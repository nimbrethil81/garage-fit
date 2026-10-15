const test = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('./helpers/coach-fixtures.js');

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/coach-model.js');
require('../js/generator.js');

const G = GarageFitGenerator;
const catalogue = GarageFitData.exercises;
const KIT = GarageFitData.equipment.map(item => item.id);
const DURATIONS = [10,15,20,30,45];
const FOCUSES = ['strength','balanced','cardio'];
// Bodyweight, each single item, and the full kit.
const KITS = [[]].concat(KIT.map(id => [id]), [KIT]);
const LOWER = new Set(['hips','knees','ankles']);
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
const ids = exercises => exercises.map(ex => ex.id).join(', ');
const knee = exercises => exercises.filter(G.kneeMobilityQualified);
const upperTrunk = ex => ex.warmupAreas.some(area => area==='shoulders' || area==='trunk');
const withExercises = (extra, without=[]) => Object.assign(Object.fromEntries(Object.entries(catalogue).filter(([id]) => !without.includes(id))), extra);

// Exercises introduced for the warm-up expansion. They belong to Warm-up only.
const ADDED = ['marching-on-the-spot','standing-knee-curls','shallow-knee-bends','heel-toe-rocks','ankle-circles','calf-raises',
  'side-step-touches','leg-swings-forward-back','leg-swings-side','hamstring-sweeps','shoulder-rolls','standing-side-bends',
  'band-external-rotation','trx-lateral-weight-shift'];

test('the reviewed knee-mobility qualifier is explicit, not inferred from a knees warm-up area', () => {
  assert.deepEqual(Object.values(catalogue).filter(G.kneeMobilityQualified).map(ex => ex.id), ['standing-knee-curls']);
  // Squats, lunges, jogging, jumping, marching and stepping all list the knees but load,
  // bounce or only incidentally bend them.
  for (const id of ['air-squat','shallow-knee-bends','step-back-lunge','trx-lunge-warmup','bum-kicks','jumping-jacks','high-knees',
    'knee-to-opposite-elbow','marching-on-the-spot','side-step-touches','trx-lateral-weight-shift']) {
    assert.equal(G.kneeMobilityQualified(catalogue[id]), false, id);
  }
});

test('catalogue validation keeps knee-mobility exercises gentle, low-impact, unloaded knee warm-ups', () => {
  const base = catalogue['standing-knee-curls'];
  const invalid = {
    impact: {impact:'medium'},
    equipment: {equipment:[['trx']]},
    areas: {warmupAreas:['hips']},
    pattern: {patterns:['squat']},
    fatigue: {prepFatigue:2},
    intensity: {prepIntensity:3},
    phase: {warmup:false, warmupPhase:null, warmupPrescription:null}
  };
  assert.deepEqual(G.validateCatalogue({[base.id]:base}), []);
  for (const [label, change] of Object.entries(invalid)) {
    const errors = G.validateCatalogue({[base.id]:Object.assign({}, base, change)});
    assert.ok(errors.some(error => /kneeMobility requires/.test(error)), label+': '+errors.join('; '));
  }
  assert.ok(G.validateCatalogue({[base.id]:Object.assign({}, base, {kneeMobility:'yes'})}).some(error => /kneeMobility must be boolean/.test(error)));
  assert.throws(() => GarageFitData.buildExerciseCatalogue([{id:'x', name:'X', instruction:'Do it.', prescription:{type:'timed',value:20}, knee:true}]), /unknown exercise field/);
});

