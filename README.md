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
- `data/programmes.js` — immutable, versioned production Coach definitions
- `js/generator.js` — workout generation rules
- `js/rampup-ui.js` — ramp-up UI
- `js/coach-model.js`, `js/coach-store.js` — versioned Coach records and their local persistence
- `js/session-tracker.js` — records what actually happened during a tracked generated workout
- `js/coach-engine.js`, `js/coach-policies.js`, `js/training-history.js` — pure programme decisions, policy strategies and performed-training evidence
- `js/coach-recovery.js` — result/state/draft transaction and startup reconciliation
- `js/coach-ui.js` — Coach screens and recoverable engine/store/generator/tracker orchestration
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

Coach is the fifth navigation destination. Its first programme is 4-Week General
Strength: three stable squat/push/pull anchors, 2×6–10 double progression, and
20/30/45-minute sessions. Anchor Done explicitly confirms the visible actual
reps/load; blank values stay unknown. Temporary substitutes preserve the programme
anchor and begin a separate performance series. Controlled early exit saves performed
work, and interrupted Coach drafts are recovered automatically after reloading using only
durably recorded outcomes. Planned work and the current screen never earn recovery credit.

The four-week review separates calendar position from performed evidence and offers
Continue building, Maintenance or Finish. Maintenance retains the same instance and
load history with one anchor set, 20-minute sessions and less supporting pressure.

See [the Coach API and policy contract](docs/COACH_ENGINE.md) and
[the production pilot verification](docs/COACH_PILOT.md).

Coach also offers **Build Arms**, an open-ended objective with one stable direct
curl and one direct extension anchor. Both start at 3×8 and progress to 3×12 before
an explicitly confirmed resistance increase. Separate rolling seven-day targets
are nine performed direct set exposures each; compound work provides separate
whole-body maintenance context. Bands/TRX log a confirmed resistance setup through
the same anchor UI. See [the Build Arms pilot](docs/BUILD_ARMS_PILOT.md).

Coach history is local to this browser/device. Clearing browser or site data can
remove it; replacing a device does not automatically migrate it. Cloud durability
and cross-device continuity are deferred. Storage failures appear in Coach with a
retry action; valid performed evidence is retained when another record is damaged.
