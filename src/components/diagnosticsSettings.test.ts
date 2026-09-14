// Settings → Data → Diagnostics: the user-facing half of the log-export
// feature.
//
// The composition itself (a Field, a SegRow and two ActionRows built inline
// in SettingsPage) has no seam to render through, so what is pinned here is
// the two contracts underneath it that CAN break silently:
//
//  1. the message catalog — `Messages` makes a missing Arabic key a compile
//     error, but it cannot notice an Arabic string that is still the English
//     one, and an untranslated toast is invisible until an Arabic reader
//     hits it;
//  2. the startup ordering — the recorder's tier is module-level state read
//     synchronously by DesktopReader's session-start effect. Applying the
//     persisted tweak after the session has started means the first chapter
//     of every launch records no geometry even with the toggle ON, and
//     nothing about that failure is visible from the UI.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { ar } from "../i18n/ar";
import { en } from "../i18n/en";

/** Every message key the Diagnostics rows render.
 *
 *  `settings.on` / `settings.off` are reused rather than twinned with a
 *  `common.*` pair: every other on/off SegRow on this page already labels
 *  itself from them, and a second pair saying the same thing is one more
 *  place for a translator to miss. */
const KEYS = [
  "settings.on",
  "settings.off",
  "settings.diagnostics",
  "settings.diagnostics.verbose",
  "settings.diagnostics.verbose.hint",
  "settings.diagnostics.export",
  "settings.diagnostics.copy",
  "settings.diagnostics.copied",
  "settings.diagnostics.exportDone",
  "settings.diagnostics.exportError",
  "settings.diagnostics.copyError",
  "settings.diagnostics.lastLaunchOk",
  "settings.diagnostics.lastLaunchBlank",
] as const;

const APP_TSX = readFileSync(
  fileURLToPath(new URL("../App.tsx", import.meta.url)),
  "utf8",
);

describe("diagnostics settings", () => {
  it("defaults verbose diagnostics off", () => {
    expect(DEFAULT_TWEAKS.verboseDiagnostics).toBe(false);
  });

  it("has an English string for every diagnostics key", () => {
    for (const k of KEYS) {
      expect(en[k as keyof typeof en], `missing en: ${k}`).toBeTruthy();
    }
  });

  it("has an Arabic counterpart for every diagnostics key", () => {
    for (const k of KEYS) {
      expect(ar[k as keyof typeof ar], `missing ar: ${k}`).toBeTruthy();
    }
  });

  it("does not leave an Arabic string identical to the English one", () => {
    for (const k of KEYS) {
      expect(ar[k as keyof typeof ar], `untranslated: ${k}`).not.toBe(
        en[k as keyof typeof en],
      );
    }
  });

  it("names the stalled stage in the blank-launch line", () => {
    // The verdict's `stalledAt` is interpolated in; a catalog edit that drops
    // the placeholder would leave the one sentence that explains a blank
    // launch saying nothing about where it died.
    expect(en["settings.diagnostics.lastLaunchBlank"]).toContain("{stage}");
    expect(ar["settings.diagnostics.lastLaunchBlank"]).toContain("{stage}");
  });
});

// Source-shape assertions rather than a render: mounting App pulls the whole
// reader, both page sources and the Tauri bridge in behind it, and the thing
// at risk here is an ordering one line of that file expresses directly.
describe("verbose tier at startup", () => {
  it("applies the persisted tier before the session starts", () => {
    const appliedAt = APP_TSX.indexOf("setVerbose(t.verboseDiagnostics)");
    const sessionAt = APP_TSX.indexOf("startSession()");
    expect(
      appliedAt,
      "App.tsx never applies the persisted tier",
    ).toBeGreaterThan(-1);
    expect(sessionAt, "App.tsx never starts a session").toBeGreaterThan(-1);
    expect(appliedAt).toBeLessThan(sessionAt);
  });

  it("reaches setVerbose through a static import", () => {
    // A dynamic import resolves a microtask later, which is already too late
    // for anything that read the tier during the same commit.
    expect(APP_TSX).toMatch(
      /import \{[^}]*\bsetVerbose\b[^}]*\} from "\.\/lib\/diagnostics\/recorder"/,
    );
    expect(APP_TSX).not.toMatch(
      /import\(\s*["']\.\/lib\/diagnostics\/recorder/,
    );
  });
});
