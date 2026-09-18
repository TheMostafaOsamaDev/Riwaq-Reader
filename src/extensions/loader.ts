// Turns bundle source into a live Source. Every failure is returned, not
// thrown: one broken extension must leave the Store and every other
// extension working, with an inline error on its own card.

import { API_VERSION, type Source, type SourceHost } from "../sources/types";
import { loadModuleFromSource, type ModuleImporter } from "./loadModule";
import type { ExtensionManifest } from "./storage";

export type LoadResult =
  | { ok: true; source: Source }
  | { ok: false; reason: "api-version" | "load-error"; message: string };

/**
 * Evaluate one extension bundle behind the apiVersion gate.
 *
 * `importModule` is a test seam, forwarded to loadModuleFromSource — Node's
 * ESM loader refuses the `blob:` URLs that module mints, so evaluation
 * cannot be exercised under Vitest without substituting an importer (see
 * loader.test.ts and the note in loadModule.test.ts). Production callers
 * pass nothing and get a real dynamic import().
 */
export async function loadExtension(
  manifest: ExtensionManifest,
  source: string,
  host: SourceHost,
  importModule?: ModuleImporter,
): Promise<LoadResult> {
  // Gate first, before any of the bundle's top-level code runs: a bundle
  // built against a different contract major must not execute at all.
  if (manifest.apiVersion !== API_VERSION) {
    return {
      ok: false,
      reason: "api-version",
      message:
        manifest.apiVersion > API_VERSION
          ? `"${manifest.name}" requires a newer version of Riwaq.`
          : `"${manifest.name}" was built for an older version of Riwaq and needs updating.`,
    };
  }

  try {
    const mod = (await loadModuleFromSource(source, importModule)) as {
      default?: unknown;
    };
    if (typeof mod.default !== "function") {
      throw new Error("bundle has no default-exported factory function");
    }
    const instance = (mod.default as (h: SourceHost) => Source)(host);
    if (!instance || typeof instance.canHandle !== "function") {
      throw new Error("factory did not return a Source");
    }
    return { ok: true, source: instance };
  } catch (e) {
    return {
      ok: false,
      reason: "load-error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
