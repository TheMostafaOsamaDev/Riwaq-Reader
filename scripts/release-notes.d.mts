export const IMAGE_CAP: number;
export function validateReleaseNotes(
  notes: unknown,
  opts: { version: string; imageBytes: (name: string) => number | undefined },
): string[];
