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
 *  An allow-list, not a deny-list: an OS we do not recognise takes the manual
 *  channel, because offering an install we cannot perform is worse than
 *  offering a link. Android is excluded because the updater plugin is not
 *  compiled into that build at all; a Linux package install is excluded
 *  because the updater replaces the running executable in place, and for a
 *  .deb/.rpm that path is root-owned under /usr/bin. */
export function resolveChannel({ os, isAppImage }: ChannelEnv): UpdateChannel {
  if (os === "windows" || os === "macos") return "auto";
  if (os === "linux") return isAppImage ? "auto" : "manual";
  return "manual";
}
