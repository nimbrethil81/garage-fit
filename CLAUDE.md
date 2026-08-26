# CLAUDE.md

## What this is
Garage Fit is a single-page mobile workout timer web app. No build step,
no framework, no dependencies — one static HTML file. It's designed to be
added to a phone home screen and used as a quasi-native app during workouts.

## Stack
- Plain HTML + CSS + vanilla JavaScript, all inline in `index.html`.
- No package.json, no build tooling, no bundler. Don't introduce one without
  a good reason — the zero-dependency, single-file nature is a deliberate
  simplicity, not an oversight.
- Browser APIs in use: Web Audio (beeps), SpeechSynthesis (spoken exercise
  names), Wake Lock (keep screen on), localStorage (equipment toggle
  preference).

## Deployment
- Served via GitHub Pages directly from the `main` branch root — there is
  no CI/build step. **Merging to `main` deploys immediately** to
  https://nimbrethil81.github.io/garage-fit/
- Because of this, treat `main` as production: use a branch + PR for any
  nontrivial change rather than committing directly to `main`.

## Structure (all in index.html)
- `<style>` — dark theme, touch-first CSS for four "screens": Home, Snack
  Picker, Player (timer), Done.
- HTML body — one `<div class="screen">` per screen, shown/hidden via
  `showScreen()`. This is a hand-rolled SPA, not a router.
- `<script>`:
  - `EX` — hardcoded exercise data: warm-up/cool-down lists (each with an
    "equipment" and "no equipment" variant), a ramp-up list, and a snack pool.
  - `state` — single global object holding the current routine/timer state.
  - Timer engine (`runTimer`/`renderTick`) drives the SVG progress ring and
    phase transitions: ready → work → rest → next exercise → done.
  - Equipment toggle persisted to `localStorage` under key `gf_equipment`.

## Conventions
- Keep everything in one file unless a change genuinely requires splitting
  it out — this is intentionally minimal.
- No test suite and no build/lint step exists. Verify changes by opening
  `index.html` in a browser (or a local static server) and manually
  exercising the affected screen/flow.
- Exercise lists in `EX` are duplicated between equipment/no-equipment
  variants where moves overlap — when editing a shared move name, update
  both lists.

## Known quirks worth knowing before changing things
- The Snack picker's `gear` field on `EX.snackPool` entries is unused
  metadata — Snack mode currently ignores the equipment toggle entirely,
  so it can suggest barbell/kettlebell moves even in "no equipment" mode.
- `beep()` and `speak()` silently swallow all errors (intentional — these
  are optional feedback, not core functionality).
