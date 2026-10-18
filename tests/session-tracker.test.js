// Coach 2: occurrence-based Session Tracker (js/session-tracker.js) and its player hooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAppContext } = require('./helpers/app-context.js');

global.window = global;
require('../js/coach-model.js');
require('../js/coach-store.js');
require('../js/generator.js');
require('../js/session-tracker.js');

const Model = GarageFitCoachModel;
const Tracker = GarageFitSessionTracker;
const plain = value => JSON.parse(JSON.stringify(value));

// ---- Unit fixtures ----

class MemoryStorage {
  constructor() { this.map = new Map(); this.failWrites = null; }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { if (this.failWrites) throw this.failWrites; this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

// Coach store that counts writes, so tests can see exactly when checkpoints persist.
function countingStore(createStore, storage) {
  const base = createStore(storage), counts = {drafts: 0, results: 0};
  const store = Object.assign({}, base, {
    saveSessionDraft(draft) { counts.drafts++; return base.saveSessionDraft(draft); },
    saveSessionResult(result) { counts.results++; return base.saveSessionResult(result); }
  });
  return {store, counts};
}

function clock() {
  let time = Date.parse('2026-10-11T08:00:00Z');
  return () => new Date(time += 1000);
}

// Three work sets of one anchor, an accessory, and timed preparation/cool-down work.
function plannedWork() {
  const rx = extra => Object.assign({type: 'reps', timed: false, reps: 8}, extra);
  return [
    {occurrenceId: 'warmup:e0', exerciseId: 'jumping-jacks', section: 'warmup', blockIndex: null, requirementId: null, prescription: {type: 'timed', timed: true, seconds: 30}},
    {occurrenceId: 'main:b0:s1:e0', exerciseId: 'goblet-squat', section: 'main', blockIndex: 0, requirementId: 'req-squat', prescription: rx({set: 1, suggestedLoad: 16})},
    {occurrenceId: 'main:b0:s1:e1', exerciseId: 'push-up', section: 'main', blockIndex: 0, requirementId: null, prescription: rx({set: 1})},
    {occurrenceId: 'main:b0:s2:e0', exerciseId: 'goblet-squat', section: 'main', blockIndex: 0, requirementId: 'req-squat', prescription: rx({set: 2, suggestedLoad: 16})},
    {occurrenceId: 'main:b0:s2:e1', exerciseId: 'push-up', section: 'main', blockIndex: 0, requirementId: null, prescription: rx({set: 2})},
    {occurrenceId: 'main:b0:s3:e0', exerciseId: 'goblet-squat', section: 'main', blockIndex: 0, requirementId: 'req-squat', prescription: rx({set: 3, suggestedLoad: 16})},
    {occurrenceId: 'cooldown:e0', exerciseId: 'childs-pose', section: 'cooldown', blockIndex: null, requirementId: null, prescription: {type: 'timed', timed: true, seconds: 30}}
  ];
}
const MAIN_IDS = plannedWork().filter(entry => entry.section === 'main').map(entry => entry.occurrenceId);

function tracker(options = {}) {
  const storage = options.storage || new MemoryStorage();
  const {store, counts} = countingStore(GarageFitCoachStore.createStore, storage);
  const instance = Tracker.createTracker(Object.assign({
    store, clock: clock(), source: 'generator', workoutId: 'generated-1', draftId: 'draft-1',
    plannedWork: plannedWork(), meaningful: MAIN_IDS
  }, options));
  return {tracker: instance, store, counts, storage};
}
async function started(options) {
  const setup = tracker(options);
  await setup.tracker.start();
  return setup;
}

// ---- Occurrence identity ----

test('occurrence ids come from timeline structure, never display text', () => {
  const id = Tracker.occurrenceIdFor;
  assert.equal(id({section: 'warmup', exerciseIndex: 2, side: null}), 'warmup:e2');
  assert.equal(id({section: 'cooldown', exerciseIndex: 0, side: 'left'}), 'cooldown:e0:left');
  assert.equal(id({section: 'main', blockIndex: 1, round: 3, exerciseIndex: 0}), 'main:b1:r3:e0');
  assert.equal(id({section: 'main', blockIndex: 0, set: 2, exerciseIndex: 1}), 'main:b0:s2:e1');
  assert.equal(id({section: 'main', blockIndex: 2, cycle: 4, exerciseIndex: 1, side: 'right'}), 'main:b2:c4:e1:right');
  // The same exercise across sets, rounds, cycles, blocks, sections, positions and sides.
  const variants = [
    {section: 'main', blockIndex: 0, set: 1, exerciseIndex: 0}, {section: 'main', blockIndex: 0, set: 2, exerciseIndex: 0},
    {section: 'main', blockIndex: 0, set: 3, exerciseIndex: 0}, {section: 'main', blockIndex: 1, round: 1, exerciseIndex: 0},
    {section: 'main', blockIndex: 1, round: 2, exerciseIndex: 0}, {section: 'main', blockIndex: 1, round: 2, exerciseIndex: 1},
    {section: 'main', blockIndex: 2, cycle: 1, exerciseIndex: 0}, {section: 'main', blockIndex: 2, cycle: 1, exerciseIndex: 0, side: 'right'},
    {section: 'main', blockIndex: 2, cycle: 1, exerciseIndex: 0, side: 'left'}, {section: 'warmup', exerciseIndex: 0}, {section: 'rampup', exerciseIndex: 0}
  ].map(phase => Object.assign({kind: 'exercise', exercise: {id: 'goblet-squat', name: 'Goblet squat'}}, phase));
  const ids = variants.map(id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(id(Object.assign({}, variants[0], {exercise: {id: 'goblet-squat', name: 'Renamed'}})), ids[0]);
});

// Seeded generated workouts played through the real player timeline builders.
function appWithWorkout(options = {}) {
  const storage = new Map();
  const app = loadAppContext(storage, {ownIntrinsics: true});
  if (options.rampupUi !== false) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'rampup-ui.js'), 'utf8'), app, {filename: 'js/rampup-ui.js'});
  const intervals = new Map(); let nextInterval = 1;
  vm.runInContext('var timerNow=Date.now();Date.now=()=>timerNow',app);
  app.setInterval = callback => { const id = nextInterval++; intervals.set(id,()=>{vm.runInContext('timerNow+=1000',app);callback();}); return id; };
  app.clearInterval = id => intervals.delete(id);
  vm.runInContext(`
    state.ownedEquipment=${JSON.stringify(options.equipment || ['dumbbells','kettlebell','bench','trx','bands'])};
    generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:${options.duration || 30},focus:'${options.focus || 'balanced'}',equipment:state.ownedEquipment,random:(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;})(${options.seed || 7})});
  `, app);
  const run = code => vm.runInContext(code, app);
  return {
    app, storage, run,
    // One second of the current phase countdown.
    tick() { const callback = intervals.get(run('generatorState.phaseTimer')); assert.ok(callback, 'phase timer is running'); callback(); },
    phase: () => run('currentGeneratedPhase()'),
    indexWhere: predicate => run('generatorState.timeline').findIndex(predicate)
  };
}

