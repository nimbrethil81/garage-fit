# GarageFit agent instructions

GarageFit is a dependency-free browser PWA for fixed and generated workouts.

## Before changing code

1. Inspect the relevant implementation and tests.
2. Treat `data/exercises.js` as the canonical exercise catalogue; `data/EXERCISE_METADATA.md` defines its fields.
3. Treat tests as the executable specification of established generator behaviour.

## Development principles

- Prefer general generator rules and exercise metadata over exercise-specific hard coding.
- Keep exercise metadata minimal and orthogonal. Before adding a new metadata field, prefer reusing an existing field or expressing phase-specific behaviour as generator policy. Add metadata only when it describes an intrinsic property of the exercise and cannot be represented cleanly by the existing model.
- Preserve established behaviour unless the requested change requires otherwise.
- Keep the implementation dependency-free unless explicitly authorised.
- Do not introduce new product decisions merely to complete a task.
- For changes to established user-visible UI, check approved requirements, existing tests and docs before modifying layout or interaction. Preserve them unless explicitly superseded, and never silently redefine docs or tests to match an unintended change.
- Informational list/detail screens under More (e.g. Exercise Library, Workout Patterns) should reuse Exercise Library-style whole-card entries, spacing, typography, teal detail headings and the shared back/swipe navigation when appropriate (detail screens use the shared `info-detail` class on their `<main class="screen">`, not per-ID padding rules), and avoid decorative chevrons. This does not apply automatically to settings, forms, action menus or equipment-management views (My Equipment, Settings).
- New primary tabs must reuse the shared masthead (`js/masthead.js`, `data-masthead` host) and the existing `showScreen()` / `#bottomNav` behaviour, and extend `tests/primary-masthead.test.js`. Inspect existing components and styles before creating new patterns.
- When adding or editing exercises, follow the catalogue and editorial rules in data/EXERCISE_METADATA.md, including the exercise-instruction standard.

## Screen presentation

For new or materially revised Coach, Generator, Prep & Recover and relevant More information screens, apply these principles proportionately; not everything needs a card.

- Visualise quantities, schedules, categories and choices when useful.
- Prefer user-facing benefits and actions over technical terminology.
- Disclose secondary detail contextually.
- Keep content quickly scannable with concise headings and labels.
- Reuse GarageFit layout, spacing, navigation and UI patterns.
- Use purposeful, restrained colour with existing theme tokens to emphasise meaningful information; preserve the calm appearance and never rely on colour alone.
- Make interaction affordances clear: distinguish static information from controls, and provide accessible disclosure state, keyboard access and visible focus.
- Explain meaningful decisions rather than automatic implementation behaviour.

## Testing and reachability

- Fast: `node --test --test-skip-pattern='\[Full\]' tests/*.test.js`; Full: `node --test tests/*.test.js` (all tests).
- During implementation run targeted tests, then Fast; isolated low-risk UI/copy/player-layout changes need Fast before PR.
- Generator, Coach construction, exercise eligibility, workout protocol or persistence contract changes need Full before PR.
- Catalogue batches/material generator-policy changes need Full plus `node scripts/audit-exercise-reachability.js`; the separate exhaustive audit is in neither tier.
- Documentation-only edits need proportionate validation; run expensive checks once near PR readiness, repeating only to investigate failures or relevant changes.
- Test observable behaviour and meaningful regressions, including changed generator behaviour; extend existing suites when sensible.
- Tests are Fast by default; mark only justified expensive sweeps with `[Full]` in the test name (see README).
- Use the smallest meaningful deterministic fixtures and seed/matrix sizes; check existing tests/audits to avoid duplicate assurance.
- Explain new expensive Full-only sweeps briefly in the PR: distinct risk beyond cheaper tests and why Full-only suits it; no tracking file or approval ceremony.
- Reuse native Node tooling; no new dependencies/framework layers without approval, and never trade essential safety, workout-construction or persistence protection for speed.
- Exercise additions need bounded deterministic reachability for every flagged generated phase; follow `data/EXERCISE_METADATA.md`.
- Review audit warnings against intended roles, without automatic frequency equalisation.

## Architecture

