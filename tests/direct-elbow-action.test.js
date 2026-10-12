'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const G = GarageFitGenerator;
const catalogue = GarageFitData.exercises;
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }

const action = id => catalogue[id].directElbowAction;

test('direct biceps work is flexion and direct triceps work is extension', () => {
  for (const id of ['trx-biceps-curl','band-biceps-curl','dumbbell-biceps-curl']) assert.equal(action(id), 'flexion', id);
  for (const id of ['trx-triceps-press','band-triceps-extension','bench-dips','chair-triceps-dips']) assert.equal(action(id), 'extension', id);
});

test('compound pulls, presses and unrelated curls or stretches are unclassified', () => {
  for (const id of ['push-up','trx-hamstring-curl','triceps-stretch','pull-up','chin-up','bent-over-row'])
    if (catalogue[id]) assert.equal(action(id), null, id);
  for (const exercise of Object.values(catalogue))
    if (/row|press|push-up|pull-up|chin-up/i.test(exercise.name) && !/triceps/i.test(exercise.name)) assert.equal(exercise.directElbowAction, null, exercise.id);
  assert.ok(Object.values(catalogue).every(e => e.directElbowAction===null || ['flexion','extension'].includes(e.directElbowAction)));
});

test('directElbowAction is validated', () => {
  assert.deepEqual(G.validateCatalogue(catalogue), []);
  const copy = JSON.parse(JSON.stringify(catalogue));
  copy['band-biceps-curl'].directElbowAction = 'curl';
  assert.ok(G.validateCatalogue(copy).includes('band-biceps-curl: invalid directElbowAction "curl"'));
});

test('generator policy does not read directElbowAction', () => {
  const strip = c => JSON.parse(JSON.stringify(c, (k, v) => (k==='directElbowAction' || k==='id' && /^generated-/.test(v)) ? undefined : v));
  // Generated exercises are catalogue copies, so compare outputs without the field itself.
  const run = c => G.generate({ catalogue:c, duration:30, focus:'balanced', equipment:['bands','dumbbells','trx','bench'], random:random(7) });
  assert.deepEqual(strip(run(catalogue)), strip(run(strip(catalogue))));
});
