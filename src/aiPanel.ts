import { invoke } from "@tauri-apps/api/core";
import { AGENT_NAME, askVerb, elapsed, tokens, type AgentId, type Agents, type Ask, type Session } from "./agents";
import { esc, pct, took, whenLabel } from "./format";
import { errorText, lang, t } from "./i18n";
import { agentLogo } from "./agentLogos";
import { icon } from "./icons";

export interface Limit {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
}

export interface Usage {
  windowTokens: number;
  windowStart: number | null;
  windowEnd: number | null;
  todayTokens: number;
  weekTokens: number;
  lastActive: number | null;
  primary: Limit | null;
  secondary: Limit | null;
}

export interface AgentStatus {
  agent: AgentId;
  installed: boolean;
  canAsk: boolean;
  connected: boolean;
  usage: Usage;
}

const FILE: Record<AgentId, string> = { claude: "~/.claude/settings.json", codex: "~/.codex/hooks.json" };

/** "today at 2:00 PM", "Friday at 9:00 AM". */
export const resetLabel = (ms: number) => t("ai.usage.resets", { time: whenLabel(new Date(ms)) });
const level = (p: number) => (p >= 90 ? "var(--bad)" : p >= 75 ? "var(--warn)" : "var(--ok)");

/** Allow, Deny, and In terminal, for the peek and the AI tab alike. */
export const askButtons = (id: string) =>
  `<div class="peek-acts ask-acts"><button class="primary" data-act="answer" data-answer="allow" data-id="${esc(id)}">${t("ask.allow")}</button>
    <button data-act="answer" data-answer="deny" data-id="${esc(id)}">${t("ask.deny")}</button>
    <button data-act="answer" data-answer="terminal" data-id="${esc(id)}">${t("ask.terminal")}</button></div>`;

export function sessionLine(s: Session, now = Date.now()): string {
  if (s.state === "waiting") return s.message || t("ai.waiting");
  if (s.state === "done") return t("ai.doneIn", { time: took((s.at - s.started) / 1000) });
  return t("ai.working", { time: elapsed(now - s.started) });
}

export const sessionTitle = (s: Session) => (s.place ? t("ai.in", { agent: AGENT_NAME[s.agent], place: s.place }) : AGENT_NAME[s.agent]);

/** AI tab: what the agents are doing now, how much they've used, and connecting them. */
export class AiPanel {
  private root = document.getElementById("aiPanel")!;
  private status: AgentStatus[] = [];
  private confirm: AgentId | null = null;
  private justConnected: AgentId | null = null;
  private tick = 0;
  /** Permission requests waiting for an answer, newest last. */
  asks: Ask[] = [];
  askOn = true;

  constructor(
    private agents: Agents,
    private toast: (msg: string) => void,
    private answer: (id: string, answer: string) => void,
    private setAskOn: (on: boolean) => void,
  ) {
    this.root.addEventListener("click", (e) => void this.click(e));
  }

  get visible() {
    return this.tick !== 0;
  }

  async show() {
    window.clearInterval(this.tick);
    // Only running clocks move; usage arrives as events.
    this.tick = window.setInterval(() => this.live(), 1000);
    this.render();
    this.setStatus(await invoke<AgentStatus[]>("agents_status").catch(() => this.status));
  }

  hide() {
    window.clearInterval(this.tick);
    this.tick = 0;
    this.confirm = null;
  }

  setStatus(list: AgentStatus[]) {
    this.status = list;
    if (this.visible) this.render();
  }

  usage(agent: AgentId) {
    return this.status.find((s) => s.agent === agent);
  }

  refresh() {
    if (this.visible) this.render();
  }

  private live() {
    const now = Date.now();
    for (const s of this.agents.list(now)) {
      const el = this.root.querySelector(`[data-session="${CSS.escape(s.id)}"] .h`);
      if (el && s.state === "working") el.textContent = sessionLine(s, now);
    }
  }

