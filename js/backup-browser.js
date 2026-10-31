(function (root) {
  'use strict';
  const LOCK = 'garagefit-data-use-v1';
  let pendingActivity = 0, failedActivity = false;
  const activity = {
    track(value) {
      const observed = Promise.resolve(value);
      pendingActivity++;
      // Observe both outcomes without creating an ignored rejected derivative.
      observed.then(() => { pendingActivity--; }, () => { pendingActivity--; failedActivity = true; });
      return observed;
    },
    fail() { failedActivity = true; },
    get pending() { return pendingActivity; },
    get failed() { return failedActivity; }
  };
  function problem(code, message, cause) {
    const ErrorType = root.GarageFitBackup?.BackupError || Error;
    const error = new ErrorType(code, message, cause);
    error.code = code;
    if (ErrorType === Error) error.message = message;
    return error;
  }
  function create({window: win = root, storage: suppliedStorage, isBlocked = () => false, onBusy = () => {}} = {}) {
    let storage = suppliedStorage;
    try { if (storage === undefined) storage = win.localStorage; } catch (_) {}
    const locks = win.navigator?.locks;
    const supported = !!locks && typeof locks.request === 'function';
    let state = 'new', shared = null, exclusive = null, operating = false;
    const journalKey = root.GarageFitBackup?.JOURNAL || 'gf_restore_journal_v1';
    const reserveKey = root.GarageFitBackup?.RESERVE || 'gf_restore_reserve_v1';
    const native = {};
    for (const name of ['getItem', 'setItem', 'removeItem', 'key', 'clear']) {
      if (storage && typeof storage[name] === 'function') native[name] = storage[name];
    }
    function status() {
      return {state, supported, ready: state === 'ready', busy: operating,
        exclusive: !!exclusive, retained: state === 'reload-required' || state === 'recovery-required',
        canLeave: state === 'ready'};
    }
    function storageReady() {
      if (!storage || !['getItem', 'setItem', 'removeItem', 'key'].every(name => native[name]))
        throw problem('storage-unavailable', 'GarageFit storage is unavailable. Existing data has not been replaced.');
    }
    const rawRead = key => { storageReady(); return native.getItem.call(storage, key); };
    function pendingRecovery() { return rawRead(journalKey) !== null || rawRead(reserveKey) !== null; }
    function allowOrdinaryWrite() {
      if (state !== 'ready') throw problem('operation-in-progress', 'GarageFit data is protected while backup recovery or replacement is in progress.');
    }
    // The coordinator alone receives this bypass adapter. Ordinary clients keep
    // localStorage and cannot race a late microtask into a protected replacement.
    const coordinatorStorage = {
      get length() { storageReady(); return storage.length; },
      key(index) { storageReady(); return native.key.call(storage, index); },
      getItem: rawRead,
      setItem(key, value) {
        storageReady();
        if (!exclusive) throw problem('exclusive-required', 'A protected data operation must own the GarageFit storage lease.');
        native.setItem.call(storage, key, value);
      },
      removeItem(key) {
        storageReady();
        if (!exclusive) throw problem('exclusive-required', 'A protected data operation must own the GarageFit storage lease.');
        native.removeItem.call(storage, key);
      }
    };
    const prototype = win.Storage?.prototype;
    const patched = [];
    if (prototype) {
      for (const name of ['setItem', 'removeItem', 'clear']) {
        const original = prototype[name];
        if (typeof original !== 'function') continue;
        const guarded = function (...args) {
          if (this === storage) allowOrdinaryWrite();
          return original.apply(this, args);
        };
        prototype[name] = guarded;
        patched.push({name, original, guarded});
      }
    }
    function notify(value) { onBusy(value, status()); }
    async function lease(mode) {
      let resolveAcquired, rejectAcquired;
      const acquired = new Promise((resolve, reject) => { resolveAcquired = resolve; rejectAcquired = reject; });
      let completion;
      try {
        completion = Promise.resolve(locks.request(LOCK, {mode, ifAvailable: true}, lock => {
          if (!lock) { resolveAcquired(null); return; }
          let release;
          const held = new Promise(resolve => { release = resolve; });
          resolveAcquired({async release() { release(); await completion; }});
          return held;
        }));
        completion.catch(rejectAcquired);
      } catch (error) { rejectAcquired(error); }
      return acquired;
    }
    async function sharedLease() {
      shared = await lease('shared');
      if (!shared) throw problem('another-tab', 'Another GarageFit data operation is running. Close other GarageFit tabs, then reload.');
    }
    async function releaseShared() { const previous = shared; shared = null; if (previous) await previous.release(); }
    async function releaseExclusive() { const previous = exclusive; exclusive = null; if (previous) await previous.release(); }
    async function start(recover) {
      if (operating) throw problem('operation-in-progress', 'Wait for the current GarageFit data operation to finish.');
      if (state === 'ready') return {status: 'none', supported};
      if (state === 'reload-required') throw problem('reload-required', 'Reload GarageFit to use the restored data.');
      operating = true; state = 'starting'; notify(true);
      try {
        storageReady();
        if (!supported) {
          if (pendingRecovery()) throw problem('recovery-required', 'An interrupted restore needs a browser with protected storage access. Open GarageFit in an up-to-date supported browser.');
          state = 'ready';
          return {status: 'none', supported: false};
        }
        if (!shared && !exclusive) await sharedLease();
        let recovery = {status: 'none'};
        if (pendingRecovery()) {
          await releaseShared();
          if (!exclusive) exclusive = await lease('exclusive');
          if (!exclusive) throw problem('another-tab', 'Close other GarageFit tabs before recovering this interrupted restore, then reload.');
          if (typeof recover !== 'function') throw problem('recovery-required', 'GarageFit could not start recovery. Reload to try again.');
          state = 'recovering';
          recovery = await recover();
          if (pendingRecovery()) throw problem('recovery-required', 'Recovery is not complete. Reload before using GarageFit.');
          await releaseExclusive();
          await sharedLease();
          if (pendingRecovery()) throw problem('recovery-required', 'Another restore was interrupted. Reload to recover before using GarageFit.');
        }
        state = 'ready';
        return {...recovery, supported: true};
      } catch (error) {
        state = exclusive ? 'recovery-required' : 'blocked';
        throw error;
      } finally { operating = false; notify(false); }
    }
    async function withExclusive(action) {
      if (operating || state !== 'ready') throw problem('operation-in-progress', 'Finish the current data operation or reload before restoring.');
      if (!supported) throw problem('unsupported-browser', 'This browser cannot protect a backup or restore from other tabs. Use an up-to-date browser over HTTPS.');
      if (isBlocked()) throw problem('active-session', 'Finish or save your current activity before restoring a backup.');
      operating = true; state = 'acquiring'; notify(true);
      let retained = false;
      try {
        await releaseShared();
        exclusive = await lease('exclusive');
        if (!exclusive) throw problem('another-tab', 'Close other GarageFit tabs or windows before restoring, then try again.');
        state = 'exclusive';
        if (isBlocked()) throw problem('active-session', 'Finish or save your current activity before restoring a backup.');
        const result = await action();
        if (result?.status === 'restored') { state = 'reload-required'; retained = true; }
        return result;
      } catch (error) {
        if (exclusive) {
          let pending = true;
          try { pending = pendingRecovery(); } catch (_) { /* An unreadable journal must keep the lease. */ }
          if (pending) { state = 'recovery-required'; retained = true; }
        }
        throw error;
      } finally {
        if (!retained) {
          await releaseExclusive();
          try { await sharedLease(); state = 'ready'; }
          catch (error) {
            state = 'blocked';
            throw problem('recovery-required', 'GarageFit changed in another tab. Close other GarageFit tabs and reload before continuing.', error);
          }
        }
        operating = false; notify(false);
      }
    }
    async function readFile(file) {
      if (!file) throw problem('no-file', 'No file was selected. Choose a GarageFit JSON backup.');
      const limit = root.GarageFitBackup?.MAX_BYTES || 8 * 1024 * 1024;
      if (!Number.isSafeInteger(file.size) || file.size < 1) throw problem('invalid-file', 'Choose a non-empty GarageFit JSON backup file.');
      if (file.size > limit) throw problem('file-too-large', 'This file is too large to restore safely.');
      try {
        if (typeof file.text === 'function') return await file.text();
        if (typeof win.FileReader !== 'function') throw problem('unsupported-browser', 'This browser cannot read backup files. Use an up-to-date browser.');
        return await new Promise((resolve, reject) => {
          const reader = new win.FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error('File read failed.'));
          reader.onabort = () => reject(problem('file-cancelled', 'File selection was cancelled. Existing data is unchanged.'));
          reader.readAsText(file);
        });
      } catch (error) {
        if (typeof error.code === 'string') throw error;
        throw problem('file-read-failed', 'The selected file could not be read. Choose it again.', error);
      }
    }
    async function saveFile(prepared) {
      if (!prepared || typeof prepared.text !== 'string' || typeof prepared.filename !== 'string')
        throw problem('no-file', 'Create a backup before saving it.');
      const nav = win.navigator || {};
      try {
        const file = typeof win.File === 'function' ? new win.File([prepared.text], prepared.filename, {type: 'application/json'}) : null;
        // Invoke each native picker directly from the user's Save button gesture.
        if (file && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({files: [file]})) {
          await nav.share({files: [file], title: 'GarageFit backup'});
          return {status: 'offered', method: 'share'};
        }
        if (typeof win.showSaveFilePicker === 'function') {
          const handle = await win.showSaveFilePicker({suggestedName: prepared.filename, types: [{description: 'GarageFit JSON backup', accept: {'application/json': ['.json']}}]});
          const stream = await handle.createWritable();
          try { await stream.write(prepared.text); await stream.close(); }
          catch (error) { try { await stream.abort(); } catch (_) {} throw error; }
          return {status: 'offered', method: 'file-picker'};
        }
        if (typeof win.Blob !== 'function' || typeof win.URL?.createObjectURL !== 'function')
          throw problem('unsupported-browser', 'This browser cannot offer a backup file. Use an up-to-date browser.');
        const anchor = win.document.createElement('a');
        if (!('download' in anchor)) throw problem('unsupported-browser', 'This browser cannot offer a backup download. Use a browser with file sharing or downloads.');
        const url = win.URL.createObjectURL(new win.Blob([prepared.text], {type: 'application/json'}));
        anchor.href = url; anchor.download = prepared.filename; anchor.hidden = true;
        win.document.body.appendChild(anchor);
        anchor.click(); anchor.remove();
        win.setTimeout(() => win.URL.revokeObjectURL(url), 60000);
        return {status: 'offered', method: 'download'};
      } catch (error) {
        if (error.name === 'AbortError') return {status: 'cancelled'};
        if (typeof error.code === 'string') throw error;
        throw problem('file-save-failed', 'The file could not be offered for saving. Try again or use another browser.', error);
      }
    }
    async function close() {
      await releaseShared(); await releaseExclusive(); state = 'closed';
      for (const {name, original, guarded} of patched) if (prototype[name] === guarded) prototype[name] = original;
    }
    // Keep leases while a page is in the back-forward cache; releasing on pagehide
    // would let a stale cached client resume after another page replaced its data.
    return {start, withExclusive, readFile, saveFile, status, supported: () => supported, storage: coordinatorStorage, close};
  }
  root.GarageFitBackupActivity = activity;
  root.GarageFitBackupBrowser = {create, LOCK};
})(typeof window !== 'undefined' ? window : globalThis);
