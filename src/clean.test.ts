import { describe, expect, test } from "vitest";
import { cleanText, cleanUrl, hasTracking, maskSensitive } from "./clean";

describe("cleanUrl", () => {
  test("removes tracking parameters and keeps real ones", () => {
    expect(cleanUrl("https://shop.example.com/p/1?utm_source=ig&utm_medium=social&id=9&fbclid=abc")).toBe(
      "https://shop.example.com/p/1?id=9",
    );
  });

  test("drops the question mark when nothing is left", () => {
    expect(cleanUrl("https://a.com/x?gclid=1")).toBe("https://a.com/x");
  });

  test("removes share ids from Spotify and YouTube", () => {
    expect(cleanUrl("https://open.spotify.com/track/abc?si=xyz")).toBe("https://open.spotify.com/track/abc");
    expect(cleanUrl("https://youtu.be/abc?si=xyz&t=30")).toBe("https://youtu.be/abc?t=30");
  });

  test("keeps the fragment", () => {
    expect(cleanUrl("https://a.com/doc?utm_campaign=x#bagian-2")).toBe("https://a.com/doc#bagian-2");
  });
});

describe("cleanText", () => {
  test("cleans every link inside a message", () => {
    expect(cleanText("Cek ini https://a.com/?utm_source=x dan https://b.com/y?ref=z&fbclid=1")).toBe(
      "Cek ini https://a.com/ dan https://b.com/y?ref=z",
    );
  });

  test("trims trailing spaces and collapses blank lines", () => {
    expect(cleanText("baris satu   \n\n\n\nbaris dua  ")).toBe("baris satu\n\nbaris dua");
  });
});

describe("hasTracking", () => {
  test("is true only when a link carries tracking", () => {
    expect(hasTracking("lihat https://a.com/?utm_source=x")).toBe(true);
    expect(hasTracking("lihat https://a.com/?id=3")).toBe(false);
  });
});

describe("maskSensitive", () => {
  test("masks an NIK", () => {
    expect(maskSensitive("NIK saya 3273012505900001 ya")).toBe("NIK saya 3273********0001 ya");
  });

  test("masks a card number that passes the Luhn check", () => {
    expect(maskSensitive("4111 1111 1111 1111")).toBe("•••• •••• •••• 1111");
  });

  test("leaves numbers that are neither NIK nor card alone", () => {
    expect(maskSensitive("4111-1111-1111-1112")).toBe("4111-1111-1111-1112");
    expect(maskSensitive("1234567890123456")).toBe("1234567890123456");
  });
});
