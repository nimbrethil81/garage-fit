const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../data/workouts.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
const cooldownIds = [
  'toe-touch','inside-thigh-stretch','wide-toe-touch','hip-flexor-arm-stretch','kneeling-hamstring',
  'frog-stretch','standing-quads','downward-upward-dog','plank-calf-stretch','pigeon-stretch',
  'runners-stretch','childs-pose','chest-opener','side-stretch','glute-stretch','lying-torso-twist',
  'full-body-stretch','trx-lean-back-sink','trx-lunge-calf-chest','trx-glute-standing','trx-side-stretch'
];

function eligibleCooldownIds(equipment) {
  const eligible = cooldownIds.filter(id => GarageFitGenerator.requirementsMet(catalogue[id], equipment));
  return eligible.filter((id, index) =>
    !catalogue[id].alternativeGroup ||
    !eligible.slice(index + 1).some(other => catalogue[other].alternativeGroup === catalogue[id].alternativeGroup)
  );
}

test('fixed Cool Down records four explicit bodyweight/TRX substitution groups', () => {
  assert.deepEqual(GarageFitData.fixedCooldownAlternativeGroups, {
    'back-lat-stretch': ['childs-pose','trx-lean-back-sink'],
    'chest-stretch-family': ['chest-opener','trx-lunge-calf-chest'],
    'glute-stretch-family': ['glute-stretch','trx-glute-standing'],
    'side-stretch-family': ['side-stretch','trx-side-stretch']
  });

  for (const [group, ids] of Object.entries(GarageFitData.fixedCooldownAlternativeGroups)) {
    for (const id of ids) assert.equal(catalogue[id].alternativeGroup, group, id);
  }
});

test('fixed Cool Down uses bodyweight substitutions when TRX is unavailable', () => {
  const ids = eligibleCooldownIds([]);
  assert.ok(ids.includes('childs-pose'));
  assert.ok(ids.includes('chest-opener'));
  assert.ok(ids.includes('glute-stretch'));
  assert.ok(ids.includes('side-stretch'));
  assert.equal(ids.some(id => id.startsWith('trx-')), false);
});

test('fixed Cool Down replaces bodyweight substitutes with TRX versions instead of concatenating them', () => {
  const ids = eligibleCooldownIds(['trx']);
  const expectedTrx = ['trx-lean-back-sink','trx-lunge-calf-chest','trx-glute-standing','trx-side-stretch'];
  const replacedBodyweight = ['childs-pose','chest-opener','glute-stretch','side-stretch'];

  for (const id of expectedTrx) assert.ok(ids.includes(id), id);
  for (const id of replacedBodyweight) assert.equal(ids.includes(id), false, id);

  const groups = ids.map(id => catalogue[id].alternativeGroup).filter(Boolean);
  assert.equal(new Set(groups).size, groups.length);
});
