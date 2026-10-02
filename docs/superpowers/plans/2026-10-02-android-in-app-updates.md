# Android In-App Updates and "What's New" Implementation Plan

**Goal:** Sideloaded Android installs download, verify and install updates
inside the app (pill → "What's new" sheet → progress → Android's installer).
Every platform shows hand-written, bilingual release notes before and after
updating. The update check is always on, and store-installed copies (Orion,
Obtainium, F-Droid, …) are handed to their store instead of fighting it.

**Architecture:** One hand-written `release-notes/<version>.json` per
release. It is bundled into the build through a Vite virtual module and
uploaded as a release asset. Rust fetches the *next* version's notes,
checksum and size (no CORS, one client). Kotlin owns the APK: `AppUpdater`
plus a dedicated `UpdateService` download it resumably, verify the SHA-256
and signing certificate, and install through a `PackageInstaller` session.
JS polls Kotlin's state through Rust. A pure TypeScript state module decides
what the pill, sheet, dot and Settings show. Everything that matters is
keyed on the **running versionCode**, never on who installed the app.

**Tech Stack:** React 19 + Vite + Vitest (happy-dom), Tauri 2 (Rust,
`reqwest`, `jni` 0.21), Kotlin (Android minSdk 24, targetSdk 36), GitHub
Actions.

**Spec:** `docs/superpowers/specs/2026-10-02-android-in-app-updates-design.md`
(read it first; this plan argues from it). Approved UI:
`~/Desktop/my-work/Riwaq-update-check/.superpowers/brainstorm/16101-1790889253/content/update-flow.html`.

**Branch / worktree:** `feat/android-in-app-updates` in
`~/Desktop/my-work/Riwaq-android-updates`, stacked on
`fix/update-check-cors` (PR #166). Never work in
`~/Desktop/my-work/Riwaq-reader` (the live checkout).

## Global Constraints

- Commits are written as the user: **no `Co-Authored-By`, no "Generated with"
  footer, no mention of Claude/AI**, ever.
- Stage explicit paths only (`git commit -m … -- <paths>`); never `git add -A`.
  The repo has untracked files that must not be committed.
- PR gate: `pnpm check` (biome format + lint, `tsc && vite build`, vitest).
  Biome, not Prettier. Rust: `cargo test --lib` in `src-tauri/`. Do **not**
  run `cargo fmt` on files you didn't touch.
- Every i18n key exists in **both** `src/i18n/en.ts` and `src/i18n/ar.ts`
  (`ar` is typed `Messages`, so a missing key is a compile error).
- Colours come from `Theme` tokens (`src/styles/tokens.ts`). Tags and errors
  carry an icon **and** words, never colour alone. Every component must work
  in RTL (`dir="rtl"`).
- No new npm, Cargo or Gradle dependencies. `base64`, `sha2`, `reqwest` and
  `jni` are already in `src-tauri/Cargo.toml`.
- **The webview never fetches the network.** Every request goes through
  Rust (GitHub release assets send no CORS headers; see PR #166).
- Every new Rust→Kotlin JNI member gets an exact `-keep` rule in
  `src-tauri/gen/android/app/proguard-rules.pro` **and** a line in
  `scripts/verify-jni-bridge.sh`, in the same commit. Debug builds don't
  minify, so a missing rule only breaks release builds.
- Never gate first paint: nothing new may be awaited before React mounts
  (`src/main.tsx`).
- Contracts installed copies depend on (never rename): `latest.json`,
  `SHA256SUMS`, `app-universal-release.apk`, `whats-new.json`, the updater
  endpoint, the identifier `com.riwaq.reader`.
- Release-notes images: WebP, filename `^[A-Za-z0-9_.-]+\.webp$`,
  **≤ 150 KB (153 600 bytes)**. `kind` ∈ `new | improved | fixed`.
- UI work: invoke the `ui-ux-pro-max` skill first (CLAUDE.md standing rule).
- Constants: notification id **1003** (1001/1002 belong to the download
  notifier), channel `riwaq-downloads`, cache dir `cacheDir/updates/`,
  polling **500 ms** only while a download is active and the page is
  visible.

## Review Focus

These are inputs the spec implies but no happy-path test exercises. Each one
has its test pinned in the owning task.

1. **The store updates the app while our APK is pending or mid-download**
   (Orion, Obtainium, F-Droid, `adb install -r`). Expect the next launch to
   delete the cached `.apk`/`.part`, show no pill, and still show What's new
   once. *Task 10 (`cleanupDecision` test) and Task 12
   (`pillFor` with running ≥ offered).*
2. **Notes file for the current version missing, or written in only one
   language.** Expect the release to fail, and the app to fall back to "Riwaq
   X is available" plus a GitHub link with no crash. *Task 2 (validator
   fixtures), Task 5 (NotesView with `null` notes).*
3. **Manifest offers a version, but `SHA256SUMS` lacks the APK line or the
   download is tampered with.** Expect no Install button and the file
   deleted. *Task 4 (`checksum_for` tests) and Task 14 (emulator tamper
   step).*
4. **A user who turned the old toggle off.** Expect the check to run anyway
   and `autoCheckUpdates` to be stripped from storage, not honoured. *Task 1
   (`loadTweaks` migration test).*
5. **Fresh install vs. update.** A brand-new user must not get a tour; an
   updater from a build that never stored `lastSeenWhatsNew` must get it
   exactly once. *Task 6 (`shouldShowWhatsNew` tests).*

---

## File map

| File | Responsibility |
|---|---|
| `release-notes/<version>.json`, `release-notes/img/*.webp` | The hand-written notes (data) |
| `scripts/release-notes.mjs` (+ `.d.mts`) | Strict validator, shared by CLI and tests |
| `scripts/verify-release-notes.mjs` | CLI: validate all notes files; `--require <v>` for releases |
| `scripts/render-release-notes.mjs` | Notes → GitHub release-body markdown |
| `vite-plugin-whats-new.ts` | `virtual:whats-new`: this build's notes, images, version |
| `src/virtual-whats-new.d.ts` | Types for the virtual module |
| `src/store/releaseNotes.ts` | Runtime types, lenient parser, `pick()` |
| `src/store/whatsNew.ts` | "Show after update?" rule (pure) |
| `src/store/updateFlow.ts` | Android flow decisions: pill, dot, start, cleanup, channel (pure) |
| `src/store/androidUpdate.ts` | Subscribable store + native polling + actions |
| `src/components/update/NotesView.tsx` | Highlight + tagged list (shared) |
| `src/components/update/StoryPages.tsx` | Full-screen pages (after big releases) |
| `src/components/update/WhatsNewAfterUpdate.tsx` | Chooses story vs. short list; marks seen |
| `src/components/update/UpdatePill.tsx`, `UpdateSheet.tsx` | Android pill + sheet (all states) |
| `src/components/update/DesktopNotesDialog.tsx` | Desktop "What's new" dialog |
| `src-tauri/src/updates.rs` | + notes / checksum / size fetches |
| `src-tauri/src/android_update.rs` | JNI commands into `AppUpdater` |
| `src-tauri/src/notify.rs` | make `find_app_class`, `drain_pending_exception` `pub(crate)` |
| `gen/android/.../AppUpdater.kt` | install source, download, verify, install, cleanup |
| `gen/android/.../UpdateService.kt` | foreground service hosting the download |
| `gen/android/.../UpdateReceivers.kt` | install-result + package-replaced receivers |

---

### Task 1: Always-on update check, full-width "Check now"

**Files:**
- Modify: `src/types/reader.ts` (remove `autoCheckUpdates`)
- Modify: `src/hooks/useTweaks.ts` (drop default, strip stored value, export `loadTweaks`)
- Modify: `src/store/updateThrottle.ts`, `src/store/updateThrottle.test.ts`
- Modify: `src/hooks/useUpdateCheck.ts`
- Modify: `src/components/SettingsPage.tsx` (the `updates` section)
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts` (`settings.updates.hint`)
- Modify: `README.md` (§ Updates)
- Test: `src/hooks/useTweaks.migration.test.ts` (new)

**Interfaces:**
- Produces: `export function loadTweaks(): Tweaks` from `useTweaks.ts`, and
  `shouldCheck({ lastCheck, now, manual }): boolean`, with no `enabled`.

- [ ] **Step 1: Write the failing migration test**

```ts
// @vitest-environment happy-dom
// src/hooks/useTweaks.migration.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { loadTweaks } from "./useTweaks";

describe("loadTweaks", () => {
  beforeEach(() => localStorage.clear());

  it("drops the retired autoCheckUpdates flag instead of honouring it", () => {
    // The toggle is gone: the daily check is always on. A copy that once
    // switched it off must not carry `false` forward into a build that no
    // longer has anywhere to switch it back on.
    localStorage.setItem(
      "riwaq:tweaks:v1",
      JSON.stringify({ autoCheckUpdates: false, fontSize: 19 }),
    );
    const t = loadTweaks() as unknown as Record<string, unknown>;
    expect("autoCheckUpdates" in t).toBe(false);
    expect(t.fontSize).toBe(19); // the control: the rest still loads
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`loadTweaks` is not exported)

Run: `pnpm vitest run src/hooks/useTweaks.migration.test.ts`
Expected: FAIL, "loadTweaks is not a function" or an import error.

- [ ] **Step 3: Implement**

In `src/hooks/useTweaks.ts`: rename `function load()` to `export function
loadTweaks()`, update its one caller (`useState<Tweaks>(() => loadTweaks())`),
delete `autoCheckUpdates: true,` from `DEFAULT_TWEAKS`, and add beside the
other strips in `loadTweaks`:

```ts
    // The "Check for updates" toggle was removed (2026-10-02): the daily
    // check is always on. Strip a stored `false` so it can't resurface.
    if (parsed && typeof parsed === "object") {
      delete parsed.autoCheckUpdates;
    }
```

In `src/types/reader.ts`, delete the `autoCheckUpdates: boolean;` member and
its doc comment.

In `src/store/updateThrottle.ts`, remove `enabled` from the parameter type,
the destructuring, and the `if (!enabled) return false;` line. Update the doc
comment: the check is skipped only by the throttle.

In `src/store/updateThrottle.test.ts`, delete the two tests whose input has
`enabled: false`, and remove `enabled: true,` from the rest.

In `src/hooks/useUpdateCheck.ts`, change the guard to:

```ts
      if (
        !shouldCheck({
          lastCheck: tw.lastUpdateCheck,
          now: Date.now(),
          manual,
        })
      ) {
```

In `src/components/SettingsPage.tsx` (`id: "updates"` section), delete the
whole `<SegRow<"on" | "off"> …/>` element. Replace the button row with a
full-width button and the status line **under** it:

```tsx
            <Button
              theme={theme}
              variant="secondary"
              size="sm"
              fullWidth
              loading={updateChecking}
              disabled={updateChecking}
              onClick={onCheckUpdates}
            >
              {updateChecking
                ? tr("settings.updates.checking")
                : tr("settings.updates.checkNow")}
            </Button>
            {/* Always mounted so the live region exists before its text
                changes — screen readers ignore a region that arrives filled.
                minHeight reserves the line so a result doesn't push the
                hint down. */}
            <p
              role="status"
              aria-live="polite"
              style={{
                margin: "8px 2px 0",
                minHeight: 18,
                fontSize: 12,
                lineHeight: 1.45,
                color:
                  updateResult?.kind === "failed" ? theme.danger : theme.muted,
              }}
            >
              {!updateChecking &&
                updateResult &&
                updateStatusText(updateResult, tr)}
            </p>
```

(Remove the wrapping `<div style={{ marginTop: 10, display: "flex", … }}>`
added in PR #166; keep a `marginTop: 4` wrapper if the Field needs spacing.)

Hint strings:

```ts
// en.ts
  "settings.updates.hint":
    "Riwaq asks GitHub once a day whether a newer version exists. Nothing about you or your books is sent, and nothing downloads until you tap Update.",
// ar.ts
  "settings.updates.hint":
    "يسأل رواق GitHub مرة يوميًا عمّا إذا كان هناك إصدار أحدث. لا يُرسَل أي شيء عنك أو عن كتبك، ولا يُنزَّل شيء حتى تضغط تحديث.",
```

`README.md` § Updates: replace the "Turn it off in **Settings → About →
Check for updates** …" paragraph with:

```md
The check is always on. It is how an installed copy hears about fixes, and it
is the same single GET every day. If you would rather it never ran, block
github.com for Riwaq in your firewall; the app is fully functional offline.
```

- [ ] **Step 4: Run tests and the typecheck, expect PASS**

Run: `pnpm vitest run src/hooks src/store && pnpm build`
Expected: all pass. `tsc` reports no remaining `autoCheckUpdates` reference
(grep to be sure: `grep -rn autoCheckUpdates src` → nothing).

- [ ] **Step 5: Tamper check**

Comment out the new `delete parsed.autoCheckUpdates;` and re-run the
migration test: it must FAIL. Restore it.

- [ ] **Step 6: Screenshot the About section** (light + dark, en + ar) in a
plain browser per memory `browser-ui-verification`. Confirm the button spans
the card and the status line sits under it.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(updater): the daily check is always on; Check now spans the card" -- \
  src/types/reader.ts src/hooks/useTweaks.ts src/hooks/useTweaks.migration.test.ts \
  src/store/updateThrottle.ts src/store/updateThrottle.test.ts src/hooks/useUpdateCheck.ts \
  src/components/SettingsPage.tsx src/i18n/en.ts src/i18n/ar.ts README.md
```

(`git add src/hooks/useTweaks.migration.test.ts` first; it is new.)

---

### Task 2: Release-notes format and strict validator

**Files:**
- Create: `scripts/release-notes.mjs`, `scripts/release-notes.d.mts`,
  `scripts/verify-release-notes.mjs`
- Create: `release-notes/README.md`, `release-notes/img/.gitkeep`
- Modify: `package.json` (`verify:notes`, add to `check`)
- Test: `src/store/releaseNotesValidator.test.ts`

**Interfaces:**
- Produces: `validateReleaseNotes(notes: unknown, opts: { version: string;
  imageBytes: (name: string) => number | undefined }): string[]` (empty =
  valid), `IMAGE_CAP = 153600`.
- CLI: `node scripts/verify-release-notes.mjs [--require <version>]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/store/releaseNotesValidator.test.ts
import { describe, expect, it } from "vitest";
import {
  IMAGE_CAP,
  validateReleaseNotes,
} from "../../scripts/release-notes.mjs";

const ok = () => ({
  version: "0.6.0",
  date: "2026-10-15",
  highlight: {
    image: "0.6.0-cards.webp",
    title: { en: "Make the library yours", ar: "اجعل المكتبة على ذوقك" },
    body: { en: "Four styles.", ar: "أربعة أنماط." },
  },
  items: [
    { kind: "new", en: "Updates install inside the app", ar: "التحديثات داخل التطبيق" },
    { kind: "fixed", en: "No double import", ar: "لا استيراد مزدوج" },
  ],
});
const sizes = (m: Record<string, number>) => (n: string) => m[n];
const run = (n: unknown, img: Record<string, number> = { "0.6.0-cards.webp": 1000 }) =>
  validateReleaseNotes(n, { version: "0.6.0", imageBytes: sizes(img) });

describe("validateReleaseNotes", () => {
  it("accepts a well-formed file", () => {
    expect(run(ok())).toEqual([]);
  });
  it("rejects a version that disagrees with the file name", () => {
    expect(run({ ...ok(), version: "0.6.1" })).toContainEqual(
      expect.stringContaining("version"),
    );
  });
  it("rejects a line with no Arabic", () => {
    const n = ok();
    n.items[0].ar = "";
    expect(run(n).join()).toMatch(/items\[0\]\.ar/);
  });
  it("rejects English pasted into the Arabic field", () => {
    const n = ok();
    n.items[1].ar = "No double import";
    expect(run(n).join()).toMatch(/items\[1\]\.ar.*Arabic/);
  });
  it("rejects an unknown kind and unknown keys", () => {
    const n = ok() as Record<string, unknown>;
    (n.items as Record<string, unknown>[])[0].kind = "feature";
    n.extra = 1;
    const errs = run(n).join("\n");
    expect(errs).toMatch(/kind/);
    expect(errs).toMatch(/extra/);
  });
  it("rejects a missing or oversized image", () => {
    expect(run(ok(), {}).join()).toMatch(/0\.6\.0-cards\.webp.*missing/);
    expect(run(ok(), { "0.6.0-cards.webp": IMAGE_CAP + 1 }).join()).toMatch(
      /150 KB/,
    );
  });
  it("rejects an empty items list and a bad date", () => {
    expect(run({ ...ok(), items: [] }).join()).toMatch(/items/);
    expect(run({ ...ok(), date: "15/10/2026" }).join()).toMatch(/date/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing)

Run: `pnpm vitest run src/store/releaseNotesValidator.test.ts`

- [ ] **Step 3: Implement the validator**

```js
// scripts/release-notes.mjs
// Strict checks for release-notes/<version>.json. Shared by the CLI (pnpm
// check, the release workflow) and the tests. The app has its own lenient
// parser (src/store/releaseNotes.ts): a release must be perfect, a running
// app must never crash on a slightly-off file.

export const IMAGE_CAP = 150 * 1024;
const KINDS = ["new", "improved", "fixed"];
const ARABIC = /[؀-ۿ]/;
const IMAGE_NAME = /^[A-Za-z0-9_.-]+\.webp$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function onlyKeys(o, allowed, at, errs) {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) errs.push(`${at}: unknown key "${k}"`);
  }
}

function localized(o, at, errs) {
  if (!isObj(o)) return errs.push(`${at}: must be { en, ar }`);
  onlyKeys(o, ["en", "ar"], at, errs);
  text(o.en, `${at}.en`, errs);
  text(o.ar, `${at}.ar`, errs, true);
}

function text(v, at, errs, arabic = false) {
  if (typeof v !== "string" || v.trim() === "") {
    errs.push(`${at}: missing`);
  } else if (arabic && !ARABIC.test(v)) {
    errs.push(`${at}: has no Arabic letters — was English pasted in?`);
  }
}

function image(name, at, errs, imageBytes) {
  if (name === undefined) return;
  if (typeof name !== "string" || !IMAGE_NAME.test(name)) {
    return errs.push(`${at}: must be a .webp file name`);
  }
  const size = imageBytes(name);
  if (size === undefined) errs.push(`${at}: ${name} is missing from release-notes/img/`);
  else if (size > IMAGE_CAP) errs.push(`${at}: ${name} is ${size} bytes; the cap is 150 KB`);
}

function card(c, at, errs, imageBytes, withKind) {
  if (!isObj(c)) return errs.push(`${at}: must be an object`);
  onlyKeys(c, withKind ? ["kind", "image", "title", "body"] : ["image", "title", "body"], at, errs);
  if (withKind && c.kind !== undefined && !KINDS.includes(c.kind)) {
    errs.push(`${at}.kind: must be one of ${KINDS.join(", ")}`);
  }
  image(c.image, `${at}.image`, errs, imageBytes);
  localized(c.title, `${at}.title`, errs);
  localized(c.body, `${at}.body`, errs);
}

/** @returns {string[]} every problem found; empty means valid. */
export function validateReleaseNotes(notes, { version, imageBytes }) {
  const errs = [];
  if (!isObj(notes)) return ["the file must hold one JSON object"];
  onlyKeys(notes, ["version", "date", "highlight", "stories", "items"], "notes", errs);
  if (notes.version !== version) {
    errs.push(`version: "${notes.version}" but the file is for ${version}`);
  }
  if (typeof notes.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(notes.date)) {
    errs.push("date: must be YYYY-MM-DD");
  }
  if (notes.highlight !== undefined) {
    card(notes.highlight, "highlight", errs, imageBytes, false);
  }
  if (notes.stories !== undefined) {
    if (!Array.isArray(notes.stories) || notes.stories.length === 0) {
      errs.push("stories: omit it, or give at least one page");
    } else {
      notes.stories.forEach((s, i) => card(s, `stories[${i}]`, errs, imageBytes, true));
    }
  }
  if (!Array.isArray(notes.items) || notes.items.length === 0) {
    errs.push("items: at least one change is required");
  } else {
    notes.items.forEach((it, i) => {
      const at = `items[${i}]`;
      if (!isObj(it)) return errs.push(`${at}: must be an object`);
      onlyKeys(it, ["kind", "en", "ar"], at, errs);
      if (!KINDS.includes(it.kind)) errs.push(`${at}.kind: must be one of ${KINDS.join(", ")}`);
      text(it.en, `${at}.en`, errs);
      text(it.ar, `${at}.ar`, errs, true);
    });
  }
  return errs;
}
```

```ts
// scripts/release-notes.d.mts
export const IMAGE_CAP: number;
export function validateReleaseNotes(
  notes: unknown,
  opts: { version: string; imageBytes: (name: string) => number | undefined },
): string[];
```

```js
// scripts/verify-release-notes.mjs
// pnpm verify:notes                  — every release-notes/*.json must be valid
// pnpm verify:notes --require 0.6.0  — …and 0.6.0's file must exist (releases)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateReleaseNotes } from "./release-notes.mjs";

const DIR = "release-notes";
const args = process.argv.slice(2);
const required = args[0] === "--require" ? args[1]?.replace(/^v/, "") : undefined;
const imageBytes = (name) => {
  const p = join(DIR, "img", name);
  return existsSync(p) ? statSync(p).size : undefined;
};

let failed = false;
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f)) : [];
for (const f of files) {
  const version = f.replace(/\.json$/, "");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  } catch (e) {
    console.error(`✗ ${f}: not valid JSON (${e.message})`);
    failed = true;
    continue;
  }
  const errs = validateReleaseNotes(parsed, { version, imageBytes });
  if (errs.length) {
    failed = true;
    console.error(`✗ ${f}`);
    for (const e of errs) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${f}`);
  }
}
if (required && !files.includes(`${required}.json`)) {
  console.error(`✗ release-notes/${required}.json is missing — every release needs its notes (English and Arabic).`);
  failed = true;
}
process.exit(failed ? 1 : 0);
```

`package.json` scripts: add `"verify:notes": "node scripts/verify-release-notes.mjs"`
and append `&& pnpm verify:notes` to `check`.

`release-notes/README.md`: a short how-to. Copy the JSON example from the
spec and state these rules: one line per change, in the product's voice,
never a PR title; `kind` values; image rules; "omit `stories` for small
releases".

- [ ] **Step 4: Run, expect PASS**; then `pnpm verify:notes` → exit 0 (no files yet).

- [ ] **Step 5: Tamper check**: delete the `ARABIC` test in `text()`; the
"English pasted" test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add scripts/release-notes.mjs scripts/release-notes.d.mts scripts/verify-release-notes.mjs \
  release-notes/README.md release-notes/img/.gitkeep src/store/releaseNotesValidator.test.ts
git commit -m "feat(release-notes): a bilingual notes file per release, and a validator that fails the build" -- \
  scripts/release-notes.mjs scripts/release-notes.d.mts scripts/verify-release-notes.mjs \
  release-notes/README.md release-notes/img/.gitkeep src/store/releaseNotesValidator.test.ts package.json
```

---

### Task 3: Runtime notes model and the bundled `virtual:whats-new`

**Files:**
- Create: `src/store/releaseNotes.ts`, `src/store/releaseNotes.test.ts`
- Create: `vite-plugin-whats-new.ts`, `src/virtual-whats-new.d.ts`
- Modify: `vite.config.ts`, `vitest.config.ts` (register the plugin)
- Test: `src/store/whatsNewModule.test.ts`

**Interfaces:**
- Produces (`src/store/releaseNotes.ts`):
  ```ts
  export type ChangeKind = "new" | "improved" | "fixed";
  export interface Localized { en: string; ar: string }
  export interface NotesCard { kind?: ChangeKind; image?: string; title: Localized; body: Localized }
  export interface ChangeItem extends Localized { kind: ChangeKind }
  export interface ReleaseNotes { version: string; date: string; highlight?: NotesCard; stories?: NotesCard[]; items: ChangeItem[] }
  export function parseReleaseNotes(v: unknown): ReleaseNotes | null
  export function pick(l: Localized, locale: "en" | "ar"): string
  ```
- Produces (`virtual:whats-new`): `default: ReleaseNotes | null`,
  `images: Record<string, string>` (file name → bundled URL),
  `appVersion: string` (package.json version, synchronous).

- [ ] **Step 1: Failing tests**

```ts
// src/store/releaseNotes.test.ts
import { describe, expect, it } from "vitest";
import { parseReleaseNotes, pick } from "./releaseNotes";

const item = (kind: string, en = "a", ar = "ب") => ({ kind, en, ar });

describe("parseReleaseNotes", () => {
  it("keeps good items and drops malformed ones instead of failing", () => {
    // A running app must never crash on a slightly-off file; the release
    // validator is where strictness lives.
    const n = parseReleaseNotes({
      version: "0.6.0",
      date: "2026-10-15",
      items: [item("new"), item("feature"), { kind: "fixed" }, item("fixed")],
    });
    expect(n?.items.map((i) => i.kind)).toEqual(["new", "fixed"]);
  });
  it("is null with no usable items or no version", () => {
    expect(parseReleaseNotes({ version: "0.6.0", items: [] })).toBeNull();
    expect(parseReleaseNotes({ items: [item("new")] })).toBeNull();
    expect(parseReleaseNotes("<!DOCTYPE html>")).toBeNull();
  });
  it("drops a highlight or story missing either language", () => {
    const n = parseReleaseNotes({
      version: "0.6.0",
      date: "x",
      highlight: { title: { en: "t" }, body: { en: "b", ar: "ب" } },
      stories: [{ title: { en: "t", ar: "ت" }, body: { en: "b", ar: "ب" } }],
      items: [item("new")],
    });
    expect(n?.highlight).toBeUndefined();
    expect(n?.stories).toHaveLength(1);
  });
});

describe("pick", () => {
  it("falls back to English when the locale's string is empty", () => {
    expect(pick({ en: "Hi", ar: "" }, "ar")).toBe("Hi");
    expect(pick({ en: "Hi", ar: "أهلا" }, "ar")).toBe("أهلا");
  });
});
```

```ts
// src/store/whatsNewModule.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import notes, { appVersion, images } from "virtual:whats-new";

describe("virtual:whats-new", () => {
  it("reports package.json's version synchronously", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(appVersion).toBe(pkg.version);
  });
  it("bundles only this version's notes, or null when there are none", () => {
    if (notes) expect(notes.version).toBe(appVersion);
    else expect(images).toEqual({});
  });
});
```

(`node:fs` in a test file: vitest runs under Node; `tsc` sees it because
`src` is included. If `tsc` complains about missing Node types, read the file
with `import pkg from "../../package.json"` instead. `resolveJsonModule` is on.)

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```ts
// src/store/releaseNotes.ts
// What the app shows from a release's notes. Lenient on purpose: anything
// malformed is dropped, never thrown. scripts/release-notes.mjs is the strict
// gate a release has to pass; this is what a running app does with whatever
// it was handed (an older file, a half-download, a hand edit).

export type ChangeKind = "new" | "improved" | "fixed";
export interface Localized {
  en: string;
  ar: string;
}
export interface NotesCard {
  kind?: ChangeKind;
  image?: string;
  title: Localized;
  body: Localized;
}
export interface ChangeItem extends Localized {
  kind: ChangeKind;
}
export interface ReleaseNotes {
  version: string;
  date: string;
  highlight?: NotesCard;
  stories?: NotesCard[];
  items: ChangeItem[];
}

const KINDS: readonly string[] = ["new", "improved", "fixed"];
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
const str = (v: unknown): v is string => typeof v === "string" && v !== "";

function localized(v: unknown): Localized | null {
  const o = rec(v);
  return o && str(o.en) && str(o.ar) ? { en: o.en, ar: o.ar } : null;
}

function card(v: unknown): NotesCard | null {
  const o = rec(v);
  if (!o) return null;
  const title = localized(o.title);
  const body = localized(o.body);
  if (!title || !body) return null;
  return {
    title,
    body,
    ...(str(o.image) ? { image: o.image } : {}),
    ...(typeof o.kind === "string" && KINDS.includes(o.kind)
      ? { kind: o.kind as ChangeKind }
      : {}),
  };
}

export function parseReleaseNotes(v: unknown): ReleaseNotes | null {
  const o = rec(v);
  if (!o || !str(o.version)) return null;
  const items: ChangeItem[] = [];
  for (const raw of Array.isArray(o.items) ? o.items : []) {
    const i = rec(raw);
    const l = localized(i);
    if (i && l && typeof i.kind === "string" && KINDS.includes(i.kind)) {
      items.push({ kind: i.kind as ChangeKind, ...l });
    }
  }
  if (items.length === 0) return null;
  const highlight = card(o.highlight) ?? undefined;
  const stories = (Array.isArray(o.stories) ? o.stories : [])
    .map(card)
    .filter((c): c is NotesCard => c !== null);
  return {
    version: o.version,
    date: str(o.date) ? o.date : "",
    ...(highlight ? { highlight } : {}),
    ...(stories.length ? { stories } : {}),
    items,
  };
}

export function pick(l: Localized, locale: "en" | "ar"): string {
  return l[locale] || l.en;
}
```

```ts
// vite-plugin-whats-new.ts
// `virtual:whats-new`: this build's own release notes, their images, and
// the app version, available synchronously at startup with no network.
// Only the file for package.json's version is bundled — notes never
// accumulate across releases.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

const ID = "virtual:whats-new";
const RESOLVED = `\0${ID}`;

export function whatsNew(): Plugin {
  return {
    name: "riwaq-whats-new",
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const version: string = JSON.parse(readFileSync("package.json", "utf8")).version;
      const file = resolve("release-notes", `${version}.json`);
      const head = `export const appVersion = ${JSON.stringify(version)};\n`;
      if (!existsSync(file)) return `${head}export const images = {};\nexport default null;\n`;
      this.addWatchFile(file);
      const notes = JSON.parse(readFileSync(file, "utf8"));
      const names: string[] = [
        notes.highlight?.image,
        ...(notes.stories ?? []).map((s: { image?: string }) => s.image),
      ].filter((n): n is string => typeof n === "string");
      const imports = names
        .map((n, i) => `import img${i} from ${JSON.stringify(resolve("release-notes/img", n))};`)
        .join("\n");
      const map = names.map((n, i) => `${JSON.stringify(n)}: img${i}`).join(", ");
      return `${imports}\n${head}export const images = { ${map} };\nexport default ${JSON.stringify(notes)};\n`;
    },
  };
}
```

```ts
// src/virtual-whats-new.d.ts
declare module "virtual:whats-new" {
  import type { ReleaseNotes } from "./store/releaseNotes";
  const notes: ReleaseNotes | null;
  export default notes;
  export const images: Record<string, string>;
  export const appVersion: string;
}
```

`vite.config.ts`: `import { whatsNew } from "./vite-plugin-whats-new";` and
`plugins: [react(), whatsNew()]`. `vitest.config.ts`: the same import, plus
`plugins: [whatsNew()]` at the top level of `defineConfig({...})`. Add
`"vite-plugin-whats-new.ts"` to `tsconfig.node.json` `include`.

- [ ] **Step 4: Run, expect PASS.** `pnpm build` must also pass.

- [ ] **Step 5: Tamper**: in the plugin, export
`appVersion = "0.0.0"`. `whatsNewModule.test.ts` must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/store/releaseNotes.ts src/store/releaseNotes.test.ts src/store/whatsNewModule.test.ts \
  vite-plugin-whats-new.ts src/virtual-whats-new.d.ts
git commit -m "feat(release-notes): bundle this version's notes via virtual:whats-new" -- \
  src/store/releaseNotes.ts src/store/releaseNotes.test.ts src/store/whatsNewModule.test.ts \
  vite-plugin-whats-new.ts src/virtual-whats-new.d.ts vite.config.ts vitest.config.ts tsconfig.node.json
```

---

### Task 4: Rust: the next release's notes, checksum and size

**Files:**
- Modify: `src-tauri/src/updates.rs`
- Modify: `src-tauri/src/lib.rs` (register two commands)

**Interfaces:**
- Consumes: `endpoint_from_config`, `parse_manifest`, `push_capped` (PR #166).
- Produces (Tauri commands, camelCase JSON):
  - `fetch_release_notes(version: String) -> { notes: unknown, highlightImage: string | null }`
    (`highlightImage` is a `data:image/webp;base64,…` URL)
  - `fetch_apk_details(version: String) -> { url: string, sha256: string, size: number }`

- [ ] **Step 1: Failing unit tests** (append to `mod tests` in `updates.rs`)

```rust
    #[test]
    fn release_base_for_github_and_for_a_test_server() {
        assert_eq!(
            release_base("https://github.com/o/r/releases/latest/download/latest.json", "0.6.0").as_deref(),
            Some("https://github.com/o/r/releases/download/v0.6.0/")
        );
        // An e2e build points at a local server: assets sit beside latest.json.
        assert_eq!(
            release_base("http://127.0.0.1:8765/latest.json", "0.6.0").as_deref(),
            Some("http://127.0.0.1:8765/")
        );
    }

    #[test]
    fn version_must_be_plain_semver() {
        // It is spliced into a URL; nothing but digits and dots gets in.
        assert!(valid_version("0.6.10"));
        assert!(!valid_version("0.6.0/../../x"));
        assert!(!valid_version("0.6"));
        assert!(!valid_version(""));
    }

    #[test]
    fn checksum_for_finds_the_apk_line_only() {
        let sums = "aa  other.exe\nF973A8BBF8BEE7D0CED32E47107418A37AC9CD9A9C6DBAD2446740E84C1E0673 *app-universal-release.apk\n";
        assert_eq!(
            checksum_for(sums, "app-universal-release.apk").as_deref(),
            Some("f973a8bbf8bee7d0ced32e47107418a37ac9cd9a9c6dbad2446740e84c1e0673")
        );
        assert_eq!(checksum_for(sums, "missing.apk"), None);
        // A truncated hash must not pass as a checksum.
        assert_eq!(checksum_for("abc  app-universal-release.apk", "app-universal-release.apk"), None);
    }

    #[test]
    fn image_names_are_bare_webp_files() {
        assert!(valid_image_name("0.6.0-cards.webp"));
        assert!(!valid_image_name("../secret.webp"));
        assert!(!valid_image_name("x.png"));
    }

    #[test]
    #[ignore = "network"]
    fn live_checksum_for_a_published_release() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let ep = endpoint_from_config(&conf["plugins"]).unwrap();
        let d = tauri::async_runtime::block_on(apk_details(&ep, "0.5.1", "0.0.0")).unwrap();
        assert_eq!(d.sha256.len(), 64);
        assert!(d.size > 1_000_000, "{d:?}");
    }
```

- [ ] **Step 2: Run, expect compile FAIL**: `cd src-tauri && cargo test --lib updates`

- [ ] **Step 3: Implement** (in `updates.rs`, above `mod tests`; refactor
`fetch_manifest` to use `client()` + `get_capped`)

```rust
const APK_ASSET: &str = "app-universal-release.apk";
const NOTES_ASSET: &str = "whats-new.json";
const SUMS_ASSET: &str = "SHA256SUMS";
const MAX_IMAGE_BYTES: usize = 150 * 1024;

/// Where one release's assets live. Versioned, never `/latest/`: a release
/// published while the sheet is open must not swap the notes or the APK
/// out from under the checksum we already fetched.
fn release_base(endpoint: &str, version: &str) -> Option<String> {
    const LATEST: &str = "/releases/latest/download/latest.json";
    if let Some(repo) = endpoint.strip_suffix(LATEST) {
        return Some(format!("{repo}/releases/download/v{version}/"));
    }
    let cut = endpoint.rfind('/')?;
    Some(endpoint[..=cut].to_string())
}

fn valid_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn valid_image_name(n: &str) -> bool {
    n.ends_with(".webp")
        && !n.starts_with('.')
        && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn checksum_for(sums: &str, asset: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut it = line.split_whitespace();
        let hash = it.next()?;
        let name = it.next()?.trim_start_matches('*');
        (name == asset && hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
            .then(|| hash.to_ascii_lowercase())
    })
}

fn client(app_version: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("Riwaq/{app_version}"))
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

async fn get_capped(client: &reqwest::Client, url: &str, cap: usize) -> Result<Vec<u8>, String> {
    let mut resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{url}: HTTP {}", resp.status()));
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        if body.len() + chunk.len() > cap {
            return Err(format!("{url}: larger than {cap} bytes"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn configured_endpoint(app: &AppHandle) -> Result<String, String> {
    let plugins = serde_json::to_value(&app.config().plugins.0).unwrap_or_default();
    endpoint_from_config(&plugins).ok_or_else(|| "no updater endpoint configured".to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotesPayload {
    notes: serde_json::Value,
    highlight_image: Option<String>,
}

#[tauri::command]
pub async fn fetch_release_notes(app: AppHandle, version: String) -> Result<ReleaseNotesPayload, String> {
    if !valid_version(&version) {
        return Err("bad version".into());
    }
    let base = release_base(&configured_endpoint(&app)?, &version).ok_or("bad endpoint")?;
    let c = client(&app.package_info().version.to_string())?;
    let raw = get_capped(&c, &format!("{base}{NOTES_ASSET}"), MAX_MANIFEST_BYTES).await?;
    let notes: serde_json::Value = serde_json::from_slice(&raw).map_err(|_| "notes are not JSON")?;
    // The image is optional decoration: any failure here drops the image,
    // never the notes.
    let mut highlight_image = None;
    if let Some(name) = notes.pointer("/highlight/image").and_then(|v| v.as_str()) {
        if valid_image_name(name) {
            if let Ok(bytes) = get_capped(&c, &format!("{base}{name}"), MAX_IMAGE_BYTES).await {
                use base64::Engine;
                highlight_image = Some(format!(
                    "data:image/webp;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                ));
            }
        }
    }
    Ok(ReleaseNotesPayload { notes, highlight_image })
}

#[derive(Debug, Serialize)]
pub struct ApkDetails {
    url: String,
    sha256: String,
    size: u64,
}

async fn apk_details(endpoint: &str, version: &str, app_version: &str) -> Result<ApkDetails, String> {
    let base = release_base(endpoint, version).ok_or("bad endpoint")?;
    let c = client(app_version)?;
    let sums = get_capped(&c, &format!("{base}{SUMS_ASSET}"), MAX_MANIFEST_BYTES).await?;
    // No checksum, no install: an APK we cannot verify is never offered.
    let sha256 = checksum_for(&String::from_utf8_lossy(&sums), APK_ASSET)
        .ok_or("SHA256SUMS has no line for the APK")?;
    let url = format!("{base}{APK_ASSET}");
    let head = c.head(&url).send().await.map_err(|e| e.to_string())?;
    // Read the header itself: reqwest's content_length() describes the body
    // it received, which for a HEAD is empty.
    let size = head
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("no Content-Length for the APK")?;
    Ok(ApkDetails { url, sha256, size })
}

#[tauri::command]
pub async fn fetch_apk_details(app: AppHandle, version: String) -> Result<ApkDetails, String> {
    if !valid_version(&version) {
        return Err("bad version".into());
    }
    apk_details(&configured_endpoint(&app)?, &version, &app.package_info().version.to_string()).await
}
```

Register in `lib.rs` after `updates::check_update_manifest,`:
`updates::fetch_release_notes, updates::fetch_apk_details,`.

- [ ] **Step 4: Run** `cargo test --lib updates -- --include-ignored` → all pass, live included.
- [ ] **Step 5: Tamper**: drop the `hash.len() == 64` condition; the truncated-hash assertion must fail. Restore.
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(updater): fetch a release's notes, APK checksum and size from Rust" -- src-tauri/src/updates.rs src-tauri/src/lib.rs
```

---

### Task 5: Shared notes UI: `NotesView` and `StoryPages`

**First:** invoke `ui-ux-pro-max` (CLAUDE.md). Match the approved mockup
`update-flow.html` (sheet step 2 and story pages).

**Files:**
- Create: `src/components/update/NotesView.tsx`, `src/components/update/StoryPages.tsx`
- Create: `src/components/update/NotesView.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `ReleaseNotes`, `pick` (Task 3); `Icon` (`plus`, `chevronsU`,
  `check`, `externalLink`); `Button`; `useI18n` (`locale` is `"en" | "ar"`).
- Produces:
  ```ts
  NotesView({ notes, theme, imageUrl }: { notes: ReleaseNotes | null; theme: Theme;
    imageUrl?: (name: string) => string | undefined; fallbackVersion?: string })
  StoryPages({ notes, theme, imageUrl, onDone }: { notes: ReleaseNotes; theme: Theme;
    imageUrl?: (name: string) => string | undefined; onDone: () => void })
  ```

i18n keys (en / ar):

```ts
  "whatsNew.title": "What's new in {v}",           // "ما الجديد في {v}"
  "whatsNew.highlight": "Highlight",               // "أبرز ما في الإصدار"
  "whatsNew.kind.new": "New",                      // "جديد"
  "whatsNew.kind.improved": "Improved",            // "تحسين"
  "whatsNew.kind.fixed": "Fixed",                  // "إصلاح"
  "whatsNew.onGithub": "Release notes on GitHub",  // "ملاحظات الإصدار على GitHub"
  "whatsNew.noNotes": "Riwaq {v} is available.",   // "الإصدار {v} من رواق متاح."
  "whatsNew.next": "Next",                         // "التالي"
  "whatsNew.skip": "Skip",                         // "تخطَّ"
  "whatsNew.done": "Start reading",                // "ابدأ القراءة"
  "whatsNew.gotIt": "Got it",                      // "حسنًا"
  "whatsNew.now": "You're now on {v}",             // "أنت الآن على الإصدار {v}"
  "whatsNew.page": "Page {n} of {total}",          // "الصفحة {n} من {total}"
```

- [ ] **Step 1: Failing test**

```tsx
// @vitest-environment happy-dom
// src/components/update/NotesView.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEMES } from "../../styles/tokens";
import type { ReleaseNotes } from "../../store/releaseNotes";
import { NotesView } from "./NotesView";

const notes: ReleaseNotes = {
  version: "0.6.0",
  date: "2026-10-15",
  highlight: { title: { en: "Make it yours", ar: "على ذوقك" }, body: { en: "Four styles", ar: "أربعة أنماط" } },
  items: [
    { kind: "new", en: "In-app updates", ar: "تحديثات داخل التطبيق" },
    { kind: "fixed", en: "No double import", ar: "لا استيراد مزدوج" },
  ],
};

function render(ui: React.ReactNode, lang: "en" | "ar") {
  const host = document.createElement("div");
  act(() => createRoot(host).render(<I18nProvider pref={lang}>{ui}</I18nProvider>));
  return host;
}

describe("NotesView", () => {
  it("shows the highlight, then every item with a worded tag, in English", () => {
    const h = render(<NotesView notes={notes} theme={THEMES.sepia} />, "en");
    expect(h.textContent).toContain("Make it yours");
    expect(h.textContent).toContain("In-app updates");
    // Tags are words, not just colour.
    expect(h.textContent).toContain("New");
    expect(h.textContent).toContain("Fixed");
  });
  it("renders the Arabic strings in Arabic", () => {
    const h = render(<NotesView notes={notes} theme={THEMES.sepia} />, "ar");
    expect(h.textContent).toContain("لا استيراد مزدوج");
    expect(h.textContent).toContain("إصلاح");
  });
  it("falls back to a GitHub link when there are no notes", () => {
    const h = render(<NotesView notes={null} theme={THEMES.sepia} fallbackVersion="0.6.0" />, "en");
    expect(h.textContent).toContain("Riwaq 0.6.0 is available");
    expect(h.textContent).toContain("Release notes on GitHub");
  });
});
```

Check `I18nProvider`'s real prop name before running (`grep -n "export function I18nProvider" -A8 src/i18n/I18nProvider.tsx`) and adjust `pref=`.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```tsx
// src/components/update/NotesView.tsx
import type { ReactNode } from "react";
import { useI18n } from "../../i18n/useI18n";
import { pick, type ChangeKind, type ReleaseNotes } from "../../store/releaseNotes";
import { RELEASES_PAGE_URL } from "../../store/updates";
import type { Theme } from "../../styles/tokens";
import { Icon } from "../Icon";

const KIND_ICON = { new: "plus", improved: "chevronsU", fixed: "check" } as const;

/** Tag with an icon AND a word. Colour only reinforces it, so the meaning
 *  survives colour blindness and the monochrome OLED theme. */
export function KindTag({ kind, theme }: { kind: ChangeKind; theme: Theme }) {
  const { tr } = useI18n();
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, flex: "none",
        height: 20, padding: "0 7px", borderRadius: 6, fontSize: 10.5, fontWeight: 600,
        background: theme.hover, color: kind === "fixed" ? theme.danger : theme.ink,
      }}
    >
      <Icon name={KIND_ICON[kind]} size={11} stroke={2.2} />
      {tr(`whatsNew.kind.${kind}`)}
    </span>
  );
}

export function NotesView({
  notes, theme, imageUrl, fallbackVersion,
}: {
  notes: ReleaseNotes | null;
  theme: Theme;
  imageUrl?: (name: string) => string | undefined;
  fallbackVersion?: string;
}): ReactNode {
  const { tr, locale } = useI18n();
  if (!notes) {
    return (
      <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
        <p style={{ margin: "0 0 10px" }}>{tr("whatsNew.noNotes", { v: fallbackVersion ?? "" })}</p>
        <a
          href={RELEASES_PAGE_URL}
          onClick={(e) => {
            e.preventDefault();
            void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(RELEASES_PAGE_URL));
          }}
          style={{ color: theme.ink, display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          {tr("whatsNew.onGithub")} <Icon name="externalLink" size={14} />
        </a>
      </div>
    );
  }
  const h = notes.highlight;
  const src = h?.image ? imageUrl?.(h.image) : undefined;
  return (
    <div>
      {h && (
        <section style={{ borderRadius: 16, background: theme.chrome, padding: 14, marginBottom: 12 }}>
          {src && (
            <img src={src} alt="" style={{ display: "block", width: "100%", height: "auto",
              maxHeight: 140, objectFit: "contain", borderRadius: 10, background: theme.bg, marginBottom: 12 }} />
          )}
          <span style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase",
            color: theme.muted, fontWeight: 600 }}>{tr("whatsNew.highlight")}</span>
          <h3 style={{ margin: "6px 0 4px", fontSize: 15, fontWeight: 600 }}>{pick(h.title, locale)}</h3>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: theme.muted }}>{pick(h.body, locale)}</p>
        </section>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {notes.items.map((it, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list, never reordered
          <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 0",
            borderBottom: `0.5px solid ${theme.rule}`, fontSize: 13, lineHeight: 1.45 }}>
            <KindTag kind={it.kind} theme={theme} />
            <span>{pick(it, locale)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

```tsx
// src/components/update/StoryPages.tsx
// Full-screen, one feature per page, shown once after a BIG release (one
// whose notes define `stories`). Small releases never get here — see
// WhatsNewAfterUpdate.
import { useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { pick, type ReleaseNotes } from "../../store/releaseNotes";
import { Z, type Theme } from "../../styles/tokens";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { KindTag } from "./NotesView";

export function StoryPages({ notes, theme, imageUrl, onDone }: {
  notes: ReleaseNotes; theme: Theme;
  imageUrl?: (name: string) => string | undefined; onDone: () => void;
}) {
  const { tr, locale } = useI18n();
  const pages = notes.stories ?? [];
  const [i, setI] = useState(0);
  const page = pages[i];
  if (!page) return null;
  const last = i === pages.length - 1;
  const src = page.image ? imageUrl?.(page.image) : undefined;
  return (
    <div role="dialog" aria-modal="true" aria-label={tr("whatsNew.title", { v: notes.version })}
      style={{ position: "fixed", inset: 0, zIndex: Z.modal, background: theme.bg, color: theme.ink,
        display: "flex", flexDirection: "column",
        padding: "calc(env(safe-area-inset-top, 0px) + 20px) 22px calc(env(safe-area-inset-bottom, 0px) + 22px)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, letterSpacing: ".12em", textTransform: "uppercase",
          color: theme.muted, fontWeight: 600 }}>{tr("whatsNew.title", { v: notes.version })}</span>
        <Button theme={theme} variant="ghost" size="sm" onClick={onDone}>{tr("whatsNew.skip")}</Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, borderRadius: 22, background: theme.chrome, margin: "20px 0",
        display: "grid", placeItems: "center", overflow: "hidden" }}>
        {src ? <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
             : <Icon name="book" size={84} stroke={1.2} />}
      </div>
      {page.kind && <span><KindTag kind={page.kind} theme={theme} /></span>}
      <h2 style={{ margin: "8px 0", fontSize: 22, fontWeight: 600, lineHeight: 1.25 }}>{pick(page.title, locale)}</h2>
      <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.55, color: theme.muted }}>{pick(page.body, locale)}</p>
      <div aria-label={tr("whatsNew.page", { n: i + 1, total: pages.length })}
        style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 16 }}>
        {pages.map((_, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: page dots
          <i key={k} style={{ width: k === i ? 20 : 7, height: 7, borderRadius: 4,
            background: k === i ? theme.ink : theme.ruleStrong }} />
        ))}
      </div>
      <Button theme={theme} variant="primary" fullWidth onClick={() => (last ? onDone() : setI(i + 1))}>
        {last ? tr("whatsNew.done") : tr("whatsNew.next")}
      </Button>
    </div>
  );
}
```

(Check the `tr` key type: `tr(\`whatsNew.kind.${kind}\`)` must typecheck. If
`MsgKey` rejects a template literal, use a `const KIND_KEY = { new:
"whatsNew.kind.new", … } as const` map instead.)

- [ ] **Step 4: Run, PASS; `pnpm build`.** Then screenshot NotesView and
StoryPages in a browser (sepia/dark, en/ar) against the mockup.
- [ ] **Step 5: Tamper**: render `it.en` instead of `pick(it, locale)`; the
Arabic test must fail. Restore.
- [ ] **Step 6: Commit** (`git add` the three new files first)

```bash
git commit -m "feat(release-notes): NotesView and StoryPages, shared by every platform" -- \
  src/components/update/NotesView.tsx src/components/update/StoryPages.tsx \
  src/components/update/NotesView.test.tsx src/i18n/en.ts src/i18n/ar.ts
```

---

### Task 6: After-update screen and Settings "What's new in this version"

**Files:**
- Create: `src/store/whatsNew.ts`, `src/store/whatsNew.test.ts`
- Create: `src/components/update/WhatsNewAfterUpdate.tsx`
- Modify: `src/types/reader.ts` (`lastSeenWhatsNew?: string`)
- Modify: `src/hooks/useTweaks.ts` (fresh install stamps `lastSeenWhatsNew`)
- Modify: `src/App.tsx` (mount), `src/components/SettingsPage.tsx` (row),
  i18n (`settings.updates.whatsNew`: "What's new in this version" /
  "ما الجديد في هذا الإصدار")

**Interfaces:**
- Produces: `shouldShowWhatsNew(input: { bundled: string | null;
  lastSeen: string | undefined }): boolean`;
  `<WhatsNewAfterUpdate theme open onClose />`.

- [ ] **Step 1: Failing tests**

```ts
// src/store/whatsNew.test.ts
import { describe, expect, it } from "vitest";
import { shouldShowWhatsNew } from "./whatsNew";

describe("shouldShowWhatsNew", () => {
  it("shows once for a version newer than the last one seen", () => {
    expect(shouldShowWhatsNew({ bundled: "0.6.0", lastSeen: "0.5.3" })).toBe(true);
    expect(shouldShowWhatsNew({ bundled: "0.6.0", lastSeen: "0.6.0" })).toBe(false);
  });
  it("shows to an updater from a build that never recorded anything", () => {
    // Every build before this feature: no lastSeenWhatsNew stored at all.
    expect(shouldShowWhatsNew({ bundled: "0.6.0", lastSeen: undefined })).toBe(true);
  });
  it("never shows without bundled notes, or after a downgrade", () => {
    expect(shouldShowWhatsNew({ bundled: null, lastSeen: "0.5.3" })).toBe(false);
    expect(shouldShowWhatsNew({ bundled: "0.6.0", lastSeen: "0.7.0" })).toBe(false);
  });
});
```

Add to `src/hooks/useTweaks.migration.test.ts`:

```ts
  it("a fresh install starts with this version already seen — no tour", () => {
    // Nothing stored = a brand-new user, who has nothing to compare against.
    expect(loadTweaks().lastSeenWhatsNew).toBe(appVersion);
  });
  it("an updater keeps undefined so the tour shows once", () => {
    localStorage.setItem("riwaq:tweaks:v1", JSON.stringify({ fontSize: 19 }));
    expect(loadTweaks().lastSeenWhatsNew).toBeUndefined();
  });
```

(with `import { appVersion } from "virtual:whats-new";`).

- [ ] **Step 2: Run, FAIL.**
- [ ] **Step 3: Implement**

```ts
// src/store/whatsNew.ts
import { isNewerVersion } from "./updateVersion";

/** Show the after-update screen? Keyed only on versions, so it works no
 *  matter who performed the update: us, Orion, Obtainium, F-Droid, adb. */
export function shouldShowWhatsNew({ bundled, lastSeen }: {
  bundled: string | null;
  lastSeen: string | undefined;
}): boolean {
  if (!bundled) return false;
  if (lastSeen === undefined) return true;
  return isNewerVersion(bundled, lastSeen);
}
```

In `useTweaks.ts` `loadTweaks()`: `if (!raw) return { ...DEFAULT_TWEAKS,
lastSeenWhatsNew: appVersion };` (import `appVersion` from
`virtual:whats-new`). Also accept `lastSeenWhatsNew` from storage as is.

```tsx
// src/components/update/WhatsNewAfterUpdate.tsx
import notes, { images } from "virtual:whats-new";
import { useI18n } from "../../i18n/useI18n";
import type { Theme } from "../../styles/tokens";
import { Button } from "../Button";
import { MobileSheet } from "../MobileSheet";
import { NotesView } from "./NotesView";
import { StoryPages } from "./StoryPages";

const imageUrl = (n: string) => images[n];

/** Big release (stories) → full-screen pages; otherwise → a short sheet. */
export function WhatsNewAfterUpdate({ theme, open, onClose }: {
  theme: Theme; open: boolean; onClose: () => void;
}) {
  const { tr } = useI18n();
  if (!notes) return null;
  if (open && notes.stories?.length) {
    return <StoryPages notes={notes} theme={theme} imageUrl={imageUrl} onDone={onClose} />;
  }
  return (
    <MobileSheet theme={theme} open={open} onClose={onClose} height="70%"
      label={tr("whatsNew.title", { v: notes.version })}>
      <div style={{ padding: "4px 20px 20px" }}>
        <h2 style={{ margin: "0 0 2px", fontSize: 19, fontWeight: 600 }}>
          {tr("whatsNew.title", { v: notes.version })}
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: theme.muted }}>
          {tr("whatsNew.now", { v: notes.version })}
        </p>
        <NotesView notes={notes} theme={theme} imageUrl={imageUrl} />
        <div style={{ marginTop: 16 }}>
          <Button theme={theme} variant="primary" fullWidth onClick={onClose}>{tr("whatsNew.gotIt")}</Button>
        </div>
      </div>
    </MobileSheet>
  );
}
```

On desktop the same sheet is acceptable (MobileSheet renders a bottom sheet
at any width). If it looks wrong at desktop widths in the screenshot step,
switch to `AnimatedDialog` when `layout === "desktop"`. Check
`AnimatedDialog`'s props first.

`App.tsx`: one state, `const [whatsNewOpen, setWhatsNewOpen] = useState(() =>
shouldShowWhatsNew({ bundled: bundledNotes?.version ?? null, lastSeen:
t.lastSeenWhatsNew }))`. Render `<WhatsNewAfterUpdate theme open={whatsNewOpen}
onClose={() => { setWhatsNewOpen(false); setTweak("lastSeenWhatsNew",
appVersion); }} />` next to the UpdateBanner. The decision is synchronous
(no await before first paint). Pass `onOpenWhatsNew={() =>
setWhatsNewOpen(true)}` to `SettingsPage`, which renders a row "What's new
in this version" (chevron) under Check now. Show it only when bundled notes
exist.

- [ ] **Step 4: Run, PASS; `pnpm build`; browser screenshot of both forms.**
- [ ] **Step 5: Tamper**: make `shouldShowWhatsNew` return `true` when
`lastSeen === bundled`; the "0.6.0 vs 0.6.0" assertion must fail. Restore.
- [ ] **Step 6: Commit**

```bash
git add src/store/whatsNew.ts src/store/whatsNew.test.ts src/components/update/WhatsNewAfterUpdate.tsx
git commit -m "feat(release-notes): show what's new once after any update, and from Settings" -- \
  src/store/whatsNew.ts src/store/whatsNew.test.ts src/components/update/WhatsNewAfterUpdate.tsx \
  src/types/reader.ts src/hooks/useTweaks.ts src/hooks/useTweaks.migration.test.ts \
  src/App.tsx src/components/SettingsPage.tsx src/i18n/en.ts src/i18n/ar.ts
```

---

### Task 7: Desktop banner "What's new" dialog

**Files:**
- Create: `src/components/update/DesktopNotesDialog.tsx`
- Create: `src/store/fetchNotes.ts`, `src/store/fetchNotes.test.ts`
- Modify: `src/components/UpdateBanner.tsx`, i18n (`update.action.whatsNew`:
  "What's new" / "ما الجديد")

**Interfaces:**
- Produces: `fetchNotes(invokeImpl, version): Promise<{ notes: ReleaseNotes |
  null; highlightImage?: string }>`. It never throws; a failure gives
  `notes: null`.

- [ ] **Step 1: Failing test**

```ts
// src/store/fetchNotes.test.ts
import { describe, expect, it } from "vitest";
import { fetchNotes } from "./fetchNotes";

describe("fetchNotes", () => {
  it("parses what Rust returns and keeps the image", async () => {
    const r = await fetchNotes(async (cmd, args) => {
      expect(cmd).toBe("fetch_release_notes");
      expect(args).toEqual({ version: "0.6.0" });
      return { notes: { version: "0.6.0", date: "d", items: [{ kind: "new", en: "a", ar: "ب" }] },
               highlightImage: "data:image/webp;base64,AA" };
    }, "0.6.0");
    expect(r.notes?.items).toHaveLength(1);
    expect(r.highlightImage).toMatch(/^data:image\/webp/);
  });
  it("is null — not a throw — when the release has no notes asset", async () => {
    const r = await fetchNotes(async () => { throw "HTTP 404"; }, "0.6.0");
    expect(r.notes).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL. Step 3: Implement**

```ts
// src/store/fetchNotes.ts
import { parseReleaseNotes, type ReleaseNotes } from "./releaseNotes";

type Invoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

export async function fetchNotes(invokeImpl: Invoke, version: string): Promise<{
  notes: ReleaseNotes | null; highlightImage?: string;
}> {
  try {
    const r = (await invokeImpl("fetch_release_notes", { version })) as {
      notes?: unknown; highlightImage?: unknown;
    };
    const notes = parseReleaseNotes(r?.notes);
    const img = typeof r?.highlightImage === "string" && r.highlightImage.startsWith("data:image/webp;base64,")
      ? r.highlightImage : undefined;
    return { notes, highlightImage: img };
  } catch {
    return { notes: null };
  }
}
```

`DesktopNotesDialog`: `AnimatedDialog` (read its props first) holding a
heading "Riwaq {v}", then `<NotesView notes fallbackVersion
imageUrl={(n) => n === notes?.highlight?.image ? highlightImage : undefined} />`,
then the banner's own action button. It fetches on open via `fetchNotes(invoke,
info.version)` and shows a `Spinner` meanwhile. In `UpdateBanner`, add a ghost
button `tr("update.action.whatsNew")` between Later and Update that opens it.

- [ ] **Step 4: PASS; browser screenshot of the dialog (mock `invoke`).**
- [ ] **Step 5: Commit**

```bash
git add src/components/update/DesktopNotesDialog.tsx src/store/fetchNotes.ts src/store/fetchNotes.test.ts
git commit -m "feat(updater): a What's new button on the desktop update banner" -- \
  src/components/update/DesktopNotesDialog.tsx src/store/fetchNotes.ts src/store/fetchNotes.test.ts \
  src/components/UpdateBanner.tsx src/i18n/en.ts src/i18n/ar.ts
```

---

### Task 8: Release pipeline: validate, upload, render the body

**Files:**
- Create: `scripts/render-release-notes.mjs`
- Modify: `.github/workflows/release.yml`, `docs/RELEASING.md`

- [ ] **Step 1: Write the renderer and run it on a fixture by hand**

```js
// scripts/render-release-notes.mjs
// release-notes/<v>.json → markdown for the GitHub release body. English
// first, then Arabic (RTL via the dir attribute GitHub preserves).
import { readFileSync } from "node:fs";

const v = process.argv[2]?.replace(/^v/, "");
const n = JSON.parse(readFileSync(`release-notes/${v}.json`, "utf8"));
const label = { new: ["New", "جديد"], improved: ["Improved", "تحسينات"], fixed: ["Fixed", "إصلاحات"] };
const section = (lang, idx) => {
  const out = [];
  if (n.highlight) out.push(`**${n.highlight.title[lang]}**: ${n.highlight.body[lang]}`, "");
  for (const k of ["new", "improved", "fixed"]) {
    const items = n.items.filter((i) => i.kind === k);
    if (items.length) out.push(`### ${label[k][idx]}`, ...items.map((i) => `- ${i[lang]}`), "");
  }
  return out.join("\n");
};
process.stdout.write(`${section("en", 0)}\n<div dir="rtl">\n\n${section("ar", 1)}\n</div>\n`);
```

Check it: write a scratch `release-notes/0.0.1.json` (valid per Task 2), run
`node scripts/render-release-notes.mjs 0.0.1`, read the output, then **delete
the scratch file**.

- [ ] **Step 2: Workflow changes**

In `preflight`, after "Verify the release config":

```yaml
      - name: Verify the release notes (English and Arabic)
        run: |
          if [[ "${GITHUB_REF}" == refs/tags/* ]]; then
            node scripts/verify-release-notes.mjs --require "${GITHUB_REF_NAME}"
          else
            node scripts/verify-release-notes.mjs
          fi
```

New job, before `checksums`:

```yaml
  notes:
    needs: preflight
    runs-on: ubuntu-22.04
    if: startsWith(github.ref, 'refs/tags/')
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Upload whats-new.json and its images; put the notes on the release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG: ${{ github.ref_name }}
        run: |
          set -euo pipefail
          v="${TAG#v}"
          cp "release-notes/${v}.json" whats-new.json
          imgs=$(node -e 'const n=require("./whats-new.json");for(const i of [n.highlight?.image,...(n.stories??[]).map(s=>s.image)])if(i)console.log("release-notes/img/"+i)')
          # The draft is created by the first build job; wait for it.
          for i in $(seq 1 60); do gh release view "$TAG" >/dev/null 2>&1 && break; sleep 20; done
          gh release upload "$TAG" whats-new.json $imgs --clobber
          node scripts/render-release-notes.mjs "$v" > body.md
          gh release view "$TAG" --json body -q .body >> body.md
          gh release edit "$TAG" --notes-file body.md
```

Change `checksums.needs` to include `notes`, so `SHA256SUMS` covers
`whats-new.json` and the images.

**Rerun safety:** `gh release edit` appends the generated changelog each run.
Guard it with `grep -q '<div dir="rtl">' <(gh release view "$TAG" --json body
-q .body) || …`.

- [ ] **Step 3: Validate the YAML**: `python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/release.yml'))"`,
and `actionlint` if installed.

- [ ] **Step 4: `docs/RELEASING.md`**: add step 1b under "Cutting a release":
write `release-notes/<version>.json` (English and Arabic, product voice, see
`release-notes/README.md`), and run `pnpm verify:notes --require <version>`.
Also state that the release fails without it.

- [ ] **Step 5: Commit**

```bash
git add scripts/render-release-notes.mjs
git commit -m "ci(release): require bilingual notes, upload whats-new.json, write the release body from it" -- \
  scripts/render-release-notes.mjs .github/workflows/release.yml docs/RELEASING.md
```

---

### Task 9: Android install source and store-aware channel

**Files:**
- Create: `src-tauri/gen/android/app/src/main/java/com/riwaq/reader/AppUpdater.kt` (install-source part)
- Create: `src-tauri/src/android_update.rs`
- Modify: `src-tauri/src/notify.rs` (`pub(crate) fn find_app_class`, `pub(crate) fn drain_pending_exception`)
- Modify: `src-tauri/src/lib.rs` (`mod android_update;` + commands)
- Modify: `proguard-rules.pro`, `scripts/verify-jni-bridge.sh`
- Create: `src/store/updateFlow.ts` (channel part), `src/store/updateFlow.test.ts`

**Interfaces:**
- Kotlin: `AppUpdater.installSource(ctx: Context): String` returns JSON
  `{"installer": "<pkg or empty>", "label": "<store label or empty>", "storeInstalled": true|false}`.
  `AppUpdater.openStore(activity: Activity, pkg: String)`.
- Rust commands: `install_source() -> String` (JSON; on desktop `{"installer":"","label":"","storeInstalled":false}`),
  `open_store(pkg: String)`.
- TS:
  ```ts
  export type AndroidChannel =
    | { kind: "in-app" }
    | { kind: "store-assisted"; store: "orion" | "obtainium"; pkg: string; label: string }
    | { kind: "managed"; pkg: string; label: string }
    | { kind: "manual" };
  export function androidChannel(src: { installer: string; label: string; storeInstalled: boolean } | null): AndroidChannel
  ```

- [ ] **Step 1: Failing TS tests**

```ts
// src/store/updateFlow.test.ts
import { describe, expect, it } from "vitest";
import { androidChannel } from "./updateFlow";

const src = (installer: string, storeInstalled = true, label = "") => ({ installer, label, storeInstalled });

describe("androidChannel", () => {
  it("installs in-app for sideloads, adb/Shizuku and our own earlier update", () => {
    for (const i of ["", "com.google.android.packageinstaller", "com.android.packageinstaller",
                     "com.android.shell", "com.riwaq.reader"]) {
      expect(androidChannel(src(i)).kind).toBe("in-app");
    }
  });
  it("hands Orion and Obtainium installs back to their store", () => {
    expect(androidChannel(src("com.orion.store"))).toMatchObject({ kind: "store-assisted", store: "orion" });
    expect(androidChannel(src("dev.imranr.obtainium.fdroid"))).toMatchObject({ kind: "store-assisted", store: "obtainium" });
  });
  it("falls back to in-app when that store app is gone", () => {
    expect(androidChannel(src("com.orion.store", false)).kind).toBe("in-app");
  });
  it("leaves F-Droid, Play and unknown stores alone", () => {
    for (const i of ["org.fdroid.fdroid", "com.looker.droidify", "com.android.vending", "com.example.somestore"]) {
      expect(androidChannel(src(i)).kind).toBe("managed");
    }
  });
  it("uses the old link when the lookup failed", () => {
    expect(androidChannel(null).kind).toBe("manual");
  });
});
```

- [ ] **Step 2: FAIL. Step 3: Implement TS**

```ts
// src/store/updateFlow.ts
// Pure decisions for the Android update flow. No React, no IPC — every rule
// here is a function of plain inputs, so each one is tested on its own.

export type AndroidChannel =
  | { kind: "in-app" }
  | { kind: "store-assisted"; store: "orion" | "obtainium"; pkg: string; label: string }
  | { kind: "managed"; pkg: string; label: string }
  | { kind: "manual" };

export interface InstallSource { installer: string; label: string; storeInstalled: boolean }

/** Installers that mean "nobody manages this install": the system package
 *  installer (a tapped APK), adb — and Shizuku, which Orion and Obtainium can
 *  use and which records com.android.shell — and Riwaq itself after one
 *  in-app update. Misfiling a store install here is harmless: the store
 *  ships the same signed APK, and whichever installs first wins. */
const SIDELOAD = new Set(["", "com.google.android.packageinstaller",
  "com.android.packageinstaller", "com.android.shell", "com.riwaq.reader"]);
const ASSISTED: Record<string, "orion" | "obtainium"> = {
  "com.orion.store": "orion",
  "dev.imranr.obtainium": "obtainium",
  "dev.imranr.obtainium.fdroid": "obtainium",
};

export function androidChannel(src: InstallSource | null): AndroidChannel {
  if (!src) return { kind: "manual" };
  if (SIDELOAD.has(src.installer)) return { kind: "in-app" };
  const store = ASSISTED[src.installer];
  if (store) {
    return src.storeInstalled
      ? { kind: "store-assisted", store, pkg: src.installer, label: src.label }
      : { kind: "in-app" };
  }
  return { kind: "managed", pkg: src.installer, label: src.label };
}
```

- [ ] **Step 4: Kotlin**

```kotlin
// AppUpdater.kt (first part; Task 10 adds download/verify)
package com.riwaq.reader

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject

/**
 * In-app updates for sideloaded installs. Every member called from Rust over
 * JNI is @JvmStatic and kept by `-keep class com.riwaq.reader.AppUpdater { *; }`
 * in proguard-rules.pro — R8 sees no bytecode caller for any of them.
 */
object AppUpdater {
    @JvmStatic
    fun installSource(ctx: Context): String {
        val pm = ctx.packageManager
        val installer = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                pm.getInstallSourceInfo(ctx.packageName).installingPackageName
            } else {
                @Suppress("DEPRECATION") pm.getInstallerPackageName(ctx.packageName)
            }
        } catch (_: Exception) { null } ?: ""
        var label = ""
        var installed = false
        if (installer.isNotEmpty()) {
            try {
                val ai = pm.getApplicationInfo(installer, 0)
                label = pm.getApplicationLabel(ai).toString()
                installed = pm.getLaunchIntentForPackage(installer) != null
            } catch (_: PackageManager.NameNotFoundException) { /* store uninstalled */ }
        }
        return JSONObject().put("installer", installer).put("label", label)
            .put("storeInstalled", installed).toString()
    }

    @JvmStatic
    fun openStore(activity: Activity, pkg: String) {
        activity.packageManager.getLaunchIntentForPackage(pkg)?.let { activity.startActivity(it) }
    }
}
```

**Package visibility (API 30+):** `getApplicationInfo` and
`getLaunchIntentForPackage` for *another* app need a `<queries>` entry. Add
to `AndroidManifest.xml` under `<manifest>`:

```xml
    <queries>
        <package android:name="com.orion.store" />
        <package android:name="dev.imranr.obtainium" />
        <package android:name="dev.imranr.obtainium.fdroid" />
        <package android:name="org.fdroid.fdroid" />
        <package android:name="org.fdroid.basic" />
        <package android:name="com.looker.droidify" />
        <package android:name="com.machiav3lli.fdroid" />
        <package android:name="com.android.vending" />
    </queries>
```

(Unlisted stores still classify correctly as "managed"; they just show "your
app store" with no Open button.)

- [ ] **Step 5: Rust bridge** (`src-tauri/src/android_update.rs`)

```rust
//! Rust ⇄ Kotlin bridge for in-app updates (AppUpdater.kt). Same rules as
//! notify.rs: classes via the activity's classloader, every pending Java
//! exception drained so a missing member degrades to Err, never a dead
//! process. Desktop builds get stubs.

#[cfg(target_os = "android")]
use jni::objects::{JObject, JString, JValue};

#[cfg(target_os = "android")]
const CLASS: &str = "com.riwaq.reader.AppUpdater";

#[cfg(target_os = "android")]
fn call<'a, F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&mut jni::JNIEnv<'a>, &JObject<'a>, &jni::objects::JClass<'a>) -> Result<T, jni::errors::Error>,
{
    let (vm, activity) = crate::notify::main_activity().map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread_permanently().map_err(|e| e.to_string())?;
    let class = crate::notify::find_app_class(&mut env, activity, CLASS).map_err(|e| e.to_string());
    let res = match class {
        Ok(c) => f(&mut env, activity, &c).map_err(|e| e.to_string()),
        Err(e) => Err(e),
    };
    crate::notify::drain_pending_exception(&mut env);
    res
}

#[cfg(target_os = "android")]
fn string_result(env: &mut jni::JNIEnv<'_>, v: jni::objects::JValueOwned<'_>) -> Result<String, jni::errors::Error> {
    let obj: JString = v.l()?.into();
    Ok(env.get_string(&obj)?.into())
}

#[tauri::command]
pub async fn install_source() -> Result<String, String> {
    #[cfg(target_os = "android")]
    return call(|env, act, c| {
        let v = env.call_static_method(c, "installSource", "(Landroid/content/Context;)Ljava/lang/String;", &[JValue::Object(act)])?;
        string_result(env, v)
    });
    #[cfg(not(target_os = "android"))]
    Ok(r#"{"installer":"","label":"","storeInstalled":false}"#.into())
}

#[tauri::command]
pub async fn open_store(pkg: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return call(|env, act, c| {
        let p = env.new_string(pkg)?;
        env.call_static_method(c, "openStore", "(Landroid/app/Activity;Ljava/lang/String;)V",
            &[JValue::Object(act), JValue::Object(&p)])?;
        Ok(())
    });
    #[cfg(not(target_os = "android"))]
    { let _ = pkg; Err("android only".into()) }
}
```

Match the `attach_current_thread` style `notify.rs` already uses. If it uses
`attach_current_thread()` (a guard), use the same guard here instead of
`_permanently`. Make `find_app_class` and `drain_pending_exception`
`pub(crate)` in `notify.rs`; `main_activity` already is. Register
`android_update::install_source, android_update::open_store` in `lib.rs`.

- [ ] **Step 6: ProGuard + guard**

```
# Rust -> Kotlin: AppUpdater's @JvmStatic members (install source, download,
# install, cleanup), all reached only over JNI from src-tauri/src/android_update.rs.
-keep class com.riwaq.reader.AppUpdater { *; }
```

Add to `EXPECTED` in `scripts/verify-jni-bridge.sh`:

```
  "com.riwaq.reader.AppUpdater java.lang.String installSource(android.content.Context)"
  "com.riwaq.reader.AppUpdater void openStore(android.app.Activity,java.lang.String)"
```

- [ ] **Step 7: Verify**: `pnpm vitest run src/store/updateFlow.test.ts`;
`cd src-tauri && cargo check --lib`; and `cargo check --target
aarch64-linux-android --lib` (NDK env per memory `android-emulator-dev-setup`).
- [ ] **Step 8: Commit** (`git add` the new files)

```bash
git commit -m "feat(android): know who installed Riwaq, and leave store installs to their store" -- \
  src-tauri/gen/android/app/src/main/java/com/riwaq/reader/AppUpdater.kt src-tauri/src/android_update.rs \
  src-tauri/src/notify.rs src-tauri/src/lib.rs src-tauri/gen/android/app/proguard-rules.pro \
  scripts/verify-jni-bridge.sh src-tauri/gen/android/app/src/main/AndroidManifest.xml \
  src/store/updateFlow.ts src/store/updateFlow.test.ts
```

---

### Task 10: Kotlin download, verify, `UpdateService`, cleanup on launch

**Files:**
- Modify: `AppUpdater.kt` (start/status/cancel/cleanup/isMetered + worker)
- Create: `UpdateService.kt`
- Modify: `MainActivity.kt` (`AppUpdater.cleanupAsync(this)` in `onCreate`)
- Modify: `AndroidManifest.xml` (`<service .UpdateService dataSync>`)
- Modify: `src-tauri/src/android_update.rs`, `lib.rs`, ProGuard guard list
- Modify: `src/store/updateFlow.ts` (+ `cleanupDecision`, `parseNativeStatus`) and its test

**Interfaces:**
- Kotlin (all `@JvmStatic`):
  `start(ctx: Context, version: String, url: String, sha256: String, size: Long, waitForUnmetered: Boolean)`,
  `status(ctx: Context): String`, `cancel(ctx: Context)`, `isMetered(ctx: Context): Boolean`,
  `cleanupAsync(ctx: Context)`.
- Status JSON: `{"state":"idle|waiting|downloading|verifying|ready|installing|failed","version":"0.6.0","bytes":123,"total":19230841,"error":"offline|checksum|signature|storage|install"|null}`.
- Rust commands: `android_update_start(version, url, sha256, size, wait_for_unmetered)`,
  `android_update_status() -> String`, `android_update_cancel()`, `android_network_metered() -> bool`.
- TS:
  ```ts
  export type NativeState = "idle"|"waiting"|"downloading"|"verifying"|"ready"|"installing"|"failed";
  export interface NativeStatus { state: NativeState; version?: string; bytes: number; total: number; error: string | null }
  export function parseNativeStatus(json: string): NativeStatus   // garbage → idle
  export function versionCode(v: string): number                  // a*1e6 + b*1e3 + c, NaN → -1
  export function cleanupDecision(running: string, cached: string | undefined): "keep" | "delete"
  ```

- [ ] **Step 1: Failing TS tests** (append to `updateFlow.test.ts`)

```ts
import { cleanupDecision, parseNativeStatus, versionCode } from "./updateFlow";

describe("cleanupDecision", () => {
  it("deletes a cached APK once the running app is at or past it — whoever updated", () => {
    // Orion/Obtainium/F-Droid/adb updated us while our APK sat in cache.
    expect(cleanupDecision("0.6.0", "0.6.0")).toBe("delete");
    expect(cleanupDecision("0.6.1", "0.6.0")).toBe("delete");
    expect(cleanupDecision("0.5.3", "0.6.0")).toBe("keep");
    expect(cleanupDecision("0.5.3", undefined)).toBe("keep");
  });
});

describe("parseNativeStatus", () => {
  it("reads a downloading status", () => {
    expect(parseNativeStatus('{"state":"downloading","version":"0.6.0","bytes":5,"total":10,"error":null}'))
      .toEqual({ state: "downloading", version: "0.6.0", bytes: 5, total: 10, error: null });
  });
  it("treats garbage as idle instead of throwing", () => {
    expect(parseNativeStatus("nope").state).toBe("idle");
    expect(parseNativeStatus('{"state":"exploded"}').state).toBe("idle");
  });
});

describe("versionCode", () => {
  it("matches Android's versionCode rule", () => {
    expect(versionCode("0.6.1")).toBe(6001);
    expect(versionCode("1.2.3")).toBe(1002003);
    expect(versionCode("x")).toBe(-1);
  });
});
```

The Kotlin `cleanup` mirrors `cleanupDecision` exactly (same
`versionCode` formula). The TS copy is the tested specification. Cite it in
a Kotlin comment.

- [ ] **Step 2: FAIL. Step 3: TS**

```ts
const STATES = ["idle","waiting","downloading","verifying","ready","installing","failed"] as const;
export type NativeState = (typeof STATES)[number];
export interface NativeStatus { state: NativeState; version?: string; bytes: number; total: number; error: string | null }

export function parseNativeStatus(json: string): NativeStatus {
  const idle: NativeStatus = { state: "idle", bytes: 0, total: 0, error: null };
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    if (!STATES.includes(o.state as NativeState)) return idle;
    return {
      state: o.state as NativeState,
      ...(typeof o.version === "string" ? { version: o.version } : {}),
      bytes: typeof o.bytes === "number" ? o.bytes : 0,
      total: typeof o.total === "number" ? o.total : 0,
      error: typeof o.error === "string" ? o.error : null,
    };
  } catch { return idle; }
}

/** Android's versionCode, as tauri derives it: major*1e6 + minor*1e3 + patch. */
export function versionCode(v: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? +m[1] * 1_000_000 + +m[2] * 1_000 + +m[3] : -1;
}

export function cleanupDecision(running: string, cached: string | undefined): "keep" | "delete" {
  if (!cached) return "keep";
  return versionCode(running) >= versionCode(cached) ? "delete" : "keep";
}
```

- [ ] **Step 4: Kotlin worker** (add to `AppUpdater`)

```kotlin
    private const val DIR = "updates"
    private const val NOTIF_ID = 1003
    @Volatile private var worker: Thread? = null
    @Volatile private var cancelled = false
    private var netCallback: android.net.ConnectivityManager.NetworkCallback? = null

    private fun dir(ctx: Context) = java.io.File(ctx.cacheDir, DIR).apply { mkdirs() }
    private fun stateFile(ctx: Context) = java.io.File(dir(ctx), "state.json")

    /** Persisted so a swiped-away app, or a process the system killed, still
     *  finds "ready" on next launch. Single writer: the worker or a UI call. */
    @Synchronized private fun write(ctx: Context, o: JSONObject) = stateFile(ctx).writeText(o.toString())
    private fun read(ctx: Context): JSONObject =
        try { JSONObject(stateFile(ctx).readText()) } catch (_: Exception) { JSONObject().put("state", "idle") }

    @JvmStatic fun status(ctx: Context): String = read(ctx).toString()

    @JvmStatic fun isMetered(ctx: Context): Boolean =
        (ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).isActiveNetworkMetered

    @JvmStatic
    fun start(ctx: Context, version: String, url: String, sha256: String, size: Long, waitForUnmetered: Boolean) {
        if (worker?.isAlive == true) return
        val app = ctx.applicationContext
        val job = JSONObject().put("version", version).put("url", url).put("sha256", sha256)
            .put("total", size).put("bytes", 0L)
        if (waitForUnmetered && isMetered(app)) {
            write(app, job.put("state", "waiting"))
            val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val req = android.net.NetworkRequest.Builder()
                .addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .addCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED).build()
            val cb = object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    cm.unregisterNetworkCallback(this); netCallback = null
                    start(app, version, url, sha256, size, false)
                }
            }
            netCallback = cb
            cm.registerNetworkCallback(req, cb)
            return
        }
        cancelled = false
        write(app, job.put("state", "downloading"))
        UpdateService.start(app)
        worker = Thread({ run(app, job) }, "riwaq-update").apply { start() }
    }

    @JvmStatic
    fun cancel(ctx: Context) {
        cancelled = true
        netCallback?.let {
            (ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).unregisterNetworkCallback(it)
            netCallback = null
        }
        dir(ctx).listFiles()?.forEach { it.delete() }
        write(ctx, JSONObject().put("state", "idle"))
        UpdateService.stop(ctx)
    }

    private fun fail(ctx: Context, job: JSONObject, error: String) {
        write(ctx, job.put("state", "failed").put("error", error))
        UpdateService.stop(ctx)
    }

    private fun run(ctx: Context, job: JSONObject) {
        val version = job.getString("version")
        val d = dir(ctx)
        val part = java.io.File(d, "riwaq-$version.apk.part")
        val apk = java.io.File(d, "riwaq-$version.apk")
        // Never more than one pending APK: anything for another version goes.
        d.listFiles()?.forEach { if (it != part && it != apk && it.name != "state.json") it.delete() }
        val total = job.getLong("total")
        if (d.usableSpace < total - part.length() + 5L * 1024 * 1024) return fail(ctx, job, "storage")
        try {
            // Re-request the GitHub URL on every attempt: its redirect target
            // is a signed URL that expires after about an hour.
            val conn = java.net.URL(job.getString("url")).openConnection() as java.net.HttpURLConnection
            conn.instanceFollowRedirects = true
            conn.connectTimeout = 15_000; conn.readTimeout = 30_000
            if (part.length() > 0) conn.setRequestProperty("Range", "bytes=${part.length()}-")
            val code = conn.responseCode
            if (code != 200 && code != 206) return fail(ctx, job, "offline")
            val append = code == 206
            var bytes = if (append) part.length() else 0L
            var lastWrite = 0L
            java.io.FileOutputStream(part, append).use { out ->
                conn.inputStream.use { inp ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        if (cancelled) return
                        val n = inp.read(buf); if (n < 0) break
                        out.write(buf, 0, n); bytes += n
                        val now = System.currentTimeMillis()
                        if (now - lastWrite > 250) {
                            lastWrite = now
                            write(ctx, job.put("state", "downloading").put("bytes", bytes))
                            UpdateService.progress(ctx, version, bytes, total)
                        }
                    }
                }
            }
        } catch (_: java.io.IOException) {
            return fail(ctx, job.put("bytes", part.length()), "offline")
        }
        write(ctx, job.put("state", "verifying").put("bytes", part.length()))
        if (sha256(part) != job.getString("sha256")) { part.delete(); return fail(ctx, job, "checksum") }
        if (!sameAppNewerAndSameSigner(ctx, part)) { part.delete(); return fail(ctx, job, "signature") }
        part.renameTo(apk)
        write(ctx, job.put("state", "ready").put("error", JSONObject.NULL))
        UpdateService.stop(ctx)
    }

    private fun sha256(f: java.io.File): String {
        val md = java.security.MessageDigest.getInstance("SHA-256")
        f.inputStream().use { s -> val b = ByteArray(64 * 1024); while (true) { val n = s.read(b); if (n < 0) break; md.update(b, 0, n) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Android refuses a different signer anyway; checking first turns its
     *  opaque "App not installed" into an explained failure. */
    private fun sameAppNewerAndSameSigner(ctx: Context, f: java.io.File): Boolean {
        val pm = ctx.packageManager
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val flags = PackageManager.GET_SIGNING_CERTIFICATES
                val archive = pm.getPackageArchiveInfo(f.path, flags) ?: return false
                val mine = pm.getPackageInfo(ctx.packageName, flags)
                archive.packageName == ctx.packageName &&
                    archive.longVersionCode > mine.longVersionCode &&
                    archive.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet() ==
                    mine.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
            } else {
                @Suppress("DEPRECATION") val flags = PackageManager.GET_SIGNATURES
                @Suppress("DEPRECATION") val archive = pm.getPackageArchiveInfo(f.path, flags) ?: return false
                @Suppress("DEPRECATION") val mine = pm.getPackageInfo(ctx.packageName, flags)
                @Suppress("DEPRECATION")
                archive.packageName == ctx.packageName && archive.versionCode > mine.versionCode &&
                    archive.signatures?.map { it.toCharsString() }?.toSet() == mine.signatures?.map { it.toCharsString() }?.toSet()
            }
        } catch (_: Exception) { false }
    }

    private fun code(v: String): Long =
        Regex("""^(\d+)\.(\d+)\.(\d+)$""").find(v)?.destructured?.let { (a, b, c) ->
            a.toLong() * 1_000_000 + b.toLong() * 1_000 + c.toLong() } ?: -1

    /** Mirrors cleanupDecision() in src/store/updateFlow.ts (the tested spec):
     *  once the running version is at or past the cached one — whoever did
     *  the update — every cached file goes. Off the main thread: never delay
     *  first paint. */
    @JvmStatic
    fun cleanupAsync(ctx: Context) {
        val app = ctx.applicationContext
        Thread({
            val cached = read(app).optString("version", "")
            val running = try { app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "" } catch (_: Exception) { "" }
            if (cached.isNotEmpty() && code(running) >= code(cached)) {
                dir(app).listFiles()?.forEach { it.delete() }
            }
        }, "riwaq-update-cleanup").start()
    }
```

`UpdateService.kt`: a copy of `TaskService`'s structure with these
differences:
- `NOTIF_ID = 1003`.
- `onTaskRemoved` does **not** stop the service: the download is pure Kotlin
  and needs no WebView.
- `companion object` has `start(ctx)`, `stop(ctx)` and `progress(ctx, version,
  bytes, total)`. `progress` posts a determinate `NotificationCompat` on
  channel `TaskService.CHANNEL_ID`, titled "Downloading Riwaq $version",
  `setProgress(100, pct, false)`, `setOnlyAlertOnce(true)`.
- No wake lock beyond a 30-minute cap, same as TaskService.

Manifest:
`<service android:name=".UpdateService" android:foregroundServiceType="dataSync" android:exported="false" />`.

`MainActivity.onCreate`: add `AppUpdater.cleanupAsync(this)` **after**
`super.onCreate` and the existing Rust registration. It is asynchronous; it
must not block.

Rust: add `android_update_start`, `android_update_status`,
`android_update_cancel`, `android_network_metered` with the same `call`
helper.
- JNI descriptors: `start` is
  `(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;JZ)V`;
  `status` is `(Landroid/content/Context;)Ljava/lang/String;`; `cancel` is
  `(Landroid/content/Context;)V`; `isMetered` is
  `(Landroid/content/Context;)Z`.
- Pass `JValue::Long(size as i64)` and `JValue::Bool(u8::from(b))`.
- Desktop stubs return `Err("android only")`, and `"{\"state\":\"idle\"}"`
  for status.

Add the four signatures to `verify-jni-bridge.sh`:

```
  "com.riwaq.reader.AppUpdater void start(android.content.Context,java.lang.String,java.lang.String,java.lang.String,long,boolean)"
  "com.riwaq.reader.AppUpdater java.lang.String status(android.content.Context)"
  "com.riwaq.reader.AppUpdater void cancel(android.content.Context)"
  "com.riwaq.reader.AppUpdater boolean isMetered(android.content.Context)"
```

- [ ] **Step 5: Verify**: TS tests pass; `cargo check --lib` and the Android
target check; `pnpm tauri android build --apk --debug --target aarch64`
compiles the Kotlin.
- [ ] **Step 6: Tamper**: make `cleanupDecision` use `>` instead of `>=`; the
"0.6.0 vs 0.6.0" assertion must fail. Restore.
- [ ] **Step 7: Commit** (`git add UpdateService.kt` first)

```bash
git commit -m "feat(android): download and verify an update in its own foreground service" -- \
  src-tauri/gen/android/app/src/main/java/com/riwaq/reader/AppUpdater.kt \
  src-tauri/gen/android/app/src/main/java/com/riwaq/reader/UpdateService.kt \
  src-tauri/gen/android/app/src/main/java/com/riwaq/reader/MainActivity.kt \
  src-tauri/gen/android/app/src/main/AndroidManifest.xml src-tauri/src/android_update.rs src-tauri/src/lib.rs \
  scripts/verify-jni-bridge.sh src/store/updateFlow.ts src/store/updateFlow.test.ts
```

---

### Task 11: Kotlin install: permission, `PackageInstaller` session, receivers

**Files:**
- Modify: `AppUpdater.kt` (`canInstall`, `openInstallPermission`, `install`)
- Create: `UpdateReceivers.kt` (`InstallResultReceiver`, `PackageReplacedReceiver`)
- Modify: `AndroidManifest.xml` (`REQUEST_INSTALL_PACKAGES`, two `<receiver>`s)
- Create: `res/values/strings_update.xml`, `res/values-ar/strings_update.xml`
- Modify: `android_update.rs`, `lib.rs`, `verify-jni-bridge.sh`

**Interfaces:**
- Kotlin: `canInstall(ctx: Context): Boolean`, `openInstallPermission(activity: Activity)`, `install(activity: Activity)`.
- Rust: `android_update_can_install() -> bool`, `android_update_open_permission()`, `android_update_install()`.

- [ ] **Step 1: Kotlin**

```kotlin
    @JvmStatic
    fun canInstall(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.packageManager.canRequestPackageInstalls()

    @JvmStatic
    fun openInstallPermission(activity: Activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        activity.startActivity(android.content.Intent(
            android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            android.net.Uri.parse("package:${activity.packageName}")))
    }

    @JvmStatic
    fun install(activity: Activity) {
        val st = read(activity)
        val apk = java.io.File(dir(activity), "riwaq-${st.optString("version")}.apk")
        if (st.optString("state") != "ready" || !apk.exists()) return
        val pi = activity.packageManager.packageInstaller
        val params = android.content.pm.PackageInstaller.SessionParams(
            android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(activity.packageName)
        val id = pi.createSession(params)
        pi.openSession(id).use { s ->
            s.openWrite("base.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                s.fsync(out)
            }
            val flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) android.app.PendingIntent.FLAG_MUTABLE else 0)
            val cb = android.app.PendingIntent.getBroadcast(activity, id,
                android.content.Intent(activity, InstallResultReceiver::class.java), flags)
            write(activity, st.put("state", "installing"))
            s.commit(cb.intentSender)
        }
    }

    /** Called by InstallResultReceiver. ABORTED = the user tapped Cancel on
     *  Android's dialog: back to "ready" with the verified APK kept. */
    internal fun onInstallResult(ctx: Context, ok: Boolean, aborted: Boolean) {
        val st = read(ctx)
        if (ok) return // the process is about to be replaced
        write(ctx, if (aborted) st.put("state", "ready") else st.put("state", "failed").put("error", "install"))
    }
```

```kotlin
// UpdateReceivers.kt
package com.riwaq.reader

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import androidx.core.app.NotificationCompat

class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm = if (Build.VERSION.SDK_INT >= 33)
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_INTENT)
                confirm?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)?.let { ctx.startActivity(it) }
            }
            PackageInstaller.STATUS_SUCCESS -> AppUpdater.onInstallResult(ctx, ok = true, aborted = false)
            PackageInstaller.STATUS_FAILURE_ABORTED -> AppUpdater.onInstallResult(ctx, ok = false, aborted = true)
            else -> AppUpdater.onInstallResult(ctx, ok = false, aborted = false)
        }
    }
}

/** Android kills the app to replace it and never relaunches it; background
 *  activity starts are blocked on 10+. So: one notification to reopen. Fires
 *  after ANY update of Riwaq (ours or a store's), which is fine — it says
 *  what is true. */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        AppUpdater.cleanupAsync(ctx)
        val version = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""
        val open = PendingIntent.getActivity(ctx, 0,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE)
        DownloadNotifier.ensureChannelPublic(ctx)
        val n = NotificationCompat.Builder(ctx, TaskService.CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(ctx.getString(R.string.update_installed_title, version))
            .setContentText(ctx.getString(R.string.update_installed_body))
            .setContentIntent(open).setAutoCancel(true).build()
        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(1004, n)
    }
}
```

Strings: `values/strings_update.xml`:
`update_installed_title` = "Riwaq %1$s is installed",
`update_installed_body` = "Tap to open it.".
`values-ar/strings_update.xml`: "تم تثبيت رواق %1$s" and "اضغط لفتحه.".

Manifest:

```xml
    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
    <!-- inside <application> -->
    <receiver android:name=".InstallResultReceiver" android:exported="false" />
    <receiver android:name=".PackageReplacedReceiver" android:exported="false">
        <intent-filter><action android:name="android.intent.action.MY_PACKAGE_REPLACED" /></intent-filter>
    </receiver>
```

**Whether `PackageReplacedReceiver` should post when *a store* updated us:**
yes. The notification is true either way, and the user may not have opened
the app since. If this proves noisy with Orion or Obtainium (they already
notify), gate it on `read(ctx).optString("state") == "installing"`. Decide
in Task 14 from what the emulator shows.

Rust commands (descriptors): `canInstall` is `(Landroid/content/Context;)Z`;
`openInstallPermission` and `install` are `(Landroid/app/Activity;)V`. Add
the three to `verify-jni-bridge.sh`.

- [ ] **Step 2: Verify**: Android debug build compiles; `cargo check` for both targets.
- [ ] **Step 3: Commit** (`git add` new files)

```bash
git commit -m "feat(android): install a verified update through a PackageInstaller session" -- \
  src-tauri/gen/android/app/src/main/java/com/riwaq/reader/AppUpdater.kt \
  src-tauri/gen/android/app/src/main/java/com/riwaq/reader/UpdateReceivers.kt \
  src-tauri/gen/android/app/src/main/AndroidManifest.xml \
  src-tauri/gen/android/app/src/main/res/values/strings_update.xml \
  src-tauri/gen/android/app/src/main/res/values-ar/strings_update.xml \
  src-tauri/src/android_update.rs src-tauri/src/lib.rs scripts/verify-jni-bridge.sh
```

---

### Task 12: Flow decisions, store, polling, new tweaks

**Files:**
- Modify: `src/store/updateFlow.ts` (+ `pillFor`, `attentionDot`, `decideStart`, `clearSkip`) and test
- Create: `src/store/androidUpdate.ts`, `src/store/androidUpdate.test.ts`
- Modify: `src/types/reader.ts`, `src/hooks/useTweaks.ts`
  (`skippedUpdateVersion?: string`, `updateOverMobile: "ask" | "always" | "wifi"` default `"ask"`)

**Interfaces:**
- ```ts
  export type Pill =
    | { kind: "available" } | { kind: "progress"; pct: number } | { kind: "waiting" }
    | { kind: "ready" } | { kind: "failed" } | null;
  export function pillFor(i: { offered: string | null; running: string; native: NativeStatus;
    skipped: string | undefined; laterThisSession: boolean; channel: AndroidChannel["kind"] }): Pill
  export function attentionDot(i: same-shape input): boolean
  export function decideStart(i: { metered: boolean; pref: "ask" | "always" | "wifi" }): "start" | "ask" | "wait"
  export function clearSkip(skipped: string | undefined, offered: string | null, running: string): boolean
  ```
- `androidUpdate.ts`: `subscribe(fn)`, `getState()`, `useAndroidUpdate()`, and
  actions `offer(info)`, `openSheet(mode)`, `closeSheet()`, `later()`,
  `skip(version)`, `undoSkip()`, `startDownload({ allowMetered })`,
  `cancel()`, `install()`, `openPermission()`, `retry()`, `openStoreApp()`.
  State: `{ offer: { version } | null; native: NativeStatus; channel:
  AndroidChannel; sheet: "closed" | "notes" | "mobile" | "progress" |
  "permission" | "ready" | "failed"; toast: "later" | "skipped" | null;
  later: boolean; notes: { notes: ReleaseNotes | null; highlightImage?:
  string } | null; apk: { url; sha256; size } | null }`.

- [ ] **Step 1: Failing tests**

```ts
// append to src/store/updateFlow.test.ts
import { attentionDot, clearSkip, decideStart, pillFor } from "./updateFlow";

const idle = { state: "idle", bytes: 0, total: 0, error: null } as const;
const base = { offered: "0.6.0", running: "0.5.3", native: idle, skipped: undefined,
  laterThisSession: false, channel: "in-app" } as const;

describe("pillFor", () => {
  it("offers, then shows progress, then ready", () => {
    expect(pillFor(base)).toEqual({ kind: "available" });
    expect(pillFor({ ...base, native: { ...idle, state: "downloading", bytes: 37, total: 100 } }))
      .toEqual({ kind: "progress", pct: 37 });
    expect(pillFor({ ...base, native: { ...idle, state: "ready" } })).toEqual({ kind: "ready" });
  });
  it("disappears once the app is already at the offered version — a store updated it", () => {
    expect(pillFor({ ...base, running: "0.6.0" })).toBeNull();
    expect(pillFor({ ...base, running: "0.6.0", native: { ...idle, state: "ready" } })).toBeNull();
  });
  it("hides after Later or Skip, but never hides a running download", () => {
    expect(pillFor({ ...base, laterThisSession: true })).toBeNull();
    expect(pillFor({ ...base, skipped: "0.6.0" })).toBeNull();
    expect(pillFor({ ...base, laterThisSession: true,
      native: { ...idle, state: "downloading", bytes: 1, total: 2 } })?.kind).toBe("progress");
  });
  it("offers the new release, not a stale ready APK of an older one", () => {
    // 0.6.0 was downloaded and left; 0.6.1 is now the offer.
    expect(pillFor({ ...base, offered: "0.6.1",
      native: { ...idle, state: "ready", version: "0.6.0" } })).toEqual({ kind: "available" });
  });
  it("is never shown for a store-managed install", () => {
    expect(pillFor({ ...base, channel: "managed" })).toBeNull();
    expect(pillFor({ ...base, channel: "store-assisted" })).toEqual({ kind: "available" });
  });
});

describe("attentionDot", () => {
  it("marks Settings after Later, not after Skip, not when managed", () => {
    expect(attentionDot({ ...base, laterThisSession: true })).toBe(true);
    expect(attentionDot({ ...base, skipped: "0.6.0" })).toBe(false);
    expect(attentionDot({ ...base, channel: "managed" })).toBe(false);
    expect(attentionDot({ ...base, running: "0.6.0" })).toBe(false);
  });
});

describe("decideStart", () => {
  it("asks on mobile data by default, waits or starts per the setting", () => {
    expect(decideStart({ metered: false, pref: "ask" })).toBe("start");
    expect(decideStart({ metered: true, pref: "ask" })).toBe("ask");
    expect(decideStart({ metered: true, pref: "wifi" })).toBe("wait");
    expect(decideStart({ metered: true, pref: "always" })).toBe("start");
  });
});

describe("clearSkip", () => {
  it("clears a skip once something newer is offered or running", () => {
    expect(clearSkip("0.6.0", "0.6.1", "0.5.3")).toBe(true);
    expect(clearSkip("0.6.0", "0.6.0", "0.5.3")).toBe(false);
    expect(clearSkip("0.6.0", null, "0.6.0")).toBe(true);
  });
});
```

`androidUpdate.test.ts` drives the store with a mocked `invoke`. It must
prove:
- `startDownload` on a metered network with `pref: "ask"` opens sheet
  `"mobile"` and does **not** call `android_update_start`.
- `startDownload({ allowMetered: true })` calls `fetch_apk_details`, then
  `android_update_start` with that sha256 and size.
- When `canInstall` is false on `ready`, `install()` opens sheet
  `"permission"` instead of calling `android_update_install`.
- On a `store-assisted` channel, the primary action calls `open_store` with
  that package and never `android_update_start`.

Write each as `it(...)` with `vi.fn()` routing on the command name.

- [ ] **Step 2: FAIL. Step 3: Implement**

```ts
// add to src/store/updateFlow.ts (put the import with the file's other imports, at the top)
import { isNewerVersion } from "./updateVersion";

export type Pill =
  | { kind: "available" } | { kind: "progress"; pct: number } | { kind: "waiting" }
  | { kind: "ready" } | { kind: "failed" } | null;

interface FlowInput {
  offered: string | null; running: string; native: NativeStatus;
  skipped: string | undefined; laterThisSession: boolean; channel: AndroidChannel["kind"];
}

/** Everything is keyed on the RUNNING version: if Orion, Obtainium, F-Droid
 *  or adb already put the offered version (or newer) on the device, there is
 *  nothing to show, whatever state our own download was in. */
function pending({ offered, running }: FlowInput): boolean {
  return offered !== null && isNewerVersion(offered, running);
}

export function pillFor(i: FlowInput): Pill {
  if (!pending(i) || i.channel === "managed" || i.channel === "manual") return null;
  // A file for an OLDER offer (0.6.0 ready, 0.6.1 now published) is stale:
  // show the new offer, never an install of the superseded APK. The store's
  // offer() cancels it natively, which deletes the file.
  const stale = i.native.version !== undefined && i.native.version !== i.offered;
  switch (stale ? "idle" : i.native.state) {
    case "downloading":
    case "verifying":
      return { kind: "progress", pct: i.native.total ? Math.min(100, Math.floor((i.native.bytes / i.native.total) * 100)) : 0 };
    case "waiting": return { kind: "waiting" };
    case "ready":
    case "installing": return { kind: "ready" };
    case "failed": return { kind: "failed" };
    default:
      if (i.skipped === i.offered || i.laterThisSession) return null;
      return { kind: "available" };
  }
}

export function attentionDot(i: FlowInput): boolean {
  if (!pending(i) || i.channel === "managed" || i.channel === "manual") return false;
  return i.skipped !== i.offered;
}

export function decideStart({ metered, pref }: { metered: boolean; pref: "ask" | "always" | "wifi" }):
  "start" | "ask" | "wait" {
  if (!metered || pref === "always") return "start";
  return pref === "wifi" ? "wait" : "ask";
}

/** A skip covers one version only: clear it once the device is at or past
 *  it, or once something newer than it is offered. */
export function clearSkip(skipped: string | undefined, offered: string | null, running: string): boolean {
  if (!skipped) return false;
  const s = versionCode(skipped);
  return versionCode(running) >= s || (offered !== null && versionCode(offered) > s);
}
```

`src/store/androidUpdate.ts`: a module store in the style of
`src/store/downloadQueue.ts` (read its `subscribe`/`getState`/`setState`
shape first and copy it).
- **Polling:** `setInterval(500)` while
  `native.state ∈ {downloading, verifying, waiting, installing}` and
  `document.visibilityState === "visible"`. It refreshes `native` from
  `android_update_status`.
- **On `visibilitychange` → visible:** refresh once, and if sheet is
  `"permission"`, re-check `android_update_can_install`. When it becomes
  true, call `install()` automatically. This is the "Riwaq continues
  automatically" promise.
- **`offer(info)`:** also loads the notes once via `fetchNotes` (Task 7),
  and loads `install_source` → `androidChannel`. If `native.version` is set
  and differs from `info.version` while not downloading, call
  `android_update_cancel` (it deletes the stale file) before anything else.
  Add an `androidUpdate.test.ts` case for exactly that.
- **`useAndroidUpdate()`:** `useSyncExternalStore(subscribe, getState)`.

New tweaks in `types/reader.ts` with doc comments; `updateOverMobile: "ask"`
in `DEFAULT_TWEAKS`; `applyTweaks` already rejects wrong types. Add
`updateOverMobile` to the `heroStyle`-style value guard: accept only
`ask | always | wifi`.

- [ ] **Step 4: PASS. Step 5: Tamper**: drop the `!pending(i)` check in
`pillFor`; the "store updated it" test must fail. Restore.
- [ ] **Step 6: Commit**

```bash
git add src/store/androidUpdate.ts src/store/androidUpdate.test.ts
git commit -m "feat(android): the update flow's decisions and store, keyed on the running version" -- \
  src/store/updateFlow.ts src/store/updateFlow.test.ts src/store/androidUpdate.ts src/store/androidUpdate.test.ts \
  src/types/reader.ts src/hooks/useTweaks.ts
```

---

### Task 13: Android UI: pill, sheet, toasts, Settings dot and About card

**First:** invoke `ui-ux-pro-max`. Build to the approved
`update-flow.html`, step for step (17 steps in its map).

**Files:**
- Create: `src/components/update/UpdatePill.tsx`, `src/components/update/UpdateSheet.tsx`
- Create: `src/components/update/UpdateSheet.test.tsx`
- Modify: `src/App.tsx` (on Android, feed `update.info` into `offer()` and render pill + sheet; desktop keeps `UpdateBanner`)
- Modify: `src/components/library/MobileBottomNav.tsx` (dot on Settings)
- Modify: `src/components/SettingsPage.tsx` (About update card; "Over mobile data" row; managed-store line + Open button)
- Modify: i18n (all strings below)

**Strings** (en / ar). Copy exactly; they were approved in the mockup.
`{store}` is the store's label, `{mb}` is a number.

```
update.pill.available      "Update available · {v}"            "يتوفر تحديث · {v}"
update.pill.progress       "Downloading · {p}%"                 "جارٍ التنزيل · {p}٪"
update.pill.waiting        "Waiting for Wi-Fi · {v}"            "بانتظار Wi-Fi · {v}"
update.pill.ready          "Ready to install · {v}"             "جاهز للتثبيت · {v}"
update.pill.failed         "Download failed · Retry"            "فشل التنزيل · أعد المحاولة"
update.sheet.update        "Update · {mb} MB"                   "تحديث · {mb} م.ب"
update.sheet.inStore       "Update in {store}"                  "حدّث من {store}"
update.sheet.skip          "Skip this version"                  "تخطَّ هذا الإصدار"
update.mobile.warn         "You're on mobile data. This update is {mb} MB." "أنت متصل ببيانات الجوال، وحجم هذا التحديث {mb} م.ب."
update.mobile.wait         "Wait for Wi-Fi"                     "انتظر Wi-Fi"
update.mobile.anyway       "Update anyway"                      "حدّث على أي حال"
update.toast.later         "OK. It'll wait for you in Settings → About." "حسنًا، سيبقى بانتظارك في الإعدادات ← حول."
update.toast.show          "Show"                               "اعرض"
update.toast.skipped       "Riwaq won't remind you about {v}. You'll still hear about the next one." "لن يذكّرك رواق بالإصدار {v}، وسيخبرك بالإصدار التالي."
update.toast.undo          "Undo"                               "تراجع"
update.dl.title            "Downloading {v}…"                   "جارٍ تنزيل {v}…"
update.dl.of               "{a} of {b} MB"                      "{a} من {b} م.ب"
update.dl.keep             "Keep reading. It finishes in the background, and the pill shows progress." "تابع القراءة؛ يكتمل التنزيل في الخلفية وتعرض الشارة التقدّم."
update.dl.hide             "Hide"                               "إخفاء"
update.dl.cancel           "Cancel"                             "إلغاء"
update.perm.title          "One last step: allow updates"       "خطوة أخيرة: اسمح بالتحديثات"
update.perm.body           "Android asks once before an app can install its own updates. Turn on “Allow from this source”, then come back. Riwaq continues automatically." "يطلب Android مرة واحدة قبل أن يثبّت تطبيقٌ تحديثاته بنفسه. فعّل «السماح من هذا المصدر» ثم عُد، وسيكمل رواق تلقائيًا."
update.perm.open           "Open Android settings"              "افتح إعدادات Android"
update.ready.title         "Ready to install"                   "جاهز للتثبيت"
update.ready.body          "Downloaded and verified. Your books, highlights and progress stay exactly where they are." "تم التنزيل والتحقق منه. تبقى كتبك وتظليلاتك وتقدّمك كما هي تمامًا."
update.ready.install       "Install now"                        "ثبّت الآن"
update.fail.title          "The download didn't finish"         "لم يكتمل التنزيل"
update.fail.offline        "Your connection dropped at {p}%. Nothing was changed. Riwaq will pick up where it stopped." "انقطع الاتصال عند {p}٪. لم يتغيّر شيء، وسيكمل رواق من حيث توقف."
update.fail.checksum       "The file didn't match what was published, so it was deleted." "لم يطابق الملف ما نُشر، لذا حُذف."
update.fail.signature      "This file isn't a Riwaq update for this install, so it was deleted." "هذا الملف ليس تحديثًا لهذه النسخة من رواق، لذا حُذف."
update.fail.storage        "Not enough space: needs {mb} MB free."  "لا توجد مساحة كافية: يلزم {mb} م.ب."
update.fail.install        "Android couldn't install the update." "تعذّر على Android تثبيت التحديث."
update.fail.resume         "Resume download"                    "استأنف التنزيل"
update.fail.again          "Try again"                          "حاول مجددًا"
settings.updates.overMobile "Over mobile data"                  "عبر بيانات الجوال"
settings.updates.mobileAsk  "Ask first"                         "اسأل أولًا"
settings.updates.mobileAlways "Always"                          "دائمًا"
settings.updates.mobileWifi "Wait for Wi-Fi"                    "انتظر Wi-Fi"
settings.updates.managedBy  "Updates for this install come from {store}." "تصل تحديثات هذه النسخة من {store}."
settings.updates.yourStore  "your app store"                    "متجر التطبيقات"
settings.updates.openStore  "Open {store}"                      "افتح {store}"
settings.updates.github     "Download from GitHub"              "التنزيل من GitHub"
settings.updates.seeNew     "See what's new"                    "اعرض الجديد"
```

- [ ] **Step 1: Failing render tests** (`UpdateSheet.test.tsx`, happy-dom).
Feed the store fixed states and assert:
- The notes sheet shows the highlight, the `Update · 18.3 MB` label (size
  formatted to one decimal), and **Skip this version**.
- With `channel: store-assisted` (Orion), the primary label reads **Update
  in Orion Store** and clicking it calls `openStoreApp`.
- The `mobile` sheet shows the warning plus both buttons.
- The `failed` sheet with `error: "offline"` reads "dropped at 62%" for
  `bytes 62 / total 100`.
- Each of these in `ar` too, for one state at least (RTL text present).

- [ ] **Step 2: FAIL. Step 3: Implement.**
- `UpdatePill`: fixed above the bottom nav,
  `bottom: calc(76px + env(safe-area-inset-bottom))`, `zIndex: Z.banner`, a
  `button` element (44 px min height), `aria-live="polite"` text.
  `progress` draws a conic ring
  (`background: conic-gradient(currentColor ${pct}%, transparent 0)`).
  `failed` uses `theme.danger`.
- `UpdateSheet`: `MobileSheet` with `height` `"86%"` for notes,
  `"auto"`-like `"52%"` for the others. Its body switches on `sheet` and
  reuses `NotesView`.
- `MobileBottomNav`: read `attentionDot(...)` from `useAndroidUpdate()` and
  render a 9 px `#c4573a` dot with a 2 px `theme.bg` ring on the settings
  `NavIconButton`. Add `aria-label` text "Settings, update available" via
  an i18n key `sidebar.settingsUpdate` ("Settings, update available" /
  "الإعدادات، يتوفر تحديث").
- Settings → About:
  - When an offer is pending and the channel is in-app or store-assisted:
    the update card with version, date and size, a one-line summary (the
    highlight title, else the first item), **See what's new**
    (`openSheet("notes")`), and **Update**.
  - When managed: `settings.updates.managedBy` with the store label (or
    `yourStore`), plus `openStore` if the store is installed, else the
    `github` link.
  - The "Over mobile data" row is a `SegRow` of ask/always/wifi, Android
    only.
- `App.tsx`: if `platform() === "android"`, call `offer(update.info)` when
  `useUpdateCheck` yields info, and render `<UpdatePill/>` and
  `<UpdateSheet/>` instead of `<UpdateBanner/>`. Desktop is unchanged.

- [ ] **Step 4: PASS; `pnpm check`; screenshots of every step** in a plain
browser with a fake `invoke` (memory `browser-ui-verification`). Compare
each against the mockup in sepia/dark and en/ar, at 360×760 and at a tablet
width.
- [ ] **Step 5: Commit** (`git add` new files)

```bash
git commit -m "feat(android): the update pill, What's new sheet, and Settings card" -- \
  src/components/update/UpdatePill.tsx src/components/update/UpdateSheet.tsx src/components/update/UpdateSheet.test.tsx \
  src/App.tsx src/components/library/MobileBottomNav.tsx src/components/SettingsPage.tsx src/i18n/en.ts src/i18n/ar.ts
```

---

### Task 15: Desktop update leftovers (storage)

*Added 2026-10-02 (user: "updates must never grow the app"). Run after Task 13.*

**Files:**
- Create: `src-tauri/src/update_leftovers.rs`
- Modify: `src-tauri/src/lib.rs` (`mod update_leftovers;` + spawn at desktop setup)

**Interfaces:**
- Produces: `fn is_stale_leftover(name: &str, product: &str, running: &str) -> bool` (pure)
  and `pub fn sweep(dir: &Path, product: &str, running: &str) -> usize` (count removed).

Why: tauri-plugin-updater 2.11 on Windows writes the installer to
`%TEMP%\<productName>-<ver>-updater-XXXX\…-installer.exe` via `tempdir().keep()`,
then `std::process::exit(0)`, so it is never deleted (about 10 MB per update).

- [ ] **Step 1: Failing tests** (in the new module):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_only_our_updater_dirs_at_or_below_the_running_version() {
        assert!(is_stale_leftover("Riwaq-0.5.3-updater-a1B2c3", "Riwaq", "0.6.0"));
        assert!(is_stale_leftover("Riwaq-0.6.0-updater-zz", "Riwaq", "0.6.0"));
        // A NEWER version's folder may belong to an update in progress.
        assert!(!is_stale_leftover("Riwaq-0.6.1-updater-zz", "Riwaq", "0.6.0"));
        // Never touch anything that isn't ours by name.
        assert!(!is_stale_leftover("Other-0.5.3-updater-zz", "Riwaq", "0.6.0"));
        assert!(!is_stale_leftover("Riwaq-0.5.3-installer.exe", "Riwaq", "0.6.0"));
        assert!(!is_stale_leftover("Riwaq-x.y-updater-zz", "Riwaq", "0.6.0"));
    }
    #[test]
    fn sweep_removes_stale_dirs_and_keeps_the_rest() {
        let base = std::env::temp_dir().join(format!("riwaq-sweep-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        for d in ["Riwaq-0.5.3-updater-aa", "Riwaq-0.7.0-updater-bb", "Unrelated"] {
            std::fs::create_dir_all(base.join(d)).unwrap();
            std::fs::write(base.join(d).join("f.exe"), b"x").unwrap();
        }
        assert_eq!(sweep(&base, "Riwaq", "0.6.0"), 1);
        assert!(!base.join("Riwaq-0.5.3-updater-aa").exists());
        assert!(base.join("Riwaq-0.7.0-updater-bb").exists());
        assert!(base.join("Unrelated").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }
}
```

- [ ] **Step 2: Run it (`cargo test --lib update_leftovers`), FAIL.**
- [ ] **Step 3: Implement.** Parse `<product>-<a>.<b>.<c>-updater-<rest>`. Compare
  `a*1_000_000 + b*1_000 + c` against the running version. `sweep` only
  touches **directories** directly in `dir` that match, uses `remove_dir_all`,
  ignores errors per entry, and returns the count. In `lib.rs`'s desktop
  `setup` (`#[cfg(desktop)]`), spawn it on a background thread:
  `std::thread::spawn(move || update_leftovers::sweep(&std::env::temp_dir(),
  &product_name, &version))`. Nothing is awaited and it never gates first
  paint. Read `productName` from `app.config()` and the version from
  `app.package_info()`.
- [ ] **Step 4: PASS; tamper (make the comparison `<` instead of `<=`; the
  0.6.0 case must fail); `cargo check --lib`; `pnpm check`.**
- [ ] **Step 5: Commit** `fix(updater): clear the installer Windows leaves in %TEMP% after each update`.

---

### Task 16: Desktop update UI: the sidebar card

*Added 2026-10-02. The user chose placement **A** from the desktop mockups.
Spec section "Desktop: the same flow, in the sidebar". Run after Task 15.
Invoke `ui-ux-pro-max` first.*

**Files:**
- Create: `src/store/desktopUpdate.ts` (+ test). This is the desktop store,
  with the same shape as `androidUpdate.ts`: `subscribe`/`getState`/`useDesktopUpdate`.
- Create: `src/components/update/SidebarUpdateCard.tsx` (+ test)
- Modify: `src/components/update/DesktopNotesDialog.tsx`: add **Later**,
  **Skip this version**, and **Download** on the manual channel.
- Modify: `src/components/LibrarySidebar.tsx`: the card above Import, and
  the dot on Settings.
- Modify: `src/App.tsx`: desktop no longer renders `UpdateBanner`. It feeds
  `offer(info)` and `configure(...)` into the desktop store.
- Modify: `src/components/SettingsPage.tsx`: the About update card on desktop.
- Modify: i18n en + ar.
- Delete: `src/components/UpdateBanner.tsx` if nothing else uses it (grep first).

**Behaviour** (verbatim from the spec table):

- **States:** `available | downloading(bytes,total) | ready | failed(reason) |
  later | skipped`, plus channel `auto | manual | none` from `resolveCheck`.
- **Update** on the auto channel:
  - `const u = await check()` from `@tauri-apps/plugin-updater`.
  - `await u.download(ev => …)` tracks `Started.contentLength` and sums
    `Progress.chunkLength`.
  - The state becomes `ready`. **Restart now** calls `await u.install()`,
    then `relaunch()` from `@tauri-apps/plugin-process`. On Windows,
    `install()` exits the app itself.
  - Keep the `Update` object in module scope between download and install.
    If it is lost (the page reloaded), **Restart now** calls `check()`
    again and does `downloadAndInstall`.
- **Update** on the manual channel opens `RELEASES_PAGE_URL` through
  `plugin-opener`.
- **No Cancel on desktop.** The plugin cannot abort a download, so the
  progress dialog offers **Hide** only.
- **Failure** → `failed`, shown as a red card with **Try again**. The dialog
  adds **Download from GitHub**.
- **Later / Skip / Settings dot:** reuse `skippedUpdateVersion` and the
  `clearSkip` rule, using `versionCode` from `updateFlow.ts`.
- **The after-update screen** (Task 6) at desktop width uses a centred
  dialog, not `MobileSheet`. This closes the deferred minor from Task 6. Big
  releases keep `StoryPages`.
- **Strings:** reuse the existing `update.*` and `whatsNew.*` keys where the
  copy matches. New keys, en and ar exactly as in the approved mockup:
  - `update.card.available`: "Riwaq {v} is available" / "الإصدار {v} من رواق متاح"
  - `update.card.ready`: "Riwaq {v} is ready" / "رواق {v} جاهز"
  - `update.restart`: "Restart now" / "أعد التشغيل الآن"
  - `update.restartBody`: "Restart Riwaq to finish. Your books and progress stay exactly where they are." / "أعد تشغيل رواق لإكمال التحديث. تبقى كتبك وتقدّمك كما هي تمامًا."
  - `update.failDesktop`: "Nothing was changed. Check your connection and try again, or download it from GitHub." / "لم يتغيّر شيء. تحقّق من اتصالك وحاول مجددًا، أو نزّله من GitHub."
  - `update.manualBody`: "This install (.deb/.rpm) can't update itself. Download the new package and install it as usual." / "هذه النسخة (.deb/.rpm) لا تستطيع تحديث نفسها. نزّل الحزمة الجديدة وثبّتها كالمعتاد."
  - `update.keepReading`: "Keep reading. Riwaq tells you when it's ready." / "تابع القراءة؛ سيخبرك رواق عندما يجهز."
- **Tests** (happy-dom, mocked plugin modules):
  - The download progress maths.
  - `ready` only after `download` resolves.
  - **Restart now** calls `install` and then `relaunch`.
  - The manual channel never calls `check()`.
  - Skip hides the card and sets the tweak.
  - The dot shows after Later and not after Skip.
  - A failure shows **Try again**.
  - The Arabic strings render.
  - Tamper-check each guard.
- **Verify:** `pnpm check`, plus browser screenshots of every state (sepia,
  dark, en, ar).
- **Commit:** `feat(updater): the desktop update flow lives in the sidebar`.

---

### Task 14: End-to-end on the emulator, release-build JNI proof, docs

*Run LAST, after Tasks 15 and 16. Also prove the desktop flow once on macOS with the throwaway-key recipe from PR #166, and confirm no `Riwaq-*-updater-*` folders remain.*

**Files:**
- Modify: `docs/ANDROID.md`, `README.md` (Android: get updates), `docs/fdroid/README.md` (permission note), `docs/superpowers/specs/2026-10-02-android-in-app-updates-design.md` (results section)
- Create (scratch only, never commit): test configs and the local server dir under the session scratchpad

- [ ] **Step 1: Release-build JNI proof.** `pnpm android:build`, then
`pnpm verify:jni`. Every `AppUpdater` line must print `ok`. A `STRIPPED`
line means a missing `-keep` rule: fix it, don't ship.

- [ ] **Step 2: Two debug builds 0.6.90 → 0.6.91** (same debug key), each
with a `--config` that sets `version` and points `plugins.updater.endpoints`
at `http://127.0.0.1:8765/latest.json`. Run `adb reverse tcp:8765 tcp:8765`.
Debug builds must allow cleartext to 127.0.0.1. If they don't, add a
**debug-only** network security config under `src/debug/`, never in main.
Serve these from a scratch dir:
- `latest.json` (version 0.6.91),
- `whats-new.json` (a valid 0.6.91 notes file with a highlight image and
  stories),
- the image,
- `SHA256SUMS`,
- `app-universal-release.apk` (the 0.6.91 APK).

- [ ] **Step 3: Drive the whole flow** over CDP (memory
`android-webview-devtools`), screenshotting each state:
- pill → notes sheet (image shown) → Update
- → **kill the server at about 40%** → red pill → restart the server → Resume.
  The server log must show a `Range:` request continuing from the same offset.
- → first-time permission → Android settings → toggle → back. It continues
  automatically.
- → Android's dialog → Update → "installed · Open" notification
- → 0.6.91 opens, the story pages show once, and the library is intact
  (inject a test book first; memory `android-inject-test-book`)
- → `adb shell run-as com.riwaq.reader ls cache/updates` is empty.

- [ ] **Step 4: Store and failure cases**
- `adb install -i org.fdroid.fdroid` the 0.6.90 build: no pill, and About
  says "from F-Droid".
- `-i com.orion.store` (install any small APK as `com.orion.store` first, or
  accept "store not installed → in-app" and test the fallback): the pill
  shows **Update in Orion Store**.
- Tamper: serve an APK whose bytes differ from `SHA256SUMS` → "didn't match"
  → no Install button, cache empty.
- Store update mid-download: start the in-app download, then `adb install -r`
  the 0.6.91 APK. On relaunch: no pill, empty cache, What's new shown once.

- [ ] **Step 5: Decide** the `PackageReplacedReceiver` noise question (Task
11) from step 4's evidence, and apply the gate if needed.

- [ ] **Step 6: Docs**
- `README.md`: rewrite "Android: get updates automatically". Riwaq now
  updates itself in-app when installed from GitHub, and Obtainium, Orion and
  F-Droid users keep updating through their store.
- `docs/ANDROID.md`: the flow, the permission, where the cache lives.
- `docs/fdroid/README.md`: `REQUEST_INSTALL_PACKAGES` is declared but never
  used in F-Droid installs (installer detected); check the anti-features.
- Spec: append "Results" with what the emulator proved.

- [ ] **Step 7: Full gate**: `pnpm check`, `cd src-tauri && cargo test --lib
-- --include-ignored`. Then clean up every scratch install and `adb reverse`.

- [ ] **Step 8: Commit and open the PR** (base: `fix/update-check-cors`
until #166 merges, then `main`). No attribution lines.

```bash
git commit -m "docs(updater): Android in-app updates, store installs, and what the emulator proved" -- \
  docs/ANDROID.md README.md docs/fdroid/README.md docs/superpowers/specs/2026-10-02-android-in-app-updates-design.md
```
