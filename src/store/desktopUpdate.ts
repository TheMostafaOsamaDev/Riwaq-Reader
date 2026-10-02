// The desktop update flow, as a module store (the shape of androidUpdate.ts:
// subscribe + getState, read in React with useSyncExternalStore).
//
// tauri-plugin-updater does the work. Download and install are split so the
// restart happens only when the user asks for it:
//   1. check() → Update; Update.download(onEvent) fetches the bundle and
//      reports progress (Started.contentLength, then Progress.chunkLength).
//   2. "Restart now" → Update.install(), then relaunch(). On Windows (NSIS)
//      install() runs the installer and exits the app itself.
// The Update object is kept here, in module scope, between the two. If it is
// lost (the page reloaded), Restart now checks again and downloadAndInstall()s.
// The plugin cannot abort a download, so there is no Cancel.
//
// The manual channel (.deb/.rpm) never calls check(): Download opens the
// release page. Flatpak has no UpdateInfo at all, so nothing here runs.
//
// Nothing runs at import time and nothing waits on this at startup: App feeds
// it after paint with configure() and offer(). The webview never fetches the
// network: the plugin and the fetch_release_notes command do.

import { useSyncExternalStore } from "react";
import { ARM_MS } from "../hooks/useArmed";
import { fetchNotes } from "./fetchNotes";
import type { ReleaseNotes } from "./releaseNotes";
import { clearSkip } from "./updateFlow";
import { RELEASES_PAGE_URL, type UpdateInfo } from "./updates";
import { isNewerVersion } from "./updateVersion";

export type DesktopPhase =
  | "idle"
  | "downloading"
  | "ready"
  | "installing"
  /** install() succeeded but relaunch() did not: the new version is on disk
   *  and needs the user to quit and reopen. Not a failure. */
  | "installed"
  | "failed";
export type DesktopDialog = "closed" | "notes" | "progress" | "failed";
export type FailReason = "unavailable" | "download" | "install";

export interface DesktopUpdateState {
  offer: { version: string; channel: UpdateInfo["channel"] } | null;
  phase: DesktopPhase;
  bytes: number;
  total: number;
  reason: FailReason | null;
  dialog: DesktopDialog;
  toast: "later" | "skipped" | null;
  /** "Later" was clicked: the card hides for this session, the dot shows. */
  later: boolean;
  notes: { notes: ReleaseNotes | null; highlightImage?: string } | null;
  running: string;
  skipped: string | undefined;
}

export type Card =
  | { kind: "available" }
  | { kind: "downloading"; bytes: number; total: number }
  | { kind: "ready" }
  | { kind: "installed" }
  | { kind: "failed" }
  | null;

function initial(): DesktopUpdateState {
  return {
    offer: null,
    phase: "idle",
    bytes: 0,
    total: 0,
    reason: null,
    dialog: "closed",
    toast: null,
    later: false,
    notes: null,
    running: "",
    skipped: undefined,
  };
}

