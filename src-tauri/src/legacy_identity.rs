// The one-time move of the whole app-data directory from the bundle
// identifier Riwaq shipped under before.
//
// Tauri derives the app-data directory from the identifier in
// tauri.conf.json: `<data dir>/<identifier>`. Changing the identifier
// therefore does not rename that directory — it points the app at a
// different one, and an existing install's entire library (books/,
// library.json, shelves.json, downloadQueue.json) is simply no longer where
// the app looks. Nothing fails loudly; the library just reads as empty.
//
// This is the level above ./store/legacyRoot.ts on the JS side, which moves
// the ROOT folder WITHIN one app-data directory. That one could use the fs
// plugin because both names sat inside the scope; this one cannot — the old
// identifier's directory is a sibling of the scoped root, so it has to be
// Rust.
//
// Deliberately conservative, and the same stance as legacyRoot.ts: the new
// location always wins, nothing is ever merged into an existing entry, and
// nothing is deleted. A failed move leaves the old directory untouched for
// the user to recover by hand.

#[cfg(desktop)]
use std::path::{Path, PathBuf};

/// The identifier Riwaq shipped under up to and including v0.2.1, back when
/// the app was called Leaflet. Keep until it is safe to assume nobody is
/// upgrading from a `com.leaflet.reader` install any more.
#[cfg(desktop)]
pub const LEGACY_IDENTIFIER: &str = "com.leaflet.reader";

/// The library root inside the app-data directory. MUST match `ROOT` in
/// src/store/paths.ts — its presence in the new location is what marks that
/// location as already in use.
#[cfg(desktop)]
const ROOT: &str = "riwaq";

/// Move everything in `old_dir` into `new_dir`, entry by entry.
///
/// No-op when `old_dir` is absent, and no-op when `new_dir` already holds a
/// library root — a post-rename install wins outright rather than having a
/// pre-rename one merged underneath it. Individual entries that already
/// exist in `new_dir` are left alone for the same reason.
#[cfg(desktop)]
pub fn migrate_app_data(old_dir: &Path, new_dir: &Path) -> std::io::Result<()> {
    if !old_dir.is_dir() {
        return Ok(());
    }
    if new_dir.join(ROOT).exists() {
        return Ok(());
    }

    std::fs::create_dir_all(new_dir)?;
    for entry in std::fs::read_dir(old_dir)? {
        let entry = entry?;
        let dest = new_dir.join(entry.file_name());
        if dest.exists() {
            continue;
        }
        // Both directories are siblings under the platform data dir, so this
        // is a same-volume rename: instant whatever the library weighs, and
        // it never leaves a half-copied book behind.
        std::fs::rename(entry.path(), dest)?;
    }
    Ok(())
}

/// Pair each of this build's app-data directories with the directory the old
/// identifier would have used: its sibling under [`LEGACY_IDENTIFIER`].
///
/// Windows splits roaming and local app data into two different parents, so
/// both have to be checked; every other desktop platform reports the same
/// path twice and must not be migrated twice.
#[cfg(desktop)]
fn legacy_pairs(new_dirs: impl IntoIterator<Item = PathBuf>) -> Vec<(PathBuf, PathBuf)> {
    let mut pairs: Vec<(PathBuf, PathBuf)> = Vec::new();
    for new_dir in new_dirs {
        let Some(parent) = new_dir.parent() else {
            continue;
        };
        if pairs.iter().any(|(_, seen)| *seen == new_dir) {
            continue;
        }
        pairs.push((parent.join(LEGACY_IDENTIFIER), new_dir));
    }
    pairs
}

