(function (root) {
  // Coach persistence: the only code that knows how Coach records are laid out in storage.
  //
  // createStore(storage) wraps a localStorage-compatible adapter (getItem/setItem/removeItem,
  // plus length/key(i) for index recovery). Every method returns a Promise so a later
  // IndexedDB or remote adapter can replace this one without changing Coach domain logic.
  //
  // Layout: separate versioned records, never one ever-growing object -
  //   one active-programme reference, one Programme State per programme instance,
  //   one small ordered Session Result index, one record per Session Result,
  //   one active Session Draft.
  // gf_generator_history is the Generator's own variety mechanism and is never touched here.
  //
  // Failures are surfaced as GarageFitCoachModel.CoachError (code + details), never swallowed:
  // unreadable storage, corrupt JSON, invalid shapes, unsupported versions and failed writes
  // (including quota) all reject. A bad record never crashes the caller's startup by itself;
  // callers decide how to handle the rejection.

  const KEY_PREFIX = 'gf_coach_';
  const ACTIVE_PROGRAMME_KEY = KEY_PREFIX+'active_programme';
  const PROGRAMME_STATE_PREFIX = KEY_PREFIX+'programme_state:';
  const SESSION_INDEX_KEY = KEY_PREFIX+'session_result_index';
  const SESSION_RESULT_PREFIX = KEY_PREFIX+'session_result:';
  const SESSION_DRAFT_KEY = KEY_PREFIX+'session_draft';
  const INDEX_SCHEMA_VERSION = 1;
  // Upper bound on keys inspected when rebuilding a malformed Session Result index.
  const MAX_RECOVERY_KEYS = 10000;

  const programmeStateKey = programmeInstanceId => PROGRAMME_STATE_PREFIX+encodeURIComponent(programmeInstanceId);
  const sessionResultKey = sessionResultId => SESSION_RESULT_PREFIX+encodeURIComponent(sessionResultId);

  function createStore(storage) {
    const Model = root.GarageFitCoachModel;
    if (!Model) throw new Error('GarageFitCoachModel must be loaded before GarageFitCoachStore.');
    const {CoachError} = Model;
    const usable = !!storage && ['getItem','setItem','removeItem'].every(method => typeof storage[method] === 'function');

    // Re-raise a model error with the storage key it came from.
    const withKey = (error, key) => error instanceof CoachError ? new CoachError(error.code, error.message, Object.assign({key}, error.details), error.cause) : error;

    function requireStorage() {
      if (!usable) throw new CoachError('storage-unavailable', 'Coach storage is not available.', {});
    }
    function readRaw(key) {
      requireStorage();
      try { return storage.getItem(key); }
      catch (error) { throw new CoachError('storage-unavailable', 'Could not read Coach storage.', {key}, error); }
    }
    function writeRaw(key, value) {
      requireStorage();
      try { storage.setItem(key, value); }
      catch (error) {
        const quotaExceeded = !!error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22);
        throw new CoachError('storage-write-failed', quotaExceeded ? 'Coach storage is full.' : 'Could not write Coach storage.', {key, quotaExceeded}, error);
      }
    }
    function removeRaw(key) {
      requireStorage();
      try { storage.removeItem(key); }
      catch (error) { throw new CoachError('storage-write-failed', 'Could not remove Coach storage record.', {key}, error); }
    }

    function parse(key, raw, kind) {
      try { return JSON.parse(raw); }
      catch (error) { throw new CoachError('corrupt-record', 'Stored '+kind+' record is not valid JSON.', {key, kind}, error); }
    }

    // Parse, upgrade through the central migration path, then validate. null when absent.
    function readRecord(kind, key) {
      const raw = readRaw(key);
      if (raw === null || raw === undefined) return null;
      try { return Model.assertValid(kind, Model.upgradeRecord(kind, parse(key, raw, kind))); }
      catch (error) { throw withKey(error, key); }
    }
    function writeRecord(kind, key, record) {
      Model.assertValid(kind, record);
      writeRaw(key, JSON.stringify(record));
    }
    function requireMatchingId(record, field, expected, key, kind) {
      if (record && record[field] !== expected) throw new CoachError('invalid-record', 'Stored '+kind+' record '+field+' does not match its key.', {key, kind, errors: [{path: kind+'.'+field, message: 'does not match the requested id'}]});
      return record;
    }

    // ---- Session Result index ----
    function readIndex() {
      const raw = readRaw(SESSION_INDEX_KEY);
      if (raw === null || raw === undefined) return [];
      let index;
      try { index = JSON.parse(raw); }
      catch (error) { throw new CoachError('session-index-corrupt', 'Session Result index is not valid JSON.', {key: SESSION_INDEX_KEY}, error); }
      const version = index && index.schemaVersion;
      if (Number.isInteger(version) && version > INDEX_SCHEMA_VERSION) throw new CoachError('unsupported-schema-version', 'Session Result index schemaVersion '+version+' is newer than supported.', {key: SESSION_INDEX_KEY, schemaVersion: version});
      const ids = index && index.sessionResultIds;
      const valid = version === INDEX_SCHEMA_VERSION && Array.isArray(ids) &&
        ids.every(id => typeof id === 'string' && id.trim() !== '') && new Set(ids).size === ids.length &&
        Object.keys(index).every(key => key === 'schemaVersion' || key === 'sessionResultIds');
      if (!valid) throw new CoachError('session-index-corrupt', 'Session Result index has an invalid shape.', {key: SESSION_INDEX_KEY});
      return ids.slice();
    }
    function writeIndex(ids) {
      writeRaw(SESSION_INDEX_KEY, JSON.stringify({schemaVersion: INDEX_SCHEMA_VERSION, sessionResultIds: ids}));
    }

    // Rebuild the index from the individually stored Session Results (bounded scan, read-only).
    // Unreadable records are reported, never deleted. Ordered by when the session happened.
    function recoverIndex(cause) {
      if (typeof storage.key !== 'function' || !Number.isInteger(storage.length)) {
        throw new CoachError('session-index-corrupt', 'Session Result index is malformed and storage cannot be scanned to rebuild it.', {key: SESSION_INDEX_KEY, recoverable: false}, cause);
      }
      const results = [], errors = [];
      let keys;
      try {
        keys = [];
        for (let i = 0; i < Math.min(storage.length, MAX_RECOVERY_KEYS); i++) keys.push(storage.key(i));
      } catch (error) { throw new CoachError('storage-unavailable', 'Could not scan Coach storage.', {}, error); }
      keys.filter(key => typeof key === 'string' && key.startsWith(SESSION_RESULT_PREFIX)).forEach(key => {
        try {
          const result = readRecord('session-result', key);
          if (result && sessionResultKey(result.sessionResultId) === key) results.push(result);
          else if (result) errors.push(new CoachError('invalid-record', 'Stored session-result record sessionResultId does not match its key.', {key, kind: 'session-result'}));
        } catch (error) { errors.push(withKey(error, key)); }
      });
      const when = result => result.endedAt || result.startedAt || result.generatedAt || null;
      results.sort((a, b) => {
        const ta = when(a), tb = when(b);
        if (ta && tb && Date.parse(ta) !== Date.parse(tb)) return Date.parse(ta) - Date.parse(tb);
        if (!!ta !== !!tb) return ta ? -1 : 1;
        return a.sessionResultId < b.sessionResultId ? -1 : a.sessionResultId > b.sessionResultId ? 1 : 0;
      });
      return {ids: results.map(result => result.sessionResultId), errors};
    }

    function readIndexOrRecover() {
      try { return {ids: readIndex(), recovered: false, errors: []}; }
      catch (error) {
        if (error.code !== 'session-index-corrupt') throw error;
        const recovered = recoverIndex(error);
        return {ids: recovered.ids, recovered: true, errors: recovered.errors};
      }
    }

    function readSessionResult(sessionResultId) {
      const key = sessionResultKey(sessionResultId);
      const result = requireMatchingId(readRecord('session-result', key), 'sessionResultId', sessionResultId, key, 'session-result');
      return result && Model.deepFreeze(result);
    }

    return {
      // ---- Active programme reference ----
      async loadActiveProgramme() { return readRecord('active-programme', ACTIVE_PROGRAMME_KEY); },
      async saveActiveProgramme(reference) { writeRecord('active-programme', ACTIVE_PROGRAMME_KEY, reference); },
      async clearActiveProgramme() { removeRaw(ACTIVE_PROGRAMME_KEY); },

      // ---- Programme State (mutable current state, one record per instance) ----
      async loadProgrammeState(programmeInstanceId) {
        const key = programmeStateKey(programmeInstanceId);
        return requireMatchingId(readRecord('programme-state', key), 'programmeInstanceId', programmeInstanceId, key, 'programme-state');
      },
      async saveProgrammeState(state) {
        Model.assertValid('programme-state', state);
        writeRecord('programme-state', programmeStateKey(state.programmeInstanceId), state);
      },

      // ---- Session Results (immutable evidence, one record each plus an ordered index) ----
      // Resolves {status: 'created'|'unchanged', sessionResultId}. Re-saving identical content is
      // a no-op; different content under an existing id rejects with session-result-conflict.
      async saveSessionResult(result) {
        Model.assertValid('session-result', result);
        const {sessionResultId} = result;
        const key = sessionResultKey(sessionResultId);
        let existing = null;
        if (readRaw(key) !== null) {
          try { existing = readSessionResult(sessionResultId); }
          catch (error) { throw new CoachError('session-result-conflict', 'A Session Result with id '+JSON.stringify(sessionResultId)+' is already stored but unreadable; refusing to overwrite it.', {key, sessionResultId}, error); }
          if (!Model.sameRecord(existing, result)) throw new CoachError('session-result-conflict', 'A different Session Result with id '+JSON.stringify(sessionResultId)+' is already stored; Session Results are immutable.', {key, sessionResultId});
        }
        // Resolve the index before writing anything, so an unusable index never strands a write.
        const index = readIndexOrRecover();
        if (!existing) writeRecord('session-result', key, result);
        if (index.recovered || !index.ids.includes(sessionResultId)) writeIndex(index.ids.includes(sessionResultId) ? index.ids : [...index.ids, sessionResultId]);
        return {status: existing ? 'unchanged' : 'created', sessionResultId};
      },
      async getSessionResult(sessionResultId) { return readSessionResult(sessionResultId); },
      // Resolves {results, errors, indexRecovered}: results in saved order; one unreadable or
      // missing record is reported in errors rather than hiding every other result.
      async listSessionResults() {
        const index = readIndexOrRecover();
        // A quota failure can leave a valid immutable result written before its
        // index entry. Include such evidence on reload so it can still be applied.
        if (!index.recovered && typeof storage.key === 'function' && Number.isInteger(storage.length)) {
          const recovered = recoverIndex();
          const indexedKeys = new Set(index.ids.map(sessionResultKey));
          index.errors.push(...recovered.errors.filter(error => !indexedKeys.has(error.details && error.details.key)));
          recovered.ids.forEach(id => { if (!index.ids.includes(id)) index.ids.push(id); });
        }
        const results = [], errors = index.errors.slice();
        index.ids.forEach(sessionResultId => {
          try {
            const result = readSessionResult(sessionResultId);
            if (result) results.push(result);
            else errors.push(new CoachError('session-index-corrupt', 'Session Result index lists '+JSON.stringify(sessionResultId)+' but no record is stored.', {key: sessionResultKey(sessionResultId), sessionResultId, missing: true}));
          } catch (error) { errors.push(error); }
        });
        return {results, errors, indexRecovered: index.recovered};
      },

      // ---- Active Session Draft (one, mutable) ----
      async loadSessionDraft() { return readRecord('session-draft', SESSION_DRAFT_KEY); },
      async saveSessionDraft(draft) { writeRecord('session-draft', SESSION_DRAFT_KEY, draft); },
      async clearSessionDraft() { removeRaw(SESSION_DRAFT_KEY); }
    };
  }

  // A view of a Coach store for an execution context whose unfinished work is never saved
  // (standalone generated workouts). Its Session Draft lives only in memory, so it can neither
  // be resumed after reload nor replace the single persisted active draft (e.g. an interrupted
  // Coach session). Only a final Session Result reaches the wrapped store, through its usual
  // validated, idempotent path.
  function withEphemeralDraft(store) {
    if (!store || typeof store.saveSessionResult !== 'function') throw new Error('withEphemeralDraft needs a Coach store.');
    const Model = root.GarageFitCoachModel;
    let draft = null;
    return {
      async loadSessionDraft() { return draft; },
      async saveSessionDraft(value) { Model.assertValid('session-draft', value); draft = value; },
      async clearSessionDraft() { draft = null; },
      saveSessionResult: result => store.saveSessionResult(result),
      getSessionResult: sessionResultId => store.getSessionResult(sessionResultId),
      listSessionResults: () => store.listSessionResults()
    };
  }

  root.GarageFitCoachStore = { createStore, withEphemeralDraft };
})(typeof window !== 'undefined' ? window : globalThis);
