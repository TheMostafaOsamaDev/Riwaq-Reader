import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { Z } from "../styles/tokens";

/**
 * The boot splash is inline HTML, so nothing in the toolchain checks it: no
 * type-checker, no bundler, no linter. Every one of its contracts — with the
 * app, with Android, with the theme system — is a string that agrees with
 * another string by hand. These tests are that agreement.
 *
 * They read what actually ships rather than re-executing it; the point is to
 * assert about the bytes the webview receives.
 */

const html = readFileSync(
  fileURLToPath(new URL("../../index.html", import.meta.url)),
  "utf8",
);

/** MainActivity.kt, which draws the same phoenix on the launch window that
 *  stands in for the webview before its first paint. */
const KOTLIN = readFileSync(
  fileURLToPath(
    new URL(
      "../../src-tauri/gen/android/app/src/main/java/com/riwaq/reader/MainActivity.kt",
      import.meta.url,
    ),
  ),
  "utf8",
);

/**
 * The body of the first block opening with `head`, brace-matched.
 *
 * Deliberately not indentation-matched: each assertion here exists to catch a
 * real change, and a test that also fails when someone reformats the `<style>`
 * block trains people to stop reading it.
 */
function blockBody(head: string): string {
  const open = html.indexOf(head);
  if (open === -1) throw new Error(`${head} not found in index.html`);
  const start = html.indexOf("{", open);
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) return html.slice(start + 1, i);
  }
  throw new Error(`${head} is unbalanced`);
}

const keyframeBody = (name: string) => blockBody(`@keyframes ${name}`);

/** A `#boot-mark` declaration's value, e.g. "104px" for `width`. */
function markStyle(prop: string): string {
  const m = blockBody("#boot-mark {").match(
    new RegExp(`\\b${prop}:\\s*([^;]+);`),
  );
  if (!m) throw new Error(`#boot-mark has no ${prop}`);
  return m[1].trim();
}

/** Every transition duration declared on the leaving splash, in ms. */
function leavingDurations(): number[] {
  const rules = [...html.matchAll(/\[data-leaving="1"\][^{]*\{([^}]*)\}/g)];
  return rules
    .flatMap((r) => [...r[1].matchAll(/transition:[^;]*?(\d+)ms/g)])
    .map((m) => Number(m[1]));
}

const EMBER_KEYFRAMES = ["boot-updraft-a", "boot-updraft-b", "boot-updraft-c"];

describe("boot splash markup", () => {
  it("ships the three elements the rest of these tests describe", () => {
    expect(html).toContain('id="boot-splash"');
    expect(html).toContain('id="boot-mark"');
    expect(html).toContain('id="boot-bar"');
  });

  it("sits above the crash screen and below the scrollbars", () => {
    // Asserted as a RELATIONSHIP, not as a literal on both sides. The splash
    // cannot import Z — it renders before any module — and an earlier version
    // of this compared 1001 against a `Z.bootSplash: 1001` token, which would
    // have stayed green while someone raised Z.appError past it and quietly
    // buried the message saying what broke.
    const z = Number(
      blockBody("#boot-splash {").match(/z-index:\s*(\d+);/)?.[1],
    );
    expect(z).toBeGreaterThan(Z.appError);
    expect(z).toBeLessThan(Z.scrollbars);
  });

  it("preloads every mark it might paint", () => {
    // The mark arrives over wry's custom protocol. Fetching it late does not
    // read as "an image loaded" — it reads as the phoenix blinking out and
    // back at the handover from the native launch window, which is the
    // artefact this feature exists to remove.
    const marks = [...html.matchAll(/--boot-mark:\s*url\("([^"]+)"\)/g)].map(
      (m) => m[1],
    );
    expect(marks.length).toBeGreaterThan(1);
    for (const url of marks) {
      expect(html).toContain(`<link rel="preload" as="image" href="${url}" />`);
    }
  });
});

describe("boot splash dismissal", () => {
  it("watches for React's first commit rather than waiting to be told", () => {
    // One observable event replaced three push call sites (App's mounted
    // effect, the error boundary's catch, and a window global). The boundary's
    // fallback is also a commit into #root, so the crash path comes free.
    expect(html).toContain("new MutationObserver(dismiss)");
    expect(html).toContain("observer.observe(root, { childList: true })");
  });

  it("leaves no global behind on window", () => {
    expect(html).not.toContain("__riwaqDismissBootSplash");
  });

  it("keeps a backstop, so a wedged bridge cannot strand the splash", () => {
    expect(html).toMatch(/setTimeout\(dismiss, \d+\)/);
  });
});

