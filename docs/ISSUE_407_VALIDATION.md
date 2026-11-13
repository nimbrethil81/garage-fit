# Exercise metadata corrections (#407)

Baseline: `a51cab5` (latest main at implementation). All 73 old values in the
approved issue still matched: 33 cardio, 25 strength, 8 difficulty and 7
conditioning corrections, affecting 67 stable exercise IDs. The regression test
reverses exactly these deltas and compares the entire canonical catalogue's
SHA-256 with that baseline. This protects all other fields and identities,
including instructions, prescriptions, safety, equipment, artwork and eligibility.

The issue's eleven Ramp-up declarations count eleven corrections across **ten
unique exercises** (Kettlebell deadlift has two corrections). Seven unique changed
exercises have Warm-up eligibility. No flags or phase doses were changed.

## Historical definitions

`data/exercises.js` retains complete, deeply frozen copies of the 67 affected
published definitions, independently of the current catalogue. Future current
catalogue edits cannot silently expand these copies. Unaffected definitions
continue through the established canonical validation path.

New family workouts and each Main block declare `exerciseCatalogueVersion: 2`.
Their validation uses current definitions only. Unknown versions and inconsistent
workout/block versions fail. Unmarked legacy records may select the pre-correction
era when their corrected intrinsic fields differ from current values. The whole
validation catalogue then uses that era's complete affected definitions, rather
than permitting individual score overrides or combining fields across eras.

All affected saved Main descriptors must match the published definition, including
rejection of additional unknown fields. Historical lookup never adds identities
absent from a supplied restricted catalogue. The existing exception for independently
evolving preparation declarations remains: those fields do not authorise Main
membership or execution. Identity, equipment, impact, difficulty eligibility,
prescription/occurrence bounds, recovery, protocols, timeline and family quality
continue through the existing validation pipeline using the selected era.
This batch does not alter any historical safety/equipment definitions. A future
release changing those fields requires an explicit review of supported historical
eras; this mechanism does not settle that future policy decision.
Block-level resolution also serves playback and estimates; no saved exercises,
execution targets, sequence or family versions are rewritten.

The owner explicitly accepted this limitation: published-definition integrity does
**not** authenticate a legacy record's origin. Removing version markers or
reconstructing an entire genuine historical definition cannot be distinguished
from a real legacy record. There is no signing, migration or new persistence
subsystem. Coach drafts already store resolved planned occurrences, not a
resumable full workout; recovery preserves that evidence and actual family tuple.

## Representative composition review

Deterministic LCG seed 31, Normal, 30 minutes. Generator samples use the broad kit
listed in `tests/metadata-407.test.js`; Coach samples use the existing pilot's
Dumbbells configuration. Before uses the published definitions; after uses current
metadata. Means describe selected exercise occurrences, not a new quality rule.

| Route | Before | After | Interpretation |
| --- | --- | --- | --- |
| Traditional Strength | mean strength 4.00; 1,756 s | 4.50; 1,708 s | Ranking moves from Dumbbell sumo squat/row to Goblet squat/deadlift; no eligibility policy change. |
| Traditional Cardio | mean cardio 3.38; 1,776 s | 3.13; 1,781 s | Ratings and selections both change; current Cardio policy remains authoritative. |
| Traditional Balanced | mean strength/cardio 4.00/2.60; 1,748 s | 3.38/2.88; 1,792 s | Different mixture of resistance and supporting exercises within the same budget. |
| Strength & Control v3 | mixed-strength; 4.40 mean strength; 1,753 s | same family/style/version; 4.67; 1,771 s | Lowered ratings shift selection towards unchanged heavier lifts; published quality checks pass. |
| Cardio & Conditioning v1 | endurance; mean cardio 4.00; 9 conditioning occurrences; 1,778 s | same family/style/version; 3.50; 6 conditioning occurrences; 1,783 s | Honest lower ratings/conditioning flags; v1 checks pass without applying or changing #402 thresholds. |
| General Fitness v2 Coach | Strength & Control v3; 1,777 s | same family/version; 1,763 s | Main selection changes; programme and family policies remain unchanged. |
| General Strength v2 Coach | 1,752 s | 1,757 s | Goblet squat, Floor press and Bent-over row anchors retained; supporting selection changes. |
| Tennis v8 Coach | 1,753 s | 1,753 s | Same Main IDs and timing; mean strength/cardio changes from 3.91/2.18 to 3.64/2.00. |

