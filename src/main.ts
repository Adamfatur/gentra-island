// Gentra Island, created by Adam Faturahman.
// SPDX-License-Identifier: GPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AiPanel, askButtons, resetLabel, sessionTitle, type AgentStatus } from "./aiPanel";
import { AGENT_NAME, Agents, DONE_PEEK_SECS, askVerb, elapsed, type AgentEvent, type Ask } from "./agents";
import { CallPanel, callTime, type Mic } from "./callPanel";
import { Care, careHtml } from "./carePanel";
import type { CareKind } from "./care";
import { CleanerPanel } from "./cleaner";
import { DevPanel, doneMeta, doneTitle, type Done } from "./devPanel";
import { MediaPanel, sameTrack, type NowPlaying } from "./mediaPanel";
import { ClipboardPanel, ICON, remindable, secondsLeft, secretName, setSmart, smart, type ClipItem } from "./clipboard";
import { FocusPanel, chime } from "./focusPanel";
import { bytes, esc, pct, took, whenLabel } from "./format";
import { APP_AUTHOR, errorText, initLanguage, lang, onLanguageChange, t, type Key } from "./i18n";
import { icon } from "./icons";
import { GuidePanel, savedGuide } from "./guidePanel";
import { HomePanel } from "./homePanel";
import { ModePanel, modeIcon, modeName } from "./modePanel";
import { needsGuide } from "./onboarding";
import { Reminders, type Reminder } from "./reminders";
import { findTime } from "./timeparse";
import { isOn, type FeatureId, type ModeState } from "./modes";
import { SettingsPanel } from "./settings";
import { ShelfPanel } from "./shelf";
import { compactLook, compactWidth, type Look } from "./islandSize";
import { Morph, type Feel, type Size } from "./spring";
import { renderCompact, renderSystem, renderSystemStalled, type Badge, type Stats } from "./system";

interface ScreenInfo {
  platform: "macos" | "windows" | "linux";
  notchWidth: number;
  notchHeight: number;
  menubarHeight: number;
}

type Mode = "compact" | "peek" | "open";
type Tab = "home" | "system" | "clipboard" | "shelf" | "focus" | "cleaner" | "dev" | "call" | "media" | "ai" | "settings" | "mode" | "guide";

/** Each tab belongs to features; a mode that switches all of them off hides the tab. */
const TAB_FEATURE: Partial<Record<Tab, FeatureId[]>> = {
  system: ["sistem"],
  clipboard: ["clip"],
  shelf: ["rak"],
  focus: ["fokus"],
  cleaner: ["bersih"],
  dev: ["port", "perintah"],
  call: ["meeting", "kamera"],
  media: ["musik"],
  ai: ["ai"],
};
const tabOn = (s: ModeState, t: Tab) => !TAB_FEATURE[t] || TAB_FEATURE[t]!.some((f) => isOn(s, f));

const WIN_W = 760;
const OPEN_W = 640;
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const shell = $("#shell");
const island = $("#island");
const root = document.documentElement;

// Language first: everything below renders text.
initLanguage();
const syncTray = () =>
  void invoke("set_tray_labels", {
    about: t("tray.about", { version: __APP_VERSION__, author: APP_AUTHOR }),
    open: t("tray.open"),
    quit: t("tray.quit"),
  });
syncTray();

const settings = new SettingsPanel();

const info = await invoke<ScreenInfo>("screen_info");
const hasNotch = info.notchWidth > 0;
const mac = info.platform === "macos";
// On a Mac the island grows out of the top edge; elsewhere it floats.
const attached = mac;
const TOP = attached ? 0 : 8;
const CH = hasNotch ? Math.round(info.notchHeight) : attached ? Math.max(28, Math.round(info.menubarHeight)) : 34;
// With a notch, the compact island is the notch plus a shoulder either side.
const CW = hasNotch ? Math.round(info.notchWidth) + 2 * 74 : 196;
const R_COMPACT = attached ? 10 : CH / 2;
const R_OPEN = 30;
const MOD = mac ? "⌘" : "Ctrl+";

root.style.setProperty("--top", `${TOP}px`);
root.style.setProperty("--ch", `${CH}px`);
root.style.setProperty("--cw", `${CW}px`);
// Content in the open island starts below the camera housing.
root.style.setProperty("--notch-pad", hasNotch ? `${CH - 6}px` : "0px");
document.body.classList.toggle("floating", !attached);
document.body.classList.toggle("notched", hasNotch);

const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
const visibleTabs = () => tabs.filter((b) => !b.hidden);
$("#settingsBtn").innerHTML = icon.gear;
$("#searchIcon").innerHTML = icon.search;

/** Files the browser is still downloading; declared early: badge() runs during start-up. */
interface Download {
  name: string;
  bytes: number;
  total: number | null;
  speed: number;
}
let downloads: Download[] = [];
let mode: Mode = "compact";
let tab: Tab = "home";
let hovering = false;
let openedByShortcut = false;
let peekTimer = 0;
let leaveTimer = 0;

/* ---------- geometry ---------- */

const radius = (r: number) => (attached ? `0 0 ${r}px ${r}px` : `${r}px`);
const morph = new Morph(
  { w: CW, h: CH, r: R_COMPACT },
  ({ w, h, r }) => {
    shell.style.width = `${w}px`;
    shell.style.height = `${h}px`;
    island.style.borderRadius = radius(Math.max(0, r));
  },
  (s) => reportHit(s),
);