/** The plugin's Update, as far as this store uses it. */
interface PluginUpdate {
  download(onEvent?: (e: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
  downloadAndInstall(onEvent?: (e: DownloadEvent) => void): Promise<void>;
  close(): Promise<void>;
}
type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

let state: DesktopUpdateState = initial();
type Listener = (s: DesktopUpdateState) => void;
const listeners = new Set<Listener>();
let saveSkipped: (v: string | undefined) => void = () => {};
let skipBeforeUndo: string | undefined;
let notesFor: string | null = null;
/** The downloaded Update, kept for install(). */
let pending: PluginUpdate | null = null;
/** Bumped by a new offer: a download begun for an older one is dropped. */
let generation = 0;
/** A download or an install is between its first await and its end. */
let busy = false;
/** When the phase last became "ready" (Date.now()). */
let readyAt = 0;

/** Let go of the downloaded Update, releasing the plugin's resource. */
function dropPending() {
  const old = pending;
  pending = null;
  void old?.close().catch(() => {});
}

/** Back to an untouched offer: what a superseded download ends in. */
function resetIdle() {
  setState({
    phase: "idle",
    bytes: 0,
    total: 0,
    reason: null,
    // The progress or failed dialog would describe a download that is gone.
    dialog: state.dialog === "notes" ? "notes" : "closed",
  });
}

function setState(patch: Partial<DesktopUpdateState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): DesktopUpdateState {
  return state;
}

export function useDesktopUpdate(): DesktopUpdateState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ── derived ────────────────────────────────────────────────────────────────

/** An offer newer than what runs. Keyed on the running version, so an
 *  update installed some other way shows nothing. */
export function pendingVersion(s: DesktopUpdateState): string | null {
  const v = s.offer?.version;
  return v && isNewerVersion(v, s.running) ? v : null;
}

/** What the sidebar card shows. Work under way always shows; only the
 *  untouched offer hides for Later or Skip. */
export function cardFor(s: DesktopUpdateState): Card {
  const v = pendingVersion(s);
  if (!v) return null;
  switch (s.phase) {
    case "downloading":
      return { kind: "downloading", bytes: s.bytes, total: s.total };
    case "ready":
    case "installing":
      return { kind: "ready" };
    case "installed":
      return { kind: "installed" };
    case "failed":
      return { kind: "failed" };
    default:
      if (s.skipped === v || s.later) return null;
      return { kind: "available" };
  }
}

/** The dot on Settings: a pending, unskipped update whose card is hidden
 *  (that is, after Later). Settings → About then holds it. */
export function dotFor(s: DesktopUpdateState): boolean {
  const v = pendingVersion(s);
  return v !== null && s.skipped !== v && cardFor(s) === null;
}

/** Whether Settings → About shows the update card. */
export function settingsCardFor(s: DesktopUpdateState): boolean {
  const v = pendingVersion(s);
  return v !== null && s.skipped !== v;
}

// ── inputs ─────────────────────────────────────────────────────────────────

export function configure(c: {
  running: string;
  skipped: string | undefined;
  saveSkipped: (v: string | undefined) => void;
}): void {
  saveSkipped = c.saveSkipped;
  if (c.running !== state.running || c.skipped !== state.skipped) {
    setState({ running: c.running, skipped: c.skipped });
  }
  reconcileSkip();
}

/** The shared rule: a skip covers one version only. */
function reconcileSkip() {
  if (!state.running) return;
  if (clearSkip(state.skipped, state.offer?.version ?? null, state.running)) {
    setState({ skipped: undefined });
    saveSkipped(undefined);
  }
}

async function tauriInvoke(cmd: string, args: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

/** What useUpdateCheck found. Idempotent for the same version; null (no
 *  update, or Flatpak) changes nothing. */
export async function offer(info: UpdateInfo | null): Promise<void> {
  if (!info) return;
  const same =
    state.offer?.version === info.version &&
    state.offer.channel === info.channel;
  if (!same) {
    const newVersion = state.offer?.version !== info.version;
    setState({ offer: { version: info.version, channel: info.channel } });
    if (newVersion) {
      generation++;
      // A file downloaded for the older offer is superseded. A download
      // still running cannot be stopped; its result is dropped when it ends.
      // Not mid-install: install() may be using it.
      if (!busy) dropPending();
      setState({ later: false, notes: null });
      // A download still running for the older offer is left to end; it
      // finds its generation stale and resets to idle then (see update()).
      if (!busy) resetIdle();
    }
  }
  reconcileSkip();
  if (notesFor !== info.version) {
    notesFor = info.version;
    const v = info.version;
    const notes = await fetchNotes(tauriInvoke, v);
    if (state.offer?.version === v) setState({ notes });
  }
}

// ── actions ────────────────────────────────────────────────────────────────

export function openDialog(d: Exclude<DesktopDialog, "closed">): void {
  setState({ dialog: d });
}

export function closeDialog(): void {
  setState({ dialog: "closed" });
}

export function dismissToast(): void {
  setState({ toast: null });
}

export function later(): void {
  setState({ later: true, dialog: "closed", toast: "later" });
}

export function skip(): void {
  const v = state.offer?.version;
  if (!v) return;
  skipBeforeUndo = state.skipped;
  setState({ skipped: v, dialog: "closed", toast: "skipped" });
  saveSkipped(v);
}

export function undoSkip(): void {
  const prev = skipBeforeUndo;
  skipBeforeUndo = undefined;
  setState({ skipped: prev, toast: null });
  saveSkipped(prev);
}

export async function openReleasePage(): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(RELEASES_PAGE_URL);
  } catch {
    // Nothing to show: the button stays where it was.
  }
}

/** Bytes counted so far, outside the state: the plugin reports a chunk at a
 *  time and only a visible change is worth a render. */
let counted = 0;
const MB_TENTH = 104_858;

function onEvent(gen: number) {
  return (e: DownloadEvent) => {
    if (gen !== generation) return;
    if (e.event === "Started") {
      counted = 0;
      setState({ bytes: 0, total: e.data.contentLength ?? 0 });
    } else if (e.event === "Progress") {
      counted += e.data.chunkLength;
      // A render per 0.1 MB, which is what the card can show.
      if (
        Math.floor(counted / MB_TENTH) !== Math.floor(state.bytes / MB_TENTH)
      ) {
        setState({ bytes: counted });
      }
    }
  };
}

function fail(reason: FailReason) {
  setState({
    phase: "failed",
    reason,
    dialog: state.dialog === "closed" ? "closed" : "failed",
  });
}

/** The primary button: Update (auto) or Download (manual). Also "Try again".
 *  A second press while one is under way does nothing. */
export async function update(): Promise<void> {
  const offered = state.offer;
  if (!offered || !pendingVersion(state)) return;
  if (offered.channel === "manual") {
    await openReleasePage();
    return;
  }
  if (busy || state.phase === "ready" || state.phase === "installing") return;
  busy = true;
  const gen = generation;
  counted = 0;
  setState({
    phase: "downloading",
    bytes: 0,
    total: 0,
    reason: null,
    dialog: state.dialog === "closed" ? "closed" : "progress",
  });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const u = (await check()) as PluginUpdate | null;
    if (gen !== generation) {
      // Superseded by a newer offer while checking: offer that one.
      void u?.close().catch(() => {});
      resetIdle();
      return;
    }
    if (!u) {
      // The manifest offered a version the plugin then declined (a platform
      // key we do not publish, a signature it would not accept).
      fail("unavailable");
      return;
    }
    try {
      await u.download(onEvent(gen));
    } catch {
      void u.close().catch(() => {});
      if (gen === generation) fail("download");
      else resetIdle();
      return;
    }
    if (gen !== generation) {
      void u.close().catch(() => {});
      resetIdle();
      return;
    }
    if (pending !== u) dropPending();
    pending = u;
    readyAt = Date.now();
    setState({
      phase: "ready",
      bytes: counted,
      dialog: state.dialog === "progress" ? "closed" : state.dialog,
    });
  } catch {
    if (gen === generation) fail("unavailable");
    else resetIdle();
  } finally {
    busy = false;
  }
}

