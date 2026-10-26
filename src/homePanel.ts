import type { AgentStatus } from "./aiPanel";
import { sessionLine, sessionTitle } from "./aiPanel";
import { AGENT_NAME, tokens, type Session } from "./agents";
import type { Mic } from "./callPanel";
import { callTime } from "./callPanel";
import type { ClipItem } from "./clipboard";
import { esc, pct } from "./format";
import { lang, t } from "./i18n";
import { icon } from "./icons";
import type { NowPlaying } from "./mediaPanel";
import type { FeatureId } from "./modes";
import type { Reminder } from "./reminders";
import type { Stats } from "./system";
import { whenLabel } from "./format";

/** What Home reads from the rest of the island, and what it can ask it to do. */
export interface HomeSource {
  on: (f: FeatureId) => boolean;
  stats: () => Stats | null;
  media: () => NowPlaying | null;
  mic: () => Mic | null;
  focus: () => { running: boolean; label: string; paused: boolean };
  latestClip: () => ClipItem | null;
  shelfCount: () => number;
  reminders: () => Reminder[];
  agents: () => Session[];
  agentStatus: () => AgentStatus[];
  go: (tab: string) => void;
  act: (action: string) => void;
}

/**
 * Home: the first thing you see when the island opens. One small card per
 * feature that is switched on, with the live thing (a call, a song) first.
 * Every card opens its tab; buttons inside do the common action in place.
 */
export class HomePanel {
  private root = document.getElementById("homePanel")!;
  private tick = 0;

  constructor(private src: HomeSource) {
    this.root.addEventListener("click", (e) => {
      const el = e.target as HTMLElement;
      const act = el.closest<HTMLElement>("[data-act]");
      if (act) return this.src.act(act.dataset.act!);
      const card = el.closest<HTMLElement>("[data-go]");
      if (card) this.src.go(card.dataset.go!);
    });
  }

  get visible() {
    return this.tick !== 0;
  }

  show() {
    this.render();
    window.clearInterval(this.tick);
    // Only clocks move: the focus countdown and the call time.
    this.tick = window.setInterval(() => this.live(), 1000);
  }

  hide() {
    window.clearInterval(this.tick);
    this.tick = 0;
  }

  /** Redraws if open; called when anything Home shows has changed. */
  refresh() {
    if (this.visible) this.render();
  }

  /** Memory and CPU change every couple of seconds; touch only their text. */
  stats() {
    if (!this.visible) return;
    const s = this.src.stats();
    const mem = this.root.querySelector<HTMLElement>("[data-live=mem]");
    if (!s || !mem) return;
    const ram = Math.round((s.memUsed / s.memTotal) * 100);
    mem.textContent = pct(ram);
    this.root.querySelector<HTMLElement>(".home-meter i")?.style.setProperty("width", `${ram}%`);
    const cpu = this.root.querySelector("[data-live=cpu]");
    if (cpu) cpu.textContent = pct(s.cpu);
  }

  private live() {
    const f = this.src.focus();
    const focus = this.root.querySelector("[data-live=focus]");
    if (focus && f.running) focus.textContent = f.label;
    const m = this.src.mic();
    const call = this.root.querySelector("[data-live=call]");
    if (call && m?.inUse) call.textContent = callTime(m);
    const agent = this.root.querySelector("[data-live=agent]");
    const lead = this.src.agents()[0];
    if (agent && lead?.state === "working") agent.textContent = sessionLine(lead);
  }

  render() {
    const cards = [this.callCard(), this.agentCard(), this.remindCard(), this.mediaCard(), this.systemCard(), this.focusCard(), this.clipCard(), this.shelfCard()].filter(Boolean);
    this.root.innerHTML = cards.length
      ? `<div class="home">${cards.join("")}</div>`
      : `<div class="state"><b>${t("home.empty.title")}</b><span>${t("home.empty.body")}</span></div>`;
  }

  /** Upcoming reminders; one that is due now carries Copy and Done. */
  private remindCard() {
    if (!this.src.on("ingat")) return "";
    const list = this.src.reminders();
    if (!list.length) return "";
    const rows = list
      .slice(0, 2)
      .map((r) => {
        const when = r.fired ? t("home.remind.now") : whenLabel(new Date(r.at));
        const acts = r.fired
          ? `<button class="pill text" data-act="rem:copy:${r.id}">${icon.copy}<span>${t("due.copy")}</span></button><button class="pill text" data-act="rem:done:${r.id}">${t("due.done")}</button>`
          : `<button class="pill" data-act="rem:del:${r.id}" aria-label="${t("home.remind.remove")}">${icon.x}</button>`;
        return `<li class="${r.fired ? "due" : ""}"><span class="card-text"><b>${esc(r.text)}</b><span>${esc(when)}</span></span>${acts}</li>`;
      })
      .join("");
    const more = list.length > 2 ? `<span class="card-sub">${t("home.remind.more", { count: list.length - 2 })}</span>` : "";
    return `<section class="card-v wide remind-card">
      <span class="card-label">${icon.bell}${t("home.remind")}</span>
      <ul class="remind-list">${rows}</ul>${more}
    </section>`;
  }

