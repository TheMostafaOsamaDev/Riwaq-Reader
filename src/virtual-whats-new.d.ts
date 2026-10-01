declare module "virtual:whats-new" {
  import type { ReleaseNotes } from "./store/releaseNotes";
  const notes: ReleaseNotes | null;
  export default notes;
  export const images: Record<string, string>;
  export const appVersion: string;
}
