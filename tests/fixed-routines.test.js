const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAppContext } = require('./helpers/app-context');

// Executable specification of the four authored Routines-tab variants.
const WARM_UP_BODYWEIGHT = [
  'knees-up','bum-kicks','open-close-gates','hand-opposite-toe','body-hoops','body-twists',
  'arm-circles-backwards','arm-circles-forwards','arm-side-circles','air-squat','step-back-lunge',
  'walk-plank-push-up','star-jumps','burpees'
];
const WARM_UP_EQUIPMENT = [
  'knees-up','bum-kicks','open-close-gates','hand-opposite-toe','body-hoops','body-twists',
  'arm-circles-backwards','arm-circles-forwards','arm-side-circles','air-squat','step-back-lunge',
  'walk-plank-push-up','star-jumps','burpees',
  'trx-squat-overhead','trx-lunge-warmup','band-pull-apart','hangout-pullup-bar','kettlebell-figure-eight'
];
const COOL_DOWN_BODYWEIGHT = [
  'toe-touch','inside-thigh-stretch','wide-toe-touch','hip-flexor-arm-stretch','kneeling-hamstring',
  'frog-stretch','standing-quads','downward-upward-dog','plank-calf-stretch','pigeon-stretch','runners-stretch',
  'childs-pose','chest-opener','side-stretch','glute-stretch','lying-torso-twist','full-body-stretch'
];
const COOL_DOWN_EQUIPMENT = [
  'toe-touch','inside-thigh-stretch','wide-toe-touch','hip-flexor-arm-stretch','kneeling-hamstring',
  'frog-stretch','standing-quads','downward-upward-dog','plank-calf-stretch','pigeon-stretch','runners-stretch',
  'trx-lean-back-sink','trx-lunge-calf-chest','trx-glute-standing','trx-side-stretch','lying-torso-twist','full-body-stretch'
];
const EXPECTED = {
  warmup: { bodyweight: WARM_UP_BODYWEIGHT, equipment: WARM_UP_EQUIPMENT },
  cooldown: { bodyweight: COOL_DOWN_BODYWEIGHT, equipment: COOL_DOWN_EQUIPMENT }
};
const BODYWEIGHT_TAIL = ['childs-pose','chest-opener','side-stretch','glute-stretch'];
const TRX_TAIL = ['trx-lean-back-sink','trx-lunge-calf-chest','trx-glute-standing','trx-side-stretch'];

function setInventory(context, ids) { context.__inventory = ids; vm.runInContext('state.ownedEquipment=__inventory.slice()', context); }
function playedRoutine(context, kind, variant) {
  context.startRoutine(kind, variant);
  return Array.from(vm.runInContext('state.list', context), step => step.id + ':' + step.name);
}

test('fixed routine data holds exactly the four authored variants', () => {
  const context = loadAppContext();
  const routines = context.GarageFitData.fixedRoutines;
  assert.deepEqual(Object.keys(routines), ['warmup','cooldown']);
  for (const [kind, variants] of Object.entries(EXPECTED)) {
    assert.deepEqual(Object.keys(routines[kind]), ['bodyweight','equipment'], kind);
    for (const [variant, ids] of Object.entries(variants)) {
      assert.deepEqual([...routines[kind][variant]], ids, kind + '/' + variant);
      assert.ok(Object.isFrozen(routines[kind][variant]), kind + '/' + variant);
      for (const id of ids) assert.ok(context.GarageFitData.exercises[id], kind + '/' + variant + ' references unknown ' + id);
    }
  }
});

test('each variant plays its authored ids in order, expanding per-side stretches right then left', () => {
  const context = loadAppContext();
  const catalogue = context.GarageFitData.exercises;
  for (const [kind, variants] of Object.entries(EXPECTED)) {
    for (const [variant, ids] of Object.entries(variants)) {
      const expected = ids.flatMap(id => catalogue[id].sidedness === 'per-side'
        ? [id + ':' + catalogue[id].name + ' - Right', id + ':' + catalogue[id].name + ' - Left']
        : [id + ':' + catalogue[id].name]);
      assert.deepEqual(playedRoutine(context, kind, variant), expected, kind + '/' + variant);
    }
  }
});

