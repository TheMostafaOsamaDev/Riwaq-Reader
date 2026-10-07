// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { installAndroidInsets, NAV_BOTTOM_VAR } from "./androidInsets";

afterEach(() => {
  delete window.RiwaqInsets;
  document.documentElement.style.removeProperty(NAV_BOTTOM_VAR);
});

const value = () =>
  document.documentElement.style.getPropertyValue(NAV_BOTTOM_VAR);

describe("installAndroidInsets", () => {
  it("does nothing without the Android bridge", () => {
    installAndroidInsets()();
    expect(value()).toBe("");
  });

  it("sets the navigation bar's height at once, and again when told", () => {
    let dp = 24;
    window.RiwaqInsets = { bottom: () => dp };
    const off = installAndroidInsets();
    expect(value()).toBe("24px");
    dp = 48; // switched to 3-button navigation
    window.dispatchEvent(new Event("riwaq-insets"));
    expect(value()).toBe("48px");
    dp = 0; // the bar went away (immersive, landscape on some phones)
    window.dispatchEvent(new Event("resize"));
    expect(value()).toBe("");
    off();
  });

  it("leaves env() in charge when the bridge throws", () => {
    window.RiwaqInsets = {
      bottom: () => {
        throw new Error("gone");
      },
    };
    installAndroidInsets()();
    expect(value()).toBe("");
  });
});
