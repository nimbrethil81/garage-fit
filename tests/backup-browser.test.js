const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function lockManager() {
  const held = [];
  return {
    request(name, options, callback) {
      assert.equal(options.ifAvailable, true, 'lease acquisition must not wait indefinitely on another page');
      return Promise.resolve().then(async () => {
        const canAcquire = !held.some(lock => lock.name === name && (lock.mode === 'exclusive' || options.mode === 'exclusive'));
        if (!canAcquire) return callback(null);
        const lock = {name, mode: options.mode}; held.push(lock);
        try { return await callback(lock); }
        finally { held.splice(held.indexOf(lock), 1); }
      });
    },
    get held() { return held.slice(); }
  };
}
function harness({locks = lockManager(), initial = [], configure = () => {}} = {}) {
  const data = initial instanceof Map ? initial : new Map(initial);
  class Storage {
    get length() { return data.size; }
    key(index) { return [...data.keys()][index] ?? null; }
    getItem(key) { return data.get(key) ?? null; }
    setItem(key, value) { data.set(key, String(value)); }
    removeItem(key) { data.delete(key); }
    clear() { data.clear(); }
  }
  const storage = new Storage();
  const context = vm.createContext({Storage, localStorage: storage, navigator: locks ? {locks} : {}, setTimeout, TextEncoder});
  context.window = context;
  configure(context);
  for (const name of ['js/backup.js', 'js/backup-browser.js']) vm.runInContext(fs.readFileSync(name, 'utf8'), context, {filename: name});
  let blocked = false;
  const events = [];
  const browser = context.GarageFitBackupBrowser.create({window: context, storage, isBlocked: () => blocked,
    onBusy: (busy, status) => events.push({busy, state: status.state})});
  return {data, storage, context, browser, locks, events, block(value) { blocked = value; }};
}

test('app startup owns a shared lease before ordinary writes; live peers block replacement and keep both clients usable', async () => {
  const locks = lockManager(), data = new Map(), first = harness({locks, initial: data}), second = harness({locks, initial: data});
  assert.throws(() => first.storage.setItem('gf_appearance_v1', 'dark'), {code: 'operation-in-progress'});
  await first.browser.start(); await second.browser.start();
  first.storage.setItem('gf_appearance_v1', 'dark');
  assert.equal(second.storage.getItem('gf_appearance_v1'), 'dark');
  assert.equal(locks.held.length, 2);
  let called = false;
  await assert.rejects(first.browser.withExclusive(() => { called = true; }), {code: 'another-tab'});
  assert.equal(called, false, 'replacement must never begin beside another live tab');
  assert.equal(first.browser.status().ready, true);
  assert.equal(second.browser.status().ready, true);
  await second.browser.close();
  const result = await first.browser.withExclusive(async () => {
    assert.equal(locks.held.length, 1); assert.equal(locks.held[0].mode, 'exclusive');
    assert.throws(() => first.storage.setItem('late-save', 'stale'), {code: 'operation-in-progress'});
    assert.throws(() => first.storage.removeItem('gf_appearance_v1'), {code: 'operation-in-progress'});
    assert.throws(() => first.storage.clear(), {code: 'operation-in-progress'});
    first.browser.storage.setItem('gf_appearance_v1', 'light');
    return {status: 'restored'};
  });
  assert.equal(result.status, 'restored'); assert.equal(first.browser.status().retained, true);
  assert.equal(first.browser.status().canLeave, false);
  assert.equal(first.browser.status().busy, false, 'success controls may be rendered while stale clients remain frozen');
  assert.throws(() => first.storage.setItem('stale-after-success', 'no'), {code: 'operation-in-progress'});
  const newTab = harness({locks, initial: data});
  await assert.rejects(newTab.browser.start(), {code: 'another-tab'});
  assert.equal(data.has('stale-after-success'), false);
  await first.browser.close(); await newTab.browser.start();
  assert.equal(newTab.browser.status().ready, true);
  await newTab.browser.close();
});

