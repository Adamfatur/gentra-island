import { describe, expect, it } from "vitest";
import { pickTint } from "./tint";

/** RGBA pixels from [r, g, b] triples. */
const px = (...colors: [number, number, number][]) => new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));

describe("pickTint", () => {
  it("prefers the vivid color over grey and black", () => {
    expect(pickTint(px([20, 20, 20], [128, 128, 128], [230, 60, 40], [240, 240, 240]))).toBe("#E63C28");
  });

  it("ignores near-white and near-black pixels even when they dominate", () => {
    expect(pickTint(px([5, 5, 5], [5, 5, 5], [5, 5, 5], [250, 250, 250], [40, 90, 200]))).toBe("#285AC8");
  });

  it("returns null for artwork with no color at all", () => {
    expect(pickTint(px([10, 10, 10], [128, 128, 128], [250, 250, 250]))).toBeNull();
  });

  it("skips transparent pixels", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 0, 30, 160, 90, 255]);
    expect(pickTint(data)).toBe("#1EA05A");
  });
});