test('generated timeline occurrences have stable unique ids across rounds, sets, cycles and sides', () => {
  const protocols = new Set();
  let sided = 0, repeatedAnchorSets = 0;
  for (const [index, focus] of ['strength','balanced','cardio'].entries()) for (const duration of [20, 30, 45]) for (const rampupUi of [true, false]) {
    const {run} = appWithWorkout({focus, duration, seed: 100 + index * 10 + duration, rampupUi});
    const timeline = run('buildGeneratedTimeline(generatorState.workout)');
    const exercises = timeline.filter(phase => phase.kind === 'exercise');
    assert.ok(exercises.every(phase => typeof phase.occurrenceId === 'string' && phase.occurrenceId));
    assert.ok(timeline.filter(phase => phase.kind !== 'exercise').every(phase => phase.occurrenceId === undefined), 'only executable occurrences get ids');
    const ids = exercises.map(phase => phase.occurrenceId);
    assert.equal(new Set(ids).size, ids.length, focus+' '+duration+' ids are unique');
    // Deterministic from structure, and independent of display text.
    assert.deepEqual(plain(run('buildGeneratedTimeline(generatorState.workout)').filter(phase => phase.kind === 'exercise').map(phase => phase.occurrenceId)), plain(ids));
    run("generatorState.workout.main.blocks.forEach(block=>block.exercises.forEach(exercise=>{exercise.name='Renamed '+exercise.name}))");
    assert.deepEqual(plain(run('buildGeneratedTimeline(generatorState.workout)').filter(phase => phase.kind === 'exercise').map(phase => phase.occurrenceId)), plain(ids));
    assert.equal(Tracker.plannedWorkFromTimeline(timeline).length, ids.length);
    exercises.forEach(phase => { if (phase.protocol) protocols.add(phase.protocol); if (phase.side) sided++; });
    run('generatorState.workout.main.blocks').forEach((block, blockIndex) => {
      if (block.protocol !== 'paired_sets') return;
      const firstExercise = exercises.filter(phase => phase.section === 'main' && phase.blockIndex === blockIndex && phase.exerciseIndex === 0 && !phase.side);
      if (!firstExercise.length) return;
      assert.equal(firstExercise.length, block.prescription.sets, 'one occurrence per work set');
      assert.equal(new Set(firstExercise.map(phase => phase.occurrenceId)).size, block.prescription.sets);
      repeatedAnchorSets++;
    });
  }
  assert.deepEqual([...protocols].sort(), ['complex','density','emom','paired_sets','rounds','timed_intervals']);
  assert.ok(sided > 0, 'per-side occurrences are covered');
  assert.ok(repeatedAnchorSets > 0, 'repeated work sets of one exercise are covered');
});

