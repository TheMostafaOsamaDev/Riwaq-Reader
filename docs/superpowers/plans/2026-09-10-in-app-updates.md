# In-App Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell every Riwaq user when a new version exists, and install it for them on the platforms where that is possible.

**Architecture:** One version check and one banner, with two strategies behind it. Installs that can self-update (Windows NSIS, macOS `.app.tar.gz`, Linux AppImage) go through `tauri-plugin-updater`. Installs that cannot (Android `.apk`, Linux `.deb`/`.rpm`) open the release page instead. Both read the same `latest.json`, so the two channels cannot drift apart.

**Tech Stack:** Tauri 2, React 19, TypeScript (strict, `noUnusedLocals`), Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-10-in-app-updates-design.md`

## Global Constraints

- **The updater private key is irreplaceable.** Its public half is compiled into every binary. Losing it means no existing desktop install can ever be updated again. Back it up with the Android keystore.
- **Never download or install without a tap.** Auto-check only; the user presses Update.
- **Throttle the check to once per 24 hours**, persisted.
- **A Settings toggle, default on**, disables the check entirely. "Check now" works regardless.
- **i18n parity is a compile error.** `src/i18n/ar.ts` is typed `Messages`, so every key added to `en.ts` must be added to `ar.ts` in the same commit.
- **TypeScript is strict with `noUnusedLocals`.** An unused import fails `pnpm build`.
- **Tests run under `environment: "node"`** (`vitest.config.ts`) — no DOM. Test pure logic, not components.
- **Endpoint:** `https://github.com/TheMostafaOsamaDev/Riwaq-Reader/releases/latest/download/latest.json`
- Verify with `pnpm test` and `pnpm build` (which runs `tsc`) before every commit.

---

### Task 1: Version comparison

The core decision — is the published version newer than ours? Pure, no I/O, no Tauri.

**Files:**
- Create: `src/store/updateVersion.ts`
- Test: `src/store/updateVersion.test.ts`

**Interfaces:**
- Produces: `isNewerVersion(latest: string, current: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/store/updateVersion.test.ts
import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./updateVersion";

describe("isNewerVersion", () => {
  it("sees a newer minor version", () => {
    expect(isNewerVersion("0.3.0", "0.2.0")).toBe(true);
  });

  it("sees a newer patch version", () => {
    expect(isNewerVersion("0.2.1", "0.2.0")).toBe(true);
  });

  it("does not offer an update for the same version", () => {
    expect(isNewerVersion("0.2.0", "0.2.0")).toBe(false);
  });

  it("never offers a downgrade", () => {
    // The updater only moves forward. If someone is running a build newer
    // than the published one, saying "update available" would loop them.
    expect(isNewerVersion("0.2.0", "0.3.0")).toBe(false);
  });

  it("compares numerically, not as strings", () => {
    // "10" < "9" as strings. This is the bug every hand-rolled semver has.
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
  });

  it("tolerates a leading v on either side", () => {
    // The manifest allows "v0.3.0"; getVersion() returns "0.3.0".
    expect(isNewerVersion("v0.3.0", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.3.0", "v0.2.0")).toBe(true);
  });

  it("treats a prerelease as older than its release", () => {
    expect(isNewerVersion("0.3.0-beta.1", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "0.3.0-beta.1")).toBe(true);
  });

  it("refuses to offer an update on malformed input", () => {
    // A truncated download or an HTML error page must not be read as a
    // version. Failing closed means "no update", never a bogus one.
    expect(isNewerVersion("", "0.2.0")).toBe(false);
    expect(isNewerVersion("not-a-version", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "")).toBe(false);
    expect(isNewerVersion("<!DOCTYPE html>", "0.2.0")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm exec vitest run src/store/updateVersion.test.ts`
Expected: FAIL — `Failed to resolve import "./updateVersion"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/store/updateVersion.ts

/** Parse `major.minor.patch` with an optional leading `v` and an optional
 *  prerelease suffix. Null for anything else — a truncated download or an
 *  HTML error page must never parse as a version. */
function parse(
  v: string,
): { parts: [number, number, number]; prerelease: boolean } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return {
    parts: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] !== undefined,
  };
}

/** Is `latest` a version we should offer to move to from `current`?
 *
 *  Fails CLOSED: anything unparseable returns false. The cost of a missed
 *  update is one more launch; the cost of a bogus one is a user chasing a
 *  version that does not exist. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  }
  // Same numbers: a prerelease is older than its release, and never newer.
  return b.prerelease && !a.prerelease;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm exec vitest run src/store/updateVersion.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/updateVersion.ts src/store/updateVersion.test.ts
git commit -m "feat(updates): compare versions, failing closed on anything unparseable"
```

---

### Task 2: Which channel this install is on

Decides whether the banner offers to install or to open a download page. Pure — the platform facts are injected so the test can drive every combination.

