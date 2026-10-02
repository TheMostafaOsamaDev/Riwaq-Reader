import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import notes, { appVersion, images } from "virtual:whats-new";

describe("virtual:whats-new", () => {
  it("reports package.json's version synchronously", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(appVersion).toBe(pkg.version);
  });
  it("bundles only this version's notes, or null when there are none", () => {
    if (notes) expect(notes.version).toBe(appVersion);
    else expect(images).toEqual({});
  });
});