test('Previous and forward navigation revisit the same occurrence id', () => {
  const {app, phase, indexWhere} = appWithWorkout();
  app.startGeneratedWorkout();
  const second = indexWhere(p => p.kind === 'exercise' && p.section === 'main' && p.blockIndex === 1);
  app.enterGeneratedPhase(second);
  const id = phase().occurrenceId;
  app.previousGeneratedPhase();
  const previousId = phase().occurrenceId;
  assert.notEqual(previousId, id);
  app.enterGeneratedPhase(second);
  assert.equal(phase().occurrenceId, id);
  app.previousGeneratedPhase();
  assert.equal(phase().occurrenceId, previousId);
});

// ---- Outcome semantics ----

test('timed work derives completed, partial and skipped from the timer', async () => {
  assert.deepEqual(Tracker.timedOutcome(30, 30), {status: 'completed', actualSeconds: 30});
  assert.deepEqual(Tracker.timedOutcome(30, 18), {status: 'partial', actualSeconds: 18});
  assert.deepEqual(Tracker.timedOutcome(30, 0), {status: 'skipped', actualSeconds: 0});
  assert.deepEqual(Tracker.timedOutcome(30, 31), {status: 'completed', actualSeconds: 30});
  assert.deepEqual(Tracker.timedOutcome(30, -2), {status: 'skipped', actualSeconds: 0});

  const {tracker: t} = await started();
  await t.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 30});
  assert.deepEqual(plain(t.outcome('warmup:e0')), {occurrenceId: 'warmup:e0', exerciseId: 'jumping-jacks', status: 'completed', sets: [{seconds: 30}]});
  await t.recordTimed('cooldown:e0', {plannedSeconds: 30, elapsedSeconds: 18});
  assert.deepEqual(plain(t.outcome('cooldown:e0')), {occurrenceId: 'cooldown:e0', exerciseId: 'childs-pose', status: 'partial', sets: [{seconds: 18}]});
  const {tracker: fresh} = await started();
  await fresh.recordTimed('cooldown:e0', {plannedSeconds: 30, elapsedSeconds: 0});
  assert.deepEqual(plain(fresh.outcome('cooldown:e0')), {occurrenceId: 'cooldown:e0', exerciseId: 'childs-pose', status: 'skipped', sets: [{seconds: 0}]});
});

test('rep Done and Skip are distinct outcomes; partial needs genuine evidence', async () => {
  const {tracker: t} = await started();
  await t.recordDone('main:b0:s1:e1');
  await t.recordSkip('main:b0:s2:e1');
  assert.equal(t.outcome('main:b0:s1:e1').status, 'completed');
  assert.equal(t.outcome('main:b0:s2:e1').status, 'skipped');
  // Ordinary accessories need no reps or load.
  assert.equal(t.outcome('main:b0:s1:e1').sets, undefined);
  assert.throws(() => t.recordPartial('main:b0:s1:e1'), /needs logged sets or a note/);
  await t.recordPartial('main:b0:s1:e1', {note: 'stopped after 5 reps'});
  assert.equal(t.outcome('main:b0:s1:e1').status, 'partial');
  assert.throws(() => t.recordDone('main:b9:s1:e0'), /Unknown occurrenceId/);
});

