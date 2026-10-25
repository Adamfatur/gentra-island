import { invoke } from "@tauri-apps/api/core";
import { clock } from "./focus";
import { esc } from "./format";
import { errorText, t } from "./i18n";
import { icon } from "./icons";
import { cameraGuide, guideHtml, problemOf, type Platform, type Problem } from "./permission";

export interface Mic {
  inUse: boolean;
  app: string | null;
  /** null when this system can't read mute. */
  muted: boolean | null;
  /** Unix seconds when the mic went live. */
  since: number;
}

/** Call time so far, e.g. "12:04". */
export const callTime = (m: Mic) => clock(Math.max(0, Date.now() - m.since * 1000));

/** Calls tab: who is using the mic, a system mute button, and a camera mirror. */
export class CallPanel {
  meeting = true;
  mirror = true;
  mic: Mic | null = null;
  private root = document.getElementById("callPanel")!;
  private stream: MediaStream | null = null;
  /** Why the camera didn't open, if it didn't; drives the step-by-step guide. */
  private problem: Problem | null = null;
  private tick = 0;

  constructor(
    private toast: (msg: string) => void,
    private platform: Platform,
  ) {
    this.root.addEventListener("click", (e) => void this.click(e));
  }

  show() {
    this.render();
    window.clearInterval(this.tick);
    // Only the clock moves; redraw just that line once a second.
    this.tick = window.setInterval(() => {
      const el = this.root.querySelector(".call-time");
      if (el && this.mic?.inUse) el.textContent = t("call.mic.time", { time: callTime(this.mic) });
    }, 1000);
  }

  /** Leaving the tab turns the camera off; nothing keeps running. */
  hide() {
    window.clearInterval(this.tick);
    this.tick = 0;
    this.stopCamera();
  }

  setMic(m: Mic) {
    this.mic = m;
    if (this.tick) this.render();
  }

  private async click(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!b) return;
    try {
      if (b.dataset.act === "mute" && this.mic) {
        const muted = !this.mic.muted;
        await invoke("mic_set_muted", { muted });
        this.mic = { ...this.mic, muted };
        this.toast(t(muted ? "call.muted" : "call.unmuted"));
      } else if (b.dataset.act === "camera-on") {
        await this.startCamera();
      } else if (b.dataset.act === "camera-off") {
        this.stopCamera();
      } else if (b.dataset.act === "perm-open") {
        await invoke("open_privacy_settings", { kind: "camera" });
      }
    } catch (err) {
      this.toast(errorText(err));
    }
    this.render();
  }

  private async startCamera() {
    this.problem = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false });
      // The permission prompt can outlive the tab: if it closed meanwhile, turn the camera straight off.
      if (!this.tick) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
    } catch (err) {
      this.problem = problemOf((err as DOMException)?.name);
    }
  }

  stopCamera() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    const video = this.root.querySelector("video");
    if (video) video.srcObject = null;
  }

  render() {
    const parts: string[] = [];
    if (this.meeting) parts.push(this.micHtml());
    if (this.mirror) parts.push(this.mirrorHtml());
    this.root.innerHTML = `<div class="calls">${parts.join("")}</div>`;
    const video = this.root.querySelector("video");
    if (video && this.stream) video.srcObject = this.stream;
  }

  private micHtml() {
    const m = this.mic;
    if (!m?.inUse) {
      // A mute set during a call outlives it; keep the way back visible.
      const unmute = m?.muted ? `<button class="primary" data-act="mute">${icon.mic}<span>${t("call.unmute")}</span></button>` : "";
      return `<section class="mic-card ${m?.muted ? "live muted" : ""}">
        <span class="mic-ic">${m?.muted ? icon.micOff : icon.mic}</span>
        <span class="mic-text"><b>${t("call.mic.idle.title")}</b><span>${t(m?.muted ? "call.mic.mutedNote" : "call.mic.idle.body")}</span></span>
        ${unmute}
      </section>`;
    }
    const title = m.app ? t("call.mic.app", { app: m.app }) : t("call.mic.some");
    const mute =
      m.muted === null
        ? ""
        : `<button class="${m.muted ? "primary" : ""}" data-act="mute">${m.muted ? icon.mic : icon.micOff}<span>${t(m.muted ? "call.unmute" : "call.mute")}</span></button>`;
    return `<section class="mic-card live ${m.muted ? "muted" : ""}">
      <span class="mic-ic">${m.muted ? icon.micOff : icon.mic}</span>
      <span class="mic-text"><b>${esc(title)}</b><span class="call-time num">${t("call.mic.time", { time: callTime(m) })}</span>${
        m.muted ? `<span class="muted">${t("call.mic.mutedNote")}</span>` : ""
      }</span>
      ${mute}
    </section>`;
  }

  private mirrorHtml() {
    const head = `<h3>${icon.camera}${t("call.mirror")}</h3>`;
    if (this.stream) {
      return `<section class="mirror">${head}
        <div class="mirror-view"><video autoplay muted playsinline></video></div>
        <button data-act="camera-off">${icon.stop}<span>${t("call.mirror.stop")}</span></button>
      </section>`;
    }
    if (this.problem) {
      return `<section class="mirror">${head}${guideHtml(cameraGuide(this.problem, this.platform), "camera-on")}</section>`;
    }
    return `<section class="mirror">${head}
      <p class="muted">${t("call.mirror.body")}</p>
      <button class="primary" data-act="camera-on">${icon.camera}<span>${t("call.mirror.start")}</span></button>
    </section>`;
  }
}
