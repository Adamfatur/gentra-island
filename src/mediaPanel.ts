import { invoke } from "@tauri-apps/api/core";
import { clock } from "./focus";
import { esc } from "./format";
import { errorText, t } from "./i18n";
import { icon } from "./icons";
import { readableAccent, onAccentText } from "./theme";
import { artTint } from "./tint";

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  app: string;
  playing: boolean;
  /** Seconds; 0 for live streams. */
  duration: number;
  /** Seconds played at `at`. */
  elapsed: number;
  /** Unix ms when `elapsed` was read. */
  at: number;
  art: string | null;
}

/** Where playback is now, counted on from the last reading while it plays. */
export function position(n: NowPlaying, now = Date.now()): number {
  const run = n.playing && n.at ? (now - n.at) / 1000 : 0;
  const p = Math.max(0, n.elapsed + run);
  return n.duration > 0 ? Math.min(n.duration, p) : p;
}

/** Same song: title and artist match. Used to spot track changes. */
export const sameTrack = (a: NowPlaying | null, b: NowPlaying | null) => !!a && !!b && a.title === b.title && a.artist === b.artist;

const mmss = (secs: number) => clock(Math.floor(secs) * 1000);

/** Media tab: what is playing anywhere, with play/pause, skip, and seek. */
export class MediaPanel {
  now: NowPlaying | null = null;
  /** The song's color, readable on the dark island; null for the theme accent. */
  tint: string | null = null;
  private tintFor = "";
  private root = document.getElementById("mediaPanel")!;
  private tick = 0;
  /** Seconds under the pointer while dragging the bar. */
  private dragging: number | null = null;

  constructor(
    private toast: (msg: string) => void,
    private onTint: (tint: string | null) => void,
  ) {
    this.root.addEventListener("click", (e) => void this.click(e));
    this.root.addEventListener("pointerdown", (e) => this.grab(e));
    this.root.addEventListener("keydown", (e) => this.key(e));
  }

  show() {
    this.render();
    window.clearInterval(this.tick);
    // Only the bar and the clock move while the tab is open.
    this.tick = window.setInterval(() => this.progress(), 1000);
  }

  hide() {
    window.clearInterval(this.tick);
    this.tick = 0;
  }

  set(n: NowPlaying | null) {
    this.now = n;
    void this.updateTint();
    if (this.tick) this.render();
  }

  private async updateTint() {
    const art = this.now?.art ?? "";
    if (art === this.tintFor) return;
    this.tintFor = art;
    const raw = art ? await artTint(art) : null;
    if (this.tintFor !== art) return;
    // The panel and meter sit on near-black; keep the color clearly visible there.
    this.tint = raw ? readableAccent(raw, "#141418", 3) : null;
    this.onTint(this.tint);
    if (this.tick) this.render();
  }

  private async send(action: string, position?: number) {
    try {
      await invoke("media_control", { action, position });
      return true;
    } catch (err) {
      this.toast(errorText(err));
      return false;
    }
  }

  private async click(e: Event) {
    const act = (e.target as HTMLElement).closest<HTMLElement>("[data-act]")?.dataset.act;
    const n = this.now;
    if (!act || !n) return;
    if (!(await this.send(act))) return;
    // Show the new state right away; the player confirms within a second.
    if (act === "toggle") this.now = { ...n, playing: !n.playing, elapsed: position(n), at: Date.now() };
    this.render();
  }

