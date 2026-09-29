# Exercise metadata

`data/exercises.js` is the canonical exercise catalogue. Each exercise is one object
passed to `buildExerciseCatalogue()`, which fills in defaults and derived fields and
rejects duplicate ids, unknown fields and incomplete definitions.
`GarageFitGenerator.validateCatalogue()` then checks every value against the rules
below; the test suite runs it on the shipped catalogue.

Metadata describes what an exercise *is*. What a relationship or score *means* in a
given phase (Main, Warm-up, Ramp-up, Cool-down) is generator policy in
`js/generator.js`, not metadata.

## Adding an exercise

1. Give it a unique kebab-case `id` and a display `name`.
2. State `prescription`, plus `estimatedSeconds` if it is rep-based (timed estimates
   are derived).
3. Set the phase flags it belongs to (`generator`/`main`, `warmup`, `rampup`,
   `cooldown`) and each phase's own fields.
4. Generator and preparation exercises must state `patterns`, `conditioning`,
   `strength` and `cardio`; choose them with the anchors below, not by copying a
   neighbour.
5. Add `family` / `repetitionClass` only if the definitions below are met.
6. Run `node --test tests/*.test.js`.

## Identity and equipment

| Field | Meaning |
| --- | --- |
| `id` | Stable kebab-case identifier. Saved history refers to it, so don't rename it. |
| `name` | Display name. |
| `equipment` | AND-of-OR groups of ids from `data/equipment.js`: `[['bench','box']]` means a bench *or* a box; `[['dumbbells'],['bench']]` means dumbbells *and* a bench. `[]` is bodyweight. |

## Movement classification

### `patterns`

These describe how the exercise moves. An exercise may have several, or none (for
example jumping jacks or arm circles).

| Pattern | Use for |
| --- | --- |
| `squat` | Bilateral knee-and-hip-dominant squatting (air squat, goblet squat, box jumps). |
| `hinge` | Hip-dominant hinging (deadlifts, swings, cleans, bent-over rows). |
| `lunge` | Split-stance or single-leg lower body (lunges, split squats, step-ups, lateral walks). |
| `push` | Pressing away from the body (push-ups, presses, dips). |
| `pull` | Pulling towards the body or hanging (rows, pull-ups, curls, dead hang). |
| `carry` | Loaded carries. |
| `core` | Trunk-focused work (planks, crunches, knee raises). |

`squat`, `hinge`, `lunge`, `push`, `pull` and `carry` count as major patterns for
Main variety. `squat`, `hinge` and `lunge` count as lower-body demand.
`conditioning` is not a pattern (see below).

### `conditioning`

This is a boolean. It says the exercise is suitable for a conditioning role: sustained,
pulse-raising work that can fill a "conditioning" recipe slot or suit a conditioning
or finisher block.

This is a category, not a degree. `cardio` measures how much cardiovascular demand the
exercise creates. The two are independent:

- A heavy farmer carry has `cardio: 3` but is not conditioning work (`false`).
- A bicycle crunch is conditioning work (`true`) with only `cardio: 3`.

Generator scoring uses both on purpose. The category decides whether an exercise fits
the role, and `cardio` grades how intense it is within that role. Conditioning status
alone never counts as lower-body demand.

### `strength` / `cardio` (integers 1–5)

| Value | `strength`: muscular challenge | `cardio`: cardiovascular demand |
| --- | --- | --- |
| 1 | Negligible: mobility, jumping jacks, recovery walk | Negligible: static holds, slow heavy hinges |
| 2 | Light: high-rep bodyweight such as burpees or bicycle crunches | Light: most controlled strength sets |
| 3 | Moderate bodyweight: air squat, plank, dead hang | Moderate: air squats, carries, bicycle crunches |
| 4 | Hard bodyweight or moderate load: push-ups, bands, TRX, hanging knee raise | High: cleans, step-ups, kettlebell figure-of-eight |
| 5 | Heavy load or very hard bodyweight: goblet squat, barbell lifts, pull-ups | Maximal: jumping jacks, burpees, swings, high knees |

