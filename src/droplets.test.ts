import { describe, expect, it } from "vitest";
import { glassShapes, hitShapes, layout, openCore, tucked, type DropletId } from "./droplets";

const ALL: DropletId[] = ["media", "focus", "system", "clipboard", "shelf", "ai", "dev", "cleaner", "calls"];
const base = { winW: 760, notch: { w: 185, h: 32 }, on: ALL, view: "home" as const };

describe("the droplet layout", () => {
  it("hangs the cluster under the core, as in the mockup", () => {
    const l = layout(base);
    const media = l.droplets.find((d) => d.id === "media")!;
    expect(l.core).toEqual({ x: 154, y: 0, w: 452, h: 100, r: 50 });
    expect(media).toMatchObject({ x: 58, y: 116, w: 320, h: 150, r: 34, form: "card" });
    expect(l.droplets.find((d) => d.id === "focus")).toMatchObject({ x: 390, w: 150, r: 75, form: "round" });
    expect(l.droplets.find((d) => d.id === "clipboard")).toMatchObject({ y: 278, h: 84, r: 42 });
    expect(l.panel).toBeNull();
  });

  it("centres every row in the window", () => {
    for (const row of [116, 278]) {
      const ds = layout(base).droplets.filter((d) => d.y === row);
      const left = ds[0].x;
      const right = ds[ds.length - 1].x + ds[ds.length - 1].w;
      expect(left + right).toBeCloseTo(760);
    }
  });

  it("leaves out what the mode switched off and closes the gap", () => {
    const l = layout({ ...base, on: ["focus", "system", "clipboard"] });
    expect(l.droplets.map((d) => d.id)).toEqual(["focus", "system", "clipboard", "settings"]);
    expect(l.droplets[0].x).toBe((760 - (150 + 12 + 150)) / 2);
  });

  it("always offers Settings", () => {
    expect(layout({ ...base, on: [] }).droplets.map((d) => d.id)).toEqual(["settings"]);
  });

  it("grows droplets out in reading order", () => {
    expect(layout(base).droplets.map((d) => d.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("sizes chips to their names when measured", () => {
    const chips = layout({ ...base, chipW: { ai: 130, settings: 120 } }).droplets.filter((d) => d.form === "chip");
    expect(chips.find((c) => c.id === "ai")!.w).toBe(130);
    expect(chips.find((c) => c.id === "dev")!.w).toBe(110);
  });

  it("turns into one panel when a droplet opens", () => {
    const l = layout({ ...base, view: "clipboard" });
    expect(l.droplets).toEqual([]);
    expect(l.panel).toEqual({ x: 40, y: 116, w: 680, h: 540, r: 44 });
    expect(glassShapes(l)).toEqual([l.panel]);
  });

  it("fits the open panel in the 700 pt window", () => {
    const p = layout({ ...base, view: "settings" }).panel!;
    expect(p.y + p.h).toBeLessThanOrEqual(700);
  });

  it("gives the core a little less height without a notch", () => {
    expect(openCore(null, 760).h).toBe(92);
  });

  it("sends the core to the hit tester but not to the glass", () => {
    const l = layout(base);
    expect(glassShapes(l)).toHaveLength(l.droplets.length);
    expect(hitShapes(l)[0]).toEqual(l.core);
  });

  it("starts each droplet tucked inside the core", () => {
    const l = layout(base);
    const t = tucked(l.droplets[0], l.core);
    expect(t.y + t.h).toBe(l.core.h);
    expect(t.x + t.w / 2).toBe(l.core.x + l.core.w / 2);
  });
});
