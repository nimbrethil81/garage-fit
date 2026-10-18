# GarageFit

Simple dependency-free PWA for fixed and generated garage workouts.

The More menu contains an Exercise Library for searching and browsing the full
canonical catalogue by equipment, with How to do it instructions for every exercise.

Live: https://nimbrethil81.github.io/garage-fit/

## Structure

- `index.html` — application UI and workout player
- `data/exercises.js` — canonical exercise catalogue and metadata
- `data/EXERCISE_METADATA.md` — meaning of every exercise field and how to author new exercises
- `data/equipment.js` — equipment catalogue
- `data/workouts.js` — fixed workouts
- `data/programmes.js` — immutable, versioned production Coach definitions
- `data/sport-profiles.js` — immutable sport identities and permitted programme settings
- `data/sport-capabilities.js`, `js/sport-coverage.js` — reviewed sport mappings and pure performed-history coverage; see [the tennis gap audit](docs/TENNIS_CAPABILITY_AUDIT.md)
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

```bash
node --test tests/*.test.js
```

See `AGENTS.md` before making changes.

Generated Main blocks occasionally include repetition ladders alongside circuits, supersets,
intervals and EMOM. Ladders show ascending or descending exact reps with recovery between
steps; Coach uses them only for permitted optional work, keeping required anchors on rounds.

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

Optional hard `mainTimeLimitSeconds` and `maximumDurationSeconds` reserve Main
time and cap the total generated duration, including preparation and rest.
Omitted limits preserve existing composition. Generation and swaps enforce them.

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

**Tennis Conditioning** keeps four stable knee, hinge, push and pull anchors,
2×6–10 double progression with confirmed comparable actuals. Each session selects
only the anchors and supporting targets that fit 10/15/20/30/45 minutes, preserving
preparation and rest. Balanced and two weekly Coach sessions are the defaults;
the instance-settings API supports one, two or three weekly sessions. Session roles,
omission rotation and supporting choices follow performed work and rolling 14-day
capability coverage, with explicit equipment/time limitations and no catch-up debt.
The third role at three sessions is conditioning/resilience without required strength
anchors. New Tennis programmes use v5's conservative schedule/readiness and event policy:
planned commitments stay separate from explicitly reported activity, lighter work
holds progression, and rest recommendations create no workout result. After six
meaningful sessions and 21 days of development, one reduced-demand consolidation
session holds anchor targets; real Main work returns it to development. Optional
tennis progress check-ins require 28 days and four meaningful sessions since start
or the last check-in/skip. Impressions remain separate from exercise progress.
Training intent and event controls prepare for an explicit local-date event with
conservative horizons, then return to ongoing development on the same instance.
Saved v1–v4 programmes retain their policies. v5 breaks equal recent anchor-dose
ties with earlier performed history so weekly short sessions do not repeatedly
omit a never-performed anchor. Coach groups Strength & fitness and
Cross-training → Tennis, with focus/frequency, usual playing days, intensity and
local-date event setup. Settings preserve the same anchors/history; optional daily
readiness, short-session preflight and performed capability coverage use the existing
player and Store. See the [Coach contract](docs/COACH_ENGINE.md).

Every Coach home uses the same compact layout: title and status, this week's
credited sessions (Tennis: its chosen weekly frequency; General Strength: 2–3, or
1–2 in maintenance; Build Arms: aim 3, 2 acceptable), a collapsed Adjust today
summary, View today's workout, and a due four-week review when there is one.
Every programme's Coach home links to one shared **Your progress** screen: one
tappable card per actual strength target (current prescription, last recorded
performance, stored next progression), recent saved sessions and the programme's
phase. General Strength shows its four-week block, Build Arms its seven-day
curl/extension exposure and Tennis its six capability cards for performed coverage
in the last two weeks plus any due check-in. It is read-only and invents no scores.
A shared **Programme settings** screen groups the training plan and programme
management. Tennis edits its existing focus, weekly frequency, playing days,
intensity and event; General Strength and Build Arms show their definition-fixed
plan read-only. Pause/Resume and a confirmed Finish work for all three; only
General Strength offers maintenance and its four-week review choices. Settings are
locked while a workout is in progress, and today-only adjustments stay on Coach home.

Coach history is local to this browser/device. Clearing browser or site data can
remove it; replacing a device does not automatically migrate it. Cloud durability
and cross-device continuity are deferred. Storage failures appear in Coach with a
retry action; valid performed evidence is retained when another record is damaged.
