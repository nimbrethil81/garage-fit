# Coach engine and policy contract

Load `data/sport-profiles.js`, `coach-model.js`, `training-history.js`, `coach-policies.js`, then
`coach-engine.js`. For Tennis also load `data/sport-capabilities.js`, `sport-coverage.js`
and `coach-tennis-policy.js` (after `coach-policies.js`, before creating the engine).
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
`build-arms` strategies, plus `tennis-conditioning` when its module is loaded.
Other programmes register their own type and hooks.

Required hooks are `validateDefinition`, `assessFeasibility`, `initialiseState`,
`calculatePriorities`, `buildPrescription`, and `interpretDose`. Optional hooks
are `getModeSettings`, `assessPlannedSession`, `interpretProgression`,
`respondToMissedSessions`, `reduceForShortSession`, `isComplete`, and
`validateProgrammeSettings`.

The optional `validateProgrammeSettings({definition, settings})` hook receives
frozen inputs and throws for policy-specific restrictions beyond the sport profile.
It runs on creation, settings updates and definition-bound state operations.

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
Tennis v1 remains pinned for existing programmes. New programmes use v2's bounded
schedule/readiness adaptation described below; setup screens remain follow-up work.
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

New Tennis programmes use immutable v4, adding event horizons to v3's scheduler
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
unproven match repeated efforts. See [the catalogue gap audit](TENNIS_CAPABILITY_AUDIT.md).

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
