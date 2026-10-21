# GarageFit

Simple dependency-free PWA for fixed and generated garage workouts.

Use fixed workouts, generate sessions for your equipment, or follow General Strength,
Build Arms or Tennis Conditioning in Coach. Prep & Recover provides five-minute
warm-ups and cool-downs; the More menu includes a searchable Exercise Library with
instructions for every exercise.

Live: https://nimbrethil81.github.io/garage-fit/

Coach history is local to this browser/device. Clearing browser or site data can
remove it; replacing a device does not automatically migrate it. Cloud durability
and cross-device continuity are deferred.

## Run locally

Serve the repository as static files, for example with Python 3:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/ in a browser. There is no build or dependency-install step.

## Structure

- `index.html` — application UI and workout player
- `data/exercises.js` — canonical exercise catalogue and metadata
- `data/EXERCISE_METADATA.md` — meaning of every exercise field and how to author new exercises
- `data/equipment.js` — equipment catalogue
- `data/workouts.js` — fixed workouts
- `data/programmes.js` — immutable, versioned production Coach definitions
- `data/sport-profiles.js` — immutable sport identities and permitted programme settings
- `data/sport-capabilities.js`, `js/sport-coverage.js` — reviewed sport mappings and pure performed-history coverage; see [Tennis mapping constraints](docs/TENNIS_CAPABILITY_AUDIT.md)
- `js/generator.js` — workout generation rules
- `js/rampup-ui.js` — ramp-up UI
- `js/coach-model.js`, `js/coach-store.js` — versioned Coach records and their local persistence
- `js/session-tracker.js` — records what actually happened during a tracked generated workout
- `js/coach-engine.js`, `js/coach-policies.js`, `js/training-history.js` — pure programme decisions, policy strategies and performed-training evidence
- `js/coach-tennis-policy.js` — Tennis anchors, performed session roles and duration-specific prescriptions
- `js/coach-recovery.js` — result/state/draft transaction and startup reconciliation
- `js/coach-ui.js` — Coach screens and recoverable engine/store/generator/tracker orchestration
- `js/coach-progress-ui.js` — read-only Your progress views shared by every Coach programme
- `tests/` — generator and UI regression tests

## Tests

Requires Node.js.

```sh
node --test tests/*.test.js
```

See [AGENTS.md](AGENTS.md) for contribution, validation and delivery instructions.

## Contracts and diagnostics

- [Exercise metadata and catalogue authoring](data/EXERCISE_METADATA.md)
- [Coach API, Session Prescription, programme policies and recovery](docs/COACH_ENGINE.md)
- [Workout protocols, occurrence targets, playback and tracking](docs/WORKOUT_PROTOCOLS.md)
- [Shared workout-family definitions and resolution](docs/WORKOUT_FAMILIES.md)
- [Tennis mapping constraints and catalogue gaps](docs/TENNIS_CAPABILITY_AUDIT.md)
- [Shared player controls and mobile verification](docs/PLAYER_TIMERS.md)
