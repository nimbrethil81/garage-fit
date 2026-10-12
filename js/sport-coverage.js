(function (root) {
  // Pure policy view over TrainingHistory. Never writes records or plans sessions.
  const copy = value => JSON.parse(JSON.stringify(value));
  const freeze = value => root.GarageFitCoachModel.deepFreeze(value);
  function validateDefinition(definition) {
    const fail = message => { throw new Error('Invalid sport capability policy: ' + message); };
    if (!definition || typeof definition.id !== 'string' || !definition.id || typeof definition.sportId !== 'string'
      || !Number.isInteger(definition.version) || definition.version < 1
      || !Number.isInteger(definition.windowDays) || definition.windowDays < 1
      || definition.balancedMinimum !== 'positive-known-exposure') fail('identity/window/minimum');
    if (!Array.isArray(definition.capabilities) || !definition.capabilities.length) fail('capabilities');
    const ids = definition.capabilities.map(item => item.id);
    if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id)) fail('capability IDs');
    definition.capabilities.forEach(cap => {
      if (!cap.label || !['core','complementary'].includes(cap.priority) || !Array.isArray(cap.facets)
        || !cap.facets.length || new Set(cap.facets).size !== cap.facets.length || !Array.isArray(cap.mappings)) fail('capability structure');
      const membership = new Set();
      cap.mappings.forEach(mapping => {
        if (!cap.facets.includes(mapping.facet) || !mapping.rationale || !['stationary','lateral','travel'].includes(mapping.space)
          || !Array.isArray(mapping.exerciseIds) || !mapping.exerciseIds.length) fail('mapping');
        mapping.exerciseIds.forEach(id => {
          const key = mapping.facet + ':' + id;
          if (typeof id !== 'string' || !id || membership.has(key)) fail('duplicate/invalid exercise membership');
          membership.add(key);
        });
      });
    });
    if (!definition.focusPreferences || !Array.isArray(definition.focusPreferences.balanced)
      || definition.focusPreferences.balanced.length) fail('balanced preferences');
    Object.values(definition.focusPreferences).forEach(preferences => {
      if (!Array.isArray(preferences) || new Set(preferences).size !== preferences.length
        || preferences.some(id => !ids.includes(id))) fail('focus preferences');
    });
    return definition;
  }
  function createPolicy(definition, catalogue) {
    validateDefinition(definition);
    if (!catalogue || typeof catalogue !== 'object') throw new Error('Canonical catalogue required.');
    const policy = freeze(copy(definition)), exercises = freeze(copy(catalogue));
    function classifyExercise(exerciseId) {
      const exercise = Object.prototype.hasOwnProperty.call(exercises, exerciseId) ? exercises[exerciseId] : null;
      const contributions = exercise ? policy.capabilities.flatMap(cap => cap.mappings
        .filter(mapping => mapping.exerciseIds.includes(exerciseId))
        .map(mapping => ({capabilityId: cap.id, facet: mapping.facet, rationale: mapping.rationale}))) : [];
      return freeze({exerciseId, status: !exercise ? 'unknown-exercise' : contributions.length ? 'mapped' : 'unmapped',
        contributions, confidence: contributions.length ? 'derived' : 'unknown', tennisImprovement: 'unproven'});
    }
    function availability(options = {}) {
      const equipment = options.equipment || [];
      const allowedImpact = options.allowedImpact || ['low','medium','high'];
      if (!Array.isArray(equipment) || !Array.isArray(allowedImpact)
        || allowedImpact.some(value => !['low','medium','high'].includes(value))
        || options.smallSpace !== undefined && typeof options.smallSpace !== 'boolean') throw new Error('Invalid availability constraints.');
      return freeze(policy.capabilities.map(cap => {
        const candidates = [...new Set(cap.mappings.flatMap(mapping => mapping.exerciseIds))].map(exerciseId => {
          const exercise = Object.prototype.hasOwnProperty.call(exercises, exerciseId) ? exercises[exerciseId] : null;
          const mappings = cap.mappings.filter(mapping => mapping.exerciseIds.includes(exerciseId));
          const reasons = [];
          if (!exercise) reasons.push('missing-catalogue-exercise');
          else {
            if (!exercise.main || !exercise.generator) reasons.push('not-generated-main');
            if (!(exercise.mainProtocols || ['rounds','paired_sets']).some(protocol => ['rounds','paired_sets'].includes(protocol))) reasons.push('unsupported-protocol');
            if (!(exercise.equipment || []).every(group => group.some(id => equipment.includes(id)))) reasons.push('equipment');
            if (!allowedImpact.includes(exercise.impact)) reasons.push('impact');
            if (options.smallSpace && policy.capabilities.some(capability => capability.mappings.some(mapping =>
              mapping.exerciseIds.includes(exerciseId) && mapping.space !== 'stationary'))) reasons.push('space');
          }
          return {exerciseId, available: !reasons.length, reasons, facets: mappings.map(mapping => mapping.facet),
            equipment: exercise && exercise.equipment || [], impact: exercise && exercise.impact || null,
            bodyPosition: exercise && exercise.bodyPosition || null, mainRole: exercise && exercise.mainRole || null,
            family: exercise && exercise.family || null, movementPlanes: exercise && exercise.movementPlanes || [],
            difficulty: exercise && exercise.difficulty || null};
        });
        const available = candidates.filter(candidate => candidate.available);
        return {capabilityId: cap.id, achievable: available.length > 0, candidates,
          missingFacets: cap.facets.filter(facet => !available.some(candidate => candidate.facets.includes(facet)))};
      }));
    }
    function summarize(history, options) {
      if (!history || !Array.isArray(history.performances) || typeof history.exactExercisePerformances !== 'function') throw new Error('TrainingHistory required.');
      if (!options || typeof options.now !== 'string' || !Number.isFinite(Date.parse(options.now))) throw new Error('Explicit assessment time required.');
      const focus = options.focus === undefined ? 'balanced' : options.focus;
      if (!Object.prototype.hasOwnProperty.call(policy.focusPreferences, focus)) throw new Error('Unknown sport focus.');
      const until = new Date(options.now).toISOString();
      const since = new Date(Date.parse(until) - policy.windowDays * 86400000).toISOString();
      const scope = {since, until, programmeInstanceId: options.programmeInstanceId,
        includeStandalone: options.includeStandalone === true, sections: options.sections || ['main']};
      const exerciseIds = [...new Set(history.performances.map(item => item.exerciseId))];
      // History already deduplicates results/occurrences and resolves actual substitute IDs.
      const scopedWork = exerciseIds.flatMap(id => history.exactExercisePerformances(id, scope))
        .sort((a,b) => Date.parse(a.occurredAt)-Date.parse(b.occurredAt)
          || a.sessionResultId.localeCompare(b.sessionResultId) || a.occurrenceId.localeCompare(b.occurrenceId));
      const observations = scopedWork.filter(item => item.semanticConfidence === 'derived' && classifyExercise(item.exerciseId).status === 'mapped');
      const unclassifiedObservations = scopedWork.filter(item => !observations.includes(item))
        .map(item => ({performance: item, classification: item.semanticConfidence === 'unknown'
          ? {exerciseId: item.exerciseId, status: 'unknown-exercise', contributions: [], confidence: 'unknown', tennisImprovement: 'unproven'}
          : classifyExercise(item.exerciseId)}));
      const available = availability(options);
      const capabilities = policy.capabilities.map((cap,index) => {
        const work = observations.filter(item => classifyExercise(item.exerciseId).contributions.some(c => c.capabilityId === cap.id));
        const exposure = root.GarageFitTrainingHistory.sumExposure(work);
        return {capabilityId: cap.id, label: cap.label, priority: cap.priority,
          preferred: policy.focusPreferences[focus].includes(cap.id), balancedMinimum: policy.balancedMinimum,
          coverage: exposure.value > 0 ? 'observed' : work.some(item => item.exposure.confidence === 'unknown') ? 'unknown' : 'not-observed',
          exposure, observations: work, achievable: available[index].achievable, missingFacets: available[index].missingFacets,
          facets: cap.facets.map(facet => ({facet, exposure: root.GarageFitTrainingHistory.sumExposure(work.filter(item =>
            classifyExercise(item.exerciseId).contributions.some(c => c.capabilityId === cap.id && c.facet === facet)))}))};
      });
      return freeze({policyId: policy.id, policyVersion: policy.version, sportId: policy.sportId, focus,
        window: {since, until, days: policy.windowDays}, capabilities, unclassifiedObservations,
        uniqueExposure: root.GarageFitTrainingHistory.sumExposure(observations),
        interpretation: 'Exercise occurrence exposure, not sets or proven tennis improvement. Capability values overlap and must not be added. No catch-up debt.'});
    }
    return Object.freeze({definition: policy, classifyExercise, availability, summarize});
  }
  root.GarageFitSportCoverage = {validateDefinition, createPolicy};
})(typeof window !== 'undefined' ? window : globalThis);
