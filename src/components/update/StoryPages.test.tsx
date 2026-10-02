// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { ReleaseNotes } from "../../store/releaseNotes";
import { THEMES } from "../../styles/tokens";
import { StoryPages } from "./StoryPages";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOTES = {
  version: "0.6.0",
  date: "2026-10-15",
  stories: [
    { kind: "new", title: { en: "One", ar: "١" }, body: { en: "a", ar: "a" } },
    { kind: "new", title: { en: "Two", ar: "٢" }, body: { en: "b", ar: "b" } },
  ],
  items: [{ kind: "new", en: "x", ar: "x" }],
} as unknown as ReleaseNotes;

let root: Root | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function mount() {
  const onDone = vi.fn();
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root?.render(
      <I18nProvider locale="en">
        <StoryPages notes={NOTES} theme={THEMES.sepia} onDone={onDone} />
      </I18nProvider>,
    );
  });
  return onDone;
}
const button = (t: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === t,
  );
async function click(t: string) {
  await act(async () => button(t)?.click());
}
const wait = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

describe("StoryPages", () => {
  it("ignores Skip and Next within 1000 ms of mount (a click carried over a relaunch)", async () => {
    const onDone = await mount();
    await click("Skip");
    await click("Next");
    expect(onDone).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("One");
    await wait(1000);
    await click("Skip");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a double-click on Next does not land on Done", async () => {
    const onDone = await mount();
    await wait(1000);
    await click("Next");
    expect(document.body.textContent).toContain("Two");
    await click("Start reading");
    expect(onDone).not.toHaveBeenCalled();
    await wait(1000);
    await click("Start reading");
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
