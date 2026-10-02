// @vitest-environment happy-dom
// The phone update UI, rendered over the REAL store (androidUpdate.ts) with a
// fake native side behind `invoke`. Every state is reached the way the app
// reaches it — offer(), a status read, an action — never by poking the store.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => unknown>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) =>
    Promise.resolve().then(() => h.invoke(cmd, args)),
}));

import { I18nProvider } from "../../i18n/I18nProvider";
import type { Locale } from "../../i18n";
import * as store from "../../store/androidUpdate";
import { THEMES } from "../../styles/tokens";
import { MobileBottomNav } from "../library/MobileBottomNav";
import { SettingsUpdateCard } from "./SettingsUpdateCard";
import { UpdatePill } from "./UpdatePill";
import { UpdateSheet, UpdateToasts } from "./UpdateSheet";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface Fake {
  installer: string;
  label: string;
  storeInstalled: boolean;
  status: Record<string, unknown>;
  metered: boolean;
}

const NOTES = {
  version: "0.6.0",
  date: "2026-10-15",
  highlight: {
    title: { en: "Make the library yours", ar: "اجعل المكتبة على ذوقك" },
    body: { en: "Four card styles", ar: "أربعة أنماط للبطاقة" },
  },
  items: [{ kind: "new", en: "In-app updates", ar: "تحديثات داخل التطبيق" }],
};

function fake(over: Partial<Fake> = {}): Fake {
  const f: Fake = {
    installer: "",
    label: "",
    storeInstalled: false,
    status: { state: "idle" },
    metered: false,
    ...over,
  };
  h.invoke.mockImplementation((cmd) => {
    switch (cmd) {
      case "install_source":
        return JSON.stringify({
          installer: f.installer,
          label: f.label,
          storeInstalled: f.storeInstalled,
        });
      case "android_update_status":
        return JSON.stringify({ bytes: 0, total: 0, error: null, ...f.status });
      case "fetch_release_notes":
        return { notes: NOTES };
      case "fetch_apk_details":
        return {
          url: "https://x/a.apk",
          sha256: "ab".repeat(32),
          size: 19230841,
        };
      case "android_network_metered":
        return f.metered;
      default:
        return null;
    }
  });
  return f;
}

let root: Root | null = null;

async function setup(f: Partial<Fake> = {}) {
  fake(f);
  store.configure({
    running: "0.5.3",
    skipped: undefined,
    pref: "ask",
    saveSkipped: () => {},
  });
  await act(async () => {
    await store.offer({ version: "0.6.0" });
  });
}

async function render(node: React.ReactNode, locale: Locale = "en") {
  const el = document.createElement("div");
  el.dir = locale === "ar" ? "rtl" : "ltr";
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(<I18nProvider locale={locale}>{node}</I18nProvider>);
  });
}

const sheet = (locale: Locale = "en") =>
  render(<UpdateSheet theme={THEMES.sepia} />, locale);
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label),
  );

