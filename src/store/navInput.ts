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
// forward() as every other input.
//
// Every listener is on the window in the capture phase, so it runs before
// any handler in the page can stop the event, and a key handled here is
// stopped so no later handler (a reader's arrow keys, a menu's) also acts on
// the same press.
//
// Android is untouched: hardware Back arrives as `popstate` through the
// webview's own history.

import { isTextEntry } from "../lib/isTextEntry";
import { back, forward } from "./navigation";

type Direction = "back" | "forward";

const SIDE_BUTTONS: Record<number, Direction> = { 3: "back", 4: "forward" };

/** The [ / ] key on a layout that types a non-Latin letter there (Arabic,
 *  for one), where `e.key` is that letter. A Latin letter (German ü) or a
 *  dead key keeps its own meaning. */
function nonLatinKeyAt(e: KeyboardEvent, code: string): boolean {
  return (
    e.code === code &&
    [...e.key].length === 1 &&
    !/[\x20-\x7e]|\p{Script=Latin}/u.test(e.key)
  );
}

/** Which way a keydown navigates, or null if it isn't a navigation key. */
function navDirection(e: KeyboardEvent): Direction | null {
  if (e.key === "BrowserBack") return "back";
  if (e.key === "BrowserForward") return "forward";
  if (e.shiftKey || e.ctrlKey) return null;
  if (e.metaKey && !e.altKey) {
    if (e.key === "[" || nonLatinKeyAt(e, "BracketLeft")) return "back";
    if (e.key === "]" || nonLatinKeyAt(e, "BracketRight")) return "forward";
    return null;
  }
  if (e.altKey && !e.metaKey) {
    if (e.key === "ArrowLeft") return "back";
    if (e.key === "ArrowRight") return "forward";
  }
  return null;
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
  e.stopPropagation();
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
export function installNavInput(): () => void {
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("mouseup", onMouseUp, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("mouseup", onMouseUp, true);
  };
}