**Files:**
- Create: `src/store/updateChannel.ts`
- Test: `src/store/updateChannel.test.ts`

**Interfaces:**
- Produces: `type UpdateChannel = "auto" | "manual"`, `resolveChannel(env: ChannelEnv): UpdateChannel`, `interface ChannelEnv { os: string; isAppImage: boolean }`

- [ ] **Step 1: Write the failing test**

```ts
// src/store/updateChannel.test.ts
import { describe, expect, it } from "vitest";
import { resolveChannel } from "./updateChannel";

// tauri-plugin-updater supports Windows, macOS and Linux-as-AppImage. It does
// not support Android at all, and on Linux it replaces the running executable
// in place — which for a .deb/.rpm install is a root-owned path under
// /usr/bin. Those installs must be offered a download, not a broken button.
describe("resolveChannel", () => {
  it("self-updates on Windows", () => {
    expect(resolveChannel({ os: "windows", isAppImage: false })).toBe("auto");
  });

  it("self-updates on macOS", () => {
    expect(resolveChannel({ os: "macos", isAppImage: false })).toBe("auto");
  });

  it("self-updates on Linux when running as an AppImage", () => {
    expect(resolveChannel({ os: "linux", isAppImage: true })).toBe("auto");
  });

  it("falls back to manual for a Linux package install", () => {
    // .deb / .rpm — the executable lives under /usr/bin and is root-owned.
    expect(resolveChannel({ os: "linux", isAppImage: false })).toBe("manual");
  });

  it("falls back to manual on Android", () => {
    // The plugin is not even compiled into the Android build.
    expect(resolveChannel({ os: "android", isAppImage: false })).toBe("manual");
  });

  it("falls back to manual on an unrecognised platform", () => {
    // iOS, or an OS string we have not seen. Offering an install we cannot
    // perform is worse than offering a link.
    expect(resolveChannel({ os: "ios", isAppImage: false })).toBe("manual");
    expect(resolveChannel({ os: "", isAppImage: false })).toBe("manual");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm exec vitest run src/store/updateChannel.test.ts`
Expected: FAIL — `Failed to resolve import "./updateChannel"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/store/updateChannel.ts

/** "auto" installs through tauri-plugin-updater; "manual" opens the release
 *  page and lets the user install by hand. */
export type UpdateChannel = "auto" | "manual";

export interface ChannelEnv {
  /** From `@tauri-apps/plugin-os` `type()`: "windows" | "macos" | "linux" |
   *  "android" | "ios". */
  os: string;
  /** Linux only: is this process running from an AppImage? */
  isAppImage: boolean;
}

/** Can this install replace itself?
 *
 *  Allow-list, not deny-list: an OS we do not recognise gets the manual
 *  channel, because offering an install we cannot perform is worse than
 *  offering a link. */
export function resolveChannel({ os, isAppImage }: ChannelEnv): UpdateChannel {
  if (os === "windows" || os === "macos") return "auto";
  if (os === "linux") return isAppImage ? "auto" : "manual";
  return "manual";
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm exec vitest run src/store/updateChannel.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/updateChannel.ts src/store/updateChannel.test.ts
git commit -m "feat(updates): route each install to the channel it can actually use"
```

---

### Task 3: The 24-hour throttle

Keeps launch from becoming a network request every time, and keeps "Check now" working anyway.

**Files:**
- Create: `src/store/updateThrottle.ts`
- Test: `src/store/updateThrottle.test.ts`

**Interfaces:**
- Produces: `CHECK_INTERVAL_MS: number`, `shouldCheck(opts: { enabled: boolean; lastCheck: number | undefined; now: number; manual: boolean }): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/store/updateThrottle.test.ts
import { describe, expect, it } from "vitest";
import { CHECK_INTERVAL_MS, shouldCheck } from "./updateThrottle";

const DAY = CHECK_INTERVAL_MS;

describe("shouldCheck", () => {
  it("checks on a first launch that has never checked", () => {
    expect(shouldCheck({ enabled: true, lastCheck: undefined, now: 1_000, manual: false }))
      .toBe(true);
  });

  it("does not check again within the interval", () => {
    expect(shouldCheck({ enabled: true, lastCheck: 1_000, now: 1_000 + DAY - 1, manual: false }))
      .toBe(false);
  });

  it("checks once the interval has elapsed", () => {
    expect(shouldCheck({ enabled: true, lastCheck: 1_000, now: 1_000 + DAY, manual: false }))
      .toBe(true);
  });

  it("never checks automatically when the setting is off", () => {
    expect(shouldCheck({ enabled: false, lastCheck: undefined, now: 1_000, manual: false }))
      .toBe(false);
  });

  it("honours an explicit Check now even when the setting is off", () => {
    // The toggle governs BACKGROUND checks. Pressing the button is consent.
    expect(shouldCheck({ enabled: false, lastCheck: 1_000, now: 1_001, manual: true }))
      .toBe(true);
  });

  it("honours an explicit Check now inside the throttle window", () => {
    expect(shouldCheck({ enabled: true, lastCheck: 1_000, now: 1_001, manual: true }))
      .toBe(true);
  });

  it("checks when the stored timestamp is in the future", () => {
    // A clock change or an edited settings file must not wedge the check
    // forever. Treat a future timestamp as "never checked".
    expect(shouldCheck({ enabled: true, lastCheck: 9_000_000, now: 1_000, manual: false }))
      .toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm exec vitest run src/store/updateThrottle.test.ts`
