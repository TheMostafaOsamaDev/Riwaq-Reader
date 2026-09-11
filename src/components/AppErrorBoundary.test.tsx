// @vitest-environment happy-dom
//
// Regression cover for the blank-screen-on-open bug.
//
// `ReaderErrorBoundary` catches a throw inside the two reader views, but
// nothing caught anything else: main.tsx rendered `<App/>` bare. A render
// error anywhere outside the reader — the import dialog, ImportProgress, the
// Library, App itself — therefore unmounted the WHOLE tree, and what was left
// on screen was the boot background and nothing else. Not even the app-level
// spinner or the error toast survive that, which is what makes it so hard to
// read from a screenshot: an unmounted tree and a book that rendered blank are
// pixel-identical and have completely different causes.
//
// Reported on Android 2026-09-11: opening a supported file from the file
// manager landed on an empty themed screen with no chrome at all. Every
// emulator path we could reproduce (EPUB 2KB and 197MB, PDF, MediaStore and
// DocumentsProvider URIs, fresh install, cold start) rendered correctly, so
// the specific throw is still unknown — which is exactly the argument for a
// boundary that NAMES it rather than swallowing it into a blank page.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  // React logs caught errors; keep the run's output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

function Boom({ message }: { message: string }): React.ReactNode {
  throw new Error(message);
}

function mount(node: React.ReactNode) {
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return root;
}

describe("AppErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    mount(
      <AppErrorBoundary>
        <p>the app</p>
      </AppErrorBoundary>,
    );

    expect(host.textContent).toContain("the app");
  });

  it("keeps something on screen when a child throws", () => {
    mount(
      <AppErrorBoundary>
        <Boom message="kaboom" />
      </AppErrorBoundary>,
    );

    // The bug is an EMPTY screen, so the assertion that matters is simply
    // that the page is not blank.
    expect(host.textContent?.trim()).not.toBe("");
  });

  it("names the error instead of swallowing it", () => {
    mount(
      <AppErrorBoundary>
        <Boom message="cannot read properties of undefined" />
      </AppErrorBoundary>,
    );

    // Without the message on screen the user can only report "it went blank",
    // which is what made this bug un-diagnosable in the first place.
    expect(host.textContent).toContain("cannot read properties of undefined");
  });

  it("offers a way out rather than a dead end", () => {
    mount(
      <AppErrorBoundary>
        <Boom message="kaboom" />
      </AppErrorBoundary>,
    );

    const labels = [...host.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(labels.length).toBeGreaterThan(0);
  });
});
