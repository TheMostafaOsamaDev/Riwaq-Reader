// The Android in-app update flow, as a module store (the shape of
// downloadQueue.ts / navigation.ts: subscribe + getState, read in React with
// useSyncExternalStore).
//
// The native side (AppUpdater.kt, through the android_update_* commands) owns
// the truth: what is downloading, how far, whether the file verified. This
// store never assumes an action took effect. After every action it reads
// android_update_status again, and while something is in flight it polls.
//
// Nothing here runs at import time and nothing waits on it at startup: the
// store is fed later, by configure() from the tweaks and by offer() once
// useUpdateCheck has an answer. First paint never depends on it.
//
// Storage rule (decided with the user, 2026-10-02): an update never grows the
// app. A skipped or superseded APK is cancelled natively at once, which
// deletes the file and abandons any install session; it is not left for the
// next launch's cleanup.

import { invoke } from "@tauri-apps/api/core";
import { fetchNotes } from "./fetchNotes";
import type { ReleaseNotes } from "./releaseNotes";
import {
  type AndroidChannel,
  androidChannel,
  decideStart,
  type FlowInput,
  type InstallSource,
  type MobilePref,
  type NativeStatus,
  parseNativeStatus,
} from "./updateFlow";
import {
  createSkip,
  createStore,
  type SkipFields,
  showToast,
} from "./updateStore";

export type Sheet =
  | "closed"
  | "notes"
  | "mobile"
  | "progress"
  | "permission"
  | "ready"
  | "failed";

export interface ApkDetails {
  url: string;
  sha256: string;
  size: number;
}

export interface AndroidUpdateState extends SkipFields {
  offer: { version: string } | null;
  native: NativeStatus;
  /** null until install_source answers (no pill, no banner before we
   *  know); "manual" when the lookup failed, which App answers with the old
   *  release-page banner. */
  channel: AndroidChannel | null;
  sheet: Sheet;
  /** "Later" was tapped: the pill hides for this session, the dot stays. */
  later: boolean;
  notes: { notes: ReleaseNotes | null; highlightImage?: string } | null;
  apk: ApkDetails | null;
  /** The APK's details could not be fetched, so nothing was started. The
   *  failed sheet shows this in place of native.error (same vocabulary). */
  fetchError: "offline" | null;
  /** The offer's APK details could not be fetched when it arrived (no
   *  SHA256SUMS line for the APK, the HEAD failed): an in-app update that
   *  cannot be verified is not offered — no pill; Settings says so and
   *  links to GitHub. Cleared by a later successful lookup. */
  unverified: boolean;
  /** From configure(), with `running` and `skipped`: the "Over mobile
   *  data" setting. */
  pref: MobilePref;
}

const IDLE: NativeStatus = { state: "idle", bytes: 0, total: 0, error: null };
/** Native states worth polling: something is moving without the user. */
const ACTIVE = new Set(["waiting", "downloading", "verifying", "installing"]);
/** States in which a stale (superseded) file is NOT cancelled: a download
 *  still running finishes first, and an install may have a system dialog
 *  up. Anything else of an older version goes at once. */
const BUSY = new Set(["downloading", "verifying", "installing"]);
const POLL_MS = 500;

function initial(): AndroidUpdateState {
  return {
    offer: null,
    native: IDLE,
    channel: null,
    sheet: "closed",
    toast: null,
    toastSeq: 0,
    later: false,
    notes: null,
    apk: null,
    fetchError: null,
    unverified: false,
    running: "",
    skipped: undefined,
    pref: "ask",
  };
}

const store = createStore(initial);
const setState = store.set;
const skips = createSkip(store);
let notesFor: string | null = null;
/** The one install_source read, shared by every caller. */
let channelLoad: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
/** Bumped by every user action and every new offer. A status read begun
 *  under an older generation is dropped: a poll that left before Cancel must
 *  not land after it and bring "downloading" back. */
let generation = 0;
/** A startDownload is between its first await and android_update_start. */
let starting = false;

function bump() {
  generation++;
}

export const { subscribe, getState } = store;
export const useAndroidUpdate = store.use;
/** One derived value (e.g. the Settings dot): re-renders only when it
 *  changes, not on every status poll. */
export const useAndroidUpdateSelect = store.useSelect;

/** The inputs pillFor / attentionDot take, from a store store.state. */
export function flowInput(s: AndroidUpdateState): FlowInput {
  return {
    offered: s.offer?.version ?? null,
    running: s.running,
    native: s.native,
    skipped: s.skipped,
    laterThisSession: s.later,
    unverified: s.unverified,
    // Not loaded yet reads as manual: pillFor and attentionDot show nothing.
    channel: s.channel?.kind ?? "manual",
  };
}

// ── native reads ───────────────────────────────────────────────────────────

/** install_source, defensively: a rejected lookup (Kotlin threw, Rust Err)
 *  or anything unreadable is null, which androidChannel maps to "manual". */
async function readInstallSource(): Promise<InstallSource | null> {
  try {
    const raw = await invoke<string>("install_source");
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (
      !o ||
      typeof o.installer !== "string" ||
      typeof o.label !== "string" ||
      typeof o.storeInstalled !== "boolean"
    ) {
      return null;
    }
    return {
      installer: o.installer,
      label: o.label,
      storeInstalled: o.storeInstalled,
    };
  } catch {
    return null;
  }
}

