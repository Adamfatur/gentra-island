# Contributing

Thanks for helping. A few things make reviews quick.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Gentra Island has to stay light. A change that adds a timer, a poll, or an animation should explain what it costs and why that's worth it.

## Setting up

See **Build from source** in the [README](README.md). `pnpm dev` with `http://localhost:1420/preview.html` runs the interface without Rust.

## Making a change

- Keep the style of the code around you. No new UI framework.
- Every piece of interface text lives in `src/i18n/`, with `en.ts` as the source and one file for each of the eleven languages. A new string goes into all of them; if you can't write a language, a careful draft is fine as long as the pull request says which ones need a native speaker. `pnpm test` lists any key a language is missing. Write it the way a person would say it; see [docs/TRANSLATING.md](docs/TRANSLATING.md).
- Add or update tests with the change, then run `pnpm test:all`.
- Test on the systems your change touches, and say in the pull request which ones you tried.

## Pull requests

Send changes as a pull request against `main`. The `main` branch can't be force-pushed or deleted, so its history and the release tags stay as they are.

## Licensing of contributions

Gentra Island is licensed under the GPL-3.0-or-later. By sending a pull request you agree that your contribution is licensed the same way.
