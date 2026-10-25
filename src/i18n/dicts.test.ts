// Guards every language at once, so new translations can't drift from
// English or reintroduce the punctuation antislop bans.
import { describe, expect, test } from "vitest";
import type { Msg } from "./core";
import { DICTS, LANGUAGES } from "./index";

const forms = (m: Msg) => (typeof m === "string" ? [m] : Object.values(m).filter((x): x is string => !!x));
const placeholders = (m: Msg) => new Set(forms(m).flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1])));

const en = DICTS.en;

describe.each(LANGUAGES.map((l) => l.id))("%s", (code) => {
  const dict = DICTS[code];

  test("has every key English has", () => {
    expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
  });

  test("uses the same placeholders as English", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect([...placeholders(dict[key])].sort(), key).toEqual([...placeholders(en[key])].sort());
    }
  });

  test("has an 'other' plural form wherever it uses plurals", () => {
    for (const [key, m] of Object.entries(dict)) {
      if (typeof m !== "string") expect(m.other, key).toBeTruthy();
    }
  });

  test("contains no empty strings, em dashes, or middle dots", () => {
    for (const [key, m] of Object.entries(dict)) {
      for (const s of forms(m)) {
        expect(s.trim(), key).not.toBe("");
        expect(s, key).not.toMatch(/[—·]/);
      }
    }
  });
});
