// @vitest-environment happy-dom
//
// A vertical swipe that starts on the chapter slider is a scroll, not a seek.
//
// The slider sits in the phone reader's bottom bar, right where a thumb starts
// an upward flick. It used to commit on release whatever the gesture had been,
// taking the chapter under the finger's final x: on a long web serial that is
// several chapters per pixel, so a flick meant to move the page a screen could
// land the reader somewhere else in the book. A drag that goes vertical before
// it goes sideways now lets go of the slider and belongs to the page.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { ReaderProgressBar } from "./ReaderProgressBar";
import { THEMES } from "../../styles/tokens";

const TRACK = { left: 100, width: 200 };

describe("ReaderProgressBar under a touch", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onSeek: Mock<(fraction: number) => void>;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    // No layout engine here: give every box the track's geometry so the
    // slider can turn a clientX into a fraction.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(TRACK.left, 800, TRACK.width, 44),
    );
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    proto.setPointerCapture ??= () => {};
    proto.releasePointerCapture ??= () => {};
    proto.hasPointerCapture ??= () => true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    onSeek = vi.fn<(fraction: number) => void>();
    act(() => {
      root.render(
        <ReaderProgressBar
          theme={THEMES.sepia}
          rtl={false}
          fraction={0.5}
          formatPct={(f) => `${Math.round(f * 100)}%`}
          formatLabel={() => "Chapter"}
          prevLabel="prev"
          nextLabel="next"
          onPrev={() => {}}
          onNext={() => {}}
          onSeek={onSeek}
          ariaLabel="progress"
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const slider = () => host.querySelector<HTMLElement>('[role="slider"]')!;
  const fire = (type: string, x: number, y: number, pointerType = "touch") =>
    act(() => {
      slider().dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          pointerType,
          isPrimary: true,
          clientX: x,
          clientY: y,
        }),
      );
    });
  const drag = (path: [number, number][], pointerType = "touch") => {
    const [first, ...rest] = path;
    fire("pointerdown", first[0], first[1], pointerType);
    for (const [x, y] of rest) fire("pointermove", x, y, pointerType);
    const last = path[path.length - 1];
    fire("pointerup", last[0], last[1], pointerType);
  };

  it("seeks on a tap", () => {
    drag([[150, 820]]);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(0.25, 5);
  });

  it("seeks on a sideways scrub, to where the finger let go", () => {
    drag([
      [150, 820],
      [162, 818],
      [220, 812],
      [250, 790],
    ]);
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls[0][0]).toBeCloseTo(0.75, 5);
  });

  it("does not seek when the drag goes vertical first", () => {
    drag([
      [150, 820],
      [152, 808],
      [170, 760],
      [230, 600],
    ]);
    expect(onSeek).not.toHaveBeenCalled();
  });

  // The phone reader scrolls the page for gestures the browser declines, and
  // the slider declines nothing (touch-action: none). Without this marker the
  // page would ride the finger's vertical wobble while it scrubs.
  it("declares that it owns sideways drags", () => {
    expect(slider().getAttribute("data-pan-axis")).toBe("x");
  });

  it("leaves a mouse drag alone: desktop scrubs in any direction", () => {
    drag(
      [
        [150, 820],
        [152, 808],
        [250, 600],
      ],
      "mouse",
    );
    expect(onSeek).toHaveBeenCalledTimes(1);
  });
});
