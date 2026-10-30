const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../js/coach-model.js');
require('../js/coach-store.js');
const {programmeState, sessionResult, sessionDraft} = require('./helpers/coach-fixtures.js');
class MemoryStorage {
  constructor(entries = []) { this.map = new Map(entries); this.writes = []; }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.writes.push(key); this.map.set(key, String(value)); }
  removeItem(key) { this.writes.push(key); this.map.delete(key); }
}
const options = {definitions: {'general-strength': {1: {id:'general-strength', version:1}}}};
const access = storage => GarageFitCoachStore.createBackupAccess(storage, options);
async function seeded() {
  const storage = new MemoryStorage([['unrelated', 'keep']]), store = GarageFitCoachStore.createStore(storage);
  await store.saveProgrammeState(programmeState({currentTargets: {reconciliation:{appliedSessionResultIds:['result-1']}}}));
  await store.saveActiveProgramme({schemaVersion:1,programmeInstanceId:'prog-1',programmeDefinitionId:'general-strength',programmeDefinitionVersion:1});
  await store.saveSessionResult(sessionResult());
  await store.saveSessionResult(sessionResult({sessionResultId:'partial-1',finalStatus:'partial'}));
  return {storage, store};
}
test('Coach portable backup retains exact completed and partial evidence plus programme credit ledger', async () => {
  const {storage} = await seeded(), source = access(storage), original = source.snapshotRaw();
  const portable = source.exportPortable();
  assert.equal(portable.some(([key]) => key.includes('index') || key.includes('draft')), false);
  assert.deepEqual(source.validatePortable(portable), {programmes:1, completed:1, partial:1, sessions:2, preferences:0});
  const destination = new MemoryStorage([['unrelated','preserve']]), restored = access(destination);
  restored.replaceRaw(restored.materialisePortable(portable));
  const query = await GarageFitCoachStore.createStore(destination).listSessionResults();
  assert.equal(query.errors.length, 0);
  assert.deepEqual(query.results.map(result => result.sessionResultId).sort(), ['partial-1','result-1']);
  assert.equal(destination.getItem('unrelated'), 'preserve');
  for (const [key, value] of portable) assert.equal(destination.getItem(key),value,'immutable raw record preserved');
  restored.replaceRaw(original);
  assert.deepEqual(restored.snapshotRaw(),original,'rollback restores original exact bytes');
});
test('Coach snapshots reject unknown keys, unsettled drafts and unreadable or oversized scans without mutation', async () => {
  const {storage,store} = await seeded(), api = access(storage);
  await store.saveSessionDraft(sessionDraft());
  assert.throws(() => api.exportPortable(), /current workout/);
  assert.ok(api.snapshotRaw().some(([key]) => key.endsWith('session_draft')));
  await store.clearSessionDraft();
  storage.setItem('gf_coach_future_record','{}');
  const before = storage.writes.length;
  assert.throws(() => api.snapshotRaw(), /unknown or duplicate/);
  assert.equal(storage.writes.length,before);
  assert.throws(() => access({length:10001,key(){}}).snapshotRaw(), /fully inspected/);
  assert.throws(() => access({key(){}, get length(){throw Error('blocked')}}).snapshotRaw(), /inspect Coach/);
});
test('Coach portable validation rejects orphan evidence, mismatched identities, absent definitions and reconciliation references', async () => {
  const {storage} = await seeded(), api=access(storage), portable=api.exportPortable();
  const mutate = fn => {const copy=portable.map(([key,value])=>[key,JSON.parse(value)]);fn(copy);return copy.map(([key,value])=>[key,JSON.stringify(value)]);};
  const before=storage.writes.length;
  assert.throws(() => api.validatePortable(portable.concat([portable[0]])), /duplicate/);
  assert.throws(() => api.validatePortable(mutate(entries=>entries.find(([key])=>key.includes('session_result:result'))[1].sessionResultId='changed')), /identity/);
  assert.throws(() => api.validatePortable(mutate(entries=>entries.find(([key])=>key.includes('programme_state:'))[1].programmeDefinitionVersion=99)), /unavailable programme/);
  assert.throws(() => api.validatePortable(portable.filter(([key])=>!key.includes('programme_state:'))), /saved programme state|owning programme/);
  assert.throws(() => api.validatePortable(portable.filter(([key])=>!key.endsWith('session_result:result-1'))), /missing or unrelated/);
  assert.throws(() => api.validatePortable(mutate(entries=>entries.find(([key])=>key.includes('session_result:partial'))[1].schemaVersion=99)), /schemaVersion/);
  assert.equal(storage.writes.length,before,'validation never mutates');
});
test('Coach backup never drops orphaned result records and blocks index references to absent evidence', async () => {
  const {storage}=await seeded(), api=access(storage);
  storage.removeItem('gf_coach_session_result_index');
  assert.equal(api.validatePortable(api.exportPortable()).sessions,2);
  storage.setItem('gf_coach_session_result_index',JSON.stringify({schemaVersion:1,sessionResultIds:['missing']}));
  assert.throws(() => api.exportPortable(), /missing evidence/);
});
test('raw Coach recovery restores malformed original bytes without interpreting them or touching other domains', () => {
  const storage=new MemoryStorage([['gf_coach_preferences','broken original'],['third-party','secret']]), api=access(storage);
  const before=api.snapshotRaw();
  api.replaceRaw([]);
  api.replaceRaw(before);
  assert.deepEqual(api.snapshotRaw(),before);
  assert.equal(storage.getItem('third-party'),'secret');
});
test('standalone evidence needs no owning programme across replacement', async () => {
  const storage=new MemoryStorage(), store=GarageFitCoachStore.createStore(storage);
  await store.saveSessionResult(sessionResult({source:'generator',programmeInstanceId:null}));
  const api=access(storage), portable=api.exportPortable();
  assert.equal(api.validatePortable(portable).programmes,0);
  const destination=new MemoryStorage(), other=access(destination);
  other.replaceRaw(other.materialisePortable(portable));
  assert.deepEqual((await GarageFitCoachStore.createStore(destination).getSessionResult('result-1')),sessionResult({source:'generator',programmeInstanceId:null}));
});
test('production programme versions remain pinned and multiple programme instances round-trip', async () => {
  require('../data/programmes.js');
  const storage = new MemoryStorage(), store = GarageFitCoachStore.createStore(storage);
  for (const version of [1,2]) await store.saveProgrammeState(programmeState({programmeInstanceId:'prog-'+version,
    programmeDefinitionId:'general-strength-4w',programmeDefinitionVersion:version}));
  const api=GarageFitCoachStore.createBackupAccess(storage), portable=api.exportPortable();
  assert.equal(api.validatePortable(portable).programmes,2);
  const destination=new MemoryStorage();
  GarageFitCoachStore.createBackupAccess(destination).replaceRaw(api.materialisePortable(portable));
  const restored=GarageFitCoachStore.createStore(destination);
  assert.equal((await restored.loadProgrammeState('prog-1')).programmeDefinitionVersion,1);
  assert.equal((await restored.loadProgrammeState('prog-2')).programmeDefinitionVersion,2);
});
test('materialised mixed-case record IDs match raw snapshot ordering exactly', async () => {
  const storage=new MemoryStorage(), store=GarageFitCoachStore.createStore(storage);
  for (const id of ['a-result','Z-result','A-result','z-result'])
    await store.saveSessionResult(sessionResult({sessionResultId:id,source:'generator',programmeInstanceId:null}));
  const api=access(storage), materialised=api.materialisePortable(api.exportPortable());
  api.replaceRaw(materialised);
  assert.deepEqual(api.snapshotRaw(), materialised);
});
test('raw journal preflight rejects unknown Coach keys and draft inspection fails closed', async () => {
  const storage=new MemoryStorage(), api=access(storage);
  assert.equal(api.hasUnsettledDraft(),false);
  storage.setItem('gf_coach_session_draft','corrupt draft');
  assert.equal(api.hasUnsettledDraft(),true,'even corrupt unfinished evidence blocks restore');
  assert.throws(() => api.validateRawEntries([['gf_coach_unknown','{}']]), /unknown/);
  assert.throws(() => access({getItem(){throw Error('blocked')}}).hasUnsettledDraft(), /current workout/);
});
