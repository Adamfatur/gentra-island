// How wide the closed island is. On a Mac with a notch the extra width on
// either side covers other apps' menus, so by default it hides in the notch
// until something is live, and opens up fully only while you point at it.

export type IslandSize = "notch" | "compact" | "wide";
/**
 * tucked: just the notch, nothing shown. slim: icons only. full: icons and numbers.
 * eyes: slim, with an eye either side of the camera. hidden: a thin line, while an
 * app window reaches up where the menu bar would be (full screen, or a hidden menu bar).
 */
export type Look = "tucked" | "slim" | "full" | "eyes" | "hidden";

export const ISLAND_SIZES: IslandSize[] = ["notch", "compact", "wide"];

/** One side of a slim island: padding plus an 18 px icon. */
export const SLIM_SIDE = 34;
const WIDE_SIDE = 74;
const FLOAT_GAP = 40;
const FLOAT_WIDE = 196;
/** The line left at the top of the screen while the island is hidden. */
export const HIDDEN_W = 64;

export function compactLook(size: IslandSize, at: { hasNotch: boolean; live: boolean; hovering: boolean; covered?: boolean }): Look {
  // Over another app's window, step aside like a hidden menu bar. The notch itself covers nothing.
  if (at.covered && !at.hovering) return at.hasNotch ? "tucked" : "hidden";
  if (at.hovering || size === "wide") return "full";
  // Without a notch there is nothing to hide in; the smallest is the slim pill.
  if (size === "notch" && at.hasNotch && !at.live) return "tucked";
  return "slim";
}

export function compactWidth(look: Look, at: { hasNotch: boolean; notchW: number }): number {
  if (look === "hidden") return HIDDEN_W;
  const base = at.hasNotch ? at.notchW : FLOAT_GAP;
  if (look === "tucked") return base;
  if (look === "slim" || look === "eyes") return base + 2 * SLIM_SIDE;
  return at.hasNotch ? at.notchW + 2 * WIDE_SIDE : FLOAT_WIDE;
}

export const isIslandSize = (v: unknown): v is IslandSize => ISLAND_SIZES.includes(v as IslandSize);
