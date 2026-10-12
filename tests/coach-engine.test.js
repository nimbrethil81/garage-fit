const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
global.window = global;
require('../data/exercises.js');
require('../data/sport-profiles.js');
require('../js/coach-model.js');
require('../js/training-history.js');
require('../js/coach-policies.js');
require('../js/coach-engine.js');
require('../js/generator.js');
const fixtures = require('./helpers/coach-policy-fixtures.js');
const {definition, context, today, performance, NOW} = fixtures;
const Model = GarageFitCoachModel, Policies = GarageFitCoachPolicies, Generator = GarageFitGenerator;
const catalogue = GarageFitData.exercises, clone = value => JSON.parse(JSON.stringify(value));
const engine = GarageFitCoachEngine.createEngine({catalogue, assessSessionPrescription: Generator.assessSessionPrescription});
const start = (def = definition(), input = context()) => engine.startProgramme(def, input, NOW).state;
const plan = (state, history = [], override = {}, def = definition()) => engine.planNextSession(def, state, history, today(override));
const apply = (state, result = performance(), history = [], def = definition()) => engine.applySessionResult(def, state, result, history);

test('new modules load in Node without DOM, storage, a clock or Generator', () => {
  const sandbox = vm.createContext({});
  for (const name of ['coach-model','training-history','coach-policies','coach-engine']) vm.runInContext(fs.readFileSync(__dirname+'/../js/'+name+'.js', 'utf8'), sandbox);
  assert.ok(sandbox.GarageFitCoachEngine.createEngine);
  assert.ok(sandbox.GarageFitTrainingHistory.createHistory);
  assert.equal(sandbox.localStorage, undefined);
  assert.equal(sandbox.document, undefined);
});

test('strategy registry dispatches all programme decisions for a future programme type', () => {
  const calls = [], policy = {};
  for (const name of [...Policies.requiredHooks, ...Policies.optionalHooks]) policy[name] = args => {
    calls.push(name);
    if (name === 'validateProgrammeSettings') {
      assert.equal(args.settings.sportId, 'tennis');
      assert.ok(Object.isFrozen(args.settings));
      return;
    }
    const result = Policies.generalStrengthPolicy[name](args);
    return name === 'buildPrescription' ? {...result, sessionRole: 'future-sport-session'} : result;
  };
  const registry = Policies.createRegistry({'future-sport': policy});
  const custom = GarageFitCoachEngine.createEngine({catalogue, registry});
  const def = definition({type: 'future-sport'});
  const state = custom.startProgramme(def, {...context(), programmeSettings: {sportId: 'tennis'}}, NOW).state;
  assert.equal(custom.planNextSession(def, state, [], today()).prescription.sessionRole, 'future-sport-session');
  custom.applySessionResult(def, state, performance(), []);
  assert.deepEqual(new Set(calls), new Set([...Policies.requiredHooks, ...Policies.optionalHooks]));
  assert.throws(() => registry.register('future-sport', policy), /registered once/);
  assert.throws(() => Policies.createRegistry({incomplete: {}}), /must implement/);
  assert.throws(() => custom.startProgramme(definition(), context(), NOW), /Unregistered/);
});

test('feasibility selects deterministic eligible stable anchors and rejects missing equipment/coverage', () => {
  const def = Model.deepFreeze(definition()), input = Model.deepFreeze(context());
  const assessment = engine.assessProgrammeFeasibility(def, input);
  assert.notEqual(assessment.status, 'infeasible');
  assert.deepEqual(assessment.conflicts, []);
  assert.equal(assessment.anchors[0].exerciseId, 'goblet-squat');
  assert.deepEqual(assessment, engine.assessProgrammeFeasibility(def, input));
  const empty = engine.assessProgrammeFeasibility(def, context({equipment: []}));
  assert.equal(empty.status, 'infeasible');
  assert.ok(empty.conflicts.some(item => item.code === 'anchor-unavailable'));
  assert.equal(engine.startProgramme(def, context({equipment: []}), NOW).state, null);
  const selected = start(def, context({anchorSelections: {'anchor-squat': 'kettlebell-goblet-squat'}}));
  assert.equal(selected.anchors[0].exerciseId, 'kettlebell-goblet-squat');
  assert.equal(engine.assessProgrammeFeasibility(def, context({anchorSelections: {'anchor-squat': 'push-up'}})).status, 'infeasible');
});

