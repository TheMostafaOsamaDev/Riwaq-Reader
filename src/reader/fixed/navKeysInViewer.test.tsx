// @vitest-environment happy-dom
//
// Paged PDF/DOCX: ←/→ flip pages, but a chorded arrow never does. Alt+←/→
// is app back/forward; ⌘/Ctrl+←/→ are system shortcuts.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixedPageViewer } from "./FixedPageViewer";
import { fakeSource, fakeViewport, settle } from "./viewerTestHarness";
import { THEMES } from "../../styles/tokens";

let restoreViewport: () => void;
let host: HTMLDivElement;
let root: Root;
let page = -1;

beforeEach(async () => {
  restoreViewport = fakeViewport(900);
  page = -1;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <FixedPageViewer
        source={fakeSource()}
        flow="paged"
        fit="width"
        zoom={1}
        tint="none"
        dir="ltr"
        turnAxis="y"
        theme={THEMES.light}
        themeKey="light"
        highlights={[]}
        onSelect={() => {}}
        onHighlightClick={() => {}}
        onProgress={(p) => {
          page = p.page ?? -1;
        }}
      />,
    );
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  restoreViewport();
});

async function press(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
  await settle();
  await settle();
}

describe("FixedPageViewer paged arrow keys", () => {
  it("plain → flips a page (control for the cases below)", async () => {
    expect(page).toBe(0);
    await press({ key: "ArrowRight" });
    expect(page).toBe(1);
  });

  it.each(["altKey", "metaKey", "ctrlKey"] as const)(
    "%s + → does not flip",
    async (mod) => {
      expect(page).toBe(0);
      await press({ key: "ArrowRight", [mod]: true });
      expect(page).toBe(0);
    },
  );
});
