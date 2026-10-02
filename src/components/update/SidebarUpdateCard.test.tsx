// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(async () => {}),
  openUrl: vi.fn(async (_url: string) => {}),
  invoke: vi.fn(async (_cmd: string, _args?: unknown) => ({
    notes: {
      version: "0.6.0",
      date: "2026-10-15",
      items: [
        { kind: "new", en: "Updates in the sidebar", ar: "تحديثات في الشريط" },
      ],
    },
  })),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: h.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: h.relaunch }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "macos" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import type { Locale } from "../../i18n";
import { I18nProvider } from "../../i18n/I18nProvider";
import * as store from "../../store/desktopUpdate";
import { RELEASES_PAGE_URL } from "../../store/updates";
import { THEMES } from "../../styles/tokens";
import { LibrarySidebar } from "../LibrarySidebar";
import { DesktopSettingsUpdateCard } from "./DesktopSettingsUpdateCard";
import { DesktopUpdateLayer } from "./DesktopUpdateLayer";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};
const theme = THEMES.sepia;
let root: Root | null = null;
const saved: (string | undefined)[] = [];

function fakeUpdate(o: { downloadFails?: boolean } = {}) {
  return {
    download: vi.fn(async () => {
      if (o.downloadFails) throw new Error("net");
    }),
    install: vi.fn(async () => {}),
    downloadAndInstall: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

async function mount(locale: Locale = "en") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <I18nProvider locale={locale}>
        <LibrarySidebar
          theme={theme}
          themeKey="sepia"
          tab="reading"
          setTab={noop}
          importing={false}
          onImport={noop}
          onImportFolder={noop}
          onOpenQueue={noop}
          onOpenSettings={noop}
          onOpenSearch={noop}
          shelfActive
          shelves={[]}
          shelvesActive={false}
          onOpenShelves={noop}
          onNewShelf={noop}
          onOpenShelf={noop}
        />
        <DesktopSettingsUpdateCard theme={theme} />
        <DesktopUpdateLayer theme={theme} />
      </I18nProvider>,
    );
  });
}

async function offer(channel: "auto" | "manual" = "auto") {
  store.configure({
    running: "0.5.4",
    skipped: undefined,
    saveSkipped: (v) => saved.push(v),
  });
  await act(async () => {
    await store.offer({ version: "0.6.0", channel });
  });
}

const card = () => document.querySelector("[data-update-card]");
const buttons = () => [...document.querySelectorAll("button")];
const button = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === text,
  );
const settingsNav = () =>
  buttons().find((b) =>
    /^Settings|^الإعدادات/.test(
      b.getAttribute("aria-label") ?? b.textContent ?? "",
    ),
  );
// The newest dialog: one that just closed stays mounted for its exit.
const dialog = () => {
  const all = document.querySelectorAll('[role="dialog"]');
  return all[all.length - 1] ?? null;
};
async function click(b: Element | undefined) {
  expect(b).toBeTruthy();
  await act(async () => {
    (b as HTMLElement).click();
  });
}

beforeEach(() => {
  store.__resetForTests();
  saved.length = 0;
  document.body.innerHTML = "";
  h.check.mockReset();
  h.relaunch.mockClear();
  h.openUrl.mockClear();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  store.__resetForTests();
});