Expected: FAIL — `Failed to resolve import "./updateThrottle"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/store/updateThrottle.ts

/** How long to wait between background checks. Once a day is enough for an
 *  app that ships every few weeks, and keeps launch off the network. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Should we hit the network now?
 *
 *  `manual` is the "Check now" button, which bypasses both the toggle and the
 *  throttle: pressing it IS the consent the toggle otherwise withholds. */
export function shouldCheck({
  enabled,
  lastCheck,
  now,
  manual,
}: {
  enabled: boolean;
  lastCheck: number | undefined;
  now: number;
  manual: boolean;
}): boolean {
  if (manual) return true;
  if (!enabled) return false;
  if (lastCheck === undefined) return true;
  // A timestamp in the future means a clock change or an edited file. Treat
  // it as never-checked rather than letting it block checks indefinitely.
  if (lastCheck > now) return true;
  return now - lastCheck >= CHECK_INTERVAL_MS;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm exec vitest run src/store/updateThrottle.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/updateThrottle.ts src/store/updateThrottle.test.ts
git commit -m "feat(updates): throttle the background check to once a day"
```

---

### Task 4: Reading the manifest

Fetches `latest.json` and turns it into an answer, reusing Tasks 1–3. This is the only piece that touches the network.

**Files:**
- Create: `src/store/updates.ts`
- Test: `src/store/updates.test.ts`

**Interfaces:**
- Consumes: `isNewerVersion` (Task 1), `resolveChannel`/`UpdateChannel` (Task 2)
- Produces: `MANIFEST_URL: string`, `RELEASES_PAGE_URL: string`, `interface UpdateInfo { version: string; notes?: string; channel: UpdateChannel }`, `fetchManifestVersion(fetchImpl: typeof fetch): Promise<{ version: string; notes?: string } | null>`, `evaluateUpdate(opts): UpdateInfo | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/store/updates.test.ts
import { describe, expect, it } from "vitest";
import { evaluateUpdate, fetchManifestVersion } from "./updates";

const ok = (body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("fetchManifestVersion", () => {
  it("reads the version and notes from a well-formed manifest", async () => {
    const r = await fetchManifestVersion(
      ok({ version: "0.3.0", notes: "Faster covers", platforms: {} }),
    );
    expect(r).toEqual({ version: "0.3.0", notes: "Faster covers" });
  });

  it("returns null on a non-200", async () => {
    const fail = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchManifestVersion(fail)).toBeNull();
  });

  it("returns null when the body is not JSON", async () => {
    // A captive portal or a GitHub error page returns HTML with a 200.
    const html = (async () =>
      new Response("<!DOCTYPE html>", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchManifestVersion(html)).toBeNull();
  });

  it("returns null when the manifest has no version", async () => {
    expect(await fetchManifestVersion(ok({ platforms: {} }))).toBeNull();
  });

  it("returns null when the network throws", async () => {
    // Offline is the normal case for this app. It must not surface an error.
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchManifestVersion(boom)).toBeNull();
  });
});

describe("evaluateUpdate", () => {
  it("offers an update on the auto channel", () => {
    expect(
      evaluateUpdate({
        latest: { version: "0.3.0", notes: "n" },
        current: "0.2.0",
        env: { os: "macos", isAppImage: false },
      }),
    ).toEqual({ version: "0.3.0", notes: "n", channel: "auto" });
  });

  it("offers an update on the manual channel for Android", () => {
    expect(
      evaluateUpdate({
        latest: { version: "0.3.0" },
        current: "0.2.0",
        env: { os: "android", isAppImage: false },
      }),
    ).toEqual({ version: "0.3.0", notes: undefined, channel: "manual" });
  });

  it("offers nothing when already current", () => {
    expect(
      evaluateUpdate({
        latest: { version: "0.2.0" },
        current: "0.2.0",
        env: { os: "windows", isAppImage: false },
      }),
    ).toBeNull();
  });

  it("offers nothing when the fetch failed", () => {
    expect(
      evaluateUpdate({
        latest: null,
        current: "0.2.0",
        env: { os: "windows", isAppImage: false },
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm exec vitest run src/store/updates.test.ts`
Expected: FAIL — `Failed to resolve import "./updates"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/store/updates.ts
//
// The one network request Riwaq makes on its own behalf. It is a single
// unauthenticated GET for a static file: no identifiers, no library contents,
// no reading data. The Settings toggle turns it off entirely, and the app is
// fully functional without it.

import { isNewerVersion } from "./updateVersion";
import { resolveChannel, type ChannelEnv, type UpdateChannel } from "./updateChannel";

const REPO = "https://github.com/TheMostafaOsamaDev/Riwaq-Reader";

/** `/releases/latest/` always resolves to the newest PUBLISHED, non-prerelease
 *  release, so a draft release changes nothing until it is published. */
export const MANIFEST_URL = `${REPO}/releases/latest/download/latest.json`;

/** Where the manual channel sends people. */
export const RELEASES_PAGE_URL = `${REPO}/releases/latest`;

export interface UpdateInfo {
  version: string;
  notes?: string;
  channel: UpdateChannel;
}

/** GET the manifest and read its version. Null on any failure — offline is
 *  the normal case for an offline-first reader, and must never surface as an
 *  error the user has to dismiss. */
export async function fetchManifestVersion(
  fetchImpl: typeof fetch,
): Promise<{ version: string; notes?: string } | null> {
  try {
    const res = await fetchImpl(MANIFEST_URL);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return null;
    const { version, notes } = body as { version?: unknown; notes?: unknown };
    if (typeof version !== "string" || version === "") return null;
    return { version, notes: typeof notes === "string" ? notes : undefined };
  } catch {
    return null;
  }
}

/** Turn a fetched manifest into an offer, or nothing. */
export function evaluateUpdate({
  latest,
  current,
  env,
}: {
  latest: { version: string; notes?: string } | null;
  current: string;
  env: ChannelEnv;
}): UpdateInfo | null {
  if (!latest) return null;
  if (!isNewerVersion(latest.version, current)) return null;
  return {
    version: latest.version,
    notes: latest.notes,
    channel: resolveChannel(env),
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm exec vitest run src/store/updates.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/updates.ts src/store/updates.test.ts
git commit -m "feat(updates): read the release manifest, failing silently when offline"
```

