// @vitest-environment happy-dom
//
// Paged PDF/DOCX: ←/→ flip pages, but a chorded arrow never does. Alt+←/→
// is app back/forward; ⌘/Ctrl+←/→ are system shortcuts.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixedPageViewer } from "./FixedPageViewer";
import type { FixedPageSource } from "./FixedPageSource";
import { THEMES } from "../../styles/tokens";

const VIEWPORT = 900;
const sizeProps = ["clientWidth", "clientHeight"] as const;
let saved: PropertyDescriptor[] = [];
let host: HTMLDivElement;
let root: Root;
let page = -1;

function fakeSource(): FixedPageSource {
  return {
    kind: "pdf",
    pageCount: 60,
    outline: [],
    hasTextLayer: false,
    async pageSize() {
      return { w: 612, h: 792 };
    },
    async renderPage(i, el) {
      const p = document.createElement("div");
      p.setAttribute("data-page-index", String(i));
      el.replaceChildren(p);
    },
    destroy() {},
  };
}

async function settle() {
  for (let n = 0; n < 6; n++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

beforeEach(async () => {
  // happy-dom lays nothing out; give the viewer a viewport to measure.
  saved = sizeProps.map(
    (p) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, p)!,
  );
  for (const p of sizeProps) {
    Object.defineProperty(HTMLElement.prototype, p, {
      configurable: true,
      get: () => VIEWPORT,
    });
  }
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
  sizeProps.forEach((p, i) => {
    Object.defineProperty(HTMLElement.prototype, p, saved[i]);
  });
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
