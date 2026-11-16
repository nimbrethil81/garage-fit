# Full-Body Challenges v2 — representative prescriptions (#398)

Run `node scripts/export-full-body-challenge-examples.js` from the repository root to reproduce these developer examples from base `c5ac48f` plus this change. All use the Mulberry32 seed stated below and the canonical catalogue; the fifteen format examples constrain the existing composer through its developer-only excluded-style seam. The app still selects formats automatically. No special exercise table, settings, scoring or stored rounds are introduced.

Rep times are catalogue estimates, not measured effort. Per-side targets apply to both sides; estimates already include both. Work, scheduled recovery, setup and reserved clocks remain separate. Easy/Normal/Hard describe prescription differences, not a physiological guarantee. These are offline programming examples; no practical exercise trial or independent human safety certification is claimed.

Ladder examples use a longer feasible budget on Easy/Normal. AMRAP uses complementary standing work plus a separate floor sequence to retain core work; its constrained catalogue cannot supply every duration/equipment profile. Other v2 styles provide the shared fallback.

## Calibration checks

- REG1: reconstructed 15-minute Normal v1 Density snapshot, 585 s Main (360 + 222 s caps + 3 s transition), 210 s scheduled recovery, 80 prescribed reps. It fails v2 for insufficient prescribed work independently of the unsupported style. The two caps are a deterministic reconstruction from the issue totals, not a recovered original diagnostic export.
- REG2: playable v2 Rounds, four movements, 585 s Main: two rounds of TRX chest press, TRX squat, bicycle crunch and push-up, 45 s exercise rest / 85 s round rest. It fails for insufficient work, redundant pressing and inappropriate challenge recovery.
- Positive Easy: two rounds of wall push-up, squat-to-alternating-knee-drive and plank arm reaches, 30 s between exercises / 70 s between rounds. The planned 220 s work and 190 s recovery passes Easy, fails Normal. Four exercise names or any one rest fraction is not intrinsically wrong.

## Samples

### Reported equipment profile — automatic selection

15 min normal; emom, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell. Actual automatic selection.
Session estimate 833 s; Main 543 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Side-lying open books — 10 s each side; Standing hinge and reach — 20 s; Wall push-up plus — 25 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; High Knees Running in Place — 35 s.
- **Main 1:** 4 one-minute slots; rotate the exercises below; finish the target then recover to the boundary. Alternating hooks — 35 s; Squat pulses — 30 s; Mountain climbers — 30 s.
  Targets across minute slots: 130 s estimated; scheduled recovery 0 s; reserved clock 240 s.
- **Main 2:** 5 one-minute slots; rotate the exercises below; finish the target then recover to the boundary. Suspension strap row — 10 reps; High-knee power steps — 35 s; Bicycle crunch — 20 reps.
  Targets across minute slots: 160 s estimated; scheduled recovery 0 s; reserved clock 300 s.
- **Cool-down (110 s including recovery):** Cross-body shoulder stretch — 15 s each side; Triceps stretch — 15 s each side; Extended Puppy pose — 20 s; Downward dog to upward dog — 15 s.

### Easy bodyweight — automatic selection

15 min easy; rounds, family v2; seed 1. Equipment: bodyweight. Actual automatic selection.
Session estimate 840 s; Main 540 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Quadruped thoracic rotation — 10 s each side; Wrist circles — 25 s; Standing knee curls — 20 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; High Knees Running in Place — 35 s.
- **Main 1:** 2 rounds; 30 s between exercises, 70 s between rounds. Alternating straight punches — 40 s; Curtsy lunge — 12 reps; Kick-through — 30 s; Prone swimmer raise — 8 reps.
  Prescribed work: 290 s estimated; scheduled recovery 250 s; block estimate 540 s (including any setup).
- **Cool-down (120 s including recovery):** Wide-stance toe-touch stretch — 15 s each side; Triceps stretch — 15 s each side; Runner's stretch — 15 s each side; Chest opener — 15 s.

### rounds — easy

15 min easy; rounds, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 875 s; Main 585 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Bent-knee fallout — 15 s each side; Standing forearm rotations — 20 s; Heel-to-toe rocks — 15 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Switch kicks — 35 s.
- **Main 1:** 2 rounds; 25 s between exercises, 55 s between rounds. Band row — 12 reps; Low-impact speed skaters — 40 s; Abdominal crunch — 30 s; Alternating straight punches — 40 s; Air squat — 10 reps.
  Prescribed work: 330 s estimated; scheduled recovery 255 s; block estimate 585 s (including any setup).
