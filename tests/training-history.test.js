const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../data/exercises.js');
require('../js/coach-model.js');
require('../js/training-history.js');
const {performance} = require('./helpers/coach-policy-fixtures.js');
const History = GarageFitTrainingHistory, Model = GarageFitCoachModel, catalogue = GarageFitData.exercises;
const view = results => History.createHistory(results, catalogue);

test('legacy Knees Up history resolves to the canonical high-knees identity', () => {
  const result = performance({performedWork: [{occurrenceId:'main-1', exerciseId:'knees-up', status:'completed'}]});
  const history = view([result]);
  assert.equal(history.performances[0].exerciseId,'high-knees');
  assert.equal(history.performances[0].semanticConfidence,'derived');
  assert.equal(history.exactExercisePerformances('high-knees').length,1);
});
const work = result => view([result]).performances[0];
const copy = value => JSON.parse(JSON.stringify(value));

test('history isolates instances, sorts by performed time, deduplicates immutable IDs and filters recent evidence', () => {
  const first = performance();
  const later = performance({sessionResultId: 'later', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z'});
  const other = performance({sessionResultId: 'other', programmeInstanceId: 'other'});
  const history = view([later, first, first, other]);
  assert.equal(history.sessions.length, 3);
  assert.deepEqual(history.sessionsForProgramme('test-instance').map(item => item.sessionResultId), ['test-result','later']);
  assert.deepEqual(history.recentPerformedSessions({programmeInstanceId: 'test-instance', since: '2026-10-02T00:00:00Z'}).map(item => item.sessionResultId), ['later']);
  assert.equal(history.exactExercisePerformances('goblet-squat', {programmeInstanceId: 'test-instance', limit: 1})[0].sessionResultId, 'later');
  assert.equal(history.recentPerformedSessions({programmeInstanceId: 'test-instance', sections: ['main']}).length, 2);
  assert.equal(history.recentPerformedSessions({programmeInstanceId: 'test-instance', sections: ['warmup']}).length, 0);
  assert.throws(() => view([first, performance({feedback: {effort: 'different'}})]), error => error.code === 'session-result-conflict');
  assert.ok(Object.isFrozen(history.sessions[0]) && Object.isFrozen(history.performances[0].sets[0]));
});

test('only performed outcomes create exposure; planned-only, skipped, unrecorded and anchor summary work do not', () => {
  const result = performance({performedWork: [
    {occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'skipped', sets: [{reps: 8}]},
    {occurrenceId: 'not-recorded', exerciseId: 'push-up', status: null}
  ], anchorResults: [{requirementId: 'anchor-squat', exerciseId: 'goblet-squat', status: 'completed', sets: [{reps: 20, load: 16, loadUnit: 'kg'}]}]});
  const history = view([result, performance({sessionResultId: 'preview', performedWork: null})]);
  assert.equal(history.performances.length, 0);
  assert.deepEqual(history.movementPatternExposure('squat'), {value: 0, confidence: 'unknown'});
  assert.equal(history.recentPerformedSessions().length, 0);
});

test('partial timed and rep work earn measured fractions; note-only partial and unknown load remain unknown', () => {
  const reps = work(performance({performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'partial', sets: [{reps: 4}]}]}));
  assert.deepEqual(reps.exposure, {value: 0.5, confidence: 'derived'});
  assert.deepEqual(reps.sets[0].load, {value: null, confidence: 'unknown'});
  assert.equal(reps.sets[0].loadUnit, null);
  const timed = performance({plannedWork: [{occurrenceId: 'main-1', exerciseId: 'plank', section: 'main', prescription: {type: 'timed', timed: true, seconds: 40}}],
    performedWork: [{occurrenceId: 'main-1', exerciseId: 'plank', status: 'partial', sets: [{seconds: 10}]}]});
  assert.equal(work(timed).exposure.value, 0.25);
  const unknown = work(performance({performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'partial', note: 'stopped early'}]}));
  assert.deepEqual(unknown.exposure, {value: null, confidence: 'unknown'});
  assert.equal(work(performance({performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'completed', sets: [{reps: 0}]}]})).exposure.value, 0);
  const done = work(performance({performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'completed'}]}));
  assert.equal(done.exposure.value, 1);
  assert.equal(done.sets.length, 0, 'completion does not invent planned reps/load');
});

