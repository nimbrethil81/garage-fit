// Coach 1: versioned Coach domain contracts (js/coach-model.js).
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
require('../js/coach-model.js');

const Model = GarageFitCoachModel;
const { validate, assertValid, upgradeRecord, CoachError } = Model;
const { programmeState, prescription, anchor, sessionResult, sessionDraft } = require('./helpers/coach-fixtures.js');

function errorPaths(kind, record) { return validate(kind, record).errors.map(error => error.path); }
function assertInvalidAt(kind, record, path) {
  const result = validate(kind, record);
  assert.equal(result.valid, false, kind+' should be invalid');
  assert.ok(result.errors.some(error => error.path === path), 'expected an error at '+path+', got '+JSON.stringify(result.errors));
}

// ---- Programme Definition identity and Programme State ----

test('a Programme State pins its Programme Definition id, version and instance', () => {
  assert.deepEqual(validate('programme-state', programmeState()), {valid: true, errors: []});
  assert.deepEqual(Model.programmeDefinitionRef(programmeState()), {
    programmeDefinitionId: 'general-strength', programmeDefinitionVersion: 1, programmeInstanceId: 'prog-1'
  });
  ['programmeDefinitionId','programmeDefinitionVersion','programmeInstanceId'].forEach(field => {
    const record = programmeState(); delete record[field];
    assertInvalidAt('programme-state', record, 'programme-state.'+field);
  });
  assertInvalidAt('programme-state', programmeState({programmeDefinitionVersion: 1.5}), 'programme-state.programmeDefinitionVersion');
  assertInvalidAt('programme-state', programmeState({programmeDefinitionVersion: '1'}), 'programme-state.programmeDefinitionVersion');
});

test('Programme State status and mode are closed vocabularies', () => {
  Model.PROGRAMME_STATUSES.forEach(status => assert.equal(validate('programme-state', programmeState({status})).valid, true));
  Model.PROGRAMME_MODES.forEach(mode => assert.equal(validate('programme-state', programmeState({mode})).valid, true));
  assertInvalidAt('programme-state', programmeState({status: 'finished'}), 'programme-state.status');
  assertInvalidAt('programme-state', programmeState({mode: 'deload'}), 'programme-state.mode');
});

test('invalid Programme State values are rejected, not reinterpreted', () => {
  assertInvalidAt('programme-state', programmeState({meaningfulSessionsCompleted: -1}), 'programme-state.meaningfulSessionsCompleted');
  assertInvalidAt('programme-state', programmeState({meaningfulSessionsCompleted: '3'}), 'programme-state.meaningfulSessionsCompleted');
  assertInvalidAt('programme-state', programmeState({nominalProgress: Infinity}), 'programme-state.nominalProgress');
  assertInvalidAt('programme-state', programmeState({startedAt: '1 Oct 2026'}), 'programme-state.startedAt');
  assertInvalidAt('programme-state', programmeState({anchors: {}}), 'programme-state.anchors');
  assertInvalidAt('programme-state', programmeState({currentTargets: {fn: () => 1}}), 'programme-state.currentTargets.fn');
  assertInvalidAt('programme-state', programmeState({lastAppliedSessionResultId: ''}), 'programme-state.lastAppliedSessionResultId');
  assertInvalidAt('programme-state', programmeState({sessionResults: []}), 'programme-state.sessionResults');
});

test('Programme State does not hold complete Session Results as children', () => {
  // Only a pointer to the last applied result and bounded summaries belong in state.
  assertInvalidAt('programme-state', programmeState({sessionResults: [sessionResult()]}), 'programme-state.sessionResults');
  assert.equal(validate('programme-state', programmeState({lastAppliedSessionResultId: 'result-1', recentSessionSummaries: [{sessionResultId: 'result-1', finalStatus: 'completed'}]})).valid, true);
});

