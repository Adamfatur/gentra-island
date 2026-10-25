import { describe, expect, it } from "vitest";
import { position, sameTrack, type NowPlaying } from "./mediaPanel";

const song = (over: Partial<NowPlaying> = {}): NowPlaying => ({
  title: "Kita",
  artist: "Sheila on 7",
  album: "Kisah Klasik",
  app: "Spotify",
  playing: true,
  duration: 245,
  elapsed: 10,
  at: 1_000_000,
  art: null,
  ...over,
});

describe("position", () => {
  it("counts on from the last reading while playing", () => {
    expect(position(song(), 1_000_000 + 5_000)).toBe(15);
  });

  it("stands still while paused", () => {
    expect(position(song({ playing: false }), 1_000_000 + 60_000)).toBe(10);
  });

  it("never runs past the end", () => {
    expect(position(song(), 1_000_000 + 999_000)).toBe(245);
  });

  it("keeps counting for live streams with no length", () => {
    expect(position(song({ duration: 0 }), 1_000_000 + 3_000)).toBe(13);
  });
});

describe("sameTrack", () => {
  it("matches on title and artist, not position", () => {
    expect(sameTrack(song(), song({ elapsed: 99, playing: false }))).toBe(true);
    expect(sameTrack(song(), song({ title: "Dan" }))).toBe(false);
    expect(sameTrack(null, song())).toBe(false);
  });
});
