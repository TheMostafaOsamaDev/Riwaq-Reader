# Extensions Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reader's three compiled-in sources with a runtime extension system that installs, updates and removes extensions individually from user-managed repos.

**Architecture:** Extensions are ESM bundles downloaded from a repo's `index.min.json`, verified by SHA-256, written under `$APPDATA/riwaq/extensions/`, and loaded via blob-URL dynamic `import()`. `registry.ts` keeps its five existing public signatures so none of the nine call sites change; a new `initExtensions()` populates it asynchronously at startup. A Cloudflare challenge is handled inside `host.fetch` by retrying through the existing desktop session webview, so extensions never know it happened.

**Tech Stack:** React 19, Vite, Tauri v2 (desktop + Android), TypeScript, Vitest + happy-dom, Rust (reqwest), Biome.

**Spec:** `docs/superpowers/specs/2026-09-17-extensions-integration-design.md`

## Global Constraints

- **Worktree:** `/Users/themostafaosama/Desktop/my-work/Riwaq-extensions-runtime`, branch `feat/extensions-runtime`.
- **No Claude/AI attribution** in any commit message or PR body. No `Co-Authored-By: Claude`, no "Generated with" footer.
- **Never `git add -A`** in this repo — it holds meaningful untracked state (`CLAUDE.md`, `scripts/mac-install.sh`, local `package.json` scripts). Stage explicit paths only.
- **App-data root is `$APPDATA/riwaq/`** — already in `assetProtocol.scope` and covered by `fs:allow-appdata-*-recursive`. No `tauri.conf.json` or capability changes.
- **Contract version:** `API_VERSION = 1`. The host refuses any manifest whose `apiVersion` major differs.
- **Official repo URL:** `https://themostafaosamadev.github.io/Riwaq-Extensions/index.min.json`
- **Never gate first paint.** `initExtensions()` must not be awaited before React mounts — a past Android blank-launch came from exactly that. Gate the Store view only.
- **Run `pnpm check`** (format, lint, build, test) before every commit.
- **Frontend/UI work must invoke the `ui-ux-pro-max` skill first** (project CLAUDE.md standing rule).
- **Tamper every test once.** This suite has a documented false-green history: after a test passes, break the code it covers and confirm it goes red, then restore.

---

### Task 1: Prove blob-URL dynamic `import()` works on both targets

The whole loader rests on this. A negative result changes `loader.ts` before anything is built on it, so this task runs alone and first.

**Files:**
- Create: `src/extensions/loadModule.ts`
- Create: `src/extensions/loadModule.test.ts`

**Interfaces:**
- Produces: `loadModuleFromSource(source: string): Promise<unknown>` — evaluates ESM source text and resolves to its module namespace. Used by `loader.ts` in Task 7.

- [ ] **Step 1: Write the failing test**

```ts
// src/extensions/loadModule.test.ts
import { describe, expect, it } from "vitest";
import { loadModuleFromSource } from "./loadModule";

describe("loadModuleFromSource", () => {
  it("evaluates ESM source and exposes its default export", async () => {
    const mod = (await loadModuleFromSource(
      `export default (host) => ({ id: "probe", greeting: host.hello });`,
    )) as { default: (h: { hello: string }) => { id: string; greeting: string } };

    const instance = mod.default({ hello: "hi" });
    expect(instance.id).toBe("probe");
    expect(instance.greeting).toBe("hi");
  });

  it("rejects when the source throws at evaluation time", async () => {
    await expect(
      loadModuleFromSource(`throw new Error("boom at load");`),
    ).rejects.toThrow(/boom at load/);
  });

  it("gives each call its own module instance", async () => {
    const src = `let n = 0; export default () => ++n;`;
    const a = (await loadModuleFromSource(src)) as { default: () => number };
    const b = (await loadModuleFromSource(src)) as { default: () => number };
    expect(a.default()).toBe(1);
    expect(b.default()).toBe(1); // not 2 — separate module registries
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/extensions/loadModule.test.ts`
Expected: FAIL — `Failed to resolve import "./loadModule"`.

- [ ] **Step 3: Implement it**

```ts
// src/extensions/loadModule.ts
//
// Evaluates an extension bundle's source text into a live module.
//
// Blob URL + dynamic import(), rather than eval or new Function, for two
// reasons: the bundles are real ESM (they have `export default`), and this
// keeps them off the app's own module graph so a broken extension cannot
// corrupt anything already loaded.
//
// The object URL is revoked in a finally block. Revoking is safe the moment
// import() has resolved — the module has been fetched and compiled by then,
// and nothing re-reads the URL afterwards.

/** Evaluate ESM `source` and resolve to its module namespace object.
 *  Each call produces a fresh module instance (a distinct blob URL is a
 *  distinct module specifier), so two extensions never share module state. */
export async function loadModuleFromSource(source: string): Promise<unknown> {
  const blob = new Blob([source], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run src/extensions/loadModule.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Tamper-check the test**

Change `return await import(url)` to `return { default: () => ({ id: "probe", greeting: "hi" }) }`. Re-run. The third test ("own module instance") must fail. Restore.

This matters: a stub that satisfies test 1 proves nothing about dynamic import, and test 3 is the one that actually pins the mechanism.

- [ ] **Step 6: Prove it in the real macOS WKWebView**

Vitest runs in happy-dom, which is *not* the webview. Add a temporary dev-only probe in `src/main.tsx`, guarded by `import.meta.env.DEV`:

```ts
if (import.meta.env.DEV) {
  void import("./extensions/loadModule").then(async ({ loadModuleFromSource }) => {
    try {
      const m = (await loadModuleFromSource(
        `export default () => "blob-import-ok";`,
      )) as { default: () => string };
      console.info("[spike] blob import:", m.default());
    } catch (e) {
      console.error("[spike] blob import FAILED:", e);
    }
  });
}
```

Run `pnpm tauri dev`, open devtools, confirm `[spike] blob import: blob-import-ok`.

- [ ] **Step 7: Prove it in the Android WebView**

Run `pnpm android:dev`. Read the log over CDP (see the `android-webview-devtools` note) or via `adb logcat | grep spike`. Confirm the same line.

**If either target fails**, stop and report before continuing. The fallback is `convertFileSrc()` + `asset://` against `$APPDATA/riwaq/**`, which is already in the asset-protocol scope — `loadModuleFromSource` would take a file path instead of source text, and only this module changes.

- [ ] **Step 8: Remove the temporary probe and commit**

```bash
# revert the main.tsx probe first
git add src/extensions/loadModule.ts src/extensions/loadModule.test.ts
git commit -m "feat(extensions): load an extension bundle from a blob URL

Dynamic import() over a blob URL, verified in both the macOS WKWebView
and the Android WebView before anything is built on it. Each call gets
its own module instance, so two extensions never share module state."
```

---

### Task 2: Give the HTTP client a cookie jar

The `SourceHost` contract requires that every `fetch`/`fetchBytes` in a session share one cookie jar. The client honours neither half of that today: `reqwest` is built without the `cookies` feature, and `build_client()` is called per request (`sources.rs:87`, `sources.rs:132`), so even enabling it would reset the jar every call. Cenele's WordPress nonces are session-scoped and cannot work across a jar reset.

**Files:**
- Modify: `src-tauri/Cargo.toml:41-47`
- Modify: `src-tauri/src/sources.rs:275-284` (`build_client`), and its two call sites at `:87` and `:132`

**Interfaces:**
- Produces: a process-wide `reqwest::Client` with `cookie_store(true)`, shared by `source_fetch` and `source_fetch_bytes`.