### `impact`

| Value | Meaning |
| --- | --- |
| `low` | Feet stay planted or the movement is controlled with little joint loading (presses, rows, planks, mobility). |
| `medium` | Repeated knee/hip loading or low-amplitude bouncing or stepping (squats, lunges, swings, jumping jacks, mountain climbers). |
| `high` | Jumping and landing with a flight phase (burpees, squat jumps, box jumps, star jumps, high knees). |

Warm-up excludes `high`. Main and Ramp-up score it (they avoid back-to-back
high-impact exercises, for example). In Cardio, on-feet `medium`/`high` work counts as
lower-body demand.

### Other descriptors

- `bodyPosition`: `standing`, `floor`, `hanging`, `supported` or `mixed`.
- `movementPlanes`: one or more of `sagittal`, `frontal` and `transverse`.
- `load`: `Light`, `Medium` or `Heavy`. This is a display hint for loaded exercises,
  and the generator avoids alternating loads.

## Sidedness and timing

`sidedness` is the only source of truth for how the sides are worked and timed.

| Value | Meaning | Timed prescription | Playback |
| --- | --- | --- | --- |
| `bilateral` | Both sides work together (squat, push-up). | Stated duration is the total. | One phase |
| `none` | No meaningful left/right distinction (plank, dead hang). | Stated duration is the total. | One phase |
| `alternating` | Sides alternate within one continuous interval (walking lunge, mountain climbers). | Stated duration is the total interval. | One phase |
| `per-side` | One side, then the other (side plank, step-ups). | Stated duration applies to each side ("30 sec each side" takes 60 sec). | One phase per side, in `sideOrder` |

Rules enforced by validation:

- Per-side exercises use `unilateral-timed` / `unilateral-reps` prescriptions in every
  phase. All other sidedness values use `timed` / `reps`.
- Timed estimates (`estimatedSeconds`, derived warm-up and ramp-up estimates) equal
  `value × sides`.
- Per-side exercises cannot use `timed_intervals`, because one interval cannot hold
  both sides.

## Prescriptions

- `prescription`: `{type, value}` with type `timed`, `unilateral-timed`, `reps` or
  `unilateral-reps`. Used by Main and fixed routines.
- `estimatedSeconds`: required for rep-based prescriptions; derived for timed ones.
- `prescriptionModes`: optional restriction on permitted modes (`time`/`reps`).
- `warmupPrescription` / `rampupPrescription`: timed only. They may carry
  `minValue`/`maxValue`; fitting to the phase budget moves the value in 5-second steps
  within that range. Every side counts against the budget.

## Phases

| Field | Meaning |
| --- | --- |
| `main` | Usable as Main work (generated or fixed). |
| `generator` | Eligible for generated Main. Requires `main`. |
| `mainRole` | `primary`, or `supporting` for punctuation movements that should not dominate long, repeated blocks. |
| `mainProtocols` | Protocols the exercise suits. Defaults to `rounds` + `paired_sets`; `timed_intervals` is opt-in (`WITH_TIMED_INTERVALS`). |
| `warmup` / `rampup` | Eligible for the generated Warm-up or Ramp-up. Each needs its prescription and the prep scales. |
| `cooldown` | Cool-down stretch. Cannot also be work or preparation. |
| `timedCues` | Mid-exercise cues at a fraction (0–1) or seconds offset. |

Exercises with no phase flags (for example `easy-recovery-walk`) exist for fixed
workouts.

## Preparation metadata

### Prep scales (integers 1–5)

