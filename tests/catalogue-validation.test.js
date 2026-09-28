const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
const { validateCatalogue, assertValidCatalogue } = GarageFitGenerator;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

// Returns validation errors for the real catalogue with one exercise altered.
function errorsWith(id, changes) {
  const copy = clone(catalogue);
  copy[id] = Object.assign(copy[id], changes);
  return validateCatalogue(copy);
}

function assertRejected(errors, pattern) {
  assert.ok(errors.length > 0, 'expected validation to fail');
  assert.ok(errors.some(error => pattern.test(error)), errors.join('\n'));
}

test('the shipped catalogue validates cleanly without generating a workout', () => {
  assert.deepEqual(validateCatalogue(catalogue), []);
  assert.doesNotThrow(() => assertValidCatalogue(catalogue));
});

// ---- Identity ----

test('duplicate exercise ids are rejected', () => {
  const list = Object.values(clone(catalogue));
  list.push(Object.assign(clone(catalogue['air-squat']), { name:'Another air squat' }));
  assertRejected(validateCatalogue(list), /^air-squat: duplicate id$/);
});

test('duplicate ids fail loudly during catalogue authoring instead of overwriting', () => {
  const definition = { id:'plank', name:'Plank', prescription:{ type:'timed', value:30 } };
  assert.throws(() => GarageFitData.buildExerciseCatalogue([definition, Object.assign({}, definition, { name:'Plank again' })]), /Duplicate exercise id: plank/);
});

test('catalogue authoring rejects unknown fields and incomplete definitions', () => {
  const build = definition => GarageFitData.buildExerciseCatalogue([definition]);
  assert.throws(() => build({ id:'typo', name:'Typo', prescription:{ type:'timed', value:30 }, warmupAreass:['hips'] }), /typo: unknown exercise field\(s\) warmupAreass/);
  assert.throws(() => build({ id:'no-prescription', name:'No prescription' }), /missing prescription/);
  assert.throws(() => build({ id:'reps-only', name:'Reps', prescription:{ type:'reps', value:10 } }), /rep-based prescriptions need estimatedSeconds/);
  assert.throws(() => build({ id:'unscored', name:'Unscored', generator:true, main:true, prescription:{ type:'timed', value:30 } }), /must declare patterns, conditioning, strength, cardio/);
});

test('authoring derives estimates that budget every side', () => {
  const built = GarageFitData.buildExerciseCatalogue([
    { id:'one-side', name:'One side', sidedness:'per-side', prescription:{ type:'unilateral-timed', value:20 },
      patterns:['lunge'], conditioning:false, strength:2, cardio:2, warmup:true, warmupPhase:'dynamic', warmupPrescription:{ type:'unilateral-timed', value:15 },
      rampup:true, rampupPrescription:{ type:'unilateral-timed', value:20, minValue:15, maxValue:25 }, prepIntensity:2, prepFatigue:2, prepComplexity:2 }
  ])['one-side'];
  assert.equal(built.estimatedSeconds, 40);
  assert.equal(built.warmupEstimatedSeconds, 30);
  assert.equal(built.rampupEstimatedSeconds, 40);
  assert.equal(built.unilateral, true);
});

test('missing ids, mismatched keys and missing names are rejected', () => {
  const copy = clone(catalogue);
  copy['air-squat'].id = 'air-squats';
  assertRejected(validateCatalogue(copy), /does not match id/);
  assertRejected(errorsWith('air-squat', { name:'' }), /air-squat: missing name/);
  assertRejected(validateCatalogue([Object.assign(clone(catalogue.plank), { id:undefined })]), /missing or malformed id/);
});

// ---- Equipment ----

test('unknown equipment ids are rejected while AND-of-OR groups remain valid', () => {
  assertRejected(errorsWith('goblet-squat', { equipment:[['dumbells']] }), /goblet-squat: unknown equipment "dumbells"/);
  assertRejected(errorsWith('bulgarian-split-squat', { equipment:[['bench','crate']] }), /unknown equipment "crate"/);
  assertRejected(errorsWith('goblet-squat', { equipment:[[]] }), /empty or malformed equipment group/);
  assert.deepEqual(errorsWith('goblet-squat', { equipment:[['dumbbells','kettlebell'],['bench','box']] }), []);
});

// ---- Patterns / demand / impact ----

test('invalid movement patterns are rejected', () => {
  assertRejected(errorsWith('push-up', { patterns:['push','chest'] }), /push-up: invalid pattern "chest"/);
  assertRejected(errorsWith('push-up', { patterns:'push' }), /patterns must be an array/);
});

test('strength and cardio outside 1-5 are rejected', () => {
  assertRejected(errorsWith('push-up', { strength:6 }), /push-up: strength must be an integer from 1 to 5/);
  assertRejected(errorsWith('push-up', { cardio:0 }), /push-up: cardio must be an integer from 1 to 5/);
  assertRejected(errorsWith('push-up', { cardio:2.5 }), /cardio must be an integer/);
});

