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

1. Decide its intended phases and, for Main, its role (`mainRole`) before writing metadata.
2. Give it a unique kebab-case `id` and a display `name`.
3. State `prescription`, plus `estimatedSeconds` if it is rep-based (timed estimates
   are derived).
4. Set the phase flags it belongs to (`generator`/`main`, `warmup`, `rampup`,
   `cooldown`) and each phase's own fields.
5. Generator and preparation exercises must state `patterns`, `conditioning`,
   `strength` and `cardio`; choose them with the anchors below, not by copying a
   neighbour. Generator and Ramp-up exercises must also state `difficulty`, and generator
   exercises `bodyFocus` (see below).
6. Add `family` / `repetitionClass` only if the definitions below are met.
7. Consider a short `instruction` if the name may be unfamiliar; follow the editorial standard below.
8. Run `node --test tests/*.test.js`; it validates the catalogue.
9. Prove reachability. For every generated phase the exercise is flagged for, add a
   bounded deterministic test (fixed seeds, at most a few hundred generated workouts)
   showing it is selected in a suitable equipment/focus/duration configuration; see
   `tests/reachability.test.js`. Reachability is not a frequency target: the exercise
   stays subject to its role and the phase's rules, and need not be as common as its
   peers or appear in every workout.
10. For a batch of exercises, run `node scripts/audit-exercise-reachability.js`. It fails
    if any exercise eligible for a generated phase is never selected across its
    representative configurations, and warns about rare and dominant ones. Its configuration matrix covers bodyweight, each
    catalogue requirement set, all equipment and every two-equipment combination. Review the
    warnings against each exercise's intended role rather than equalising frequencies,
    and include the relevant results in the PR summary.

Also run the full audit after material generator selection or scoring changes, after
changing relationship or phase metadata rules, and when investigating observed overuse
or absence. It is not part of the ordinary test run.

Each failure and rare warning is followed by diagnostic evidence from the generator's own
selection trace (`--no-diagnostics` skips it; `--json` includes it as `diagnostics`):

- `eligible` / `selected`: configurations where the exercise is eligible (and what excludes
  it elsewhere), where it was selected and its best configuration.
- `funnel`: the share of its selection slots that pass the pre-score filters, reach the
  shortlist window, are drawn, and survive later attempt or sequence choice, each against
  the phase median, with the rules or outcomes that removed it.
- `rank` / `score`: its best and median rank against the window, how far its score falls
  short of the window boundary, and the generator's labelled score components: its own
  largest penalties and where the candidate ranked directly above it leads (means over a
  deterministic sample of slots).
- `above`: the exercises most often ranked directly above it.
- `diagnosis`: a general classification of the stage furthest below the phase median and
  its main cause. It is guidance for review, not a decision; never change metadata just to
  move a classification or a frequency.

## Exercise instructions

`instruction` is optional. Add it when the exercise name alone may not tell an
unfamiliar user what to do. Write **one concise sentence** describing essential
setup and movement. For genuinely complex multi-step exercises where one sentence
would reduce clarity, a second concise sentence is permitted as a strict exception.
It must sound natural both on screen and spoken aloud, and fit within 180 characters
on one line. Do not turn it into a coaching essay: omit benefits, motivational copy,
alternatives, generic safety boilerplate and lengthy technique notes. Keep it
separate from `timedCues`, which direct a change during the movement rather than
explain how to perform it.

`voiceInstruction` defaults to `false`. Set it to `true` only when automatic
explanation is materially useful; it requires a valid `instruction`. The app
speaks it once per exercise id in each workout session when timing allows. The
written instruction remains available even when automatic speech is skipped.

| Exercise | Good | Avoid |
| --- | --- | --- |
| TRX knee tuck | “From a plank with feet in the TRX straps, draw both knees towards your chest, then extend.” | “Do your best with TRX knee tucks for stronger abs!” |
| Wall angel | “With your back against a wall and arms bent in a W, slide your arms up into a Y and back down.” | “Stand against a wall. Move your arms up. Keep your back flat. Repeat carefully.” |

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

### `difficulty`

`difficulty` is how demanding the exercise is to perform well for a typical user: its
strength prerequisite, skill and coordination, balance, and the power or work capacity
it needs. It is `easy`, `moderate` or `hard`. Generator and Ramp-up exercises must state
it; other exercises leave it unset (`null`).

| Value | Use for | Examples |
| --- | --- | --- |
| `easy` | Simple, stable movements a beginner can perform well at a comfortable effort: no jumping, no technical or ballistic lifting, no demanding strength prerequisite. | Air squat, glute bridge, plank, crunches, jumping jacks, band exercises, supported dumbbell presses and rows, step-ups, TRX row |
| `moderate` | Standard movements that need some strength, coordination, balance or conditioning but are routine for a regular trainee. | Push-ups, lunges, goblet squat, deadlifts, kettlebell swing, mountain climbers, high knees, hanging knee raise, TRX chest press |
| `hard` | Movements with a substantial strength, skill, balance or power prerequisite, or explosive full-body work. | Pull-ups, toes-to-bar, pistol and Bulgarian split squats, cleans and snatches, thrusters, burpees, squat/box/skater jumps |

