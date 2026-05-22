# Store polish follow-ups — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land three fixes from the spec at `docs/superpowers/specs/2026-05-13-store-polish-followups-design.md` onto the open `feat/store-convert-to-epub` branch — conversion pre-loads every volume, notification channel + unicode progress bar, mobile inner pages drop the Library header.

**Architecture:** Three independent edits to existing modules. No new files for issues 1-2; one tiny local component for issue 3. All work stays within `src/`, no Rust changes.

**Tech Stack:** TypeScript, React, Tauri 2, `@tauri-apps/plugin-notification` (existing). No test framework in this codebase — verification is `pnpm exec tsc --noEmit` + `pnpm exec vite build`, with manual smoke at the end.

**Branch:** `feat/store-convert-to-epub`. Start each task from a clean working tree on this branch.

---

## File touch list

| File | Change |
|---|---|
| `src/store/storeConversion.ts` | Add preload pass to `runConversion`; drop silent-skip filter + the "no chapter listings" error |
| `src/store/downloadNotifier.ts` | Register LOW-importance `downloads` channel at startup; pass `channelId` on every send; insert unicode progress bar in body |
| `src/components/Library.tsx` | Gate Library header on `tab !== "store"`; add local `BackHeader` rendered on Store tab |

---

## Task 1: Conversion pre-loads every volume

**Files:**
- Modify: `src/store/storeConversion.ts`

**Context:** `runConversion` currently filters out unloaded volumes (Cenele lazy mode) and errors if none are loaded. The fix is to pre-load them via the source's `getVolumeChapters` + persist via `setVolumeChapters`, then proceed with the full set. `setVolumeChapters` and `snapshotToSourceNovel` are already exported from `src/store/sourceLibrary.ts`.

- [ ] **Step 1: Read the function block we're editing**

Run:
```bash
sed -n '85,135p' src/store/storeConversion.ts
```
Expected: the `runConversion` opening + the `orderedVolumes` filter + the `flat` computation. Confirm the lines match Task 1's edit anchors below before proceeding.

- [ ] **Step 2: Replace the silent-skip filter with a preload pass**

Edit `src/store/storeConversion.ts`. Find this block (currently around lines 108-126):

```ts
  // Build a flat ordered chapter list. Skip any volumes whose
  // listing isn't loaded yet — the user is expected to either let
  // the dialog pre-load them or open the volumes manually. Skipping
  // is safer than fetching here because lazy-volume fetches can
  // multiply network load unpredictably mid-conversion.
  const orderedVolumes = snap.volumes.filter(
    (v) => v.chaptersLoaded !== false || v.chapters.length > 0,
  );
  if (orderedVolumes.length === 0) {
    throw new Error(
      "No chapter listings are loaded for this novel. Open the volumes in the detail view (or use Download Range) before converting.",
    );
  }
  const flat = orderedVolumes.flatMap((v) =>
    v.chapters.map((c) => ({ volumeId: v.id, volumeTitle: v.title, chapter: c })),
  );
  if (flat.length === 0) {
    throw new Error("This novel has no chapters to convert.");
  }
```

Replace with:

