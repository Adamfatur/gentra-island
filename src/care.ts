// Small, warm reminders for the body: a break, water, a meal, and bed.
// Pure rules: the island feeds in how long the keyboard and mouse have been
// quiet, and gets back at most one nudge. Spam is the enemy, so every rule
// is gated by a quiet gap, a daily cap, and "not while you're busy".

export type CareKind = "break" | "water" | "lunch" | "dinner" | "late";

export interface CareState {
  /** Local date, "2026-10-26"; daily limits reset when it changes. */
  day: string;
  /** Start of the current stretch of activity; null after a real break. */
  streakStart: number | null;
  /** Active time since the last water nudge. */
  activeSinceWater: number;
  lastTick: number;
  lastNudge: number;
  count: number;
  /** Meals and the late-night nudge happen once a day. */
  done: CareKind[];
  /** "Not today" from the user. */
  muted: CareKind[];
  snoozed: Partial<Record<CareKind, number>>;
}

export interface CareContext {
  now: Date;
  /** Seconds since the last keyboard or mouse input; null when unknown. */
  idle: number | null;
  /** A call, a focus timer, or Focus mode: nudges wait. */
  busy: boolean;
}

export interface Nudge {
  kind: CareKind;
  /** Minutes of activity without a break, for the message. */
  activeMin: number;
  /** Which variation of the message, so it doesn't repeat word for word. */
  variant: number;
}

const MIN = 60_000;
/** Quiet this long and it was a break. */
export const BREAK_IDLE_SECS = 5 * 60;
/** Input within this long means you're at the computer right now. */
const PRESENT_SECS = 2 * 60;
export const BREAK_AFTER = 50 * MIN;
export const WATER_AFTER = 90 * MIN;
/** At least this long between any two nudges. */
export const GAP = 20 * MIN;
export const DAILY_CAP = 8;
const REPEAT_BREAK = 25 * MIN;
/** A gap in ticks this long (sleep, app closed) is not activity. */
const MAX_TICK = 5 * MIN;

export const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function freshCare(now: Date): CareState {
  return { day: dayOf(now), streakStart: null, activeSinceWater: 0, lastTick: now.getTime(), lastNudge: 0, count: 0, done: [], muted: [], snoozed: {} };
}

const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const between = (d: Date, from: string, to: string) => {
  const m = minutesOfDay(d);
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  return m >= fh * 60 + fm && m < th * 60 + tm;
};

/** Advances the state by one tick and says whether to nudge now. */
export function careTick(prev: CareState, ctx: CareContext): { state: CareState; nudge: Nudge | null } {
  const now = ctx.now.getTime();
  let s: CareState = { ...prev, snoozed: { ...prev.snoozed } };
  if (s.day !== dayOf(ctx.now)) s = { ...s, day: dayOf(ctx.now), count: 0, done: [], muted: [], snoozed: {} };

  const dt = Math.min(Math.max(0, now - s.lastTick), MAX_TICK);
  s.lastTick = now;
  const idle = ctx.idle ?? 0;
  const present = idle < PRESENT_SECS;
  if (idle >= BREAK_IDLE_SECS || now - prev.lastTick > MAX_TICK) {
    // Away long enough to count as a rest; the next stretch starts fresh.
    s.streakStart = null;
  } else if (present) {
    s.streakStart ??= now - idle * 1000;
    s.activeSinceWater += dt;
  }

  const streak = s.streakStart === null ? 0 : now - s.streakStart;
  const nudge = (kind: CareKind): { state: CareState; nudge: Nudge } => {
    s.lastNudge = now;
    s.count += 1;
    if (kind === "lunch" || kind === "dinner" || kind === "late") s.done = [...s.done, kind];
    if (kind === "water") s.activeSinceWater = 0;
    if (kind === "break") s.snoozed.break = now + REPEAT_BREAK;
    return { state: s, nudge: { kind, activeMin: Math.round(streak / MIN), variant: s.count } };
  };

  if (!present || ctx.busy || s.count >= DAILY_CAP || now - s.lastNudge < GAP) return { state: s, nudge: null };
  const can = (k: CareKind) => !s.muted.includes(k) && !s.done.includes(k) && (s.snoozed[k] ?? 0) <= now;

  const d = ctx.now;
  if (can("late") && (d.getHours() >= 23 || d.getHours() < 4) && streak >= 10 * MIN) return nudge("late");
  if (can("lunch") && between(d, "12:00", "13:30") && streak >= 15 * MIN) return nudge("lunch");
  if (can("dinner") && between(d, "18:30", "20:00") && streak >= 15 * MIN) return nudge("dinner");
  if (can("break") && streak >= BREAK_AFTER) return nudge("break");
  if (can("water") && s.activeSinceWater >= WATER_AFTER && between(d, "07:00", "23:00")) return nudge("water");
  return { state: s, nudge: null };
}

/** What the buttons on a nudge do. */
export function careAnswer(prev: CareState, kind: CareKind, answer: "ok" | "later" | "today", now: Date): CareState {
  const s: CareState = { ...prev, snoozed: { ...prev.snoozed }, done: [...prev.done], muted: [...prev.muted] };
  const t = now.getTime();
  if (answer === "today") s.muted.push(kind);
  if (answer === "later") {
    // Meals come back once more in half an hour; the rest in fifteen minutes.
    const meal = kind === "lunch" || kind === "dinner";
    s.done = s.done.filter((k) => k !== kind);
    s.snoozed[kind] = t + (meal ? 30 : 15) * MIN;
    // A snooze is its own promise, so the general gap doesn't hold it back.
    s.lastNudge = t - GAP + (meal ? 30 : 15) * MIN;
  }
  if (answer === "ok" && kind === "break") {
    // Trust them: the stretch starts over even if they only stood up briefly.
    s.streakStart = t;
  }
  return s;
}

export function loadCare(raw: string | null, now: Date): CareState {
  try {
    const v = JSON.parse(raw ?? "null");
    if (v && typeof v.day === "string" && typeof v.count === "number") return { ...freshCare(now), ...v, lastTick: now.getTime() };
  } catch {
    /* start fresh */
  }
  return freshCare(now);
}
