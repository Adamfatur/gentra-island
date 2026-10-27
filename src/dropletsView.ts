// Draws the droplets from a layout and keeps the glass and the hit tester on
// the same shapes. The droplets move with a CSS transition on the same curve
// and duration the native glass uses, so the glass and the content arrive together.
//
// A droplet that opens grows into a panel. The panel borrows today's section
// for that feature (its markup, listeners and logic) and gives it back when it
// closes, so a view keeps working while only its look changes.

import { invoke } from "@tauri-apps/api/core";
import { CURVE, MOVE_MS, glassShapes, hitShapes, tucked, type DropletId, type Layout, type Shape } from "./droplets";

export type GlassKind = "liquid" | "blur" | "none";
type Tint = [number, number, number, number];

/** A dark tint in the glass keeps white text readable over any wallpaper. */
const TINT: Tint = [0.05, 0.06, 0.16, 0.58];

export interface PanelHead {
  kicker: string;
  title: string;
  done: string;
}

export class DropletsView {
  private root = document.createElement("div");
  private els = new Map<DropletId, HTMLButtonElement>();
  private layout: Layout | null = null;
  private hideTimer = 0;
  /** The tallest the open panel may grow. */
  private maxH = 0;
  private reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private panel: { el: HTMLElement; section: HTMLElement; home: [Node, Node | null]; tint: Tint } | null = null;
  /** Refits the open panel when what's inside changes height (files added, a timer started). */
  private resize = new ResizeObserver(() => this.refit());

