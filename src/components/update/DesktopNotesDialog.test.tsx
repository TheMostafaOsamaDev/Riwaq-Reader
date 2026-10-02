// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEMES } from "../../styles/tokens";
import { DesktopNotesDialog } from "./DesktopNotesDialog";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  document.body.innerHTML = "";
});

async function mount(
  over: Partial<Parameters<typeof DesktopNotesDialog>[0]> = {},
) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const invokeImpl = vi.fn(async () => ({
    notes: {
      version: "0.6.0",
      date: "d",
      items: [{ kind: "new", en: "In-app updates", ar: "ب" }],
    },
    highlightImage: null,
  }));
  const onAction = vi.fn();
  const onClose = vi.fn();
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <DesktopNotesDialog
          open
          version="0.6.0"
          theme={THEMES.sepia}
          actionLabel="Update"
          actionBusy={false}
          onAction={onAction}
          onClose={onClose}
          invokeImpl={invokeImpl}
          {...over}
        />
      </I18nProvider>,
    );
  });
  return { invokeImpl, onAction, onClose };
}

describe("DesktopNotesDialog", () => {
  it("fetches the next version's notes and renders them", async () => {
    const { invokeImpl } = await mount();
    expect(invokeImpl).toHaveBeenCalledWith("fetch_release_notes", {
      version: "0.6.0",
    });
    expect(document.body.textContent).toContain("In-app updates");
  });
  it("Escape closes; the primary button runs the banner action", async () => {
    const { onClose, onAction } = await mount();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Update"),
    );
    await act(async () => btn?.click());
    expect(onAction).toHaveBeenCalled();
  });
});
