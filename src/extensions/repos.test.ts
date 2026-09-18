import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- @tauri-apps/plugin-fs mock: in-memory files + dirs, same pattern as
// storage.test.ts. ----
const files = new Map<string, string>();
const dirs = new Set<string>();

function requireBaseDir(opts?: { baseDir?: unknown }): void {
  if (!opts || opts.baseDir === undefined) {
    throw new Error("missing baseDir");
  }
}

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: vi.fn(async (p: string, opts?: { baseDir?: unknown }) => {
    requireBaseDir(opts);
    return files.has(p) || dirs.has(p);
  }),
  mkdir: vi.fn(async (p: string, opts?: { baseDir?: unknown }) => {
    requireBaseDir(opts);
    // Mirrors real recursive mkdir: every ancestor becomes its own entry.
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }),
  readTextFile: vi.fn(async (p: string, opts?: { baseDir?: unknown }) => {
    requireBaseDir(opts);
    if (!files.has(p)) throw new Error(`ENOENT ${p}`);
    return files.get(p) as string;
  }),
  writeTextFile: vi.fn(
    async (p: string, c: string, opts?: { baseDir?: unknown }) => {
      requireBaseDir(opts);
      if (failWritesMatching?.test(p)) throw new Error(`EIO ${p}`);
      files.set(p, c);
    },
  ),
  remove: vi.fn(async (p: string, opts?: { baseDir?: unknown }) => {
    requireBaseDir(opts);
    files.delete(p);
    dirs.delete(p);
    for (const k of [...files.keys()])
      if (k.startsWith(`${p}/`)) files.delete(k);
    for (const d of [...dirs]) if (d.startsWith(`${p}/`)) dirs.delete(d);
  }),
}));

// ---- @tauri-apps/api/core mock: a single swappable `invoke`, same
// convention as src/sources/host.test.ts. ----
let invokeImpl: (cmd: string, args: unknown) => Promise<unknown> = async (
  cmd,
) => {
  throw new Error(`invoke not stubbed for ${cmd}`);
};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeImpl(cmd, args),
}));

import {
  MAX_BUNDLE_BYTES,
  OFFICIAL_REPO_URL,
  acknowledgeTrustNotice,
  addRepo,
  fetchRepoIndex,
  hasAcknowledgedTrustNotice,
  listRepos,
  parseRepoIndex,
  removeRepo,
  resolveAssetUrl,
  saveRepos,
} from "./repos";

/** When set, every writeTextFile to a matching path fails. Lets a test put
 *  a disk error on one specific write rather than on all of them. */
let failWritesMatching: RegExp | null = null;

beforeEach(() => {
  files.clear();
  dirs.clear();
  failWritesMatching = null;
  invokeImpl = async (cmd) => {
    throw new Error(`invoke not stubbed for ${cmd}`);
  };
});

const valid = {
  name: "Riwaq Official Extensions",
  apiVersion: 1,
  extensions: [
    {
      id: "cenele",
      name: "فضاء الروايات",
      version: "1.0.0",
      apiVersion: 1,
      language: "ar",
      baseUrl: "https://cenele.com",
      code: "cenele/index.js",
      icon: "cenele/icon.png",
      sha256:
        "e2810d52b592c3f9b4b1499dc1f14b4baf196db93a5f1830d38af009ebb0393a",
      size: 12756,
    },
  ],
};

describe("parseRepoIndex", () => {
  it("accepts the real published index shape", () => {
    const index = parseRepoIndex(valid);
    expect(index.extensions[0].id).toBe("cenele");
  });

  it("rejects an entry with no sha256 — an unverifiable bundle must never install", () => {
    const bad = structuredClone(valid);
    delete (bad.extensions[0] as Record<string, unknown>).sha256;
    expect(() => parseRepoIndex(bad)).toThrow(/sha256/i);
  });

  it("rejects a non-object payload", () => {
    expect(() => parseRepoIndex("nope")).toThrow();
  });

  it("drops entries missing required fields but keeps the rest", () => {
    const mixed = structuredClone(valid);
    mixed.extensions.push({ id: "broken" } as never);
    expect(parseRepoIndex(mixed).extensions.map((e) => e.id)).toEqual([
      "cenele",
    ]);
  });
});