  private async click(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!b) return;
    const agent = b.dataset.agent as AgentId;
    try {
      switch (b.dataset.act) {
        case "ask":
          this.confirm = agent;
          break;
        case "cancel":
          this.confirm = null;
          break;
        case "connect":
          await invoke("agents_connect", { agent });
          this.confirm = null;
          this.justConnected = agent;
          this.toast(t("ai.connected.toast", { agent: AGENT_NAME[agent] }));
          break;
        case "answer":
          return this.answer(b.dataset.id!, b.dataset.answer!);
        case "ask-switch":
          this.setAskOn(!this.askOn);
          break;
        case "disconnect":
          await invoke("agents_disconnect", { agent });
          this.justConnected = null;
          this.toast(t("ai.disconnected.toast", { agent: AGENT_NAME[agent] }));
          break;
      }
      if (b.dataset.act === "connect" || b.dataset.act === "disconnect") {
        this.status = await invoke<AgentStatus[]>("agents_status").catch(() => this.status);
      }
    } catch (err) {
      this.toast(errorText(err));
    }
    this.render();
  }

  render() {
    const sessions = this.agents.list();
    const now = this.asksHtml() + (sessions.length ? this.sessionsHtml(sessions) : "");
    const cards = (["claude", "codex"] as AgentId[]).map((a) => this.agentHtml(a)).join("");
    this.root.innerHTML = `<div class="ai">${now}${cards}</div>`;
  }

  /** Requests stay here too, in case another message covered the peek. */
  private asksHtml() {
    if (!this.asks.length) return "";
    return this.asks
      .map(
        (a) => `<section class="ask-card"><span class="card-label">${agentLogo(a.agent)}${esc(t(askVerb(a.tool), { agent: AGENT_NAME[a.agent] }))}</span>
          ${a.place ? `<span class="card-sub">${esc(a.place)}</span>` : ""}
          <code class="ask-code">${esc(a.summary || a.tool)}</code>
          ${askButtons(a.id)}</section>`,
      )
      .join("");
  }

  private sessionsHtml(list: Session[]) {
    const rows = list
      .slice(0, 4)
      .map((s) => {
        const ic = s.state === "waiting" ? icon.hand : s.state === "done" ? icon.ok : `<i class="pulse"></i>`;
        return `<li class="agent-row ${s.state}" data-session="${esc(s.id)}">
          ${agentLogo(s.agent)}
          <span class="done-ic">${ic}</span>
          <span class="server-text"><span class="n">${esc(sessionTitle(s))}</span><span class="h">${esc(sessionLine(s))}</span></span>
        </li>`;
      })
      .join("");
    return `<section><div class="dev-head"><h3>${icon.robot}${t("ai.now")}</h3></div><ul class="dones">${rows}</ul></section>`;
  }

  private agentHtml(agent: AgentId) {
    const st = this.usage(agent);
    const name = AGENT_NAME[agent];
    const head = (right: string, sub: string) =>
      `<div class="agent-head">${agentLogo(agent)}<span class="card-text"><b>${name}</b><span>${sub}</span></span>${right}</div>`;
    if (st && !st.installed) {
      return `<section class="agent-card off">${head("", t("ai.missing"))}</section>`;
    }
    if (this.confirm === agent) {
      return `<section class="agent-card">${head("", esc(FILE[agent]))}
        <div class="hook-setup">
          <b>${t("ai.confirm.title", { agent: name })}</b>
          <p class="muted">${esc(t(agent === "claude" ? "ai.confirm.claude" : "ai.confirm.codex", { file: FILE[agent] }))}</p>
          <p class="muted">${t("ai.confirm.safe")}</p>
          <div class="agent-acts"><button class="primary" data-act="connect" data-agent="${agent}">${icon.plug}<span>${t("ai.connect")}</span></button>
            <button data-act="cancel" data-agent="${agent}">${t("ai.cancel")}</button></div>
        </div></section>`;
    }
    const connected = !!st?.connected;
    const button = connected
      ? `<button class="agent-btn" data-act="disconnect" data-agent="${agent}">${t("ai.disconnect")}</button>`
      : `<button class="agent-btn primary" data-act="ask" data-agent="${agent}">${icon.plug}<span>${t("ai.connect")}</span></button>`;
    const sub = connected ? t("ai.state.on") : t("ai.state.off");
    const fresh = this.justConnected === agent && connected ? `<p class="note">${t("ai.connected.note", { agent: name })}</p>` : "";
    // Claude Code's permission requests: a switch once connected, or a way to add it.
    const asks =
      agent !== "claude" || !connected
        ? ""
        : st?.canAsk
          ? `<div class="setting-row ask-row"><span>${t("ask.switch")}<small>${t("ask.switch.note")}</small></span><button class="switch" role="switch" data-act="ask-switch" data-agent="claude" aria-checked="${this.askOn}" aria-label="${t("ask.switch")}"></button></div>`
          : `<div class="ask-row"><p class="note">${t("ask.reconnect")}</p><button class="agent-btn" data-act="connect" data-agent="claude">${t("ask.reconnect.button")}</button></div>`;
    return `<section class="agent-card">${head(button, sub)}${st ? this.usageHtml(agent, st.usage) : ""}${asks}${fresh}</section>`;
  }

  private usageHtml(agent: AgentId, u: Usage) {
    const loc = lang();
    const bars = [u.primary && this.bar(t("ai.limit.window"), u.primary), u.secondary && this.bar(t("ai.limit.week"), u.secondary)].filter(Boolean);
    if (bars.length) return `<div class="agent-bars">${bars.join("")}</div>`;
    if (!u.weekTokens) return `<p class="muted agent-empty">${t("ai.usage.none")}</p>`;
    // No reset time here: the agent doesn't say when its limit resets, and a guess would mislead.
    const window = u.windowEnd
      ? `<div class="agent-stat"><span class="card-label">${t("ai.usage.window")}</span><b class="num">${tokens(u.windowTokens, loc)}</b><span class="card-sub">${t("ai.usage.tokens")}</span></div>`
      : `<div class="agent-stat"><span class="card-label">${t("ai.usage.window")}</span><b class="num">0</b><span class="card-sub">${t("ai.usage.idle")}</span></div>`;
    const why = agent === "claude" ? `<p class="note">${t("ai.usage.claudeNote")}</p>` : "";
    return `<div class="agent-stats">${window}
      <div class="agent-stat"><span class="card-label">${t("ai.usage.today")}</span><b class="num">${tokens(u.todayTokens, loc)}</b><span class="card-sub">${t("ai.usage.tokens")}</span></div>
      <div class="agent-stat"><span class="card-label">${t("ai.usage.week")}</span><b class="num">${tokens(u.weekTokens, loc)}</b><span class="card-sub">${t("ai.usage.tokens")}</span></div>
    </div>${why}`;
  }

  private bar(label: string, l: Limit) {
    const p = Math.max(0, Math.min(100, l.usedPercent));
    const reset = l.resetsAt ? resetLabel(l.resetsAt) : "";
    return `<div class="agent-bar"><div class="agent-bar-top"><span>${label}</span><b class="num">${pct(p)}</b></div>
      <span class="home-meter"><i style="width:${p}%;background:${level(p)}"></i></span><span class="card-sub">${reset}</span></div>`;
  }
}