- **Cool-down (110 s including recovery):** Extended Puppy pose — 20 s; Glute stretch — 15 s each side; Supine hamstring stretch — 25 s each side.

### rounds — normal

15 min normal; rounds, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 875 s; Main 585 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Bent-knee fallout — 15 s each side; Standing forearm rotations — 20 s; Heel-to-toe rocks — 15 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Switch kicks — 35 s.
- **Main 1:** 3 rounds; 20 s between exercises, 45 s between rounds. Dumbbell push press — 10 reps; Dumbbell reverse lunge — 8 reps each side; Dumbbell suitcase carry — 25 s each side.
  Prescribed work: 375 s estimated; scheduled recovery 210 s; block estimate 585 s (including any setup).
- **Cool-down (110 s including recovery):** Extended Puppy pose — 20 s; Glute stretch — 15 s each side; Supine hamstring stretch — 25 s each side.

### rounds — hard

15 min hard; rounds, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 875 s; Main 585 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Bent-knee fallout — 15 s each side; Standing forearm rotations — 20 s; Heel-to-toe rocks — 15 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Switch kicks — 35 s.
- **Main 1:** 4 rounds; 10 s between exercises, 35 s between rounds. Dumbbell push press — 10 reps; Kettlebell dead-stop swing — 10 reps; Ski abs — 30 s.
  Prescribed work: 400 s estimated; scheduled recovery 185 s; block estimate 585 s (including any setup).
- **Cool-down (110 s including recovery):** Extended Puppy pose — 20 s; Glute stretch — 15 s each side; Supine hamstring stretch — 25 s each side.

### emom — easy

15 min easy; emom, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 833 s; Main 543 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Wrist circles — 25 s; Quadruped wrist rocks — 20 s; Bum kicks — 20 s.
- **Ramp-up (80 s including recovery):** Jumping jacks — 45 s; Suspension strap row — 30 s.
- **Main 1:** 4 one-minute slots; rotate the exercises below; finish the target then recover to the boundary. Suspension strap row — 10 reps; Suspension strap reverse lunge — 30 s; Suspension strap mountain climber — 30 s.
  Targets across minute slots: 120 s estimated; scheduled recovery 0 s; reserved clock 240 s.
- **Main 2:** 5 one-minute slots; rotate the exercises below; finish the target then recover to the boundary. Suspension strap chest press — 10 reps; Squat to alternating knee drive — 30 s; Bicycle crunch — 20 reps.
  Targets across minute slots: 150 s estimated; scheduled recovery 0 s; reserved clock 300 s.
- **Cool-down (110 s including recovery):** Cross-body shoulder stretch — 15 s each side; Triceps stretch — 15 s each side; Extended Puppy pose — 20 s; Downward dog to upward dog — 15 s.

### emom — normal

15 min normal; emom, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 833 s; Main 543 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Wall ankle dorsiflexion rocks — 15 s each side; Seated thoracic extension — 15 s; Standing scapular protraction and retraction — 20 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; High Knees Running in Place — 35 s.
- **Main 1:** 4 one-minute slots; rotate the exercises below; finish the target then recover to the boundary. Alternating hooks — 35 s; Squat pulses — 30 s; Mountain climbers — 30 s.
  Targets across minute slots: 130 s estimated; scheduled recovery 0 s; reserved clock 240 s.
- **Main 2:** 5 one-minute slots; rotate the exercises below; finish the target then recover to the boundary. Suspension strap row — 10 reps; High-knee power steps — 35 s; Bicycle crunch — 20 reps.
  Targets across minute slots: 160 s estimated; scheduled recovery 0 s; reserved clock 300 s.
- **Cool-down (110 s including recovery):** Cross-body shoulder stretch — 15 s each side; Triceps stretch — 15 s each side; Extended Puppy pose — 20 s; Downward dog to upward dog — 15 s.

### emom — hard

15 min hard; emom, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 833 s; Main 543 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Seated thoracic extension — 20 s; Standing hinge and reach — 20 s; Wall push-up plus — 25 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; High Knees Running in Place — 35 s.
- **Main 1:** 4 one-minute slots; rotate the exercises below; finish the target then recover to the boundary. Suspension strap chest press — 10 reps; Fast feet — 30 s; Suspension strap knee tuck — 10 reps.
  Targets across minute slots: 120 s estimated; scheduled recovery 0 s; reserved clock 240 s.
