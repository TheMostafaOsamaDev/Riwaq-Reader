// @vitest-environment happy-dom
//
// The download-range picker on a phone: a bottom sheet whose primary button
// is pinned to the sheet's visible bottom, so it can be reached at the
// default height, and whose chapter lists ask the sheet to bring them into
// view when they open.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { SourceNovel } from "../sources/types";
import { setReduceMotionOverride } from "../styles/motion";
import { THEMES } from "../styles/tokens";
import { DownloadRangeDialog } from "./DownloadRangeDialog";
import { findBody } from "./sheet/gesture";
import { SheetController } from "./sheet/SheetController";

/** What the source's getNovel resolves to; pending (never loads) when null. */
let novel: SourceNovel | null = null;
vi.mock("../sources/registry", () => ({
  getSource: () => ({
    getNovel: () => (novel ? Promise.resolve(novel) : new Promise(() => {})),
  }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  setReduceMotionOverride("on");
  novel = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setReduceMotionOverride("auto");
  vi.restoreAllMocks();
});

async function render() {
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <DownloadRangeDialog
          theme={THEMES.sepia}
          layout="mobile"
          open
          sourceId="src"
          novelUrl="/n"
          onCancel={() => {}}
          onStarted={() => {}}
          onCompleted={() => {}}
        />
      </I18nProvider>,
    );
  });
}

describe("DownloadRangeDialog on a phone", () => {
  it("the queue button sits in the sheet footer and the list is the sheet body", async () => {
    await render();
    const footer = document.querySelector("[data-sheet-footer]");
    expect(footer?.querySelector("button")).not.toBeNull();
    const content = document.querySelector<HTMLElement>("[data-sheet-content]");
    expect(content).not.toBeNull();
    if (!content) return;
    const body = findBody(content);
    expect(body).not.toBe(content);
    expect(body.hasAttribute("data-sheet-scrollable")).toBe(true);
    // Exactly one list is the sheet's: a nested picker list must not be.
    expect(content.querySelectorAll("[data-sheet-scrollable]")).toHaveLength(1);
  });

  // An opened chapter list can sit below the screen at the default height;
  // like the font picker, it asks the sheet to bring all of it into view.
  it("an opened chapter list asks the sheet to reveal it", async () => {
    novel = {
      title: "N",
      author: "",
      language: "en",
      direction: "ltr",
      volumes: [
        {
          title: "Volume 1",
          chapters: Array.from({ length: 30 }, (_, i) => ({
            id: i + 1,
            title: `Chapter ${i + 1}`,
            url: `/c/${i + 1}`,
          })),
        },
      ],
    } as unknown as SourceNovel;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => {
      f(0);
      return 1;
    });
    const reveal = vi.spyOn(SheetController.prototype, "reveal");
    await render();
    const from = document.querySelector<HTMLButtonElement>(
      "[data-sheet-content] button[aria-expanded]",
    );
    expect(from).not.toBeNull();
    await act(async () => from?.click());
    // The whole opened list (search box and chapters), not just the search
    // box its autofocus also reveals.
    const revealedList = reveal.mock.calls.some(
      ([el]) => el.querySelector("input[type=search]") !== null,
    );
    expect(revealedList).toBe(true);
  });
});