describe("parseRepoIndex — the id is a path component", () => {
  // A repo index is a remote document and its `id` becomes a directory
  // name: `installed/<id>`, `staging/<id>`, `trash/<id>`. Until this
  // validation existed, `"id": "../../../evil"` was an arbitrary file write
  // outside app data on Windows the moment the user pressed Install —
  // storage.ts's EXTENSION_ID_RE has the mechanism.
  const withId = (id: unknown) => {
    const doc = structuredClone(valid) as { extensions: unknown[] };
    const entry = structuredClone(valid.extensions[0]) as Record<
      string,
      unknown
    >;
    entry.id = id;
    doc.extensions = [entry];
    return doc;
  };
  const ids = (doc: unknown) => parseRepoIndex(doc).extensions.map((e) => e.id);

  it("drops a traversing id", () => {
    // The Windows-shaped case: `$APPDATA/**` glob-matches this because
    // require_literal_leading_dot is false there and the scope only
    // canonicalises paths that already exist.
    expect(ids(withId("../../../evil"))).toEqual([]);
  });

  it("drops a bare dot and a bare double dot", () => {
    expect(ids(withId("."))).toEqual([]);
    expect(ids(withId(".."))).toEqual([]);
  });

  it("drops an id with a path separator in it", () => {
    // Not an attack, but it installs into a nested directory listInstalled
    // then silently skips: the install "succeeds" and nothing appears.
    expect(ids(withId("a/b"))).toEqual([]);
    expect(ids(withId("a\\b"))).toEqual([]);
  });

  it("drops a dot-prefixed id", () => {
    // Tauri's fs scope refuses dot-prefixed components on macOS, Linux and
    // Android, so this would install and then be unreadable.
    expect(ids(withId(".hidden"))).toEqual([]);
  });

  it("drops an absurdly long id", () => {
    expect(ids(withId("a".repeat(65)))).toEqual([]);
  });

  it("keeps the ids real extensions actually use", () => {
    // The counterweight: a rule that rejected everything would pass every
    // case above and ship an app that can install nothing.
    expect(ids(withId("cenele"))).toEqual(["cenele"]);
    expect(ids(withId("kolnovel-pro"))).toEqual(["kolnovel-pro"]);
    expect(ids(withId("sea_novel.v2"))).toEqual(["sea_novel.v2"]);
    expect(ids(withId("a"))).toEqual(["a"]);
  });

  it("drops an entry whose declared size is over the bundle limit", () => {
    const doc = structuredClone(valid) as { extensions: unknown[] };
    const fat = structuredClone(valid.extensions[0]) as Record<string, unknown>;
    fat.size = MAX_BUNDLE_BYTES + 1;
    doc.extensions = [fat];
    expect(parseRepoIndex(doc).extensions).toEqual([]);
    // ...and the ordinary one beside it is still fine.
    expect(ids(withId("cenele"))).toEqual(["cenele"]);
  });

  it("keeps the good entries when a bad id sits beside them", () => {
    const doc = structuredClone(valid) as { extensions: unknown[] };
    const evil = structuredClone(valid.extensions[0]) as Record<
      string,
      unknown
    >;
    evil.id = "../../../evil";
    doc.extensions = [evil, ...doc.extensions];
    expect(ids(doc)).toEqual(["cenele"]);
  });
});

describe("resolveAssetUrl", () => {
  // code/icon are relative to the index URL so a fork or mirror works
  // without editing any URL inside the index.
  it("resolves relative to the index URL", () => {
    expect(
      resolveAssetUrl(
        "https://host.test/repo/index.min.json",
        "cenele/index.js",
      ),
    ).toBe("https://host.test/repo/cenele/index.js");
  });
});

