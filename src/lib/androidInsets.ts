// The navigation bar's height on Android, for everything pinned to the bottom
// of the page.
//
// The app draws edge-to-edge, so bottom bars, sheets and toasts keep clear of
// the gesture bar themselves, through `--safe-bottom` (global.css): the larger
// of `env(safe-area-inset-bottom)` and `--android-nav-bottom`, set here. A
// current WebView reports the env() value and the two agree. A WebView before
// roughly Chrome 136 reports 0 for the bottom — measured on an API 36 emulator
// with WebView 133: top 52px, bottom 0, and the home bar's labels drew through
// the gesture pill — so the activity measures the bar and hands the number
// over (MainActivity.reportNavigationBarInset).
//
// Read synchronously: `RiwaqInsets.bottom()` is a plain JavaScript interface
// call, so nothing here waits on IPC or delays first paint. Read again on
// resize and when the activity says the insets changed. Outside Android there
// is no bridge and this does nothing.

declare global {
  interface Window {
    RiwaqInsets?: { bottom(): number };
  }
}

export const NAV_BOTTOM_VAR = "--android-nav-bottom";

/** Installed once from main.tsx. Returns the teardown, for tests. */
export function installAndroidInsets(
  root: HTMLElement = document.documentElement,
): () => void {
  const bridge = window.RiwaqInsets;
  if (!bridge) return () => {};
  const apply = () => {
    let dp = 0;
    try {
      dp = Number(bridge.bottom());
    } catch {
      // A bridge that throws is no worse than no bridge: env() stands.
    }
    if (Number.isFinite(dp) && dp > 0) {
      root.style.setProperty(NAV_BOTTOM_VAR, `${dp}px`);
    } else {
      root.style.removeProperty(NAV_BOTTOM_VAR);
    }
  };
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("riwaq-insets", apply);
  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("riwaq-insets", apply);
  };
}