test('unknown anchor load and reps stay unknown rather than copying the plan', async () => {
  const {tracker: t} = await started();
  await t.recordAnchor('main:b0:s1:e0', {status: 'completed', sets: [{reps: 8}]});
  const outcome = plain(t.outcome('main:b0:s1:e0'));
  assert.deepEqual(outcome.sets, [{reps: 8}], 'no load copied from suggestedLoad');
  assert.equal(outcome.targetAchieved, undefined, 'target achievement is unknown unless confirmed');
  await t.recordAnchor('main:b0:s2:e0', {status: 'completed', sets: [{reps: null, load: null}]});
  assert.deepEqual(plain(t.outcome('main:b0:s2:e0').sets), [{reps: null, load: null}]);
  // When supplied: actual reps, numeric load, unit, interpretation and target achievement.
  await t.recordAnchor('main:b0:s3:e0', {status: 'partial', sets: [{reps: 6, load: 12, loadUnit: 'kg', loadInterpretation: 'per-item'}], targetAchieved: false});
  assert.deepEqual(plain(t.outcome('main:b0:s3:e0')), {occurrenceId: 'main:b0:s3:e0', exerciseId: 'goblet-squat', status: 'partial', sets: [{reps: 6, load: 12, loadUnit: 'kg', loadInterpretation: 'per-item'}], targetAchieved: false});
  // A load without a unit is refused and leaves the earlier outcome in place.
  assert.throws(() => t.recordAnchor('main:b0:s3:e0', {status: 'completed', sets: [{reps: 8, load: 16}]}), error => error.code === 'invalid-record');
  assert.equal(t.outcome('main:b0:s3:e0').status, 'partial');
  assert.throws(() => t.recordAnchor('main:b0:s1:e1', {status: 'completed'}), /not linked to an anchor requirement/);

  // Three work sets of one anchor stay three occurrences; the requirement aggregates them.
  const [anchor] = plain(t.draft().anchorResults);
  assert.deepEqual(anchor, {requirementId: 'req-squat', exerciseId: 'goblet-squat', occurrenceId: null, status: 'partial', sets: [{reps: 8}, {reps: null, load: null}, {reps: 6, load: 12, loadUnit: 'kg', loadInterpretation: 'per-item'}]});
});

test('substitutions record what was actually performed, one per occurrence', async () => {
  const {tracker: t} = await started();
  await t.recordSubstitution({occurrenceId: 'main:b0:s1:e1', toExerciseId: 'incline-push-up', reason: 'wrist'});
  await t.recordSubstitution({occurrenceId: 'main:b0:s1:e1', toExerciseId: 'knee-push-up'});
  await t.recordDone('main:b0:s1:e1');
  const draft = plain(t.draft());
  assert.deepEqual(draft.substitutions, [{occurrenceId: 'main:b0:s1:e1', requirementId: null, fromExerciseId: 'push-up', toExerciseId: 'knee-push-up', reason: null}]);
  assert.equal(t.outcome('main:b0:s1:e1').exerciseId, 'knee-push-up');
  assert.equal(draft.plannedWork.find(entry => entry.occurrenceId === 'main:b0:s1:e1').exerciseId, 'push-up', 'the plan is unchanged');
  assert.throws(() => t.recordSubstitution({occurrenceId: 'main:b0:s2:e1', toExerciseId: 'push-up'}), error => error.code === 'invalid-record');
  assert.equal(plain(t.draft()).substitutions.length, 1);
});

// ---- Previous / revisit ----

