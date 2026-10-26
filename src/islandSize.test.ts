import { describe, expect, it } from "vitest";
import { compactLook, compactWidth } from "./islandSize";

const notch = { hasNotch: true, notchW: 185 };

describe("island size", () => {
  it("hides in the notch when nothing is live", () => {
    const look = compactLook("notch", { hasNotch: true, live: false, hovering: false });
    expect(look).toBe("tucked");
    expect(compactWidth(look, notch)).toBe(185);
  });

  it("grows just enough for icons when something is live", () => {
    const look = compactLook("notch", { hasNotch: true, live: true, hovering: false });
    expect(look).toBe("slim");
    expect(compactWidth(look, notch)).toBe(185 + 68);
  });

  it("shows everything while you point at it, whatever the size", () => {
    for (const size of ["notch", "compact", "wide"] as const) {
      expect(compactLook(size, { hasNotch: true, live: false, hovering: true })).toBe("full");
    }
    expect(compactWidth("full", notch)).toBe(185 + 148);
  });

  it("compact stays slim, wide stays as before", () => {
    expect(compactLook("compact", { hasNotch: true, live: false, hovering: false })).toBe("slim");
    expect(compactLook("wide", { hasNotch: true, live: false, hovering: false })).toBe("full");
  });

  it("a floating island never shrinks to nothing", () => {
    const look = compactLook("notch", { hasNotch: false, live: false, hovering: false });
    expect(look).toBe("slim");
    expect(compactWidth(look, { hasNotch: false, notchW: 0 })).toBe(108);
    expect(compactWidth("full", { hasNotch: false, notchW: 0 })).toBe(196);
  });
});
