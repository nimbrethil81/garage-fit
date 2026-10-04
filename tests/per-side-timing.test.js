const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAppContext } = require('./helpers/app-context.js');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
const allEquipment = GarageFitData.equipment.map(item => item.id);
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
const app = loadAppContext();

function playbackSeconds(exercise, section) {
  return app.makeGeneratedExercisePhases(exercise, section, null, 0).reduce((sum, phase) => sum + phase.seconds, 0);
}

// ---- Locked sidedness semantics ----

test('bilateral and side-less timed prescriptions state the total duration', () => {
  const plank = GarageFitGenerator.phaseExercise(catalogue.plank, 'rampup', 30);
  assert.equal(plank.sidedness, 'none');
  assert.equal(plank.estimatedSeconds, 30);
  assert.equal(app.formatPrescription(plank), '30 sec');
  assert.equal(app.makeGeneratedExercisePhases(plank, 'rampup', null, 0).length, 1);
  assert.equal(playbackSeconds(plank, 'rampup'), 30);

  const squat = GarageFitGenerator.phaseExercise(catalogue['air-squat'], 'warmup', 20);
  assert.equal(squat.sidedness, 'bilateral');
  assert.equal(squat.estimatedSeconds, 20);
  assert.equal(playbackSeconds(squat, 'warmup'), 20);
});

test('alternating timed prescriptions state the total interval and play as one phase', () => {
  const climbers = GarageFitGenerator.phaseExercise(catalogue['mountain-climbers'], 'rampup', 30);
  assert.equal(climbers.sidedness, 'alternating');
  assert.equal(climbers.estimatedSeconds, 30);
  assert.equal(app.formatPrescription(climbers), '30 sec');
  const phases = app.makeGeneratedExercisePhases(climbers, 'rampup', null, 0);
  assert.equal(phases.length, 1);
  assert.equal(phases[0].side, null);
  assert.equal(phases[0].seconds, 30);
});

test('per-side timed prescriptions apply to each side and budget both sides', () => {
  const stepUps = GarageFitGenerator.phaseExercise(catalogue['step-ups'], 'rampup', 20);
  assert.equal(stepUps.sidedness, 'per-side');
  assert.equal(stepUps.prescription.value, 20);
  assert.equal(stepUps.estimatedSeconds, 40);
  assert.equal(app.formatPrescription(stepUps), '20 sec each side');
  const phases = app.makeGeneratedExercisePhases(stepUps, 'rampup', null, 0);
  assert.deepEqual(phases.map(phase => [phase.side, phase.seconds]), [['right',20],['left',20]]);
  assert.equal(playbackSeconds(stepUps, 'rampup'), stepUps.estimatedSeconds);
});

test('preview wording is driven by sidedness even if a prescription type omits it', () => {
  const exercise = Object.assign({}, catalogue['side-plank'], { prescription:{ type:'timed', value:30 } });
  assert.equal(app.formatPrescription(exercise), '30 sec each side');
});

// ---- Known regressions from the metadata review ----

test('Step-ups in Ramp-up: displayed, estimated and played durations agree', () => {
  const stepUps = catalogue['step-ups'];
  assert.equal(stepUps.rampupPrescription.type, 'unilateral-timed');
  assert.equal(stepUps.rampupEstimatedSeconds, stepUps.rampupPrescription.value * 2);
  const fitted = GarageFitGenerator.fitTimedDurations([stepUps], 40, 5, 'rampup');
  const exercise = fitted.exercises[0];
  assert.equal(fitted.estimatedSeconds, exercise.estimatedSeconds);
  assert.equal(exercise.estimatedSeconds, exercise.prescription.value * 2);
  assert.equal(playbackSeconds(exercise, 'rampup'), exercise.estimatedSeconds);
  assert.equal(app.formatPrescription(exercise), exercise.prescription.value + ' sec each side');
});

test('Step back lunge in Warm-up: displayed, estimated and played durations agree', () => {
  const lunge = catalogue['step-back-lunge'];
  const fitted = GarageFitGenerator.fitTimedDurations([lunge, catalogue['air-squat']], 60, 5, 'warmup');
  const exercise = fitted.exercises[0];
  assert.equal(exercise.id, 'step-back-lunge');
  assert.equal(exercise.estimatedSeconds, exercise.prescription.value * 2);
  assert.equal(playbackSeconds(exercise, 'warmup'), exercise.estimatedSeconds);
  assert.equal(app.formatPrescription(exercise), exercise.prescription.value + ' sec each side');
  assert.equal(fitted.estimatedSeconds, fitted.exercises.reduce((sum, ex) => sum + ex.estimatedSeconds, 0) + 5);
});