test('intrinsic movement and broad body-region exposure come from the actual exercise in the catalogue', () => {
  const result = performance({performedWork: [{occurrenceId: 'main-1', exerciseId: 'dumbbell-bent-over-row', status: 'completed'}],
    derivedExposure: {patterns: {squat: 1000}}, substitutions: [{occurrenceId: 'main-1', fromExerciseId: 'goblet-squat', toExerciseId: 'dumbbell-bent-over-row'}]});
  const history = view([result]);
  assert.deepEqual(history.movementPatternExposure('pull'), {value: 1, confidence: 'derived'});
  assert.equal(history.movementPatternExposure('squat').value, 0);
  assert.equal(history.bodyRegionExposure('upper').value, 1);
  assert.equal(history.exactExercisePerformances('goblet-squat').length, 0);
  const missing = work(performance({performedWork: [{occurrenceId: 'main-1', exerciseId: null, status: 'completed'}]}));
  assert.equal(missing.exerciseId, null); assert.equal(missing.semanticConfidence, 'unknown');
});

test('external activity does not become invented resistance dose or exact-exercise performance', () => {
  const external = performance({source: 'external', programmeInstanceId: null, prescriptionId: null, feedback: {activity: 'tennis'}});
  const history = view([external]);
  assert.equal(history.sessions.length, 1);
  assert.equal(history.performances.length, 0);
});

test('direct comparison requires the exact exercise, mode, protocol conditions and side', () => {
  const a = work(performance());
  assert.equal(History.comparePerformances(a, copy(a)).comparable, true);
  for (const [key, value] of [['exerciseId','kettlebell-goblet-squat'], ['prescriptionMode','time'], ['protocol','paired_sets'], ['side','left'],
    ['protocolConditions',{roundRestSeconds: 20}], ['protocolConditions',null]]) {
    assert.equal(History.comparePerformances(a, {...copy(a), [key]: value}).comparable, false, key);
  }
  assert.equal(History.comparePerformances({...a, side: 'unknown'}, {...a, side: 'unknown'}).comparable, false);
});

test('performance evidence distinguishes reps, load and unknown evidence without copying planned load', () => {
  const a = work(performance());
  const reps = copy(a); reps.sets[0].reps.value = 9;
  assert.equal(History.comparePerformanceEvidence(a, reps).change, 'improved-reps');
  const load = copy(a); load.sets[0].load.value = 18;
  assert.equal(History.comparePerformanceEvidence(a, load).change, 'improved-load');
  assert.equal(History.comparePerformanceEvidence(a, a).change, 'unchanged-or-insufficient');
  const unknown = copy(a); unknown.sets[0].load = {value: null, confidence: 'unknown'};
  assert.equal(History.comparePerformanceEvidence(unknown, unknown).change, 'unknown-load');
  const unit = copy(a); unit.sets[0].loadUnit = 'lb';
  assert.equal(History.comparePerformanceEvidence(a, unit).change, 'incomparable-load');
  assert.equal(History.comparePerformanceEvidence(a, unit).comparable, false);
  const interpretation = copy(a); interpretation.sets[0].loadInterpretation = 'per-item';
  assert.equal(History.comparePerformanceEvidence(a, interpretation).change, 'incomparable-load');
});

test('substitution creates a new exact-exercise anchor series even for catalogue relatives', () => {
  const first = performance();
  const next = performance({sessionResultId: 'new', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z',
    performedWork: [{occurrenceId: 'main-1', exerciseId: 'kettlebell-goblet-squat', status: 'completed', sets: [{reps: 10, load: 16, loadUnit: 'kg', loadInterpretation: 'total'}]}]});
  const series = view([first, next]).anchorPerformanceSeries('anchor-squat');
  assert.deepEqual(series.map(item => item.exerciseId), ['goblet-squat','kettlebell-goblet-squat']);
  assert.equal(series[1].performances.length, 1);
  assert.equal(catalogue['goblet-squat'].family, catalogue['kettlebell-goblet-squat'].family);
});

