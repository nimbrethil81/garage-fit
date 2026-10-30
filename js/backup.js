(function (root) {
  'use strict';
  // No UI or private Coach keys here. All mutations run under an app-wide exclusive
  // lock supplied by the browser integration; startup recovery precedes app clients.
  const FORMAT = 1, MAX_BYTES = 8 * 1024 * 1024, MAX_KEYS = 20000;
  const JOURNAL = 'gf_restore_journal_v1', RESERVE = 'gf_restore_reserve_v1';
  class BackupError extends Error {
    constructor(code, message, cause) { super(message); this.name = 'BackupError'; this.code = code; this.cause = cause; }
  }
  const fail = (code, message) => { throw new BackupError(code, message); };
  const orderEntries = values => values.slice().sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const bytes = text => new TextEncoder().encode(text).length;
  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  async function fingerprint(value) {
    if (!root.crypto?.subtle) fail('unsupported-browser', 'This browser cannot independently verify backups. Use an up-to-date browser over HTTPS.');
    const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  }
  function exactKeys(value, names) {
    return value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).sort().join('|') === names.slice().sort().join('|');
  }
  function entries(value) {
    if (!Array.isArray(value) || value.length > MAX_KEYS) fail('invalid-file', 'The backup contains too many records or an invalid section.');
    const seen = new Set();
    for (const entry of value) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string'
        || seen.has(entry[0])) fail('invalid-file', 'The backup contains duplicate or invalid records.');
      seen.add(entry[0]);
    }
    return value;
  }
  // Detect duplicate JSON members before JSON.parse can silently overwrite them.
  // Bound nesting before canonical hashing or schema validation uses recursion.
  function checkJson(text) {
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        const start = i++;
        while (i < text.length) {
          if (text[i] === '\\') i += 2;
          else if (text[i] === '"') break;
          else i++;
        }
        const frame = stack.at(-1);
        if (frame?.object && frame.key) {
          const key = JSON.parse(text.slice(start, i + 1));
          if (frame.names.has(key)) fail('invalid-file', 'The backup contains duplicate JSON fields.');
          frame.names.add(key); frame.key = false;
        }
      } else if (char === '{' || char === '[') {
        stack.push({object: char === '{', key: char === '{', names: new Set()});
        if (stack.length > 64) fail('invalid-file', 'The backup is nested too deeply to inspect safely.');
      } else if (char === '}' || char === ']') stack.pop();
      else if (char === ',' && stack.at(-1)?.object) stack.at(-1).key = true;
    }
  }
  function parse(text, limit = MAX_BYTES) {
    if (typeof text !== 'string' || bytes(text) > limit) fail('file-too-large', 'This file is too large to restore safely.');
    try { checkJson(text); return JSON.parse(text); } catch (error) { throw new BackupError('invalid-file', 'Choose a complete GarageFit JSON backup file.', error); }
  }
  function create({storage, coach, registry = root.GarageFitBackupRegistry, isBlocked = () => false,
    withExclusive, now = () => new Date().toISOString()} = {}) {
    if (!coach || !registry) throw new Error('Backup needs the Coach backup API and durable-data registry.');
    let busy = false, preservation = null, prepared = null;
    function available() {
      if (!storage || !['getItem', 'setItem', 'removeItem', 'key'].every(name => typeof storage[name] === 'function'))
        fail('storage-unavailable', 'GarageFit storage is unavailable. Existing data has not been replaced.');
    }
    function read(key) {
      available();
      try { return storage.getItem(key); } catch (error) { throw new BackupError('storage-unavailable', 'GarageFit data could not be read.', error); }
    }
    function write(key, value) {
      try { storage.setItem(key, value); }
      catch (error) { throw new BackupError('storage-write-failed', 'Storage could not save the replacement safely. Free browser storage and try again.', error); }
    }
    function remove(key) {
      try { storage.removeItem(key); }
      catch (error) { throw new BackupError('storage-write-failed', 'Storage could not finish safely. Reload to recover your original data.', error); }
    }
    function requireSettled() {
      if (isBlocked() || coach.hasUnsettledDraft()) fail('active-session', 'Finish or save your current activity before using Backup & Restore.');
      if (read(JOURNAL) !== null) fail('recovery-required', 'An interrupted restore needs recovery. Reload before continuing.');
    }
    function snapshot() {
      available();
      if (!Number.isInteger(storage.length) || storage.length > MAX_KEYS) fail('data-too-large', 'There is too much browser data to inspect safely.');
      const preferences = registry.keys.flatMap(key => { const value = read(key); return value === null ? [] : [[key, value]]; });
      return {preferences: orderEntries(preferences), coach: coach.snapshotRaw()};
    }
    function validateRaw(raw) {
      if (!exactKeys(raw, ['preferences', 'coach'])) fail('invalid-file', 'The data snapshot is incomplete.');
      registry.validate(entries(raw.preferences)); entries(raw.coach);
      coach.validateRawEntries(raw.coach);
      // replaceRaw performs its own strict Coach-key checks; validate portable
      // separately before staging so malformed record bodies can never commit.
      return raw;
    }
    function replace(raw) {
      validateRaw(raw);
      // Delete only registered keys; unknown browser/app data is never touched.
      registry.keys.forEach(remove);
      coach.replaceRaw([]);
      raw.preferences.forEach(([key, value]) => write(key, value));
      coach.replaceRaw(raw.coach);
      if (canonical(snapshot()) !== canonical(raw)) fail('concurrent-change', 'GarageFit data changed during replacement. Original data will be recovered.');
    }
    function portable(raw) {
      registry.validate(raw.preferences);
      // exportPortable reads and validates all stored records, not a displayed history.
      return {preferences: {version: 1, entries: raw.preferences}, coach: {version: 1, entries: coach.exportPortable()}};
    }
    async function validate(text) {
      const archive = parse(text);
      if (!exactKeys(archive, ['app', 'formatVersion', 'createdAt', 'sections', 'checksum']) || archive.app !== 'GarageFit')
        fail('invalid-file', 'Choose a complete GarageFit backup.');
      if (archive.formatVersion !== FORMAT) fail('incompatible-version', 'This backup format is not supported by this version of GarageFit.');
      if (typeof archive.createdAt !== 'string' || !Number.isFinite(Date.parse(archive.createdAt))
        || !exactKeys(archive.sections, ['preferences', 'coach'])) fail('invalid-file', 'The backup date or sections are invalid.');
      for (const section of Object.values(archive.sections)) {
        if (!exactKeys(section, ['version', 'entries']) || section.version !== 1) fail('incompatible-version', 'A backup section is missing or incompatible.');
        entries(section.entries);
      }
      const {checksum, ...payload} = archive;
      if (typeof checksum !== 'string' || checksum !== await fingerprint(payload)) fail('integrity-failed', 'The backup is incomplete or has changed. Choose an unmodified backup file.');
      for (const section of Object.values(archive.sections)) {
        for (const [, raw] of section.entries) if (/^[\s]*[\[{]/.test(raw)) parse(raw);
      }
      registry.validate(archive.sections.preferences.entries);
      const summary = coach.validatePortable(archive.sections.coach.entries);
      return {archive, summary: {...summary, preferences: (summary.preferences || 0) + archive.sections.preferences.entries.length}, identity: await fingerprint(archive.sections)};
    }
    async function run(action, {exclusive = false} = {}) {
      if (busy) fail('operation-in-progress', 'Wait for the current backup or restore to finish.');
      busy = true;
      try {
        if (exclusive) {
          if (typeof withExclusive !== 'function') fail('unsupported-browser', 'This browser cannot protect a restore from other tabs. Use a supported browser.');
          return await withExclusive(action);
        }
        return await action();
      } finally { busy = false; }
    }
    async function prepare({preserve = false} = {}) {
      return run(async () => {
        requireSettled();
        const original = snapshot(), sections = portable(original);
        const payload = {app: 'GarageFit', formatVersion: FORMAT, createdAt: now(), sections};
        const archive = {...payload, checksum: await fingerprint(payload)}, text = JSON.stringify(archive);
        if (bytes(text) > MAX_BYTES) fail('data-too-large', 'Your data is too large for this backup format. Nothing has been omitted.');
        await validate(text);
        requireSettled();
        if (canonical(original) !== canonical(snapshot())) fail('concurrent-change', 'GarageFit changed while preparing the file. Please create a new backup.');
        const result = {text, filename: 'GarageFit-backup-' + payload.createdAt.slice(0, 10) + '.json',
          checksum: archive.checksum, identity: await fingerprint(sections), status: 'prepared'};
        if (preserve) preservation = {original: canonical(original), checksum: result.checksum, verified: false};
        prepared = result;
        return {...result};
      });
    }
    async function verify(text, {preserve = false} = {}) {
      return run(async () => {
        const result = await validate(text);
        if (preserve) {
          requireSettled();
          if (!preservation || result.archive.checksum !== preservation.checksum || canonical(snapshot()) !== preservation.original) {
            preservation = null;
            fail('preservation-mismatch', 'Choose the preservation backup of your current device. If data changed, create a new one.');
          }
          preservation.verified = true;
        } else if (!prepared || result.archive.checksum !== prepared.checksum) fail('verification-mismatch', 'Choose the backup file you just prepared.');
        return {status: 'verified', ...result};
      });
    }
    async function restore(text, {confirmed = false} = {}) {
      return run(async () => {
        if (!confirmed) fail('confirmation-required', 'Confirm that the selected file will replace existing GarageFit data.');
        requireSettled();
        const incoming = await validate(text), original = snapshot();
        if ((original.preferences.length || original.coach.length)
          && (!preservation?.verified || preservation.original !== canonical(original))) {
          preservation = null;
          fail('preservation-required', 'Create and independently verify a preservation backup of the current device before replacing its data.');
        }
        const target = {preferences: orderEntries(incoming.archive.sections.preferences.entries),
          coach: coach.materialisePortable(incoming.archive.sections.coach.entries)};
        validateRaw(target);
        const payload = {version: 1, original, target};
        const journal = JSON.stringify({...payload, checksum: await fingerprint(payload)});
        if (bytes(journal) > MAX_BYTES * 3) fail('data-too-large', 'The restore recovery snapshot is too large. Existing data is unchanged.');
        requireSettled();
        if (canonical(snapshot()) !== canonical(original)) fail('concurrent-change', 'Data changed after verification. Create a new preservation backup.');
        // Preflight journal and space for both datasets while originals are intact.
        // Removing the reserve then clearing the registered domain releases enough
        // capacity for target writes or exact rollback, even on quota-limited storage.
        write(JOURNAL, journal);
        if (read(JOURNAL) !== journal) fail('recovery-required', 'The recovery snapshot could not be stored reliably. Existing data is unchanged.');
        try { write(RESERVE, ' '.repeat(JSON.stringify(target).length + JSON.stringify(original).length)); }
        catch (error) { remove(JOURNAL); throw error; }
        remove(RESERVE);
        if (isBlocked() || coach.hasUnsettledDraft() || canonical(snapshot()) !== canonical(original)) {
          remove(JOURNAL); preservation = null;
          fail('concurrent-change', 'Data changed before replacement. Create a new preservation backup.');
        }
        try {
          replace(target);
          remove(JOURNAL);
          preservation = null; prepared = null;
          return {status: 'restored', reloadRequired: true, summary: incoming.summary};
        } catch (error) {
          try { replace(original); remove(JOURNAL); }
          catch (recoveryError) { throw new BackupError('recovery-required', 'Restore stopped. Reload to recover the original data before using GarageFit.', recoveryError); }
          throw new BackupError('restore-rolled-back', 'Restore did not finish. Your original GarageFit data has been recovered.', error);
        }
      }, {exclusive: true});
    }
    async function recover() {
      // The caller must hold the startup-exclusive lock and must not mount any
      // first-use, Coach or Progress clients unless this resolves successfully.
      return run(async () => {
        const raw = read(JOURNAL);
        if (raw === null) { if (read(RESERVE) !== null) remove(RESERVE); return {status: 'none'}; }
        const journal = parse(raw, MAX_BYTES * 3);
        if (!exactKeys(journal, ['version', 'original', 'target', 'checksum'])) fail('recovery-required', 'The restore recovery record is incomplete. Existing data has been left untouched.');
        const {checksum, ...payload} = journal;
        if (journal.version !== 1 || checksum !== await fingerprint(payload)) fail('recovery-required', 'The restore recovery record cannot be verified. Existing data has been left untouched.');
        validateRaw(journal.original); validateRaw(journal.target);
        remove(RESERVE);
        replace(journal.original);
        remove(JOURNAL);
        return {status: 'original-recovered'};
      });
    }
    return {prepare, verify, validate, restore, recover,
      inspectDestination() { requireSettled(); const raw = snapshot(); return {meaningful: !!(raw.preferences.length || raw.coach.length), preservationVerified: !!preservation?.verified && preservation.original === canonical(raw)}; },
      get busy() { return busy; }};
  }
  root.GarageFitBackup = {create, BackupError, FORMAT, MAX_BYTES, JOURNAL, RESERVE, canonical, fingerprint};
})(typeof window !== 'undefined' ? window : globalThis);