test('every generated full-workout warm-up contains a qualifying knee-mobility exercise', () => {
  let checked = 0;
  for (const duration of DURATIONS) for (const focus of FOCUSES) for (const equipment of KITS) for (let seed=1;seed<=3;seed++) {
    const options = {catalogue, duration, focus, equipment, random:random(seed*7919+duration+equipment.length),
      difficulty:G.WORKOUT_DIFFICULTIES[seed%3], bodyFocus:G.WORKOUT_BODY_FOCUSES[(seed+duration)%4]};
    const workout = G.generate(options);
    const warmup = workout.warmup.exercises;
    const label = `${duration}/${focus}/${equipment.join('+')||'bodyweight'}/${seed}: ${ids(warmup)}`;
    assert.equal(knee(warmup).length, 1, label);
    assert.equal(workout.warmup.diagnostics, undefined, label);
    assert.ok(!G.validatePreparation(workout.warmup, workout.rampup, workout.main.blocks[0].exercises).includes('warmup:missing-knee-mobility'), label);
    checked++;
  }
  assert.equal(checked, DURATIONS.length*FOCUSES.length*KITS.length*3);
});

test('the knee-mobility safeguard keeps warm-up budgets, exercise counts and minimum useful time', () => {
  const counts = {10:3,15:4,20:5,30:7,45:9};
  for (const duration of DURATIONS) for (const equipment of [[],KIT]) for (let seed=1;seed<=10;seed++) {
    const workout = G.generate({catalogue, duration, focus:'balanced', equipment, random:random(seed*31+duration)});
    assert.equal(workout.warmup.exercises.length, counts[duration]);
    assert.ok(Math.abs(workout.warmup.estimatedSeconds-G.BUDGETS[duration].warmup)<=10, ids(workout.warmup.exercises));
    for (const exercise of knee(workout.warmup.exercises)) assert.ok(exercise.prescription.value>=20, ids(workout.warmup.exercises));
  }
});

test('Coach session prescriptions keep the knee-mobility warm-up', () => {
  for (const duration of [20,30,45]) for (let seed=1;seed<=6;seed++) {
    const rx = fixtures.prescription({duration, equipment:KIT, movementPriorities:[], requiredAnchors:[fixtures.anchor({allowedProtocols:['rounds']})]});
    const workout = G.generate({catalogue, sessionPrescription:rx, random:random(seed)});
    assert.equal(knee(workout.warmup.exercises).length, 1, ids(workout.warmup.exercises));
  }
});

test('a warm-up swap never removes the only knee-mobility exercise', () => {
  for (let seed=1;seed<=20;seed++) {
    const workout = G.generate({catalogue, duration:[10,20,30,45][seed%4], focus:'balanced', equipment:[], random:random(seed)});
    for (let index=0;index<workout.warmup.exercises.length;index++) {
      const before = workout.warmup.exercises[index], estimated = workout.warmup.estimatedSeconds;
      G.swapPreparation(workout, 'warmup', index, {catalogue, equipment:[], random:random(seed+index)});
      assert.equal(knee(workout.warmup.exercises).length, 1, ids(workout.warmup.exercises));
      // With a single qualifier in the catalogue its slot is kept rather than emptied of the obligation.
      if (G.kneeMobilityQualified(before)) assert.equal(workout.warmup.exercises[index].id, before.id);
      assert.equal(workout.warmup.estimatedSeconds, estimated);
    }
  }
});

test('a second qualifier can replace the knee-mobility slot in a swap', () => {
  const second = Object.assign({}, catalogue['standing-knee-curls'], {id:'test-knee-extensions', name:'Test knee extensions'});
  const extended = withExercises({[second.id]:second});
  assert.deepEqual(G.validateCatalogue(extended), []);
  let sole = 0;
  for (let seed=1;seed<=20;seed++) {
    const workout = G.generate({catalogue:extended, duration:20, focus:'balanced', equipment:[], random:random(seed)});
    if (knee(workout.warmup.exercises).length!==1) continue;
    sole++;
    const index = workout.warmup.exercises.findIndex(G.kneeMobilityQualified);
    const before = workout.warmup.exercises[index].id;
    G.swapPreparation(workout, 'warmup', index, {catalogue:extended, equipment:[], random:random(seed)});
    const after = workout.warmup.exercises[index];
    assert.ok(G.kneeMobilityQualified(after) && after.id!==before, before+' > '+after.id);
  }
  assert.ok(sole>=5, String(sole));
});

