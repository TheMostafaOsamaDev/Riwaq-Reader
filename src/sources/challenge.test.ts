import { describe, expect, it } from "vitest";
import { isChallengeResponse } from "./challenge";

const interstitial =
  `<html><head><title>Just a moment...</title></head>` +
  `<body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js">` +
  `</script></body></html>`;

describe("isChallengeResponse", () => {
  it("detects the cf-mitigated header", () => {
    expect(
      isChallengeResponse({
        status: 403,
        headers: { "cf-mitigated": "challenge" },
        text: "",
      }),
    ).toBe(true);
  });

  it("detects the cf-mitigated header regardless of value case", () => {
    // HTTP header VALUES are case-sensitive to a plain string compare, and
    // nothing obliges an edge to send this one lower-cased. Without this
    // case, deleting `.toLowerCase()` from the implementation fails zero
    // tests, because the only other test touching that line already hands
    // it an already-lower-case value.
    expect(
      isChallengeResponse({
        status: 403,
        headers: { "cf-mitigated": "Challenge" },
        text: "",
      }),
    ).toBe(true);
  });

  it("detects the interstitial body on a 403 without the header", () => {
    expect(
      isChallengeResponse({ status: 403, headers: {}, text: interstitial }),
    ).toBe(true);
  });

  it("does NOT treat a successful page as a challenge, even though live pages carry the Cloudflare beacon", () => {
    // Verified live 2026-09-17: cenele.com returns 200 with a real page whose
    // body contains "challenge-platform" — that string is part of Cloudflare's
    // always-on beacon, not a challenge. Keying on it would route every single
    // request through the desktop-only session webview.
    expect(
      isChallengeResponse({
        status: 200,
        headers: {},
        text: `<html><body>real content<script>/cdn-cgi/challenge-platform/x.js</script></body></html>`,
      }),
    ).toBe(false);
  });

  it("does not treat an ordinary 403 as a challenge", () => {
    expect(
      isChallengeResponse({
        status: 403,
        headers: {},
        text: "<html>Forbidden</html>",
      }),
    ).toBe(false);
  });

  // The three cases above pin the detector but don't individually prove that
  // BOTH the status gate and BOTH body markers are required — a detector
  // that dropped the status check, or that OR'd the two markers instead of
  // AND'ing them, would still pass all of them. These three close that gap.

  it("does not treat a 403 with only the challenge origin as a challenge (title missing)", () => {
    expect(
      isChallengeResponse({
        status: 403,
        headers: {},
        text: `<html><body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`,
      }),
    ).toBe(false);
  });

  it("does not treat a 403 with only the interstitial title as a challenge (origin missing)", () => {
    expect(
      isChallengeResponse({
        status: 403,
        headers: {},
        text: `<html><head><title>Just a moment...</title></head><body>no challenge script here</body></html>`,
      }),
    ).toBe(false);
  });

  it("does not treat a 200 response as a challenge even with both body markers present", () => {
    // Status leads: a 200 can never be a challenge, no matter what the body
    // contains. This is unlikely in practice (Cloudflare mitigations are
    // always 403/503) but it is the case that proves the status gate is
    // load-bearing rather than redundant with the body checks.
    expect(
      isChallengeResponse({ status: 200, headers: {}, text: interstitial }),
    ).toBe(false);
  });
});
