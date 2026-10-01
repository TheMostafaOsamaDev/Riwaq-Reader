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
import { useSyncExternalStore } from "react";
import { fetchNotes } from "./fetchNotes";
import type { ReleaseNotes } from "./releaseNotes";
import {
  type AndroidChannel,
  androidChannel,
  clearSkip,
  decideStart,
  type FlowInput,
  type InstallSource,
  type MobilePref,
  type NativeStatus,
  parseNativeStatus,
} from "./updateFlow";

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

export interface AndroidUpdateState {
  offer: { version: string } | null;
  native: NativeStatus;
  /** "manual" until install_source answers: no pill before we know. */
  channel: AndroidChannel;
  sheet: Sheet;
  toast: "later" | "skipped" | null;
  /** "Later" was tapped: the pill hides for this session, the dot stays. */
  later: boolean;
  notes: { notes: ReleaseNotes | null; highlightImage?: string } | null;
  apk: ApkDetails | null;
  /** The APK's details could not be fetched, so nothing was started. The
   *  failed sheet shows this in place of native.error (same vocabulary). */
  fetchError: "offline" | null;
  /** From configure(): the running app version, the stored skip, and the
   *  "Over mobile data" setting. */
  running: string;
  skipped: string | undefined;
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
    channel: { kind: "manual" },
    sheet: "closed",
    toast: null,
    later: false,
    notes: null,
    apk: null,
    fetchError: null,
    running: "",
    skipped: undefined,
    pref: "ask",
  };
}

let state: AndroidUpdateState = initial();
type Listener = (s: AndroidUpdateState) => void;
const listeners = new Set<Listener>();
let saveSkipped: (v: string | undefined) => void = () => {};
/** The skip that "Undo" puts back (usually undefined). */
let skipBeforeUndo: string | undefined;
let notesFor: string | null = null;
let channelLoaded = false;
let timer: ReturnType<typeof setInterval> | null = null;
let listening = false;

function setState(patch: Partial<AndroidUpdateState>) {
  // A fresh object every time: useSyncExternalStore compares by identity.
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): AndroidUpdateState {
  return state;
}

export function useAndroidUpdate(): AndroidUpdateState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** The inputs pillFor / attentionDot take, from a store state. */
export function flowInput(s: AndroidUpdateState): FlowInput {
  return {
    offered: s.offer?.version ?? null,
    running: s.running,
    native: s.native,
    skipped: s.skipped,
    laterThisSession: s.later,
    channel: s.channel.kind,
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
  const offered = state.offer?.version;
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
  let native = await readStatus();
  if (isStale(native)) {
    await call("android_update_cancel");
    native = await readStatus();
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

function syncPolling() {
  const want = ACTIVE.has(state.native.state) && visible();
  if (want && !timer) {
    timer = setInterval(() => void refresh(), POLL_MS);
  } else if (!want && timer) {
    clearInterval(timer);
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
    state.sheet === "permission" &&
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
  saveSkipped = c.saveSkipped;
  if (
    c.running !== state.running ||
    c.skipped !== state.skipped ||
    c.pref !== state.pref
  ) {
    setState({ running: c.running, skipped: c.skipped, pref: c.pref });
  }
  reconcileSkip();
}

/** A skip covers one version: drop it once something newer is offered or
 *  the device is already at or past it. */
function reconcileSkip() {
  if (!state.running) return;
  if (clearSkip(state.skipped, state.offer?.version ?? null, state.running)) {
    setState({ skipped: undefined });
    saveSkipped(undefined);
  }
}

/** What useUpdateCheck found. Idempotent for the same version. */
export async function offer(info: { version: string } | null): Promise<void> {
  if (!info) return;
  listen();
  if (state.offer?.version !== info.version) {
    setState({ offer: { version: info.version }, apk: null, fetchError: null });
  }
  reconcileSkip();
  // First: a file left for an older offer is deleted before anything else.
  await refresh();
  const work: Promise<unknown>[] = [];
  if (!channelLoaded) {
    channelLoaded = true;
    work.push(
      readInstallSource().then((src) =>
        setState({ channel: androidChannel(src) }),
      ),
    );
  }
  if (notesFor !== info.version) {
    notesFor = info.version;
    const v = info.version;
    work.push(
      fetchNotes(invoke as never, v).then((notes) => {
        if (state.offer?.version === v) setState({ notes });
      }),
    );
  }
  // The size, for the sheet's "Update · 19 MB". Not fatal: startDownload
  // asks again.
  if (!state.apk) work.push(loadApk(info.version));
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
    if (state.offer?.version === version) setState({ apk });
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
  setState({ later: true, sheet: "closed", toast: "later" });
}

export async function skip(version: string): Promise<void> {
  skipBeforeUndo = state.skipped;
  setState({ skipped: version, sheet: "closed", toast: "skipped" });
  saveSkipped(version);
  // Now, not next launch: the APK and any install session go at once.
  await call("android_update_cancel");
  await refresh();
}

/** Puts the offer back. Nothing is downloaded again until the user asks. */
export function undoSkip(): void {
  const prev = skipBeforeUndo;
  skipBeforeUndo = undefined;
  setState({ skipped: prev, toast: null });
  saveSkipped(prev);
}

/** The primary button. `allowMetered` is "Update anyway"; `waitForWifi` is
 *  the mobile sheet's "Wait for Wi-Fi". */
export async function startDownload(
  opts: { allowMetered?: boolean; waitForWifi?: boolean } = {},
): Promise<void> {
  const version = state.offer?.version;
  if (!version) return;
  if (state.channel.kind === "store-assisted") {
    await openStoreApp();
    return;
  }
  if (state.channel.kind !== "in-app") return;

  let waitForUnmetered = opts.waitForWifi === true;
  if (!opts.allowMetered && !waitForUnmetered) {
    // Unknown counts as metered: the cost of a wrong guess is one tap.
    const metered = await ask("android_network_metered", true);
    const d = decideStart({ metered, pref: state.pref });
    if (d === "ask") {
      setState({ sheet: "mobile" });
      return;
    }
    waitForUnmetered = d === "wait";
  }

  const apk = (await loadApk(version)) ?? null;
  if (!apk) {
    setState({ fetchError: "offline", sheet: "failed" });
    return;
  }
  setState({ fetchError: null, sheet: "closed" });
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
  setState({ sheet: "closed" });
  await call("android_update_cancel");
  await refresh();
}

/** "Install now". Also callable while installing: a re-tap recovers a
 *  system dialog that never appeared. */
export async function install(): Promise<void> {
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
  if (state.native.state === "failed" && state.native.error === "install") {
    await install();
    return;
  }
  await startDownload();
}

/** Open the store app that manages this install (Orion, Obtainium, or a
 *  managed store's "Open F-Droid"). */
export async function openStoreApp(): Promise<void> {
  const c = state.channel;
  if (c.kind !== "store-assisted" && c.kind !== "managed") return;
  await call("open_store", { pkg: c.pkg });
}

/** Test-only: back to a fresh module. */
export function __resetForTests(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (listening && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibility);
  }
  listening = false;
  listeners.clear();
  state = initial();
  saveSkipped = () => {};
  skipBeforeUndo = undefined;
  notesFor = null;
  channelLoaded = false;
}