test('start pins identity/version and fails Generator preflight when required dose cannot fit', () => {
  const def = definition(), state = start(def);
  assert.equal(Model.validate('programme-state', state).valid, true);
  assert.equal(state.programmeDefinitionId, def.id);
  assert.equal(state.programmeDefinitionVersion, 3);
  assert.equal(state.meaningfulSessionsCompleted, 0);
  assert.equal(state.currentTargets.dose.exposure, 0);
  assert.equal(state.lastAppliedSessionResultId, null);
  const tooMuch = definition(); tooMuch.anchorSelectionPolicy.requirements[0].targetSets = 100;
  const result = engine.startProgramme(tooMuch, context(), NOW);
  assert.equal(engine.assessProgrammeFeasibility(tooMuch, context()).status, 'infeasible');
  assert.equal(result.status, 'infeasible');
  assert.equal(result.state, null);
  assert.ok(result.assessment.conflicts.some(item => item.code === 'insufficient-main-time'));
  assert.throws(() => plan(state, [], {}, definition({version: 4})), /pinned/);
  assert.throws(() => engine.startProgramme(def, context(), null), /explicit timestamp/);
});

test('strategies require explicit parameters and keep production definitions separate', () => {
  for (const field of ['anchorSelectionPolicy','progressionPolicy','shortSessionPolicy','maintenancePolicy','doseTargets']) {
    const def = definition(); delete def[field];
    assert.throws(() => start(def), undefined, field);
  }
  assert.deepEqual(Policies.createDefaultRegistry().types(), ['general-strength','build-arms']);
  assert.equal(Policies.generalStrengthDefinition, undefined);
  assert.equal(engine.assessProgrammeFeasibility(definition(), context({duration: 5})).status, 'infeasible');
  assert.throws(() => start(Object.assign(definition(), {extra: () => 1})), error => error.code === 'invalid-record');
  assert.throws(() => start(Object.assign(definition(), {extra: Infinity})), error => error.code === 'invalid-record');
});

test('planning and seeded generation/preview never change state, anchors, summaries or overrides', () => {
  const def = Model.deepFreeze(definition()), state = Model.deepFreeze(start(def));
  const before = clone(state);
  const first = plan(state, [], {easyToday: true, bodyFocus: 'upper', duration: 10}, def);
  assert.notEqual(first.status, 'infeasible');
  assert.equal(first.prescription.difficulty, 'easy');
  assert.equal(first.prescription.bodyFocus, 'upper');
  assert.equal(first.prescription.duration, 10);
  assert.deepEqual(first, plan(state, [], {easyToday: true, bodyFocus: 'upper', duration: 10}, def));
  Generator.generate({catalogue, sessionPrescription: first.prescription, random: () => 0.5});
  assert.deepEqual(state, before);
  assert.deepEqual(state.recentOverrides, []);
});

test('generated/planned work, session start and skipped work earn zero programme dose', () => {
  for (const result of [performance({performedWork: []}), performance({performedWork: null}),
    performance({performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'skipped'}]}),
    performance({finalStatus: 'skipped-before-start', startedAt: null, performedWork: []})]) {
    const state = apply(start(), result);
    assert.equal(state.meaningfulSessionsCompleted, 0);
    assert.equal(state.currentTargets.dose.exposure, 0);
    assert.deepEqual(state.currentTargets.dose.patterns, {});
  }
});

test('meaningful performed sessions advance count; measured partial work earns only its fraction', () => {
  const state = start(), before = clone(state);
  const completed = apply(Model.deepFreeze(state));
  assert.equal(completed.meaningfulSessionsCompleted, 1);
  assert.equal(completed.currentTargets.dose.patterns.squat, 1);
  assert.equal(completed.currentTargets.dose.bodyRegions.lower, 1);
  assert.deepEqual(state, before);
  const partial = performance({finalStatus: 'partial', performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'partial', sets: [{reps: 4}]}]});
  const updated = apply(start(), partial);
  assert.equal(updated.currentTargets.dose.exposure, 0.5);
  assert.equal(updated.meaningfulSessionsCompleted, 0);
  const smallerThreshold = definition(); smallerThreshold.doseTargets.meaningfulExposure = 0.5;
  assert.equal(apply(start(smallerThreshold), partial, [], smallerThreshold).meaningfulSessionsCompleted, 1);
  const noteOnly = apply(start(), performance({performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'partial', note: 'some work'}]}));
  assert.equal(noteOnly.currentTargets.dose.exposure, 0);
  assert.equal(noteOnly.meaningfulSessionsCompleted, 0);
});

