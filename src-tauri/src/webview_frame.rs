//! Keep the macOS webview filling its window.
//!
//! On macOS the WKWebView of a plain Tauri window is sized only by AppKit
//! autoresizing (wry's `set_bounds` is a no-op for it). Autoresizing preserves
//! the subview's *margins*, so if the frame ever comes out wrong — seen after
//! entering full screen and after rapid minimize/maximize, upstream as
//! tauri-apps/tauri#14843 — the gap is kept on every resize after that: the
//! page sits at its old height, pinned to the bottom, under a band of bare
//! window background. Nothing on the web side can fix it; `innerHeight` is
//! simply the stale frame.
//!
//! So on every resize we compare the webview's frame with its parent's bounds
//! and put it back when they disagree — once right away, and once more after
//! the resize has settled, in case AppKit lays the window out again at the
//! end of a full-screen animation. When they agree this is two property
//! reads.
//!
//! Verified 2026-10-01 by shrinking the frame 200pt by hand: without this the
//! gap survived every full-screen enter and exit; with it, entering full
//! screen logged `repaired 1728x884 -> 1728x1084` and the gap stayed at 0.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{Runtime, WebviewWindow};

/// Bumped per resize, so a live drag schedules one settle check, not sixty.
static RESIZE_GEN: AtomicU64 = AtomicU64::new(0);

pub fn on_resized<R: Runtime>(window: WebviewWindow<R>) {
    heal(&window);
    let gen = RESIZE_GEN.fetch_add(1, Ordering::Relaxed) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        if RESIZE_GEN.load(Ordering::Relaxed) == gen {
            heal(&window);
        }
    });
}

fn heal<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.with_webview(|pv| {
        // SAFETY: `inner()` is the WKWebView, an NSView subclass, and
        // `with_webview` runs this closure on the main thread.
        let view = unsafe { &*(pv.inner() as *const objc2_app_kit::NSView) };
        let Some(parent) = (unsafe { view.superview() }) else {
            return;
        };
        let want = parent.bounds();
        let have = view.frame();
        let off = (have.origin.x - want.origin.x).abs() > 0.5
            || (have.origin.y - want.origin.y).abs() > 0.5
            || (have.size.width - want.size.width).abs() > 0.5
            || (have.size.height - want.size.height).abs() > 0.5;
        if off {
            eprintln!(
                "[webview-frame] repaired {:.0}x{:.0}@{:.0},{:.0} -> {:.0}x{:.0}",
                have.size.width,
                have.size.height,
                have.origin.x,
                have.origin.y,
                want.size.width,
                want.size.height
            );
            view.setFrame(want);
        }
    });
}
