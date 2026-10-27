// Where the core and the droplets sit in the island's window. Pure: the page
// draws what this returns, and sends the same shapes to the glass and to the
// hit tester, so all three always agree.
//
// Home is a cluster under the core: a card and two round droplets, two pills,
// then a row of small chips. A droplet that opens becomes one large panel and
// the others go back into the core.

export type DropletId = "media" | "focus" | "system" | "clipboard" | "shelf" | "ai" | "dev" | "cleaner" | "calls" | "modes" | "settings";

/** card: a wide rounded card. round: a circle. pill: a wide capsule. chip: a small capsule with a name. */
export type Form = "card" | "round" | "pill" | "chip";

export interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export interface Droplet extends Shape {
  id: DropletId;
  form: Form;
  /** Its place in the order droplets grow out of the core. */
  order: number;
}

export interface Layout {
  core: Shape;
  droplets: Droplet[];
  /** The open view, when a droplet has grown into one. */
  panel: Shape | null;
}

export interface LayoutInput {
  /** The window's width; the island is centred in it. */
  winW: number;
  /** The camera housing, or null on a screen without one. */
  notch: { w: number; h: number } | null;
  /** Which droplets the mode has on, in any order. */
  on: DropletId[];
  /** "home" for the cluster, or the droplet that grew into a view. */
  view: DropletId | "home";
  /** Measured chip widths; a chip without one is CHIP_W wide. */
  chipW?: Partial<Record<DropletId, number>>;
  /** How tall the open view is, when it needs less than the full panel. */
  panelH?: number;
  /** The core's size when it has nothing to say yet; the open core when left out. */
  core?: { w: number; h: number; r: number };
}

export const GAP = 12;
const CHIP_GAP = 10;
/** Space between the core and the first droplet. */
const DROP = 16;
const CHIP_W = 110;
const CHIP_H = 52;
export const PANEL = { w: 680, h: 540, r: 44 };
/** How long droplets take to move, here and in the native glass (glass.rs). */
export const MOVE_MS = 360;
/** The curve both use; CAMediaTimingFunction takes the same four numbers. */
export const CURVE = "cubic-bezier(0.2, 0.9, 0.25, 1)";

const ROWS: { id: DropletId; form: Form; w: number; h: number }[][] = [
  [
    { id: "media", form: "card", w: 320, h: 150 },
    { id: "focus", form: "round", w: 150, h: 150 },
    { id: "system", form: "round", w: 150, h: 150 },
  ],
  [
    { id: "clipboard", form: "pill", w: 400, h: 84 },
    { id: "shelf", form: "pill", w: 232, h: 84 },
  ],
];
const CHIPS: DropletId[] = ["ai", "dev", "cleaner", "calls", "modes", "settings"];

/** The core when the island is open: wide enough for a sentence and a readout. */
export function openCore(notch: LayoutInput["notch"], winW: number): Shape {
  const w = 452;
  const h = notch ? 100 : 92;
  return { x: (winW - w) / 2, y: 0, w, h, r: h / 2 };
}

const radius = (form: Form, h: number) => (form === "card" ? 34 : h / 2);

export function layout(i: LayoutInput): Layout {
  const core = i.core ? { x: (i.winW - i.core.w) / 2, y: 0, ...i.core } : openCore(i.notch, i.winW);
  const top = core.y + core.h + DROP;
  if (i.view !== "home") {
    const h = Math.min(PANEL.h, i.panelH ?? PANEL.h);
    const panel = { x: (i.winW - PANEL.w) / 2, y: top, w: PANEL.w, h, r: PANEL.r };
    return { core, droplets: [], panel };
  }
  const on = new Set(i.on);
  // Modes and Settings have no feature to switch off; they are always there.
  on.add("modes");
  on.add("settings");
  const droplets: Droplet[] = [];
  let y = top;
  let order = 0;
  const place = (row: { id: DropletId; form: Form; w: number; h: number }[], gap: number) => {
    if (!row.length) return;
    const width = row.reduce((t, d) => t + d.w, 0) + gap * (row.length - 1);
    let x = (i.winW - width) / 2;
    for (const d of row) {
      droplets.push({ id: d.id, form: d.form, x, y, w: d.w, h: d.h, r: radius(d.form, d.h), order: order++ });
      x += d.w + gap;
    }
    y += Math.max(...row.map((d) => d.h)) + GAP;
  };
  for (const row of ROWS) place(row.filter((d) => on.has(d.id)), GAP);
  place(
    CHIPS.filter((id) => on.has(id)).map((id) => ({ id, form: "chip" as const, w: i.chipW?.[id] ?? CHIP_W, h: CHIP_H })),
    CHIP_GAP,
  );
  return { core, droplets, panel: null };
}

/** Every shape the glass draws: the droplets, or the open panel. The core is solid black. */
export function glassShapes(l: Layout): Shape[] {
  const list: Shape[] = l.panel ? [l.panel] : l.droplets;
  return list.map(({ x, y, w, h, r }) => ({ x, y, w, h, r }));
}

/** Every shape that takes the pointer: the core and whatever hangs under it. */
export function hitShapes(l: Layout): Shape[] {
  return [l.core, ...glassShapes(l)];
}

/** Where a droplet starts before it grows: tucked into the core's middle. */
export function tucked(d: Shape, core: Shape): Shape {
  const w = Math.min(d.w, 60);
  const h = Math.min(d.h, 30);
  return { x: core.x + (core.w - w) / 2, y: core.y + core.h - h, w, h, r: h / 2 };
}