// ---- Fitting budgets both sides ----

test('Warm-up fitting counts each side of per-side work against the budget', () => {
  const lunge = catalogue['step-back-lunge'];
  const squat = catalogue['air-squat'];
  const fitted = GarageFitGenerator.fitTimedDurations([lunge, squat], 55, 5, 'warmup');
  // 55 - 5 rest = 50 of work: step back lunge 15 each side (30) + air squat 20.
  assert.equal(fitted.estimatedSeconds, 55);
  assert.deepEqual(fitted.exercises.map(ex => [ex.id, ex.prescription.value, ex.estimatedSeconds]), [['step-back-lunge',15,30],['air-squat',20,20]]);
});

test('Ramp-up fitting counts each side of per-side work against the budget', () => {
  const fitted = GarageFitGenerator.fitTimedDurations([catalogue['step-ups'], catalogue['jumping-jacks']], 85, 5, 'rampup');
  const stepUps = fitted.exercises[0];
  assert.equal(stepUps.estimatedSeconds, stepUps.prescription.value * 2);
  assert.equal(fitted.estimatedSeconds, fitted.exercises.reduce((sum, ex) => sum + ex.estimatedSeconds, 0) + 5);
  assert.ok(Math.abs(fitted.estimatedSeconds - 85) <= 5, String(fitted.estimatedSeconds));
});

test('generated preparation phases keep estimate, prescription and playback in agreement', () => {
  let perSideSeen = 0;
  for (const duration of [10,15,20,30,45]) for (const focus of ['strength','balanced','cardio']) for (let seed = 1; seed <= 12; seed++) {
    const workout = GarageFitGenerator.generate({ catalogue, duration, focus, equipment:allEquipment, random:random(seed) });
    for (const section of ['warmup','rampup']) {
      for (const exercise of workout[section].exercises) {
        assert.equal(exercise.estimatedSeconds, exercise.prescription.value * GarageFitGenerator.sideCount(exercise), exercise.id);
        assert.equal(playbackSeconds(exercise, section), exercise.estimatedSeconds, exercise.id);
        if (exercise.sidedness==='per-side') perSideSeen++;
      }
      const list = workout[section].exercises;
      assert.equal(workout[section].estimatedSeconds, list.reduce((sum, ex) => sum + ex.estimatedSeconds, 0) + workout[section].restSeconds * Math.max(0, list.length-1));
    }
  }
  assert.ok(perSideSeen > 0, 'expected per-side preparation exercises to be generated');
});

test('swapping into a per-side preparation exercise keeps the slot total and splits it by side', () => {
  // The swap target must not already be in the warm-up, so use the first seed without it.
  let workout;
  for (let seed = 3; !workout || workout.warmup.exercises.some(ex => ex.id==='step-back-lunge'); seed++)
    workout = GarageFitGenerator.generate({ catalogue, duration:30, focus:'balanced', equipment:allEquipment, random:random(seed) });
  const slot = workout.warmup.exercises.findIndex(ex => ex.sidedness!=='per-side' && ex.estimatedSeconds % 10 === 0);
  assert.ok(slot >= 0);
  const before = workout.warmup.estimatedSeconds, total = workout.warmup.exercises[slot].estimatedSeconds;
  const onlyLunge = Object.fromEntries(Object.entries(catalogue).filter(([id, ex]) => !ex.warmup || id==='step-back-lunge' || workout.warmup.exercises.some(item => item.id===id)));
  GarageFitGenerator.swapPreparation(workout, 'warmup', slot, { catalogue:onlyLunge, equipment:allEquipment, random:random(5) });
  const replacement = workout.warmup.exercises[slot];
  assert.equal(replacement.id, 'step-back-lunge');
  assert.equal(replacement.prescription.value, total / 2);
  assert.equal(replacement.estimatedSeconds, total);
  assert.equal(workout.warmup.estimatedSeconds, before);
});
