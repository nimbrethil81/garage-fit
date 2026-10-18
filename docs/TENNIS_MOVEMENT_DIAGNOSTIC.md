# Tennis movement diagnostic (#159)

Reproduce with `node scripts/audit-tennis-movement.js > /tmp/tennis-movement.json`.
The grid uses fresh equivalent states, Balanced focus and default home space.
Roles are forced only for comparison, with no fabricated performed credit.
The production eight-week tracker test separately verifies earned rotation.

Versions 5/6 × seeds 1/29/95 × 20/30/45 minutes × 2/3 sessions per week ×
bodyweight/DB/TRX/mixed kit produce 270 workouts and 36 explicit blocked starts.
Bodyweight-only cannot supply the required persistent pull anchor; temporary
bodyweight-only days on an existing programme are tested separately.

## Representative 30-minute pair

Seed 95, dumbbells + kettlebell + TRX + pull-up bar. Seconds include the actual
generated preparation and cooldown. Shares measure estimated exercise work time
with lateral/trunk/conditioning/power mapping, excluding rest; they are diagnostic
comparisons, not universal dose targets or evidence of tennis improvement.

| Version | Role | Total seconds | Main seconds | Relevant work share |
| --- | --- | ---: | ---: | ---: |
| v5 | strength-stability | 1759 | 1289 | 4.7% |
| v5 | movement-conditioning | 1723 | 1253 | 12.0% |
| v6 | strength-stability | 1755 | 1285 | 9.8% |
| v6 | movement-conditioning | 1690 | 1220 | 86.1% |

### v5 strength-stability

| Main protocol | Seconds | Exercise IDs (A = persistent anchor) |
| --- | ---: | --- |
| rounds | 128 | `dumbbell-reverse-lunge` (A) |
| rounds | 96 | `dumbbell-romanian-deadlift` (A) |
| rounds | 96 | `dumbbell-floor-press` (A) |
| rounds | 96 | `dumbbell-bent-over-row` (A) |
| rounds | 30 | `kettlebell-russian-twist` |
| rounds | 495 | `kettlebell-goblet-squat`, `trx-pike`, `trx-row` |
| paired_sets | 330 | `trx-knee-tuck`, `trx-triceps-press` |

### v5 movement-conditioning

| Main protocol | Seconds | Exercise IDs (A = persistent anchor) |
| --- | ---: | --- |
| rounds | 128 | `dumbbell-reverse-lunge` (A) |
| rounds | 96 | `dumbbell-romanian-deadlift` (A) |
| rounds | 35 | `dumbbell-lateral-raise` |
| rounds | 30 | `kettlebell-russian-twist` |
| rounds | 30 | `dumbbell-push-press` |
| rounds | 30 | `high-knees` |
| rounds | 320 | `trx-biceps-curl`, `kettlebell-sumo-squat`, `trx-pike` |
| rounds | 320 | `dumbbell-shoulder-press`, `trx-body-saw`, `trx-row` |
| paired_sets | 240 | `ski-abs`, `reverse-lunge-knee-drive` |

### v6 strength-stability

| Main protocol | Seconds | Exercise IDs (A = persistent anchor) |
| --- | ---: | --- |
| rounds | 128 | `dumbbell-reverse-lunge` (A) |
| rounds | 96 | `dumbbell-romanian-deadlift` (A) |
| rounds | 96 | `dumbbell-floor-press` (A) |
| rounds | 96 | `dumbbell-bent-over-row` (A) |
| rounds | 30 | `kettlebell-russian-twist` |
| rounds | 40 | `alternating-lateral-lunge` |
| paired_sets | 200 | `trx-squat`, `trx-body-saw` |
| paired_sets | 230 | `kettlebell-deadlift`, `kettlebell-shoulder-press` |
| paired_sets | 345 | `ski-abs`, `curtsy-lunge` |

### v6 movement-conditioning

| Main protocol | Seconds | Exercise IDs (A = persistent anchor) |
| --- | ---: | --- |
| rounds | 128 | `dumbbell-reverse-lunge` (A) |
| rounds | 96 | `dumbbell-romanian-deadlift` (A) |
| rounds | 40 | `alternating-lateral-lunge` |
| rounds | 30 | `kettlebell-russian-twist` |
| rounds | 30 | `kettlebell-swing` |
| rounds | 360 | `dead-bug`, `side-plank`, `plank` |
| paired_sets | 360 | `mountain-climbers`, `cossack-squat` |
| rounds | 155 | `dumbbell-wood-chop`, `trx-mountain-climber`, `kettlebell-lateral-lunge` |

The same four persistent identities and normal two-set rounds/rest conditions
remain in both versions. The movement role retains its two selected anchors,
then reserves home lateral control and complementary support. In v6 all generic
Main filler belongs to the role pool; anchors are never satisfied by generic copies.
The JSON also records exact targets, repetitions/cycles, mapped facets, warnings
and every block. Other grid seeds use compatible optional timed intervals.

## Limits and validation

Across feasible kits/durations/seeds, both v6 movement roles have a higher
role-relevant exercise share and work-time share than their paired strength role.
This is a bounded regression matrix, not a fixed percentage promise. Low impact,
readiness, recent/planned hard tennis, consolidation and event limits can remove
lateral/power/conditioning work: role-specific partial warnings, feasible fallback
or rest remain preferable to forcing a full movement session. Default home
coverage can observe lateral-control after performed work, never lateral-braking.
Existing v1–v5 instances and drafts stay pinned; there is no automatic upgrade.

The full catalogue reachability audit passed 27,360 standalone workouts with zero
unreachable eligible exercises. Its 38 rare and 30 dominant warnings were reviewed:
rare support work competes with primary patterns, and preparation roles compete
for limited phase slots; dominance occurs in small equipment pools or deliberate
preparation slots (for example standing knee curls). All flagged exercises remain
reachable. No frequency rebalancing was made. Standalone behavior is unchanged
when the optional Main pool field is absent, including the Coach/Generator
characterisation fixture.