// ---------------------------------------------------------------------------
// Coverage beyond the brief's Step 1 test: parseRepoIndex/resolveAssetUrl
// are pure and already covered above, but listRepos/addRepo/removeRepo and
// the cache-fallback half of fetchRepoIndex are this task's other named
// exports and the reason it exists ("...validate, cache"). They get the
// same TDD treatment rather than shipping untested.
// ---------------------------------------------------------------------------

const okResponse = (body: unknown) => ({
  status: 200,
  text: JSON.stringify(body),
  headers: {},
});

describe("listRepos", () => {
  it("seeds and persists the official repo on first run", async () => {
    const repos = await listRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].url).toBe(OFFICIAL_REPO_URL);
    expect(files.has("riwaq/extensions/repos.json")).toBe(true);
  });

  it("reads back a persisted list rather than re-seeding it", async () => {
    // Write a custom repos.json directly, bypassing listRepos/addRepo
    // entirely, so this only passes if listRepos actually reads the file
    // rather than regenerating the official-repo seed on every call.
    const persisted = [
      {
        url: "https://custom.test/index.min.json",
        name: "Custom",
        addedAt: "2020-01-01T00:00:00.000Z",
      },
    ];
    files.set("riwaq/extensions/repos.json", JSON.stringify(persisted));

    const repos = await listRepos();
    expect(repos).toEqual(persisted);
  });

  it("does not replace an unreadable repos.json with the official seed", async () => {
    // Absent and unreadable are different things. A blanket catch treated
    // them as one, so a transient read error or a half-written repos.json
    // silently seeded the official repo OVER every repository the user had
    // added — the file was gone before they could notice.
    const persisted = JSON.stringify([
      { url: "https://custom.test/index.min.json", name: "C", addedAt: "x" },
    ]);
    files.set("riwaq/extensions/repos.json", `${persisted} <-- truncated`);

    await expect(listRepos()).rejects.toThrow();

    expect(files.get("riwaq/extensions/repos.json")).toBe(
      `${persisted} <-- truncated`,
    );
  });

  it("still seeds when the file is genuinely absent", async () => {
    // The counterweight to the case above: refusing to seed at all would
    // satisfy it and leave a first run with no repositories.
    expect(files.has("riwaq/extensions/repos.json")).toBe(false);
    expect((await listRepos()).map((r) => r.url)).toEqual([OFFICIAL_REPO_URL]);
  });

  it("does not quietly drop the trust acknowledgement when repos.json won't parse", async () => {
    // saveRepos read-then-writes so a list update keeps the flag that
    // shares the file. Swallowing the read failure wrote the loss back:
    // the user is asked to accept the notice again, with no sign why.
    files.set("riwaq/extensions/repos.json", "{ not json");
    await expect(
      saveRepos([{ url: "https://r.test/i.json", name: "R", addedAt: "x" }]),
    ).rejects.toThrow();
    expect(files.get("riwaq/extensions/repos.json")).toBe("{ not json");
  });
});

// Deliberately NOT named "Riwaq Official Extensions": that string is also
// the hardcoded seed name in listRepos(). A test that fetches an index and
// then asserts the entry's name equals that same literal would pass even
// if addRepo hardcoded the seed name instead of reading index.name.
const mirrorIndex = { ...valid, name: "Mirror Extensions" };

