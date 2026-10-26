// Eyes in the notch: they look toward the pointer, blink now and then, sleep
// while you're away, and smile when something you waited for is done. Nothing
// animates on a loop: the eyes move only when the pointer does, and a blink is
// one short transition.

/** Where the eyes look, in px: up to 7 sideways and 3 up or down. */
export function gaze(dx: number, dy: number): [number, number] {
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  return [clamp(dx / 60, 7), clamp(dy / 90, 3)];
}

/** Seconds of no keyboard or mouse before the eyes fall asleep. */
export const SLEEP_AFTER = 5 * 60;

export type Mood = "happy" | "surprised";

export class Eyes {
  private root = document.getElementById("cEyes")!;
  private inner = this.root.querySelector<HTMLElement>(".eyes")!;
  private reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private blinkTimer = 0;
  private asleep = false;
  on = false;

  /** Shown only while the setting is on and the island has nothing else to show. */
  setVisible(show: boolean) {
    this.root.hidden = !show;
    window.clearTimeout(this.blinkTimer);
    if (show && !this.reduce) this.scheduleBlink();
  }

  /** The pointer, relative to the middle of the notch. */
  look(dx: number, dy: number) {
    if (this.root.hidden || this.reduce) return;
    if (this.asleep) this.sleep(false);
    const [x, y] = gaze(dx, dy);
    this.inner.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
  }

  sleep(on: boolean) {
    if (on === this.asleep) return;
    this.asleep = on;
    this.inner.classList.toggle("asleep", on);
    if (on) this.inner.style.translate = "0 1px";
    else this.feel("surprised");
  }

  get sleeping() {
    return this.asleep;
  }

  feel(mood: Mood) {
    if (this.root.hidden || this.asleep) return;
    const cls = mood === "happy" ? "is-happy" : "surprised";
    this.inner.classList.add(cls);
    window.setTimeout(() => this.inner.classList.remove(cls), mood === "happy" ? 1600 : 700);
  }

  private blink(twice = false) {
    if (this.asleep || this.root.hidden) return;
    this.inner.classList.add("blink");
    window.setTimeout(() => this.inner.classList.remove("blink"), 130);
    if (twice) window.setTimeout(() => this.blink(), 260);
  }

  /** Every 3 to 7 seconds, now and then twice. */
  private scheduleBlink() {
    this.blinkTimer = window.setTimeout(() => {
      this.blink(Math.random() < 0.2);
      this.scheduleBlink();
    }, 3000 + Math.random() * 4000);
  }
}