/** Tells Rust where the island is so the rest of the window stays click-through. */
function reportHit(s: Size, target?: Size) {
  const w = Math.max(s.w, target?.w ?? 0);
  const h = Math.max(s.h, target?.h ?? 0);
  // A few extra pixels around the compact pill make the notch easy to hit.
  const pad = mode === "compact" ? 6 : 0;
  void invoke("set_hit_rect", {
    rect: { x: (WIN_W - w) / 2 - pad, y: TOP > 0 ? TOP - pad : 0, w: w + pad * 2, h: h + pad + (TOP > 0 ? pad : 0) },
  });
}

function go(target: Size, feel: Feel) {
  reportHit(morph.current, target);
  morph.to(target, feel);
}

function show(id: string) {
  document.querySelectorAll("#island > .v").forEach((v) => v.classList.toggle("on", v.id === id));
}

function openSize(): Size {
  const panel = $(`.panel[data-panel="${tab}"]`);
  const pad = hasNotch ? CH - 6 : 0;
  return { w: OPEN_W, h: pad + 10 + 32 + 12 + panel.offsetHeight + 14, r: R_OPEN };
}

/* ---------- modes ---------- */

let look: Look | null = null;

/**
 * The closed island's width follows Settings, what is live, and the pointer.
 * The row inside is laid out at the same width, so its sides sit at the edges.
 */
function compactSize(): Size {
  const live = !!badge() || playingArt() !== undefined;
  const next = compactLook(settings.settings.islandSize, { hasNotch, live, hovering });
  // A running timer needs a little more room on the right.
  const extra = next === "full" && badge() ? 24 : 0;
  const w = compactWidth(next, { hasNotch, notchW: Math.round(info.notchWidth) }) + extra;
  if (next !== look) {
    look = next;
    document.body.dataset.look = next;
    root.style.setProperty("--cw", `${w - extra}px`);
  }
  return { w, h: CH + (hovering ? 3 : 0), r: R_COMPACT };
}

function compact() {
  clearTimeout(peekTimer);
  dev.hide();
  call.hide();
  media.hide();
  home.hide();
  ai.hide();
  mode = "compact";
  openedByShortcut = false;
  shell.classList.remove("open");
  show("v-compact");
  void invoke("set_stats_detail", { on: false });
  go(compactSize(), "shrink");
}

/** The tab to show when `t` belongs to a feature the current mode switched off. */
function allowed(t: Tab): Tab {
  if (tabOn(modes.state, t)) return t;
  return (visibleTabs()[0]?.dataset.tab as Tab) ?? "mode";
}

function open(t: Tab = tab) {
  clearTimeout(peekTimer);
  mode = "open";
  shell.classList.add("open");
  show("v-exp");
  setTab(allowed(t));
}

function setTab(t: Tab, focusTab = false) {
  tab = t;
  const inSettings = t === "settings";
  tabs.forEach((b) => {
    const on = b.dataset.tab === t;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on || (inSettings && b === visibleTabs()[0]) ? 0 : -1;
    if (on && focusTab) b.focus();
  });
  $("#settingsBtn").setAttribute("aria-pressed", String(inSettings));
  $("#modeBtn").setAttribute("aria-pressed", String(t === "mode"));
  document.querySelectorAll<HTMLElement>(".panel").forEach((p) => p.classList.toggle("on", p.dataset.panel === t));
  const pill = $("#tabPill");
  const active = tabs.find((b) => b.dataset.tab === t);
  pill.style.opacity = active ? "1" : "0";
  if (active) {
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.translate = `${active.offsetLeft - 3}px 0`;
  }
  void invoke("set_stats_detail", { on: t === "system" });
  renderHeadMeta();
  if (t === "system" && lastStats) renderSystem(lastStats);
  if (t === "cleaner") {
    cleaner.render(); // redraw last results, e.g. after a language change
    cleaner.ensureScanned();
  }
  if (t === "dev") dev.show();
  else dev.hide();
  if (t === "call") call.show();
  else call.hide();
  if (t === "media") media.show();
  else media.hide();
  if (t === "home") home.show();
  else home.hide();
  if (t === "ai") void ai.show();
  else ai.hide();
  if (t === "shelf") shelf.render();
  if (t === "focus") focus.render();
  if (t === "settings") settings.render();
  if (t === "mode") modes.render();
  if (t === "guide") guide.render();
  go(openSize(), "grow");
}

let clearArmed = 0;
function renderHeadMeta() {
  // Lives in the clipboard's filter row, so the header never runs out of room.
  const meta = $("#clipClear");
  const armed = Date.now() - clearArmed < 3000;
  const label = t(armed ? "clip.clearConfirm" : "clip.clear");
  // An icon until it's armed; the confirmation spells out what will happen.
  meta.innerHTML = `<button id="clearBtn" class="${armed ? "danger" : ""}" aria-label="${label}" title="${label}">${icon.trash}${armed ? `<span>${label}</span>` : ""}</button>`;
  $("#clearBtn").addEventListener("click", async () => {
    // Clearing history cannot be undone, so it takes two clicks within 3 s.
    if (Date.now() - clearArmed > 3000) {
      clearArmed = Date.now();
      renderHeadMeta();
      window.setTimeout(renderHeadMeta, 3100);
      return;
    }
    clearArmed = 0;
    await clips.clear();
    setTab("clipboard");
  });
}