test('invalid impact classifications are rejected on every exercise, not only warm-ups', () => {
  assertRejected(errorsWith('barbell-deadlift', { impact:'extreme' }), /barbell-deadlift: invalid impact "extreme"/);
  assertRejected(errorsWith('toe-touch', { impact:null }), /toe-touch: invalid impact/);
});

// ---- Preparation metadata ----

test('invalid preparation enums and scales are rejected', () => {
  assertRejected(errorsWith('air-squat', { prepIntensity:7 }), /air-squat: prepIntensity must be an integer from 1 to 5/);
  assertRejected(errorsWith('air-squat', { prepFatigue:'high' }), /prepFatigue must be an integer/);
  assertRejected(errorsWith('knees-up', { prepComplexity:0 }), /prepComplexity must be an integer/);
  assertRejected(errorsWith('air-squat', { warmupAreas:['hips','elbows'] }), /air-squat: invalid warm-up areas/);
  assertRejected(errorsWith('air-squat', { warmupPhase:'early' }), /air-squat: invalid warm-up phase "early"/);
  assertRejected(errorsWith('air-squat', { warmupPhase:null }), /warm-up exercise missing warm-up phase/);
});

// ---- Phase metadata ----

test('meaningless phase combinations are rejected', () => {
  assertRejected(errorsWith('push-up', { main:false }), /push-up: generator exercises must be Main exercises/);
  assertRejected(errorsWith('toe-touch', { main:true }), /toe-touch: cool-down exercises cannot also be work or preparation exercises/);
  assertRejected(errorsWith('pull-up', { warmupPhase:'late' }), /pull-up: warm-up metadata set on a non-warm-up exercise/);
  assertRejected(errorsWith('pull-up', { rampupPrescription:{ type:'timed', value:30 } }), /ramp-up prescription set on a non-ramp-up exercise/);
  assertRejected(errorsWith('pull-up', { main:'yes' }), /main must be boolean/);
});

// ---- Prescriptions ----

test('invalid prescription types and numeric values are rejected', () => {
  assertRejected(errorsWith('push-up', { prescription:{ type:'distance', value:100 } }), /push-up: prescription has invalid type "distance"/);
  assertRejected(errorsWith('push-up', { prescription:{ type:'reps', value:0 } }), /prescription has invalid value/);
  assertRejected(errorsWith('push-up', { estimatedSeconds:-5 }), /invalid estimated seconds/);
  assertRejected(errorsWith('air-squat', { rampupPrescription:{ type:'timed', value:40, minValue:45, maxValue:50 } }), /minValue exceeds value/);
  assertRejected(errorsWith('air-squat', { warmupPrescription:{ type:'reps', value:10 } }), /warm-up prescription must be timed/);
});

test('prescriptions incompatible with sidedness are rejected', () => {
  assertRejected(errorsWith('side-plank', { prescription:{ type:'timed', value:20 } }), /side-plank: prescription does not match sidedness per-side/);
  assertRejected(errorsWith('plank', { prescription:{ type:'unilateral-timed', value:15 }, estimatedSeconds:15 }), /plank: prescription does not match sidedness none/);
  assertRejected(errorsWith('step-ups', { rampupPrescription:{ type:'timed', value:35 }, rampupEstimatedSeconds:35 }), /step-ups: ramp-up prescription does not match sidedness per-side/);
  // A per-side timed estimate must budget both sides.
  assertRejected(errorsWith('side-plank', { estimatedSeconds:20 }), /side-plank: prescription estimated seconds do not budget every side/);
  assertRejected(errorsWith('step-back-lunge', { warmupEstimatedSeconds:15 }), /warm-up prescription estimated seconds do not budget every side/);
  assertRejected(errorsWith('plank', { unilateral:true }), /unilateral flag does not match sidedness/);
});

// ---- Main protocols ----

test('invalid Main protocols are rejected', () => {
  assertRejected(errorsWith('push-up', { mainProtocols:['rounds','emom'] }), /push-up: invalid main protocol "emom"/);
  assertRejected(errorsWith('push-up', { mainProtocols:[] }), /mainProtocols must be a non-empty array/);
  assertRejected(errorsWith('side-plank', { mainProtocols:['rounds','timed_intervals'] }), /per-side exercises cannot use timed intervals/);
  assertRejected(errorsWith('toe-touch', { mainProtocols:['rounds'] }), /mainProtocols set on a non-Main exercise/);
});

// ---- Relationship metadata ----

test('malformed relationship metadata is rejected', () => {
  assertRejected(errorsWith('jumping-jacks', { repetitionClass:'Basic Conditioning' }), /invalid repetitionClass/);
  assertRejected(errorsWith('dumbbell-farmer-carry', { frequency:'rare' }), /invalid frequency "rare"/);
});

test('generation refuses a malformed catalogue', () => {
  const copy = clone(catalogue);
  copy['push-up'].patterns = ['push','chest'];
  assert.throws(() => GarageFitGenerator.generate({ catalogue:copy, duration:20, focus:'balanced', equipment:[] }), /Invalid exercise catalogue: .*push-up: invalid pattern/);
});
