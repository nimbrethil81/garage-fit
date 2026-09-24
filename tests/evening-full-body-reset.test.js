const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');

// ---- Data-level tests (catalogue + fixed-workout structure) ----

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
require('../data/workouts.js');

const catalogue = GarageFitData.exercises;
const workout = GarageFitData.fixedWorkouts.eveningFullBodyReset;

const EXPECTED_SEQUENCE = [
  { id:'bodyweight-squat', name:'Bodyweight squat' },
  { id:'push-up', name:'Press-ups' },
  { id:'alternating-reverse-lunge', name:'Alternating reverse lunges' },
  { id:'bodyweight-good-morning', name:'Bodyweight good mornings' },
  { id:'wall-angel', name:'Wall angels' },
  { id:'dead-bug', name:'Dead bug' },
  { id:'glute-bridge', name:'Glute bridge' }
];

const PROHIBITED_NAME_PATTERN = /jumping jack|star jump|burpee|mountain climber|high knee|running on the spot|plyometric|squat jump|box jump/i;
const PROHIBITED_PRONE_PATTERN = /superman|prone w raise|reverse snow angel|prone\b/i;

test('Evening Full-Body Reset appears in the fixed workouts catalogue', () => {
  assert.ok(workout, 'eveningFullBodyReset is missing from GarageFitData.fixedWorkouts');
  assert.equal(workout.name, 'Evening Full-Body Reset');
});

test('Evening Full-Body Reset contains exactly seven exercises in the required order', () => {
  assert.equal(workout.exercises.length, 7);
  assert.deepEqual(
    workout.exercises.map(exercise => ({ id: exercise.id, name: exercise.name })),
    EXPECTED_SEQUENCE
  );
});

test('each exercise lasts 40 seconds', () => {
  for (const exercise of workout.exercises) assert.equal(exercise.durationSeconds, 40, exercise.name);
});

test('transitions between exercises are 10 seconds', () => {
  assert.equal(workout.transitionSeconds, 10);
});

test('the routine is a single pass with no repeating rounds, AMRAP or EMOM', () => {
  assert.equal(workout.termination.type, 'timed-sequence');
  assert.equal(workout.termination.rounds, undefined);
  assert.equal(workout.exercises.length, new Set(workout.exercises.map((_, index) => index)).size);
});

test('the calculated duration matches 7x40s work plus 6x10s transitions (approximately 5:50)', () => {
  const expectedTotal = workout.exercises.reduce((sum, exercise) => sum + exercise.durationSeconds, 0)
    + workout.transitionSeconds * (workout.exercises.length - 1);
  assert.equal(workout.termination.durationSeconds, expectedTotal);
  assert.equal(expectedTotal, 340);
  // "Approximately 5 minutes 50 seconds" per the product brief; the exact figure implied by
  // "40s per exercise with a 10s transition between exercises" (6 gaps across 7 exercises) is 5:40.
  assert.ok(Math.abs(expectedTotal - 350) <= 15, 'expected duration to be close to 5:50 ('+expectedTotal+'s)');
});

test('the workout requires no equipment', () => {
  for (const exercise of workout.exercises) {
    assert.equal(exercise.equipment, undefined, exercise.name + ' should not declare equipment on the fixed-workout entry');
    const catalogueEntry = catalogue[exercise.id];
    if (catalogueEntry) assert.deepEqual(catalogueEntry.equipment, [], exercise.id + ' should require no equipment');
  }
});

test('no prohibited high-impact, jumping, or conditioning exercise is included', () => {
  for (const exercise of workout.exercises) {
    assert.doesNotMatch(exercise.name, PROHIBITED_NAME_PATTERN, exercise.name);
    const catalogueEntry = catalogue[exercise.id];
    if (catalogueEntry) assert.notEqual(catalogueEntry.impact, 'high', exercise.name);
  }
});

test('no prone (lying face down) exercise is included', () => {
  for (const exercise of workout.exercises) assert.doesNotMatch(exercise.name, PROHIBITED_PRONE_PATTERN, exercise.name);
  // Dead bug and Glute bridge are performed lying on the back and are intentionally included.
  assert.ok(workout.exercises.some(exercise => exercise.id === 'dead-bug'));
  assert.ok(workout.exercises.some(exercise => exercise.id === 'glute-bridge'));
});

test('Wall angel is defined in the exercise catalogue', () => {
  const wallAngel = catalogue['wall-angel'];
  assert.ok(wallAngel);
  assert.equal(wallAngel.name, 'Wall angel');
  assert.deepEqual(wallAngel.equipment, []);
  assert.notEqual(wallAngel.impact, 'high');
});

test('the workout copy avoids HIIT/conditioning/challenge framing', () => {
  assert.doesNotMatch(workout.description || '', /HIIT|conditioning|calorie|fat.burn|challenge|high.intensity/i);
});

// ---- Fixed-workout UI/detail-model tests (mirrors tests/workouts-detail-ui.test.js) ----

