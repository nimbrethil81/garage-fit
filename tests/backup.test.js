const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const {programmeState, sessionResult, sessionDraft} = require('./helpers/coach-fixtures');

const copy = value => JSON.parse(JSON.stringify(value));
const sorted = map => [...map].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
function harness(initial = [], options = {}) {
  const map = new Map(initial), trace = [];
  let failure = 0, persistent = false, mutations = 0, blocked = false, quota = Infinity;
  function storageError() { return Object.assign(new Error('injected quota/write failure'), {name: 'QuotaExceededError'}); }
  function before() {
    mutations++;
    if (failure && (persistent ? mutations >= failure : mutations === failure)) throw storageError();
  }
  const storage = {
    get length() { return map.size; }, key(i) { return [...map.keys()][i] ?? null; },
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) {
      before(); value = String(value);
      const projected = [...map].reduce((sum, [name, raw]) => sum + (name === key ? 0 : name.length + raw.length), 0) + key.length + value.length;
      if (projected > quota) throw storageError();
      map.set(key, value); trace.push(new Map(map));
    },
    removeItem(key) { before(); map.delete(key); trace.push(new Map(map)); }
  };
  const context = vm.createContext({TextEncoder, crypto: webcrypto});
  context.window = context;
  for (const file of ['data/equipment.js', 'js/coach-model.js', 'js/coach-store.js', 'js/backup-registry.js', 'js/backup.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  }
  const coach = context.GarageFitCoachStore.createBackupAccess(storage, {
    definitions: {'general-strength': {1: {id: 'general-strength', version: 1}}}
  });
  const api = context.GarageFitBackup.create({storage, coach, isBlocked: () => blocked,
    withExclusive: action => action(), now: () => '2026-10-30T19:00:00.000Z', ...options});
  return {map, storage, trace, context, coach, api,
    record(value) { return vm.runInContext('JSON.parse(' + JSON.stringify(JSON.stringify(value)) + ')', context); },
    store: context.GarageFitCoachStore.createStore(storage),
    block(value) { blocked = value; },
    injectFailure(n, persist = false) { failure = n; persistent = persist; mutations = 0; trace.length = 0; },
    limitStorage(value) { quota = value; },
    get mutations() { return mutations; }};
}
async function seed(h, prefix = '') {
  h.storage.setItem('gf_equipment_inventory', '["rings"]');
  h.storage.setItem('gf_equipment_configured', 'true');
  h.storage.setItem('gf_first_use_v1', JSON.stringify({version: 1, audience: 'new', explored: true, modes: ['home'], acknowledged: prefix + 'result-1'}));
  h.storage.setItem('gf_generator_history', '[ ["retired-exercise"] ]');
  h.storage.setItem('gf_appearance_v1', 'dark');
  await h.store.saveProgrammeState(h.record(programmeState({programmeInstanceId: prefix + 'prog-1', currentTargets: {reconciliation: {appliedSessionResultIds: [prefix + 'result-1']}}})));
  await h.store.saveActiveProgramme(h.record({schemaVersion: 1, programmeInstanceId: prefix + 'prog-1', programmeDefinitionId: 'general-strength', programmeDefinitionVersion: 1}));
  await h.store.saveSessionResult(h.record(sessionResult({programmeInstanceId: prefix + 'prog-1', sessionResultId: prefix + 'result-1'})));
  await h.store.saveSessionResult(h.record(sessionResult({programmeInstanceId: prefix + 'prog-1', sessionResultId: prefix + 'partial-1', finalStatus: 'partial'})));
}
async function preservation(h) {
  const backup = await h.api.prepare({preserve: true});
  await h.api.verify(backup.text, {preserve: true});
  return backup;
}
async function archive() { const source = harness(); await seed(source); return {source, file: await source.api.prepare()}; }

test('portable archive round-trips completed/partial immutable evidence, credit, first-use and exact preferences on a new device', async () => {
  const {source, file} = await archive();
  assert.equal(file.status, 'prepared');
  assert.equal((await source.api.verify(file.text)).status, 'verified');
  const inspected = await source.api.validate(file.text);
  assert.equal(inspected.summary.completed, 1); assert.equal(inspected.summary.partial, 1);
  assert.equal(inspected.summary.programmes, 1);
  const target = harness([['other-app', 'leave alone'], ['gf_workout_diagnostics_v1', 'old diagnostics']]);
  assert.equal(target.api.inspectDestination().meaningful, false);
  assert.equal((await target.api.restore(file.text, {confirmed: true})).status, 'restored');
  assert.equal(target.map.get('other-app'), 'leave alone');
  assert.equal(target.map.get('gf_workout_diagnostics_v1'), 'old diagnostics');
  for (const [key, value] of source.map) if (!key.includes('session_result_index')) assert.equal(target.map.get(key), value, key);
  const query = await target.store.listSessionResults();
  assert.equal(query.errors.length, 0);
  assert.deepEqual(copy(query.results).map(result => result.finalStatus).sort(), ['completed', 'partial']);
  const reloaded = harness(target.map);
  assert.equal((await reloaded.api.recover()).status, 'none');
  await preservation(reloaded);
  assert.equal((await reloaded.api.restore(file.text, {confirmed: true})).status, 'restored');
  assert.equal((await reloaded.store.listSessionResults()).results.length, 2, 'repeat restore never appends or duplicates credit');
});

test('sparse destination needs independently reselected exact preservation plus separate destructive confirmation', async () => {
  const {file} = await archive();
  for (const entries of [[['gf_appearance_v1', 'light']], [['gf_equipment_configured', 'true']],
    [['gf_first_use_v1', '{"version":1,"audience":"existing","explored":false,"modes":[],"acknowledged":null}']]]) {
    const target = harness(entries), before = sorted(target.map);
    assert.equal(target.api.inspectDestination().meaningful, true);
    await assert.rejects(target.api.restore(file.text), {code: 'confirmation-required'});
    await assert.rejects(target.api.restore(file.text, {confirmed: true}), {code: 'preservation-required'});
    const prepared = await target.api.prepare({preserve: true});
    await assert.rejects(target.api.restore(file.text, {confirmed: true}), {code: 'preservation-required'});
    assert.deepEqual(sorted(target.map), before, 'preparation is not preservation verification');
    // Recreate after failed attempt invalidates the unverified preservation gate.
    const current = await preservation(target);
    assert.equal(target.api.inspectDestination().preservationVerified, true);
    assert.notEqual(current.identity, file.identity);
    target.storage.setItem('gf_appearance_v1', 'dark');
    assert.equal(target.api.inspectDestination().preservationVerified, false);
    await assert.rejects(target.api.restore(file.text, {confirmed: true}), {code: 'preservation-required'});
    assert.equal(prepared.status, 'prepared');
  }
});

test('unmodified wrong files, corrupt, future versions and duplicate entries reject before any destination mutation', async () => {
  const {file} = await archive();
  const target = harness([['gf_appearance_v1', 'light']]);
  await preservation(target);
  await assert.rejects(target.api.verify(file.text, {preserve: true}), {code: 'preservation-mismatch'});
  const tests = ['{', '{}', file.text.replace('"formatVersion":1', '"formatVersion":2'), file.text.replace('"GarageFit"', '"AnotherApp"')];
  const tampered = JSON.parse(file.text); tampered.sections.preferences.entries.push(tampered.sections.preferences.entries[0]); tests.push(JSON.stringify(tampered));
  const damaged = JSON.parse(file.text); damaged.sections.coach.entries.pop(); tests.push(JSON.stringify(damaged));
  const before = sorted(target.map), writes = target.mutations;
  for (const text of tests) await assert.rejects(target.api.restore(text, {confirmed: true}));
  assert.deepEqual(sorted(target.map), before); assert.equal(target.mutations, writes);
});

test('checksummed archives accept record permutations and mixed-case identities without losing exact records', async () => {
  const source = harness(); await seed(source, 'Mixed-');
  const file = await source.api.prepare(), archive = JSON.parse(file.text);
  archive.sections.preferences.entries.reverse();
  archive.sections.coach.entries.reverse();
  const {checksum, ...payload} = archive;
  archive.checksum = await source.context.GarageFitBackup.fingerprint(payload);
  const target = harness();
  assert.equal((await target.api.restore(JSON.stringify(archive), {confirmed: true})).status, 'restored');
  for (const [key, value] of source.map) if (!key.includes('session_result_index')) assert.equal(target.map.get(key), value);
});

test('duplicate JSON member names and excessive nesting are rejected, including escaped keys and embedded stored JSON', async () => {
  const {file} = await archive(), target = harness();
  const duplicate = file.text.replace('"app":"GarageFit"', '"app":"Other","app":"GarageFit"');
  const escaped = file.text.replace('"app":"GarageFit"', '"a\\u0070p":"Other","app":"GarageFit"');
  const nested = '['.repeat(65) + '0' + ']'.repeat(65);
  for (const text of [duplicate, escaped, nested]) await assert.rejects(target.api.validate(text), {code: 'invalid-file'});
  const document = JSON.parse(file.text);
  document.sections.preferences.entries.find(([key]) => key === 'gf_first_use_v1')[1] =
    '{"version":2,"version":1,"audience":"new","explored":true,"modes":[],"acknowledged":null}';
  const {checksum, ...payload} = document;
  document.checksum = await target.context.GarageFitBackup.fingerprint(payload);
  await assert.rejects(target.api.validate(JSON.stringify(document)), {code: 'invalid-file'});
  assert.equal(target.mutations, 0);
});

test('live activity, unresolved persisted draft, missing protection and unavailable storage block safely', async () => {
  const {file} = await archive();
  const target = harness(); target.block(true);
  await assert.rejects(target.api.prepare(), {code: 'active-session'});
  await assert.rejects(target.api.restore(file.text, {confirmed: true}), {code: 'active-session'});
  target.block(false); await target.store.saveSessionDraft(target.record(sessionDraft()));
  await assert.rejects(target.api.prepare(), {code: 'active-session'});
  await assert.rejects(target.api.restore(file.text, {confirmed: true}), {code: 'active-session'});
  target.storage.setItem('gf_coach_session_draft', '{');
  await assert.rejects(target.api.restore(file.text, {confirmed: true}), {code: 'active-session'});
  const unsupported = harness([], {withExclusive: undefined});
  await assert.rejects(unsupported.api.restore(file.text, {confirmed: true}), {code: 'unsupported-browser'});
  const unavailable = harness([], {storage: null});
  await assert.rejects(unavailable.api.prepare(), {code: 'storage-unavailable'});
});

test('one-shot failure at every significant storage mutation preserves the original or a complete valid replacement', async () => {
  const {file} = await archive(), initial = harness([['unrelated', 'keep']]);
  await seed(initial, 'old-');
  const original = sorted(initial.map);
  const baseline = harness(initial.map); await preservation(baseline); baseline.injectFailure(0);
  await baseline.api.restore(file.text, {confirmed: true});
  const replacement = sorted(baseline.map), phases = baseline.mutations;
  assert.ok(phases > 10, 'exercise real deletion, replacement, journal and reserve phases');
  for (let failAt = 1; failAt <= phases; failAt++) {
    const target = harness(initial.map); await preservation(target); target.injectFailure(failAt);
    try { await target.api.restore(file.text, {confirmed: true}); } catch (_) { /* failure outcome checked below */ }
    const reload = harness(target.map); await reload.api.recover();
    const recovered = sorted(reload.map);
    assert.ok(JSON.stringify(recovered) === JSON.stringify(original) || JSON.stringify(recovered) === JSON.stringify(replacement), `failure ${failAt} must not mix datasets`);
    assert.equal(reload.map.get('unrelated'), 'keep');
  }
});

test('reload after each durable restore mutation recovers the exact original until the journal is removed', async () => {
  const {file} = await archive(), target = harness([['unrelated', 'keep']]);
  await seed(target, 'old-'); const original = sorted(target.map);
  await preservation(target); target.injectFailure(0);
  await target.api.restore(file.text, {confirmed: true});
  const replacement = sorted(target.map);
  for (const interrupted of target.trace) {
    const reload = harness(interrupted), pending = interrupted.has('gf_restore_journal_v1');
    await reload.api.recover();
    assert.deepEqual(sorted(reload.map), pending ? original : replacement);
  }
});

test('startup recovers a valid journal larger than the portable-file bound', async () => {
  // Non-ASCII names exercise encoded byte bounds: each portable file is <8MiB,
  // while preserving both full snapshots makes the journal >8MiB and <24MiB.
  const voice = name => JSON.stringify({voiceURI: 'voice', name, lang: 'en-GB'});
  const source = harness([['gf_spoken_voice_v1', voice('é'.repeat(2200000))]]);
  const file = await source.api.prepare();
  const target = harness([['gf_spoken_voice_v1', voice('ø'.repeat(2200000))]]);
  const original = sorted(target.map);
  await preservation(target); target.injectFailure(0);
  await target.api.restore(file.text, {confirmed: true});
  const staged = target.trace.find(state => state.has('gf_restore_journal_v1'));
  const journalBytes = new TextEncoder().encode(staged.get('gf_restore_journal_v1')).length;
  assert.ok(journalBytes > source.context.GarageFitBackup.MAX_BYTES);
  assert.ok(journalBytes < source.context.GarageFitBackup.MAX_BYTES * 3);
  const reloaded = harness(staged);
  assert.equal((await reloaded.api.recover()).status, 'original-recovered');
  assert.deepEqual(sorted(reloaded.map), original);
});

test('persistent storage failure retains recovery journal and blocks operations until exact recovery is possible', async () => {
  const {file} = await archive(), target = harness([['unrelated', 'keep']]);
  await seed(target, 'old-'); const original = sorted(target.map);
  await preservation(target); target.injectFailure(9, true);
  await assert.rejects(target.api.restore(file.text, {confirmed: true}), {code: 'recovery-required'});
  assert.ok(target.map.has('gf_restore_journal_v1'));
  await assert.rejects(target.api.prepare(), {code: 'recovery-required'});
  await assert.rejects(target.api.restore(file.text, {confirmed: true}), {code: 'recovery-required'});
  target.injectFailure(0);
  assert.equal((await target.api.recover()).status, 'original-recovered');
  assert.deepEqual(sorted(target.map), original);
});

test('realistic quota permits the durable journal but rejects reserve before any registered data changes', async () => {
  const {file} = await archive(), target = harness([['gf_appearance_v1', 'light'], ['unrelated', 'keep']]);
  const original = sorted(target.map);
  await preservation(target);
  // Measure journal capacity from a successful equivalent transaction, rather
  // than relying on implementation-specific snapshot string lengths.
  const control = harness(target.map); await preservation(control); control.injectFailure(0);
  await control.api.restore(file.text, {confirmed: true});
  const staged = control.trace.find(state => state.has('gf_restore_journal_v1'));
  const journalCapacity = [...staged].reduce((sum, [key, raw]) => sum + key.length + raw.length, 0);
  target.limitStorage(journalCapacity + 10);
  await assert.rejects(target.api.restore(file.text, {confirmed: true}), {code: 'storage-write-failed'});
  assert.deepEqual(sorted(target.map), original);
  assert.equal(target.map.has('gf_restore_journal_v1'), false);
  assert.equal(target.map.has('gf_restore_reserve_v1'), false);
});
