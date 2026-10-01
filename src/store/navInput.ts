// Every desktop back/forward input, routed into the nav store.
//
// Keyboard: Alt+←/→ everywhere (back is Alt+← in RTL too, as in every
// browser), ⌘[ / ⌘], and the BrowserBack/BrowserForward keys some keyboards
// have.
//
// Mouse side buttons (4/5, `MouseEvent.button` 3/4): the webview already
// navigates on these by itself. On macOS and Linux wry swallows the native
// event, dispatches a synthetic mousedown/mouseup on the element under the
// pointer, and calls history.back()/forward() unless that mouseup was
// defaultPrevented; WebView2 (Windows) navigates on mouseup natively. So we
// cancel both halves and navigate ourselves, once, through the same back()/
// forward() as every other input. The synthetic events don't bubble, which
// is why every listener here is on the window in the capture phase.
//
// Android is untouched: hardware Back arrives as `popstate` through the
// webview's own history.

import { back, forward } from "./navigation";

type Direction = "back" | "forward";

const SIDE_BUTTONS: Record<number, Direction> = { 3: "back", 4: "forward" };

/** Which way a keydown navigates, or null if it isn't a navigation key. */
export function navDirection(e: KeyboardEvent): Direction | null {
  if (e.key === "BrowserBack") return "back";
  if (e.key === "BrowserForward") return "forward";
  if (e.shiftKey || e.ctrlKey) return null;
  if (e.metaKey && !e.altKey) {
    // On a non-Latin layout (Arabic, for one) the [ key reports a letter, so
    // fall back to the physical key, but only then: on AZERTY "BracketLeft"
    // is a different printable key and its own character must win.
    const latin = /^[\x20-\x7e]$/.test(e.key);
    if (e.key === "[" || (!latin && e.code === "BracketLeft")) return "back";
    if (e.key === "]" || (!latin && e.code === "BracketRight"))
      return "forward";
    return null;
  }
  if (e.altKey && !e.metaKey) {
    if (e.key === "ArrowLeft") return "back";
    if (e.key === "ArrowRight") return "forward";
  }
  return null;
}

function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable
  );
}

function go(dir: Direction): void {
  if (dir === "back") back();
  else forward();
}

function onKeyDown(e: KeyboardEvent): void {
  const dir = navDirection(e);
  if (!dir) return;
  // Option+←/→ moves the caret by a word on macOS; don't steal it from a
  // field the user is typing in.
  if (e.altKey && isTextEntry(e.target)) return;
  e.preventDefault();
  if (e.repeat) return; // holding the key steps once, not to the root
  go(dir);
}

function onMouseDown(e: MouseEvent): void {
  if (e.button in SIDE_BUTTONS) e.preventDefault();
}

function onMouseUp(e: MouseEvent): void {
  const dir = SIDE_BUTTONS[e.button];
  if (!dir) return;
  e.preventDefault();
  go(dir);
}

/** Install the listeners; returns a function that removes them. */
export function installNavInput(target: Window = window): () => void {
  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("mousedown", onMouseDown, true);
  target.addEventListener("mouseup", onMouseUp, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("mousedown", onMouseDown, true);
    target.removeEventListener("mouseup", onMouseUp, true);
  };
}