- **Main 2:** 5 one-minute slots; rotate the exercises below; finish the target then recover to the boundary. Suspension strap row — 10 reps; High-knee power steps — 40 s; Bicycle crunch — 20 reps.
  Targets across minute slots: 170 s estimated; scheduled recovery 0 s; reserved clock 300 s.
- **Cool-down (110 s including recovery):** Cross-body shoulder stretch — 15 s each side; Triceps stretch — 15 s each side; Extended Puppy pose — 20 s; Downward dog to upward dog — 15 s.

### ladder — easy

45 min easy; ladder, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 2586 s; Main 1911 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (225 s including recovery):** Supine heel slides — 20 s; Standing forearm rotations — 20 s; Heel-to-toe rocks — 15 s; Standing torso twists — 20 s; Arm circles backwards — 20 s; Standing cross-body reaches — 25 s; Standing knee curls — 20 s; Four-square steps — 25 s; Bum kicks — 20 s.
- **Ramp-up (160 s including recovery):** Jumping jacks — 45 s; Air squat — 40 s; Ring scapular row — 25 s; High Knees Running in Place — 35 s.
- **Main 1:** 4 → 6 → 8 reps of each exercise; 20 s between exercises, 50 s between steps. Ring row — rep steps above; Suspension strap squat — rep steps above.
  Prescribed work: 99 s estimated; scheduled recovery 160 s; block estimate 259 s (including any setup).
- **Main 2:** 4 → 6 → 8 reps of each exercise; 20 s between exercises, 50 s between steps. Seated knee tucks — rep steps above; Band triceps extension — rep steps above.
  Prescribed work: 99 s estimated; scheduled recovery 160 s; block estimate 259 s (including any setup).
- **Main 3:** 4 → 6 → 8 reps of each exercise; 20 s between exercises, 55 s between steps. Glute bridge — rep steps above; Dead bug — rep steps above.
  Prescribed work: 106 s estimated; scheduled recovery 170 s; block estimate 276 s (including any setup).
- **Main 4:** 2 → 4 → 6 → 8 reps of each exercise; 10 s between exercises, 45 s between steps. Dumbbell lateral raise — rep steps above; Curtsy lunge — rep steps above.
  Prescribed work: 120 s estimated; scheduled recovery 175 s; block estimate 295 s (including any setup).
- **Main 5:** 4 → 6 → 8 reps of each exercise; 20 s between exercises, 60 s between steps. Bird dog — rep steps above; Suspension strap high row — rep steps above.
  Prescribed work: 115 s estimated; scheduled recovery 180 s; block estimate 295 s (including any setup).
- **Main 6:** 4 → 6 → 8 reps of each exercise; 20 s between exercises, 50 s between steps. Band Romanian deadlift — rep steps above; Suspension strap knee tuck — rep steps above.
  Prescribed work: 99 s estimated; scheduled recovery 160 s; block estimate 259 s (including any setup).
- **Main 7:** 8 → 6 → 4 reps of each exercise; 15 s between exercises, 55 s between steps. Suspension strap row — rep steps above; Walking lunge — rep steps above.
  Prescribed work: 95 s estimated; scheduled recovery 155 s; block estimate 250 s (including any setup).
- **Cool-down (290 s including recovery):** Pigeon stretch — 15 s each side; Supine hamstring stretch — 25 s each side; Butterfly stretch — 25 s; Low Cobra pose — 15 s; Standing lat stretch — 25 s; Full body stretch — 15 s; Glute stretch — 15 s each side; Suspension strap side stretch — 15 s each side; Suspension strap lunge, calf and chest opener — 15 s each side.

### ladder — normal

45 min normal; ladder, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 2653 s; Main 1963 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (225 s including recovery):** Supine heel slides — 20 s; Standing wall slides — 15 s; Arm circles backwards — 15 s; Ankle circles — 15 s each side; Standing cross-body reaches — 20 s; Side-lying open books — 10 s each side; Bent-knee fallout — 15 s each side; Forward-back aerobic steps — 15 s; Forward and back leg swings — 10 s each side.
- **Ramp-up (160 s including recovery):** Bum kicks — 40 s; Jumping jacks — 45 s; Suspension strap row — 30 s; Skater jumps — 30 s.
- **Main 1:** 9 → 6 → 3 reps of each exercise; 15 s between exercises, 35 s between steps. Suspension strap high row — rep steps above; Banded lateral walk — rep steps above.
  Prescribed work: 108 s estimated; scheduled recovery 115 s; block estimate 223 s (including any setup).
