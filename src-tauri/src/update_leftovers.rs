//! Clears the installers the Windows updater leaves in `%TEMP%`.
//!
//! tauri-plugin-updater writes each downloaded installer into
//! `<temp>/<product>-<ver>-updater-XXXX/` and then exits the process, so the
//! folder is never removed (about 10 MB per update). On every desktop launch we
//! delete the ones that belong to this version or an older one.

use std::path::Path;

/// `a.b.c` as a single comparable number.
fn version_code(v: &str) -> Option<u64> {
    let mut parts = v.split('.');
    let a: u64 = parts.next()?.parse().ok()?;
    let b: u64 = parts.next()?.parse().ok()?;
    let c: u64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(a * 1_000_000 + b * 1_000 + c)
}

/// True for `<product>-<a>.<b>.<c>-updater-<rest>` with a version at or below
/// the running one. A newer folder may belong to an update in progress.
#[cfg_attr(not(desktop), allow(dead_code))]
pub fn is_stale_leftover(name: &str, product: &str, running: &str) -> bool {
    let Some(rest) = name.strip_prefix(product).and_then(|r| r.strip_prefix('-')) else {
        return false;
    };
    let Some((ver, tail)) = rest.split_once("-updater-") else {
        return false;
    };
    if tail.is_empty() {
        return false;
    }
    match (version_code(ver), version_code(running)) {
        (Some(v), Some(r)) => v <= r,
        _ => false,
    }
}

/// Removes matching directories directly inside `dir`; returns how many went.
/// Symlinks and plain files are never touched; per-entry errors are ignored.
#[cfg_attr(not(desktop), allow(dead_code))]
pub fn sweep(dir: &Path, product: &str, running: &str) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() || !ft.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if is_stale_leftover(name, product, running)
            && std::fs::remove_dir_all(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_only_our_updater_dirs_at_or_below_the_running_version() {
        assert!(is_stale_leftover(
            "Riwaq-0.5.3-updater-a1B2c3",
            "Riwaq",
            "0.6.0"
        ));
        assert!(is_stale_leftover(
            "Riwaq-0.6.0-updater-zz",
            "Riwaq",
            "0.6.0"
        ));
        // A NEWER version's folder may belong to an update in progress.
        assert!(!is_stale_leftover(
            "Riwaq-0.6.1-updater-zz",
            "Riwaq",
            "0.6.0"
        ));
        // Never touch anything that isn't ours by name.
        assert!(!is_stale_leftover(
            "Other-0.5.3-updater-zz",
            "Riwaq",
            "0.6.0"
        ));
        assert!(!is_stale_leftover(
            "Riwaq-0.5.3-installer.exe",
            "Riwaq",
            "0.6.0"
        ));
        assert!(!is_stale_leftover("Riwaq-x.y-updater-zz", "Riwaq", "0.6.0"));
    }
    #[test]
    fn sweep_removes_stale_dirs_and_keeps_the_rest() {
        let base = std::env::temp_dir().join(format!("riwaq-sweep-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        for d in [
            "Riwaq-0.5.3-updater-aa",
            "Riwaq-0.7.0-updater-bb",
            "Unrelated",
        ] {
            std::fs::create_dir_all(base.join(d)).unwrap();
            std::fs::write(base.join(d).join("f.exe"), b"x").unwrap();
        }
        assert_eq!(sweep(&base, "Riwaq", "0.6.0"), 1);
        assert!(!base.join("Riwaq-0.5.3-updater-aa").exists());
        assert!(base.join("Riwaq-0.7.0-updater-bb").exists());
        assert!(base.join("Unrelated").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }
}
