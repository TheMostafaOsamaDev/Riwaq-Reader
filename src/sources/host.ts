// The SourceHost implementation — concrete bridge between extensions and
// the Rust scraper commands defined in src-tauri/src/sources.rs.
//
// Extensions receive an opaque `host: SourceHost` and never touch Tauri or
// the network directly. That lets us:
//   - swap implementations (e.g. a record/replay fixture host for tests),
//   - tag every log line with the calling source's id so a misbehaving
//     extension is easy to identify in dev tools,
//   - centrally enforce per-source rate limits / concurrency caps in one
//     place rather than re-implementing them in each extension.

import { invoke } from "@tauri-apps/api/core";
import { isChallengeResponse } from "./challenge";
import { extractPdfLines } from "./pdf/pdfChapter";
import type { FetchOptions, FetchResponse, Locale, SourceHost } from "./types";

interface TauriFetchResponse {
  status: number;
  text: string;
  headers: Record<string, string>;
}

/** The UI language, read outside the React tree. App.tsx keeps <html lang>
 *  in sync with the user's preference, and this module is plain DOM code
 *  with no access to useI18n(). */
function currentLocale(): Locale {
  return typeof document !== "undefined" &&
    document.documentElement.lang === "ar"
    ? "ar"
    : "en";
}

/** One plain request, retried through the session webview if — and only if
 *  — Cloudflare challenged it. Extensions never see this happen: the
 *  contract exposes no session-fetch escape hatch of its own, so this
 *  retry protects every extension rather than only the one that knew to
 *  ask for it.
 *
 *  Text only, deliberately. `fetchBytes` gets no equivalent because there
 *  is nothing for it to retry WITH and nothing for it to retry ON:
 *    - `source_fetch_bytes` (src-tauri/src/sources.rs) turns any non-2xx
 *      into `Err("HTTP <status> for <url>")` and discards the body and
 *      headers, so a challenged byte fetch never produces a response for
 *      isChallengeResponse to inspect in the first place;
 *    - `source_session_fetch` resolves to a FetchResponse whose body is
 *      `text`, because the session webview runs a same-origin `fetch`
 *      inside a real page. Re-encoding an image's decoded text back into
 *      bytes does not round-trip, so there is no byte transport to fall
 *      back to even once a challenge is known.
 *  This matches what the retired cenele extension actually did: all six of
 *  its session-fetched requests were text (pages and admin-ajax), never
 *  images. */
async function fetchWithChallengeRetry(
  sourceId: string,
  url: string,
  options: FetchOptions | undefined,
): Promise<FetchResponse> {
  const normalized = normalizeFetchOptions(options);
  const resp = await invoke<TauriFetchResponse>("source_fetch", {
    url,
    options: normalized,
  });
  if (!isChallengeResponse(resp)) return resp as FetchResponse;

  console.info(
    `[source:${sourceId}] challenged at ${url}; retrying in session`,
  );
  try {
    return (await invoke<TauriFetchResponse>("source_session_fetch", {
      input: { url, ...normalized },
    })) as FetchResponse;
  } catch (e) {
    // Mobile has no session webview. Say so plainly rather than letting a
    // parser report a selector regression that does not exist.
    //
    // `hostname` is resolved defensively: a source that passes a relative
    // or malformed URL would otherwise make `new URL()` throw from inside
    // this handler, replacing this deliberately plain message with an
    // opaque one AND discarding the original failure — the exact outcome
    // the paragraph above exists to prevent.
    throw new Error(
      `${hostnameOf(url)} is blocking automated access (Cloudflare ` +
        `challenge) and the in-app browser check could not run: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Build a SourceHost bound to a specific source id. The id is used purely
 * for log-line prefixing; it does not gate access to any host primitive.
 */
export function createHost(sourceId: string): SourceHost {
  return {
    fetch(url, options) {
      return fetchWithChallengeRetry(sourceId, url, options);
    },

    async fetchBytes(url, options) {
      // The command returns `tauri::ipc::Response`, so the bytes normally
      // arrive as an ArrayBuffer. The `number[]` arm in the type is a hedge
      // for a stale command binding during development, where the old
      // Vec<u8>-as-JSON-array reply could still show up. `new Uint8Array`
      // already handles both shapes correctly (view over an ArrayBuffer,
      // element copy over an array-like) — no branch needed.
      const buf = await invoke<ArrayBuffer | number[]>("source_fetch_bytes", {
        url,
        options: normalizeFetchOptions(options),
      });
      return new Uint8Array(buf);
    },

    async renderAndExtract(url, options) {
      const json = await invoke<string>("source_render_and_extract", {
        input: {
          url,
          waitForPredicate: options.waitForPredicate,
          waitForSelector: options.waitForSelector,
          script: options.script,
          timeoutMs: options.timeoutMs,
        } satisfies RenderExtractInputPayload,
      });
      try {
        return JSON.parse(json);
      } catch (e) {
        throw new Error(
          `[${sourceId}] renderAndExtract: invalid JSON returned by extractor — ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    },

    get locale() {
      return currentLocale();
    },

    pdf: {
      extractChapter(bytes, options) {
        return extractPdfLines(bytes, {
          chapterUrl: options.chapterUrl,
          novelTitle: options.novelTitle,
          mintImageRef: options.mintImageRef,
          log: (msg) => console.debug(`[source:${sourceId}] pdf: ${msg}`),
        });
      },
    },

    log(level, message) {
      const tag = `[source:${sourceId}]`;
      // eslint-disable-next-line no-console
      switch (level) {
        case "debug":
          console.debug(tag, message);
          break;
        case "info":
          console.info(tag, message);
          break;
        case "warn":
          console.warn(tag, message);
          break;
        case "error":
          console.error(tag, message);
          break;
      }
    },
  };
}

interface RenderExtractInputPayload {
  url: string;
  waitForPredicate?: string;
  waitForSelector?: string;
  script: string;
  timeoutMs?: number;
}

function normalizeFetchOptions(
  options: FetchOptions | undefined,
): TauriFetchOptionsPayload | null {
  if (!options) return null;
  const out: TauriFetchOptionsPayload = {};
  if (options.method) out.method = options.method;
  if (options.headers) out.headers = options.headers;
  if (options.body !== undefined) out.body = options.body;
  return out;
}

interface TauriFetchOptionsPayload {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

// ── DOM-side helpers for parsing static HTML ───────────────────────────────
//
// Most extensions will mix `host.fetch` (static HTML) and `host.renderAndExtract`
// (JS-rendered). For the static path we need DOM access in the main webview;
// DOMParser is the right tool. We don't add this to the SourceHost interface
// because it doesn't need to cross the Tauri boundary — but we ship it here
// so all extensions can import a consistent helper without rolling their
// own.

/** Parse an HTML string into a Document. Equivalent to
 *  `new DOMParser().parseFromString(html, "text/html")` but with a clearer
 *  name for the caller's intent. */
export function parseHtmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/** Resolve a URL relative to a base. Throws on invalid input. */
export function absolutizeUrl(href: string, base: string): string {
  return new URL(href, base).toString();
}

/** Get the inner text of the first element matching `selector` within
 *  `root`, trimmed. Returns null when no match. */
export function textOf(root: ParentNode, selector: string): string | null {
  const el = root.querySelector(selector);
  if (!el) return null;
  return (el.textContent || "").trim() || null;
}

/** Get an attribute value of the first element matching `selector`. */
export function attrOf(
  root: ParentNode,
  selector: string,
  attr: string,
): string | null {
  const el = root.querySelector(selector);
  if (!el) return null;
  return el.getAttribute(attr);
}
