import { describe, expect, it } from "vitest";
import { checkDelay, due, loadReminders, type Reminder } from "./reminders";

const r = (id: string, at: number, fired = false): Reminder => ({ id, text: id, at, created: 0, fired });

describe("checkDelay", () => {
  it("waits for nothing when there are no reminders", () => {
    expect(checkDelay([], 1000)).toBeNull();
  });

  it("wakes at the next reminder, but at least once a minute in case the Mac slept", () => {
    expect(checkDelay([r("a", 31_000)], 1_000)).toBe(30_000);
    expect(checkDelay([r("a", 10 * 60_000)], 0)).toBe(60_000);
  });

  it("ignores reminders that already fired and wait for the user", () => {
    expect(checkDelay([r("a", 500, true)], 1_000)).toBeNull();
  });

  it("checks right away when something is overdue", () => {
    expect(checkDelay([r("a", 500)], 1_000)).toBe(0);
  });
});

describe("due", () => {
  it("returns unfired reminders whose time has come, oldest first", () => {
    const list = [r("later", 5_000), r("b", 900), r("a", 100), r("done", 50, true)];
    expect(due(list, 1_000).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("loadReminders", () => {
  it("survives missing or broken storage", () => {
    expect(loadReminders(null)).toEqual([]);
    expect(loadReminders("{nope")).toEqual([]);
    expect(loadReminders(JSON.stringify([{ id: "x" }]))).toEqual([]);
  });

  it("keeps valid reminders", () => {
    const ok = [{ id: "a", text: "Call Budi", at: 5, created: 1, fired: false }];
    expect(loadReminders(JSON.stringify(ok))).toEqual(ok);
  });
});