/**
 * The invariant the whole approach rests on.
 *
 * This webview has twice either skipped a mount keyframe or held it
 * indefinitely. The splash is therefore built so that its resting state — no
 * animation at all — is already the finished logo, and every animated layer
 * only adds light on top of it. A layer that started transparent, or a
 * `fill-mode` that parked one mid-flight, would turn a stalled animation into
 * an invisible phoenix: the exact blank launch this element exists to replace.
 */
describe("boot splash survives a stalled animation", () => {
  it("never uses animation-fill-mode", () => {
    expect(html).not.toContain("animation-fill-mode");
    // the shorthand can smuggle it in too
    expect(html).not.toMatch(/animation:[^;]*\b(forwards|backwards|both)\b/);
  });

  it("paints the mark from a background-image, never an animated opacity", () => {
    expect(html).toContain("background-image: var(--boot-mark);");
  });

  it.each(EMBER_KEYFRAMES)("%s animates transform and nothing else", (name) => {
    const declared = [...keyframeBody(name).matchAll(/([a-z-]+)\s*:/g)].map(
      (m) => m[1],
    );
    expect(declared.length).toBeGreaterThan(0);
    expect([...new Set(declared)]).toEqual(["transform"]);
  });
});

describe("boot splash progress bar", () => {
  it("fills left-to-right regardless of locale", () => {
    // The app is RTL-first and mirrors almost everything. This is deliberately
    // exempt: it reports a machine's progress, it is not text being read.
    expect(html).toContain("transform-origin: 0 50%;");
    expect(html).not.toMatch(/#boot-bar[^}]*direction:\s*rtl/);
  });

  it("drives the fill with a transform, not a width", () => {
    const body = keyframeBody("boot-fill");
    expect(body).toContain("transform: scaleX(");
    expect(body).not.toContain("width:");
  });

  it("rests at the end of its own curve, so a skipped fill still reads", () => {
    // If the animation never runs, the bar shows this value rather than empty.
    const parked = blockBody("#boot-bar > span {").match(
      /transform: scaleX\(([\d.]+)\)/,
    );
    const end = keyframeBody("boot-fill").match(
      /to \{ transform: scaleX\(([\d.]+)\)/,
    );
    expect(parked?.[1]).toBeDefined();
    expect(parked?.[1]).toBe(end?.[1]);
  });

  it("completes from where it reached rather than resetting", () => {
    // Removing the animation alone snaps the element back to its base scale;
    // the teardown has to pin the computed value first.
    expect(html).toContain("getComputedStyle(fill).transform");
  });
});

/**
 * How the splash leaves.
 *
 * The exit used to fire everything at once: the bar ran to 100% underneath a
 * surface that was already half transparent, so the one frame that says "done"
 * rather than merely "gone" was never actually visible. These pin the ordering
 * that fixed it, and the escape hatches that keep it from becoming a tax on
 * people who did not need the flourish.
 */
describe("boot splash exit", () => {
  it("lets the bar finish before the fade begins", () => {
    expect(html).toMatch(/setTimeout\(leave, \d+\)/);
  });

  it("only spends that beat when the bar was actually on screen", () => {
    expect(html).toContain('el.getAttribute("data-slow") === "1"');
  });

  it("skips the whole flourish under reduce motion", () => {
    const dismiss = html.slice(html.indexOf("function dismiss()"));
    const guard = dismiss.indexOf('data-boot-reduced") === "1"');
    const beat = dismiss.indexOf("setTimeout(leave");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(beat);
  });

  it("never animates out a splash that was never painted", () => {
    // The webview's first paint can land AFTER React commits, in which case
    // fading would create a flash rather than smooth one away.
    expect(html).toContain("if (!painted) {");
    expect(html).toMatch(
      /requestAnimationFrame\([\s\S]{0,120}requestAnimationFrame\(/,
    );
  });

  it("promotes the layer only on the paths that actually fade", () => {
    // A standing `will-change` would promote a full-screen layer for the whole
    // boot, including the common launches that remove the node outright.
    expect(blockBody("#boot-splash {")).not.toContain("will-change");
    expect(html).toContain('el.style.willChange = "opacity"');
  });

  it("hands input to the app as soon as it starts leaving", () => {
    expect(html).toMatch(/\[data-leaving="1"\][^}]*pointer-events: none/);
  });

  it("removes the node only after every transition has finished", () => {
    const durations = leavingDurations();
    expect(durations.length).toBeGreaterThan(0);
    const removeAfter = html.match(/el\.remove\(\);\s*\}, (\d+)\);/);
    expect(removeAfter).not.toBeNull();
    expect(Number(removeAfter?.[1])).toBeGreaterThan(Math.max(...durations));
  });
});

/**
 * Values the inline script mirrors from modules it cannot import — the same
 * problem `bootTheme.test.ts` solves for BOOT_THEMES, and the same remedy: the
 * copy is fine, the copy drifting silently is not.
 */
describe("boot splash mirrors the app's own preferences", () => {
  it("reads the reduce-motion preference under the name useTweaks writes", () => {
    // Rename or re-default `Tweaks.reduceMotion` and the splash would animate
    // for someone who asked it not to — the one class of user for whom a
    // missed preference is an accessibility failure, not a cosmetic one.
    expect(html).toContain("saved.reduceMotion");
    const fallback = html.match(/saved\.reduceMotion \|\| "(\w+)"/);
    expect(fallback?.[1]).toBe(DEFAULT_TWEAKS.reduceMotion);
  });

  it("uses the same reduced-motion query as styles/motion.ts", () => {
    expect(html).toContain("(prefers-reduced-motion: reduce)");
  });

  it("derives the bar's track from the resolved theme's own ink", () => {
    // Listing it meant four themes sharing two literals: `light` wore sepia's
    // ink and `oled` wore dark's, on the one element whose whole job is to
    // look like it belongs to the theme around it.
    expect(html).toContain('"--boot-track"');
    expect(html).toContain("theme.ink.slice(");
    expect(html).not.toMatch(/--boot-track:\s*rgba/);
  });
});

/**
 * The cross-language contract with the Android launch window.
 *
 * Android's system splash dismisses when the activity first draws, which is
 * well before the webview has a frame. For that stretch the screen is the
 * activity's windowBackground, and MainActivity draws the same phoenix on it
 * so the launcher icon does not vanish into an empty screen.
 *
 * Nothing type-checks a Kotlin constant against a CSS declaration, so these
 * do. If they disagree, the handover shows as the phoenix jumping or changing
 * colour.
 */
describe("boot splash lines up with the Android launch window", () => {
  it("is centred, because the native side uses Gravity.CENTER", () => {
    // Centre is the one position both sides can compute without agreeing on
    // screen metrics, insets, or the status bar height. `inset: 0` +
    // `margin: auto` centres without hand-computed half-sizes, so changing the
    // mark's size cannot leave a stale offset behind.
    expect(markStyle("inset")).toBe("0");
    expect(markStyle("margin")).toBe("auto");
    expect(KOTLIN).toContain("setLayerGravity(1, Gravity.CENTER)");
  });

  it.each([
    ["width", "MARK_WIDTH_DP"],
    ["height", "MARK_HEIGHT_DP"],
  ])("CSS %s matches Kotlin %s", (prop, constant) => {
    const css = Number(markStyle(prop).replace("px", ""));
    const kotlin = Number(
      KOTLIN.match(new RegExp(`${constant} = ([\\d.]+)f`))?.[1],
    );
    expect(Number.isFinite(css)).toBe(true);
    expect(kotlin).toBe(css);
  });

  it("lets the window's phoenix show through before the page paints", () => {
    // An opaque webview would cover the launch window for exactly the stretch
    // it exists to cover. The page is opaque, so this only shows through when
    // there is genuinely nothing to show.
    expect(KOTLIN).toContain("webView.setBackgroundColor(Color.TRANSPARENT)");
  });

  it("picks its phoenix from the stashed theme, not from luminance", () => {
    // setBarAppearance is handed the frontend's own isDarkTheme() answer on
    // every theme change. Re-deriving it from the background's luminance was a
    // third independent opinion, and a disagreement shows as the mark changing
    // colour mid-launch. Luminance survives only as the first-launch fallback.
    expect(KOTLIN).toContain("putBoolean(KEY_LAUNCH_DARK, lightIcons)");
    expect(KOTLIN).toContain("launchIsDark(background)");
  });
});
