(function (root) {
  // Strategies own programme parameters. There is deliberately no production definition
  // here: the General Strength strategy requires explicit inputs (see test fixtures).
  const clone = value => JSON.parse(JSON.stringify(value));
  const DAY = 86400000;
  const requiredHooks = ['validateDefinition','assessFeasibility','initialiseState','calculatePriorities','buildPrescription','interpretDose'];
  const optionalHooks = ['getModeSettings','assessPlannedSession','interpretProgression','respondToMissedSessions','reduceForShortSession','isComplete','validateProgrammeSettings','validateSettingsChange'];

  function createRegistry(entries = {}) {
    const policies = new Map();
    const registry = {
      register(type, policy) {
        if (typeof type !== 'string' || !type.trim() || policies.has(type)) throw new Error('Policy types must be non-empty and registered once.');
        requiredHooks.forEach(name => { if (!policy || typeof policy[name] !== 'function') throw new Error('Policy must implement '+name+'.'); });
        [...optionalHooks, 'anchorAlternatives', 'progressionHold'].forEach(name => { if (policy[name] !== undefined && typeof policy[name] !== 'function') throw new Error('Invalid policy hook '+name+'.'); });
        policies.set(type, Object.freeze({...policy}));
        return registry;
      },
      get(type) { if (!policies.has(type)) throw new Error('Unregistered Coach policy '+JSON.stringify(type)+'.'); return policies.get(type); },
      types() { return [...policies.keys()]; }
    };
    Object.entries(entries).forEach(([type, policy]) => registry.register(type, policy));
    return Object.freeze(registry);
  }

  function assertDefinition(definition) {
    const validId = value => typeof value === 'string' && value.trim() && value === value.trim() && value.length <= 200;
    if (!definition || definition.schemaVersion !== 1 || !validId(definition.id) || !validId(definition.type)
      || !Number.isInteger(definition.version) || definition.version < 1 || !validId(definition.objective)
      || typeof definition.openEnded !== 'boolean'
      || (!definition.openEnded && !(Number.isFinite(definition.nominalDurationDays) && definition.nominalDurationDays > 0))) throw new Error('Invalid versioned Programme Definition.');
    // Reuse the model's plain-JSON validation without adding another persistent record kind.
    root.GarageFitCoachModel.assertValid('programme-state', {schemaVersion: 1, programmeInstanceId: 'definition-check', programmeDefinitionId: definition.id,
      programmeDefinitionVersion: definition.version, status: 'active', mode: 'development', currentTargets: definition});
    return definition;
  }
  function positive(value, label) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Programme Definition needs positive '+label+'.');
  }
  function nonNegative(value, label) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Programme Definition needs non-negative '+label+'.');
  }
  function frequency(value) {
    if (!value) throw new Error('Programme Definition needs frequency.');
    positive(value.minSessionsPerWeek, 'minimum frequency'); positive(value.maxSessionsPerWeek, 'maximum frequency');
    if (value.maxSessionsPerWeek < value.minSessionsPerWeek) throw new Error('Invalid frequency range.');
  }

  function validateStrengthDefinition(definition) {
    const Model = root.GarageFitCoachModel;
    assertDefinition(definition);
    frequency(definition.recommendedFrequency);
    positive(definition.coverageTargets && definition.coverageTargets.windowDays, 'coverage window');
    const patterns = definition.coverageTargets.patterns;
    if (!patterns || !Object.keys(patterns).length) throw new Error('Explicit broad-pattern targets are required.');
    Object.entries(patterns).forEach(([pattern, value]) => {
      if (!Model.MOVEMENT_PATTERNS.includes(pattern)) throw new Error('Unknown broad movement pattern.');
      positive(value, 'pattern dose target');
    });
    if (definition.coverageTargets.includeStandaloneHistory !== undefined && typeof definition.coverageTargets.includeStandaloneHistory !== 'boolean') throw new Error('Standalone coverage history must be an explicit boolean.');
    Object.entries(definition.coverageTargets.bodyRegions || {}).forEach(([region, value]) => {
      if (!Model.WORKOUT_BODY_FOCUSES.includes(region)) throw new Error('Unknown body region.');
      positive(value, 'body-region target');
    });
    if (!definition.doseTargets || definition.doseTargets.meaningfulRule !== 'any-performed-main-work') positive(definition.doseTargets && definition.doseTargets.meaningfulExposure, 'meaningful performed exposure');
    if (!Array.isArray(definition.doseTargets.sections) || !definition.doseTargets.sections.length
      || definition.doseTargets.sections.some(section => typeof section !== 'string' || !section)) throw new Error('Dose needs explicit eligible sections.');
    const requirements = definition.anchorSelectionPolicy && definition.anchorSelectionPolicy.requirements;
    if (!Array.isArray(requirements) || !requirements.length) throw new Error('Explicit anchor requirements are required.');
    const ids = new Set();
    requirements.forEach(requirement => {
      if (ids.has(requirement.requirementId)) throw new Error('Duplicate anchor requirement.');
      ids.add(requirement.requirementId);
      const hasExerciseIds = Array.isArray(requirement.exerciseIds) && requirement.exerciseIds.length;
      const direct = ['flexion','extension'].includes(requirement.directElbowAction);
      if (!Model.MOVEMENT_PATTERNS.includes(requirement.pattern) || !['primary','accessory'].includes(requirement.role)
        || !hasExerciseIds && !direct) throw new Error('Anchor selection needs a pattern, role and exercise IDs or intrinsic direct-action selector.');
      positive(requirement.targetSets || requirement.targetExposures, 'anchor dose');
      if (!requirement.target || !requirement.prescriptionMode || !Array.isArray(requirement.allowedProtocols) || !requirement.allowedProtocols.length) throw new Error('Anchor targets, mode and protocols must be explicit.');
      // The Generator seam remains the authority on the bounded anchor shape.
      Model.createSessionPrescription({prescriptionId: 'definition-check', programmeInstanceId: 'definition-check', sessionRole: 'check',
        [requirement.importance === 'required' ? 'requiredAnchors' : 'preferredAnchors']: [anchorRequest(requirement, hasExerciseIds ? requirement.exerciseIds[0] : 'definition-check')]});
    });
    if (!definition.sessionTemplate) throw new Error('Explicit session template required.');
    Model.createSessionPrescription({prescriptionId: 'definition-check', programmeInstanceId: 'definition-check', sessionRole: 'check', ...definition.sessionTemplate});
    positive(definition.feasibilityRequirements && definition.feasibilityRequirements.minimumDurationMinutes, 'minimum duration');
    (definition.feasibilityRequirements.requiredPatterns || []).forEach(pattern => {
      if (!Model.MOVEMENT_PATTERNS.includes(pattern)) throw new Error('Unknown feasibility pattern.');
    });
    if (!definition.sequencingRules) throw new Error('Explicit sequencing rules required.');
    nonNegative(definition.sequencingRules.minimumRecoveryHours, 'recovery interval');
    const short = definition.shortSessionPolicy;
    if (!short || !Array.isArray(short.tiers) || short.preservePreparation !== true || short.preserveRest !== true) throw new Error('Short sessions must explicitly preserve essential preparation and rest.');
    const durations = new Set();
    short.tiers.forEach(tier => {
      positive(tier.maxDurationMinutes, 'short-session duration');
      if (durations.has(tier.maxDurationMinutes)) throw new Error('Duplicate short-session duration.');
      durations.add(tier.maxDurationMinutes);
      ['primaryPriorityLimit','primaryPreferredLimit','accessoryLimit'].forEach(key => {
        if (!Number.isInteger(tier[key]) || tier[key] < 0) throw new Error('Short-session limits must be explicit integers.');
      });
      if (typeof tier.keepSecondaryPriorities !== 'boolean') throw new Error('Short-session secondary policy must be explicit.');
    });
    const maintenance = definition.maintenancePolicy;
    if (!maintenance || typeof maintenance.allowProgression !== 'boolean' || typeof maintenance.keepAccessories !== 'boolean') throw new Error('Explicit maintenance policy required.');
    frequency(maintenance.frequency);
    positive(maintenance.coverageMultiplier, 'maintenance coverage multiplier');
    if (maintenance.maximumDurationMinutes !== undefined) {
      positive(maintenance.maximumDurationMinutes, 'maintenance duration');
      if (definition.supportedDurations && !definition.supportedDurations.includes(maintenance.maximumDurationMinutes)) throw new Error('Unsupported maintenance duration.');
    }
    const overrides = maintenance.anchorTargetOverrides;
    if (!overrides || typeof overrides !== 'object') throw new Error('Explicit maintenance anchor targets required.');
    Object.keys(overrides).forEach(id => { if (!ids.has(id)) throw new Error('Unknown maintenance anchor requirement.'); });
    requirements.forEach(requirement => {
      const adjusted = {...requirement, ...(overrides[requirement.requirementId] || {})};
      Model.createSessionPrescription({prescriptionId: 'maintenance-check', programmeInstanceId: 'maintenance-check', sessionRole: 'check',
        [requirement.importance === 'required' ? 'requiredAnchors' : 'preferredAnchors']: [anchorRequest(adjusted, requirement.exerciseIds && requirement.exerciseIds[0] || 'definition-check')]});
    });
    const progression = definition.progressionPolicy;
    if (!progression) throw new Error('Explicit progression policy required.');
    if (progression.strategy === 'double-progression') {
      positive(progression.minReps, 'minimum reps'); positive(progression.maxReps, 'maximum reps');
      positive(progression.repIncrement, 'rep increment');
      if (progression.maxReps < progression.minReps) throw new Error('Invalid progression rep range.');
    }
    ['minimumRepsImprovement','minimumLoadImprovement','minimumSecondsImprovement'].forEach(key => {
      if (progression[key] !== null) positive(progression[key], key);
    });
    if (definition.missedSessionPolicy && definition.missedSessionPolicy.strategy !== 'recompute-no-debt') throw new Error('Strength missed sessions must recompute without debt.');
    if (!definition.missedSessionPolicy) throw new Error('Explicit missed-session policy required.');
    if (!definition.completionCriteria) throw new Error('Explicit completion criteria required.');
    if (definition.completionCriteria.minimumMeaningfulSessions !== null) positive(definition.completionCriteria.minimumMeaningfulSessions, 'meaningful completion count');
    if (typeof definition.completionCriteria.requireNominalDuration !== 'boolean') throw new Error('Explicit calendar completion rule required.');
    if (definition.openEnded && definition.completionCriteria.requireNominalDuration) throw new Error('An open-ended programme has no nominal completion date.');
  }

  function anchorRequest(requirement, exerciseId, targets = {}) {
    const result = {requirementId: requirement.requirementId, exerciseId, importance: requirement.importance};
    for (const key of ['targetSets','targetExposures','prescriptionMode','target','suggestedLoad','loadUnit','loadInterpretation','allowedProtocols','progressionIntent']) {
      if (requirement[key] !== undefined) result[key] = clone(requirement[key]);
      if (targets[key] !== undefined) result[key] = clone(targets[key]);
    }
    return result;
  }
  function eligible(exercise, context, requirement) {
    if (!exercise || !exercise.generator || !exercise.main) return false;
    const owned = new Set(context.equipment || []);
    if (!(exercise.equipment || []).every(group => group.some(id => owned.has(id)))) return false;
    if (context.difficulty === 'easy' && exercise.difficulty === 'hard') return false;
    if (!requirement) return true;
    const mode = exercise.prescription && exercise.prescription.type.includes('timed') ? 'time' : 'reps';
    const sides = exercise.sidedness === 'per-side' ? 2 : 1;
    return (!requirement.directElbowAction || exercise.directElbowAction === requirement.directElbowAction)
      && (exercise.patterns || []).includes(requirement.pattern) && mode === requirement.prescriptionMode
      && (requirement.target.type === 'timed' ? 'time' : 'reps') === mode
      && (!requirement.targetExposures || Number.isInteger(requirement.targetExposures / sides)
        && (!requirement.targetSets || requirement.targetSets * sides === requirement.targetExposures))
      && requirement.allowedProtocols.some(protocol => (exercise.mainProtocols || []).includes(protocol)
        && !(mode === 'reps' && protocol === 'timed_intervals'));
  }

  function anchorEligible(definition, exercise, context, requirement) {
    return eligible(exercise, context, requirement) && (!definition.anchorSelectionPolicy.strengthOnly
      || exercise.mainRole === 'primary' && exercise.strength >= exercise.cardio && !exercise.conditioning);
  }
  function candidateIds(definition, catalogue, requirement) {
    if (requirement.exerciseIds) return requirement.exerciseIds;
    return Object.values(catalogue).filter(exercise => exercise.directElbowAction === requirement.directElbowAction)
      .sort((a,b) => Number(numericLoad(definition,b)) - Number(numericLoad(definition,a)) || a.id.localeCompare(b.id)).map(exercise => exercise.id);
  }
  function numericLoad(definition, exercise) {
    return (exercise.equipment || []).some(group => group.some(id => (definition.progressionPolicy.numericLoadEquipment || []).includes(id)));
  }
  function anchorAlternatives({definition, catalogue, context, state, requirementId}) {
    const requirement = definition.anchorSelectionPolicy.requirements.find(item => item.requirementId === requirementId);
    if (!requirement) throw new Error('Unknown anchor requirement.');
    const today = {...definition.sessionTemplate, ...context, difficulty: context.easyToday ? 'easy' : context.difficulty || definition.sessionTemplate.difficulty};
    return candidateIds(definition, catalogue, requirement).filter(id => anchorEligible(definition, catalogue[id], today, requirement)
      && !(state.anchors || []).some(anchor => anchor.requirementId !== requirementId && anchor.exerciseId === id));
  }
  function assessFeasibility({definition, catalogue, context}) {
    context = {...definition.sessionTemplate, ...context, difficulty: context.easyToday ? 'easy' : context.difficulty || definition.sessionTemplate.difficulty};
    const conflicts = [], anchors = [], selected = context.anchorSelections || {}, used = new Set();
    const available = Object.values(catalogue).filter(exercise => eligible(exercise, context));
    for (const pattern of definition.feasibilityRequirements.requiredPatterns || []) {
      if (!available.some(exercise => (exercise.patterns || []).includes(pattern))) conflicts.push({code: 'missing-pattern', pattern});
    }
    if ((context.duration || definition.sessionTemplate.duration) < definition.feasibilityRequirements.minimumDurationMinutes) conflicts.push({code: 'insufficient-duration'});
    if (definition.supportedDurations && !definition.supportedDurations.includes(context.duration)) conflicts.push({code: 'unsupported-duration'});
    Object.keys(selected).forEach(requirementId => {
      if (!definition.anchorSelectionPolicy.requirements.some(item => item.requirementId === requirementId)) conflicts.push({code: 'unknown-anchor-selection', requirementId});
    });
    for (const requirement of definition.anchorSelectionPolicy.requirements) {
      const candidates = candidateIds(definition, catalogue, requirement);
      const ids = selected[requirement.requirementId] ? [selected[requirement.requirementId]] : candidates;
      const exerciseId = ids.find(id => candidates.includes(id) && !used.has(id) && anchorEligible(definition, catalogue[id], context, requirement));
      if (!exerciseId) conflicts.push({code: 'anchor-unavailable', requirementId: requirement.requirementId, exerciseIds: ids.slice(),
        ...(requirement.directElbowAction ? {directElbowAction: requirement.directElbowAction} : {})});
      else { used.add(exerciseId); anchors.push({...clone(requirement), exerciseId}); }
    }
    const prescription = root.GarageFitCoachModel.createSessionPrescription({...clone(definition.sessionTemplate),
      prescriptionId: 'programme-feasibility', programmeInstanceId: context.programmeInstanceId || 'programme-feasibility', sessionRole: 'feasibility',
      duration: context.duration, difficulty: context.difficulty, equipment: clone(context.equipment || []),
      requiredAnchors: anchors.filter(item => item.importance === 'required').map(item => anchorRequest(item, item.exerciseId)),
      preferredAnchors: anchors.filter(item => item.importance === 'preferred').map(item => anchorRequest(item, item.exerciseId))});
    return {status: conflicts.length ? 'infeasible' : 'feasible', conflicts, anchors, prescription};
  }

  function getModeSettings({definition, state}) {
    return state.mode === 'maintenance' ? clone(definition.maintenancePolicy) : {
      frequency: clone(definition.recommendedFrequency), coverageMultiplier: 1, keepAccessories: true, allowProgression: true, anchorTargetOverrides: {}
    };
  }
  function assessPlannedSession({definition, catalogue, prescription}) {
    const conflicts = [];
    for (const anchor of prescription.requiredAnchors || []) {
      const source = catalogue[anchor.exerciseId];
      const requirement = definition.anchorSelectionPolicy.requirements.find(item => item.requirementId === anchor.requirementId);
      const pattern = requirement ? requirement.pattern : source && (source.patterns || [])[0];
      if (!eligible(source, prescription, {...requirement, ...anchor, pattern})) conflicts.push({code: 'required-anchor-unavailable', requirementId: anchor.requirementId, exerciseId: anchor.exerciseId});
    }
    return {conflicts};
  }
  function initialiseState({assessment, context}) {
    return {anchors: assessment.anchors.map(anchor => ({...clone(anchor), selectedAt: context.now || null,
      currentTarget: anchorRequest(anchor, anchor.exerciseId), comparisonBaseline: null, substitutionHistory: []})), currentTargets: {anchorTargets: {}}};
  }

  // A definition may opt in to counting performed standalone work (outside any programme)
  // towards rolling coverage. It informs priorities only: never sessions, dose or anchors.
  function calculatePriorities({definition, state, history, today, mode}) {
    const options = {programmeInstanceId: state.programmeInstanceId, sections: definition.doseTargets.sections,
      includeStandalone: definition.coverageTargets.includeStandaloneHistory === true,
      since: new Date(Date.parse(today.now) - definition.coverageTargets.windowDays * DAY).toISOString(), until: today.now};
    const movements = Object.entries(definition.coverageTargets.patterns).map(([pattern, target], index) => {
      const exposure = history.movementPatternExposure(pattern, options);
      const deficit = Math.max(0, target * mode.coverageMultiplier - exposure.value);
      return {requirementId: 'coverage-'+pattern, pattern, priority: deficit > 0 ? 'primary' : 'maintenance', deficit, exposure, index};
    }).sort((a, b) => b.deficit - a.deficit || a.index - b.index);
    const bodyRegions = Object.entries(definition.coverageTargets.bodyRegions || {}).map(([bodyRegion, target]) => ({
      requirementId: 'region-'+bodyRegion, bodyRegion,
      priority: history.bodyRegionExposure(bodyRegion, options).value < target * mode.coverageMultiplier ? 'high' : 'maintenance'
    }));
    return {movements, bodyRegions};
  }
  function buildPrescription({definition, state, today, mode, priorities, catalogue}) {
    const requiredAnchors = [], preferredAnchors = [];
    (state.anchors || []).forEach(anchor => {
      if (anchor.role === 'accessory' && !mode.keepAccessories && anchor.importance !== 'required') return;
      const targets = {...anchor.currentTarget, ...((state.currentTargets || {}).anchorTargets || {})[anchor.requirementId], ...(mode.anchorTargetOverrides[anchor.requirementId] || {})};
      const request = anchorRequest(anchor, anchor.exerciseId, targets);
      if (!mode.allowProgression) delete request.progressionIntent;
      (anchor.importance === 'required' ? requiredAnchors : preferredAnchors).push(request);
    });
    return root.GarageFitCoachModel.createSessionPrescription({
      ...clone(definition.sessionTemplate), prescriptionId: today.prescriptionId, programmeInstanceId: state.programmeInstanceId,
      sessionRole: state.mode, duration: Math.min(today.duration || definition.sessionTemplate.duration, mode.maximumDurationMinutes || Infinity),
      equipment: clone(today.equipment || []),
      difficulty: today.easyToday ? 'easy' : definition.sessionTemplate.difficulty,
      bodyFocus: today.bodyFocus || definition.sessionTemplate.bodyFocus,
      requiredAnchors, preferredAnchors,
      movementPriorities: priorities.movements.map(({requirementId, pattern, priority}) => ({requirementId, pattern, priority})),
      bodyRegionPriorities: clone(priorities.bodyRegions),
      ...(!mode.keepAccessories && catalogue ? {avoidConstraints: [
        ...(definition.sessionTemplate.avoidConstraints || []),
        ...Object.values(catalogue).filter(exercise => exercise.mainRole === 'supporting')
          .map(exercise => ({requirementId: 'maintenance-support-'+exercise.id, importance: 'soft', exerciseId: exercise.id}))
      ]} : {}),
      programmeContext: {objective: definition.objective, mode: state.mode, frequency: mode.frequency,
        ...(definition.progressionPolicy.allowConfirmedSetup ? {anchorResistance: Object.fromEntries((state.anchors || []).map(anchor => [anchor.requirementId, {
          exerciseId: anchor.exerciseId, numericLoad: numericLoad(definition, catalogue[anchor.exerciseId]),
          setup: anchor.comparisonBaseline && anchor.comparisonBaseline.resistanceSetup || 'initial',
          ready: anchor.currentTarget.progressionIntent === definition.progressionPolicy.setupResistanceIntent
        }]))} : {}),
        essentialConstraints: clone(definition.sequencingRules), nominalProgress: state.nominalProgress,
        overrides: [...(today.easyToday ? [{type: 'easy-today'}] : []), ...(today.bodyFocus ? [{type: 'body-focus', value: today.bodyFocus}] : []),
          ...(today.duration && today.duration < definition.sessionTemplate.duration ? [{type: 'duration', value: today.duration}] : [])]}
    });
  }

  // Required anchors are immutable in this reduction. Select primary objective intent
  // before accessories; preparation/rest constraints and workout style stay intact.
  // Final physical feasibility belongs to the Generator's injected pure preflight.
  function reduceForShortSession({definition, state, prescription}) {
    const short = clone(prescription);
    const tier = definition.shortSessionPolicy.tiers.slice().sort((a, b) => a.maxDurationMinutes - b.maxDurationMinutes)
      .find(item => short.duration <= item.maxDurationMinutes);
    if (!tier || short.duration >= definition.sessionTemplate.duration) return short;
    const roles = new Map((state.anchors || []).map(anchor => [anchor.requirementId, anchor.role]));
    let primary = 0, accessory = 0, primaryPriority = 0;
    const omitted = [];
    short.preferredAnchors = (short.preferredAnchors || []).filter(anchor => {
      const keep = roles.get(anchor.requirementId) === 'primary' ? primary++ < tier.primaryPreferredLimit : accessory++ < tier.accessoryLimit;
      if (!keep) omitted.push(anchor.requirementId);
      return keep;
    });
    short.movementPriorities = (short.movementPriorities || []).filter(priority => {
      const keep = priority.priority === 'primary' ? primaryPriority++ < tier.primaryPriorityLimit : tier.keepSecondaryPriorities;
      if (!keep) omitted.push(priority.requirementId);
      return keep;
    });
    short.programmeContext.shortSession = {omittedRequirementIds: omitted,
      priorityOrder: ['required-anchors','primary-objective','essential-preparation-and-rest','optional-accessories']};
    return short;
  }

  function interpretDose({definition, evidence}) {
    const History = root.GarageFitTrainingHistory;
    const performed = evidence.performances.filter(item => definition.doseTargets.sections.includes(item.section) && item.semanticConfidence !== 'unknown');
    const exposure = History.sumExposure(performed);
    const patterns = {}, bodyRegions = {};
    performed.forEach(item => {
      const credit = item.exposure.value || 0;
      item.patterns.forEach(pattern => { patterns[pattern] = (patterns[pattern] || 0) + credit; });
      if (item.bodyRegion) bodyRegions[item.bodyRegion] = (bodyRegions[item.bodyRegion] || 0) + credit;
    });
    return {meaningful: definition.doseTargets.meaningfulRule === 'any-performed-main-work' ? exposure.value > 0 : exposure.value >= definition.doseTargets.meaningfulExposure, exposure, patterns, bodyRegions};
  }

  function doubleProgression({definition, state, evidence, result, mode, catalogue}) {
    const History = root.GarageFitTrainingHistory, rule = definition.progressionPolicy;
    return (state.anchors || []).map(original => {
      const anchor = clone(original), at = result.endedAt || result.startedAt;
      if (anchor.progression && Date.parse(anchor.progression.lastOccurredAt) > Date.parse(at)) return anchor;
      const work = evidence.performances.filter(item => item.requirementId === anchor.requirementId && item.section === 'main');
      if (!work.length) return anchor;
      const substituted = work.filter(item => item.exerciseId !== anchor.exerciseId);
      if (substituted.length) {
        anchor.substitutionHistory = [...(anchor.substitutionHistory || []), {sessionResultId: result.sessionResultId,
          exerciseId: substituted[0].exerciseId, occurredAt: at}].slice(-32);
        anchor.latestSubstitution = {exerciseId: substituted[0].exerciseId, decision: 'new-exercise-series'};
        return anchor;
      }
      let decision = 'hold';
      const target = anchor.currentTarget || anchorRequest(anchor, anchor.exerciseId);
      const reps = target.target.maxReps;
      const expected = target.targetSets * (catalogue[anchor.exerciseId].sidedness === 'per-side' ? 2 : 1);
      const planned = (result.plannedWork || []).filter(item => item.requirementId === anchor.requirementId && item.section === 'main');
      const full = planned.length === expected && work.length === expected && work.every(item => item.status === 'completed' && item.sets.length === 1
        && History.comparePerformances(item,item).comparable);
      const sets = work.flatMap(item => item.sets);
      const loadKnown = full && sets.every(set => set.reps.value !== null && set.load.value !== null && set.loadUnit && set.loadInterpretation);
      const sameLoad = loadKnown && sets.every(set => set.load.value === sets[0].load.value && set.loadUnit === sets[0].loadUnit && set.loadInterpretation === sets[0].loadInterpretation);
      const baseline = anchor.comparisonBaseline;
      const compatible = !baseline || work.every(item => {
        const previous = baseline.performances.find(prior => prior.side === item.side);
        return previous && History.comparePerformances(previous, item).comparable;
      });
      if (!mode.allowProgression) decision = 'hold-maintenance';
      else if ((result.overrides || []).some(item => item.type === 'easy-today')) decision = 'hold-easy-today';
      else if (rule.allowConfirmedSetup && !numericLoad(definition, catalogue[anchor.exerciseId])) {
        const setup = sets[0] && sets[0].resistanceSetup;
        const confirmed = full && compatible && setup && sets.every(set => set.reps.value !== null && set.resistanceSetup === setup);
        const unchanged = !baseline || baseline.resistanceSetup === setup;
        const ready = target.progressionIntent === rule.setupResistanceIntent;
        if (confirmed && !unchanged && ready && sets.every(set => set.reps.value >= rule.minReps)) {
          target.target = {type: 'reps', minReps: rule.minReps, maxReps: rule.minReps};
          target.progressionIntent = 'Harder setup confirmed; build reps again'; decision = 'reset-after-resistance';
        } else if (confirmed && unchanged && sets.every(set => set.reps.value >= reps)) {
          if (reps < rule.maxReps) {
            const next = Math.min(rule.maxReps, reps + rule.repIncrement);
            target.target = {type: 'reps', minReps: next, maxReps: next};
            target.progressionIntent = 'Try '+next+' reps with the confirmed setup'; decision = 'add-rep';
          } else { target.progressionIntent = rule.setupResistanceIntent; decision = 'suggest-resistance'; }
        } else if (!confirmed) decision = 'hold-unknown-setup';
        if (confirmed && (unchanged || decision === 'reset-after-resistance')) {
          anchor.comparisonBaseline = {resistanceSetup: setup, performances: clone(work)};
        }
      }
      else if (sameLoad && compatible) {
        const load = sets[0].load.value, unit = sets[0].loadUnit, interpretation = sets[0].loadInterpretation;
        const unchanged = !baseline || load === baseline.load && unit === baseline.loadUnit && interpretation === baseline.loadInterpretation;
        const heavier = baseline && load > baseline.load && unit === baseline.loadUnit && interpretation === baseline.loadInterpretation;
        const meets = sets.every(set => set.reps.value >= reps);
        const heavierIntent = rule.numericResistanceIntent || 'Use the next heavier weight';
        if (target.progressionIntent === heavierIntent && heavier && sets.every(set => set.reps.value >= rule.minReps)) {
          target.target = {type: 'reps', minReps: rule.minReps, maxReps: rule.minReps};
          target.progressionIntent = 'Heavier load confirmed; build reps again'; decision = 'reset-after-load';
        } else if (unchanged && meets) {
          if (reps < rule.maxReps) {
            const next = Math.min(rule.maxReps, reps + rule.repIncrement);
            target.target = {type: 'reps', minReps: next, maxReps: next};
            target.progressionIntent = 'Try '+next+' reps at the confirmed load'; decision = 'add-rep';
          } else { target.progressionIntent = heavierIntent; decision = 'suggest-load'; }
        }
        if (unchanged || decision === 'reset-after-load') {
          anchor.comparisonBaseline = {load, loadUnit: unit, loadInterpretation: interpretation, performances: clone(work)};
          Object.assign(target, {suggestedLoad: load, loadUnit: unit, loadInterpretation: interpretation});
        }
      } else if (!loadKnown) decision = 'hold-unknown-load';
      anchor.currentTarget = target;
      anchor.progression = {decision, lastSessionResultId: result.sessionResultId, lastOccurredAt: at};
      return anchor;
    });
  }

  function interpretProgression(input) {
    const {definition, state, history, result, mode} = input;
    if (definition.progressionPolicy.strategy === 'double-progression') return doubleProgression(input);
    const History = root.GarageFitTrainingHistory;
    return (state.anchors || []).map(anchor => {
      const occurredAt = result.endedAt || result.startedAt || null;
      if (anchor.progression && anchor.progression.lastOccurredAt
        && (!occurredAt || Date.parse(occurredAt) < Date.parse(anchor.progression.lastOccurredAt))) return clone(anchor);
      const series = history.anchorPerformanceSeries(anchor.requirementId, {programmeInstanceId: state.programmeInstanceId,
        sections: definition.doseTargets.sections, until: result.endedAt || result.startedAt || undefined});
      const currentSeries = series.filter(group => group.performances.some(item => item.sessionResultId === result.sessionResultId));
      if (!currentSeries.length) return clone(anchor);
      const current = currentSeries.flatMap(group => group.performances.filter(item => item.sessionResultId === result.sessionResultId));
      // Compare the same occurrence/set position across sessions, rather than two sets
      // of today's workout. Every performed set must support a threshold decision.
      const previous = [], comparisons = [];
      currentSeries.forEach(group => {
        const before = group.performances.filter(item => item.sessionResultId !== result.sessionResultId);
        const previousId = before.length ? before[before.length - 1].sessionResultId : null;
        const prior = before.filter(item => item.sessionResultId === previousId);
        previous.push(...prior);
        group.performances.filter(item => item.sessionResultId === result.sessionResultId).forEach((item, index) => comparisons.push(History.comparePerformanceEvidence(prior[index], item)));
      });
      const thresholds = definition.progressionPolicy;
      const qualifies = comparison => comparison.change === 'improved-reps' && thresholds.minimumRepsImprovement !== null && comparison.performanceDelta >= thresholds.minimumRepsImprovement
        || comparison.change === 'improved-time' && thresholds.minimumSecondsImprovement !== null && comparison.performanceDelta >= thresholds.minimumSecondsImprovement
        || comparison.change === 'improved-load' && thresholds.minimumLoadImprovement !== null && comparison.loadDelta >= thresholds.minimumLoadImprovement;
      const enough = current.length === previous.length && current.concat(previous).every(item => item.status === 'completed') && comparisons.every(qualifies);
      const exerciseId = current[current.length - 1].exerciseId;
      const decision = current.some(item => item.exerciseId !== anchor.exerciseId) ? 'new-exercise-series' : !previous.length ? 'baseline'
        : !mode.allowProgression ? 'hold-maintenance' : enough ? 'progress' : 'hold';
      return {...clone(anchor), progression: {exerciseId, lastSessionResultId: result.sessionResultId, lastOccurredAt: occurredAt, decision, comparisons}};
    });
  }
  // The same holds double progression applies. Variation-progression evidence uses it so
  // deliberately held work can never establish readiness for a harder exercise.
  function progressionHold({mode, result}) {
    if (mode && mode.allowProgression === false) return 'hold-maintenance';
    return (result.overrides || []).some(item => item.type === 'easy-today') ? 'hold-easy-today' : null;
  }
  function respondToMissedSessions({definition, state, history, today, mode}) {
    const sessions = history.sessionsForProgramme(state.programmeInstanceId, {until: today.now}).slice().reverse()
      .filter(session => interpretDose({definition, evidence: history.sessionEvidence(session.sessionResultId)}).meaningful);
    const last = sessions.find(session => session.endedAt || session.startedAt);
    const at = last ? last.endedAt || last.startedAt : state.startedAt;
    const elapsedDays = at ? Math.max(0, (Date.parse(today.now) - Date.parse(at)) / DAY) : null;
    return {missed: elapsedDays !== null && elapsedDays > 7 / mode.frequency.minSessionsPerWeek, elapsedDays, catchUpSessions: 0, strategy: 'recompute-no-debt'};
  }
  function isComplete({definition, state}) {
    const criteria = definition.completionCriteria;
    // Calendar passage alone never completes a development programme.
    return state.mode === 'development' && criteria.minimumMeaningfulSessions !== null
      && state.meaningfulSessionsCompleted >= criteria.minimumMeaningfulSessions
      && (!criteria.requireNominalDuration || state.nominalProgress >= definition.nominalDurationDays);
  }

  const generalStrengthPolicy = Object.freeze({validateDefinition: validateStrengthDefinition, assessFeasibility, initialiseState,
    getModeSettings, assessPlannedSession, calculatePriorities, buildPrescription, reduceForShortSession, interpretDose, interpretProgression,
    respondToMissedSessions, isComplete, anchorAlternatives, progressionHold});
  function validateArmsDefinition(definition) {
    validateStrengthDefinition(definition);
    positive(definition.doseTargets.windowDays, 'direct-dose window');
    ['flexion','extension'].forEach(action => {
      positive(definition.doseTargets.directElbowActions[action], 'direct '+action+' target');
      if (definition.anchorSelectionPolicy.requirements.filter(item => item.directElbowAction === action).length !== 1) throw new Error('One stable direct anchor per action is required.');
    });
    if (!definition.openEnded || definition.coverageTargets.excludeDirectArmWork !== true || definition.anchorSelectionPolicy.requirements.length !== 2
      || definition.anchorSelectionPolicy.requirements.some(item => item.importance !== 'required' || item.role !== 'primary')) throw new Error('Build Arms must be open-ended with two required direct anchors and compound maintenance separate.');
  }
  function armsPriorities({definition, state, history, today}) {
    const options = {programmeInstanceId: state.programmeInstanceId, sections: definition.doseTargets.sections,
      since: new Date(Date.parse(today.now) - definition.coverageTargets.windowDays * DAY).toISOString(), until: today.now};
    const movements = Object.entries(definition.coverageTargets.patterns).map(([pattern,target],index) => {
      const exposure = history.compoundPatternExposure(pattern, options);
      const deficit = Math.max(0,target-exposure.value);
      return {requirementId: 'coverage-'+pattern, pattern, priority: deficit > 0 ? 'secondary' : 'maintenance', deficit, exposure, index};
    }).sort((a,b) => b.deficit - a.deficit || a.index - b.index);
    const directOptions = {...options, since: new Date(Date.parse(today.now)-definition.doseTargets.windowDays*DAY).toISOString()};
    const directDose = Object.fromEntries(Object.entries(definition.doseTargets.directElbowActions).map(([action,target]) =>
      [action, {...history.directElbowExposure(action,directOptions), target}]));
    return {movements, bodyRegions: [], directDose};
  }
  function armsPrescription(input) {
    const {catalogue, priorities} = input;
    const prescription = buildPrescription(input), used = new Set(prescription.requiredAnchors.map(item => item.exerciseId)), unavailable = [];
    // Explicit preferred work preserves compound coverage even when a direct
    // anchor shares its broad pattern. No Generator programme branches are needed.
    for (const priority of priorities.movements.filter(item => item.deficit > 0)) {
      const exercise = Object.values(catalogue).filter(item => eligible(item, prescription) && !item.directElbowAction
        && !used.has(item.id) && item.patterns.includes(priority.pattern) && item.mainProtocols.includes('rounds'))
        .sort((a,b) => Number(b.mainRole === 'primary')-Number(a.mainRole === 'primary') || a.estimatedSeconds-b.estimatedSeconds || a.id.localeCompare(b.id))[0];
      if (!exercise) { unavailable.push(priority.pattern); continue; }
      used.add(exercise.id);
      const timed = exercise.prescription.type.includes('timed');
      prescription.preferredAnchors.push({requirementId: 'maintenance-'+priority.pattern, exerciseId: exercise.id, importance: 'preferred',
        targetSets: 1, prescriptionMode: timed ? 'time' : 'reps', allowedProtocols: ['rounds'],
        target: timed ? {type: 'timed', seconds: exercise.prescription.value} : {type: 'reps', minReps: exercise.prescription.value, maxReps: exercise.prescription.value}});
    }
    prescription.programmeContext.directDose = clone(priorities.directDose);
    prescription.programmeContext.maintenanceUnavailable = unavailable;
    return root.GarageFitCoachModel.createSessionPrescription(prescription);
  }
  function armsDose(input) {
    const dose = interpretDose(input), performed = input.evidence.performances.filter(item => input.definition.doseTargets.sections.includes(item.section));
    dose.directElbowActions = Object.fromEntries(['flexion','extension'].map(action =>
      [action, root.GarageFitTrainingHistory.sumExposure(performed.filter(item => item.directElbowAction === action))]));
    dose.compoundContext = Object.fromEntries(['push','pull'].map(pattern =>
      [pattern, root.GarageFitTrainingHistory.sumExposure(performed.filter(item => !item.directElbowAction && item.patterns.includes(pattern)))]));
    return dose;
  }
  const buildArmsPolicy = Object.freeze({...generalStrengthPolicy, validateDefinition: validateArmsDefinition,
    calculatePriorities: armsPriorities, buildPrescription: armsPrescription, interpretDose: armsDose, isComplete: () => false});
  const createDefaultRegistry = () => createRegistry({'general-strength': generalStrengthPolicy, 'build-arms': buildArmsPolicy,
    ...(root.GarageFitCoachTennisPolicy ? {'tennis-conditioning': root.GarageFitCoachTennisPolicy} : {}),
    ...(root.GarageFitCoachGeneralFitnessPolicy ? {'general-fitness': root.GarageFitCoachGeneralFitnessPolicy} : {})});
  root.GarageFitCoachPolicies = {createRegistry, createDefaultRegistry, assertDefinition, generalStrengthPolicy, buildArmsPolicy, requiredHooks, optionalHooks};
})(typeof window !== 'undefined' ? window : globalThis);