test('the equipment inventory does not change any fixed routine variant', () => {
  const context = loadAppContext();
  const everything = context.GarageFitData.equipment.map(item => item.id);
  for (const [kind, variants] of Object.entries(EXPECTED)) {
    for (const variant of Object.keys(variants)) {
      const played = [[], ['trx'], ['bands','kettlebell'], everything].map(inventory => {
        setInventory(context, inventory);
        return { ids: [...context.routineIds(kind, variant)], steps: playedRoutine(context, kind, variant) };
      });
      for (const result of played.slice(1)) assert.deepEqual(result, played[0], kind + '/' + variant);
      assert.deepEqual(played[0].ids, EXPECTED[kind][variant], kind + '/' + variant);
    }
  }
  // Toggling through the real inventory UI is equally ignored.
  setInventory(context, []);
  const before = playedRoutine(context, 'cooldown', 'equipment');
  context.toggleEquipmentItem('trx');
  assert.deepEqual(playedRoutine(context, 'cooldown', 'equipment'), before);
});

test('Cool Down variants keep their own tails and never concatenate them', () => {
  const context = loadAppContext();
  const bodyweight = [...context.routineIds('cooldown', 'bodyweight')];
  const equipment = [...context.routineIds('cooldown', 'equipment')];
  assert.deepEqual(bodyweight.slice(-6), ['childs-pose','chest-opener','side-stretch','glute-stretch','lying-torso-twist','full-body-stretch']);
  assert.deepEqual(equipment.slice(-6), ['trx-lean-back-sink','trx-lunge-calf-chest','trx-glute-standing','trx-side-stretch','lying-torso-twist','full-body-stretch']);
  for (const id of TRX_TAIL) assert.equal(bodyweight.includes(id), false, 'bodyweight has ' + id);
  for (const id of BODYWEIGHT_TAIL) assert.equal(equipment.includes(id), false, 'equipment has ' + id);
  assert.equal(bodyweight.some(id => id.startsWith('trx-')), false);
  assert.equal(new Set(equipment).size, equipment.length);
  assert.deepEqual(bodyweight.slice(0, 11), equipment.slice(0, 11));
});

test('fixed routine construction does not use generator eligibility or family substitution', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const source = html.match(/function routineIds[\s\S]*?function renderHome/)[0];
  assert.doesNotMatch(source, /requirementsMet|sameFamily|ownedEquipment|family/);
  assert.doesNotMatch(html, /eligibleRoutineIds|warmupIds|cooldownIds/);
});

test('fixed routines keep the current playback timing', () => {
  const context = loadAppContext();
  for (const kind of ['warmup','cooldown']) for (const variant of ['bodyweight','equipment']) {
    for (const step of context.routineList(kind, variant)) {
      assert.equal(step.work, 15, step.name);
      assert.equal(step.rest, 5, step.name);
    }
  }
});

test('the TRX stretches remain direct variants of their bodyweight stretches for the generator', () => {
  const catalogue = loadAppContext().GarageFitData.exercises;
  const families = {};
  for (const id of COOL_DOWN_BODYWEIGHT.concat(TRX_TAIL)) if (catalogue[id].family) (families[catalogue[id].family] = families[catalogue[id].family] || []).push(id);
  assert.deepEqual(families, {
    'back-lat-stretch': ['childs-pose','trx-lean-back-sink'],
    'chest-opener': ['chest-opener','trx-lunge-calf-chest'],
    'glute-stretch': ['glute-stretch','trx-glute-standing'],
    'side-stretch': ['side-stretch','trx-side-stretch']
  });
});

test('fixed-workout data no longer mutates catalogue relationship metadata', () => {
  const data = loadAppContext().GarageFitData;
  assert.equal(data.fixedCooldownAlternativeGroups, undefined);
  for (const exercise of Object.values(data.exercises)) assert.equal(exercise.alternativeGroup, undefined, exercise.id);
});

test('Routines landing exposes only Warm Up and Cool Down with one-tap start and no variant picker screen', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const home = html.match(/<main id="home"[\s\S]*?<\/main>/)[0];
  const labels = [...home.matchAll(/<span class="label">([^<]+)<\/span>/g)].map(match => match[1]);
  assert.deepEqual(labels, ['Warm Up','Cool Down']);
  assert.doesNotMatch(home, /Ramp Up|Snack|tile-rampup|tile-snack|openSnack|startRoutine\('rampup'\)/);
  assert.doesNotMatch(home, /equipToggle|openEquipment/);
  assert.match(home, /startPreferredRoutine\('warmup'\)/);
  assert.match(home, /startPreferredRoutine\('cooldown'\)/);
  assert.deepEqual([...home.matchAll(/id="routineMode\w+"[^>]*>([^<]+)</g)].map(match => match[1]), ['Bodyweight','With equipment']);
  assert.doesNotMatch(html, /id="routinepick"|openRoutineVariants/);
});