test('interrupted restore is recovered under exclusive startup ownership before any mutable client can run', async () => {
  const h = harness({initial: [['gf_restore_journal_v1', 'journal'], ['gf_appearance_v1', 'mixed']]});
  let recovered = false;
  const result = await h.browser.start(async () => {
    assert.equal(h.locks.held.length, 1); assert.equal(h.locks.held[0].mode, 'exclusive');
    assert.throws(() => h.storage.setItem('first-use', 'premature'), {code: 'operation-in-progress'});
    h.browser.storage.setItem('gf_appearance_v1', 'original');
    h.browser.storage.removeItem('gf_restore_journal_v1');
    recovered = true;
    return {status: 'original-recovered'};
  });
  assert.equal(recovered, true); assert.equal(result.status, 'original-recovered');
  assert.equal(h.storage.getItem('gf_appearance_v1'), 'original');
  assert.equal(h.locks.held[0].mode, 'shared');
  assert.throws(() => h.browser.storage.setItem('misused-adapter', 'bad'), {code: 'exclusive-required'});
  h.storage.setItem('first-use', 'now-safe');
  await h.browser.close();
});

test('persistent recovery failures retain exclusive protection, freeze app clients and permit retry without losing the journal', async () => {
  const h = harness(); await h.browser.start();
  await assert.rejects(h.browser.withExclusive(async () => {
    h.browser.storage.setItem('gf_restore_journal_v1', 'pending');
    throw Object.assign(new Error('write failed'), {code: 'recovery-required'});
  }), {code: 'recovery-required'});
  assert.equal(h.browser.status().state, 'recovery-required');
  assert.equal(h.browser.status().retained, true);
  assert.throws(() => h.storage.setItem('late-result', 'mixed'), {code: 'operation-in-progress'});
  await h.browser.start(async () => {
    h.browser.storage.removeItem('gf_restore_journal_v1');
    return {status: 'original-recovered'};
  });
  assert.equal(h.browser.status().ready, true);
  assert.equal(h.data.has('late-result'), false);
  await h.browser.close();
});

test('unsupported locks allow ordinary use without a journal but fail closed for replacement and interrupted startup', async () => {
  const ordinary = harness({locks: null});
  await ordinary.browser.start();
  ordinary.storage.setItem('gf_appearance_v1', 'dark');
  await assert.rejects(ordinary.browser.withExclusive(() => {}), {code: 'unsupported-browser'});
  await ordinary.browser.close();
  const pending = harness({locks: null, initial: [['gf_restore_journal_v1', 'pending']]});
  let recovered = false;
  await assert.rejects(pending.browser.start(() => { recovered = true; }), {code: 'recovery-required'});
  assert.equal(recovered, false);
  assert.throws(() => pending.storage.setItem('gf_appearance_v1', 'light'), {code: 'operation-in-progress'});
  assert.equal(pending.data.get('gf_restore_journal_v1'), 'pending');
  await pending.browser.close();
});

test('active or pending activity blocks before releasing a healthy shared lease', async () => {
  const h = harness(); await h.browser.start(); h.block(true);
  await assert.rejects(h.browser.withExclusive(() => {}), {code: 'active-session'});
  assert.equal(h.browser.status().ready, true); assert.equal(h.locks.held[0].mode, 'shared');
  await h.browser.close();
});

test('native file sharing is invoked within the save gesture and returns offered, never independently saved', async () => {
  let shared = false;
  const h = harness({configure(win) {
    win.File = class { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; } };
    win.navigator.canShare = value => value.files[0].type === 'application/json';
    win.navigator.share = value => { shared = true; assert.equal(value.files[0].name, 'backup.json'); return Promise.resolve(); };
  }});
  const saving = h.browser.saveFile({text: '{"backup":true}', filename: 'backup.json'});
  assert.equal(shared, true, 'no awaited preparation can consume the activation first');
  const offered = await saving;
  assert.equal(offered.status, 'offered'); assert.equal(offered.method, 'share');
  h.context.navigator.share = () => Promise.reject(Object.assign(new Error('cancelled'), {name: 'AbortError'}));
  assert.equal((await h.browser.saveFile({text: '{}', filename: 'backup.json'})).status, 'cancelled');
  await h.browser.close();
});

