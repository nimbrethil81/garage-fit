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
  //   one active Session Draft, one optional shared Coach preferences record.
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
  const PREFERENCES_KEY = KEY_PREFIX+'preferences';
  // Upper bound on keys inspected when rebuilding a malformed Session Result index.
  const MAX_RECOVERY_KEYS = 10000;

  const programmeStateKey = programmeInstanceId => PROGRAMME_STATE_PREFIX+encodeURIComponent(programmeInstanceId);
  const sessionResultKey = sessionResultId => SESSION_RESULT_PREFIX+encodeURIComponent(sessionResultId);

  function createStore(storage) {
    const Model = root.GarageFitCoachModel;
    if (!Model) throw new Error('GarageFitCoachModel must be loaded before GarageFitCoachStore.');
    const {CoachError} = Model;
    let reconciled = false;
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
    const metadata = result => ({sessionResultId: result.sessionResultId, source: result.source,
      programmeInstanceId: result.programmeInstanceId || null,
      occurredAt: result.endedAt || result.startedAt || result.generatedAt || null,
      exerciseIds: [...new Set((result.performedWork || []).map(work => work.exerciseId).filter(Boolean))],
      hasPerformedWork: result.source !== 'external' && ['completed','partial'].includes(result.finalStatus)
        && (result.performedWork || []).some(work => {
          if (!['completed','partial'].includes(work.status)) return false;
          const actuals = (work.sets || []).flatMap(set => [set.reps,set.seconds]).filter(value => value != null);
          return !actuals.length || actuals.some(value => value > 0);
        })});
    function readIndex() {
      const raw = readRaw(SESSION_INDEX_KEY);
      if (raw === null || raw === undefined) return {ids: [], entries: []};
      try {
        const value = Model.assertValid('session-result-index', Model.upgradeRecord('session-result-index', parse(SESSION_INDEX_KEY, raw, 'session-result-index')));
        return {ids: value.sessionResultIds.slice(), entries: value.entries && value.entries.slice()};
      } catch (error) {
        if (error.code === 'unsupported-schema-version' && Number.isInteger(error.details.schemaVersion)
          && error.details.schemaVersion > Model.SCHEMA_VERSION) throw withKey(error, SESSION_INDEX_KEY);
        throw new CoachError('session-index-corrupt', 'Session Result index has an invalid shape or JSON.', {key: SESSION_INDEX_KEY}, error);
      }
    }
    function writeIndex(index) {
      const value = {schemaVersion: Model.SCHEMA_VERSION, sessionResultIds: index.ids};
      if (index.entries) value.entries = index.entries;
      writeRecord('session-result-index', SESSION_INDEX_KEY, value);
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
      if (storage.length > MAX_RECOVERY_KEYS) errors.push(new CoachError('session-index-corrupt',
        'Coach history recovery reached its key limit. Some history could not be checked.', {key: SESSION_INDEX_KEY, truncated: true}));
      return {ids: results.map(result => result.sessionResultId), entries: results.map(metadata), errors};
    }

    function readIndexOrRecover() {
      try { return {...readIndex(), recovered: false, errors: []}; }
      catch (error) {
        if (error.code !== 'session-index-corrupt') throw error;
        const recovered = recoverIndex(error);
        return {...recovered, recovered: true};
      }
    }

    function readSessionResult(sessionResultId) {
      const key = sessionResultKey(sessionResultId);
      const result = requireMatchingId(readRecord('session-result', key), 'sessionResultId', sessionResultId, key, 'session-result');
      return result && Model.deepFreeze(result);
    }

    return {
      // Read-only first-use classification, including orphaned/corrupt records. Never
      // reconcile, migrate or reset data merely to decide whether to show guidance.
      async hasInstallationEvidence() {
        requireStorage();
        try {
          if (typeof storage.key !== 'function' || !Number.isInteger(storage.length) || storage.length > MAX_RECOVERY_KEYS)
            throw new Error('Storage cannot be inspected safely.');
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (typeof key !== 'string') throw new Error('Storage key is unreadable.');
            if (key.startsWith(KEY_PREFIX)) return true;
          }
          return false;
        } catch (error) { throw new CoachError('storage-unavailable', 'Could not inspect existing Coach evidence.', {}, error); }
      },
      // Shared, optional planning preferences. Absent storage means none; reads
      // never create records, and clearing never touches programme/history data.
      async loadCoachPreferences() { return readRecord('coach-preferences', PREFERENCES_KEY) || Model.createCoachPreferences(); },
      async saveCoachPreferences(preferences) { writeRecord('coach-preferences', PREFERENCES_KEY, preferences); },
      async clearCoachPreferences() { removeRaw(PREFERENCES_KEY); },
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
        if (index.recovered || !index.ids.includes(sessionResultId)) {
          if (!index.ids.includes(sessionResultId)) {
            index.ids.push(sessionResultId);
            if (index.entries) index.entries.push(metadata(result));
          }
          writeIndex(index);
        }
        return {status: existing ? 'unchanged' : 'created', sessionResultId};
      },
      async getSessionResult(sessionResultId) { return readSessionResult(sessionResultId); },
      // Startup-only scan finds evidence stranded between the result and index writes.
      // Cache successful reconciliation for this store; routine screens never scan keys.
      async reconcileSessionIndex(force = false) {
        if (reconciled && !force) return {errors: [], indexRecovered: false};
        const index = readIndexOrRecover();
        const recovered = recoverIndex();
        // Retain missing references so callers can report them, never hide evidence loss.
        const recoveredIds = new Set(recovered.ids);
        const ids = [...recovered.ids, ...index.ids.filter(id => !recoveredIds.has(id))];
        const byId = new Map((index.entries || []).map(entry => [entry.sessionResultId, entry]));
        recovered.entries.forEach(entry => byId.set(entry.sessionResultId, entry));
        const entries = ids.map(id => byId.get(id));
        const next = {ids, entries: entries.every(Boolean) ? entries : null};
        if (!recovered.errors.some(error => error.details && error.details.truncated)
          && !Model.sameRecord({ids: index.ids, entries: index.entries || null}, next)) writeIndex(next);
        reconciled = true;
        return {errors: recovered.errors, indexRecovered: index.recovered};
      },
      // Filters operate on small metadata before reading evidence. Recent N reads
      // only matching records (plus damaged candidates), newest first when limited.
      async listSessionResults(filters = {}) {
        const index = readIndexOrRecover();
        let entries = index.entries;
        if ((!entries && Object.keys(filters).length)
          || (filters.performedOnly === true && entries && entries.some(entry => entry.hasPerformedWork == null))) {
          const recovered = recoverIndex();
          entries = recovered.entries; index.errors.push(...recovered.errors);
          writeIndex(recovered);
        }
        let candidates = entries || index.ids.map(sessionResultId => ({sessionResultId}));
        const matches = entry => (!filters.programmeInstanceId || entry.programmeInstanceId === filters.programmeInstanceId)
          && (!filters.source || entry.source === filters.source)
          && (!filters.sources || filters.sources.includes(entry.source))
          && (filters.performedOnly !== true || entry.hasPerformedWork === true)
          && (!filters.exerciseId || entry.exerciseIds.includes(filters.exerciseId))
          && (!filters.since || Date.parse(entry.occurredAt) >= Date.parse(filters.since))
          && (!filters.until || Date.parse(entry.occurredAt) <= Date.parse(filters.until));
        candidates = candidates.filter(matches);
        if (filters.limit !== undefined) {
          if (!Number.isInteger(filters.limit) || filters.limit < 0) throw new CoachError('invalid-record', 'History limit must be a non-negative integer.', {});
          candidates = candidates.slice().sort((a,b) => (Date.parse(b.occurredAt) || 0) - (Date.parse(a.occurredAt) || 0)
            || b.sessionResultId.localeCompare(a.sessionResultId));
        }
        // Optional hard read budget for contextual summaries: damaged evidence
        // consumes a candidate too, rather than triggering an unbounded retry scan.
        if (filters.candidateLimit !== undefined) {
          if (!Number.isInteger(filters.candidateLimit) || filters.candidateLimit < 0)
            throw new CoachError('invalid-record', 'History candidate limit must be a non-negative integer.', {});
          candidates = candidates.slice(0, filters.candidateLimit);
        }
        const results = [], errors = index.errors.slice();
        for (const entry of candidates) {
          if (filters.limit !== undefined && results.length >= filters.limit) break;
          const sessionResultId = entry.sessionResultId;
          try {
            const result = readSessionResult(sessionResultId);
            if (result) {
              if (!entries || matches(metadata(result))) results.push(result);
            } else errors.push(new CoachError('session-index-corrupt', 'Session Result index references a missing record.', {key: sessionResultKey(sessionResultId), sessionResultId, missing: true}));
          } catch (error) { errors.push(error); }
        }
        return {results, errors, indexRecovered: index.recovered};
      },

      // ---- Active Session Draft (one, mutable) ----
      async loadSessionDraft() { return readRecord('session-draft', SESSION_DRAFT_KEY); },
      async saveSessionDraft(draft) { writeRecord('session-draft', SESSION_DRAFT_KEY, draft); },
      async clearSessionDraft() { removeRaw(SESSION_DRAFT_KEY); }
    };
  }

  // Synchronous, narrow storage boundary for the backup transaction coordinator.
  // Raw snapshots retain bytes (including the derived index) for exact rollback;
  // portable snapshots are separately validated and never contain a live draft.
  function backupKeyKind(key) {
    if (key === ACTIVE_PROGRAMME_KEY) return 'active-programme';
    if (key === PREFERENCES_KEY) return 'coach-preferences';
    if (key === SESSION_INDEX_KEY) return 'session-result-index';
    if (key === SESSION_DRAFT_KEY) return 'session-draft';
    if (typeof key === 'string' && key.startsWith(PROGRAMME_STATE_PREFIX)) return 'programme-state';
    if (typeof key === 'string' && key.startsWith(SESSION_RESULT_PREFIX)) return 'session-result';
    return null;
  }

  function createBackupAccess(storage, options = {}) {
    const Model = root.GarageFitCoachModel;
    const fail = (code, message, details = {}) => { throw new Model.CoachError(code, message, details); };
    const definitions = options.definitions || (root.GarageFitData || {}).programmes || {};
    function checkEntries(entries, portable) {
      if (!Array.isArray(entries) || entries.length > MAX_RECOVERY_KEYS)
        fail('invalid-record', 'Coach backup exceeds its supported record bound.');
      const seen = new Set();
      entries.forEach(entry => {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string'
          || !backupKeyKind(entry[0]) || seen.has(entry[0])) fail('invalid-record', 'Coach backup contains an unknown or duplicate record.');
        if (portable && [SESSION_INDEX_KEY, SESSION_DRAFT_KEY].includes(entry[0]))
          fail('invalid-record', 'Portable backups cannot contain session drafts or derived indexes.');
        seen.add(entry[0]);
      });
    }
    function snapshotRaw() {
      try {
        if (!storage || typeof storage.key !== 'function' || !Number.isInteger(storage.length)
          || storage.length > MAX_RECOVERY_KEYS) fail('storage-unavailable', 'Storage cannot be fully inspected for backup.');
        const keys = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (typeof key !== 'string') fail('storage-unavailable', 'Storage changed during backup.');
          if (key.startsWith(KEY_PREFIX)) keys.push(key);
        }
        const entries = keys.sort().map(key => [key, storage.getItem(key)]);
        checkEntries(entries, false);
        return entries;
      } catch (error) {
        if (error instanceof Model.CoachError) throw error;
        throw new Model.CoachError('storage-unavailable', 'Could not inspect Coach data for backup.', {}, error);
      }
    }
    function parseEntry(key, raw) {
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (error) { throw new Model.CoachError('corrupt-record', 'Coach backup contains invalid JSON.', {key}, error); }
      const kind = backupKeyKind(key);
      const record = Model.assertValid(kind, Model.upgradeRecord(kind, parsed));
      if (kind === 'programme-state' && programmeStateKey(record.programmeInstanceId) !== key
        || kind === 'session-result' && sessionResultKey(record.sessionResultId) !== key)
        fail('invalid-record', 'Coach record identity does not match its storage key.', {key});
      return record;
    }
    function validatePortable(entries) {
      checkEntries(entries, true);
      const records = entries.map(([key, raw]) => ({key, kind: backupKeyKind(key), value: parseEntry(key, raw)}));
      const states = new Map(records.filter(item => item.kind === 'programme-state').map(item => [item.value.programmeInstanceId, item.value]));
      const results = new Map(records.filter(item => item.kind === 'session-result').map(item => [item.value.sessionResultId, item.value]));
      const checkDefinition = value => {
        const definition = definitions[value.programmeDefinitionId] && definitions[value.programmeDefinitionId][value.programmeDefinitionVersion];
        if (!definition) fail('invalid-record', 'This backup needs an unavailable programme definition.', {programmeDefinitionId: value.programmeDefinitionId, programmeDefinitionVersion: value.programmeDefinitionVersion});
      };
      for (const state of states.values()) {
        checkDefinition(state);
        const targets = state.currentTargets || {};
        const referenced = [state.lastAppliedSessionResultId, targets.lastMeaningfulSessionResultId,
          ...((targets.reconciliation || {}).appliedSessionResultIds || []),
          ...(state.recentSessionSummaries || []).map(item => item.sessionResultId),
          ...(state.recentOverrides || []).map(item => item.sessionResultId),
          ...(state.recentSubstitutions || []).map(item => item.sessionResultId)];
        (state.anchors || []).forEach(anchor => {
          const variation = anchor.variationProgression || {};
          referenced.push(...(variation.evidence || []).map(item => item.sessionResultId));
          (variation.transitions || []).forEach(item => referenced.push(...item.evidenceSessionResultIds));
        });
        referenced.filter(Boolean).forEach(id => {
          const result = results.get(id);
          if (!result || result.source !== 'coach' || result.programmeInstanceId !== state.programmeInstanceId)
            fail('invalid-record', 'Programme state references missing or unrelated session evidence.', {sessionResultId: id});
        });
      }
      records.filter(item => item.kind === 'active-programme').forEach(({value}) => {
        checkDefinition(value);
        const state = states.get(value.programmeInstanceId);
        if (!state || state.programmeDefinitionId !== value.programmeDefinitionId
          || state.programmeDefinitionVersion !== value.programmeDefinitionVersion)
          fail('invalid-record', 'Active programme does not match a saved programme state.');
      });
      for (const result of results.values()) {
        if (result.source === 'coach' && !states.has(result.programmeInstanceId))
          fail('invalid-record', 'Coach session evidence has no owning programme state.', {sessionResultId: result.sessionResultId});
      }
      return {programmes: states.size, completed: [...results.values()].filter(item => item.finalStatus === 'completed').length,
        partial: [...results.values()].filter(item => item.finalStatus === 'partial').length, sessions: results.size,
        preferences: records.filter(item => item.kind === 'coach-preferences').length};
    }
    function exportPortable() {
      const raw = snapshotRaw();
      if (raw.some(([key]) => key === SESSION_DRAFT_KEY)) fail('active-session', 'Finish or resolve the current workout before creating a backup.');
      const entries = raw.filter(([key]) => key !== SESSION_INDEX_KEY);
      validatePortable(entries);
      // A missing derived index is rebuilt on import. Existing indexes must be
      // readable and missing referenced evidence must never disappear.
      const indexEntry = raw.find(([key]) => key === SESSION_INDEX_KEY);
      if (indexEntry) {
        const index = parseEntry(...indexEntry);
        const ids = new Set(entries.filter(([key]) => backupKeyKind(key) === 'session-result').map(([key, value]) => JSON.parse(value).sessionResultId));
        if (index.sessionResultIds.some(id => !ids.has(id))) fail('invalid-record', 'Session history references missing evidence.');
      }
      return entries;
    }
    function materialisePortable(entries) {
      validatePortable(entries);
      const results = entries.filter(([key]) => backupKeyKind(key) === 'session-result').map(entry => parseEntry(...entry));
      results.sort((a,b) => (Date.parse(a.endedAt || a.startedAt || a.generatedAt) || 0)
        - (Date.parse(b.endedAt || b.startedAt || b.generatedAt) || 0) || a.sessionResultId.localeCompare(b.sessionResultId));
      const index = {schemaVersion: Model.SCHEMA_VERSION, sessionResultIds: results.map(item => item.sessionResultId)};
      return [...entries.map(entry => entry.slice()), [SESSION_INDEX_KEY, JSON.stringify(index)]].sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    }
    function replaceRaw(entries) {
      checkEntries(entries, false);
      // The caller must have durably staged its recovery journal before invoking
      // this operation. It intentionally propagates partial-write failures.
      const previous = snapshotRaw(), next = new Map(entries);
      entries.forEach(([key, value]) => storage.setItem(key, value));
      previous.forEach(([key]) => { if (!next.has(key)) storage.removeItem(key); });
    }
    function hasUnsettledDraft() {
      try {
        if (!storage || typeof storage.getItem !== 'function') fail('storage-unavailable', 'Coach storage is unavailable.');
        return storage.getItem(SESSION_DRAFT_KEY) !== null;
      } catch (error) {
        if (error instanceof Model.CoachError) throw error;
        throw new Model.CoachError('storage-unavailable', 'Could not inspect the current workout.', {}, error);
      }
    }
    function validateRawEntries(entries) { checkEntries(entries, false); return entries; }
    return {snapshotRaw, exportPortable, validatePortable, materialisePortable, replaceRaw, validateRawEntries, hasUnsettledDraft};
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
      listSessionResults: filters => store.listSessionResults(filters)
    };
  }

  root.GarageFitCoachStore = { createStore, withEphemeralDraft, createBackupAccess, backupKeyKind };
})(typeof window !== 'undefined' ? window : globalThis);