---

### Task 5: The updater plugin and its permissions

Wiring only — no behaviour yet. Kept separate so a reviewer can judge the dependency and capability changes on their own.

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src-tauri/Cargo.toml` (after the existing `cfg(not(any(target_os = "android", target_os = "ios")))` block at line 70)
- Modify: `src-tauri/tauri.conf.json` (add `plugins`, drop the MSI target)
- Modify: `src-tauri/capabilities/default.json` (add `updater:default`)
- Modify: `src-tauri/src/lib.rs` (register the plugin, desktop-only)

- [ ] **Step 1: Add the JS dependency**

```bash
pnpm add @tauri-apps/plugin-updater
```

- [ ] **Step 2: Add the Rust dependency, desktop-only**

In `src-tauri/Cargo.toml`, find the existing block:

```toml
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-single-instance = "2"
```

and add the updater to it, with a comment:

```toml
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-single-instance = "2"
# The updater does not support Android or iOS — the plugin itself excludes
# those targets. Android takes the manual channel (see src/store/updates.ts),
# so this must stay inside the desktop-only block or the Android build breaks.
tauri-plugin-updater = "2"
```

- [ ] **Step 3: Register the plugin, desktop-only**

In `src-tauri/src/lib.rs`, inside the builder chain, add a `#[cfg]`-guarded registration next to the existing single-instance registration:

```rust
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
```

Match the surrounding style — if the existing single-instance plugin is registered with a different pattern, follow that pattern instead.

- [ ] **Step 4: Add the capability**

In `src-tauri/capabilities/default.json`, add `"updater:default"` to the `permissions` array, after `"os:default"`.

- [ ] **Step 5: Configure the plugin and drop MSI**

In `src-tauri/tauri.conf.json`, add a top-level `plugins` key (sibling of `app` and `bundle`). Leave `pubkey` as an empty string for now — Task 10 fills it in from the generated key:

```json
  "plugins": {
    "updater": {
      "pubkey": "",
      "endpoints": [
        "https://github.com/TheMostafaOsamaDev/Riwaq-Reader/releases/latest/download/latest.json"
      ]
    }
  }
```

Then change `bundle.targets` from `"all"` to an explicit list that excludes MSI. The spec's reasoning: one manifest URL per platform means an MSI user updated via NSIS ends up with two installs.

```json
    "targets": ["deb", "rpm", "appimage", "nsis", "app", "dmg"]
```

- [ ] **Step 6: Verify it all still builds**