// Content can change height after opening (process list arrives, search
// filters cards); the island follows it instead of clipping.
const resize = new ResizeObserver(() => {
  if (mode === "open") go(openSize(), "grow");
});
document.querySelectorAll(".panel").forEach((p) => resize.observe(p));

/** A short-lived wider island that says what just happened, then tucks back. */
function peek(html: string, ms = 1800, wide = false) {
  if (mode === "open") return;
  mode = "peek";
  $("#v-peek").classList.toggle("wide", wide);
  $("#peekBody").innerHTML = html;
  show("v-peek");
  const body = $("#peekBody");
  go({ w: Math.max(CW + 40, wide ? 460 : 380), h: CH + body.offsetHeight, r: attached ? 22 : 24 }, "grow");
  clearTimeout(peekTimer);
  // A peek with buttons stays while the pointer is on it.
  const close = () => {
    if (mode !== "peek") return;
    if (hovering && body.querySelector("button")) peekTimer = window.setTimeout(close, 800);
    else compact();
  };
  peekTimer = window.setTimeout(close, ms);
}

const peekLine = (glyph: string, color: string, title: string, sub: string) =>
  `<span class="ic" style="color:${color}">${glyph}</span><div style="min-width:0"><div class="t">${title}</div><div class="s">${sub}</div></div>`;

/* ---------- toast ---------- */

let toastTimer = 0;
function toast(msg: string) {
  // The toast lives at the bottom of the open island; a closed island is too
  // small to show it, so the message gets a short peek of its own instead.
  if (mode !== "open") {
    peek(`<div class="peek-main note-peek"><div class="t">${esc(msg)}</div></div>`, 2200);
    return;
  }
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 1800);
}

/* ---------- panels ---------- */

/* ---------- reminders ---------- */

/** A copy with a time in it, waiting for "Remind me" in the peek. */
let offer: { text: string; app?: string; at: Date } | null = null;

const reminders = new Reminders(
  (r, late) => reminderDue(r, late),
  () => home.refresh(),
);

function reminderDue(r: Reminder, late: boolean) {
  chime();
  if (mode === "open") {
    toast(t("due.toast", { text: r.text.slice(0, 60) }));
    return;
  }
  const sub = late ? t("due.late", { when: whenLabel(new Date(r.at)) }) : r.app || t("due.title");
  peek(
    `<span class="ic" style="color:var(--warn)">${icon.bellRing}</span>
     <div class="peek-main"><div class="t clamp2">${esc(r.text)}</div><div class="s">${esc(sub)}</div>
       <div class="peek-acts" data-rem="${r.id}">
         <button data-rem-act="copy">${icon.copy}<span>${t("due.copy")}</span></button>
         <button data-rem-act="snooze">${t("due.snooze")}</button>
         <button class="primary" data-rem-act="done">${t("due.done")}</button>
       </div></div>`,
    20_000,
    true,
  );
}

async function reminderAct(id: string, act: string) {
  const r = reminders.get(id);
  if (!r) return;
  if (act === "copy") {
    await invoke("clip_write", { text: r.text }).catch(() => {});
    toast(t("clip.copied", { key: pasteKey }));
    reminders.remove(id);
  } else if (act === "snooze") {
    reminders.snooze(id, 10);
    toast(t("due.snoozed"));
  } else {
    reminders.remove(id);
  }
  if (mode === "peek") compact();
}

function remindAt(text: string, at: Date, app?: string) {
  reminders.add(text, at, app);
  toast(t("remind.saved", { when: whenLabel(at) }));
}

const pasteKey = mac ? "⌘V" : "Ctrl+V";
const clips = new ClipboardPanel(() => {
  toast(t("clip.copied", { key: pasteKey }));
  window.setTimeout(compact, 700);
}, toast, (item, at) => remindAt(item.text ?? "", at, item.app));
await clips.load();

const cleaner = new CleanerPanel();
const shelf = new ShelfPanel(info.platform, toast);
await shelf.load();

let focusWasRunning = false;
const focus = new FocusPanel(
  () => {
    renderCompact(lastStats, badge(), playingArt());
    if (mode === "compact") go(compactSize(), "hover");
    // Home redraws when a session starts or ends; the countdown ticks on its own.
    if (focus.running !== focusWasRunning) {
      focusWasRunning = focus.running;
      home.refresh();
    }
  },
  () => peek(peekLine(icon.timer, "var(--warn)", t("peek.focusDone.title"), t("peek.focusDone.body")), 5000),
);

const dev = new DevPanel(info.platform, toast);
const call = new CallPanel(toast, info.platform);
const agents = new Agents();
const ASK_KEY = "gentra:ask";
const ai = new AiPanel(
  agents,
  toast,
  (id, answer) => void answerAsk(id, answer),
  (on) => {
    ai.askOn = on;
    try {
      localStorage.setItem(ASK_KEY, on ? "1" : "0");
    } catch {
      /* this session only */
    }
    void invoke("agents_set_ask", { on });
    ai.refresh();
  },
);
try {
  ai.askOn = localStorage.getItem(ASK_KEY) !== "0";
} catch {
  /* on by default */
}
void invoke("agents_set_ask", { on: ai.askOn });

