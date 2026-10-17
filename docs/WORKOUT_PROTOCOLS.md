# Main block protocol contracts

Current protocols: `rounds`, `paired_sets`, `timed_intervals`. These contracts are the
extension seams for later block patterns (#75). `tests/protocol-contracts.test.js` and
`tests/main-blocks.test.js` enforce them; shared fixtures and the step-trace check live in
`tests/helpers/protocol-fixtures.js`.

## 1. One vocabulary, three copies

| Where | What | Role |
| --- | --- | --- |
| `GarageFitGenerator.PROTOCOL_SHAPES` | `repeatKey`, `stepKey`, `conditionFields` | accepted, playable protocols (`MAIN_PROTOCOLS` is its keys) |
| `GarageFitCoachModel.MAIN_PROTOCOLS` | names | valid in Session Prescriptions (anchors, protocol constraints) |
| `GarageFitTrainingHistory.PROTOCOL_CONDITION_FIELDS` | condition fields | which conditions must match for comparable evidence |

The modules stay independent, and the contract test fails if the copies drift.
`GarageFitGenerator.GENERATED_PROTOCOLS` is separate generator policy: the protocols generation
may choose by itself, in weighted-pick order. A protocol can be accepted and playable before
it is auto-selected. Adding it to `GENERATED_PROTOCOLS` changes selection: update the #53
characterisation fixture only with before/after evidence, and run the reachability audit.

## 2. Block prescription describes structure

`block.prescription` holds one repeat count (`repeatKey`: `rounds` / `sets` / `cycles`) plus the
protocol's condition fields, and nothing else. `blockRepeatCount(block)` reads the repeat key.
`protocolConditions(block)` is the prescription without the repeat count. It is shared by every
occurrence of the block and is frozen on player phases.

## 3. One resolved plan

`resolveBlockSteps(block)` is the only executable plan of a block:

- Exercise steps carry `exerciseIndex` and their position in `stepKey` (`round` / `set` / `cycle`).
  Timed interval steps also carry `timed: true` and `seconds`.
- Rest steps have positive `seconds` and sit only between exercise steps, with
  `nextExerciseIndex` naming the next step's exercise. There is no leading, trailing or
  zero-second rest.
- `estimateBlockDuration(block)` equals the steps' time. An exercise step lasts its `seconds` when
  timed, otherwise the exercise's `estimatedSeconds`. Each rest step adds its `seconds`.

The player (`appendBlockTimeline` in `index.html`) builds every Main phase from these steps, with
one phase per side for per-side exercises. The Session Tracker reads planned occurrences only
from those phases (`plannedWorkFromTimeline`). Presentation and evidence therefore share one plan.
Occurrence ids come from section, block, step position, exercise index and side
(`occurrenceIdFor`). A new protocol's steps must use one of the encoded positions, or extend
`occurrenceIdFor` without changing existing ids.

Occurrence-specific targets (for example a ladder's reps per step) belong on the resolved step,
copied immutably onto its phase and its planned occurrence. No protocol emits such targets yet.
The ticket that adds one defines the field and how Training History reads it.

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

This contract adds no persisted fields. Generated workouts (schema version 2) are not stored.
Coach stores planned occurrences in Session Drafts and Results (schema version 1). Their
`prescription` is free-form JSON, so additive occurrence fields load without a migration.
Changing the meaning of an existing field, or the occurrence id format, needs an explicit
schema/migration decision in `js/coach-model.js`.

## Adding a protocol

1. Add its shape to `PROTOCOL_SHAPES`. Add steps to `resolveBlockSteps` and timing to
   `estimateBlockDuration`.
2. Add its conditions to Training History. Add it to the Coach model only if prescriptions may name it.
3. Extend the fixtures in `tests/helpers/protocol-fixtures.js`. The contract tests then cover it.
4. Add player labels and preview text.
5. Opt exercises in through catalogue `mainProtocols`, and add it to `GENERATED_PROTOCOLS`, only
   in the ticket that authorises selecting it.
