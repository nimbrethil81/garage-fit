# Coach engine and policy contract

Load `data/sport-profiles.js`, `coach-model.js`, `training-history.js`, `coach-policies.js`, then
`coach-engine.js`. For Tennis also load `data/sport-capabilities.js`, `sport-coverage.js`
and `coach-tennis-policy.js` (after `coach-policies.js`, before creating the engine).
General Fitness similarly needs `coach-general-fitness-policy.js` (after `coach-policies.js`)
and, to generate its sessions, the workout-family modules and composers.
These scripts use the repository's `GarageFit*` globals and run
in Node without browser, storage, player, clock or third-party dependencies.
They are dormant until a caller explicitly creates an engine.

```js
const engine = GarageFitCoachEngine.createEngine({
  catalogue: GarageFitData.exercises,
  registry: GarageFitCoachPolicies.createDefaultRegistry(),
  assessSessionPrescription: GarageFitGenerator.assessSessionPrescription
});
const assessment = engine.assessProgrammeFeasibility(definition, {equipment});
const started = engine.startProgramme(definition, {programmeInstanceId, equipment}, now);
const planned = engine.planNextSession(definition, started.state, sessionResults, {
  now, prescriptionId, equipment, duration, easyToday, bodyFocus
});
// When planned.prescription exists, pass it to Generator.generate().
// After execution, persist the immutable Session Result through Coach Store, then:
const updated = engine.applySessionResult(definition, started.state, result, sessionResults);
// Persist updated Programme State through Coach Store.
```

IDs and ISO timestamps come from the caller. `duration` is in minutes and
`bodyFocus` uses `upper`, `lower`, `core`, or `full-body`. Equipment is today's owned
equipment selection. No input is mutated. The catalogue is snapshotted at engine
creation; definitions and hook inputs are validated and frozen.

Feasibility returns `{status, conflicts, anchors, prescription}` for the General
Strength strategy. Its prescription is an assessment request with a synthetic ID,
not a prescription to execute. Supplying Generator's pure preflight also returns
`generatorAssessment`, preserves soft relaxations, and checks physical composition
constraints such as required work fitting Main time. Without that adapter, the
engine evaluates policy feasibility and anchor eligibility only.

Start returns `{status, state, assessment}`; infeasibility returns `state: null`.
Planning returns `{status, prescription, conflicts, assessment, rationale}`; hard conflicts
return `prescription: null`. Planning projects calendar progress in rationale and
recomputes priorities from today's evidence. It never advances stored progress,
awards dose, records overrides or queues catch-up work.

`pauseProgramme`, `resumeProgramme`, `enterMaintenanceMode` and
`exitMaintenanceMode` return new Programme States. Paused/completed states cannot
plan. Completed states cannot change lifecycle/mode. Applying a result is allowed
after pausing so an in-flight session can still be reconciled.

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

## Versioned definitions

Definitions are plain JSON with `schemaVersion: 1`, `id`, positive integer
`version`, policy `type`, string `objective`, `openEnded`, and, when bounded,
positive `nominalDurationDays`. `nominalProgress` measures elapsed days from
`startedAt`; elapsed days alone award no meaningful sessions or progression.
The engine rejects a definition whose ID/version differs from the state's pin.

The General Strength strategy requires these explicit inputs:

| Field | Meaning |
| --- | --- |
| `recommendedFrequency` | `minSessionsPerWeek` / `maxSessionsPerWeek` |
| `coverageTargets` | Rolling `windowDays`, broad `patterns` and optional `bodyRegions` exposure targets; optional boolean `includeStandaloneHistory` (see below) |
| `doseTargets` | Eligible `sections` and `meaningfulExposure` threshold |
| `anchorSelectionPolicy.requirements` | Ordered candidate `exerciseIds`, `pattern`, `role` (`primary` / `accessory`), and bounded Generator anchor fields |
| `progressionPolicy` | Explicit `minimumRepsImprovement`, `minimumLoadImprovement`, `minimumSecondsImprovement` thresholds; each positive or null to disable that progression category |
| `sequencingRules` | Explicit `minimumRecoveryHours` and any additional essential preparation/rest context |
| `shortSessionPolicy` | `preservePreparation: true`, `preserveRest: true`, and explicit reduction `tiers` |
| `maintenancePolicy` | `frequency`, `coverageMultiplier`, `keepAccessories`, `allowProgression`, `anchorTargetOverrides` by requirement ID |
| `missedSessionPolicy` | `strategy: 'recompute-no-debt'` |
| `feasibilityRequirements` | `minimumDurationMinutes` and `requiredPatterns` |
| `completionCriteria` | `minimumMeaningfulSessions` (null for no automatic completion) and `requireNominalDuration` |
| `sessionTemplate` | Bounded Session Prescription defaults: duration, workout style, difficulty, body focus, variation and constraints |

Anchor requirements explicitly supply dose, target, prescription mode and permitted
protocols. Candidate order selects stable anchors deterministically, with an optional
`context.anchorSelections` map allowing explicit selections. Unknown/missing
equipment, exercises, coverage or incompatible anchors produce conflicts.

Short-session tiers specify `maxDurationMinutes`, `primaryPriorityLimit`,
`primaryPreferredLimit`, `accessoryLimit` and `keepSecondaryPriorities`. The first
matching duration tier reduces soft intent in this order: required anchors,
primary objective work, essential preparation/rest constraints, optional accessories.
Required anchors and their targets stay intact. The strategy preserves workout
style/rest and never increases difficulty or density to compensate. Generator
preflight rejects an impossible remaining hard prescription.

Maintenance retains the same definition and instance, applies explicit anchor
target overrides and coverage/frequency reductions, drops accessories when
specified, and holds progression when disabled. It does not award completion from
calendar passage. Progression decisions are recorded as evidence (`baseline`,
`progress`, `hold`, `hold-maintenance`, `new-exercise-series`); they do not invent
load increments, change exercise difficulty, or automatically replace exercises.

`data/programmes.js` ships `general-strength-4w`, version 1, using the production
values approved in issue #58. The definition is pinned in each Programme State and
must receive a new version for material policy changes. Test fixture definitions
remain separate from this release. Its three stable squat/push/pull anchors start
at 2×6, with 20/30/45-minute sessions and a recommended 2–3 sessions per week.

The production `double-progression` strategy persists `anchors[].currentTarget`,
`comparisonBaseline`, latest progression and substitution history. It requires both
sets (including both sides for unilateral work) with confirmed comparable actual
reps/load. It advances one rep through 6–10, then suggests the next heavier weight;
confirmed heavier work resets the target to 6 without inventing a load increment.
Partial/skipped, unknown or incompatible evidence holds progression. Easy today and
maintenance hold it as well. Whole-session feedback cannot award progression.

`doseTargets.meaningfulRule: 'any-performed-main-work'` counts a session only when
catalogue-resolved Main work has positive performed exposure; preparation alone is
abandoned on early exit. The rolling pattern floors are priority targets, not quotas.
General Strength start feasibility preflights the selected anchors at every supported duration.

