import { optimizedCoverUrl } from "../sources/images";

/** Every URL a Store novel's cover may load from, best first.
 *
 *  A novel already in the library has its cover on disk — `addNovelToLibrary`
 *  fetched it at save time — so the detail page should read that file instead
 *  of going back to the source site on every open. On a Cloudflare-fronted
 *  source that round trip is a visible wait for bytes we already own.
 *
 *  The remote URLs stay behind the local one rather than replacing it: the
 *  index can name a `coverFile` whose bytes are gone (a half-finished delete,
 *  a restored backup), and falling through to the network beats showing "no
 *  cover" for a novel whose art is still fetchable. Callers walk the list on
 *  error, so each entry is a strictly worse-but-still-valid fallback.
 *
 *  `optimizedCoverUrl` returns its input unchanged for anything it can't
 *  rewrite, so the list is de-duplicated — otherwise a failed load would
 *  retry the identical URL and stall on the last candidate. */
export function novelCoverCandidates({
  local,
  remote,
  height,
}: {
  local: string | null;
  remote: string | undefined;
  height: number;
}): string[] {
  const out: string[] = [];
  if (local) out.push(local);
  if (remote) {
    out.push(optimizedCoverUrl(remote, height));
    out.push(remote);
  }
  return out.filter((url, i) => out.indexOf(url) === i);
}
