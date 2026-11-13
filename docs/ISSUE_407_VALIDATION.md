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

## GF-META-R1 continuation

Authority: [owner approval R1-A–F](https://github.com/nimbrethil81/garage-fit/pull/408#issuecomment-6858917597).
The nine cardio-2 CD1 entries no longer qualify for Cardio v1's unchanged minimum
of 3. This loss is explicitly accepted. Tests distinguish the original eighteen
from the current nine suitable entries, assert exclusion of the other nine across
ninety family sessions, and retain all original traditional Main, preparation and
Full-Body crossover route checks. No Cardio v2 work or threshold changes were made.

Ordinary Generator construction now rejects candidate attempts containing more
than four consecutive selected Upper/Lower/Core exercises in Main order across
blocks. It reuses existing attempt/reserve/fallback mechanisms, without a new soft
penalty or selection bias. Ordinary swaps reject prospective edits that violate
this ceiling and return the unchanged plan if no valid alternative exists. Full
Body remains neutral. The separate two-in-a-row **bonus credit** rule is unchanged.
This is not a saved-workout validator. Dedicated prescribed/Coach and family
composition and validation are unchanged. Empty prescriptions retain their exact
ordinary-generation alias and inherit its new-output rule. Historical validation
and playback are unchanged. Setup fitting changes repeat
counts only; captured alternatives already pass the ceiling; the existing
last-resort fallback contains at most three exercise identities.

### Body-focus evidence

Mandatory fixture: Dumbbells, 20 minutes, Balanced, Lower, Normal, LCG seed 569.
Before R1: Goblet squat → Dumbbell Romanian deadlift → High knees → Walking lunge
→ High-knee power steps → Plank up-downs; longest Lower run **5**, 1,153 seconds.
After R1: Dumbbell sumo squat → Dumbbell kickstand Romanian deadlift → Burpees →
V-ups → Skater jumps; longest Lower run **2**, 1,218 seconds.
The latter is 18 seconds over nominal duration, inside the existing ordinary
Generator tolerance of ±max(3 minutes, 18%). No duration limit was changed.

A paired 81-case comparison (three body focuses × three difficulties × bodyweight,
Dumbbells and all equipment × 10/20/45 minutes, Balanced, seed 569) found:

| Measure | Before R1 | After R1 |
| --- | --- | --- |
| Maximum selected-focus run | 5 | 4 |
| Last-resort fallbacks | 0 | 0 |
| Underfilled below 82% duration | 0 | 0 |
| Technical Main errors | 0 | 0 |
| Generation exceptions | 0 | 0 |

The committed regression also checks the existing duration tolerance, complete
preparation, actual rejection of the seed-569 attempt, and an otherwise eligible
swap that would create a fifth Lower exercise. The original body-focus matrix
retains its preference, diversity, fatigue, difficulty, timing and bonus tests.

### Evidence-backed test corrections

No snapshot JSON was refreshed. Existing decision-flow snapshots now explicitly
receive their original pre-#407 metadata input, alongside existing membership
projections. Current catalogue behavior remains checked in live tests. Thirteen
snapshot cases still pass unchanged under the current runtime.

Approved literal expectations were corrected for conditioning, difficulty and
ratings. Bounded fixed seeds were refreshed while retaining route, anchor, dose,
protocol, safety, style and membership assertions. Supine arm pulses retains a
real General Fitness bodyweight route. All eighteen original CD1 identities still
have traditional Main proof, with all six generated/standalone preparation routes
and all seven intended Full-Body crossover identities retained.

Only two incidental frequency assertions changed, following independent review
against the catalogue's explicit “reachability is not frequency equalisation”
rule. Hollow hold's identical 91-workout sample changed from **5 to 2** appearances;
it must still actually appear, and its stronger Core-route/supporting-role checks
remain. TRX high row/standard row changed from **11/48 to 15/26** in the same eighty
workouts. Both are primary and now strength 4; the former 2:1 ratio is replaced by
actual reachability of both, primary-role assertions and no duplicate Main
occurrences. Other quotas and supporting-versus-primary protections remain.

## Remaining quality evidence

The broad, currently feasible Hard Cardio pool still exposes an unchanged quality
assertion: bodyweight, 10 minutes, Hard Cardio, Full Body/default body focus, LCG seed
169 (existing matrix index 3). Current metadata produces Fast feet, Air squat and
Mountain climbers, cardio demand **3.75** against the unchanged **3.8** floor,
deficit **0.01**, unsuitable. Pre-#407 metadata at the same configuration yielded
**4.04348**, suitable. This occurs with Full Body, independently of R1's ceiling.
The quality matrix and threshold have not been weakened. It needs an authorised
quality resolution, potentially coordinated with #402, rather than a silent test
refresh or rating inflation.

The pool is genuinely feasible: Jumping jacks, Fast feet and Mountain climbers,
three rounds with 10-second exercise rests and 30-second round rests, form a valid
390-second Main. The existing proxy reports cardio demand **4**, conditioning
share **1**, zero weak work and high-impact adjacency, and no Main validation
errors. This is diagnostic proof, not a special-case generation recipe.

Separately, the **low-impact bodyweight** pool is now mathematically intensity-
infeasible: all eligible cardio scores are at most 3, below 3.8. Its existing
fallback test now explicitly proves that bound and expects an honest unsuitable
proxy result while retaining bounded attempts, low impact, valid playback and
complete preparation. The original published-era positive proxy fixture remains
checked against its frozen definitions, with current metadata correctly failing
that same proxy. This does not relax the feasible-pool quality matrix above.

The neutral recent-history In-in-out route remains genuine: three actual
traditional Cardio sessions (45 minutes, seeds 1/2/3), followed by 30-minute Cardio
seed 3, select it as supporting work. The fixture now uses that history instead
of Cardio-v1 history, whose coverage changed with the accepted nine losses. No
eligibility or role was changed.

## Review and validation status

FAQ reviewed — no changes required. The five controlled answers still accurately
describe Generator, difficulty, Coach, history and backup. No FAQ/About/Help copy,
graphics, instructions or programme definitions changed. First-use/visual impact:
none.

Independent review confirmed ordinary-only scope isolation and unchanged saved,
family and Coach validation. It requested a true cap-causing swap test and
established duration-tolerance assertion; both are implemented. It approved the
two incidental-frequency corrections with the safeguards above. No outstanding
R1 adapter/runtime findings remain; separate current quality evidence remains
visible.

Fast, Full and exhaustive audit are running to completion with saved exit-status
files. Final results will replace this status before delivery. PR #408 remains
draft; no merge or deployment is authorised or performed.