The optional `anchorAlternatives` policy hook validates candidates for a programme
role. `engine.getAnchorAlternatives(definition, state, context, requirementId)` exposes
these for substitutions. Planning accepts `todayContext.anchorSubstitutions`, a map
of requirement ID to substitute ID, and creates a temporary prescription at the new
exercise's initial target. It never rewrites persistent anchors or imports their load.
The tracker records planned original identity and actual substitute identity.

`engine.programmeReview(definition, state, now)` projects nominal block progress and
counts meaningful sessions within the reviewed 28-day block. It does not mutate state
or automatically complete the programme. `acknowledgeBlockReview(...)` advances the
review marker while retaining identity, anchors and history. The four-week UI offers
Continue building, Maintenance or Finish. `finishProgramme(state)`
is the explicit terminal operation. Mode/lifecycle changes still go through the engine.

Production maintenance uses one anchor set, 20-minute sessions, 1–2 sessions/week,
half the coverage priority floor and softer preference for supporting accessories;
challenge and instance identity persist. Optional `maximumDurationMinutes` belongs
to the definition and caps available time without increasing density or reducing rest.

`GarageFitCoachUI.createController(...)` owns recoverable application orchestration.
It saves immutable results, applies them idempotently, persists state, then clears
the active draft. Startup reconciles saved results before allowing another session.
The store also discovers an immutable result stranded by an interrupted index write.
Interrupted Coach drafts recover automatically on reload using only durable outcomes.