Classify the movement, not the equipment: a barbell or kettlebell does not make an
exercise hard, and bodyweight does not make it easy. Load is the user's choice, so judge
the movement at a sensible load. Repeated jumping with a flight phase (`impact: 'high'`)
is never `easy`. When torn between two levels, choose the lower one unless the exercise
would be inappropriate for an Easy workout. `difficulty` is independent of `strength`
and `cardio`: jumping jacks are `cardio: 5` but `easy`, and a dumbbell floor press is
`strength: 5` but `easy`.

The generator's workout difficulty (Easy / Normal / Hard) reads it; see Phases below.

### `bodyFocus`

`bodyFocus` is the body area an exercise primarily trains: `upper`, `lower`, `core` or
`full-body`. Generator exercises must state it; other exercises leave it unset (`null`).
Choose one value: the area that does most of the work and that a user would say the
exercise is for.

| Value | Use for | Examples |
| --- | --- | --- |
| `upper` | Arms, shoulders, chest or back do the work: presses, push-ups, dips, rows, pull-ups, curls, raises, hangs. | Push-up, dumbbell shoulder press, bent-over row, pull-up, dead hang, renegade row, push press |
| `lower` | Hips and legs do the work: squats, lunges, hinges, bridges, step-ups, jumps, running drills. | Air squat, reverse lunge, Romanian deadlift, kettlebell swing, glute bridge, box jumps, high knees |
| `core` | The trunk does the work, holding or moving against the limbs: planks, crunches, leg raises, twists, chops, anti-rotation, plank-based knee drives. | Plank, bicycle crunch, hanging knee raise, mountain climbers, Russian twist, Pallof press, ski abs |
| `full-body` | Upper and lower body share the work with no clear primary area: lifts that move a load from the floor overhead or to the shoulders, carries, burpees, crawls, whole-body jumping. | Clean and press, thruster, snatch, kettlebell clean, farmer carry, burpees, bear crawl, jumping jacks |

Classify by where the effort is, not by stance or which joints move: a hinge can be
`upper` when the pull is the point (bent-over row) and `lower` when the hips drive the load
(swing, deadlift); a hanging knee raise is `core`, not `upper`. Use `full-body` only when no
one area clearly leads; it is not a default for conditioning work. `bodyFocus` is
independent of `patterns`, which describe how the exercise moves.

The generator's workout body focus (Upper / Full Body / Lower / Core) reads it; see Phases
below.

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
| `mainRole` | `primary`, or `supporting` for punctuation movements that should not dominate long, repeated blocks. Main scores supporting work down; long non-Cardio Mains with at least two non-conditioning supporting candidates occasionally offer one of them the last slot of their accessory block. |
| `mainProtocols` | Protocols the exercise suits. Defaults to `rounds` + `paired_sets`; `timed_intervals` is opt-in (`WITH_TIMED_INTERVALS`). |
| `warmup` / `rampup` | Eligible for the generated Warm-up or Ramp-up. Each needs its prescription and the prep scales. |
| `cooldown` | Cool-down stretch. Cannot also be work or preparation. |
| `timedCues` | Mid-exercise cues at a fraction (0–1) or seconds offset. |

Exercises with no phase flags (for example `easy-recovery-walk`) exist for fixed
workouts.

### Workout difficulty (generator policy)

The Generator's optional Difficulty setting is `easy`, `normal` (the default) or `hard`.
It is policy in `js/generator.js` (`DIFFICULTY_POLICY`), not metadata:

| Setting | Generated Main | Ramp-up | Warm-up / Cool-down |
| --- | --- | --- | --- |
| Normal | Neutral: no exclusion or score change; generation is identical to omitting the setting. | Unchanged. | Unchanged. |
| Easy | `hard` exercises are ineligible; `easy` exercises get a score preference over `moderate`. | `hard` exercises are ineligible. | Unchanged. |
| Hard | Nothing is excluded; `hard` exercises get a score preference, `moderate` a smaller one. The preference is withheld from a high-impact exercise following high-impact work, and stays below the pattern, recency and variety rules. | Unchanged. | Unchanged. |

Main swaps keep the workout's difficulty, and Ramp-up swaps keep Easy's exclusion.
Difficulty changes exercise selection only, not rest, rounds or interval structure.

### Workout body focus (generator policy)

The Generator's optional Body focus setting is `upper`, `full-body` (the default), `lower`
or `core`. It is policy in `js/generator.js` (`BODY_FOCUS_POLICY`), not metadata, and it
applies to generated Main only:

| Setting | Generated Main |
| --- | --- |
| Full Body | Neutral: no score change; generation is identical to omitting the setting. |
| Upper / Lower / Core | Nothing is excluded. Exercises whose `bodyFocus` is the focus area get a score preference, `full-body` exercises a smaller one. The preference pauses beside a run of two focus-area exercises (a `full-body` exercise neither extends nor breaks the run), is withheld from a high-impact exercise following high-impact work, and works through the usual scores, so pattern, repetition, recency, equipment and structure rules still apply. |

Warm-up, Ramp-up and Cool-down are unchanged (the Warm-up still adapts its lower-body
preparation to the Main it precedes). Main swaps keep the workout's body focus. Body focus
combines freely with workout style and difficulty.

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
  press, dumbbell/kettlebell swing);
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
| Main | Hard cap of one per workout for `occasional` families, shared by generation and swaps. Recent use of a variant counts towards recency penalties. | Soft score penalty when the immediately preceding Main exercise shares it; never an exclusion. |
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