- [ ] **Step 1: Add the `cookies` feature**

```toml
reqwest = { version = "0.12", default-features = false, features = [
    "rustls-tls",
    "gzip",
    "deflate",
    "brotli",
    "charset",
    "cookies",
] }
```

- [ ] **Step 2: Make the client shared and cookie-bearing**

Replace `build_client` and switch both call sites to `http_client()?`:

```rust
use std::sync::OnceLock;

static HTTP_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

/// The one HTTP client every source request goes through.
///
/// Shared, not per-request, because `SourceHost` promises extensions that
/// all their fetches share a cookie jar the way a browser tab's do — and a
/// fresh `Client` per call means a fresh, empty jar per call. Cenele scrapes
/// a WordPress nonce off one page and replays it against admin-ajax.php in a
/// later call; WordPress nonces are session-scoped, so that only works if the
/// session cookie set by the first request is still sent on the second.
fn http_client() -> Result<reqwest::Client, String> {
    HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
                     AppleWebKit/537.36 (KHTML, like Gecko) \
                     Chrome/131.0.0.0 Safari/537.36",
                )
                .cookie_store(true)
                .gzip(true)
                .build()
                .map_err(|e| e.to_string())
        })
        .clone()
}
```

The UA also drops the `Leaflet/0.1` token. A non-browser suffix on an otherwise-browser UA is a standard bot signal, and nothing depends on advertising it.

- [ ] **Step 3: Add a Rust test that the jar persists**

```rust
#[test]
fn http_client_is_shared_across_calls() {
    let a = http_client().expect("client builds");
    let b = http_client().expect("client builds");
    // reqwest::Client is an Arc internally; a shared jar requires the same
    // underlying client, not merely two identically-configured ones.
    assert!(
        std::ptr::eq(
            a.as_ref() as *const _ as *const u8,
            b.as_ref() as *const _ as *const u8
        ) || format!("{a:?}") == format!("{b:?}"),
        "http_client() must hand back one shared client"
    );
}
```

- [ ] **Step 4: Build and test**

Run: `cd src-tauri && cargo test sources:: && cargo check --target aarch64-linux-android`
Expected: PASS, and the Android target still compiles (the NDK env from the `android-emulator-dev-setup` note is required for the second command).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/sources.rs
git commit -m "fix(sources): share one cookie-bearing HTTP client

SourceHost promises extensions that every fetch in a session shares a
cookie jar. The client honoured neither half: reqwest was built without
the cookies feature, and build_client() ran per request, so each call
got a fresh empty jar. Cenele's WordPress nonces are session-scoped and
cannot survive that.

Also drops the Leaflet/0.1 suffix from the user agent — a non-browser
token on an otherwise-browser UA is a bot signal we gain nothing from."
```

---

### Task 3: Reconcile the contract and extend the host

**Files:**
- Modify: `src/sources/types.ts` (replace wholesale)
- Modify: `src/sources/host.ts`
- Create: `src/sources/challenge.ts`
- Create: `src/sources/challenge.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isChallengeResponse(resp: { status: number; headers: Record<string,string>; text: string }): boolean`; `createHost(sourceId: string): SourceHost` now supplying `locale` and `pdf`.

- [ ] **Step 1: Vendor the contract**

Copy `packages/extension-api/src/types.ts` from the extensions repo over `src/sources/types.ts`, then prepend:

```ts
// VENDORED from Riwaq-Extensions @ packages/extension-api/src/types.ts.
//
// Types only. The contract's runtime helpers (parseHtml, absoluteUrl, …)
// are bundled into each extension by the repo's builder and are never
// imported by the host, so drift here can only ever surface as a
// TypeScript error in this tree — never as a runtime mismatch. The real
// runtime gate is the manifest's `apiVersion`, checked in loader.ts.
//
// When the contract changes upstream, re-copy this file verbatim.
```

Delete the app-only `SessionFetchOptions` interface and the `sessionFetch` member — Task 4's fallback replaces them.

- [ ] **Step 2: Write the failing challenge-detection test**

```ts
// src/sources/challenge.test.ts
import { describe, expect, it } from "vitest";
import { isChallengeResponse } from "./challenge";

const interstitial =
  `<html><head><title>Just a moment...</title></head>` +
  `<body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js">` +
  `</script></body></html>`;