test('interleaved left/right anchor work retains distinct comparable series', () => {
  const make = (id, date) => performance({sessionResultId: id, startedAt: date+'T08:00:00Z', endedAt: date+'T08:30:00Z',
    plannedWork: ['left','right'].map(side => ({occurrenceId: side, exerciseId: 'dumbbell-reverse-lunge', requirementId: 'lunge', section: 'main',
      prescription: {type: 'unilateral-reps', reps: 8, protocol: 'rounds', side, protocolConditions: {exerciseRestSeconds: 20, roundRestSeconds: 60}}})),
    performedWork: ['left','right'].map(side => ({occurrenceId: side, exerciseId: 'dumbbell-reverse-lunge', status: 'completed',
      sets: [{reps: 8, load: 12, loadUnit: 'kg', loadInterpretation: 'per-item'}]}))});
  const series = view([make('first','2026-10-01'), make('second','2026-10-03')]).anchorPerformanceSeries('lunge');
  assert.equal(series.length, 2);
  assert.deepEqual(series.map(item => item.performances.length), [2,2]);
  assert.equal(series[0].performances[0].side, 'left'); assert.equal(series[1].performances[0].side, 'right');
});

test('timed performance comparisons retain work/rest conditions and explicit numeric load', () => {
  const make = seconds => work(performance({plannedWork: [{occurrenceId: 'main-1', exerciseId: 'plank', section: 'main',
    prescription: {type: 'timed', timed: true, seconds: 30, protocol: 'timed_intervals', side: null, protocolConditions: {transitionSeconds: 20}}}],
    performedWork: [{occurrenceId: 'main-1', exerciseId: 'plank', status: 'completed', sets: [{seconds, load: 0, loadUnit: 'kg', loadInterpretation: 'total'}]}]}));
  const before = make(20), after = make(25);
  assert.equal(History.comparePerformanceEvidence(before, after).change, 'improved-time');
  // Views are frozen: create a separate changed-protocol input to the pure comparator.
  const changed = copy(after); changed.protocolConditions.workSeconds = 40;
  assert.equal(History.comparePerformances(before, changed).comparable, false);
  assert.equal(History.comparePerformances(before, {...copy(before), protocolConditions: {}}).comparable, false);
});

test('explicit approximate contextual evidence retains its confidence but contributes zero resistance dose', () => {
  const contribution = {activity: 'tennis', bodyRegion: 'upper', confidence: 'approximate'};
  const result = performance({source: 'external', feedback: {contextualContribution: contribution}});
  const history = view([result]);
  assert.deepEqual(history.contextualEvidence()[0].contribution, contribution);
  assert.equal(history.bodyRegionExposure('upper').value, 0);
  assert.equal(history.exactExercisePerformances('goblet-squat').length, 0);
});

