# Main block protocol contracts

Playable and automatically selected protocols: `rounds`, `paired_sets`, `timed_intervals`, `emom`, `ladder`, `pyramid`.
These contracts are the extension seams for later block patterns (#75). `tests/protocol-contracts.test.js` and
`tests/main-blocks.test.js` enforce them; shared fixtures and the step-trace check live in
`tests/helpers/protocol-fixtures.js`.

## 1. One vocabulary, three copies

| Where | What | Role |
| --- | --- | --- |
| `GarageFitGenerator.PROTOCOL_SHAPES` | `repeatKey`, `stepKey`, `conditionFields` | accepted domain protocols (`MAIN_PROTOCOLS` is its keys) |
| `GarageFitCoachModel.MAIN_PROTOCOLS` | names | valid in Session Prescriptions (anchors, protocol constraints) |
| `GarageFitTrainingHistory.PROTOCOL_CONDITION_FIELDS` | condition fields | which conditions must match for comparable evidence |

The modules stay independent, and the contract test fails if the copies drift.
`GarageFitGenerator.GENERATED_PROTOCOLS` is separate generator policy: the protocols generation
may choose by itself, in weighted-pick order. A protocol can be accepted and playable before
it is auto-selected. Adding it to `GENERATED_PROTOCOLS` changes selection: update the #53
characterisation fixture only with before/after evidence, and run the reachability audit.

## 2. Block prescription describes structure

`block.prescription` holds one repeat structure (`repeatKey`: `rounds` / `sets` / `cycles` / `minutes` / `repSteps` / `steps`) plus the
protocol's condition fields, and nothing else. `blockRepeatCount(block)` reads the repeat key
(the array length for a ladder or pyramid).
`protocolConditions(block)` is the prescription without the repeat count. It is shared by every
occurrence of the block and is frozen on player phases.

## 3. One resolved plan

`resolveBlockSteps(block)` is the only executable plan of a block:

- Exercise steps carry `exerciseIndex` and their position in `stepKey` (`round` / `set` / `cycle` / `minute`).
  Ladders use `ladderStep`, pyramids `pyramidStep`. Timed interval steps also carry `timed: true` and `seconds`.
- Rest steps have positive `seconds` and sit only between exercise steps, with
  `nextExerciseIndex` naming the next step's exercise. There is no leading, trailing or
  zero-second rest.
- `estimateBlockDuration(block)` equals the steps' time. For sequential protocols, an exercise
  step lasts its `seconds` when timed, otherwise the exercise's `estimatedSeconds`; rest steps
  add their `seconds`. EMOM reserves entire minute windows as described below.

The player (`appendBlockTimeline` in `index.html`) builds every Main phase from these steps, with
one phase per side for per-side exercises. The Session Tracker reads planned occurrences only
from those phases (`plannedWorkFromTimeline`). Presentation and evidence therefore share one plan.
Occurrence ids come from section, block, step position, exercise index and side
(`occurrenceIdFor`). A new protocol's steps must use one of the encoded positions, or extend
`occurrenceIdFor` without changing existing ids.

Occurrence-specific targets (for example a ladder's reps per step) belong on the resolved step,
copied immutably onto its phase and its planned occurrence. EMOM defines that contract below;
the player retains these fields rather than substituting catalogue targets.

### Shared occurrence targets

Explicit blocks may add `block.occurrenceTargets`: a dense array in resolved **exercise-step**
order, before splitting per-side work. It has exactly one entry per step, at most 256 entries.
`null` retains that step's default. An override is
`{plannedPrescription: {type, value}, plannedLoad?: {suggestedLoad, loadUnit, loadInterpretation}}`.
No other keys are accepted. This is planned guidance, never actual performance or catalogue
metadata. No generator route or user control produces these overrides yet.

`resolveOccurrenceTarget` and `validateOccurrenceTargets` validate this plain JSON contract.
Types match the exercise, including `unilateral-` for per-side work. Interval overrides use
`timed` and cannot exceed the block work interval. Values are positive (whole reps): at most
100 reps or 300 seconds per side, with at most 600 estimated work seconds per step.
Rep estimates scale the published estimate by target/default reps, rounding up separately
for each side. Timed estimates count every side. Optional numeric guidance is positive and
at most 1000, with `kg`/`lb` and `per-item`/`total`; it is never copied to actual load.
An alternative `plannedLoad: {relativeLoad: 'lighter' | 'medium' | 'heavier'}` contains
no numerical fields and is permitted only for suitable standing TRX strength work.
EMOM additionally retains its eligibility, 40-second estimate and original target ceilings.

Resolved steps carry frozen `plannedPrescription`, optional frozen `plannedLoad`, and
`estimatedSeconds`. Every step in an overridden block carries `variableTarget: true`, including
default entries. EMOM's existing `target` remains an alias for its resolved prescription.
The player, preview, voice, next hints and Tracker read the resolved target. Rests and minute
boundaries retain their existing semantics; occurrence IDs do not depend on targets.
Invalid overrides resolve to no steps, estimate zero, and fail normalisation. Normalisation
owns a copy of the input overrides and recomputes their estimates rather than trusting caches.

Coach anchor blocks reject occurrence overrides. Variable-target phases cannot link to an
anchor or open the anchor actuals UI. Their timed evidence is capped to the planned occurrence,
and rep Done records completion without inventing measurements. Training History retains their
targets as context and treats variable-target evidence as incomparable, even when two individual
targets match: the surrounding variable dose does not establish comparable fatigue/recovery.
Legacy rounds anchor comparisons are unchanged. Draft/Result schema version 1 stores the optional
fields inside the existing JSON prescription; no migration is needed.

### Repetition ladders

A `ladder` block has one or two distinct rep-based exercises in execution order and
`prescription: {repSteps: [2,4,6,8], exerciseRestSeconds: 15, stepRestSeconds: 45}`.
Steps are strictly ascending or descending, two to five entries, at most 12 reps per
step and 36 total reps per exercise. Each target stays within the catalogue dose;
scaled total work is at most 120 seconds per exercise. Exercise rest is 0–60 seconds,
step recovery 15–90 seconds, with no final rest. There are no load changes or generic
occurrence overrides on ladders: those could contradict the monotonic plan.

`validateLadderBlock(block, catalogue?)` enforces these bounds in validation,
normalisation, resolution and swaps. Eligibility reuses rounds compatibility,
easy/moderate technique, low/medium impact and bilateral/alternating/no-side reps.
Per-side work, anchors, barbells, kettlebells, Heavy loads and dumbbell movements
with strength 4–5 are excluded in this initial policy. No catalogue fields change.

Each exercise at each step resolves a frozen `plannedPrescription`, scaled
`estimatedSeconds`, `variableTarget: true` and one-based `ladderStep`. Existing
occurrence IDs stay unchanged; ladder IDs add `lN`. The shared preview shows the
rep sequence; the player shows “Ladder · Step X of Y”, exact reps, next reps and
normal recovery, pause, Previous and completion controls. Done confirms completion
without inventing actual reps/load. Previous/redo replaces the same keyed outcome.
Training History keeps ladder evidence incomparable, including saved records without
the variable-target flag. Required and preferred anchor targets cannot become ladders.

Automatic routing gives ladders a small Strength/Balanced/Cardio weight, selects two
eligible exercises, fits a bounded ascending/descending plan within its share, and
allows at most one per Main. Existing variety, equipment and dominance scoring still
apply. Coach may use them only as optional work within protocol/avoid/time constraints;
production required anchors retain their released rounds-only definitions.

### Rep and intensity pyramids

`pyramid` uses one stable rep-based strength exercise and
`prescription: {steps: [{reps:4},{reps:8},{reps:4}], stepRestSeconds:60}`.
Three or five steps rise then fall around one rep peak. Optional `relativeLoad`
on **every** step instead permits an inverse rep valley/resistance peak (8/4/8,
lighter/heavier/lighter), or a three-step reverse pyramid (4/6/8,
heavier/medium/lighter). Monotonic reps alone remain ladders. No numerical loads,
mixed/missing cues, occurrence overrides or anchor metadata are accepted.

`validatePyramidBlock` checks the copied exercise and, when supplied, its canonical
metadata. Existing rounds compatibility, easy/moderate technique, low/medium impact,
strength ≥3, cardio ≤3 and unambiguous bilateral/alternating/no-side reps are required.
Heavy loads, barbells, kettlebells, hanging and per-side work are excluded. Steps have
2–12 reps, never exceed the catalogue dose, and total at most 40 reps / 180 work seconds.
Recovery is 60–120 seconds for fixed-load rep pyramids and 90–120 for intensity work;
fitting chooses sufficient recovery within these bounds and never compresses it.
There is no final rest. Invalid plans resolve to no steps and cannot be normalised.

There is no weight inventory. Fixed-load rep pyramids work with one comfortable load.
Relative cues are restricted to standing TRX strength work (strength ≥4, cardio ≤2),
where stance can adjust resistance without assuming extra weights or bands. Preview
and player mark these cues **Planned** and say to adjust stance only if comfortable.
Automatic selection otherwise uses rep pyramids or another protocol; free-weight
intensity changes are deferred until availability can be established.

Resolved steps share frozen occurrence targets, scaled estimates and optional
qualitative `plannedLoad`, with `variableTarget:true` and `pyramidStep`. New occurrence
IDs add `pN`; old IDs and saved records remain unchanged. Preview, speech, next hints,
normal rest/pause/Previous/Skip and Tracker use that same plan. Done records completion;
actual reps, numerical loads and resistance setups remain unknown unless confirmed.
Redo replaces the same outcome and duplicate immutable Session Results add no credit.
Pyramid history remains incomparable, including records missing the variable-target
flag; it cannot become straight-set progression evidence.

Automatic Strength/Balanced supporting work has a small weight, a 150–720-second
share and at most one pyramid per Main. Explicit rep-volume bounds replace the
generic five-full-set loop penalty; ordinary variety, fatigue, equipment and duration
rules still apply. Coach protocol/avoid/time constraints apply to optional work only.
Required and preferred target blocks cannot become pyramids, and production anchors
and progression policies are unchanged. No new controls, catalogue flags or schema
versions are introduced. `tests/pyramid.test.js` covers the domain and shared player.

### EMOM domain contract

An explicit block uses `protocol: 'emom'`, an ordered `exercises` rotation (one to three
distinct eligible exercises), and `prescription: {minutes, slotSeconds: 60, targets}`.
`minutes` is an integer from 1 to 12, at least the rotation length. `targets` aligns with
the rotation; each entry is `{type: 'reps' | 'timed', value}`. No other prescription fields
are accepted. Targets must match the canonical mode, be positive (whole reps), not exceed
the catalogue dose, and estimate at most 40 seconds, leaving at least 20 seconds of room.
Eligibility requires existing `timed_intervals` compatibility, easy/moderate difficulty,
low/medium impact, and unambiguous bilateral/alternating/no-side work. Heavy free-weight
work, barbells, per-side work and Coach anchors are excluded. No catalogue flags are added.

`validateEmomBlock(block, catalogue?)` is shared by Main validation, normalisation, estimation
and resolution. Main validation checks the canonical catalogue as well as the copied block.
Invalid blocks resolve to no steps, estimate zero, and cannot be normalised. Valid estimates
are exactly `minutes * 60`; Main adds the usual external transition between blocks.

Each frozen resolved exercise step has a one-based `minute`, zero-based `slotIndex`,
`startsAtSeconds`, `endsAtSeconds`, frozen `target`, and `completion: 'explicit'`.
Minute N uses rotation index `(N - 1) % exercises.length`. Timed steps also expose `timed`
and target `seconds`; these are work targets within the window. Recovery lasts from the
actual finish to the boundary: no fixed rest step, carry-over work or completed outcome is
invented. The tracker encodes both minute and slot in new occurrence IDs, reads the resolved
target rather than the catalogue dose, and caps timed recording at that planned target.
Passing a boundary alone earns no performed work. Existing occurrence IDs are unchanged.

`buildEmomBlock({catalogue, equipment, availableSeconds, blocks?, sessionPrescription?, random?})`
constructs one bounded candidate using the existing exercise selector. `availableSeconds`
is the total Main budget; preceding `blocks` and their external transition are subtracted.
Without an injected random source it is deterministic. Empty/ineligible pools or insufficient
time return `null`; a single exercise may rotate. With a Session Prescription, current Coach
preflight must be feasible, required blocks are reserved first, hard protocol/avoid/time
constraints apply, and anchors cannot become EMOM work. A supplied prefix must preserve the
reserved required blocks. Automatic composition uses the same exercise selector, eligibility
and target contract through `buildMainBlock` and `chooseClosestPrescription`.

The existing player uses one block origin on monotonic active workout time (`performance.now`,
with a Date fallback). Pause excludes time; Done/Skip ends work but never advances the minute.
Reps require Done, otherwise they remain skipped/unknown; no partial-rep or load values are
invented. Timed targets record only measured work before target/window end, then show recovery.
Delayed callbacks skip unentered windows and join the live minute without backfilling timed
credit. A hidden page never starts new exercise work; returning observes the live window.

Previous is disabled during EMOM; expired EMOM occurrences cannot be replayed by Previous.
Direct revisits rejoin the original clock and preserve settled outcomes. Navigation away
stops timers; a back-forward-cache restoration stays paused for an explicit Resume. Coach
reload recovery consults only durable outcomes. Standalone early exits retain the existing
ephemeral policy. Pending saves capture evidence at the action, cannot shift the block origin,
and cannot advance a different workout after navigation; failures offer Retry save.

The same ring shows seconds remaining in the minute; targets remain visible beside work/rest
status. Minute starts and actual work completion have distinct cues, with no backlog of stale
completion cues. Previews show EMOM targets. Swaps preserve the exact target type/value, rotation
position and minute windows; the replacement must pass canonical eligibility and target validation.
Without a safe alternative the plan stays intact.

EMOM history remains explicitly incomparable: actual rep pacing/recovery conditions are not
recorded. `tests/emom.test.js` covers the domain; `tests/emom-player.test.js` adds fake-clock,
tracker, recovery and UI coverage. `blockFixtures(catalogue, {emom:true})` includes the EMOM
playback fixture; the saved-v2 characterisation retains its original three blocks.

### Automatic routing

The existing duration-dependent block count and quality rules apply. EMOM has a modest focus-based
weight, needs at least two eligible exercises and a 3–12 minute share, rotates at most three
exercises, and caps exposure at four minutes per exercise. Consecutive EMOM blocks are excluded;
there is no novelty quota or new control. Rounds, supersets and intervals remain common. Quality
and equipment scores count each exercise's actual rotation exposures, not every minute as a round.
Required/preferred Coach target blocks are reserved unchanged first, including recovery; EMOM
supplies optional work only within protocol, avoid and time constraints. Production programme
anchors remain rounds. Hard EMOM-only optional prescriptions still need a practical pool/budget.

The existing within-session protocol-variety credit also ranks Coach attempts. A small 0.5 weight
penalty for recently performed protocols uses at most four existing Session Results, joining
performed Main occurrences to their planned protocols. Skipped/planned-only work is excluded.
Standalone reads use the store's metadata-filtered `{source: 'generator', limit: 4}` query on load
and after successful completion, cached only in memory; while unavailable/loading recency is neutral.
Coach reuses its loaded results. `gf_generator_history` remains exercise IDs only; there is no
additional persistent pattern history. Neither recency nor variety revives an ineligible protocol.
`tests/automatic-patterns.test.js` covers the seeded routing matrix and these constraints. The
full reachability audit uses 48 seeds per combination: very rare preparation roles were too
sensitive to a single draw in the previous 24-seed sample; failure criteria stay unchanged.

### Presentation names

`paired_sets` is shown to users as a **Superset**: exercises A then B each set, a changeover
(`betweenExercisesSeconds`) between them, and rest (`betweenSetsSeconds`) only after each
completed pair. `GarageFitWorkoutPreview.protocolLabel` and `supersetMarker` supply the preview
copy; the player labels each step `Superset · Set N of M · A/B`. Naming never changes the stored
protocol id, prescription or occurrence ids.

## 4. Unknown protocols

An unknown protocol has no steps and an estimate of 0. `validateMain` reports
`invalid-protocol`. `normaliseWorkout` throws instead of playing an empty block. Training History
never treats it as comparable. A block with no protocol is still a legacy `rounds` block.

## 5. Coach

Required anchors in production programmes allow only `rounds`. Do not broaden those
definitions. Coach anchor and minimum blocks (`anchorBlock`, `minimumOptionalBlock`) build
prescriptions for the current protocols only. Extend them when a protocol becomes Coach-eligible.

## 6. Persistence

Generated workouts (schema version 2) are not stored.
Coach stores planned occurrences in Session Drafts and Results (schema version 1). Their
`prescription` is free-form JSON, so additive occurrence fields load without a migration.
EMOM adds minute/window/target fields only inside that JSON prescription. Its new occurrence
IDs apply only to new EMOM work; existing IDs and both schema versions stay unchanged.
Changing the meaning of an existing field or an existing occurrence ID needs an explicit
schema/migration decision in `js/coach-model.js`.

## Adding a protocol

1. Add its shape to `PROTOCOL_SHAPES`. Add steps to `resolveBlockSteps` and timing to
   `estimateBlockDuration`.
2. Add its conditions to Training History. Add it to the Coach model only if prescriptions may name it.
3. Add domain fixtures/tests. Extend `tests/helpers/protocol-fixtures.js` when the protocol
   becomes playable so the shared playback contract tests cover it too.
4. Add player labels and preview text in its playback ticket.
5. Define conservative eligibility from existing metadata where possible, and add it to
   `GENERATED_PROTOCOLS` only in the ticket that authorises selecting it.