/** "Restart now". Never called by anything but the user. */
export async function restart(): Promise<void> {
  if (state.offer?.channel !== "auto" || state.phase !== "ready" || busy) {
    return;
  }
  // Defence in depth, behind the armed buttons: a restart asked for within
  // ARM_MS of the download finishing is taken as stray input, not a
  // decision (see useArmed for the unexplained restart this guards).
  if (Date.now() - readyAt < ARM_MS) return;
  busy = true;
  setState({ phase: "installing" });
  try {
    if (pending) {
      await pending.install();
    } else {
      // The downloaded Update was lost: check again and do it in one go.
      const { check } = await import("@tauri-apps/plugin-updater");
      const u = (await check()) as PluginUpdate | null;
      if (!u) {
        fail("unavailable");
        return;
      }
      await u.downloadAndInstall();
    }
  } catch {
    dropPending();
    fail("install");
    return;
  } finally {
    busy = false;
  }
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    // The new version is installed; only the restart did not happen. Saying
    // "nothing was changed" here would be false.
    setState({ phase: "installed" });
  }
}

/** Test-only: back to a fresh module. */
export function __resetForTests(): void {
  listeners.clear();
  state = initial();
  saveSkipped = () => {};
  skipBeforeUndo = undefined;
  notesFor = null;
  pending = null;
  generation = 0;
  busy = false;
  counted = 0;
  readyAt = 0;
}

/** Test-only: a "ready" state whose Update object is gone (a reload). */
export function __setReadyWithoutUpdateForTests(): void {
  pending = null;
  readyAt = Date.now();
  setState({ phase: "ready" });
}
