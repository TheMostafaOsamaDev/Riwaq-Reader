import { describe, expect, it } from "vitest";
import { openIntentFor } from "./importOpenTarget";

/** Minimal stand-ins: the rule only ever reads lengths and the entry id. */
const book = (id: string) => ({ id });
const draft = () => ({});
const failure = (file: string) => ({ file, message: "Unsupported file" });

describe("openIntentFor", () => {
  it("opens a single EPUB handed in from outside", () => {
    expect(
      openIntentFor(
        { autoImported: [book("a")], drafts: [], errors: [] },
        true,
      ),
    ).toEqual({ kind: "now", target: book("a") });
  });

  it("opens a book the library already had, rather than re-importing it", () => {
    // Hash dedupe reports the file under `reused`, so there is nothing in
    // autoImported to land on — the existing entry is the target.
    expect(
      openIntentFor(
        { autoImported: [], drafts: [], errors: [], reused: [book("owned")] },
        true,
      ),
    ).toEqual({ kind: "now", target: book("owned") });
  });

  it("waits for the dialog when the one file is a PDF or DOCX", () => {
    // A fixed-layout book has no entry until the title/cover dialog commits,
    // so the reader opens on confirm rather than now.
    expect(
      openIntentFor({ autoImported: [], drafts: [draft()], errors: [] }, true),
    ).toEqual({ kind: "afterDraft" });
  });

  it("stays in the library when a sibling file failed to parse", () => {
    // THE BUG (S3): `open -a Riwaq good.epub broken.epub`. Counting only
    // successes made this look like a single-book pick, so it opened the
    // reader and returned early — and summarizeImport, the only place import
    // errors are ever reported, was never reached. The failure was silent.
    expect(
      openIntentFor(
        {
          autoImported: [book("good")],
          drafts: [],
          errors: [failure("broken.epub")],
        },
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("stays in the library when a sibling failed next to a PDF or DOCX", () => {
    // Same bug on the deferred path: advanceQueue's open-on-confirm return
    // skips summarizeImport just as the immediate one does, so
    // `open -a Riwaq broken.epub good.pdf` swallowed the error too.
    expect(
      openIntentFor(
        { autoImported: [], drafts: [draft()], errors: [failure("broken.epub")] },
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("stays in the library when an already-owned book came with a failure", () => {
    expect(
      openIntentFor(
        {
          autoImported: [],
          drafts: [],
          errors: [failure("broken.epub")],
          reused: [book("owned")],
        },
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("never opens anything for an in-app pick", () => {
    // The import button's own picks always report through the summary, however
    // few files they turn out to contain.
    expect(
      openIntentFor(
        { autoImported: [book("a")], drafts: [], errors: [] },
        false,
      ),
    ).toEqual({ kind: "none" });
  });

  it("stays in the library for a multi-file open", () => {
    // Two books is no defensible choice of which to land on.
    expect(
      openIntentFor(
        { autoImported: [book("a"), book("b")], drafts: [], errors: [] },
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("stays in the library when one book imported alongside a draft", () => {
    expect(
      openIntentFor(
        { autoImported: [book("a")], drafts: [draft()], errors: [] },
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("stays in the library when two drafts need the dialog", () => {
    expect(
      openIntentFor(
        { autoImported: [], drafts: [draft(), draft()], errors: [] },
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("has nothing to open when every file failed", () => {
    // summarizeImport surfaces the first error in the banner from here.
    expect(
      openIntentFor(
        { autoImported: [], drafts: [], errors: [failure("broken.epub")] },
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("still opens the book when the run repaired a dead entry to get it", () => {
    // A hash match whose files were gone is pruned and re-imported (S2). The
    // repair succeeded, so this is still exactly one book handed in from
    // outside — `pruned` is bookkeeping about what the run cleaned up, not a
    // failure, and must never keep the reader closed.
    expect(
      openIntentFor(
        {
          autoImported: [book("repaired")],
          drafts: [],
          errors: [],
          pruned: ["dead-entry"],
        },
        true,
      ),
    ).toEqual({ kind: "now", target: book("repaired") });
  });

  it("has nothing to open when the pick was empty", () => {
    expect(
      openIntentFor({ autoImported: [], drafts: [], errors: [] }, true),
    ).toEqual({ kind: "none" });
  });
});
