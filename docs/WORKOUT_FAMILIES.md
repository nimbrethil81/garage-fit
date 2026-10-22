# Shared workout-family contract

`data/workout-families.js` owns the canonical six-family registry, exposed as
`GarageFitData.workoutFamilies[workoutFamilyId][version]`. Definitions and nested
values are immutable. Released versions remain available unchanged; a material
policy change needs a new definition version and versioned policy reference.
A later version of the same family keeps its id, name, purpose, styles and feasibility; it is the
same family for training balance and recency, while composition and history keep the version.
`GarageFitData.workoutFamilyCurrentVersions` names the version new workouts use; today that is
version 1 for every family except Athletic Movement, whose current version is 3 (#244).

Each definition owns its display name, purpose, supported internal styles, Body
Focus compatibility, composition/membership policy references, suitability criteria
and family feasibility requirements. Those requirements describe obligations for
the downstream composers and validator, not proof that a workout can be generated.
Supporting a duration/difficulty does not promise feasibility for every equipment,
impact or space configuration. Policy references do not register working composers.

## Shared resolution

Load `js/workout-families.js` after the data file. Both standalone Generator and
Coach consumers use `GarageFitWorkoutFamilies`; neither maintains a second family
table. Explicit requests for any of the six families use the constructor below; other existing generation
continues through its established path.

1. `resolveRequest(options)` resolves the requested family/version and effective
   Body Focus. Missing/null `workoutFamilyId` returns `null`: continue the existing
   Generator or Coach path with the original options, with no additional random
   draws, preference changes or record migrations. The legacy `focus` and
   `workoutStyle` values are ignored only for an explicit family request.
2. An explicit request returns `{workoutFamilyId, workoutFamilyVersion, bodyFocus,
   familyStyleId: null}`. Only Strength & Control accepts a non-default Body Focus;
   other families resolve to `full-body`, ignoring the temporarily disabled value.
   The caller retains the original preferences for restoration on the legacy route.
3. The shared composer establishes which supported internal styles are feasible
   and ranks them using actual constraints and training context. Call
   `resolveStyle(request, feasibleStyleIds)` to select the first viable candidate
   automatically. An input request cannot set `familyStyleId`. The returned style
   identifies the actual composition; a supported label alone does not validate a
   workout. Same-family fallback must call `resolveStyle` with the original unresolved
   request and the revised feasible candidates before display, not feed the already
   resolved identity back into `resolveRequest`.

For example:

```js
const request = GarageFitWorkoutFamilies.resolveRequest({
  workoutFamilyId: 'strength-control', workoutFamilyVersion: 1,
  focus: 'cardio', bodyFocus: 'upper'
});
// After composition proves a paired-set session feasible:
const identity = GarageFitWorkoutFamilies.resolveStyle(request, ['paired-sets']);
```

`getDefinition(id, version = 1)` and `getStyle(id, styleId, version = 1)` are strict
lookups. The default remains version 1; future published consumers explicitly pin
their approved version instead of silently following newer policy. `currentVersion(id)`
returns the registry-declared version for new workouts: the standalone Generator passes it
explicitly, and General Fitness plans a family at its current version (see
[Coach engine](COACH_ENGINE.md#general-fitness)). Stored workouts, drafts and results keep
the version they name, and every registered version stays composable and validatable. Requests do
not accept aliases or guess a family from other fields. `FamilyContractError.code`
distinguishes unknown family, unsupported version/style/Body Focus, invalid request
and an empty feasible-style list. An empty list means the composer supplied no
viable style; actionable feasibility reasons and bounded fallback belong to the
shared validation gate (see the final section).

## Boundaries

- `workoutFamilyId` describes the workout's purpose; `familyStyleId` describes its
  resolved internal experience. Neither replaces exercise `family` (variation
  metadata), Coach `sessionRole`, programme `type`, or a Main block protocol.
- `membershipPolicy` is the versioned seam for family-scoped exercise eligibility
  and contextual prescriptions. It contains no guessed exercise IDs or global
  phase promotions. Mobility/Athletic catalogue and sequence implementations use
  this seam in their own issues.
- Composition owns construction and style feasibility; the shared validation gate
  owns final programming quality, safe fallback and edit/swap integrity. A manual
  family choice must not silently cross families.
- Existing published Coach definitions, saved preferences and historical records
  remain unchanged. This module neither stores identities nor relabels legacy
  sessions; execution records carry the resolved identity described below.

## Completed-session identity and performed history

Session Drafts and Results accept an optional complete tuple of `workoutFamilyId`,
`workoutFamilyVersion` (positive integer) and `familyStyleId`, independent of
`sessionRole`. The player and Coach controller snapshot the **actual workout** at
tracker construction, after edits and same-family fallback. Picker state,
requested styles, roles and legacy focus never supply historical identity. The
tuple survives checkpoints, resume, immutable result writes and interrupted Coach
recovery. A conflicting recovery identity retains both records and reports the
conflict. Stored IDs/versions do not require today's registry to load them.

These are optional fields in schema v1: existing records need no migration and
remain unknown. Standalone generated drafts remain ephemeral: completed results
retain identity across reload; an abandoned/reloaded unfinished standalone run
does not create history or displace the durable Coach draft.

`GarageFitTrainingHistory.loadRecentSummary(store, catalogue, {limit, since,
until})` queries the existing Session Results store across Coach programme
instances, standalone Generator and fixed records. Default limit is 12, maximum
64 (minimum 1); date bounds are optional inclusive ISO timestamps. Metadata
filters completed/partial sessions with recorded performed work before reading at
most `limit` results. The existing index can rebuild optional `hasPerformedWork`
metadata once for old indexes; no extra storage key or history cache is created.
The read returns `{summary, errors}` so damaged evidence stays visible to callers.
Damaged candidates consume the read budget and may shorten the summary.

`createHistory(results, catalogue).recentTrainingSummary(options)` is the pure
equivalent. Its frozen `sessions` are newest first, with source, instance, time,
versioned family/style, zero-based recency, reported effort (otherwise unknown)
and occurrence performances. `families`, `styles`, `exercises`, `patterns` and
`protocols` contain session counts, latest time/recency and supporting result IDs;
the latter three also contain occurrence counts and confidence-labelled exposure.
These are inputs for future similarity/rolling-balance policy, not repetition
bans or a fitness score. No scheduling or new published Coach family policy is
enabled here.

The default view includes Main work and reliable older performed occurrences
whose section is unknown; preparation alone never establishes family exposure.
At most the bounded candidate results are considered, so records containing only
preparation may yield fewer summary sessions. Measured seconds/reps/load remain
on each occurrence's `sets`; completion exposure is not measured reps or load.
Timed partials retain actual seconds and their known fraction; note-only partials
retain unknown amount. Skipped/planned-only, abandoned and external records create
no summary dose. The existing progress view can still display factual unmeasured
outcomes from an interrupted non-meaningful run without crediting a session.
Missing family/style/protocol/intensity remains unknown. Fixed Session
Results can supply catalogue patterns without acquiring a family; legacy fixed
AMRAP totals are not imported as guessed exercise doses. Undated results do not
establish recent-session recency.

Coach exposes the same query through `controller.trainingEvidence(options)`.
This contextual API does not join the programme-owned results passed to released
planning, completion-credit or anchor progression. Programme progress and rebuild
remain scoped to the owning instance. No raw results are copied into Programme
State, and the Generator's existing `gf_generator_history` behaviour is unchanged.

## Family-scoped exercise membership and prescriptions

After the Generator module loads, the catalogue-owning module registers its reviewed
membership policy once with `GarageFitWorkoutFamilies.registerMembershipPolicy({
workoutFamilyId, workoutFamilyVersion: 1, entries})`. The registry resolves the
definition's versioned `membershipPolicy` reference; duplicate registration and
unknown versions fail. Registered data is copied and deeply frozen. There are no
production membership entries in the shared foundation: each catalogue ticket owns its
complete approved table. The Mobility table (approved M1-M15, roles `prep`, `focused`,
`flow` and `finish`) lives in `data/mobility-membership.js`, loaded after the Generator.
Its eight new movements are family-only catalogue entries with no phase flags; the seven
existing ones keep their canonical flags. The Athletic Movement table (approved A1-A8,
A10-A12; roles `footwork`, `control` and `integrated`) lives in `data/athletic-membership.js`.
Its six new drills are family-only catalogue entries with no phase flags; `bear-crawl`,
`skater-jumps`, `reverse-lunge-knee-drive`, `alternating-lateral-lunge` and
`knee-to-opposite-elbow` keep their canonical entries and flags. Travelling drills set
`requiresMovementRoom`, so only in-place low-impact drills are assumed viable in ordinary
space; high-impact skater jumps need an explicit Hard-difficulty opt-in that lifts the
default high-impact exclusion. Deferred A9 and A13 are absent. Neither Coach nor Generator supplies a
separate table, guessed exercise aliases or grants copied from saved data.

Each entry identifies one exact canonical `exerciseId` and family-specific `role`,
its allowed `protocols`, and reviewed `prescriptions`. Roles describe contextual
usage, independently of the exercise's global `mainRole` and Coach `sessionRole`.
Protocols come from the existing `GarageFitGenerator.MAIN_PROTOCOLS` vocabulary;
membership never relaxes a protocol's canonical exercise restrictions or validator.
An entry may set `requiresMovementRoom: true`; that is unavailable unless the
planning context explicitly confirms sufficient room. It does not add a space UI.

Each prescription is `{type, minValue, maxValue, secondsPerRep?}`. The type retains
canonical sidedness (`unilateral-` only for per-side exercises). Bounds are positive,
whole reps where appropriate, and cannot exceed the shared occurrence-target ceilings.
Canonical exercise prescriptions remain the defaults. A contextual mode or dose is
allowed only within an explicitly reviewed prescription range; intrinsic
`prescriptionModes` restrictions still apply. Timed work estimates its actual planned
seconds on each side. Rep work uses the canonical rep estimate, or a reviewed
`secondsPerRep` estimate (1–30 seconds); conversion from a timed default to reps
requires that pacing estimate. These are planned targets/estimates, never measured
reps, achieved loads or completion evidence.

Blocks carry a plain JSON `familyContext`:

```js
{
  workoutFamilyId: 'mobility-movement-quality', workoutFamilyVersion: 1,
  role: 'flow', difficulty: 'normal', excludedImpact: ['high'],
  bodyPositions: ['standing', 'floor'], movementRoom: false
}
```

Only family/version/role are required. Omitted difficulty is Normal; omitted
`excludedImpact` excludes high impact; omitted `bodyPositions` adds no position
restriction; omitted room confirmation is false. An explicit empty impact exclusion
list does not override Easy difficulty or protocol safety. Supplied malformed
constraints fail closed. Selected equipment remains an input to eligibility and Main
validation through their existing equipment arguments; a family grant cannot bypass it.

`getMembership(context, exerciseId)` resolves the central reviewed entry, including
after JSON round-trip. `generatedPhaseEligible(exercise, 'main', equipment,
difficulty, context)` applies that grant plus canonical equipment, difficulty, impact,
position and room checks. Other phases retain their original rules. A warm-up-only or
cool-down-only ID can therefore be explicitly authorised as family Main without
changing `generator`, `main`, preparation metadata or global catalogue validation.
Related variants receive no implicit membership.

`protocolCompatible(exercise, protocol, context)` additionally checks membership.
`validateFamilyBlock` rechecks the canonical catalogue and rejects modified exercise
copies. Main validation, normalisation, step resolution and estimation share that
check. Existing setup compatibility and protocol validators remain authoritative.
Within-family swaps must preserve the role's membership, canonical safety and every
occurrence target. Final family composition/quality revalidation uses the shared
validation gate (see the final section).

Contextual targets use the existing `block.occurrenceTargets` contract from
[Workout protocols](WORKOUT_PROTOCOLS.md#shared-occurrence-targets). Pass
`{familyContext}` to `resolveOccurrenceTarget` when resolving them directly. Defaults
and null entries must also satisfy the registered ranges. Invalid/stale grants or
targets produce no executable steps, estimate zero, and fail normalisation instead
of silently reverting to a default. Normalisation copies the context and targets and
recomputes duration. Original catalogue objects and prescriptions are never rewritten.

The common preview/player consume the same resolved targets. Main exercise phases
carry the transient context so Session Tracker can validate permitted mode changes;
the context is not a new persisted workout-family identity/history field. Existing
variable-target evidence rules and saved record schemas remain unchanged. Without
an explicit family context, these seams retain the original behaviour and RNG use.

The foundation tests demonstrate shared rounds, supersets and intervals plus existing
advanced protocol compatibility, not specialist composition. Whole-session allocation,
exercise-sensitive recovery and sequential-flow characterisation belong to issue 05
(#181); no new protocol or player is introduced here.

## Explicit family composition

`GarageFitGenerator.generate(options)` enters the common constructor only when
`workoutFamilyId` is explicit. Catalogue-owned composers register once through
`registerFamilyComposer(workoutFamilyId, workoutFamilyVersion, compose, validateQuality)`,
keyed by the canonical definition's versioned `compositionPolicy`; registration without
the family's quality validator fails. A composer receives normalised duration/difficulty,
the unresolved identity and `{excludedStyleIds}`, and returns `{familyStyleId, blocks}`.
The wrapper resolves the actual style, normalises the existing Main block contracts,
supplies empty generic warm-up/ramp-up/cooldown sections, and passes the result through
the shared validation gate below. It never falls back to another family.

A composer may also return `generalPreparation: {focus}`. The wrapper then keeps the
established generic warm-up, ramp-up and cool-down around the family's Main (the same
`buildPreparation`/`buildSection` selection and phase budgets as the traditional route,
chosen after Main) instead of empty sections, retrying that bounded preparation if it
would push the whole session past the selected duration. Mobility and Athletic do not opt in.

### Training-purpose sections of specialist families (#242)

Mobility and Athletic keep their whole progression in Main blocks; the generic arrays stay empty
and never receive specialist blocks. A composer may register an optional fifth argument,
`stageSection(block)`, naming which canonical stages are preparation (`'warmup'`) or finish
(`'cooldown'`); anything else is Main. `blockTrainingSection(block)` and
`trainingSectionPlan(workout)` (per-block section/position/count plus warm-up, ramp-up, Main and
cool-down seconds) are the one shared reading used by the standalone and Coach previews, the shared
player and the Session Tracker. Mobility classifies `prep` as Warm-up and `finish` as Cool-down.
Athletic uses explicit stage identity (`athletic-preparation-*`, `athletic-finish-*`), never the
reused `control` role, so control drills and reset blocks remain Main. Neither adds a Ramp-up: the
progression ramps internally. Section seconds sum exactly to `estimatedSeconds`; a block transition
belongs to the block it ends and a setup allowance to the exercise it precedes.

Nothing structural changes: blocks, ids, order, estimates, phase `section: 'main'` and occurrence
ids are unchanged. Player phases carry a derived `trainingSection`; a section boundary keeps its
three-second block transition but is announced as “Warm-up complete”/“Main workout complete”, and
Main numbers only its own blocks. New planned occurrences record the training section, so specialist
preparation/finish never counts as Main dose, family exposure or meaningful Coach work (completion,
early exit or interrupted-draft recovery), while their `blockIndex` keeps the block association.
Existing Session Results and Drafts keep what they recorded; nothing migrates. Other families,
no-family generation and benchmark blocks are always Main. The classification does not change any
published composition: Athletic v1's short finish (30/32/54/76/119 s at 10/15/20/30/45 minutes)
is unchanged. Athletic v2 and v3 (#244) lengthen it within the same total and keep the same stage ids,
so all versions share one stage classifier.

Missing composers fail with `family-composer-unavailable`; unsupported duration or
difficulty fails with `family-configuration-unsupported`. An explicit family plus
Coach `sessionPrescription` fails with `family-prescription-unsupported`: Coach asks
for families only through a prescription's `workoutFamilyPlan` (see Coach replanning
below). No-family Coach and standalone calls
retain their existing paths and random consumption. These transient workout identity
fields introduce no persisted family history or preference migrations.

### Mobility composition v1

Load `js/mobility-composer.js` after the Generator and approved Mobility membership.
It implements the reference prep/focused/flow/finish minute profiles:

| Total | Preparation | Focused mobility | Integrated flow | Gentle finish |
| --- | --- | --- | --- | --- |
| 10 | 1 | 4 | 4 | 1 |
| 15 | 2 | 5 | 6 | 2 |
| 20 | 3 | 7 | 8 | 2 |
| 30 | 3 | 11 | 13 | 3 |
| 45 | 4 | 17 | 20 | 4 |

Each phase is one `rounds:1` block with ordered occurrences, contextual timed
prescriptions and explicit per-gap recovery; all phase boundaries, changeovers and
both sides of unilateral work count in the selected total. Generic preparation and
cooldown stay empty because the family owns the entire progression; its prep and finish are
presented and recorded as Warm-up/Cool-down (see training-purpose sections above). The common
player's three-second Ready countdown remains outside the exercise-session budget.

The automatically resolved styles have different practice pacing, within the
flexible profiles. `joint-focused` transfers 8% of flow time into focused regional
practice, favours longer individual joint exposures and gives deliberate seven-second
resets between movements on the same level. `integrated-flow` transfers 8% of focused
time into connected flow, uses shorter focused primers, longer connected movement
exposures and three-second flow changeovers on the same level. A body-level change
gets twelve seconds in either style. These are comfortable movement targets, not
instructions to push stretch intensity; the catalogue's controlled-range cues apply.

Preparation stays standing. Focused practice covers shoulders, hips, ankles,
adductors and thoracic rotation, grouping standing work before floor work. Flow
sweeps connect floor rotations and dog practice through the mixed-position lunge
stretch into standing hip/squat movement, then return as needed. The gentle finish
descends once and stays on the floor for further comfortable spinal/dog practice.
Phase boundaries remain at the same body level. Later exposures use modestly varied
targets; they do not repeat a generic strength round/rest cycle.

Short sessions retain broad regional essentials. Longer durations introduce more
of the approved M1–M15 set before extending full regional sweeps. At 30/45 minutes
the complete feasible bodyweight pool is used; TRX contributes only when selected.
Easy excludes medium impact and caps individual focused/flow work at 35 seconds
bilaterally or 30 seconds per side; Normal caps these at 45/35 and Hard at 50/40.
The gentle finish uses comfortable bilateral movement, capped at 50 seconds on all
difficulties. Hard changes exposure, never asks for maximal stretching or impact.

Optional `excludedImpact`, `bodyPositions` and `movementRoom` options pass through
the central membership context gates. No large movement space is assumed. A request
that leaves too few eligible movements or loses required shoulder/ankle/thoracic
practice fails with `family-not-feasible`, including standing-only and floor-only
restrictions. It never substitutes a different family or an unapproved exercise.

### Athletic Movement composition v1

Load `js/athletic-composer.js` after the Generator and approved Athletic membership.
It uses the common composer registration, contextual targets and per-gap recovery;
there is no specialist player or new protocol. Its flexible minute profiles are:

| Total | Preparation | Footwork | Balance/control | Integrated + finish |
| --- | --- | --- | --- | --- |
| 10 | 2 | 3 | 3 | 2 |
| 15 | 3 | 4 | 5 | 3 |
| 20 | 3 | 6 | 6 | 5 |
| 30 | 4 | 9 | 10 | 7 |
| 45 | 5 | 14 | 15 | 11 |

Each small `rounds` drill has two to four movement slots and at least two distinct
approved exercises. Longer phases introduce complementary pairs/triples before
extending their technical practice. Preparation gently introduces standing
cross-body coordination, forward/back steps and pivots. Footwork includes
forward/back, lateral and rotational practice; control combines single-leg balance
with stepping, sticking and cross-body coordination. Integrated drills join travelling
steps, controlled lunges and, when room permits, crawling. They begin and end standing;
floor changes stay inside an explicit recovery gap. A low-impact grapevine/crawl route
revisits grapevine on either side of the crawl to preserve that standing bridge.

Automatic `footwork-coordination` transfers 8% of control time into footwork and
favours longer footwork exposures with twelve-second light resets. `dynamic-balance`
transfers 8% of footwork time into control and favours longer per-side balance
exposures. `integrated-movement` transfers 8% of footwork time into integrated practice
and its finish; it alone can optionally introduce permitted high-impact work.
The latter styles use fifteen-second light drill resets. Identity reflects the
actual composition and cannot be forced by legacy style/focus inputs.

All exercises retain their canonical catalogue identity and instructions. Timed
technical efforts last 10–25 seconds bilaterally on Easy or 10–30 on Normal/Hard;
per-side efforts cap at 22 seconds, crawling at 20, and optional jumping at 15.
Recovery follows both sides: at least sixteen seconds around unilateral work,
twenty around medium-impact combinations, twenty-five around floor changes/crawling,
and forty around high impact. Gentle preparation/finish changes use eight seconds.
Fitting can extend each recovery by up to twenty-five seconds, preserving work caps
and never shortening the exercise-sensitive minimum. Hard does not compress rest.

Integrated blocks always lead into gentle active recovery: a minute allocated to
cross-body knee/elbow and pivot practice between longer-session blocks, or the
gentle stepping finish after the final block. Thus the shared three-second block
transition never joins consecutive demanding integrated blocks. Optional high-impact
drills never begin/end a block or occur consecutively across rounds/blocks. The
finish receives at least thirty seconds; all work, both sides, recovery and block
transitions count exactly once in the selected whole-session duration. Generic
warm-up/ramp-up/cooldown sections remain empty (preparation and finish read as Warm-up/Cool-down,
see training-purpose sections above); only Ready's three seconds sit outside.

All durations/difficulties have an ordinary in-place bodyweight route, including
Hard without high impact. Travelling drills require explicit `movementRoom:true`.
High impact additionally requires Hard and an explicit exclusion list permitting it;
permission still allows sessions without jumps. A low-impact-only bodyweight route
is available with confirmed room. With no confirmed room, the approved integrated
pool contains only the two medium-impact lunge combinations: combining that space
restriction with exclusion of medium impact fails `family-not-feasible`. Floor-only,
hanging-only and other requests losing the standing directional/balance essentials
also fail honestly. Membership is never expanded to fill time; A9/A13 remain deferred.

### Athletic Movement composition v2 (#244)

v1 cut each phase into roughly four-minute slices and filled them from fixed drill patterns. With
the ordinary in-place pool (three footwork drills, two integrated lunges) a standalone 30-minute
Normal session became 11 blocks: two footwork blocks that were subsets of the first, three control
triples around the same balance anchor and an integrated pair repeated in reverse order. v2 is the
same family (definition, styles, reviewed v1 membership, feasibility, minute profiles, style
emphasis, per-drill caps and exercise-sensitive recovery are unchanged) with a new composition:

- **Purposeful blocks.** A stage gains another block only for each further four minutes of its
  budget *and* when that block brings a drill the stage has not practised yet. Otherwise the stage
  is consolidated into fewer, longer drills with deliberate repetition across rounds. Short
  sessions (10–20 minutes) are five blocks: preparation, footwork, control, integrated, finish.
- **Stage content.** Footwork opens with forward/back, lateral and rotational stepping; with
  confirmed room a second block adds the travelling drills. Every control block centres on
  single-leg balance with different stepping, sticking or cross-body partners, preferring drills
  footwork has not used. Integrated drills keep standing non-jumping edges with floor changes or
  optional jumps inside, prefer drills not yet practised, and are separated by the one-minute
  gentle reset only when there is a second, different integrated block. Chosen drills play in their
  seeded order, so equal choices still vary between sessions. Preparation is unchanged.
- **Longer finish.** The gentle stepping finish targets 60 s up to 20 minutes and 120 s at 30/45
  minutes (adding forward/back steps to pivots and cross-body practice), taken from integrated
  work so the total is unchanged. Because bounded efforts cannot fill every whole-second budget it
  moves by the fewest seconds from that target (at least 30 s, at most 20 s above) until every
  drill fits; e.g. a 10-minute low-impact route with room, whose shortest grapevine/crawl drill
  needs 83 s, keeps a 37–51 s finish.

Ordinary space at 30/45 minutes therefore gives six blocks (one long footwork block, two
control blocks, one integrated block); confirmed room gives seven to nine. Feasibility, reasons and
adjustments are those of v1. v2 blocks carry `workoutFamilyVersion: 2` in their family context,
which resolves the v1 membership policy. v2 stays composable and validatable exactly as released.

### Athletic Movement composition v3 (#244 follow-up, current)

v2 judged novelty only against earlier blocks of the same stage, so a control block built from
footwork's own stepping drills passed (a 30-minute Dynamic Balance session showed forward-back and
quarter-turn steps in warm-up, footwork, control and cool-down). v3 is the same family and the same
staged script, with novelty judged across the whole Main session:

- **Session-wide purpose.** Each footwork, control or integrated block must bring at least two drills
  (both, for a two-drill block) that no earlier Main block practised. When a stage's approved pool is
  spent it is consolidated into one longer circuit with deliberate round repetition rather than a
  relabelled copy: ordinary space at 30/45 minutes is five blocks (preparation, footwork, control,
  integrated, finish); confirmed room adds a second footwork block at 30 and 45 minutes.
- **Bookends stay gentle.** Preparation, resets and the finish may reuse familiar drills and are
  neither counted for nor against Main novelty. Control prefers the partner the session has used
  least, so the bookends do not decide which drills the Main block repeats; ties stay seeded.
- **Honest limited pools.** When the integrated pool has fewer than two drills of its own (low impact
  with room is only grapevine steps and the crawl), footwork leaves the shared ones for integrated
  work, using one only to cover a movement plane.
- Gate: `redundant-block:<id>` now means fewer than two drills new to the Main session. Stage ids,
  the finish, per-drill caps, recovery, membership (v1 policy), feasibility and styles are unchanged.
  Saved v1 and v2 workouts keep their own rules; v3 blocks carry `workoutFamilyVersion: 3`.

### Strength & Control and Cardio & Conditioning composition v1

Load `js/strength-cardio-composer.js` after the Generator. These families have no
membership table: eligibility is the canonical Main eligibility (equipment, difficulty,
protocol compatibility, setup profiles) narrowed by family suitability from reviewed
metadata, and construction reuses the Generator's recipe-driven `selectBlockExercises`,
scoring, recency `history`, `recentProtocols`, Body Focus credit and block estimators.
They opt into `generalPreparation`; Main targets the traditional Main budget less a 15 s
margin and is filled to within 6% (at least 40 s), so warm-up, Main and cool-down total
at most the selected duration. Blocks are ordinary legacy protocols with no family context.

Optional `excludedImpact` and `bodyPositions` filter the pool (malformed values fail
`invalid-family-context`); `movementRoom` is irrelevant because nothing travels. A request
that leaves no style able to build a credible session fails `family-not-feasible`.

Styles are ranked by seeded weights from duration, difficulty and `recentProtocols`; the first
style that builds a valid session is the displayed one, so the label always matches the blocks.

| Family | Suitable exercises | Style | Resolved structure |
| --- | --- | --- | --- |
| Strength & Control | strength ≥ 2 and ≥ cardio, not conditioning, never high impact; session mean strength exceeds mean cardio by 0.5 | `straight-sets` (favours long sessions) | one-exercise `rounds` blocks, 3–4 sets, 45–120 s rest scaled to strength/load, strength ≥ 3 movements where available |
| | | `paired-sets` (favours short sessions) | `paired_sets` blocks of contrasting movements, 3–4 sets, 10 s changeover, 45–120 s rest per pair |
| | | `controlled-circuits` | `rounds` blocks of 3–6 varied movements, 20–30 s between, 60–120 s between rounds |
| Cardio & Conditioning | cardio ≥ 3 and ≥ strength, never high impact on Easy; session mean cardio exceeds mean strength by 0.5; Body Focus ignored | `endurance` | `rounds` circuits of low/medium-impact, non-heavy, non-hard-rated, strength ≤ 3 work with 10–20 s exercise rests and 20–45 s round rests (work ≥ 50% of time) |
| | | `intervals` | `timed_intervals` blocks, work:rest between 1:1 and 3:1 (30/30–45/15), 2–5 cycles of 3–5 timed-compatible bilateral exercises |
| | | `mixed-conditioning` | alternating endurance circuits and interval blocks, at least one of each |

Safety rules for Cardio: a rep-prescribed movement is never timed longer than its catalogue
estimate; high-impact intervals last at most 40 s, never run back to back (including cycle and
block wrap-around) and make up at most half of a block; no exercise appears in more than two
blocks. Every Strength style uses each exercise once. Long rests are a Strength
feature: round rests are never below 45 s there and never above 45 s in Cardio endurance work.
No-family generation, explicit-family Coach prescriptions (still `family-prescription-unsupported`), exercise
eligibility and fixed workouts are untouched. Final family quality validation and fallback
belong to the shared gate below.

### Core & Stability and Full-Body Challenges composition v1

Load `js/core-challenge-composer.js` after `js/strength-cardio-composer.js`: it reuses that module's frozen
`GarageFitFamilyComposerKit` (seeded style ordering, shared block sequencing and fitting) and the same
`generalPreparation` opt-in, so warm-up, Main and cool-down total at most the selected duration. Neither family
has a membership table or catalogue change: eligibility is canonical Main eligibility narrowed by reviewed
metadata, optional `excludedImpact`/`bodyPositions` filters (malformed values fail `invalid-family-context`)
and the Generator's own protocol validators. Body Focus is ignored (`full-body`). An unbuildable request fails
`family-not-feasible`. Styles are ranked by seeded weights from duration, difficulty and `recentProtocols`;
the first that builds is the displayed one. Each exercise is used once where the pool allows, otherwise at most
twice. Explicit-family Coach prescriptions stay `family-prescription-unsupported`; final quality validation and fallback use the shared gate below.

| Family | Suitable exercises | Style | Resolved structure |
| --- | --- | --- | --- |
| Core & Stability | `bodyFocus` core with a core pattern, no press pattern, low impact, cardio ≤ 3; session mean cardio ≤ 2.5 and at least a quarter holds (timed, cardio ≤ 2, no alternation) | `controlled-stability` (favours Easy and short sessions) | `rounds` circuits of 3–6 alternating holds and controlled (cardio ≤ 2) movement, 2–4 rounds, 15 s+ between exercises, 45 s+ between rounds |
| | | `dynamic-core` (favours Hard and long sessions) | `paired_sets` blocks of one hold and one dynamic trunk movement, 3–4 sets, 10 s changeover, 30 s+ between sets; needs three distinct exercises, so not offered at 10 minutes |
| Full-Body Challenges | any Main-eligible exercise; every style needs the session balanced: upper, lower and core each credited (full-body work counts one third to each) for 15–50% of the exercises, and no multi-exercise block repeats | `rounds` | one or two blocks of 3–6 exercises, one per body region first (upper, lower, core, full-body), 3 rounds (4+ from 20 minutes); no Heavy or strength 5 work, high impact only on Hard and never adjacent or more than one per round; Easy 20/50 s, Normal 15/40 s, Hard 10/30 s minimum exercise/round rest |
| | | `emom` | whole-minute blocks rotating upper, lower and core (two regions when under six minutes); work scaled to at most 30/35/40 s of each minute on Easy/Normal/Hard; at most four minutes per exercise |
| | | `ladder` | two-exercise ladders (two regions per block), ascending or descending, step rest at least 40/30/20 s |
| | | `pyramid` | one rep pyramid per block, regions rotating, at least three blocks, step rest at least 75/60/60 s (rep pyramids only) |
| | | `density` | never on Easy; two-exercise blocks of two or three fixed rounds with the whole time cap reserved, 15 s+ exercise and 45 s+ round rest |

`rounds` is the least likely style and only qualifies as a challenge when a round itself is balanced and long
enough: a short circuit of one or two movements, or an unbalanced one, is not labelled Full-Body Challenges.
Density needs canonical partners (one setup, position and load, distinct patterns), so it is offered only where
such balanced pairs exist (short sessions with TRX, bands or broad equipment); other styles take over otherwise.
EMOM fills whole minutes, so Main can finish up to about a minute short of its target.

## Shared validation, same-family fallback and edit integrity

Every explicit-family workout, from standalone Generator or the Coach replanning seam, passes
one post-composition gate before it is returned: `GarageFitGenerator.validateFamilyWorkout(workout,
{catalogue, equipment})` returns `{valid, technicalIssues, qualityIssues}`.

- **Technical legality** (shared): supported identity/style/duration/difficulty; the existing
  `validateMain` contracts (protocol validators, family membership, occurrence targets/recovery,
  setup profiles, executable steps, budget tolerance); each Main exercise is the unmodified
  canonical entry and Main-eligible for the equipment, difficulty and its block's family context;
  requested `excludedImpact`/`bodyPositions` (kept on the workout as transient `familyConstraints`)
  hold for every exercise, including generic warm-up, ramp-up and cool-down. Those sections
  use a constraint-filtered preparation pool, remain phase-eligible and cannot be silently
  omitted when a composer requires generic preparation. A constrained request that cannot
  provide that preparation fails with explained same-family unavailability. Finally,
  the recomputed timeline equals the stored estimates and fits the selected duration.
- **Family identity** (family-owned, registered with the composer, evaluated on the resolved blocks
  and `resolvedOccurrences(block)` timeline): Strength & Control, Cardio & Conditioning, Core &
  Stability and Full-Body Challenges restate their published suitability, session-balance,
  exposure, impact and per-style structure rules above. Mobility requires the four
  prep/focused/flow/finish phases in order, timed doses within the difficulty caps, standing
  preparation, style-consistent changeovers (twelve seconds for a level change) and focused
  shoulder/ankle/thoracic practice. Athletic requires approved-context blocks that start and finish
  with control, footwork across all three movement planes, single-leg control, 2–4 slot drills,
  per-drill effort caps, exercise-sensitive minimum recovery, integrated blocks followed by
  recovery and high impact only in `integrated-movement`, never at a block edge or consecutively.
  Athletic v2 adds construction rules: explicit stage ids matching their roles in the
  coached order (preparation, footwork, control, integrated with resets between, finish), single-leg
  balance in every control block, a finish of at least 30 s, context versions matching the workout,
  and `redundant-block:<id>` for any footwork, control or integrated block whose drills are all
  already in earlier blocks of that stage (a copy, reorder or subset); v3 widens that to fewer than two
  drills new to the whole Main session. Rounds within a block and the gentle resets may repeat.
  Saved v1 and v2 workouts keep their own rules.

**Same-family fallback.** If composition of one style fails (`familyStyleId` on the composer's
`family-not-feasible` error) or the gate rejects it, the wrapper composes again with that style in
`excludedStyleIds`; seeded style draws are unchanged when nothing is excluded. There is at most one
attempt per published style. An accepted fallback lists the rejected attempts in transient
`familyDiagnostics`; a manual family choice is never replaced by another family.

**Infeasible family.** When no style passes, `generate` throws `FamilyContractError`
`family-not-feasible` with `workoutFamilyId`, ordered `reasons` and verified `adjustments`.
Reason codes: `insufficient-eligible-movements` (with `role`), `missing-essential-practice`,
`phase-cannot-fit` (style), `no-buildable-style`, `style-technical-invalid` and
`style-quality-failed` (with `issues`), and `composer-ignored-style-exclusion`. Adjustments are
single changes, each proven by composing and gating a whole workout with a fixed seed after the
unchanged settings fail under that seed: `remove-body-position-restriction`,
`reduce-impact-exclusions` (keeps any `high` exclusion; high impact is never proposed),
`confirm-movement-room` (families requiring safe movement space), and adjacent supported
`change-duration`/`change-difficulty`. Equipment is never proposed. No adjustment is listed when
none verifies. Invalid constraints still fail with `invalid-family-context`.

**Coach replanning.** `generateFamilyReplan(options, candidates)` is the only route that may move
to another family: the caller supplies its ordered priorities as `{workoutFamilyId, rationale}`
(a non-empty rationale is required). Each candidate uses the gate and same-family fallback above;
the returned workout's transient `familyReplan` reports the requested and actual family, style,
`replanned`, the chosen rationale and earlier infeasible attempts.

A Coach Session Prescription reaches this route only through its optional
`workoutFamilyPlan`: `{candidates: [{workoutFamilyId, workoutFamilyVersion, rationale}],
excludedImpact?, bodyPositions?, movementRoom?}` (one to six unique families). Coach Model
rejects a plan combined with anchors, Main priorities, avoid/protocol constraints, an optional
Main pool, time limits or a variation preference, because family composers own their
programming. `assessSessionPrescription` stays pure and cheap: it reports candidates whose
published definition, composer or duration/difficulty support is missing as
`family-candidate-unavailable` warnings, and `family-plan-unavailable` when none remains.
Generation calls `generateFamilyReplan` with the usable candidates in order; the workout's
`familyReplan` names the plan's first family as requested, `replanned` when the delivered
family differs, and every skipped or infeasible attempt. `prescriptionOutcome.familyPlan`
repeats it with no anchor placements. No generic `sessionPrescription` is attached, so swaps
use the family gate rather than Main budgets. If no candidate builds, generation throws
`SessionPrescriptionError` with hard conflict `family-plan-not-feasible` and the attempts.
The released General Strength, Build Arms and Tennis programmes never send a family plan;
General Fitness (see [Coach engine](COACH_ENGINE.md#general-fitness)) is the only caller.

### Optional embedded benchmark (#192)

A family plan may also carry `benchmark: {workoutFamilyId, workoutFamilyVersion, exerciseRestSeconds, items:
[{benchmarkId, exerciseId, setupId}]}` (one to four items; it must name the plan's first family). Only a composer
that opts into general preparation honours it. `composeFamilyWithFallback` builds one `rounds` block (one round,
the fixed rest, round rest 0, the eligible reviewed exercises, `block.benchmark` metadata) and passes its time plus
a 60 s margin to the composer as `reservedMainSeconds`, then places it first in Main. Items that are ineligible for
the equipment, difficulty, `excludedImpact` or `bodyPositions` are dropped; with none left no block is added. If
the intended family cannot be built with the block, `generateFamilyPlanWorkout` plans again without it, so the
benchmark never changes which family is delivered. The shared gate judges family identity on the non-benchmark
blocks only and checks the benchmark block separately (first, one block, fixed shape, canonical unmodified
unloaded exercises matching their items, with the whole session still within the duration). `swap` refuses a benchmark exercise
(`benchmark-swap`); other swaps re-pass the gate. The timeline gives each benchmark phase `phase.benchmark`, which
the tracker links as requirement `benchmark:<benchmarkId>`.

**Swaps and edits.** For a workout with `workoutFamilyId`, `swap` and `swapPreparation` accept only
replacements whose whole revised workout passes the gate; if none does, the workout is unchanged.
Any other edit must be revalidated with `validateFamilyWorkout` before it keeps the family label.
No-family workouts, legacy swaps and published Coach behaviour do not use the gate.

## Optional usual external activity context

`GarageFitCoachModel.createCoachPreferences({usualExternalActivities})` constructs
one optional version-1 `coach-preferences` record. Each routine is
`{activityType, sessionsPerWeek}`: a trimmed, user-named activity (1–100 characters)
and a finite positive approximate weekly frequency (fractional values allowed).
There are at most sixteen types, unique ignoring case. No sport registry, day,
intensity, duration or resistance dose is implied. An empty array means none
configured, not a claim of inactivity.

Coach Store owns `loadCoachPreferences`, `saveCoachPreferences` and
`clearCoachPreferences`. A missing record returns the empty default without a
write; malformed or future records reject through the usual Coach errors. This
shared preference record is independent of all programme instances and Tennis
settings; existing records need no migration. No activity log or second history
store is introduced.

Controller methods `saveExternalActivityPreferences(activities)` (replace/edit),
`clearExternalActivityPreferences()` and `externalActivityContext(sessionContext?)`
provide the opt-in seam for General Fitness #190 and settings #191. Only a definition
with `externalActivityPolicy` (General Fitness v1) consumes it during planning; its
optional editor lives in that programme's existing Programme settings (#191). The pure equivalent is
`GarageFitCoachModel.externalActivityContext(preferences, sessionContext?, localDate?)`.
Its deeply frozen output separates:

- `typical`: routines labelled `status:'typical'`, `provenance:'user-preference'`,
  `confidence:'approximate'`. These have no inferred occurrence dates or doses.
- `actual`: defaults to `status:'unknown'`, null provenance, unknown confidence
  and empty `reports`. It means participation is unknown, even with routines saved.
- Explicit existing `sessionContext.reportedSportActivity` can instead yield
  `actual.status:'confirmed'`, `provenance:'session-context.reportedSportActivity'`,
  `confidence:'user-reported'`. “Confirmed” means the user reported activity, never
  verified attendance. Reports retain only activity type, reported local date and
  `reportedIntensity`; this is not quantified training dose or fatigue. The caller
  must supply the current local date, and reports must lie within its last seven
  calendar days. The controller supplies that date from its clock.

Planned matches, usual Tennis days, readiness and generic external Session Result
status/feedback never confirm participation. No typed reliable external-activity
report exists in Session Results, so this seam does not mine them or add an
integration. Preferences/context create no result, training credit/debt, recovery
state or programme progress. They do not enter released programme planners,
Generator recency, or Tennis event/readiness behavior. Future consumers must keep
these approximate preferences separate from performed GarageFit evidence. General
Fitness does: typical routines only bound a small mobility preference and confirmed
reports only order lower-demand families first.
