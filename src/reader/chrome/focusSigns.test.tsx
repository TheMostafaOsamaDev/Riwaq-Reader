// The two things that tell a reader they are in focus mode.
//
// Static markup: these are questions about what gets emitted, not about
// interaction. The lock's assertions are the load-bearing ones — it is the
// only visible way out of the mode, so it has to be a real, named control.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEMES } from "../../styles/tokens";
import { FocusLock, FocusPill } from "./FocusSigns";

const pill = (reduced = false) =>
  renderToStaticMarkup(
    <FocusPill
      theme={THEMES.sepia}
      title="وضع التركيز"
      hint="انقر مرتين للخروج"
      reduced={reduced}
    />,
  );
const lock = () =>
  renderToStaticMarkup(
    <FocusLock
      theme={THEMES.sepia}
      label="Exit focus mode"
      onExit={() => {}}
    />,
  );

describe("the focus-mode pill", () => {
  it("names the mode AND the way out", () => {
    // Naming the mode alone leaves the reader in it with no exit; the gesture
    // is the half that cannot be discovered any other way.
    expect(pill()).toContain("وضع التركيز");
    expect(pill()).toContain("انقر مرتين للخروج");
  });

  it("never swallows a tap meant for the page", () => {
    expect(pill()).toContain("pointer-events:none");
  });

  it("sits along the bottom, clear of the gesture bar", () => {
    // It used to be a plate in the middle of the page, over the text the
    // reader had just been given. Down here it covers nothing anyone is
    // reading, and it is out of the way of the double-tap it describes.
    expect(pill()).toContain("bottom:calc(var(--safe-bottom)");
    expect(pill()).not.toContain("top:50%");
  });

  it("stays on one line", () => {
    // Wrapping is what turned a message into a block of screen.
    expect(pill()).toContain("white-space:nowrap");
  });

  it("does not animate under reduced motion", () => {
    // The duration is what starts the keyframe; without one the element's own
    // styles paint, and those ARE the arrived state. So the message still
    // appears — only the movement goes.
    expect(pill(true)).not.toContain("animation-duration");
    expect(pill(false)).toContain("animation-duration");
  });
});

describe("the focus-mode lock", () => {
  it("is a real control with an accessible name", () => {
    // It is the ONLY visible way out — a decorative glyph would leave a
    // reader who cannot double-tap with no exit at all.
    expect(lock()).toMatch(/<button[^>]+aria-label="Exit focus mode"/);
  });

  it("keeps a 44px target even though the ink is smaller", () => {
    expect(lock()).toMatch(/width:44px/);
    expect(lock()).toMatch(/height:44px/);
  });

  it("clears the safe area and mirrors with the language", () => {
    // The Android system bars are hidden in this mode; a display cutout is
    // not. And it sits opposite the home button in BOTH directions.
    const html = lock();
    expect(html).toContain("env(safe-area-inset-top");
    expect(html).toContain("inset-inline-end");
    expect(html).not.toMatch(/(^|[;"])right:/);
  });
});