Run: `pnpm build && cd src-tauri && cargo check && cd ..`
Expected: both clean. If `cargo check` fails on the plugin registration, fix the builder syntax to match the surrounding code before continuing.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/src/lib.rs
git commit -m "build(updates): add the updater plugin on desktop, and drop the MSI target"
```

---

### Task 6: The settings

The toggle and its persistence, before any UI depends on them.

**Files:**
- Modify: `src/types/reader.ts` (the `Tweaks` interface)
- Modify: `src/hooks/useTweaks.ts` (`DEFAULT_TWEAKS`)
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Produces: `Tweaks.autoCheckUpdates: boolean`, `Tweaks.lastUpdateCheck?: number`

- [ ] **Step 1: Add the fields to the Tweaks type**

In `src/types/reader.ts`, after `confirmDelete: boolean;`:

```ts
  /** Check GitHub for a new version on launch, at most once a day. The one
   *  network request Riwaq makes on its own behalf; off here stops it
   *  entirely. "Check now" in Settings still works. */
  autoCheckUpdates: boolean;
  /** Epoch ms of the last completed check, for the 24h throttle. */
  lastUpdateCheck?: number;
```

- [ ] **Step 2: Add the default**

In `src/hooks/useTweaks.ts`, in `DEFAULT_TWEAKS`, after `confirmDelete: true,`:

```ts
  autoCheckUpdates: true,
```

Do not default `lastUpdateCheck` — `undefined` means "never checked", which `shouldCheck` already handles.

- [ ] **Step 3: Add the strings to en.ts**

In `src/i18n/en.ts`, near the other `settings.*` keys:

```ts
  "settings.updates": "Check for updates",
  "settings.updates.hint":
    "Asks GitHub once a day whether a newer Riwaq exists. Nothing about you or your books is sent, and nothing is downloaded until you tap Update.",
  "settings.updates.checkNow": "Check now",
  "settings.updates.checking": "Checking…",
  "settings.updates.upToDate": "Riwaq is up to date",
  "update.available": "Riwaq {v} is available",
  "update.action.install": "Update",
  "update.action.download": "Download",
  "update.action.later": "Later",
  "update.downloading": "Downloading…",
  "update.installing": "Installing…",
  "update.failed": "Update failed. Try downloading it instead.",
```

- [ ] **Step 4: Add the same keys to ar.ts**

In `src/i18n/ar.ts`, in the same relative position:

```ts
  "settings.updates": "التحقق من التحديثات",
  "settings.updates.hint":
    "يسأل GitHub مرة واحدة يوميًا عمّا إذا كان هناك إصدار أحدث من رواق. لا يُرسَل أي شيء عنك أو عن كتبك، ولا يُنزَّل شيء حتى تضغط تحديث.",
  "settings.updates.checkNow": "تحقق الآن",
  "settings.updates.checking": "جارٍ التحقق…",
  "settings.updates.upToDate": "رواق محدَّث",
  "update.available": "الإصدار {v} من رواق متاح",
  "update.action.install": "تحديث",
  "update.action.download": "تنزيل",
  "update.action.later": "لاحقًا",
  "update.downloading": "جارٍ التنزيل…",
  "update.installing": "جارٍ التثبيت…",
  "update.failed": "تعذّر التحديث. جرّب تنزيله بدلًا من ذلك.",