describe("addRepo / removeRepo", () => {
  it("fetches the new repo's index, then appends it to the persisted list", async () => {
    invokeImpl = async () => okResponse(mirrorIndex);
    const entry = await addRepo("https://mirror.test/index.min.json");
    expect(entry.name).toBe("Mirror Extensions");

    const repos = await listRepos();
    expect(repos.map((r) => r.url)).toContain(
      "https://mirror.test/index.min.json",
    );
  });

  it("accepts a bare origin and stores the index url it resolved to", async () => {
    // The extensions repo's own `pnpm dev-repo` documents its loop as "add
    // http://localhost:8787", but the index is served at /index.min.json and
    // the origin itself 404s. Both spellings have to work.
    const seen: string[] = [];
    invokeImpl = async (_cmd, args) => {
      const url = (args as { url: string }).url;
      seen.push(url);
      if (!url.endsWith("index.min.json")) throw new Error("404 Not Found");
      return okResponse(mirrorIndex);
    };

    const entry = await addRepo("http://localhost:8787");

    expect(seen).toEqual([
      "http://localhost:8787",
      "http://localhost:8787/index.min.json",
    ]);
    // The RESOLVED url is what persists — resolveAssetUrl resolves each
    // extension's code/icon against it, so storing the origin would point
    // those at the wrong base.
    expect(entry.url).toBe("http://localhost:8787/index.min.json");
    expect((await listRepos()).map((r) => r.url)).toContain(
      "http://localhost:8787/index.min.json",
    );
  });

  it("reports the error for the url the user typed, not the appended one", async () => {
    // A host that is simply unreachable must not be reported as "couldn't
    // find /index.min.json" — that sends the reader looking for a path
    // problem when the real one is the host.
    invokeImpl = async (_cmd, args) => {
      const url = (args as { url: string }).url;
      throw new Error(url.endsWith("index.min.json") ? "404" : "ECONNREFUSED");
    };
    await expect(addRepo("http://nope.test")).rejects.toThrow(/ECONNREFUSED/);
  });

  it("does not append a second path to a url that already names a json file", async () => {
    // Otherwise a genuine 404 on a real index url would be retried against
    // .../index.min.json/index.min.json and reported as that.
    const seen: string[] = [];
    invokeImpl = async (_cmd, args) => {
      seen.push((args as { url: string }).url);
      throw new Error("404");
    };
    await expect(addRepo("https://mirror.test/index.min.json")).rejects.toThrow(
      /404/,
    );
    expect(seen).toEqual(["https://mirror.test/index.min.json"]);
  });

  it("refuses to add a repo url that's already present", async () => {
    await listRepos(); // seeds OFFICIAL_REPO_URL
    await expect(addRepo(OFFICIAL_REPO_URL)).rejects.toThrow(/already/i);
  });

  it("removes a repo from the persisted list without touching the others", async () => {
    invokeImpl = async () => okResponse(mirrorIndex);
    await addRepo("https://mirror.test/index.min.json");
    await removeRepo("https://mirror.test/index.min.json");

    const repos = await listRepos();
    expect(repos.map((r) => r.url)).not.toContain(
      "https://mirror.test/index.min.json",
    );
    expect(repos.map((r) => r.url)).toContain(OFFICIAL_REPO_URL);
  });

  it("deletes the removed repo's cached index too, so index-cache/ doesn't grow forever", async () => {
    invokeImpl = async () => okResponse(mirrorIndex);
    // addRepo fetches, which writes a cache file for this URL.
    await addRepo("https://mirror.test/index.min.json");
    const before = [...files.keys()].filter((k) =>
      k.startsWith("riwaq/extensions/index-cache/"),
    );
    expect(before).toHaveLength(1);

    await removeRepo("https://mirror.test/index.min.json");
    const after = [...files.keys()].filter((k) =>
      k.startsWith("riwaq/extensions/index-cache/"),
    );
    expect(after).toHaveLength(0);
  });
});

