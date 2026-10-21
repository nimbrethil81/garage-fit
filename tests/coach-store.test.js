// Coach 1: local Coach persistence (js/coach-store.js) behind an injected storage adapter.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.window = global;
require('../js/coach-model.js');
require('../js/coach-store.js');

const { createStore } = GarageFitCoachStore;
const { CoachError } = GarageFitCoachModel;
const { programmeState, prescription, sessionResult, sessionDraft } = require('./helpers/coach-fixtures.js');

// localStorage-compatible in-memory fake with failure injection.
class MemoryStorage {
  constructor(entries) { this.map = new Map(entries || []); this.failReads = false; this.failWrites = null; this.writes = []; }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { if (this.failReads) throw new Error('SecurityError: storage disabled'); return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) {
    if (this.failWrites) throw this.failWrites;
    this.writes.push(key);
    this.map.set(key, String(value));
  }
  removeItem(key) { if (this.failWrites) throw this.failWrites; this.map.delete(key); }
  coachKeys() { return [...this.map.keys()].filter(key => key.startsWith('gf_coach_')).sort(); }
  keyHolding(predicate) { return [...this.map.entries()].find(([, value]) => { try { return predicate(JSON.parse(value)); } catch (e) { return false; } })[0]; }
}

const quotaError = () => Object.assign(new Error('The quota has been exceeded.'), {name: 'QuotaExceededError', code: 22});
const rejectsWith = (promise, code, check) => assert.rejects(promise, error => {
  assert.ok(error instanceof CoachError, 'expected a CoachError, got '+error);
  assert.equal(error.code, code, error.message);
  if (check) check(error);
  return true;
});
const activeRef = () => ({schemaVersion: 1, programmeInstanceId: 'prog-1', programmeDefinitionId: 'general-strength', programmeDefinitionVersion: 1});

// ---- Programme State and active programme ----

test('Programme State saves and loads by programme instance id', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  assert.equal(await store.loadProgrammeState('prog-1'), null);
  await store.saveProgrammeState(programmeState());
  await store.saveProgrammeState(programmeState({programmeInstanceId: 'prog-2', status: 'paused'}));
  assert.deepEqual(await store.loadProgrammeState('prog-1'), programmeState());
  assert.equal((await store.loadProgrammeState('prog-2')).status, 'paused');
  // Programme State is mutable current state: a later save replaces it.
  await store.saveProgrammeState(programmeState({meaningfulSessionsCompleted: 3, lastAppliedSessionResultId: 'result-1'}));
  assert.equal((await store.loadProgrammeState('prog-1')).meaningfulSessionsCompleted, 3);
  assert.equal(storage.coachKeys().length, 2, 'one record per programme instance');
});

test('the active programme reference saves, loads and clears', async () => {
  const store = createStore(new MemoryStorage());
  assert.equal(await store.loadActiveProgramme(), null);
  await store.saveActiveProgramme(activeRef());
  assert.deepEqual(await store.loadActiveProgramme(), activeRef());
  await store.clearActiveProgramme();
  assert.equal(await store.loadActiveProgramme(), null);
});

test('unknown values load back as unknown', async () => {
  const store = createStore(new MemoryStorage());
  const sparse = {schemaVersion: 1, programmeInstanceId: 'prog-1', programmeDefinitionId: 'general-strength', programmeDefinitionVersion: 1, status: 'active', mode: 'development', nominalProgress: null};
  await store.saveProgrammeState(sparse);
  const loaded = await store.loadProgrammeState('prog-1');
  assert.deepEqual(loaded, sparse);
  assert.equal(loaded.nominalProgress, null);
  assert.equal('currentTargets' in loaded, false);

  const result = sessionResult({actualDurationSeconds: null, performedWork: [{occurrenceId: 'occ-1', exerciseId: 'goblet-squat', status: 'completed', sets: [{reps: null, load: null}]}]});
  await store.saveSessionResult(result);
  const loadedResult = await store.getSessionResult('result-1');
  assert.equal(loadedResult.actualDurationSeconds, null);
  assert.deepEqual(loadedResult.performedWork[0].sets, [{reps: null, load: null}]);
});

