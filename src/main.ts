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
import { MediaPanel, position, sameTrack, type NowPlaying } from "./mediaPanel";
import { ClipboardPanel, ICON, remindable, secondsLeft, secretName, setSmart, smart, type ClipItem } from "./clipboard";
import { FocusPanel, chime } from "./focusPanel";
import { bytes, esc, pct, took, whenLabel } from "./format";
import { APP_AUTHOR, errorText, initLanguage, lang, onLanguageChange, t, type Key } from "./i18n";
import { icon } from "./icons";
import { GuidePanel, savedGuide } from "./guidePanel";
import { HomePanel } from "./homePanel";
import { ModePanel, modeIcon, modeName } from "./modePanel";
import { needsGuide } from "./onboarding";
import { agentLogo } from "./agentLogos";
import { clock, pickCore, type Core } from "./core";
import { layout, openCore, type DropletId, type Shape } from "./droplets";
import { DropletsView, parseColor, type GlassKind } from "./dropletsView";
import { Reminders, type Reminder } from "./reminders";
import { findTime } from "./timeparse";
import { isOn, type FeatureId, type ModeState } from "./modes";
import { SettingsPanel } from "./settings";
import { ShelfPanel } from "./shelf";
import { compactLook, compactWidth, type Look } from "./islandSize";
import { Eyes, SLEEP_AFTER, type Mood } from "./eyes";
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
root.style.setProperty("--nw", `${Math.round(info.notchWidth)}px`);
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
/** An app window reaches up where the menu bar would be, under the island. */
let covered = false;
let openedByShortcut = false;
/** Droplets, the 1.0 island, while it's built: on with localStorage gentra:droplets = 1. */
let drops: DropletsView | null = null;
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
  if (drops?.sideVisible && mode === "compact") {
    const w = Math.max(s.w, target?.w ?? 0);
    const h = Math.max(s.h, target?.h ?? 0);
    const core = { x: (WIN_W - w) / 2 - 6, y: 0, w: w + 12, h: h + 6 };
    void invoke("set_hit_rects", { rects: [core, ...drops.sideShapes().map(({ x, y, w, h }) => ({ x, y, w, h }))] });
    return;
  }
  if (drops?.visible) {
    void invoke("set_hit_rects", { rects: drops.hitShapes().map(({ x, y, w, h }) => ({ x, y, w, h })) });
    return;
  }
  const w = Math.max(s.w, target?.w ?? 0);
  const h = Math.max(s.h, target?.h ?? 0);
  // The hidden line takes only the pointer at the very top edge; the app below keeps the rest.
  const tight = mode === "compact" && look === "hidden" && (target ?? s).h <= 4;
  // A few extra pixels around the compact pill make the notch easy to hit.
  const pad = mode === "compact" && !tight ? 6 : 0;
  void invoke("set_hit_rect", {
    rect: { x: (WIN_W - w) / 2 - pad, y: TOP > 0 ? TOP - pad : 0, w: w + pad * 2, h: h + pad + (TOP > 0 ? pad : 0), tight },
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
const eyes = new Eyes();
let eyesShown = false;
/** Whether the pointer feed is on: the eyes are wanted, even if tucked away for now. */
let eyesFeed = false;
/** In Moments, the eyes show until this time after something happens. */
let momentUntil = 0;
let momentTimer = 0;
const MOMENT_MS = 2500;
/** A mood that happened while a peek or the open island hid the eyes. */
let pendingMood: Mood | null = null;

/**
 * The eyes show only on an empty, closed island, and only with the setting on.
 * The notch has no pixels, so on a Mac with one they sit either side of the
 * camera, in the menu bar, and cover nothing below it. `fits` is false while
 * the island shows its numbers (on hover, or the Wide size).
 */
function syncEyes(fits = true) {
  const setting = settings.settings.eyes;
  const want = setting !== "off" && mode === "compact" && !badge() && playingArt() === undefined;
  if (want !== eyesFeed) {
    eyesFeed = want;
    void invoke("set_eyes", { on: want });
  }
  if (want && pendingMood && Date.now() >= momentUntil) {
    // A mood saved during a peek gets its moment now, and tucks away after.
    momentUntil = Date.now() + MOMENT_MS;
    window.clearTimeout(momentTimer);
    momentTimer = window.setTimeout(() => mode === "compact" && go(compactSize(), "hover"), MOMENT_MS + 50);
  }
  const moment = Date.now() < momentUntil;
  const show = want && fits && (!hasNotch || setting === "always" || moment);
  if (show === eyesShown) return;
  eyesShown = show;
  eyes.setVisible(show);
  if (show && pendingMood) {
    const m = pendingMood;
    pendingMood = null;
    window.setTimeout(() => eyes.feel(m), 450);
  }
}

/** Back after a while away: a moment to say hello, in either mode. */
function wake() {
  if (!eyesFeed) return;
  moment();
  window.setTimeout(() => eyes.sleep(false), 300);
}

function mood(m: Mood) {
  if (mode !== "compact") {
    pendingMood = m;
    return;
  }
  moment();
  window.setTimeout(() => eyes.feel(m), eyesShown ? 0 : 350);
}

/** Moments: the eyes peek out for a little while, then tuck away. */
function moment() {
  momentUntil = Date.now() + MOMENT_MS;
  window.clearTimeout(momentTimer);
  momentTimer = window.setTimeout(() => mode === "compact" && go(compactSize(), "hover"), MOMENT_MS + 50);
  if (mode === "compact") go(compactSize(), "hover");
}

/**
 * The closed island's width follows Settings, what is live, and the pointer.
 * The row inside is laid out at the same width, so its sides sit at the edges.
 */
function compactSize(): Size {
  const live = !!badge() || playingArt() !== undefined;
  let next: Look = compactLook(settings.settings.islandSize, { hasNotch, live, hovering, covered });
  // While something is live, small droplets split off beside the notch; the island tucks into it.
  if (sideKind()) next = "tucked";
  syncEyes(next !== "hidden" && (!hasNotch || next !== "full"));
  // Beside the camera, the eyes take the place of the small icons.
  if (hasNotch && eyesShown) next = "eyes";
  // A running timer needs a little more room on the right.
  const extra = next === "full" && badge() ? 24 : 0;
  const w = compactWidth(next, { hasNotch, notchW: Math.round(info.notchWidth) }) + extra;
  if (next !== look) {
    look = next;
    document.body.dataset.look = next;
    root.style.setProperty("--cw", `${w - extra}px`);
  }
  queueMicrotask(syncSide);
  if (next === "hidden") return { w, h: 4, r: 2 };
  return { w, h: CH + (hovering ? 3 : 0), r: R_COMPACT };
}

/** What splits off beside the closed island, most urgent first: a call, music, a download. */
function sideKind(): "call" | "music" | "download" | null {
  if (!drops || !hasNotch || mode !== "compact" || hovering || covered) return null;
  if (call.mic?.inUse && isOn(modes.state, "meeting")) return "call";
  if (media.now?.playing && isOn(modes.state, "musik")) return "music";
  if (downloads.length && isOn(modes.state, "unduh")) return "download";
  return null;
}

/** Shows or tucks away the droplets beside the closed island. */
function syncSide() {
  if (!drops) return;
  const kind = sideKind();
  if (!kind) return drops.hideSide();
  const nw = Math.round(info.notchWidth);
  const cx = WIN_W / 2;
  const size = 34;
  const gap = 8;
  const left = { x: cx - nw / 2 - gap - size, y: 0, w: size, h: size, r: size / 2 };
  const right = { x: cx + nw / 2 + gap, y: 0, w: size, h: size, r: size / 2 };
  const notch = { x: cx - nw / 2, y: 0, w: nw, h: CH, r: 0 };
  if (kind === "call") {
    const m = call.mic!;
    const app = m.app ?? t("tab.call");
    drops.showSide(
      [
        { id: "calls", kind: "call-app", shape: left, html: icon.video, label: app },
        { id: "calls", kind: m.muted ? "call-mic muted" : "call-mic", act: "call:mute", shape: right, html: m.muted ? icon.micOff : icon.mic, label: t(m.muted ? "call.unmute" : "call.mute") },
      ],
      notch,
    );
  } else if (kind === "music") {
    const n = media.now!;
    const cover = n.art ? `<img class="dl-side-art" alt="" src="${esc(n.art)}">` : icon.music;
    const sound = `<span class="dl-eq" aria-hidden="true"><i></i><i></i><i></i></span>`;
    drops.showSide(
      [
        { id: "media", kind: "music-art", shape: left, html: cover, label: n.title },
        { id: "media", kind: "music-eq", shape: right, html: sound, label: n.artist ? `${n.title}, ${n.artist}` : n.title },
      ],
      notch,
    );
  } else {
    const d = downloads[0];
    const part = d.total ? Math.min(1, d.bytes / d.total) : null;
    const ringHtml =
      part === null
        ? icon.down
        : `<svg class="dl-side-ring" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="14" class="track" pathLength="100"/><circle cx="17" cy="17" r="14" class="fill" pathLength="100" stroke-dasharray="${(part * 100).toFixed(1)} 100"/></svg><b class="num">${Math.round(part * 100)}</b>`;
    drops.showSide(
      [
        { id: "shelf", kind: "dl-file", shape: left, html: icon.file, label: d.name },
        { id: "shelf", kind: "dl-progress", shape: right, html: ringHtml, label: part === null ? bytes(d.bytes) : `${Math.round(part * 100)}%` },
      ],
      notch,
    );
  }
  reportHit(morph.current);
}

function compact() {
  clearTimeout(peekTimer);
  drops?.hide();
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
  if (drops && allowed(t) === "home") return openDroplets();
  const asDrop = drops ? (Object.keys(DROP_VIEWS) as DropletId[]).find((id) => DROP_TAB[id] === allowed(t)) : undefined;
  if (asDrop) return openDropView(asDrop, null);
  drops?.hide();
  mode = "open";
  syncEyes();
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
  // A droplet's view sizes itself; only the old open island follows its tab.
  if (!drops?.visible) go(openSize(), "grow");
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
  // A droplet's view has its own size; the island stays the core around it.
  if (mode === "open" && !drops?.visible) go(openSize(), "grow");
});
document.querySelectorAll(".panel").forEach((p) => resize.observe(p));

/** A short-lived wider island that says what just happened, then tucks back. */
function peek(html: string, ms = 1800, wide = false) {
  if (mode === "open") return;
  mode = "peek";
  // A peek widens over the notch's sides; the droplets there step back meanwhile.
  drops?.hideSide();
  syncEyes();
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
  // With droplets out, the message shows over them, not in the core.
  if (drops?.visible) return drops.say(msg);
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
  mood("surprised");
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
}, toast, (item, at) => remindAt(item.text ?? "", at, item.app), (id) => copyTextFrom(id, false));
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

