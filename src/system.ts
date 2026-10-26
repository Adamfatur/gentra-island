import { bytes, esc, gb, pct, rate } from "./format";
import { t, type Key } from "./i18n";
import { icon } from "./icons";

export interface Stats {
  memUsed: number;
  memTotal: number;
  swapUsed: number;
  pressure: 0 | 1 | 2;
  cpu: number;
  netRx: number;
  netTx: number;
  top: { name: string; mem: number }[];
}

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T;
const PRESSURE = [
  { color: "var(--ok)", label: "system.pressure.ok" as Key },
  { color: "var(--warn)", label: "system.pressure.tight" as Key },
  { color: "var(--bad)", label: "system.pressure.full" as Key },
];

const cpuHistory: number[] = Array(60).fill(0);
let lastLeft = "";
let lastRight = "";

/** What the right side of the compact island shows instead of CPU. */
export interface Badge {
  kind: "focus" | "call" | "media" | "agent" | "download";
  label: string;
  /** Focus paused, mic muted during a call, or media paused. */
  dim: boolean;
  /** Who the badge is about, for its tooltip. */
  title?: string;

}

const BADGE = {
  focus: { cls: "timer", on: () => icon.timer, off: () => icon.pause, title: ["compact.focusLeft", "compact.focusPaused"] as Key[] },
  call: { cls: "call", on: () => icon.mic, off: () => icon.micOff, title: ["compact.call", "compact.callMuted"] as Key[] },
  media: { cls: "media", on: () => "", off: () => "", title: ["compact.media", "compact.mediaPaused"] as Key[] },
  download: { cls: "download", on: () => icon.down, off: () => icon.down, title: ["compact.download", "compact.download"] as Key[] },
  // For agents, "dim" means it is waiting for you.
  agent: { cls: "agent", on: () => `<i class="pulse"></i>`, off: () => icon.hand, title: ["compact.agent", "compact.agentWaiting"] as Key[] },
};

let lastArt: string | null | undefined;

/**
 * The compact island: memory on the left, or the song's artwork while music
 * plays; CPU, a call, the focus timer, or the level meter on the right.
 * `art` is undefined when nothing plays, null for a song without artwork.
 */
export function renderCompact(s: Stats | null, timer: Badge | null, art?: string | null) {
  if (art !== lastArt) {
    lastArt = art;
    const side = $("#cArt");
    side.hidden = art === undefined;
    $("#cLeft").hidden = art !== undefined;
    side.innerHTML = art ? `<img class="mini-art" src="${esc(art)}" alt="">` : art === null ? icon.music : "";
  }
  if (s) {
    cpuHistory.push(s.cpu);
    cpuHistory.shift();
    const ram = Math.round((s.memUsed / s.memTotal) * 100);
    const left = `${ram}|${s.pressure}`;
    if (left !== lastLeft) {
      lastLeft = left;
      $("#cRam").textContent = pct(ram);
      const ring = $<SVGCircleElement>("#miniRing");
      ring.style.strokeDashoffset = String(47.1 * (1 - ram / 100));
      ring.style.stroke = PRESSURE[s.pressure].color;
    }
  }
  const right = timer ? `t|${timer.kind}|${timer.label}|${timer.dim}` : `c|${Math.round(s?.cpu ?? 0)}`;
  if (right === lastRight) return;
  const el = $("#cRight");
  const wasTimer = lastRight.startsWith("t");
  lastRight = right;
  if (timer) {
    const b = BADGE[timer.kind];
    el.className = `side ${b.cls}${timer.dim ? " dim" : ""}`;
    if (timer.kind === "media") {
      // A small level meter; the artwork sits on the left, the title in the tooltip.
      el.title = t(b.title[timer.dim ? 1 : 0], { title: timer.label });
      el.innerHTML = `<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
      return;
    }
    el.title = t(b.title[timer.dim ? 1 : 0], { agent: timer.title ?? "" });
    el.innerHTML = `${timer.dim ? b.off() : b.on()}<span class="num">${timer.label}</span>`;
    return;
  }
  el.className = "side";
  el.title = t("compact.cpu");
  if (wasTimer || !el.querySelector(".bars")) el.innerHTML = `<span class="bars"><i></i><i></i><i></i><i></i></span><span class="num" id="cCpu"></span>`;
  $("#cCpu").textContent = pct(s?.cpu ?? 0);
  const recent = cpuHistory.slice(-4);
  el.querySelectorAll<HTMLElement>(".bars i").forEach((b, i) => {
    b.style.height = `${Math.max(18, Math.min(100, recent[i]))}%`;
  });
}

let iconsPlaced = false;

export function renderSystem(s: Stats) {
  $("#sysReady").hidden = false;
  $("#sysWaiting").hidden = true;
  $("#sysError").hidden = true;
  if (!iconsPlaced) {
    $("#netRxIcon").innerHTML = icon.down;
    $("#netTxIcon").innerHTML = icon.up;
    iconsPlaced = true;
  }
  const ratio = s.memUsed / s.memTotal;
  const p = PRESSURE[s.pressure];
  const ring = $<SVGCircleElement>("#ramRing");
  ring.style.strokeDashoffset = String(314.16 * (1 - ratio));
  ring.style.stroke = p.color;
  $("#ramUsed").textContent = `${gb(s.memUsed)} GB`;
  $("#ramTotal").textContent = t("system.of", { total: gb(s.memTotal) });
  $("#pressure i").setAttribute("style", `background:${p.color}`);
  $("#pressure span").textContent = t(p.label);
  $("#swap").textContent = s.swapUsed ? t("system.swap.used", { size: bytes(s.swapUsed) }) : t("system.swap.none");

  $("#cpuNow").textContent = pct(s.cpu);
  const pts = cpuHistory.map((v, i) => `${((i / 59) * 240).toFixed(1)} ${(56 - (v / 100) * 50).toFixed(1)}`);
  const d = `M${pts.join(" L")}`;
  $("#sparkLine").setAttribute("d", d);
  $("#sparkArea").setAttribute("d", `${d} L240 56 L0 56Z`);
  $("#netRx").textContent = rate(s.netRx);
  $("#netTx").textContent = rate(s.netTx);

  if (s.top.length) {
    const max = s.top[0].mem;
    $("#procs").innerHTML = s.top
      .slice(0, 4)
      .map(
        (app) => `<li><span>${esc(app.name)}</span><span class="amt num">${bytes(app.mem)}</span>
        <span class="meter"><b style="width:${((app.mem / max) * 100).toFixed(1)}%"></b></span></li>`,
      )
      .join("");
  } else {
    $("#procs").innerHTML = `<li class="muted">${t("system.measuringApps")}</li>`;
  }
}

/** No stats for a while: say so instead of showing frozen numbers. */
export function renderSystemStalled() {
  $("#sysReady").hidden = true;
  $("#sysWaiting").hidden = true;
  $("#sysError").hidden = false;
}
