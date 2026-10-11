(function (root) {
  // Coach domain contracts: pure, versioned record shapes and their validation.
  //
  // Coach owns longitudinal programme intent; the Generator still builds one workout.
  // These records are the boundaries between them and the evidence of what happened:
  //   programme-state       mutable current state of one programme instance
  //   active-programme      which programme instance is currently active
  //   session-prescription  Coach-to-Generator request for one session
  //   session-result        immutable evidence of one finished (or skipped) session
  //   session-draft         mutable in-progress session, finalised later into a result
  //
  // Unknown stays unknown: optional fields accept null/absent and nothing here fills them
  // from planned values. Policy-owned payloads (anchors, targets, priorities, constraints,
  // feedback, summaries) are only required to be plain JSON until programme policy exists.
  // Records never touch storage here; persistence lives behind js/coach-store.js.

  const SCHEMA_VERSION = 1;
  const RECORD_KINDS = ['programme-state','active-programme','session-prescription','session-result','session-draft'];

  const PROGRAMME_STATUSES = ['active','paused','completed'];
  const PROGRAMME_MODES = ['development','maintenance'];
  const SESSION_SOURCES = ['coach','generator','fixed','external'];
  const FINAL_STATUSES = ['completed','partial','abandoned','skipped-before-start'];
  const OCCURRENCE_STATUSES = ['completed','partial','skipped'];
  const DRAFT_STATES = ['in-progress','finalising','finalised'];
  const ANCHOR_IMPORTANCE = ['required','preferred'];
  const LOAD_UNITS = ['kg','lb'];
  const LOAD_INTERPRETATIONS = ['per-item','total'];
  const TARGET_TYPES = ['reps','timed'];
  // Generator vocabulary carried by a Session Prescription (generate({focus, difficulty,
  // bodyFocus}) and Main block protocols). Kept in step with js/generator.js by tests.
  const WORKOUT_STYLES = ['strength','balanced','cardio'];
  const WORKOUT_DIFFICULTIES = ['easy','normal','hard'];
  const WORKOUT_BODY_FOCUSES = ['upper','full-body','lower','core'];
  const MAIN_PROTOCOLS = ['rounds','paired_sets','timed_intervals'];

  const ERROR_CODES = ['invalid-record','unsupported-schema-version','corrupt-record','storage-unavailable','storage-write-failed','session-result-conflict','session-index-corrupt'];

  class CoachError extends Error {
    constructor(code, message, details = {}, cause) {
      super(message);
      this.name = 'CoachError';
      this.code = code;
      this.details = details;
      if (cause !== undefined) this.cause = cause;
    }
  }

  // ---- Field types: (value, path, errors) => void, pushing {path, message} on failure ----
  const isMissing = value => value === null || value === undefined;
  const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  const describe = value => value === undefined ? 'undefined' : JSON.stringify(value);
  const fail = (errors, path, message) => { errors.push({path,message}); };

  function required(check, expected) {
    return (value, path, errors) => {
      if (value === undefined || value === null) return fail(errors, path, 'is required');
      if (!check(value)) fail(errors, path, 'must be '+expected+' (got '+describe(value)+')');
    };
  }
  // Absent and null both mean "unknown"; anything else must satisfy the type.
  function nullable(type) {
    return (value, path, errors) => { if (!isMissing(value)) type(value, path, errors); };
  }

  const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
  const id = required(value => typeof value === 'string' && value.trim() !== '' && value === value.trim() && value.length <= 200, 'a non-empty trimmed string id');
  const text = required(value => typeof value === 'string' && value.trim() !== '', 'a non-empty string');
  const timestamp = required(value => typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)), 'an ISO 8601 timestamp');
  const positiveInteger = required(value => Number.isInteger(value) && value >= 1, 'a positive integer');
  const nonNegativeInteger = required(value => Number.isInteger(value) && value >= 0, 'a non-negative integer');
  const positiveNumber = required(value => typeof value === 'number' && Number.isFinite(value) && value > 0, 'a positive number');
  const nonNegativeNumber = required(value => typeof value === 'number' && Number.isFinite(value) && value >= 0, 'a non-negative number');
  const boolean = required(value => typeof value === 'boolean', 'a boolean');
  const oneOf = values => required(value => values.includes(value), 'one of '+values.join(', '));
  const exactly = expected => required(value => value === expected, describe(expected));

  function arrayOf(type) {
    return (value, path, errors) => {
      if (value === undefined || value === null) return fail(errors, path, 'is required');
      if (!Array.isArray(value)) return fail(errors, path, 'must be an array (got '+describe(value)+')');
      value.forEach((item, index) => type(item, path+'['+index+']', errors));
    };
  }

  // Plain JSON only (no functions, class instances, NaN/Infinity or cycles), bounded depth.
  function jsonValue(value, path, errors, depth = 0) {
    if (depth > 32) return fail(errors, path, 'is nested too deeply');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail(errors, path, 'must be a finite number'); return; }
    if (Array.isArray(value)) { value.forEach((item, index) => jsonValue(item, path+'['+index+']', errors, depth+1)); return; }
    if (isPlainObject(value)) { Object.keys(value).forEach(key => jsonValue(value[key], path+'.'+key, errors, depth+1)); return; }
    fail(errors, path, 'must be plain JSON (got '+(value === undefined ? 'undefined' : typeof value)+')');
  }
  const jsonObject = (value, path, errors) => {
    if (value === undefined || value === null) return fail(errors, path, 'is required');
    if (!isPlainObject(value)) return fail(errors, path, 'must be an object (got '+describe(value)+')');
    jsonValue(value, path, errors);
  };

  // Closed object shape: unknown fields are rejected so typos never pass as data.
  function shape(fields, check) {
    return (value, path, errors) => {
      if (value === undefined || value === null) return fail(errors, path, 'is required');
      if (!isPlainObject(value)) return fail(errors, path, 'must be an object (got '+describe(value)+')');
      const before = errors.length;
      Object.keys(value).forEach(key => { if (!Object.prototype.hasOwnProperty.call(fields, key)) fail(errors, path+'.'+key, 'is not a recognised field'); });
      Object.keys(fields).forEach(key => fields[key](value[key], path+'.'+key, errors));
      // Cross-field rules only run on a shape whose own fields are individually valid.
      if (check && before === errors.length) check(value, path, errors);
    };
  }

  function uniqueBy(key, label) {
    return (items, path, errors) => {
      if (!Array.isArray(items)) return;
      const seen = new Set();
      items.forEach((item, index) => {
        const value = item && item[key];
        if (isMissing(value)) return;
        if (seen.has(value)) fail(errors, path+'['+index+'].'+key, 'duplicates '+label+' '+describe(value));
        seen.add(value);
      });
    };
  }

  function notBefore(record, earlierKey, laterKey, path, errors) {
    const earlier = record[earlierKey], later = record[laterKey];
    if (isMissing(earlier) || isMissing(later)) return;
    if (Date.parse(later) < Date.parse(earlier)) fail(errors, path+'.'+laterKey, 'must not be before '+earlierKey);
  }

  // ---- Shared sub-records ----
  const loadFields = {
    load: nullable(nonNegativeNumber),
    loadUnit: nullable(oneOf(LOAD_UNITS)),
    loadInterpretation: nullable(oneOf(LOAD_INTERPRETATIONS))
  };
  // A load without a unit cannot be interpreted later, so a known load must name its unit.
  function loadHasUnit(loadKey) {
    return (value, path, errors) => {
      if (!isMissing(value[loadKey]) && isMissing(value.loadUnit)) fail(errors, path+'.loadUnit', 'is required when '+loadKey+' is known');
    };
  }

  // Rep range or timed target. Either bound of a rep range may be unknown, but not both.
  const target = shape({
    type: oneOf(TARGET_TYPES),
    minReps: nullable(positiveInteger),
    maxReps: nullable(positiveInteger),
    seconds: nullable(positiveNumber)
  }, (value, path, errors) => {
    if (value.type === 'reps') {
      if (!isMissing(value.seconds)) fail(errors, path+'.seconds', 'is not used by a reps target');
      if (isMissing(value.minReps) && isMissing(value.maxReps)) fail(errors, path, 'a reps target needs minReps or maxReps');
      if (!isMissing(value.minReps) && !isMissing(value.maxReps) && value.maxReps < value.minReps) fail(errors, path+'.maxReps', 'must not be below minReps');
    } else {
      if (!isMissing(value.minReps) || !isMissing(value.maxReps)) fail(errors, path, 'a timed target does not use minReps/maxReps');
      if (isMissing(value.seconds)) fail(errors, path+'.seconds', 'is required for a timed target');
    }
  });

  const anchorRequirement = shape({
    requirementId: id,
    exerciseId: id,
    importance: oneOf(ANCHOR_IMPORTANCE),
    targetSets: nullable(positiveInteger),
    targetExposures: nullable(positiveInteger),
    target: nullable(target),
    suggestedLoad: nullable(nonNegativeNumber),
    loadUnit: nullable(oneOf(LOAD_UNITS)),
    loadInterpretation: nullable(oneOf(LOAD_INTERPRETATIONS)),
    allowedProtocols: nullable(arrayOf(oneOf(MAIN_PROTOCOLS))),
    progressionIntent: nullable(text)
  }, loadHasUnit('suggestedLoad'));

  // One logged set. Every measure may be unknown; nothing is inferred from the plan.
  const setLog = shape(Object.assign({
    reps: nullable(nonNegativeInteger),
    seconds: nullable(nonNegativeNumber)
  }, loadFields), loadHasUnit('load'));

  // A planned exercise occurrence in the workout as built (what was intended).
  const plannedOccurrence = shape({
    occurrenceId: id,
    exerciseId: id,
    section: nullable(text),
    blockIndex: nullable(nonNegativeInteger),
    requirementId: nullable(id),
    prescription: nullable(jsonObject)
  });

  // What actually happened to one occurrence. status null = not recorded; sets null = not
  // logged in detail (accessories need not be). exerciseId is what was actually performed.
  // targetAchieved is only known when someone confirmed it (e.g. an anchor); null otherwise.
  const occurrenceOutcome = shape({
    occurrenceId: id,
    exerciseId: nullable(id),
    status: nullable(oneOf(OCCURRENCE_STATUSES)),
    sets: nullable(arrayOf(setLog)),
    targetAchieved: nullable(boolean),
    note: nullable(text)
  });

  const substitution = shape({
    occurrenceId: nullable(id),
    requirementId: nullable(id),
    fromExerciseId: id,
    toExerciseId: id,
    reason: nullable(text)
  }, (value, path, errors) => {
    if (value.fromExerciseId === value.toExerciseId) fail(errors, path+'.toExerciseId', 'must differ from fromExerciseId');
  });

  const anchorResult = shape({
    requirementId: id,
    exerciseId: id,
    occurrenceId: nullable(id),
    status: nullable(oneOf(OCCURRENCE_STATUSES)),
    sets: nullable(arrayOf(setLog))
  });

  // ---- Record shapes ----
  const definitionRefFields = {
    programmeInstanceId: id,
    programmeDefinitionId: id,
    programmeDefinitionVersion: positiveInteger
  };

  const activeProgramme = shape(Object.assign({schemaVersion: exactly(SCHEMA_VERSION)}, definitionRefFields));

  const programmeState = shape(Object.assign({schemaVersion: exactly(SCHEMA_VERSION)}, definitionRefFields, {
    status: oneOf(PROGRAMME_STATUSES),
    mode: oneOf(PROGRAMME_MODES),
    startedAt: nullable(timestamp),
    nominalProgress: nullable(nonNegativeNumber),
    meaningfulSessionsCompleted: nullable(nonNegativeInteger),
    anchors: nullable(arrayOf(jsonObject)),
    currentTargets: nullable(jsonObject),
    recentSessionSummaries: nullable(arrayOf(jsonObject)),
    recentOverrides: nullable(arrayOf(jsonObject)),
    recentSubstitutions: nullable(arrayOf(jsonObject)),
    lastAppliedSessionResultId: nullable(id)
  }));

  const sessionPrescription = shape({
    schemaVersion: exactly(SCHEMA_VERSION),
    prescriptionId: id,
    programmeInstanceId: id,
    sessionRole: text,
    duration: nullable(positiveNumber), // minutes, as generate({duration})
    workoutStyle: nullable(oneOf(WORKOUT_STYLES)),
    difficulty: nullable(oneOf(WORKOUT_DIFFICULTIES)),
    bodyFocus: nullable(oneOf(WORKOUT_BODY_FOCUSES)),
    equipment: nullable(arrayOf(id)),
    requiredAnchors: nullable(arrayOf(anchorRequirement)),
    preferredAnchors: nullable(arrayOf(anchorRequirement)),
    movementPriorities: nullable(arrayOf(jsonValue)),
    bodyRegionPriorities: nullable(arrayOf(jsonValue)),
    avoidConstraints: nullable(arrayOf(jsonValue)),
    protocolConstraints: nullable(arrayOf(jsonValue)),
    programmeContext: nullable(jsonObject)
  }, (value, path, errors) => {
    [['requiredAnchors','required'],['preferredAnchors','preferred']].forEach(([key, importance]) => {
      (value[key] || []).forEach((anchor, index) => {
        if (anchor.importance !== importance) fail(errors, path+'.'+key+'['+index+'].importance', 'must be '+describe(importance)+' in '+key);
      });
    });
    uniqueBy('requirementId','requirement')([...(value.requiredAnchors || []), ...(value.preferredAnchors || [])], path+'.anchors', errors);
  });

  // Fields shared by a finished Session Result and an in-progress Session Draft.
  const sessionLinkFields = {
    source: oneOf(SESSION_SOURCES),
    programmeInstanceId: nullable(id),
    prescriptionId: nullable(id),
    workoutId: nullable(id),
    generatedAt: nullable(timestamp),
    startedAt: nullable(timestamp),
    feedback: nullable(jsonObject),
    overrides: nullable(arrayOf(jsonObject)),
    plannedWork: nullable(arrayOf(plannedOccurrence)),
    substitutions: nullable(arrayOf(substitution)),
    anchorResults: nullable(arrayOf(anchorResult))
  };
  function sessionLinkChecks(value, path, errors, performedKey) {
    if (value.source === 'coach') {
      if (isMissing(value.programmeInstanceId)) fail(errors, path+'.programmeInstanceId', 'is required for a coach session');
      if (isMissing(value.prescriptionId)) fail(errors, path+'.prescriptionId', 'is required for a coach session');
    }
    uniqueBy('occurrenceId','occurrence')(value.plannedWork, path+'.plannedWork', errors);
    uniqueBy('occurrenceId','occurrence')(value[performedKey], path+'.'+performedKey, errors);
    uniqueBy('requirementId','requirement')(value.anchorResults, path+'.anchorResults', errors);
  }

  const sessionResult = shape(Object.assign({
    schemaVersion: exactly(SCHEMA_VERSION),
    sessionResultId: id
  }, sessionLinkFields, {
    endedAt: nullable(timestamp),
    actualDurationSeconds: nullable(nonNegativeNumber),
    finalStatus: oneOf(FINAL_STATUSES),
    performedWork: nullable(arrayOf(occurrenceOutcome)),
    derivedExposure: nullable(jsonObject)
  }), (value, path, errors) => {
    sessionLinkChecks(value, path, errors, 'performedWork');
    notBefore(value, 'startedAt', 'endedAt', path, errors);
    if (value.finalStatus === 'skipped-before-start') {
      (value.performedWork || []).forEach((outcome, index) => {
        if (outcome.status === 'completed' || outcome.status === 'partial') fail(errors, path+'.performedWork['+index+'].status', 'cannot record performed work in a session skipped before start');
      });
      (value.anchorResults || []).forEach((result, index) => {
        if (result.status === 'completed' || result.status === 'partial') fail(errors, path+'.anchorResults['+index+'].status', 'cannot record performed work in a session skipped before start');
      });
    }
  });

  const finalisation = shape({
    state: oneOf(DRAFT_STATES),
    sessionResultId: nullable(id)
  }, (value, path, errors) => {
    if (value.state === 'finalised' && isMissing(value.sessionResultId)) fail(errors, path+'.sessionResultId', 'is required once finalised');
  });

  const sessionDraft = shape(Object.assign({
    schemaVersion: exactly(SCHEMA_VERSION),
    draftId: id
  }, sessionLinkFields, {
    updatedAt: nullable(timestamp),
    occurrenceOutcomes: nullable(arrayOf(occurrenceOutcome)),
    finalisation
  }), (value, path, errors) => {
    sessionLinkChecks(value, path, errors, 'occurrenceOutcomes');
    notBefore(value, 'startedAt', 'updatedAt', path, errors);
  });

  const SHAPES = {
    'programme-state': programmeState,
    'active-programme': activeProgramme,
    'session-prescription': sessionPrescription,
    'session-result': sessionResult,
    'session-draft': sessionDraft
  };

  function requireKind(kind) {
    if (!RECORD_KINDS.includes(kind)) throw new Error('Unknown Coach record kind '+describe(kind)+'.');
  }

  function validate(kind, record) {
    requireKind(kind);
    const errors = [];
    SHAPES[kind](record, kind, errors);
    return {valid: errors.length === 0, errors};
  }

  function assertValid(kind, record) {
    const {valid, errors} = validate(kind, record);
    if (!valid) throw new CoachError('invalid-record', 'Invalid '+kind+' record: '+errors.map(error => error.path+' '+error.message).join('; '), {kind, errors});
    return record;
  }

  // ---- Versioning ----
  // Central upgrade path for persisted records. MIGRATIONS[kind][n] upgrades a version-n
  // record to version n+1; none exist yet. Records newer than this build, or without a usable
  // version, are refused rather than reinterpreted.
  const MIGRATIONS = Object.fromEntries(RECORD_KINDS.map(kind => [kind, {}]));

  function upgradeRecord(kind, record) {
    requireKind(kind);
    const version = isPlainObject(record) ? record.schemaVersion : undefined;
    if (!Number.isInteger(version) || version < 1) throw new CoachError('unsupported-schema-version', kind+' record has no valid schemaVersion (got '+describe(version)+').', {kind, schemaVersion: version});
    if (version > SCHEMA_VERSION) throw new CoachError('unsupported-schema-version', kind+' record schemaVersion '+version+' is newer than supported version '+SCHEMA_VERSION+'.', {kind, schemaVersion: version});
    let upgraded = record;
    for (let from = version; from < SCHEMA_VERSION; from++) {
      const migrate = MIGRATIONS[kind][from];
      if (!migrate) throw new CoachError('unsupported-schema-version', 'No migration for '+kind+' schemaVersion '+from+'.', {kind, schemaVersion: version});
      upgraded = Object.assign(migrate(upgraded), {schemaVersion: from+1});
    }
    return upgraded;
  }

  // ---- Construction helpers ----
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.keys(value).forEach(key => deepFreeze(value[key]));
    }
    return value;
  }
  // Key-order-independent serialisation, used to recognise an identical record.
  function canonicalJson(value) {
    if (Array.isArray(value)) return '['+value.map(item => canonicalJson(item === undefined ? null : item)).join(',')+']';
    if (isPlainObject(value)) return '{'+Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
    return JSON.stringify(value);
  }
  const sameRecord = (a, b) => canonicalJson(a) === canonicalJson(b);

  function create(kind, fields) {
    return assertValid(kind, clone(Object.assign({}, fields, {schemaVersion: SCHEMA_VERSION})));
  }
  const createProgrammeState = fields => create('programme-state', fields);
  const createActiveProgramme = fields => create('active-programme', fields);
  const createSessionPrescription = fields => create('session-prescription', fields);
  const createSessionDraft = fields => create('session-draft', fields);
  // Session Results are immutable evidence: the constructed record is deeply frozen.
  const createSessionResult = fields => deepFreeze(create('session-result', fields));

  // The pinned Programme Definition identity of a state or active-programme record.
  function programmeDefinitionRef(record) {
    return {
      programmeDefinitionId: record.programmeDefinitionId,
      programmeDefinitionVersion: record.programmeDefinitionVersion,
      programmeInstanceId: record.programmeInstanceId
    };
  }

  root.GarageFitCoachModel = {
    SCHEMA_VERSION, RECORD_KINDS, PROGRAMME_STATUSES, PROGRAMME_MODES, SESSION_SOURCES, FINAL_STATUSES,
    OCCURRENCE_STATUSES, DRAFT_STATES, ANCHOR_IMPORTANCE, LOAD_UNITS, LOAD_INTERPRETATIONS, TARGET_TYPES,
    WORKOUT_STYLES, WORKOUT_DIFFICULTIES, WORKOUT_BODY_FOCUSES, MAIN_PROTOCOLS, ERROR_CODES,
    CoachError, validate, assertValid, upgradeRecord, MIGRATIONS,
    canonicalJson, sameRecord, deepFreeze,
    createProgrammeState, createActiveProgramme, createSessionPrescription, createSessionResult, createSessionDraft,
    programmeDefinitionRef
  };
})(typeof window !== 'undefined' ? window : globalThis);
