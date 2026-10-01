/** "auto" installs through tauri-plugin-updater; "manual" opens the release
 *  page and lets the user install by hand; "none" offers nothing, because
 *  something other than this app already updates the install. */
export type UpdateChannel = "auto" | "manual" | "none";

export interface ChannelEnv {
  /** From `@tauri-apps/plugin-os` `type()`: "windows" | "macos" | "linux" |
   *  "android" | "ios". */
  os: string;
  /** Linux only: is this process running from an AppImage? */
  isAppImage: boolean;
  /** Linux only: is this process running inside a Flatpak sandbox? */
  isFlatpak: boolean;
}

/** Can this install replace itself, and does it need to?
 *
 *  An allow-list, not a deny-list: an OS we do not recognise takes the manual
 *  channel, because offering an install we cannot perform is worse than
 *  offering a link. Android is excluded because the updater plugin is not
 *  compiled into that build at all; a Linux package install is excluded
 *  because the updater replaces the running executable in place, and for a
 *  .deb/.rpm that path is root-owned under /usr/bin.
 *
 *  The third case is not a failure to update but a reason not to try: inside
 *  a Flatpak the store updates the app, so a link to a .deb or .rpm would
 *  send the user to fetch something Flathub has already delivered. That
 *  check comes first because the sandbox decides who updates the app, no
 *  matter what else the environment reports. */
export function resolveChannel({
  os,
  isAppImage,
  isFlatpak,
}: ChannelEnv): UpdateChannel {
  if (isFlatpak) return "none";
  if (os === "windows" || os === "macos") return "auto";
  if (os === "linux") return isAppImage ? "auto" : "manual";
  return "manual";
}