test('invalid records are refused before anything is written', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  await rejectsWith(store.saveProgrammeState(programmeState({status: 'nope'})), 'invalid-record');
  await rejectsWith(store.saveProgrammeState(null), 'invalid-record');
  await rejectsWith(store.saveSessionResult(sessionResult({finalStatus: 'done'})), 'invalid-record');
  await rejectsWith(store.saveSessionDraft(sessionDraft({finalisation: null})), 'invalid-record');
  await rejectsWith(store.saveActiveProgramme(Object.assign(activeRef(), {programmeDefinitionVersion: 0})), 'invalid-record');
  assert.deepEqual(storage.coachKeys(), []);
});

// ---- Session Results ----

test('each Session Result is a separate record with a small ordered index', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  for (const id of ['result-1','result-2','result-3']) {
    assert.deepEqual(await store.saveSessionResult(sessionResult({sessionResultId: id})), {status: 'created', sessionResultId: id});
  }
  // Three result records plus one index, never one growing history object.
  assert.equal(storage.coachKeys().length, 4);
  ['result-1','result-2','result-3'].forEach(id => {
    const key = storage.keyHolding(record => record.sessionResultId === id);
    assert.equal(JSON.parse(storage.map.get(key)).sessionResultId, id);
  });
  const indexKey = storage.keyHolding(record => Array.isArray(record.sessionResultIds));
  assert.deepEqual(JSON.parse(storage.map.get(indexKey)).sessionResultIds, ['result-1','result-2','result-3']);
  assert.equal(JSON.parse(storage.map.get(indexKey)).entries.length, 3);
  assert.ok(!storage.map.get(indexKey).includes('plannedWork'), 'the index holds only identity and filter metadata');

  const listed = await store.listSessionResults();
  assert.deepEqual(listed.results.map(result => result.sessionResultId), ['result-1','result-2','result-3']);
  assert.deepEqual(listed.errors, []);
  assert.equal(listed.indexRecovered, false);
  assert.deepEqual(await store.getSessionResult('result-2'), sessionResult({sessionResultId: 'result-2'}));
  assert.equal(await store.getSessionResult('missing'), null);
});

test('Coach storage never touches Generator history or other app keys', async () => {
  const storage = new MemoryStorage([['gf_generator_history', '[["push-up"]]'], ['gf_amrap_results', '[]']]), store = createStore(storage);
  await store.saveActiveProgramme(activeRef());
  await store.saveProgrammeState(programmeState());
  await store.saveSessionResult(sessionResult());
  await store.saveSessionDraft(sessionDraft());
  assert.equal(storage.map.get('gf_generator_history'), '[["push-up"]]');
  assert.equal(storage.map.get('gf_amrap_results'), '[]');
  assert.ok(storage.writes.every(key => key.startsWith('gf_coach_')), storage.writes.join(', '));
});

test('loaded Session Results are immutable', async () => {
  const store = createStore(new MemoryStorage());
  await store.saveSessionResult(sessionResult());
  const loaded = await store.getSessionResult('result-1');
  assert.ok(Object.isFrozen(loaded) && Object.isFrozen(loaded.performedWork[0].sets[0]));
  const listed = (await store.listSessionResults()).results[0];
  assert.ok(Object.isFrozen(listed));
});

test('saving an identical Session Result again is an idempotent no-op', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  await store.saveSessionResult(sessionResult());
  const writes = storage.writes.length;
  const reordered = Object.fromEntries(Object.entries(sessionResult()).reverse());
  assert.deepEqual(await store.saveSessionResult(reordered), {status: 'unchanged', sessionResultId: 'result-1'});
  assert.equal(storage.writes.length, writes, 'no rewrite of existing evidence');
  assert.deepEqual((await store.listSessionResults()).results.map(result => result.sessionResultId), ['result-1']);
});

