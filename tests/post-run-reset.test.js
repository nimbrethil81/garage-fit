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
const workout = GarageFitData.fixedWorkouts.postRunReset;

test('Post-Run Reset appears in the fixed workouts catalogue', () => {
  assert.ok(workout, 'postRunReset is missing from GarageFitData.fixedWorkouts');
  assert.equal(workout.name, 'Post-Run Reset');
});

test('Post-Run Reset is a fixed workout, not a generated workout', () => {
  assert.ok(GarageFitData.fixedWorkouts.postRunReset, 'postRunReset must live in the fixed-workout catalogue');
  assert.equal(workout.termination.type, 'fixed-sequence');
  assert.notEqual(workout.termination.type, 'amrap');
  assert.equal(workout.termination.rounds, undefined, 'a fixed-sequence workout must not declare rounds');
});

test('the routine is a single linear pass: upper-body/core block, then downshift, then cooldown', () => {
  const ids = workout.exercises.map(exercise => exercise.id);
  const upperBodyEnd = ids.indexOf('dead-bug');
  const downshiftIndex = ids.indexOf('easy-recovery-walk');
  const firstStretchIndex = ids.indexOf('runners-stretch');
  assert.ok(upperBodyEnd >= 0 && downshiftIndex > upperBodyEnd, 'downshift must follow the upper-body/core block');
  assert.ok(firstStretchIndex > downshiftIndex, 'cooldown stretches must follow the downshift');
  assert.deepEqual(ids.slice(0, 4), ['push-up', 'pike-push-up', 'plank-shoulder-taps', 'dead-bug']);
});

test('the upper-body/core block occurs exactly once (no repeated round)', () => {
  const upperBodyIds = ['push-up', 'pike-push-up', 'plank-shoulder-taps', 'dead-bug'];
  for (const id of upperBodyIds) {
    assert.equal(workout.exercises.filter(exercise => exercise.id === id).length, 1, id + ' should appear exactly once');
  }
});

test('press-ups, pike press-ups and plank shoulder taps are all included as rep-based movements', () => {
  const pressUp = workout.exercises.find(exercise => exercise.id === 'push-up');
  const pikePressUp = workout.exercises.find(exercise => exercise.id === 'pike-push-up');
  const shoulderTaps = workout.exercises.find(exercise => exercise.id === 'plank-shoulder-taps');
  assert.ok(pressUp && pressUp.reps >= 10 && pressUp.reps <= 15, 'press-ups should be 10-15 reps');
  assert.ok(pikePressUp && pikePressUp.reps >= 6 && pikePressUp.reps <= 10, 'pike press-ups should be 6-10 reps');
  assert.ok(shoulderTaps && shoulderTaps.reps >= 10 && shoulderTaps.reps <= 16, 'plank shoulder taps should be 10-16 total taps');
  assert.equal(shoulderTaps.durationSeconds, undefined, 'plank shoulder taps should be rep-based, not timed');
});

test('the core movement is a single bodyweight, no-equipment, timed hold distinct from the other upper-body movements', () => {
  const core = workout.exercises.find(exercise => exercise.id === 'dead-bug');
  assert.ok(core, 'expected a core movement in the upper-body block');
  assert.ok(core.durationSeconds >= 20 && core.durationSeconds <= 30, 'core movement should be 20-30 seconds');
  assert.equal(core.equipment, undefined, 'core movement should not declare equipment on the fixed-workout entry');
});

test('the downshift is a brief timed recovery step of roughly 30-60 seconds', () => {
  const downshift = workout.exercises.find(exercise => exercise.id === 'easy-recovery-walk');
  assert.ok(downshift, 'expected a downshift/recovery step between the top-up and the cooldown');
  assert.ok(downshift.durationSeconds >= 30 && downshift.durationSeconds <= 60);
});

const EXPECTED_STRETCH_PAIRS = [
  ['runners-stretch', 'Standing calf stretch'],
  ['standing-quads', 'Standing quad stretch'],
  ['hip-flexor-arm-stretch', 'Hip-flexor lunge stretch'],
  ['kneeling-hamstring', 'Hamstring stretch'],
  ['glute-stretch', 'Figure-four / glute stretch']
];

