// First-run guide bookkeeping. Bump GUIDE_VERSION when the guide gains a
// step worth showing to people who already finished the old one.

export const GUIDE_VERSION = 1;
export const LAST_STEP = 2;

/** `saved` is the guide version the user last finished, as stored. */
export function needsGuide(saved: string | null): boolean {
  const v = Number(saved);
  return saved === null || !Number.isInteger(v) || v < GUIDE_VERSION;
}

export const clampStep = (n: number) => Math.min(LAST_STEP, Math.max(0, n));
