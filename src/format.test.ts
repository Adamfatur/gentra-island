import { beforeEach, describe, expect, it } from "vitest";
import { setLanguage } from "./i18n";
import { took } from "./format";

describe("took", () => {
  beforeEach(() => setLanguage("en"));

  it("says seconds for short runs", () => {
    expect(took(42)).toBe("42 sec");
  });

  it("adds minutes, dropping zero seconds", () => {
    expect(took(185)).toBe("3 min 5 sec");
    expect(took(120)).toBe("2 min");
  });

  it("switches to hours for long runs", () => {
    expect(took(3600 + 4 * 60 + 9)).toBe("1 hr 4 min");
  });

  it("follows the UI language", () => {
    setLanguage("id");
    expect(took(185)).toBe("3 mnt 5 dtk");
  });
});
