# Contributing

Thanks for helping! Bug reports, log samples, translations and PRs are all welcome.

## Dev setup

```bash
npm install
npm run dev            # Tauri app + Vite hot reload
```

In dev builds the overlay server redirects `/overlay/*` to the Vite dev server, so the OBS page hot-reloads too.

## Checks before a PR

```bash
npx tsc --noEmit -p tsconfig.json
npx vite build
cd src-tauri && cargo test --lib
```

## Visual harnesses (no game needed)

```bash
npx vite build --config .overlay-preview/vite.config.mjs   # every overlay widget with fixed data
npx vite build --config .hud-preview/vite.config.mjs       # Live HUD modes
```

Open the generated `dist/index.html`. The overlay harness picks a section from `window.__SECTION`: `layout`, `widgets`, `strips`, `themes`, `look`, `fit`, `debrief` or `editor`.

## Log samples

The parser is written against real `Game.log` lines, and the most useful contribution is a short excerpt showing a format we don't handle yet.

**Before you paste one, remove personal data:**
- your handle, in `Player[...]` and `nickname`
- your player id, in `PlayerId[...]`
- other players' names

Add the case as a test in `src-tauri/src/activity_parser.rs` or `src-tauri/src/overlay/contracts.rs`.

## Translations

UI text uses the English sentence as the key: `t('Session profit')`. To add or improve Spanish, edit `src/i18n/es.ts`. To add a new language, add a dictionary next to it and register it in `src/i18n/index.tsx`.

## Ground rules

- **Local first:** no third-party network calls, no accounts and no analytics.
- **Don't touch the game:** never read the game's memory or modify its files, apart from the documented `user.cfg` keys.
- **Keep the overlay server read-only.**