test('a conflicting Session Result with an existing id fails clearly and leaves the evidence intact', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  await store.saveSessionResult(sessionResult());
  const before = new Map(storage.map);
  await rejectsWith(store.saveSessionResult(sessionResult({finalStatus: 'partial'})), 'session-result-conflict', error => {
    assert.equal(error.details.sessionResultId, 'result-1');
  });
  assert.deepEqual(storage.map, before);
  assert.equal((await store.getSessionResult('result-1')).finalStatus, 'completed');
});

test('an unreadable stored Session Result is never overwritten by a new save', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  await store.saveSessionResult(sessionResult());
  const key = storage.keyHolding(record => record.sessionResultId === 'result-1');
  storage.map.set(key, '{"sessionResultId": "result-1", truncated');
  await rejectsWith(store.saveSessionResult(sessionResult()), 'session-result-conflict', error => assert.equal(error.cause.code, 'corrupt-record'));
  assert.equal(storage.map.get(key), '{"sessionResultId": "result-1", truncated');
});

test('a Session Result written without its index entry is re-indexed on the idempotent re-save', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  await store.saveSessionResult(sessionResult());
  const indexKey = storage.keyHolding(record => Array.isArray(record.sessionResultIds));
  storage.map.set(indexKey, JSON.stringify({schemaVersion: 1, sessionResultIds: []}));
  assert.equal((await store.saveSessionResult(sessionResult())).status, 'unchanged');
  assert.deepEqual((await store.listSessionResults()).results.map(result => result.sessionResultId), ['result-1']);
});

// ---- Corrupt and invalid storage ----

test('corrupt JSON is reported as a structured error rather than crashing', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  await store.saveProgrammeState(programmeState());
  await store.saveSessionDraft(sessionDraft());
  await store.saveActiveProgramme(activeRef());
  for (const key of storage.coachKeys()) storage.map.set(key, '{not json');
  await rejectsWith(store.loadProgrammeState('prog-1'), 'corrupt-record', error => assert.equal(error.details.kind, 'programme-state'));
  await rejectsWith(store.loadSessionDraft(), 'corrupt-record');
  await rejectsWith(store.loadActiveProgramme(), 'corrupt-record');
  // The corrupt records are left in place for inspection, not deleted.
  assert.ok(storage.coachKeys().every(key => storage.map.get(key) === '{not json'));
});

test('invalid record shapes are reported, not silently reinterpreted', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  await store.saveProgrammeState(programmeState());
  const key = storage.coachKeys()[0];
  storage.map.set(key, JSON.stringify(programmeState({status: 'ACTIVE', meaningfulSessionsCompleted: '2'})));
  await rejectsWith(store.loadProgrammeState('prog-1'), 'invalid-record', error => {
    assert.deepEqual(error.details.errors.map(entry => entry.path).sort(), ['programme-state.meaningfulSessionsCompleted','programme-state.status']);
    assert.equal(error.details.key, key);
  });
  storage.map.set(key, JSON.stringify(programmeState({programmeInstanceId: 'prog-9'})));
  await rejectsWith(store.loadProgrammeState('prog-1'), 'invalid-record');
  storage.map.set(key, '[]');
  await rejectsWith(store.loadProgrammeState('prog-1'), 'unsupported-schema-version');
});

