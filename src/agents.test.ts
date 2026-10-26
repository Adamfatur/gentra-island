import { describe, expect, it } from "vitest";
import { Agents, elapsed, tokens, type AgentEvent } from "./agents";

const ev = (event: AgentEvent["event"], extra: Partial<AgentEvent> = {}): AgentEvent => ({
  agent: "claude",
  event,
  place: "shop",
  message: "",
  session: "s1",
  ...extra,
});

describe("Agents", () => {
  it("works, asks, and finishes", () => {
    const a = new Agents();
    expect(a.apply(ev("start"), 0)).toBeNull();
    expect(a.lead(1000)?.state).toBe("working");
    const n = a.apply(ev("notify", { message: "Claude needs your permission to use Bash" }), 5000);
    expect(n?.kind).toBe("waiting");
    expect(a.lead(6000)?.state).toBe("waiting");
    const d = a.apply(ev("stop"), 60_000);
    expect(d).toMatchObject({ kind: "done", secs: 60 });
    expect(a.lead(61_000)).toBeNull();
  });

  it("ignores the idle-at-prompt notification", () => {
    const a = new Agents();
    a.apply(ev("start"), 0);
    expect(a.apply(ev("notify", { message: "Claude is waiting for your input" }), 1000)).toBeNull();
    expect(a.lead(2000)?.state).toBe("working");
  });

  it("doesn't announce a stop it never saw start", () => {
    const a = new Agents();
    expect(a.apply(ev("stop"), 0)).toBeNull();
    expect(a.list(0)).toHaveLength(1);
  });

  it("drops finished sessions after ten minutes", () => {
    const a = new Agents();
    a.apply(ev("start"), 0);
    a.apply(ev("stop"), 1000);
    expect(a.list(5 * 60_000)).toHaveLength(1);
    expect(a.list(12 * 60_000)).toHaveLength(0);
  });

  it("a waiting session beats a newer working one", () => {
    const a = new Agents();
    a.apply(ev("start"), 0);
    a.apply(ev("notify", { message: "Approve?" }), 1000);
    a.apply(ev("start", { session: "s2", agent: "codex" }), 2000);
    expect(a.lead(3000)?.id).toBe("claude:s1");
  });
});

describe("format", () => {
  it("shortens token counts", () => {
    expect(tokens(950)).toBe("950");
    expect(tokens(12_400)).toBe("12K");
    expect(tokens(2_955_318)).toBe("3M");
    expect(tokens(1_250_000)).toBe("1.3M");
    expect(tokens(95_368_831)).toBe("95.4M");
    expect(tokens(1_250_000, "id")).toBe("1,3M");
  });

  it("shows running time", () => {
    expect(elapsed(187_000)).toBe("3:07");
    expect(elapsed(3_727_000)).toBe("1:02:07");
  });
});
