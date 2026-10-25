// "Clean paste": strip link tracking, tidy whitespace, and mask identity
// numbers before text goes into a chat. Pure functions, unit-tested.

const TRACKING = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
  "igshid", "igsh", "mc_cid", "mc_eid", "_hsenc", "_hsmi", "mkt_tok", "li_fat_id", "vero_id",
  "oly_anon_id", "oly_enc_id", "rb_clickid", "s_cid", "_ga", "_gl",
]);

/** Parameters that are only tracking on particular sites (elsewhere they may matter). */
const SITE_TRACKING: [RegExp, string[]][] = [
  [/(^|\.)(spotify\.com|youtube\.com|youtu\.be)$/, ["si", "feature", "pp"]],
  [/(^|\.)(x\.com|twitter\.com)$/, ["s", "t"]],
];

function isTracking(key: string, host: string): boolean {
  const k = key.toLowerCase();
  if (k.startsWith("utm_") || TRACKING.has(k)) return true;
  return SITE_TRACKING.some(([re, keys]) => re.test(host) && keys.includes(k));
}

export function cleanUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return url;
  const hashIndex = url.indexOf("#", qIndex);
  const base = url.slice(0, qIndex);
  const query = url.slice(qIndex + 1, hashIndex < 0 ? undefined : hashIndex);
  const hash = hashIndex < 0 ? "" : url.slice(hashIndex);
  // Filter the raw pairs so kept parameters keep their original encoding.
  const kept = query.split("&").filter((pair) => {
    if (!pair) return false;
    const key = decodeURIComponent(pair.split("=")[0].replace(/\+/g, " "));
    return !isTracking(key, parsed.hostname);
  });
  return `${base}${kept.length ? `?${kept.join("&")}` : ""}${hash}`;
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;

export function cleanText(text: string): string {
  return text
    .replace(URL_RE, (u) => cleanUrl(u))
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hasTracking(text: string): boolean {
  return (text.match(URL_RE) ?? []).some((u) => cleanUrl(u) !== u);
}

/** Province codes start with these digits (Sumatra 1x … Papua 9x; no 4x). */
const NIK_PROVINCE = /^[12356789][1-9]/;

function isNik(d: string): boolean {
  if (!NIK_PROVINCE.test(d)) return false;
  const day = Number(d.slice(6, 8));
  const month = Number(d.slice(8, 10));
  // Women's NIKs add 40 to the day of birth.
  const dayOk = (day >= 1 && day <= 31) || (day >= 41 && day <= 71);
  return dayOk && month >= 1 && month <= 12;
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export function maskSensitive(text: string): string {
  return text
    .replace(/\b\d{16}\b/g, (d) => (isNik(d) ? `${d.slice(0, 4)}${"*".repeat(8)}${d.slice(-4)}` : d))
    .replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
      const digits = m.replace(/\D/g, "");
      if (!luhn(digits)) return m;
      let seen = 0;
      // Keep separators, hide every digit except the last four.
      return m.replace(/\d/g, (c) => (++seen > digits.length - 4 ? c : "•"));
    });
}
