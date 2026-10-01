// @vitest-environment happy-dom
//
// A chorded arrow is never a chapter turn. Alt+←/→ is app back/forward, and
// one press must not both leave the reader and turn a chapter; ⌘/Ctrl+←/→
// are system shortcuts.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopReader, makeBook } from "./desktopReaderTestHarness";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

const onChapterChange = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  onChapterChange.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      desktopReader({
        book: makeBook("en", 3, 10),
        locale: "en",
        currentChapter: 1,
        onChapterChange,
      }),
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function press(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

describe("DesktopReader arrow keys", () => {
  it("plain arrows still change chapter (control for the case below)", () => {
    press({ key: "ArrowRight" });
    press({ key: "ArrowLeft" });
    expect(onChapterChange).toHaveBeenCalledTimes(2);
  });

  it.each(["altKey", "metaKey", "ctrlKey"] as const)(
    "%s + arrow does not change chapter",
    (mod) => {
      press({ key: "ArrowRight", [mod]: true });
      press({ key: "ArrowLeft", [mod]: true });
      expect(onChapterChange).not.toHaveBeenCalled();
    },
  );
});