test('revisiting an occurrence replaces its outcome and never double-credits it', async () => {
  const {tracker: t} = await started();
  await t.recordDone('main:b0:s1:e0');
  await t.recordDone('main:b0:s1:e0');
  assert.equal(t.draft().occurrenceOutcomes.filter(outcome => outcome.occurrenceId === 'main:b0:s1:e0').length, 1);
  // Moving forward past it again without doing anything keeps the performed work...
  await t.recordSkip('main:b0:s1:e0');
  assert.equal(t.outcome('main:b0:s1:e0').status, 'completed');
  await t.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 30});
  await t.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 0});
  assert.equal(t.outcome('warmup:e0').status, 'completed');
  // ...while performing it again replaces the outcome, and a deliberate record is honoured.
  await t.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 12});
  assert.deepEqual(plain(t.outcome('warmup:e0').sets), [{seconds: 12}]);
  await t.recordOutcome('main:b0:s1:e0', {status: 'skipped'});
  assert.equal(t.outcome('main:b0:s1:e0').status, 'skipped');
  const result = await t.complete();
  assert.equal(result.performedWork.filter(outcome => outcome.occurrenceId === 'warmup:e0').length, 1);
});

test('Previous in the tracked player cannot double-credit an occurrence', async () => {
  const {app, run, phase, indexWhere} = appWithWorkout();
  const store = app.GarageFitCoachStore.createStore(app.localStorage);
  app.startGeneratedWorkout({store, source: 'generator', meaningful: (outcome, planned) => planned.section === 'main'});
  const tracker = run('generatorState.tracker');
  const repIndex = indexWhere(p => p.kind === 'exercise' && p.section === 'main' && !p.timed);
  assert.ok(repIndex > 0, 'workout has a rep-based Main occurrence');
  app.enterGeneratedPhase(repIndex);
  const id = phase().occurrenceId;
  app.completeWorkoutMovement();
  app.previousGeneratedPhase();
  assert.equal(phase().occurrenceId, id);
  app.completeWorkoutMovement();
  app.previousGeneratedPhase();
  app.completeWorkoutMovement();
  await tracker.flush();
  const draft = plain(await store.loadSessionDraft());
  assert.deepEqual(draft.occurrenceOutcomes.map(outcome => [outcome.occurrenceId, outcome.status]), [[id, 'completed']]);
  assert.equal(run('generatorState.trackerError'), null);
});

// ---- Finalisation ----

test('normal end finalises a valid immutable completed Session Result', async () => {
  const {tracker: t, store, counts} = await started({recordResults: true});
  await t.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 30});
  await t.recordAnchor('main:b0:s1:e0', {status: 'completed', sets: [{reps: 8, load: 16, loadUnit: 'kg', loadInterpretation: 'total'}], targetAchieved: true});
  await t.recordSkip('main:b0:s1:e1');
  const result = await t.complete({actualDurationSeconds: 1500});
  assert.equal(result.finalStatus, 'completed');
  assert.equal(Model.validate('session-result', result).valid, true);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.performedWork[0]));
  assert.equal(result.sessionResultId, 'result:draft-1');
  assert.equal(result.actualDurationSeconds, 1500);
  assert.ok(Date.parse(result.endedAt) > Date.parse(result.startedAt));
  assert.equal(counts.results, 1);
  assert.deepEqual(plain(await store.getSessionResult('result:draft-1')), plain(result));
  const draft = await store.loadSessionDraft();
  assert.deepEqual(plain(draft.finalisation), {state: 'finalised', sessionResultId: 'result:draft-1'});
  assert.throws(() => t.recordDone('main:b0:s2:e0'), /already finalised/);
  await assert.rejects(t.complete(), /already finalised/);
});

test('only performed outcomes enter performedWork; the rest stay planned-only', async () => {
  const {tracker: t} = await started();
  await t.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 30});
  await t.recordAnchor('main:b0:s1:e0', {status: 'partial', sets: [{reps: 5}]});
  await t.recordSkip('main:b0:s1:e1');
  await t.recordTimed('cooldown:e0', {plannedSeconds: 30, elapsedSeconds: 0});
  const result = await t.complete();
  assert.deepEqual(result.performedWork.map(outcome => [outcome.occurrenceId, outcome.status]), [['warmup:e0','completed'], ['main:b0:s1:e0','partial']]);
  assert.equal(result.plannedWork.length, plannedWork().length, 'every planned occurrence is kept as planned');
  // Unreached work is never credited automatically, including the anchor's later sets.
  assert.deepEqual(plain(result.anchorResults), [{requirementId: 'req-squat', exerciseId: 'goblet-squat', occurrenceId: null, status: 'partial', sets: [{reps: 5}]}]);
  // Nothing defaults the duration: unknown stays unknown.
  assert.equal(result.actualDurationSeconds, null);
});

