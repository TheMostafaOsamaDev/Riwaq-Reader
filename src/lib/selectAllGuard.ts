// Select-all selects nothing in Riwaq. Selection is something the reader does
// with the mouse or a finger; ⌘A / Ctrl+A, Edit ▸ Select All in the macOS menu
// bar (Tauri installs that menu) or "Select all" in Android's selection
// toolbar painting the whole window — or the whole chapter — in selection
// colour is the web page showing through. A text field keeps its own
// select-all, because there it means "this field's text".
//
// Every one of those routes reaches the engine's select-all command, and that
// command first fires a cancelable `selectstart` at the document root. A drag,
// double-click or long-press fires it at the node under the pointer instead,
// and a focused field's select-all fires it at the field — so the root is the
// tell, and one listener covers the keyboard, the menu and the toolbar alike.
// Measured in WebKit, Chromium and a real WKWebView with the Edit menu present.
//
// Not a keydown filter: that misses the menu item, which selects with no key
// press at all, and has to second-guess keyboard layouts to find the chord.

export function onSelectStart(e: Event): void {
  if (e.target === document.body || e.target === document.documentElement) {
    e.preventDefault();
  }
}

/** Installed once from main.tsx. Returns the teardown, for tests. */
export function installSelectAllGuard(): () => void {
  document.addEventListener("selectstart", onSelectStart, { capture: true });
  return () =>
    document.removeEventListener("selectstart", onSelectStart, {
      capture: true,
    });
}