test('records from a newer or missing schema version are refused', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  await store.saveSessionDraft(sessionDraft());
  await store.saveSessionResult(sessionResult());
  const draftKey = storage.keyHolding(record => record.draftId === 'draft-1');
  storage.map.set(draftKey, JSON.stringify(sessionDraft({schemaVersion: 2})));
  await rejectsWith(store.loadSessionDraft(), 'unsupported-schema-version', error => assert.equal(error.details.schemaVersion, 2));
  const draft = sessionDraft(); delete draft.schemaVersion;
  storage.map.set(draftKey, JSON.stringify(draft));
  await rejectsWith(store.loadSessionDraft(), 'unsupported-schema-version');

  const indexKey = storage.keyHolding(record => Array.isArray(record.sessionResultIds));
  storage.map.set(indexKey, JSON.stringify({schemaVersion: 2, sessionResultIds: ['result-1'], newField: true}));
  await rejectsWith(store.listSessionResults(), 'unsupported-schema-version');
  // A newer index is never rebuilt or overwritten by this version.
  await rejectsWith(store.saveSessionResult(sessionResult({sessionResultId: 'result-2'})), 'unsupported-schema-version');
  assert.equal(JSON.parse(storage.map.get(indexKey)).schemaVersion, 2);
});

test('one bad Session Result does not hide the others', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  for (const id of ['result-1','result-2','result-3']) await store.saveSessionResult(sessionResult({sessionResultId: id}));
  storage.map.set(storage.keyHolding(record => record.sessionResultId === 'result-2'), JSON.stringify(sessionResult({sessionResultId: 'result-2', finalStatus: '?'})));
  storage.map.delete(storage.keyHolding(record => record.sessionResultId === 'result-3'));
  const listed = await store.listSessionResults();
  assert.deepEqual(listed.results.map(result => result.sessionResultId), ['result-1']);
  assert.deepEqual(listed.errors.map(error => error.code), ['invalid-record','session-index-corrupt']);
  assert.equal(listed.errors[1].details.missing, true);
});

test('a malformed Session Result index is rebuilt from the individual records', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  await store.saveSessionResult(sessionResult({sessionResultId: 'later', startedAt: '2026-10-03T08:00:00Z', endedAt: '2026-10-03T08:30:00Z'}));
  await store.saveSessionResult(sessionResult({sessionResultId: 'earlier', startedAt: '2026-10-02T08:00:00Z', endedAt: '2026-10-02T08:30:00Z'}));
  await store.saveSessionResult(sessionResult({sessionResultId: 'bad'}));
  storage.map.set(storage.keyHolding(record => record.sessionResultId === 'bad'), '{oops');
  const indexKey = storage.keyHolding(record => Array.isArray(record.sessionResultIds));
  for (const corrupt of ['{oops', '{"schemaVersion":1,"sessionResultIds":"later"}', '{"schemaVersion":1,"sessionResultIds":["later","later"]}', 'null']) {
    storage.map.set(indexKey, corrupt);
    const listed = await store.listSessionResults();
    assert.equal(listed.indexRecovered, true, corrupt);
    assert.deepEqual(listed.results.map(result => result.sessionResultId), ['earlier','later'], corrupt);
    assert.deepEqual(listed.errors.map(error => error.code), ['corrupt-record'], corrupt);
    assert.equal(storage.map.get(indexKey), corrupt, 'listing is read-only');
  }
  // The next save repairs the index; unreadable records stay in storage untouched.
  await store.saveSessionResult(sessionResult({sessionResultId: 'newest', startedAt: '2026-10-04T08:00:00Z', endedAt: '2026-10-04T08:30:00Z'}));
  assert.deepEqual(JSON.parse(storage.map.get(indexKey)).sessionResultIds, ['earlier','later','newest']);
  assert.equal([...storage.map.values()].filter(value => value === '{oops').length, 1);
  assert.equal((await store.listSessionResults()).indexRecovered, false);
});

test('a malformed index fails safely when storage cannot be scanned', async () => {
  const storage = new MemoryStorage();
  await createStore(storage).saveSessionResult(sessionResult());
  const indexKey = storage.keyHolding(record => Array.isArray(record.sessionResultIds));
  storage.map.set(indexKey, '{oops');
  const unscannable = {getItem: key => storage.getItem(key), setItem: (key, value) => storage.setItem(key, value), removeItem: key => storage.removeItem(key)};
  const store = createStore(unscannable);
  await rejectsWith(store.listSessionResults(), 'session-index-corrupt', error => assert.equal(error.details.recoverable, false));
  const before = new Map(storage.map);
  await rejectsWith(store.saveSessionResult(sessionResult({sessionResultId: 'result-2'})), 'session-index-corrupt');
  assert.deepEqual(storage.map, before, 'nothing written or deleted');
  assert.equal((await store.getSessionResult('result-1')).sessionResultId, 'result-1');
});