test('early exit is partial with meaningful work and abandoned without it', async () => {
  const meaningful = await started();
  await meaningful.tracker.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 30});
  await meaningful.tracker.recordDone('main:b0:s1:e1');
  assert.equal((await meaningful.tracker.exitEarly()).finalStatus, 'partial');

  const warmupOnly = await started();
  await warmupOnly.tracker.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 30});
  await warmupOnly.tracker.recordSkip('main:b0:s1:e0');
  const abandoned = await warmupOnly.tracker.exitEarly();
  assert.equal(abandoned.finalStatus, 'abandoned');
  assert.deepEqual(abandoned.performedWork.map(outcome => outcome.occurrenceId), ['warmup:e0']);

  // The caller decides what is meaningful, by ids or by predicate; the tracker never guesses.
  const predicate = await started({meaningful: (outcome, planned) => planned.section === 'warmup'});
  await predicate.tracker.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 10});
  assert.equal((await predicate.tracker.exitEarly()).finalStatus, 'partial');
  const untold = await started({meaningful: undefined});
  await untold.tracker.recordDone('main:b0:s1:e0');
  await assert.rejects(untold.tracker.exitEarly(), /meaningful-work context/);
  assert.equal((await untold.tracker.exitEarly({meaningful: ['main:b0:s1:e0']})).finalStatus, 'partial');
});

test('skipped-before-start is an explicit result with no performed work', async () => {
  const {tracker: t, counts} = tracker({recordResults: true});
  const result = await t.skipBeforeStart();
  assert.equal(result.finalStatus, 'skipped-before-start');
  assert.equal(result.startedAt, null);
  assert.deepEqual(plain(result.performedWork), []);
  assert.equal(result.anchorResults[0].status, 'skipped');
  assert.equal(Model.validate('session-result', result).valid, true);
  assert.equal(counts.drafts, 0, 'no draft is needed for a session that never started');
  assert.equal(counts.results, 1);
  const {tracker: begun} = await started();
  await assert.rejects(begun.skipBeforeStart(), /cannot be skipped before start/);
});

test('a failed finalisation write can be retried with the same result', async () => {
  const storage = new MemoryStorage();
  const {tracker: t, store} = await started({storage, recordResults: true});
  await t.recordDone('main:b0:s1:e0');
  storage.failWrites = Object.assign(new Error('quota'), {name: 'QuotaExceededError'});
  await assert.rejects(t.complete(), error => error.code === 'storage-write-failed');
  assert.throws(() => t.recordDone('main:b0:s2:e0'), /already finalised/, 'recording closes once finalisation begins');
  storage.failWrites = null;
  const result = await t.exitEarly();
  assert.equal(result.finalStatus, 'completed', 'the decided outcome is kept');
  assert.deepEqual(plain(await store.getSessionResult(result.sessionResultId)), plain(result));
});

test('Session Results are only saved when the execution context opts in', async () => {
  const {tracker: t, store, counts} = await started();
  await t.recordDone('main:b0:s1:e0');
  await t.complete();
  assert.equal(counts.results, 0);
  assert.deepEqual(plain((await store.listSessionResults()).results), []);
});

// ---- Persistence ----

test('a session role id survives draft, recovery and the immutable result; absence stays valid', async () => {
  const storage = new MemoryStorage();
  const {tracker: t} = tracker({storage, sessionRole: 'movement-conditioning'});
  await t.start();
  const draft = await GarageFitCoachStore.createStore(storage).loadSessionDraft();
  assert.equal(draft.sessionRole, 'movement-conditioning');
  const resumed = await Tracker.resumeTracker({store: GarageFitCoachStore.createStore(storage), clock: clock(), meaningful: MAIN_IDS});
  await resumed.recordDone('main:b0:s1:e1');
  const result = await resumed.exitEarly();
  assert.equal(result.sessionRole, 'movement-conditioning');
  assert.equal(Model.validate('session-result', result).valid, true);
  const plainSetup = tracker();
  await plainSetup.tracker.start();
  assert.equal('sessionRole' in plainSetup.tracker.draft(), false);
});


