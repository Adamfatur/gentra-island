// Damped harmonic oscillator. One per animated dimension.
export class Spring {
  x: number;
  v = 0;
  target: number;

  constructor(x: number) {
    this.x = x;
    this.target = x;
  }

  step(dt: number, k: number, c: number) {
    const force = -k * (this.x - this.target) - c * this.v;
    this.v += force * dt;
    this.x += this.v * dt;
  }

  get settled() {
    return Math.abs(this.x - this.target) < 0.15 && Math.abs(this.v) < 0.15;
  }

  snap() {
    this.x = this.target;
    this.v = 0;
  }
}

export type Feel = "grow" | "shrink" | "hover";

// Grow overshoots a little so it feels alive; shrink is near-critical so it
// tucks back in without wobbling against the notch.
const FEEL: Record<Feel, [k: number, c: number]> = {
  grow: [300, 24],
  shrink: [420, 38],
  hover: [520, 30],
};

export interface Size {
  w: number;
  h: number;
  r: number;
}

/** Drives width, height and radius together; runs rAF only while moving. */
export class Morph {
  private s = { w: new Spring(0), h: new Spring(0), r: new Spring(0) };
  private raf = 0;
  private last = 0;
  /** When a frame last arrived, and the timer that checks they keep coming. */
  private ticked = 0;
  private guard = 0;
  private k = 300;
  private c = 24;
  private reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    initial: Size,
    private paint: (s: Size) => void,
    private settled: (s: Size) => void,
  ) {
    this.s.w = new Spring(initial.w);
    this.s.h = new Spring(initial.h);
    this.s.r = new Spring(initial.r);
    paint(initial);
  }

  get current(): Size {
    return { w: this.s.w.x, h: this.s.h.x, r: this.s.r.x };
  }

  to(t: Size, feel: Feel) {
    [this.k, this.c] = FEEL[feel];
    this.s.w.target = t.w;
    this.s.h.target = t.h;
    this.s.r.target = t.r;
    if (this.reduce) {
      Object.values(this.s).forEach((s) => s.snap());
      this.paint(this.current);
      this.settled(this.current);
      return;
    }
    if (!this.raf) {
      this.ticked = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
    // WebKit pauses animation frames for a window it thinks nobody can see.
    // Without frames the island would freeze mid-way, so it jumps instead.
    window.clearTimeout(this.guard);
    this.guard = window.setTimeout(this.unstick, 250);
  }

  private unstick = () => {
    if (!this.raf) return;
    if (performance.now() - this.ticked < 200) {
      this.guard = window.setTimeout(this.unstick, 250);
      return;
    }
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
    Object.values(this.s).forEach((s) => s.snap());
    this.paint(this.current);
    this.settled(this.current);
  };

  private tick = (ts: number) => {
    this.ticked = performance.now();
    const dt = Math.min(0.034, this.last ? (ts - this.last) / 1000 : 1 / 60);
    this.last = ts;
    const springs = Object.values(this.s);
    // Sub-stepping keeps stiff springs stable on 30 Hz and 120 Hz displays alike.
    for (let i = 0; i < 4; i++) springs.forEach((s) => s.step(dt / 4, this.k, this.c));
    if (springs.every((s) => s.settled)) {
      springs.forEach((s) => s.snap());
      this.paint(this.current);
      this.raf = 0;
      this.last = 0;
      window.clearTimeout(this.guard);
      this.settled(this.current);
      return;
    }
    this.paint(this.current);
    this.raf = requestAnimationFrame(this.tick);
  };
}
