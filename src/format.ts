import { lang, t } from "./i18n";

// Number formatters follow the UI language (1,234.5 in English, 1.234,5 in Indonesian).
const one = () => new Intl.NumberFormat(lang(), { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const whole = () => new Intl.NumberFormat(lang(), { maximumFractionDigits: 0 });

export const GB = 1024 ** 3;

export function bytes(n: number): string {
  if (n >= GB) return `${one().format(n / GB)} GB`;
  if (n >= 1024 ** 2) return `${whole().format(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${whole().format(n / 1024)} KB`;
  return `${whole().format(n)} B`;
}

export const rate = (n: number) => t("unit.perSecond", { size: bytes(n) });
export const gb = (n: number) => one().format(n / GB);
export const pct = (n: number) => new Intl.NumberFormat(lang(), { style: "percent", maximumFractionDigits: 0 }).format(n / 100);

export function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 45) return t("clip.ago.now");
  if (s < 3600) return t("clip.ago.min", { count: Math.round(s / 60) });
  if (s < 86400) return t("clip.ago.hour", { count: Math.round(s / 3600) });
  if (s < 172800) return t("clip.ago.yesterday");
  return t("clip.ago.day", { count: Math.round(s / 86400) });
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** How long something ran: "42 sec", "3 min 5 sec", "1 hr 4 min". */
export function took(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return m ? t("dur.hrMin", { h, m }) : t("dur.hr", { h });
  if (m) return r ? t("dur.minSec", { m, s: r }) : t("dur.min", { m });
  return t("dur.sec", { s: r });
}
