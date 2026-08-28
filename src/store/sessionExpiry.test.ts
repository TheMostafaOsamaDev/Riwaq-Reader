import { describe, it, expect } from "vitest";
import { isSessionExpiredError } from "./sessionExpiry";

describe("isSessionExpiredError", () => {
  it("matches the marker the Rust transport emits", () => {
    expect(
      isSessionExpiredError(
        "SESSION_EXPIRED: https://cenele.com needs its browser check completed again.",
      ),
    ).toBe(true);
  });

  it("ignores ordinary download failures", () => {
    // These must stay quiet — a re-auth prompt for a plain network blip
    // trains the user to dismiss the one that matters.
    expect(isSessionExpiredError("Timed out reading chunk at 0")).toBe(false);
    expect(isSessionExpiredError("HTTP 500 for https://cenele.com/")).toBe(false);
    expect(isSessionExpiredError("network error")).toBe(false);
  });
});
