import { describe, expect, test } from "vitest";
import { FEATURES, MODES, loadModeState, pick, toggle } from "./modes";

const ready = (id: string) => FEATURES.find((f) => f.id === id)?.ready;

describe("pick", () => {
  test("turns on exactly the ready features of the preset", () => {
    const s = pick("ringkas");
    expect(s.mode).toBe("ringkas");
    expect(s.on.sort()).toEqual(["clip", "ingat", "jaga", "pintar", "sistem"]);
  });

  test("Dev turns on the port watcher and command alerts", () => {
    const s = pick("dev");
    expect(MODES.dev.features).toContain("port");
    expect(s.on).toContain("port");
    expect(s.on).toContain("perintah");
    expect(s.on.every((id) => ready(id))).toBe(true);
  });
});

describe("toggle", () => {
  test("changing one feature makes the mode custom and remembers the base", () => {
    const s = toggle(pick("harian"), "bersih");
    expect(s.mode).toBe("kustom");
    expect(s.base).toBe("harian");
    expect(s.on).not.toContain("bersih");
  });

  test("returning to a preset's exact set restores that preset's name", () => {
    const s = toggle(toggle(pick("harian"), "bersih"), "bersih");
    expect(s.mode).toBe("harian");
  });

  test("adding a feature from another preset makes the mode custom", () => {
    const s = toggle(pick("harian"), "port");
    expect(s.on).toContain("port");
    expect(s.mode).toBe("kustom");
    expect(s.base).toBe("harian");
  });
});

describe("loadModeState", () => {
  test("defaults to Harian when nothing is saved or it is broken", () => {
    expect(loadModeState(null)).toEqual(pick("harian"));
    expect(loadModeState("{nope")).toEqual(pick("harian"));
  });

  test("keeps a saved custom set but drops unknown features", () => {
    const raw = JSON.stringify({ mode: "kustom", base: "dev", on: ["sistem", "rak", "port", "hack"] });
    expect(loadModeState(raw)).toEqual({ mode: "kustom", base: "dev", on: ["sistem", "rak", "port"] });
  });

  test("a saved preset is re-derived so new features in that preset appear", () => {
    expect(loadModeState(JSON.stringify({ mode: "fokus", base: "fokus", on: [] }))).toEqual(pick("fokus"));
  });
});
