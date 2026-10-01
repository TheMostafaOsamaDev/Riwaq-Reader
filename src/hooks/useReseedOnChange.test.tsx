// @vitest-environment happy-dom
//
// A layout flip — rotating a tablet, folding a phone, dragging a desktop
// window across 720px — swaps MobileReader for DesktopReader. The new one is
// a fresh mount, and a fresh reader scrolls to its resume hint. That hint was
// set when the book was OPENED, so the flip threw the reader back to wherever
// they started this session, and the new reader then saved that over the real
// position. Measured: four pages into a chapter (paragraph 36), one resize,
// back at paragraph 0 and paragraph 0 on disk.
//
// The hook re-seeds the hint from the live position when the key changes,
// and it has to do it BEFORE the new reader's first render — a reader that
// mounts with the stale value has already scrolled there.
import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useReseedOnChange } from "./useReseedOnChange";

type Layout = "mobile" | "desktop";

function harness() {
  /** Every value a reader instance saw, keyed by instance. */
  const mounts: { kind: Layout; seen: number[] }[] = [];

  function Reader({ kind, resume }: { kind: Layout; resume: number }) {
    const log = useRef<{ kind: Layout; seen: number[] } | null>(null);
    if (!log.current) {
      log.current = { kind, seen: [] };
      mounts.push(log.current);
    }
    log.current.seen.push(resume);
    return null;
  }

  const live = { current: 0 };
  function App({ layout }: { layout: Layout }) {
    const [resume, setResume] = useState(0);
    useReseedOnChange(layout, () => setResume(live.current));
    return layout === "mobile" ? (
      <Reader key="m" kind="mobile" resume={resume} />
    ) : (
      <Reader key="d" kind="desktop" resume={resume} />
    );
  }

  const host = document.createElement("div");
  const root = createRoot(host);
  return {
    mounts,
    live,
    render: (layout: Layout) => act(() => root.render(<App layout={layout} />)),
  };
}

describe("useReseedOnChange", () => {
  it("the reader mounted by a layout flip starts at the live position", () => {
    const h = harness();
    h.render("desktop");
    h.live.current = 36; // the reader has moved on since the book opened
    h.render("mobile");

    const mobile = h.mounts.find((m) => m.kind === "mobile");
    expect(mobile?.seen[0]).toBe(36);
    expect(mobile?.seen).not.toContain(0);
  });

  it("does nothing while the key stays the same", () => {
    const h = harness();
    h.render("desktop");
    h.live.current = 36;
    h.render("desktop");

    expect(h.mounts).toHaveLength(1);
    const seen = h.mounts[0].seen;
    expect(seen[seen.length - 1]).toBe(0);
  });

  it("re-seeds on every flip, not just the first", () => {
    const h = harness();
    h.render("desktop");
    h.live.current = 36;
    h.render("mobile");
    h.live.current = 52;
    h.render("desktop");

    expect(h.mounts.map((m) => m.seen[0])).toEqual([0, 36, 52]);
  });
});