test('unknown Programme State fields may be null or absent', () => {
  const minimal = {schemaVersion: 1, programmeInstanceId: 'prog-1', programmeDefinitionId: 'general-strength', programmeDefinitionVersion: 1, status: 'active', mode: 'development'};
  assert.equal(validate('programme-state', minimal).valid, true);
  assert.equal(validate('programme-state', Object.assign({}, minimal, {startedAt: null, nominalProgress: null, meaningfulSessionsCompleted: null, anchors: null, currentTargets: null, lastAppliedSessionResultId: null})).valid, true);
});

// ---- Session Prescription ----

test('a Session Prescription carries the Coach-to-Generator boundary fields', () => {
  assert.deepEqual(validate('session-prescription', prescription()), {valid: true, errors: []});
  ['prescriptionId','programmeInstanceId','sessionRole'].forEach(field => {
    const record = prescription(); delete record[field];
    assertInvalidAt('session-prescription', record, 'session-prescription.'+field);
  });
});

test('Session Prescription Generator vocabulary matches js/generator.js', () => {
  assert.deepEqual(Model.WORKOUT_DIFFICULTIES, GarageFitGenerator.WORKOUT_DIFFICULTIES);
  assert.deepEqual(Model.WORKOUT_BODY_FOCUSES, GarageFitGenerator.WORKOUT_BODY_FOCUSES);
  assert.deepEqual(Model.MAIN_PROTOCOLS, [...GarageFitGenerator.MAIN_PROTOCOLS]);
  Model.WORKOUT_STYLES.forEach(focus => assert.doesNotThrow(() => GarageFitGenerator.generate({catalogue: GarageFitData.exercises, duration: 10, focus, equipment: [], random: () => .5})));
});

test('invalid Session Prescriptions are rejected', () => {
  assertInvalidAt('session-prescription', prescription({workoutStyle: 'hiit'}), 'session-prescription.workoutStyle');
  assertInvalidAt('session-prescription', prescription({difficulty: 'brutal'}), 'session-prescription.difficulty');
  assertInvalidAt('session-prescription', prescription({bodyFocus: 'legs'}), 'session-prescription.bodyFocus');
  assertInvalidAt('session-prescription', prescription({duration: 0}), 'session-prescription.duration');
  assertInvalidAt('session-prescription', prescription({equipment: 'dumbbells'}), 'session-prescription.equipment');
  assertInvalidAt('session-prescription', prescription({requiredAnchors: [anchor({allowedProtocols: ['pyramid']})]}), 'session-prescription.requiredAnchors[0].allowedProtocols[0]');
  assertInvalidAt('session-prescription', prescription({requiredAnchors: [anchor({loadInterpretation: 'each'})]}), 'session-prescription.requiredAnchors[0].loadInterpretation');
  // Anchor lists must agree with their importance, and requirement ids are unique across both.
  assertInvalidAt('session-prescription', prescription({preferredAnchors: [anchor({requirementId: 'req-2'})]}), 'session-prescription.preferredAnchors[0].importance');
  assertInvalidAt('session-prescription', prescription({preferredAnchors: [anchor({importance: 'preferred'})]}), 'session-prescription.anchors[1].requirementId');
});

test('Session Prescription priorities and constraints use bounded semantic contracts', () => {
  const record = prescription({
    movementPriorities: [{requirementId:'push',pattern:'push',priority:'primary'}],
    bodyRegionPriorities: [{requirementId:'upper',bodyRegion:'upper',priority:'high'}],
    avoidConstraints: [{requirementId:'avoid',exerciseId:'pull-up',importance:'soft'}],
    protocolConstraints: [{requirementId:'protocol',anchorRequirementId:'req-1',importance:'hard',allowedProtocols:['rounds']}],
    variationPreference:'varied'
  });
  assert.equal(validate('session-prescription',record).valid,true);
  assert.deepEqual(Model.MOVEMENT_PATTERNS,[...GarageFitGenerator.VALID_PATTERNS]);
  for(const patch of [
    {movementPriorities:['push']},
    {movementPriorities:[{requirementId:'push',pattern:'push',priority:99}]},
    {bodyRegionPriorities:[{requirementId:'upper',bodyRegion:'upper',priority:'high',weight:100}]},
    {avoidConstraints:[{requirementId:'avoid',importance:'hard'}]},
    {avoidConstraints:[{requirementId:'avoid',importance:'hard',exerciseId:'pull-up',pattern:'pull'}]},
    {protocolConstraints:[{requirementId:'protocol',anchorRequirementId:'absent',importance:'hard',allowedProtocols:['rounds']}]},
    {variationPreference:300},
    {movementPriorities:[{requirementId:'req-1',pattern:'push',priority:'primary'}]}
  ]) assert.equal(validate('session-prescription',Object.assign({},record,patch)).valid,false,JSON.stringify(patch));
});

