import { t, type Key } from "./i18n";
import { icon } from "./icons";
import { FEATURES, MODES, loadModeState, pick, toggle, type FeatureId, type ModeId, type ModeState } from "./modes";

const KEY = "gentra:mode";

const MODE_ICON: Record<ModeId | "kustom", string> = {
  ringkas: icon.shrink,
  harian: icon.sun,
  dev: icon.terminal,
  rapat: icon.video,
  fokus: icon.timer,
  kustom: icon.sliders,
};

function read(): ModeState {
  try {
    return loadModeState(localStorage.getItem(KEY));
  } catch {
    return pick("harian");
  }
}

export const modeName = (s: ModeState) => t(`mode.${s.mode}` as Key);
export const modeIcon = (s: ModeState) => MODE_ICON[s.mode];

export class ModePanel {
  state = read();
  private root = document.getElementById("modePanel")!;

  constructor(private onChange: (s: ModeState) => void) {
    this.root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const card = t.closest<HTMLElement>("[data-mode]");
      if (card && card.dataset.mode !== "kustom") return this.set(pick(card.dataset.mode as ModeId));
      const sw = t.closest<HTMLButtonElement>("[data-feature]");
      if (sw && !sw.disabled) this.set(toggle(this.state, sw.dataset.feature as FeatureId));
    });
  }

  /** Switches to a preset from elsewhere, e.g. the first-run guide. */
  choose(mode: ModeId) {
    this.set(pick(mode));
  }

  private set(s: ModeState) {
    this.state = s;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // The mode still applies for this session.
    }
    this.render();
    this.onChange(s);
  }

  render() {
    const s = this.state;
    const cards = (Object.keys(MODES) as ModeId[])
      .map(
        (id) =>
          `<button class="mode-card" data-mode="${id}" aria-pressed="${s.mode === id}">${MODE_ICON[id]}<b>${t(`mode.${id}` as Key)}</b><span>${t(`mode.line.${id}` as Key)}</span></button>`,
      )
      .join("");
    const custom = `<div class="mode-card static" aria-current="${s.mode === "kustom"}">${MODE_ICON.kustom}<b>${t("mode.kustom")}</b><span>${
      s.mode === "kustom" ? t("mode.custom.based", { mode: t(`mode.${s.base}` as Key) }) : t("mode.custom.hint")
    }</span></div>`;
    const rows = FEATURES.map((f) => {
      const on = s.on.includes(f.id);
      const name = t(`feature.${f.id}` as Key);
      return `<div class="feat-row${f.ready ? "" : " soon"}"><span>${name}${f.ready ? "" : ` <em>${t("mode.soon")}</em>`}</span>
        <button class="switch" role="switch" data-feature="${f.id}" aria-checked="${on}" aria-label="${name}" ${f.ready ? "" : "disabled"}></button></div>`;
    }).join("");
    this.root.innerHTML = `<div class="modes-wrap">
      <div class="mode-cards" role="group" aria-label="${t("mode.pick")}">${cards}${custom}</div>
      <div class="feat-list" role="group" aria-label="${t("mode.features")}">${rows}</div>
      <p class="note">${t("mode.note")}</p>
    </div>`;
  }
}
