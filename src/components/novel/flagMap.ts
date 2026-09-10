import type { ChapterFlags } from "../../store/chapterDeletion";
import type { SourceSnapshot } from "../../store/sourceLibrary";

// Both the detail view and the accordion rebuild this after a download or
// a delete. It lives on its own so they do not have to import each other.
/** Build a chapter-id → {downloadedAt, readAt} lookup from a snapshot.
 *  Lets the volumes accordion render per-chapter status with a single
 *  Map.get() per chapter instead of walking volumes each time. */
export function buildFlagMap(snapshot: SourceSnapshot): Map<number, ChapterFlags> {
  const out = new Map<number, ChapterFlags>();
  for (const v of snapshot.volumes) {
    for (const c of v.chapters) {
      if (c.downloadedAt || c.readAt) {
        out.set(c.id, {
          ...(c.downloadedAt ? { downloadedAt: c.downloadedAt } : {}),
          ...(c.readAt ? { readAt: c.readAt } : {}),
        });
      }
    }
  }
  return out;
}
