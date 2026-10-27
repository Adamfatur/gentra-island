import { describe, expect, it } from "vitest";
import { clock, pickCore } from "./core";

const ask = { agent: "Claude Code", summary: "npm test" };
const call = { app: "Zoom", muted: false };
const agent = { agent: "Claude Code", project: "gentra-island", since: 0 };
const focus = { endsAt: 1_500_000, paused: false };
const download = { name: "design.zip", bytes: 10, total: null };

describe("the core", () => {
  it("shows nothing when nothing is going on", () => {
    expect(pickCore({})).toEqual({ kind: "idle" });
  });

  it("puts someone who needs you before everything else", () => {
    expect(pickCore({ ask, call, agent, focus, download }).kind).toBe("ask");
  });

  it("then a call, an agent, focus, and a download, in that order", () => {
    expect(pickCore({ call, agent, focus, download }).kind).toBe("call");
    expect(pickCore({ agent, focus, download }).kind).toBe("agent");
    expect(pickCore({ focus, download }).kind).toBe("focus");
    expect(pickCore({ download }).kind).toBe("download");
  });

  it("keeps what it was given", () => {
    expect(pickCore({ agent })).toEqual({ kind: "agent", ...agent });
    expect(pickCore({ call: null, download })).toEqual({ kind: "download", ...download });
  });
});

describe("the readout", () => {
  it("reads like a clock", () => {
    expect(clock(252_000)).toBe("4:12");
    expect(clock(25 * 60_000)).toBe("25:00");
    expect(clock(3_723_000)).toBe("1:02:03");
    expect(clock(-5)).toBe("0:00");
  });
});