// ---- Storage failures ----

test('unavailable storage is surfaced, not swallowed', async () => {
  for (const storage of [null, undefined, {}, {getItem(){}}]) {
    const store = createStore(storage);
    await rejectsWith(store.loadProgrammeState('prog-1'), 'storage-unavailable');
    await rejectsWith(store.saveSessionDraft(sessionDraft()), 'storage-unavailable');
    await rejectsWith(store.listSessionResults(), 'storage-unavailable');
  }
  const storage = new MemoryStorage(); storage.failReads = true;
  const store = createStore(storage);
  await rejectsWith(store.loadActiveProgramme(), 'storage-unavailable', error => assert.match(error.cause.message, /storage disabled/));
  await rejectsWith(store.saveSessionResult(sessionResult()), 'storage-unavailable');
});

test('write failures, including quota, are surfaced with their cause', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  storage.failWrites = quotaError();
  await rejectsWith(store.saveProgrammeState(programmeState()), 'storage-write-failed', error => {
    assert.equal(error.details.quotaExceeded, true);
    assert.equal(error.cause.name, 'QuotaExceededError');
  });
  await rejectsWith(store.saveSessionResult(sessionResult()), 'storage-write-failed');
  await rejectsWith(store.clearSessionDraft(), 'storage-write-failed');
  storage.failWrites = new Error('disk error');
  await rejectsWith(store.saveSessionDraft(sessionDraft()), 'storage-write-failed', error => assert.equal(error.details.quotaExceeded, false));
  assert.deepEqual(storage.coachKeys(), []);
});

// ---- Active Session Draft ----

test('the active Session Draft saves, updates, loads and clears', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  assert.equal(await store.loadSessionDraft(), null);
  await store.saveSessionDraft(sessionDraft());
  assert.deepEqual(await store.loadSessionDraft(), sessionDraft());
  const updated = sessionDraft({updatedAt: '2026-10-01T08:20:00Z', finalisation: {state: 'finalising', sessionResultId: 'result-1'}});
  await store.saveSessionDraft(updated);
  assert.deepEqual(await store.loadSessionDraft(), updated);
  assert.equal(storage.coachKeys().length, 1, 'one active draft');
  await store.clearSessionDraft();
  assert.equal(await store.loadSessionDraft(), null);
  await store.clearSessionDraft();
});

test('returned records are copies that cannot alter storage', async () => {
  const store = createStore(new MemoryStorage());
  const state = programmeState();
  await store.saveProgrammeState(state);
  state.status = 'paused';
  const loaded = await store.loadProgrammeState('prog-1');
  assert.equal(loaded.status, 'active');
  loaded.status = 'completed';
  assert.equal((await store.loadProgrammeState('prog-1')).status, 'active');
});

test('every store operation returns a Promise', () => {
  const store = createStore(new MemoryStorage());
  Object.entries(store).forEach(([name, method]) => {
    const value = method.call(store);
    assert.ok(value instanceof Promise, name);
    value.catch(() => {});
  });
});

// ---- Boundary ----

test('Coach storage keys are only known to js/coach-store.js', () => {
  const root = path.join(__dirname, '..');
  const files = ['index.html', ...fs.readdirSync(path.join(root, 'js')).map(file => path.join('js', file))];
  const leaking = files.filter(file => file !== path.join('js', 'coach-store.js') && /gf_coach/.test(fs.readFileSync(path.join(root, file), 'utf8')));
  assert.deepEqual(leaking, []);
});

