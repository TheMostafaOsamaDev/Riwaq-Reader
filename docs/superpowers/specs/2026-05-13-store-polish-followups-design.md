# Store polish follow-ups — design

Three independent fixes layered on top of the conversion + queue
work currently sitting on `feat/store-convert-to-epub`. Land as a
single commit on that branch since the PR isn't merged yet.

## 1. Conversion pre-loads every volume's chapter list

### Symptom
"Save as offline book" on a Cenele novel includes only the chapters
from volumes the user has manually expanded (typically just volume 1,
which auto-expands). The resulting EPUB silently drops volumes 2..N.

### Cause
`runConversion` in `src/store/storeConversion.ts` filters out any
volume whose `chaptersLoaded === false` and `chapters.length === 0`,
then walks only the remaining set. The filter was a guard against
incomplete data; in practice it discards everything Cenele hasn't
lazy-loaded yet.

### Fix
Add a pre-load pass at the top of `runConversion` (after the
snapshot read, before the enrichment loop):

- Detect unloaded volumes: `chaptersLoaded === false && chapters.length === 0`
- For each, when the source has `hasLazyVolumes` + `getVolumeChapters`:
  - Phase label: `Loading volume X / N: <title>`
  - `chapters = await source.getVolumeChapters(snap.novelUrl, sourceVolume)`
  - `await setVolumeChapters(job.libraryEntryId, v.id, chapters)`
- Re-read the snapshot at the end so the rest of the function sees
  the now-loaded chapters.

Remove the "No chapter listings are loaded" error since we now load
them ourselves. If `source.getVolumeChapters` is absent (eager source
like KolNovel), keep the filter — we genuinely can't recover those.

Progress budget: 0.01 → 0.05 of the bar for the preload phase
(small, since chapter listings are tiny compared to per-chapter
content fetches that come next).

### Reuse
- `setVolumeChapters` already exported from `sourceLibrary.ts`.
- `snapshotToSourceNovel` already converts persisted volumes to the
  `SourceVolume` shape that `getVolumeChapters` expects.

## 2. Notification: channel + unicode progress bar

### Symptom
Two issues:
- No progress bar in the system notification.
- Each chapter completion appears to dismiss + re-add the notification
  (the "blink").

### Cause
- Tauri's notification plugin doesn't expose
  `NotificationCompat.setProgress` so there's no native progress UI
  available without forking. The plugin DOES already call
  `setOnlyAlertOnce(true)`.
- The "blink" is the heads-up notification re-rendering whenever the
  body text changes. On a default-importance channel (which the
  plugin uses by default) updates pulse heads-up briefly.

### Fix
**Channel** — fix the blink:

- On startup, register a `downloads` notification channel with
  `Importance.Low` via the plugin's `createChannel` API.
- Pass `channelId: "downloads"` in every `sendNotification` call from
  `downloadNotifier`.
- LOW-importance notifications never trigger heads-up + use a quieter
  visual update path, eliminating the perceived blink.

**Unicode bar** — show progress:

- Helper: `renderBar(progress: 0..1, width = 10)` returns a string
  like `"███████░░░"`.
- Compose into the body alongside the existing counter:
  `███████░░░  67% · 27 of 40 chapters`
- For conversion-jobs the body keeps the phase prefix:
  `Building EPUB  ██████░░░░  60%`

Per-job kind:
- Chapter burst — bar reflects `completedThisBurst / burstTotal`.
- Conversion — bar reflects the running conversion's `progress`
  (already 0..1).

### Why LOW importance is safe
The download notifier already does NOT want to alert the user every
chapter; we want a single quiet status indicator. A LOW channel
serves exactly that purpose and matches what the user asked for.
The terminal "All done" summary still fires because we re-use the
same notification id — even on a LOW channel, the body change is
visible.

### Throttling
Keep the existing 600ms throttle. LOW-importance channels don't
penalize us as hard for frequent updates, but throttling is still
useful to limit CPU/IPC.

## 3. Mobile inner pages drop the Library header

### Symptom
Tapping the globe in the bottom nav (or `setTab("store")`) keeps the
"Library" title + status pills visible at the top, even though the
content swapped to the Store view.

### Fix
Two-part change in `src/components/Library.tsx` MobileLibrary:

1. Render the Library header (title + `MobileTabRow`) only when
   `!sourceDetailView && tab !== "store"`.
2. When on the Store tab, render a thin back-arrow header above the
   Store body:
   `[← arrow]  Store`
   Tapping the arrow flips `tab` back to `"all"`.

The bottom nav stays visible on Store (so the user can hop to
Downloads / Settings without backing out). The globe in the bottom
nav stays as the alternate way to toggle.

`BackHeader` is a small local component, reusing the same back-button
visual as `NovelDetailView` (34px circle, `arrowL` icon, 0.5px rule).

## Out of scope

- Native Android `setProgress` notification (Path A from
  brainstorming) — viable but requires a new in-tree Tauri plugin;
  deferred until the unicode bar proves insufficient.
- Conversion resume tracking which chapters have been processed
  (separate from the volume-level resume already in place).
- Hiding the bottom nav on the Store page (explicitly kept visible
  per user choice during brainstorming).

## Testing

For all three:
1. `tsc --noEmit` clean
2. `vite build` clean
3. Manual smoke on Android phone

Issue-specific:
- **Conversion**: open a Cenele novel without expanding any volume.
  Trigger "Save as offline book" → per-volume mode. Verify every
  volume's chapters are pulled (preload phase visible in the queue
  page + final library entry count equals volume count).
- **Notification**: queue 5 chapter downloads, watch the notification
  tray. Bar should fill smoothly without dismiss-and-reappear at
  chapter boundaries.
- **Inner pages**: from MobileLibrary, tap the globe nav button →
  Store renders without the "Library" header above. A back arrow
  shows; tapping it returns to the library shelf with header
  restored.

## File touch list

- `src/store/storeConversion.ts` — preload pass
- `src/store/downloadNotifier.ts` — channel registration + unicode
  bar in body + `channelId` on every send
- `src/components/Library.tsx` — header guard + `BackHeader` for
  Store tab