/* ---------- droplets (1.0, while it's built) ---------- */

const DROP_TAB: Record<DropletId, Tab> = {
  media: "media",
  focus: "focus",
  system: "system",
  clipboard: "clipboard",
  shelf: "shelf",
  ai: "ai",
  dev: "dev",
  cleaner: "cleaner",
  calls: "call",
  modes: "mode",
  settings: "settings",
};

const dropName = (id: DropletId) =>
  id === "settings" ? t("drop.settings") : id === "modes" ? t("drop.modes") : id === "ai" ? t("drop.ai") : t(`tab.${DROP_TAB[id]}` as Key);

/** What the core shows while the droplets are out: the most urgent thing going on. */
function coreNow(): Core {
  const ask = ai.asks[0];
  const lead = isOn(modes.state, "ai") ? agents.lead() : null;
  const m = call.mic;
  const d = downloads[0];
  return pickCore({
    ask: ask ? { agent: AGENT_NAME[ask.agent], summary: ask.summary || ask.tool } : null,
    call: m?.inUse ? { app: m.app ?? "", muted: !!m.muted } : null,
    agent: lead ? { agent: AGENT_NAME[lead.agent], project: lead.place, since: lead.started } : null,
    focus: focus.running ? { endsAt: 0, paused: focus.paused } : null,
    download: d ? { name: d.name, bytes: d.bytes, total: d.total } : null,
  });
}