- **Main 2:** 9 → 6 → 3 reps of each exercise; 15 s between exercises, 35 s between steps. Suspension strap knee tuck — rep steps above; Suspension strap triceps press — rep steps above.
  Prescribed work: 108 s estimated; scheduled recovery 115 s; block estimate 223 s (including any setup).
- **Main 3:** 3 → 6 → 9 reps of each exercise; 15 s between exercises, 30 s between steps. Banded squat — rep steps above; Seated knee tucks — rep steps above.
  Prescribed work: 100 s estimated; scheduled recovery 105 s; block estimate 205 s (including any setup).
- **Main 4:** 4 → 6 → 8 → 10 reps of each exercise; 15 s between exercises, 35 s between steps. Alternating dumbbell front raise — rep steps above; Band Romanian deadlift — rep steps above.
  Prescribed work: 154 s estimated; scheduled recovery 165 s; block estimate 319 s (including any setup).
- **Main 5:** 10 → 8 → 6 → 4 reps of each exercise; 15 s between exercises, 30 s between steps. Plank arm reaches — rep steps above; Band row — rep steps above.
  Prescribed work: 182 s estimated; scheduled recovery 150 s; block estimate 332 s (including any setup).
- **Main 6:** 4 → 6 → 8 → 10 reps of each exercise; 10 s between exercises, 40 s between steps. Walking lunge — rep steps above; Lying leg raise — rep steps above.
  Prescribed work: 148 s estimated; scheduled recovery 160 s; block estimate 308 s (including any setup).
- **Main 7:** 2 → 4 → 6 → 8 → 10 reps of each exercise; 10 s between exercises, 30 s between steps. Push-up — rep steps above; Curtsy lunge — rep steps above.
  Prescribed work: 165 s estimated; scheduled recovery 170 s; block estimate 335 s (including any setup).
- **Cool-down (305 s including recovery):** Wide-stance toe-touch stretch — 15 s each side; Standing calf stretch — 25 s each side; Standing lat stretch — 25 s; Inner thigh stretch — 15 s each side; Lying torso twist — 15 s each side; Plank calf stretch — 15 s; Hip flexor stretch — 15 s each side; Extended Puppy pose — 20 s; Frog stretch — 15 s; Suspension strap back stretch — 15 s.

### ladder — hard

15 min hard; ladder, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 866 s; Main 576 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Quadruped thoracic rotation — 10 s each side; Heel-to-toe rocks — 20 s; Wall push-up plus — 25 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Squat jumps — 35 s.
- **Main 1:** 4 → 8 → 12 reps of each exercise; 15 s between exercises, 25 s between steps. Band chest press — rep steps above; Banded squat — rep steps above.
  Prescribed work: 120 s estimated; scheduled recovery 95 s; block estimate 215 s (including any setup).
- **Main 2:** 6 → 8 → 10 → 12 reps of each exercise; 10 s between exercises, 40 s between steps. Bridge march — rep steps above; Band row — rep steps above.
  Prescribed work: 198 s estimated; scheduled recovery 160 s; block estimate 358 s (including any setup).
- **Cool-down (110 s including recovery):** Extended Puppy pose — 20 s; Glute stretch — 15 s each side; Supine hamstring stretch — 25 s each side.

### amrap — easy

15 min easy; amrap, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 848 s; Main 543 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Seated knee extensions — 25 s; Supine heel slides — 20 s; Quadruped thoracic rotation — 10 s each side; Side-lying open books — 10 s each side.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Band pull-apart — 35 s.
- **Main 1:** 4 min cap; repeat quality rounds in order and recover as needed; no scheduled rest or round/rep score. Band row — 5 reps; Banded squat — 5 reps.
  One planned pass: 26 s estimated; scheduled recovery 0 s; reserved clock 240 s.
- **Main 2:** 5 min cap; repeat quality rounds in order and recover as needed; no scheduled rest or round/rep score. Bicycle crunch — 5 reps; Push-up — 5 reps.
  One planned pass: 21 s estimated; scheduled recovery 0 s; reserved clock 300 s.
- **Cool-down (125 s including recovery):** Plank calf stretch — 15 s; Triceps stretch — 15 s each side; Downward dog to upward dog — 15 s; Standing toe-touch stretch — 15 s; Suspension strap lunge, calf and chest opener — 15 s each side.

### amrap — normal

