# Main block protocol contracts

Playable and automatically selected protocols: `rounds`, `paired_sets`, `timed_intervals`, `emom`.
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

`block.prescription` holds one repeat count (`repeatKey`: `rounds` / `sets` / `cycles` / `minutes`) plus the
protocol's condition fields, and nothing else. `blockRepeatCount(block)` reads the repeat key.
`protocolConditions(block)` is the prescription without the repeat count. It is shared by every
occurrence of the block and is frozen on player phases.

## 3. One resolved plan

`resolveBlockSteps(block)` is the only executable plan of a block:

- Exercise steps carry `exerciseIndex` and their position in `stepKey` (`round` / `set` / `cycle` / `minute`).
  Timed interval steps also carry `timed: true` and `seconds`.
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
