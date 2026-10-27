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
  test("eyes: a valid choice stays, the old off switch stays off", () => {
    expect(loadSettings('{"eyes":"always"}').eyes).toBe("always");
    expect(loadSettings('{"islandEyes":false}').eyes).toBe("off");
    expect(loadSettings('{"islandEyes":true}').eyes).toBe("always");
    expect(loadSettings('{"eyes":"wink"}').eyes).toBe("always");
  });

  test("keeps a valid island size and drops a made-up one", () => {
    expect(loadSettings('{"islandSize":"wide"}').islandSize).toBe("wide");
    expect(loadSettings('{"islandSize":"huge"}').islandSize).toBe("notch");
  });

  test("keeps the daily update check unless it was turned off", () => {
    expect(loadSettings('{"autoUpdate":false}').autoUpdate).toBe(false);
    expect(loadSettings('{"autoUpdate":"no"}').autoUpdate).toBe(true);
    expect(loadSettings(null).autoUpdate).toBe(true);
  });

  test("reads a valid saved setting", () => {
    expect(loadSettings('{"theme":"light","accent":"#FF6A3D"}')).toEqual({ theme: "light", accent: "#FF6A3D", islandSize: "notch", eyes: "always", clipKeep: 30, autoUpdate: true });
  });

  test("falls back to defaults for missing or broken data", () => {
    expect(loadSettings(null)).toEqual({ theme: "auto", accent: null, islandSize: "notch", eyes: "always", clipKeep: 30, autoUpdate: true });
    expect(loadSettings("{not json")).toEqual({ theme: "auto", accent: null, islandSize: "notch", eyes: "always", clipKeep: 30, autoUpdate: true });
  });

  test("drops values that are not a theme or a hex colour", () => {
    expect(loadSettings('{"theme":"neon","accent":"red;background:url(x)"}')).toEqual({ theme: "auto", accent: null, islandSize: "notch", eyes: "always", clipKeep: 30, autoUpdate: true });
  });

  test("keeps a chosen clipboard history length, and only real choices", () => {
    expect(loadSettings('{"clipKeep":30}').clipKeep).toBe(30);
    expect(loadSettings('{"clipKeep":0}').clipKeep).toBe(0);
    expect(loadSettings('{"clipKeep":5}').clipKeep).toBe(30);
  });
});
