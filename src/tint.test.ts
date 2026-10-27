import { describe, expect, it } from "vitest";
import { contrast } from "./theme";
import { coverBackdrop, edgeColor, pickTint } from "./tint";

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

describe("edgeColor", () => {
  it("averages the right quarter, where the cover fades into the panel", () => {
    // 4×4: left three columns red, right column cream.
    const row: [number, number, number][] = [[200, 0, 0], [200, 0, 0], [200, 0, 0], [240, 230, 210]];
    const data = px(...row, ...row, ...row, ...row);
    expect(edgeColor(data, 4)).toBe("#F0E6D2");
  });

  it("returns null when the edge is all transparent", () => {
    expect(edgeColor(new Uint8ClampedArray(4 * 4), 2)).toBeNull();
  });
});

describe("coverBackdrop", () => {
  it("keeps a pale edge and writes on it in dark ink", () => {
    expect(coverBackdrop("#EFE6D6")).toEqual({ bg: "#EFE6D6", ink: "on-light" });
  });

  it("keeps a deep edge and writes on it in white", () => {
    expect(coverBackdrop("#1B2E2A")).toEqual({ bg: "#1B2E2A", ink: "on-dark" });
  });

  it("nudges a mid-tone edge until the ink reads at 5:1", () => {
    for (const edge of ["#8F55A0", "#C0703A", "#6E8C7A", "#808080"]) {
      const { bg, ink } = coverBackdrop(edge);
      expect(contrast(bg, ink === "on-dark" ? "#FFFFFF" : "#14183A")).toBeGreaterThanOrEqual(5);
    }
  });
});
