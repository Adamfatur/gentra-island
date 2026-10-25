import { describe, expect, test } from "vitest";
import { GUIDE_VERSION, LAST_STEP, clampStep, needsGuide } from "./onboarding";

describe("needsGuide", () => {
  test("shows the guide on first run", () => {
    expect(needsGuide(null)).toBe(true);
  });

  test("does not show it again after it was finished", () => {
    expect(needsGuide(String(GUIDE_VERSION))).toBe(false);
  });

  test("shows it again when a newer guide ships", () => {
    expect(needsGuide(String(GUIDE_VERSION - 1))).toBe(true);
  });

  test("treats unreadable values as first run", () => {
    expect(needsGuide("ya")).toBe(true);
  });
});

describe("clampStep", () => {
  test("stays between the first and last step", () => {
    expect(clampStep(-1)).toBe(0);
    expect(clampStep(LAST_STEP + 3)).toBe(LAST_STEP);
    expect(clampStep(1)).toBe(1);
  });
});
