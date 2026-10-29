// @vitest-environment happy-dom
//
// The Store landing's search field and the language filter beside it.
// The registry is the only thing mocked: it is what decides which sources
// exist, and the view reads it directly.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { SourceMetadata } from "../sources/types";
import { THEMES } from "../styles/tokens";
import { SourcesListView } from "./SourcesListView";

let sources: SourceMetadata[] = [];

vi.mock("../sources/registry", () => ({
  listSources: () => sources,
}));

const source = (id: string, language: string): SourceMetadata => ({
  id,
  name: id,
  baseUrl: `https://${id}.test`,
  language,
  version: "1.0.0",
});

let host: HTMLDivElement;
let root: Root;

function mount(locale: "en" | "ar" = "en") {
  root = createRoot(host);
  act(() => {
    root.render(
      <I18nProvider locale={locale}>
        <SourcesListView
          theme={THEMES.light}
          onOpenSource={() => {}}
          onOpenExtensions={() => {}}
        />
      </I18nProvider>,
    );
  });
}

const languageGroup = () =>
  host.querySelector('[role="group"][aria-label="Language"]');

function choose(label: string) {
  const button = [...(languageGroup()?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no language choice "${label}"`);
  act(() => {
    (button as HTMLButtonElement).click();
  });
}

function typeSearch(text: string) {
  const input = host.querySelector('input[type="search"]') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setValue?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const shownIds = () =>
  [...host.querySelectorAll("button")]
    .map((b) => b.textContent ?? "")
    .flatMap((t) => t.match(/[a-z]+(?=\.test)/) ?? []);

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
});

describe("SourcesListView — search and language filter", () => {
  it("still narrows the sources to the typed query", () => {
    sources = [source("kolnovel", "ar"), source("novelbuddy", "en")];
    mount();
    typeSearch("buddy");
    expect(shownIds()).toEqual(["novelbuddy"]);
  });

  it("keeps only the chosen language's sources", () => {
    sources = [
      source("cenele", "ar"),
      source("kolnovel", "ar"),
      source("novelbuddy", "en"),
    ];
    mount();
    choose("Arabic");
    expect(shownIds()).toEqual(["cenele", "kolnovel"]);
    choose("All");
    expect(shownIds()).toEqual(["cenele", "kolnovel", "novelbuddy"]);
  });

  it("offers no language choice when every source shares one language", () => {
    sources = [source("cenele", "ar"), source("kolnovel", "ar")];
    mount();
    expect(languageGroup()).toBeNull();
  });

  it("names languages in the interface's own language", () => {
    sources = [source("kolnovel", "ar"), source("novelbuddy", "en")];
    mount("ar");
    const group = host.querySelector('[role="group"][aria-label="اللغة"]');
    expect(
      [...(group?.querySelectorAll("button") ?? [])].map((b) =>
        b.textContent?.trim(),
      ),
    ).toEqual(["الكل", "الإنجليزية", "العربية"]);
  });

  it("names each source's language on its card instead of the raw code", () => {
    sources = [source("novelbuddy", "en")];
    mount();
    expect(host.textContent).toContain("English · v1.0.0");
  });

  it("says nothing matches when the query and language rule everything out", () => {
    sources = [source("kolnovel", "ar"), source("novelbuddy", "en")];
    mount();
    choose("English");
    typeSearch("kol");
    expect(shownIds()).toEqual([]);
    expect(host.textContent).toContain("No websites match");
  });
});
