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
- New primary tabs must reuse the shared masthead (`js/masthead.js`, `data-masthead` host) and the existing `showScreen()` / `#bottomNav` behaviour, and extend `tests/primary-masthead.test.js`. Inspect existing components and styles before creating new patterns.
- When adding or editing exercises, follow the catalogue and editorial rules in data/EXERCISE_METADATA.md, including the exercise-instruction standard.

## Catalogue reachability

- Exercise additions must include bounded, deterministic reachability coverage for every generated phase they are flagged for.
- Catalogue batches and material generator-policy changes must run the full audit: `node scripts/audit-exercise-reachability.js`.
- Audit warnings (rare or dominant exercises) require review against intended roles, not automatic frequency equalisation.
- The detailed rules are in the adding-an-exercise workflow in `data/EXERCISE_METADATA.md`.

## Architecture

- `index.html`: application shell/UI and workout player
- `data/`: exercise, equipment and fixed-workout data
- `data/programmes.js`: immutable versioned production Coach programme definitions; never change a released policy in place
- `data/sport-profiles.js`: immutable sport identities, capabilities and permitted user configuration; no Generator mappings
- `js/generator.js`: workout construction and selection
- `js/routine-generator.js`: standalone five-minute warm-up/cool-down routines (coverage, exact 300 s timing) and their separate `gf_routine_recent_v1` recency
- `js/rampup-ui.js`: ramp-up presentation
- `js/masthead.js`: canonical GarageFit logo/wordmark, mounted into primary-tab `data-masthead` hosts
- `js/coach-model.js`: versioned Coach record contracts and validation (Programme State, Session Prescription, Session Result, Session Draft)
- `js/coach-store.js`: Coach persistence behind an injected storage adapter; all other code reads and writes Coach records only through this module, never Coach localStorage keys directly
- `js/training-history.js`: immutable performed-evidence views derived from Session Results and the canonical catalogue; exact-exercise/protocol/side comparability
- `js/coach-policies.js`: programme-policy registry and parameterised General Strength strategy; production definitions are separate from policy code
- `js/coach-engine.js`: pure programme lifecycle, planning and idempotent result application; see `docs/COACH_ENGINE.md` for the API and definition inputs
- `js/coach-recovery.js`: central startup reconciliation and result → state → draft-clear transaction; interrupted Coach drafts finalise only durable outcomes
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