test('reapplying the latest or an older result is a deterministic no-op, including progression and overrides', () => {
  const first = performance({overrides: [{type: 'easy-today'}]});
  const state = apply(start(), first);
  assert.deepEqual(apply(state, first), state);
  const next = performance({sessionResultId: 'next', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z'});
  const twice = apply(state, next, [first]);
  assert.equal(twice.meaningfulSessionsCompleted, 2);
  const compacted = {...twice, recentSessionSummaries: []};
  assert.deepEqual(apply(Model.deepFreeze(compacted), first, [first, next]), compacted);
});

test('only performed meaningful results record repeated overrides/substitutions', () => {
  const changes = {overrides: [{type: 'body-focus', value: 'upper'}], substitutions: [{fromExerciseId: 'goblet-squat', toExerciseId: 'kettlebell-goblet-squat'}]};
  const empty = apply(start(), performance({...changes, performedWork: []}));
  assert.equal(empty.recentOverrides.length, 0); assert.equal(empty.recentSubstitutions.length, 0);
  const done = apply(start(), performance(changes));
  assert.equal(done.recentOverrides.length, 1); assert.equal(done.recentSubstitutions.length, 1);
});

test('missed sessions advance only projected calendar progress and create no catch-up queue', () => {
  const state = Model.deepFreeze(start());
  const later = {now: '2026-10-29T08:00:00Z'};
  const missed = plan(state, [], later);
  assert.equal(missed.rationale.nominalProgress, 28);
  assert.equal(missed.rationale.missedSessionResponse.missed, true);
  assert.equal(missed.rationale.missedSessionResponse.catchUpSessions, 0);
  assert.equal(missed.prescription.requiredAnchors[0].targetSets, 2);
  assert.equal(state.meaningfulSessionsCompleted, 0); assert.equal(state.nominalProgress, 0);
  const skip = performance({finalStatus: 'skipped-before-start', startedAt: null, endedAt: later.now, performedWork: []});
  const after = apply(state, skip);
  assert.equal(after.nominalProgress, 28); assert.equal(after.meaningfulSessionsCompleted, 0);
  assert.equal(after.status, 'active');
  assert.deepEqual(plan(after, [skip], later).prescription.requiredAnchors, missed.prescription.requiredAnchors);
});

test('short sessions keep required anchors and primary work before accessories without compressed rest or increased difficulty', () => {
  const state = start(), normal = plan(state).prescription, short = plan(state, [], {duration: 10}).prescription;
  assert.deepEqual(short.requiredAnchors, normal.requiredAnchors);
  assert.deepEqual(short.preferredAnchors.map(item => item.requirementId), ['anchor-row']);
  assert.equal(short.movementPriorities.length, 2);
  assert.deepEqual(short.programmeContext.essentialConstraints, normal.programmeContext.essentialConstraints);
  assert.equal(short.workoutStyle, normal.workoutStyle); assert.equal(short.difficulty, normal.difficulty);
  assert.equal(plan(state, [], {duration: 5}).status, 'infeasible');
  assert.equal(plan(state, [], {duration: 5}).prescription, null);
  const normalWorkout = Generator.generate({catalogue, sessionPrescription: normal, random: () => 0.5});
  const shortWorkout = Generator.generate({catalogue, sessionPrescription: short, random: () => 0.5});
  for (const key of ['exerciseRestSeconds','roundRestSeconds']) assert.equal(shortWorkout.main.blocks[0].prescription[key], normalWorkout.main.blocks[0].prescription[key]);
});

test('maintenance uses the same instance and important anchors with less frequency, volume, accessories and progression pressure', () => {
  const initial = start(), state = engine.enterMaintenanceMode(initial);
  const normal = plan(initial).prescription, maintenance = plan(state).prescription;
  assert.equal(state.programmeInstanceId, initial.programmeInstanceId);
  assert.equal(state.programmeDefinitionVersion, initial.programmeDefinitionVersion);
  assert.equal(maintenance.requiredAnchors[0].exerciseId, normal.requiredAnchors[0].exerciseId);
  assert.equal(maintenance.requiredAnchors[0].targetSets, 1);
  assert.equal(maintenance.requiredAnchors[0].target.minReps, 6, 'challenge preserved');
  assert.equal(maintenance.requiredAnchors[0].progressionIntent, undefined);
  assert.deepEqual(maintenance.preferredAnchors.map(item => item.requirementId), ['anchor-row']);
  assert.equal(maintenance.programmeContext.frequency.minSessionsPerWeek, 1);
  assert.equal(engine.exitMaintenanceMode(state).mode, 'development');
  assert.deepEqual(initial, start());
});

test('pause/resume are pure state transitions and paused programmes cannot plan', () => {
  const state = start(), paused = engine.pauseProgramme(state);
  assert.equal(state.status, 'active'); assert.equal(paused.status, 'paused');
  assert.throws(() => plan(paused), /active programme/);
  assert.deepEqual(engine.resumeProgramme(paused), state);
  assert.equal(engine.enterMaintenanceMode(paused).status, 'paused');
});

test('fixture General Strength prioritises under-served broad patterns based on recent performed exposure', () => {
  const first = performance();
  const second = performance({sessionResultId: 'second', startedAt: '2026-10-02T08:00:00Z', endedAt: '2026-10-02T08:30:00Z'});
  const planned = plan(start(), [first, second], {now: '2026-10-05T08:00:00Z'});
  const priorities = planned.prescription.movementPriorities;
  assert.deepEqual(new Set(priorities.map(item => item.pattern)), new Set(['squat','hinge','lunge','push','pull','core','carry']));
  assert.equal(priorities.find(item => item.pattern === 'squat').priority, 'maintenance');
  assert.equal(priorities.find(item => item.pattern === 'pull').priority, 'primary');
  assert.equal(priorities[0].pattern, 'hinge');
  const stale = plan(start(), [first, second], {now: '2026-10-20T08:00:00Z'});
  assert.equal(stale.prescription.movementPriorities.find(item => item.pattern === 'squat').priority, 'primary');
  const plannedOnly = performance({performedWork: []});
  assert.deepEqual(plan(start(), [plannedOnly], {now: '2026-10-05T08:00:00Z'}).prescription.movementPriorities,
    plan(start(), [], {now: '2026-10-05T08:00:00Z'}).prescription.movementPriorities);
});

test('recovery/sequencing checks recent performed work; preview and skipped work do not enforce a false recovery gap', () => {
  const state = start(), result = performance();
  assert.equal(plan(state, [result], {now: '2026-10-01T10:00:00Z'}).conflicts[0].code, 'recovery-interval');
  assert.notEqual(plan(state, [performance({performedWork: []})], {now: '2026-10-01T10:00:00Z'}).status, 'infeasible');
});

test('comparable actual improvements are interpreted using definition thresholds, including unknown-load holds', () => {
  const first = performance(), initial = apply(start(), first);
  const later = actual => performance({sessionResultId: 'next', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z',
    performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'completed', sets: [actual]}]});
  const reps = later({reps: 9, load: 16, loadUnit: 'kg', loadInterpretation: 'total'});
  assert.equal(apply(initial, reps, [first]).anchors[0].progression.decision, 'progress');
  assert.equal(apply(initial, reps, [first]).anchors[0].progression.comparisons[0].change, 'improved-reps');
  const higherThreshold = definition(); higherThreshold.progressionPolicy.minimumRepsImprovement = 2;
  assert.equal(apply(initial, reps, [first], higherThreshold).anchors[0].progression.decision, 'hold');
  const load = later({reps: 8, load: 18, loadUnit: 'kg', loadInterpretation: 'total'});
  assert.equal(apply(initial, load, [first]).anchors[0].progression.comparisons[0].change, 'improved-load');
  const unknown = later({reps: 10});
  assert.equal(apply(initial, unknown, [first]).anchors[0].progression.comparisons[0].change, 'unknown-load');
  const maintenance = engine.enterMaintenanceMode(initial);
  assert.equal(apply(maintenance, reps, [first]).anchors[0].progression.decision, 'hold-maintenance');
});

