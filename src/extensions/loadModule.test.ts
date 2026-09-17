import { describe, expect, it } from "vitest";
import { loadModuleFromSource } from "./loadModule";

// These three cases are the real contract for loadModuleFromSource, and they
// are written against the exact mechanism it uses in production (blob URL +
// dynamic import()). They do not run here.
//
// Node's own ESM loader rejects the `blob:` scheme unconditionally:
//   "Only URLs with a scheme in: file, data, and node are supported by the
//   default ESM loader. Received protocol 'blob:'" (Node v22.23.2,
//   ERR_UNSUPPORTED_ESM_URL_SCHEME) — confirmed both under plain `node
//   --experimental-vm-modules` and under `pnpm vitest run` in the "node" and
//   "happy-dom" test environments. happy-dom only shims `window`/`document`;
//   it does not replace Node's module loader, so the failure is identical in
//   both. There is no supported way around it: Node's module-customization
//   hooks (`module.register`) run the `load` hook off the main thread, and
//   `buffer.resolveObjectURL` — the only way to read a blob registered by
//   `URL.createObjectURL` — has no visibility into that thread's registry
//   (confirmed by trying it), so even a custom loader can't bridge this.
//
// Real browser engines (WKWebView, Android WebView) do support importing a
// blob: URL — that's the whole premise of loadModule.ts — but Vitest runs on
// Node, not on either of those engines, so this suite structurally cannot be
// the proof. The proof is the two device runs recorded in
// task-1-report.md (a temporary probe in main.tsx, run under `pnpm tauri dev`
// and `pnpm android:dev`), exactly per this task's brief, note 1: "a green
// unit test proves nothing about WKWebView or the Android WebView."
//
// Kept here (skipped, not deleted) as the literal spec for the contract, and
// because a tamper-check against a stubbed loadModuleFromSource (swapping
// the real `import(url)` for a hardcoded return) does distinguish real from
// fake for tests 2 and 3 when run un-skipped — see task-1-report.md.
describe("loadModuleFromSource", () => {
  it.skip("evaluates ESM source and exposes its default export", async () => {
    const mod = (await loadModuleFromSource(
      `export default (host) => ({ id: "probe", greeting: host.hello });`,
    )) as {
      default: (h: { hello: string }) => { id: string; greeting: string };
    };

    const instance = mod.default({ hello: "hi" });
    expect(instance.id).toBe("probe");
    expect(instance.greeting).toBe("hi");
  });

  it.skip("rejects when the source throws at evaluation time", async () => {
    await expect(
      loadModuleFromSource(`throw new Error("boom at load");`),
    ).rejects.toThrow(/boom at load/);
  });

  it.skip("gives each call its own module instance", async () => {
    const src = `let n = 0; export default () => ++n;`;
    const a = (await loadModuleFromSource(src)) as { default: () => number };
    const b = (await loadModuleFromSource(src)) as { default: () => number };
    expect(a.default()).toBe(1);
    expect(b.default()).toBe(1); // not 2 — separate module registries
  });
});