15 min normal; amrap, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 848 s; Main 543 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Seated knee extensions — 25 s; Supine heel slides — 20 s; Quadruped thoracic rotation — 10 s each side; Side-lying open books — 10 s each side.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Suspension strap squat with overhead reach — 35 s.
- **Main 1:** 4 min cap; repeat quality rounds in order and recover as needed; no scheduled rest or round/rep score. Suspension strap chest press — 6 reps; Suspension strap squat — 6 reps.
  One planned pass: 33 s estimated; scheduled recovery 0 s; reserved clock 240 s.
- **Main 2:** 5 min cap; repeat quality rounds in order and recover as needed; no scheduled rest or round/rep score. Bicycle crunch — 6 reps; Push-up — 6 reps.
  One planned pass: 24 s estimated; scheduled recovery 0 s; reserved clock 300 s.
- **Cool-down (125 s including recovery):** Plank calf stretch — 15 s; Triceps stretch — 15 s each side; Downward dog to upward dog — 15 s; Standing toe-touch stretch — 15 s; Suspension strap lunge, calf and chest opener — 15 s each side.

### amrap — hard

15 min hard; amrap, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 848 s; Main 543 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Seated knee extensions — 25 s; Supine heel slides — 20 s; Quadruped thoracic rotation — 10 s each side; Side-lying open books — 10 s each side.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Suspension strap squat with overhead reach — 35 s.
- **Main 1:** 4 min cap; repeat quality rounds in order and recover as needed; no scheduled rest or round/rep score. Suspension strap chest press — 8 reps; Suspension strap squat — 8 reps.
  One planned pass: 44 s estimated; scheduled recovery 0 s; reserved clock 240 s.
- **Main 2:** 5 min cap; repeat quality rounds in order and recover as needed; no scheduled rest or round/rep score. Bicycle crunch — 8 reps; Push-up — 8 reps.
  One planned pass: 32 s estimated; scheduled recovery 0 s; reserved clock 300 s.
- **Cool-down (125 s including recovery):** Plank calf stretch — 15 s; Triceps stretch — 15 s each side; Downward dog to upward dog — 15 s; Standing toe-touch stretch — 15 s; Suspension strap lunge, calf and chest opener — 15 s each side.

### intervals — easy

15 min easy; intervals, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 870 s; Main 580 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Bent-knee fallout — 15 s each side; Standing thoracic rotation with reach — 20 s; Heel-to-toe rocks — 15 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Switch kicks — 35 s.
- **Main 1:** 5 cycles; 20 s work / 20 s recovery/changeover. Alternating straight punches — 20 s; Air squat — 20 s; Mountain climbers — 20 s.
  Prescribed work: 300 s timed; scheduled recovery 280 s; block estimate 580 s (including any setup).
- **Cool-down (110 s including recovery):** Extended Puppy pose — 20 s; Glute stretch — 15 s each side; Supine hamstring stretch — 25 s each side.

### intervals — normal

15 min normal; intervals, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 875 s; Main 585 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Bent-knee fallout — 15 s each side; Standing forearm rotations — 20 s; Heel-to-toe rocks — 15 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Switch kicks — 35 s.
- **Main 1:** 5 cycles; 25 s work / 15 s recovery/changeover. Alternating hooks — 25 s; Walking lunge — 25 s; Mountain climbers — 25 s.
  Prescribed work: 375 s timed; scheduled recovery 210 s; block estimate 585 s (including any setup).
- **Cool-down (110 s including recovery):** Extended Puppy pose — 20 s; Glute stretch — 15 s each side; Supine hamstring stretch — 25 s each side.

### intervals — hard

15 min hard; intervals, family v2; seed 7. Equipment: dumbbells, kettlebell, trx, rings, barbell, bands. Format isolated for inspection.
Session estimate 870 s; Main 580 s. Ready/phase-boundary overhead follows the existing player contract.

- **Warm-up (100 s including recovery):** Supine heel slides — 20 s; Bent-knee fallout — 15 s each side; Standing forearm rotations — 20 s; Heel-to-toe rocks — 15 s.
- **Ramp-up (80 s including recovery):** Bum kicks — 40 s; Switch kicks — 35 s.
- **Main 1:** 4 cycles; 30 s work / 20 s recovery/changeover. Alternating hooks — 30 s; Walking lunge — 30 s; Ski abs — 30 s.
  Prescribed work: 360 s timed; scheduled recovery 220 s; block estimate 580 s (including any setup).
- **Cool-down (110 s including recovery):** Extended Puppy pose — 20 s; Glute stretch — 15 s each side; Supine hamstring stretch — 25 s each side.