async function readStatus(): Promise<NativeStatus> {
  try {
    return parseNativeStatus(await invoke<string>("android_update_status"));
  } catch {
    return IDLE;
  }
}

/** Ask, falling back to `fallback` if the command fails. */
async function ask(cmd: string, fallback: boolean): Promise<boolean> {
  try {
    return (await invoke<boolean>(cmd)) === true;
  } catch {
    return fallback;
  }
}

async function call(cmd: string, args?: Record<string, unknown>) {
  try {
    await invoke(cmd, args);
  } catch {
    // The status read that follows every call says what really happened.
  }
}

function isStale(native: NativeStatus): boolean {
  const offered = store.state.offer?.version;
  return (
    offered !== undefined &&
    native.version !== undefined &&
    native.version !== offered &&
    !BUSY.has(native.state)
  );
}

/** Read the native status into the store. A superseded file found here is
 *  cancelled at once (deleting it), then read again. */
export async function refresh(): Promise<void> {
  const gen = generation;
  let native = await readStatus();
  if (gen !== generation) return;
  if (isStale(native)) {
    await call("android_update_cancel");
    native = await readStatus();
    if (gen !== generation) return;
  }
  setState({ native });
  syncPolling();
}

// ── polling ────────────────────────────────────────────────────────────────

function visible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

/** One poll at a time: the next is scheduled only once the previous read
 *  has settled (refresh() ends by calling this again), so a slow status
 *  call never stacks reads behind it. */
function syncPolling() {
  const want = ACTIVE.has(store.state.native.state) && visible();
  if (want && !timer) {
    timer = setTimeout(() => {
      timer = null;
      // A read dropped as stale does not reschedule; keep the chain alive.
      void refresh().finally(syncPolling);
    }, POLL_MS);
  } else if (!want && timer) {
    clearTimeout(timer);
    timer = null;
  }
}

async function onVisibility() {
  if (!visible()) {
    syncPolling();
    return;
  }
  await refresh();
  // "Riwaq continues automatically": back from Android's install-permission
  // screen with the switch now on, carry straight on to the install.
  if (
    store.state.sheet === "permission" &&
    (await ask("android_update_can_install", false))
  ) {
    await install();
  }
}

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", onVisibility);
}

// ── inputs ─────────────────────────────────────────────────────────────────

/** Feed the store what lives in the tweaks. Called by App on every tweak
 *  change; `saveSkipped` persists `skippedUpdateVersion`. */
export function configure(c: {
  running: string;
  skipped: string | undefined;
  pref: MobilePref;
  saveSkipped: (v: string | undefined) => void;
}): void {
  skips.setSave(c.saveSkipped);
  if (
    c.running !== store.state.running ||
    c.skipped !== store.state.skipped ||
    c.pref !== store.state.pref
  ) {
    setState({ running: c.running, skipped: c.skipped, pref: c.pref });
  }
  skips.reconcile();
}

/** Who updates this install, read once. App calls it after paint on
 *  Android so Settings can say "Updates come from F-Droid" with no update
 *  offered; offer() reuses the same read. */
export function loadChannel(): Promise<void> {
  if (!channelLoad) {
    channelLoad = readInstallSource().then((src) =>
      setState({ channel: androidChannel(src) }),
    );
  }
  return channelLoad;
}

/** What useUpdateCheck found. Idempotent for the same version. */
export async function offer(info: { version: string } | null): Promise<void> {
  if (!info) return;
  listen();
  if (store.state.offer?.version !== info.version) {
    bump();
    setState({
      offer: { version: info.version },
      apk: null,
      fetchError: null,
      unverified: false,
    });
  }
  skips.reconcile();
  // First: a file left for an older offer is deleted before anything else.
  await refresh();
  // The notes and the APK's size exist for the pill, the sheet and the
  // Settings card, which only an in-app or store-assisted install shows. A
  // managed install (F-Droid, Play) or a failed lookup (manual) would fetch
  // three files from the release for nothing, once a day: say nothing, ask
  // nothing.
  await loadChannel();
  const kind = store.state.channel?.kind;
  if (kind !== "in-app" && kind !== "store-assisted") return;
  const work: Promise<unknown>[] = [];
  if (notesFor !== info.version) {
    notesFor = info.version;
    const v = info.version;
    work.push(
      fetchNotes(invoke, v).then((notes) => {
        if (store.state.offer?.version === v) setState({ notes });
      }),
    );
  }
  // The size, for the sheet's "Update · 19 MB". A failure here hides the
  // in-app offer (no checksum, no offer); startDownload asks again.
  if (!store.state.apk) {
    const v = info.version;
    work.push(
      loadApk(v).then((apk) => {
        if (!apk && kind === "in-app" && store.state.offer?.version === v) {
          setState({ unverified: true });
        }
      }),
    );
  }
  await Promise.all(work);
}

