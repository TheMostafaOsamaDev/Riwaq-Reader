// Source registry — a small lookup table from source id to its constructor.
//
// In v1 the registry is statically populated from the `extensions/` folder
// that lives inside this codebase. Each extension exports a default factory
// that takes a `SourceHost` and returns a `Source`. The host calls the
// factory the first time a source is requested and caches the instance for
// the session.
//
// Future work: load extensions from $APPDATA/leaflet/extensions/ at startup,
// each bundle a JS file + manifest.json. The registry's public API stays
// the same — `listSources()` and `getSource(id)` — so the rest of the app
// doesn't need to know whether a source is built-in or sideloaded.

import { createHost } from "./host";
import { createCeneleSource } from "./extensions/cenele";
import { createKolNovelSource } from "./extensions/kolnovel";
import { createKolNovelProSource } from "./extensions/kolnovel-pro";
import type { Source, SourceHost, SourceMetadata } from "./types";

type SourceFactory = (host: SourceHost) => Source;

interface RegistryEntry {
  meta: SourceMetadata;
  factory: SourceFactory;
}

// Built-in extensions. Add new entries here as we port more sites. Keep
// them alphabetized by id so the panel listing has a stable order.
const BUILTINS: RegistryEntry[] = [
  {
    meta: {
      id: "cenele",
      name: "Cenele",
      baseUrl: "https://cenele.com",
      language: "ar",
      description:
        "Arabic translations of Asian web novels from cenele.com (فضاء الروايات).",
      version: "0.1.0",
    },
    factory: (host) => createCeneleSource(host),
  },
  {
    meta: {
      id: "kolnovel",
      name: "KolNovel",
      baseUrl: "https://free.kolnovel.com",
      language: "ar",
      description: "Arabic translations of Asian novels from free.kolnovel.com.",
      version: "0.1.0",
    },
    factory: (host) => createKolNovelSource(host),
  },
  {
    meta: {
      id: "kolnovel-pro",
      name: "KolNovel Pro",
      baseUrl: "https://kolnovel.com",
      language: "ar",
      description:
        "Arabic novels from kolnovel.com delivered as PDF chapters with the official illustrations.",
      version: "0.1.0",
    },
    factory: (host) => createKolNovelProSource(host),
  },
];

// Cache of constructed Source instances. Sources are stateless w.r.t. the
// user's library, so it's safe to keep them around for the whole session.
const instances = new Map<string, Source>();

/** List metadata for every source available in this build. The panel UI
 *  uses this to render the source list without instantiating anything — so
 *  enumerating doesn't pay for the construction cost of every extension. */
export function listSources(): SourceMetadata[] {
  return BUILTINS.map((b) => b.meta);
}

/** Lazily construct (and cache) a Source instance by id. Returns null when
 *  the id isn't registered. */
export function getSource(id: string): Source | null {
  const cached = instances.get(id);
  if (cached) return cached;
  const entry = BUILTINS.find((b) => b.meta.id === id);
  if (!entry) return null;
  const host = createHost(entry.meta.id);
  const instance = entry.factory(host);
  instances.set(id, instance);
  return instance;
}

/** Find the first registered source whose `canHandle(url)` returns true.
 *  Used by the import dialog to auto-pick a source from a pasted URL. */
export function findSourceForUrl(url: string): Source | null {
  for (const entry of BUILTINS) {
    const source = getSource(entry.meta.id);
    if (source && source.canHandle(url)) return source;
  }
  return null;
}