- `index.html`: application shell/UI and workout player
- `data/`: exercise, equipment and fixed-workout data
- `data/programmes.js`: immutable versioned production Coach programme definitions; never change a released policy in place
- `data/sport-profiles.js`: immutable sport identities, capabilities and permitted user configuration; no Generator mappings
- `js/generator.js`: workout construction and selection; Main block protocol contracts (vocabulary, resolved steps, playback/tracker plan) are in `docs/WORKOUT_PROTOCOLS.md`
- `js/routine-generator.js`: standalone five-minute warm-up/cool-down routines (coverage, exact 300 s timing) and their separate `gf_routine_recent_v1` recency
- `js/rampup-ui.js`: ramp-up presentation
- `js/masthead.js`: canonical GarageFit logo/wordmark, mounted into primary-tab `data-masthead` hosts
- `js/coach-model.js`: versioned Coach record contracts and validation (Programme State, Session Prescription, Session Result, Session Draft)
- `js/coach-store.js`: Coach persistence behind an injected storage adapter; all other code reads and writes Coach records only through this module, never Coach localStorage keys directly
- `js/training-history.js`: immutable performed-evidence views derived from Session Results and the canonical catalogue; exact-exercise/protocol/side comparability
- `js/coach-policies.js`: programme-policy registry and parameterised General Strength strategy; production definitions are separate from policy code
- `js/coach-engine.js`: pure programme lifecycle, planning and idempotent result application; see `docs/COACH_ENGINE.md` for the API and definition inputs
- `js/coach-recovery.js`: central startup reconciliation and result → state → draft-clear transaction; interrupted Coach drafts finalise only durable outcomes
- `js/coach-progress-ui.js`: read-only Your progress view helpers (strength target cards, evidence drill-down, Tennis capability grid, arm exposure, session history) shared by every Coach programme
- `js/coach-ui.js`: Coach screens and orchestration of engine/store/generator/tracker; routine history queries use store metadata filters
- `js/session-tracker.js`: execution semantics for one generated-workout run (occurrence ids, completed/partial/skipped outcomes, checkpointed Session Draft, finalisation into a Session Result); dormant unless an execution context opts in (Coach sessions, and standalone generated workouts, which persist only completed runs)
- `tests/`: behavioural and UI regression tests
- `scripts/`: developer tooling (not shipped), e.g. the reachability audit

## Git and delivery workflow

When implementing an approved GitHub issue, complete the delivery workflow rather than stopping after code changes.

1. **Implement and validate**
   - Work on a dedicated implementation branch, unless direct changes to `main` are explicitly authorised.
   - Follow the repository's development instructions and run all required tests and applicable audits.
   - Do not introduce unapproved scope or product decisions.

2. **Commit and create PR**
   - Commit and push the completed changes.
   - Create a pull request targeting `main`, referencing the GitHub issue.
   - Summarise the changes, validation performed and any relevant limitations.
   - Do not request additional approval merely to commit, push or create the PR.

3. **Merge**
   - For an implementation explicitly authorised by the user, enable GitHub auto-merge on the PR when available and appropriate.
   - Use the repository's established merge strategy and respect required checks, branch protection and review requirements.
   - If all requirements are already satisfied, merge the PR directly.
   - Do not bypass required checks or protections.
   - Do not merge if validation fails, material uncertainty remains, or implementation exceeds the approved scope.
   - Do not request a separate approval solely to merge an implementation that is already authorised and meets these conditions.

4. **Complete and report**
   - Confirm whether the PR was merged, auto-merge is pending, or delivery is blocked.
   - Close the associated issue only after the implementation is merged and its acceptance criteria are satisfied. If the PR automatically closes the issue, do not close it again.
   - Report the PR link, merge status, test results and any outstanding action.
   - If auto-merge is pending, report that status accurately; do not claim completion or wait indefinitely.
   - Leave unrelated changes and issues untouched.

### Exceptions

Changes may be committed and pushed directly to `main` when explicitly authorised by the user.

For direct-to-main work, complete the required validation before pushing and report the resulting commit.

If repository permissions, unavailable tooling, failed checks or other safeguards prevent completing the workflow, stop at the furthest safe point and explain the blocker. Do not repeatedly ask for approval for routine delivery steps already covered by the original implementation authorisation.
