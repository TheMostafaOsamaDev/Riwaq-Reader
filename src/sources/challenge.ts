// Cloudflare interstitial detection, shared by every source.
//
// Status leads on purpose. A live page can carry the Cloudflare beacon
// ("challenge-platform") in a perfectly ordinary 200 response — verified
// against cenele.com on 2026-09-17 — so a body-only test would route every
// request through the desktop-only session webview and break the sources
// it was meant to rescue.

export interface MaybeChallenge {
  status: number;
  /** Response headers with lowercased keys, as host.fetch returns them. */
  headers: Record<string, string>;
  text: string;
}

/** True when a response is Cloudflare's anti-bot interstitial rather than
 *  the page we asked for. */
export function isChallengeResponse(resp: MaybeChallenge): boolean {
  if ((resp.headers["cf-mitigated"] || "").toLowerCase() === "challenge") {
    return true;
  }
  // Header-less fallback: the interstitial is identifiable by its fixed
  // title plus the challenge origin it must load. Both are required so a
  // page that merely 403s is not mistaken for one.
  return (
    (resp.status === 403 || resp.status === 503) &&
    /<title>\s*Just a moment/i.test(resp.text) &&
    resp.text.includes("challenges.cloudflare.com")
  );
}