describe("SidebarUpdateCard", () => {
  it("shows nothing until there is an offer (Flatpak never gets one)", async () => {
    await mount();
    expect(card()).toBeNull();
    expect(document.body.textContent).not.toContain("is available");
  });

  it("available → the card; clicking opens the dialog with Later, Skip, Update", async () => {
    await mount();
    await offer();
    expect(card()?.textContent).toContain("Riwaq 0.6.0 is available");
    expect(card()?.textContent).toContain("What's new");
    await click(card()?.querySelector("button") ?? undefined);
    const d = dialog();
    expect(d?.textContent).toContain("Updates in the sidebar");
    expect(button("Later", d!)).toBeTruthy();
    expect(button("Skip this version", d!)).toBeTruthy();
    expect(button("Update", d!)).toBeTruthy();
  });

  it("Skip hides the card, sets the tweak, and leaves no dot", async () => {
    await mount();
    await offer();
    await click(card()?.querySelector("button") ?? undefined);
    await click(button("Skip this version"));
    expect(card()).toBeNull();
    expect(saved).toEqual(["0.6.0"]);
    expect(settingsNav()?.getAttribute("aria-label")).not.toBe(
      "Settings, update available",
    );
    expect(document.querySelector("[data-update-dot]")).toBeNull();
    expect(document.body.textContent).toContain("Undo");
  });

  it("Later hides the card and puts the dot on Settings", async () => {
    await mount();
    await offer();
    expect(document.querySelector("[data-update-dot]")).toBeNull();
    await click(card()?.querySelector("button") ?? undefined);
    await click(button("Later"));
    expect(card()).toBeNull();
    expect(document.querySelector("[data-update-dot]")).toBeTruthy();
    expect(settingsNav()?.getAttribute("aria-label")).toBe(
      "Settings, update available",
    );
    expect(document.body.textContent).toContain("It'll wait for you");
  });

  it("Update downloads, then Restart now installs and relaunches", async () => {
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    await mount();
    await offer();
    await click(card()?.querySelector("button") ?? undefined);
    await click(button("Update", dialog()!));
    expect(card()?.textContent).toContain("Riwaq 0.6.0 is ready");
    expect(h.relaunch).not.toHaveBeenCalled();
    await click(button("Restart now", card()!));
    expect(u.install).toHaveBeenCalledTimes(1);
    expect(h.relaunch).toHaveBeenCalledTimes(1);
  });

  it("a failure shows a red card with Try again; its dialog offers GitHub", async () => {
    h.check.mockResolvedValue(fakeUpdate({ downloadFails: true }));
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    expect(card()?.textContent).toContain("The update didn't finish");
    expect(button("Try again", card()!)).toBeTruthy();
    await click(card()?.querySelector("button") ?? undefined);
    const d = dialog();
    expect(button("Download from GitHub", d!)).toBeTruthy();
    expect(button("Try again", d!)).toBeTruthy();
    await click(button("Download from GitHub", d!));
    expect(h.openUrl).toHaveBeenCalledWith(RELEASES_PAGE_URL);
  });

  it("the progress dialog offers Hide and no Cancel", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    h.check.mockResolvedValue({
      ...fakeUpdate(),
      download: vi.fn(async () => {
        await gate;
      }),
    });
    await mount();
    await offer();
    await click(card()?.querySelector("button") ?? undefined);
    await click(button("Update", dialog()!));
    const d = dialog();
    expect(d?.textContent).toContain("Downloading 0.6.0…");
    expect(button("Hide", d!)).toBeTruthy();
    expect(button("Cancel", d!)).toBeUndefined();
    await act(async () => open());
  });

  it("manual channel: Download, the .deb/.rpm note, and never check()", async () => {
    await mount();
    await offer("manual");
    await click(card()?.querySelector("button") ?? undefined);
    const d = dialog();
    expect(d?.textContent).toContain("can't update itself");
    await click(button("Download", d!));
    expect(h.openUrl).toHaveBeenCalledWith(RELEASES_PAGE_URL);
    expect(h.check).not.toHaveBeenCalled();
  });

  it("Settings → About shows the update after Later", async () => {
    await mount();
    await offer();
    store.later();
    await act(async () => {});
    const s = document.querySelector("[data-settings-update]");
    expect(s?.textContent).toContain("Riwaq 0.6.0 is available");
    expect(s?.textContent).toContain("Updates in the sidebar");
    expect(button("Update", s!)).toBeTruthy();
  });

  it("renders the Arabic strings", async () => {
    h.check.mockResolvedValue(fakeUpdate());
    await mount("ar");
    await offer();
    expect(card()?.textContent).toContain("الإصدار 0.6.0 من رواق متاح");
    await act(async () => {
      await store.update();
    });
    expect(card()?.textContent).toContain("رواق 0.6.0 جاهز");
    expect(button("أعد التشغيل الآن", card()!)).toBeTruthy();
  });
});
