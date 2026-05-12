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
import type { FetchOptions, FetchResponse, SourceHost } from "./types";

interface TauriFetchResponse {
  status: number;
  text: string;
  headers: Record<string, string>;
}

/**
 * Build a SourceHost bound to a specific source id. The id is used purely
 * for log-line prefixing; it does not gate access to any host primitive.
 */
export function createHost(sourceId: string): SourceHost {
  return {
    async fetch(url, options) {
      const resp = await invoke<TauriFetchResponse>("source_fetch", {
        url,
        options: normalizeFetchOptions(options),
      });
      return resp as FetchResponse;
    },

    async fetchBytes(url, options) {
      const bytes = await invoke<number[]>("source_fetch_bytes", {
        url,
        options: normalizeFetchOptions(options),
      });
      return new Uint8Array(bytes);
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
