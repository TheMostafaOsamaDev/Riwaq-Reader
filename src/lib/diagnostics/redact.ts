// Redaction, applied at WRITE time.
//
// The export is meant to be pasted into a chat or attached to an issue, and
// a raw log carries the user's library: novel titles, local paths with their
// account name in them, and the sites they read from. Redacting at write
// time rather than at export time means no unredacted copy is ever on disk,
// so there is nothing to leak if the file is picked up some other way.
//
// Stability matters more than reversibility. `t:a3f19c` appearing in twelve
// events is enough to follow one book through a session, which is all a
// diagnosis needs.

/**
 * Keys whose values are any user-authored or user-identifying free text:
 * titles (including original-language/alternate titles), descriptions, and
 * the user's own highlight notes and quoted passages.
 */
const TEXT_KEYS =
  /^(title|name|chapterTitle|bookTitle|author|novelTitle|originalTitle|subtitle|description|note|text)$/i;
/** Keys whose values are filesystem paths. */
const PATH_KEYS = /^(path|file|filePath|dest|src|dir)$/i;
/** Keys whose values are URLs. */
const URL_KEYS =
  /^(url|href|link|novelUrl|chapterUrl|source|coverUrl|viewMoreUrl|baseUrl|iconUrl)$/i;
/**
 * Keys whose values are identifiers that MAY have a URL baked into them.
 *
 * These are value-sniffed, not blanket-hashed, because the two populations
 * are genuinely different. A local book id is a `crypto.randomUUID()`
 * (store/library.ts) and identifies nothing outside the device, while being
 * exactly what lets a reader follow one book across a session — hashing it
 * would cost that for no privacy gain. A streamed book's id is minted as
 * `stream:${sourceId}:${novelUrl}` (components/SourceStreamReader.tsx) and a
 * streamed chapter's is `${chapterUrl}#0`, so the SAME key carries the full
 * source URL. The key name cannot tell the two apart; the value can.
 */
const ID_KEYS = /^(id|bookId|chapterId|novelId)$/i;
/**
 * Keys whose values are diagnostic free text that can EMBED a path rather
 * than being one. Error messages are the case that matters: the Rust layer
 * builds them with `path.display()` — `format!("cannot open {}: {e}", ...)`
 * appears four times in src-tauri/src/archive.rs — so an unhandled invoke()
 * rejection carries the user's home directory and the book's real title in
 * the middle of an otherwise ordinary sentence. Key-based redaction alone
 * misses it, because the key is `message`, not `path`.
 */
const MESSAGE_KEYS = /^(message|stack|componentStack)$/i;

/**
 * Origins that are the app shell or the dev server rather than something the
 * user chose to read. Frames pointing at these are the most useful content
 * the export has, and carry nothing about the library, so `scrubUrls` leaves
 * them byte-identical: `https://tauri.localhost/...` is the packaged Android
 * and Windows origin, `http://localhost:1420/src/...` is `vite dev`.
 */
