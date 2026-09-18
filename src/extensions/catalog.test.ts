import { describe, expect, it } from "vitest";
import { buildCatalog, compareVersions } from "./catalog";

const idx = (id: string, version: string) => ({
  id,
  name: id,
  version,
  apiVersion: 1,
  language: "ar",
  baseUrl: `https://${id}.test`,
  code: `${id}/index.js`,
  sha256: "a".repeat(64),
  size: 1,
});
const inst = (
  id: string,
  version: string,
  repoUrl = "https://repo.test/index.min.json",
) => ({
  manifest: {
    id,
    name: id,
    version,
    apiVersion: 1,
    language: "ar",
    baseUrl: `https://${id}.test`,
  },
  origin: {
    repoUrl,
    sha256: "a".repeat(64),
    installedAt: "2026-09-01T00:00:00Z",
  },
});

describe("compareVersions", () => {
  it("orders by numeric segment, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1); // "10" > "9"
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
  });

  it("treats a missing segment as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
  });
});

describe("buildCatalog", () => {
  it("flags an update when the repo is ahead", () => {
    const c = buildCatalog(
      [inst("cenele", "1.0.0")],
      [
        {
          repoUrl: "https://repo.test/index.min.json",
          entries: [idx("cenele", "1.1.0")],
        },
      ],
    );
    expect(c[0]).toMatchObject({
      installed: true,
      installedVersion: "1.0.0",
      updateAvailable: true,
      version: "1.1.0",
    });
  });

  it("does not flag an update when the installed version is newer or equal", () => {
    const c = buildCatalog(
      [inst("cenele", "2.0.0")],
      [
        {
          repoUrl: "https://repo.test/index.min.json",
          entries: [idx("cenele", "1.1.0")],
        },
      ],
    );
    expect(c[0].updateAvailable).toBe(false);
  });

  it("keeps an installed extension whose repo was removed, with no update offered", () => {
    const c = buildCatalog([inst("cenele", "1.0.0")], []);
    expect(c[0]).toMatchObject({ installed: true, updateAvailable: false });
  });

  it("lists an available-but-not-installed extension", () => {
    const c = buildCatalog(
      [],
      [
        {
          repoUrl: "https://repo.test/index.min.json",
          entries: [idx("kolnovel", "1.0.0")],
        },
      ],
    );
    expect(c[0]).toMatchObject({
      id: "kolnovel",
      installed: false,
      updateAvailable: false,
    });
  });

  it("does not let a second repo publishing the same id offer an update", () => {
    // Installed from repo A. Repo B — a different URL — advertises a
    // higher version of the same id. Only repo A may offer cenele an
    // update; repo B's higher version must not surface as one, and must
    // not overwrite the `entry` shown for it either.
    const c = buildCatalog(
      [inst("cenele", "1.0.0", "https://repo-a.test/index.min.json")],
      [
        {
          repoUrl: "https://repo-b.test/index.min.json",
          entries: [idx("cenele", "9.9.9")],
        },
      ],
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      installed: true,
      installedVersion: "1.0.0",
      updateAvailable: false,
    });
    expect(c[0].entry).toBeUndefined();
  });

  it("gives a not-installed id to the first configured repo that lists it", () => {
    // Nothing installed. Repo A and repo B both list "kolnovel", B with a
    // much higher version. Highest-version-wins would let B capture the
    // id just by publishing a bigger number, so repo order decides
    // instead: A was configured first, so A's entry, repoUrl and version
    // must all win together — none of the three may come from B.
    const c = buildCatalog(
      [],
      [
        {
          repoUrl: "https://repo-a.test/index.min.json",
          entries: [idx("kolnovel", "1.0.0")],
        },
        {
          repoUrl: "https://repo-b.test/index.min.json",
          entries: [idx("kolnovel", "9.9.9")],
        },
      ],
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      id: "kolnovel",
      installed: false,
      updateAvailable: false,
      repoUrl: "https://repo-a.test/index.min.json",
      version: "1.0.0",
    });
    expect(c[0].entry?.version).toBe("1.0.0");
  });
});
