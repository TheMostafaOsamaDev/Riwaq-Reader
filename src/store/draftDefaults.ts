// The cover a PDF/DOCX import gets when nobody chooses one: the first
// candidate, or none. Shared by the import dialog's Skip paths and the
// background importer, which commits without asking.
//
// Its own module, holding only types from ./fixedImportStage, because that
// module pulls in pdf.js and mammoth and is loaded on demand.

import type { CoverChoice, FixedImportDraft } from "./fixedImportStage";

export function draftDefaultCover(
  d: Pick<FixedImportDraft, "defaultCoverId">,
): CoverChoice {
  return d.defaultCoverId
    ? { kind: "candidate", id: d.defaultCoverId }
    : { kind: "none" };
}
