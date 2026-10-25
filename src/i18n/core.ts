// A small translation core: placeholders, plural forms from Intl.PluralRules
// (so Arabic's six forms work without special code), English fallback, and
// text direction per language.

export type Msg = string | Partial<Record<Intl.LDMLPluralRule, string>>;
export type Dict = Record<string, Msg>;
export type Params = Record<string, string | number>;

export function createI18n<L extends string>(dicts: Record<L, Partial<Dict>>, dirs: Record<L, "ltr" | "rtl">, fallback = "en" as L) {
  let current: L = fallback;
  const plural = new Map<L, Intl.PluralRules>();
  const number = new Map<L, Intl.NumberFormat>();

  const rulesFor = (l: L) => plural.get(l) ?? plural.set(l, new Intl.PluralRules(l)).get(l)!;
  const numberFor = (l: L) => number.get(l) ?? number.set(l, new Intl.NumberFormat(l)).get(l)!;

  function pickForm(msg: Msg, l: L, params?: Params): string | undefined {
    if (typeof msg === "string") return msg;
    const n = Number(params?.count ?? 0);
    return msg[rulesFor(l).select(n)] ?? msg.other;
  }

  function t(key: string, params?: Params): string {
    let text: string | undefined;
    let used: L = current;
    for (const l of [current, fallback]) {
      const msg = dicts[l]?.[key];
      if (msg !== undefined) {
        text = pickForm(msg, l, params);
        used = l;
        if (text !== undefined) break;
      }
    }
    if (text === undefined) return key;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
      const v = params?.[name];
      if (v === undefined) return whole;
      return typeof v === "number" ? numberFor(used).format(v) : v;
    });
  }

  return {
    t,
    setLang: (l: L) => {
      current = l;
    },
    lang: () => current,
    dir: () => dirs[current],
  };
}

/** English unless the user picked a language this build ships. */
export function resolveLang<L extends string>(saved: string | null, supported: L[], fallback = "en" as L): L {
  return saved && (supported as string[]).includes(saved) ? (saved as L) : fallback;
}
