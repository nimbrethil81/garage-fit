# Coach engine and policy contract

Load `coach-model.js`, `training-history.js`, `coach-policies.js`, then
`coach-engine.js`. These scripts use the repository's `GarageFit*` globals and run
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
| `coverageTargets` | Rolling `windowDays`, broad `patterns` and optional `bodyRegions` exposure targets |
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

No production General Strength definition is bundled. The complete fixture in
`tests/helpers/coach-policy-fixtures.js` contains deliberately fake test parameters.
The first production definition and UI belong to #58, after a Coach UI/UX design pass.

## Policy strategies

`createRegistry({type: policy})` returns a registry with `register`, `get`, and
`types`. Duplicate types and incomplete strategies are rejected.
`createDefaultRegistry()` registers only the parameterised `general-strength`
strategy. Another programme (including a future Tennis strategy) registers its
own type and hooks without changing the engine.

Required hooks are `validateDefinition`, `assessFeasibility`, `initialiseState`,
`calculatePriorities`, `buildPrescription`, and `interpretDose`. Optional hooks
are `getModeSettings`, `assessPlannedSession`, `interpretProgression`,
`respondToMissedSessions`, `reduceForShortSession`, and `isComplete`.

Hooks receive an object with the relevant `definition`, `catalogue`, `context`
(at start), `state`, `history`, `today`, `mode`, `priorities`, `prescription`,
`result`, and `evidence`. All hooks must be pure. Initial state additions are
`{anchors, currentTargets}`; engine identity/lifecycle/reconciliation fields are
protected. Dose interpretation returns `{meaningful, exposure: {value, confidence},
patterns, bodyRegions}` based solely on performed evidence. Progression returns
updated anchors. Completion returns a boolean. `assessPlannedSession` returns
`{conflicts}`. The engine validates outgoing records through Coach Model.

## History and confidence

`GarageFitTrainingHistory.createHistory(results, catalogue)` validates, deduplicates,
chronologically sorts and freezes Session Results and performed observations.
Conflicting contents under the same result ID are rejected. It provides:

- `sessionsForProgramme(instanceId, options)`;
- `recentPerformedSessions(options)`;
- `exactExercisePerformances(exerciseId, options)`;
- `movementPatternExposure(pattern, options)`;
- `bodyRegionExposure(bodyRegion, options)`;
- `anchorPerformanceSeries(requirementId, options)`;
- `sessionEvidence(sessionResultId)`;
- `contextualEvidence(options)`.

Options support `programmeInstanceId` and inclusive `since` / `until`. Observation
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
