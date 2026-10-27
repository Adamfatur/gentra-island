import { clock, isDone, pause, progress, remaining, resume, start, type Timer } from "./focus";
import { t } from "./i18n";
import { icon } from "./icons";

const KEY = "gentra:focus";
const PRESETS = [5, 15, 25, 50];

function read(): Timer | null {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return t && typeof t.total === "number" ? t : null;
  } catch {
    return null;
  }
}

/** A short two-note chime, made on the fly so no audio file ships. */
export function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.65);
    });
  } catch {
    // No audio device: the visual notice is enough.
  }
}

export class FocusPanel {
  timer: Timer | null = read();
  private root = document.getElementById("focusPanel")!;

  constructor(
    private onChange: () => void,
    private onDone: () => void,
  ) {
    this.root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!b) return;
      const now = Date.now();
      const act = b.dataset.act!;
      if (act.startsWith("start:")) this.set(start(Number(act.slice(6)), now));
      else if (act === "pause" && this.timer) this.set(pause(this.timer, now));
      else if (act === "resume" && this.timer) this.set(resume(this.timer, now));
      else if (act === "stop") this.set(null);
    });
    window.setInterval(() => this.tick(), 1000);
  }

  /** Starts a session from elsewhere, e.g. Home's quick start button. */
  begin(minutes: number) {
    this.set(start(minutes, Date.now()));
  }

  /** Ends a running session, e.g. when the user's mode switches Fokus off. */
  stop() {
    if (this.timer) this.set(null);
  }

  get running() {
    return this.timer !== null;
  }

  /** Text for the compact island, e.g. "18:42". */
  get label() {
    return this.timer ? clock(remaining(this.timer, Date.now())) : "";
  }

  /** How much of the session is left: 1 at the start, 0 at the end, 0 with none running. */
  get left() {
    return this.timer ? remaining(this.timer, Date.now()) / this.timer.total : 0;
  }

  get paused() {
    return this.timer?.pausedLeft != null;
  }

  private set(t: Timer | null) {
    this.timer = t;
    try {
      t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY);
    } catch {
      // The timer still runs for this session.
    }
    this.render();
    this.onChange();
  }

  private tick() {
    if (!this.timer) return;
    if (isDone(this.timer, Date.now())) {
      this.set(null);
      chime();
      this.onDone();
      return;
    }
    this.onChange();
    this.updateClock();
  }

  private updateClock() {
    if (!this.timer) return;
    const now = Date.now();
    const el = this.root.querySelector(".focus-clock");
    if (el) el.textContent = clock(remaining(this.timer, now));
    const ring = this.root.querySelector<SVGCircleElement>(".focus-ring .fill");
    if (ring) ring.style.strokeDashoffset = String(301.6 * progress(this.timer, now));
  }

  render() {
    if (!this.timer) {
      this.root.innerHTML = `<div class="focus idle">
        <div class="focus-intro"><b>${t("focus.ask")}</b><span>${t("focus.askBody")}</span></div>
        <div class="presets">${PRESETS.map((m) => `<button data-act="start:${m}"><b class="num">${m}</b><span>${t("focus.minutes")}</span></button>`).join("")}</div>
      </div>`;
      return;
    }
    const paused = this.paused;
    this.root.innerHTML = `<div class="focus">
      <svg class="focus-ring" viewBox="0 0 108 108"><circle cx="54" cy="54" r="48" class="track"/><circle cx="54" cy="54" r="48" class="fill"/></svg>
      <div class="focus-main">
        <div class="focus-clock num"></div>
        <div class="muted">${paused ? t("focus.paused") : t("focus.running", { count: Math.round(this.timer.total / 60000) })}</div>
      </div>
      <div class="focus-actions">
        ${paused ? `<button class="primary" data-act="resume">${icon.play}<span>${t("focus.resume")}</span></button>` : `<button class="primary" data-act="pause">${icon.pause}<span>${t("focus.pause")}</span></button>`}
        <button data-act="stop">${icon.stop}<span>${t("focus.end")}</span></button>
      </div>
    </div>`;
    this.updateClock();
  }
}
