// Files handed to Riwaq from outside: an "Open with" launch, an Android
// share, a drag-and-drop.
//
// Why a queue and not just an event. A double-clicked file LAUNCHES the
// app, so Rust learns the path long before the webview exists to hear an
// emit. An event alone would drop the very first open, which is the whole
// feature. So paths land here, and the emit is only a nudge that carries
// no payload — the frontend always drains the queue, which means a
// listener attaching late still sees everything that arrived before it.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

/// Extensions Riwaq can read. The single source of truth for what a
/// drop will accept — the frontend never second-guesses this list.
/// Note these decide only what the OVERLAY promises; the authoritative
/// check is still the byte sniff in src/store/bookFormat.ts, and
/// stagePaths rejects a file whose bytes disagree with its name.
const SUPPORTED: [&str; 3] = ["epub", "pdf", "docx"];

static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Event name. Payload-less by design; see the module comment.
const OPENED_EVENT: &str = "app://opened";

/// Queue paths and nudge the frontend. Safe to call before the webview
/// exists — the emit simply reaches nobody, and the drain on mount picks
/// the paths up.
pub fn push<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut q) = PENDING.lock() {
        q.extend(paths);
    }
    let _ = app.emit(OPENED_EVENT, ());
}

/// Queue paths without an AppHandle, for callers that run before one
/// exists (the argv scan in setup runs early enough that emitting is
/// pointless anyway — the frontend drains on mount).
pub fn push_silent(paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut q) = PENDING.lock() {
        q.extend(paths);
    }
}

#[tauri::command]
pub fn take_pending_opens() -> Vec<String> {
    PENDING
        .lock()
        .map(|mut q| std::mem::take(&mut *q))
        .unwrap_or_default()
}

#[derive(Serialize)]
pub struct DropClassification {
    /// Every book the drop resolved to, including files found one level
    /// inside dropped folders. This is the list the frontend imports.
    pub books: Vec<String>,
    /// Dropped paths that yielded no book — a stray .txt, an empty folder.
    /// Only used to decide whether to say anything about skipped files.
    pub unsupported: Vec<String>,
}

/// Resolve a drop into a list of importable books.
///
/// Rust rather than JS for two reasons: a dropped FOLDER is
/// indistinguishable from an extension-less file by name alone, and
/// expanding one needs a directory read the webview can't do for arbitrary
/// paths. Folders are walked ONE level — a shelf of books is the case
/// worth handling; a recursive walk of a dropped home directory is not.
///
/// Called once per drag-enter, since Tauri's `over` event carries no
/// paths, so the I/O is paid once per drag rather than per mousemove.
#[tauri::command]
pub fn classify_drop(paths: Vec<String>) -> DropClassification {
    let mut books = Vec::new();
    let mut unsupported = Vec::new();

    for p in paths {
        let path = Path::new(&p);
        if path.is_dir() {
            let found = books.len();
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    let child = entry.path();
                    if child.is_file() && is_book(&child) {
                        books.push(child.to_string_lossy().into_owned());
                    }
                }
            }
            // An empty folder, or one holding nothing we can read, is a
            // refusal like any other — otherwise the overlay would accept
            // a drop that imports nothing.
            if books.len() == found {
                unsupported.push(p);
            }
            continue;
        }
        if is_book(path) {
            books.push(p);
        } else {
            unsupported.push(p);
        }
    }

    // read_dir yields in filesystem order, which is arbitrary. Sort so a
    // dropped folder imports in the order the user sees in their file
    // manager.
    books.sort();
    DropClassification { books, unsupported }
}

fn is_book(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}
