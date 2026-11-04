// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReadPosition, usePositionReporter } from "./usePositionReporter";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type OnReport = (at: ReadPosition, final: boolean) => void;

/** DesktopReader's shape: switching to a paginated mode turns the hook off
 *  and swaps the scroller out in the same commit. `reuse` is the real case —
 *  both containers are plain <div>s, so React keeps the DOM node and swaps
 *  its children for the paginated view's own paragraphs. */
function ModeSwitchReader({
  onReport,
  scrolling,
  reuse,
}: {
  onReport: OnReport;
  scrolling: boolean;
  reuse: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  usePositionReporter({ scrollRef, enabled: scrolling, onReport });
  if (scrolling) {
    return (
      <div ref={scrollRef}>
        <p data-p-index="0">one</p>
        <p data-p-index="1">two</p>
      </div>
    );
  }
  const pages = (
    <>
      <p data-p-index="7">page</p>
      <p data-p-index="8">page</p>
    </>
  );
  return reuse ? (
    <div ref={pagesRef}>{pages}</div>
  ) : (
    <section ref={pagesRef}>{pages}</section>
  );
}

let host: HTMLDivElement;
let root: Root;

describe("usePositionReporter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  it("sends a final report when the window is closing", () => {
    // Closing the desktop window can tear the webview down with a pagehide
    // and no visibilitychange.
    const finals: boolean[] = [];
    act(() =>
      root.render(
        <ModeSwitchReader
          scrolling
          reuse
          onReport={(_at, final) => finals.push(final)}
        />,
      ),
    );
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(finals).toEqual([true]);
  });

  it.each([
    ["reused for the paginated view", true],
    ["replaced outright", false],
  ])("never measures a scroller that has been %s", (_label, reuse) => {
    // React finishes a component's child mutations BEFORE running its own
    // layout cleanup, so by then the scroller is either detached (every rect
    // zero: the LAST paragraph wins) or holds the paginated view's columns.
    // Either measurement, sent as final, would be saved as the position.
    const seen: number[] = [];
    const onReport: OnReport = (at) => {
      seen.push(at.idx);
    };
    act(() =>
      root.render(
        <ModeSwitchReader scrolling reuse={reuse} onReport={onReport} />,
      ),
    );
    act(() =>
      root.render(
        <ModeSwitchReader
          scrolling={false}
          reuse={reuse}
          onReport={onReport}
        />,
      ),
    );
    expect(seen).toEqual([]);
  });
});