test('bounded sequences expose cross-source family/style/exercise/pattern/protocol recency without inventing dose', () => {
  const identity={workoutFamilyId:'strength-control',workoutFamilyVersion:1,familyStyleId:'straight-sets'};
  const sequence=Array.from({length:7},(_,i)=>performance({sessionResultId:'sequence-'+i,
    startedAt:`2026-10-0${i+1}T08:00:00Z`,endedAt:`2026-10-0${i+1}T08:30:00Z`,
    source:i===6?'fixed':i%2?'generator':'coach',programmeInstanceId:i%2?null:'previous-instance',
    ...(i<6?{...identity,familyStyleId:i%2?'paired-sets':'straight-sets'}:{}),
    feedback:i===5?{effort:'moderate'}:{},
    ...(i===4?{plannedWork:[{occurrenceId:'main-1',exerciseId:'plank',section:'main',prescription:{type:'timed',timed:true,seconds:40,protocol:'timed_intervals'}}],
      performedWork:[{occurrenceId:'main-1',exerciseId:'plank',status:'partial',sets:[{seconds:12}]}]}:{}),
    ...(i===5?{performedWork:[{occurrenceId:'main-1',exerciseId:'goblet-squat',status:'completed'}]}:{})}));
  const excluded=['abandoned','skipped-before-start','completed'].map((finalStatus,i)=>performance({sessionResultId:'excluded-'+i,
    startedAt:'2026-10-09T08:00:00Z',endedAt:'2026-10-09T08:30:00Z',finalStatus,
    ...(i===1?{performedWork:[],anchorResults:[]} : i===2?{performedWork:[{occurrenceId:'main-1',exerciseId:'goblet-squat',status:'skipped'}]}:{})}));
  const summary=view([...sequence,...excluded]).recentTrainingSummary({limit:4});
  assert.deepEqual(summary.sessions.map(item=>item.sessionResultId),['sequence-6','sequence-5','sequence-4','sequence-3']);
  assert.equal(summary.sessions[0].workoutFamilyId,null,'fixed work is not relabelled');
  assert.deepEqual(summary.families.map(item=>[item.key,item.sessionCount,item.recency]),[['strength-control@1',3,1]]);
  assert.deepEqual(summary.styles.map(item=>[item.familyStyleId,item.sessionCount]),[['paired-sets',2],['straight-sets',1]]);
  assert.equal(summary.exercises[0].sessionCount,3); assert.equal(summary.patterns.find(item=>item.key==='squat').exposure.value,3);
  assert.equal(summary.exercises.find(item=>item.key==='plank').recency,2);
  assert.equal(summary.patterns.find(item=>item.key==='core').exposure.value,.3);
  assert.equal(summary.protocols[0].key,'rounds');assert.equal(summary.protocols[0].sessionCount,3);
  assert.equal(summary.protocols.find(item=>item.key==='timed_intervals').recency,2);
  assert.deepEqual(summary.sessions[1].intensity,{value:'moderate',confidence:'reported'});
  assert.deepEqual(summary.sessions[0].intensity,{value:null,confidence:'unknown'});
  assert.deepEqual(summary.sessions[1].performances[0].sets,[],'rep Done supplies no measured reps/load');
  assert.ok(Object.isFrozen(summary.sessions[1].performances));
  assert.equal(view(sequence).sessionsForProgramme('previous-instance').length,4);
  assert.throws(()=>view(sequence).recentTrainingSummary({limit:65}),/limit/);
  assert.throws(()=>view(sequence).recentTrainingSummary({limit:-1}),/limit/);
});

