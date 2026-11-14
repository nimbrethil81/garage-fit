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

Late catalogue/protocol checks also retain their substantive protections. Kick-
through is absent from the original 150-workout neutral sample but remains
reachable through existing Core-focused Balanced bodyweight generation at 30
minutes, seed 25. The original sample and Curtsy threshold remain. The no-ring
snapshot retains its original metadata input without changing hashes or draw
counts. Ladder fixtures retain all five durations, all three focuses, both
directions, validity, budget, identity variety and determinism; explicit dimension
assertions protect that coverage. Original ten-minute Balanced seeds 1–400 and
Cardio seeds 1–200/280 were unobserved, not proved impossible. Their unchanged
positive routing weights/share bounds and one-ladder limit are separately checked;
the previous specific automatic contexts are not claimed restored.

The additional paired **243-case** review spans all three workout focuses on the
same body-focus/difficulty/kit/duration grid. Maximum run changed 5→4; fallback,
technical-error and exception counts remained zero. The count below 82% nominal
duration remained one before and after; this comparison does not introduce a new
82% hard gate. No case changed from suitable to unsuitable Hard Cardio due to R1.

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

A complete paired run of the existing 120-case Hard Cardio matrix found **0/120
unsuitable before metadata correction, 8/120 after**, all bodyweight; both runs had
zero high-impact adjacency, technical errors and exceptions. Failing current
configurations (Full Body/default body focus, Hard Cardio; seed is the actual LCG seed):

| Minutes | Seed | Cardio demand | Conditioning share |
| --- | --- | --- | --- |
| 10 | 169 | 3.7500 | 0.7500 |
| 15 | 333 | 3.7368 | 0.7368 |
| 15 | 386 | 3.7586 | 0.6552 |
| 30 | 242 | 3.4769 | 0.7385 |
| 30 | 295 | 3.4903 | 0.6194 |
| 45 | 98 | 3.3521 | 0.6197 |
| 45 | 257 | 3.5280 | 0.6818 |
| 45 | 416 | 3.6415 | 0.6981 |

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

## GF-META-R2 bounded correction handover (14 November 2026)

Owner authorised execution and **up to two additional correction cycles** in chat.
Both are consumed across this continuation. One primary agent and one independent
read-only reviewer were used; no specialist agents or broad seed searches.
No further corrective editing is authorised by this handover. PR #408 must remain
open and draft; no merge, auto-merge, deployment, closure or publication.

### Frozen diagnostic baseline

Baseline head: `96225197f5c61e384f17673ede6fd5d5c3c1d514`.

