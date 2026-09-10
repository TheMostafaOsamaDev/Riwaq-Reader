# Releasing

Riwaq holds **two irreplaceable secrets**. Read the first section before
anything else; the rest is procedure.

## The two keys

| Key | Signs | If you lose it |
|---|---|---|
| Android release keystore | the `.apk` | Nobody who installed Riwaq on Android can upgrade in place. They must uninstall first, which **deletes their library**. |
| Updater private key (minisign) | the desktop bundles | **Every existing desktop install can never be updated again.** They only accept payloads signed by a public key already compiled into them, and there is no way to reach them short of every user reinstalling by hand. |

They fail differently, and the second is worse. Keep both in the same backup,
somewhere that survives losing your laptop, with their passwords.

`.gitignore` covers `key.properties`, `*.jks`, `*.keystore` and `.tauri/`, so
neither key can be committed by accident. That is a safety net, not the plan.

### Creating them

Android — once, in your own terminal:

```bash
keytool -genkeypair -v -keystore riwaq-release.jks -alias riwaq \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Riwaq, O=Riwaq, C=EG"
```

Updater — once:

```bash
pnpm tauri signer generate -w ~/.tauri/riwaq-updater.key
```

Then paste the printed **public** key into `src-tauri/tauri.conf.json` at
`plugins.updater.pubkey`. It is compiled into every build; the private half
never leaves your backup and the CI secret.

## Repository secrets

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i riwaq-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | `riwaq` |
| `ANDROID_KEY_PASSWORD` | key password |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/riwaq-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password chosen above |

Repository **variable** (not a secret — a public-key fingerprint isn't one),
set after the first signed Android release:

| Variable | Value |
|---|---|
| `ANDROID_SIGNING_CERT_SHA256` | from `pnpm verify:signing --print` |

## Cutting a release

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`. They must agree: the updater compares against
   `tauri.conf.json`, and Android derives its `versionCode` from it as
   `major*1000000 + minor*1000 + patch`.
2. Push a `v*` tag. The pipeline builds seven targets into a **draft** release.
3. The build fails rather than shipping something broken if: the Android APK
   is debug-signed, `latest.json` is missing a platform, a signature is empty,
   or the manifest version disagrees with the tag.
4. Download the binaries and check them.
5. **Press Publish.** Nothing reaches any user before this — `latest.json` is
   served from `/releases/latest/`, which ignores drafts.

## Rollback is forward-only

The updater moves users forward and never down.

- Users **still on the old version** are protected the moment you unpublish or
  delete the bad release: `/releases/latest/` falls back to the previous one.
- Users **already on the bad version** cannot be reached by editing anything.
  The only way to fix them is to **publish a higher version containing the
  reverted code** — 0.3.1 with 0.2.0's behaviour, not a re-cut 0.3.0.

This is why step 4 exists. The draft is the last point at which a bad build
costs nothing.
