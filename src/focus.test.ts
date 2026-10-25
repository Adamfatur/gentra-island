import { describe, expect, test } from "vitest";
import { clock, isDone, pause, progress, remaining, resume, start } from "./focus";

const MIN = 60_000;
const T0 = 1_000_000;

describe("focus timer", () => {
  test("counts down from the chosen minutes", () => {
    const t = start(25, T0);
    expect(remaining(t, T0)).toBe(25 * MIN);
    expect(remaining(t, T0 + 10 * MIN)).toBe(15 * MIN);
  });

  test("never goes below zero and reports done", () => {
    const t = start(1, T0);
    expect(remaining(t, T0 + 5 * MIN)).toBe(0);
    expect(isDone(t, T0 + 5 * MIN)).toBe(true);
    expect(isDone(t, T0 + 30_000)).toBe(false);
  });

  test("pausing freezes the time left", () => {
    const paused = pause(start(25, T0), T0 + 5 * MIN);
    expect(remaining(paused, T0 + 60 * MIN)).toBe(20 * MIN);
    expect(isDone(paused, T0 + 60 * MIN)).toBe(false);
  });

  test("resuming continues from where it paused", () => {
    const paused = pause(start(25, T0), T0 + 5 * MIN);
    const resumed = resume(paused, T0 + 30 * MIN);
    expect(remaining(resumed, T0 + 40 * MIN)).toBe(10 * MIN);
  });

  test("progress runs from 0 to 1", () => {
    const t = start(10, T0);
    expect(progress(t, T0)).toBe(0);
    expect(progress(t, T0 + 5 * MIN)).toBeCloseTo(0.5);
    expect(progress(t, T0 + 20 * MIN)).toBe(1);
  });
});

describe("clock", () => {
  test.each([
    [25 * MIN, "25:00"],
    [4 * MIN + 5_000, "4:05"],
    [65 * MIN, "1:05:00"],
    [400, "0:01"],
    [0, "0:00"],
  ])("%i ms → %s", (ms, text) => {
    expect(clock(ms)).toBe(text);
  });
});