test('calf, quad, hip-flexor, hamstring and glute stretches are all included for both sides, once each', () => {
  for (const [id] of EXPECTED_STRETCH_PAIRS) {
    const entries = workout.exercises.filter(exercise => exercise.id === id);
    assert.equal(entries.length, 2, id + ' should appear exactly twice (left and right)');
    const sides = entries.map(exercise => exercise.side).sort();
    assert.deepEqual(sides, ['left', 'right']);
    for (const entry of entries) {
      assert.ok(entry.durationSeconds >= 25 && entry.durationSeconds <= 30, id + ' side hold should be around 30 seconds');
      assert.match(entry.name, entry.side === 'left' ? /- Left$/ : /- Right$/);
    }
  }
});

test('the chest/shoulder opener appears once, at the end of the cooldown, with no side split', () => {
  const chest = workout.exercises[workout.exercises.length - 1];
  assert.equal(chest.id, 'chest-opener');
  assert.equal(chest.side, undefined);
  assert.equal(workout.exercises.filter(exercise => exercise.id === 'chest-opener').length, 1);
  assert.ok(chest.durationSeconds >= 30 && chest.durationSeconds <= 45);
});

test('the workout requires no equipment', () => {
  for (const exercise of workout.exercises) {
    assert.equal(exercise.equipment, undefined, exercise.name + ' should not declare equipment on the fixed-workout entry');
    const catalogueEntry = catalogue[exercise.id];
    if (catalogueEntry) assert.deepEqual(catalogueEntry.equipment, [], exercise.id + ' should require no equipment');
  }
});

test('no leg-strengthening movement precedes the cooldown', () => {
  const stretchStart = workout.exercises.findIndex(exercise => exercise.id === 'runners-stretch');
  const beforeStretches = workout.exercises.slice(0, stretchStart);
  const legStrengthIds = ['air-squat', 'reverse-lunge', 'walking-lunge', 'bodyweight-squat', 'squat-jumps'];
  for (const exercise of beforeStretches) assert.ok(!legStrengthIds.includes(exercise.id), exercise.id + ' should not appear before the cooldown');
});

test('the estimated duration is roughly 7-8 minutes', () => {
  const timedTotal = workout.exercises.reduce((sum, exercise) => sum + (exercise.durationSeconds || 0), 0);
  const transitionTotal = workout.exercises.reduce((sum, exercise, index) => {
    if (index === workout.exercises.length - 1) return sum;
    const gap = exercise.transitionAfter != null ? exercise.transitionAfter : (workout.transitionSeconds || 0);
    return sum + gap;
  }, 0);
  const repsTotal = workout.exercises.reduce((sum, exercise) => sum + (exercise.reps || 0), 0);
  // Rep-based movements are user-paced; assume roughly 2.5 seconds per rep for a rough estimate.
  const estimatedSeconds = timedTotal + transitionTotal + repsTotal * 2.5;
  assert.ok(estimatedSeconds >= 300 && estimatedSeconds <= 560, 'expected roughly 7-8 minutes, got ' + Math.round(estimatedSeconds) + 's');
});

// ---- Fixed-workout UI/detail-model tests ----

test('detail model presents Post-Run Reset via the reusable fixed-sequence UI', () => {
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
  const definition = ui.detailDefinition('postRunReset');
  assert.equal(definition.name, 'Post-Run Reset');
  assert.equal(definition.exercises.length, workout.exercises.length);
  assert.equal(definition.exercises[0].target, '12 reps');
  assert.equal(definition.exercises[3].target, '25 sec');
  assert.ok(ui.cardMeta.postRunReset, 'expected a Workouts-catalogue card for Post-Run Reset');
});

// ---- Full playback simulation (mirrors the harness used by tests/evening-full-body-reset.test.js) ----

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

