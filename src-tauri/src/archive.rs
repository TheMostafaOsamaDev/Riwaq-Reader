// Native file staging + zip access for book imports.
//
// Why this exists: on Android, Tauri's IPC cannot use the custom-protocol
// transport (`ipc-protocol.js` hard-disables it because the Android webview
// can't read a request body), so *every* invoke — including
// `plugin:fs|write_file` — is serialized by `processIpcMessage` into a JSON
// string and handed to `window.ipc.postMessage`. That serializer turns a
// `Uint8Array` payload into `Array.from(bytes)`, i.e. one JS array element
// per byte. Two consequences:
//
//   * Hard ceiling. V8's `FixedArray::kMaxLength` is 134_217_725, so any
//     file at or above ~128 MB dies with `RangeError: Invalid array length`
//     before a single byte reaches Rust. That is the 206 MB EPUB bug.
//   * Brutal slowness below the ceiling. A 20 MB book becomes a ~20M-element
//     JS array, then an ~80 MB JSON string, then a serde parse — per file,
//     and once more per extracted image.
//
// So the frontend never carries book bytes any more. It hands us a source
// path and a destination, and everything heavy (copy, unzip, extract)
// happens here. The JS side only ever receives the small text entries it
// genuinely has to parse (OPF, nav/NCX, chapter XHTML).
//
// Commands:
//   stage_import_file — stream a picked file into app-data, sniffing format
//   zip_entries       — list entry names in a staged archive
//   zip_read_texts    — batch-read entries as UTF-8 text
//   zip_extract       — batch-extract entries straight to disk
//   zip_read_bytes    — read one small entry as raw bytes (covers)
//   write_chunk_b64   — append in-memory bytes without the JSON-array blow-up
//   delete_staged     — remove a staged file/dir after a failed import
//
// All caller-supplied paths are relative to the app-data dir and are
// resolved through `resolve()`, which refuses anything that escapes it.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Component, Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_fs::{FilePath, FsExt, OpenOptions};

/// Progress events are throttled to this granularity so a large copy doesn't
/// flood the IPC channel with a message per chunk.
const PROGRESS_STEP: f64 = 0.02;

/// Copy buffer. Big enough to keep syscall overhead irrelevant on a 200 MB
/// file, small enough that the peak RSS cost is noise on a phone.
const COPY_BUF: usize = 256 * 1024;

/// Per-entry ceiling for `zip_read_texts`. A book's XHTML is measured in tens
/// of KB; anything at this scale is a malformed or hostile archive, and
/// materializing it as a JS string would reintroduce the memory blow-up this
/// module exists to avoid. Generous enough that no real chapter trips it.
const MAX_TEXT_ENTRY: u64 = 64 * 1024 * 1024;

/// Cumulative ceiling for one `zip_read_texts` call. The parser prefetches a
/// whole spine at once, so without this a book with thousands of large
/// chapters could ask for more text than the webview can hold. Entries past
/// the cap come back as `null`; the caller re-reads those individually.
const MAX_TEXT_BATCH: u64 = 48 * 1024 * 1024;

#[derive(Serialize, Clone)]
pub struct StagedFile {
    pub size: u64,
    /// "epub" | "pdf" | "docx" | "unknown" — sniffed from the bytes, because
    /// Android's SAF picker returns a `content://` URI with no extension.
    pub format: String,
    /// Lowercase hex SHA-256 of the file's bytes. Lets an import recognise a
    /// book the library already holds and reuse it — with its reading
    /// position and highlights — instead of adding a second copy. Computed
    /// during the copy, so it costs a pass over bytes already in hand.
    pub hash: String,
}

#[derive(Deserialize)]
pub struct ExtractItem {
    /// Entry name inside the archive.
    pub entry: String,
    /// Destination, relative to app-data.
    pub dest: String,
}

#[derive(Serialize, Clone)]
struct ProgressPayload {
    /// Correlates the event with the import that asked for it.
    token: String,
    phase: String,
    /// 0.0 – 1.0.
    ratio: f64,
}

// ── path safety ────────────────────────────────────────────────────────────

fn app_data<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))
}

/// Resolve `rel` under the app-data dir. Rejects absolute paths, drive
/// prefixes and any `..` segment, so a malformed book can't write outside
/// the app's own storage.
fn resolve<R: Runtime>(app: &AppHandle<R>, rel: &str) -> Result<PathBuf, String> {
    let root = app_data(app)?;
    let candidate = Path::new(rel);
    for part in candidate.components() {
        match part {
            Component::Normal(_) => {}
            _ => return Err(format!("unsafe path: {rel}")),
        }
    }
    Ok(root.join(candidate))
}