/** Sends your answer to a waiting permission request. */
async function answerAsk(id: string, answer: string) {
  try {
    await invoke("agents_answer", { id, answer });
    toast(t(answer === "allow" ? "ask.allowed" : answer === "deny" ? "ask.denied" : "ask.toTerminal"));
  } catch (err) {
    toast(errorText(err) === "ask_gone" ? t("ask.gone") : errorText(err));
  }
  ai.asks = ai.asks.filter((a) => a.id !== id);
  ai.refresh();
  if (mode === "peek" && $("#peekBody").querySelector(`[data-id="${CSS.escape(id)}"]`)) compact();
}
const media = new MediaPanel(toast, (tint) => {
  if (tint) root.style.setProperty("--media-tint", tint);
  else root.style.removeProperty("--media-tint");
});

// Newest by time, so a pinned old item doesn't hide what you just copied.
const newestClip = () => clips.items.reduce<ClipItem | null>((a, b) => (!a || b.created > a.created ? b : a), null);

const home = new HomePanel({
  on: (f) => isOn(modes.state, f),
  stats: () => lastStats,
  media: () => media.now,
  mic: () => call.mic,
  focus: () => ({ running: focus.running, label: focus.label, paused: focus.paused }),
  latestClip: () => newestClip(),
  shelfCount: () => shelf.items.length,
  reminders: () => reminders.upcoming,
  agents: () => agents.list(),
  agentStatus: () => [ai.usage("claude"), ai.usage("codex")].filter((s): s is AgentStatus => !!s),
  go: (t) => setTab(t as Tab),
  act: (a) => void homeAct(a),
});

async function homeAct(a: string) {
  try {
    if (a === "media:toggle" || a === "media:next") {
      await invoke("media_control", { action: a.slice(6) });
      if (a === "media:toggle" && media.now) media.set({ ...media.now, playing: !media.now.playing });
    } else if (a === "call:mute" && call.mic) {
      const muted = !call.mic.muted;
      await invoke("mic_set_muted", { muted });
      call.setMic({ ...call.mic, muted });
      toast(t(muted ? "call.muted" : "call.unmuted"));
    } else if (a.startsWith("rem:")) {
      const [, act, id] = a.split(":");
      if (act === "del") reminders.remove(id);
      else await reminderAct(id, act);
    } else if (a === "focus:25") {
      focus.begin(25);
    } else if (a === "clip:again") {
      const c = newestClip();
      if (c) await clips.copy(c.id);
    }
  } catch (err) {
    toast(errorText(err));
  }
  home.refresh();
}


/** A live call outranks the focus timer on the compact island. */
function badge(): Badge | null {
  const m = call.mic;
  if (m?.inUse) return { kind: "call", label: callTime(m), dim: !!m.muted };
  // An agent waiting on you outranks the timer; one that's just working doesn't.
  const lead = isOn(modes.state, "ai") ? agents.lead() : null;
  if (lead?.state === "waiting") return { kind: "agent", label: AGENT_NAME[lead.agent].split(" ")[0], dim: true, title: AGENT_NAME[lead.agent] };
  if (focus.running) return { kind: "focus", label: focus.label, dim: focus.paused };
  if (lead) return { kind: "agent", label: elapsed(Date.now() - lead.started), dim: false, title: AGENT_NAME[lead.agent] };
  const d = downloads[0];
  if (d) return { kind: "download", label: d.total ? pct((d.bytes / d.total) * 100) : bytes(d.bytes), dim: false, title: d.name };
  // Music only while it plays; a paused song gives the spot back to CPU.
  const n = media.now;
  if (n?.playing) return { kind: "media", label: n.title, dim: false };
  return null;
}

/** The song's artwork for the left of the compact island; undefined when nothing plays. */
const playingArt = () => (media.now?.playing ? media.now.art : undefined);

/* ---------- modes ---------- */

/** Fokus mode keeps the island quiet; only safety warnings still speak. */
const quiet = () => modes.state.mode === "fokus";

function applyMode(s: ModeState, announce = false) {
  // Switched-off features stop their background work, not just their UI.
  void invoke("set_features", { sistem: isOn(s, "sistem"), clip: isOn(s, "clip"), perintah: isOn(s, "perintah"), meeting: isOn(s, "meeting"), musik: isOn(s, "musik"), ai: isOn(s, "ai"), tangkap: isOn(s, "tangkap"), unduh: isOn(s, "unduh") });
  // "Today" in AI usage starts at local midnight.
  void invoke("agents_set_offset", { minutes: -new Date().getTimezoneOffset() });
  if (!isOn(s, "musik")) media.set(null); // the backend's empty "media" event then stops the meter
  dev.ports = isOn(s, "port");
  dev.alerts = isOn(s, "perintah");
  call.meeting = isOn(s, "meeting");
  call.mirror = isOn(s, "kamera");
  if (!call.meeting) call.mic = null;
  setSmart(isOn(s, "pintar"));
  clips.remindOn = isOn(s, "ingat");
  reminders.setEnabled(isOn(s, "ingat"));
  tabs.forEach((b) => {
    b.hidden = !tabOn(s, b.dataset.tab as Tab);
  });
  $("#tabs").classList.toggle("many", visibleTabs().length > 6);
  // With every feature on, the mode button keeps its icon and shows its name on hover.
  $("#v-exp .head").classList.toggle("crowded", visibleTabs().length > 7);
  document.body.classList.toggle("no-sistem", !isOn(s, "sistem"));
  document.body.classList.toggle("mode-ringkas", s.mode === "ringkas");
  if (!isOn(s, "fokus")) focus.stop();
  care.setEnabled(isOn(s, "jaga"));
  $("#modeBtn").innerHTML = `${modeIcon(s)}<span>${modeName(s)}</span>`;
  $("#modeBtn").title = modeName(s);
  clips.render();
  if (mode === "open") setTab(allowed(tab));
  else if (mode === "compact") go(compactSize(), "shrink");
  home.refresh();
  if (announce) toast(t("mode.on", { mode: modeName(s) }));
}

