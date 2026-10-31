(function (root) {
  'use strict';
  // Portable, durable non-Coach records. Keep raw strings: validation must never
  // rewrite historical evidence, truncate a history, or invent missing values.
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.length > 0;
  const ids = value => Array.isArray(value) && value.every(text);
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const date = value => text(value) && Number.isFinite(Date.parse(value));
  const oneOf = values => value => values.includes(value);
  const json = check => raw => { try { return check(JSON.parse(raw)); } catch (_) { return false; } };
  const sessionIds = value => Array.isArray(value) && value.every(ids);
  const routineSession = value => ids(value) || (object(value) && ids(value.ids)
    && (value.completedAt === undefined || date(value.completedAt)));
  const registry = Object.freeze({
    gf_equipment_inventory: json(value => ids(value) && new Set(value).size === value.length
      && value.every(id => (root.GarageFitData?.equipment || []).some(item => item.id === id))),
    gf_equipment_configured: oneOf(['true', 'false']),
    // Retained for older installations: loadEquipment still interprets this key.
    gf_equipment: oneOf(['true', 'false']),
    gf_generator_duration: oneOf(['10', '15', '20', '30', '45']),
    gf_generator_focus: oneOf(['strength', 'balanced', 'cardio']),
    gf_generator_difficulty: oneOf(['easy', 'normal', 'hard']),
    gf_generator_body_focus: oneOf(['upper', 'full-body', 'lower', 'core']),
    gf_generator_history: json(sessionIds),
    gf_300_pb_seconds: raw => /^\d+$/.test(raw) && count(Number(raw)),
    gf_amrap_results: json(value => Array.isArray(value) && value.every(result => object(result)
      && text(result.workoutId) && result.terminationType === 'amrap'
      && count(result.durationSeconds) && result.durationSeconds > 0
      && count(result.completedRounds) && count(result.additionalReps)
      && count(result.partialReps) && date(result.completedAt))),
    gf_routine_variant: oneOf(['bodyweight', 'equipment']),
    gf_routine_recent_v1: json(value => object(value) && value.version === 1
      && ['warmup', 'cooldown'].every(kind => Array.isArray(value[kind]) && value[kind].every(routineSession))),
    gf_desk_break_recent_v1: json(value => sessionIds(value)
      && value.every(session => session.length === 6 && new Set(session).size === 6)),
    gf_post_run_recent_v1: json(ids),
    gf_appearance_v1: oneOf(['automatic', 'light', 'dark']),
    gf_spoken_voice_v1: json(value => value === null || (object(value)
      && ['voiceURI', 'name', 'lang'].every(key => typeof value[key] === 'string')
      && !!(value.voiceURI || value.name))),
    gf_first_use_v1: json(value => object(value) && value.version === 1
      && ['new', 'existing'].includes(value.audience) && typeof value.explored === 'boolean'
      && Array.isArray(value.modes) && value.modes.every(id => ['home', 'coach'].includes(id))
      && (value.acknowledged == null || typeof value.acknowledged === 'string'))
  });
  function invalid(key) {
    const error = new Error('The backup contains an unsupported or damaged GarageFit preference or history record.');
    error.code = 'invalid-backup-record';
    error.key = key;
    return error;
  }
  function validate(entries) {
    if (!Array.isArray(entries)) throw invalid(null);
    const seen = new Set();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) throw invalid(null);
      const [key, raw] = entry;
      if (typeof key !== 'string' || typeof raw !== 'string' || seen.has(key)
        || !Object.prototype.hasOwnProperty.call(registry, key) || !registry[key](raw)) throw invalid(key);
      seen.add(key);
    }
    return entries;
  }
  root.GarageFitBackupRegistry = Object.freeze({
    keys: Object.freeze(Object.keys(registry)),
    excludedKeys: Object.freeze(['gf_workout_diagnostics_v1', 'gf_restore_journal_v1', 'gf_restore_reserve_v1']),
    validate
  });
})(typeof window !== 'undefined' ? window : globalThis);
