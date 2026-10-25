# Translating Gentra Island

English is the default language and the fallback for everything. Bahasa Indonesia ships alongside it. Chinese, Arabic, Japanese, and Korean come next, then others.

Every language has to read like a person wrote it for people who speak it. A correct but stiff translation is a bug.

## How the text is organised

- `src/i18n/en.ts`: every string, by key. This is the source.
- `src/i18n/id.ts`: the same keys in Indonesian. TypeScript refuses to build if a key is missing.
- `src/i18n/index.ts`: the list of shipped languages (`LANGUAGES`) and the product name (`APP_NAME`).
- `src/i18n/dicts.test.ts`: checks every language for missing keys, mismatched placeholders, empty strings, em dashes, and middle dots. Run `pnpm test`.

## Adding a language

1. Copy `src/i18n/id.ts` to `src/i18n/<code>.ts` (for example `ja.ts`) and translate every value. Keep the keys.
2. Add it to `LANGUAGES` in `src/i18n/index.ts` with its native name and direction, for example `{ id: "ar", name: "العربية", dir: "rtl" }`, and to `DICTS`.
3. Run `pnpm test`. The dictionary tests will point at anything missing or mismatched.
4. Open `http://localhost:1420/preview.html` with `pnpm dev`, switch to the new language in Settings, and read every panel out loud.

## Writing rules for every language

- **Write, don't transliterate.** Read the English, understand what the person needs to know, then say it the way a helpful colleague in your language would.
- **Talk to the person.** Use the everyday form of "you" for your language (English "you", Indonesian "kamu"). Skip formal register unless your language would find casual rude in a utility app.
- **Short beats complete.** Labels are a word or two. Messages are one or two short sentences.
- **Buttons say what happens.** "Move to Trash", not "OK". "Copy without trackers", not "Clean".
- **Errors say what went wrong and what to do.** No apologies, no blame.
- **Keep common loanwords** that people actually say: clipboard, swap, JSON, Unix, AirDrop. Translating them makes text harder, not easier.
- **No filler or hype:** no "seamless", "powerful", "unlock", "effortless", or their equivalents in your language.
- **No em dashes (—) or middle dots (·).** Use a comma, a period, or two sentences. The tests reject both.
- **Placeholders stay exactly as written:** `{count}`, `{app}`, `{size}`, `{error}`. Move them anywhere in the sentence your grammar needs.

## Plurals

A value can be a string or an object of plural forms chosen by `Intl.PluralRules`:

```ts
"shelf.added": { one: "Added {count} file to the shelf", other: "Added {count} files to the shelf" },
```

Give the forms your language uses. Indonesian, Chinese, Japanese, and Korean need only `other`. Arabic uses `zero`, `one`, `two`, `few`, `many`, and `other`. `other` is always required.

## Numbers, dates, and times

Do not write numbers or dates into strings by hand. The code formats them with `Intl` in the current language, so `1,234.5` becomes `1.234,5` in Indonesian, weekday names come out in your language, and Arabic gets its own digits if the locale uses them.

## Right-to-left languages

Set `dir: "rtl"` in `LANGUAGES`. The app sets `dir` on the page, so text and inline layout flip. Check the island in the preview: icons that point (arrows, chevrons) may need mirroring, and anything positioned with `left`/`right` in `src/style.css` should be moved to logical properties (`inset-inline-start`) as part of adding the language.

## Fonts

Plus Jakarta Sans covers Latin scripts. Chinese, Japanese, Korean, and Arabic fall back to each system's own font (PingFang, Hiragino, Apple SD Gothic Neo, Microsoft YaHei, Yu Gothic, Malgun Gothic, Geeza Pro, Noto). No extra download is needed.

## Before you open a pull request

- `pnpm test` passes.
- You read every panel in the preview, in your language, and nothing is cut off.
- A second native speaker read it, if you can find one. Mention who in the pull request.
