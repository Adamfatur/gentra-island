// Draws the droplets from a layout and keeps the glass and the hit tester on
// the same shapes. The droplets move with a CSS transition on the same curve
// and duration the native glass uses, so the glass and the content arrive together.

import { invoke } from "@tauri-apps/api/core";
import { CURVE, MOVE_MS, glassShapes, hitShapes, tucked, type DropletId, type Layout, type Shape } from "./droplets";

export type GlassKind = "liquid" | "blur" | "none";

/** A dark tint in the glass keeps white text readable over any wallpaper. */
const TINT: [number, number, number, number] = [0.06, 0.08, 0.2, 0.3];
const tinted = (list: Shape[]) => list.map((s) => ({ ...s, tint: TINT }));

export class DropletsView {
  private root = document.createElement("div");
  private els = new Map<DropletId, HTMLButtonElement>();
  private layout: Layout | null = null;
  private hideTimer = 0;
  private reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    kind: GlassKind,
    private onPick: (id: DropletId) => void,
  ) {
    this.root.className = "droplets";
    // Without system glass the page paints each droplet itself.
    this.root.classList.toggle("solid", kind === "none");
    this.root.style.setProperty("--move", `${this.reduce ? 120 : MOVE_MS}ms`);
    this.root.style.setProperty("--curve", CURVE);
    this.root.hidden = true;
    this.root.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-drop]");
      if (!el) return;
      e.stopPropagation();
      this.onPick(el.dataset.drop as DropletId);
    });
    // The window itself, or the preview's stand-in for it.
    (document.getElementById("stagebox") ?? document.body).append(this.root);
  }

  get visible(): boolean {
    return this.layout !== null;
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

  /**
   * Grows the droplets out of the core into `layout`, or moves them there if
   * already out. `content` returns each droplet's HTML with every value escaped.
   */
  show(layout: Layout, content: (id: DropletId) => string) {
    clearTimeout(this.hideTimer);
    const first = !this.layout;
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
        // New droplets start tucked in the core, then grow on the next frame.
        place(el, tucked(d, layout.core), false);
      }
      el.innerHTML = content(d.id);
    }
    this.layout = layout;
    if (first) void invoke("set_glass", { shapes: tinted(layout.droplets.map((d) => tucked(d, layout.core))), ms: 0 });
    // Reading layout commits the tucked start, so the move below animates from
    // there. No requestAnimationFrame: macOS pauses it for windows it thinks
    // are hidden, which once froze the island mid-grow.
    void this.root.offsetWidth;
    for (const d of layout.droplets) place(this.els.get(d.id)!, d, true);
    void invoke("set_glass", { shapes: tinted(glassShapes(layout)), ms: this.reduce ? 0 : MOVE_MS });
  }

  /** Redraws what's inside the droplets without moving them. */
  refresh(content: (id: DropletId) => string) {
    if (!this.layout) return;
    for (const [id, el] of this.els) el.innerHTML = content(id);
  }

  /** Tucks the droplets back into the core, then clears them and their glass. */
  hide() {
    const l = this.layout;
    if (!l) return;
    this.layout = null;
    for (const d of l.droplets) {
      const el = this.els.get(d.id);
      if (el) place(el, tucked(d, l.core), true);
    }
    void invoke("set_glass", { shapes: tinted(l.droplets.map((d) => tucked(d, l.core))), ms: this.reduce ? 0 : MOVE_MS });
    this.hideTimer = window.setTimeout(() => {
      this.root.hidden = true;
      this.root.replaceChildren();
      this.els.clear();
      void invoke("set_glass", { shapes: [], ms: 0 });
    }, this.reduce ? 120 : MOVE_MS);
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