Unreviewed permanent anchor replacement and a complete previous-programmes browser
remain optional future extensions; records are retained for them. Reviewed,
user-confirmed variation changes are described in
[Exercise-variation progression](#exercise-variation-progression-opt-in).

## Coach screens

Coach groups Strength & fitness and Cross-training → Tennis. Tennis setup offers
focus/frequency, usual playing days, intensity and an optional local-date event.
Anchor Done explicitly confirms visible actual reps/load; blank values stay unknown.

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

Regression coverage lives in `tests/coach-home.test.js`, `tests/coach-progress.test.js`
and `tests/coach-settings.test.js`.

## Policy strategies

`createRegistry({type: policy})` returns a registry with `register`, `get`, and
`types`. Duplicate types and incomplete strategies are rejected.
`createDefaultRegistry()` registers the parameterised `general-strength` and
`build-arms` strategies, plus `tennis-conditioning` and `general-fitness` when their
modules are loaded.
Other programmes register their own type and hooks.

Required hooks are `validateDefinition`, `assessFeasibility`, `initialiseState`,
`calculatePriorities`, `buildPrescription`, and `interpretDose`. Optional hooks
are `getModeSettings`, `assessPlannedSession`, `interpretProgression`,
`respondToMissedSessions`, `reduceForShortSession`, `isComplete`, and
`validateProgrammeSettings`.

The optional `validateProgrammeSettings({definition, settings})` hook receives
frozen inputs and throws for policy-specific restrictions beyond the sport profile.
It runs on creation, settings updates and definition-bound state operations.

Two further optional hooks support exercise-variation progression:
`anchorAlternatives` (see substitutions below) and `progressionHold({definition, state,
result, mode})`, which returns the hold code (`hold-maintenance`, `hold-easy-today`) a
performed result is subject to, or `null`. A definition can opt in only when its policy
implements both. Tennis deliberately does not inherit `progressionHold`.

Hooks receive an object with the relevant `definition`, `catalogue`, `context`
(at start), `state`, `history`, `today`, `mode`, `priorities`, `prescription`,
`result`, and `evidence`. All hooks must be pure. Initial state additions are
`{anchors, currentTargets}`; engine identity/lifecycle/reconciliation fields are
protected. Dose interpretation returns `{meaningful, exposure: {value, confidence},
patterns, bodyRegions}` based solely on performed evidence. Progression returns
updated anchors. Completion returns a boolean. `assessPlannedSession` returns
`{conflicts}`. The engine validates outgoing records through Coach Model.

Feasibility and planning hooks also receive `assessSessionPrescription(prescription)`
when the engine's Generator adapter is supplied. This pure callback consumes no
randomness. Existing strategies retain their preflight path. A strategy owning start
shapes can return `prescription: null` and explicit per-duration assessments rather
than ask the engine to repeat one prescription at every duration.

## Tennis Conditioning

The immutable `tennis-conditioning` v1 definition registers a separate pure policy.
It selects four eligible canonical anchor identities at start (knee, hinge, upper push,
upper pull); the knee prefers unilateral lunges with explicit squat alternatives.
Bodyweight alone fails with an actionable missing-pull conflict. Definition-bound
default settings initialise Tennis/Balanced/two sessions; existing definitions have no
defaults and keep their saved settings semantics.

Start checks all four roles and reports `durationAssessments[].roles` with their actual
prescriptions/conflicts. A role that cannot fit a short budget does not make every
supported duration fail. Planning uses the same pure Generator preflight to choose
the hard subset before issuing a prescription, holding each selected strength anchor
at two complete rounds sets (both sides where applicable). `mainTimeLimitSeconds`
reserves 30 seconds for whole-step preparation timing, and `maximumDurationSeconds`
caps the complete workout. These opt-in limits also apply to swaps; General Strength,
Build Arms and no-prescription generation omit them and retain their existing output.

One weekly session emphasises full body; two balance strength/stability with
movement/conditioning; three distribute strength, movement/power and
conditioning/resilience. The last role has no required progression anchors and avoids
optional primary strength work. Roles balance earned sessions over 14 days: a role
label in a result's overrides needs a full two-set anchor contribution or a completed
mapped supporting target. Preview, skipped/abandoned results, unknown partials and
tiny partial loops cannot advance the rotation. Partial sessions can earn their actual
useful contribution. Where a role has no attainable target, another feasible role
provides work with an explicit warning; no role quota or catch-up queue is created.

Anchor selection for today favours the least performed full-pass exposure, so repeated
short sessions rotate unavoidable omissions. Deferred targets/baselines remain intact.
Core capability gaps retain Balanced priority under focus preferences; supporting
exercises rotate by actual identity/recency. Availability, missing facets and time
shortages are separate warnings, not invented coverage. Coverage uses the pinned sport
mapping and actual Main observations; no sport calendar or feedback earns exercise dose.
Supporting targets can be required for execution without becoming stable progression
anchors. The existing player logs them through normal Done/timed evidence.

The policy reuses exact exercise/protocol/side/actual-load double progression (6–10,
about two reps in reserve). Explicitly confirmed nonnumeric setups use the shared
band/TRX contract. Temporary substitutes use eligible candidates for the same role,
retain the programme anchor, and start a separate series with no inherited load.
Tennis v1 remains pinned for existing programmes. Later versions add the bounded
schedule/readiness adaptation and home movement composition described below.
The existing controller's settings API supports frequency/focus and usual playing
days/intensity without resetting anchors.

## History and confidence

`GarageFitTrainingHistory.createHistory(results, catalogue)` validates, deduplicates,
chronologically sorts and freezes Session Results and performed observations.
Conflicting contents under the same result ID are rejected. It provides:

- `sessionsForProgramme(instanceId, options)`;
- `recentPerformedSessions(options)`;
- `exactExercisePerformances(exerciseId, options)`;
- `movementPatternExposure(pattern, options)`;
- `directElbowExposure(action, options)`;
- `compoundPatternExposure(pattern, options)` (excludes direct arm work);
- `bodyRegionExposure(bodyRegion, options)`;
- `anchorPerformanceSeries(requirementId, options)`;
- `sessionEvidence(sessionResultId)`;
- `contextualEvidence(options)`.

Options support `programmeInstanceId` and inclusive `since` / `until`. With a
`programmeInstanceId`, `includeStandalone: true` also includes performed work
recorded outside any programme (e.g. completed standalone generated workouts) as
context; `sessionsForProgramme` never includes it. Each performance carries its
result's `source`. Observation
and recent-performed queries also support `sections`; recent queries support
`limit` and return newest first. Unknown timestamps do
not satisfy a time window. Sessions for a programme and anchor series are ordered
oldest first. Interleaved left/right work retains separate comparable series.

Only completed/partial `performedWork` creates observations. Planned-only work,
session start, skipped work, aggregate `anchorResults` and cached `derivedExposure`
cannot create extra dose. Actual exercise IDs supply patterns/body focus from the
canonical catalogue, including substitutions; missing actual identity stays unknown.
The General Strength policy credits only catalogue-resolved work in eligible sections.

One completed occurrence earns one **derived** exposure, even if actual reps/load
are unlogged. An explicit zero actual measurement earns zero. Partial work uses
confirmed reps/time divided by its planned occurrence target, capped at one;
unmeasured partial work has unknown exposure. Exposure sums report known credited
amounts and preserve unknown confidence; zero credited amount does not assert that
an unknown performance was zero. These are coverage units, not invented load,
tonnage or physiological dose. Actual measurements are **confirmed**, intrinsic
pattern/region contributions **derived**, and absent performance/load **unknown**.
Explicit `feedback.contextualContribution` is retained separately with its supplied
confidence (including **approximate**). External activity never enters resistance
performance or dose queries.

## Standalone generated workouts

A standalone generated workout that reaches normal completion is saved through Coach
Store as a `source: 'generator'` Session Result with no programme or prescription
link. Its tracker draft stays in memory (`GarageFitCoachStore.withEphemeralDraft`),
so it never replaces a persisted Coach draft and nothing is saved before completion.
A confirmed early exit keeps the existing "progress won't be saved" behaviour and
discards the run. Previews and starts earn nothing. `gf_generator_history` is still
written separately by the player as the Generator's recency record.

The lightweight player records rep work as Done without actual reps/load, timed
work as measured seconds, and never copies a planned or catalogue load. Such results
contribute broad exact-exercise, pattern and body-region exposure. They are not
programme sessions: the engine refuses to apply them, so they cannot change
`meaningfulSessionsCompleted`, dose, reconciliation or anchor progression.
`comparePerformanceEvidence` is source-agnostic, so a standalone performance with
confirmed comparable actuals is valid evidence for a future policy that explicitly
grants it credit; coarse completion is `insufficient-evidence`.

A General Strength definition opts in to counting standalone work towards its
rolling coverage priorities with `coverageTargets.includeStandaloneHistory: true`.
Released `general-strength-4w` version 1 does not set it, so its planning is
unchanged; adopting it requires a new definition version.

## Comparability and reconciliation

`comparePerformances(previous, current)` requires exact exercise ID, matching known
prescription mode/protocol, known side interpretation, and matching relevant protocol
conditions. Planned occurrence `prescription.protocolConditions` supplies these:

| Protocol | Required condition fields |
| --- | --- |
| `rounds` | `exerciseRestSeconds`, `roundRestSeconds` |
| `paired_sets` | `betweenExercisesSeconds`, `betweenSetsSeconds` |
| `timed_intervals` | `workSeconds`, `transitionSeconds` |

Other supplied conditions (e.g. tempo, paired exercise/order) must match too. Timed
observations include prescribed `seconds` as `workSeconds`. This context describes
execution conditions; it never supplies actual reps/time/load. Producers that omit
conditions, including older Tracker records, remain incomparable until explicit
evidence exists. No catalogue family/repetition class/difficulty implies comparison.

`comparePerformanceEvidence` additionally checks actual set count, numeric load,
unit and `per-item`/`total` interpretation, and achieved reps/time. It distinguishes
improved reps/time at the same load, improved load at comparable performance,
unchanged/insufficient evidence, and unknown load. No unit conversion or planned
load inference occurs. General Strength compares observations between sessions,
requires completed comparable observations for threshold decisions, and keeps
substitutions in new series. Applying an older result cannot overwrite newer
progression evidence.

Result application uses `lastAppliedSessionResultId` plus
`currentTargets.reconciliation.appliedSessionResultIds`. Retain that ID ledger when
compacting recent summaries: it makes even older result retries deterministic
no-ops. Cumulative credited exposure lives in `currentTargets.dose`; per-anchor
progression evidence lives in `anchors[].progression`. Only meaningful performed
results add override/substitution summaries. Store these records through Coach Store;
no engine/history/policy operation accesses storage directly.

## Exercise-variation progression (opt-in)

Within an exercise, progression stays the policy's automatic, evidence-based rule.
Moving a stable anchor to another exercise is never automatic: Coach may recommend a
reviewed edge, and only an explicit user confirmation changes the anchor. No released
definition opts in, so their behaviour and stored records are unchanged.

A definition opts in with `variationProgressionPolicy.edges`. Each edge is reviewed
programme data, not catalogue hierarchy or a "next harder" inference:

| Field | Meaning |
| --- | --- |
| `edgeId` | Stable ID, unique in the definition |
| `requirementId` | The anchor requirement; at most one edge per requirement and `fromExerciseId` |
| `fromExerciseId` / `toExerciseId` | Two catalogue exercises, both requirement candidates, in the requirement's prescription mode (and direct action, if any) |
| `evidence` | `consecutiveSessions` (1–8) and `minimumRepsPerSet` (reps mode) or `minimumSecondsPerSet` (time mode) |
| `repromptAfterSessions` | Qualifying sessions after a decline before the same edge is offered again (1–8) |
| `startingTarget` | `target` in the requirement mode and optional `progressionIntent`; sets and protocols come from the requirement |

Applying a Coach result records, for an anchor with an outgoing edge, one bounded
evidence entry in `anchors[].variationProgression` (`schemaVersion: 1`, validated by
Coach Model; at most 8 entries and 32 transitions). Results remain the authority. An
entry is `qualifying` only when every planned Main occurrence of the full anchor dose
was completed with the anchor's own exercise, every set has a confirmed actual at or
above its planned target, and the observations are comparable (known side, protocol and
conditions). Otherwise it records `incomplete`, `unknown-actuals`, `below-target`,
`incomparable`, or the policy's hold. Any such performed attempt restarts the
consecutive count, as does changed protocol conditions; sessions where the anchor was
not performed, or only substituted just for today, are no evidence either way.
Timed holds use the tracker's measured seconds. Each edge reads only its own anchor's
exercise, so support-hold work never implies dip readiness.

```js
const items = engine.variationProgressionRecommendations(definition, state, {equipment});
// [{recommendationId, edgeId, requirementId, fromExerciseId, toExerciseId,
//   evidenceSessionResultIds, evidence, currentTarget, startingTarget}]
engine.confirmVariationProgression(definition, state, {recommendationId, equipment, now});
engine.declineVariationProgression(definition, state, {recommendationId, equipment, now});
// → {status: 'confirmed' | 'already-applied' | 'declined' | 'already-declined' | 'stale', state}
```

A recommendation needs an active programme whose mode allows progression, the
required consecutive qualifying entries, and the target exercise eligible for the
requirement with the supplied equipment (policy `anchorAlternatives`). It is a read and
never changes state. Its ID names the edge and latest evidence result, so newer
evidence, pausing, maintenance or missing equipment makes an older ID `stale`; stale
decisions return the state unchanged. Declining records only the decision. Confirming
changes the anchor's identity, `selectedAt` and `currentTarget` to the starting target,
clears its comparison baseline and load fields, and appends a transition with the
evidence IDs and previous target. Prior Session Results stay untouched; Training History
already starts a new series for the new exercise. The transition ID makes a replayed
confirmation an exact no-op, and older results applied later cannot rewrite the new
series. `rebuildDerivedState` preserves these anchor decisions.

The controller exposes `variationRecommendations(equipment)`, `confirmVariation(id,
equipment)` and `declineVariation(id, equipment)`. Decisions use the same durable
settings-change path: refused while a session or draft exists, applied to the stored
state, and previews are invalidated. Coach home shows the current and proposed
exercise, the factual evidence and starting target, with **Try progression** and
**Continue current exercise**. A future programme version opts in by adding reviewed
edges and thresholds to a new definition version; existing instances stay pinned to
their saved definition. `tests/variation-progression.test.js` and
`tests/variation-progression-ui.test.js` pin this contract with test-only fixtures.

## Build Arms

`build-arms` version 1 is a second immutable production definition. Its anchor
requirements select candidates from canonical `directElbowAction` rather than
an exercise-ID list. The common candidate/eligibility and substitution flow still
checks equipment, Main/generator eligibility, rep mode and protocol compatibility.
Supporting-role direct work is eligible; compound push/pull cannot replace it.
The same pure Generator preflight verifies all supported 20/30/45-minute budgets.

Policy `build-arms` reuses common lifecycle, prescriptions, double progression,
tracking and result application. Its rolling direct-dose and maintenance queries
exclude each other's direct/compound evidence. `rationale.priorities.directDose`
exposes per-action performed value, target and confidence; cumulative direct work
and compound context are retained separately in `currentTargets.dose`. Preferred
maintenance prescriptions restore deficient broad patterns after required work;
unsupported maintenance equipment is explained in the preview. Open-ended review
never creates a four-week review or automatic completion. The definition exposes
pause/resume/finish without an unapproved reduced-volume maintenance mode.

The common actual-set contract optionally accepts `resistanceSetup`, a stable ID
that the user explicitly confirms for nonnumeric resistance. A new setup ID means
a fresh baseline, never a quantified resistance increase. The shared history
comparison can compare reps/time under the same confirmed setup while retaining
the exact exercise/protocol/side constraints; missing setup and missing numeric
load remain unknown. The programme opts into setup progression through
`progressionPolicy.allowConfirmedSetup`. `programmeContext.anchorResistance`
supplies per-anchor confirmation context to the generic player, including whether
numeric load is meaningful and whether a harder setup may be confirmed. Actuals
are saved only on explicit Done/confirmation; no setup or load is inferred from
the plan. General Strength retains its existing numeric-load progression rules.

Build Arms aims for three meaningful sessions per week; two is acceptable and
missed sessions create no debt. Each direct anchor starts at 3×8 and progresses
through 3×12 with comparable confirmed actuals. Numeric load suggests the next
heavier available load without inventing an increment. Bands/TRX show “Ready for
more resistance” at the ceiling and reset to eight only after an explicitly
confirmed harder setup. Easy today holds progression.

Rolling seven-day targets are nine performed direct set exposures per action.
Completed occurrences earn one, measured partials earn their performed fraction
capped at one, and skipped/planned-only work earns zero. Compound push/pull is
separate maintenance context, never quantified biceps/triceps sets. Whole-body
floors are one exposure each for squat, hinge, lunge, compound push, compound pull,
core and carry in seven days. Short sessions omit maintenance preferences; later
sessions recompute deficits without debt. The catalogue currently needs dumbbells
for carry maintenance. `tests/build-arms.test.js` pins these production rules;
`tests/coach-pilot.test.js` pins General Strength's end-to-end flow.

## General Fitness

`general-fitness` version 1 (`data/programmes.js`, policy `js/coach-general-fitness-policy.js`)
implements the approved #190 Decisions 1–8 on the same registry, lifecycle, store/recovery,
prescribed Generator seam and player. It is open-ended and **anchor-free**: start needs no
anchors or equipment prerequisite (`assessFeasibility` returns `prescription: null`), state
holds `anchors: []`, there is no progression, maintenance mode, review or automatic completion,
and pause/resume/finish are the common transitions. Its own Coach results are credited through
the common performed Main-work rule; nothing else is.

Each plan chooses an intended **workout family first**, then lets the shared composer resolve
the internal style from performed protocol recency and the shared gate validate it:

- **Performed training effects.** The rolling 28-day window reads performed sessions from every
  GarageFit source the caller supplies (this and other Coach instances, standalone Generator,
  fixed workouts; the controller adds a bounded cross-source query because the definition sets
  `coverageTargets.includeCrossSourceHistory`). A session with a recorded family contributes its
  family's effect shares (`strength`, `conditioning`, `challenge` (Full-Body Challenges also
  shares a quarter each with strength and conditioning), `athletic`, `core`, `mobility`); a
  legacy/generic session contributes effects derived from its performed Main exercises' metadata
  (core body focus, conditioning/cardio-dominant, otherwise strength ≥ 3). Partial sessions
  count their performed fraction of planned Main work. Preparation, planned-only, skipped and
  external records contribute nothing. These are planning inputs, never programme credit.
