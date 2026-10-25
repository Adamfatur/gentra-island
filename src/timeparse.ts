// Finds a moment in copied text, in Indonesian or English, without any
// network: "rapat Jumat jam 14.00", "besok jam 9 pagi", "meeting moved to
// 3 pm", "Nov 5 at 10am". It only answers when there is a clear time of day,
// so prices ("Rp 14.000"), versions, and log timestamps stay quiet.

const DAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  "hari minggu": 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, "jum'at": 5, sabtu: 6,
};

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, januari: 0,
  february: 1, feb: 1, februari: 1, pebruari: 1,
  march: 2, mar: 2, maret: 2,
  april: 3, apr: 3,
  may: 4, mei: 4,
  june: 5, jun: 5, juni: 5,
  july: 6, jul: 6, juli: 6,
  august: 7, aug: 7, agustus: 7, agu: 7, ags: 7, agt: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, oktober: 9, okt: 9,
  november: 10, nov: 10, nopember: 10,
  december: 11, dec: 11, desember: 11, des: 11,
};

const MONTH_WORDS = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const DAY_WORDS = Object.keys(DAYS).sort((a, b) => b.length - a.length).join("|");

interface Clock {
  h: number;
  m: number;
}

function clockFrom(h: number, m: number): Clock | null {
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? { h, m } : null;
}

/** The time of day in the text, or null. */
function findClock(s: string): Clock | null {
  // 3 pm, 11:30am, 2.15 p.m.
  const ampm = s.match(/(?<![\d.:])(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/);
  if (ampm) {
    const h = Number(ampm[1]);
    if (h < 1 || h > 12) return null;
    const pm = ampm[3].startsWith("p");
    return clockFrom((h % 12) + (pm ? 12 : 0), Number(ampm[2] ?? 0));
  }
  // jam 14.00, pukul 9, jam 3 sore
  const jam = s.match(/\b(?:jam|pukul|pkl\.?)\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(pagi|siang|sore|malam))?/);
  if (jam) {
    let h = Number(jam[1]);
    const part = jam[3];
    if (h > 23) return null;
    if (part === "siang" && h < 11) h += 12;
    if (part === "sore" && h < 12) h += 12;
    if (part === "malam" && h >= 5 && h < 12) h += 12;
    return clockFrom(h, Number(jam[2] ?? 0));
  }
  // 14:30 or at 9:30, but not 12:34:56 or 2026-10-22T14:30
  const colon = s.match(/(?<![\d:t-])(\d{1,2}):(\d{2})(?![:\d])/);
  if (colon) return clockFrom(Number(colon[1]), Number(colon[2]));
  return null;
}

/** Days from today named in the text (besok = 1), or a weekday, or a date. */
function findDay(s: string, now: Date): { offset?: number; weekday?: number; date?: Date } {
  if (/\blusa\b|\bday after tomorrow\b/.test(s)) return { offset: 2 };
  if (/\bbesok\b|\btomorrow\b/.test(s)) return { offset: 1 };
  const named = s.match(new RegExp(`(?<![a-z])(${DAY_WORDS})(?![a-z])`));
  if (named) return { weekday: DAYS[named[1]] };
  const dm = s.match(new RegExp(`(?<![\\d.])(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_WORDS})(?![a-z])`));
  const md = s.match(new RegExp(`(?<![a-z])(${MONTH_WORDS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:.])`));
  const hit = dm ? { day: Number(dm[1]), month: MONTHS[dm[2]] } : md ? { day: Number(md[2]), month: MONTHS[md[1]] } : null;
  if (hit && hit.day >= 1 && hit.day <= 31) {
    const date = new Date(now.getFullYear(), hit.month, hit.day);
    if (date.getMonth() !== hit.month) return {};
    // A date earlier this year means next year's.
    if (date.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) date.setFullYear(now.getFullYear() + 1);
    return { date };
  }
  return {};
}

/**
 * The next moment the text points at, or null when there's no clear time.
 * Times already past today roll to tomorrow; a weekday that is today but
 * already past rolls to next week.
 */
export function findTime(text: string, now: Date = new Date()): Date | null {
  const s = text.toLowerCase().replace(/\s+/g, " ");
  let clock = findClock(s);
  const evening = /\bnanti malam\b|\btonight\b/.test(s);
  if (!clock && evening) clock = { h: 20, m: 0 };
  if (!clock) return null;

  const day = findDay(s, now);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), clock.h, clock.m);
  const soon = now.getTime() + 60_000;
  if (day.date) {
    at.setFullYear(day.date.getFullYear(), day.date.getMonth(), day.date.getDate());
  } else if (day.offset !== undefined) {
    at.setDate(at.getDate() + day.offset);
  } else if (day.weekday !== undefined) {
    let ahead = (day.weekday - now.getDay() + 7) % 7;
    if (ahead === 0 && at.getTime() <= soon) ahead = 7;
    at.setDate(at.getDate() + ahead);
  } else if (at.getTime() <= soon) {
    at.setDate(at.getDate() + 1);
  }
  // Only the future, and not absurdly far.
  if (at.getTime() <= soon || at.getTime() - now.getTime() > 366 * 86_400_000) return null;
  return at;
}

export interface Quick {
  id: "hour" | "tonight" | "morning";
  at: Date;
}

/** The one-tap choices: in an hour, tonight at 8 (until 7 pm), tomorrow at 9. */
export function quickTimes(now: Date = new Date()): Quick[] {
  const hour = new Date(now.getTime() + 3_600_000);
  hour.setSeconds(0, 0);
  const tonight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20, 0);
  const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  const list: Quick[] = [{ id: "hour", at: hour }];
  if (now.getHours() < 19) list.push({ id: "tonight", at: tonight });
  list.push({ id: "morning", at: morning });
  return list;
}
