// @vitest-environment happy-dom
//
// The boundary catches render errors that never reach window.onerror, and
// its own comment says the failure it catches is "indistinguishable from a
// chapter that loaded blank". That ambiguity is the reason diagnostics
// exist, so the wiring gets a test that actually renders a throwing child —
// a test that called `record()` by hand would stay green with the boundary
// unwired, which is the one outcome that matters here.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drain } from "../lib/diagnostics/recorder";
import { THEMES } from "../styles/tokens";
import { ReaderErrorBoundary } from "./ReaderErrorBoundary";

function Boom(): never {
  throw new Error("bad chapter");
}

describe("ReaderErrorBoundary", () => {
  beforeEach(() => {
    drain();
    // React's own act() check reads this global; without it every render
    // below is an act-environment warning instead of a test.
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    // React logs caught render errors; silence it so the run stays readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records a renderError event when a child throws", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    act(() => {
      createRoot(host).render(
        <ReaderErrorBoundary theme={THEMES.sepia}>
          <Boom />
        </ReaderErrorBoundary>,
      );
    });

    const ev = drain().find((e) => e.kind === "renderError");
    expect(ev).toBeDefined();
    const data = ev?.data as Record<string, unknown>;
    expect(data.message).toBe("bad chapter");
    expect(typeof data.componentStack).toBe("string");
    // The fallback is what the reader actually sees, so it is part of the
    // same claim: the error was caught, not swallowed.
    expect(host.textContent).toContain("This chapter could not be displayed");
  });
});
