// When the system says no, the island walks the user through fixing it:
// numbered steps for their system, a button that opens the right settings
// page, and a "Try again" that checks for real.

import { esc } from "./format";
import { t, type Key } from "./i18n";
import { icon } from "./icons";

export type Platform = "macos" | "windows" | "linux";
/** denied: the user or system said no. busy: another app has it. missing: no device. unsupported: this system can't. */
export type Problem = "denied" | "busy" | "missing" | "unsupported";

export interface Guide {
  title: string;
  steps: string[];
  /** Show a button that opens the system's privacy page. */
  openSettings: boolean;
  /** Show "Try again"; false when nothing the user does here will help. */
  retry: boolean;
}

/** Turns a getUserMedia error name into something the user can act on. */
export function problemOf(errorName: string | undefined): Problem {
  switch (errorName) {
    case "NotAllowedError":
    case "SecurityError":
      return "denied";
    case "NotReadableError":
    case "AbortError":
      return "busy";
    case "NotFoundError":
    case "OverconstrainedError":
      return "missing";
    default:
      return "unsupported";
  }
}

const STEPS: Record<Problem, Partial<Record<Platform, Key[]>> & { all?: Key[] }> = {
  denied: {
    macos: ["perm.camera.mac.1", "perm.camera.mac.2", "perm.camera.mac.3", "perm.camera.mac.4"],
    windows: ["perm.camera.win.1", "perm.camera.win.2", "perm.camera.win.3", "perm.camera.win.4"],
    linux: ["perm.camera.linux.1", "perm.camera.linux.2", "perm.camera.linux.3"],
  },
  busy: { all: ["perm.camera.busy.1", "perm.camera.busy.2"] },
  missing: { all: ["perm.camera.missing.1", "perm.camera.missing.2"] },
  unsupported: { all: ["perm.camera.unsupported.1"] },
};

const TITLE: Record<Problem, Key> = {
  denied: "perm.camera.title",
  busy: "perm.camera.busy.title",
  missing: "perm.camera.missing.title",
  unsupported: "perm.camera.unsupported.title",
};

export function cameraGuide(problem: Problem, platform: Platform): Guide {
  const keys = STEPS[problem][platform] ?? STEPS[problem].all ?? [];
  return {
    title: t(TITLE[problem]),
    steps: keys.map((k) => t(k)),
    openSettings: problem === "denied",
    retry: problem !== "unsupported",
  };
}

/** The guide as a card. Buttons carry data-act="perm-open" and the given retry action. */
export function guideHtml(g: Guide, retryAct: string): string {
  const steps = g.steps.map((s, i) => `<li><span class="perm-n num">${i + 1}</span><span>${esc(s)}</span></li>`).join("");
  const open = g.openSettings ? `<button class="primary" data-act="perm-open">${icon.gear}<span>${t("perm.open.camera")}</span></button>` : "";
  const retry = g.retry ? `<button data-act="${retryAct}">${t("perm.retry")}</button>` : "";
  return `<div class="perm" role="group" aria-label="${esc(g.title)}">
    <b class="perm-title">${icon.warning}${esc(g.title)}</b>
    <ol class="perm-steps">${steps}</ol>
    ${open || retry ? `<div class="perm-actions">${open}${retry}</div>` : ""}
  </div>`;
}