- **Balance and attendance.** Effect target weights favour the strength and conditioning
  foundations (3/3 against 1 for athletic, core, mobility and 0.5 for challenge below three
  performed sessions a week over the last 14 days; 2/2 against the same at or above it). Each
  family scores its effect shares of `targetShare × (performed sessions + 1) − performed effect`;
  needs recompute every plan, so missed days, gaps or 2–5 weekly sessions create no debt,
  catch-up session or rigid rotation. After a long absence the plan matches a fresh start.
- **Variety.** The previous family is penalised (Strength & Control only lightly, at most two in a
  row) and recent repeats in the last three sessions add a small penalty; exercises and
  protocols vary through the Generator's existing cross-source `history`/`recentProtocols`.
  There are no novelty quotas.
- **Recovery and intensity.** A demanding performed session (Strength, Cardio, Challenges, or
  derived strength/conditioning work) within 24 hours, or a confirmed `reportedSportActivity`
  with hard intensity today or yesterday, orders lower-demand families first. Duration, existing
  difficulty (`difficulty`, or `easyToday` for Easy), body focus (Strength & Control only),
  equipment and optional `excludedImpact`/`bodyPositions`/`movementRoom` come from today's
  context. No readiness prompt or rest recommendation is introduced.
- **External preferences.** With `todayContext.externalActivity` (the controller supplies
  `externalActivityContext` for this definition) typical routines raise the mobility weight by
  0.25 per weekly session, capped at 0.5, labelled approximate. They never earn effect credit.

