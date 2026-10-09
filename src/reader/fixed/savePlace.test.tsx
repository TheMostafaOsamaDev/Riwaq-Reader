// @vitest-environment happy-dom
//
// The saved place is exactly where the reader is. It used to be saved only
// when the PAGE changed, so scrolling within a page never moved it, and a save
// still waiting when the reader closed was dropped — reopening landed at the
// top of the page, or on the page before.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FixedPageViewer } from "./FixedPageViewer";
import { fakeSource, fakeViewport, settle } from "./viewerTestHarness";
import { THEMES } from "../../styles/tokens";

const VIEWPORT = 900;
let host: HTMLDivElement;
let root: Root;
let restoreViewport: () => void;
const saved = vi.fn();

beforeEach(() => {
  restoreViewport = fakeViewport(VIEWPORT);
  saved.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <FixedPageViewer
        source={fakeSource()}
        flow="scroll"
        fit="width"
        zoom={1}
        tint="none"
        dir="ltr"
        turnAxis="y"
        theme={THEMES.light}
        themeKey="light"
        highlights={[]}
        onSelect={() => {}}
        onHighlightClick={() => {}}
        onLocationChange={saved}
        resume={{ page: 0 }}
      />,
    ),
  );
});

afterEach(() => {
  host.remove();
  restoreViewport();
});

function scrollTo(y: number) {
  const el = host.querySelector<HTMLElement>(".no-scrollbar")!;
  el.scrollTop = y;
  el.dispatchEvent(new Event("scroll"));
}

/** Page `i`'s top and height, read from what the viewer rendered (scrolling
 *  near it first so it is mounted). */
async function pageBox(i: number): Promise<{ top: number; h: number }> {
  scrollTo(i * 1000);
  await settle();
  const el = host.querySelector<HTMLElement>(`[data-fixed-host="${i}"]`);
  if (!el)
    throw new Error(
      `page ${i} not mounted at scrollTop ${host.querySelector<HTMLElement>(".no-scrollbar")!.scrollTop}; have ${[
        ...host.querySelectorAll("[data-fixed-host]"),
      ]
        .map((h) => h.getAttribute("data-fixed-host"))
        .join(",")}`,
    );
  return {
    top: Number.parseFloat(el.style.top),
    h: Number.parseFloat(el.style.height),
  };
}

it("saves a move WITHIN a page, at the fraction the reader is at", async () => {
  await settle();
  const p3 = await pageBox(3);
  scrollTo(p3.top + 0.25 * p3.h);
  await settle();
  // Let that save land, so the next move is a fresh one within the same page.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 500));
  });
  expect(saved.mock.calls[saved.mock.calls.length - 1][1]).toBeCloseTo(0.25, 2);
  scrollTo(p3.top + 0.75 * p3.h);
  await settle();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 500));
  });
  const [page, offset] = saved.mock.calls[saved.mock.calls.length - 1];
  expect(page).toBe(3);
  expect(offset).toBeCloseTo(0.75, 2);
  act(() => root.unmount());
});

it("writes a waiting save when the reader closes", async () => {
  await settle();
  const p5 = await pageBox(5);
  scrollTo(p5.top + 0.5 * p5.h);
  await settle(); // fewer than the 400ms the save waits
  saved.mockClear();
  act(() => root.unmount());
  expect(saved).toHaveBeenCalledTimes(1);
  expect(saved.mock.calls[0][0]).toBe(5);
  expect(saved.mock.calls[0][1]).toBeCloseTo(0.5, 2);
});
