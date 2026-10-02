// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:whats-new", () => ({
  default: {
    version: "0.6.0",
    date: "2026-10-15",
    items: [{ kind: "fixed", en: "A small fix", ar: "إصلاح صغير" }],
  },
  appVersion: "0.6.0",
  images: {},
}));

import { I18nProvider } from "../../i18n/I18nProvider";
import { THEMES } from "../../styles/tokens";
import { WhatsNewAfterUpdate } from "./WhatsNewAfterUpdate";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(layout: "mobile" | "desktop", onClose = vi.fn()) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <I18nProvider locale="en">
        <WhatsNewAfterUpdate
          theme={THEMES.dark}
          open
          onClose={onClose}
          layout={layout}
        />
      </I18nProvider>,
    );
  });
  return onClose;
}

describe("WhatsNewAfterUpdate", () => {
  it("at desktop width: a centred dialog, not the phone sheet", async () => {
    const onClose = await mount("desktop");
    const d = document.querySelector('[aria-labelledby="whats-new-title"]');
    expect(d?.getAttribute("role")).toBe("dialog");
    expect(d?.textContent).toContain("A small fix");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
  });
  it("on a phone: still the sheet", async () => {
    await mount("mobile");
    expect(
      document.querySelector('[aria-labelledby="whats-new-title"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain("A small fix");
  });
});