/** The core's one line, every value escaped. */
function coreView(c: Core): string {
  let title = "";
  let sub = "";
  let readout = "";
  if (c.kind === "ask") {
    const a = ai.asks[0];
    title = t(askVerb(a?.tool ?? ""), { agent: c.agent });
    sub = c.summary;
  } else if (c.kind === "call") {
    title = c.muted ? t("core.call.muted") : c.app ? t("core.call.live", { app: c.app }) : t("core.call.liveNoApp");
    sub = t("core.call.sub");
    readout = clock(Date.now() - (call.mic?.since ?? 0) * 1000);
  } else if (c.kind === "agent") {
    const waiting = agents.lead()?.state === "waiting";
    title = t(waiting ? "core.agent.waiting" : "core.agent.working", { agent: c.agent });
    sub = c.project;
    readout = clock(Date.now() - c.since);
  } else if (c.kind === "focus") {
    title = t(c.paused ? "core.focus.paused" : "core.focus");
    sub = t("core.focus.sub");
    readout = focus.label;
  } else if (c.kind === "download") {
    title = c.name;
    sub = t("core.download.sub", { speed: bytes(downloads[0]?.speed ?? 0) });
    readout = c.total ? `${Math.round((c.bytes / c.total) * 100)}%` : bytes(c.bytes);
  }
  const urgent = c.kind === "ask" || (c.kind === "call" && !c.muted);
  // An agent's own mark says which one it is; other kinds keep the plain light.
  const who = c.kind === "ask" ? ai.asks[0]?.agent : c.kind === "agent" ? agents.lead()?.agent : undefined;
  const mark = who ? agentLogo(who) : "<i></i>";
  return `<span class="core-ring${urgent ? " urgent" : ""}${who ? " logo" : ""}" aria-hidden="true">${mark}</span>
    <span class="core-text"><b>${esc(title)}</b><span>${esc(sub)}</span></span>
    ${readout ? `<span class="core-readout num">${esc(readout)}</span>` : ""}`;
}

