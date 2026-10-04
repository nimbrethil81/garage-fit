const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
const G = GarageFitGenerator;
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

test('conditioning is a separate attribute and no longer a pattern', () => {
  for (const exercise of Object.values(catalogue)) {
    assert.equal(exercise.patterns.includes('conditioning'), false, exercise.id);
    assert.equal(typeof exercise.conditioning, 'boolean', exercise.id);
  }
  assert.equal(G.VALID_PATTERNS.has('conditioning'), false);
  const copy = clone(catalogue);
  copy['burpees'].patterns = ['push','conditioning'];
  assert.ok(G.validateCatalogue(copy).some(error => /burpees: invalid pattern "conditioning"/.test(error)));
  copy['burpees'].patterns = ['push'];
  copy['burpees'].conditioning = 'yes';
  assert.ok(G.validateCatalogue(copy).some(error => /burpees: conditioning must be boolean/.test(error)));
});

test('the migrated conditioning set matches the previous pattern-based set', () => {
  const expected = ['bicycle-crunch','mountain-climbers','jumping-jacks','high-knees','burpees','squat-jumps','skater-jumps',
    'dumbbell-thruster','dumbbell-clean-and-press','kettlebell-swing','kettlebell-single-arm-swing','kettlebell-clean','kettlebell-figure-eight',
    'trx-knee-tuck','trx-mountain-climber','barbell-clean','barbell-clean-and-press','step-ups','box-jumps','box-step-ups',
    'chair-step-ups','knees-up','bum-kicks','star-jumps','devils-press','dumbbell-snatch','switch-kicks','ski-abs'];
  const actual = Object.values(catalogue).filter(exercise => exercise.conditioning).map(exercise => exercise.id);
  assert.deepEqual(actual.slice().sort(), expected.slice().sort());
  assert.deepEqual(catalogue['mountain-climbers'].patterns, ['core']);
  assert.deepEqual(catalogue['kettlebell-swing'].patterns, ['hinge']);
  assert.deepEqual(catalogue['jumping-jacks'].patterns, []);
});

test('the conditioning recipe slot is filled from the conditioning attribute', () => {
  assert.deepEqual(G.selectionTags(catalogue['kettlebell-swing']), ['hinge','conditioning']);
  assert.deepEqual(G.selectionTags(catalogue['goblet-squat']), ['squat']);
  const conditioningOnly = Object.assign(clone(catalogue['high-knees']), { id:'pulse', patterns:[], conditioning:true, strength:3, cardio:2, mainRole:'primary' });
  const plainCore = Object.assign(clone(catalogue['plank']), { id:'still', patterns:['core'], conditioning:false, strength:3, cardio:2, mainProtocols:['rounds','paired_sets','timed_intervals'] });
  // Cardio recipe slot 0 is the conditioning role.
  // With a zero roll the highest-scoring candidate is taken.
  const pick = pool => G.selectBlockExercises(pool, 1, 'cardio', 'strength', 'rounds', { exercises:[], usedIds:new Set(), blocks:[], owned:[] }, [], () => 0, {})[0].id;
  assert.equal(pick([conditioningOnly, plainCore]), 'pulse');
  assert.equal(pick([Object.assign(clone(conditioningOnly), { conditioning:false }), plainCore]), 'still');
});

test('cardio remains an independent scalar from the conditioning category', () => {
  // A heavy carry raises the pulse but is not conditioning work; a bicycle crunch is
  // conditioning work at moderate cardio.
  assert.equal(catalogue['dumbbell-farmer-carry'].conditioning, false);
  assert.equal(catalogue['dumbbell-farmer-carry'].cardio, 3);
  assert.equal(catalogue['bicycle-crunch'].conditioning, true);
  assert.equal(catalogue['bicycle-crunch'].cardio, 3);
  const early = ex => G.scoreRampupCandidate(ex, 0, [], [], [catalogue['burpees']], [], 'balanced');
  const asConditioning = Object.assign(clone(catalogue['dumbbell-farmer-carry']), { conditioning:true });
  assert.ok(early(asConditioning) > early(catalogue['dumbbell-farmer-carry']));
  const higherCardio = Object.assign(clone(catalogue['knees-up']), { cardio:5 });
  const cardioScore = ex => G.scoreRampupCandidate(ex, 0, [], [], [catalogue['burpees']], [], 'cardio');
  assert.ok(cardioScore(higherCardio) > cardioScore(catalogue['knees-up']));
});

test('conditioning status alone does not count as lower-body demand', () => {
  const only = id => [catalogue[id]];
  // Floor-based, core-led conditioning.
  for (const id of ['mountain-climbers','trx-mountain-climber','bicycle-crunch','trx-knee-tuck']) {
    assert.equal(G.lowerBodyDemand(only(id), 'cardio'), 0, id);
  }
  // Genuinely leg-driven conditioning still counts.
  for (const id of ['jumping-jacks','high-knees','squat-jumps','skater-jumps','burpees','step-ups']) {
    assert.equal(G.lowerBodyDemand(only(id), 'cardio'), 1, id);
  }
  // Outside Cardio only the lower-body movement patterns count, as before.
  assert.equal(G.lowerBodyDemand(only('jumping-jacks'), 'balanced'), 0);
  assert.equal(G.lowerBodyDemand(only('goblet-squat'), 'strength'), 1);
});

test('Cardio Main still leans on conditioning exercises', () => {
  let conditioning = 0, total = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const workout = G.generate({ catalogue, duration:30, focus:'cardio', equipment:['kettlebell','box'], random:random(seed) });
    const exercises = workout.main.blocks.flatMap(block => block.exercises);
    total += exercises.length;
    conditioning += exercises.filter(ex => ex.conditioning).length;
  }
  assert.ok(conditioning / total >= .4, conditioning+'/'+total);
});