test('the draft persists at meaningful actions and reloads through coach-store.js', async () => {
  const storage = new MemoryStorage();
  const {tracker: t, counts} = tracker({storage});
  await t.start();
  assert.equal(counts.drafts, 1, 'tracked session start');
  await t.recordTimed('warmup:e0', {plannedSeconds: 30, elapsedSeconds: 30});
  await t.recordDone('main:b0:s1:e1');
  await t.recordAnchor('main:b0:s1:e0', {status: 'completed', sets: [{reps: 8}]});
  await t.recordSubstitution({occurrenceId: 'main:b0:s2:e1', toExerciseId: 'knee-push-up'});
  assert.equal(counts.drafts, 5);
  assert.equal(t.writeCount, 5);

  // A fresh store over the same storage sees all the evidence recorded so far.
  const reloaded = await GarageFitCoachStore.createStore(storage).loadSessionDraft();
  assert.equal(Model.validate('session-draft', reloaded).valid, true);
  assert.equal(reloaded.draftId, 'draft-1');
  assert.deepEqual(plain(reloaded.finalisation), {state: 'in-progress', sessionResultId: null});
  assert.deepEqual(reloaded.occurrenceOutcomes.map(outcome => [outcome.occurrenceId, outcome.status]), [['warmup:e0','completed'], ['main:b0:s1:e0','completed'], ['main:b0:s1:e1','completed']]);
  assert.equal(reloaded.substitutions[0].toExerciseId, 'knee-push-up');

  // It is enough to continue and finalise later.
  const resumed = await Tracker.resumeTracker({store: GarageFitCoachStore.createStore(storage), clock: clock(), meaningful: MAIN_IDS});
  await resumed.recordDone('main:b0:s2:e1');
  assert.equal(resumed.outcome('main:b0:s2:e1').exerciseId, 'knee-push-up');
  const result = await resumed.exitEarly();
  assert.equal(result.finalStatus, 'partial');
  assert.equal(result.performedWork.length, 4);
  assert.equal(await Tracker.resumeTracker({store: GarageFitCoachStore.createStore(storage)}), null, 'a finalised draft is not resumed');
});

test('timer ticks never write the draft; the timed outcome is one checkpoint', async () => {
  const {app, run, tick, phase, indexWhere} = appWithWorkout();
  const {store, counts} = countingStore(app.GarageFitCoachStore.createStore, app.localStorage);
  app.startGeneratedWorkout({store, source: 'generator', meaningful: (outcome, planned) => planned.section === 'main'});
  const tracker = run('generatorState.tracker');
  await tracker.flush();
  assert.equal(counts.drafts, 1, 'tracked session start');

  // Full timer completion -> completed with the planned seconds.
  const timedIndex = indexWhere(p => p.kind === 'exercise' && p.timed && p.seconds > 18);
  assert.ok(timedIndex > 0);
  app.enterGeneratedPhase(timedIndex);
  const {occurrenceId, seconds} = phase();
  for (let elapsed = 1; elapsed < seconds; elapsed++) tick();
  await tracker.flush();
  assert.equal(counts.drafts, 1, 'no write per second');
  tick();
  await tracker.flush();
  assert.equal(counts.drafts, 2);
  assert.deepEqual(plain(tracker.outcome(occurrenceId)), {occurrenceId, exerciseId: run('generatorState.timeline')[timedIndex].exercise.id, status: 'completed', sets: [{seconds}]});

  // Rest and transition countdowns are not exercise occurrences: no writes at all.
  const restIndex = indexWhere(p => ['rest','interval-rest','set-change','round-rest','set-rest','transition'].includes(p.kind));
  app.enterGeneratedPhase(restIndex);
  const restSeconds = phase().seconds;
  for (let elapsed = 0; elapsed < restSeconds; elapsed++) tick();
  await tracker.flush();
  assert.equal(counts.drafts, 2);

  // Early Skip after 18s -> partial with the measured seconds; immediate Skip -> skipped.
  app.enterGeneratedPhase(timedIndex);
  for (let elapsed = 0; elapsed < 18; elapsed++) tick();
  app.completeWorkoutMovement();
  await tracker.flush();
  assert.deepEqual(plain(tracker.outcome(occurrenceId).sets), [{seconds: 18}]);
  assert.equal(tracker.outcome(occurrenceId).status, 'partial');
  const otherTimed = indexWhere((p, index) => index !== timedIndex && p.kind === 'exercise' && p.timed);
  app.enterGeneratedPhase(otherTimed);
  const otherId = phase().occurrenceId;
  app.completeWorkoutMovement();
  await tracker.flush();
  assert.deepEqual(plain(tracker.outcome(otherId)), {occurrenceId: otherId, exerciseId: run('generatorState.timeline')[otherTimed].exercise.id, status: 'skipped', sets: [{seconds: 0}]});
  assert.equal(counts.drafts, 4);
});

