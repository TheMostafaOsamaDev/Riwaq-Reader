// @vitest-environment happy-dom
//
// ActionsMenu's two presentations. The default is layout-driven — a bottom
// sheet on a phone, an anchored popover on desktop — which is what the
// volume menu in VolumesAccordion has always done. The novel page's hero ⋮
// opts out with `presentation="popover"` and is anchored on both.
//
// The default is pinned here because it is now a default rather than the
// only behaviour: a change to it would move the volume menu silently.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES } from "../styles/tokens";
import { ActionsMenu, type ActionsMenuProps } from "./ActionsMenu";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props: Partial<ActionsMenuProps<"a">> = {}): void {
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <ActionsMenu<"a">
          theme={THEMES.dark}
          layout="mobile"
          open
          anchor={{ left: 10, right: 54, y: 100 }}
          label="Actions"
          actions={[{ id: "a", label: "Do the thing", icon: "trash" }]}
          onPick={() => {}}
          onClose={() => {}}
          {...props}
        />
      </I18nProvider>,
    );
  });
}

const sheet = () => document.querySelector('[role="dialog"]');
const popover = () => document.querySelector<HTMLElement>('[role="menu"]');

/** happy-dom has no layout, so the popover cannot measure itself unless we
 *  say how big it is. Returns a restore function. */
function stubMenuSize(width: number, height: number): () => void {
  const real = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.getAttribute("role") === "menu") {
      return {
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return real.call(this);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = real;
  };
}

describe("ActionsMenu presentation", () => {
  it("defaults to a bottom sheet on a phone", () => {
    render();
    expect(sheet()).not.toBeNull();
    expect(popover()).toBeNull();
  });

  it("defaults to an anchored popover on desktop", () => {
    render({ layout: "desktop" });
    expect(popover()).not.toBeNull();
    expect(sheet()).toBeNull();
  });

  it("anchors on a phone when asked to", () => {
    render({ presentation: "popover" });
    expect(popover()).not.toBeNull();
    expect(sheet()).toBeNull();
  });

  it("renders its rows in either presentation", () => {
    render();
    expect(
      document.querySelector('[data-menu-action="a"]')?.textContent,
    ).toContain("Do the thing");
    render({ presentation: "popover" });
    expect(
      document.querySelector('[data-menu-action="a"]')?.textContent,
    ).toContain("Do the thing");
  });
});

// The popover used to place itself from two constants describing the volume
// menu — a pinned 262px box and a 190px height allowance. A second caller
// with a different number of rows made both wrong, and showing it on phones
// made the height one wrong often: a short menu was shoved up off its
// trigger to make room it did not need.
describe("ActionsMenu popover placement", () => {
  let restore = () => {};
  const viewport = (w: number, h: number) => {
    Object.defineProperty(window, "innerWidth", {
      value: w,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: h,
      configurable: true,
    });
  };
  afterEach(() => restore());

  it("hangs under its trigger when the menu fits below it", () => {
    viewport(400, 800);
    restore = stubMenuSize(262, 110);
    render({
      presentation: "popover",
      anchor: { left: 20, right: 64, y: 300 },
    });
    expect(popover()?.style.top).toBe("306px");
  });

  // 300 + 6 + 110 = 416, past the bottom; it sits as low as it can instead.
  it("keeps a low menu fully on screen, by its own height", () => {
    viewport(400, 400);
    restore = stubMenuSize(262, 110);
    render({
      presentation: "popover",
      anchor: { left: 20, right: 64, y: 300 },
    });
    expect(popover()?.style.top).toBe("282px");
  });

  it("keeps a wide menu on screen, by its own width", () => {
    viewport(360, 800);
    restore = stubMenuSize(300, 110);
    render({
      presentation: "popover",
      anchor: { left: 300, right: 344, y: 100 },
    });
    expect(popover()?.style.left).toBe("52px");
  });
});