test('recent N uses metadata and reads only N matching results across large histories', async () => {
  const storage = new MemoryStorage(), store = createStore(storage);
  for (let i=0;i<180;i++) {
    const at=new Date(Date.UTC(2026,0,1+i)).toISOString();
    await store.saveSessionResult(sessionResult({sessionResultId:'history-'+i, programmeInstanceId:i%2?'other':'prog-1',
      startedAt:at, endedAt:at}));
  }
  const reads=[], original=storage.getItem.bind(storage);
  storage.getItem=key=>{reads.push(key);return original(key);};
  const listed=await store.listSessionResults({programmeInstanceId:'prog-1',source:'coach',exerciseId:'goblet-squat',limit:3});
  assert.deepEqual(listed.results.map(result=>result.sessionResultId),['history-178','history-176','history-174']);
  assert.equal(reads.filter(key=>key.startsWith('gf_coach_session_result:')).length,3);
  reads.length=0;
  await store.listSessionResults({since:new Date(Date.UTC(2026,0,175)).toISOString(),programmeInstanceId:'prog-1',limit:2});
  assert.equal(reads.filter(key=>key.startsWith('gf_coach_session_result:')).length,2);
  assert.equal((await store.listSessionResults({limit:0})).results.length,0);
});

test('original v1 id-only index enriches centrally; startup finds unindexed evidence once', async () => {
  const storage=new MemoryStorage(), store=createStore(storage);
  await store.saveSessionResult(sessionResult());
  storage.map.set('gf_coach_session_result_index',JSON.stringify({schemaVersion:1,sessionResultIds:[]}));
  await store.reconcileSessionIndex();
  const index=JSON.parse(storage.map.get('gf_coach_session_result_index'));
  assert.equal(index.schemaVersion,1); assert.deepEqual(index.sessionResultIds,['result-1']);
  assert.deepEqual(index.entries[0].exerciseIds,['goblet-squat']);
  let scanned=0; storage.key=()=>{scanned++;throw new Error('routine query must not scan');};
  await store.reconcileSessionIndex();
  assert.equal((await store.listSessionResults({limit:1})).results.length,1);
  assert.equal(scanned,0);
});

test('malformed/future versions for every persisted shape are never silently current', async () => {
  const records={
    'programme-state':programmeState(), 'session-result':sessionResult(), 'session-draft':sessionDraft(),
    'active-programme':activeRef(), 'session-result-index':{schemaVersion:1,sessionResultIds:[]}
  };
  for(const [kind,record] of Object.entries(records)) {
    assert.equal(GarageFitCoachModel.assertValid(kind,GarageFitCoachModel.upgradeRecord(kind,record)),record);
    for(const version of [undefined,null,'1',0,-1,1.5,2]) assert.throws(()=>GarageFitCoachModel.upgradeRecord(kind,{...record,schemaVersion:version}),error=>error.code==='unsupported-schema-version');
  }
});

test('missing records and conflicting/key-mismatched IDs preserve other evidence', async () => {
  const storage=new MemoryStorage(),store=createStore(storage);
  await store.saveSessionResult(sessionResult());
  await store.saveSessionResult(sessionResult({sessionResultId:'missing'}));
  storage.map.delete('gf_coach_session_result:missing');
  storage.map.set('gf_coach_session_result:wrong',JSON.stringify(sessionResult()));
  const recovery=await store.reconcileSessionIndex();
  assert.ok(recovery.errors.some(error=>error.code==='invalid-record'));
  const listed=await store.listSessionResults();
  assert.deepEqual(listed.results.map(result=>result.sessionResultId),['result-1']);
  assert.ok(listed.errors.some(error=>error.details.missing));
  await rejectsWith(store.saveSessionResult(sessionResult({finalStatus:'partial'})),'session-result-conflict');
  assert.equal((await store.getSessionResult('result-1')).finalStatus,'completed');
});