```

- [ ] **Step 5: Verify parity compiles**

Run: `pnpm build`
Expected: clean. A key present in `en.ts` but missing from `ar.ts` fails here, because `ar` is typed `Messages`.

- [ ] **Step 6: Commit**

```bash
git add src/types/reader.ts src/hooks/useTweaks.ts src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(updates): add the update-check setting and its strings"
```

---

### Task 7: The check hook

Binds the pure pieces to the real platform and to settings.

**Files:**
- Create: `src/hooks/useUpdateCheck.ts`
- Modify: `src/App.tsx` (call the hook, render the banner from Task 8)

**Interfaces:**
- Consumes: `shouldCheck`, `CHECK_INTERVAL_MS` (Task 3); `fetchManifestVersion`, `evaluateUpdate`, `UpdateInfo`, `RELEASES_PAGE_URL` (Task 4); `Tweaks.autoCheckUpdates`, `Tweaks.lastUpdateCheck` (Task 6)
- Produces: `useUpdateCheck(t: Tweaks, setTweak): { info: UpdateInfo | null; checking: boolean; check: () => void; dismiss: () => void }`

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useUpdateCheck.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Tweaks } from "../types/reader";
import { shouldCheck } from "../store/updateThrottle";
import {
  evaluateUpdate,
  fetchManifestVersion,
  type UpdateInfo,
} from "../store/updates";

/** Ask the platform what it is. Both imports are dynamic so the Android
 *  bundle never pulls in a desktop-only path, and so a failure here degrades
 *  to the manual channel rather than throwing during launch. */
async function readEnv(): Promise<{ os: string; isAppImage: boolean }> {
  try {
    const { type } = await import("@tauri-apps/plugin-os");
    const os = type();
    // Tauri's Linux updater replaces the running executable in place, which
    // only works for an AppImage. The AppImage runtime sets APPIMAGE in the
    // process environment; anything else is a .deb/.rpm install.
    let isAppImage = false;
    if (os === "linux") {
      const { env } = await import("@tauri-apps/plugin-os");
      isAppImage = Boolean((env as unknown as () => Record<string, string>)()?.APPIMAGE);
    }
    return { os, isAppImage };
  } catch {
    return { os: "", isAppImage: false };
  }
}

export function useUpdateCheck(
  t: Tweaks,
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void,
) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // A ref, not state: two checks must not overlap, and the guard has to be
  // set synchronously or a double render starts two fetches.
  const inFlight = useRef(false);

  const run = useCallback(
    async (manual: boolean) => {
      if (inFlight.current) return;
      if (
        !shouldCheck({
          enabled: t.autoCheckUpdates,
          lastCheck: t.lastUpdateCheck,
          now: Date.now(),
          manual,
        })
      ) {
        return;
      }
      inFlight.current = true;
      setChecking(true);
      try {
        const [latest, env, current] = await Promise.all([
          fetchManifestVersion(fetch),
          readEnv(),
          import("@tauri-apps/api/app").then((m) => m.getVersion()).catch(() => ""),
        ]);
        setInfo(evaluateUpdate({ latest, current, env }));
        setTweak("lastUpdateCheck", Date.now());
      } finally {
        inFlight.current = false;
        setChecking(false);
      }
    },
    [t.autoCheckUpdates, t.lastUpdateCheck, setTweak],
  );

  // Launch check. Deliberately depends on nothing that changes, so it runs
  // once per session; the throttle inside `run` is what limits it further.
  useEffect(() => {
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    info: dismissed ? null : info,
    checking,
    check: useCallback(() => void run(true), [run]),
    dismiss: useCallback(() => setDismissed(true), []),
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: clean. If `@tauri-apps/plugin-os` has no `env` export, replace the AppImage detection with the `os` plugin's actual API — the fallback (`isAppImage: false`) is safe, it just routes AppImage users to the manual channel, which Task 12's spike will catch.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useUpdateCheck.ts
git commit -m "feat(updates): check for a new version once per session, off the launch path"
```

---

### Task 8: The banner

One component, both channels.

