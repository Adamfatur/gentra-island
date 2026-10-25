import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { errorText, t, type Key } from "./i18n";
import { icon } from "./icons";
import { type ModeId } from "./modes";
import { GUIDE_VERSION, LAST_STEP, clampStep } from "./onboarding";

const KEY = "gentra:guide";
const QUICK_MODES: ModeId[] = ["ringkas", "harian", "dev"];

/** A dev build loads its UI from the Vite server, so launching it at login would show an empty island. */
export const LOGIN_LAUNCH_AVAILABLE = !import.meta.env.DEV;

export function markGuideDone() {
  try {
    localStorage.setItem(KEY, String(GUIDE_VERSION));
  } catch {
    // Without storage the guide shows again next launch; harmless.
  }
}

export function savedGuide(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Login launch helpers shared with Settings. Errors surface as messages. */
export async function loginLaunch(): Promise<boolean> {
  try {
    return await isEnabled();
  } catch {
    return false;
  }
}

export async function setLoginLaunch(on: boolean): Promise<void> {
  await (on ? enable() : disable());
}

export class GuidePanel {
  private step = 0;
  private launch = LOGIN_LAUNCH_AVAILABLE;
  private root = document.getElementById("guidePanel")!;

  constructor(
    private env: { notched: boolean; mac: boolean },
    private currentMode: () => ModeId | "kustom",
    private onPickMode: (m: ModeId) => void,
    private onDone: (problem?: string) => void,
  ) {
    this.root.addEventListener("click", (e) => this.click(e));
  }

  restart() {
    this.step = 0;
    this.render();
  }

  private click(e: Event) {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
    const mode = target.closest<HTMLElement>("[data-pick]")?.dataset.pick as ModeId | undefined;
    if (mode) {
      this.onPickMode(mode);
      return this.render();
    }
    if (act === "launch") {
      this.launch = !this.launch;
      return this.render();
    }
    if (act === "back") this.step = clampStep(this.step - 1);
    if (act === "next") this.step = clampStep(this.step + 1);
    if (act === "skip" || act === "finish") return void this.finish(act === "finish");
    this.render();
  }

  private async finish(applyLaunch: boolean) {
    markGuideDone();
    let problem: string | undefined;
    if (applyLaunch && LOGIN_LAUNCH_AVAILABLE) {
      try {
        // Only touch the login item when it differs from what the user chose.
        if ((await loginLaunch()) !== this.launch) await setLoginLaunch(this.launch);
      } catch (err) {
        problem = t("guide.loginFailed", { error: errorText(err) });
      }
    }
    this.onDone(problem);
  }

  render() {
    const s = this.step;
    const total = LAST_STEP + 1;
    const bars = `<div class="guide-steps" role="img" aria-label="${t("guide.step", { step: s + 1, total })}">${[0, 1, 2]
      .map((i) => `<i class="${i <= s ? "on" : ""}"></i>`)
      .join("")}</div>`;
    const keys: [string, Key][] = this.env.mac
      ? [["⌥⌘G", "guide.2.open"], ["⌥⌘V", "guide.2.clip"], ["⌘1-5", "guide.2.switch"]]
      : [["Ctrl+Alt+G", "guide.2.open"], ["Ctrl+Alt+V", "guide.2.clip"], ["Ctrl+1-5", "guide.2.switch"]];
    const current = this.currentMode();
    const devNote = LOGIN_LAUNCH_AVAILABLE ? "" : `<small>${t("settings.login.devNote")}</small>`;
    const bodies = [
      `<h4>${t(this.env.notched ? "guide.1.title.notch" : "guide.1.title.top")}</h4><p>${t("guide.1.body")}</p>`,
      `<h4>${t("guide.2.title")}</h4><p>${t("guide.2.body")}</p>
       <div class="guide-keys">${keys.map(([k, d]) => `<span><kbd>${k}</kbd>${t(d)}</span>`).join("")}</div>`,
      `<h4>${t("guide.3.title")}</h4><p>${t("guide.3.body")}</p>
       <div class="guide-modes">${QUICK_MODES.map(
         (m) => `<button class="mode-card" data-pick="${m}" aria-pressed="${current === m}"><b>${t(`mode.${m}` as Key)}</b><span>${t(`mode.line.${m}` as Key)}</span></button>`,
       ).join("")}</div>
       <div class="guide-toggle"><span>${t("settings.login")}${devNote}</span><button class="switch" role="switch" data-act="launch" aria-checked="${this.launch}" aria-label="${t("settings.login")}" ${LOGIN_LAUNCH_AVAILABLE ? "" : "disabled"}></button></div>`,
    ];
    const nav = `<div class="guide-nav">
      ${s === 0 ? `<button data-act="skip">${t("guide.skip")}</button>` : `<button data-act="back">${t("guide.back")}</button>`}
      <button class="primary" data-act="${s === LAST_STEP ? "finish" : "next"}">${s === LAST_STEP ? `${icon.check}<span>${t("guide.done")}</span>` : t("guide.next")}</button>
    </div>`;
    this.root.innerHTML = `<div class="guide">${bars}${bodies[s]}${nav}</div>`;
    this.root.querySelector<HTMLElement>(".guide-nav .primary")?.focus({ preventScroll: true });
  }
}
