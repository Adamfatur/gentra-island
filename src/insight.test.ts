import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { setLanguage } from "./i18n";
import { analyze } from "./insight";

// The original suite reads the Indonesian copy; English has its own block below.
beforeAll(() => setLanguage("id"));
afterAll(() => setLanguage("en"));

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: object) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.c2lnbmF0dXJl`;
const first = (text: string) => analyze(text, NOW)[0];

describe("JWT", () => {
  test("shows algorithm and time until expiry", () => {
    const i = first(jwt({ sub: "42", name: "Raka", exp: NOW / 1000 + 7200 }));
    expect(i.kind).toBe("jwt");
    expect(i.summary).toBe("HS256, kedaluwarsa dalam 2 jam");
  });

  test("keeps the minutes when expiry is not a whole hour", () => {
    expect(first(jwt({ exp: NOW / 1000 + 5400 })).summary).toBe("HS256, kedaluwarsa dalam 1 jam 30 menit");
  });

  test("outputs the payload as pretty JSON", () => {
    const i = first(jwt({ sub: "42", name: "Raka" }));
    expect(i.output).toBe(JSON.stringify({ sub: "42", name: "Raka" }, null, 2));
  });

  test("says when the token already expired", () => {
    const i = first(jwt({ exp: NOW / 1000 - 3 * 86400 }));
    expect(i.summary).toContain("sudah kedaluwarsa 3 hari lalu");
  });

  test("says when there is no expiry", () => {
    expect(first(jwt({ sub: "1" })).summary).toContain("tanpa batas waktu");
  });
});

describe("timestamps and dates", () => {
  test("reads unix seconds as a local date", () => {
    const i = first("1792931573");
    expect(i.kind).toBe("timestamp");
    expect(i.summary).toContain("25 Okt 2026");
    expect(i.summary).toContain("WIB");
    expect(i.output).toBe(new Date(1792931573000).toISOString());
  });

  test("reads unix milliseconds", () => {
    expect(first("1792931573000").kind).toBe("timestamp");
  });

  test("ignores short numbers and phone numbers", () => {
    expect(analyze("12345", NOW)).toEqual([]);
    expect(analyze("081234567890", NOW)).toEqual([]);
  });

  test("turns an ISO date into unix seconds", () => {
    const i = first("2026-10-25T12:00:00Z");
    expect(i.kind).toBe("date");
    expect(i.output).toBe(String(NOW / 1000));
  });
});

describe("JSON", () => {
  test("pretty-prints minified JSON and counts keys", () => {
    const i = first('{"a":1,"b":[1,2]}');
    expect(i.kind).toBe("json");
    expect(i.summary).toBe("JSON valid, 2 kunci");
    expect(i.output).toBe(JSON.stringify({ a: 1, b: [1, 2] }, null, 2));
  });

  test("minifies JSON that is already pretty", () => {
    expect(first('{\n  "a": 1\n}').output).toBe('{"a":1}');
  });

  test("reports invalid JSON", () => {
    const i = first('{"a":1,}');
    expect(i.kind).toBe("json");
    expect(i.summary).toMatch(/^JSON-nya tidak valid/);
    expect(i.output).toBeUndefined();
  });
});

describe("encodings", () => {
  test("decodes base64 text", () => {
    const i = first("SGFsbyBkYXJpIER5bmFtaWMgR2F0ZQ==");
    expect(i.kind).toBe("base64");
    expect(i.output).toBe("Halo dari Dynamic Gate");
  });

  test("leaves ordinary words alone", () => {
    expect(analyze("Pengumuman", NOW)).toEqual([]);
  });

  test("ignores base64 that decodes to binary", () => {
    expect(analyze("abcd1234abcd", NOW)).toEqual([]);
  });

  test("decodes percent-encoding", () => {
    const i = first("nama%20lengkap%3DRaka");
    expect(i.kind).toBe("urlencoded");
    expect(i.output).toBe("nama lengkap=Raka");
  });
});

describe("colours", () => {
  test("converts hex to rgb and hsl", () => {
    const i = first("#FF6A3D");
    expect(i.kind).toBe("color");
    expect(i.summary).toBe("rgb(255, 106, 61) / hsl(14, 100%, 62%)");
    expect(i.output).toBe("rgb(255, 106, 61)");
  });

  test("converts rgb to hex", () => {
    expect(first("rgb(255, 106, 61)").output).toBe("#FF6A3D");
  });
});

describe("cron", () => {
  test.each([
    ["*/15 * * * *", "Tiap 15 menit"],
    ["0 9 * * 1", "Tiap Senin pukul 09.00"],
    ["30 8 * * *", "Tiap hari pukul 08.30"],
    ["0 0 1 * *", "Tiap tanggal 1 pukul 00.00"],
  ])("%s → %s", (expr, words) => {
    const i = first(expr);
    expect(i.kind).toBe("cron");
    expect(i.summary).toBe(words);
  });
});

test("plain sentences get no insight", () => {
  expect(analyze("Rapat sprint dipindah ke Kamis jam 14.00", NOW)).toEqual([]);
});

describe("in English", () => {
  beforeAll(() => setLanguage("en"));
  afterAll(() => setLanguage("id"));

  test("JWT expiry reads naturally", () => {
    expect(first(jwt({ exp: NOW / 1000 + 5400 })).summary).toBe("HS256, expires in 1 hour and 30 minutes");
    expect(first(jwt({ exp: NOW / 1000 - 3 * 86400 })).summary).toBe("HS256, expired 3 days ago");
    expect(first(jwt({ sub: "1" })).summary).toBe("HS256, no expiry");
  });

  test("JSON counts keys and items", () => {
    expect(first('{"a":1,"b":2}').summary).toBe("Valid JSON, 2 keys");
    expect(first("[1]").summary).toBe("Valid JSON, 1 item");
  });

  test.each([
    ["*/15 * * * *", "Every 15 minutes"],
    ["0 9 * * 1", "Every Monday at 09:00"],
    ["0 9 * * 1-5", "Every Monday to Friday at 09:00"],
    ["30 8 * * *", "Every day at 08:30"],
  ])("cron %s reads %s", (expr, words) => {
    expect(first(expr).summary).toBe(words);
  });

  test("timestamps use English dates", () => {
    expect(first("1792931573").summary).toContain("Oct");
  });
});
