import { describe, expect, it } from "vitest";
import { BREAK_AFTER, DAILY_CAP, careAnswer, careTick, freshCare, type CareState } from "./care";

const MIN = 60_000;
const at = (h: number, m = 0, day = 26) => new Date(2026, 9, day, h, m);

/** Ticks once a minute from `from` for `minutes`, at the given idle seconds. */
function run(s: CareState, from: Date, minutes: number, idle = 5, busy = false) {
  const nudges: { kind: string; at: number }[] = [];
  for (let i = 1; i <= minutes; i++) {
    const now = new Date(from.getTime() + i * MIN);
    const r = careTick(s, { now, idle, busy });
    s = r.state;
    if (r.nudge) nudges.push({ kind: r.nudge.kind, at: i });
  }
  return { s, nudges };
}

describe("care", () => {
  it("suggests a break after about 50 minutes of work", () => {
    const { nudges } = run(freshCare(at(9)), at(9), 55);
    // The stretch starts at the first tick, so it lands just after 50 minutes.
    expect(nudges).toEqual([{ kind: "break", at: 51 }]);
  });

  it("five quiet minutes count as a break", () => {
    let { s } = run(freshCare(at(9)), at(9), 40);
    ({ s } = run(s, at(9, 40), 6, 400));
    const after = run(s, at(9, 46), 45);
    expect(after.nudges).toEqual([]);
  });

  it("asks again later if you keep going, but never closer than the gap", () => {
    const { nudges } = run(freshCare(at(9)), at(9), 120);
    expect(nudges[0].kind).toBe("break");
    expect(nudges.filter((n) => n.kind === "break").length).toBeGreaterThan(1);
    for (let i = 1; i < nudges.length; i++) expect(nudges[i].at - nudges[i - 1].at).toBeGreaterThanOrEqual(20);
  });

  it("reminds about water after 90 active minutes", () => {
    let s = freshCare(at(9));
    s = careAnswer(s, "break", "today", at(9));
    const { nudges } = run(s, at(9), 95);
    expect(nudges).toEqual([{ kind: "water", at: 90 }]);
  });

  it("offers lunch once, while you're working through it", () => {
    let s = freshCare(at(11, 40));
    s = careAnswer(s, "break", "today", at(11, 40));
    const { nudges } = run(s, at(11, 40), 120);
    expect(nudges.filter((n) => n.kind === "lunch")).toHaveLength(1);
  });

  it("stays quiet while busy, and when nobody is there", () => {
    expect(run(freshCare(at(9)), at(9), 120, 5, true).nudges).toEqual([]);
    expect(run(freshCare(at(9)), at(9), 120, 900).nudges).toEqual([]);
  });

  it("says it's late once a night", () => {
    let s = freshCare(at(23));
    s = careAnswer(s, "break", "today", at(23));
    s = careAnswer(s, "water", "today", at(23));
    const { nudges } = run(s, at(23), 59);
    expect(nudges).toEqual([{ kind: "late", at: 11 }]);
  });

  it("'Not today' silences that kind until tomorrow", () => {
    let s = careAnswer(freshCare(at(9)), "break", "today", at(9));
    s = careAnswer(s, "water", "today", at(9));
    expect(run(s, at(9), 170).nudges).toEqual([]);
    // The overnight gap resets the stretch on the first tick.
    const tomorrow = run(s, at(9, 0, 27), BREAK_AFTER / MIN + 3);
    expect(tomorrow.nudges.map((n) => n.kind)).toContain("break");
  });

  it("'Later' brings it back in fifteen minutes", () => {
    let { s } = run(freshCare(at(9)), at(9), 50);
    s = careAnswer(s, "break", "later", at(9, 50));
    const { nudges } = run(s, at(9, 50), 16);
    expect(nudges).toEqual([{ kind: "break", at: 15 }]);
  });

  it("never more than the daily cap", () => {
    const { nudges } = run(freshCare(at(7)), at(7), 15 * 60);
    expect(nudges.length).toBeLessThanOrEqual(DAILY_CAP);
  });

  it("a sleeping computer doesn't count as work", () => {
    let { s } = run(freshCare(at(9)), at(9), 40);
    // Next tick comes 3 hours later (lid closed); idle reads low after waking.
    const r = careTick(s, { now: at(12, 40), idle: 1, busy: false });
    expect(r.nudge?.kind).not.toBe("break");
    s = r.state;
    expect(run(s, at(12, 40), 30).nudges.map((n) => n.kind)).not.toContain("break");
  });
});