test('file picker and browser download fallbacks remain truthful and release temporary URLs', async () => {
  const operations = [];
  const h = harness({configure(win) {
    win.showSaveFilePicker = options => {
      operations.push(['picker', options.suggestedName]);
      return Promise.resolve({createWritable: async () => ({write: async text => operations.push(['write', text]), close: async () => operations.push(['close'])})});
    };
  }});
  const saving = h.browser.saveFile({text: 'archive', filename: 'backup.json'});
  assert.equal(operations[0][0], 'picker');
  assert.equal((await saving).status, 'offered');
  assert.deepEqual(operations.map(item => item[0]), ['picker', 'write', 'close']);
  delete h.context.showSaveFilePicker;
  h.context.Blob = class {};
  h.context.URL = {createObjectURL: () => 'blob:backup', revokeObjectURL: url => operations.push(['revoke', url])};
  h.context.setTimeout = callback => callback();
  h.context.document = {body: {appendChild() {}}, createElement: () => ({download: '', click() { operations.push(['download']); }, remove() {}})};
  assert.equal((await h.browser.saveFile({text: 'archive', filename: 'backup.json'})).method, 'download');
  assert.equal(operations.at(-1)[0], 'revoke');
  await h.browser.close();
});

test('file reading rejects missing, empty and oversized selections before loading content', async () => {
  const h = harness(); let read = false;
  await assert.rejects(h.browser.readFile(null), {code: 'no-file'});
  await assert.rejects(h.browser.readFile({size: 0}), {code: 'invalid-file'});
  await assert.rejects(h.browser.readFile({size: h.context.GarageFitBackup.MAX_BYTES + 1, text() { read = true; }}), {code: 'file-too-large'});
  assert.equal(read, false);
  assert.equal(await h.browser.readFile({size: 7, text: async () => 'archive'}), 'archive');
  await h.browser.close();
});

test('pending save tracking preserves rejection semantics and blocks after a failed finalisation until reload', async () => {
  const h = harness(), activity = h.context.GarageFitBackupActivity;
  let finish, fail;
  const saving = activity.track(new Promise(resolve => { finish = resolve; }));
  const failing = activity.track(new Promise((resolve, reject) => { fail = reject; }));
  assert.equal(activity.pending, 2); assert.equal(activity.failed, false);
  finish('saved'); assert.equal(await saving, 'saved');
  assert.equal(activity.pending, 1);
  fail(new Error('quota'));
  await assert.rejects(failing, /quota/);
  assert.equal(activity.pending, 0); assert.equal(activity.failed, true);
  await h.browser.close();
});


test('synchronous history failure blocks backup without creating an unhandled rejected promise', async () => {
  const h = harness(), activity = h.context.GarageFitBackupActivity;
  assert.equal(activity.failed, false);
  assert.equal(activity.fail(), undefined);
  assert.equal(activity.pending, 0);
  assert.equal(activity.failed, true);
  assert.equal(await activity.track(Promise.resolve('later success')), 'later success');
  assert.equal(activity.failed, true, 'a later unrelated save cannot erase unsaved-session evidence');
  await h.browser.close();
});


test('losing the shared lease during downgrade blocks stale clients and requests reload', async () => {
  const manager = lockManager(); let sharedRequests = 0;
  const locks = {request(name, options, callback) {
    if (options.mode === 'shared' && ++sharedRequests === 2) return Promise.resolve().then(() => callback(null));
    return manager.request(name, options, callback);
  }};
  const h = harness({locks}); await h.browser.start();
  await assert.rejects(h.browser.withExclusive(async () => ({status: 'prepared'})), {code: 'recovery-required'});
  assert.equal(h.browser.status().state, 'blocked');
  assert.equal(h.browser.status().canLeave, false);
  assert.throws(() => h.storage.setItem('stale', 'not allowed'), {code: 'operation-in-progress'});
  await h.browser.close();
});
