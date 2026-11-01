const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../data/workouts.js');

const data = GarageFitData;

test('neutral suspension labels preserve all 29 canonical identities, equipment and artwork lookup', () => {
  const straps = Object.values(data.exercises).filter(ex => ex.id.startsWith('trx-'));
  assert.equal(straps.length, 29);
  assert.equal(data.equipment.find(ex => ex.id === 'trx').name, 'Suspension straps');
  for (const ex of straps) {
    assert.match(ex.name, /^Suspension strap /);
    assert.deepEqual(ex.equipment, [['trx']]);
  }
  for (const ex of Object.values(data.exercises)) {
    assert.doesNotMatch(ex.name + ' ' + ex.instruction, /\bTRX\b|Suspension Trainer|CrossFit|Gym Jones|Cindy/i);
  }
  assert.equal(data.exerciseIllustration('trx-row'), 'assets/exercises/trx-row.webp');
  assert.equal(data.exerciseIllustration('trx-reverse-lunge'), 'assets/exercises/trx-reverse-lunge.webp');
});

test('historical benchmark definitions remain explicitly legacy-only while the seven-minute order is independently composed', () => {
  assert.equal(data.fixedWorkouts.cindy.legacyOnly, true);
  assert.equal(data.fixedWorkouts.workout300.legacyOnly, true);
  assert.equal(data.fixedWorkouts.workout300.name, '300-Rep Challenge');
  assert.deepEqual(data.fixedWorkouts.cindy.exercises.map(ex => ex.reps), [5, 10, 15]);
  const prior = ['jumping-jacks','wall-sit','push-up','abdominal-crunch','chair-step-ups','air-squat',
    'chair-triceps-dips','plank','high-knees','reverse-lunge','push-up-rotation','side-plank'];
  const current = data.fixedWorkouts.sevenMinute;
  assert.equal(current.length, 12);
  assert.notDeepEqual(current, prior);
  assert.deepEqual([...current].sort(), [...prior].sort());
  assert.ok(current.every(id => data.exercises[id]));
});
