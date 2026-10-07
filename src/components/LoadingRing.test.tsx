// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEMES } from "../styles/tokens";
import { DELAY_MS, EXIT_MS, LoadingRing, usePresence } from "./LoadingRing";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
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

/** The ring and its words: the status surface's only child. */
const ringOpacity = () =>
  (host.querySelector('[role="status"]')?.firstElementChild as HTMLElement)
    ?.style.opacity;

describe("LoadingRing", () => {
  it("shows nothing for a load that finishes inside the delay", () => {
    act(() =>
      root.render(
        <LoadingRing theme={THEMES.dark} label="Opening…" surface={{}} />,
      ),
    );
    expect(ringOpacity()).toBe("0");
    act(() => vi.advanceTimersByTime(DELAY_MS - 10));
    expect(ringOpacity()).toBe("0");
    act(() => vi.advanceTimersByTime(20));
    expect(ringOpacity()).toBe("1");
  });

  it("names what is loading", () => {
    act(() =>
      root.render(
        <LoadingRing
          theme={THEMES.dark}
          title="القس المجنون"
          label="Opening…"
          surface={{}}
          delayMs={0}
        />,
      ),
    );
    expect(host.textContent).toContain("القس المجنون");
    expect(host.textContent).toContain("Opening…");
  });
});

describe("usePresence", () => {
  function Probe() {
    const [on, setOn] = useState(true);
    const p = usePresence(on);
    return (
      <button type="button" onClick={() => setOn(false)}>
        {p.render ? (p.leaving ? "leaving" : "here") : "gone"}
      </button>
    );
  }

  it("lingers, leaving, for the exit time before it goes", () => {
    act(() => root.render(<Probe />));
    expect(host.textContent).toBe("here");
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    expect(host.textContent).toBe("leaving");
    act(() => vi.advanceTimersByTime(EXIT_MS + 5));
    expect(host.textContent).toBe("gone");
  });
});
