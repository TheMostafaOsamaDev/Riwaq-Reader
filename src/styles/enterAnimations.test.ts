// No entering animation may hold its content invisible before it runs.
//
// `animation: … both` is shorthand for backwards + forwards fill. The
// BACKWARDS half applies the keyframe's `from` state to the element as soon as
// the class lands, and holds it until the animation actually starts. When that
// `from` state is `opacity: 0`, the content is laid out, painted into the tree,
// and completely invisible for that whole window.
//
// On a webview that defers or drops the animation — cold start, a backgrounded
// tab, a renderer still warming up — "that whole window" is forever. The result
// is a fully themed screen with nothing on it: no chrome, no text, no error.
// From a screenshot it is indistinguishable from a crash, and it is not one;
// the DOM is complete and correct the entire time.
//
// Reported on Android 2026-09-11 as a blank screen when opening a book, which
// is a Library → Reader swap and therefore `.riwaq-view-enter`. Confirmed by
// reading the live DOM over CDP while the screen was blank: the view was fully
// rendered. The same hazard was hit before on WKWebView, which is where the
// rule comes from — never give content an invisible first frame.
//
// Exit animations are deliberately NOT covered: their `from` is the VISIBLE
// state, so backwards fill holds them visible, and an exit that never runs
// leaves the content on screen rather than hiding it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./global.css", import.meta.url), "utf8");

/** `from`/`0%` block of each @keyframes, by name. */
function firstFrames(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)) {
    const first = /(?:from|0%)\s*\{([^}]*)\}/.exec(m[2]);
    if (first) out.set(m[1], first[1]);
  }
  return out;
}

/** Class rules whose `animation` shorthand fills backwards. */
function backwardsFilled(): { cls: string; keyframes: string }[] {
  const frames = firstFrames();
  const found: { cls: string; keyframes: string }[] = [];
  for (const m of css.matchAll(
    /\.([\w-]+)\s*\{[^}]*?animation:\s*([\w-]+)([^;]*);/g,
  )) {
    const [decl, cls, name] = [m[0], m[1], m[2]];
    if (!/\b(both|backwards)\b/.test(decl)) continue;
    if (!frames.has(name)) continue;
    found.push({ cls, keyframes: name });
  }
  return found;
}

describe("entering animations", () => {
  it("never hold their content invisible before they start", () => {
    const frames = firstFrames();
    const offenders = backwardsFilled()
      .filter(({ keyframes }) =>
        /opacity:\s*0\b/.test(frames.get(keyframes) ?? ""),
      )
      .map(({ cls, keyframes }) => `.${cls} → @keyframes ${keyframes}`);

    expect(
      offenders,
      "These rules fill backwards from `opacity: 0`, so the element is " +
        "invisible from the moment the class lands until the animation " +
        "actually starts — which on a stalled webview is forever. Use " +
        "`forwards` instead of `both`:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("still finds the rules it is meant to be checking", () => {
    // A parser that silently matched nothing would make the test above pass
    // for the wrong reason, forever.
    expect(backwardsFilled().length).toBeGreaterThan(5);
  });
});
