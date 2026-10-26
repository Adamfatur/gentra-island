import { invoke } from "@tauri-apps/api/core";
import { careAnswer, careTick, loadCare, type CareKind, type CareState, type Nudge } from "./care";
import { esc } from "./format";
import { t, type Key } from "./i18n";
import { icon } from "./icons";

const KEY = "gentra:care";
const VARIANTS: Record<CareKind, number> = { break: 3, water: 3, lunch: 2, dinner: 2, late: 2 };
const ICON: Record<CareKind, string> = { break: icon.walk, water: icon.water, lunch: icon.meal, dinner: icon.meal, late: icon.night };
const COLOR: Record<CareKind, string> = { break: "var(--ok)", water: "var(--accent)", lunch: "var(--warn)", dinner: "var(--warn)", late: "var(--accent)" };

/** "50 minutes", "1 hour and 5 minutes", "1 jam 5 menit". */
export function careTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const mins = t("care.dur.min", { count: m });
  if (!h) return mins;
  const hours = t("care.dur.hr", { count: h });
  return m ? t("care.dur.hrMin", { hours, minutes: mins }) : hours;
}

/** The peek's contents for a nudge, with its three answers. */
export function careHtml(n: Nudge): string {
  const v = (n.variant % VARIANTS[n.kind]) + 1;
  const time = careTime(Math.max(1, n.activeMin));
  const title = t(`care.${n.kind}.t${v}` as Key, { time });
  const body = t(`care.${n.kind}.b${v}` as Key, { time });
  return `<span class="ic" style="color:${COLOR[n.kind]}">${ICON[n.kind]}</span>
    <div class="peek-main"><div class="t">${esc(title)}</div><div class="s clamp2">${esc(body)}</div>
      <div class="peek-acts" data-care-kind="${n.kind}">
        <button class="primary" data-care="ok">${esc(t(`care.ok.${n.kind}` as Key))}</button>
        <button data-care="later">${t("care.later")}</button>
        <button data-care="today">${t("care.today")}</button>
      </div></div>`;
}

/**
 * Checks once a minute, only while the feature is on. Reading the idle time
 * is one cheap system call; nothing else runs in between.
 */
export class Care {
  private state: CareState;
  private timer = 0;

  constructor(
    private busy: () => boolean,
    private show: (html: string) => void,
  ) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      /* starts fresh each launch */
    }
    this.state = loadCare(raw, new Date());
  }

  setEnabled(on: boolean) {
    window.clearInterval(this.timer);
    this.timer = 0;
    if (on) this.timer = window.setInterval(() => void this.tick(), 60_000);
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* kept for this session */
    }
  }

  private async tick() {
    const idle = await invoke<number | null>("idle_secs").catch(() => null);
    const r = careTick(this.state, { now: new Date(), idle, busy: this.busy() });
    this.state = r.state;
    this.save();
    if (r.nudge) this.show(careHtml(r.nudge));
  }

  answer(kind: CareKind, answer: "ok" | "later" | "today"): string | null {
    this.state = careAnswer(this.state, kind, answer, new Date());
    this.save();
    if (answer === "today") return t("care.muted");
    return answer === "ok" && kind !== "late" ? t("care.thanks") : null;
  }
}
