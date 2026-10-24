import { useEffect, useRef, type RefObject } from "react";

interface PinchZoomOptions {
  ref: RefObject<HTMLElement | null>;
  currentValue: number;
  minValue: number;
  maxValue: number;
  precision?: "int" | "float";
  onChange: (value: number) => void;
  disabled?: boolean;
}

/**
 * Intercept two-finger pinch gestures (and trackpad ctrl+wheel pinch) on a container
 * to zoom and dezoom text only (preventing full-browser/webview viewport zoom).
 */
export function usePinchZoom({
  ref,
  currentValue,
  minValue,
  maxValue,
  precision = "int",
  onChange,
  disabled = false,
}: PinchZoomOptions) {
  const currentValRef = useRef(currentValue);
  currentValRef.current = currentValue;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (disabled) return;
    const el = ref.current;
    if (!el) return;

    let initialDistance = 0;
    let initialVal = currentValRef.current;
    let isPinching = false;

    const getDistance = (t1: Touch, t2: Touch) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.hypot(dx, dy);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        initialDistance = getDistance(e.touches[0], e.touches[1]);
        initialVal = currentValRef.current;
        isPinching = true;
      } else {
        isPinching = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPinching || e.touches.length !== 2) return;
      if (e.cancelable) {
        e.preventDefault();
      }
      const dist = getDistance(e.touches[0], e.touches[1]);
      if (initialDistance <= 0) return;
      const ratio = dist / initialDistance;

      let nextVal: number;
      if (precision === "int") {
        nextVal = Math.round(initialVal * ratio);
      } else {
        nextVal = Math.round(initialVal * ratio * 100) / 100;
      }
      nextVal = Math.max(minValue, Math.min(maxValue, nextVal));
      if (nextVal !== currentValRef.current) {
        onChangeRef.current(nextVal);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        isPinching = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      if (e.cancelable) {
        e.preventDefault();
      }
      const delta = -e.deltaY;
      let nextVal: number;
      if (precision === "int") {
        const diff = delta > 0 ? 1 : -1;
        nextVal = currentValRef.current + diff;
      } else {
        const factor = delta > 0 ? 1.05 : 0.95;
        nextVal = Math.round(currentValRef.current * factor * 100) / 100;
      }
      nextVal = Math.max(minValue, Math.min(maxValue, nextVal));
      if (nextVal !== currentValRef.current) {
        onChangeRef.current(nextVal);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [ref, minValue, maxValue, precision, disabled]);
}
