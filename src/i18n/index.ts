import { createI18n, resolveLang, type Msg, type Params } from "./core";
import { en, type Key } from "./en";
import { id } from "./id";

/** Change the product name here; every string reads it as {app}. */
export const APP_NAME = "Gentra Island";
/** Credit for the original author. Keep it in every build and fork. */
export const APP_AUTHOR = "Adam Faturahman";

/** Native names, so people can find their language without reading English. */
export const LANGUAGES = [
  { id: "en", name: "English", dir: "ltr" },
  { id: "id", name: "Bahasa Indonesia", dir: "ltr" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["id"];
export const DICTS: Record<Lang, Record<Key, Msg>> = { en, id };

const i18n = createI18n<Lang>(DICTS, { en: "ltr", id: "ltr" });
const STORE = "gentra:lang";
const listeners = new Set<() => void>();

export type { Key };

export const t = (key: Key, params?: Params) => i18n.t(key, { app: APP_NAME, ...params });
export const lang = () => i18n.lang();

/** The backend reports known failures as codes; unknown ones pass through as-is. */
export function errorText(err: unknown): string {
  const code = String(err);
  const key = `error.${code}` as Key;
  const text = t(key);
  return text === key ? code : text;
}

/** Fills every element marked with data-i18n* attributes. */
export function translateStatic(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n as Key)));
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria as Key)));
  root.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh as Key)));
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle as Key)));
}

function applyDocument() {
  if (typeof document === "undefined") return; // unit tests
  document.documentElement.lang = i18n.lang();
  document.documentElement.dir = i18n.dir();
  translateStatic();
}

export function initLanguage() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORE);
  } catch {
    // English, then.
  }
  i18n.setLang(resolveLang<Lang>(saved, LANGUAGES.map((l) => l.id)));
  applyDocument();
}

export function setLanguage(l: Lang) {
  i18n.setLang(l);
  try {
    localStorage.setItem(STORE, l);
  } catch {
    // Applies for this session only.
  }
  applyDocument();
  listeners.forEach((fn) => fn());
}

export function onLanguageChange(fn: () => void) {
  listeners.add(fn);
}