/** Care nudges wait while you're on a call, focusing, or using the island. */
const care = new Care(
  () => mode !== "compact" || !!call.mic?.inUse || focus.running || quiet() || agents.lead()?.state === "waiting",
  (html) => peek(html, 15_000, true),
);

// The preview harness shows each nudge on demand.
if (import.meta.env.DEV) Object.assign(window, { __care: (kind: CareKind, variant = 0) => peek(careHtml({ kind, activeMin: 62, variant }), 15_000, true) });

const modes = new ModePanel((s) => applyMode(s, true));
applyMode(modes.state);

/* ---------- first-run guide ---------- */

const guide = new GuidePanel(
  { notched: hasNotch, mac },
  () => modes.state.mode,
  (m) => modes.choose(m),
  (problem) => {
    if (problem) toast(problem);
    openedByShortcut = false;
    setTab(allowed("home"));
  },
);

function showGuide() {
  guide.restart();
  openedByShortcut = true; // stays open until the user finishes or skips
  open("guide");
}

settings.hooks = { toast, replayGuide: showGuide, resized: () => mode === "compact" && go(compactSize(), "hover") };

function describe(item: ClipItem) {
  if (item.secret) {
    const kind = secretName(item.secret);
    // Sentence-initial in the peek title, so capitalise the kind's first letter.
    const title = t("peek.secret.title", { kind: kind.charAt(0).toLocaleUpperCase(lang()) + kind.slice(1) });
    return peekLine(ICON.secret, "var(--bad)", esc(title), esc(t("peek.secret.body", { count: secondsLeft(item) })));
  }
  const insight = smart(item).insight;
  if (insight) return peekLine(ICON[item.kind], "var(--accent)", esc(t("peek.smartCopied", { label: insight.label })), esc(insight.summary));
  const glyph = item.kind === "image" && item.thumb ? `<img alt="" src="${item.thumb}">` : ICON[item.kind];
  const base = item.kind === "image" ? "peek.imageCopied" : item.kind === "link" ? "peek.linkCopied" : "peek.copied";
  const title = item.app ? t(`${base}From` as Key, { source: item.app }) : t(base);
  const detail =
    item.kind === "image" ? (item.size ? `${item.size[0]} × ${item.size[1]} px` : "") : esc((item.text ?? "").replace(/\s+/g, " "));
  return peekLine(glyph, "inherit", esc(title), detail);
}

let topId = clips.items[0]?.id;
await listen("clips-changed", async () => {
  const items = await clips.load();
  const top = items[0];
  const isNew = top && top.id !== topId;
  topId = top?.id;
  const fresh = isNew && Date.now() - top.created < 3000;
  // Text with a time in it ("rapat Jumat jam 14.00") gets a one-tap reminder offer.
  const when = fresh && !quiet() && isOn(modes.state, "ingat") && remindable(top) ? findTime(top.text ?? "") : null;
  if (when) {
    offer = { text: top.text ?? "", app: top.app, at: when };
    peek(
      `<span class="ic" style="color:var(--accent)">${icon.bell}</span>
       <div class="peek-main"><div class="t">${esc(t("offer.title", { when: whenLabel(when) }))}</div><div class="s clamp1">${esc(top.text ?? "")}</div>
         <div class="peek-acts"><button class="primary" data-offer="yes">${icon.bell}<span>${t("offer.yes")}</span></button>
           <button data-offer="no">${t("offer.no")}</button></div></div>`,
      8000,
      true,
    );
  } else if (fresh && (top.secret || !quiet())) peek(describe(top), top.secret ? 3500 : 2400);
  if (mode === "open" && tab === "clipboard") renderHeadMeta();
  home.refresh();
});

/* ---------- stats ---------- */

let warnedAt = 0;
let lastStats = await invoke<Stats | null>("stats_now");
let lastStatsAt = lastStats ? Date.now() : 0;
await listen<Stats>("stats", ({ payload }) => {
  lastStats = payload;
  lastStatsAt = Date.now();
  renderCompact(payload, badge(), playingArt());
  if (mode === "open" && tab === "system") renderSystem(payload);
  home.stats();
  // Warn once per 10 minutes when memory pressure turns critical.
  if (payload.pressure === 2 && !quiet() && Date.now() - warnedAt > 600_000) {
    warnedAt = Date.now();
    const top = payload.top[0];
    peek(peekLine(icon.warning, "var(--bad)", t("peek.memory.title"), top ? esc(t("peek.memory.app", { source: top.name })) : t("peek.memory.none")), 3500);
  }
});
// Stats arrive every second; five seconds of silence is a real problem.
window.setInterval(() => {
  if (mode === "open" && tab === "system" && lastStatsAt && Date.now() - lastStatsAt > 5000) renderSystemStalled();
}, 2000);

/* ---------- files dragged onto the island ---------- */