## Review

FAQ reviewed — no changes required. The five controlled answers still describe
Generator, difficulty, Coach, history and backup accurately. No FAQ/About/Help
copy or graphics were modified. First-use and visual impact: none.

Independent review identified a preparation-field tolerance regression; corrected
and covered by regression. It also requested an unconditional mixed-era fixture
assertion. A final review also found and corrected historical lookup restoring
IDs excluded from a supplied catalogue; a rejection regression covers it. Validation results are recorded in the implementation PR.

## Implementation stop: current policy conflict

The full suite revealed a structural conflict with the existing CD1 Cardio-family
membership contract. Cardio v1's `cardioLed` predicate requires `cardio >= 3`.
Nine of the eighteen CD1 entries now correctly have cardio 2: Power march,
Step jacks, Standing knee drive march, Alternating hamstring curl steps,
Side step knee lift, Forward/back aerobic steps, Alternating straight punches,
Alternating hooks and Dumbbell alternating punch-out. They cannot satisfy the
existing all-eighteen Cardio-family reachability regression under that policy.
Changing seeds cannot restore these memberships. The Cardio threshold and the
membership regression have deliberately been left unchanged.

This requires the separate policy review prescribed by #407. Independent review
confirmed the conflict and recommends coordinating delivery with #402, retaining
published v1 policy. Explicit owner acceptance of interim membership loss would
be an alternative product decision; it has not been assumed. No #402 policy,
threshold or family version has been implemented here.

Other failing assertions remain visible for diagnosis, including the established
body-focus run safeguard and fixed-seed CD1 preparation/Full-Body samples. A missing
Full-Body fixed-seed selection is not proof of structural exclusion: that family
has a broader selection pool. The PR is blocked, not ready to merge.

Independent reproduction of the body-focus regression: Dumbbells, 20 minutes,
Balanced, Lower body, Normal, LCG seed **569** (existing matrix index 9).
Before metadata: Goblet squat → Dumbbell deadlift → Single-arm dumbbell row →
Dumbbell lateral lunge → Low pogo hops → V-ups (longest lower run **2**).
After metadata: Goblet squat → Dumbbell Romanian deadlift → High knees →
Walking lunge → High-knee power steps → Plank up-downs (longest lower run **5**,
against the existing maximum **4**). This occurs in ordinary Generator selection,
independently of historical compatibility. No seed or safeguard was changed to
conceal this regression. It needs an authorised policy resolution before delivery.

## Validation status at the stop

- `node --test tests/metadata-407.test.js tests/family-validation.test.js`:
  **20 passed**, including all 73 deltas, whole-catalogue baseline reversal,
  all fourteen published family versions (plus the second Cardio difficulty),
  unchanged player timelines, mixed-era/current-marker rejection, extra descriptor
  rejection, restricted-catalogue rejection and Coach durable recovery.
- `node --test tests/ab-blast-catalogue.test.js`: **3 passed** after refreshing
  shifted fixed seeds and retaining the real bodyweight Supine arm pulses route.
- `node --test tests/bear-crawl-batch.test.js`: **10 passed**, including its Full
  samples. Bear crawl's expected cardio is now the approved 3. The original
  360-workout accessory sample remains, with one bounded Upper-body Dumbbells
  fixture added to demonstrate the rare curl route; no frequency threshold changed.
- Focused CD1 suite: **3 passed, 6 failed**. Includes obsolete literal metadata
  expectations and the structural all-eighteen Cardio-family membership conflict.
- Focused body-focus safeguard: **failed**, independently reproduced above.
- `node --test tests/*.test.js` was started and **interrupted at the confirmed
  material stop**, after approximately 20 minutes. Runner totals at interruption:
  **767 passed, 39 failed, 71 cancelled**. These are partial-run totals, not final
  results for the latest branch: some fixed fixtures had already been loaded before
  their corrections. Remaining output snapshots/metadata literals and shifted
  samples were not bulk rewritten to force a green result.
- `node scripts/audit-exercise-reachability.js` was started and interrupted at the
  same stop. It had not emitted its completion report; **no audit result exists**.
- `git diff --check`: passed. No graphics or illustration files changed.

The full suite and exhaustive audit must be rerun to completion after the material
policy conflicts are resolved. This branch is a reviewable, blocked implementation,
not acceptance-complete delivery.
