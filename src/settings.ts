import { invoke } from "@tauri-apps/api/core";
import { LOGIN_LAUNCH_AVAILABLE, loginLaunch, setLoginLaunch } from "./guidePanel";
import { APP_AUTHOR, LANGUAGES, errorText, lang, setLanguage, t, type Key, type Lang } from "./i18n";
import wordmark from "../assets/brand/gentra-island-wordmark.svg?raw";
import { icon } from "./icons";
import { DEFAULTS, loadSettings, onAccentText, readableAccent, resolveTheme, type Settings, type ThemeMode } from "./theme";

const KEY = "gentra:settings";

/** Default accent per theme, and the surface accents are checked against. */
const THEME = {
  dark: { accent: "#5AC8FA", surface: "#17171B" },
  light: { accent: "#0A66C2", surface: "#EEEEF2" },
} as const;

const SWATCHES = ["#FF6A3D", "#34C759", "#AF52DE", "#FF375F", "#FFB547"];

const THEMES: { id: ThemeMode; label: Key; icon: string }[] = [
  { id: "auto", label: "settings.theme.auto", icon: icon.auto },
  { id: "dark", label: "settings.theme.dark", icon: icon.moon },
  { id: "light", label: "settings.theme.light", icon: icon.sun },
];

function read(): Settings {
  try {
    return loadSettings(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULTS };
  }
}

export class SettingsPanel {
  settings = read();
  private media = matchMedia("(prefers-color-scheme: dark)");
  private root = document.getElementById("settingsPanel")!;

  /** Set by main once the toast and guide exist. */
  hooks: { toast: (msg: string) => void; replayGuide: () => void } | null = null;

  constructor() {
    this.media.addEventListener("change", () => this.apply());
    this.root.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("#replayGuide")) return this.hooks?.replayGuide();
      if (target.closest("#coffee")) {
        return void invoke("open_support").catch((err) => this.hooks?.toast(errorText(err)));
      }
      const sw = target.closest<HTMLButtonElement>("#loginSw");
      if (sw) {
        const on = sw.getAttribute("aria-checked") !== "true";
        try {
          await setLoginLaunch(on);
          sw.setAttribute("aria-checked", String(on));
          this.hooks?.toast(t(on ? "settings.login.on" : "settings.login.off"));
        } catch (err) {
          this.hooks?.toast(t("settings.login.failed", { error: errorText(err) }));
        }
        return;
      }
      const language = target.closest<HTMLElement>("[data-lang]")?.dataset.lang as Lang | undefined;
      if (language) {
        setLanguage(language);
        return this.render();
      }
      const theme = target.closest<HTMLElement>("[data-theme-mode]")?.dataset.themeMode as ThemeMode | undefined;
      if (theme) return this.update({ theme });
      const swatch = target.closest<HTMLElement>("[data-accent]");
      if (swatch) return this.update({ accent: swatch.dataset.accent || null });
    });
    this.root.addEventListener("input", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.id === "accentPick") this.update({ accent: input.value.toUpperCase() });
    });
    this.apply();
  }

  private update(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      // Storage can be unavailable; the choice still applies for this session.
    }
    this.apply();
    this.render();
  }

  /** Sets the theme attribute and a legible accent for that theme. */
  apply() {
    const theme = resolveTheme(this.settings.theme, this.media.matches);
    document.documentElement.dataset.theme = theme;
    const base = THEME[theme];
    const accent = readableAccent(this.settings.accent ?? base.accent, base.surface);
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--on-accent", onAccentText(accent));
    // The closed island on a notch is always black, whatever the theme.
    const onBlack = readableAccent(this.settings.accent ?? THEME.dark.accent, THEME.dark.surface);
    document.documentElement.style.setProperty("--accent-on-black", onBlack);
  }

  render() {
    const { theme, accent } = this.settings;
    const themes = THEMES.map(
      (m) => `<button class="seg" data-theme-mode="${m.id}" aria-pressed="${theme === m.id}">${m.icon}<span>${t(m.label)}</span></button>`,
    ).join("");
    const swatches = [
      `<button class="swatch default" data-accent="" aria-pressed="${accent === null}" aria-label="${t("settings.accent.default")}"><span></span></button>`,
      ...SWATCHES.map(
        (c) => `<button class="swatch" data-accent="${c}" aria-pressed="${accent === c}" aria-label="${t("settings.accent.swatch", { color: c })}"><span style="background:${c}"></span></button>`,
      ),
    ].join("");
    const custom = accent && !SWATCHES.includes(accent);
    const languages = LANGUAGES.map(
      (l) => `<button class="seg lang-seg" data-lang="${l.id}" lang="${l.id}" dir="${l.dir}" aria-pressed="${lang() === l.id}"><span>${l.name}</span></button>`,
    ).join("");
    const devNote = LOGIN_LAUNCH_AVAILABLE ? "" : `<small>${t("settings.login.devNote")}</small>`;
    this.root.innerHTML = `<div class="settings">
      <section>
        <h3>${t("settings.theme")}</h3>
        <div class="segs" role="group" aria-label="${t("settings.theme")}">${themes}</div>
        <p class="note">${t("settings.theme.note")}</p>
      </section>
      <section>
        <h3>${t("settings.accent")}</h3>
        <div class="swatches" role="group" aria-label="${t("settings.accent")}">
          ${swatches}
          <label class="swatch pick" aria-pressed="${Boolean(custom)}" title="${t("settings.accent.custom")}">
            <input type="color" id="accentPick" value="${accent ?? THEME.dark.accent}" aria-label="${t("settings.accent.custom")}">
            ${icon.paint}
          </label>
        </div>
        <p class="note">${t("settings.accent.note")}</p>
      </section>
      <section>
        <h3>${t("settings.language")}</h3>
        <div class="segs" role="group" aria-label="${t("settings.language")}">${languages}</div>
        <p class="note">${t("settings.language.note")}</p>
      </section>
      <section class="startup">
        <h3>${t("settings.startup")}</h3>
        <div class="setting-row"><span>${t("settings.login")}${devNote}</span><button class="switch" role="switch" id="loginSw" aria-checked="false" aria-label="${t("settings.login")}" ${LOGIN_LAUNCH_AVAILABLE ? "" : "disabled"}></button></div>
        <button class="link-btn" id="replayGuide">${t("settings.guide")}</button>
      </section>
      <section class="about" aria-label="${t("settings.about")}">
        <div class="about-id">
          <span class="about-logo">${wordmark}</span>
          <p>${t("settings.about.version", { version: __APP_VERSION__ })}. ${t("settings.about.madeBy", { author: APP_AUTHOR })}. ${t("settings.about.license")}</p>
          <p class="note">${t("about.coffeeNote")}</p>
        </div>
        <button class="coffee" id="coffee">${icon.coffee}<span>${t("about.coffee")}</span></button>
      </section>
    </div>`;
    // The login item lives in the OS; read it fresh each time Settings opens.
    void loginLaunch().then((on) => this.root.querySelector("#loginSw")?.setAttribute("aria-checked", String(on)));
  }
}
