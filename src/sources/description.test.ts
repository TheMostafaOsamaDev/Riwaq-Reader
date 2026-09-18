import { describe, expect, it } from "vitest";
import { pickDescription } from "./description";

describe("pickDescription", () => {
  it("prefers the requested locale", () => {
    expect(pickDescription({ en: "English", ar: "عربي" }, "ar")).toBe("عربي");
  });

  it("falls back to en when the requested locale is absent", () => {
    // `en` is required by convention in the contract precisely so there is
    // always something to show.
    expect(pickDescription({ en: "English" }, "ar")).toBe("English");
  });

  it("falls back to the first entry when even en is absent", () => {
    // A third-party extension that ships only its own language must still
    // render something rather than a blank card.
    expect(pickDescription({ fr: "Français" }, "ar")).toBe("Français");
  });

  it("prefers en over another present language, not merely the first entry", () => {
    // The distinguishing case for the `en` step. With `en` listed after
    // another language, a fallback chain that skipped straight to "first
    // non-empty entry" returns "Français" here — and passes every other
    // test in this file, because in those `en` happens to BE the first
    // entry.
    expect(pickDescription({ fr: "Français", en: "English" }, "ar")).toBe(
      "English",
    );
  });

  it("returns undefined for an absent map", () => {
    expect(pickDescription(undefined, "en")).toBeUndefined();
  });

  it("returns undefined for an empty map", () => {
    // `{}` must not become `""`-then-truthy or `undefined`-then-crash; the
    // card's `description && (...)` guard needs a falsy, renderable answer.
    expect(pickDescription({}, "en")).toBeUndefined();
  });

  it("ignores an empty string for the requested locale and falls through", () => {
    // An empty `ar` entry is a missing translation, not a deliberate blank.
    expect(pickDescription({ en: "English", ar: "" }, "ar")).toBe("English");
  });
});