await getCurrentWebview().onDragDropEvent(({ payload }) => {
  if (!isOn(modes.state, "rak")) return;
  if (payload.type === "enter") {
    if (!(mode === "open" && tab === "shelf")) open("shelf");
    shelf.setDropping(true);
  } else if (payload.type === "leave") {
    shelf.setDropping(false);
  } else if (payload.type === "drop") {
    shelf.setDropping(false);
    void shelf.add(payload.paths).then(() => home.refresh());
  }
});

/* ---------- input ---------- */

await listen<boolean>("island-hover", ({ payload }) => {
  hovering = payload;
  clearTimeout(leaveTimer);
  if (mode === "compact") {
    go(compactSize(), "hover");
  } else if (mode === "open" && !payload && !openedByShortcut) {
    // Leaving the open island closes it, with a grace period for overshooting the edge.
    leaveTimer = window.setTimeout(compact, 380);
  }
});

await listen<Tab | "toggle">("open-tab", ({ payload }) => {
  if (payload === "toggle") {
    if (mode === "open") return compact();
    payload = tab;
  }
  openedByShortcut = true;
  if (payload === "clipboard" && !isOn(modes.state, "clip")) {
    open("mode");
    return toast(t("mode.clipOff", { mode: modeName(modes.state) }));
  }
  open(payload);
  if (payload === "clipboard") window.setTimeout(() => clips.focusSearch(), 60);
  else window.setTimeout(() => tabs.find((b) => b.dataset.tab === payload)?.focus(), 60);
});

const win = getCurrentWindow();
await win.onFocusChanged(({ payload: focused }) => {
  if (!focused && mode === "open" && openedByShortcut) compact();
});

shell.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  // Buttons inside a peek act in place instead of opening the island.
  const rem = el.closest<HTMLElement>("[data-rem-act]");
  if (rem) return void reminderAct(rem.closest<HTMLElement>("[data-rem]")!.dataset.rem!, rem.dataset.remAct!);
  const careBtn = el.closest<HTMLElement>("[data-care]");
  if (careBtn) {
    const kind = careBtn.closest<HTMLElement>("[data-care-kind]")!.dataset.careKind as CareKind;
    const said = care.answer(kind, careBtn.dataset.care as "ok" | "later" | "today");
    compact();
    if (said) window.setTimeout(() => peek(peekLine(icon.check, "var(--ok)", esc(said), ""), 1600), 450);
    return;
  }
  const dlBtn = el.closest<HTMLElement>("[data-dl]");
  if (dlBtn) return void downloadAct(dlBtn.dataset.dl!);
  const shotBtn = el.closest<HTMLElement>("[data-shot]");
  if (shotBtn) return void shotAct(shotBtn.dataset.shot!);
  const ans = el.closest<HTMLElement>("[data-act=answer]");
  if (ans) return void answerAsk(ans.dataset.id!, ans.dataset.answer!);
  const to = el.closest<HTMLElement>("[data-open]");
  if (to) return open(to.dataset.open as Tab);
  const off = el.closest<HTMLElement>("[data-offer]");
  if (off) {
    if (off.dataset.offer === "yes" && offer) remindAt(offer.text, offer.at, offer.app);
    offer = null;
    return compact();
  }
  if (mode === "compact") open(focus.running ? "focus" : tab === "settings" || tab === "mode" ? "home" : tab);
  else if (mode === "peek") open((e.target as HTMLElement).closest(".peek-body") ? "clipboard" : "home");
});

tabs.forEach((b) =>
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    setTab(b.dataset.tab as Tab);
  }),
);
$("#settingsBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  setTab(tab === "settings" ? allowed("home") : "settings");
});
$("#modeBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  setTab(tab === "mode" ? allowed("home") : "mode");
});
$("#v-exp").addEventListener("click", (e) => e.stopPropagation());

// Arrow keys move between tabs (WAI-ARIA tabs pattern); Tab moves focus normally.
$("#tabs").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  e.preventDefault();
  e.stopPropagation();
  const list = visibleTabs();
  const i = list.findIndex((b) => b.dataset.tab === tab);
  const next = list[(i + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
  setTab(next.dataset.tab as Tab, true);
});

document.addEventListener("keydown", (e) => {
  if (mode !== "open") return;
  if (e.key === "Escape") return compact();
  // ⌘1…⌘5 (Ctrl+1… elsewhere) jump straight to a section.
  if ((mac ? e.metaKey : e.ctrlKey) && /^[1-9]$/.test(e.key)) {
    const target = visibleTabs()[Number(e.key) - 1];
    if (target) {
      e.preventDefault();
      setTab(target.dataset.tab as Tab, true);
    }
    return;
  }
  if (tab === "clipboard" && !(e.target as HTMLElement).closest("#tabs") && clips.key(e)) e.preventDefault();
});

// Shortcuts are listed in Settings so they can be found without a manual.
const shortcutsNote = document.createElement("p");
shortcutsNote.className = "note";
new MutationObserver(() => {
  const s = document.querySelector("#settingsPanel .settings");
  if (!s || s.contains(shortcutsNote)) return;
  // The tab count follows the mode, and the words follow the language.
  shortcutsNote.textContent = t("settings.shortcuts", { open: mac ? "⌥⌘G" : "Ctrl+Alt+G", clip: mac ? "⌥⌘V" : "Ctrl+Alt+V", mod: MOD, last: visibleTabs().length });
  s.firstElementChild?.appendChild(shortcutsNote);
}).observe($("#settingsPanel"), { childList: true });