beforeEach(() => {
  store.__resetForTests();
  h.invoke.mockReset();
  document.body.innerHTML = "";
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

describe("UpdateSheet", () => {
  it("notes: highlight, the size to one decimal, and Skip this version", async () => {
    await setup();
    await sheet();
    await act(async () => store.openSheet("notes"));
    expect(text()).toContain("Make the library yours");
    expect(text()).toContain("In-app updates");
    expect(button("Update · 18.3 MB")).toBeTruthy();
    expect(button("Skip this version")).toBeTruthy();
    expect(button("Later")).toBeTruthy();
  });

  it("notes in Arabic: the Arabic copy and Arabic size label", async () => {
    await setup();
    await sheet("ar");
    await act(async () => store.openSheet("notes"));
    expect(text()).toContain("اجعل المكتبة على ذوقك");
    expect(button("تحديث · 18.3 م.ب")).toBeTruthy();
    expect(button("تخطَّ هذا الإصدار")).toBeTruthy();
  });

  it("store-assisted: the primary reads Update in Orion Store and opens it", async () => {
    await setup({
      installer: "com.orion.store",
      label: "Orion Store",
      storeInstalled: true,
    });
    await sheet();
    await act(async () => store.openSheet("notes"));
    const b = button("Update in Orion Store");
    expect(b).toBeTruthy();
    await act(async () => b?.click());
    expect(h.invoke).toHaveBeenCalledWith("open_store", {
      pkg: "com.orion.store",
    });
  });

  it("mobile: the warning with the size, and both choices", async () => {
    await setup({ metered: true });
    await sheet();
    await act(async () => store.openSheet("notes"));
    await act(async () => button("Update · 18.3 MB")?.click());
    expect(store.getState().sheet).toBe("mobile");
    expect(text()).toContain("You're on mobile data. This update is 18.3 MB.");
    expect(button("Wait for Wi-Fi")).toBeTruthy();
    const anyway = button("Update anyway");
    expect(anyway).toBeTruthy();
    await act(async () => anyway?.click());
    expect(h.invoke).toHaveBeenCalledWith(
      "android_update_start",
      expect.objectContaining({ version: "0.6.0", waitForUnmetered: false }),
    );
  });

  it("mobile: Wait for Wi-Fi starts a download that waits for unmetered", async () => {
    await setup({ metered: true });
    await sheet();
    await act(async () => store.openSheet("mobile"));
    await act(async () => button("Wait for Wi-Fi")?.click());
    expect(h.invoke).toHaveBeenCalledWith(
      "android_update_start",
      expect.objectContaining({ waitForUnmetered: true }),
    );
  });

  it("failed offline: dropped at 62% and Resume download", async () => {
    await setup({
      status: {
        state: "failed",
        version: "0.6.0",
        bytes: 62,
        total: 100,
        error: "offline",
      },
    });
    await sheet();
    await act(async () => store.openSheet("failed"));
    expect(text()).toContain("Your connection dropped at 62%");
    expect(button("Resume download")).toBeTruthy();
  });

  it("failed offline in Arabic", async () => {
    await setup({
      status: {
        state: "failed",
        version: "0.6.0",
        bytes: 62,
        total: 100,
        error: "offline",
      },
    });
    await sheet("ar");
    await act(async () => store.openSheet("failed"));
    expect(text()).toContain("انقطع الاتصال عند 62٪");
  });

  it("failed: each native code has its own sentence", async () => {
    const cases: [string, string][] = [
      ["checksum", "didn't match what was published"],
      ["signature", "isn't a Riwaq update for this install"],
      ["storage", "needs 18.3 MB free"],
      ["install", "Android couldn't install the update."],
    ];
    for (const [error, expected] of cases) {
      store.__resetForTests();
      document.body.innerHTML = "";
      await setup({
        status: { state: "failed", version: "0.6.0", error },
      });
      await sheet();
      await act(async () => store.openSheet("failed"));
      expect(text()).toContain(expected);
      expect(button("Try again")).toBeTruthy();
      await act(async () => root?.unmount());
      root = null;
    }
  });

  it("installing: the ready sheet still offers a tappable Install now", async () => {
    await setup({ status: { state: "installing", version: "0.6.0" } });
    await sheet();
    await act(async () => store.openSheet("ready"));
    const b = button("Install now");
    expect(b).toBeTruthy();
    expect(b?.disabled).toBe(false);
  });

  it("progress: bar, MB, Cancel and Hide", async () => {
    await setup({
      status: {
        state: "downloading",
        version: "0.6.0",
        bytes: 5_242_880,
        total: 19_230_841,
      },
    });
    await sheet();
    await act(async () => store.openSheet("progress"));
    expect(text()).toContain("Downloading 0.6.0…");
    expect(text()).toContain("5.0 of 18.3 MB");
    expect(document.querySelector('[role="progressbar"]')).toBeTruthy();
    expect(button("Cancel")).toBeTruthy();
    expect(button("Hide")).toBeTruthy();
  });
});

describe("UpdatePill", () => {
  it("available: a polite button that opens the notes", async () => {
    await setup();
    await render(<UpdatePill theme={THEMES.sepia} />);
    const pill = button("Update available · 0.6.0");
    expect(pill).toBeTruthy();
    expect(pill?.querySelector('[aria-live="polite"]')).toBeTruthy();
    await act(async () => pill?.click());
    expect(store.getState().sheet).toBe("notes");
  });

  it("is absent for a store-managed install", async () => {
    await setup({
      installer: "org.fdroid.fdroid",
      label: "F-Droid",
      storeInstalled: true,
    });
    await render(<UpdatePill theme={THEMES.sepia} />);
    expect(document.querySelector("button")).toBeNull();
  });
});

describe("UpdateToasts", () => {
  it("Later shows the Settings toast; Skip offers Undo", async () => {
    await setup();
    await render(<UpdateToasts theme={THEMES.sepia} />);
    await act(async () => store.later());
    expect(text()).toContain("It'll wait for you in Settings → About.");
    expect(button("Show")).toBeTruthy();
    await act(async () => {
      await store.skip("0.6.0");
    });
    expect(text()).toContain("Riwaq won't remind you about 0.6.0.");
    await act(async () => button("Undo")?.click());
    expect(store.getState().skipped).toBeUndefined();
  });
});

describe("MobileBottomNav settings dot", () => {
  const nav = () =>
    render(
      <MobileBottomNav
        theme={THEMES.sepia}
        importing={false}
        tab="all"
        shelvesActive={false}
        onOpenShelves={() => {}}
        onSetStore={() => {}}
        onOpenQueue={() => {}}
        onImport={() => {}}
        onOpenSettings={() => {}}
      />,
    );

  it("marks Settings while an update waits", async () => {
    await setup();
    await nav();
    expect(
      document.querySelector('[aria-label="Settings, update available"]'),
    ).toBeTruthy();
    expect(document.querySelector("[data-update-dot]")).toBeTruthy();
  });

  it("no dot without an offer", async () => {
    await nav();
    expect(document.querySelector('[aria-label="Settings"]')).toBeTruthy();
    expect(document.querySelector("[data-update-dot]")).toBeNull();
  });
});

describe("SettingsUpdateCard", () => {
  const card = (onOpenUrl = vi.fn()) =>
    render(<SettingsUpdateCard theme={THEMES.sepia} onOpenUrl={onOpenUrl} />);

  it("pending offer: version, date, size, summary, See what's new, Update", async () => {
    await setup();
    await card();
    expect(text()).toContain("Riwaq 0.6.0 is available");
    expect(text()).toContain("2026-10-15 · 18.3 MB");
    expect(text()).toContain("Make the library yours");
    await act(async () => button("See what's new")?.click());
    expect(store.getState().sheet).toBe("notes");
    expect(button("Update · 18.3 MB")).toBeTruthy();
  });

  it("hidden once the version is skipped", async () => {
    await setup();
    await act(async () => {
      await store.skip("0.6.0");
    });
    await card();
    expect(text()).not.toContain("Riwaq 0.6.0 is available");
  });

  it("managed with the store installed: who updates it, and Open store", async () => {
    await setup({
      installer: "org.fdroid.fdroid",
      label: "F-Droid",
      storeInstalled: true,
    });
    await card();
    expect(text()).toContain("Updates for this install come from F-Droid.");
    await act(async () => button("Open F-Droid")?.click());
    expect(h.invoke).toHaveBeenCalledWith("open_store", {
      pkg: "org.fdroid.fdroid",
    });
  });

  it("managed, store gone, no label: your app store, and GitHub", async () => {
    await setup({
      installer: "com.example.x",
      label: "",
      storeInstalled: false,
    });
    const onOpenUrl = vi.fn();
    await card(onOpenUrl);
    expect(text()).toContain(
      "Updates for this install come from your app store.",
    );
    await act(async () => button("Download from GitHub")?.click());
    expect(onOpenUrl).toHaveBeenCalled();
  });
});
