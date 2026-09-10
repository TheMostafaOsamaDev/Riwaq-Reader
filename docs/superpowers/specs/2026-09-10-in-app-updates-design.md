# In-app updates: two channels, one banner

Date: 2026-09-10

Riwaq has shipped one release. At one release, having no updater is invisible.
At two it means every user who wants v0.3 has to remember the repo exists, find
it, work out which of seven artifacts is theirs, download it, and clear
Gatekeeper or SmartScreen again by hand. Nobody does that, so the install base
freezes at whatever version each person first grabbed — including on the
versions carrying the bugs the next release fixes.

This design adds updates without a server, without accounts, and without
contradicting the promise on the front of the README.

## The constraint that shaped this

`tauri-plugin-updater` does not support Android. Not "partially" — the plugin's
own dependency block excludes Android and iOS targets.

That inverts the obvious plan. Riwaq's most stranded users are on Android:
sideloading an APK, with no store to fall back on (Play distribution is not
planned, per the README), and now — after the release-signing work — pinned to a
signing key that makes a clean reinstall the only alternative to updating.
Desktop users at least have a `.dmg` they can re-download.

Nor is the gap only Android. Mapping what Riwaq ships against what the updater
can actually consume:

| Riwaq artifact | Updater support |
|---|---|
| Linux `.AppImage` (x86_64, aarch64) | yes |
| Linux `.deb` | **no** — unsupported format |
| Linux `.rpm` | **no** — unsupported format |
| Windows `.exe` (NSIS, x86_64 + aarch64) | yes |
| Windows `.msi` (WiX, x86_64) | yes, but see [Windows: one installer](#windows-one-installer) |
| macOS `.app.tar.gz` (universal) | yes — **already built** by the pipeline |
| macOS `.dmg` | no — the `.dmg` is the installer; updates arrive as `.app.tar.gz` |
| **Android `.apk`** | **no** |

Three of the seven build targets cannot self-update. So the design is not
"desktop gets updates and Android doesn't" — it is that **every install is
either self-updating or manual, and the split does not follow OS lines.**

## The shape

Two channels behind one piece of UI:

|  | self-updating | manual notice |
|---|---|---|
| Windows | NSIS `.exe` | — |
| macOS | `.app.tar.gz` | — |
| Linux | `.AppImage` | `.deb`, `.rpm` |
| Android | — | `.apk` |

One version-check module, one banner component, two strategies behind it. The
Android notifier is not an Android feature — it is the fallback channel, and
`.deb`/`.rpm` users get it too. Without that, those users would sit behind an
update button that fails every time, which is worse than no button.

```
                    ┌──────────────────────────┐
                    │  checkForUpdate()        │
                    │  (throttled, once a day) │
                    └────────────┬─────────────┘
                                 │ a newer version exists
                    ┌────────────▼─────────────┐
                    │  <UpdateBanner>          │
                    │  "Riwaq 0.3.0 is ready"  │
                    └────────────┬─────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
   canSelfUpdate() === true              canSelfUpdate() === false
              │                                     │
   ┌──────────▼──────────┐              ┌───────────▼───────────┐
   │ plugin-updater      │              │ opener → the release  │
   │ download + install  │              │ page for this platform│
   │ then relaunch       │              │ user installs by hand │
   └─────────────────────┘              └───────────────────────┘
```

## Behaviour

Decided with the user, 2026-09-10:

- **Auto-check on launch**, throttled to at most once every 24 hours, with the
  last-check timestamp persisted next to the other tweaks.
- **Never downloads or installs without a tap.** The banner states the version
  and offers "Update" / "Later". On a metered Egyptian mobile connection,
  spending someone's bandwidth unasked is not acceptable.
- **A Settings toggle, default on**, that disables the check entirely.
- **A manual "Check now"** in Settings, which works regardless of the toggle.

### Squaring this with "no accounts, no sync, no analytics"

The README's promise is about the user's *books and behaviour*, and an update
check does not touch either. But it is still a network request the app makes on
its own, so the honest thing is to say exactly what it is rather than rely on a
narrow reading:

- One unauthenticated GET to
  `https://github.com/TheMostafaOsamaDev/Riwaq-Reader/releases/latest/download/latest.json`.
- No identifiers, no library contents, no reading data. GitHub sees an IP and a
  user agent, as it would for any download.
- Off in one tap, and the app is fully functional with it off.

The README and `docs/` must both state this. An app that advertises privacy and
then quietly phones home — even harmlessly — spends trust it cannot re-earn.

## Desktop: the Tauri updater

### Manifest and endpoint

A static `latest.json` published as a release asset, fetched from:

```
https://github.com/TheMostafaOsamaDev/Riwaq-Reader/releases/latest/download/latest.json
```

`/releases/latest/` always resolves to the newest **published, non-prerelease**
release. That preserves the existing workflow exactly: the pipeline creates a
*draft*, you download and verify the binaries, and nothing in the world changes
until you press Publish. A half-built or bad release is invisible to every
installed copy until you say so.

Format, per the plugin:

```json
{
  "version": "0.3.0",
  "notes": "…",
  "pub_date": "2026-09-10T00:00:00Z",
  "platforms": {
    "darwin-x86_64":   { "url": "…/Riwaq_universal.app.tar.gz", "signature": "…" },
    "darwin-aarch64":  { "url": "…/Riwaq_universal.app.tar.gz", "signature": "…" },
    "windows-x86_64":  { "url": "…/Riwaq_0.3.0_x64-setup.exe",  "signature": "…" },
    "windows-aarch64": { "url": "…/Riwaq_0.3.0_arm64-setup.exe","signature": "…" },
    "linux-x86_64":    { "url": "…/Riwaq_0.3.0_amd64.AppImage", "signature": "…" },
    "linux-aarch64":   { "url": "…/Riwaq_0.3.0_aarch64.AppImage","signature": "…" }
  }
}
```

`signature` is the *contents* of the corresponding `.sig` file, inlined — not a
URL. The macOS entries deliberately point at the same universal bundle from both
architecture keys.

### Windows: one installer

The manifest holds exactly one URL per platform key, so Windows must pick NSIS
or MSI. The updater sniffs the downloaded bytes to decide how to run them, so
either *works* — but a user who installed from the `.msi` and updates via the
NSIS `.exe` ends up with two Riwaq entries in Add/Remove Programs, two
uninstallers, and one of them stale.

**Drop the MSI target.** One install format, one upgrade path. MSI's real
audience is enterprise group-policy deployment, which is not this app's
audience, and NSIS is the only format that covers Windows arm64 anyway — the
pipeline already ships NSIS-only there. This is a deliberate reduction in
artifacts, and the release notes for the version that does it should say so, for
anyone who installed via MSI and needs to reinstall once.

### Linux: why `.deb` and `.rpm` cannot be served

The plugin sets the extraction target to the running executable itself:

```rust
let extract_path = if cfg!(target_os = "linux") {
  executable_path
} else {
  extract_path_from_executable(&executable_path)?
};
```

For an AppImage that path *is* the AppImage, and replacing it is the update. For
a `.deb`/`.rpm` install it is a root-owned path under `/usr/bin`, which an
unprivileged process cannot replace. Those users therefore take the manual
channel. We keep shipping `.deb` and `.rpm` — they are the pleasant way to
install on those distributions — and simply do not pretend they can self-update.

## Manual channel: Android, `.deb`, `.rpm`

Same check, same banner, different action: open the release page for this
platform in the system browser via `tauri-plugin-opener`, already a dependency.

The version comparison must not reuse the updater plugin, which is not present
on Android. A small shared module owns it:

- `fetchLatestVersion()` — GET the same `latest.json`, read `version`.
- `isNewer(latest, current)` — semver compare, current version from
  `@tauri-apps/api/app`'s `getVersion()`, which reads the same
  `tauri.conf.json` version the manifest is generated from.
- `canSelfUpdate()` — true on Windows and macOS; on Linux, true only for an
  AppImage install; false on Android.

Reusing `latest.json` for both channels means one artifact and one code path
producing it — the manual channel cannot drift out of sync with the automatic
one, because there is nothing to keep in sync.

Explicitly **not** in scope: downloading the APK in-app and firing an install
intent. That needs `REQUEST_INSTALL_PACKAGES`, a permission that alarms users
and some scanners, plus a `FileProvider` and new Kotlin. The gap between "the
banner hands you the right APK" and "the app installs it for you" is one tap;
the gap in trust and maintenance cost is much larger. Revisit only if the manual
step proves to be where people actually fall off.

## Release pipeline changes

`.github/workflows/release.yml`, building on the signing work already there:

1. **Sign the bundles.** Add `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the env of the five desktop build
   jobs (`linux`, `linux-arm64`, `windows`, `windows-arm64`, `macos`). Tauri then
   emits a `.sig` beside each updatable bundle. No `.sig`, no update — so this
   is the step whose absence must fail loudly, exactly like the Android
   keystore.
2. **Remove the MSI target** from the Windows job.
3. **Let `tauri-action` write `latest.json`.** *(Corrected during
   implementation: the five desktop jobs already use `tauri-apps/tauri-action@v0`
   — only the Android job is hand-rolled — and the action generates and uploads
   the manifest itself once the signing vars are present. Writing our own
   manifest job would have duplicated it.)* Set `updaterJsonPreferNsis: true`
   as insurance against MSI ever being re-added.
4. **Verify what it produced.** Five jobs upload to the same draft release and
   each writes `latest.json`; whether that merges platform entries or
   overwrites them is not documented. So a `manifest` job downloads the shipped
   manifest and runs a guard, in the spirit of `verify-apk-signing.sh`: fail if
   any platform key is missing, if any signature is empty, or if the version
   disagrees with the tag. A manifest that silently omits `linux-aarch64` is
   valid JSON that strands those users with no error anywhere.
5. **`checksums` gains `manifest`** in its `needs:`, so `SHA256SUMS` covers
   `latest.json` too.

The Android job is untouched. Its APK is what the manual channel links to.

## Keys and secrets

`tauri signer generate` produces a minisign keypair. The **public** half is
compiled into every shipped binary via `tauri.conf.json`:

```json
{ "plugins": { "updater": { "pubkey": "…", "endpoints": ["…"] } } }
```

**This is the second irreplaceable key in this project, and it fails differently
from the first.** Losing the Android keystore means new installs can't upgrade
in place. Losing the updater private key means *every already-installed copy on
every desktop platform can never be updated again*, because they will only
accept payloads signed by a public key that is already baked into them. There is
no recovery path short of every user manually reinstalling.

It goes in the same backup as the Android keystore, at the same time, with the
same seriousness. `.gitignore` already anticipates this — `.tauri/` is listed
under "Tauri updater signing key (if the updater is ever enabled)".

New repository secrets: `TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Rollback is forward-only

The updater moves users forward and never down. If 0.3.0 ships broken:

- Users still on 0.2.0 are protected the moment you unpublish or delete the
  0.3.0 release — `/releases/latest/` falls back to the previous one.
- Users already on 0.3.0 are **not** recoverable by editing the manifest. The
  only way to reach them is to publish **0.3.1 containing the reverted code.**

Write this down now rather than discover it during an incident. It also argues
for keeping the draft-release verification step that exists today: it is the
last point at which a bad build costs nothing.

## Files

New:

- `src/store/updates.ts` — `fetchLatestVersion`, `isNewer`, `canSelfUpdate`,
  throttle state.
- `src/components/UpdateBanner.tsx` — the one piece of UI, both channels.
- `scripts/verify-update-manifest.sh` — the pipeline guard.

Modified:

- `src-tauri/tauri.conf.json` — `plugins.updater` block; drop the MSI target.
- `src-tauri/Cargo.toml` — `tauri-plugin-updater` under a
  `cfg(not(any(target_os = "android", target_os = "ios")))` target block, the
  same shape `tauri-plugin-single-instance` already uses, so the Android build
  does not try to compile it.
- `package.json` — `@tauri-apps/plugin-updater`.
- `src-tauri/capabilities/default.json` — `updater:default`.
- `src/App.tsx` — mount the check.
- `src/components/SettingsSection.tsx` — the toggle and "Check now".
- `src/hooks/useTweaks.ts` — `autoCheckUpdates` (default `true`),
  `lastUpdateCheck`.
- `src/i18n/en.ts`, `src/i18n/ar.ts` — the banner and settings strings; parity is
  a compile error, so both change together.
- `.github/workflows/release.yml`, `README.md`, `docs/ANDROID.md`.

## Spikes — do these before implementing

Two questions the documentation does not settle, either of which could change
the design:

1. **Does the updater apply to an unsigned macOS `.app`?** Riwaq's macOS bundles
   are unsigned and un-notarized; users clear Gatekeeper by hand on first launch.
   The updater replaces the `.app` bundle in place, and there are several open
   Tauri issues around macOS signature mismatches during update. If an unsigned
   bundle cannot be updated cleanly, macOS moves to the manual channel and the
   design is otherwise unchanged — but we need to know before shipping, not from
   a bug report. Test: build 0.2.0 and 0.2.1 locally with a throwaway signing
   key, install 0.2.0 from the `.dmg`, clear quarantine, and update.
2. **Does `canSelfUpdate()` correctly detect a `.deb`/`.rpm` install?** The
   AppImage-vs-package distinction is the difference between a working button and
   a failing one. Verify the detection on a real `.deb` install in a VM rather
   than trusting an environment variable to be present.

## Testing

Unit, in the style the store already uses:

- `isNewer` — 0.2.0 → 0.3.0, equal versions, 0.3.0 → 0.2.0 (no downgrade),
  prerelease suffixes, malformed input (must not offer an update).
- Throttle — no second check within 24h; a manual "Check now" bypasses it.
- `canSelfUpdate` — per platform, driven by injected platform/env values.
- Manifest guard — a `latest.json` missing a platform, carrying an empty
  signature, or disagreeing with the tag must all fail.

Manual, on real installs, before tagging: update applies on Windows NSIS, on
macOS (pending spike 1), and on Linux AppImage; the banner shows the manual path
on Android and on `.deb`; the toggle actually stops the network request.

## Rejected alternatives

**A `gh-pages` or hosted `latest.json`.** More control — staged rollouts,
pointing a manifest at an older version — at the cost of another deploy step and
another thing to be out of sync. GitHub's `/releases/latest/` gives the same
publish gate for free, and staged rollout is not a problem this project has.

**~~`tauri-action` for the whole release.~~** *Withdrawn — this rejection rested
on a false premise. The five desktop jobs **already** use
`tauri-apps/tauri-action@v0`; only the Android job is hand-rolled. So the action
generates `latest.json` for free once the signing vars are set, and the
implementation uses it rather than composing a manifest by hand. What survives
of the original concern is the undocumented multi-job merge behaviour, which is
why the manifest is verified after the fact instead of trusted.*

**Auto-download in the background.** Rejected with the user: it spends bandwidth
without asking, which matters on a metered mobile connection, and it sits least
comfortably with the app's stated character.
