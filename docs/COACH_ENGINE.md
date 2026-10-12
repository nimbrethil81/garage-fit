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

`data/programmes.js` now ships `general-strength-4w`, version 1, using the production
values approved in issue #58. The definition is pinned in each Programme State and
must receive a new version for material policy changes. Test fixture definitions
remain separate from this release.

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
Start feasibility preflights the selected anchors at every supported duration.

The optional `anchorAlternatives` policy hook validates candidates for a programme
role. `engine.getAnchorAlternatives(definition, state, context, requirementId)` exposes
these for substitutions. Planning accepts `todayContext.anchorSubstitutions`, a map
of requirement ID to substitute ID, and creates a temporary prescription at the new
exercise's initial target. It never rewrites persistent anchors or imports their load.
The tracker records planned original identity and actual substitute identity.

`engine.programmeReview(definition, state, now)` projects nominal block progress and
counts meaningful sessions within the reviewed 28-day block. It does not mutate state
or automatically complete the programme. `acknowledgeBlockReview(...)` advances the
review marker while retaining identity, anchors and history. `finishProgramme(state)`
is the explicit terminal operation. Mode/lifecycle changes still go through the engine.

Production maintenance uses one anchor set, 20-minute sessions, 1–2 sessions/week,
half the coverage priority floor and softer preference for supporting accessories;
challenge and instance identity persist. Optional `maximumDurationMinutes` belongs
to the definition and caps available time without increasing density or reducing rest.

`GarageFitCoachUI.createController(...)` owns recoverable application orchestration.
It saves immutable results, applies them idempotently, persists state, then clears
the active draft. Startup reconciles saved results before allowing another session.
The store also discovers an immutable result stranded by an interrupted index write.
In-progress drafts offer an explicit Save performed work action after reload.

## Policy strategies

`createRegistry({type: policy})` returns a registry with `register`, `get`, and
`types`. Duplicate types and incomplete strategies are rejected.
`createDefaultRegistry()` registers the parameterised `general-strength` and
`build-arms` strategies. Another programme (including a future Tennis strategy) registers its
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

Resilience verification on 2026-10-12 used isolated Chromium contexts against the
local application. Both programmes survived reload; interrupted recorded anchor
work recovered as one partial result, remaining planned occurrences earned zero,
and repeated reloads left dose/progression unchanged. Completed results, short
sessions and temporary substitutions survived the same flow. A corrupt test record
left startup and other history usable; unavailable localStorage showed a Coach
error while the application still started. Standalone generation retained its
`gf_generator_history` behaviour. These bounded browser checks used production
controller/tracker calls to simulate work and interruption, plus rendered Coach
navigation/errors; they did not use or clear production browser data.
