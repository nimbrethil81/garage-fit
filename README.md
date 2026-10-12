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
- `js/coach-model.js`, `js/coach-store.js` — versioned Coach records and their local persistence
- `js/session-tracker.js` — records what actually happened during a tracked generated workout
- `js/coach-engine.js`, `js/coach-policies.js`, `js/training-history.js` — pure programme decisions, policy strategies and performed-training evidence
- `tests/` — generator and UI regression tests

## Tests

Requires Node.js.

```bash
node --test tests/*.test.js
```

See `AGENTS.md` before making changes.

## Session Prescription boundary

`GarageFitGenerator.generate(options)` accepts an optional `sessionPrescription`
validated by `GarageFitCoachModel`. Load `js/coach-model.js` before making prescribed
calls. Standalone callers need no Coach records and retain their seeded output.

`GarageFitGenerator.assessSessionPrescription(options)` is a pure preflight: it
consumes no randomness and returns `status` (`feasible`, `partially-feasible`, or
`infeasible`), `hardConflicts`, `softConflicts`, `softRelaxations`, and `warnings`.
Conflicts name relevant requirement/exercise IDs. Generation throws
`SessionPrescriptionError` with that assessment when hard requirements fail.

The version-1 Coach contract defines:

- `requiredAnchors` / `preferredAnchors`: identified exercise requirements, optional
  `targetSets`, `targetExposures`, rep-range or timed `target`, `suggestedLoad`,
  `loadUnit`, `loadInterpretation`, `progressionIntent`, `prescriptionMode`
  (`reps` / `time`), and an `allowedProtocols` whitelist.
- `movementPriorities`: `{requirementId, pattern, priority}` with `primary`,
  `secondary`, or `maintenance` priority.
- `bodyRegionPriorities`: `{requirementId, bodyRegion, priority}` with `high`,
  `normal`, or `maintenance` priority.
- `avoidConstraints`: `{requirementId, importance, exerciseId | pattern | bodyRegion}`;
  exactly one selector, with `hard` / `soft` importance. Hard avoids apply to all phases.
- `protocolConstraints`: `{requirementId, importance, allowedProtocols, anchorRequirementId?}`;
  omitted anchor scope applies to every Main block.
- `variationPreference`: `varied` / `familiar`, a bounded recency preference.
  Reconciliation records a relaxation if required work must repeat a recent
  exercise, or a familiar exercise is unavailable. Only recent exercise IDs are
  retained as session context for reconciling later swaps.

Requirement IDs are unique across these lists. Generator options override the
prescription's duration/style/difficulty/body-focus/equipment defaults, so the
current equipment selection always controls eligibility. Prescribed durations
use the supported 10/15/20/30/45 minute budgets.

Required work reserves Main time before generic selection. Sets count full
left/right passes; exposures count executable side occurrences. Three per-side
sets therefore mean six exposures. Supplying both counts requires agreement.
An unspecified count reserves one pass. Targets must match the catalogue's rep/time
mode. Anchor intervals require explicit permission and catalogue compatibility;
an explicit hard `reps` mode still forbids timed playback.
Rounds/paired sets are preferred where feasible. Planned targets never alter the
catalogue or imply actual reps/load.

Generated `exercise.coachAnchor` metadata carries the requirement and planned
target. `workout.prescriptionOutcome` records hard satisfaction, required placements
(block ID/index, exercise index, protocol, sets/exposures), preferred satisfaction,
soft relaxations, and warnings. The Session Tracker links Main occurrences to
those requirements and copies the target into planned work. Generic anchor swaps
throw with `code: 'required-anchor-swap'`; optional swaps refresh reconciliation.
The workout retains the bounded session request for swaps, excluding programme context.

## Coach decision boundary

The pure Coach engine consumes an explicit, versioned programme definition, pinned
Programme State, immutable Session Results and today's context. It produces a
Session Prescription for the Generator and applies performed results idempotently.
Policies own feasibility, priorities, progression, short sessions and maintenance.

See [the Coach API and policy contract](docs/COACH_ENGINE.md). The General Strength
strategy is exercised with test-only definitions; no production programme or Coach
UI is supplied. Coach UI/UX design must precede implementation of issue #58.
