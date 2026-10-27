import { describe, expect, it } from "vitest";
import { parseColor } from "./dropletsView";

describe("reading the song's colour for the glass", () => {
  it("reads rgb() and hex", () => {
    expect(parseColor("rgb(226, 114, 91)")).toEqual([226, 114, 91]);
    expect(parseColor(" rgba(12,34,56,0.5)")).toEqual([12, 34, 56]);
    expect(parseColor("#5ac8fa")).toEqual([90, 200, 250]);
  });

  it("gives up on anything else", () => {
    expect(parseColor("")).toBeNull();
    expect(parseColor("var(--accent)")).toBeNull();
    expect(parseColor("#fff")).toBeNull();
  });
});