test('detail model presents Evening Full-Body Reset via the reusable timed-sequence UI', () => {
  const source = fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8');
  const context = {
    console,
    document: { readyState:'loading' },
    addEventListener() {},
    FIXED_WORKOUTS: GarageFitData.fixedWorkouts,
    SEVEN_MINUTE_WORKOUT: [{ name:'Jumping jacks', work:30 }],
    fixedWorkoutExercises(w) { return w.exercises; }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename:'js/workouts-ui.js' });

  const ui = context.GarageFitWorkoutUI;
  const definition = ui.detailDefinition('eveningFullBodyReset');
  assert.equal(definition.name, 'Evening Full-Body Reset');
  assert.match(definition.description, /short, low-impact bodyweight routine/i);
  assert.doesNotMatch(definition.description, /HIIT|conditioning|calorie|challenge/i);
  assert.deepEqual(
    Array.from(definition.exercises, exercise => exercise.target),
    ['40 sec','40 sec','40 sec','40 sec','40 sec','40 sec','40 sec']
  );
  assert.ok(ui.cardMeta.eveningFullBodyReset, 'expected a Workouts-catalogue card for Evening Full-Body Reset');
});

// ---- Full playback simulation (mirrors the harness used by tests/ui-smoke.test.js) ----

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value=>this.values.add(value)); }
  remove(...values) { values.forEach(value=>this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force===undefined) force=!this.values.has(value);
    force ? this.values.add(value) : this.values.delete(value);
    return force;
  }
}
class Element {
  constructor(id='') { this.id=id;this.classList=new ClassList();this.style={};this.children=[];this.attributes={};this.disabled=false;this.textContent='';this.innerHTML='';this.value=''; }
  setAttribute(key,value) { this.attributes[key]=String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child);return child; }
  querySelector() { return new Element(); }
  addEventListener() {}
  focus() {}
}

function loadApp() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const elements = Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  for (const id of ['partialRepsDialog','doneStats','generatedDoneStats','amrapDoneStats']) elements[id].classList.add('hidden');
  const storage = new Map();
  const spoken = [];
  const intervals = new Map(); let nextInterval = 1;
  const context = {
    console, Date, Math, JSON, Set,
    SpeechSynthesisUtterance: function(text){this.text=text;},
    speechSynthesis: { cancel(){}, speak(utterance){spoken.push(utterance.text);} },
    document: { getElementById:id=>elements[id]||(elements[id]=new Element(id)), createElement:()=>new Element(), addEventListener(){}, head:new Element(), querySelector(){return new Element();} },
    localStorage: { getItem:key=>storage.has(key)?storage.get(key):null, setItem:(key,value)=>storage.set(key,String(value)) },
    navigator: {},
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
    setInterval: callback => { const id=nextInterval++; intervals.set(id,callback); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: callback => callback(),
    addEventListener() {}
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of ['data/equipment.js','data/exercises.js','data/workouts.js','js/generator.js','js/timed-cues.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename:file });
  }
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline, context, { filename:'index-inline.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8'), context, { filename:'js/workouts-ui.js' });
  return { context, elements, intervals, spoken };
}

function tick(intervals, timerId, times) {
  for (let i=0;i<times;i++) intervals.get(timerId)();
}

test('playback can complete Evening Full-Body Reset via the existing fixed-workout timed-sequence flow', () => {
  const { context, elements, intervals } = loadApp();
  context.GarageFitWorkoutUI.startTimedSequenceWorkout('eveningFullBodyReset');

  assert.equal(vm.runInContext('state.key', context), 'fixedTimedSequence');
  assert.equal(vm.runInContext('state.list.length', context), 7);
  assert.equal(elements.routineName.textContent, 'Evening Full-Body Reset');

  // "Get ready" (3s)
  tick(intervals, vm.runInContext('state.timer', context), 3);
  assert.equal(elements.exerciseName.textContent, 'Bodyweight squat');
  assert.equal(vm.runInContext('state.phase', context), 'work');

  const expectedNames = ['Bodyweight squat','Press-ups','Alternating reverse lunges','Bodyweight good mornings','Wall angels','Dead bug','Glute bridge'];
  for (let index=0; index<expectedNames.length; index++) {
    assert.equal(elements.exerciseName.textContent, expectedNames[index]);
    assert.equal(vm.runInContext('state.phase', context), 'work');
    tick(intervals, vm.runInContext('state.timer', context), 40); // work phase
    if (index < expectedNames.length-1) {
      assert.equal(vm.runInContext('state.phase', context), 'rest');
      tick(intervals, vm.runInContext('state.timer', context), 10); // 10s transition
    }
  }

  assert.equal(vm.runInContext('state.running', context), false);
  assert.equal(elements.doneTitle.textContent, 'Evening Full-Body Reset Complete');
  assert.equal(elements.doneSub.textContent, 'Reset complete. Nice and easy.');
});