describe("fetchRepoIndex", () => {
  it("fetches, validates and caches a good index", async () => {
    invokeImpl = async (cmd, args) => {
      expect(cmd).toBe("source_fetch");
      expect(args).toEqual({
        url: "https://mirror.test/index.min.json",
        options: null,
      });
      return okResponse(valid);
    };
    const { index, cached } = await fetchRepoIndex(
      "https://mirror.test/index.min.json",
    );
    expect(cached).toBe(false);
    expect(index.extensions[0].id).toBe("cenele");

    const cacheFiles = [...files.keys()].filter((k) =>
      k.startsWith("riwaq/extensions/index-cache/"),
    );
    expect(cacheFiles).toHaveLength(1);
  });

  it("falls back to the last good cached index when the repo goes unreachable", async () => {
    invokeImpl = async () => okResponse(valid);
    const good = await fetchRepoIndex("https://mirror.test/index.min.json");
    expect(good.cached).toBe(false);

    invokeImpl = async () => {
      throw new Error("network down");
    };
    const fallback = await fetchRepoIndex("https://mirror.test/index.min.json");
    expect(fallback.cached).toBe(true);
    expect(fallback.index).toEqual(good.index);
    // The stale timestamp from the last GOOD fetch, not the failed attempt.
    expect(fallback.fetchedAt).toBe(good.fetchedAt);
  });

  it("treats a non-2xx HTTP status as a failure and still falls back to cache", async () => {
    invokeImpl = async () => okResponse(valid);
    await fetchRepoIndex("https://mirror.test/index.min.json");

    invokeImpl = async () => ({ status: 500, text: "oops", headers: {} });
    const fallback = await fetchRepoIndex("https://mirror.test/index.min.json");
    expect(fallback.cached).toBe(true);
  });

  it("reports a healthy repo even when the cache write fails", async () => {
    // The cache write used to sit inside the fetch's own try, so a disk
    // error AFTER a perfectly successful fetch fell into the cache
    // fallback: with an older cache it reported a fresh index as stale,
    // and with none it rethrew a filesystem error as "repo unreachable".
    invokeImpl = async () => okResponse(valid);
    failWritesMatching = /index-cache/;

    const result = await fetchRepoIndex("https://mirror.test/index.min.json");

    expect(result.cached).toBe(false);
    expect(result.index.extensions[0].id).toBe("cenele");
  });

  it("does not replay a stale cache after a fetch that actually succeeded", async () => {
    // The same bug's other face: with a cache already on disk, the failed
    // write dropped through to it and answered `cached: true` — the Store
    // then tells the user the repo could not be reached.
    invokeImpl = async () => okResponse(valid);
    const first = await fetchRepoIndex("https://mirror.test/index.min.json");
    expect(first.cached).toBe(false);

    const cacheKey = [...files.keys()].find((k) => k.includes("index-cache"));
    const cachedBefore = files.get(cacheKey as string);

    failWritesMatching = /index-cache/;
    const second = await fetchRepoIndex("https://mirror.test/index.min.json");

    expect(second.cached).toBe(false);
    // ...and the write really did fail, so this is the path it claims.
    expect(files.get(cacheKey as string)).toBe(cachedBefore);
  });

  it("throws when the repo is unreachable and there is no cache yet", async () => {
    invokeImpl = async () => {
      throw new Error("network down");
    };
    await expect(
      fetchRepoIndex("https://mirror.test/index.min.json"),
    ).rejects.toThrow(/network down/);
  });

  it("rejects an unverifiable fetched index rather than caching it", async () => {
    const bad = structuredClone(valid);
    delete (bad.extensions[0] as Record<string, unknown>).sha256;
    invokeImpl = async () => okResponse(bad);

    await expect(
      fetchRepoIndex("https://mirror.test/index.min.json"),
    ).rejects.toThrow(/sha256/i);
    expect(
      [...files.keys()].some((k) =>
        k.startsWith("riwaq/extensions/index-cache/"),
      ),
    ).toBe(false);
  });

  it("gives two URLs that collided under the old 32-bit rolling hash distinct cache slots", async () => {
    // These two URLs were found by brute force (~1.2e5 trials) to collide
    // under the previous Math.imul/base36 cacheName: both hashed to
    // "ny56e1c", so one repo's cache write would silently overwrite the
    // other's last-good fallback. A real SHA-256 of the URL must not
    // repeat that — this pins the fix against a future regression back
    // to a truncated/weak hash, not just "any two URLs differ".
    const urlA = "https://8lqtt7.example.com/index.min.json";
    const urlB = "https://8lqtru.example.com/index.min.json";
    const indexA = { ...valid, name: "Repo A" };
    const indexB = { ...valid, name: "Repo B" };

    invokeImpl = async (_cmd, args) => {
      const { url } = args as { url: string };
      return okResponse(url === urlA ? indexA : indexB);
    };
    await fetchRepoIndex(urlA);
    await fetchRepoIndex(urlB);

    const cacheFiles = [...files.keys()].filter((k) =>
      k.startsWith("riwaq/extensions/index-cache/"),
    );
    expect(cacheFiles).toHaveLength(2);

    // Each URL's own cache holds its own index, not the other's.
    invokeImpl = async () => {
      throw new Error("network down");
    };
    const fallbackA = await fetchRepoIndex(urlA);
    const fallbackB = await fetchRepoIndex(urlB);
    expect(fallbackA.index.name).toBe("Repo A");
    expect(fallbackB.index.name).toBe("Repo B");
  });
});

