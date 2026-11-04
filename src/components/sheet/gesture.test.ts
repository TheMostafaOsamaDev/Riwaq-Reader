// @vitest-environment happy-dom
//
// Who owns a touch on a sheet: the sheet (it moves, and preventDefault keeps
// the browser from scrolling) or the browser (an ordinary native scroll).
// The table these cases pin is the "Gesture ownership" table in
// docs/superpowers/specs/2026-11-04-native-feel-sheets-design.md.

import { afterEach, describe, expect, it } from "vitest";
import {
  classifyTarget,
  decideOwner,
  findBody,
  type OwnerInput,
  readTranslateY,
} from "./gesture";

const base: OwnerInput = {
  region: "body",
  kind: "plain",
  dx: 0,
  dy: -10,
  cancelable: true,
  atTopSnap: false,
  expandable: true,
  bodyScrollTop: 0,
  bodyScrollable: true,
};

describe("decideOwner", () => {
  it("swipe up on the body below full belongs to the sheet", () => {
    expect(decideOwner(base)).toBe("sheet");
  });

  it("swipe up on the body below full belongs to the sheet even when the list is scrolled", () => {
    expect(decideOwner({ ...base, bodyScrollTop: 300 })).toBe("sheet");
  });

  it("swipe up on the body at full is a native scroll", () => {
    expect(decideOwner({ ...base, atTopSnap: true })).toBe("scroll");
  });

  it("pull down with the body at its top belongs to the sheet at either snap", () => {
    expect(decideOwner({ ...base, dy: 10 })).toBe("sheet");
    expect(decideOwner({ ...base, dy: 10, atTopSnap: true })).toBe("sheet");
  });

  it("pull down with the body scrolled is a native scroll at either snap", () => {
    expect(decideOwner({ ...base, dy: 10, bodyScrollTop: 40 })).toBe("scroll");
    expect(
      decideOwner({ ...base, dy: 10, bodyScrollTop: 40, atTopSnap: true }),
    ).toBe("scroll");
  });

  it("chrome always drags", () => {
    expect(decideOwner({ ...base, region: "chrome", atTopSnap: true })).toBe(
      "sheet",
    );
    expect(
      decideOwner({ ...base, region: "chrome", dy: 10, bodyScrollTop: 40 }),
    ).toBe("sheet");
  });

  it("nested scrollers, horizontal moves, editing and uncancelable moves pass", () => {
    expect(decideOwner({ ...base, region: "nested" })).toBe("pass");
    expect(decideOwner({ ...base, dx: 12, dy: -10 })).toBe("pass");
    expect(decideOwner({ ...base, kind: "editing" })).toBe("pass");
    expect(decideOwner({ ...base, cancelable: false })).toBe("pass");
  });

  // Only "scroll" is ever handed from the list to the sheet mid-gesture, so
  // nothing that passes for another reason may be called one.
  it("only a plain vertical list scroll is a 'scroll'", () => {
    const down = { ...base, dy: 10, bodyScrollTop: 40 };
    expect(decideOwner({ ...down, dx: 12 })).toBe("pass");
    expect(decideOwner({ ...down, kind: "slider", dx: 8 })).toBe("pass");
    expect(decideOwner({ ...down, kind: "editing" })).toBe("pass");
    expect(decideOwner({ ...down, region: "nested" })).toBe("pass");
    expect(decideOwner({ ...down, cancelable: false })).toBe("pass");
  });

  it("a slider is claimed only by a clearly vertical move", () => {
    expect(decideOwner({ ...base, kind: "slider", dx: 6, dy: -10 })).toBe(
      "pass",
    );
    expect(decideOwner({ ...base, kind: "slider", dx: 3, dy: -20 })).toBe(
      "sheet",
    );
  });

  it("a non-expandable sheet claims up only when its body can't scroll", () => {
    const f = { ...base, expandable: false, atTopSnap: true };
    expect(decideOwner(f)).toBe("scroll");
    expect(decideOwner({ ...f, bodyScrollable: false })).toBe("sheet");
  });

  it("a full sheet whose list fits claims up, to rubber-band", () => {
    expect(
      decideOwner({ ...base, atTopSnap: true, bodyScrollable: false }),
    ).toBe("sheet");
  });
});

/** Give an element a vertical scroll range happy-dom can't lay out. */
function scrollable(el: HTMLElement, range: number): void {
  el.style.overflowY = "auto";
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: 200,
  });
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: 200 + range,
  });
}

describe("DOM helpers", () => {
  let content: HTMLElement;
  let header: HTMLElement;
  let body: HTMLElement;
  let row: HTMLButtonElement;
  let inner: HTMLElement;
  let heading: HTMLElement;

  function build(tagBody = true) {
    content = document.createElement("div");
    header = document.createElement("div");
    body = document.createElement("div");
    if (tagBody) body.setAttribute("data-sheet-scrollable", "true");
    row = document.createElement("button");
    inner = document.createElement("div");
    heading = document.createElement("div");
    inner.append(heading);
    body.append(row, inner);
    content.append(header, body);
    document.body.append(content);
    scrollable(body, 1000);
    scrollable(inner, 400);
  }

  afterEach(() => {
    content.remove();
  });

  it("findBody is the tagged list, or the content when nothing is tagged", () => {
    build();
    expect(findBody(content)).toBe(body);
    content.remove();
    build(false);
    expect(findBody(content)).toBe(content);
  });

  it("findBody picks the outermost tagged list", () => {
    build();
    inner.setAttribute("data-sheet-scrollable", "");
    expect(findBody(content)).toBe(body);
  });

  it("classifies chrome, body and nested regions", () => {
    build();
    expect(classifyTarget(header, body).region).toBe("chrome");
    expect(classifyTarget(row, body)).toEqual({
      region: "body",
      kind: "plain",
    });
    expect(classifyTarget(body, body).region).toBe("body");
    expect(classifyTarget(heading, body).region).toBe("nested");
  });

  it("an inner box with nothing to scroll is still body", () => {
    build();
    scrollable(inner, 0);
    expect(classifyTarget(heading, body).region).toBe("body");
  });

  it("a focused text field is editing; an unfocused one is plain content", () => {
    build();
    const input = document.createElement("input");
    body.append(input);
    expect(classifyTarget(input, body).kind).toBe("plain");
    input.focus();
    expect(classifyTarget(input, body).kind).toBe("editing");
  });

  it("contenteditable and data-no-drag are editing; range inputs are sliders", () => {
    build();
    const ce = document.createElement("div");
    ce.setAttribute("contenteditable", "true");
    const noDrag = document.createElement("div");
    noDrag.setAttribute("data-no-drag", "");
    const range = document.createElement("input");
    range.type = "range";
    const roleSlider = document.createElement("div");
    roleSlider.setAttribute("role", "slider");
    body.append(ce, noDrag, range, roleSlider);
    expect(classifyTarget(ce, body).kind).toBe("editing");
    expect(classifyTarget(noDrag, body).kind).toBe("editing");
    expect(classifyTarget(range, body).kind).toBe("slider");
    expect(classifyTarget(roleSlider, body).kind).toBe("slider");
  });

  it("readTranslateY reads the box's current vertical offset", () => {
    build();
    header.style.transform = "translateY(120px)";
    expect(readTranslateY(header)).toBe(120);
    header.style.transform = "matrix(1, 0, 0, 1, 0, -42.5)";
    expect(readTranslateY(header)).toBe(-42.5);
    header.style.transform = "";
    expect(readTranslateY(header)).toBe(0);
  });
});
