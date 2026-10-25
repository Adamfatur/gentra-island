// Recognises what a copied string *is* and offers a decoded form of it.
// Pure functions of their input and the current language; unit-tested.

import { lang, t as msg } from "./i18n";

export type InsightKind = "jwt" | "timestamp" | "date" | "json" | "base64" | "urlencoded" | "color" | "cron";

export interface Insight {
  kind: InsightKind;
  /** Short name shown on the card, e.g. "JWT". */
  label: string;
  /** One line shown under the card and in the peek. */
  summary: string;
  /** Longer decoded content for the inspector. */
  detail?: string;
  /** Text the "copy result" action puts on the clipboard. */
  output?: string;
  outputLabel?: string;
}

type Detector = (t: string, now: number) => Insight | null;

export function analyze(text: string, now = Date.now()): Insight[] {
  const t = text.trim();
  if (!t || t.length > 20_000) return [];
  const found: Insight[] = [];
  for (const detect of DETECTORS) {
    const hit = detect(t, now);
    if (hit) found.push(hit);
  }
  return found;
}

/* ---------- helpers ---------- */

function relative(deltaSec: number): string {
  const s = Math.abs(deltaSec);
  if (s < 60) return msg("time.lessThanMinute");
  if (s < 3600) return msg("time.minutes", { count: Math.round(s / 60) });
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    if (m && m < 60) return msg("time.hoursMinutes", { hours: msg("time.hours", { count: h }), minutes: msg("time.minutes", { count: m }) });
    return msg("time.hours", { count: Math.round(s / 3600) });
  }
  return msg("time.days", { count: Math.round(s / 86400) });
}

const when = (deltaSec: number) =>
  deltaSec >= 0 ? msg("insight.time.in", { time: relative(deltaSec) }) : msg("insight.time.ago", { time: relative(deltaSec) });