test('the newest completed session of each family is derived read-only, with its completed occurrences and blocks (#264)', () => {
  const family = (version, style = 'joint-focused') => ({workoutFamilyId: 'mobility-movement-quality', workoutFamilyVersion: version, familyStyleId: style});
  const stages = ['cat-cow', 'kneeling-ankle-rocks', 'thread-the-needle', 'worlds-greatest-stretch', 'wall-angel'];
  const make = (id, day, extra = {}, statuses = stages.map(() => 'completed')) => performance({sessionResultId: id, source: 'generator', programmeInstanceId: null, ...family(2),
    startedAt: `2026-10-0${day}T08:00:00Z`, endedAt: `2026-10-0${day}T08:20:00Z`,
    plannedWork: stages.map((exerciseId, i) => ({occurrenceId: id + i, exerciseId, section: i === 0 ? 'warmup' : i === 4 ? 'cooldown' : 'main', blockIndex: [0, 1, 1, 2, 3][i]})),
    performedWork: stages.map((exerciseId, i) => ({occurrenceId: id + i, exerciseId, status: statuses[i]})), anchorResults: [], ...extra});
  const results = [make('old-complete', 1, family(1)), make('newest-complete', 2), make('later-partial', 3, {finalStatus: 'partial'}, ['completed', 'completed', 'skipped', 'skipped', 'skipped']),
    make('later-abandoned', 4, {finalStatus: 'abandoned'}), make('fixed-untagged', 5, {source: 'fixed', workoutFamilyId: undefined, workoutFamilyVersion: undefined, familyStyleId: undefined}),
    make('other-family', 6, {workoutFamilyId: 'core-stability', workoutFamilyVersion: 1, familyStyleId: 'controlled-stability'})];
  const history = view(results), found = history.lastCompletedFamilySessions();
  assert.deepEqual(Object.keys(found).sort(), ['core-stability', 'mobility-movement-quality']);
  const mobility = found['mobility-movement-quality'];
  assert.equal(mobility.sessionResultId, 'newest-complete', 'partial, abandoned and untagged sessions never qualify');
  assert.deepEqual([mobility.workoutFamilyVersion, mobility.familyStyleId, mobility.plannedOccurrences], [2, 'joint-focused', 5]);
  assert.deepEqual(mobility.completedOccurrences.map(item => [item.exerciseId, item.blockIndex]),
    [['cat-cow', 0], ['kneeling-ankle-rocks', 1], ['thread-the-needle', 1], ['worlds-greatest-stretch', 2], ['wall-angel', 3]], 'all sections, with their block');
  assert.ok(Object.isFrozen(found) && Object.isFrozen(mobility.completedOccurrences[0]));
  assert.deepEqual(Object.keys(history.lastCompletedFamilySessions({until: '2026-10-01T23:00:00Z'})), ['mobility-movement-quality']);
  assert.equal(history.lastCompletedFamilySessions({until: '2026-10-01T23:00:00Z'})['mobility-movement-quality'].sessionResultId, 'old-complete');
  assert.deepEqual(view([]).lastCompletedFamilySessions(), {});
  // Skipped occurrences are not completed work.
  const skipped = view([make('skips', 7, {}, ['completed', 'skipped', 'completed', 'completed', 'skipped'])]).lastCompletedFamilySessions()['mobility-movement-quality'];
  assert.deepEqual(skipped.completedOccurrences.map(item => item.exerciseId), ['cat-cow', 'thread-the-needle', 'worlds-greatest-stretch']);
  assert.equal(skipped.plannedOccurrences, 5);
  // Nothing in a Session Result changes: the stored records are untouched by the derived view.
  assert.deepEqual(JSON.parse(JSON.stringify(results)), JSON.parse(JSON.stringify(results.map(item => history.sessions.find(entry => entry.sessionResultId === item.sessionResultId)))));
});

test('recent balance retains measured partial work, unknown amount and unlinked fixed patterns honestly', () => {
  const partial=performance({sessionResultId:'partial-time',finalStatus:'partial',
    plannedWork:[{occurrenceId:'main-1',exerciseId:'plank',section:'main',prescription:{type:'timed',timed:true,seconds:40,protocol:'timed_intervals'}}],
    performedWork:[{occurrenceId:'main-1',exerciseId:'plank',status:'partial',sets:[{seconds:10}]}]});
  const fixed=performance({sessionResultId:'old-fixed',source:'fixed',programmeInstanceId:null,plannedWork:[],
    performedWork:[{occurrenceId:'old-1',exerciseId:'goblet-squat',status:'partial',note:'some work'}]});
  const zero=performance({sessionResultId:'zero',performedWork:[{occurrenceId:'main-1',exerciseId:'push-up',status:'completed',sets:[{reps:0}]}]});
  const interrupted=performance({sessionResultId:'unmeasured-interrupted',finalStatus:'abandoned',
    performedWork:[{occurrenceId:'main-1',exerciseId:'goblet-squat',status:'partial',note:'Some work, amount unknown'}]});
  const history=view([partial,fixed,zero,interrupted]),summary=history.recentTrainingSummary();
  assert.equal(history.sessionEvidence('unmeasured-interrupted').performances[0].exposure.confidence,'unknown',
    'existing progress retains factual unknown work from interrupted non-meaningful runs');
  assert.equal(summary.sessions.length,2);assert.deepEqual(summary.families,[]);
  const timed=summary.sessions.find(item=>item.sessionResultId==='partial-time').performances[0];
  assert.deepEqual(timed.sets[0].seconds,{value:10,confidence:'confirmed'});assert.equal(timed.exposure.value,.25);
  const squat=summary.patterns.find(item=>item.key==='squat');
  assert.equal(squat.exposure.confidence,'unknown');assert.equal(squat.occurrenceCount,1);
  assert.equal(summary.protocols.length,1,'missing fixed protocol stays unknown');
  assert.equal(summary.sessions.find(item=>item.source==='fixed').performances[0].section,null);
});
