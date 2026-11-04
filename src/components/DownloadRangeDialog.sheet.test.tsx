// @vitest-environment happy-dom
//
// The download-range picker on a phone: a bottom sheet whose primary button
// is pinned to the sheet's visible bottom, so it can be reached at the
// default height. The novel never loads here (the source stays pending): the
// sheet's frame — header, list, footer — is what is under test.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { setReduceMotionOverride } from "../styles/motion";
import { THEMES } from "../styles/tokens";
import { DownloadRangeDialog } from "./DownloadRangeDialog";
import { findBody } from "./sheet/gesture";

vi.mock("../sources/registry", () => ({
  getSource: () => ({ getNovel: () => new Promise(() => {}) }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  setReduceMotionOverride("on");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setReduceMotionOverride("auto");
});

describe("DownloadRangeDialog on a phone", () => {
  it("the queue button sits in the sheet footer and the list is the sheet body", () => {
    act(() => {
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
});
