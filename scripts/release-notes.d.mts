export const IMAGE_CAP: number;
/** A plain .webp file name: no path, nothing that can leave release-notes/img. */
export const IMAGE_NAME: RegExp;
export function validateReleaseNotes(
  notes: unknown,
  opts: { version: string; imageBytes: (name: string) => number | undefined },
): string[];
