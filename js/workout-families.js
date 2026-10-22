(function (root) {
  // One resolution seam for future standalone Generator and Coach consumers.
  // See docs/WORKOUT_FAMILIES.md. Composition and feasibility are owned downstream.
  const definitions = root.GarageFitData && root.GarageFitData.workoutFamilies;
  if (!definitions) throw new Error('Load data/workout-families.js before js/workout-families.js.');
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  class FamilyContractError extends Error {
    constructor(code, message) { super(message); this.name = 'FamilyContractError'; this.code = code; }
  }
  function fail(code, message) { throw new FamilyContractError(code, message); }
  function getDefinition(workoutFamilyId, version = 1) {
    if (typeof workoutFamilyId !== 'string' || !own(definitions, workoutFamilyId))
      fail('unknown-workout-family', 'Unknown workout family.');
    if (!Number.isInteger(version) || !own(definitions[workoutFamilyId], version))
      fail('unsupported-workout-family-version', 'Unsupported workout family version.');
    return definitions[workoutFamilyId][version];
  }
  // The published version new workouts use (standalone Generator and Coach family plans).
  const currentVersions = root.GarageFitData.workoutFamilyCurrentVersions || {};
  function currentVersion(workoutFamilyId) {
    getDefinition(workoutFamilyId);
    return getDefinition(workoutFamilyId, own(currentVersions, workoutFamilyId) ? currentVersions[workoutFamilyId] : 1).version;
  }
  function getStyle(workoutFamilyId, familyStyleId, version = 1) {
    const definition = getDefinition(workoutFamilyId, version);
    const style = definition.styles.find(item => item.id === familyStyleId);
    if (!style) fail('unsupported-family-style', 'Internal style is not supported by this workout family.');
    return style;
  }
  function resolveRequest(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
      fail('invalid-family-request', 'Workout family request must be an options object.');
    // No validation, normalisation, random draws or mutation of legacy options here.
    if (options.workoutFamilyId == null) return null;
    const definition = getDefinition(options.workoutFamilyId,
      options.workoutFamilyVersion === undefined ? 1 : options.workoutFamilyVersion);
    if (options.familyStyleId != null)
      fail('invalid-family-request', 'Internal style is selected automatically after family composition.');
    // A disabled Body Focus cannot override family identity, even if stale/invalid.
    let bodyFocus = 'full-body';
    if (definition.bodyFocus.length > 1) {
      bodyFocus = options.bodyFocus == null ? 'full-body' : String(options.bodyFocus).toLowerCase();
      if (!definition.bodyFocus.includes(bodyFocus))
        fail('unsupported-family-body-focus', 'Body Focus is not supported by this workout family.');
    }
    // Legacy focus/workoutStyle preferences stay with their owner, never family policy.
    return Object.freeze({workoutFamilyId: definition.id, workoutFamilyVersion: definition.version,
      bodyFocus, familyStyleId: null});
  }
  function resolveStyle(request, feasibleStyleIds) {
    const selection = resolveRequest(request);
    if (!selection) fail('invalid-family-request', 'An explicit workout family is required to resolve an internal style.');
    if (!Array.isArray(feasibleStyleIds))
      fail('invalid-family-request', 'Composition must supply an ordered list of feasible internal styles.');
    // Validate every candidate; never hide an unsupported pair behind a valid first one.
    feasibleStyleIds.forEach(id => getStyle(selection.workoutFamilyId, id, selection.workoutFamilyVersion));
    if (!feasibleStyleIds.length)
      fail('family-style-unavailable', 'No feasible internal style supplied for this workout family.');
    return Object.freeze({...selection, familyStyleId: feasibleStyleIds[0]});
  }
  // Catalogue-owning tickets register reviewed policy data once; neither entry point
  // can grant eligibility by changing an exercise copy or supplying its own table.
  const membershipPolicies = new Map();
  const membershipKey = definition => definition.membershipPolicy.id + ':' + definition.membershipPolicy.version;
  const identifier = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  function freezeTree(value) {
    Object.values(value).forEach(item => { if (item && typeof item === 'object') freezeTree(item); });
    return Object.freeze(value);
  }
  function registerMembershipPolicy({workoutFamilyId, workoutFamilyVersion = 1, entries} = {}) {
    const definition = getDefinition(workoutFamilyId, workoutFamilyVersion), key = membershipKey(definition);
    if (membershipPolicies.has(key)) fail('duplicate-family-membership', 'A published membership policy may be registered only once.');
    if (!Array.isArray(entries)) fail('invalid-family-membership', 'Membership entries must be an array.');
    const seen = new Set();
    for (const entry of entries) {
      if (!entry || Object.keys(entry).some(field => !['exerciseId', 'role', 'protocols', 'prescriptions', 'requiresMovementRoom', 'minimumDifficulty'].includes(field))
        || !identifier(entry.exerciseId) || !identifier(entry.role) || seen.has(entry.exerciseId + ':' + entry.role)
        || !Array.isArray(entry.protocols) || !entry.protocols.length
        || entry.protocols.some(protocol => !root.GarageFitGenerator || !root.GarageFitGenerator.MAIN_PROTOCOLS.has(protocol))
        || new Set(entry.protocols).size !== entry.protocols.length
        || entry.requiresMovementRoom !== undefined && typeof entry.requiresMovementRoom !== 'boolean'
        || entry.minimumDifficulty !== undefined && !['normal', 'hard'].includes(entry.minimumDifficulty)
        || !Array.isArray(entry.prescriptions) || !entry.prescriptions.length)
        fail('invalid-family-membership', 'Invalid or duplicate family membership entry.');
      seen.add(entry.exerciseId + ':' + entry.role);
      const types = new Set();
      for (const target of entry.prescriptions) {
        const timed = target && ['timed', 'unilateral-timed'].includes(target.type);
        if (!target || Object.keys(target).some(field => !['type', 'minValue', 'maxValue', 'secondsPerRep'].includes(field))
          || !['reps', 'unilateral-reps', 'timed', 'unilateral-timed'].includes(target.type) || types.has(target.type)
          || !Number.isFinite(target.minValue) || !Number.isFinite(target.maxValue)
          || target.minValue <= 0 || target.maxValue < target.minValue || target.maxValue > (timed ? 300 : 100)
          || !timed && (!Number.isInteger(target.minValue) || !Number.isInteger(target.maxValue))
          || target.secondsPerRep !== undefined && (timed || !Number.isFinite(target.secondsPerRep) || target.secondsPerRep < 1 || target.secondsPerRep > 30))
          fail('invalid-family-membership', 'Invalid contextual prescription bounds.');
        types.add(target.type);
      }
    }
    const policy = freezeTree(JSON.parse(JSON.stringify({id: definition.membershipPolicy.id,
      version: definition.membershipPolicy.version, entries})));
    membershipPolicies.set(key, policy);
    return policy;
  }
  function getMembership(context, exerciseId) {
    if (!context || typeof context !== 'object' || Array.isArray(context)
      || Object.keys(context).some(field => !['workoutFamilyId', 'workoutFamilyVersion', 'role', 'difficulty', 'excludedImpact', 'bodyPositions', 'movementRoom'].includes(field))
      || !identifier(context.role)
      || context.difficulty !== undefined && !['easy', 'normal', 'hard'].includes(context.difficulty)
      || context.excludedImpact !== undefined && (!Array.isArray(context.excludedImpact) || context.excludedImpact.some(impact => !['low', 'medium', 'high'].includes(impact)))
      || context.bodyPositions !== undefined && (!Array.isArray(context.bodyPositions) || !context.bodyPositions.length || context.bodyPositions.some(position => !['standing', 'floor', 'supported', 'hanging', 'mixed'].includes(position)))
      || context.movementRoom !== undefined && typeof context.movementRoom !== 'boolean')
      fail('invalid-family-context', 'Invalid family exercise context.');
    const definition = getDefinition(context.workoutFamilyId, context.workoutFamilyVersion === undefined ? 1 : context.workoutFamilyVersion);
    const policy = membershipPolicies.get(membershipKey(definition));
    if (!policy) fail('family-membership-unavailable', 'No reviewed membership policy is registered for this family version.');
    return policy.entries.find(entry => entry.exerciseId === exerciseId && entry.role === context.role) || null;
  }
  root.GarageFitWorkoutFamilies = Object.freeze({FamilyContractError,
    FAMILY_IDS: Object.freeze(Object.keys(definitions)), getDefinition, currentVersion, getStyle, resolveRequest, resolveStyle,
    registerMembershipPolicy, getMembership});
})(typeof window !== 'undefined' ? window : globalThis);
