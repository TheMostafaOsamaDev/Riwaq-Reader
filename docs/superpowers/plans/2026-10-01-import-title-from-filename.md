# Import Title From Filename — Implementation Plan (Phase 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the import dialog prefill a PDF/DOCX title from the file's name instead of the document's embedded metadata.

**Architecture:** The sanitization layer already exists (`filenameTitle()` in `src/store/importName.ts`). Only the precedence changes, at four sites in `src/store/fixedImportStage.ts`. The rule is extracted into one named function rather than inverted four times inline, because the naive inversion (`fallback || doc.meta.title`) still loses to a whitespace-only metadata title — a shape Word-produced PDFs emit routinely.

**Tech Stack:** TypeScript, React 19, Vite, Vitest + happy-dom. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-docx-import-modes-and-background-design.md` (Section 1, Decision 3)

## Global Constraints

- Worktree: `~/Desktop/my-work/Riwaq-import-modes`, branch `feat/import-modes`. The main checkout at `~/Desktop/my-work/Riwaq-reader` is live — never `checkout`/`switch`/`reset` there.
- Never `git add -A` in this repo. Stage named paths only.
- Commit messages carry no AI/Claude attribution and are written as the user.
- A missing title persists as `""`, never the literal `"Untitled"` — the display-time `common.untitled` fallback localizes it. This is an existing invariant of `importName.ts`; do not break it.
- `src/docx/toFixedDoc.ts` is not modified. A document's own title is a property of the document; only the dialog's prefill precedence changes.
- Run `pnpm test --run` from the worktree root. Baseline before this plan: 116 files, 1067 passed, 1 skipped.

## Review Focus

Input classes the spec implies but which no task would otherwise exercise. Each has its test assigned to the task that owns the code.

1. **Whitespace-only document metadata** (`doc.meta.title === "   "`). Word-produced PDFs emit this. A reasonable person expects the filename to win; a bare `||` would return the spaces. → Task 1.
2. **Filename that sanitizes to empty** (Android SAF row id `document%3A19`, or `19.pdf`). `filenameTitle()` returns `""`. Expected: fall through to the document's own title, not show a blank field. → Task 1.
3. **Both sources empty.** Expected: `""`, so the localized `common.untitled` fallback applies at display time — not `"Untitled"` frozen into the stored book. → Task 1.
4. **User clears the title field and confirms.** Expected: commit falls back through filename, then document title — not an empty stored title when a good filename exists. → Task 2.
5. **DOCX whose first heading differs from the filename.** This is the core behaviour change; expected: filename wins for the prefill, and the heading is still available as fallback. → Task 2.

---

### Task 1: The precedence rule as a tested pure function

**Files:**
- Modify: `src/store/importName.ts` (append; do not touch `filenameTitle`)
- Test: `src/store/filenameTitle.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: nothing.
- Produces: `preferredTitle(fromFile: string, fromDocument: string): string` — exported from `src/store/importName.ts`. Task 2 imports it by this exact name.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/filenameTitle.test.ts`. Note the import line at the top of that file must be widened to `import { filenameTitle, preferredTitle } from "./importName";`

```ts
describe("preferredTitle", () => {
  it("prefers the file's name over the document's own metadata", () => {
    expect(preferredTitle("Ahmed Metwally", "Microsoft Word - Document1")).toBe(
      "Ahmed Metwally",
    );
  });

  // Word writes a single space into dc:title often enough that `||` alone
  // (which treats " " as present) would hand the spaces to the dialog and
  // leave the user staring at an apparently empty field.
  it("treats a whitespace-only document title as absent", () => {
    expect(preferredTitle("", "   ")).toBe("");
    expect(preferredTitle("Ahmed Metwally", "   ")).toBe("Ahmed Metwally");
  });

  // filenameTitle() returns "" for a SAF row id or an all-digits stem, so
  // the document's own title is the only thing left worth showing.
  it("falls back to the document title when the filename yields nothing", () => {
    expect(preferredTitle("", "The Long War")).toBe("The Long War");
  });

  it("trims a filename that is only whitespace", () => {
    expect(preferredTitle("  ", "The Long War")).toBe("The Long War");
  });

  // "" and not "Untitled": a blank title persists as empty so the
  // display-time common.untitled fallback localizes it per-locale, rather
  // than freezing an English literal into the stored book.
  it("returns empty when neither source has anything", () => {
    expect(preferredTitle("", "")).toBe("");
    expect(preferredTitle("  ", "  ")).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run filenameTitle`
Expected: FAIL — `preferredTitle is not a function` / TypeScript reports no exported member `preferredTitle`.

- [ ] **Step 3: Write the implementation**

Append to `src/store/importName.ts`:

```ts
/**
 * Which of two candidate titles to show for an imported file.
 *
 * The file's name wins. A document's embedded title is far more often
 * wrong than the filename is: PDFs carry the LaTeX jobname, the Word
 * template name ("Microsoft Word - Document1"), or the title of whatever
 * document was copied to make this one. The filename is what the user
 * themselves saw in the picker, so it is what they expect in the field.
 *
 * Both sides are trimmed before being weighed, which is the part a bare
 * `fromFile || fromDocument` gets wrong: Word writes a lone space into
 * `dc:title` routinely, and `" " || x` is `" "` — the dialog would show an
 * apparently empty field and store a space as the book's title.
 *
 * Empty (not "Untitled") when neither has anything, so the display-time
 * `common.untitled` fallback localizes it wherever the book is rendered.
 */
export function preferredTitle(fromFile: string, fromDocument: string): string {
  return fromFile.trim() || fromDocument.trim();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run filenameTitle`
Expected: PASS, all cases green.

- [ ] **Step 5: Verify the tests can actually fail (tamper check)**

Temporarily change the implementation body to `return fromDocument.trim() || fromFile.trim();` and re-run. Expected: the first and second cases FAIL. Restore the correct body and re-run to confirm green. This repo has a recorded history of tests that passed while proving nothing — tamper, don't read.

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/my-work/Riwaq-import-modes
git add src/store/importName.ts src/store/filenameTitle.test.ts
git commit -m "feat(import): the file's name outranks the document's own title

A document's embedded title is wrong more often than the filename is —
it carries the LaTeX jobname, or 'Microsoft Word - Document1', or the
title of whatever file was copied to make this one. The filename is what
the user saw in the picker.

Trimmed on both sides, which is what a bare || gets wrong: Word writes a
lone space into dc:title routinely, and ' ' || x is ' '."
```

---

### Task 2: Wire the rule into the four title sites

**Files:**
- Modify: `src/store/fixedImportStage.ts` (lines 150, 168, 231, 241 — four sites, plus one hoist in `stageDocx`)
- Test: `src/store/fixedImportStage.test.ts` (create)

**Interfaces:**
- Consumes: `preferredTitle(fromFile, fromDocument)` from `./importName` (Task 1).
- Produces: no new exports. `stageFixedImport`'s signature is unchanged; only the value of `draft.title` and the committed title change.

- [ ] **Step 1: Write the failing test**

Create `src/store/fixedImportStage.test.ts`:

```ts
// The import dialog prefills from the FILE's name, not the document's own
// metadata. These mock the parsers away — the rule under test is precedence,
// and pdf.js / mammoth have nothing to say about it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { openPdfDocument, commitPdfBook, commitDocxBook, docxToFixedDoc } =
  vi.hoisted(() => ({
    openPdfDocument: vi.fn(),
    commitPdfBook: vi.fn(async (o: { title: string }) => ({ id: "pdf-1", ...o })),
    commitDocxBook: vi.fn(async (o: { title: string }) => ({ id: "docx-1", ...o })),
    docxToFixedDoc: vi.fn(),
  }));

vi.mock("../pdf/pdfjs", () => ({ openPdfDocument }));
vi.mock("./fixedImport", () => ({ commitPdfBook, commitDocxBook }));
vi.mock("./nativeStaging", () => ({ deleteStaged: vi.fn(async () => {}) }));
vi.mock("../docx/toFixedDoc", () => ({ docxToFixedDoc }));

import { stageFixedImport } from "./fixedImportStage";

/** A PdfDoc stub carrying only what staging reads. Cover thumbnails are
 *  lazy, so renderPage is never reached by these tests. */
function pdfDoc(meta: { title?: string; author?: string }) {
  return {
    pageCount: 3,
    meta: { title: meta.title ?? "", author: meta.author ?? "" },
    outline: [],
    hasTextLayer: true,
    renderPage: vi.fn(),
    destroy: vi.fn(),
  };
}

function fixedDoc(title: string) {
  return {
    html: "<p>body</p>",
    images: [] as { href: string; bytes: Uint8Array }[],
    title,
    author: "",
    dir: "ltr" as const,
    outline: [],
  };
}

const bytes = new Uint8Array([1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("stageFixedImport — title prefill", () => {
  it("prefills a PDF from the filename, not the embedded title", async () => {
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "Microsoft Word - Doc1" }));
    const draft = await stageFixedImport(
      { bytes },
      "/Users/me/Ahmed_Metwally_dalel.pdf",
      "pdf",
    );
    expect(draft.title).toBe("Ahmed Metwally dalel");
  });

  it("prefills a DOCX from the filename, not the first heading", async () => {
    docxToFixedDoc.mockResolvedValue(fixedDoc("Chapter One"));
    const draft = await stageFixedImport({ bytes }, "/Users/me/my-book.docx", "docx");
    expect(draft.title).toBe("my book");
  });

  // An Android SAF "Recent" pick is a bare provider row id with no name in
  // it, so filenameTitle() yields "" and the document is all we have.
  it("falls back to the embedded title when the path carries no name", async () => {
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "The Long War" }));
    const draft = await stageFixedImport(
      { bytes },
      "content://com.android.providers.media.documents/document/document%3A19",
      "pdf",
    );
    expect(draft.title).toBe("The Long War");
  });

  it("prefers the filename over a whitespace-only embedded title", async () => {
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "   " }));
    const draft = await stageFixedImport({ bytes }, "/Users/me/real-title.pdf", "pdf");
    expect(draft.title).toBe("real title");
  });

  it("uses the caller's resolved name over the path when given one", async () => {
    // On Android the name costs an IPC round trip, so stagePaths resolves it
    // once and passes it down; it must outrank re-parsing the path.
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "Embedded" }));
    const draft = await stageFixedImport(
      { bytes },
      "content://…/document%3A19",
      "pdf",
      undefined,
      "Resolved Name",
    );
    expect(draft.title).toBe("Resolved Name");
  });
});

describe("stageFixedImport — committed title", () => {
  it("commits a PDF under the filename when the field is cleared", async () => {
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "Embedded Title" }));
    const draft = await stageFixedImport({ bytes }, "/Users/me/on-disk.pdf", "pdf");
    await draft.commit({ title: "   ", cover: { kind: "none" } });
    expect(commitPdfBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: "on disk" }),
    );
  });

  it("commits a DOCX under the filename when the field is cleared", async () => {
    docxToFixedDoc.mockResolvedValue(fixedDoc("Chapter One"));
    const draft = await stageFixedImport({ bytes }, "/Users/me/on-disk.docx", "docx");
    await draft.commit({ title: "", cover: { kind: "none" } });
    expect(commitDocxBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: "on disk" }),
    );
  });

  it("commits what the user typed when they typed something", async () => {
    openPdfDocument.mockResolvedValue(pdfDoc({ title: "Embedded" }));
    const draft = await stageFixedImport({ bytes }, "/Users/me/on-disk.pdf", "pdf");
    await draft.commit({ title: "  What I Typed  ", cover: { kind: "none" } });
    expect(commitPdfBook).toHaveBeenCalledWith(
      expect.objectContaining({ title: "What I Typed" }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run fixedImportStage`
Expected: FAIL. The PDF prefill case reports `expected 'Microsoft Word - Doc1' to be 'Ahmed Metwally dalel'`; the DOCX case reports `expected 'Chapter One' to be 'my book'`.

- [ ] **Step 3: Write the implementation**

In `src/store/fixedImportStage.ts`, widen the import on line 13:

```ts
import { filenameTitle, preferredTitle } from "./importName";
```

Site 1 — `stagePdf` draft prefill, line 150. Replace:

```ts
    title: doc.meta.title || fallback,
```

with:

```ts
    title: preferredTitle(fallback, doc.meta.title),
```

Site 2 — `stagePdf` commit, line 168. Replace:

```ts
        title: title.trim() || doc.meta.title || fallback,
```

with:

```ts
        title: title.trim() || preferredTitle(fallback, doc.meta.title),
```

Site 3 — `stageDocx`, hoist the fallback so it mirrors `stagePdf:109` instead of being computed inline in the `docxToFixedDoc` argument. Replace:

```ts
  const { docxToFixedDoc } = await import("../docx/toFixedDoc");
  const fixed = await docxToFixedDoc(
    bytes,
    fallbackTitle || filenameTitle(filename),
  );
```

with:

```ts
  const { docxToFixedDoc } = await import("../docx/toFixedDoc");
  const fallback = fallbackTitle || filenameTitle(filename);
  // toFixedDoc still receives the fallback: it is the document's OWN title
  // resolution (first heading, else this), which stays a property of the
  // document. Only the dialog's prefill precedence changes, below.
  const fixed = await docxToFixedDoc(bytes, fallback);
```

Site 4 — `stageDocx` draft prefill, line 231. Replace:

```ts
    title: fixed.title,
```

with:

```ts
    title: preferredTitle(fallback, fixed.title),
```

Site 5 — `stageDocx` commit, line 241. Replace:

```ts
        title: title.trim() || fixed.title,
```

with:

```ts
        title: title.trim() || preferredTitle(fallback, fixed.title),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run fixedImportStage`
Expected: PASS, all eight cases green.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm test --run`
Expected: 117 files passed, 1067 + 13 new tests passing, 1 skipped. No previously-green test may go red. `reimportRepair.test.ts` mocks `stageFixedImport` wholesale and must be unaffected — if it is not, stop and investigate rather than editing its expectations.

- [ ] **Step 6: Typecheck and lint**

Run: `cd ~/Desktop/my-work/Riwaq-import-modes && pnpm build 2>&1 | tail -20 && pnpm exec biome check src/store/fixedImportStage.ts src/store/importName.ts src/store/fixedImportStage.test.ts src/store/filenameTitle.test.ts`
Expected: no TypeScript errors, no Biome findings. CI has previously rejected this branch family on formatting alone, so do not skip this step.

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/my-work/Riwaq-import-modes
git add src/store/fixedImportStage.ts src/store/fixedImportStage.test.ts
git commit -m "feat(import): prefill the import dialog from the file's name

All four title sites — the PDF and DOCX dialog prefills and both commit
fallbacks — now weigh the filename first. stageDocx hoists its fallback
to mirror stagePdf rather than computing it inside an argument list.

docxToFixedDoc still receives the fallback unchanged: resolving the
document's own title from its first heading is a property of the
document, and only the dialog's precedence moves here."
```

---

## Verification

After both tasks:

- [ ] `pnpm test --run` — full suite green, no previously-passing test red.
- [ ] `pnpm build` — clean typecheck.
- [ ] `pnpm exec biome check src/` — clean.
- [ ] Manual, desktop: import a PDF whose embedded title differs from its filename. The dialog shows the filename. Confirm, and the library card shows the filename.
- [ ] Manual, desktop: import the same PDF, clear the title field, confirm. The book stores the filename, not a blank title and not the embedded title.

## Out of scope for this phase

Phase 2 (DOCX reading modes + position mapping) and Phase 3 (background import + crash recovery) get their own plans. Nothing in this phase touches `book.json`, `BookState`, the readers, or the staging manifest.
