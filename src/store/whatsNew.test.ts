import { describe, expect, it } from "vitest";
import { shouldShowWhatsNew } from "./whatsNew";

describe("shouldShowWhatsNew", () => {
  it("shows once for a version newer than the last one seen", () => {
    expect(shouldShowWhatsNew({ bundled: "0.6.0", lastSeen: "0.5.3" })).toBe(
      true,
    );
    expect(shouldShowWhatsNew({ bundled: "0.6.0", lastSeen: "0.6.0" })).toBe(
      false,
    );
  });
  it("shows to an updater from a build that never recorded anything", () => {
    // Every build before this feature: no lastSeenWhatsNew stored at all.
    expect(shouldShowWhatsNew({ bundled: "0.6.0", lastSeen: undefined })).toBe(
      true,
    );
  });
  it("never shows without bundled notes, or after a downgrade", () => {
    expect(shouldShowWhatsNew({ bundled: null, lastSeen: "0.5.3" })).toBe(
      false,
    );
    expect(shouldShowWhatsNew({ bundled: "0.6.0", lastSeen: "0.7.0" })).toBe(
      false,
    );
  });
});
