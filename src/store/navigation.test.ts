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

// Back-button layers: a bottom sheet pushes a history entry that carries the
// screen it sits on, so the system Back closes the sheet instead of leaving
// the screen. See pushLayer in navigation.ts.
describe("layers", () => {
  const seq = () => nav.getState().seq;
  const reader = { screen: "reader", bookId: "b1" };

  it("pushLayer adds a history entry without navigating", () => {
    nav.goReader("b1");
    const s = seq();
    nav.pushLayer(() => {});
    expect(navIndex()).toBe(2);
    expect(seq()).toBe(s);
    expect(view()).toEqual(reader);
  });

  it("Back closes the layer and stays on the screen", () => {
    nav.goReader("b1");
    const onBack = vi.fn();
    nav.pushLayer(onBack);
    const s = seq();
    window.history.back();
    expect(onBack).toHaveBeenCalledOnce();
    expect(navIndex()).toBe(1);
    expect(seq()).toBe(s);
    expect(view()).toEqual(reader);
  });

  it("two Back presses: first closes the layer, second navigates", () => {
    nav.goReader("b1");
    const onBack = vi.fn();
    nav.pushLayer(onBack);
    window.history.back();
    window.history.back();
    expect(onBack).toHaveBeenCalledOnce();
    expect(view()).toEqual({ kind: "shelf" });
  });

  it("back() with a layer open closes the layer", () => {
    nav.goReader("b1");
    const onBack = vi.fn();
    nav.pushLayer(onBack);
    nav.back();
    expect(onBack).toHaveBeenCalledOnce();
    expect(view()).toEqual(reader);
  });

  it("release pops its own entry silently and is idempotent", () => {
    nav.goReader("b1");
    const onBack = vi.fn();
    const release = nav.pushLayer(onBack);
    const s = seq();
    release();
    release();
    expect(onBack).not.toHaveBeenCalled();
    expect(navIndex()).toBe(1);
    expect(seq()).toBe(s);
    expect(view()).toEqual(reader);
  });

  it("release after Back is a no-op", () => {
    nav.goReader("b1");
    const release = nav.pushLayer(() => {});
    window.history.back();
    release();
    expect(navIndex()).toBe(1);
    expect(view()).toEqual(reader);
  });

  it("navigating with a layer open reuses its entry and closes the layer", () => {
    nav.goReader("b1");
    const onBack = vi.fn();
    const release = nav.pushLayer(onBack);
    nav.goSettings();
    // The sheet's entry now belongs to Settings: the sheet is told to close,
    // so it can never sit open without a Back step of its own.
    expect(onBack).toHaveBeenCalledOnce();
    release();
    expect(onBack).toHaveBeenCalledOnce();
    expect(navIndex()).toBe(2);
    expect(nav.getState().snapshot.base).toEqual({ screen: "settings" });
    expect(nav.getState().move).toBe("push");
    nav.back();
    expect(view()).toEqual(reader);
  });

  it("navigating to the entry behind a layer still navigates", () => {
    nav.goReader("b1");
    nav.pushLayer(() => {});
    nav.goLibrary({ kind: "shelf" });
    expect(view()).toEqual({ kind: "shelf" });
  });

  it("forward never re-enters a closed layer", () => {
    nav.goReader("b1");
    nav.pushLayer(() => {});
    window.history.back();
    nav.forward();
    expect(navIndex()).toBe(1);
    expect(view()).toEqual(reader);
  });

  it("Back with two layers closes only the top one", () => {
    nav.goReader("b1");
    const a = vi.fn();
    const b = vi.fn();
    nav.pushLayer(a);
    nav.pushLayer(b);
    window.history.back();
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
    expect(navIndex()).toBe(2);
  });

  it("releasing a lower layer, then the upper, lands on the screen in one step", () => {
    nav.goReader("b1");
    const relA = nav.pushLayer(() => {});
    const relB = nav.pushLayer(() => {});
    relA();
    relB();
    expect(navIndex()).toBe(1);
    expect(view()).toEqual(reader);
  });

  it("Back past a released lower layer needs one press", () => {
    nav.goReader("b1");
    const relA = nav.pushLayer(() => {});
    const b = vi.fn();
    nav.pushLayer(b);
    relA();
    window.history.back();
    expect(b).toHaveBeenCalledOnce();
    expect(navIndex()).toBe(1);
    expect(view()).toEqual(reader);
  });

  it("a new layer opened on a released one's entry reuses it", () => {
    nav.goReader("b1");
    const relA = nav.pushLayer(() => {});
    nav.pushLayer(() => {});
    // A closes while B is still above it: its entry stays behind, dead.
    relA();
    // Back closes B; the dead entry is skipped on the way down.
    window.history.back();
    expect(navIndex()).toBe(1);
    const c = vi.fn();
    nav.pushLayer(c);
    expect(navIndex()).toBe(2);
    window.history.back();
    expect(c).toHaveBeenCalledOnce();
    expect(navIndex()).toBe(1);
  });

  describe("with an asynchronous history.back", () => {
    // A real WebView fires popstate a task after history.back(). Stub back()
    // so the traversal waits, then replay it with go(-1), which happy-dom
    // performs (and fires popstate for) independently of back().
    it("navigate during a pending self-pop waits for it", () => {
      nav.goReader("b1");
      const release = nav.pushLayer(() => {});
      const back = vi
        .spyOn(window.history, "back")
        .mockImplementation(() => {});
      release();
      expect(back).toHaveBeenCalledOnce();
      nav.goStorePage();
      expect(view()).toEqual(reader);
      back.mockRestore();
      window.history.go(-1);
      expect(view()).toEqual({ kind: "store" });
      expect(navIndex()).toBe(2);
    });

    it("pushLayer during a pending self-pop waits for it", () => {
      nav.goReader("b1");
      const release = nav.pushLayer(() => {});
      const back = vi
        .spyOn(window.history, "back")
        .mockImplementation(() => {});
      release();
      const onBack = vi.fn();
      nav.pushLayer(onBack);
      back.mockRestore();
      window.history.go(-1);
      expect(navIndex()).toBe(2);
      expect(onBack).not.toHaveBeenCalled();
      window.history.back();
      expect(onBack).toHaveBeenCalledOnce();
      expect(navIndex()).toBe(1);
    });

    it("a layer released while still queued is never pushed", () => {
      nav.goReader("b1");
      const release = nav.pushLayer(() => {});
      const back = vi
        .spyOn(window.history, "back")
        .mockImplementation(() => {});
      release();
      const releaseQueued = nav.pushLayer(() => {});
      releaseQueued();
      back.mockRestore();
      window.history.go(-1);
      expect(navIndex()).toBe(1);
      expect(view()).toEqual(reader);
    });
  });
});
