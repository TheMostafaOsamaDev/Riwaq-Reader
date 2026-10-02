// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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
import { SidebarUpdateCard } from "./SidebarUpdateCard";

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

// Only timers and the clock are faked: the arming delay is a timer, and
// promises (the mocked plugins) must still resolve on their own.
const ARM = 1000;
async function arm() {
  await act(async () => {
    vi.advanceTimersByTime(ARM);
  });
}

beforeEach(() => {
  // Date too: the store's own restart guard reads the clock.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  store.__resetForTests();
  saved.length = 0;
  document.body.innerHTML = "";
  h.check.mockReset();
  h.relaunch.mockClear();
  h.openUrl.mockClear();
});
afterEach(async () => {
  vi.useRealTimers();
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
    await arm();
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

  it("ready: the card and the Settings card say the restart is safe", async () => {
    h.check.mockResolvedValue(fakeUpdate());
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    const body =
      "Restart Riwaq to finish. Your books and progress stay exactly where they are.";
    expect(card()?.textContent).toContain(body);
    expect(
      document.querySelector("[data-settings-update]")?.textContent,
    ).toContain(body);
  });

  it("ready: the sidebar note is clamped to one line, its full text in the title", async () => {
    // At an 800 px window the unclamped (then two-line) note pushed Settings
    // half out of view. One line now; the full text is in the title, the
    // Settings card and the notes dialog.
    h.check.mockResolvedValue(fakeUpdate());
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    const body =
      "Restart Riwaq to finish. Your books and progress stay exactly where they are.";
    const note = card()?.querySelector<HTMLElement>("[data-update-note]");
    expect(note?.textContent).toBe(body);
    expect(note?.title).toBe(body);
    // happy-dom's CSSOM drops the -webkit-box declarations it does not
    // know, so read the style React itself serialises for the same card.
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <SidebarUpdateCard theme={theme} />
      </I18nProvider>,
    );
    const style = /data-update-note="[^"]*"[^>]*style="([^"]*)"/.exec(
      html,
    )?.[1];
    expect(style).toMatch(/display:\s*-webkit-box/);
    expect(style).toMatch(/line-clamp:\s*1/);
    expect(style).toMatch(/box-orient:\s*vertical/);
    expect(style).toMatch(/overflow:\s*hidden/);
  });

  it("relaunch failing after a good install says to reopen, not that nothing changed", async () => {
    h.check.mockResolvedValue(fakeUpdate());
    h.relaunch.mockImplementationOnce(async () => {
      throw new Error("no");
    });
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    await arm();
    await click(button("Restart now", card()!));
    expect(card()?.textContent).toContain(
      "The update is installed. Quit and reopen Riwaq to finish.",
    );
    expect(document.body.textContent).not.toContain("Nothing was changed");
  });

  it("one live region, mounted before the card, announces the offer", async () => {
    await mount();
    const live = document.querySelector("[data-update-live]");
    expect(live).toBeTruthy();
    await offer();
    const after = document.querySelector("[data-update-live]");
    expect(after).toBe(live);
    expect(after?.textContent).toBe("Riwaq 0.6.0 is available");
    expect(document.querySelectorAll("[data-update-live]").length).toBe(1);
  });

  it("the notes dialog follows the state: Restart now when ready", async () => {
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    await act(async () => store.openDialog("notes"));
    const d = dialog()!;
    expect(button("Update", d)).toBeUndefined();
    await arm();
    await click(button("Restart now", d));
    expect(u.install).toHaveBeenCalled();
  });

  it("the notes dialog while downloading: no Update, a disabled Downloading…", async () => {
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
    void store.update();
    await act(async () => {});
    await act(async () => store.openDialog("notes"));
    const d = dialog()!;
    expect(button("Update", d)).toBeUndefined();
    expect(button("Downloading…", d)?.disabled).toBe(true);
    await act(async () => open());
  });

  // The Task 14 macOS run restarted ~2 s after a download, unexplained; a
  // second click or stray input on the old Update spot is suspected. These
  // pin the protection, whatever the cause was.
  it("Settings: a click on the old spot right after the download does not restart", async () => {
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    await mount();
    await offer();
    const settings = () => document.querySelector("[data-settings-update]")!;
    const updateBtn = button("Update", settings());
    await click(updateBtn);
    // The download has resolved: the card is ready.
    expect(store.getState().phase).toBe("ready");
    // Whatever now sits where Update was, and Restart now itself, ignore a
    // click inside the arming delay.
    const restartBtn = button("Restart now", settings());
    expect(restartBtn).toBeTruthy();
    expect(restartBtn).not.toBe(updateBtn);
    expect(restartBtn?.getAttribute("aria-disabled")).toBe("true");
    await click(restartBtn);
    await click(updateBtn?.isConnected ? updateBtn : restartBtn);
    expect(u.install).not.toHaveBeenCalled();
    expect(h.relaunch).not.toHaveBeenCalled();
    await arm();
    expect(
      button("Restart now", settings())?.getAttribute("aria-disabled"),
    ).not.toBe("true");
    await click(button("Restart now", settings()));
    expect(u.install).toHaveBeenCalledTimes(1);
    expect(h.relaunch).toHaveBeenCalledTimes(1);
  });

  it("sidebar: Try again then an immediate second click does not restart", async () => {
    const bad = fakeUpdate({ downloadFails: true });
    const good = fakeUpdate();
    h.check.mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    const tryAgain = button("Try again", card()!);
    await click(tryAgain);
    expect(store.getState().phase).toBe("ready");
    const restartBtn = button("Restart now", card()!);
    expect(restartBtn).not.toBe(tryAgain);
    await click(restartBtn);
    expect(good.install).not.toHaveBeenCalled();
    await arm();
    await click(button("Restart now", card()!));
    expect(good.install).toHaveBeenCalledTimes(1);
  });

  it("notes dialog opened when ready: Restart now waits out the arming delay", async () => {
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    await arm();
    await act(async () => store.openDialog("notes"));
    await click(button("Restart now", dialog()!));
    expect(u.install).not.toHaveBeenCalled();
    await arm();
    await click(button("Restart now", dialog()!));
    expect(u.install).toHaveBeenCalledTimes(1);
  });

  it("notes dialog: close and reopen within a second re-arms Restart now", async () => {
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    await arm();
    await act(async () => store.openDialog("notes"));
    await arm();
    await act(async () => store.closeDialog());
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await act(async () => store.openDialog("notes"));
    const btn = button("Restart now", dialog()!);
    expect(btn?.getAttribute("aria-disabled")).toBe("true");
    await click(btn);
    expect(u.install).not.toHaveBeenCalled();
    await arm();
    await click(button("Restart now", dialog()!));
    expect(u.install).toHaveBeenCalledTimes(1);
  });

  // Final verification on a Mac: the ready card (a full-width 44 px button
  // under a two-line note) was ~130 px tall and cut Settings off at 800 px.
  it("ready: a compact card, Restart now its own armed element and not full width", async () => {
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    const c = card()!;
    const btns = [...c.querySelectorAll("button")];
    // Only Restart now: ready has no head button to re-label.
    expect(btns.map((b) => b.textContent?.trim())).toEqual(["Restart now"]);
    const restartBtn = btns[0];
    expect(restartBtn.hasAttribute("data-compact")).toBe(true);
    expect(restartBtn.style.width).not.toBe("100%");
    for (const b of btns) expect(b.style.width).not.toBe("100%");
    // Title and button share the first row.
    const row = c.querySelector("[data-update-row]");
    expect(row?.contains(restartBtn)).toBe(true);
    expect(row?.textContent).toContain("Riwaq 0.6.0 is ready");
    // Still armed.
    expect(restartBtn.getAttribute("aria-disabled")).toBe("true");
    await click(restartBtn);
    expect(u.install).not.toHaveBeenCalled();
    await arm();
    await click(button("Restart now", card()!));
    expect(u.install).toHaveBeenCalledTimes(1);
  });

  it("failed: compact too; Try again is not full width and the title still opens the dialog", async () => {
    h.check.mockResolvedValue(fakeUpdate({ downloadFails: true }));
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    const c = card()!;
    const tryAgain = button("Try again", c)!;
    expect(tryAgain.style.width).not.toBe("100%");
    expect(c.querySelector("[data-update-row]")?.contains(tryAgain)).toBe(true);
    await click(c.querySelector("button[data-update-head]") ?? undefined);
    expect(store.getState().dialog).toBe("failed");
  });

  // The button's own arming, apart from the store's guard: long after ready
  // (store armed), a Restart now that has only just appeared (the sidebar
  // remounted, e.g. back from Settings) still ignores a click at once.
  it("a freshly shown Restart now arms on its own, even when the store already allows a restart", async () => {
    const u = fakeUpdate();
    h.check.mockResolvedValue(u);
    await mount();
    await offer();
    await act(async () => {
      await store.update();
    });
    await arm();
    await arm();
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
    await mount();
    await click(button("Restart now", card()!));
    expect(u.install).not.toHaveBeenCalled();
    await arm();
    await click(button("Restart now", card()!));
    expect(u.install).toHaveBeenCalledTimes(1);
  });
});