The prescription has `sessionRole: 'general-fitness'`, no anchors and a `workoutFamilyPlan` of
all six families in priority order, each with its rationale; `programmeContext` records the
intended family and recovery reasons, and `rationale.priorities` exposes effects, family scores,
attendance, recovery, external context and the history sessions used (`credit: 'none'`). The
Generator builds the first feasible family and reports any transparent replan (see
[Workout families](WORKOUT_FAMILIES.md#shared-validation-same-family-fallback-and-edit-integrity));
the tracker records the delivered family/style. Unsupported durations are planning conflicts;
a plan no family can build fails visibly with each family's reasons. `tests/general-fitness.test.js`
covers lifecycle, sequences at 2/3/5 sessions per week, cross-source context, recovery,
external preferences and the family-plan seam.

**Shared Coach screens (#191).** General Fitness uses the same discovery, home, weekly
progress, Adjust today, workout card, preview/edit, player, Your progress, session history and
Programme settings as every programme; there is no separate page, tab or style selector.
Presentation is neutral to `state.anchors.length`: strength targets, anchor substitution and
anchor/progression copy render only when anchors exist. The home card names the plan's intended
family, duration and family purpose; the preview, saved-session notice, weekly list and session
history show the **delivered** family and style (`GarageFitCoachProgressUI.workoutIdentity`),
with a status line when the plan was replanned or a same-family style fallback was used. Records
without a complete published identity keep neutral copy and are never given a family label.
Programme settings for a definition with `externalActivityPolicy` include an optional, editable
"Usual activities" section over the shared preferences seam; it never blocks planning.

### Optional comparable benchmarks (#192, v2)

`general-fitness` **version 2** (`benchmarkPolicy`) is v1's scheduling unchanged plus the approved
Decision 7 C: occasional, optional, embedded benchmarks. Released v1 is not edited; saved v1
instances stay pinned and never offer one, and new starts select v2. The policy is closed and
validated: a published family, a cadence of at least 28 days, a first-session wait, a session of
at least 20 minutes, one fixed rest and one to four reviewed benchmarks, each an unloaded,
bilateral, rep-based catalogue exercise. Reviewed set: push-up, air squat and leg raises (push,
squat, core), each with the explicit unloaded setup id `bodyweight`.

- **Offer.** `rationale.priorities.benchmark` explains every plan (`offered` or a reason: too-early,
  recent-benchmark, short-session, easy-today, recovery-preferred, other-family). It is offered only
  after a first meaningful session, at least 28 days after the last benchmark *occasion*, in a plan of
  20 minutes or more that is not Easy, has no recovery preference, and whose first (intended) family is
  Strength & Control. An occasion is a completed session that reached the benchmark (measured or
  skipped) or any session that measured one; an abandoned or early exit that measured nothing does not
  use the opportunity up. Cadence is read from saved results: no benchmark state, queue or debt is
  stored on Programme State, and a long absence yields a single opportunity.
- **Embedding.** The prescription's `workoutFamilyPlan.benchmark` (family, rest, items) is honoured by
  the Generator only for the plan's first family (see [Workout families](WORKOUT_FAMILIES.md#optional-embedded-benchmark-192)).
  The family choice, replanning and style are those of the benchmark-free plan; if the family cannot carry
  the block it is delivered without it. Skipping any measurement in the player records nothing.
- **Recording.** Benchmark occurrences link to requirement `benchmark:<benchmarkId>`, so the existing
  tracker's `recordAnchor`, drafts, results and recovery carry them with no new record kind. The player
  shows the shared actuals panel with blank reps and a confirmation that the set was bodyweight only;
  only entered reps and a confirmed `resistanceSetup` are saved. Planned reps are never copied in.
- **Comparison.** `GarageFitCoachGeneralFitnessPolicy.benchmarkImprovement` calls
  `comparePerformanceEvidence`: only completed, single-set, rep-counted observations of the exact exercise
  with a confirmed setup and no numeric load are usable, and only against an earlier observation that shares
  exercise, side, setup, prescription mode, protocol and protocol conditions. A changed condition is shown
  as *not enough comparable evidence* (kept separately, never converted); an improvement, a repeat and a
  lower result are each reported as such.
- **Progress.** The shared Your progress screen shows three separate sections for v2 and later:
  **Training consistency** (credited sessions per recent week, zero weeks included),
  **Capability balance** (performed training effects over the rolling window across all GarageFit
  sources, with unmeasured work flagged) and **Demonstrated comparable improvement**. There is no combined
  score, recovery or cardio metric. The controller reads benchmark observations by exercise for this
  instance (bounded, newest first) and exposes them as `progressEvidence()`.

`tests/general-fitness-benchmarks.test.js` covers the policy, cadence, embedding, gate, recording,
recovery, comparison matrix, screens and the unchanged legacy paths.

## Sport profiles and instance settings

`data/sport-profiles.js` defines immutable sport identities, capabilities, permitted
configuration and defaults. Tennis profile v2 names the six conditioning capabilities
and references immutable `tennis-conditioning` mapping v1. Tennis Conditioning v1
uses these capabilities for session priorities. General Strength and Build Arms retain settings as
context without changing their training policies or exposing sport setup in the UI.

`currentTargets.programmeSettings` is an optional, reserved Programme State
namespace with its own `schemaVersion: 1`. Coach Model validates it on every state
read/write. Absent settings remain absent on existing records; Programme State,
results, drafts, indexes and definition pins retain their version-1 contracts.

```js
const settings = GarageFitCoachModel.createProgrammeSettings({sportId: 'tennis'});
// Pure helpers: updateProgrammeSettings(settings, patch), assertProgrammeSettings(settings).
const changed = engine.updateProgrammeSettings(definition, state, {
  sportId: 'tennis', intent: 'event', significantEventDate: '2026-11-01'
});
// Controller saves only the current instance through Coach Store, using durable state.
await controller.saveProgrammeSettings({sportId: 'tennis', focus: 'power'});
// Optional initial choices: controller.start(definition, equipment, settings), or
// engine.startProgramme(definition, {...context, programmeSettings: settings}, now).
```

Fields are `sportId`, `focus` (default `balanced`, or `movement`, `power`,
`endurance`, `resilience`), `weeklyCoachFrequency` (1/2/3, default 2),
`usualPlayingDays` (unique lowercase weekday names; `[]` means irregular/no fixed
days), `typicalSportIntensity` (`light`/`moderate`/`hard`, default `moderate`),
`intent` (`ongoing` by default or `event`), and optional `significantEventDate`.
Dates are validated `YYYY-MM-DD` local calendar dates, retained as strings without
UTC conversion. Event intent may omit a date; ongoing intent requires it absent/null.
Switching back to ongoing therefore clears a known date explicitly in the patch.
Invalid values, unknown fields/sports and unsupported versions throw; defaults
apply only during creation, never to repair invalid saved settings.

Settings survive lifecycle changes, result application, startup recovery and
`rebuildDerivedState`. Updating them preserves identity/pins, anchors, progression,
dose and result reconciliation; it creates no training credit. Controller updates
invalidate previews, reject an in-flight session or changed active reference, and
publish new in-memory state only after the store write succeeds.

Optional `todayContext.sessionContext` is a closed, transient boundary. Readiness
is `{value: 'fresh' | 'normal' | 'tired', localDate: 'YYYY-MM-DD'}`; absent/null or a
previous-day check-in means Normal. Future readiness rejects. Explicit
`reportedSportActivity` entries contain only `sportId`, `localDate`, `intensity`;
at most seven entries, one per sport/day. Tennis v2 requires reports within the
last seven local days, including today, and rejects future reports. Optional
`plannedMatchDate` is a date-only planned commitment, never confirmation of play.
Coach Model validates the boundary before planning. No diary or new store is added.

Tennis v2 planning accepts an explicit `todayContext.localDate`. The browser
controller supplies its local calendar date from the injected clock. Pure callers
using UTC instants for local planning must supply it too; when omitted, the date
label of `now` is used (including an explicit timestamp offset). Weekday and day
distance arithmetic uses calendar dates, so midnight, week/year boundaries and
DST do not fabricate another day of reported activity.

`GarageFitCoachTennisPolicy.classifyContext({definition, state, today})` exposes
`usual`, `lighter` or `rest`, separate planned slots/confirmed reports, readiness
and short truthful reasons. Pilot rules in immutable Tennis v2 are:

- Hard usual tennis today/tomorrow, an explicit match/event today/tomorrow, or
  reported hard tennis today/yesterday prefers lighter work. A past usual weekday
  never becomes evidence that tennis occurred. Light/moderate preferences and
  reports remain visible context without asserting a demanding recovery need.
- Lighter work caps available time at 20 minutes and strength anchors at one,
  prioritises upper/trunk work, limits impact to low/medium and removes demanding
  conditioning, power and additional primary-strength filler, while permitting
  intrinsically easy core work. Tired caps time at
  15 minutes and uses one anchor set. A shorter requested budget stays shorter;
  unsupported budgets and stricter caller avoids/impact limits still fail visibly.
- Tired plus reported hard tennis today/yesterday, or a match/event today, offers
  rest: `prescription: null`, conflict `tennis-rest-recommended`, and an explainable
  recommendation in `rationale.priorities.adaptation`. No result/draft is created;
  a failed preparation clears any previous preview. Starting a preview after local
  midnight requires a fresh plan. It creates no debt or failure.
- Fresh/Normal grants no bonus load. Deliberately lighter work uses `easy-today`
  to hold double progression, preserving persistent targets and baselines. A later
  Normal session resumes the same targets. Hard constraints are set before target
  selection; preparation, rest, side exposures and timing ceilings remain enforced.
- Home small-space constraints apply by default. Explicit `smallSpace: false`
  permits existing mapped lateral exercises; no acceleration/shuttle drills or
  outdoor exercise catalogue is introduced.

Adaptation is prescription context, not a physiological score. Only relevant
decisions become bounded `tennis-adaptation` overrides; readiness/reports are never
persisted as ongoing fitness state. Session Results remain the only performed-work
authority. General Strength, Build Arms and saved Tennis v1 ignore sport context.

## Tennis development and optional sport reviews

Tennis definition **v3** introduces ongoing development; v4 retains these rules
and adds dated events below. Saved v1/v2 instances keep their policies.
`currentTargets.tennisDevelopment` is a closed, schema-version-1
namespace validated by Coach Model and persisted only through Coach Store. It
holds `phase` (`development`/`consolidation`), `entryReason`, `lastTransitionAt`,
`developmentStartedAt`, saturated eligible performed-session counts, the latest
evaluated result timestamp, and a bounded `sportReview`. Generic programme mode,
pause/resume/finish and all four anchor identities remain independent.

Pilot thresholds live in `phasePolicy` and `sportReviewPolicy` on v3:

- At least **six meaningful performed Coach sessions AND 21 elapsed days** since
  start/last completed consolidation makes one consolidation session due. Counts
  saturate at six; elapsed time, previews, absence and pause earn no session credit.
  These gates are simple UX defaults, not a fatigue or optimal-dosage model.
- Planning returns the recommendation and rationale without mutating state.
  `engine.beginSession(definition, state, prescription, now)` enters consolidation
  when a due, feasible prescription starts; the controller saves that state before
  starting its Tracker draft. A failed save leaves state unchanged and retryable.
  Rest/infeasible plans create neither a phase transition nor a draft.
- Consolidation uses the existing lighter-work constraints: at most 20 minutes,
  one achievable strength anchor with **one set**, low/medium impact and reduced
  demanding support/filler; important capabilities still follow performed-only
  two-week coverage. Tired/event safeguards can shorten or defer it further.
  Preparation/rest and the requested shorter budget remain intact. Deliberately
  easier work holds complete anchor targets and baselines, with no set repayment.
- **One** meaningful completed/partial consolidation result with real Main work
  returns to development and resets the six-session/21-day gates. Abandonment,
  skip, preparation-only, zero and unmeasured partial work cannot finish it.
  Recovery can finish only durable Main outcomes. Replay cannot duplicate phase
  work; older out-of-order results cannot rewind transitions/review counters.
- An optional sport check-in becomes eligible after **28 days AND four meaningful
  sessions** since programme start or prior response/dismissal. No check-in is
  required for a workout. `engine.sportReview(definition, state, now)` reads its
  eligibility; `engine.recordSportReview(definition, state, response, now)` returns
  changed state. The controller's `saveSportReview(response)` uses the same durable
  Store write safeguards as settings changes. `null` dismisses; otherwise supply
  `{movement, endurance, comfort}` with `better`/`same`/`worse`/`unsure`. The optional
  Coach card labels `unsure` as Not sure. Only the last feedback and prompt timestamp
  are retained; both gates reset even on dismissal, so it does not recur on render.
- Feedback confidence is **subjective**, absent feedback **unknown**; performed
  phase counts and coverage are **derived**, comparable actuals remain the only
  exercise-progression evidence. One worse answer requests an easier review
  session without diagnosing injury, changing phase or downgrading load. Real
  meaningful work in that session consumes the suggestion; preview/skip does not.

`rebuildDerivedState` preserves deliberate phase/review state as well as anchor
targets and lifecycle while rebuilding dose/count/reconciliation evidence. Raw
results and existing instance history remain unchanged. Revise pilot thresholds
only in a new definition version with corresponding namespace validation/tests.

## Dated Tennis event preparation

Immutable Tennis v4 adds event horizons to v3's scheduler
and development/consolidation rules. Saved v1–v3 retain their policies. Changing
`intent` between `ongoing` and `event` preserves the current instance, four anchors,
definition pin, baselines and performed histories. Coach's **Training intent and
event** controls explicitly save/change a significant local date and optional
`significantEventLabel` (1–60 trimmed characters), or cancel/return to ongoing.
Routine playing days remain separate from an explicitly selected event.

For pure settings updates, supply `{now, localDate}` as the fourth argument to
`engine.updateProgrammeSettings`; the controller supplies the browser's local date.
Selecting/changing an event requires today or a future date; impossible dates and
invalid settings reject. Existing expired events remain readable and prompt
return-to-ongoing or an explicit new date. Cancelling clears date and label.

Calendar-day defaults: **15+** days permits normal development; **8–14** retains
established targets, holds progression and avoids unfamiliar difficult/high-impact
or power work; **3–7** reduces demand, with at most one established anchor set;
**0–2** caps at 15 minutes, low impact and gentle trunk/shoulder work without
required strength anchors. Readiness, planned/confirmed sport, consolidation and
caller constraints may further reduce demand. Familiarity requires completed Main
evidence, not a preview. Hard avoids precede anchor selection and remain through
generation/swaps. If useful safe work cannot fit, rest is recommended without a
workout/result. Event expiry likewise asks for an explicit next action.

`rationale.priorities.event` and prescription context expose the local horizon and
plain rationale; bounded `tennis-event` overrides preserve deliberate progression
holds in performed results. Time alone never credits exercise, sport, phase work or
training debt. These are conservative pilot preferences, not a guaranteed peak.

## Local persistence and recovery

`coach-recovery.js` centralises the production transaction: save immutable result,
apply it idempotently, save changed Programme State, then clear the active draft.
A failed write/clear remains an error. Reload replays only missing result IDs,
including inactive instances. Interrupted Coach drafts finalise as partial or
abandoned using their durable outcomes, stable result ID and last checkpoint time;
no current-screen/planned work is inferred. Standalone unfinished drafts remain
ephemeral. Conflicting evidence and invalid state/drafts are retained and reported,
with recovery retry in Coach; damaged individual results do not hide valid results.

All record versions, including active references and result-index metadata, pass
through Coach Model's central validation/upgrade hooks. Production schema is still
v1, with no actual pre-v1 record shape to migrate. The original v1 ID-only index is
supported and enriched from immutable results without a schema bump. Future
versions are refused; damaged indexes can be rebuilt deterministically. Startup
key recovery inspects at most 10,000 keys and reports incomplete scans without
replacing the index with incomplete metadata. No evidence retention/deletion policy
is introduced.

`store.listSessionResults({programmeInstanceId, source, exerciseId, since, until,
limit})` filters compact metadata before reading individual results. A limited
query returns newest first and reads only matching candidates (plus damaged
candidates reported as errors). `reconcileSessionIndex()` performs the startup
orphan scan once per store; its `true` argument explicitly retries the scan.
Controller loads use the programme's rolling time window plus eight recent results
and the latest meaningful session. Full-history replay is a startup/repair operation,
not a render operation.

`engine.rebuildDerivedState(definition, state, results)` is a pure explicit repair
of cumulative dose, meaningful counts, review-block counts, applied IDs and recent
session/override/substitution summaries. It preserves anchor membership/targets,
lifecycle, mode and review decisions: immutable results are not a full event log
of user mode changes. Training History's exact exercise and anchor series rebuild
comparable performance evidence directly from results. Recent state summaries are
bounded (64 sessions, 32 overrides/substitutions); the compact result-ID ledger and
per-block counts remain for exact idempotency/review. Raw Session Results are neither
copied into Programme State nor deleted by compaction.

History is local-only. Browser/site-data clearing can remove it; device replacement
does not migrate it. Cloud durability and cross-device continuity remain deferred.

`tests/coach-resilience.test.js` and `tests/tennis-pilot.test.js` exercise durable
interruption, reload, damaged records and result/state/draft-clear failures.

## Sport capability coverage

Load `data/sport-capabilities.js` and `js/sport-coverage.js` after Coach Model and
Training History. `GarageFitSportCoverage.createPolicy(definition, catalogue)`
validates and snapshots a version-pinned mapping. It exposes `classifyExercise(id)`,
`availability({equipment, allowedImpact, smallSpace})`, and
`summarize(history, {now, focus, programmeInstanceId, includeStandalone, sections,
equipment, allowedImpact, smallSpace})`. For tennis use
the programme's pinned `sportPolicy.version` in `GarageFitData.sportCapabilityPolicies.tennis`. No storage, clock, Generator
selection or released programme policy is changed.

Summary uses Training History's actual exercise IDs, inclusive `[now − 14 days, now]`,
Main section by default, and its existing programme/standalone scope. Completed
and measured partial occurrences retain history exposure/confidence; unknown
partials remain unknown, explicit zero earns zero. Left/right occurrences remain
separate observations, never multiplied into sets. Skipped/planned/external work
cannot count. Unmapped/unknown actual identities appear in `unclassifiedObservations`
without capability credit. Available exercises and missing facets explain current
equipment/impact/space limits independently of historical exposure.

Each capability reports core/complementary priority, focus preference, the same
Balanced qualitative floor, observations and facet exposure. `observed` means
positive known exercise exposure; `unknown` means only unquantified partial work;
`not-observed` means no positive/unknown evidence. It does not assert physiological
adequacy. Overlapping capability values must not be summed; `uniqueExposure` counts
each mapped occurrence once. Facets distinguish controlled lateral work from
braking, controlled rotation from rotational power, and general conditioning from
unproven match repeated efforts. See [Tennis mapping constraints](TENNIS_CAPABILITY_AUDIT.md).

### Tennis v6: home movement composition (#159)

New starts select programme v6 and Tennis capability mapping v2. Versions 1–5
and mapping v1 remain available unchanged. Active references, history and drafts
continue to resolve their saved definition; there is no automatic migration or
in-place upgrade. Finishing an old programme and explicitly starting another uses
the current definition with a new instance and new anchor baselines. This does
not transfer progression into v6.

Mapping v2 treats a stationary wide-stance Cossack squat and single-step lateral
lunges (bodyweight or kettlebell, returning to centre) as home-feasible controlled
lateral loading. Their catalogue difficulty, impact, equipment and dose still
apply. A comfortable stance/step footprint is necessary. Banded lateral walks and
skater jumps still require lateral clearance. Only performed eligible work awards
`lateral-control` exposure; `lateral-braking` remains unavailable in default home
space. Controlled loading proves neither rapid braking nor court agility.
Reverse lunge to knee drive maps to lower-body control only, not lateral/power.

The versioned `roleCompositionPolicy` puts each role's capabilities ahead of
programme-wide gaps. Movement roles first retain their normal limited stable
anchors, then reserve lateral control and complementary trunk/conditioning/power
support with full preflight. Strength roles retain responsibility for lower/upper
coverage; tracking still includes all six capabilities across performed sessions.
Movement roles use low/medium-impact mapped work, favour core work and exclude
strength-heavy trunk compounds. Jumping jacks and star jumps are avoided in v6. No catalogue
entries or persistent settings are added, and rings are not required.

`SessionPrescription.optionalMainExerciseIds` is an optional, bounded allow-list
for **optional Main only**. Absent/null preserves the existing pool; an empty list
permits reserved work only. It intersects normal eligibility and protocol rules;
it cannot admit an otherwise unavailable exercise. Required/preferred anchors,
preparation and cooldown keep their independent contracts. Assessment, paired
partners, composition, fallback and generic swaps honour this pool. This small
constraint is necessary because `lunge` cannot express lateral control and
`core` alone cannot distinguish mapped trunk work from strength-heavy compounds.
The Generator contains no sport identities or hardcoded Tennis exercise names.

The workout style stays `strength`: comparable stable anchors remain two-set
rounds, 20 s exercise rest / 60 s round rest, unchanged targets and load progression.
Movement roles additionally permit timed intervals through existing constraints;
only compatible optional exercises can use them. Supporting targets and stable
anchors remain rounds. No new protocol or timed anchor conversion is introduced.
Lighter, tired, consolidation and event rules still take precedence over demand.
When lateral plus complementary support cannot fit, a visible role-specific
shortfall warning describes the partial/lighter alternative. A wholly unattainable
role retains the existing feasible-role fallback or rest/conflict behavior.

Reproduce the deterministic before/after grid with:

```sh
node scripts/audit-tennis-movement.js > /tmp/tennis-movement.json
```

It compares fresh equivalent states for every configured 2/week and 3/week role,
v5/v6, seeds 1/29/95, 20/30/45 min and bodyweight/DB/TRX/mixed kit. Each row reports
actual Main IDs, facets, protocols, prescribed targets, Main/total seconds and
role-relevant exercise/work-time shares. Bodyweight-only starts truthfully fail
because the programme still requires a feasible persistent pull anchor; temporary
bodyweight-only days on an existing programme can offer support without pretending
the absent anchor was trained. The grid forces each role only for comparison;
production role rotation remains performed-only and is tested through the tracker.

The bounded setup and eight-week performed-history simulation is reproducible with
`node scripts/audit-tennis-pilot.js > /tmp/tennis-pilot.json`. It exercises saved
v5 behavior; `tests/tennis-pilot.test.js` also checks v6 home lateral-control coverage.
Neither simulation proves athletic outcomes or universal feasibility. Tennis v5's
short-session omission tie-break uses earlier performed anchor history after rolling
dose ties; saved v1–v4 retain their original rules without automatic migration.

## Gymnastic rings in Coach programmes (#146)

Rings are optional equipment and never required. New starts select General
Strength v2 and Tennis v7; Build Arms stays v1. Released definitions (General
Strength v1, Tennis v1–v6) and Tennis capability mappings v1/v2 are unchanged.
Saved instances keep their pinned version, anchors, targets, history and drafts;
there is no automatic upgrade or remapping. Adopting a v2/v7 ring anchor means
finishing the current programme and explicitly starting a new one.

| Programme | Ring anchors for new starts | Optional ring work | Saved instances |
| --- | --- | --- | --- |
| General Strength v2 | push: ring press-up; pull: ring row, ring pull-up, ring chin-up | Generic Main filler (any eligible ring entry) | v1 anchors and alternatives unchanged; no ring alternatives |
| Build Arms v1 | flexion: ring biceps curl; extension: ring triceps extension (via `directElbowAction`) | Generic maintenance/filler | Ring curl/extension available immediately as temporary substitutes |
| Tennis v7 | push: ring press-up; pull: ring row | Ring face pull as `upper-body` shoulder support (mapping v3); other ring entries are unmapped generic filler | v1–v6 anchors, alternatives and mappings unchanged |

Ring IDs are appended after the released choices, so owners of other suitable kit
keep the released default anchors. A ring anchor becomes the default only when no
earlier choice is available (for example Tennis with rings but no row/pull-up kit,
which v6 could not start). Otherwise it is an explicit `anchorSelections` choice or
a temporary substitute; the start screen has no anchor picker. General Strength
needs dumbbells for its carry, which also provide its default press and row.

Ring anchors use the programme's existing comparable contract: two (or three for
Build Arms) rep-based `rounds` sets with the definition's fixed starting reps.
Hard ring press-ups/pull-ups/chin-ups are unavailable on Easy days rather than
eased by lowering reps. Build Arms and Tennis progress non-numeric ring anchors only
through explicit confirmed resistance setup; no load is inferred from ring height or
body angle. General Strength keeps its released double-progression rule for every
non-numeric anchor, as for TRX rows and push-ups. Substitutes and anchors keep exact
exercise identity, so ring and bar/TRX work remain separate performed series.

Deliberately excluded as anchors: ring dips and foot-assisted dips (deep supported
shoulder extension, not comparable to the released presses), timed support holds
(the anchors are rep-based), neutral-grip ring pull-ups (redundant with the two
reviewed vertical pulls), face pulls, curls/extensions outside Build Arms, knee
raises and fallouts. Tennis also excludes ring pull-ups/chin-ups as anchors.
Mapping v3 leaves pull-ups, dips, holds, knee raises and fallouts unmapped; they
earn no tennis capability credit and can only appear as generic optional filler.

Setup grouping and ring-adjustment transitions come from the shared Generator
(#113/#114); Coach adds no ring rules. `tests/rings-coach-programmes.test.js`
covers the matrix above, equipment on/off, seeded workouts in all three programmes,
setup compatibility, timing, recovery and history attribution.