/** The view a busy core opens when clicked. */
const CORE_TAB: Partial<Record<Core["kind"], Tab>> = { ask: "ai", agent: "ai", call: "call", focus: "focus" };

/** The core's size: grown for a live line, or the small island when nothing is going on. */
function dropCore() {
  const c = coreNow();
  if (c.kind === "idle") return { w: CW, h: CH, r: R_COMPACT };
  const { w, h, r } = openCore(hasNotch ? { w: info.notchWidth, h: info.notchHeight } : null, WIN_W);
  return { w, h, r };
}

/** Whether the core last had something to say, to notice when that changes. */
let coreBusy = false;

// Once a second while the droplets are out: the readout ticks, and the core
// grows or shrinks when something starts or stops.
window.setInterval(() => {
  if (!drops?.visible || mode !== "open") return;
  const busy = coreNow().kind !== "idle";
  // The core changing size moves everything under it. With the pointer on the
  // island that would pull a droplet away from under it, so it waits.
  if (busy !== coreBusy && !hovering) {
    if (dropView) openDropView(dropView, null);
    else openDroplets();
    return;
  }
  if (busy !== coreBusy) return;
  if (busy) $("#v-core").innerHTML = coreView(coreNow());
}, 1000);

/** Shows the core's line, or the small island's row when there is nothing to say. */
function paintCore() {
  const c = coreNow();
  coreBusy = c.kind !== "idle";
  if (c.kind === "idle") return show("v-compact");
  root.style.setProperty("--core-h", `${openCore(hasNotch ? { w: 0, h: 0 } : null, WIN_W).h}px`);
  $("#v-core").innerHTML = coreView(c);
  show("v-core");
}

function dropLayout() {
  const on = (Object.keys(DROP_TAB) as DropletId[]).filter((id) => id === "settings" || id === "modes" || tabOn(modes.state, DROP_TAB[id]));
  const notch = hasNotch ? { w: Math.round(info.notchWidth), h: Math.round(info.notchHeight) } : null;
  return layout({ winW: WIN_W, notch, on, view: "home", chipW: drops!.measure(on, dropName), core: dropCore() });
}

