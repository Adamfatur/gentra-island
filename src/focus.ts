// Focus timer state. Stored as an end time rather than a ticking counter, so
// it stays correct across sleep, reloads and missed frames.

export interface Timer {
  total: number;
  /** When it ends, while running. */
  endsAt: number | null;
  /** Time left, while paused. */
  pausedLeft: number | null;
}

export const start = (minutes: number, now: number): Timer => ({
  total: minutes * 60_000,
  endsAt: now + minutes * 60_000,
  pausedLeft: null,
});

export function remaining(t: Timer, now: number): number {
  if (t.pausedLeft !== null) return t.pausedLeft;
  return Math.max(0, (t.endsAt ?? now) - now);
}

export const pause = (t: Timer, now: number): Timer =>
  t.pausedLeft !== null ? t : { ...t, endsAt: null, pausedLeft: remaining(t, now) };

export const resume = (t: Timer, now: number): Timer =>
  t.pausedLeft === null ? t : { ...t, endsAt: now + t.pausedLeft, pausedLeft: null };

export const isDone = (t: Timer, now: number) => t.pausedLeft === null && remaining(t, now) === 0;

export const progress = (t: Timer, now: number) => (t.total ? Math.min(1, 1 - remaining(t, now) / t.total) : 0);

/** 25:00, 4:05, 1:05:00. Rounds up so the last second shows 0:01, not 0:00. */
export function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
