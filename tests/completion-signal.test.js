const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

require('../js/completion-signal.js');
const { shouldSignalUnitComplete } = GarageFitCompletionSignal;

test('a forward step in playback position signals a completed unit', () => {
  assert.equal(shouldSignalUnitComplete(0, 1), true);
  assert.equal(shouldSignalUnitComplete(4, 5), true);
});

test('a backward step (manual "previous") does not signal completion', () => {
  assert.equal(shouldSignalUnitComplete(5, 4), false);
});

test('staying on the same index does not signal completion', () => {
  assert.equal(shouldSignalUnitComplete(0, 0), false);
  assert.equal(shouldSignalUnitComplete(3, 3), false);
});

test('a missing or non-finite index never signals completion', () => {
  assert.equal(shouldSignalUnitComplete(null, 1), false);
  assert.equal(shouldSignalUnitComplete(0, undefined), false);
  assert.equal(shouldSignalUnitComplete(NaN, 1), false);
});

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force === undefined) force = !this.values.has(value);
    force ? this.values.add(value) : this.values.delete(value);
    return force;
  }
}
class Element {
  constructor(id = '') { this.id = id; this.classList = new ClassList(); this.style = {}; this.children = []; this.attributes = {}; this.disabled = false; this.textContent = ''; this.innerHTML = ''; this.value = ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  querySelector() { return new Element(); }
  addEventListener() {}
  focus() {}
}

function loadApp() {
  const root = path.join(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  for (const id of ['partialRepsDialog', 'doneStats', 'generatedDoneStats', 'amrapDoneStats']) elements[id].classList.add('hidden');
  const storage = new Map();
  const spoken = [];
  const intervals = new Map(); let nextInterval = 1;
  const context = {
    console, Date, Math, JSON, Set,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    speechSynthesis: { cancel() {}, speak(utterance) { spoken.push(utterance.text); } },
    document: { getElementById: id => elements[id] || (elements[id] = new Element(id)), createElement: () => new Element(), addEventListener() {}, querySelector() { return new Element(); } },
    localStorage: { getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)) },
    navigator: {}, getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
    setInterval: callback => { const id = nextInterval++; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id), setTimeout: callback => callback()
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of ['data/equipment.js', 'data/exercises.js', 'data/workouts.js', 'js/generator.js', 'js/timed-cues.js', 'js/completion-signal.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline, context, { filename: 'index-inline.js' });
  let chimeCount = 0;
  context.playCompletionChime = () => { chimeCount++; };
  return { context, elements, storage, html, spoken, intervals, getChimeCount: () => chimeCount };
}

function runPhaseTimerToZero(context, intervals) {
  const timer = vm.runInContext('generatorState.phaseTimer', context);
  const seconds = vm.runInContext('currentGeneratedPhase().seconds', context);
  const callback = intervals.get(timer);
  for (let i = 0; i < seconds; i++) callback();
}

// Advances exactly one step in the generated timeline, regardless of whether
// the current phase is timed (run its countdown out) or rep-based (use the
// same manual-advance path the "Done" button uses).
function advanceOnePhase(context, intervals) {
  const seconds = vm.runInContext('currentGeneratedPhase().seconds', context);
  if (Number.isFinite(seconds)) runPhaseTimerToZero(context, intervals);
  else context.generatedPrimaryAction();
}

// Generation picks randomly from eligible exercises, so block count can vary
// run to run; regenerate until a multi-block workout is produced.
function startGeneratedWorkoutWithMultipleBlocks(context) {
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30);
  for (let attempt = 0; attempt < 25; attempt++) {
    context.generateWorkout();
    if (vm.runInContext('generatorState.workout.main.blocks.length', context) > 1) break;
  }
  context.startGeneratedWorkout();
}

test('a timed exercise interval ending triggers exactly one completion chime', () => {
  const { context, intervals, getChimeCount } = loadApp();
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30); context.generateWorkout(); context.startGeneratedWorkout();
  const timedIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.timed)", context);
  context.enterGeneratedPhase(timedIndex);
  const before = getChimeCount();
  runPhaseTimerToZero(context, intervals);
  assert.equal(getChimeCount(), before + 1);
});

test('transitioning from a finished exercise into Rest or Change Over does not duplicate the chime', () => {
  const { context, intervals, getChimeCount } = loadApp();
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30); context.generateWorkout(); context.startGeneratedWorkout();
  const restIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>['rest','interval-rest','set-change'].includes(phase.kind))", context);
  if (restIndex >= 0) {
    context.enterGeneratedPhase(restIndex - 1);
    const before = getChimeCount();
    advanceOnePhase(context, intervals);
    assert.equal(vm.runInContext('currentGeneratedPhase().kind', context), vm.runInContext("generatorState.timeline[" + restIndex + "].kind", context));
    assert.equal(getChimeCount(), before + 1);
  }
});

test('a round ending is signalled exactly once, even as the last exercise of the round', () => {
  const { context, intervals, getChimeCount } = loadApp();
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30); context.generateWorkout(); context.startGeneratedWorkout();
  const roundRestIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='round-rest')", context);
  if (roundRestIndex >= 0) {
    context.enterGeneratedPhase(roundRestIndex - 1);
    const before = getChimeCount();
    advanceOnePhase(context, intervals);
    assert.equal(vm.runInContext('currentGeneratedPhase().kind', context), 'round-rest');
    assert.equal(getChimeCount(), before + 1);
  }
});

