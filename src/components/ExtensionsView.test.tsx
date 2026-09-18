// @vitest-environment happy-dom
//
// Behaviour, not markup. What a card OFFERS is the whole contract here —
// the five states differ only in which buttons exist and what the inline
// message says — so every assertion below is "which actions are on this
// card", "was this call made", or "did the card come back from a failure".
//
// The view takes its I/O as a `deps` object (same convention as
// install.ts's `InstallDeps`), so nothing here mocks a module: the tests
// hand it a registry that reports whatever status a case needs.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogEntry } from "../extensions/catalog";
import type { RepoEntry, RepoIndexEntry } from "../extensions/repos";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES } from "../styles/tokens";
import {
  type CatalogData,
  type ExtensionsDeps,
  ExtensionsView,
} from "./ExtensionsView";

const OFFICIAL = "https://official.test/index.min.json";

function repoEntry(id: string, version: string): RepoIndexEntry {
  return {
    id,
    name: id,
    version,
    apiVersion: 1,
    language: "ar",
    baseUrl: `https://${id}.test`,
    code: `${id}/index.js`,
    sha256: "a".repeat(64),
    size: 128,
  };
}

function installedRecord(id: string, version: string) {
  return {
    manifest: {
      id,
      name: id,
      version,
      apiVersion: 1,
      language: "ar",
      baseUrl: `https://${id}.test`,
    },
    origin: {
      repoUrl: OFFICIAL,
      sha256: "a".repeat(64),
      installedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

function available(id: string, version = "1.0.0"): CatalogEntry {
  return {
    id,
    name: id,
    version,
    installed: false,
    updateAvailable: false,
    repoUrl: OFFICIAL,
    entry: repoEntry(id, version),
  };
}

function installed(
  id: string,
  installedVersion = "1.0.0",
  latest = installedVersion,
): CatalogEntry {
  return {
    id,
    name: id,
    version: latest,
    installed: true,
    installedVersion,
    updateAvailable: latest !== installedVersion,
    repoUrl: OFFICIAL,
    entry: repoEntry(id, latest),
    record: installedRecord(id, installedVersion),
  };
}

const repo: RepoEntry = {
  url: OFFICIAL,
  name: "Official",
  addedAt: "2026-01-01T00:00:00.000Z",
};

function data(catalog: CatalogEntry[]): CatalogData {
  return {
    repos: [repo],
    contents: [{ repoUrl: OFFICIAL, entries: [], cached: false }],
    catalog,
  };
}

interface Setup {
  catalog: CatalogEntry[];
  status?: Record<string, "ok" | "broken" | "api-version" | "missing">;
  errors?: Record<string, string>;
  over?: Partial<ExtensionsDeps>;
}

let host: HTMLDivElement;
let root: Root;

function makeDeps({ catalog, status = {}, errors = {}, over = {} }: Setup) {
  const deps: ExtensionsDeps = {
    loadCatalog: vi.fn(async () => data(catalog)),
    initExtensions: vi.fn(async () => {}),
    getExtensionStatus: (id) =>
      status[id] ??
      (catalog.find((c) => c.id === id)?.installed ? "ok" : "missing"),
    getExtensionError: (id) => errors[id],
    getSourceIconUrl: () => undefined,
    installExtension: vi.fn(async () => {}),
    uninstallExtension: vi.fn(async () => {}),
    addRepo: vi.fn(async () => ({})),
    removeRepo: vi.fn(async () => {}),
    hasAcknowledgedTrustNotice: vi.fn(async () => true),
    acknowledgeTrustNotice: vi.fn(async () => {}),
    officialRepoUrl: OFFICIAL,
    ...over,
  };
  return deps;
}

async function mount(deps: ExtensionsDeps) {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <ExtensionsView theme={THEMES.light} onBack={() => {}} deps={deps} />
      </I18nProvider>,
    );
  });
  // Flush the mount effect's loadCatalog().
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const card = (id: string) =>
  host.querySelector(`[data-testid="extension-card-${id}"]`) as HTMLElement;

const actionsOn = (id: string) =>
  [...card(id).querySelectorAll("button")].map((b) => b.textContent?.trim());

function click(label: string, scope: ParentNode = host) {
  const button = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) {
    throw new Error(
      `no button "${label}" among [${[...scope.querySelectorAll("button")]
        .map((b) => b.textContent?.trim())
        .join(" | ")}]`,
    );
  }
  act(() => {
    (button as HTMLButtonElement).click();
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
});

describe("ExtensionsView — what each card state offers", () => {
  it("offers Install, and nothing destructive, for an extension that is not installed", async () => {
    await mount(makeDeps({ catalog: [available("fresh")] }));
    expect(actionsOn("fresh")).toEqual(["Install"]);
  });

  it("offers only Remove for an installed extension with no update", async () => {
    await mount(makeDeps({ catalog: [installed("steady")] }));
    expect(actionsOn("steady")).toEqual(["Remove"]);
  });

  it("offers Update before Remove when an update is available", async () => {
    await mount(makeDeps({ catalog: [installed("aged", "1.0.0", "1.1.0")] }));
    // Order matters: the destructive action is last in the cluster, which
    // is what puts it last in reading order under RTL too.
    expect(actionsOn("aged")).toEqual(["Update", "Remove"]);
  });

  it("shows the installed → available version pair when an update is available", async () => {
    await mount(makeDeps({ catalog: [installed("aged", "1.0.0", "1.1.0")] }));
    expect(card("aged").textContent).toContain("v1.0.0 → v1.1.0");
  });

  it("offers Retry and Remove, and shows the captured load error, for a broken extension", async () => {
    await mount(
      makeDeps({
        catalog: [installed("snapped")],
        status: { snapped: "broken" },
        errors: { snapped: "export default is not a function" },
      }),
    );
    expect(actionsOn("snapped")).toEqual(["Retry", "Remove"]);
    expect(
      card("snapped").querySelector('[role="alert"]')?.textContent,
    ).toContain("export default is not a function");
  });

  it("offers only Remove, with the newer-Riwaq notice, on an api-version mismatch", async () => {
    await mount(
      makeDeps({
        catalog: [installed("future")],
        status: { future: "api-version" },
      }),
    );
    expect(actionsOn("future")).toEqual(["Remove"]);
    expect(
      card("future").querySelector('[role="alert"]')?.textContent,
    ).toContain("Requires a newer version of Riwaq");
  });

  it("refuses Install, with a reason, for an entry built against another contract major", async () => {
    // loader.ts gates on the manifest's apiVersion, so this entry would
    // install perfectly and then refuse to load — a plain Install button
    // whose only possible outcome is a broken card. The index declares the
    // apiVersion, so the card can say so before the download.
    const entry = available("futuristic");
    entry.entry = { ...entry.entry!, apiVersion: 2 };
    await mount(makeDeps({ catalog: [entry] }));

    const install = [...card("futuristic").querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Install",
    ) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    expect(
      card("futuristic").querySelector('[role="alert"]')?.textContent,
    ).toContain("Built for a different version of Riwaq");
  });

  it("still offers Install for an entry on this contract major", async () => {
    // The counterweight: a gate that refused everything would satisfy the
    // case above and make the Available list uninstallable.
    await mount(makeDeps({ catalog: [available("fresh")] }));
    const install = [...card("fresh").querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Install",
    ) as HTMLButtonElement;
    expect(install.disabled).toBe(false);
  });

  it("does not offer Update on a broken extension even when a newer version is listed", async () => {
    await mount(
      makeDeps({
        catalog: [installed("snapped", "1.0.0", "1.1.0")],
        status: { snapped: "broken" },
      }),
    );
    expect(actionsOn("snapped")).toEqual(["Retry", "Remove"]);
  });
});

describe("ExtensionsView — installing", () => {
  it("installs from the entry's own repo and refreshes the registry afterwards", async () => {
    const deps = makeDeps({ catalog: [available("fresh")] });
    await mount(deps);
    click("Install", card("fresh"));
    await settle();

    expect(deps.installExtension).toHaveBeenCalledWith(
      OFFICIAL,
      expect.objectContaining({ id: "fresh" }),
    );
    // Without this the Store's sources list would not see the new source
    // until the app restarted.
    expect(deps.initExtensions).toHaveBeenCalled();
    expect(deps.loadCatalog).toHaveBeenCalledTimes(2);
  });

  it("leaves a failed install recoverable: the error shows and Install is still offered", async () => {
    const deps = makeDeps({
      catalog: [available("fresh")],
      over: {
        installExtension: vi.fn(async () => {
          throw new Error("Checksum mismatch");
        }),
      },
    });
    await mount(deps);
    click("Install", card("fresh"));
    await settle();

    expect(
      card("fresh").querySelector('[role="alert"]')?.textContent,
    ).toContain("Checksum mismatch");
    // Still the not-installed card, not a half-installed row.
    expect(actionsOn("fresh")).toEqual(["Install"]);

    click("Install", card("fresh"));
    await settle();
    expect(deps.installExtension).toHaveBeenCalledTimes(2);
  });

  it("does not refresh the registry when the install threw", async () => {
    const deps = makeDeps({
      catalog: [available("fresh")],
      over: {
        installExtension: vi.fn(async () => {
          throw new Error("HTTP 404");
        }),
      },
    });
    await mount(deps);
    click("Install", card("fresh"));
    await settle();
    expect(deps.initExtensions).not.toHaveBeenCalled();
  });

  it("re-downloads the bundle when Retry is pressed on a broken extension", async () => {
    const deps = makeDeps({
      catalog: [installed("snapped")],
      status: { snapped: "broken" },
      errors: { snapped: "boom" },
    });
    await mount(deps);
    click("Retry", card("snapped"));
    await settle();
    expect(deps.installExtension).toHaveBeenCalledWith(
      OFFICIAL,
      expect.objectContaining({ id: "snapped" }),
    );
  });
});

describe("ExtensionsView — Update all", () => {
  it("is not offered when nothing is outdated", async () => {
    await mount(
      makeDeps({ catalog: [installed("steady"), available("fresh")] }),
    );
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        b.textContent?.trim().startsWith("Update all"),
      ),
    ).toBe(false);
  });

  it("updates every outdated extension, and nothing else", async () => {
    const deps = makeDeps({
      catalog: [
        installed("aged", "1.0.0", "1.1.0"),
        installed("older", "2.0.0", "3.0.0"),
        installed("steady"),
        available("fresh"),
      ],
    });
    await mount(deps);

    click("Update all (2)");
    await settle();

    const ids = vi
      .mocked(deps.installExtension)
      .mock.calls.map(([, entry]) => (entry as { id: string }).id);
    expect(ids.sort()).toEqual(["aged", "older"]);
  });

  it("leaves a broken extension to its own Retry", async () => {
    // A broken card offers Retry, not Update — sweeping it into a bulk
    // update would hide a failure the user is meant to answer per card.
    const deps = makeDeps({
      catalog: [
        installed("aged", "1.0.0", "1.1.0"),
        installed("snapped", "1.0.0", "1.1.0"),
      ],
      status: { snapped: "broken" },
    });
    await mount(deps);

    click("Update all (1)");
    await settle();

    const ids = vi
      .mocked(deps.installExtension)
      .mock.calls.map(([, entry]) => (entry as { id: string }).id);
    expect(ids).toEqual(["aged"]);
  });

  it("keeps going, and reports per card, when one update fails", async () => {
    const deps = makeDeps({
      catalog: [
        installed("aged", "1.0.0", "1.1.0"),
        installed("older", "2.0.0", "3.0.0"),
      ],
      over: {
        installExtension: vi.fn(async (_repo, entry) => {
          if ((entry as { id: string }).id === "aged") {
            throw new Error("disk full");
          }
        }),
      },
    });
    await mount(deps);

    click("Update all (2)");
    await settle();

    const ids = vi
      .mocked(deps.installExtension)
      .mock.calls.map(([, entry]) => (entry as { id: string }).id);
    expect(ids.sort()).toEqual(["aged", "older"]);
    expect(card("aged").querySelector('[role="alert"]')?.textContent).toContain(
      "disk full",
    );
    expect(card("older").querySelector('[role="alert"]')).toBeNull();
  });
});