test('playback moves through the mixed reps/timed sequence linearly with no looping or rounds', () => {
  const { context, elements, intervals } = loadApp();
  context.GarageFitWorkoutUI.startFixedSequenceWorkout('postRunReset');

  assert.equal(vm.runInContext('state.key', context), 'fixedSequence');
  assert.equal(vm.runInContext('state.list.length', context), workout.exercises.length);
  assert.equal(elements.routineName.textContent, 'Post-Run Reset');

  // "Get ready" (3s)
  tick(intervals, vm.runInContext('state.timer', context), 3);
  assert.equal(elements.exerciseName.textContent, 'Press-ups');
  assert.equal(vm.runInContext('state.phase', context), 'reps');
  assert.equal(elements.repsNum.textContent, 'x12 reps');

  // Reps-based steps do not auto-advance: tapping "complete" moves forward, one movement at a time.
  context.GarageFitWorkoutUI.skipFixedSequence();
  assert.equal(elements.exerciseName.textContent, 'Pike press-ups');
  assert.equal(vm.runInContext('state.phase', context), 'reps');
  context.GarageFitWorkoutUI.skipFixedSequence();
  assert.equal(elements.exerciseName.textContent, 'Plank shoulder taps');
  context.GarageFitWorkoutUI.skipFixedSequence();

  // Dead bug is timed and must count down automatically.
  assert.equal(elements.exerciseName.textContent, 'Dead bug');
  assert.equal(vm.runInContext('state.phase', context), 'work');
  tick(intervals, vm.runInContext('state.timer', context), 25);
  tick(intervals, vm.runInContext('state.timer', context), 8); // transition into the downshift

  assert.equal(elements.exerciseName.textContent, 'Downshift - easy recovery');
  assert.equal(vm.runInContext('state.phase', context), 'work');
  tick(intervals, vm.runInContext('state.timer', context), 45);
  tick(intervals, vm.runInContext('state.timer', context), 8);

  assert.equal(elements.exerciseName.textContent, 'Standing calf stretch - Left');
  tick(intervals, vm.runInContext('state.timer', context), 30); // no transition delay between left/right sides
  assert.equal(elements.exerciseName.textContent, 'Standing calf stretch - Right');

  // Verify the whole sequence visits each remaining name exactly once, ending on the chest opener.
  const remainingNames = [
    'Standing quad stretch - Left','Standing quad stretch - Right',
    'Hip-flexor lunge stretch - Left','Hip-flexor lunge stretch - Right',
    'Hamstring stretch - Left','Hamstring stretch - Right',
    'Figure-four / glute stretch - Left','Figure-four / glute stretch - Right',
    'Chest / shoulder opener'
  ];
  tick(intervals, vm.runInContext('state.timer', context), 30); tick(intervals, vm.runInContext('state.timer', context), 8);
  for (let i=0;i<remainingNames.length;i++) {
    assert.equal(elements.exerciseName.textContent, remainingNames[i], 'step '+i);
    const duration = remainingNames[i]==='Chest / shoulder opener' ? 35 : 30;
    tick(intervals, vm.runInContext('state.timer', context), duration);
    const isLast = i===remainingNames.length-1;
    if (!isLast && vm.runInContext('state.phase', context)==='rest') tick(intervals, vm.runInContext('state.timer', context), 8);
  }

  assert.equal(vm.runInContext('state.running', context), false);
  assert.equal(elements.doneTitle.textContent, 'Post-Run Reset Complete');
  assert.equal(elements.doneSub.textContent, 'Reset complete. Nice run.');
});

test('existing fixed workouts remain unaffected by the new fixed-sequence engine', () => {
  const cindy = GarageFitData.fixedWorkouts.cindy;
  const abBlast = GarageFitData.fixedWorkouts.abBlast;
  const workout300 = GarageFitData.fixedWorkouts.workout300;
  const evening = GarageFitData.fixedWorkouts.eveningFullBodyReset;
  assert.equal(cindy.termination.type, 'amrap');
  assert.equal(abBlast.termination.type, 'timed-sequence');
  assert.equal(workout300.termination.type, 'fixed-rounds');
  assert.equal(evening.termination.type, 'timed-sequence');
});
