import { afterEach, describe, expect, test } from "vitest";
import { createI18n, resolveLang } from "./core";

const en = {
  hello: "Hello, {name}",
  files: { one: "{count} file", other: "{count} files" },
  onlyEnglish: "Only in English",
};
const id = {
  hello: "Halo, {name}",
  files: { other: "{count} file" },
};
const ar = { hello: "مرحبا {name}" };

const i18n = createI18n({ en, id, ar }, { en: "ltr", id: "ltr", ar: "rtl" });
afterEach(() => i18n.setLang("en"));

describe("t", () => {
  test("fills in placeholders", () => {
    expect(i18n.t("hello", { name: "Raka" })).toBe("Hello, Raka");
  });

  test("uses the current language", () => {
    i18n.setLang("id");
    expect(i18n.t("hello", { name: "Raka" })).toBe("Halo, Raka");
  });

  test("falls back to English when a translation is missing", () => {
    i18n.setLang("id");
    expect(i18n.t("onlyEnglish")).toBe("Only in English");
  });

  test("returns the key itself when even English lacks it", () => {
    expect(i18n.t("nope.missing")).toBe("nope.missing");
  });

  test("picks the plural form for the language", () => {
    expect(i18n.t("files", { count: 1 })).toBe("1 file");
    expect(i18n.t("files", { count: 3 })).toBe("3 files");
    i18n.setLang("id");
    expect(i18n.t("files", { count: 1 })).toBe("1 file");
  });

  test("formats numbers in placeholders for the language", () => {
    i18n.setLang("id");
    expect(i18n.t("files", { count: 1200 })).toBe("1.200 file");
  });
});

describe("direction", () => {
  test("Arabic reads right to left", () => {
    i18n.setLang("ar");
    expect(i18n.dir()).toBe("rtl");
    expect(i18n.dir()).not.toBe(undefined);
  });
});

describe("resolveLang", () => {
  test("defaults to English", () => {
    expect(resolveLang(null, ["en", "id"])).toBe("en");
  });

  test("keeps a saved, supported choice", () => {
    expect(resolveLang("id", ["en", "id"])).toBe("id");
  });

  test("ignores a saved language that is no longer shipped", () => {
    expect(resolveLang("xx", ["en", "id"])).toBe("en");
  });
});