/// Same rules as `resolve`, applied to a name that came out of a zip's
/// central directory. Returns None for entries we refuse to write (zip-slip
/// attempts, absolute names, empty names).
fn safe_entry_name(name: &str) -> Option<&str> {
    if name.is_empty() || name.ends_with('/') {
        return None;
    }
    for part in Path::new(name).components() {
        if !matches!(part, Component::Normal(_)) {
            return None;
        }
    }
    Some(name)
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
    }
    Ok(())
}

// ── format sniffing ────────────────────────────────────────────────────────

const ZIP_LOCAL_HEADER: &[u8] = b"PK\x03\x04";
const EPUB_MIMETYPE: &[u8] = b"mimetypeapplication/epub+zip";
/// EPUB's uncompressed `mimetype` entry must come first, so its payload sits
/// at a fixed offset: 30-byte local header + the 8-byte name.
const EPUB_MIMETYPE_OFFSET: usize = 30;

/// Mirrors `src/store/bookFormat.ts` — kept in sync deliberately so the
/// frontend's dev harness (which still sniffs in JS) and the native import
/// path agree on what a file is.
fn sniff_format(head: &[u8], archive: Option<&Path>) -> String {
    if head.starts_with(b"%PDF-") {
        return "pdf".into();
    }
    if head.starts_with(ZIP_LOCAL_HEADER) {
        let end = EPUB_MIMETYPE_OFFSET + EPUB_MIMETYPE.len();
        if head.len() >= end && &head[EPUB_MIMETYPE_OFFSET..end] == EPUB_MIMETYPE {
            return "epub".into();
        }
        // No `mimetype` entry (or a non-conforming one). Fall back to the
        // central directory, which is authoritative and — unlike the JS
        // version's linear byte scan over the whole file — cheap to read.
        if let Some(path) = archive {
            if let Some(kind) = sniff_zip_entries(path) {
                return kind;
            }
        }
    }
    "unknown".into()
}

fn sniff_zip_entries(path: &Path) -> Option<String> {
    let file = File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file)).ok()?;
    let mut is_docx = false;
    for i in 0..zip.len() {
        let name = zip.by_index_raw(i).ok()?.name().to_string();
        if name == "META-INF/container.xml" {
            return Some("epub".into());
        }
        if name == "word/document.xml" {
            is_docx = true;
        }
    }
    is_docx.then(|| "docx".into())
}

// ── commands ───────────────────────────────────────────────────────────────

/// Stream a picked file into `dest` (relative to app-data) without the bytes
/// ever entering the webview, and report what format it turned out to be.
///
/// `src` is whatever the file dialog handed the frontend: a real filesystem
/// path on desktop, a `content://` SAF URI on Android. `FsExt::open` resolves
/// both — on Android it round-trips through the Kotlin plugin to get a file
/// descriptor for the content resolver.
#[tauri::command]
pub async fn stage_import_file<R: Runtime>(
    app: AppHandle<R>,
    src: String,
    dest: String,
    token: String,
) -> Result<StagedFile, String> {
    let dest_path = resolve(&app, &dest)?;
    let file_path: FilePath = src
        .parse()
        .map_err(|_| format!("unrecognised source path: {src}"))?;

    // Opening happens here (JNI on Android); the resulting descriptor is a
    // plain `std::fs::File`, which is Send, so the copy itself can move to a
    // blocking worker.
    let mut opts = OpenOptions::new();
    opts.read(true);
    let source = app
        .fs()
        .open(file_path, opts)
        .map_err(|e| format!("cannot open picked file: {e}"))?;

    let total = source.metadata().map(|m| m.len()).unwrap_or(0);
    ensure_parent(&dest_path)?;

    let emitter = app.clone();
    let dest_for_worker = dest_path.clone();
    let staged = tauri::async_runtime::spawn_blocking(move || -> Result<StagedFile, String> {
        let mut reader = BufReader::with_capacity(COPY_BUF, source);
        let out = File::create(&dest_for_worker)
            .map_err(|e| format!("cannot create {}: {e}", dest_for_worker.display()))?;
        let mut writer = BufWriter::with_capacity(COPY_BUF, out);

        let mut head = Vec::with_capacity(64);
        let mut buf = vec![0u8; COPY_BUF];
        let mut copied: u64 = 0;
        let mut last_emitted = 0.0f64;
        let mut hasher = Sha256::new();

        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("read failed: {e}"))?;
            if n == 0 {
                break;
            }
            if head.len() < 64 {
                let want = (64 - head.len()).min(n);
                head.extend_from_slice(&buf[..want]);
            }
            writer
                .write_all(&buf[..n])
                .map_err(|e| format!("write failed: {e}"))?;
            hasher.update(&buf[..n]);
            copied += n as u64;

            if total > 0 {
                let ratio = copied as f64 / total as f64;
                if ratio - last_emitted >= PROGRESS_STEP {
                    last_emitted = ratio;
                    emit_progress(&emitter, &token, "copy", ratio);
                }
            }
        }
        writer.flush().map_err(|e| format!("flush failed: {e}"))?;
        drop(writer);

        emit_progress(&emitter, &token, "copy", 1.0);

        let format = sniff_format(&head, Some(&dest_for_worker));
        Ok(StagedFile {
            size: copied,
            format,
            hash: format!("{:x}", hasher.finalize()),
        })
    })
    .await
    .map_err(|e| format!("staging task failed: {e}"))??;

    Ok(staged)
}

