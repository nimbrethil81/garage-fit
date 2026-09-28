const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
const { scoreRampupCandidate } = GarageFitGenerator;

// The pre-hardening generic defaults that prep exercises used to inherit silently.
function withGenericDefaults(exercise) {
  return Object.assign({}, exercise, { strength:1, cardio:1, patterns:[] });
}

test('preparation exercises must declare strength, cardio, patterns and conditioning when authored', () => {
  assert.throws(() => GarageFitData.buildExerciseCatalogue([
    { id:'mystery-prep', name:'Mystery prep', prescription:{ type:'timed', value:20 }, warmup:true, warmupPhase:'basic', warmupPrescription:{ type:'timed', value:20 }, warmupAreas:['hips'] }
  ]), /mystery-prep: generator and preparation exercises must declare patterns, conditioning, strength, cardio/);
});

test('reviewed prep exercises carry explicit scored metadata', () => {
  const expected = {
    'knees-up':{ strength:1, cardio:3, patterns:['conditioning'] },
    'bum-kicks':{ strength:1, cardio:3, patterns:['conditioning'] },
    'star-jumps':{ strength:1, cardio:5, patterns:['conditioning'] },
    'walk-plank-push-up':{ strength:2, cardio:2, patterns:['push','core'] },
    'step-back-lunge':{ strength:2, cardio:2, patterns:['lunge'] },
    'trx-squat-overhead':{ strength:2, cardio:2, patterns:['squat','push'] },
    'trx-lunge-warmup':{ strength:2, cardio:2, patterns:['lunge'] },
    'hangout-pullup-bar':{ strength:2, cardio:1, patterns:['pull'] }
  };
  for (const [id, values] of Object.entries(expected)) {
    const exercise = catalogue[id];
    assert.equal(exercise.strength, values.strength, id);
    assert.equal(exercise.cardio, values.cardio, id);
    assert.deepEqual([...exercise.patterns].filter(pattern => pattern!=='conditioning'), values.patterns.filter(pattern => pattern!=='conditioning'), id);
  }
});

test('walk to plank and push up now prepares for push-led Main work', () => {
  const walk = catalogue['walk-plank-push-up'];
  const pushMain = [catalogue['push-up'], catalogue['dumbbell-floor-press']];
  const squatMain = [catalogue['goblet-squat'], catalogue['air-squat']];
  const pushScore = scoreRampupCandidate(walk, .5, [], [], pushMain, [], 'balanced');
  const squatScore = scoreRampupCandidate(walk, .5, [], [], squatMain, [], 'balanced');
  assert.ok(pushScore > squatScore, pushScore+' > '+squatScore);
  // With generic defaults the movement was blind to the Main context.
  const blind = withGenericDefaults(walk);
  assert.equal(scoreRampupCandidate(blind, .5, [], [], pushMain, [], 'balanced'), scoreRampupCandidate(blind, .5, [], [], squatMain, [], 'balanced'));
});

test('cardio-oriented prep movements are recognised as such by Cardio Ramp-up scoring', () => {
  const main = [catalogue['jumping-jacks'], catalogue['burpees']];
  for (const id of ['star-jumps','knees-up','bum-kicks']) {
    const explicit = scoreRampupCandidate(catalogue[id], 0, [], [], main, [], 'cardio');
    const defaulted = scoreRampupCandidate(withGenericDefaults(catalogue[id]), 0, [], [], main, [], 'cardio');
    assert.ok(explicit > defaulted, id+': '+explicit+' > '+defaulted);
  }
});
