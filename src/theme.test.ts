import { describe, expect, test } from "vitest";
import { contrast, loadSettings, onAccentText, readableAccent, resolveTheme } from "./theme";

describe("resolveTheme", () => {
  test("auto follows the system", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
  });

  test("an explicit choice ignores the system", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("contrast", () => {
  test("matches the WCAG ratio", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrast("#8D8D96", "#17171B")).toBeCloseTo(5.43, 1);
  });
});

describe("readableAccent", () => {
  test("keeps an accent that already reads well", () => {
    expect(readableAccent("#5AC8FA", "#17171B")).toBe("#5AC8FA");
  });

  test("darkens a pale accent on a light surface until it passes 4.5:1", () => {
    const fixed = readableAccent("#5AC8FA", "#EEEEF2");
    expect(contrast(fixed, "#EEEEF2")).toBeGreaterThanOrEqual(4.5);
  });

  test("lightens a deep accent on a dark surface until it passes 4.5:1", () => {
    const fixed = readableAccent("#1A237E", "#17171B");
    expect(contrast(fixed, "#17171B")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("onAccentText", () => {
  test("picks black on bright accents and white on deep ones", () => {
    expect(onAccentText("#FFD60A")).toBe("#000000");
    expect(onAccentText("#0A66C2")).toBe("#FFFFFF");
  });
});

describe("loadSettings", () => {
  test("reads a valid saved setting", () => {
    expect(loadSettings('{"theme":"light","accent":"#FF6A3D"}')).toEqual({ theme: "light", accent: "#FF6A3D" });
  });

  test("falls back to defaults for missing or broken data", () => {
    expect(loadSettings(null)).toEqual({ theme: "auto", accent: null });
    expect(loadSettings("{not json")).toEqual({ theme: "auto", accent: null });
  });

  test("drops values that are not a theme or a hex colour", () => {
    expect(loadSettings('{"theme":"neon","accent":"red;background:url(x)"}')).toEqual({ theme: "auto", accent: null });
  });
});