/** A ring around a round droplet: `part` from 0 to 1 of it filled. */
const ring = (part: number, color: string) =>
  `<svg class="dl-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" class="track" pathLength="100"/><circle cx="60" cy="60" r="54" class="fill" pathLength="100" stroke="${color}" stroke-dasharray="${Math.max(0, Math.min(100, part * 100)).toFixed(1)} 100"/></svg>`;

const CHIP_ICON: Partial<Record<DropletId, string>> = { ai: icon.robot, dev: icon.terminal, cleaner: icon.broom, calls: icon.mic, modes: icon.sliders, settings: icon.gear };
const PRESSURE_COLOR = ["var(--ok)", "var(--warn)", "var(--bad)"];

/** A chip's small light: on only when there is something live behind it. */
function chipDot(id: DropletId): string {
  if (id === "ai" && isOn(modes.state, "ai")) {
    const lead = agents.lead();
    if (lead) return lead.state === "waiting" ? "var(--warn)" : "var(--accent-on-black, var(--accent))";
  }
  if (id === "calls" && call.mic?.inUse) return call.mic.muted ? "var(--muted)" : "var(--bad)";
  return "";
}

/** Each droplet's inside, every value escaped. */
function dropContent(id: DropletId): string {
  if (id === "media") {
    const n = media.now;
    const art = n?.art ? `<span class="dl-art" style="background-image: url('${esc(n.art)}')"></span>` : `<span class="dl-art blank">${icon.music}</span>`;
    const part = n && n.duration > 0 ? Math.min(1, position(n) / n.duration) : 0;
    const bar = n && n.duration > 0 ? `<span class="dl-bar" aria-hidden="true"><i style="width: ${(part * 100).toFixed(1)}%"></i></span>` : "";
    const state = n ? `<span class="dl-state">${n.playing ? icon.pause : icon.play}</span>` : "";
    return `${art}<span class="dl-text"><b>${esc(n?.title || t("drop.nothing"))}</b><small>${esc(n ? n.artist : t("drop.playHint"))}</small>${bar}</span>${state}`;
  }
  if (id === "focus") {
    const fill = focus.running ? ring(focus.left, "var(--accent-on-black, var(--accent))") : ring(0, "transparent");
    return `${fill}<span class="dl-round-in"><span class="dl-big num">${esc(focus.running ? focus.label : "25:00")}</span><span class="dl-sub">${icon.timer}${esc(t("tab.focus"))}</span></span>`;
  }
  if (id === "system") {
    const s = lastStats;
    const part = s ? s.memUsed / s.memTotal : 0;
    return `${ring(part, PRESSURE_COLOR[s?.pressure ?? 0])}<span class="dl-round-in"><span class="dl-big num">${Math.round(part * 100)}%</span><span class="dl-sub">${icon.memory}${esc(t("drop.memory"))}</span><span class="dl-sub faint">${esc(t("drop.cpu", { pct: Math.round(s?.cpu ?? 0) }))}</span></span>`;
  }
  if (id === "clipboard") {
    const last = clips.items[0];
    const text = !last ? t("drop.nothingCopied") : last.secret ? t("drop.secret") : last.kind === "image" ? t("tab.clipboard") : (last.text ?? "");
    const lead = !last
      ? `<span class="dl-kind">${icon.clipboard}</span>`
      : last.secret
        ? `<span class="dl-kind secret">${icon.lock}</span>`
        : last.kind === "image" && last.thumb
          ? `<span class="dl-kind thumb"><img alt="" src="${esc(last.thumb)}"></span>`
          : `<span class="dl-kind">${({ text: icon.text, link: icon.link, code: icon.code, color: icon.paint, image: icon.image } as const)[last.kind]}</span>`;
    const from = last?.app ? t("drop.copiedFrom", { app: last.app }) : t("drop.lastCopied");
    return `${lead}<span class="dl-text"><small>${esc(from)}</small><b>${esc(text)}</b></span><span class="dl-btn">${esc(t("drop.seeAll", { count: clips.items.length }))}</span>`;
  }
  if (id === "shelf") {
    const items = shelf.items.slice(0, 3);
    const stack = items.length
      ? `<span class="dl-stack" aria-hidden="true">${items.map((f, i) => `<span class="dl-file f${i}">${f.isDir ? icon.folder : `<b>${esc((f.name.split(".").pop() ?? "").slice(0, 4).toUpperCase())}</b>`}</span>`).join("")}</span>`
      : `<span class="dl-kind">${icon.tray}</span>`;
    const n = shelf.items.length;
    return `${stack}<span class="dl-text"><b>${esc(n ? t("drop.shelf", { count: n }) : t("drop.shelfEmpty"))}</b><small>${esc(t("drop.dropHere"))}</small></span>`;
  }
  const dot = chipDot(id);
  return `${CHIP_ICON[id] ?? ""}<span>${esc(dropName(id))}</span>${dot ? `<i class="dl-dot" style="background: ${dot}"></i>` : ""}`;
}