test('anchor requirements carry rep range or timed targets with interpretable loads', () => {
  const timed = anchor({target: {type: 'timed', seconds: 40}, suggestedLoad: null, loadUnit: null});
  assert.equal(validate('session-prescription', prescription({requiredAnchors: [timed]})).valid, true);
  const perHand = anchor({suggestedLoad: 12, loadUnit: 'kg', loadInterpretation: 'per-item'});
  assert.equal(validate('session-prescription', prescription({requiredAnchors: [perHand]})).valid, true);
  assertInvalidAt('session-prescription', prescription({requiredAnchors: [anchor({target: {type: 'reps', minReps: 10, maxReps: 6}})]}), 'session-prescription.requiredAnchors[0].target.maxReps');
  assertInvalidAt('session-prescription', prescription({requiredAnchors: [anchor({target: {type: 'reps'}})]}), 'session-prescription.requiredAnchors[0].target');
  assertInvalidAt('session-prescription', prescription({requiredAnchors: [anchor({target: {type: 'timed', minReps: 8, seconds: 30}})]}), 'session-prescription.requiredAnchors[0].target');
  assertInvalidAt('session-prescription', prescription({requiredAnchors: [anchor({target: {type: 'reps', minReps: 8, seconds: 30}})]}), 'session-prescription.requiredAnchors[0].target.seconds');
  // A known load without a unit cannot be interpreted later.
  assertInvalidAt('session-prescription', prescription({requiredAnchors: [anchor({suggestedLoad: 20, loadUnit: null})]}), 'session-prescription.requiredAnchors[0].loadUnit');
});

test('unknown prescription and anchor values remain unknown', () => {
  const sparseAnchor = {requirementId: 'req-1', exerciseId: 'goblet-squat', importance: 'required'};
  const sparse = {schemaVersion: 1, prescriptionId: 'rx-1', programmeInstanceId: 'prog-1', sessionRole: 'strength-a', requiredAnchors: [sparseAnchor]};
  assert.equal(validate('session-prescription', sparse).valid, true);
  const created = Model.createSessionPrescription(sparse);
  assert.equal(created.duration, undefined);
  assert.equal(created.requiredAnchors[0].suggestedLoad, undefined);
  assert.equal(created.requiredAnchors[0].target, undefined);
  assert.notEqual(created.requiredAnchors[0], sparseAnchor, 'construction copies rather than aliasing caller data');
});

// ---- Session Result ----

test('Session Result final statuses distinguish completed, partial, abandoned and skipped-before-start', () => {
  assert.deepEqual(Model.FINAL_STATUSES, ['completed','partial','abandoned','skipped-before-start']);
  ['completed','partial','abandoned'].forEach(finalStatus => assert.equal(validate('session-result', sessionResult({finalStatus})).valid, true, finalStatus));
  const skipped = sessionResult({finalStatus: 'skipped-before-start', startedAt: null, endedAt: null, actualDurationSeconds: null, performedWork: [], anchorResults: [], substitutions: []});
  assert.deepEqual(validate('session-result', skipped), {valid: true, errors: []});
  assertInvalidAt('session-result', sessionResult({finalStatus: 'done'}), 'session-result.finalStatus');
  assertInvalidAt('session-result', sessionResult({finalStatus: 'skipped-before-start'}), 'session-result.performedWork[0].status');
});

