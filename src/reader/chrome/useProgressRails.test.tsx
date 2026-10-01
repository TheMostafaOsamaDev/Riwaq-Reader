// @vitest-environment happy-dom
//
// One paint, both rails: the header's bar and focus mode's rail must never
// disagree, and the rail has to mount at the last painted width rather than
// empty. Both readers lean on this, and their own tests only check that the
// rail is there, not what it shows.

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useProgressRails } from "./useProgressRails";

let host: HTMLDivElement;
let root: Root;
let rails: ReturnType<typeof useProgressRails>;
const paints: Array<(f: number) => void> = [];

function Probe({ showRail }: { showRail: boolean }) {
  rails = useProgressRails();
  useEffect(() => {
    paints.push(rails.paintProgress);
  });
  return (
    <>
      <div ref={rails.progressFillRef} data-fill="header" />
      {showRail && <div ref={rails.focusFillRef} data-fill="rail" />}
    </>
  );
}

const fill = (which: string) =>
  host.querySelector<HTMLElement>(`[data-fill="${which}"]`);

function render(showRail: boolean) {
  act(() => root.render(<Probe showRail={showRail} />));
}

beforeEach(() => {
  paints.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useProgressRails", () => {
  it("paints the same width to both rails", () => {
    render(true);
    rails.paintProgress(0.25);
    expect(fill("header")?.style.width).toBe("25%");
    expect(fill("rail")?.style.width).toBe("25%");
  });

  it("paints the header alone while the rail is not mounted", () => {
    render(false);
    expect(() => rails.paintProgress(0.4)).not.toThrow();
    expect(fill("header")?.style.width).toBe("40%");
  });

  it("remembers the last fraction for the rail's first paint", () => {
    render(false);
    rails.paintProgress(0.7);
    expect(rails.lastFractionRef.current).toBe(0.7);
  });

  it("clamps out-of-range fractions", () => {
    render(true);
    rails.paintProgress(1.4);
    expect(fill("rail")?.style.width).toBe("100%");
    rails.paintProgress(-0.2);
    expect(fill("rail")?.style.width).toBe("0%");
  });

  it("keeps paintProgress stable across renders", () => {
    // Effects and PaginatedView depend on it; a new function per render
    // would re-run them on every re-render.
    render(true);
    render(false);
    render(true);
    expect(new Set(paints).size).toBe(1);
  });
});