test('substituted anchors start new series and never replace the selected exercise or inherit its progression', () => {
  const first = performance(), initial = apply(start(), first);
  const replacement = performance({sessionResultId: 'replacement', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z',
    performedWork: [{occurrenceId: 'main-1', exerciseId: 'kettlebell-goblet-squat', status: 'completed', sets: [{reps: 20, load: 24, loadUnit: 'kg', loadInterpretation: 'total'}]}]});
  const next = apply(initial, replacement, [first]);
  assert.equal(next.anchors[0].exerciseId, 'goblet-squat');
  assert.equal(next.anchors[0].progression.decision, 'new-exercise-series');
  assert.equal(next.anchors[0].progression.comparisons[0].change, 'incomparable');
  assert.equal(plan(next, [first, replacement], {now: '2026-10-05T08:00:00Z'}).prescription.requiredAnchors[0].exerciseId, 'goblet-squat');
});

test('completion needs explicit meaningful-session criteria and calendar passage alone cannot complete', () => {
  const def = definition(); def.completionCriteria.minimumMeaningfulSessions = 1;
  const state = start(def);
  const result = performance({startedAt: '2026-10-30T08:00:00Z', endedAt: '2026-10-30T08:30:00Z'});
  const complete = apply(state, result, [], def);
  assert.equal(complete.status, 'completed');
  assert.throws(() => engine.resumeProgramme(complete), /completed programme/);
  const open = definition({openEnded: true, nominalDurationDays: null, completionCriteria: {minimumMeaningfulSessions: null, requireNominalDuration: false}});
  assert.equal(apply(start(open), result, [], open).status, 'active');
});