function isAppOrigin(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * FNV-1a, 32-bit. Not a security hash and does not need to be — it needs to
 * be stable across runs and cheap enough to call from the log path.
 */
export function hashTitle(s: string): string {
  if (!s) return "t:empty";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `t:${(h >>> 0).toString(16).padStart(8, "0").slice(0, 6)}`;
}

/** Basename only — everything above it identifies the machine's owner. */
export function redactPath(p: string): string {
  if (!p) return "";
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/** Host only — the path identifies exactly what they were reading. */
export function redactUrl(u: string): string {
  try {
    return new URL(u).host || "<url>";
  } catch {
    return "<url>";
  }
}

/** Absolute POSIX paths, by the roots that only ever appear in one. The
 *  segment class excludes `:` so the match stops at the `: {e}` that the
 *  Rust error strings append, and allows spaces so "Application Support"
 *  does not end the path halfway through. */
const POSIX_ABS =
  /\/(?:Users|home|var|private|data|storage|sdcard)(?:\/[^/\n:"'\\]*)+/g;
/** The same for a Windows drive path. */
const WINDOWS_ABS = /[A-Za-z]:\\(?:[^\\\n"']*\\)*[^\\\n"'\s:]*/g;

/** Is this match part of a URL? Stack frames are `tauri://localhost/...` in
 *  a packaged build and carry no user data, so cutting them to a basename
 *  would destroy the line and column for nothing. */
function insideUrl(src: string, index: number): boolean {
  const before = src.slice(0, index);
  return before.slice(before.search(/\S*$/)).includes("://");
}

/**
 * Replace absolute filesystem paths embedded in free text with their
 * basename, leaving URLs — and everything else in the sentence — alone.
 */
export function scrubPaths(s: string): string {
  if (!s) return s;
  const scrub = (match: string, offset: number, src: string) =>
    insideUrl(src, offset)
      ? match
      : // A path that ends on a separator would otherwise have an empty
        // basename, and redactPath falls back to the whole path for that.
        redactPath(match.replace(/[/\\]+$/, ""));
  return s.replace(POSIX_ABS, scrub).replace(WINDOWS_ABS, scrub);
}

/**
 * Reduce an identifier to something that still correlates events but names
 * no novel or chapter.
 *
 * A value with no `://` in it is a local id — a UUID — and passes through
 * untouched, because following one book across a session is most of what the
 * export is read for. A value WITH a `://` has a source URL baked into it,
 * and only the URL half is reduced: the scheme is walked backwards over so
 * `stream:cenele:https://cenele.com/novel/x/` keeps its `stream:cenele:`
 * prefix and becomes `stream:cenele:cenele.com`. Losing the prefix would
 * make a streamed id indistinguishable from a bare host in the log.
 */
export function redactId(v: string): string {
  const at = v.indexOf("://");
  if (at === -1) return v;
  let start = at;
  while (start > 0 && /[A-Za-z0-9+.-]/.test(v[start - 1])) start--;
  return v.slice(0, start) + redactUrl(v.slice(start));
}

/**
 * URLs as they appear inside free text. The class stops at whitespace,
 * quotes and closing brackets so a frame wrapped in `(...)` does not swallow
 * its own delimiter.
 */
const EMBEDDED_URL = /https?:\/\/[^\s"'`<>\\)\]}]+/g;

/**
 * Reduce `http(s)` URLs embedded in free text to their host, leaving app and
 * dev-server origins alone.
 *
 * A fetch failure reads `failed to fetch https://cenele.com/novel/x/chap-3`,
 * which names the book and the chapter in a field no key-based rule looks
 * at. Stack frames are the opposite case — `https://tauri.localhost/assets/
 * index-abc.js:1:234` is the single most useful line in the whole export and
 * must survive byte-identical, along with its `tauri://` and `file://`
 * cousins (neither of which this touches, since neither is http(s)).
 */
export function scrubUrls(s: string): string {
  if (!s) return s;
  return s.replace(EMBEDDED_URL, (match) => {
    try {
      const u = new URL(match);
      return isAppOrigin(u.hostname) ? match : u.host;
    } catch {
      return match;
    }
  });
}

/** The full treatment for a free-text field: embedded paths AND embedded
 *  source URLs, both reduced, with stack frames left readable. */
export function scrubMessage(s: string): string {
  return scrubUrls(scrubPaths(s));
}

/**
 * Walk a log payload and redact by key name.
 *
 * Which treatment to apply is chosen by key, not by guessing from the value:
 * a value-based guess would both miss titles that look ordinary and mangle
 * data that merely resembles a path. ID_KEYS is the one place a value is
 * consulted, and only to choose between two treatments the key has already
 * narrowed to — see its comment for why the key alone cannot decide.
 *
 * A bare top-level string has no key to consult, so it passes through
 * unredacted — callers must always log `{ title: x }`, never `x` directly.
 *
 * `seen` tracks only the current ancestor chain (entries are removed once a
 * subtree finishes), so a DAG — the same object reached twice via sibling
 * branches — is redacted normally both times; only a genuine cycle back to
 * an object still being processed yields `"<cycle>"`.
 */
export function redactValue(v: unknown, seen = new WeakSet<object>()): unknown {
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v as object)) return "<cycle>";
  seen.add(v as object);

  try {
    if (Array.isArray(v)) return v.map((x) => redactValue(x, seen));

    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "string") {
        if (TEXT_KEYS.test(k)) out[k] = hashTitle(val);
        else if (PATH_KEYS.test(k)) out[k] = redactPath(val);
        else if (URL_KEYS.test(k)) out[k] = redactUrl(val);
        else if (ID_KEYS.test(k)) out[k] = redactId(val);
        else if (MESSAGE_KEYS.test(k)) out[k] = scrubMessage(val);
        else out[k] = val;
      } else {
        out[k] = redactValue(val, seen);
      }
    }
    return out;
  } finally {
    seen.delete(v as object);
  }
}
