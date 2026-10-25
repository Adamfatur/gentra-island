// Modes are presets over one list of switched-on features. Changing a single
// feature turns the mode into "kustom" without losing what the user chose.

export type FeatureId = "sistem" | "clip" | "pintar" | "rak" | "fokus" | "bersih" | "port" | "perintah" | "meeting" | "kamera" | "musik" | "ingat";
export type ModeId = "ringkas" | "harian" | "dev" | "rapat" | "fokus";

export interface ModeState {
  mode: ModeId | "kustom";
  /** The preset a custom set started from. */
  base: ModeId;
  on: FeatureId[];
}

/**
 * `ready: false` features are listed as "Soon" and cannot be switched on.
 * Names live in the i18n dictionaries as feature.<id>.
 */
export const FEATURES: { id: FeatureId; ready: boolean }[] = [
  { id: "sistem", ready: true },
  { id: "clip", ready: true },
  { id: "pintar", ready: true },
  { id: "rak", ready: true },
  { id: "fokus", ready: true },
  { id: "bersih", ready: true },
  { id: "port", ready: true },
  { id: "perintah", ready: true },
  { id: "meeting", ready: true },
  { id: "kamera", ready: true },
  { id: "musik", ready: true },
  { id: "ingat", ready: true },
];

/** Names and descriptions live in the i18n dictionaries as mode.<id> and mode.line.<id>. */
export const MODES: Record<ModeId, { features: FeatureId[] }> = {
  ringkas: { features: ["sistem", "clip", "pintar", "ingat"] },
  harian: { features: ["sistem", "clip", "pintar", "rak", "fokus", "bersih", "musik", "ingat"] },
  dev: { features: ["sistem", "clip", "pintar", "rak", "fokus", "bersih", "port", "perintah", "musik", "ingat"] },
  rapat: { features: ["sistem", "clip", "fokus", "meeting", "kamera", "ingat"] },
  fokus: { features: ["fokus", "sistem"] },
};

const isReady = (id: string): id is FeatureId => FEATURES.some((f) => f.id === id && f.ready);
const readyOf = (mode: ModeId) => MODES[mode].features.filter(isReady);
const sameSet = (a: FeatureId[], b: FeatureId[]) => a.length === b.length && a.every((x) => b.includes(x));

export function pick(mode: ModeId): ModeState {
  return { mode, base: mode, on: readyOf(mode) };
}

export function toggle(state: ModeState, id: FeatureId): ModeState {
  if (!isReady(id)) return state;
  const on = state.on.includes(id) ? state.on.filter((x) => x !== id) : [...state.on, id];
  // Several presets can share the same built features today; prefer the base.
  const order = [state.base, ...(Object.keys(MODES) as ModeId[]).filter((m) => m !== state.base)];
  const match = order.find((m) => sameSet(readyOf(m), on));
  return match ? { mode: match, base: match, on } : { mode: "kustom", base: state.base, on };
}

export function loadModeState(raw: string | null): ModeState {
  try {
    const v = JSON.parse(raw ?? "null");
    const base: ModeId = v && v.base in MODES ? v.base : "harian";
    if (!v || v.mode !== "kustom") return pick(v && v.mode in MODES ? v.mode : base);
    const on = Array.isArray(v.on) ? (v.on as string[]).filter(isReady) : readyOf(base);
    return { mode: "kustom", base, on };
  } catch {
    return pick("harian");
  }
}

export const isOn = (state: ModeState, id: FeatureId) => state.on.includes(id);
