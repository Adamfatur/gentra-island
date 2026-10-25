// Reminders made from copied text. One timer waits for the next reminder
// (checking at least once a minute, so a Mac waking from sleep catches up);
// with no reminders, nothing runs at all.

export interface Reminder {
  id: string;
  text: string;
  /** Unix ms when it's due. */
  at: number;
  created: number;
  /** The app the text was copied from, when known. */
  app?: string;
  /** Shown already and waiting for Copy, Snooze, or Done. */
  fired: boolean;
}

const KEY = "gentra:reminders";
const MAX_TEXT = 500;

/** Milliseconds until the next check, or null when nothing is waiting. */
export function checkDelay(list: Reminder[], now: number): number | null {
  const waiting = list.filter((r) => !r.fired);
  if (!waiting.length) return null;
  const next = Math.min(...waiting.map((r) => r.at));
  return Math.max(0, Math.min(next - now, 60_000));
}

/** Reminders whose time has come and that haven't been shown yet, oldest first. */
export function due(list: Reminder[], now: number): Reminder[] {
  return list.filter((r) => !r.fired && r.at <= now).sort((a, b) => a.at - b.at);
}

export function loadReminders(raw: string | null): Reminder[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter((r) => r && typeof r.id === "string" && typeof r.text === "string" && typeof r.at === "number" && typeof r.created === "number");
  } catch {
    return [];
  }
}

export class Reminders {
  list: Reminder[];
  private timer = 0;
  private enabled = true;

  constructor(
    /** Called once when a reminder is due; `late` when it was missed while the app was closed. */
    private onDue: (r: Reminder, late: boolean) => void,
    private onChange: () => void,
  ) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      /* private storage: reminders last until the app quits */
    }
    // Anything shown before a restart but not handled comes back.
    this.list = loadReminders(raw).map((r) => ({ ...r, fired: false }));
  }

  /** Starts the timer; reminders missed while the app was closed show now. */
  start() {
    this.check();
  }

  /** A mode without reminders pauses them; switching back catches up. */
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.check();
    else window.clearTimeout(this.timer);
  }

  add(text: string, at: Date, app?: string): Reminder {
    const r: Reminder = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text: text.slice(0, MAX_TEXT),
      at: at.getTime(),
      created: Date.now(),
      app,
      fired: false,
    };
    this.list.push(r);
    this.changed();
    return r;
  }

  remove(id: string) {
    this.list = this.list.filter((r) => r.id !== id);
    this.changed();
  }

  snooze(id: string, minutes: number) {
    const r = this.list.find((x) => x.id === id);
    if (!r) return;
    r.at = Date.now() + minutes * 60_000;
    r.fired = false;
    this.changed();
  }

  get(id: string) {
    return this.list.find((r) => r.id === id);
  }

  /** Still to come, soonest first; and those due but not handled. */
  get upcoming() {
    return [...this.list].sort((a, b) => a.at - b.at);
  }

  private changed() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.list));
    } catch {
      /* kept in memory */
    }
    this.onChange();
    this.schedule();
  }

  private schedule() {
    window.clearTimeout(this.timer);
    if (!this.enabled) return;
    const delay = checkDelay(this.list, Date.now());
    if (delay !== null) this.timer = window.setTimeout(() => this.check(), delay);
  }

  private check() {
    if (!this.enabled) return;
    const now = Date.now();
    const list = due(this.list, now);
    for (const r of list) {
      r.fired = true;
      this.onDue(r, now - r.at > 120_000);
    }
    if (list.length) this.changed();
    else this.schedule();
  }
}
