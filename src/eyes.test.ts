import { describe, expect, it } from "vitest";
import { gaze } from "./eyes";

describe("gaze", () => {
  it("looks toward the pointer", () => {
    expect(gaze(-120, 0)).toEqual([-2, 0]);
    expect(gaze(0, 90)).toEqual([0, 1]);
  });

  it("never rolls out of the notch", () => {
    expect(gaze(-5000, -5000)).toEqual([-7, -3]);
    expect(gaze(5000, 5000)).toEqual([7, 3]);
  });
});