```ts
  // Pre-load any unloaded volumes (Cenele-style lazy sources start
  // with empty chapters[] on every volume except the one the user
  // expanded in the detail view). The filter we used to apply here
  // silently dropped those volumes, which let conversions ship
  // incomplete novels. Now we fetch every missing volume up front
  // and persist via setVolumeChapters so the snapshot reflects what
  // we have, then proceed with the full ordered list.
  let workingSnap = snap;
  if (source.hasLazyVolumes && source.getVolumeChapters) {
    const missing = workingSnap.volumes.filter(
      (v) => v.chaptersLoaded === false && v.chapters.length === 0,
    );
    if (missing.length > 0) {
      const { setVolumeChapters, snapshotToSourceNovel, readSnapshot: rereadSnapshot } =
        await import("./sourceLibrary");
      const novelForFetch = snapshotToSourceNovel(workingSnap);
      for (let i = 0; i < missing.length; i++) {
        if (isCancelled()) return;
        const persisted = missing[i];
        const sourceVol = novelForFetch.volumes.find(
          (v) => v.id === persisted.id,
        );
        if (!sourceVol) continue;
        onProgress(
          0.01 + 0.04 * (i / missing.length),
          `Loading volume ${i + 1} / ${missing.length}: ${persisted.title}`,
        );
        const chapters = await source.getVolumeChapters(
          workingSnap.novelUrl,
          sourceVol,
        );
        await setVolumeChapters(job.libraryEntryId, persisted.id, chapters);
      }
      if (isCancelled()) return;
      const refreshed = await rereadSnapshot(job.libraryEntryId);
      if (refreshed) workingSnap = refreshed;
    }
  }

  // After preload, ANY volume with chapters is fair game. Volumes
  // that still have empty chapters[] at this point come from sources
  // that don't support lazy loading + were genuinely empty upstream
  // (e.g. a "no volumes" pseudo-volume on a novel with zero chapters).
  const orderedVolumes = workingSnap.volumes.filter(
    (v) => v.chapters.length > 0,
  );
  const flat = orderedVolumes.flatMap((v) =>
    v.chapters.map((c) => ({ volumeId: v.id, volumeTitle: v.title, chapter: c })),
  );
  if (flat.length === 0) {
    throw new Error("This novel has no chapters to convert.");
  }
```

- [ ] **Step 3: Re-base every post-preload reference on `workingSnap`**

The preload pass produces a new `workingSnap`. Everything downstream of the preload block should read from `workingSnap` so we see the freshly-loaded chapters. References ABOVE the preload (the initial `snap` declaration, the `if (!snap)` guard, `getSource(snap.sourceId)`, the source-missing error message) stay as `snap` — `workingSnap` doesn't exist yet at that point.

Search and update each remaining post-preload reference (line numbers are approximate; search by content):

Find:
```ts
  const host = createHost(snap.sourceId);
```
Replace with:
```ts
  const host = createHost(workingSnap.sourceId);
```

Find:
```ts
    const bytes = await assembleSingleEpub(
      snap,
```
Replace with:
```ts
    const bytes = await assembleSingleEpub(
      workingSnap,
```

Find:
```ts
    const bytes = await assembleVolumeEpub(
      snap,
```
Replace with:
```ts
    const bytes = await assembleVolumeEpub(
      workingSnap,
```

Find:
```ts
    onProgress(1, `Saved "${entry.title ?? snap.title}"`);
```
Replace with:
```ts
    onProgress(1, `Saved "${entry.title ?? workingSnap.title}"`);
```

Verify the only remaining `snap` references inside `runConversion` are the pre-preload ones:
```bash
awk '/^export async function runConversion/,/^}$/' src/store/storeConversion.ts | grep -nE '\bsnap\b'
```
Expected: exactly these four hits in this order:
1. `const snap = await readSnapshot(job.libraryEntryId);`
2. `if (!snap) {`
3. `const source = getSource(snap.sourceId);`
4. `Source "${snap.sourceId}" isn't installed in this build.` (inside the error message)

…plus one `let workingSnap = snap;` line we added in Step 2. Any other `snap.` hit is a bug — update it to `workingSnap.`.

- [ ] **Step 4: Type-check**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && pnpm exec tsc --noEmit
echo "EXIT $?"
```
Expected: `EXIT 0`.

- [ ] **Step 5: Build check**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && pnpm exec vite build 2>&1 | tail -5
```
Expected: `✓ built in N.NNs` with no error lines.

- [ ] **Step 6: Commit**