/// Entry names in a staged archive. Directory entries are omitted — the
/// parser only ever looks up files.
#[tauri::command]
pub async fn zip_entries<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<Vec<String>, String> {
    let archive = resolve(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        let mut zip = open_zip(&archive)?;
        let mut out = Vec::with_capacity(zip.len());
        for i in 0..zip.len() {
            let entry = zip
                .by_index_raw(i)
                .map_err(|e| format!("bad zip entry {i}: {e}"))?;
            let name = entry.name();
            if !name.ends_with('/') {
                out.push(name.to_string());
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("zip listing failed: {e}"))?
}

/// Read several entries as UTF-8 text in one round trip. Missing or
/// oversized entries come back as `null` so the caller can skip them the
/// same way it skips a missing file today.
///
/// Batching matters: on Android every invoke is a `postMessage` plus a
/// `webview.eval` of the response, so 114 individual chapter reads cost 114
/// full IPC round trips. One call costs one.
#[tauri::command]
pub async fn zip_read_texts<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    entries: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    let archive = resolve(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<Option<String>>, String> {
        let mut zip = open_zip(&archive)?;
        let mut out = Vec::with_capacity(entries.len());
        let mut budget = MAX_TEXT_BATCH;
        for name in &entries {
            let text = read_entry_text(&mut zip, name);
            match &text {
                Some(t) if (t.len() as u64) <= budget => {
                    budget -= t.len() as u64;
                    out.push(text);
                }
                // Over budget for this batch. Report it missing rather than
                // truncated — the caller retries it on its own, where the
                // only limit is MAX_TEXT_ENTRY.
                Some(_) => out.push(None),
                None => out.push(None),
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("zip read failed: {e}"))?
}

/// Extract entries straight to disk. Returns one bool per item so the caller
/// can drop references to entries the archive didn't actually contain.
#[tauri::command]
pub async fn zip_extract<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    items: Vec<ExtractItem>,
    token: String,
) -> Result<Vec<bool>, String> {
    let archive = resolve(&app, &path)?;
    let mut targets = Vec::with_capacity(items.len());
    for item in &items {
        targets.push(resolve(&app, &item.dest)?);
    }

    let emitter = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<bool>, String> {
        let mut zip = open_zip(&archive)?;
        let mut out = Vec::with_capacity(items.len());
        let total = items.len().max(1) as f64;
        let mut last_emitted = 0.0f64;

        for (i, item) in items.iter().enumerate() {
            out.push(extract_one(&mut zip, &item.entry, &targets[i]));
            let ratio = (i + 1) as f64 / total;
            if ratio - last_emitted >= PROGRESS_STEP || i + 1 == items.len() {
                last_emitted = ratio;
                emit_progress(&emitter, &token, "extract", ratio);
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("zip extract failed: {e}"))?
}

/// Read one entry as raw bytes. Returned through `tauri::ipc::Response` so it
/// travels as an octet-stream over the channel/fetch path rather than as a
/// JSON number array. Intended for single small entries (covers); bulk data
/// should use `zip_extract` and stay on disk.
#[tauri::command]
pub async fn zip_read_bytes<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    entry: String,
) -> Result<Response, String> {
    let archive = resolve(&app, &path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut zip = open_zip(&archive)?;
        let mut file = zip
            .by_name(&entry)
            .map_err(|_| format!("missing zip entry: {entry}"))?;
        let mut buf = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut buf)
            .map_err(|e| format!("read {entry}: {e}"))?;
        Ok(buf)
    })
    .await
    .map_err(|e| format!("zip read failed: {e}"))??;
    Ok(Response::new(bytes))
}

/// Append (or create) a file from a base64 chunk.
///
/// For archives the app builds in memory — a Sources download, a DOCX
/// conversion — the bytes have no on-disk origin to stream from, so they do
/// have to cross the bridge. Base64 is how to do that cheaply on Android:
/// Tauri's IPC serializer expands a `Uint8Array` to one JSON array element
/// per byte (~4x, plus a 134M-element ceiling), whereas a string passes
/// through as a string (~1.33x, no ceiling). Tauri's own docs recommend
/// exactly this for Android.
#[tauri::command]
pub async fn write_chunk_b64<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    data: String,
    append: bool,
) -> Result<(), String> {
    let dest = resolve(&app, &path)?;
    ensure_parent(&dest)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let bytes = BASE64
            .decode(data.as_bytes())
            .map_err(|e| format!("bad base64 chunk: {e}"))?;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            // First chunk truncates so a retry can't append onto a partial
            // earlier attempt; the rest append.
            .append(append)
            .truncate(!append)
            .open(&dest)
            .map_err(|e| format!("cannot open {}: {e}", dest.display()))?;
        file.write_all(&bytes)
            .map_err(|e| format!("write failed: {e}"))
    })
    .await
    .map_err(|e| format!("write task failed: {e}"))?
}

