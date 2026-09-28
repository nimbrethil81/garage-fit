const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
const G = GarageFitGenerator;
const allEquipment = GarageFitData.equipment.map(item => item.id);
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

// ---- Metadata semantics ----

test('family is recognised across different exercise ids', () => {
  assert.ok(G.sameFamily(catalogue['dead-hang'], catalogue['hangout-pullup-bar']));
  assert.ok(G.sameFamily(catalogue['dumbbell-farmer-carry'], catalogue['kettlebell-farmer-carry']));
  assert.ok(G.sameFamily(catalogue['reverse-lunge'], catalogue['step-back-lunge']));
  assert.ok(G.sameExerciseOrFamily(catalogue['goblet-squat'], catalogue['kettlebell-goblet-squat']));
  // Sharing a movement pattern is not enough.
  assert.equal(G.sameFamily(catalogue['air-squat'], catalogue['goblet-squat']), false);
  assert.equal(G.sameFamily(catalogue['pull-up'], catalogue['chin-up']), false);
});

test('repetitionClass stays independent of family', () => {
  const jacks = catalogue['jumping-jacks'], stars = catalogue['star-jumps'];
  assert.ok(G.sameRepetitionClass(jacks, stars));
  assert.equal(G.sameFamily(jacks, stars), false);
  const carries = [catalogue['dumbbell-farmer-carry'], catalogue['kettlebell-farmer-carry']];
  assert.ok(G.sameFamily(...carries));
  assert.equal(G.sameRepetitionClass(...carries), false);
});

test('the retired relationship fields are gone and cannot re-enter the catalogue', () => {
  for (const exercise of Object.values(catalogue)) {
    assert.equal(exercise.alternativeGroup, undefined, exercise.id);
    assert.equal(exercise.selectionFamily, undefined, exercise.id);
  }
  const copy = clone(catalogue);
  copy['glute-stretch'].alternativeGroup = 'glute-stretch';
  assert.ok(G.validateCatalogue(copy).some(error => /glute-stretch: alternativeGroup is retired/.test(error)));
  const bad = clone(catalogue);
  bad['dead-hang'].family = 'Dead Hang';
  assert.ok(G.validateCatalogue(bad).some(error => /dead-hang: invalid family/.test(error)));
  const orphan = clone(catalogue);
  orphan['push-up'].frequency = 'occasional';
  assert.ok(G.validateCatalogue(orphan).some(error => /push-up: frequency requires a family/.test(error)));
});

// ---- Preparation policy ----

test('dead hang and hangout on a pull-up bar are not selected together in Ramp-up', () => {
  // Directly: a hangout already in Warm-up steers Ramp-up away from dead hang.
  const warmup = [G.phaseExercise(catalogue['hangout-pullup-bar'], 'warmup', 20)];
  for (let seed = 1; seed <= 40; seed++) {
    const rampup = G.selectRampup(catalogue, 120, ['pullup-bar'], [catalogue['pull-up']], warmup, 'strength', random(seed));
    assert.equal(rampup.exercises.some(ex => ex.id==='dead-hang'), false, 'seed '+seed);
  }
  // And across generated workouts, neither pairing appears within Ramp-up or across phases.
  for (const focus of ['strength','balanced']) for (let seed = 1; seed <= 60; seed++) {
    const workout = G.generate({ catalogue, duration:45, focus, equipment:['pullup-bar'], random:random(seed) });
    const prep = workout.warmup.exercises.concat(workout.rampup.exercises).map(ex => ex.id);
    assert.ok(!(prep.includes('dead-hang') && prep.includes('hangout-pullup-bar')), focus+' seed '+seed+': '+prep.join(', '));
  }
});

test('a Ramp-up never pairs direct variants when alternatives exist', () => {
  for (const duration of [20,30,45]) for (const focus of ['strength','balanced','cardio']) for (let seed = 1; seed <= 20; seed++) {
    const workout = G.generate({ catalogue, duration, focus, equipment:allEquipment, random:random(seed) });
    const families = workout.rampup.exercises.map(ex => ex.family).filter(Boolean);
    assert.equal(new Set(families).size, families.length, workout.rampup.exercises.map(ex => ex.id).join(', '));
    const warmFamilies = new Set(workout.warmup.exercises.map(ex => ex.family).filter(Boolean));
    assert.equal(families.some(family => warmFamilies.has(family)), false);
  }
});

test('Warm-up never contains two members of the same family', () => {
  for (const focus of ['strength','balanced','cardio']) for (let seed = 1; seed <= 40; seed++) {
    const warmup = G.generate({ catalogue, duration:45, focus, equipment:allEquipment, random:random(seed) }).warmup.exercises;
    const families = warmup.map(ex => ex.family).filter(Boolean);
    assert.equal(new Set(families).size, families.length, warmup.map(ex => ex.id).join(', '));
  }
});