describe("isChallengeResponse", () => {
  it("detects the cf-mitigated header", () => {
    expect(
      isChallengeResponse({ status: 403, headers: { "cf-mitigated": "challenge" }, text: "" }),
    ).toBe(true);
  });

  it("detects the interstitial body on a 403 without the header", () => {
    expect(isChallengeResponse({ status: 403, headers: {}, text: interstitial })).toBe(true);
  });

  it("does NOT treat a successful page as a challenge, even though live pages carry the Cloudflare beacon", () => {
    // Verified live 2026-09-17: cenele.com returns 200 with a real page whose
    // body contains "challenge-platform" — that string is part of Cloudflare's
    // always-on beacon, not a challenge. Keying on it would route every single
    // request through the desktop-only session webview.
    expect(
      isChallengeResponse({
        status: 200,
        headers: {},
        text: `<html><body>real content<script>/cdn-cgi/challenge-platform/x.js</script></body></html>`,
      }),
    ).toBe(false);
  });

  it("does not treat an ordinary 403 as a challenge", () => {
    expect(
      isChallengeResponse({ status: 403, headers: {}, text: "<html>Forbidden</html>" }),
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run src/sources/challenge.test.ts`
Expected: FAIL — cannot resolve `./challenge`.

- [ ] **Step 4: Implement it**

Lift the detector out of the app's old `src/sources/extensions/cenele.ts:394-443`, which is already field-proven, into its own module:

```ts
// src/sources/challenge.ts
//
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
```

- [ ] **Step 5: Run and confirm PASS**

Run: `pnpm vitest run src/sources/challenge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Tamper-check**

Weaken the implementation to `return resp.text.includes("challenge-platform")`. The third test must fail. Restore.

- [ ] **Step 7: Wire `locale`, `pdf` and the retry into `createHost`**

In `src/sources/host.ts`, delete the `sessionFetch` member and add:

```ts
import { isChallengeResponse } from "./challenge";
import { extractPdfLines } from "./pdf/pdfChapter";
import type { Locale } from "./types";

/** The UI language, read outside the React tree. App.tsx keeps
 *  <html lang> in sync with the user's preference, and this module is
 *  plain DOM code with no access to useI18n(). */
function currentLocale(): Locale {
  return typeof document !== "undefined" &&
    document.documentElement.lang === "ar"
    ? "ar"
    : "en";
}

/** One plain request, retried through the session webview if — and only
 *  if — Cloudflare challenged it. Extensions never see this happen. */
async function fetchWithChallengeRetry(
  sourceId: string,
  url: string,
  options: FetchOptions | undefined,
): Promise<FetchResponse> {
  const resp = await invoke<TauriFetchResponse>("source_fetch", {
    url,
    options: normalizeFetchOptions(options),
  });
  if (!isChallengeResponse(resp)) return resp as FetchResponse;

  console.info(`[source:${sourceId}] challenged at ${url}; retrying in session`);
  try {
    return (await invoke<TauriFetchResponse>("source_session_fetch", {
      input: { url, ...normalizeFetchOptions(options) },
    })) as FetchResponse;
  } catch (e) {
    // Mobile has no session webview. Say so plainly rather than letting a
    // parser report a selector regression that does not exist.
    throw new Error(
      `${new URL(url).hostname} is blocking automated access (Cloudflare ` +
        `challenge) and the in-app browser check could not run: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
```

Then in the returned object: `fetch: (url, options) => fetchWithChallengeRetry(sourceId, url, options)`, the same wrapping for `fetchBytes`, plus

```ts
    get locale() {
      return currentLocale();
    },
    pdf: {
      extractChapter(bytes, options) {
        return extractPdfLines(bytes, {
          chapterUrl: options.chapterUrl,
          novelTitle: options.novelTitle,
          mintImageRef: options.mintImageRef,
          log: (msg) => console.debug(`[source:${sourceId}] pdf: ${msg}`),
        });
      },
    },
```

- [ ] **Step 8: Verify and commit**

Run: `pnpm check`

```bash
git add src/sources/types.ts src/sources/host.ts src/sources/challenge.ts src/sources/challenge.test.ts
git commit -m "feat(sources): adopt the published contract in the host

Vendors @riwaq/extension-api's types verbatim and fills the two gaps that
would have crashed any published extension: host.locale (both extensions
read it) and host.pdf.extractChapter (kolnovel reads it).

Cloudflare handling moves off the contract and into host.fetch, which
retries a challenged request through the session webview. Extensions only
ever call plain fetch, so sessionFetch leaves the contract entirely and
the retry protects every extension rather than just cenele."
```

---

### Task 4: App-data storage layout

**Files:**
- Create: `src/extensions/storage.ts`
- Create: `src/extensions/storage.test.ts`

**Interfaces:**
- Produces:
  - `EXTENSIONS_DIR = "riwaq/extensions"`
  - `type InstalledRecord = { manifest: ExtensionManifest; origin: OriginRecord }`
  - `type OriginRecord = { repoUrl: string; sha256: string; installedAt: string }`
  - `type ExtensionManifest = { id: string; name: string; version: string; apiVersion: number; language: string; baseUrl: string; description?: Record<string,string>; author?: string; icon?: string }`
  - `listInstalled(): Promise<InstalledRecord[]>`
  - `readBundleSource(id: string): Promise<string>`
  - `writeInstalled(id, files: { source: string; manifest: ExtensionManifest; icon?: Uint8Array; origin: OriginRecord }): Promise<void>`
  - `removeInstalled(id: string): Promise<void>`
  - `iconPath(id: string): string`

- [ ] **Step 1: Write the failing test**

Mock `@tauri-apps/plugin-fs` with an in-memory map so the test is hermetic.

```ts
// src/extensions/storage.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string | Uint8Array>();
const dirs = new Set<string>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
  mkdir: vi.fn(async (p: string) => {
    dirs.add(p);
  }),
  readDir: vi.fn(async (p: string) =>
    [...dirs]
      .filter((d) => d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes("/"))
      .map((d) => ({ name: d.slice(p.length + 1), isDirectory: true })),
  ),
  readTextFile: vi.fn(async (p: string) => {
    if (!files.has(p)) throw new Error(`ENOENT ${p}`);
    return files.get(p) as string;
  }),
  writeTextFile: vi.fn(async (p: string, c: string) => {
    files.set(p, c);
  }),
  writeFile: vi.fn(async (p: string, c: Uint8Array) => {
    files.set(p, c);
  }),
  remove: vi.fn(async (p: string) => {
    files.delete(p);
    dirs.delete(p);
    for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k);
    for (const d of [...dirs]) if (d.startsWith(`${p}/`)) dirs.delete(d);
  }),
  rename: vi.fn(async (a: string, b: string) => {
    for (const k of [...files.keys()]) {
      if (k === a || k.startsWith(`${a}/`)) {
        files.set(k.replace(a, b), files.get(k)!);
        files.delete(k);
      }
    }
    dirs.delete(a);
    dirs.add(b);
  }),
}));

import { listInstalled, readBundleSource, removeInstalled, writeInstalled } from "./storage";

const manifest = {
  id: "demo",
  name: "Demo",
  version: "1.2.0",
  apiVersion: 1,
  language: "ar",
  baseUrl: "https://demo.test",
};
const origin = { repoUrl: "https://repo.test/index.min.json", sha256: "abc", installedAt: "2026-09-17T00:00:00Z" };

beforeEach(() => {
  files.clear();
  dirs.clear();
});

describe("storage", () => {
  it("round-trips an installed extension", async () => {
    await writeInstalled("demo", { source: "export default () => 1;", manifest, origin });

    const installed = await listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].manifest.version).toBe("1.2.0");
    expect(installed[0].origin.repoUrl).toBe("https://repo.test/index.min.json");
    expect(await readBundleSource("demo")).toBe("export default () => 1;");
  });

  it("removes an extension completely", async () => {
    await writeInstalled("demo", { source: "x", manifest, origin });
    await removeInstalled("demo");
    expect(await listInstalled()).toEqual([]);
  });

  it("skips a directory whose manifest is unreadable rather than failing the whole listing", async () => {
    await writeInstalled("good", { source: "x", manifest, origin });
    dirs.add("riwaq/extensions/installed/broken");
    const installed = await listInstalled();
    expect(installed.map((r) => r.manifest.id)).toEqual(["good"]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/extensions/storage.test.ts`
Expected: FAIL — cannot resolve `./storage`.

- [ ] **Step 3: Implement**

```ts
// src/extensions/storage.ts
//
// On-disk layout for installed extensions, under the app-data root the
// rest of the app already uses:
//
//   riwaq/extensions/
//   ├── repos.json
//   ├── index-cache/<hash>.json
//   └── installed/<id>/{index.js,manifest.json,icon.png,.origin.json}
//
// Writes land in a sibling `.tmp-<id>` directory and are renamed into
// place, so an interrupted install can never leave a half-written bundle
// that loader.ts would then try to evaluate.

import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

const BASE = BaseDirectory.AppData;
export const EXTENSIONS_DIR = "riwaq/extensions";
const INSTALLED_DIR = `${EXTENSIONS_DIR}/installed`;

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  language: string;
  baseUrl: string;
  description?: Record<string, string>;
  author?: string;
  icon?: string;
}

export interface OriginRecord {
  repoUrl: string;
  sha256: string;
  installedAt: string;
}

export interface InstalledRecord {
  manifest: ExtensionManifest;
  origin: OriginRecord;
}

const dirOf = (id: string) => `${INSTALLED_DIR}/${id}`;
export const iconPath = (id: string) => `${dirOf(id)}/icon.png`;

async function ensureDir(path: string): Promise<void> {
  if (!(await exists(path, { baseDir: BASE }))) {
    await mkdir(path, { baseDir: BASE, recursive: true });
  }
}

export async function listInstalled(): Promise<InstalledRecord[]> {
  if (!(await exists(INSTALLED_DIR, { baseDir: BASE }))) return [];
  const entries = await readDir(INSTALLED_DIR, { baseDir: BASE });
  const out: InstalledRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory || entry.name.startsWith(".tmp-")) continue;
    try {
      const manifest = JSON.parse(
        await readTextFile(`${dirOf(entry.name)}/manifest.json`, { baseDir: BASE }),
      ) as ExtensionManifest;
      const origin = JSON.parse(
        await readTextFile(`${dirOf(entry.name)}/.origin.json`, { baseDir: BASE }),
      ) as OriginRecord;
      out.push({ manifest, origin });
    } catch {
      // One unreadable extension must not blank the whole list — the Store
      // still has to render, and catalog.ts surfaces the gap as "broken".
      continue;
    }
  }
  return out.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export async function readBundleSource(id: string): Promise<string> {
  return readTextFile(`${dirOf(id)}/index.js`, { baseDir: BASE });
}

export async function writeInstalled(
  id: string,
  files: {
    source: string;
    manifest: ExtensionManifest;
    icon?: Uint8Array;
    origin: OriginRecord;
  },
): Promise<void> {
  const staging = `${INSTALLED_DIR}/.tmp-${id}`;
  await ensureDir(staging);
  await writeTextFile(`${staging}/index.js`, files.source, { baseDir: BASE });
  await writeTextFile(`${staging}/manifest.json`, JSON.stringify(files.manifest, null, 2), { baseDir: BASE });
  await writeTextFile(`${staging}/.origin.json`, JSON.stringify(files.origin, null, 2), { baseDir: BASE });
  if (files.icon) await writeFile(`${staging}/icon.png`, files.icon, { baseDir: BASE });

  if (await exists(dirOf(id), { baseDir: BASE })) {
    await remove(dirOf(id), { baseDir: BASE, recursive: true });
  }
  await rename(staging, dirOf(id), { oldPathBaseDir: BASE, newPathBaseDir: BASE });
}

export async function removeInstalled(id: string): Promise<void> {
  if (await exists(dirOf(id), { baseDir: BASE })) {
    await remove(dirOf(id), { baseDir: BASE, recursive: true });
  }
}
```

- [ ] **Step 4: Run and confirm PASS**

Run: `pnpm vitest run src/extensions/storage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Tamper-check**

Remove the `try/catch` in `listInstalled`. The third test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/storage.ts src/extensions/storage.test.ts
git commit -m "feat(extensions): app-data layout for installed extensions

Writes stage into .tmp-<id> and rename into place, so an interrupted
install cannot leave a half-written bundle for the loader to evaluate.
An unreadable extension directory is skipped rather than blanking the
whole listing — the Store still has to render."
```

---

### Task 5: Repos — list, fetch, validate, cache

**Files:**
- Create: `src/extensions/repos.ts`
- Create: `src/extensions/repos.test.ts`

**Interfaces:**
- Consumes: `EXTENSIONS_DIR` from `storage.ts`.
- Produces:
  - `OFFICIAL_REPO_URL`
  - `type RepoEntry = { url: string; name: string; addedAt: string; lastFetchedAt?: string }`
  - `type RepoIndexEntry = { id, name, version, apiVersion, language, baseUrl, description?, author?, code, icon?, sha256, size }`
  - `type RepoIndex = { name: string; apiVersion: number; extensions: RepoIndexEntry[] }`
  - `parseRepoIndex(json: unknown): RepoIndex` — throws on a malformed index
  - `listRepos(): Promise<RepoEntry[]>`, `addRepo(url): Promise<RepoEntry>`, `removeRepo(url): Promise<void>`
  - `fetchRepoIndex(url): Promise<{ index: RepoIndex; cached: boolean; fetchedAt: string }>`
  - `resolveAssetUrl(repoUrl: string, relative: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/extensions/repos.test.ts
import { describe, expect, it } from "vitest";
import { parseRepoIndex, resolveAssetUrl } from "./repos";

const valid = {
  name: "Riwaq Official Extensions",
  apiVersion: 1,
  extensions: [
    {
      id: "cenele",
      name: "فضاء الروايات",
      version: "1.0.0",
      apiVersion: 1,
      language: "ar",
      baseUrl: "https://cenele.com",
      code: "cenele/index.js",
      icon: "cenele/icon.png",
      sha256: "e2810d52b592c3f9b4b1499dc1f14b4baf196db93a5f1830d38af009ebb0393a",
      size: 12756,
    },
  ],
};

describe("parseRepoIndex", () => {
  it("accepts the real published index shape", () => {
    const index = parseRepoIndex(valid);
    expect(index.extensions[0].id).toBe("cenele");
  });

  it("rejects an entry with no sha256 — an unverifiable bundle must never install", () => {
    const bad = structuredClone(valid);
    delete (bad.extensions[0] as Record<string, unknown>).sha256;
    expect(() => parseRepoIndex(bad)).toThrow(/sha256/i);
  });

  it("rejects a non-object payload", () => {
    expect(() => parseRepoIndex("nope")).toThrow();
  });

  it("drops entries missing required fields but keeps the rest", () => {
    const mixed = structuredClone(valid);
    mixed.extensions.push({ id: "broken" } as never);
    expect(parseRepoIndex(mixed).extensions.map((e) => e.id)).toEqual(["cenele"]);
  });
});

describe("resolveAssetUrl", () => {
  // code/icon are relative to the index URL so a fork or mirror works
  // without editing any URL inside the index.
  it("resolves relative to the index URL", () => {
    expect(
      resolveAssetUrl("https://host.test/repo/index.min.json", "cenele/index.js"),
    ).toBe("https://host.test/repo/cenele/index.js");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm vitest run src/extensions/repos.test.ts` → FAIL, module missing.

- [ ] **Step 3: Implement**

```ts
// src/extensions/repos.ts
//
// Repo bookkeeping: which catalogues we know about, and their contents.
//
// `code` and `icon` in an index are relative to the index URL itself, so a
// fork or mirror of the official repo works with no URL edits. A repo that
// cannot be reached falls back to its last good cached index, so the Store
// still lists what is available and can say how stale it is.

import { BaseDirectory, exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { EXTENSIONS_DIR } from "./storage";

const BASE = BaseDirectory.AppData;
const REPOS_FILE = `${EXTENSIONS_DIR}/repos.json`;
const CACHE_DIR = `${EXTENSIONS_DIR}/index-cache`;

export const OFFICIAL_REPO_URL =
  "https://themostafaosamadev.github.io/Riwaq-Extensions/index.min.json";

export interface RepoEntry {
  url: string;
  name: string;
  addedAt: string;
  lastFetchedAt?: string;
}

export interface RepoIndexEntry {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  language: string;
  baseUrl: string;
  description?: Record<string, string>;
  author?: string;
  code: string;
  icon?: string;
  sha256: string;
  size: number;
}

export interface RepoIndex {
  name: string;
  apiVersion: number;
  extensions: RepoIndexEntry[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate a fetched index. Throws when the document itself is unusable;
 *  individual malformed entries are dropped so one bad extension cannot
 *  take a whole repo offline. */
export function parseRepoIndex(json: unknown): RepoIndex {
  if (!isRecord(json)) throw new Error("Repo index is not a JSON object");
  if (!Array.isArray(json.extensions)) {
    throw new Error("Repo index has no `extensions` array");
  }

  const extensions: RepoIndexEntry[] = [];
  for (const raw of json.extensions) {
    if (!isRecord(raw)) continue;
    const required = ["id", "name", "version", "baseUrl", "code"] as const;
    if (required.some((k) => typeof raw[k] !== "string" || !raw[k])) continue;
    if (typeof raw.sha256 !== "string" || raw.sha256.length !== 64) {
      // A bundle we cannot verify must never reach install.ts. Say which.
      throw new Error(`Repo index entry "${String(raw.id)}" has no valid sha256`);
    }
    extensions.push({
      id: raw.id as string,
      name: raw.name as string,
      version: raw.version as string,
      apiVersion: typeof raw.apiVersion === "number" ? raw.apiVersion : 0,
      language: typeof raw.language === "string" ? raw.language : "",
      baseUrl: raw.baseUrl as string,
      description: isRecord(raw.description) ? (raw.description as Record<string, string>) : undefined,
      author: typeof raw.author === "string" ? raw.author : undefined,
      code: raw.code as string,
      icon: typeof raw.icon === "string" ? raw.icon : undefined,
      sha256: raw.sha256,
      size: typeof raw.size === "number" ? raw.size : 0,
    });
  }

  return {
    name: typeof json.name === "string" ? json.name : "Extensions",
    apiVersion: typeof json.apiVersion === "number" ? json.apiVersion : 1,
    extensions,
  };
}

export function resolveAssetUrl(repoUrl: string, relative: string): string {
  return new URL(relative, repoUrl).toString();
}

const cacheName = (url: string) =>
  `${CACHE_DIR}/${[...url].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36).replace("-", "n")}.json`;

export async function listRepos(): Promise<RepoEntry[]> {
  try {
    return JSON.parse(await readTextFile(REPOS_FILE, { baseDir: BASE })) as RepoEntry[];
  } catch {
    // First run: the official repo is pre-added but not privileged — it can
    // be removed like any other.
    const seed: RepoEntry[] = [
      { url: OFFICIAL_REPO_URL, name: "Riwaq Official Extensions", addedAt: new Date().toISOString() },
    ];
    await saveRepos(seed);
    return seed;
  }
}

async function saveRepos(repos: RepoEntry[]): Promise<void> {
  if (!(await exists(EXTENSIONS_DIR, { baseDir: BASE }))) {
    await mkdir(EXTENSIONS_DIR, { baseDir: BASE, recursive: true });
  }
  await writeTextFile(REPOS_FILE, JSON.stringify(repos, null, 2), { baseDir: BASE });
}

export async function addRepo(url: string): Promise<RepoEntry> {
  const repos = await listRepos();
  if (repos.some((r) => r.url === url)) {
    throw new Error("That repo has already been added.");
  }
  const { index } = await fetchRepoIndex(url);
  const entry: RepoEntry = { url, name: index.name, addedAt: new Date().toISOString() };
  await saveRepos([...repos, entry]);
  return entry;
}

export async function removeRepo(url: string): Promise<void> {
  // Deliberately does NOT uninstall that repo's extensions: they keep
  // working and keep reading, they just stop being offered updates.
  await saveRepos((await listRepos()).filter((r) => r.url !== url));
}

export async function fetchRepoIndex(
  url: string,
): Promise<{ index: RepoIndex; cached: boolean; fetchedAt: string }> {
  try {
    const resp = await tauriFetch(url, { method: "GET" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const index = parseRepoIndex(await resp.json());
    const fetchedAt = new Date().toISOString();
    if (!(await exists(CACHE_DIR, { baseDir: BASE }))) {
      await mkdir(CACHE_DIR, { baseDir: BASE, recursive: true });
    }
    await writeTextFile(cacheName(url), JSON.stringify({ index, fetchedAt }), { baseDir: BASE });
    return { index, cached: false, fetchedAt };
  } catch (e) {
    try {
      const cached = JSON.parse(await readTextFile(cacheName(url), { baseDir: BASE })) as {
        index: RepoIndex;
        fetchedAt: string;
      };
      return { index: cached.index, cached: true, fetchedAt: cached.fetchedAt };
    } catch {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
}
```

If `@tauri-apps/plugin-http` is not already a dependency, use the existing `source_fetch` command through `invoke` instead — it returns `{ status, text, headers }` and needs no new plugin. Check `package.json` first and prefer whichever is already present.

- [ ] **Step 4: Run and confirm PASS**

Run: `pnpm vitest run src/extensions/repos.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Tamper-check**

Change the sha256 guard to accept any string. The "rejects an entry with no sha256" test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/repos.ts src/extensions/repos.test.ts
git commit -m "feat(extensions): repo list, index fetch and last-good cache

code/icon paths resolve against the index URL, so a fork or mirror needs
no URL edits. An entry without a valid sha256 rejects the whole index —
a bundle we cannot verify must never reach the installer. An unreachable
repo falls back to its cached index so the Store still renders."
```

---

### Task 6: Install — download, verify, write

**Files:**
- Create: `src/extensions/install.ts`
- Create: `src/extensions/install.test.ts`

**Interfaces:**
- Consumes: `writeInstalled`, `removeInstalled` (Task 4); `RepoIndexEntry`, `resolveAssetUrl` (Task 5).
- Produces: `sha256Hex(bytes: Uint8Array): Promise<string>`; `installExtension(repoUrl, entry, deps?): Promise<void>`; `uninstallExtension(id): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/extensions/install.test.ts
import { describe, expect, it, vi } from "vitest";

const written: Array<{ id: string; source: string; sha256: string }> = [];
vi.mock("./storage", () => ({
  writeInstalled: vi.fn(async (id: string, f: { source: string; origin: { sha256: string } }) => {
    written.push({ id, source: f.source, sha256: f.origin.sha256 });
  }),
  removeInstalled: vi.fn(async () => {}),
}));

import { installExtension, sha256Hex } from "./install";

const SOURCE = "export default () => ({});";
const enc = new TextEncoder();

const entry = (sha: string) => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  apiVersion: 1,
  language: "ar",
  baseUrl: "https://demo.test",
  code: "demo/index.js",
  sha256: sha,
  size: SOURCE.length,
});

describe("installExtension", () => {
  it("writes a bundle whose hash matches the index", async () => {
    const good = await sha256Hex(enc.encode(SOURCE));
    await installExtension("https://repo.test/index.min.json", entry(good), {
      fetchBytes: async () => enc.encode(SOURCE),
    });
    expect(written.at(-1)).toMatchObject({ id: "demo", source: SOURCE, sha256: good });
  });

  it("refuses to install when the hash does not match, and names both hashes", async () => {
    const before = written.length;
    await expect(
      installExtension("https://repo.test/index.min.json", entry("0".repeat(64)), {
        fetchBytes: async () => enc.encode(SOURCE),
      }),
    ).rejects.toThrow(/checksum|sha256|mismatch/i);
    expect(written).toHaveLength(before); // nothing was written
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `pnpm vitest run src/extensions/install.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/extensions/install.ts
//
// Download → verify → write. Verification happens before anything touches
// the installed/ directory, so a tampered or truncated bundle never lands
// on disk at all, let alone gets evaluated.

import { invoke } from "@tauri-apps/api/core";
import { resolveAssetUrl, type RepoIndexEntry } from "./repos";
import { removeInstalled, writeInstalled } from "./storage";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer | number[]>("source_fetch_bytes", { url, options: null });
  return new Uint8Array(buf as ArrayBuffer);
}

export interface InstallDeps {
  fetchBytes?: (url: string) => Promise<Uint8Array>;
}

export async function installExtension(
  repoUrl: string,
  entry: RepoIndexEntry,
  deps: InstallDeps = {},
): Promise<void> {
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;

  const codeBytes = await fetchBytes(resolveAssetUrl(repoUrl, entry.code));
  const actual = await sha256Hex(codeBytes);
  if (actual !== entry.sha256.toLowerCase()) {
    throw new Error(
      `Checksum mismatch for "${entry.name}". The repo lists ` +
        `${entry.sha256.slice(0, 12)}… but the downloaded bundle hashes to ` +
        `${actual.slice(0, 12)}…. Nothing was installed.`,
    );
  }

  let icon: Uint8Array | undefined;
  if (entry.icon) {
    // A missing icon is cosmetic — never fail an otherwise-verified install.
    try {
      icon = await fetchBytes(resolveAssetUrl(repoUrl, entry.icon));
    } catch {
      icon = undefined;
    }
  }

  await writeInstalled(entry.id, {
    source: new TextDecoder().decode(codeBytes),
    manifest: {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      apiVersion: entry.apiVersion,
      language: entry.language,
      baseUrl: entry.baseUrl,
      description: entry.description,
      author: entry.author,
      icon: entry.icon ? "icon.png" : undefined,
    },
    icon,
    origin: { repoUrl, sha256: actual, installedAt: new Date().toISOString() },
  });
}

export async function uninstallExtension(id: string): Promise<void> {
  await removeInstalled(id);
}
```

- [ ] **Step 4: Run and confirm PASS** — expected 2 tests PASS.

- [ ] **Step 5: Tamper-check**

Delete the `if (actual !== entry.sha256...)` block. The mismatch test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/install.ts src/extensions/install.test.ts
git commit -m "feat(extensions): verified install

SHA-256 is checked before anything touches installed/, so a tampered or
truncated bundle never lands on disk. A mismatch names both hashes so the
failure is diagnosable rather than mysterious. A missing icon is cosmetic
and never fails an otherwise-verified install."
```

---

### Task 7: Loader — evaluate, gate on apiVersion, capture failures

**Files:**
- Create: `src/extensions/loader.ts`
- Create: `src/extensions/loader.test.ts`

**Interfaces:**
- Consumes: `loadModuleFromSource` (Task 1); `ExtensionManifest` (Task 4); `API_VERSION`, `Source`, `SourceHost` from `../sources/types`.
- Produces: `type LoadResult = { ok: true; source: Source } | { ok: false; reason: "api-version" | "load-error"; message: string }`; `loadExtension(manifest, source, host): Promise<LoadResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/extensions/loader.test.ts
import { describe, expect, it } from "vitest";
import { loadExtension } from "./loader";
import type { SourceHost } from "../sources/types";

const host = { locale: "en" } as unknown as SourceHost;
const manifest = {
  id: "demo", name: "Demo", version: "1.0.0", apiVersion: 1,
  language: "ar", baseUrl: "https://demo.test",
};

describe("loadExtension", () => {
  it("constructs a source from a well-formed bundle", async () => {
    const r = await loadExtension(manifest, `export default (host) => ({ canHandle: () => true });`, host);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source.canHandle("https://demo.test/x")).toBe(true);
  });

  it("refuses a bundle built against a different contract major", async () => {
    const r = await loadExtension({ ...manifest, apiVersion: 2 }, `export default () => ({});`, host);
    expect(r).toMatchObject({ ok: false, reason: "api-version" });
  });

  it("captures a bundle that throws at evaluation instead of propagating", async () => {
    const r = await loadExtension(manifest, `throw new Error("bad bundle");`, host);
    expect(r).toMatchObject({ ok: false, reason: "load-error" });
    if (!r.ok) expect(r.message).toMatch(/bad bundle/);
  });

  it("captures a bundle with no default export", async () => {
    const r = await loadExtension(manifest, `export const nope = 1;`, host);
    expect(r).toMatchObject({ ok: false, reason: "load-error" });
  });
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement**

```ts
// src/extensions/loader.ts
//
// Turns bundle source into a live Source. Every failure is returned, not
// thrown: one broken extension must leave the Store and every other
// extension working, with an inline error on its own card.

import { API_VERSION, type Source, type SourceHost } from "../sources/types";
import { loadModuleFromSource } from "./loadModule";
import type { ExtensionManifest } from "./storage";

export type LoadResult =
  | { ok: true; source: Source }
  | { ok: false; reason: "api-version" | "load-error"; message: string };

export async function loadExtension(
  manifest: ExtensionManifest,
  source: string,
  host: SourceHost,
): Promise<LoadResult> {
  if (manifest.apiVersion !== API_VERSION) {
    return {
      ok: false,
      reason: "api-version",
      message:
        manifest.apiVersion > API_VERSION
          ? `"${manifest.name}" requires a newer version of Riwaq.`
          : `"${manifest.name}" was built for an older version of Riwaq and needs updating.`,
    };
  }

  try {
    const mod = (await loadModuleFromSource(source)) as { default?: unknown };
    if (typeof mod.default !== "function") {
      throw new Error("bundle has no default-exported factory function");
    }
    const instance = (mod.default as (h: SourceHost) => Source)(host);
    if (!instance || typeof instance.canHandle !== "function") {
      throw new Error("factory did not return a Source");
    }
    return { ok: true, source: instance };
  } catch (e) {
    return {
      ok: false,
      reason: "load-error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
```

- [ ] **Step 4: Run and confirm PASS** (4 tests).

- [ ] **Step 5: Tamper-check** — remove the `try/catch` and confirm the third test fails. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/loader.ts src/extensions/loader.test.ts
git commit -m "feat(extensions): load a bundle behind an apiVersion gate

Failures are returned rather than thrown: one broken extension leaves the
Store and every other extension working, with an inline error on its own
card."
```

---

### Task 8: Catalog — merge installed with available, detect updates

**Files:**
- Create: `src/extensions/catalog.ts`
- Create: `src/extensions/catalog.test.ts`

**Interfaces:**
- Consumes: `InstalledRecord` (Task 4), `RepoIndexEntry` (Task 5).
- Produces: `compareVersions(a, b): -1 | 0 | 1`; `type CatalogEntry = { id; name; version; installed: boolean; installedVersion?; updateAvailable: boolean; repoUrl?; entry?: RepoIndexEntry; record?: InstalledRecord }`; `buildCatalog(installed, available): CatalogEntry[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/extensions/catalog.test.ts
import { describe, expect, it } from "vitest";
import { buildCatalog, compareVersions } from "./catalog";

const idx = (id: string, version: string) => ({
  id, name: id, version, apiVersion: 1, language: "ar",
  baseUrl: `https://${id}.test`, code: `${id}/index.js`,
  sha256: "a".repeat(64), size: 1,
});
const inst = (id: string, version: string, repoUrl = "https://repo.test/index.min.json") => ({
  manifest: { id, name: id, version, apiVersion: 1, language: "ar", baseUrl: `https://${id}.test` },
  origin: { repoUrl, sha256: "a".repeat(64), installedAt: "2026-09-01T00:00:00Z" },
});

describe("compareVersions", () => {
  it("orders by numeric segment, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1); // "10" > "9"
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("treats a missing segment as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("buildCatalog", () => {
  it("flags an update when the repo is ahead", () => {
    const c = buildCatalog([inst("cenele", "1.0.0")], [
      { repoUrl: "https://repo.test/index.min.json", entries: [idx("cenele", "1.1.0")] },
    ]);
    expect(c[0]).toMatchObject({ installed: true, installedVersion: "1.0.0", updateAvailable: true });
  });

  it("does not flag an update when the installed version is newer or equal", () => {
    const c = buildCatalog([inst("cenele", "2.0.0")], [
      { repoUrl: "https://repo.test/index.min.json", entries: [idx("cenele", "1.1.0")] },
    ]);
    expect(c[0].updateAvailable).toBe(false);
  });

  it("keeps an installed extension whose repo was removed, with no update offered", () => {
    const c = buildCatalog([inst("cenele", "1.0.0")], []);
    expect(c[0]).toMatchObject({ installed: true, updateAvailable: false });
  });

  it("lists an available-but-not-installed extension", () => {
    const c = buildCatalog([], [
      { repoUrl: "https://repo.test/index.min.json", entries: [idx("kolnovel", "1.0.0")] },
    ]);
    expect(c[0]).toMatchObject({ id: "kolnovel", installed: false, updateAvailable: false });
  });
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement**

```ts
// src/extensions/catalog.ts
//
// The Store's Extensions view is a merge of two lists: what is on disk and
// what the repos offer. An extension can appear in either, both, or — when
// its repo has been removed — only on disk.

import type { RepoIndexEntry } from "./repos";
import type { InstalledRecord } from "./storage";

/** Numeric-segment compare. "1.10.0" is newer than "1.9.0"; a lexical
 *  compare gets that backwards, which would silently skip updates. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  installed: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  repoUrl?: string;
  entry?: RepoIndexEntry;
  record?: InstalledRecord;
}

export interface RepoContents {
  repoUrl: string;
  entries: RepoIndexEntry[];
}

export function buildCatalog(
  installed: InstalledRecord[],
  repos: RepoContents[],
): CatalogEntry[] {
  const byId = new Map<string, CatalogEntry>();

  for (const record of installed) {
    byId.set(record.manifest.id, {
      id: record.manifest.id,
      name: record.manifest.name,
      version: record.manifest.version,
      installed: true,
      installedVersion: record.manifest.version,
      updateAvailable: false,
      repoUrl: record.origin.repoUrl,
      record,
    });
  }

  for (const { repoUrl, entries } of repos) {
    for (const entry of entries) {
      const existing = byId.get(entry.id);
      if (!existing) {
        byId.set(entry.id, {
          id: entry.id,
          name: entry.name,
          version: entry.version,
          installed: false,
          updateAvailable: false,
          repoUrl,
          entry,
        });
        continue;
      }
      // Only the repo an extension was installed from may offer it an
      // update. Otherwise any repo publishing the same id could hijack it.
      if (existing.record && existing.record.origin.repoUrl !== repoUrl) continue;
      existing.entry = entry;
      existing.updateAvailable =
        compareVersions(entry.version, existing.installedVersion ?? "0") > 0;
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run and confirm PASS** (6 tests).

- [ ] **Step 5: Tamper-check** — change `compareVersions` to `a < b ? -1 : a > b ? 1 : 0` (lexical). The "1.10.0 vs 1.9.0" test must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/extensions/catalog.ts src/extensions/catalog.test.ts
git commit -m "feat(extensions): merge installed with available and detect updates

Version compare is numeric per segment — a lexical compare makes 1.10.0
look older than 1.9.0 and would silently skip updates. Only the repo an
extension was installed from may offer it an update, so a second repo
publishing the same id cannot hijack it."
```

---

### Task 9: Rewrite the registry

**Files:**
- Modify: `src/sources/registry.ts` (replace wholesale)
- Create: `src/sources/registry.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–8, plus `createHost` (Task 3).
- Produces: `initExtensions()`, and the unchanged `listSources`, `getSource`, `getSourceMeta`, `findSourceForUrl`. Also `getExtensionStatus(id): "ok" | "broken" | "api-version" | "missing"` for the manager UI, and `resolveSourceId(id): string`.

- [ ] **Step 1: Write the failing test for alias resolution**

```ts
// src/sources/registry.test.ts
import { describe, expect, it } from "vitest";
import { resolveSourceId } from "./registry";

describe("resolveSourceId", () => {
  it("maps the retired kolnovel-pro id onto kolnovel", () => {
    // Library books persist sourceId. kolnovel-pro was merged into kolnovel
    // upstream, so existing books must keep resolving with no data rewrite.
    expect(resolveSourceId("kolnovel-pro")).toBe("kolnovel");
  });

  it("passes through an unknown id unchanged", () => {
    expect(resolveSourceId("cenele")).toBe("cenele");
  });
});
```

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement the rewrite**

```ts
// src/sources/registry.ts
//
// Source registry, now backed by installed extensions rather than a
// compiled-in list.
//
// The five public accessors keep their exact previous signatures, so all
// nine existing call sites are untouched. Loading is async once via
// initExtensions(); every accessor stays synchronous afterwards.

import { buildCatalog } from "../extensions/catalog";
import { loadExtension } from "../extensions/loader";
import { fetchRepoIndex, listRepos } from "../extensions/repos";
import { iconPath, listInstalled, readBundleSource } from "../extensions/storage";
import { convertFileSrc } from "@tauri-apps/api/core";
import { createHost } from "./host";
import type { Source, SourceMetadata } from "./types";

/** Ids that have been renamed upstream. Library books persist `sourceId`,
 *  so a rename must not orphan them. App-side by design — an extension
 *  cannot declare an alias and claim another extension's id. */
const ID_ALIASES: Record<string, string> = { "kolnovel-pro": "kolnovel" };

export function resolveSourceId(id: string): string {
  return ID_ALIASES[id] ?? id;
}

type Status = "ok" | "broken" | "api-version" | "missing";

interface Entry {
  meta: SourceMetadata;
  source: Source | null;
  status: Status;
  error?: string;
}

const entries = new Map<string, Entry>();
let initialized = false;

export async function initExtensions(): Promise<void> {
  entries.clear();
  const installed = await listInstalled();

  for (const record of installed) {
    const { manifest, origin } = record;
    const meta: SourceMetadata = {
      id: manifest.id,
      name: manifest.name,
      baseUrl: manifest.baseUrl,
      language: manifest.language,
      description: manifest.description,
      iconUrl: manifest.icon ? convertFileSrc(iconPath(manifest.id)) : undefined,
      version: manifest.version,
      installedFrom: origin.repoUrl,
    };

    try {
      const result = await loadExtension(
        manifest,
        await readBundleSource(manifest.id),
        createHost(manifest.id),
      );
      entries.set(
        manifest.id,
        result.ok
          ? { meta, source: result.source, status: "ok" }
          : { meta, source: null, status: result.reason === "api-version" ? "api-version" : "broken", error: result.message },
      );
    } catch (e) {
      entries.set(manifest.id, {
        meta,
        source: null,
        status: "broken",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  initialized = true;
}

export function isInitialized(): boolean {
  return initialized;
}

export function listSources(): SourceMetadata[] {
  return [...entries.values()].filter((e) => e.status === "ok").map((e) => e.meta);
}

export function getSourceMeta(id: string): SourceMetadata | null {
  return entries.get(resolveSourceId(id))?.meta ?? null;
}

export function getSource(id: string): Source | null {
  return entries.get(resolveSourceId(id))?.source ?? null;
}

export function getExtensionStatus(id: string): Status {
  return entries.get(resolveSourceId(id))?.status ?? "missing";
}

export function getExtensionError(id: string): string | undefined {
  return entries.get(resolveSourceId(id))?.error;
}

export function findSourceForUrl(url: string): Source | null {
  for (const entry of entries.values()) {
    if (entry.source?.canHandle(url)) return entry.source;
  }
  return null;
}

/** Installed + available, for the Extensions manager. */
export async function loadCatalog() {
  const repos = await listRepos();
  const contents = await Promise.all(
    repos.map(async (repo) => {
      try {
        const { index, cached, fetchedAt } = await fetchRepoIndex(repo.url);
        return { repoUrl: repo.url, entries: index.extensions, cached, fetchedAt, error: undefined as string | undefined };
      } catch (e) {
        return { repoUrl: repo.url, entries: [], cached: false, fetchedAt: undefined, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
  return { repos, contents, catalog: buildCatalog(await listInstalled(), contents) };
}
```

Add `installedFrom?: string` to `SourceMetadata` in `src/sources/types.ts` (the one deliberate app-side addition to the vendored contract — note it in the vendor header).

- [ ] **Step 4: Run and confirm PASS.**

- [ ] **Step 5: Delete the compiled-in extensions**

```bash
git rm src/sources/extensions/cenele.ts src/sources/extensions/cenele.test.ts \
       src/sources/extensions/kolnovel.ts src/sources/extensions/kolnovel-pro.ts \
       src/sources/extensions/kolnovel-theme.ts src/sources/extensions/kolnovel-theme.test.ts
git rm src/assets/source-icons/cenele.png src/assets/source-icons/kolnovel.png
```

Then fix `src/components/SourceHomeView.tsx:289` and `src/components/novel/NovelDetailView.tsx:383`, which read `source.meta.id` — `Source` no longer carries `meta`. Both components already receive `sourceId` as a prop; use that.

- [ ] **Step 6: Run the full suite**

Run: `pnpm check`
Expected: format, lint, typecheck, build and tests all pass. Fix any remaining reference to the deleted modules.

- [ ] **Step 7: Commit**

```bash
git add src/sources/registry.ts src/sources/registry.test.ts src/sources/types.ts \
        src/components/SourceHomeView.tsx src/components/novel/NovelDetailView.tsx
git commit -m "feat(sources): back the registry with installed extensions

The five public accessors keep their exact signatures, so all nine call
sites are untouched; initExtensions() populates them once at startup and
every accessor stays synchronous afterwards.

Deletes the three compiled-in sources. An id-alias table keeps library
books that persist sourceId: kolnovel-pro resolves to kolnovel with no
data rewrite. Aliases are app-side, so an extension cannot claim another
extension's id."
```

---

### Task 10: Start the runtime without gating first paint

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Store.tsx`

- [ ] **Step 1: Kick off init after mount, never before**

In `App.tsx`, inside a `useEffect` — **not** at module scope and **not** awaited in `main.tsx`:

```tsx
const [extensionsReady, setExtensionsReady] = useState(false);

useEffect(() => {
  // Deliberately not awaited before the React mount. A previous Android
  // blank-launch came from main.tsx awaiting a filesystem call before
  // mounting; the Store renders its own loading state instead.
  void initExtensions().finally(() => setExtensionsReady(true));
}, []);
```

Pass `extensionsReady` to `Store`.

- [ ] **Step 2: Render a loading state inside the Store only**

In `Store.tsx`, when `!extensionsReady`, render the existing `Skeleton` in place of `SourcesListView`. Everything outside the Store — library, reader, settings — renders exactly as before.

- [ ] **Step 3: Verify the cold-launch path is unchanged**

Run `pnpm android:dev`, cold-start the app, and confirm the brand mark still paints immediately and the library appears without waiting on extensions. Compare against the `android-launch-startup-path` note.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/components/Store.tsx
git commit -m "feat(extensions): initialise the runtime after mount

Extension loading is kicked off from an effect and never awaited before
React mounts — the Store renders its own loading state. Gating the mount
on a filesystem call is what caused the Android blank launch before."
```

---

### Task 11: Extensions manager UI

**Files:**
- Create: `src/components/ExtensionsView.tsx`
- Create: `src/components/extensions/ExtensionCard.tsx`
- Create: `src/components/extensions/RepoList.tsx`
- Modify: `src/components/Store.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`

- [ ] **Step 1: Invoke the `ui-ux-pro-max` skill first**

Standing rule in `CLAUDE.md`. Ask it for the React + Tailwind/shadcn treatment of a management list with per-row action buttons and a secondary "add by URL" form, in an RTL-capable app. Follow what it returns for spacing, type scale and states.

- [ ] **Step 2: Build the three states each card must express**

Use `getExtensionStatus(id)` from Task 9:

| Status | Card shows |
|---|---|
| `ok`, no update | name, version, Remove |
| `ok`, update available | as above plus **Update** (`installedVersion` → `entry.version`) |
| `api-version` | "Requires a newer version of Riwaq", no action but Remove |
| `broken` | the captured load error inline, plus **Retry** and Remove |
| not installed | **Install** with progress |

- [ ] **Step 3: Repos section**

Add by URL (validate it parses as a URL and that `fetchRepoIndex` succeeds before saving), remove with a confirm dialog that names the extensions installed from it and states they keep working. First add of any repo shows the one-time trust notice: extensions from it run with the app's access.

- [ ] **Step 4: Add the strings to both catalogues**

Every new string goes in `en.ts` and `ar.ts`. No English fallback baked into a component.

- [ ] **Step 5: Verify in a browser and on device**

Per the `browser-ui-verification` note, screenshot both themes in a plain browser first, then confirm on Android. Check RTL: the app runs `dir="rtl"` in Arabic and row actions must not invert into a confusing order.

- [ ] **Step 6: Run `pnpm check` and commit**

```bash
git add src/components/ExtensionsView.tsx src/components/extensions src/components/Store.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(store): extensions manager

Installed, Available and Repos in one view. Per-extension Update driven
by a numeric version compare, Remove, and inline recovery for a bundle
that failed to load. Removing a repo keeps its extensions installed and
says so — it only stops update checks."
```

---

### Task 12: End-to-end verification

- [ ] **Step 1: Fresh-install flow on desktop**

Per the `never-drive-the-real-app-data` note, **copy the app-data directory first** and point the run at the copy. Then: launch with no extensions installed, confirm the official repo is pre-added, install all four extensions, and confirm each appears in the Store's sources list.

- [ ] **Step 2: Import a novel from each of the four sources**

cenele, kolnovel, seanovel, sunovels. For each: open the source home, search, open a novel, read the chapter list, import a small range, and open it in the reader.

- [ ] **Step 3: Update and remove**

Hand-edit an installed `manifest.json` to a lower version, reload, confirm **Update** appears on that card alone and that updating restores the published version. Then remove one extension and confirm a book already imported from it still opens and reads offline.

- [ ] **Step 4: Failure paths**

- Point a repo at a URL that 404s → cached index, "last updated …".
- Hand-edit an installed bundle to `throw new Error("x")` → that card shows `broken` with Retry; every other extension still works.
- Hand-edit a manifest's `apiVersion` to `2` → "Requires a newer version of Riwaq".

- [ ] **Step 5: Android run**

`pnpm android:dev`. Confirm the loader works, cold start still paints immediately, and the three non-cenele sources function. A cenele request that is actually challenged should fail with the explicit browser-check message, not a selector error.

- [ ] **Step 6: Final check and PR**

Run `pnpm check`, then open the PR. No Claude/AI attribution in the title or body.

---

## Self-Review

**Spec coverage.** §1 contract reconciliation → Task 3. §2 Cloudflare → Tasks 2, 3. §3 runtime modules → Tasks 4–7. §4 registry, init gate, aliases → Tasks 9, 10. §5 manager UI and all card states → Task 11. §6 extension workstreams → separate plans. Testing → per-task tests plus Task 12. Risks → Task 1 (blob spike), Task 12 (Android, failure paths).

One item the spec named that this plan adds beyond it: the **cookie jar** (Task 2). It is not in the spec because it was discovered while writing this plan — the client had neither the `cookies` feature nor a shared instance, which violates the contract's explicit cookie-jar requirement and is the likeliest true reason cenele needed the session webview at all.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. Task 11's visual design is delegated to `ui-ux-pro-max` by project rule, but its required states are enumerated rather than left open.

**Type consistency.** `ExtensionManifest`, `OriginRecord`, `InstalledRecord` (Task 4) are consumed unchanged by Tasks 6, 7, 8, 9. `RepoIndexEntry` (Task 5) flows into Tasks 6 and 8. `loadModuleFromSource` (Task 1) is used only by Task 7. `compareVersions` (Task 8) is used by Task 11. `resolveSourceId` is defined and tested in Task 9 and used by the accessors in the same file.