/// Remove a staged file or directory. Used to clean up after a failed or
/// cancelled import so a half-written 200 MB copy doesn't linger.
#[tauri::command]
pub async fn delete_staged<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let target = resolve(&app, &path)?;
    if target.is_dir() {
        let _ = fs::remove_dir_all(&target);
    } else {
        let _ = fs::remove_file(&target);
    }
    Ok(())
}

/// Move a staged file into its final name inside app-data. Used once the
/// parse succeeds and we know the book id, so the original never has to be
/// copied twice.
#[tauri::command]
pub async fn rename_staged<R: Runtime>(
    app: AppHandle<R>,
    from: String,
    to: String,
) -> Result<(), String> {
    let src = resolve(&app, &from)?;
    let dst = resolve(&app, &to)?;
    ensure_parent(&dst)?;
    fs::rename(&src, &dst).map_err(|e| format!("rename failed: {e}"))
}

// ── helpers ────────────────────────────────────────────────────────────────

type Zip = zip::ZipArchive<BufReader<File>>;

fn open_zip(path: &Path) -> Result<Zip, String> {
    let file = File::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    zip::ZipArchive::new(BufReader::new(file)).map_err(|e| format!("not a readable zip: {e}"))
}

fn read_entry_text(zip: &mut Zip, name: &str) -> Option<String> {
    let mut file = zip.by_name(name).ok()?;
    if file.size() > MAX_TEXT_ENTRY {
        return None;
    }
    let mut raw = Vec::with_capacity(file.size() as usize);
    file.read_to_end(&mut raw).ok()?;
    // Lossy on purpose: one bad byte in one chapter shouldn't abort an
    // otherwise fine import, which is what the JS parser's try/catch did.
    Some(String::from_utf8_lossy(&raw).into_owned())
}

fn extract_one(zip: &mut Zip, entry: &str, dest: &Path) -> bool {
    if safe_entry_name(entry).is_none() {
        return false;
    }
    let Ok(mut file) = zip.by_name(entry) else {
        return false;
    };
    if ensure_parent(dest).is_err() {
        return false;
    }
    let Ok(out) = File::create(dest) else {
        return false;
    };
    let mut writer = BufWriter::with_capacity(COPY_BUF, out);
    if std::io::copy(&mut file, &mut writer).is_err() {
        return false;
    }
    writer.flush().is_ok()
}

fn emit_progress<R: Runtime>(app: &AppHandle<R>, token: &str, phase: &str, ratio: f64) {
    let _ = app.emit(
        "import://progress",
        ProgressPayload {
            token: token.to_string(),
            phase: phase.to_string(),
            ratio: ratio.clamp(0.0, 1.0),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sniffs_epub_by_mimetype_entry() {
        let mut head = Vec::from(ZIP_LOCAL_HEADER);
        head.resize(EPUB_MIMETYPE_OFFSET, 0);
        head.extend_from_slice(EPUB_MIMETYPE);
        assert_eq!(sniff_format(&head, None), "epub");
    }

    #[test]
    fn sniffs_pdf_by_magic() {
        assert_eq!(sniff_format(b"%PDF-1.7\n", None), "pdf");
    }

    #[test]
    fn unknown_for_arbitrary_bytes() {
        assert_eq!(sniff_format(b"not a book at all", None), "unknown");
    }

    #[test]
    fn rejects_zip_slip_entry_names() {
        assert!(safe_entry_name("../../etc/passwd").is_none());
        assert!(safe_entry_name("/abs/path").is_none());
        assert!(safe_entry_name("images/cover.png").is_some());
        assert!(safe_entry_name("dir/").is_none());
    }
}

