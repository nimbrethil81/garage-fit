# GarageFit agent instructions

GarageFit is a dependency-free browser PWA for fixed and generated workouts.

## Before changing code

1. Inspect the relevant implementation and tests.
2. Treat `data/exercises.js` as the canonical exercise catalogue.
3. Treat tests as the executable specification of established generator behaviour.
4. Run all tests after changes: `node --test tests/*.test.js`

## Development principles

- Prefer general generator rules and exercise metadata over exercise-specific hard coding.
- Preserve established behaviour unless the requested change requires otherwise.
- Add or update regression tests for generator behaviour changes.
- Keep the implementation dependency-free unless explicitly authorised.
- Do not introduce new product decisions merely to complete a task.

## Architecture

- `index.html`: application shell/UI and workout player
- `data/`: exercise, equipment and fixed-workout data
- `js/generator.js`: workout construction and selection
- `js/rampup-ui.js`: ramp-up presentation
- `tests/`: behavioural and UI regression tests

## Git

Changes may be committed and pushed directly to `main` when explicitly authorised by the user.