  /** Dragging the bar previews the time and seeks once on release. */
  private grab(e: PointerEvent) {
    const bar = (e.target as HTMLElement).closest<HTMLElement>(".scrub");
    const n = this.now;
    if (!bar || !n || n.duration <= 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
    const at = (x: number) => {
      const r = bar.getBoundingClientRect();
      return Math.min(1, Math.max(0, (x - r.left) / r.width)) * n.duration;
    };
    this.dragging = at(e.clientX);
    this.progress();
    const move = (ev: PointerEvent) => {
      this.dragging = at(ev.clientX);
      this.progress();
    };
    const up = async (ev: PointerEvent) => {
      bar.removeEventListener("pointermove", move);
      bar.classList.remove("dragging");
      const secs = at(ev.clientX);
      this.dragging = null;
      if (await this.send("seek", secs)) this.now = { ...n, elapsed: secs, at: Date.now() };
      this.progress();
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up, { once: true });
  }

  /** Space plays or pauses; arrows on the bar skip 10 seconds. */
  private key(e: KeyboardEvent) {
    const n = this.now;
    if (!n) return;
    const onBar = (e.target as HTMLElement).classList.contains("scrub");
    if (onBar && (e.key === "ArrowLeft" || e.key === "ArrowRight") && n.duration > 0) {
      e.preventDefault();
      const secs = Math.min(n.duration, Math.max(0, position(n) + (e.key === "ArrowRight" ? 10 : -10)));
      void this.send("seek", secs).then((ok) => {
        if (ok) this.now = { ...n, elapsed: secs, at: Date.now() };
        this.progress();
      });
    } else if (e.key === " " && (e.target as HTMLElement).tagName !== "BUTTON") {
      e.preventDefault();
      this.root.querySelector<HTMLButtonElement>("[data-act=toggle]")?.click();
    }
  }

  private progress() {
    const n = this.now;
    if (!n) return;
    const p = this.dragging ?? position(n);
    const pct = n.duration > 0 ? (p / n.duration) * 100 : 0;
    this.root.querySelector<HTMLElement>(".scrub")?.style.setProperty("--p", `${pct}%`);
    const elapsed = this.root.querySelector(".media-times .elapsed");
    if (elapsed) elapsed.textContent = mmss(p);
    const left = this.root.querySelector(".media-times .left");
    if (left) left.textContent = `-${mmss(Math.max(0, n.duration - p))}`;
    this.root.querySelector(".scrub")?.setAttribute("aria-valuenow", String(Math.round(p)));
    this.root.querySelector(".scrub")?.setAttribute("aria-valuetext", mmss(p));
  }

  render() {
    const n = this.now;
    const style = this.tint ? ` style="--tint:${this.tint};--on-tint:${onAccentText(this.tint)}"` : "";
    if (!n) {
      this.root.innerHTML = `<div class="player empty">
        <span class="media-art blank">${icon.music}</span>
        <span class="media-main"><b class="media-title">${t("media.empty.title")}</b><span class="media-by">${t("media.empty.body")}</span></span>
      </div>`;
      return;
    }
    const by = [n.artist, n.album].filter(Boolean).join(", ");
    const art = n.art ? `<img class="media-art" src="${esc(n.art)}" alt="">` : `<span class="media-art blank">${icon.music}</span>`;
    const p = position(n);
    const pct = n.duration > 0 ? (p / n.duration) * 100 : 0;
    const timeline =
      n.duration > 0
        ? `<div class="scrub" role="slider" tabindex="0" style="--p:${pct}%" aria-label="${t("media.seek")}" aria-valuemin="0" aria-valuemax="${Math.round(n.duration)}" aria-valuenow="${Math.round(p)}" aria-valuetext="${mmss(p)}"><span class="track"><i></i></span></div>
          <div class="media-times num"><span class="elapsed">${mmss(p)}</span><span class="left">-${mmss(Math.max(0, n.duration - p))}</span></div>`
        : `<p class="media-live"><i></i>${t("media.live")}</p>`;
    this.root.innerHTML = `<div class="player ${n.playing ? "playing" : "paused"}"${style}>
      ${art}
      <div class="media-main">
        ${n.app ? `<span class="media-app">${esc(t("media.from", { app: n.app }))}</span>` : ""}
        <b class="media-title" title="${esc(n.title)}">${esc(n.title)}</b>
        ${by ? `<span class="media-by" title="${esc(by)}">${esc(by)}</span>` : ""}
        ${timeline}
        <div class="media-controls">
          <button data-act="previous" aria-label="${t("media.previous")}">${icon.prev}</button>
          <button class="play" data-act="toggle" aria-label="${t(n.playing ? "media.pause" : "media.play")}">${n.playing ? icon.pause : icon.play}</button>
          <button data-act="next" aria-label="${t("media.next")}">${icon.next}</button>
        </div>
      </div>
    </div>`;
  }
}
