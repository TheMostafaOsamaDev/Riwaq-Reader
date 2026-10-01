// @vitest-environment happy-dom
//
// The nav store is module state initialised at import, so every case loads a
// fresh copy over a history entry it has never stamped (state null), which
// is what a cold launch looks like to init().
import { beforeEach, describe, expect, it, vi } from "vitest";

type Nav = typeof import("./navigation");
let nav: Nav;

async function freshNav(): Promise<Nav> {
  vi.resetModules();
  return import("./navigation");
}

beforeEach(async () => {
  window.history.replaceState(null, "");
  nav = await freshNav();
});

const view = () => {
  const b = nav.getState().snapshot.base;
  return b.screen === "library" ? b.view : b;
};
const navIndex = () => (window.history.state as { navIndex: number }).navIndex;

describe("navigate", () => {
  it("pushes a new destination and back() returns to the previous one", () => {
    nav.goLibrary({ kind: "store" });
    expect(view()).toEqual({ kind: "store" });
    expect(navIndex()).toBe(1);
    nav.back();
    expect(view()).toEqual({ kind: "shelf" });
    expect(navIndex()).toBe(0);
  });

  it("collapses A→B→A into a back step, keeping B on Forward", () => {
    nav.goLibrary({ kind: "store" });
    nav.goLibrary({ kind: "shelf" });
    expect(view()).toEqual({ kind: "shelf" });
    expect(navIndex()).toBe(0);
    nav.forward();
    expect(view()).toEqual({ kind: "store" });
    expect(navIndex()).toBe(1);
  });

  it("only collapses onto the entry directly behind", () => {
    nav.goLibrary({ kind: "store" }); // 1
    nav.goLibrary({ kind: "shelves" }); // 2
    nav.goShelf("s1"); // 3
    nav.goLibrary({ kind: "store" }); // behind is shelfDetail → push
    expect(view()).toEqual({ kind: "store" });
    expect(navIndex()).toBe(4);
  });

  it("a push after a collapse truncates forward history as usual", () => {
    nav.goLibrary({ kind: "store" });
    nav.goLibrary({ kind: "shelf" }); // collapse → index 0, store ahead
    nav.goLibrary({ kind: "shelves" }); // push → index 1, store gone
    expect(navIndex()).toBe(1);
    nav.forward();
    expect(view()).toEqual({ kind: "shelves" });
  });

  it("after a reload knows nothing behind, so it pushes instead of collapsing", async () => {
    nav.goLibrary({ kind: "store" }); // index 1; shelf behind
    nav = await freshNav(); // reload: restores index 1 from history.state
    expect(view()).toEqual({ kind: "store" });
    nav.goLibrary({ kind: "shelf" });
    expect(navIndex()).toBe(2);
  });
});

describe("back()", () => {
  it("is a no-op at the root", () => {
    nav.back();
    expect(view()).toEqual({ kind: "shelf" });
    expect(navIndex()).toBe(0);
  });

  it("falls back to the root when the first entry is not the root", () => {
    nav.goReader("b1", { replace: true });
    expect(view()).toEqual({ screen: "reader", bookId: "b1" });
    nav.back();
    expect(view()).toEqual({ kind: "shelf" });
    expect(navIndex()).toBe(0);
  });
});

describe("Store pages", () => {
  it("walk back through novel → source → sources", () => {
    nav.goStorePage();
    nav.goStorePage({ kind: "source", sourceId: "src" });
    nav.goStorePage({ kind: "novel", sourceId: "src", novelUrl: "/n" });
    nav.back();
    expect(view()).toEqual({
      kind: "store",
      page: { kind: "source", sourceId: "src" },
    });
    nav.back();
    expect(view()).toEqual({ kind: "store" });
  });
});