  constructor(
    kind: GlassKind,
    private onPick: (id: DropletId, from: Shape) => void,
    private onDone: () => void,
    /** Called when the shapes change on their own, so the hit tester can follow. */
    private onMoved: () => void,
  ) {
    this.root.className = "droplets";
    // Without system glass the page paints each droplet itself.
    this.root.classList.toggle("solid", kind === "none");
    this.root.style.setProperty("--move", `${this.ms}ms`);
    this.root.style.setProperty("--curve", CURVE);
    this.root.hidden = true;
    this.root.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-dl-done]")) {
        e.stopPropagation();
        return this.onDone();
      }
      const el = target.closest<HTMLButtonElement>("[data-drop]");
      if (!el) return;
      e.stopPropagation();
      const d = this.layout?.droplets.find((x) => x.id === el.dataset.drop);
      if (d) this.onPick(d.id, d);
    });
    // The window itself, or the preview's stand-in for it.
    (document.getElementById("stagebox") ?? document.body).append(this.root);
  }

  private get ms() {
    return this.reduce ? 120 : MOVE_MS;
  }

  get visible(): boolean {
    return this.layout !== null;
  }

  /** Which droplet has grown into a panel, if any. */
  get open(): boolean {
    return this.panel !== null;
  }

  /** The shapes that take the pointer while the droplets are out; none while they're away. */
  hitShapes(): Shape[] {
    return this.layout ? hitShapes(this.layout) : [];
  }

  /** Measures each chip's name so the layout can size it. */
  measure(ids: DropletId[], label: (id: DropletId) => string): Partial<Record<DropletId, number>> {
    const probe = document.createElement("span");
    probe.className = "dl-probe";
    // On the body: the droplets' own layer may still be hidden, and hidden text measures 0.
    document.body.append(probe);
    const out: Partial<Record<DropletId, number>> = {};
    for (const id of ids) {
      probe.textContent = label(id);
      out[id] = Math.ceil(probe.getBoundingClientRect().width) + 40;
    }
    probe.remove();
    return out;
  }

  private glass(shapes: Shape[], ms: number, tint: Tint = TINT) {
    void invoke("set_glass", { shapes: shapes.map((s) => ({ ...s, tint })), ms });
  }

  /**
   * Grows the droplets out of the core into `layout`, or moves them there if
   * already out. `content` returns each droplet's HTML with every value escaped.
   */
  show(layout: Layout, content: (id: DropletId) => string) {
    clearTimeout(this.hideTimer);
    const first = !this.layout || this.open;
    this.dropPanel();
    this.root.hidden = false;
    const keep = new Set(layout.droplets.map((d) => d.id));
    for (const [id, el] of this.els) {
      if (!keep.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    for (const d of layout.droplets) {
      let el = this.els.get(d.id);
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.dataset.drop = d.id;
        el.className = `dl dl-${d.form}`;
        this.root.append(el);
        this.els.set(d.id, el);
        // New droplets start tucked in the core, then grow.
        place(el, tucked(d, layout.core), false);
      }
      el.innerHTML = content(d.id);
    }
    this.layout = layout;
    if (first) this.glass(layout.droplets.map((d) => tucked(d, layout.core)), 0);
    // Reading layout commits the tucked start, so the move below animates from
    // there. No requestAnimationFrame: macOS pauses it for windows it thinks
    // are hidden, which once froze the island mid-grow.
    void this.root.offsetWidth;
    for (const d of layout.droplets) place(this.els.get(d.id)!, d, true);
    this.glass(glassShapes(layout), this.ms);
  }

  /** Redraws what's inside the droplets without moving them. */
  refresh(content: (id: DropletId) => string) {
    if (!this.layout || this.open) return;
    for (const [id, el] of this.els) el.innerHTML = content(id);
  }

  /**
   * Grows a panel out of the droplet at `from` (or the core) into `layout.panel`,
   * holding `section`. The other droplets give way to it.
   */
  openPanel(layout: Layout, from: Shape | null, section: HTMLElement, head: PanelHead) {
    const target = layout.panel;
    if (!target) return;
    this.maxH = target.h;
    clearTimeout(this.hideTimer);
    this.dropPanel();
    this.root.hidden = false;
    for (const el of this.els.values()) el.remove();
    this.els.clear();

    const el = document.createElement("div");
    el.className = "dl-panel";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", head.kicker);
    const top = document.createElement("div");
    top.className = "dl-head";
    const words = document.createElement("div");
    words.className = "dl-words";
    const kicker = document.createElement("div");
    kicker.className = "dl-kicker";
    kicker.textContent = head.kicker;
    const title = document.createElement("div");
    title.className = "dl-title";
    title.textContent = head.title;
    words.append(kicker, title);
    const done = document.createElement("button");
    done.type = "button";
    done.className = "dl-done";
    done.dataset.dlDone = "";
    done.textContent = head.done;
    top.append(words, done);
    const body = document.createElement("div");
    body.className = "dl-body";
    const home: [Node, Node | null] = [section.parentNode!, section.nextSibling];
    body.append(section);
    el.append(top, body);
    this.root.append(el);
    this.panel = { el, section, home, tint: TINT };

    // Lay it out at its final width first, to learn how tall its content is.
    place(el, target, false);
    const fitted = { ...target, h: this.fitHeight(el, section, target.h) };
    const start = from ?? tucked(fitted, layout.core);
    place(el, start, false);
    this.layout = { ...layout, panel: fitted };
    this.glass([start], 0);
    void this.root.offsetWidth;
    place(el, fitted, true);
    this.glass([fitted], this.ms);
    // The section itself always fills the panel; its children change size with their content.
    for (const child of section.children) this.resize.observe(child);
  }

  /** The panel's height for its content: never more than `max`, never a sliver. */
  private fitHeight(el: HTMLElement, section: HTMLElement, max: number): number {
    const style = getComputedStyle(el);
    const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const head = el.querySelector<HTMLElement>(".dl-head")!.offsetHeight;
    const gap = parseFloat(style.rowGap) || 0;
    // The section fills the panel, so measure it at its own height for a moment.
    const before = section.style.cssText;
    section.style.flex = "none";
    section.style.height = "auto";
    section.style.overflow = "visible";
    const content = section.offsetHeight;
    section.style.cssText = before;
    // A few points spare, so rounding never leaves a scrollbar.
    return Math.round(Math.min(max, Math.max(200, pad + head + gap + content + 4)));
  }

  private refit() {
    const p = this.panel;
    const l = this.layout;
    if (!p || !l?.panel) return;
    const h = this.fitHeight(p.el, p.section, this.maxH);
    if (Math.abs(h - l.panel.h) < 2) return;
    const next = { ...l.panel, h };
    this.layout = { ...l, panel: next };
    place(p.el, next, true);
    this.glass([next], this.ms, p.tint);
    this.onMoved();
  }

  /** Retitles the open panel, e.g. when the song changes. */
  retitle(head: Pick<PanelHead, "kicker" | "title">) {
    if (!this.panel) return;
    this.panel.el.querySelector(".dl-kicker")!.textContent = head.kicker;
    this.panel.el.querySelector(".dl-title")!.textContent = head.title;
  }

  /** Colours the open panel's glass, e.g. with the artwork's colour; null for the usual tint. */
  tintPanel(rgb: [number, number, number] | null) {
    if (!this.panel || !this.layout?.panel) return;
    // Darkened, so white text stays readable on a pale cover too.
    this.panel.tint = rgb ? [(rgb[0] / 255) * 0.55, (rgb[1] / 255) * 0.55, (rgb[2] / 255) * 0.55, 0.62] : TINT;
    this.glass([this.layout.panel], 0, this.panel.tint);
  }

  /** Puts the borrowed section back where it came from and removes the panel. */
  private dropPanel() {
    const p = this.panel;
    if (!p) return;
    this.resize.disconnect();
    this.panel = null;
    p.home[0].insertBefore(p.section, p.home[1]);
    p.el.remove();
  }

  /** Tucks everything back into the core, then clears it and its glass. */
  hide() {
    const l = this.layout;
    if (!l) return;
    this.layout = null;
    const out: Shape[] = [];
    for (const d of l.droplets) {
      const to = tucked(d, l.core);
      const el = this.els.get(d.id);
      if (el) place(el, to, true);
      out.push(to);
    }
    if (this.panel && l.panel) {
      const to = tucked(l.panel, l.core);
      place(this.panel.el, to, true);
      out.push(to);
    }
    this.glass(out, this.ms, this.panel?.tint);
    this.hideTimer = window.setTimeout(() => {
      this.dropPanel();
      this.root.hidden = true;
      this.root.replaceChildren();
      this.els.clear();
      this.glass([], 0);
    }, this.ms);
  }
}

function place(el: HTMLElement, s: Shape, animate: boolean) {
  el.classList.toggle("moving", animate);
  el.style.transform = `translate(${s.x}px, ${s.y}px)`;
  el.style.width = `${s.w}px`;
  el.style.height = `${s.h}px`;
  el.style.borderRadius = `${s.r}px`;
  // Content fades in once the droplet is big enough to hold it.
  el.classList.toggle("tucked", s.w <= 60);
}

/** "rgb(12, 34, 56)" or "#0c2238" as numbers, or null when it is neither. */
export function parseColor(css: string): [number, number, number] | null {
  const v = css.trim();
  const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return null;
}
