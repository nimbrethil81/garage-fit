# GarageFit agent instructions

GarageFit is a dependency-free browser PWA for fixed and generated workouts.

## Before changing code

1. Inspect the relevant implementation and tests.
2. Treat `data/exercises.js` as the canonical exercise catalogue; `data/EXERCISE_METADATA.md` defines its fields.
3. Treat tests as the executable specification of established generator behaviour.
4. Run all tests after changes: `node --test tests/*.test.js`

## Development principles

- Prefer general generator rules and exercise metadata over exercise-specific hard coding.
- Keep exercise metadata minimal and orthogonal. Before adding a new metadata field, prefer reusing an existing field or expressing phase-specific behaviour as generator policy. Add metadata only when it describes an intrinsic property of the exercise and cannot be represented cleanly by the existing model.
- Preserve established behaviour unless the requested change requires otherwise.
- Add or update regression tests for generator behaviour changes.
- Keep the implementation dependency-free unless explicitly authorised.
- Do not introduce new product decisions merely to complete a task.
- When adding or editing exercises, follow the catalogue and editorial rules in data/EXERCISE_METADATA.md, including the exercise-instruction standard.

## Catalogue reachability

- Exercise additions must include bounded, deterministic reachability coverage for every generated phase they are flagged for.
- Catalogue batches and material generator-policy changes must run the full audit: `node scripts/audit-exercise-reachability.js`.
- Audit warnings (rare or dominant exercises) require review against intended roles, not automatic frequency equalisation.
- The detailed rules are in the adding-an-exercise workflow in `data/EXERCISE_METADATA.md`.

## Architecture

- `index.html`: application shell/UI and workout player
- `data/`: exercise, equipment and fixed-workout data
- `js/generator.js`: workout construction and selection
- `js/rampup-ui.js`: ramp-up presentation
- `tests/`: behavioural and UI regression tests
- `scripts/`: developer tooling (not shipped), e.g. the reachability audit

## Git

Changes may be committed and pushed directly to `main` when explicitly authorised by the user.
