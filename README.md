# GarageFit

Simple dependency-free PWA for fixed and generated garage workouts.

The More menu contains an Exercise Library for searching and browsing the full
canonical catalogue by equipment, including exercises without instructions.

Live: https://nimbrethil81.github.io/garage-fit/

## Structure

- `index.html` — application UI and workout player
- `data/exercises.js` — canonical exercise catalogue and metadata
- `data/EXERCISE_METADATA.md` — meaning of every exercise field and how to author new exercises
- `data/equipment.js` — equipment catalogue
- `data/workouts.js` — fixed workouts
- `js/generator.js` — workout generation rules
- `js/rampup-ui.js` — ramp-up UI
- `tests/` — generator and UI regression tests

## Tests

Requires Node.js.

```bash
node --test tests/*.test.js
```

See `AGENTS.md` before making changes.