test('result application rejects another programme/source and conflicts with immutable history', () => {
  assert.throws(() => apply(start(), performance({programmeInstanceId: 'other'})), /does not belong/);
  assert.throws(() => apply(start(), performance({source: 'generator'})), /does not belong/);
  assert.throws(() => apply(start(), performance(), [performance({feedback: {different: true}})]), error => error.code === 'session-result-conflict');
});

test('logical planning still detects lost required equipment without a Generator adapter', () => {
  const pure = GarageFitCoachEngine.createEngine({catalogue});
  const state = pure.startProgramme(definition(), context(), NOW).state;
  const result = pure.planNextSession(definition(), state, [], today({equipment: []}));
  assert.equal(result.status, 'infeasible'); assert.equal(result.prescription, null);
  assert.equal(result.conflicts[0].code, 'required-anchor-unavailable');
});

test('out-of-order result application adds performed credit without regressing newer anchor evidence', () => {
  const earlier = performance();
  const later = performance({sessionResultId: 'later', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z'});
  const state = apply(start(), later, [earlier]);
  const updated = apply(state, earlier, [earlier, later]);
  assert.equal(updated.meaningfulSessionsCompleted, 2);
  assert.deepEqual(updated.anchors[0].progression, state.anchors[0].progression);
});

test('a partial baseline cannot qualify a later full session for progression by doing more of the plan', () => {
  const partial = performance({finalStatus: 'partial', performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'partial',
    sets: [{reps: 4, load: 16, loadUnit: 'kg', loadInterpretation: 'total'}]}]});
  const later = performance({sessionResultId: 'later', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z'});
  assert.equal(apply(apply(start(), partial), later, [partial]).anchors[0].progression.decision, 'hold');
});

test('unknown catalogue identity cannot award programme-specific dose or a meaningful session', () => {
  const result = performance({performedWork: [{occurrenceId: 'main-1', exerciseId: 'unknown-exercise', status: 'completed'}]});
  const state = apply(start(), result);
  assert.equal(state.meaningfulSessionsCompleted, 0); assert.equal(state.currentTargets.dose.exposure, 0);
});

test('preparation-only and insufficient partial sessions do not reset the meaningful-session cadence', () => {
  const preparation = performance({sessionResultId: 'prep', startedAt: '2026-10-10T08:00:00Z', endedAt: '2026-10-10T08:30:00Z',
    plannedWork: [{occurrenceId: 'prep', exerciseId: 'goblet-squat', section: 'warmup'}],
    performedWork: [{occurrenceId: 'prep', exerciseId: 'goblet-squat', status: 'completed'}]});
  const partial = performance({sessionResultId: 'partial', startedAt: '2026-10-10T08:00:00Z', endedAt: '2026-10-10T08:30:00Z',
    performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'partial', sets: [{reps: 1}]}]});
  for (const result of [preparation, partial]) assert.equal(plan(start(), [result], {now: '2026-10-11T08:00:00Z'}).rationale.missedSessionResponse.missed, true);
  assert.notEqual(plan(start(), [preparation], {now: '2026-10-10T09:00:00Z'}).status, 'infeasible');
});

test('explicit null progression thresholds disable a category without inventing a default', () => {
  const def = definition(); def.progressionPolicy.minimumRepsImprovement = null;
  const first = performance(), state = apply(start(def), first, [], def);
  const improved = performance({sessionResultId: 'later', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z',
    performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'completed', sets: [{reps: 15, load: 16, loadUnit: 'kg', loadInterpretation: 'total'}]}]});
  assert.equal(apply(state, improved, [first], def).anchors[0].progression.decision, 'hold');
});

test('unknown partial exposure remains unknown after later confirmed work', () => {
  const unknown = performance({performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'partial', note: 'stopped'}]});
  const state = apply(start(), unknown);
  const later = performance({sessionResultId: 'later', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z'});
  const updated = apply(state, later, [unknown]);
  assert.equal(updated.currentTargets.dose.exposure, 1);
  assert.equal(updated.currentTargets.dose.confidence, 'unknown');
});