// ---------------------------------------------------------------------------
// The one-time "extensions run with the app's access" notice. It is stored
// as a field of repos.json rather than in a file of its own — one place
// owns what the user has been told about repositories — so these also pin
// that a list update never drops it and that the pre-existing bare-array
// file still reads.
// ---------------------------------------------------------------------------
describe("trust notice acknowledgement", () => {
  it("has not been acknowledged before anything is stored", async () => {
    expect(await hasAcknowledgedTrustNotice()).toBe(false);
  });

  it("is false for a repos.json that predates the field", async () => {
    files.set(
      "riwaq/extensions/repos.json",
      JSON.stringify([
        { url: OFFICIAL_REPO_URL, name: "Official", addedAt: "2020-01-01" },
      ]),
    );
    expect(await hasAcknowledgedTrustNotice()).toBe(false);
  });

  it("records the acknowledgement so it survives a reload", async () => {
    await acknowledgeTrustNotice();
    expect(await hasAcknowledgedTrustNotice()).toBe(true);
  });

  it("keeps the repo list intact when it records the acknowledgement", async () => {
    invokeImpl = async () => okResponse(mirrorIndex);
    await addRepo("https://mirror.test/index.min.json");
    await acknowledgeTrustNotice();
    expect((await listRepos()).map((r) => r.url)).toContain(
      "https://mirror.test/index.min.json",
    );
  });

  it("survives a later repo add, which rewrites the same file", async () => {
    await acknowledgeTrustNotice();
    invokeImpl = async () => okResponse(mirrorIndex);
    await addRepo("https://mirror.test/index.min.json");
    expect(await hasAcknowledgedTrustNotice()).toBe(true);
  });

  it("survives a repo removal", async () => {
    invokeImpl = async () => okResponse(mirrorIndex);
    await addRepo("https://mirror.test/index.min.json");
    await acknowledgeTrustNotice();
    await removeRepo("https://mirror.test/index.min.json");
    expect(await hasAcknowledgedTrustNotice()).toBe(true);
  });

  it("keeps the first timestamp rather than rewriting it", async () => {
    // Two calls inside the same millisecond would produce identical JSON
    // whether or not the second one short-circuits, so move the clock.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      await acknowledgeTrustNotice();
      vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
      await acknowledgeTrustNotice();
    } finally {
      vi.useRealTimers();
    }
    const stored = files.get("riwaq/extensions/repos.json") as string;
    expect(stored).toContain("2026-01-01T00:00:00.000Z");
    expect(stored).not.toContain("2026-06-01");
  });
});