/// Move a pre-rename install's app data into the directory this build reads.
///
/// Desktop only. On Android the old package's data sits in a sandbox this
/// process cannot open at all, so there is nothing to attempt; the command
/// still exists there so the frontend has one code path.
#[tauri::command]
pub async fn migrate_legacy_identity(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        let path = app.path();
        let dirs = [path.app_data_dir(), path.app_local_data_dir()];
        for (old_dir, new_dir) in legacy_pairs(dirs.into_iter().flatten()) {
            migrate_app_data(&old_dir, &new_dir).map_err(|e| e.to_string())?;
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
    }
    Ok(())
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    /// A fresh `<temp>/old` + `<temp>/new` pair, unique per test.
    fn scratch() -> (PathBuf, PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!(
            "riwaq-identity-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        (
            base.join("com.leaflet.reader"),
            base.join("com.riwaq.reader"),
            base,
        )
    }

    /// A pre-rename install: a library root with a book in it, plus the
    /// debug/ directory dev builds write to.
    fn seed_old_install(old: &Path) {
        fs::create_dir_all(old.join(ROOT).join("books/b1")).unwrap();
        fs::write(old.join(ROOT).join("library.json"), r#"{"books":["b1"]}"#).unwrap();
        fs::write(old.join(ROOT).join("books/b1/book.epub"), b"EPUB").unwrap();
        fs::create_dir_all(old.join("debug")).unwrap();
    }

    #[test]
    fn pairs_a_data_dir_with_the_old_identifier_beside_it() {
        let pairs = legacy_pairs([PathBuf::from("/data/com.riwaq.reader")]);

        assert_eq!(
            pairs,
            vec![(
                PathBuf::from("/data/com.leaflet.reader"),
                PathBuf::from("/data/com.riwaq.reader"),
            )]
        );
    }

    #[test]
    fn keeps_roaming_and_local_app_data_apart_on_windows() {
        let pairs = legacy_pairs([
            PathBuf::from("/Roaming/com.riwaq.reader"),
            PathBuf::from("/Local/com.riwaq.reader"),
        ]);

        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, PathBuf::from("/Roaming/com.leaflet.reader"));
        assert_eq!(pairs[1].0, PathBuf::from("/Local/com.leaflet.reader"));
    }

    #[test]
    fn migrates_a_repeated_data_dir_only_once() {
        // macOS and Linux report the same path for app data and local app
        // data; migrating it twice would run the move against a directory
        // the first pass already emptied.
        let same = PathBuf::from("/data/com.riwaq.reader");
        let pairs = legacy_pairs([same.clone(), same]);

        assert_eq!(pairs.len(), 1);
    }

    #[test]
    fn skips_a_data_dir_with_no_parent_to_look_beside() {
        assert!(legacy_pairs([PathBuf::from("/")]).is_empty());
    }

    #[test]
    fn moves_the_whole_library_when_the_new_location_is_untouched() {
        let (old, new, _base) = scratch();
        seed_old_install(&old);

        migrate_app_data(&old, &new).unwrap();

        assert_eq!(
            fs::read_to_string(new.join(ROOT).join("library.json")).unwrap(),
            r#"{"books":["b1"]}"#
        );
        assert_eq!(
            fs::read(new.join(ROOT).join("books/b1/book.epub")).unwrap(),
            b"EPUB"
        );
        assert!(new.join("debug").is_dir());
        assert!(
            !old.join(ROOT).exists(),
            "the old root should be gone, not copied"
        );
    }

    #[test]
    fn leaves_both_alone_when_the_new_location_already_has_a_library() {
        let (old, new, _base) = scratch();
        seed_old_install(&old);
        fs::create_dir_all(new.join(ROOT)).unwrap();
        fs::write(
            new.join(ROOT).join("library.json"),
            r#"{"books":["newer"]}"#,
        )
        .unwrap();

        migrate_app_data(&old, &new).unwrap();

        assert_eq!(
            fs::read_to_string(new.join(ROOT).join("library.json")).unwrap(),
            r#"{"books":["newer"]}"#,
            "the post-rename library must win"
        );
        assert!(
            old.join(ROOT).join("library.json").exists(),
            "the old library must be left intact to recover by hand"
        );
    }

    #[test]
    fn never_overwrites_an_entry_that_already_exists() {
        let (old, new, _base) = scratch();
        seed_old_install(&old);
        // The new dir exists with a debug/ (dev logging creates it early)
        // but no library root yet — so the move is still on.
        fs::create_dir_all(new.join("debug")).unwrap();
        fs::write(new.join("debug/reader-debug.log"), b"new session").unwrap();

        migrate_app_data(&old, &new).unwrap();

        assert!(
            new.join(ROOT).join("library.json").exists(),
            "the library still moves"
        );
        assert_eq!(
            fs::read(new.join("debug/reader-debug.log")).unwrap(),
            b"new session",
            "an entry already present in the new location is not replaced"
        );
        assert!(
            old.join("debug").is_dir(),
            "the skipped entry stays where it was"
        );
    }

    #[test]
    fn is_a_no_op_when_there_is_no_old_install() {
        let (old, new, _base) = scratch();

        migrate_app_data(&old, &new).unwrap();

        assert!(!new.exists(), "nothing to migrate means nothing is created");
    }
}