/** The views already rebuilt as droplets, and the tallest each may grow (each fits its content); the rest still open today's panels. */
const DROP_VIEWS: Record<DropletId, number> = { clipboard: 540, media: 540, system: 540, focus: 540, shelf: 540, ai: 540, dev: 540, cleaner: 540, calls: 540, modes: 540, settings: 540 };
const PRESSURE_TITLE: Key[] = ["system.pressure.ok", "system.pressure.tight", "system.pressure.full"];
/** The droplet whose view is open, if any. */
let dropView: DropletId | null = null;

function dropHead(id: DropletId) {
  if (id === "ai") {
    const lead = agents.lead();
    const title = !lead ? t("drop.ai.idle") : t(lead.state === "waiting" ? "drop.ai.waiting" : "drop.ai.working", { agent: AGENT_NAME[lead.agent] });
    return { kicker: t("drop.ai"), title };
  }
  if (id === "dev") return { kicker: t("tab.dev"), title: t("drop.dev.title") };
  if (id === "cleaner") return { kicker: t("tab.cleaner"), title: t("drop.cleaner.title") };
  if (id === "settings") return { kicker: t("drop.settings"), title: t("drop.settings.title") };
  if (id === "modes") return { kicker: t("drop.modes"), title: t("drop.modes.title") };
  if (id === "calls") {
    const m = call.mic;
    const title = !m?.inUse ? t("drop.calls.idle") : m.muted ? t("drop.calls.muted") : m.app ? t("drop.calls.live", { app: m.app }) : t("drop.calls.liveNoApp");
    return { kicker: t("tab.call"), title };
  }
  if (id === "system") return { kicker: t("tab.system"), title: lastStats ? t(PRESSURE_TITLE[lastStats.pressure]) : t("system.waiting.title") };
  if (id === "focus") {
    const title = !focus.running ? t("drop.focus.idle") : t(focus.paused ? "drop.focus.paused" : "drop.focus.running", { time: focus.label });
    return { kicker: t("tab.focus"), title };
  }
  if (id === "shelf") {
    const n = shelf.items.length;
    return { kicker: t("tab.shelf"), title: n ? t("drop.shelf.title", { count: n }) : t("drop.shelf.empty") };
  }
  if (id === "media") {
    const n = media.now;
    return { kicker: n?.app ? t("media.from", { app: n.app }) : t("drop.media.kicker"), title: n?.title || t("drop.nothing") };
  }
  const n = clips.items.length;
  return { kicker: t("tab.clipboard"), title: n ? t("drop.clip.title", { count: n }) : t("drop.nothingCopied") };
}

/** The song's colour, which the media view already works out, for the panel's glass. */
function tintMedia() {
  const player = document.querySelector<HTMLElement>("#mediaPanel .player");
  drops?.tintPanel(player ? parseColor(getComputedStyle(player).getPropertyValue("--tint")) : null);
}