test('a Main block ending is signalled exactly once', () => {
  const { context, intervals, getChimeCount } = loadApp();
  startGeneratedWorkoutWithMultipleBlocks(context);
  const blockTransitionIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='block-transition')", context);
  assert.ok(blockTransitionIndex >= 0);
  context.enterGeneratedPhase(blockTransitionIndex - 1);
  const before = getChimeCount();
  advanceOnePhase(context, intervals);
  assert.equal(vm.runInContext('currentGeneratedPhase().kind', context), 'block-transition');
  assert.equal(getChimeCount(), before + 1);
});

test('Warm-up ending and Main ending are each signalled exactly once', () => {
  const { context, intervals, getChimeCount } = loadApp();
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30); context.generateWorkout(); context.startGeneratedWorkout();
  const warmupEndIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='transition'&&phase.section==='warmup')", context);
  context.enterGeneratedPhase(warmupEndIndex - 1);
  let before = getChimeCount();
  advanceOnePhase(context, intervals);
  assert.equal(vm.runInContext('currentGeneratedPhase().kind', context), 'transition');
  assert.equal(getChimeCount(), before + 1);

  const mainEndIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='transition'&&phase.section==='main')", context);
  context.enterGeneratedPhase(mainEndIndex - 1);
  before = getChimeCount();
  advanceOnePhase(context, intervals);
  assert.equal(vm.runInContext('currentGeneratedPhase().kind', context), 'transition');
  assert.equal(getChimeCount(), before + 1);
});

test('the overall generated workout ending is signalled exactly once, not doubled with the final exercise', () => {
  const { context, intervals, getChimeCount } = loadApp();
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30); context.generateWorkout(); context.startGeneratedWorkout();
  const lastIndex = vm.runInContext('generatorState.timeline.length - 1', context);
  context.enterGeneratedPhase(lastIndex);
  const before = getChimeCount();
  advanceOnePhase(context, intervals);
  assert.equal(vm.runInContext('workoutState.running', context), false);
  assert.equal(getChimeCount(), before + 1);
});

test('Ramp-up ending is signalled through the routine player', () => {
  const { context, getChimeCount } = loadApp();
  context.startRoutine('rampup');
  let safety = 0;
  while (vm.runInContext('state.running', context) && safety++ < 100) {
    const before = getChimeCount();
    context.skipPhase();
    assert.ok(getChimeCount() > before, 'expected a completion chime for each forward step');
  }
  assert.equal(vm.runInContext('state.running', context), false);
});

test('an intra-exercise cue such as Change direction does not trigger the completion chime', () => {
  const { context, intervals, spoken, getChimeCount } = loadApp();
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30); context.generateWorkout(); context.startGeneratedWorkout();
  const timedIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.timed)", context);
  vm.runInContext("generatorState.timeline[" + timedIndex + "].exercise.timedCues=[{text:'Change direction',at:{type:'fraction',value:0.5}}]", context);
  context.enterGeneratedPhase(timedIndex);
  const before = getChimeCount();
  const timer = vm.runInContext('generatorState.phaseTimer', context);
  const seconds = vm.runInContext('currentGeneratedPhase().seconds', context);
  const callback = intervals.get(timer);
  for (let i = 0; i < Math.ceil(seconds / 2); i++) callback();
  assert.ok(spoken.includes('Change direction'));
  assert.equal(getChimeCount(), before);
});

test('pause and resume around a completed interval does not cause a duplicate chime', () => {
  const { context, intervals, getChimeCount } = loadApp();
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30); context.generateWorkout(); context.startGeneratedWorkout();
  const timedIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.timed)", context);
  context.enterGeneratedPhase(timedIndex);
  context.toggleWorkoutPause();
  const timer = vm.runInContext('generatorState.phaseTimer', context);
  const callback = intervals.get(timer);
  const before = getChimeCount();
  callback(); callback(); callback();
  assert.equal(getChimeCount(), before);
  context.toggleWorkoutPause();
  const seconds = vm.runInContext('currentGeneratedPhase().seconds', context);
  for (let i = 0; i < seconds; i++) callback();
  assert.equal(getChimeCount(), before + 1);
});

test('skipping ahead clears the pending timer so it cannot later fire a stale chime', () => {
  const { context, intervals, getChimeCount } = loadApp();
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30); context.generateWorkout(); context.startGeneratedWorkout();
  const timedIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.timed)", context);
  context.enterGeneratedPhase(timedIndex);
  const staleTimer = vm.runInContext('generatorState.phaseTimer', context);
  const staleCallback = intervals.get(staleTimer);
  context.generatedPrimaryAction();
  const before = getChimeCount();
  assert.ok(intervals.has(staleTimer) === false || vm.runInContext('generatorState.phaseTimer', context) !== staleTimer);
  staleCallback();
  assert.equal(getChimeCount(), before);
});

test('nested boundaries (last exercise, round, and block ending together) produce exactly one chime', () => {
  const { context, getChimeCount } = loadApp();
  startGeneratedWorkoutWithMultipleBlocks(context);
  const blockTransitionIndex = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='block-transition')", context);
  assert.ok(blockTransitionIndex > 0);
  context.enterGeneratedPhase(blockTransitionIndex - 1);
  const before = getChimeCount();
  context.enterGeneratedPhase(blockTransitionIndex);
  assert.equal(getChimeCount(), before + 1);
});

test('manually navigating back to a previous exercise does not itself signal a completion', () => {
  const { context, getChimeCount } = loadApp();
  context.toggleEquipmentItem('dumbbells'); context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30); context.generateWorkout(); context.startGeneratedWorkout();
  const firstSecondBlock = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.section==='main'&&phase.blockIndex===1)", context);
  context.enterGeneratedPhase(firstSecondBlock);
  const before = getChimeCount();
  context.previousGeneratedPhase();
  assert.equal(getChimeCount(), before);
});
