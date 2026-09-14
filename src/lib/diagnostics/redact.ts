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

/** Keys whose values are free text naming something the user chose. */
const TITLE_KEYS = /^(title|name|chapterTitle|bookTitle|author|novelTitle)$/i;
/** Keys whose values are filesystem paths. */
const PATH_KEYS = /^(path|file|filePath|dest|src|dir)$/i;
/** Keys whose values are URLs. */
const URL_KEYS = /^(url|href|link|novelUrl|chapterUrl|source)$/i;

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

/**
 * Walk a log payload and redact by key name.
 *
 * By key rather than by value sniffing: a value-based guess would both miss
 * titles that look ordinary and mangle data that merely resembles a path.
 */
export function redactValue(v: unknown, seen = new WeakSet<object>()): unknown {
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v as object)) return "<cycle>";
  seen.add(v as object);

  if (Array.isArray(v)) return v.map((x) => redactValue(x, seen));

  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") {
      if (TITLE_KEYS.test(k)) out[k] = hashTitle(val);
      else if (PATH_KEYS.test(k)) out[k] = redactPath(val);
      else if (URL_KEYS.test(k)) out[k] = redactUrl(val);
      else out[k] = val;
    } else {
      out[k] = redactValue(val, seen);
    }
  }
  return out;
}