function openDropView(id: DropletId, from: Shape | null) {
  const tabId = DROP_TAB[id];
  mode = "open";
  tab = tabId;
  syncEyes();
  paintCore();
  const section = $(`.panel[data-panel="${tabId}"]`);
  document.querySelectorAll<HTMLElement>(".panel").forEach((p) => p.classList.toggle("on", p === section));
  dropView = id;
  // The same start-up each section gets as a tab; live ones stop when another opens.
  void invoke("set_stats_detail", { on: id === "system" });
  if (id === "system" && lastStats) renderSystem(lastStats);
  if (id === "media") media.show();
  else media.hide();
  if (id === "dev") dev.show();
  else dev.hide();
  if (id === "calls") call.show();
  else call.hide();
  if (id === "ai") void ai.show();
  else ai.hide();
  if (id === "cleaner") {
    cleaner.render();
    cleaner.ensureScanned();
  }
  if (id === "focus") focus.render();
  if (id === "shelf") shelf.render();
  if (id === "settings") settings.render();
  if (id === "modes") modes.render();
  const notch = hasNotch ? { w: Math.round(info.notchWidth), h: Math.round(info.notchHeight) } : null;
  const l = layout({ winW: WIN_W, notch, on: [id], view: id, panelH: DROP_VIEWS[id], core: dropCore() });
  drops!.openPanel(l, from, section, { ...dropHead(id), done: t("drop.done") });
  go({ w: l.core.w, h: l.core.h, r: l.core.r }, "grow");
  if (id === "media") tintMedia();
  if (id === "clipboard") window.setTimeout(() => clips.focusSearch(), 60);
}

function openDroplets() {
  mode = "open";
  tab = "home";
  dropView = null;
  syncEyes();
  paintCore();
  const l = dropLayout();
  drops!.show(l, dropContent);
  go({ w: l.core.w, h: l.core.h, r: l.core.r }, "grow");
}

