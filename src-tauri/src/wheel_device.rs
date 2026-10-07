//! Tell the page whether the wheel in use is a mouse or a trackpad.
//!
//! WKWebView applies a mouse-wheel notch in a single frame, so the page jumps
//! a few lines per notch, while a trackpad's stream of small deltas is
//! already smooth. The reader smooths the mouse and leaves the trackpad alone
//! (src/reader/scroll/smoothWheel.ts), which needs to know which one sent an
//! event. The DOM cannot say: WebKit reports a notch and a trackpad swipe with
//! the same `WheelEvent` fields, in the same units, at the same 3:1
//! `wheelDelta` ratio. AppKit can — `hasPreciseScrollingDeltas` is false for a
//! line-based wheel and true for a trackpad or Magic Mouse surface.
//!
//! A local event monitor sees every scroll event before the webview does and
//! writes `window.__riwaqWheel` whenever the device CHANGES, so the cost is one
//! `eval` per switch between devices, not one per event. The script can
//! arrive just after the event that caused it, so the first notch after
//! switching from the trackpad scrolls unsmoothed; every one after is smooth.

use std::ptr::NonNull;
use std::sync::atomic::{AtomicU8, Ordering};

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask};
use tauri::{AppHandle, Manager, Runtime};

/// 0 = not yet known, 1 = mouse, 2 = trackpad.
static LAST: AtomicU8 = AtomicU8::new(0);

/// The page in the main window was (re)loaded and no longer has the flag:
/// send it again with the next scroll event, whatever the device.
pub fn forget() {
    LAST.store(0, Ordering::Relaxed);
}

pub fn install<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit hands the monitor a live event for the duration of
        // the call.
        let precise = unsafe { event.as_ref() }.hasPreciseScrollingDeltas();
        let kind = if precise { 2 } else { 1 };
        if LAST.swap(kind, Ordering::Relaxed) != kind {
            let value = if precise { "trackpad" } else { "mouse" };
            // The app's own window only: the source scrapers are webviews
            // too, showing third-party pages that have no business with it.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(format!("window.__riwaqWheel={value:?}"));
            }
        }
        // Returning the event passes it on untouched.
        event.as_ptr()
    });
    // SAFETY: called from `setup`, on the main thread; the block returns the
    // event it was given, which is a valid pointer.
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::ScrollWheel, &block)
    };
    // The monitor lives as long as the app; AppKit holds the block, and the
    // token is only needed to remove it, which we never do.
    std::mem::forget(monitor);
}