**Files:**
- Create: `src/components/UpdateBanner.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `UpdateInfo`, `RELEASES_PAGE_URL` (Task 4)

- [ ] **Step 1: Write the component**

```tsx
// src/components/UpdateBanner.tsx
import { useState } from "react";
import type { Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import { Button } from "./Button";
import { RELEASES_PAGE_URL, type UpdateInfo } from "../store/updates";

type Phase = "idle" | "working" | "failed";

/** The single piece of update UI. On the auto channel it installs and
 *  relaunches; on the manual channel it opens the release page and the user
 *  installs by hand. Same banner either way, so there is one thing to
 *  translate, style and test. */
export function UpdateBanner({
  info,
  theme,
  onDismiss,
}: {
  info: UpdateInfo;
  theme: Theme;
  onDismiss: () => void;
}) {
  const { tr } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");

  async function act() {
    setPhase("working");
    try {
      if (info.channel === "manual") {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(RELEASES_PAGE_URL);
        onDismiss();
        return;
      }
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setPhase("failed");
        return;
      }
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      // Never leave the user stuck on a spinner: fall back to the link.
      setPhase("failed");
    }
  }

  const label =
    phase === "working"
      ? tr(info.channel === "auto" ? "update.downloading" : "update.installing")
      : info.channel === "auto"
        ? tr("update.action.install")
        : tr("update.action.download");

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        insetInlineStart: 16,
        insetInlineEnd: 16,
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        zIndex: 9000,
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "12px 14px",
        borderRadius: 12,
        // `chrome` is the opaque surface token; there is no `surface`/`accent`
        // in Theme. Colour comes from Button's own variants.
        background: theme.chrome,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        boxShadow: "0 10px 34px rgba(0,0,0,0.28)",
      }}
    >
      <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
        {phase === "failed"
          ? tr("update.failed")
          : tr("update.available", { v: info.version })}
      </span>
      <Button theme={theme} variant="ghost" size="sm" onClick={onDismiss}>
        {tr("update.action.later")}
      </Button>
      <Button
        theme={theme}
        variant="primary"
        size="sm"
        loading={phase === "working"}
        disabled={phase === "working"}
        onClick={act}
      >
        {label}
      </Button>
    </div>
  );
}
```

`Theme` has no `accent`, `primary` or `surface` — the real tokens are `bg`,
`paper`, `ink`, `muted`, `rule`, `ruleStrong`, `chrome`, `chromeGlass`,
`chromeInk`, `hover`, `chromeHover`, `danger`. Colour for the actions comes
from `Button`'s own `variant`, which also supplies hover, press and the
44px touch target, so nothing here hand-rolls a button.

- [ ] **Step 2: Add the process plugin (needed for relaunch)**

```bash
pnpm add @tauri-apps/plugin-process
```

In `src-tauri/Cargo.toml`, inside the same desktop-only target block as the updater:

```toml
tauri-plugin-process = "2"
```

Register it in `src-tauri/src/lib.rs` next to the updater, and add `"process:default"` to `src-tauri/capabilities/default.json`.

- [ ] **Step 3: Mount it in App.tsx**

In `src/App.tsx`, call the hook near the other top-level hooks and render the banner inside the existing top-level `return (` at line 736, as the last child so it overlays everything:

```tsx
  const update = useUpdateCheck(t, setTweak);
```

```tsx
      {update.info && (
        <UpdateBanner
          info={update.info}
          theme={theme}
          onDismiss={update.dismiss}
        />
      )}
```

`useTweaks()` returns a **tuple**, `[t, setTweak, applyTweaks] as const`, so
`App.tsx` already has `t` and `setTweak` in scope under those names — pass them
straight through.

- [ ] **Step 4: Verify**

Run: `pnpm build && pnpm test`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/UpdateBanner.tsx src/App.tsx package.json pnpm-lock.yaml \
        src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs \
        src-tauri/capabilities/default.json
git commit -m "feat(updates): one banner for both the automatic and manual channels"
```

---

### Task 9: Settings UI

**Files:**
- Modify: `src/components/SettingsPage.tsx`

- [ ] **Step 1: Add the entry to the `about` category**

In `src/components/SettingsPage.tsx`, in `entriesByCat`, add to the `about` array after the `about-info` entry, following the exact shape used by the `wifiOnly` entry at lines ~249–266:

```tsx
      {
        id: "updates",
        label: tr("settings.updates"),
        node: (
          <Field label={tr("settings.updates")} theme={theme}>
            <SegRow<"on" | "off">
              theme={theme}
              value={t.autoCheckUpdates ? "on" : "off"}
              onChange={(v) => setTweak("autoCheckUpdates", v === "on")}
              options={[
                { value: "on", label: tr("settings.on") },
                { value: "off", label: tr("settings.off") },
              ]}
            />
            <p style={{ margin: "8px 2px 0", fontSize: 10.5, color: theme.muted, lineHeight: 1.5 }}>
              {tr("settings.updates.hint")}
            </p>
          </Field>
        ),
      },
```

- [ ] **Step 2: Add the "Check now" button**

The spec requires a manual check that works even with the toggle off — pressing
it is the consent the toggle withholds, which `shouldCheck` already implements
via its `manual` flag. `SettingsPage` needs the hook's `check` and `checking`;
thread them in from `App.tsx` as props rather than calling the hook twice, or
the page would run its own independent check.

Add below the toggle, inside the same `Field`:

```tsx
            <div style={{ marginTop: 10 }}>
              <Button
                theme={theme}
                variant="secondary"
                size="sm"
                loading={updateChecking}
                disabled={updateChecking}
                onClick={onCheckUpdates}
              >
                {updateChecking
                  ? tr("settings.updates.checking")
                  : tr("settings.updates.checkNow")}
              </Button>
            </div>
```

Add `onCheckUpdates: () => void` and `updateChecking: boolean` to
`SettingsPage`'s props, pass them from `App.tsx` as `update.check` and
`update.checking`, and import `Button` from `./Button` if it is not already
imported there.

- [ ] **Step 3: Verify**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsPage.tsx src/App.tsx
git commit -m "feat(updates): expose the update toggle and a manual check in Settings"
```

---

### Task 10: Generate and store the signing key

**This task produces an irreplaceable secret. Read the whole task before starting.**

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`)
- Modify: `docs/ANDROID.md` is not the right home — create `docs/RELEASING.md`

- [ ] **Step 1: Generate the keypair**

Run in your own terminal, choosing your own password:

```bash
pnpm tauri signer generate -w ~/.tauri/riwaq-updater.key
```

- [ ] **Step 2: Back it up before going further**

Put `~/.tauri/riwaq-updater.key` and its password wherever the Android release keystore lives. **Losing this file means every existing desktop install can never be updated again** — they only accept payloads signed by the public key already compiled into them. There is no recovery short of every user reinstalling by hand.

- [ ] **Step 3: Put the public key in the config**

Copy the printed public key into `src-tauri/tauri.conf.json` at `plugins.updater.pubkey` (the key content itself, not a path).

- [ ] **Step 4: Add the CI secrets**

In GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the contents of `~/.tauri/riwaq-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password chosen in Step 1 |

- [ ] **Step 5: Write `docs/RELEASING.md`**

Document: both irreplaceable keys and where they live; the four Android secrets and two updater secrets; the draft-release verification step; and — most importantly — that **rollback is forward-only**: un-shipping a bad 0.3.0 means publishing 0.3.1 with the reverted code, because clients already on 0.3.0 will never downgrade.

- [ ] **Step 6: Commit (the public key only — never the private one)**

```bash
git status   # confirm no .key file is staged; .gitignore covers .tauri/
git add src-tauri/tauri.conf.json docs/RELEASING.md
git commit -m "build(updates): embed the update signing public key, and document releasing"
```

---

### Task 11: CI — sign, generate the manifest, and guard it

**Files:**
- Create: `scripts/verify-update-manifest.sh`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write the guard**

```bash
#!/usr/bin/env bash
#
# Refuse to publish an update manifest that would strand a platform.
#
# A latest.json that silently omits linux-aarch64 produces no error anywhere:
# those users simply never see an update again. Same for an empty signature
# string, which the client rejects at install time, long after the release.
#
# Usage: verify-update-manifest.sh latest.json <expected-version>

set -euo pipefail

MANIFEST="${1:?usage: verify-update-manifest.sh latest.json <version>}"
EXPECTED="${2:?usage: verify-update-manifest.sh latest.json <version>}"

REQUIRED=(darwin-x86_64 darwin-aarch64 windows-x86_64 windows-aarch64 linux-x86_64 linux-aarch64)

fail() { echo "verify-update-manifest: $*" >&2; exit 1; }

command -v jq >/dev/null || fail "jq is required"
[ -f "$MANIFEST" ] || fail "no manifest at $MANIFEST"

version="$(jq -r '.version // empty' "$MANIFEST")"
[ -n "$version" ] || fail "manifest has no version"
[ "$version" = "${EXPECTED#v}" ] \
  || fail "manifest version '$version' does not match the tag '${EXPECTED#v}'"

for key in "${REQUIRED[@]}"; do
  url="$(jq -r --arg k "$key" '.platforms[$k].url // empty' "$MANIFEST")"
  sig="$(jq -r --arg k "$key" '.platforms[$k].signature // empty' "$MANIFEST")"
  [ -n "$url" ] || fail "missing url for $key — those users would never see an update"
  [ -n "$sig" ] || fail "empty signature for $key — the client will reject the install"
done

echo "verify-update-manifest: $version covers all ${#REQUIRED[@]} platforms"
```

Then `chmod +x scripts/verify-update-manifest.sh`.

- [ ] **Step 2: Sign the bundles in CI**

Add to the `env:` of the build step in each of the five desktop jobs (`linux`, `linux-arm64`, `windows`, `windows-arm64`, `macos`):

```yaml
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

- [ ] **Step 3: Add a manifest job**

A new job after `macos`, with `needs: [linux, linux-arm64, windows, windows-arm64, macos]`, that downloads the five jobs' artifacts, reads each `.sig` file's contents, composes `latest.json` with the six platform keys from the spec, runs `scripts/verify-update-manifest.sh latest.json ${{ github.ref_name }}`, and uploads `latest.json` to the same draft release with `softprops/action-gh-release@v2` — matching how the existing jobs upload.

Both macOS keys point at the same universal `.app.tar.gz`.

- [ ] **Step 4: Include it in the checksums**

Add the new job to the `checksums` job's `needs:` array so `SHA256SUMS` covers `latest.json` too.

- [ ] **Step 5: Verify the YAML parses**

Run: `ruby -ryaml -e 'YAML.load_file(".github/workflows/release.yml"); puts "ok"'`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-update-manifest.sh .github/workflows/release.yml
git commit -m "ci(updates): sign the bundles, publish latest.json, and refuse a manifest with holes"
```

---

### Task 12: The two spikes, and the docs

The spec lists these as prerequisites to *shipping*, not to writing the code. Do them before tagging a release that enables updates.

- [ ] **Step 1: Spike — does the updater apply to an unsigned macOS `.app`?**

Build 0.2.0 and 0.2.1 locally with a throwaway signing key, install 0.2.0 from the `.dmg`, clear the Gatekeeper quarantine as a user would, and update. If it fails, change `resolveChannel` so `macos` returns `"manual"` and add a test asserting that, plus a comment explaining why.

- [ ] **Step 2: Spike — does AppImage detection work?**

Install the `.deb` in a VM and confirm the banner offers *Download*, not *Update*. Then run the AppImage and confirm it offers *Update*. If `@tauri-apps/plugin-os` cannot report `APPIMAGE`, read it in Rust with `std::env::var("APPIMAGE")` behind a small command instead.

- [ ] **Step 3: Update the README**

Add a short "Updates" note to `README.md` stating what is contacted, that nothing identifying is sent, that nothing downloads without a tap, and that it can be turned off in Settings. The README currently promises "no accounts, no sync, no analytics" — this keeps that promise honest rather than relying on a narrow reading of it.

- [ ] **Step 4: Commit**

```bash
git add README.md src/store/updateChannel.ts src/store/updateChannel.test.ts
git commit -m "docs(updates): say what the update check contacts, and record the spike results"
```
