const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context.js');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../data/programmes.js');
require('../js/generator.js');
const programmesBefore = JSON.stringify(GarageFitData.programmes);
const catalogueBefore = JSON.stringify(GarageFitData.exercises);
const G = GarageFitGenerator;
function random(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function generate(options, resolve) {
  let draws = 0;
  const seeded = random(31), request = {...options, catalogue: GarageFitData.exercises,
    random: () => { draws++; return seeded(); }};
  if (resolve) assert.equal(resolve(request), null);
  const workout = G.generate(request);
  delete workout.id;
  return {workout, draws};
}
const legacyOptions = [
  {duration: 10, focus: 'strength', bodyFocus: 'upper', difficulty: 'easy', equipment: []},
  {duration: 20, focus: 'balanced', bodyFocus: 'lower', difficulty: 'normal', equipment: ['dumbbells']},
  {duration: 45, focus: 'cardio', bodyFocus: 'core', difficulty: 'hard', equipment: ['trx', 'bands']}
];
// Capture actual legacy generation before either new module is loaded.
const before = legacyOptions.map(options => generate(options));
require('../data/workout-families.js');
require('../js/workout-families.js');
const F = GarageFitWorkoutFamilies, definitions = GarageFitData.workoutFamilies;
const expected = [
  ['strength-control', 'Strength & Control'],
  ['cardio-conditioning', 'Cardio & Conditioning'],
  ['athletic-movement', 'Athletic Movement'],
  ['core-stability', 'Core & Stability'],
  ['mobility-movement-quality', 'Mobility & Movement Quality'],
  ['full-body-challenges', 'Full-Body Challenges']
];
const fails = (fn, code) => assert.throws(fn, error => error instanceof F.FamilyContractError && error.code === code);

test('six canonical families own immutable versioned identity, policies, suitability and feasibility', () => {
  assert.deepEqual(F.FAMILY_IDS, expected.map(([id]) => id));
  assert.ok(Object.isFrozen(definitions) && Object.isFrozen(F.FAMILY_IDS));
  for (const [id, name] of expected) {
    const definition = F.getDefinition(id);
    assert.equal(definition, definitions[id][1]);
    assert.equal(definition.id, id);
    assert.equal(definition.name, name);
    assert.equal(definition.version, 1);
    assert.ok(definition.purpose.length > 20);
    assert.deepEqual(definition.compositionPolicy, {id, version: 1});
    assert.deepEqual(definition.membershipPolicy, {id, version: 1});
    assert.ok(definition.suitabilityCriteria.length && definition.feasibilityRequirements.requirements.length);
    assert.deepEqual(definition.feasibilityRequirements.supportedDurations, [10, 15, 20, 30, 45]);
    assert.deepEqual(definition.feasibilityRequirements.supportedDifficulties, G.WORKOUT_DIFFICULTIES);
    assert.equal(new Set(definition.styles.map(item => item.id)).size, definition.styles.length);
    for (const object of [definitions[id], definition, definition.styles, definition.styles[0],
      definition.bodyFocus, definition.compositionPolicy, definition.membershipPolicy,
      definition.suitabilityCriteria, definition.feasibilityRequirements,
      definition.feasibilityRequirements.requiredChecks, definition.feasibilityRequirements.requirements])
      assert.ok(Object.isFrozen(object));
    assert.throws(() => definition.styles.push({id: 'invented'}), TypeError);
  }
});

test('explicit family overrides legacy workout styles without changing user preferences', () => {
  for (const [id] of expected) for (const focus of ['strength', 'balanced', 'cardio']) {
    const preferences = Object.freeze({workoutFamilyId: id, focus, workoutStyle: focus, bodyFocus: 'upper'});
    const selection = F.resolveRequest(preferences);
    assert.deepEqual(selection, {workoutFamilyId: id, workoutFamilyVersion: 1,
      bodyFocus: id === 'strength-control' ? 'upper' : 'full-body', familyStyleId: null});
    assert.ok(Object.isFrozen(selection));
    assert.equal(preferences.focus, focus);
    assert.equal(preferences.workoutStyle, focus);
    assert.equal(preferences.bodyFocus, 'upper');
    assert.ok(!('focus' in selection) && !('workoutStyle' in selection));
  }
});

test('only Strength & Control permits non-default Body Focus; disabled stale values cannot override another family', () => {
  assert.deepEqual([...F.getDefinition('strength-control').bodyFocus].sort(), [...G.WORKOUT_BODY_FOCUSES].sort());
  for (const bodyFocus of G.WORKOUT_BODY_FOCUSES)
    assert.equal(F.resolveRequest({workoutFamilyId: 'strength-control', bodyFocus}).bodyFocus, bodyFocus);
  assert.equal(F.resolveRequest({workoutFamilyId: 'strength-control', bodyFocus: 'UPPER'}).bodyFocus, 'upper');
  assert.equal(F.resolveRequest({workoutFamilyId: 'strength-control'}).bodyFocus, 'full-body');
  fails(() => F.resolveRequest({workoutFamilyId: 'strength-control', bodyFocus: 'invalid'}), 'unsupported-family-body-focus');
  for (const id of F.FAMILY_IDS.filter(id => id !== 'strength-control')) {
    assert.deepEqual(F.getDefinition(id).bodyFocus, ['full-body']);
    for (const bodyFocus of ['upper', 'lower', 'core', 'stale-value'])
      assert.equal(F.resolveRequest({workoutFamilyId: id, bodyFocus}).bodyFocus, 'full-body');
  }
});

test('internal styles resolve automatically from composer-proven candidates and report actual chosen style', () => {
  for (const id of F.FAMILY_IDS) {
    const request = F.resolveRequest({workoutFamilyId: id});
    const candidates = F.getDefinition(id).styles.map(style => style.id);
    for (const familyStyleId of candidates) {
      const resolved = F.resolveStyle(request, [familyStyleId]);
      assert.deepEqual(resolved, {...request, familyStyleId});
      assert.ok(Object.isFrozen(resolved));
      assert.equal(F.getStyle(id, resolved.familyStyleId).id, familyStyleId);
      assert.equal(request.familyStyleId, null, 'the requested family is not a performed style');
    }
    assert.equal(F.resolveStyle(request, candidates).familyStyleId, candidates[0]);
    assert.equal(F.resolveStyle(request, candidates.slice(1)).familyStyleId, candidates[1], 'an alternative keeps the family');
    assert.deepEqual(candidates, F.getDefinition(id).styles.map(style => style.id));
    fails(() => F.resolveStyle(request, []), 'family-style-unavailable');
    fails(() => F.resolveStyle(request, [candidates[0], 'unknown']), 'unsupported-family-style');
    fails(() => F.resolveRequest({workoutFamilyId: id, familyStyleId: candidates[0]}), 'invalid-family-request');
  }
});

test('unknown IDs, versions and family/style pairs fail explicitly without inference or legacy fallback', () => {
  for (const id of ['unknown', '', 'Strength & Control', 'toString', '__proto__', {}, 1])
    fails(() => F.resolveRequest({workoutFamilyId: id}), 'unknown-workout-family');
  for (const version of [0, 2, '1', null, 1.5, NaN])
    fails(() => F.resolveRequest({workoutFamilyId: 'strength-control', workoutFamilyVersion: version}), 'unsupported-workout-family-version');
  fails(() => F.getStyle('strength-control', 'integrated-flow'), 'unsupported-family-style');
  fails(() => F.resolveStyle({workoutFamilyId: 'mobility-movement-quality'}, ['straight-sets']), 'unsupported-family-style');
  fails(() => F.resolveStyle({}, ['straight-sets']), 'invalid-family-request');
  fails(() => F.resolveStyle({workoutFamilyId: 'strength-control'}, 'straight-sets'), 'invalid-family-request');
  for (const options of [null, [], 'strength-control']) fails(() => F.resolveRequest(options), 'invalid-family-request');
  assert.equal(F.resolveRequest({family: 'strength-control', sessionRole: 'strength-control', type: 'strength-control'}), null);
});

test('no-family path preserves complete seeded workouts, random consumption, catalogue and published Coach definitions', () => {
  assert.equal(F.resolveRequest(), null);
  assert.equal(F.resolveRequest({focus: 'legacy-value', bodyFocus: 'legacy-value'}), null);
  for (const [index, options] of legacyOptions.entries()) {
    assert.deepEqual(generate(options, F.resolveRequest), before[index]);
    assert.deepEqual(generate({...options, workoutFamilyId: null}, F.resolveRequest), before[index]);
  }
  assert.equal(JSON.stringify(GarageFitData.exercises), catalogueBefore);
  assert.equal(JSON.stringify(GarageFitData.programmes), programmesBefore);
});

test('standalone and Coach requests use the same browser contract with no persistence or namespace changes', () => {
  const storage = new Map([['gf_generator_focus', 'cardio'], ['gf_generator_body_focus', 'upper'],
    ['gf_generator_duration', '20'], ['gf_generator_difficulty', 'easy']]);
  const app = loadAppContext(storage), snapshot = new Map(storage);
  const result = vm.runInContext(`(() => {
    const standalone = GarageFitWorkoutFamilies.resolveRequest({workoutFamilyId:'strength-control',focus:'cardio',bodyFocus:'upper'});
    const coach = GarageFitWorkoutFamilies.resolveRequest({workoutFamilyId:'strength-control',workoutStyle:'strength',bodyFocus:'upper',sessionRole:'unchanged',type:'unchanged'});
    return {standalone,coach,definition:GarageFitWorkoutFamilies.getDefinition(standalone.workoutFamilyId)};
  })()`, app);
  assert.deepEqual(JSON.parse(JSON.stringify(result.standalone)), JSON.parse(JSON.stringify(result.coach)));
  assert.equal(result.definition, app.GarageFitData.workoutFamilies['strength-control'][1]);
  assert.deepEqual(storage, snapshot);
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
  assert.equal(scripts.filter(src => src === 'data/workout-families.js').length, 1);
  assert.equal(scripts.filter(src => src === 'js/workout-families.js').length, 1);
  assert.ok(scripts.indexOf('data/workout-families.js') < scripts.indexOf('js/workout-families.js'));
  assert.ok(scripts.indexOf('js/workout-families.js') < scripts.indexOf('js/generator.js'));
});