const formatDate = (d: Date) =>
  new Intl.DateTimeFormat(lang(), {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);

function decodeBase64(s: string): string | null {
  try {
    let b = s.replace(/-/g, "+").replace(/_/g, "/");
    b += "=".repeat((4 - (b.length % 4)) % 4);
    const bin = atob(b);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** True when a decoded string looks like something a person would read. */
function readable(s: string): boolean {
  if (s.length < 4 || /[\u0000-\u0008\u000e-\u001f\u007f�]/.test(s)) return false;
  const good = s.match(/[\p{L}\p{N}\p{P}\p{Zs}\n\t]/gu)?.length ?? 0;
  return good / s.length > 0.9;
}

/* ---------- detectors ---------- */

const jwt: Detector = (t, now) => {
  const parts = t.split(".");
  if (parts.length !== 3 || !/^[\w-]+$/.test(parts[0]) || !/^[\w-]+$/.test(parts[1])) return null;
  const header = decodeBase64(parts[0]);
  const body = decodeBase64(parts[1]);
  if (!header || !body) return null;
  try {
    const h = JSON.parse(header);
    const p = JSON.parse(body);
    if (typeof h !== "object" || !h.alg) return null;
    const alg = String(h.alg);
    let summary = msg("insight.jwt.noExpiry", { alg });
    if (typeof p.exp === "number") {
      const delta = p.exp - now / 1000;
      summary = delta >= 0 ? msg("insight.jwt.expiresIn", { alg, time: relative(delta) }) : msg("insight.jwt.expiredAgo", { alg, time: relative(delta) });
    }
    const output = JSON.stringify(p, null, 2);
    return { kind: "jwt", label: msg("insight.jwt"), summary, detail: output, output, outputLabel: msg("insight.copy.payload") };
  } catch {
    return null;
  }
};

const json: Detector = (t) => {
  const looks = (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
  if (!looks) return null;
  try {
    const v = JSON.parse(t);
    const summary = Array.isArray(v) ? msg("insight.json.items", { count: v.length }) : msg("insight.json.keys", { count: Object.keys(v).length });
    const pretty = t.includes("\n");
    const output = pretty ? JSON.stringify(v) : JSON.stringify(v, null, 2);
    return {
      kind: "json",
      label: msg("insight.json"),
      summary,
      detail: JSON.stringify(v, null, 2),
      output,
      outputLabel: pretty ? msg("insight.copy.compact") : msg("insight.copy.pretty"),
    };
  } catch {
    return { kind: "json", label: msg("insight.json"), summary: msg("insight.json.invalid") };
  }
};

const timestamp: Detector = (t, now) => {
  let ms: number;
  if (/^\d{10}$/.test(t)) ms = Number(t) * 1000;
  else if (/^\d{13}$/.test(t)) ms = Number(t);
  else return null;
  // 2001 to 2100: wide enough for real timestamps, narrow enough to skip IDs.
  if (ms < 978_307_200_000 || ms > 4_102_444_800_000) return null;
  const d = new Date(ms);
  const output = d.toISOString();
  return {
    kind: "timestamp",
    label: msg("insight.timestamp"),
    summary: `${formatDate(d)}, ${when((ms - now) / 1000)}`,
    detail: output,
    output,
    outputLabel: msg("insight.copy.iso"),
  };
};

const date: Detector = (t) => {
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(t)) return null;
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) return null;
  const secs = String(Math.floor(ms / 1000));
  return { kind: "date", label: msg("insight.date"), summary: msg("insight.date.unix", { date: formatDate(new Date(ms)), secs }), output: secs, outputLabel: msg("insight.copy.unix") };
};

function parseColor(t: string): [number, number, number] | null {
  const hex = t.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = t.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map(Number) as [number, number, number];
  return null;
}

function toHsl([r, g, b]: [number, number, number]): string {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
  }
  h = Math.round(h * 60 + 360) % 360;
  return `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

const color: Detector = (t) => {
  const c = parseColor(t);
  if (!c) return null;
  const rgb = `rgb(${c.join(", ")})`;
  const hex = `#${c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  const fromHex = t.startsWith("#");
  return {
    kind: "color",
    label: msg("insight.color"),
    summary: fromHex ? `${rgb} / ${toHsl(c)}` : `${hex} / ${toHsl(c)}`,
    output: fromHex ? rgb : hex,
    outputLabel: fromHex ? msg("insight.copy.rgb") : msg("insight.copy.hex"),
  };
};

/** Weekday names from Intl, so every language gets its own (cron 0 and 7 are Sunday). */
function dayName(n: number): string {
  const sunday = Date.UTC(2023, 0, 1); // a Sunday
  return new Intl.DateTimeFormat(lang(), { weekday: "long", timeZone: "UTC" }).format(new Date(sunday + (n % 7) * 86_400_000));
}

function clockTime(h: string, m: string): string {
  return new Intl.DateTimeFormat(lang(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(
    new Date(Date.UTC(2023, 0, 1, Number(h), Number(m))),
  );
}

function cronDays(dow: string): string | null {
  if (/^\d$/.test(dow)) return dayName(Number(dow));
  const range = dow.match(/^(\d)-(\d)$/);
  if (range) return msg("list.range", { a: dayName(Number(range[1])), b: dayName(Number(range[2])) });
  if (/^\d(,\d)+$/.test(dow)) {
    const names = dow.split(",").map((d) => dayName(Number(d)));
    return new Intl.ListFormat(lang(), { type: "conjunction" }).format(names);
  }
  return null;
}

const cron: Detector = (text) => {
  const f = text.split(/\s+/);
  if (f.length !== 5 || !f.every((x) => /^[\d*/,-]+$/.test(x))) return null;
  const [m, h, dom, mon, dow] = f;
  const rest = (...xs: string[]) => xs.every((x) => x === "*");
  let words: string | null = null;
  const every = m.match(/^\*\/(\d+)$/);
  if (every && rest(h, dom, mon, dow)) words = msg("cron.everyMinutes", { count: Number(every[1]) });
  else if (m === "*" && rest(h, dom, mon, dow)) words = msg("cron.everyMinute");
  else if (/^\d+$/.test(m) && /^\*\/\d+$/.test(h) && rest(dom, mon, dow)) words = msg("cron.everyHours", { count: Number(h.slice(2)), minute: m });
  else if (/^\d+$/.test(m) && /^\d+$/.test(h)) {
    const time = clockTime(h, m);
    const days = cronDays(dow);
    if (rest(dom, mon, dow)) words = msg("cron.daily", { time });
    else if (rest(dom, mon) && days) words = msg("cron.weekly", { days, time });
    else if (/^\d+$/.test(dom) && rest(mon, dow)) words = msg("cron.monthly", { day: dom, time });
  }
  return { kind: "cron", label: msg("insight.cron"), summary: words ?? msg("cron.raw", { m, h, dom, mon, dow }) };
};

const base64: Detector = (t) => {
  if (t.length < 8 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) return null;
  if (t.length % 4 !== 0 && !/[-_]/.test(t)) return null;
  const decoded = decodeBase64(t);
  if (!decoded || !readable(decoded)) return null;
  return { kind: "base64", label: msg("insight.base64"), summary: msg("insight.base64.chars", { count: decoded.length }), detail: decoded, output: decoded, outputLabel: msg("insight.copy.result") };
};

const urlencoded: Detector = (t) => {
  if (!/%[0-9A-Fa-f]{2}/.test(t)) return null;
  try {
    const decoded = decodeURIComponent(t);
    if (decoded === t) return null;
    return { kind: "urlencoded", label: msg("insight.urlencoded"), summary: decoded.slice(0, 120), detail: decoded, output: decoded, outputLabel: msg("insight.copy.result") };
  } catch {
    return null;
  }
};

const DETECTORS: Detector[] = [jwt, json, timestamp, date, color, cron, base64, urlencoded];