test('preparation swaps respect family like initial generation', () => {
  const workout = G.generate({ catalogue, duration:30, focus:'strength', equipment:['pullup-bar'], random:random(2) });
  workout.warmup.exercises[0] = G.phaseExercise(catalogue['hangout-pullup-bar'], 'warmup', 20);
  const ids = new Set(workout.warmup.exercises.concat(workout.rampup.exercises).map(ex => ex.id));
  for (let seed = 1; seed <= 30; seed++) {
    const copy = clone(workout);
    G.swapPreparation(copy, 'rampup', 0, { catalogue, equipment:['pullup-bar'], random:random(seed) });
    assert.notEqual(copy.rampup.exercises[0].id, 'dead-hang', 'seed '+seed);
    assert.ok(!ids.has(copy.rampup.exercises[0].id) || copy.rampup.exercises[0].id===workout.rampup.exercises[0].id);
  }
});

// ---- Main policy ----

function carryWorkout() {
  return G.normaliseWorkout({
    focus:'strength', warmup:{exercises:[],restSeconds:5}, rampup:{exercises:[],restSeconds:5}, cooldown:{exercises:[],restSeconds:5},
    main:{ blocks:[
      { id:'main-1', protocol:'rounds', intent:'strength', exercises:[catalogue['dumbbell-farmer-carry'], catalogue['goblet-squat'], catalogue['push-up']].map(clone), prescription:{rounds:3,exerciseRestSeconds:20,roundRestSeconds:60} },
      { id:'main-2', protocol:'rounds', intent:'accessory', exercises:[catalogue['plank'], catalogue['kettlebell-deadlift'], catalogue['pull-up']].map(clone), prescription:{rounds:3,exerciseRestSeconds:20,roundRestSeconds:60} }
    ] }
  });
}

test('a Main swap cannot add a second farmer carry the generator would have refused', () => {
  const owned = ['dumbbells','kettlebell','pullup-bar'];
  // Offer the kettlebell carry as the obvious like-for-like replacement for a plank.
  const pool = { plank:catalogue.plank, 'kettlebell-farmer-carry':catalogue['kettlebell-farmer-carry'], 'dead-hang':catalogue['dead-hang'] };
  for (const id of ['dumbbell-farmer-carry','goblet-squat','push-up','kettlebell-deadlift','pull-up']) pool[id] = catalogue[id];
  for (let seed = 1; seed <= 40; seed++) {
    const workout = G.swap(carryWorkout(), 1, 0, { catalogue:pool, equipment:owned, random:random(seed) });
    const carries = workout.main.blocks.flatMap(block => block.exercises).filter(ex => ex.family==='farmer-carry');
    assert.equal(carries.length, 1, 'seed '+seed+': '+workout.main.blocks.map(b => b.exercises.map(e => e.id).join(',')).join(' | '));
  }
  // Swapping the existing carry itself may still choose the other carry variant.
  let variantSeen = false;
  for (let seed = 1; seed <= 40 && !variantSeen; seed++) {
    const workout = G.swap(carryWorkout(), 0, 0, { catalogue:pool, equipment:owned, random:random(seed) });
    variantSeen = workout.main.blocks[0].exercises[0].id==='kettlebell-farmer-carry';
  }
  assert.ok(variantSeen);
});

test('generated Main uses at most one member of an occasional family', () => {
  for (const focus of ['strength','balanced']) for (let seed = 1; seed <= 60; seed++) {
    const workout = G.generate({ catalogue, duration:45, focus, equipment:['dumbbells','kettlebell'], random:random(seed) });
    const carries = workout.main.blocks.flatMap(block => block.exercises).filter(ex => ex.family==='farmer-carry');
    assert.ok(carries.length <= 1, focus+' seed '+seed);
  }
});

test('recent use of a direct variant counts towards recency penalties', () => {
  const penalty = G.recentUsePenalty(catalogue['kettlebell-clean-and-press'], [['dumbbell-clean-and-press']], catalogue);
  assert.ok(penalty > 0);
});

// ---- Cool-down and fixed routines ----

test('generated Cool-down never pairs a stretch with its TRX variant', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const cooldown = G.generate({ catalogue, duration:45, focus:'balanced', equipment:['trx'], random:random(seed) }).cooldown.exercises;
    const families = cooldown.map(ex => ex.family).filter(Boolean);
    assert.equal(new Set(families).size, families.length, cooldown.map(ex => ex.id).join(', '));
  }
});