test('a pool without any qualifier yields an explicit diagnostic instead of a valid warm-up', () => {
  const constrained = withExercises({}, ['standing-knee-curls']);
  const warmup = G.selectWarmup(constrained, 115, [], [catalogue['goblet-squat']], random(3), {focus:'balanced'});
  assert.ok(warmup.exercises.length>0);
  assert.deepEqual(warmup.diagnostics, ['warmup:knee-mobility-unavailable']);
  assert.ok(G.validatePreparation(warmup, {exercises:[]}, [catalogue['goblet-squat']]).includes('warmup:missing-knee-mobility'));
  const workout = G.generate({catalogue:constrained, duration:20, focus:'balanced', equipment:[], random:random(3)});
  assert.deepEqual(workout.warmup.diagnostics, ['warmup:knee-mobility-unavailable']);
});

test('warm-ups keep shoulder or trunk preparation alongside the essential knee and lower-body work', () => {
  for (const duration of DURATIONS) for (const focus of FOCUSES) for (const equipment of [[],['bands'],['trx'],KIT]) for (let seed=1;seed<=6;seed++) {
    const warmup = G.generate({catalogue, duration, focus, equipment, random:random(seed*104729+duration)}).warmup.exercises;
    const label = `${duration}/${focus}/${equipment.join('+')||'bodyweight'}/${seed}: ${ids(warmup)}`;
    assert.ok(warmup.filter(upperTrunk).length>=G.upperTrunkTarget(warmup.length), label);
    assert.ok(warmup.some(ex => ex.warmupAreas.filter(area => LOWER.has(area)).length>=2), label);
  }
  assert.equal(G.upperTrunkTarget(3), 1);
  assert.equal(G.upperTrunkTarget(5), 1);
  assert.equal(G.upperTrunkTarget(7), 2);
});

test('close warm-up variants do not co-occur and repetition classes are discouraged together', () => {
  let warmups = 0, repeatedClass = 0;
  for (const duration of DURATIONS) for (const equipment of [[],['bands'],['trx'],KIT]) for (let seed=1;seed<=10;seed++) {
    const warmup = G.generate({catalogue, duration, focus:'balanced', equipment, random:random(seed*131+duration)}).warmup.exercises;
    warmups++;
    assert.equal(new Set(warmup.map(ex => ex.id)).size, warmup.length, ids(warmup));
    const families = warmup.map(ex => ex.family).filter(Boolean);
    assert.equal(new Set(families).size, families.length, ids(warmup));
    const classes = warmup.map(ex => ex.repetitionClass).filter(Boolean);
    if (new Set(classes).size!==classes.length) repeatedClass++;
  }
  assert.ok(repeatedClass*10<warmups, repeatedClass+' of '+warmups);
  // The arm-circle versions are one exercise in different directions.
  for (const id of ['arm-circles-forwards','arm-circles-backwards','arm-side-circles']) assert.equal(catalogue[id].family, 'arm-circles', id);
});

test('expansion exercises are warm-up only, low-impact and carry complete warm-up metadata', () => {
  for (const id of ADDED) {
    const exercise = catalogue[id];
    assert.ok(exercise, id);
    assert.equal(exercise.warmup, true, id);
    for (const flag of ['main','generator','rampup','cooldown']) assert.equal(exercise[flag], false, id+' '+flag);
    assert.equal(exercise.impact, 'low', id);
    assert.ok(exercise.prepIntensity<=2 && exercise.prepFatigue===1, id);
    assert.ok(exercise.warmupAreas.length>0 && exercise.warmupPhase, id);
    assert.equal(G.generatedPhaseEligible(exercise, 'warmup', KIT), true, id);
  }
  assert.deepEqual(catalogue['band-external-rotation'].equipment, [['bands']]);
  assert.deepEqual(catalogue['trx-lateral-weight-shift'].equipment, [['trx']]);
  // Hip circles move the hips as well as the trunk.
  assert.deepEqual(catalogue['body-hoops'].warmupAreas, ['hips','trunk']);
});