  /** A live agent session, or what the agents have used. */
  private agentCard() {
    if (!this.src.on("ai")) return "";
    const live = this.src.agents().filter((s) => s.state !== "done");
    const s = live.find((x) => x.state === "waiting") ?? live[0];
    if (s) {
      const waiting = s.state === "waiting";
      return `<section class="card-h wide live-agent ${waiting ? "waiting" : ""}" data-go="ai">
        <span class="card-ic ${waiting ? "warn" : "ok"}">${waiting ? icon.hand : `<i class="pulse"></i>`}</span>
        <span class="card-text"><b>${esc(sessionTitle(s))}</b><span data-live="agent">${esc(sessionLine(s))}</span></span>
        ${live.length > 1 ? `<span class="card-sub">${t("home.remind.more", { count: live.length - 1 })}</span>` : ""}
      </section>`;
    }
    const connected = this.src.agentStatus().filter((a) => a.connected || a.usage.weekTokens);
    const line = connected
      .map((a) => {
        const p = a.usage.primary;
        const used = p ? pct(p.usedPercent) : tokens(a.usage.windowTokens, lang());
        return `<span class="card-sub">${esc(AGENT_NAME[a.agent])} <span class="num">${used}</span></span>`;
      })
      .join("");
    return `<section class="card-v" data-go="ai">
      <span class="card-label">${icon.robot}${t("home.ai")}</span>
      ${line ? `<span class="card-sub">${t("ai.usage.window")}</span>${line}` : `<span class="card-sub">${t("home.ai.connect")}</span>`}
    </section>`;
  }

  private callCard() {
    const m = this.src.mic();
    if (!this.src.on("meeting") || !m?.inUse) return "";
    const title = m.app ? t("call.mic.app", { app: m.app }) : t("call.mic.some");
    const mute =
      m.muted === null
        ? ""
        : `<button class="pill ${m.muted ? "on" : ""}" data-act="call:mute" aria-label="${t(m.muted ? "call.unmute" : "call.mute")}">${m.muted ? icon.micOff : icon.mic}</button>`;
    return `<section class="card-h wide live-call" data-go="call">
      <span class="card-ic ok">${m.muted ? icon.micOff : icon.mic}</span>
      <span class="card-text"><b>${esc(title)}</b><span class="num" data-live="call">${callTime(m)}</span></span>
      ${mute}
    </section>`;
  }

  private mediaCard() {
    if (!this.src.on("musik")) return "";
    const n = this.src.media();
    if (!n) {
      return `<section class="card-h wide" data-go="media">
        <span class="card-art blank">${icon.music}</span>
        <span class="card-text"><b>${t("home.media.none")}</b><span>${t("home.media.noneBody")}</span></span>
      </section>`;
    }
    const art = n.art ? `<img class="card-art" src="${esc(n.art)}" alt="">` : `<span class="card-art blank">${icon.music}</span>`;
    return `<section class="card-h wide ${n.playing ? "" : "paused"}" data-go="media">
      ${art}
      <span class="card-text"><b>${esc(n.title)}</b><span>${esc(n.artist || n.app)}</span></span>
      <span class="card-buttons">
        <button class="pill" data-act="media:toggle" aria-label="${t(n.playing ? "media.pause" : "media.play")}">${n.playing ? icon.pause : icon.play}</button>
        <button class="pill" data-act="media:next" aria-label="${t("media.next")}">${icon.next}</button>
      </span>
    </section>`;
  }

  private systemCard() {
    if (!this.src.on("sistem")) return "";
    const s = this.src.stats();
    const ram = s ? Math.round((s.memUsed / s.memTotal) * 100) : 0;
    return `<section class="card-v" data-go="system">
      <span class="card-label">${icon.memory}${t("home.memory")}</span>
      <b class="card-big num" data-live="mem">${s ? pct(ram) : "–"}</b>
      <span class="home-meter"><i style="width:${ram}%"></i></span>
      <span class="card-sub">${t("home.cpu")} <span class="num" data-live="cpu">${s ? pct(s.cpu) : "–"}</span></span>
    </section>`;
  }

  private focusCard() {
    if (!this.src.on("fokus")) return "";
    const f = this.src.focus();
    if (f.running) {
      return `<section class="card-v" data-go="focus">
        <span class="card-label">${icon.timer}${t("home.focus")}</span>
        <b class="card-big num" data-live="focus">${f.label}</b>
        <span class="card-sub">${t(f.paused ? "compact.focusPaused" : "home.focus.running")}</span>
      </section>`;
    }
    return `<section class="card-v" data-go="focus">
      <span class="card-label">${icon.timer}${t("home.focus")}</span>
      <span class="card-sub">${t("home.focus.idle")}</span>
      <button class="pill text" data-act="focus:25">${icon.play}<span>${t("home.focus.start", { minutes: 25 })}</span></button>
    </section>`;
  }

  private clipCard() {
    if (!this.src.on("clip")) return "";
    const c = this.src.latestClip();
    const preview = !c
      ? `<span class="card-sub">${t("home.clip.none")}</span>`
      : c.kind === "image"
        ? `<span class="card-sub">${t("home.clip.image")}</span>`
        : `<span class="card-quote">${esc((c.text ?? "").slice(0, 120))}</span>`;
    return `<section class="card-v" data-go="clipboard">
      <span class="card-label">${icon.clipboard}${t("home.clip")}</span>
      ${preview}
      ${c && !c.secret ? `<button class="pill text" data-act="clip:again">${icon.copy}<span>${t("home.clip.again")}</span></button>` : ""}
    </section>`;
  }

  private shelfCard() {
    if (!this.src.on("rak")) return "";
    const n = this.src.shelfCount();
    return `<section class="card-v" data-go="shelf">
      <span class="card-label">${icon.tray}${t("home.shelf")}</span>
      ${n ? `<b class="card-big num">${n}</b><span class="card-sub">${t("home.shelf.count", { count: n })}</span>` : `<span class="card-sub">${t("home.shelf.empty")}</span>`}
    </section>`;
  }
}
