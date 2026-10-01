// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const back = vi.fn();
const forward = vi.fn();
vi.mock("./navigation", () => ({ back, forward }));

const { installNavInput } = await import("./navInput");

let uninstall: () => void;
beforeEach(() => {
  back.mockClear();
  forward.mockClear();
  uninstall = installNavInput();
});
afterEach(() => {
  uninstall();
  document.body.replaceChildren();
});

function key(init: KeyboardEventInit, target: EventTarget = document.body) {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}

function mouse(
  type: "mousedown" | "mouseup",
  button: number,
  target: EventTarget = document.body,
) {
  // Mirrors wry's synthetic event on macOS/Linux: cancelable, NOT bubbling,
  // dispatched on whatever element is under the pointer.
  const e = new MouseEvent(type, { button, cancelable: true, bubbles: false });
  target.dispatchEvent(e);
  return e;
}

describe("keyboard", () => {
  it.each([
    [{ key: "ArrowLeft", altKey: true }, "back"],
    [{ key: "ArrowRight", altKey: true }, "forward"],
    [{ key: "[", metaKey: true }, "back"],
    [{ key: "]", metaKey: true }, "forward"],
    [{ key: "BrowserBack" }, "back"],
    [{ key: "BrowserForward" }, "forward"],
  ] as const)("%o → %s", (init, dir) => {
    const e = key(init);
    expect(e.defaultPrevented).toBe(true);
    expect(dir === "back" ? back : forward).toHaveBeenCalledTimes(1);
    expect(dir === "back" ? forward : back).not.toHaveBeenCalled();
  });

  it("⌘[ on a non-Latin layout falls back to the physical key", () => {
    // Arabic layout: the [ key reports a letter, not "[".
    key({ key: "ج", code: "BracketLeft", metaKey: true });
    key({ key: "د", code: "BracketRight", metaKey: true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledTimes(1);
  });

  it("ignores plain arrows and other modifier mixes", () => {
    for (const init of [
      { key: "ArrowLeft" },
      { key: "ArrowLeft", ctrlKey: true },
      { key: "ArrowLeft", altKey: true, shiftKey: true },
      { key: "ArrowLeft", altKey: true, metaKey: true },
      { key: "[" },
      { key: "[", metaKey: true, shiftKey: true },
    ]) {
      expect(key(init).defaultPrevented).toBe(false);
    }
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });

  it.each(["input", "textarea", "contenteditable"])(
    "leaves Alt+arrows to a %s (word motion) but still honours ⌘[",
    (kind) => {
      const el =
        kind === "contenteditable"
          ? Object.assign(document.createElement("div"), {
              contentEditable: "true",
            })
          : document.createElement(kind);
      document.body.appendChild(el);
      expect(key({ key: "ArrowLeft", altKey: true }, el).defaultPrevented).toBe(
        false,
      );
      expect(back).not.toHaveBeenCalled();
      key({ key: "[", metaKey: true }, el);
      expect(back).toHaveBeenCalledTimes(1);
    },
  );

  it("auto-repeat is swallowed: holding Alt+← steps back once", () => {
    key({ key: "ArrowLeft", altKey: true });
    const held = key({ key: "ArrowLeft", altKey: true, repeat: true });
    key({ key: "ArrowLeft", altKey: true, repeat: true });
    expect(held.defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe("mouse side buttons", () => {
  it.each([
    [3, "back"],
    [4, "forward"],
  ] as const)(
    "button %i: cancels the native action and steps %s exactly once",
    (button, dir) => {
      const deep = document.createElement("span");
      document.body
        .appendChild(document.createElement("div"))
        .appendChild(deep);
      expect(mouse("mousedown", button, deep).defaultPrevented).toBe(true);
      expect(back).not.toHaveBeenCalled();
      expect(forward).not.toHaveBeenCalled();
      expect(mouse("mouseup", button, deep).defaultPrevented).toBe(true);
      expect(dir === "back" ? back : forward).toHaveBeenCalledTimes(1);
      expect(dir === "back" ? forward : back).not.toHaveBeenCalled();
    },
  );

  it("ignores the primary, middle and secondary buttons", () => {
    for (const b of [0, 1, 2]) {
      expect(mouse("mousedown", b).defaultPrevented).toBe(false);
      expect(mouse("mouseup", b).defaultPrevented).toBe(false);
    }
    expect(back).not.toHaveBeenCalled();
    expect(forward).not.toHaveBeenCalled();
  });
});

it("uninstall removes every listener", () => {
  uninstall();
  key({ key: "ArrowLeft", altKey: true });
  mouse("mouseup", 3);
  expect(back).not.toHaveBeenCalled();
  uninstall = installNavInput(); // so afterEach has something to remove
});
