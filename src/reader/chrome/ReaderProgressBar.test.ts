// Render-level regressions for the shared progress bar. Both cases below were
// real defects found on device, and neither is visible to type-checking.
//
// Built with `createElement` rather than JSX so the file stays a `.test.ts` and
// needs no JSX transform in the vitest config.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MAX_TICKS,
  ReaderProgressBar,
  type ReaderProgressBarProps,
} from "./ReaderProgressBar";
import { THEMES } from "../../styles/tokens";

function render(props: Partial<ReaderProgressBarProps> = {}): string {
  return renderToStaticMarkup(
    createElement(ReaderProgressBar, {
      theme: THEMES.dark,
      rtl: false,
      fraction: 0.5,
      formatPct: (f: number) => `${Math.round(f * 100)}%`,
      formatLabel: () => "Page 5 of 10",
      prevLabel: "prev",
      nextLabel: "next",
      onPrev: () => {},
      onNext: () => {},
      onSeek: () => {},
      ariaLabel: "progress",
      ...props,
    }),
  );
}

/** Landmark dots are the only 2×2 boxes in the markup. */
const tickCount = (html: string) =>
  (html.match(/width:2px;height:2px/g) || []).length;

const ticksOf = (n: number) => Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));

describe("ReaderProgressBar landmarks", () => {
  it("draws them while they are far enough apart to read", () => {
    expect(tickCount(render({ ticks: ticksOf(8) }))).toBe(8);
  });

  it("draws them right up to the cap", () => {
    expect(tickCount(render({ ticks: ticksOf(MAX_TICKS) }))).toBe(MAX_TICKS);
  });

  it("draws none past the cap, rather than a smear", () => {
    // A 2372-chapter web serial asked for 2370 dots on a ~184px track: two to a
    // pixel, and 2370 absolutely-positioned nodes rebuilt on every drag frame.
    const html = render({ ticks: ticksOf(2370) });
    expect(tickCount(html)).toBe(0);
    expect(html).toContain('role="slider"'); // the track itself still renders
  });
});

describe("ReaderProgressBar handle centring", () => {
  // `insetInlineStart` resolves to `right` under RTL, so the physical
  // translateX that centres the handle in LTR has to flip sign — otherwise the
  // handle lands a full width past the end of the fill.
  it("pulls the handle back in LTR", () => {
    expect(render({ rtl: false })).toContain("translate(-50%, -50%)");
  });

  it("pushes it forward in RTL", () => {
    expect(render({ rtl: true })).toContain("translate(50%, -50%)");
  });
});