| Value | `prepIntensity`: how much it raises effort | `prepFatigue`: fatigue carried into Main | `prepComplexity`: coordination and technique |
| --- | --- | --- | --- |
| 1 | Basic mobility (arm circles, body twists) | None (mobility, jumping jacks, dead hang) | Simple (arm circles, air squat, jacks) |
| 2 | Gentle dynamic (plank, dead hang, step back lunge) | Light (air squat, plank, carries) | Moderate (push-up, lunge, deadlift) |
| 3 | Moderate (air squat, knees up, loaded hinges) | Moderate (push-up, goblet squat, burpees, swings) | Technical (kettlebell swing and figure-of-eight, TRX mountain climber) |
| 4 | Brisk (jumping jacks, push-ups, goblet squat, star jumps) | Heavy; excluded from Ramp-up | Highly technical; excluded from Ramp-up |
| 5 | Near-maximal (burpees, high knees, jumps, swings) | Very heavy; excluded from Ramp-up | Very technical; excluded from Ramp-up |

Ramp-up builds intensity towards Main. It excludes fatigue or complexity above 3, and
it flags a final exercise with fatigue above 3 that shares a pattern with the first
Main exercise.

### `warmupAreas`

One or more of `hips`, `knees`, `ankles`, `shoulders` and `trunk`. Covering at least
two of hips/knees/ankles makes an exercise meaningful lower-body preparation. The
Warm-up guarantees a minimum amount of it and caps upper/trunk-only movements.

### `warmupPhase`

One of `basic`, `dynamic` or `late`. It is required for warm-up exercises. Its only
generator role is as a tie-breaker when ordering the Warm-up: exercises are sorted by
`prepIntensity`, then by phase (basic, then dynamic, then late). Otherwise it is
descriptive. A redesign is deferred.

## Relationships

### `family`

`family` is a stable kebab-case id shared by exercises that are direct or near-direct
variants of substantially the same exercise:

- equipment variants of the same named lift (dumbbell/kettlebell/barbell clean and
  press, dumbbell/kettlebell farmer carry);
- phase-specific duplicates (step back lunge and reverse lunge, dead hang and hangout
  on a pull-up bar);
- a stretch and its TRX version.

These do not qualify:

- sharing a movement pattern (all squats are not one family);
- progressions and regressions that change the movement (incline or pike push-ups);
- grip or stance variants that train differently (pull-up and chin-up);
- exercises that merely feel similar (use `repetitionClass`).

Use it sparingly. It is optional.

### `repetitionClass`

`repetitionClass` is a stable kebab-case id shared by exercises that are meaningfully
different but make a workout feel monotonous when programmed close together. For
example, `basic-conditioning` covers jumping jacks and star jumps. It is independent
of `family`: direct variants do not automatically share a repetition class, and
members of a class are not variants of each other.

### `frequency`

`frequency: 'occasional'` asks Main to use at most one member of the exercise's
family per workout (farmer carries). It requires a `family`.

### Phase policy (in `js/generator.js`)

| Phase | Same family | Same repetition class |
| --- | --- | --- |
| Main | Hard cap of one per workout for `occasional` families, shared by generation and swaps. Recent use of a variant counts towards recency penalties. | — |
| Warm-up | Never two members. | — |
| Ramp-up | Avoided (soft-mandatory) against earlier Ramp-up and Warm-up picks, including in swaps. | Soft score penalty against Warm-up and earlier Ramp-up picks. |
| Cool-down | Never two members. | — |
| Fixed Warm-up/Cool-down routines | Not applied. The Routines tab plays explicitly authored Bodyweight / With equipment lists (`fixedRoutines` in `data/workouts.js`); metadata never adds, removes or substitutes their exercises. | — |

`alternativeGroup` and `selectionFamily` are retired. Validation rejects them.

Generated preparation also uses the existing major `patterns` as a sequencing signal:
consecutive Warm-up and Ramp-up exercises, including their shared boundary, prefer
different major patterns. More distant repetition receives a small score penalty, not
a global ban. A constrained catalogue may repeat a pattern to complete the phase;
swaps leave an already suitable slot alone if every replacement would introduce an
avoidable adjacency. This is generator policy, not another metadata relationship.