async function loadApk(version: string): Promise<ApkDetails | null> {
  try {
    const r = (await invoke("fetch_apk_details", { version })) as Record<
      string,
      unknown
    > | null;
    if (
      !r ||
      typeof r.url !== "string" ||
      typeof r.sha256 !== "string" ||
      typeof r.size !== "number"
    ) {
      return null;
    }
    const apk = { url: r.url, sha256: r.sha256, size: r.size };
    if (store.state.offer?.version === version) {
      setState({ apk, unverified: false });
    }
    return apk;
  } catch {
    return null;
  }
}

// ── actions ────────────────────────────────────────────────────────────────

export function openSheet(mode: Exclude<Sheet, "closed">): void {
  setState({ sheet: mode });
}

export function closeSheet(): void {
  setState({ sheet: "closed" });
}

export function dismissToast(): void {
  setState({ toast: null });
}

export function later(): void {
  setState({
    later: true,
    sheet: "closed",
    ...showToast(store.state, "later"),
  });
}

export async function skip(version: string): Promise<void> {
  bump();
  skips.skip(version, { sheet: "closed" });
  // Now, not next launch: the APK and any install session go at once.
  await call("android_update_cancel");
  await refresh();
}

/** Puts the offer back. Nothing is downloaded again until the user asks. */
export function undoSkip(): void {
  bump();
  skips.undo();
}

/** The primary button. `allowMetered` is "Update anyway"; `waitForWifi` is
 *  the mobile sheet's "Wait for Wi-Fi". A second tap while one is pending
 *  does nothing. */
export async function startDownload(
  opts: { allowMetered?: boolean; waitForWifi?: boolean } = {},
): Promise<void> {
  const version = store.state.offer?.version;
  if (!version) return;
  if (store.state.channel?.kind === "store-assisted") {
    await openStoreApp();
    return;
  }
  if (store.state.channel?.kind !== "in-app" || starting) return;
  starting = true;
  try {
    await start(version, opts);
  } finally {
    starting = false;
  }
}

/** After every await: has the user since skipped this version, or has a
 *  newer offer replaced it? Then the start they asked for no longer stands. */
function stillWanted(version: string): boolean {
  return (
    store.state.offer?.version === version && store.state.skipped !== version
  );
}

async function start(
  version: string,
  opts: { allowMetered?: boolean; waitForWifi?: boolean },
): Promise<void> {
  bump();
  let waitForUnmetered = opts.waitForWifi === true;
  if (!opts.allowMetered && !waitForUnmetered) {
    // Unknown counts as metered: the cost of a wrong guess is one tap.
    const metered = await ask("android_network_metered", true);
    if (!stillWanted(version)) return;
    const d = decideStart({ metered, pref: store.state.pref });
    if (d === "ask") {
      setState({ sheet: "mobile" });
      return;
    }
    waitForUnmetered = d === "wait";
  }

  const apk = await loadApk(version);
  if (!stillWanted(version)) return;
  if (!apk) {
    setState({ fetchError: "offline", sheet: "failed" });
    return;
  }
  setState({ fetchError: null, sheet: "closed" });
  // A job for another version — even one still downloading, which the
  // automatic cleanup leaves alone — would make native ignore this start
  // and keep growing the old file. The user asked for this version: cancel
  // the other one (deleting it) first.
  const now = await readStatus();
  if (!stillWanted(version)) return;
  if (now.version !== undefined && now.version !== version) {
    await call("android_update_cancel");
    if (!stillWanted(version)) return;
  }
  await call("android_update_start", {
    version,
    url: apk.url,
    sha256: apk.sha256,
    size: apk.size,
    waitForUnmetered,
  });
  // A start can be ignored natively; only the status says whether it ran.
  await refresh();
}

export async function cancel(): Promise<void> {
  bump();
  setState({ sheet: "closed" });
  await call("android_update_cancel");
  await refresh();
}

/** "Install now". Also callable while installing: a re-tap recovers a
 *  system dialog that never appeared. */
export async function install(): Promise<void> {
  bump();
  if (!(await ask("android_update_can_install", false))) {
    setState({ sheet: "permission" });
    return;
  }
  setState({ sheet: "closed" });
  await call("android_update_install");
  await refresh();
}

export async function openPermission(): Promise<void> {
  await call("android_update_open_permission");
}

/** After a failure: an install failure retries the install (the file is
 *  kept); anything else starts the download again, which resumes from the
 *  byte it stopped at, or starts fresh if the file was deleted. */
export async function retry(): Promise<void> {
  if (
    store.state.native.state === "failed" &&
    store.state.native.error === "install"
  ) {
    await install();
    return;
  }
  await startDownload();
}

/** Open the store app that manages this install (Orion, Obtainium, or a
 *  managed store's "Open F-Droid"). */
export async function openStoreApp(): Promise<void> {
  const c = store.state.channel;
  if (!c) return;
  if (c.kind !== "store-assisted" && c.kind !== "managed") return;
  await call("open_store", { pkg: c.pkg });
}

/** Test-only: back to a fresh module. */
export function __resetForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (listening && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibility);
  }
  listening = false;
  store.reset();
  skips.reset();
  notesFor = null;
  channelLoad = null;
  generation = 0;
  starting = false;
}