test('known derived state cannot hide malformed dose or reconciliation data inside JSON', async () => {
  const store=createStore(new MemoryStorage());
  for(const currentTargets of [{dose:{exposure:'12'}},{dose:{exposure:1,directElbowActions:{flexion:-1}}},
    {reconciliation:{appliedSessionResultIds:'result-1'}},{reconciliation:{appliedSessionResultIds:['same','same']}}]) {
    await rejectsWith(store.saveProgrammeState(programmeState({currentTargets})),'invalid-record');
  }
});

test('performed context filters metadata across sources/instances and rebuilds optional legacy metadata once', async () => {
  require('../data/exercises.js');require('../js/training-history.js');
  const storage=new MemoryStorage(),store=createStore(storage);
  for(let i=0;i<9;i++) await store.saveSessionResult(sessionResult({sessionResultId:'context-'+i,
    source:i===6?'external':i===7?'fixed':i%2?'generator':'coach',
    programmeInstanceId:i%2?null:'older-instance',
    startedAt:`2026-10-0${i+1}T08:00:00Z`,endedAt:`2026-10-0${i+1}T08:30:00Z`,
    finalStatus:i===8?'abandoned':'completed'}));
  const index=JSON.parse(storage.getItem('gf_coach_session_result_index'));
  index.entries.forEach(entry=>delete entry.hasPerformedWork);
  storage.setItem('gf_coach_session_result_index',JSON.stringify(index));
  const loaded=await GarageFitTrainingHistory.loadRecentSummary(createStore(storage),GarageFitData.exercises,{limit:3});
  assert.deepEqual(loaded.summary.sessions.map(item=>item.sessionResultId),['context-7','context-5','context-4']);
  assert.deepEqual(loaded.errors,[]);
  assert.ok(JSON.parse(storage.getItem('gf_coach_session_result_index')).entries.every(entry=>typeof entry.hasPerformedWork==='boolean'));
  const reads=[],get=storage.getItem.bind(storage);
  storage.getItem=key=>{reads.push(key);return get(key);};
  await GarageFitTrainingHistory.loadRecentSummary(createStore(storage),GarageFitData.exercises,{limit:2});
  assert.equal(reads.filter(key=>key.startsWith('gf_coach_session_result:')).length,2,'routine query reads only bounded matching evidence');
  const damagedKey='gf_coach_session_result:context-7',saved=storage.getItem(damagedKey);
  storage.setItem(damagedKey,'{bad');reads.length=0;
  const damaged=await GarageFitTrainingHistory.loadRecentSummary(createStore(storage),GarageFitData.exercises,{limit:2});
  assert.equal(damaged.summary.sessions.length,1);assert.equal(damaged.errors.length,1);
  assert.equal(reads.filter(key=>key.startsWith('gf_coach_session_result:')).length,2,'damaged candidates consume the bound too');
  storage.setItem(damagedKey,saved);
  assert.equal(storage.coachKeys().length,10,'same result records and existing index only');
  const since=await GarageFitTrainingHistory.loadRecentSummary(createStore(storage),GarageFitData.exercises,{limit:3,since:'2026-10-06T00:00:00Z',until:'2026-10-07T23:00:00Z'});
  assert.deepEqual(since.summary.sessions.map(item=>item.sessionResultId),['context-5']);
  await assert.rejects(GarageFitTrainingHistory.loadRecentSummary(store,GarageFitData.exercises,{limit:1000}),/limit/);
});

test('unknown actual exercise identity remains valid evidence without an invented index exercise id', async () => {
  const storage=new MemoryStorage(),store=createStore(storage);
  const result=sessionResult({performedWork:[{occurrenceId:'occ-1',exerciseId:null,status:'partial',note:'some work'}]});
  await store.saveSessionResult(result);
  const index=JSON.parse(storage.getItem('gf_coach_session_result_index'));
  assert.deepEqual(index.entries[0].exerciseIds,[]);
  const loaded=await store.listSessionResults({performedOnly:true,limit:1});
  assert.equal(loaded.results[0].performedWork[0].exerciseId,null);
});