test('Session Result records occurrence-level outcomes without requiring set logs for accessories', () => {
  const result = sessionResult({
    finalStatus: 'partial',
    performedWork: [
      {occurrenceId: 'occ-1', exerciseId: 'goblet-squat', status: 'completed', sets: [{reps: 8, load: 16, loadUnit: 'kg', loadInterpretation: 'total'}]},
      {occurrenceId: 'occ-2', exerciseId: 'push-up', status: 'partial'},
      {occurrenceId: 'occ-3', exerciseId: 'dead-bug', status: 'skipped', sets: null},
      {occurrenceId: 'occ-4', status: null}
    ]
  });
  assert.deepEqual(validate('session-result', result), {valid: true, errors: []});
  assertInvalidAt('session-result', sessionResult({performedWork: [{occurrenceId: 'occ-1', status: 'done'}]}), 'session-result.performedWork[0].status');
  assertInvalidAt('session-result', sessionResult({performedWork: [{occurrenceId: 'occ-1', status: 'completed', sets: [{reps: 8, load: 16}]}]}), 'session-result.performedWork[0].sets[0].loadUnit');
});

test('whether an occurrence achieved its target is a confirmed boolean or unknown', () => {
  [true, false, null, undefined].forEach(targetAchieved => {
    const outcome = {occurrenceId: 'occ-1', exerciseId: 'goblet-squat', status: 'completed', sets: [{reps: 8}], targetAchieved};
    assert.equal(validate('session-result', sessionResult({performedWork: [outcome]})).valid, true);
    assert.equal(validate('session-draft', sessionDraft({occurrenceOutcomes: [outcome]})).valid, true);
  });
  assertInvalidAt('session-result', sessionResult({performedWork: [{occurrenceId: 'occ-1', status: 'completed', targetAchieved: 'yes'}]}), 'session-result.performedWork[0].targetAchieved');
});

test('Session Result keeps planned and performed work separate and source linkage explicit', () => {
  Model.SESSION_SOURCES.forEach(source => {
    const linked = source === 'coach' ? {} : {programmeInstanceId: null, prescriptionId: null};
    assert.equal(validate('session-result', sessionResult(Object.assign({source}, linked))).valid, true, source);
  });
  assertInvalidAt('session-result', sessionResult({source: 'coach', prescriptionId: null}), 'session-result.prescriptionId');
  assertInvalidAt('session-result', sessionResult({source: 'coach', programmeInstanceId: null}), 'session-result.programmeInstanceId');
  assertInvalidAt('session-result', sessionResult({source: 'manual'}), 'session-result.source');
  assertInvalidAt('session-result', sessionResult({performedWork: [{occurrenceId: 'occ-1'}, {occurrenceId: 'occ-1'}]}), 'session-result.performedWork[1].occurrenceId');
  assertInvalidAt('session-result', sessionResult({substitutions: [{fromExerciseId: 'push-up', toExerciseId: 'push-up'}]}), 'session-result.substitutions[0].toExerciseId');
  assertInvalidAt('session-result', sessionResult({endedAt: '2026-10-01T08:00:00Z', startedAt: '2026-10-01T09:00:00Z'}), 'session-result.endedAt');
});

test('unknown performed values are not replaced by planned values', () => {
  const result = Model.createSessionResult(sessionResult({
    performedWork: [{occurrenceId: 'occ-1', exerciseId: 'goblet-squat', status: 'completed', sets: [{reps: null, load: null}]}],
    actualDurationSeconds: null
  }));
  assert.equal(result.performedWork[0].sets[0].reps, null);
  assert.equal(result.performedWork[0].sets[0].load, null);
  assert.equal(result.actualDurationSeconds, null);
  assert.deepEqual(result.plannedWork[0].prescription, {sets: 3, reps: 8});
});

test('a constructed Session Result is immutable evidence', () => {
  const result = Model.createSessionResult(sessionResult());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.performedWork[0]));
  assert.throws(() => { 'use strict'; result.finalStatus = 'partial'; }, TypeError);
});

// ---- Active Session Draft ----