test('routine variant preference: deterministic default, shared switching, persistence and one-tap launch', () => {
  const storage = new Map();
  const context = loadAppContext(storage);
  const doc = context.document;
  const state = () => vm.runInContext('state', context);
  const sub = kind => doc.getElementById(kind + 'Sub').textContent;
  const pressed = id => doc.getElementById(id).attributes['aria-pressed'];

  // Default is Bodyweight, even when the Generator inventory owns everything.
  context.loadRoutineVariant();
  state().ownedEquipment = context.GarageFitData.equipment.map(item => item.id);
  context.renderHome();
  assert.equal(vm.runInContext('routineVariant', context), 'bodyweight');
  assert.match(sub('warmup'), /^Bodyweight · ~\d+ min$/);
  assert.match(sub('cooldown'), /^Bodyweight · ~\d+ min$/);
  assert.equal(pressed('routineModeBodyweight'), 'true');
  assert.equal(pressed('routineModeEquipment'), 'false');

  // Switching is shared by both cards, does not start a routine, and persists.
  context.setRoutineVariant('equipment');
  assert.match(sub('warmup'), /^With equipment · ~\d+ min$/);
  assert.match(sub('cooldown'), /^With equipment · ~\d+ min$/);
  assert.equal(pressed('routineModeEquipment'), 'true');
  assert.equal(vm.runInContext('state.running', context), false);
  assert.equal(storage.get('gf_routine_variant'), 'equipment');
  context.setRoutineVariant('bogus');
  assert.equal(vm.runInContext('routineVariant', context), 'equipment');

  // A fresh app load restores the saved variant; garbage falls back to the default.
  const reloaded = loadAppContext(storage);
  reloaded.loadRoutineVariant();
  assert.equal(vm.runInContext('routineVariant', reloaded), 'equipment');
  storage.set('gf_routine_variant', 'nonsense');
  reloaded.loadRoutineVariant();
  assert.equal(vm.runInContext('routineVariant', reloaded), 'bodyweight');

  // One tap launches the authored list for the current variant, for both routines.
  for (const variant of ['bodyweight', 'equipment']) for (const kind of ['warmup', 'cooldown']) {
    context.setRoutineVariant(variant);
    context.startPreferredRoutine(kind);
    assert.equal(vm.runInContext('state.key', context), kind);
    assert.equal(doc.getElementById('routineName').textContent, kind === 'warmup' ? 'Warm Up' : 'Cool Down');
    assert.deepEqual(vm.runInContext('state.list', context).map(item => item.name), context.routineList(kind, variant).map(item => item.name));
    vm.runInContext('state.running=false', context);
  }
});

test('generated workouts still contain Warm-up, Ramp-up, Main and Cool-down', () => {
  const { GarageFitGenerator, GarageFitData } = loadAppContext();
  for (const duration of [10, 20, 45]) for (const equipment of [[], GarageFitData.equipment.map(item => item.id)]) {
    const workout = GarageFitGenerator.generate({ catalogue: GarageFitData.exercises, duration, focus:'balanced', equipment });
    assert.ok(workout.warmup.exercises.length > 0, 'warm-up ' + duration);
    assert.ok(workout.rampup.exercises.length > 0, 'ramp-up ' + duration);
    assert.ok(workout.main.blocks.length > 0 && workout.main.blocks.every(block => block.exercises.length > 0), 'main ' + duration);
    assert.ok(workout.cooldown.exercises.length > 0, 'cool-down ' + duration);
  }
});

test('Routines cards use the Workouts card language: no numbering or stick-figure art', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const home = html.match(/<main id="home"[\s\S]*?<\/main>/)[0];
  assert.equal((home.match(/class="routine-card"/g) || []).length, 2);
  assert.match(home, /class="routine-kicker"/);
  assert.match(home, /class="routine-cta"/);
  assert.doesNotMatch(home, /class="glyph"|icon-warmup|icon-cooldown/);
  assert.doesNotMatch(html, /content:"0[12]"|icon-warmup|icon-cooldown/);
});
