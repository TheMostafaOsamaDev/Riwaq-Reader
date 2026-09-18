// @vitest-environment happy-dom
//
// The repositories half. Three things are worth a test and the rest is
// markup: that the URL field refuses something the fetcher would choke on,
// that removing a repo tells the truth about what happens to the
// extensions installed from it, and that one unreachable repo does not
// take the other rows down with it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogEntry } from "../../extensions/catalog";
import type { RepoEntry } from "../../extensions/repos";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEMES } from "../../styles/tokens";
import { parseRepoUrl, RepoList, type RepoContent } from "./RepoList";

const OFFICIAL = "https://official.test/index.min.json";
const MIRROR = "https://mirror.test/index.min.json";

const repo = (url: string, name: string): RepoEntry => ({
  url,
  name,
  addedAt: "2026-01-01T00:00:00.000Z",
  lastFetchedAt: "2026-01-02T09:30:00.000Z",
});

function installedFrom(id: string, repoUrl: string): CatalogEntry {
  return {
    id,
    name: id,
    version: "1.0.0",
    installed: true,
    installedVersion: "1.0.0",
    updateAvailable: false,
    repoUrl,
    record: {
      manifest: {
        id,
        name: id,
        version: "1.0.0",
        apiVersion: 1,
        language: "ar",
        baseUrl: `https://${id}.test`,
      },
      origin: {
        repoUrl,
        sha256: "a".repeat(64),
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  };
}

let host: HTMLDivElement;
let root: Root | null = null;

interface Props {
  repos?: RepoEntry[];
  contents?: RepoContent[];
  catalog?: CatalogEntry[];
  onAdd?: (url: string) => Promise<"added" | "cancelled">;
  onRemove?: (url: string) => Promise<void>;
}

function render({
  repos = [repo(OFFICIAL, "Official")],
  contents = [{ repoUrl: OFFICIAL, entries: [], cached: false }],
  catalog = [],
  onAdd = vi.fn(async () => "added" as const),
  onRemove = vi.fn(async () => {}),
}: Props = {}) {
  const mounted = createRoot(host);
  root = mounted;
  act(() => {
    mounted.render(
      <I18nProvider locale="en">
        <RepoList
          theme={THEMES.light}
          repos={repos}
          contents={contents}
          catalog={catalog}
          officialRepoUrl={OFFICIAL}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      </I18nProvider>,
    );
  });
  return { onAdd, onRemove };
}

function typeUrl(url: string) {
  const input = host.querySelector("#extensions-repo-url") as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setValue?.call(input, url);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

function submitForm() {
  const form = host.querySelector("form") as HTMLFormElement;
  act(() => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

function click(label: string, scope: ParentNode = host) {
  const button = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button "${label}"`);
  act(() => {
    (button as HTMLButtonElement).click();
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

const alerts = () =>
  [...host.querySelectorAll('[role="alert"]')]
    .map((n) => n.textContent ?? "")
    .join(" ");

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  // The pure parseRepoUrl cases never render, so there may be no root.
  const mounted = root;
  root = null;
  if (mounted) {
    act(() => {
      mounted.unmount();
    });
  }
  host.remove();
  vi.restoreAllMocks();
});

describe("parseRepoUrl", () => {
  it("accepts an absolute http(s) URL", () => {
    expect(parseRepoUrl(" https://mirror.test/index.min.json ")).toBe(MIRROR);
    expect(parseRepoUrl("http://mirror.test/i.json")).toBe(
      "http://mirror.test/i.json",
    );
  });

  it("rejects text, a bare host, and a non-http scheme", () => {
    expect(parseRepoUrl("not a url")).toBeNull();
    expect(parseRepoUrl("mirror.test/index.min.json")).toBeNull();
    // Parses perfectly well as a URL and must still never reach the fetcher.
    expect(parseRepoUrl("javascript:alert(1)")).toBeNull();
    expect(parseRepoUrl("   ")).toBeNull();
  });
});

describe("RepoList — adding a repository", () => {
  it("refuses a value that is not a URL and never calls onAdd", async () => {
    const { onAdd } = render();
    typeUrl("definitely not a url");
    submitForm();
    await settle();
    expect(onAdd).not.toHaveBeenCalled();
    expect(alerts()).toContain("isn't a web address");
  });

  it("refuses a javascript: URL", async () => {
    const { onAdd } = render();
    typeUrl("javascript:alert(1)");
    submitForm();
    await settle();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("stays quiet while the user is still typing", () => {
    render();
    typeUrl("htt");
    expect(alerts()).toBe("");
  });

  it("complains on blur once the field has been left", () => {
    render();
    const input = typeUrl("htt");
    // React delegates onBlur to the bubbling `focusout`, not to `blur`.
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(alerts()).toContain("isn't a web address");
  });

  it("hands a valid URL to onAdd and clears the field", async () => {
    const { onAdd } = render();
    typeUrl(MIRROR);
    submitForm();
    await settle();
    expect(onAdd).toHaveBeenCalledWith(MIRROR);
    expect(
      (host.querySelector("#extensions-repo-url") as HTMLInputElement).value,
    ).toBe("");
  });

  it("keeps what was typed when the add was cancelled", async () => {
    const { onAdd } = render({
      onAdd: vi.fn(async () => "cancelled" as const),
    });
    typeUrl(MIRROR);
    submitForm();
    await settle();
    expect(onAdd).toHaveBeenCalled();
    expect(
      (host.querySelector("#extensions-repo-url") as HTMLInputElement).value,
    ).toBe(MIRROR);
  });

  it("reports a failed add inline instead of throwing it away", async () => {
    render({
      onAdd: vi.fn(async () => {
        throw new Error("HTTP 404");
      }),
    });
    typeUrl(MIRROR);
    submitForm();
    await settle();
    expect(alerts()).toContain("HTTP 404");
  });
});

describe("RepoList — removing a repository", () => {
  const twoRepos = [repo(OFFICIAL, "Official"), repo(MIRROR, "Mirror")];
  const twoContents: RepoContent[] = [
    { repoUrl: OFFICIAL, entries: [], cached: false },
    { repoUrl: MIRROR, entries: [], cached: false },
  ];

  it("names the extensions installed from that repo, and only those", async () => {
    render({
      repos: twoRepos,
      contents: twoContents,
      catalog: [
        installedFrom("from-mirror", MIRROR),
        installedFrom("also-mirror", MIRROR),
        installedFrom("from-official", OFFICIAL),
      ],
    });
    click("Remove");
    await settle();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("from-mirror");
    expect(dialog.textContent).toContain("also-mirror");
    expect(dialog.textContent).not.toContain("from-official");
    expect(dialog.textContent).toContain("stay installed and keep working");
  });

  it("says so when nothing installed came from that repo", async () => {
    render({
      repos: twoRepos,
      contents: twoContents,
      catalog: [installedFrom("from-official", OFFICIAL)],
    });
    click("Remove");
    await settle();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain(
      "Nothing installed came from this repository",
    );
  });

  it("removes nothing until the dialog is confirmed", async () => {
    const { onRemove } = render({ repos: twoRepos, contents: twoContents });
    click("Remove");
    await settle();
    expect(onRemove).not.toHaveBeenCalled();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    click("Remove", dialog);
    await settle();
    expect(onRemove).toHaveBeenCalledWith(MIRROR);
  });

  it("does not offer to remove the official repository", () => {
    render({ repos: twoRepos, contents: twoContents });
    // Exactly one Remove button on the page: the mirror's.
    const removes = [...host.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Remove",
    );
    expect(removes).toHaveLength(1);
    const officialRow = host.querySelector(
      `[data-testid="repo-row-${OFFICIAL}"]`,
    ) as HTMLElement;
    expect(officialRow.querySelector("button")).toBeNull();
    expect(officialRow.textContent).toContain("Bundled with Riwaq");
  });
});

describe("RepoList — a repo that could not be reached", () => {
  const twoRepos = [repo(OFFICIAL, "Official"), repo(MIRROR, "Mirror")];

  it("marks only that row as stale and keeps the other repo listed", () => {
    render({
      repos: twoRepos,
      contents: [
        { repoUrl: OFFICIAL, entries: [], cached: false },
        {
          repoUrl: MIRROR,
          entries: [],
          cached: true,
          fetchedAt: "2026-01-02T09:30:00.000Z",
        },
      ],
    });
    const official = host.querySelector(
      `[data-testid="repo-row-${OFFICIAL}"]`,
    ) as HTMLElement;
    const mirror = host.querySelector(
      `[data-testid="repo-row-${MIRROR}"]`,
    ) as HTMLElement;
    expect(mirror.querySelector('[role="alert"]')?.textContent).toContain(
      "showing the copy saved on this device",
    );
    expect(official.querySelector('[role="alert"]')).toBeNull();
    expect(official.textContent).toContain("Last checked");
  });

  it("reports an unreachable repo with no cached copy, with its reason", () => {
    render({
      repos: [repo(MIRROR, "Mirror")],
      contents: [
        {
          repoUrl: MIRROR,
          entries: [],
          cached: false,
          error: "network unreachable",
        },
      ],
    });
    expect(alerts()).toContain("network unreachable");
  });
});
