// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { usePinchZoom } from "./usePinchZoom";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function TestComponent({
  currentValue,
  onChange,
  precision = "int",
}: {
  currentValue: number;
  onChange: (val: number) => void;
  precision?: "int" | "float";
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePinchZoom({
    ref,
    currentValue,
    minValue: 14,
    maxValue: 42,
    precision,
    onChange,
  });
  return (
    <div ref={ref} data-testid="target" style={{ width: 400, height: 400 }} />
  );
}

describe("usePinchZoom", () => {
  it("adjusts value on 2-finger pinch gesture", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(<TestComponent currentValue={20} onChange={onChange} />);
    });

    const target = host.querySelector(
      '[data-testid="target"]',
    ) as HTMLDivElement;
    expect(target).toBeTruthy();

    // Start with 2 fingers 100px apart
    const touchStartEvent = new Event("touchstart", { bubbles: true }) as any;
    touchStartEvent.touches = [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ];
    target.dispatchEvent(touchStartEvent);

    // Spread to 150px apart (ratio 1.5 -> 20 * 1.5 = 30)
    const touchMoveEvent = new Event("touchmove", {
      bubbles: true,
      cancelable: true,
    }) as any;
    touchMoveEvent.touches = [
      { clientX: 75, clientY: 100 },
      { clientX: 225, clientY: 100 },
    ];
    target.dispatchEvent(touchMoveEvent);

    expect(onChange).toHaveBeenCalledWith(30);
  });

  it("clamps to min and max values", () => {
    const onChange = vi.fn();
    act(() => {
      root.render(<TestComponent currentValue={20} onChange={onChange} />);
    });

    const target = host.querySelector(
      '[data-testid="target"]',
    ) as HTMLDivElement;

    // Start with 2 fingers 100px apart
    const touchStartEvent = new Event("touchstart", { bubbles: true }) as any;
    touchStartEvent.touches = [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ];
    target.dispatchEvent(touchStartEvent);

    // Pinch in very small (ratio 0.1 -> 20 * 0.1 = 2 -> clamped to min 14)
    const touchMoveEvent = new Event("touchmove", {
      bubbles: true,
      cancelable: true,
    }) as any;
    touchMoveEvent.touches = [
      { clientX: 100, clientY: 100 },
      { clientX: 110, clientY: 100 },
    ];
    target.dispatchEvent(touchMoveEvent);

    expect(onChange).toHaveBeenCalledWith(14);
  });
});