```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && git add src/store/storeConversion.ts && git commit -m "$(cat <<'EOF'
fix(store): conversion pre-loads every volume's chapter listing

Lazy-volume sources (Cenele) had a silent-skip filter that dropped
any volume the user hadn't expanded in the detail view — so a "Save
as offline book" on a 12-volume novel where only volume 1 was
loaded shipped an EPUB containing volume 1's chapters and nothing
else.

Replace the filter with a preload pass at the top of runConversion:
walk every volume whose chapters[] is still empty, fetch via
source.getVolumeChapters, persist via setVolumeChapters, re-read
the snapshot, then proceed with the full ordered list. The
"No chapter listings are loaded" error is gone — we load them
ourselves now. Sources without lazy volumes are unaffected (the
preload pass is gated on hasLazyVolumes).

Progress: preload uses 0.01-0.05 of the bar with phase labels like
"Loading volume 3 / 12: Volume Title".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `[feat/store-convert-to-epub <sha>] fix(store): conversion pre-loads every volume's chapter listing`.

---

## Task 2: Register LOW-importance channel + thread `channelId` through

**Files:**
- Modify: `src/store/downloadNotifier.ts`

**Context:** Tauri's notification plugin already calls `setOnlyAlertOnce(true)` on Android, but the default channel's importance is DEFAULT which still triggers heads-up on body changes. Registering a `downloads` channel with `Importance.Low` and routing our sends through it suppresses heads-up entirely — that's the "blink" fix. The Tauri plugin exposes `createChannel` and `channelId` natively (verified via `@tauri-apps/plugin-notification/dist-js/index.d.ts`).

- [ ] **Step 1: Read the current import + startup function**

Run:
```bash
sed -n '16,28p;94,108p' src/store/downloadNotifier.ts
```
Expected: shows the import block from `@tauri-apps/plugin-notification` (around line 16) and `startDownloadNotifier` (around line 96).

- [ ] **Step 2: Pull in `createChannel` + `Importance` from the plugin**

Edit `src/store/downloadNotifier.ts`. Replace:

```ts
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
```

with:

```ts
import {
  createChannel,
  Importance,
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
```

- [ ] **Step 3: Add a channel id constant + a one-shot registration helper**

Edit `src/store/downloadNotifier.ts`. Find this block (around lines 28-31):

```ts
/** Stable id so subsequent sends replace the previous notification on
 *  Android instead of stacking. (iOS reuses by id too.) */
const NOTIFICATION_ID = 1001;
```

Append (immediately after):

```ts

/** Channel id used by every download/conversion notification. We
 *  register the channel with Importance.LOW on first use so updates
 *  never show heads-up — Android otherwise re-renders the heads-up
 *  overlay on every body change, which reads as a blink at chapter
 *  boundaries. The channel only exists on Android; the createChannel
 *  call is a no-op everywhere else. */
const CHANNEL_ID = "leaflet-downloads";
let channelRegistered = false;

async function ensureChannel(): Promise<void> {
  if (channelRegistered) return;
  try {
    await createChannel({
      id: CHANNEL_ID,
      name: "Downloads",
      description: "Chapter downloads and offline-book conversions",
      importance: Importance.Low,
      lights: false,
      vibration: false,
    });
    channelRegistered = true;
  } catch (e) {
    // Plugin throws on non-Android platforms (channels are
    // Android-only) — that's fine, sendNotification still works
    // without a channel. Mark registered so we don't keep
    // retrying.
    channelRegistered = true;
    // eslint-disable-next-line no-console
    console.warn("[downloadNotifier] createChannel skipped:", e);
  }
}
```

- [ ] **Step 4: Call `ensureChannel` from the permission gate**

Edit `src/store/downloadNotifier.ts`. Find this `ensurePermission` function (around line 178):

