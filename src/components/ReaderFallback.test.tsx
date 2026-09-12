// What App renders when the route says "reader" but there is no book to show.
//
// That branch used to be a bare `null`. While the load is in flight that is
// correct — the app-level spinner covers it — but when the load FAILS the
// spinner comes down and the branch keeps rendering nothing, so the app sits
// on a reader route with no book, no chrome and no way out. On desktop there
// isn't even a hardware back button to escape with.
//
// The regression these tests guard is simply: never render an empty screen
// once loading has stopped.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makeTr } from "../i18n";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES } from "../styles/tokens";
import { ReaderFallback } from "./ReaderFallback";

function render(props: { loading: boolean; error?: string | null }) {
  return renderToStaticMarkup(
    <I18nProvider locale="en">
      <ReaderFallback
        theme={THEMES.sepia}
        tr={makeTr("en")}
        loading={props.loading}
        error={props.error ?? null}
        onBack={() => {}}
      />
    </I18nProvider>,
  );
}

describe("ReaderFallback", () => {
  it("renders nothing while the book is still loading", () => {
    // The full-page spinner is already covering the screen; drawing a second
    // message behind it would flash on every open.
    expect(render({ loading: true })).toBe("");
  });

  it("renders nothing when a load has not been attempted yet", () => {
    // The restore path (browser-forward into a book, dev reload) flips the
    // route to "reader" and only THEN runs the effect that loads it, so there
    // is a frame with no book, no error and loading still false. Drawing the
    // failure message there would flash it on every such open.
    expect(render({ loading: false, error: null })).toBe("");
  });

  it("never leaves an empty screen once a load has failed", () => {
    expect(render({ loading: false, error: "boom" }).trim()).not.toBe("");
  });

  it("offers a way back to the library", () => {
    expect(render({ loading: false, error: "boom" })).toContain(
      "Back to library",
    );
  });

  it("shows why the book could not be opened when there is a reason", () => {
    expect(render({ loading: false, error: "zip entry missing" })).toContain(
      "zip entry missing",
    );
  });
});