- [Fast](https://github.com/nimbrethil81/garage-fit/actions/runs/43574437176):
  completed failure, 1,482 passed / 5 failed. Runner checked out synthetic merge
  `a4305b692cb3936e714b0acd48b9c3fbf484836b`, explicitly merging this head into
  `f36fe20e7f113f6bb084f2d351bd755c8a48887e`; not a raw-head result.
- [Full and audit](https://github.com/nimbrethil81/garage-fit/actions/runs/43575179157):
  both completed failure, direct checkout of baseline head. Full: 1,530 passed /
  7 failed. Audit: one unreachable phase/exercise. Workflow summary shell quoting
  is defective, but checkout logs independently establish the tested SHA.
  No workflow changes were made here.

These supersede the earlier R1 text saying validation was still running.

### Exact changed files since the frozen baseline

- `js/generator.js`: after ten ordinary Hard Cardio attempts, the remaining
  existing bounded search can narrow already-filtered candidates to fresh,
  credible conditioning work where available. Eligibility, 3.8 demand, 65%
  conditioning share, weak-work limit, impact spacing and 40-attempt bound remain.
  Also adds a repeat-above-three supporting-dose penalty for ordinary repetition
  protocols. This helper is shared with Coach and families: downstream effects
  remain a validation concern, not an assertion of isolation.
- `js/core-challenge-composer.js`: tries smaller already-published rounds circuit
  sizes after the original sizes fail; attempts to avoid impact-unsafe prefixes.
  **Review found the prefix check over-restrictive; do not accept as finished.**
- `tests/strength-cardio-composer.test.js`: replaces strict sampled session
  prevalence with optionality plus direct protection of the unchanged 25% route
  draw, its exact boundary and short-session non-applicability. Existing minor
  supporting share, suitability, uniqueness and family gates remain.
- `tests/reachability.test.js`: replaces Twist/Deadlift frequency ratio with both
  roles, both real routes, a per-session secondary-role share and executable Main
  validation. Replaces warm-up expansion frequency quotas with reachability plus
  actual timed doses, equipment, metadata and uniqueness. Existing phase exclusion,
  knee mobility and major-pattern protections remain.
- `tests/supersets.test.js`: distinguishes a primary five-set pair with a separate
  varied block from a repetitive circuit. **Review found the replacement lacks a
  sufficient duration bound; do not accept as finished.**
- `docs/ISSUE_407_VALIDATION.md`: this evidence, review and explicit stop state.

No changes to canonical metadata, history definitions/adapter, GF-META-R1 ceiling
or swaps, published thresholds, family validators, Coach code/programmes, playback,
prescriptions, timing machinery, artwork, dependencies or infrastructure.
The new selection paths nevertheless need the unresolved review corrections below.
FAQ reviewed — no changes required. No first-use or visual impact.

### Reproduction and expectation evidence

Runtime correction revision: `1ab6e17` (documentation-only commits may follow).

| Failure / unchanged configuration | Before | After / disposition |
| --- | --- | --- |
| Hard Cardio existing 120-case matrix | 8 unsuitable; first 10m bodyweight seed169 demand 3.75 | Matrix passes. Seed169 demand 4, conditioning share 1, weak work 0, high-impact adjacency 0. A separate Hard variety safeguard now fails; not accepted. |
| Jumping Jacks, original 20m Cardio sample seed23 | four exposures | seed23 now chooses other exercises; original 80-seed exposure test passes, including genuine isolated selection route and relative supporting penalty. No blanket exclusion. |
| Full-Body 45m Hard standing Dumbbells, Upper, LCG seed2 | family-not-feasible | Original S1 fixture passes; valid 2,678s rounds session includes Suitcase march, 985s and 1,010s Main blocks, five rounds each, unchanged gate passes. Prefix review issue still blocks acceptance. |
| Tiny-loop 30m Strength, KB/TRX/Bands, LCG104 | one of 72 classified dominated | Exact workout unchanged: five-set Single-leg deadlift/Goblet squat pair 665s; three-round Ski abs/TRX curl/TRX knee tuck/Band triceps circuit 660s; whole session 1,803s. Six unique IDs. Legitimate paired prescription, but revised test needs a stronger duration protection. |
| Strength v2 supporting prevalence, same 40 configs | published metadata 17/40, 17/284 slots | corrected metadata 20/40, 21/294 slots. Strict session-majority assertion is not the 25% route contract; replacement checks that contract directly, retaining slot/dose/suitability/uniqueness protections. |
| Russian Twist / KB Deadlift, same original sample | 1 / 57 | 4 / 13 after Deadlift strength 5→4. Retained real reachability, supporting role, non-repetition, added per-session secondary share and executable doses instead of fixed fourfold ratio. |
| Band External Rotation warm-ups, same sample | 8 | 2. No prescribed three-appearance contract; actual route retained with dose, equipment, uniqueness and phase-exclusion protections. Uniform expansion reachability replaces uniform frequency quota; no sample or seed changes. |

Before/after frequency counts use the complete published affected definitions versus
current definitions in identical existing sample configurations. No metadata was
edited to obtain these counts. Tests were not given favourable seeds or larger samples.
Hard Cardio and Jumping Jacks quality assertions and all family quality gates remain
unchanged; the tiny-loop replacement is expressly not independently approved.

### Cycles and independent review

1. Bounded recovery candidate search, supporting-dose penalty and impact prefix
   filtering. Focused retest: Jumping Jacks passed; Hard Cardio moved to an exact-ID
   reuse failure; Full-Body remained infeasible. No acceptance claimed.
2. Recovery prefers fresh IDs; smaller circuit fallback; evidence-backed expectation
   batch above. Two-test exact reproduction passed Hard Cardio matrix and S1 family
   fixture. Wider six-suite validation exposed a separate Hard variety regression.

Independent reviewer inspected stable `1ab6e17`, without edits or extra test sweeps:

- `core-challenge-composer.js`: cyclic `impactSafe` is unsuitable for an incomplete
  prefix. A first high-impact exercise is compared with itself and rejected although
  a completed high/low/low circuit is legal. Material unresolved finding.
- `supersets.test.js`: under 45 minutes, an arbitrarily dominant primary pair could
  pass with a separate three-ID block. Needs meaningful exposure/duration protection.
- New Hard variety/fatigue test failure remains. Candidate narrowing can displace
  soft adjacent-pattern scoring; exact cause requires the recorded failure evidence.
- Shared supporting penalty needs downstream Coach/family evidence.
- Catalogue, history, programme definitions, thresholds and audit semantics remain
  untouched. Group 2 replacements retain substantive protections.

**Review disposition: not approved. Two cycles consumed; stop corrective editing.**

### Separate read-only Tabletop Toe Taps audit proposal — owner decision only

Frozen audit reports Ramp-up **0/35,280**, eligible in all 49 equipment contexts.
Its funnel passes filters in 99.9% of slots but enters the window in only 0.1%;
35 constructed sequences lose to fitter sequences. This is not a phase-flag or
eligibility failure. Existing focused regression demonstrates Rings, 45m Normal,
Core body focus, Balanced, LCG seed `831056492` as a real Ramp-up route.

The audit's ordinary matrix leaves body focus at default Full Body. Smallest
purposeful general coverage proposal: retain that matrix and diagnostics, and add
one bounded supplemental matrix for every non-default body focus (Upper, Lower,
Core), using existing supported durations, workout focuses and equipment contexts
with a fixed small deterministic seed bank. Derive focuses from the Generator's
public supported-focus values; name no exercises, special seeds or exemptions.
Report default and focused counts separately and a clearly-labelled combined
reachability result. Any acceptance based on combined coverage requires explicit
owner approval. Keep 0/35,280 visible; do not reinterpret the completed failed run.

No audit code, acceptance semantics, exercise scores or phase flags changed.
Do not dispatch another exhaustive audit to conceal the reserved policy decision.

### Completed focused validation and outstanding work

Command on the cycle-2 runtime revision (Node v24.19.0 locally; CI uses Node 22):

```sh
node --test tests/difficulty.test.js tests/main-blocks.test.js tests/supersets.test.js tests/strength-cardio-composer.test.js tests/reachability.test.js tests/metadata-407.test.js
```

Completed: **89 tests, 87 passed, 2 failed**, exit 1, approximately 177 seconds.
Both failures were passing in the frozen CI baseline and are new blockers:

1. `difficulty.test.js:114`: Hard variety/fatigue safeguard reports adjacent shared
   major pattern **Burpees → Dumbbell push press** (`:124`). The original assertion
   is retained, not weakened.
2. `strength-cardio-composer.test.js:509`: original ordinary Generator fixture for
   **Kettlebell single-leg deadlift**, 45m Upper, Kettlebell, LCG45, no longer selects
   that identity (`:523`). No favourable replacement seed or expectation edit.

All original handover failures addressed by this batch pass in these six suites,
including the unchanged Hard Cardio 120-case matrix, 80-seed Jumping Jacks test,
S1 Full-Body fixture, revised supporting/frequency checks, tiny-loop sample, and
exact metadata/history regressions. This does **not** establish task acceptance:
two new test failures and the independent review findings remain unresolved.
A separate two-test reproduction of Hard Cardio matrix / S1 family fixture also
completed successfully; it is narrower than the six-suite result and does not
supersede its failures. Local logs remain at `/tmp/407-cycle2.log` and
`/tmp/407-cycle2-repro.log` in the execution workspace.

`git diff --check` passes. No claim of successful current Full or audit validation.
Push the preserved correction and evidence to the existing draft branch for
review and automatic Fast tests; do not mark ready. Do not supervise CI by polling.
Required Full and reachability remain outstanding for the eventual accepted
revision. Owner coordination for manual `PickSetGo Deep validation` dispatch
(`validation: both`) belongs after correction/review blockers are resolved, using
the existing branch and exact tested SHA. The audit policy remains reserved.

Immediate owner decision: assess the stopped, unapproved correction batch and
its concrete remaining defects. No further edits, changed assertions, policy
relaxations or additional correction cycle are implied by this report.

## GF-META-A-REC1 / Stage A2 recovery and corrective evidence (14 November 2026)

This section supplements the historical R1/R2 evidence above; it does not replace
it or accept the rejected R2 runtime changes. R3 restored the pre-R2 runtime at
`5eca8a6241908e78328934fe17864b8f357b0fe1`. The recovered local Stage A/A2 work
was verified against that head and main `f36fe20e7f113f6bb084f2d351bd755c8a48887e`.
The owner separately authorised A2's initial pass and one corrective attempt.
Both are now used. Interrupted validation recovery consumed no correction.

### Initial A2 composition repair

Seed 267, 45-minute Balanced, Kettlebell/TRX/Bands, previously selected two
five-set paired blocks totalling 1,360/1,880 block seconds. Existing candidate
fitness ranked that attempt at 532, ahead of a valid one-pair/circuit alternative
at approximately 682. Simply adding a penalty would promote a five-pass tiny
interval loop. The narrow recovery therefore selects an existing validated
alternative only when the original winner has multiple repeated paired blocks
over 55% cumulative block duration. It retains duration filtering, supporting-route
selection and the existing tiny-loop protection; it adds no attempts or exercise
score changes. If no suitable alternative exists, the existing candidate remains.

The seed-267 result is a 630-second five-set pair plus a varied four-exercise
circuit (1,713 Main seconds including the transition). Seed 104 retains its
665-second five-set primary pair plus a four-exercise circuit, six distinct
exercises overall. Seed 23 still plays Jumping Jacks four times: supporting work
is 120/556 resolved planned exercise seconds. Structural, duration, variety and
supporting-work counterexamples remain tested.

### Corrective attempt: distinguish seeded context from reachability

The recovered implementation passed 77 focused tests. Its first completed Fast
run returned **1,488 passed / 3 failed**, exit 1. Two failures were baseline;
the new failure was `tests/prep-recover-expansion.test.js`, Ramp-up
`four-square-steps`, 45-minute Strength, Barbell, Normal, seed `4077198353`.
The same test passes when loading the original Generator from the baseline head.
That original failed fixture is deliberately recorded here.

Trace comparison of that exact configuration:

- Original Main attempt 1: Air squat/Glute bridge ladder, followed by two
  five-set pairs (Overhead press/Side plank hip lifts and Lateral lunge to
  balance/Low pogo hops). A2 instead selects attempt 9: a four-exercise circuit
  followed by a Tabletop toe taps/Reverse Nordic pair.
- Both versions finish Main selection at random draw 99, Warm-up at draw 108,
  eight Ramp-up attempts at draw 140, and generation at draw 151. The recovery
  consumes no additional random draws. Different Main context changes Warm-up
  and Ramp-up scoring at the same random positions.
- Original final Ramp-up: Air squat, Four-square steps, Bum kicks, Switch kicks.
  A2 final Ramp-up: Bum kicks, Walk to plank and push up, Jumping Jacks, Skater jumps.
  Both final preparation plans pass `validatePreparation`.

The same-context dense seed bank 1–128 and decorrelated bank
`imul(i,2654435761) >>> 0`, i=1–256, did not select Four-square steps in Ramp-up.
This is not evidence of global unreachability. A bounded legitimate Lower-focus
route matrix then examined difficulty Easy/Normal, equipment bodyweight/Barbell,
duration 30/45, focus Strength/Balanced, and seeds 1–16 in that order (maximum 256
contexts). Its first actual final-workout match was context 176: 45-minute
Strength, Normal, bodyweight, Lower focus, seed 16. Four-square steps has a timed
35-second prescription within its authored 20–35-second Ramp-up bounds and no
preparation validation issues.

Only that route fixture changed, with an optional body-focus argument. The test
still requires actual final selection for every flagged phase, checks prescription
type and preparation safety, and now explicitly checks Four-square steps' dose
bounds and estimated duration. An additional test preserves preparation validity
for the original Barbell configuration. No runtime, metadata, preparation safety
rule, published family policy or threshold changed in the corrective attempt.

### Completed validation and stage disposition

- Complete Stage A/Generator, expansion and warm-up coverage suites: **98 passed,
  0 failed**, exit 0 (233 seconds).
- Additional Prep & Recover, preparation metadata/repetition and knee-mobility
  suites: **38 passed, 0 failed**, exit 0 (43 seconds).
- Prescribed Fast command, after the corrective attempt:
  `node --test --test-skip-pattern='\[Full\]' tests/*.test.js`:
  **1,490 passed / 2 failed**, exit 1 (1,111 seconds). Both new preparation tests
  pass. No new Stage A2 regression remains.
- Unchanged baseline failure at `tests/difficulty.test.js:210`: bodyweight
  10-minute Hard Cardio, matrix seed index 3 (LCG seed 169), demand 3.75 vs 3.8.
- Unchanged baseline failure at `tests/strength-cardio-composer.test.js:458`:
  constrained 45-minute Full-Body Challenges v1 cannot compose the requested
  session. Both failures were reproduced using the original baseline Generator;
  they remain reserved for Stages B and C.

Workspace logs: `/tmp/407-a2-correction-focused.log`,
`/tmp/407-a2-correction-preparation.log`, `/tmp/407-a2-correction-fast.log`,
with corresponding `.exit` files. Original failure and baseline evidence remain
in `/tmp/407-a2-fast-recovery.log` and `/tmp/407-a2-baseline-comparison.log`.
The counts and failures above preserve the evidence independently of temporary logs.

Stage A's no-new-regression gate is satisfied and A2 is ready for owner acceptance
review; the complete Fast suite is not green and #407 is not complete. No Stage
B–D implementation, final Full/audit run or independent final review is claimed.
PR #408 remains draft. No merge, auto-merge, deployment or issue closure is authorised.
FAQ reviewed — no changes required. No customer-facing copy changed.