```ts
async function ensurePermission(): Promise<void> {
  if (permissionState === "granted" || permissionState === "denied") return;
  if (permissionInflight) {
    await permissionInflight;
    return;
  }
  permissionInflight = (async () => {
    try {
      if (await isPermissionGranted()) {
        permissionState = "granted";
        return;
      }
      const next = await requestPermission();
      permissionState = next === "granted" ? "granted" : "denied";
    } catch (e) {
      // Plugin or capability missing → don't keep retrying.
      // eslint-disable-next-line no-console
      console.warn("[downloadNotifier] permission check failed:", e);
      permissionState = "denied";
    } finally {
      permissionInflight = null;
    }
  })();
  await permissionInflight;
}
```

Replace the inner `try` block (the one that runs `isPermissionGranted` etc) with this version that also registers the channel on first grant:

```ts
permissionInflight = (async () => {
    try {
      if (await isPermissionGranted()) {
        permissionState = "granted";
        await ensureChannel();
        return;
      }
      const next = await requestPermission();
      permissionState = next === "granted" ? "granted" : "denied";
      if (permissionState === "granted") await ensureChannel();
    } catch (e) {
      // Plugin or capability missing → don't keep retrying.
      // eslint-disable-next-line no-console
      console.warn("[downloadNotifier] permission check failed:", e);
      permissionState = "denied";
    } finally {
      permissionInflight = null;
    }
  })();
```

- [ ] **Step 5: Pass `channelId` on every `sendNotification` call**

Edit `src/store/downloadNotifier.ts`. Find the `sendNotification` invocation (around line 213):

```ts
    sendNotification({
      id: NOTIFICATION_ID,
      title,
      body,
      // In-progress: ongoing so Android marks the notification as
      // persistent background work, which suppresses the per-update
      // alert. Silent on iOS for the same reason. The terminal
      // summary fires without these flags so the system alerts as
      // normal — the "your work is done" cue.
      ongoing: !isTerminalSummary,
      silent: !isTerminalSummary,
    });
```

Add `channelId` so the notification routes through the LOW-importance channel:

```ts
    sendNotification({
      id: NOTIFICATION_ID,
      channelId: CHANNEL_ID,
      title,
      body,
      // In-progress: ongoing so Android marks the notification as
      // persistent background work, which suppresses the per-update
      // alert. Silent on iOS for the same reason. The terminal
      // summary fires without these flags so the system alerts as
      // normal — the "your work is done" cue.
      ongoing: !isTerminalSummary,
      silent: !isTerminalSummary,
    });
```

- [ ] **Step 6: Type-check**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && pnpm exec tsc --noEmit
echo "EXIT $?"
```
Expected: `EXIT 0`.

- [ ] **Step 7: Build check**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && pnpm exec vite build 2>&1 | tail -5
```
Expected: `✓ built in N.NNs`.

- [ ] **Step 8: Commit**

```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && git add src/store/downloadNotifier.ts && git commit -m "$(cat <<'EOF'
fix(notify): route downloads through a LOW-importance channel

Android's default channel re-renders the heads-up overlay on every
body change. setOnlyAlertOnce stops the sound + vibration but the
heads-up animation still pulses, which reads as a "blink" each
time a chapter completes. Registering a "leaflet-downloads" channel
with Importance.LOW suppresses heads-up entirely — updates land
silently in the tray with no re-render flicker.

Channel is registered lazily after permission grants (Android-only;
createChannel is a no-op on other platforms and we catch the throw).
Every sendNotification call now carries channelId.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `[feat/store-convert-to-epub <sha>] fix(notify): route downloads through a LOW-importance channel`.

---

## Task 3: Unicode progress bar in notification body

**Files:**
- Modify: `src/store/downloadNotifier.ts`

**Context:** The Tauri plugin doesn't expose Android's `setProgress`. We render the bar as a block-character string in the body text instead. Both chapter-burst and conversion bodies get the bar prefixed.

- [ ] **Step 1: Read the current `compose` function**

Run:
```bash
sed -n '233,272p' src/store/downloadNotifier.ts
```
Expected: shows the `compose` function (around line 230s).

- [ ] **Step 2: Add a `renderBar` helper**

Edit `src/store/downloadNotifier.ts`. Find this comment + `findRunningConversion` function (the line numbers depend on Task 2's additions; search for `function findRunningConversion`):

```ts
/** Find the conversion job that's currently running, if any. Used by
 *  the notification body so the phase text reads naturally rather
 *  than a bare burst tally. */