describe("ExtensionsView — removing an extension", () => {
  it("asks before uninstalling anything", async () => {
    const deps = makeDeps({ catalog: [installed("steady")] });
    await mount(deps);
    click("Remove", card("steady"));
    await settle();
    expect(deps.uninstallExtension).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(
      "steady",
    );
  });

  it("uninstalls and refreshes the registry once the dialog is confirmed", async () => {
    const deps = makeDeps({ catalog: [installed("steady")] });
    await mount(deps);
    click("Remove", card("steady"));
    await settle();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    click("Remove", dialog);
    await settle();
    expect(deps.uninstallExtension).toHaveBeenCalledWith("steady");
    expect(deps.initExtensions).toHaveBeenCalled();
  });

  it("keeps the extension when the dialog is cancelled", async () => {
    const deps = makeDeps({ catalog: [installed("steady")] });
    await mount(deps);
    click("Remove", card("steady"));
    await settle();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    click("Cancel", dialog);
    await settle();
    expect(deps.uninstallExtension).not.toHaveBeenCalled();
  });
});

describe("ExtensionsView — the one-time trust notice", () => {
  function typeUrl(url: string) {
    const input = host.querySelector(
      "#extensions-repo-url",
    ) as HTMLInputElement;
    // React installs its own `value` setter to track changes; assigning
    // `input.value` directly goes through it and the synthetic onChange
    // never fires. Go through the prototype's setter instead — the standard
    // way to type into a controlled input from a test.
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setValue?.call(input, url);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function submitForm() {
    const form = host.querySelector("form") as HTMLFormElement;
    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  }

  it("holds the add until the notice is accepted, then records it", async () => {
    const deps = makeDeps({
      catalog: [],
      over: { hasAcknowledgedTrustNotice: vi.fn(async () => false) },
    });
    await mount(deps);
    typeUrl("https://mirror.test/index.min.json");
    submitForm();
    await settle();

    expect(deps.addRepo).not.toHaveBeenCalled();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Extensions run with Riwaq's access");

    click("I understand — add it", dialog);
    await settle();
    expect(deps.addRepo).toHaveBeenCalledWith(
      "https://mirror.test/index.min.json",
    );
    expect(deps.acknowledgeTrustNotice).toHaveBeenCalledTimes(1);
  });

  it("does not re-list the registry for a repository edit", async () => {
    // Adding a repo changes what is OFFERED, never what is installed, so a
    // registry refresh here is a full directory re-list plus a bundle-cache
    // pass that cannot change a single answer the registry gives. The
    // catalogue reload is the part that actually differs, so it must still
    // happen.
    const deps = makeDeps({ catalog: [] });
    await mount(deps);
    const catalogLoads = vi.mocked(deps.loadCatalog).mock.calls.length;

    typeUrl("https://mirror.test/index.min.json");
    submitForm();
    await settle();

    expect(deps.addRepo).toHaveBeenCalled();
    expect(deps.initExtensions).not.toHaveBeenCalled();
    expect(vi.mocked(deps.loadCatalog).mock.calls.length).toBeGreaterThan(
      catalogLoads,
    );
  });

  it("adds nothing when the notice is declined", async () => {
    const deps = makeDeps({
      catalog: [],
      over: { hasAcknowledgedTrustNotice: vi.fn(async () => false) },
    });
    await mount(deps);
    typeUrl("https://mirror.test/index.min.json");
    submitForm();
    await settle();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    click("Cancel", dialog);
    await settle();
    expect(deps.addRepo).not.toHaveBeenCalled();
    expect(deps.acknowledgeTrustNotice).not.toHaveBeenCalled();
  });

  it("does not show the notice again once it has been acknowledged", async () => {
    const deps = makeDeps({ catalog: [] });
    await mount(deps);
    typeUrl("https://mirror.test/index.min.json");
    submitForm();
    await settle();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(deps.addRepo).toHaveBeenCalledWith(
      "https://mirror.test/index.min.json",
    );
  });
});

describe("ExtensionsView — retrying a broken extension", () => {
  it("explains a retry that cannot re-download, instead of doing nothing visible", async () => {
    // A broken extension whose repo has since been removed has no entry to
    // re-download from, so Retry can only re-run the loader — and the
    // registry caches an evaluation failure by content hash, so that
    // changes nothing. Silence here reads as a dead button.
    const orphan = {
      ...installed("orphan"),
      entry: undefined,
      repoUrl: undefined,
    };
    const deps = makeDeps({
      catalog: [orphan],
      status: { orphan: "broken" },
      errors: { orphan: "bundle threw on evaluation" },
    });
    await mount(deps);

    click("Retry", card("orphan"));
    await settle();

    expect(deps.installExtension).not.toHaveBeenCalled();
    expect(deps.initExtensions).toHaveBeenCalled();
    expect(card("orphan").textContent).toContain("no longer configured");
  });

  it("stays quiet when a reload-only retry actually fixed it", async () => {
    // The read-failure case: the bundle was unreadable, the registry does
    // NOT cache that, so re-running the loader really can recover. No
    // message belongs here.
    const orphan = {
      ...installed("orphan"),
      entry: undefined,
      repoUrl: undefined,
    };
    const status: Record<string, "ok" | "broken"> = { orphan: "broken" };
    const deps = makeDeps({
      catalog: [orphan],
      status,
      errors: { orphan: "ENOENT" },
      over: {
        initExtensions: vi.fn(async () => {
          status.orphan = "ok";
        }),
      },
    });
    await mount(deps);

    click("Retry", card("orphan"));
    await settle();

    expect(card("orphan").textContent).not.toContain("no longer configured");
  });
});

describe("ExtensionsView — catalogue load failure", () => {
  it("offers a retry rather than an empty page when the catalogue cannot be read", async () => {
    let fail = true;
    const deps = makeDeps({
      catalog: [available("fresh")],
      over: {
        loadCatalog: vi.fn(async () => {
          if (fail) throw new Error("disk is on fire");
          return data([available("fresh")]);
        }),
      },
    });
    await mount(deps);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "disk is on fire",
    );

    fail = false;
    click("Retry");
    await settle();
    expect(card("fresh")).not.toBeNull();
  });

  it("says the list is stale when a refresh fails AFTER one succeeded", async () => {
    // The dangerous shape: the first load worked, so a list is on screen.
    // A refresh that then fails used to leave that list in place with no
    // sign at all — a removed extension still offering Remove — because
    // reload() swallows its own throw and removeExtension() reports
    // success. The rows must stay (they are the last known good state) and
    // the staleness must be visible.
    let calls = 0;
    const deps = makeDeps({
      catalog: [installed("steady")],
      over: {
        loadCatalog: vi.fn(async () => {
          calls++;
          if (calls > 1) throw new Error("disk went away");
          return data([installed("steady")]);
        }),
      },
    });
    await mount(deps);
    expect(card("steady")).not.toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();

    click("Remove", card("steady"));
    await settle();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    click("Remove", dialog);
    await settle();

    expect(deps.uninstallExtension).toHaveBeenCalledWith("steady");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "disk went away",
    );
    // The rows survive: a failed refresh must not blank a working list.
    expect(card("steady")).not.toBeNull();
  });
});