// A new language redraws whatever is on screen; closed panels render on open.
onLanguageChange(() => {
  syncTray();
  applyMode(modes.state);
  if (lastStats) renderSystem(lastStats);
  if (mode === "open") setTab(tab);
});

renderCompact(lastStats, badge(), playingArt());
reportHit(morph.current);

// First launch: open the guide once the island has settled into place.
if (needsGuide(savedGuide())) window.setTimeout(showGuide, 900);

/* ---------- command alerts and calls ---------- */

await listen<Done>("command-done", ({ payload }) => {
  dev.commandDone();
  if (quiet()) return;
  const ok = payload.code === 0;
  peek(peekLine(ok ? icon.ok : icon.fail, ok ? "var(--ok)" : "var(--bad)", esc(doneTitle(payload)), esc(doneMeta(payload))), 4000);
});

let callClock = 0;
await listen<Mic>("mic", ({ payload }) => {
  const started = payload.inUse && !call.mic?.inUse;
  call.setMic(payload);
  home.refresh();
  window.clearInterval(callClock);
  // The call clock ticks only while a call is live.
  if (payload.inUse) callClock = window.setInterval(() => renderCompact(lastStats, badge(), playingArt()), 1000);
  renderCompact(lastStats, badge(), playingArt());
  if (mode === "compact") go(compactSize(), "hover");
  if (started && !quiet()) {
    const title = payload.app ? t("peek.call.title", { app: payload.app }) : t("peek.call.some");
    peek(peekLine(icon.mic, "var(--ok)", esc(title), t("peek.call.body")), 3500);
  }
});
const micNow = await invoke<Mic | null>("mic_now");
if (micNow) call.setMic(micNow);

/* ---------- now playing ---------- */

// Four poses a second keep the level meter alive for a fraction of the cost
// of a CSS animation. It only runs while music plays and the island is small.
let meterFrame = 0;
let meterTimer = 0;
function syncMeter() {
  const run = !!media.now?.playing;
  if (run && !meterTimer) {
    meterTimer = window.setInterval(() => {
      if (mode !== "compact") return;
      const eq = document.querySelector<HTMLElement>("#cRight .eq");
      if (eq) eq.dataset.f = String((meterFrame = (meterFrame + 1) % 4));
    }, 250);
  } else if (!run && meterTimer) {
    window.clearInterval(meterTimer);
    meterTimer = 0;
  }
}

await listen<NowPlaying | null>("media", ({ payload }) => {
  const changed = payload?.playing && !sameTrack(media.now, payload);
  media.set(payload);
  syncMeter();
  home.refresh();
  renderCompact(lastStats, badge(), playingArt());
  if (mode === "compact") go(compactSize(), "hover");
  if (changed && !quiet()) {
    const art = payload.art ? `<img class="peek-art" src="${esc(payload.art)}" alt="">` : icon.music;
    peek(peekLine(art, "var(--accent)", esc(payload.title), esc(payload.artist || payload.app)), 3000);
  }
});
media.syncYoutube();
const mediaNow = await invoke<NowPlaying | null>("media_now");
if (mediaNow) media.set(mediaNow);
syncMeter();

// Reminders start last: one missed while the app was closed shows right away.
reminders.start();

/* ---------- downloads ---------- */

let lastDone: { path: string; name: string; bytes: number } | null = null;

await listen<Download[]>("downloads", ({ payload }) => {
  downloads = isOn(modes.state, "unduh") ? payload : [];
  renderCompact(lastStats, badge(), playingArt());
  if (mode === "compact") go(compactSize(), "hover");
});

await listen<{ path: string; name: string; bytes: number }>("download-done", ({ payload: f }) => {
  lastDone = f;
  if (quiet() || mode === "open") return;
  const shelfBtn = isOn(modes.state, "rak") ? `<button data-dl="shelf">${icon.tray}<span>${t("shot.shelf")}</span></button>` : "";
  peek(
    `<span class="ic" style="color:var(--ok)">${icon.ok}</span>
     <div class="peek-main"><div class="t clamp1">${esc(f.name)}</div><div class="s">${esc(t("dl.done", { size: bytes(f.bytes) }))}</div>
       <div class="peek-acts"><button class="primary" data-dl="open">${t("dl.open")}</button>
         <button data-dl="reveal">${t(mac ? "dl.revealMac" : "dl.reveal")}</button>${shelfBtn}</div></div>`,
    8000,
    true,
  );
});

async function downloadAct(act: string) {
  const f = lastDone;
  if (!f) return;
  compact();
  try {
    if (act === "open") await invoke("download_open", { path: f.path });
    else if (act === "reveal") await invoke("download_reveal", { path: f.path });
    else if (act === "shelf") {
      await shelf.add([f.path]);
      home.refresh();
      toast(t("shot.onShelf"));
    }
  } catch (err) {
    toast(errorText(err));
  }
}

/* ---------- smart screenshots ---------- */

interface Shot {
  path: string;
  name: string;
  thumb: string | null;
  size: [number, number] | null;
}
let lastShot: Shot | null = null;