function findRunningConversion() {
```

Insert the helper IMMEDIATELY ABOVE that block:

```ts
/** Unicode block-character progress bar for the notification body.
 *  10-cell width — narrow enough to fit beside the counter on
 *  phone-width notification rows while still showing visible
 *  granularity (10% increments). The full block U+2588 + light
 *  shade U+2591 render correctly in every Android system font
 *  shipped since 2016.
 *
 *  Returns "" for invalid progress so callers can `${renderBar(p)}`
 *  unconditionally without weird empty bars when math goes wrong. */
function renderBar(progress: number, width = 10): string {
  if (!Number.isFinite(progress) || progress < 0) return "";
  const clamped = Math.min(1, progress);
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

```

- [ ] **Step 3: Use the bar in the chapter-burst body**

Edit `src/store/downloadNotifier.ts`. Find this branch inside `compose`:

```ts
    return {
      title: "Downloading chapters",
      body: `${completedThisBurst} of ${burstTotal} done`,
    };
```

Replace with:

```ts
    const fraction =
      burstTotal > 0 ? completedThisBurst / burstTotal : 0;
    return {
      title: "Downloading chapters",
      body: `${renderBar(fraction)}  ${Math.round(fraction * 100)}% · ${completedThisBurst} of ${burstTotal}`,
    };
```

`const fraction` is fine at the top of the surrounding `if`-arm — both arms `return`, so the binding never leaks.

- [ ] **Step 4: Use the bar in the conversion body**

Edit `src/store/downloadNotifier.ts`. Find this branch (a bit above the chapter-burst branch):

```ts
    if (snap.activeConversions > 0) {
      const runningConversion = findRunningConversion();
      const body = runningConversion?.phase
        ? `${runningConversion.phase} · ${Math.round(runningConversion.progress * 100)}%`
        : `${completedThisBurst} of ${burstTotal} jobs done`;
      return { title: "Saving as offline book", body };
    }
```

Replace with:

```ts
    if (snap.activeConversions > 0) {
      const runningConversion = findRunningConversion();
      let body: string;
      if (runningConversion) {
        const pct = Math.round(runningConversion.progress * 100);
        const bar = renderBar(runningConversion.progress);
        body = runningConversion.phase
          ? `${runningConversion.phase}\n${bar}  ${pct}%`
          : `${bar}  ${pct}%`;
      } else {
        body = `${completedThisBurst} of ${burstTotal} jobs done`;
      }
      return { title: "Saving as offline book", body };
    }
```

(The `\n` after the phase puts the bar on a second line so the phase label stays readable when it's long like "Fetching chapter 247 / 2996".)

- [ ] **Step 5: Type-check**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && pnpm exec tsc --noEmit
echo "EXIT $?"
```
Expected: `EXIT 0`.

- [ ] **Step 6: Build check**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && pnpm exec vite build 2>&1 | tail -5
```
Expected: `✓ built in N.NNs`.

- [ ] **Step 7: Commit**

```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && git add src/store/downloadNotifier.ts && git commit -m "$(cat <<'EOF'
feat(notify): unicode progress bar in the download notification body

Tauri's notification plugin doesn't expose Android's setProgress,
and writing a custom plugin just for the bar would be a multi-hour
detour. Block-character bars in the body text get us 80% of the
value with 20 LOC: "███████░░░  67% · 27 of 40" for chapter
bursts; "Fetching chapter 247 / 2996\n██░░░░░░░░  21%" for
conversion progress (newline keeps the phase label legible when
it's long).

Bar helper is a small local utility — 10 cells, full block + light
shade chars, clamps and rounds out-of-range values to "".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `[feat/store-convert-to-epub <sha>] feat(notify): unicode progress bar in the download notification body`.

---

## Task 4: Hide Library header on inner pages; back-arrow header for Store

**Files:**
- Modify: `src/components/Library.tsx`

**Context:** Today the mobile Library renders its header (title + `MobileTabRow`) whenever no source-detail view is open, including when the Store tab is active. The fix is to add `tab !== "store"` to that guard and render a small back-arrow header in the Store branch instead. The bottom nav stays visible so the user can hop to other sections.

- [ ] **Step 1: Locate the current header guard**

Run:
```bash
grep -nE "No top header on mobile|<MobileTabRow|tab === \"store\" \?" src/components/Library.tsx | head -10
```
Expected: a line matching the `"No top header on mobile"` comment (current header gate at the top of the mobile body), a `<MobileTabRow` usage inside it, and the `tab === "store" ?` ternary that swaps in the Store component.

- [ ] **Step 2: Restrict the header to the library shelf only**

Edit `src/components/Library.tsx`. Find this block (the comment will be near line 1000-1015 in the current branch):

```tsx
      {/* Top header — title + filter tabs. Hidden inside the source
          detail view (NovelDetailView has its own header with a back
          arrow). The Store tab is omitted from the pills since the
          bottom nav owns Store toggling. Action buttons live in the
          bottom nav, so the right side of the title row is empty. */}
      {!sourceDetailView && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "16px 22px 10px",
            borderBottom: `0.5px solid ${theme.rule}`,
          }}
        >
          <h1
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 28,
              margin: 0,
              letterSpacing: "-0.02em",
              color: theme.ink,
            }}
          >
            Library
          </h1>
          <MobileTabRow theme={theme} tab={tab} setTab={setTab} />
        </div>
      )}
```

Tighten the gate so the header only renders on the shelf — not on the Store tab or while a detail view is open:

```tsx
      {/* Top header — title + filter tabs. Only on the shelf. The
          Store tab swaps in its own back-arrow header below. The
          source detail view (NovelDetailView) brings its own header
          with a back arrow. Action buttons live in the bottom nav,
          so the right side of the title row is empty. */}
      {!sourceDetailView && tab !== "store" && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "16px 22px 10px",
            borderBottom: `0.5px solid ${theme.rule}`,
          }}
        >
          <h1
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: 28,
              margin: 0,
              letterSpacing: "-0.02em",
              color: theme.ink,
            }}
          >
            Library
          </h1>
          <MobileTabRow theme={theme} tab={tab} setTab={setTab} />
        </div>
      )}
```

- [ ] **Step 3: Add a `BackHeader` above the Store body**

Still in `src/components/Library.tsx`. Find the Store branch in the mobile body (search for `tab === "store" ?`):

```tsx
      ) : tab === "store" ? (
        <Store
          theme={theme}
          layout="mobile"
          onStreamRead={onStreamRead}
          onImportComplete={onSourceImportComplete}
        />
      ) : (
```

Wrap the `<Store>` so a back-arrow header sits above it:

```tsx
      ) : tab === "store" ? (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <BackHeader
            theme={theme}
            title="Store"
            onBack={() => setTab("all")}
          />
          <Store
            theme={theme}
            layout="mobile"
            onStreamRead={onStreamRead}
            onImportComplete={onSourceImportComplete}
          />
        </div>
      ) : (
```

- [ ] **Step 4: Define `BackHeader` as a local component**

Still in `src/components/Library.tsx`. Find the `MobileTabRow` function declaration (search for `function MobileTabRow`). Insert this BackHeader component IMMEDIATELY ABOVE the `interface MobileTabRowProps` block:

```tsx
interface BackHeaderProps {
  theme: Theme;
  title: string;
  onBack: () => void;
}

/** Thin back-arrow header used by mobile inner pages (Store, future
 *  side-pages) when the shelf-mode Library header would be misleading.
 *  Visual matches NovelDetailView's header: 34px outlined circle with
 *  the arrowL glyph, label fills the rest of the row. The wrapping
 *  border-bottom keeps the row visually separated from the body
 *  underneath. */
function BackHeader({ theme, title, onBack }: BackHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 18px 12px",
        borderBottom: `0.5px solid ${theme.rule}`,
        flexShrink: 0,
      }}
    >
      <button
        onClick={onBack}
        aria-label="Back to library"
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          border: `0.5px solid ${theme.rule}`,
          background: theme.bg,
          color: theme.ink,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontFamily: "inherit",
        }}
      >
        <Icon name="arrowL" size={16} />
      </button>
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          letterSpacing: "-0.005em",
          color: theme.ink,
        }}
      >
        {title}
      </div>
    </div>
  );
}

```

- [ ] **Step 5: Type-check**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && pnpm exec tsc --noEmit
echo "EXIT $?"
```
Expected: `EXIT 0`.

- [ ] **Step 6: Build check**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && pnpm exec vite build 2>&1 | tail -5
```
Expected: `✓ built in N.NNs`.

- [ ] **Step 7: Commit**

```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && git add src/components/Library.tsx && git commit -m "$(cat <<'EOF'
fix(mobile): drop the Library header on inner pages

Tapping the globe in the bottom nav swapped the body to the Store
but kept the "Library" title + status pills sitting on top — which
both looked wrong (the header belongs to the shelf, not the store)
and stole vertical room from the Store's own content.

Tighten the header guard so it only renders when the shelf is
showing (!sourceDetailView && tab !== "store"). On Store tab we
mount a tiny BackHeader instead — 34px back-arrow circle + "Store"
label, matching NovelDetailView's header treatment. The bottom nav
stays visible so the user can hop between Library / Store /
Downloads / Settings without backing out first.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `[feat/store-convert-to-epub <sha>] fix(mobile): drop the Library header on inner pages`.

---

## Task 5: Push the branch

- [ ] **Step 1: Verify all four commits landed**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && git log --oneline origin/feat/store-convert-to-epub..HEAD
```
Expected: four new commits in this order (newest at top):
```
<sha> fix(mobile): drop the Library header on inner pages
<sha> feat(notify): unicode progress bar in the download notification body
<sha> fix(notify): route downloads through a LOW-importance channel
<sha> fix(store): conversion pre-loads every volume's chapter listing
```

If any are missing, back up to the corresponding task and re-run its commit step.

- [ ] **Step 2: Push**

Run:
```bash
cd /mnt/sda3/my-work-personal/Leaflet/Leaflet-ebook-reader && git push 2>&1 | tail -5
```
Expected: a line like `<old>..<new>  feat/store-convert-to-epub -> feat/store-convert-to-epub`.

The open PR (https://github.com/TheMostafaOsamaDev/Leaflet-ebook-reader/pull/new/feat/store-convert-to-epub) picks up the new commits automatically.

---

## Manual smoke checklist (no automation; runs after the branch is pushed)

After `pnpm tauri android dev` lands on the phone:

- [ ] Open a Cenele novel that has multiple volumes, **don't** expand any volume past the default. Trigger "Save as offline book" → per-volume mode. Watch the queue page — phase label should read "Loading volume N / M: ..." before chapter fetching starts. Final library entry count should equal the source's volume count.
- [ ] Queue 5+ chapter downloads. Notification tray should show the progress bar filling smoothly between chapter completions, with no dismiss + reappear at chapter boundaries.
- [ ] Tap the globe icon in the bottom nav. Store renders below a small "← Store" header (no "Library" title, no pills). Bottom nav is still visible.
- [ ] Tap the back arrow in the Store header. Library shelf header (title + pills) returns.