const dropletsWanted = (() => {
  try {
    return localStorage.getItem("gentra:droplets") === "1";
  } catch {
    return false;
  }
})();
// For smoothness tests: frames a second and the slowest frame, sent to the log,
// and each slow frame and click with what the island was doing.
const probing = await invoke<boolean>("fps_probe");
const dbg = (line: string) => probing && void invoke("debug_log", { line: `${Math.round(performance.now())} ${line}` });
if (probing) {
  let frames = 0;
  let worst = 0;
  let last = performance.now();
  let since = last;
  const tick = (now: number) => {
    frames++;
    if (now - last > 50) dbg(`slow frame ${Math.round(now - last)} ms, mode ${mode}, droplets ${drops?.visible ? "out" : "in"}`);
    worst = Math.max(worst, now - last);
    last = now;
    if (now - since >= 1000) {
      void invoke("fps_log", { fps: frames, worst });
      frames = 0;
      worst = 0;
      since = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // A press that never shows here never reached the window at all.
  document.addEventListener("mousedown", (e) => dbg(`press on ${(e.target as HTMLElement).id || (e.target as HTMLElement).className || "?"} at ${e.clientX},${e.clientY}`), true);
}
if (dropletsWanted || (await invoke<boolean>("droplets_enabled"))) {
  document.body.classList.add("droplets-on");
  drops = new DropletsView(
    await invoke<GlassKind>("glass_kind"),
    (id, from) => openDropView(id, from),
    () => openDroplets(),
    () => reportHit(morph.current),
    (act) => void homeAct(act).then(syncSide),
  );
}

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
  // With droplets out, a mode change redraws them (features came or went); an open view stays put.
  if (mode === "open" && drops?.visible) {
    if (!drops.open) openDroplets();
  } else if (mode === "open") setTab(allowed(tab));
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
  drops?.refresh(dropContent);
  if (drops?.open && tab === "clipboard") drops.retitle(dropHead("clipboard"));
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
  } else if (fresh && top.kind === "image" && !quiet() && isOn(modes.state, "tangkap")) {
    // A screenshot copied straight to the clipboard (⌃⇧⌘4) never becomes a
    // file, so any copied image gets the same Copy text as a saved screenshot.
    const pic = top.thumb ? `<img class="shot-thumb" alt="" src="${top.thumb}">` : `<span class="ic">${icon.image}</span>`;
    const title = top.app ? t("peek.imageCopiedFrom", { source: top.app }) : t("peek.imageCopied");
    const size = top.size ? `<div class="s num">${top.size[0]} × ${top.size[1]} px</div>` : "";
    peek(
      `${pic}<div class="peek-main"><div class="t">${esc(title)}</div>${size}
         <div class="peek-acts"><button class="primary" data-clip-text="${top.id}">${icon.text}<span>${t("shot.text")}</span></button></div></div>`,
      6000,
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
  drops?.refresh(dropContent);
  // The stats tick every couple of seconds, often enough to keep an open view's title current.
  if (drops?.open && dropView) drops.retitle(dropHead(dropView));
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

function setCovered(on: boolean) {
  covered = on;
  if (mode === "compact") go(compactSize(), "shrink");
}
await listen<boolean>("top-covered", ({ payload }) => setCovered(payload));
setCovered(await invoke<boolean>("top_covered"));

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
  // The guide stays until Skip or Done: at launch another app takes focus before anyone reads it.
  if (!focused && mode === "open" && openedByShortcut && tab !== "guide") compact();
});

shell.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  dbg(`click on ${el.id || el.className || el.tagName}, mode ${mode}, droplets ${drops ? "on" : "off"}`);
  // Buttons inside a peek act in place instead of opening the island.
  const rem = el.closest<HTMLElement>("[data-rem-act]");
  if (rem) return void reminderAct(rem.closest<HTMLElement>("[data-rem]")!.dataset.rem!, rem.dataset.remAct!);
  const careBtn = el.closest<HTMLElement>("[data-care]");
  if (careBtn) {
    const kind = careBtn.closest<HTMLElement>("[data-care-kind]")!.dataset.careKind as CareKind;
    const said = care.answer(kind, careBtn.dataset.care as "ok" | "later" | "today");
    if (careBtn.dataset.care === "ok") mood("happy");
    compact();
    if (said) window.setTimeout(() => peek(peekLine(icon.check, "var(--ok)", esc(said), ""), 1600), 450);
    return;
  }
  const dlBtn = el.closest<HTMLElement>("[data-dl]");
  if (dlBtn) return void downloadAct(dlBtn.dataset.dl!);
  const clipText = el.closest<HTMLElement>("[data-clip-text]");
  if (clipText) return void copyTextFrom(Number(clipText.dataset.clipText));
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
  // With droplets, the island always opens on them; the busy core then leads to its view.
  if (mode === "compact" && drops) open("home");
  else if (mode === "compact") open(focus.running ? "focus" : tab === "settings" || tab === "mode" ? "home" : tab);
  else if (mode === "open" && drops?.visible && el.closest("#v-core")) {
    const to = CORE_TAB[coreNow().kind];
    if (to) open(to);
  }
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
  // In a droplet's view, Escape steps back to the droplets; there, it closes.
  if (e.key === "Escape") return drops?.open ? openDroplets() : compact();
  // ⌘1…⌘5 (Ctrl+1… elsewhere) jump straight to a section.
  if ((mac ? e.metaKey : e.ctrlKey) && /^[1-9]$/.test(e.key)) {
    const target = visibleTabs()[Number(e.key) - 1];
    if (target) {
      e.preventDefault();
      if (drops) open(target.dataset.tab as Tab);
      else setTab(target.dataset.tab as Tab, true);
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
  drops?.refresh(dropContent);
  if (drops?.open && tab === "media") {
    drops.retitle(dropHead("media"));
    tintMedia();
  }
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

/** Copy text for an image in the clipboard history; from a peek, the island closes first. */
async function copyTextFrom(id: number, close = true) {
  if (close) compact();
  try {
    const text = await invoke<string>("clip_text", { id });
    if (!text.trim()) return toast(t("shot.noText"));
    await invoke("clip_write", { text });
    toast(t("shot.textCopied", { key: pasteKey }));
  } catch (err) {
    toast(errorText(err));
  }
}

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
  mood(n.kind === "waiting" ? "surprised" : "happy");
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
    `<span class="ic ask-ic">${agentLogo(a.agent)}</span>
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

/* ---------- eyes ---------- */

// The pointer, from the hit tester, relative to the middle of the notch.
await listen<[number, number]>("pointer", ({ payload: [x, y] }) => {
  const dx = x - WIN_W / 2;
  eyes.look(dx, y - (TOP + CH / 2));
});

// Asleep after five quiet minutes; the next pointer move wakes them.
window.setInterval(async () => {
  if (!eyesFeed) return;
  const idle = await invoke<number | null>("idle_secs").catch(() => null);
  if (idle === null) return;
  if (idle >= SLEEP_AFTER) eyes.sleep(true);
  else if (eyes.sleeping) wake();
}, 30_000);

