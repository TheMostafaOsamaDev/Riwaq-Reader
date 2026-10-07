// The bottom-bar styles a phone reader can pick in Settings ▸ Appearance.
// No JSX, so the lists and the rules about them are testable without
// rendering anything.

import type { HomeBarStyle, ReaderBarStyle } from "../../types/reader";
import type { ReaderPanel } from "./ReaderTabBar";

/** Picker order. The first entry is NOT the default — that is
 *  DEFAULT_TWEAKS.readerBar. */
export const READER_BAR_STYLES: readonly ReaderBarStyle[] = [
  "classic",
  "labelled",
  "capsule",
  "status",
  "slider",
  "corners",
];

/** Picker order. The default is DEFAULT_TWEAKS.homeBar. */
export const HOME_BAR_STYLES: readonly HomeBarStyle[] = [
  "classic",
  "labelled",
  "dock",
  "raised",
  "switch",
  "expanding",
];

export function isReaderBarStyle(v: unknown): v is ReaderBarStyle {
  return typeof v === "string" && (READER_BAR_STYLES as string[]).includes(v);
}

export function isHomeBarStyle(v: unknown): v is HomeBarStyle {
  return typeof v === "string" && (HOME_BAR_STYLES as string[]).includes(v);
}

/** The panels a style puts on the bar itself. Whatever it leaves off is
 *  reached from inside the Contents sheet instead (see PanelSwitcher), so
 *  every panel stays reachable whichever bar is chosen. */
export function panelsOnBar(style: ReaderBarStyle): readonly ReaderPanel[] {
  switch (style) {
    case "classic":
    case "labelled":
    case "status":
      return ["toc", "highlights", "progress", "settings"];
    case "capsule":
    case "slider":
    case "corners":
      return ["toc", "settings"];
  }
}

/** The panels the Contents sheet has to offer as tabs, because the bar does
 *  not. Empty when the bar has a button for each. */
export function panelsInContents(style: ReaderBarStyle): ReaderPanel[] {
  const on = panelsOnBar(style);
  const sheetPanels: ReaderPanel[] = ["toc", "highlights", "progress"];
  return sheetPanels.some((p) => !on.includes(p)) ? sheetPanels : [];
}

/** Each panel's icon, as the reader bars draw it. */
export const PANEL_ICON = {
  toc: "list",
  highlights: "highlight",
  progress: "clock",
  settings: "type",
} as const;

/** Short names, for buttons that carry their label. */
export const PANEL_LABEL = {
  toc: "reader.bar.contents",
  highlights: "reader.bar.highlights",
  progress: "reader.bar.progress",
  settings: "reader.bar.text",
} as const;

/** Full names, for icon-only buttons (screen readers, long press). */
export const PANEL_ARIA = {
  toc: "reader.toc",
  highlights: "reader.highlights",
  progress: "reader.progress",
  settings: "reader.settings",
} as const;

/** Does the home bar carry its own import button? The others put it in the
 *  header next to the title. */
export function homeBarHasImport(style: HomeBarStyle): boolean {
  return style === "classic" || style === "dock" || style === "raised";
}

/** Does the home bar carry a Shelves button? The others put one in the
 *  header beside search. */
export function homeBarHasShelves(style: HomeBarStyle): boolean {
  return style === "classic";
}

/** Roughly how long the rest of a chapter takes, in whole minutes.
 *
 *  A reading speed is a guess at best, so this aims at "about right", not a
 *  promise: 200 words a minute sits between the usual adult figures for
 *  Arabic (lower) and English (higher). Never below one minute while there
 *  is anything left — "0 min left" next to text still on screen reads as a
 *  bug. */
export const WORDS_PER_MINUTE = 200;
export function minutesLeft(totalWords: number, fractionRead: number): number {
  const f = Math.min(1, Math.max(0, fractionRead));
  const left = totalWords * (1 - f);
  if (left <= 0) return 0;
  return Math.max(1, Math.round(left / WORDS_PER_MINUTE));
}

/** Words in a run of paragraphs, counted the way a reader would: runs of
 *  non-space characters. */
export function wordCount(texts: readonly string[]): number {
  let n = 0;
  for (const t of texts) {
    const m = t.match(/\S+/g);
    if (m) n += m.length;
  }
  return n;
}