await listen<Shot>("screenshot", ({ payload: s }) => {
  lastShot = s;
  if (quiet() || mode === "open") return;
  const pic = s.thumb ? `<img class="shot-thumb" alt="" src="${s.thumb}">` : `<span class="ic">${icon.image}</span>`;
  const shelfBtn = isOn(modes.state, "rak") ? `<button data-shot="shelf">${icon.tray}<span>${t("shot.shelf")}</span></button>` : "";
  peek(
    `${pic}<div class="peek-main"><div class="t">${t("shot.title")}</div>${s.size ? `<div class="s num">${s.size[0]} × ${s.size[1]} px</div>` : ""}
       <div class="peek-acts"><button class="primary" data-shot="text">${icon.text}<span>${t("shot.text")}</span></button>
         <button data-shot="image">${icon.copy}<span>${t("shot.image")}</span></button>${shelfBtn}</div></div>`,
    9000,
    true,
  );
});

async function shotAct(act: string) {
  const s = lastShot;
  if (!s) return;
  compact();
  try {
    if (act === "text") {
      const text = await invoke<string>("shot_text", { path: s.path });
      if (!text.trim()) return toast(t("shot.noText"));
      await invoke("clip_write", { text });
      toast(t("shot.textCopied", { key: pasteKey }));
    } else if (act === "image") {
      await invoke("shot_copy", { path: s.path });
      toast(t("shot.imageCopied", { key: pasteKey }));
    } else if (act === "shelf") {
      await shelf.add([s.path]);
      home.refresh();
      toast(t("shot.onShelf"));
    }
  } catch (err) {
    toast(errorText(err));
  }
}

/** A paused player that ignored Play (its tab closed, or a page that can't resume). */
await listen<string>("media-gone", ({ payload }) => toast(t("media.gone", { app: payload || t("media.player") })));

/* ---------- AI agents ---------- */

let agentClock = 0;
/** The compact island's agent clock ticks only while an agent works. */
function syncAgents() {
  window.clearInterval(agentClock);
  if (agents.lead()) agentClock = window.setInterval(() => renderCompact(lastStats, badge(), playingArt()), 1000);
  renderCompact(lastStats, badge(), playingArt());
  if (mode === "compact") go(compactSize(), "hover");
  ai.refresh();
  home.refresh();
}

await listen<AgentEvent>("agent-event", ({ payload }) => {
  const n = agents.apply(payload);
  syncAgents();
  if (!n || mode === "open") return;
  const s = n.session;
  // Claude Code also notifies about a permission request the island is already showing.
  if (n.kind === "waiting" && ai.asks.some((a) => a.agent === s.agent)) return;
  if (n.kind === "waiting") {
    // A question blocks the agent, so it speaks even in Focus mode.
    chime();
    peek(
      `<span class="ic" style="color:var(--warn)">${icon.hand}</span>
       <div class="peek-main"><div class="t">${esc(t("peek.agent.waiting", { agent: AGENT_NAME[s.agent] }))}</div><div class="s clamp2">${esc(s.message || sessionTitle(s))}</div>
         <div class="peek-acts"><button class="primary" data-open="ai">${t("peek.agent.show")}</button></div></div>`,
      10_000,
      true,
    );
  } else if (n.secs >= DONE_PEEK_SECS && !quiet()) {
    const sub = s.place ? t("peek.agent.doneSub", { place: s.place, time: took(n.secs) }) : t("peek.agent.doneSubNoPlace", { time: took(n.secs) });
    peek(peekLine(icon.ok, "var(--ok)", esc(t("peek.agent.done", { agent: AGENT_NAME[s.agent] })), esc(sub)), 4500);
  }
});

/** A permission request: the command in full, and three answers. It waits 30 seconds. */
await listen<Ask>("agent-ask", ({ payload: a }) => {
  ai.asks = [...ai.asks, a];
  ai.refresh();
  if (mode === "open" && tab === "ai") return;
  if (mode === "open") compact();
  chime();
  peek(
    `<span class="ic" style="color:var(--warn)">${icon.hand}</span>
     <div class="peek-main"><div class="t">${esc(t(askVerb(a.tool), { agent: AGENT_NAME[a.agent] }))}</div>
       <code class="ask-code">${esc(a.summary || a.tool)}</code>
       ${a.place ? `<div class="s">${esc(a.place)}</div>` : ""}
       ${askButtons(a.id)}</div>`,
    30_000,
    true,
  );
});
await listen<string>("agent-ask-done", ({ payload: id }) => {
  ai.asks = ai.asks.filter((a) => a.id !== id);
  ai.refresh();
  if (mode === "peek" && $("#peekBody").querySelector(`[data-id="${CSS.escape(id)}"]`)) compact();
});

/** Codex limit warnings already shown, by window and threshold. */
const warnedLimits = new Set<string>();
await listen<AgentStatus[]>("agent-usage", ({ payload }) => {
  ai.setStatus(payload);
  home.refresh();
  for (const st of payload) {
    for (const [l, name] of [[st.usage.primary, t("ai.limit.window")], [st.usage.secondary, t("ai.limit.week")]] as const) {
      if (!l) continue;
      const step = l.usedPercent >= 95 ? 95 : l.usedPercent >= 80 ? 80 : 0;
      const key = `${st.agent}:${l.windowMinutes}:${l.resetsAt}:${step}`;
      if (!step || warnedLimits.has(key)) continue;
      warnedLimits.add(key);
      if (!quiet()) peek(peekLine(icon.warning, step >= 95 ? "var(--bad)" : "var(--warn)", esc(t("peek.agent.limit", { percent: pct(l.usedPercent), window: name.toLocaleLowerCase(lang()) })), l.resetsAt ? esc(resetLabel(l.resetsAt)) : ""), 5000);
    }
  }
});

