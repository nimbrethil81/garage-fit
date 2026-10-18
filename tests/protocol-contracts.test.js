// Workout Patterns 0 (#75): shared Main block protocol and playback contracts.
// See docs/WORKOUT_PROTOCOLS.md. These tests pin today's protocols so later patterns extend
// the same seams instead of drifting: one vocabulary, one resolved step plan read by both the
// player and the Session Tracker, and saved version-2 workouts/records that keep playing.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context.js');
const {blockFixtures, savedWorkoutV2, traceBlock} = require('./helpers/protocol-fixtures.js');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../data/sport-profiles.js');
require('../data/sport-capabilities.js');
require('../js/generator.js');
require('../js/coach-model.js');
require('../js/coach-store.js');
require('../js/session-tracker.js');
require('../data/programmes.js');
require('../js/training-history.js');

const G = GarageFitGenerator, Model = GarageFitCoachModel, Tracker = GarageFitSessionTracker, History = GarageFitTrainingHistory;
const catalogue = GarageFitData.exercises;
const plain = value => JSON.parse(JSON.stringify(value));
const allEquipment = ['dumbbells','kettlebell','pullup-bar','trx','barbell','bench','box','bands'];
function random(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// A bounded, deterministic spread of standalone workouts across durations, styles and kit.
function generatedSample() {
  const workouts = [];
  for (const duration of [10, 20, 30, 45]) for (const focus of ['strength','balanced','cardio']) for (const seed of [3, 11, 29])
    for (const equipment of [allEquipment, ['dumbbells'], []])
      workouts.push(G.generate({catalogue, duration, focus, equipment, random: random(seed * duration)}));
  workouts.push(G.generate({catalogue,duration:30,focus:'strength',bodyFocus:'upper',equipment:['trx'],random:random(50)}));
  return workouts;
}
const SAMPLE = generatedSample();
const sampleBlocks = () => SAMPLE.flatMap(workout => workout.main.blocks);

// ---- One vocabulary ----

test('Generator, Coach model and Training History accept the same protocol vocabulary; auto-selection is separate', () => {
  const generator = Object.keys(G.PROTOCOL_SHAPES);
  assert.deepEqual([...G.MAIN_PROTOCOLS], generator);
  assert.deepEqual(Model.MAIN_PROTOCOLS, generator);
  assert.deepEqual(Object.keys(History.PROTOCOL_CONDITION_FIELDS), generator);
  for (const protocol of generator)
    assert.deepEqual([...History.PROTOCOL_CONDITION_FIELDS[protocol]], [...G.PROTOCOL_SHAPES[protocol].conditionFields], protocol);
  // Today's protocols are exactly these; a new protocol must update every copy and this test.
  assert.deepEqual(generator, ['rounds','paired_sets','timed_intervals','emom','ladder','pyramid']);
  // Auto-selection is separate generator policy over accepted protocols, in a fixed pick order.
  assert.deepEqual([...G.GENERATED_PROTOCOLS], ['rounds','paired_sets','timed_intervals','emom','ladder','pyramid']);
  assert.ok(G.GENERATED_PROTOCOLS.every(protocol => G.MAIN_PROTOCOLS.has(protocol)));
  const eligible = Object.values(catalogue).filter(exercise => exercise.generator && exercise.main);
  for (const focus of ['strength','balanced','cardio'])
    assert.deepEqual(G.protocolWeights(focus, 'strength', 600, eligible, {blocks: [{protocol: 'rounds'}]}).map(item => item.value), [...G.GENERATED_PROTOCOLS]);
  // Catalogue opt-ins use only accepted protocols.
  for (const exercise of Object.values(catalogue)) for (const protocol of exercise.mainProtocols || [])
    assert.ok(G.MAIN_PROTOCOLS.has(protocol), exercise.id+' '+protocol);
});

test('each protocol has a distinct repeat key and a step position that occurrence ids encode', () => {
  const shapes = Object.values(G.PROTOCOL_SHAPES);
  assert.equal(new Set(shapes.map(shape => shape.repeatKey)).size, shapes.length);
  assert.equal(new Set(shapes.map(shape => shape.stepKey)).size, shapes.length);
  const ids = new Set();
  for (const shape of shapes) {
    assert.ok(Object.isFrozen(shape) && Object.isFrozen(shape.conditionFields));
    assert.equal(shape.conditionFields.includes(shape.repeatKey), false);
    for (const position of [1, 2]) {
      const id = Tracker.occurrenceIdFor({section: 'main', blockIndex: 0, exerciseIndex: 0, [shape.stepKey]: position});
      assert.notEqual(id, 'main:b0:e0', shape.stepKey+' is encoded');
      ids.add(id);
    }
  }
  assert.equal(ids.size, shapes.length * 2, 'positions never collide across protocols');
});

// ---- Block prescription describes structure ----

test('protocol conditions are the prescription without its repeat count', () => {
  for (const [protocol, block] of Object.entries(blockFixtures(catalogue))) {
    const conditions = G.protocolConditions(block), shape = G.PROTOCOL_SHAPES[protocol];
    assert.deepEqual(Object.keys(conditions).sort(), [...shape.conditionFields].sort(), protocol);
    assert.equal(G.blockRepeatCount(block), block.prescription[shape.repeatKey]);
    assert.notEqual(conditions, block.prescription, 'a copy, never the block prescription');
  }
  // Generated prescriptions carry only structure: the repeat count plus condition fields.
  for (const block of sampleBlocks()) {
    const shape = G.PROTOCOL_SHAPES[block.protocol];
    assert.deepEqual(Object.keys(block.prescription).sort(), [shape.repeatKey, ...shape.conditionFields].sort(), block.protocol);
  }
});

// ---- Resolved steps: rest boundaries and executable duration ----

test('fixture blocks resolve to well-formed steps whose time equals the estimate', () => {
  for (const [protocol, block] of Object.entries(blockFixtures(catalogue))) {
    const {steps, seconds, problems} = traceBlock(G, block);
    assert.deepEqual(problems, [], protocol);
    assert.equal(seconds, G.estimateBlockDuration(block), protocol);
    assert.equal(steps.filter(step => step.kind === 'exercise').length, G.blockRepeatCount(block) * (block.protocol==='emom'?1:block.exercises.length), protocol);
    // A single repeat and zero rests leave no stray rest steps.
    const shape = G.PROTOCOL_SHAPES[protocol];
    const single = Object.assign({}, block, {prescription: Object.assign({}, block.prescription, {[shape.repeatKey]: 1})});
    const restless = Object.assign({}, block, {prescription: Object.assign({}, block.prescription,
      Object.fromEntries(shape.conditionFields.filter(field => field !== 'workSeconds').map(field => [field, 0])))});
    for (const variant of [single, restless]) {
      const trace = traceBlock(G, variant);
      assert.deepEqual(trace.problems, [], protocol);
      assert.equal(trace.seconds, G.estimateBlockDuration(variant), protocol);
    }
    assert.equal(traceBlock(G, restless).steps.some(step => step.kind !== 'exercise'), false, protocol+' has no zero-second rests');
  }
});

test('generated blocks resolve to well-formed steps whose time equals the estimate', () => {
  const protocols = new Set();
  for (const block of sampleBlocks()) {
    const {steps, seconds, problems} = traceBlock(G, block);
    assert.deepEqual(problems, [], block.protocol);
    assert.equal(seconds, block.estimatedDurationSeconds, block.protocol);
    assert.equal(steps.filter(step => step.kind === 'exercise').length, G.blockRepeatCount(block) * (block.protocol==='emom'?1:block.exercises.length));
    protocols.add(block.protocol);
  }
  assert.deepEqual([...protocols].sort(), ['emom','ladder','paired_sets','pyramid','rounds','timed_intervals']);
  for (const workout of SAMPLE) assert.equal(workout.main.estimatedDurationSeconds,
    workout.main.blocks.reduce((sum, block) => sum + G.estimateBlockDuration(block), 0) + G.BLOCK_TRANSITION_SECONDS * (workout.main.blocks.length - 1));
});

// ---- Safe unknown-protocol handling ----

test('an unknown protocol is never estimated, played or normalised as another protocol', () => {
  const block = {id: 'main-1', protocol: 'future_pattern', intent: 'strength', exercises: [plain(catalogue['air-squat'])], prescription: {rounds: 3}};
  assert.deepEqual(G.resolveBlockSteps(block), []);
  assert.equal(G.estimateBlockDuration(block), 0);
  assert.equal(G.blockRepeatCount(block), 1);
  assert.ok(G.validateMain({blocks: [block]}, catalogue, allEquipment).includes('main-1:invalid-protocol'));
  assert.equal(G.protocolCompatible(catalogue['air-squat'], 'future_pattern'), false);
  assert.throws(() => G.normaliseWorkout({focus: 'strength', main: {blocks: [block]}}), /unsupported protocol "future_pattern"/);
  // A block with no protocol is still a legacy rounds block.
  const legacy = G.normaliseWorkout({focus: 'strength', blocks: [{rounds: 2, rest: {exercise: 10, round: 30}, exercises: [catalogue['air-squat']]}]});
  assert.equal(legacy.main.blocks[0].protocol, 'rounds');
  // Training History never treats an unknown or inherited-property protocol as comparable.
  for (const protocol of ['future_pattern', 'toString']) {
    const performance = {exerciseId: 'air-squat', prescriptionMode: 'reps', protocol, side: null, protocolConditions: {}};
    assert.deepEqual(History.comparePerformances(performance, performance), {comparable: false, reasons: ['unknown-protocol-conditions']});
  }
});

// ---- Saved version-2 workouts and records stay playable ----

// Pinned Main playback of the saved fixture: occurrence ids (with timed seconds) and rests.
const SAVED_MAIN_PLAYBACK = [
  'main:b0:r1:e0','rest:15','main:b0:r1:e1:right=20','main:b0:r1:e1:left=20','rest:15','main:b0:r1:e2','round-rest:45',
  'main:b0:r2:e0','rest:15','main:b0:r2:e1:right=20','main:b0:r2:e1:left=20','rest:15','main:b0:r2:e2','round-rest:45',
  'main:b0:r3:e0','rest:15','main:b0:r3:e1:right=20','main:b0:r3:e1:left=20','rest:15','main:b0:r3:e2','block-transition:3',
  'main:b1:s1:e0:right','main:b1:s1:e0:left','set-change:10','main:b1:s1:e1','set-rest:60',
  'main:b1:s2:e0:right','main:b1:s2:e0:left','set-change:10','main:b1:s2:e1','set-rest:60',
  'main:b1:s3:e0:right','main:b1:s3:e0:left','set-change:10','main:b1:s3:e1','block-transition:3',
  'main:b2:c1:e0=40','interval-rest:20','main:b2:c1:e1=40','interval-rest:20','main:b2:c2:e0=40','interval-rest:20','main:b2:c2:e1=40','transition:3'
];
const playback = timeline => timeline.filter(phase => phase.section === 'main')
  .map(phase => phase.kind === 'exercise' ? phase.occurrenceId+(phase.timed ? '='+phase.seconds : '') : phase.kind+':'+phase.seconds);

function app() {
  const context = loadAppContext(new Map(), {ownIntrinsics: true});
  return {context, run: code => vm.runInContext(code, context)};
}

test('a saved version-2 workout normalises idempotently and keeps its pinned playback', () => {
  const {context, run} = app();
  context.savedWorkout = savedWorkoutV2(context.GarageFitData.exercises);
  const once = plain(run('GarageFitGenerator.normaliseWorkout(savedWorkout)'));
  const twice = plain(run('GarageFitGenerator.normaliseWorkout(savedWorkout)'));
  assert.deepEqual(twice, once);
  assert.equal(once.schemaVersion, 2);
  assert.deepEqual(once.main.blocks.map(block => block.estimatedDurationSeconds), [450, 375, 220]);
  assert.deepEqual(plain(run('GarageFitGenerator.validateMain(savedWorkout.main,CATALOGUE,' + JSON.stringify(allEquipment) + ')')), []);
  assert.deepEqual(plain(playback(run('buildGeneratedTimeline(savedWorkout)'))), SAVED_MAIN_PLAYBACK);
});

test('planned occurrences of a saved workout keep their shape for Training History', () => {
  const {context, run} = app();
  context.savedWorkout = savedWorkoutV2(context.GarageFitData.exercises);
  const planned = plain(Tracker.plannedWorkFromTimeline(run('buildGeneratedTimeline(savedWorkout)'))).filter(entry => entry.section === 'main');
  assert.deepEqual(planned[1], {occurrenceId: 'main:b0:r1:e1:right', exerciseId: 'side-plank', section: 'main', blockIndex: 0, requirementId: null,
    prescription: {type: 'unilateral-timed', timed: true, seconds: 20, reps: null, side: 'right', protocol: 'rounds',
      protocolConditions: {exerciseRestSeconds: 15, roundRestSeconds: 45}, round: 1, set: null, cycle: null, exerciseIndex: 1}});
  assert.deepEqual(planned.find(entry => entry.occurrenceId === 'main:b1:s2:e1'), {occurrenceId: 'main:b1:s2:e1', exerciseId: 'trx-row', section: 'main', blockIndex: 1, requirementId: null,
    prescription: {type: 'reps', timed: false, seconds: null, reps: 10, side: null, protocol: 'paired_sets',
      protocolConditions: {betweenExercisesSeconds: 10, betweenSetsSeconds: 60}, round: null, set: 2, cycle: null, exerciseIndex: 1}});
  assert.deepEqual(planned.find(entry => entry.occurrenceId === 'main:b2:c1:e0'), {occurrenceId: 'main:b2:c1:e0', exerciseId: 'mountain-climbers', section: 'main', blockIndex: 2, requirementId: null,
    prescription: {type: 'timed', timed: true, seconds: 40, reps: null, side: null, protocol: 'timed_intervals',
      protocolConditions: {workSeconds: 40, transitionSeconds: 20}, round: null, set: null, cycle: 1, exerciseIndex: 0}});
});

// ---- Player and tracker read the same resolved plan ----

test('the player timeline is built from the resolved steps and the tracker reads that timeline', () => {
  const {context, run} = app();
  const protocols = new Set();
  let sided = 0;
  SAMPLE.filter((workout, index) => index % 4 === 0).concat({...savedWorkoutV2(catalogue),main:{blocks:Object.values(blockFixtures(catalogue,{ladder:true,pyramid:true})).filter(b=>['ladder','pyramid'].includes(b.protocol))}}).forEach(workout => {
    context.workout = plain(workout);
    const timeline = run('buildGeneratedTimeline(workout)');
    const planned = new Map(Tracker.plannedWorkFromTimeline(timeline).map(entry => [entry.occurrenceId, entry]));
    workout.main.blocks.forEach((block, blockIndex) => {
      protocols.add(block.protocol);
      const shape = G.PROTOCOL_SHAPES[block.protocol];
      const phases = timeline.filter(phase => phase.section === 'main' && phase.blockIndex === blockIndex && phase.kind !== 'block-transition');
      // Expand each resolved step exactly as the player does: one phase per side.
      const expected = G.resolveBlockSteps(block).flatMap(step => {
        if (step.kind !== 'exercise') return [step.kind+':'+step.seconds];
        const exercise = block.exercises[step.exerciseIndex];
        const sides = exercise.sidedness === 'per-side' ? exercise.sideOrder || ['right','left'] : [null];
        return sides.map(side => [step.exerciseIndex, step[shape.stepKey], side, step.timed ? step.seconds : null].join('|'));
      });
      const actual = phases.map(phase => phase.kind === 'exercise'
        ? [phase.exerciseIndex, phase[shape.stepKey], phase.side, block.protocol === 'timed_intervals' || block.protocol === 'emom' && phase.timed ? phase.seconds : null].join('|')
        : phase.kind+':'+phase.seconds);
      assert.deepEqual(plain(actual), expected, block.protocol);
      const conditions = plain(G.protocolConditions(block));
      for (const phase of phases) {
        assert.equal(phase.protocol, block.protocol);
        assert.ok(Object.isFrozen(phase.protocolConditions), 'block conditions are immutable');
        assert.deepEqual(plain(phase.protocolConditions), conditions);
        if (phase.kind !== 'exercise') continue;
        if (phase.side) sided++;
        const entry = planned.get(phase.occurrenceId);
        assert.equal(entry.exerciseId, phase.exercise.id);
        assert.equal(entry.prescription.protocol, block.protocol);
        assert.deepEqual(plain(entry.prescription.protocolConditions), conditions);
        assert.equal(entry.prescription[shape.stepKey], phase[shape.stepKey]);
        assert.equal(entry.prescription.seconds, phase.timed ? phase.seconds : null);
      }
    });
  });
  assert.deepEqual([...protocols].sort(), ['emom','ladder','paired_sets','pyramid','rounds','timed_intervals']);
  assert.ok(sided > 0, 'per-side occurrences are covered');
});

// ---- Per-side identity and partial/skipped outcomes per protocol ----

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

test('per-side occurrences stay distinct and outcomes record only what was performed', async () => {
  const {context, run} = app();
  context.savedWorkout = savedWorkoutV2(context.GarageFitData.exercises);
  const plannedWork = plain(Tracker.plannedWorkFromTimeline(run('buildGeneratedTimeline(savedWorkout)')));
  const ids = plannedWork.map(entry => entry.occurrenceId);
  assert.equal(new Set(ids).size, ids.length);
  let time = Date.parse('2026-10-17T08:00:00Z');
  const tracker = Tracker.createTracker({store: GarageFitCoachStore.createStore(new MemoryStorage()), clock: () => new Date(time += 1000),
    source: 'generator', workoutId: 'saved-v2', draftId: 'draft-v2', plannedWork, meaningful: (outcome, planned) => planned.section === 'main'});
  await tracker.start();
  // Rounds: a per-side timed exercise, right side held fully, left side cut short.
  await tracker.recordTimed('main:b0:r1:e1:right', {plannedSeconds: 20, elapsedSeconds: 20});
  await tracker.recordTimed('main:b0:r1:e1:left', {plannedSeconds: 20, elapsedSeconds: 7});
  // Paired sets: one per-side rep side done, the other skipped; the partner set skipped.
  await tracker.recordDone('main:b1:s1:e0:right');
  await tracker.recordSkip('main:b1:s1:e0:left');
  await tracker.recordSkip('main:b1:s1:e1');
  // Timed intervals: one full interval and one not started.
  await tracker.recordTimed('main:b2:c1:e0', {plannedSeconds: 40, elapsedSeconds: 40});
  await tracker.recordTimed('main:b2:c1:e1', {plannedSeconds: 40, elapsedSeconds: 0});
  const statuses = Object.fromEntries(['main:b0:r1:e1:right','main:b0:r1:e1:left','main:b1:s1:e0:right','main:b1:s1:e0:left','main:b1:s1:e1','main:b2:c1:e0','main:b2:c1:e1','main:b0:r1:e0']
    .map(id => [id, tracker.outcome(id) && tracker.outcome(id).status]));
  assert.deepEqual(statuses, {'main:b0:r1:e1:right': 'completed', 'main:b0:r1:e1:left': 'partial', 'main:b1:s1:e0:right': 'completed', 'main:b1:s1:e0:left': 'skipped',
    'main:b1:s1:e1': 'skipped', 'main:b2:c1:e0': 'completed', 'main:b2:c1:e1': 'skipped', 'main:b0:r1:e0': null});
  const result = await tracker.exitEarly();
  assert.equal(result.finalStatus, 'partial');
  assert.deepEqual(result.performedWork.map(outcome => [outcome.occurrenceId, outcome.status]),
    [['main:b0:r1:e1:right','completed'], ['main:b0:r1:e1:left','partial'], ['main:b1:s1:e0:right','completed'], ['main:b2:c1:e0','completed']]);
  assert.deepEqual(plain(result.performedWork[1].sets), [{seconds: 7}]);
  assert.equal(result.plannedWork.length, plannedWork.length, 'the plan is kept whole; unrecorded work is not credited');
});

// ---- Coach required anchors remain rounds-only ----

test('production Coach required anchors allow only rounds', () => {
  const found = [];
  (function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.importance === 'required' && Array.isArray(value.allowedProtocols)) found.push(value);
    Object.values(value).forEach(walk);
  })(GarageFitData.programmes);
  assert.ok(found.length >= 5, found.length+' required anchors');
  for (const anchor of found) assert.deepEqual([...anchor.allowedProtocols], ['rounds'], anchor.requirementId);
});

test('General Strength and Build Arms previews place required anchors in rounds blocks', async () => {
  const {pilot} = require('./helpers/coach-pilot.js');
  for (const programme of ['general-strength-4w', 'build-arms']) {
    const p = pilot(new Map(), programme);
    await p.start();
    await p.begin();
    const preview = p.json('pilot.snapshot().preview');
    assert.ok(preview.plan.prescription.requiredAnchors.length > 0, programme);
    for (const anchor of preview.plan.prescription.requiredAnchors) assert.deepEqual(anchor.allowedProtocols, ['rounds'], programme);
    const anchorBlocks = preview.workout.main.blocks.filter(block => block.exercises.some(exercise => exercise.coachAnchor));
    assert.ok(anchorBlocks.length > 0, programme);
    for (const block of anchorBlocks) assert.equal(block.protocol, 'rounds', programme);
    // The tracked plan of the anchor occurrences carries the rounds protocol and its conditions.
    const anchored = p.json('pilotTracker.plannedWork()').filter(entry => entry.requirementId);
    assert.ok(anchored.length > 0 && anchored.every(entry => entry.prescription.protocol === 'rounds' && Number.isInteger(entry.prescription.round)), programme);
  }
});
