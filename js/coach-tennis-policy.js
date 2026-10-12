(function (root) {
  // Pure Tennis decisions. The injected Generator preflight owns physical timing.
  const copy = value => JSON.parse(JSON.stringify(value));
  const Model = () => root.GarageFitCoachModel;
  const strength = root.GarageFitCoachPolicies.generalStrengthPolicy;
  const DAY = 86400000;
  const roleOverride = 'tennis-session-role';
  function settings(definition, state, context = {}) {
    return Model().createProgrammeSettings(context.programmeSettings
      || state && state.currentTargets.programmeSettings || definition.defaultProgrammeSettings);
  }
  function coveragePolicy(definition, catalogue) {
    const pin = definition.sportPolicy;
    const mapping = root.GarageFitData.sportCapabilityPolicies[pin.sportId][pin.version];
    return root.GarageFitSportCoverage.createPolicy(mapping, catalogue);
  }
  function validateProgrammeSettings({settings: value}) {
    Model().assertProgrammeSettings(value);
    if (value.sportId !== 'tennis') throw new Error('Tennis Conditioning requires tennis settings.');
  }
  function validateDefinition(definition) {
    strength.validateDefinition(definition);
    validateProgrammeSettings({settings: settings(definition)});
    if (definition.type !== 'tennis-conditioning' || !definition.openEnded
      || definition.coverageTargets.windowDays !== 14 || definition.progressionPolicy.strategy !== 'double-progression'
      || definition.progressionPolicy.minReps !== 6 || definition.progressionPolicy.maxReps !== 10
      || definition.shortSessionPolicy.tiers.length || !Number.isFinite(definition.preparationTimingReserveSeconds)
      || definition.preparationTimingReserveSeconds < 0) throw new Error('Invalid Tennis training contract.');
    const requirements = definition.anchorSelectionPolicy.requirements;
    if (requirements.length !== 4 || new Set(requirements.map(item => item.roleId)).size !== 4
      || requirements.some(item => !['knee','hinge','push','pull'].includes(item.roleId)
        || item.importance !== 'required' || item.targetSets !== 2 || item.targetExposures !== undefined
        || item.prescriptionMode !== 'reps' || item.target.minReps !== 6 || item.target.maxReps !== 6
        || !Array.isArray(item.patterns) || !item.patterns.length || item.patterns.some(pattern => !Model().MOVEMENT_PATTERNS.includes(pattern))
        || item.allowedProtocols.length !== 1 || item.allowedProtocols[0] !== 'rounds')) throw new Error('Tennis needs four two-set rounds anchors.');
    const pin = definition.sportPolicy, mappings = root.GarageFitData && root.GarageFitData.sportCapabilityPolicies;
    if (!root.GarageFitSportCoverage || !pin || pin.sportId !== 'tennis' || !mappings || !mappings.tennis[pin.version]) throw new Error('Tennis needs its pinned sport capability mapping.');
    const capabilities = mappings.tennis[pin.version].capabilities.map(item => item.id);
    [1,2,3].forEach(frequency => {
      const roles = definition.sessionRoles && definition.sessionRoles[frequency];
      if (!Array.isArray(roles) || roles.length !== frequency || new Set(roles.map(role => role.id)).size !== frequency
        || roles.some(role => !role.id || !role.label || !Array.isArray(role.capabilities) || !role.capabilities.length
          || role.capabilities.some(id => !capabilities.includes(id)) || !Array.isArray(role.anchorLimits)
          || role.anchorLimits.length !== definition.supportedDurations.length
          || role.anchorLimits.some(value => !Number.isInteger(value) || value < 0 || value > 4))) throw new Error('Invalid Tennis session roles.');
    });
  }
  function anchorEligible(exercise, context, requirement) {
    if (!exercise || !exercise.main || !exercise.generator
      || !(exercise.equipment || []).every(group => group.some(id => (context.equipment || []).includes(id)))
      || (context.easyToday || context.difficulty === 'easy') && exercise.difficulty === 'hard') return false;
    return requirement.patterns.some(pattern => exercise.patterns.includes(pattern))
      && exercise.mainRole === 'primary' && !exercise.conditioning && exercise.strength >= exercise.cardio
      && !exercise.prescription.type.includes('timed') && exercise.mainProtocols.includes('rounds');
  }
  function anchorAlternatives({definition, catalogue, context, state, requirementId}) {
    const requirement = definition.anchorSelectionPolicy.requirements.find(item => item.requirementId === requirementId);
    if (!requirement) throw new Error('Unknown Tennis anchor role.');
    return requirement.exerciseIds.filter(id => anchorEligible(catalogue[id], context, requirement)
      && !state.anchors.some(anchor => anchor.requirementId !== requirementId && anchor.exerciseId === id));
  }
  function anchorRequest(anchor) {
    const target = anchor.currentTarget || anchor;
    const request = {requirementId: anchor.requirementId, exerciseId: anchor.exerciseId, importance: 'required'};
    ['targetSets','target','prescriptionMode','allowedProtocols','suggestedLoad','loadUnit','loadInterpretation','progressionIntent'].forEach(key => {
      if (target[key] !== undefined) request[key] = copy(target[key]);
    });
    return request;
  }
  function fullAnchor(work, catalogue) {
    if (!work.length || work.some(item => item.status !== 'completed' || item.exposure.value < 1)) return false;
    const exercise = catalogue[work[0].exerciseId];
    if (!exercise || work.some(item => item.exerciseId !== exercise.id)) return false;
    const sides = exercise.sidedness === 'per-side' ? ['left','right'] : [null];
    return sides.every(side => work.filter(item => item.side === side).length >= 2);
  }
  function calculatePriorities({definition, catalogue, state, history, today}) {
    const config = settings(definition, state), sport = coveragePolicy(definition, catalogue);
    const scope = {programmeInstanceId: state.programmeInstanceId, sections: ['main'], until: today.now,
      since: new Date(Date.parse(today.now) - 14 * DAY).toISOString()};
    const summary = sport.summarize(history, {...scope, now: today.now, focus: config.focus,
      equipment: today.equipment || [], allowedImpact: today.allowedImpact, smallSpace: today.smallSpace});
    const roles = definition.sessionRoles[config.weeklyCoachFrequency];
    const earnedRoles = Object.fromEntries(roles.map(role => [role.id,0]));
    // A preview/label alone cannot move the rotation. Tiny partial loops earn no turn.
    for (const result of history.sessionsForProgramme(state.programmeInstanceId, scope)) {
      if (!['completed','partial'].includes(result.finalStatus)) continue;
      const role = roles.find(item => (result.overrides || []).some(override => override.type === roleOverride && override.value === item.id));
      if (!role) continue;
      const work = history.sessionEvidence(result.sessionResultId).performances.filter(item => item.section === 'main' && item.semanticConfidence === 'derived');
      const anchorCredit = state.anchors.some(anchor => {
        const requirement = definition.anchorSelectionPolicy.requirements.find(item => item.requirementId === anchor.requirementId);
        const performed = work.filter(item => item.requirementId === anchor.requirementId);
        return performed.every(item => requirement.exerciseIds.includes(item.exerciseId)) && fullAnchor(performed,catalogue);
      });
      const supportCredit = work.some(item => item.requirementId && item.requirementId.startsWith('tennis-support-')
        && item.status === 'completed' && item.exposure.value >= 1
        && sport.classifyExercise(item.exerciseId).contributions.some(contribution => role.capabilities.includes(contribution.capabilityId)));
      if (anchorCredit || supportCredit) earnedRoles[role.id]++;
    }
    const role = roles.slice().sort((a,b) => earnedRoles[a.id]-earnedRoles[b.id] || roles.indexOf(a)-roles.indexOf(b))[0];
    const anchors = state.anchors.map((anchor,index) => {
      const requirement = definition.anchorSelectionPolicy.requirements.find(item => item.requirementId === anchor.requirementId);
      const work = history.performances.filter(item => item.programmeInstanceId === state.programmeInstanceId
        && item.requirementId === anchor.requirementId && item.section === 'main' && item.semanticConfidence === 'derived'
        && requirement.exerciseIds.includes(item.exerciseId)
        && item.occurredAt && Date.parse(item.occurredAt) >= Date.parse(scope.since) && Date.parse(item.occurredAt) <= Date.parse(scope.until));
      const passes = work.reduce((sum,item) => sum + item.exposure.value / (catalogue[item.exerciseId].sidedness === 'per-side' ? 2 : 1),0);
      return {requirementId: anchor.requirementId, index, passes,
        lastPerformedAt: work.filter(item => item.exposure.value > 0).map(item => new Date(item.occurredAt).toISOString()).at(-1) || null};
    }).sort((a,b) => a.passes-b.passes || (a.lastPerformedAt || '').localeCompare(b.lastPerformedAt || '') || a.index-b.index);
    const capabilities = summary.capabilities.slice().sort((a,b) => Number(b.priority === 'core' && b.coverage !== 'observed')-Number(a.priority === 'core' && a.coverage !== 'observed')
      || Number(b.coverage !== 'observed')-Number(a.coverage !== 'observed') || Number(b.preferred)-Number(a.preferred)
      || (role.capabilities.includes(a.capabilityId) ? role.capabilities.indexOf(a.capabilityId) : 99)
        -(role.capabilities.includes(b.capabilityId) ? role.capabilities.indexOf(b.capabilityId) : 99));
    return {role, earnedRoles, anchors, capabilities, coverage: summary, movements: [], bodyRegions: []};
  }
  function supportRequest(capabilityId, exercise) {
    const timed = exercise.prescription.type.includes('timed');
    return {requirementId: 'tennis-support-'+capabilityId, exerciseId: exercise.id, importance: 'required', targetSets: 1,
      prescriptionMode: timed ? 'time' : 'reps', allowedProtocols: ['rounds'],
      target: timed ? {type: 'timed', seconds: exercise.prescription.value}
        : {type: 'reps', minReps: exercise.prescription.value, maxReps: exercise.prescription.value}};
  }
  function buildPrescription({definition, catalogue, state, history, today, priorities, assessSessionPrescription, allowRoleFallback = true}) {
    const config = settings(definition, state), role = priorities.role, sport = coveragePolicy(definition, catalogue);
    const duration = today.duration === undefined ? definition.sessionTemplate.duration : today.duration;
    // Preparation uses whole timed steps, including both sides. Reserve its rounding
    // allowance before selecting hard work; never shorten preparation or rest later.
    const availableMainSeconds = assessSessionPrescription && definition.supportedDurations.includes(duration)
      ? assessSessionPrescription(Model().createSessionPrescription({...definition.sessionTemplate, duration,
        prescriptionId: today.prescriptionId, programmeInstanceId: state.programmeInstanceId, sessionRole: role.id,
        equipment: today.equipment || []})).availableMainSeconds : null;
    const availability = sport.availability({equipment: today.equipment || [], allowedImpact: today.allowedImpact, smallSpace: today.smallSpace});
    const lowLoad = role.id === 'conditioning-resilience';
    const numeric = exercise => exercise.equipment.some(group => group.some(id => definition.progressionPolicy.numericLoadEquipment.includes(id)));
    const prescription = Model().createSessionPrescription({...copy(definition.sessionTemplate), duration,
      ...(Number.isFinite(availableMainSeconds) ? {
        mainTimeLimitSeconds: Math.max(1,availableMainSeconds-definition.preparationTimingReserveSeconds), maximumDurationSeconds: duration*60} : {}),
      prescriptionId: today.prescriptionId, programmeInstanceId: state.programmeInstanceId, sessionRole: role.id,
      equipment: today.equipment || [], difficulty: today.easyToday ? 'easy' : definition.sessionTemplate.difficulty,
      bodyFocus: today.bodyFocus || definition.sessionTemplate.bodyFocus, requiredAnchors: [], preferredAnchors: [],
      protocolConstraints: [{requirementId: 'tennis-protocols', importance: 'hard', allowedProtocols: ['rounds','paired_sets']}],
      avoidConstraints: [...(definition.sessionTemplate.avoidConstraints || []), ...Object.values(catalogue)
        .filter(exercise => today.allowedImpact && !today.allowedImpact.includes(exercise.impact)
          || today.smallSpace && availability.some(cap => cap.candidates.some(candidate => candidate.exerciseId === exercise.id && candidate.reasons.includes('space')))
          || lowLoad && exercise.main && exercise.strength >= exercise.cardio && !exercise.conditioning && exercise.mainRole === 'primary')
        .map(exercise => ({requirementId: 'tennis-avoid-'+exercise.id, importance: 'hard', exerciseId: exercise.id}))],
      programmeContext: {objective: definition.objective, mode: state.mode, frequency: {minSessionsPerWeek: config.weeklyCoachFrequency, maxSessionsPerWeek: config.weeklyCoachFrequency},
        roleLabel: role.label, repsInReserve: 2, warnings: [], deferredAnchorRequirementIds: [],
        anchorResistance: Object.fromEntries(state.anchors.map(anchor => [anchor.requirementId, {exerciseId: anchor.exerciseId,
          numericLoad: numeric(catalogue[anchor.exerciseId]), setup: anchor.comparisonBaseline && anchor.comparisonBaseline.resistanceSetup || 'initial',
          ready: anchor.currentTarget.progressionIntent === definition.progressionPolicy.setupResistanceIntent}])),
        overrides: [{type: roleOverride, value: role.id}, ...(today.easyToday ? [{type: 'easy-today'}] : []),
          ...(today.duration !== undefined ? [{type: 'duration', value: duration}] : []), ...(today.bodyFocus ? [{type: 'body-focus', value: today.bodyFocus}] : [])]}});
    const warnings = prescription.programmeContext.warnings;
    const assess = request => assessSessionPrescription && assessSessionPrescription(Model().createSessionPrescription(request));
    const fits = request => { const assessment = assess(request); return assessment && assessment.status !== 'infeasible' && !assessment.hardConflicts.length; };
    const add = request => {
      if (prescription.requiredAnchors.some(item => item.exerciseId === request.exerciseId)) return false;
      if (!fits({...prescription, requiredAnchors: [...prescription.requiredAnchors,request]})) return false;
      prescription.requiredAnchors.push(request); return true;
    };
    const limit = role.anchorLimits[definition.supportedDurations.indexOf(duration)] || 0;
    for (const priority of priorities.anchors) {
      const anchor = state.anchors.find(item => item.requirementId === priority.requirementId), request = anchorRequest(anchor);
      if (prescription.requiredAnchors.length < limit && add(request)) continue;
      prescription.programmeContext.deferredAnchorRequirementIds.push(anchor.requirementId);
      if (!lowLoad && !fits({...prescription, requiredAnchors: [request]})) warnings.push({code: 'tennis-anchor-unavailable', requirementId: anchor.requirementId,
        message: catalogue[anchor.exerciseId].name+' cannot fit its full target with today’s time/equipment. Its baseline is retained.'});
    }
    const recent = exerciseId => history.exactExercisePerformances(exerciseId, {programmeInstanceId: state.programmeInstanceId, until: today.now, sections: ['main']})
      .filter(item => item.exposure.value > 0).map(item => new Date(item.occurredAt).toISOString()).at(-1) || '';
    for (const capability of priorities.capabilities) {
      const available = availability.find(item => item.capabilityId === capability.capabilityId);
      const allowed = available.candidates.filter(item => item.available && !(prescription.difficulty === 'easy' && item.difficulty === 'hard')
        && (!lowLoad || catalogue[item.exerciseId].mainRole === 'supporting' || catalogue[item.exerciseId].conditioning));
      if (!allowed.length) warnings.push({code: 'tennis-capability-unavailable', capabilityId: capability.capabilityId,
        message: capability.label+' has no suitable exercise with today’s equipment, space, impact or session constraints.'});
      if (available.missingFacets.length) warnings.push({code: 'tennis-capability-facets-unavailable', capabilityId: capability.capabilityId, facets: available.missingFacets,
        message: capability.label+': '+available.missingFacets.join(', ')+' are unavailable; no coverage is assumed.'});
      if (prescription.requiredAnchors.some(request => sport.classifyExercise(request.exerciseId).contributions.some(item => item.capabilityId === capability.capabilityId))) continue;
      // Complementary power/endurance follow their session roles, rather than
      // forcing every session to contain every capability or a ballistic target.
      if (capability.priority === 'complementary' && !role.capabilities.includes(capability.capabilityId)) continue;
      const candidates = allowed.filter(item => !state.anchors.some(anchor => anchor.exerciseId === item.exerciseId))
        .sort((a,b) => recent(a.exerciseId).localeCompare(recent(b.exerciseId))
          || Number(catalogue[b.exerciseId].mainRole === 'supporting')-Number(catalogue[a.exerciseId].mainRole === 'supporting')
          || catalogue[a.exerciseId].estimatedSeconds-catalogue[b.exerciseId].estimatedSeconds || a.exerciseId.localeCompare(b.exerciseId));
      if (!candidates.some(candidate => add(supportRequest(capability.capabilityId,catalogue[candidate.exerciseId]))) && candidates.length) warnings.push({
        code: 'tennis-capability-time-limit', capabilityId: capability.capabilityId,
        message: capability.label+' does not fit alongside today’s selected work. Priorities will be recomputed from performed history.'});
    }
    prescription.programmeContext.emptySession = !prescription.requiredAnchors.length;
    prescription.programmeContext.preflightAvailable = typeof assessSessionPrescription === 'function';
    if (prescription.programmeContext.emptySession && assessSessionPrescription && allowRoleFallback) {
      const alternatives = definition.sessionRoles[config.weeklyCoachFrequency].filter(item => item.id !== role.id)
        .sort((a,b) => priorities.earnedRoles[a.id]-priorities.earnedRoles[b.id]);
      for (const alternative of alternatives) {
        const fallback = buildPrescription({definition,catalogue,state,history,today,assessSessionPrescription,
          priorities: {...priorities,role: alternative},allowRoleFallback: false});
        if (fallback.programmeContext.emptySession) continue;
        fallback.programmeContext.requestedRole = role.id;
        fallback.programmeContext.warnings.unshift({code: 'tennis-session-role-unavailable', sessionRole: role.id,
          message: role.label+' has no attainable target today. '+alternative.label+' provides useful work with preparation and rest; no missed-session debt is created.'});
        return fallback;
      }
    }
    return Model().createSessionPrescription(prescription);
  }
  function assessPlannedSession({prescription}) {
    const conflicts = [];
    if (!prescription.programmeContext.preflightAvailable) conflicts.push({code: 'tennis-preflight-required', message: 'Tennis requires Generator preflight to preserve preparation, targets and rest.'});
    if (prescription.programmeContext.emptySession) conflicts.push({code: 'tennis-no-useful-session', message: 'No useful Tennis target fits. Choose more time or suitable equipment; preparation and rest are preserved.'});
    return {conflicts};
  }
  function assessFeasibility({definition, catalogue, context, assessSessionPrescription}) {
    const config = settings(definition, null, context); validateProgrammeSettings({settings: config});
    const anchors = [], conflicts = [], selected = context.anchorSelections || {};
    const requirements = definition.anchorSelectionPolicy.requirements;
    Object.keys(selected).filter(id => !requirements.some(item => item.requirementId === id))
      .forEach(requirementId => conflicts.push({code: 'unknown-anchor-selection', requirementId}));
    for (const requirement of requirements) {
      const ids = selected[requirement.requirementId] ? [selected[requirement.requirementId]] : requirement.exerciseIds;
      const exerciseId = ids.find(id => requirement.exerciseIds.includes(id) && anchorEligible(catalogue[id], context, requirement)
        && !anchors.some(anchor => anchor.exerciseId === id));
      if (!exerciseId) conflicts.push({code: 'anchor-unavailable', requirementId: requirement.requirementId, exerciseIds: ids,
        message: 'Add equipment for a '+requirement.roleId+' anchor or explicitly choose a suitable catalogue alternative.'});
      else anchors.push({...copy(requirement), exerciseId, pattern: catalogue[exerciseId].patterns.find(pattern => requirement.patterns.includes(pattern))});
    }
    if (context.duration !== undefined && !definition.supportedDurations.includes(context.duration)) conflicts.push({code: 'unsupported-duration'});
    if (!assessSessionPrescription) conflicts.push({code: 'tennis-preflight-required'});
    if (conflicts.length) return {status: 'infeasible', conflicts, anchors, prescription: null};
    const state = {programmeInstanceId: context.programmeInstanceId || 'tennis-feasibility', mode: 'development',
      anchors: strength.initialiseState({assessment: {anchors}, context}).anchors, currentTargets: {programmeSettings: config}};
    const history = root.GarageFitTrainingHistory.createHistory([], catalogue);
    const now = context.now || '2000-01-01T00:00:00Z'; // No clock/evidence involved in start feasibility.
    const durationAssessments = definition.supportedDurations.map(duration => ({duration, roles: definition.sessionRoles[config.weeklyCoachFrequency].map(role => {
      const today = {...context, duration, now, prescriptionId: 'tennis-feasibility-'+duration+'-'+role.id};
      const priorities = {...calculatePriorities({definition,catalogue,state,history,today}),role};
      const prescription = buildPrescription({definition,catalogue,state,history,today,priorities,assessSessionPrescription,allowRoleFallback:false});
      const assessment = assessSessionPrescription(prescription);
      const failures = [...assessment.hardConflicts, ...assessPlannedSession({prescription}).conflicts];
      return {sessionRole: role.id, status: failures.length ? 'infeasible' : assessment.status, prescription, conflicts: failures,
        warnings: prescription.programmeContext.warnings};
    })}));
    const current = durationAssessments.find(item => item.duration === (context.duration === undefined ? definition.sessionTemplate.duration : context.duration));
    // A long default session may start even when a short budget cannot offer every role.
    // Today's actual plan is still independently checked and can truthfully fail.
    if (current.roles.every(item => item.status === 'infeasible')) conflicts.push(...current.roles.flatMap(item => item.conflicts));
    return {status: conflicts.length ? 'infeasible' : current.roles.some(item => item.status !== 'feasible') ? 'partially-feasible' : 'feasible', conflicts, anchors, prescription: null, durationAssessments,
      warnings: current.roles.flatMap(item => item.warnings)};
  }
  const policy = {...strength, validateDefinition, validateProgrammeSettings, assessFeasibility, calculatePriorities, buildPrescription,
    interpretDose: input => ['completed','partial'].includes(input.result.finalStatus) ? strength.interpretDose(input)
      : {meaningful:false,exposure:{value:0,confidence:'unknown'},patterns:{},bodyRegions:{}},
    interpretProgression: input => ['completed','partial'].includes(input.result.finalStatus) ? strength.interpretProgression(input) : copy(input.state.anchors),
    assessPlannedSession, anchorAlternatives, reduceForShortSession: ({prescription}) => copy(prescription),
    getModeSettings: ({definition,state}) => {
      const frequency = settings(definition,state).weeklyCoachFrequency;
      return {frequency: {minSessionsPerWeek: frequency,maxSessionsPerWeek: frequency}, allowProgression: state.mode !== 'maintenance'};
    }, isComplete: () => false};
  root.GarageFitCoachTennisPolicy = Object.freeze(policy);
})(typeof window !== 'undefined' ? window : globalThis);
