// @vitest-environment happy-dom
//
// A DOCX page is real text, painted from CSS variables the viewer sets
// (DocxPageSource reads `--reading-ink`), so the reader's chosen text colour
// reaches it through that one variable. A PDF page is a picture and ignores it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { THEMES } from "../../styles/tokens";
import { FixedPageViewer } from "./FixedPageViewer";
import { fakeSource, fakeViewport } from "./viewerTestHarness";

let host: HTMLDivElement;
let root: Root;
let restoreViewport: () => void;

beforeEach(() => {
  restoreViewport = fakeViewport(900);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  restoreViewport();
});

function mountViewer(extra: { textInk?: string }) {
  act(() =>
    root.render(
      <FixedPageViewer
        source={fakeSource()}
        flow="scroll"
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
        {...extra}
      />,
    ),
  );
}

/** The element that hands DOCX cards their colours. */
const inkHost = () =>
  [...host.querySelectorAll<HTMLElement>("*")].find((e) =>
    e.style.getPropertyValue("--reading-ink"),
  );

it("DOCX cards take the chosen text color", () => {
  mountViewer({ textInk: "#1f3a5f" });
  expect(inkHost()?.style.getPropertyValue("--reading-ink")).toBe("#1f3a5f");
});

it("without a choice they keep the theme ink", () => {
  mountViewer({});
  expect(inkHost()?.style.getPropertyValue("--reading-ink")).toBe(
    THEMES.light.ink,
  );
});
