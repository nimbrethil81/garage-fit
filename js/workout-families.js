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
  root.GarageFitWorkoutFamilies = Object.freeze({FamilyContractError,
    FAMILY_IDS: Object.freeze(Object.keys(definitions)), getDefinition, getStyle, resolveRequest, resolveStyle});
})(typeof window !== 'undefined' ? window : globalThis);
