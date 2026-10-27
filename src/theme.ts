// Theme choice and custom accents. A user-picked accent is nudged lighter or
// darker until it reads at 4.5:1 on the theme's surface, so no choice can
// make the UI illegible.

import { isIslandSize, type IslandSize } from "./islandSize";

export type ThemeMode = "auto" | "dark" | "light";
export type EyesMode = "off" | "moments" | "always";
export const EYES_MODES: EyesMode[] = ["off", "moments", "always"];
/** Days the clipboard keeps unpinned items; 0 keeps them until the history is full. */
export type ClipKeep = 1 | 7 | 30 | 0;
export const CLIP_KEEPS: ClipKeep[] = [1, 7, 30, 0];

export interface Settings {
  theme: ThemeMode;
  /** Custom accent as #RRGGBB, or null for the theme's default. */
  accent: string | null;
  /** How wide the closed island is; see islandSize.ts. */
  islandSize: IslandSize;
  /** Eyes in the notch: never, for moments (on hover and when something happens), or always. */
  eyes: EyesMode;
  /** How long the clipboard history keeps what isn't pinned. */
  clipKeep: ClipKeep;
  /** Look for a new version once a day. */
  autoUpdate: boolean;
}

export const DEFAULTS: Settings = { theme: "auto", accent: null, islandSize: "notch", eyes: "always", clipKeep: 30, autoUpdate: true };

export function resolveTheme(mode: ThemeMode, systemDark: boolean): "dark" | "light" {
  if (mode === "auto") return systemDark ? "dark" : "light";
  return mode;
}

type RGB = [number, number, number];

const toRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
};

const toHex = (rgb: RGB) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mixes the accent toward black or white, whichever moves it away from the surface. */
export function readableAccent(hex: string, surface: string, min = 4.5): string {
  if (contrast(hex, surface) >= min) return hex;
  const toward: RGB = luminance(surface) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  const base = toRgb(hex);
  for (let t = 0.05; t <= 1; t += 0.05) {
    const mixed = toHex(base.map((v, i) => v + (toward[i] - v) * t) as RGB);
    if (contrast(mixed, surface) >= min) return mixed;
  }
  return toHex(toward);
}

export function onAccentText(hex: string): "#000000" | "#FFFFFF" {
  return contrast(hex, "#000000") >= contrast(hex, "#FFFFFF") ? "#000000" : "#FFFFFF";
}

export function loadSettings(raw: string | null): Settings {
  try {
    const v = JSON.parse(raw ?? "null");
    if (!v || typeof v !== "object") return { ...DEFAULTS };
    const theme: ThemeMode = ["auto", "dark", "light"].includes(v.theme) ? v.theme : DEFAULTS.theme;
    const accent = typeof v.accent === "string" && /^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent.toUpperCase() : null;
    const islandSize = isIslandSize(v.islandSize) ? v.islandSize : DEFAULTS.islandSize;
    // 0.9 stored an on/off switch; off stays off, on becomes the new default.
    const eyes: EyesMode = EYES_MODES.includes(v.eyes) ? v.eyes : v.islandEyes === false ? "off" : DEFAULTS.eyes;
    const clipKeep: ClipKeep = CLIP_KEEPS.includes(v.clipKeep) ? v.clipKeep : DEFAULTS.clipKeep;
    const autoUpdate = typeof v.autoUpdate === "boolean" ? v.autoUpdate : DEFAULTS.autoUpdate;
    return { theme, accent, islandSize, eyes, clipKeep, autoUpdate };
  } catch {
    return { ...DEFAULTS };
  }
}