test('an active Session Draft holds in-progress execution state', () => {
  assert.deepEqual(validate('session-draft', sessionDraft()), {valid: true, errors: []});
  const empty = sessionDraft({startedAt: null, updatedAt: null, occurrenceOutcomes: [], substitutions: [], anchorResults: []});
  assert.equal(validate('session-draft', empty).valid, true);
  Model.DRAFT_STATES.forEach(state => {
    const finalisation = {state, sessionResultId: state === 'finalised' ? 'result-1' : null};
    assert.equal(validate('session-draft', sessionDraft({finalisation})).valid, true, state);
  });
});

test('invalid Session Drafts are rejected', () => {
  const noFinalisation = sessionDraft(); delete noFinalisation.finalisation;
  assertInvalidAt('session-draft', noFinalisation, 'session-draft.finalisation');
  assertInvalidAt('session-draft', sessionDraft({finalisation: {state: 'done'}}), 'session-draft.finalisation.state');
  assertInvalidAt('session-draft', sessionDraft({finalisation: {state: 'finalised', sessionResultId: null}}), 'session-draft.finalisation.sessionResultId');
  assertInvalidAt('session-draft', sessionDraft({draftId: ''}), 'session-draft.draftId');
  assertInvalidAt('session-draft', sessionDraft({source: 'coach', prescriptionId: null}), 'session-draft.prescriptionId');
  assertInvalidAt('session-draft', sessionDraft({occurrenceOutcomes: [{occurrenceId: 'occ-1', status: 'half'}]}), 'session-draft.occurrenceOutcomes[0].status');
  assertInvalidAt('session-draft', sessionDraft({finalStatus: 'completed'}), 'session-draft.finalStatus');
});

// ---- Versioning ----

test('every record kind requires the current schemaVersion', () => {
  const records = {'session-result-index': {schemaVersion:1,sessionResultIds:[]}, 'programme-state': programmeState(), 'session-prescription': prescription(), 'session-result': sessionResult(), 'session-draft': sessionDraft(),
    'active-programme': {schemaVersion: 1, programmeInstanceId: 'prog-1', programmeDefinitionId: 'general-strength', programmeDefinitionVersion: 1}};
  assert.deepEqual(Object.keys(records).sort(), [...Model.RECORD_KINDS].sort());
  Object.entries(records).forEach(([kind, record]) => {
    assert.equal(validate(kind, record).valid, true, kind);
    const missing = Object.assign({}, record); delete missing.schemaVersion;
    assert.deepEqual(errorPaths(kind, missing), [kind+'.schemaVersion']);
    assert.deepEqual(errorPaths(kind, Object.assign({}, record, {schemaVersion: 2})), [kind+'.schemaVersion']);
  });
});

test('version mismatches are refused by the central upgrade path', () => {
  assert.deepEqual(upgradeRecord('programme-state', programmeState()), programmeState());
  [2, 0, '1', undefined].forEach(schemaVersion => {
    assert.throws(() => upgradeRecord('programme-state', programmeState({schemaVersion})), error => error instanceof CoachError && error.code === 'unsupported-schema-version');
  });
  assert.throws(() => upgradeRecord('programme-state', null), error => error.code === 'unsupported-schema-version');
  assert.throws(() => upgradeRecord('not-a-kind', programmeState()), /Unknown Coach record kind/);
});

test('assertValid raises a structured invalid-record error', () => {
  assert.throws(() => assertValid('programme-state', programmeState({status: 'nope'})), error => {
    assert.ok(error instanceof CoachError);
    assert.equal(error.code, 'invalid-record');
    assert.equal(error.details.kind, 'programme-state');
    assert.deepEqual(error.details.errors.map(entry => entry.path), ['programme-state.status']);
    return true;
  });
  assert.throws(() => Model.createProgrammeState({status: 'active'}), error => error.code === 'invalid-record');
});

test('identical records compare equal regardless of key order', () => {
  const a = sessionResult();
  const b = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(a).reverse())));
  assert.equal(Model.sameRecord(a, b), true);
  assert.equal(Model.sameRecord(a, sessionResult({finalStatus: 'partial'})), false);
});