// ---- Player integration ----

async function playToEnd(harness) {
  const {app, run} = harness;
  for (let guard = 0; run('workoutState.running') && guard < 2000; guard++) {
    const emom=run('isEmomPhase()');
    await app.completeWorkoutMovement();
    // EMOM Done ends work, then the original minute boundary advances playback.
    if(emom&&run('isEmomPhase()')){run('timerNow+=generatorState.remaining*1000');await app.updateEmomMinute();}
  }
  assert.equal(run('workoutState.running'), false);
}

test('generated playback without an execution context stays untracked and writes no Coach records', async () => {
  const harness = appWithWorkout();
  harness.app.startGeneratedWorkout();
  assert.equal(harness.run('generatorState.tracker'), null);
  await playToEnd(harness);
  assert.deepEqual([...harness.storage.keys()].filter(key => key.startsWith('gf_coach_')), []);
  assert.ok(harness.storage.has('gf_generator_history'), 'the Generator variety history is still written');
  assert.equal(harness.app.document.getElementById('doneTitle').textContent, 'Done');
});

test('a tracked player run records before advancing and finalises at the normal end', async () => {
  const harness = appWithWorkout();
  const {app, run} = harness;
  const store = app.GarageFitCoachStore.createStore(app.localStorage);
  app.startGeneratedWorkout({store, source: 'generator', recordResults: true, meaningful: (outcome, planned) => planned.section === 'main'});
  const tracker = run('generatorState.tracker');
  const planned = tracker.plannedWork();
  await playToEnd(harness);
  const result = await run('generatorState.trackedResult');
  assert.equal(result.finalStatus, 'completed');
  assert.equal(result.workoutId, run('generatorState.workout.id'));
  assert.equal(result.plannedWork.length, planned.length);
  // Every occurrence was acted on in order; rep work Done, timed work skipped immediately.
  assert.deepEqual(plain(result.performedWork.map(outcome => outcome.occurrenceId)), plain(planned.filter(entry => !entry.prescription.timed).map(entry => entry.occurrenceId)));
  assert.ok(result.performedWork.every(outcome => outcome.status === 'completed'));
  assert.equal(Model.validate('session-result', plain(result)).valid, true);
  assert.equal((await store.listSessionResults()).results.length, 1);
  assert.equal(run('generatorState.trackerError'), null);
});

test('controlled early exit from the tracked player finalises partial or abandoned', async () => {
  for (const [doMain, expected] of [[true, 'partial'], [false, 'abandoned']]) {
    const harness = appWithWorkout();
    const {app, run, indexWhere} = harness;
    const store = app.GarageFitCoachStore.createStore(app.localStorage);
    app.startGeneratedWorkout({store, source: 'generator', meaningful: (outcome, planned) => planned.section === 'main'});
    app.completeWorkoutMovement(); // skip get ready
    if (doMain) {
      app.enterGeneratedPhase(indexWhere(p => p.kind === 'exercise' && p.section === 'main' && !p.timed));
      app.completeWorkoutMovement();
    }
    app.openExitDialog('workout');
    app.confirmExitChoice();
    const result = await run('generatorState.trackedResult');
    assert.equal(result.finalStatus, expected);
    assert.equal(result.performedWork.length, doMain ? 1 : 0);
    assert.deepEqual(plain((await store.loadSessionDraft()).finalisation), {state: 'finalised', sessionResultId: result.sessionResultId});
    assert.equal((await store.listSessionResults()).results.length, 0, 'history stays dormant without recordResults');
  }
});
