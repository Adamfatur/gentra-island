// What Claude Code and Codex are doing, from their hooks. Pure state: the
// island feeds events in and reads back sessions and what to announce.

export type AgentId = "claude" | "codex";
export type AgentState = "working" | "waiting" | "done";

export interface AgentEvent {
  agent: AgentId;
  event: "start" | "notify" | "stop";
  place: string;
  message: string;
  session: string;
}

/** A permission request the island can answer. */
export interface Ask {
  id: string;
  agent: AgentId;
  place: string;
  session: string;
  tool: string;
  summary: string;
}

/** What the agent wants to do, in words: the i18n key for the peek title. */
export function askVerb(tool: string): "ask.run" | "ask.edit" | "ask.read" | "ask.web" | "ask.use" {
  if (tool === "Bash") return "ask.run";
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) return "ask.edit";
  if (["Read", "Glob", "Grep"].includes(tool)) return "ask.read";
  if (["WebFetch", "WebSearch"].includes(tool)) return "ask.web";
  return "ask.use";
}

export interface Session {
  id: string;
  agent: AgentId;
  place: string;
  state: AgentState;
  /** When the current task started. */
  started: number;
  /** When the state last changed. */
  at: number;
  message: string;
}

/** What the island should say about an event, if anything. */
export type Notice = { kind: "waiting"; session: Session } | { kind: "done"; session: Session; secs: number } | null;

export const AGENT_NAME: Record<AgentId, string> = { claude: "Claude Code", codex: "Codex" };

/** Short tasks finish before you've looked away; only longer ones get a "done" peek. */
export const DONE_PEEK_SECS = 15;
/** A finished session stays listed this long, then drops off. */
const KEEP_DONE_MS = 10 * 60_000;
/** A session that says nothing for this long probably died without a Stop. */
const STALE_MS = 3 * 3600_000;

export class Agents {
  private map = new Map<string, Session>();

  apply(e: AgentEvent, now = Date.now()): Notice {
    const key = `${e.agent}:${e.session || e.place}`;
    const prev = this.map.get(key);
    if (e.event === "start") {
      this.map.set(key, { id: key, agent: e.agent, place: e.place || prev?.place || "", state: "working", started: now, at: now, message: "" });
      return null;
    }
    const base: Session = prev ?? { id: key, agent: e.agent, place: e.place, state: "working", started: now, at: now, message: "" };
    if (e.event === "notify") {
      // Claude also notifies after a minute idle at the prompt; that's not a question.
      if (base.state === "done" || /waiting for your input/i.test(e.message)) return null;
      const s = { ...base, place: e.place || base.place, state: "waiting" as const, at: now, message: e.message };
      this.map.set(key, s);
      return { kind: "waiting", session: s };
    }
    const s = { ...base, place: e.place || base.place, state: "done" as const, at: now, message: "" };
    this.map.set(key, s);
    // Without a start we don't know how long it ran, so it isn't announced.
    if (!prev || prev.state === "done") return null;
    const secs = Math.round((now - prev.started) / 1000);
    return { kind: "done", session: s, secs };
  }

  /** Newest first, with finished and silent sessions dropped once they're old. */
  list(now = Date.now()): Session[] {
    for (const [k, s] of this.map) {
      if ((s.state === "done" && now - s.at > KEEP_DONE_MS) || now - s.at > STALE_MS) this.map.delete(k);
    }
    return [...this.map.values()].sort((a, b) => b.at - a.at);
  }

  /** The one session the compact island should show: waiting beats working. */
  lead(now = Date.now()): Session | null {
    const all = this.list(now);
    return all.find((s) => s.state === "waiting") ?? all.find((s) => s.state === "working") ?? null;
  }

  dismiss(id: string) {
    const s = this.map.get(id);
    if (s?.state === "waiting") this.map.set(id, { ...s, state: "working", at: Date.now(), message: "" });
  }
}

/** "1.2M", "340K", "950": token counts read at a glance. */
export function tokens(n: number, locale = "en"): string {
  const f = (x: number, digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(x);
  if (n >= 1e9) return `${f(n / 1e9, 1)}B`;
  if (n >= 1e6) return `${f(n / 1e6, n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${f(n / 1e3, 0)}K`;
  return f(n, 0);
}

/** "3:07" or "1:02:07" since a task started. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
