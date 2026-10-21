(function (root) {
  // Coach decides longitudinal intent. Policies own programme decisions; the
  // Generator owns composition, the store owns persistence, and the player executes.
  const clone = value => JSON.parse(JSON.stringify(value));
  const DAY = 86400000;

  function createEngine({catalogue, registry, assessSessionPrescription} = {}) {
    const Model = root.GarageFitCoachModel, Policies = root.GarageFitCoachPolicies, History = root.GarageFitTrainingHistory;
    if (!Model || !Policies || !History) throw new Error('Load Coach Model, Training History and Coach Policies before the engine.');
    if (!catalogue || typeof catalogue !== 'object') throw new Error('Coach needs a canonical catalogue.');
    const exercises = Model.deepFreeze(clone(catalogue));
    const policies = registry || Policies.createDefaultRegistry();
    if (assessSessionPrescription !== undefined && typeof assessSessionPrescription !== 'function') throw new Error('Invalid Generator preflight adapter.');
    const snapshot = value => Model.deepFreeze(clone(value));
    function policyFor(definition) {
      Policies.assertDefinition(definition);
      const policy = policies.get(definition.type);
      policy.validateDefinition(snapshot(definition));
      validateVariationPolicy(definition, policy);
      return policy;
    }
    // ---- Exercise-variation progression (definition opt-in) ----
    // Reviewed edges only: no catalogue hierarchy or "next harder" inference exists.
    const VARIATION_EDGE_FIELDS = ['edgeId','requirementId','fromExerciseId','toExerciseId','evidence','repromptAfterSessions','startingTarget'];
    const validId = value => typeof value === 'string' && value.trim() !== '' && value === value.trim() && value.length <= 120;
    const modeOf = exercise => exercise.prescription && exercise.prescription.type.includes('timed') ? 'time' : 'reps';
    const sessionCount = value => Number.isInteger(value) && value >= 1 && value <= Model.VARIATION_EVIDENCE_LIMIT;
    function validateVariationPolicy(definition, policy) {
      const variation = definition.variationProgressionPolicy;
      if (variation === undefined) return;
      const invalid = message => { throw new Error('Invalid variation progression policy: '+message+'.'); };
      if (!policy.anchorAlternatives || !policy.progressionHold) invalid('this programme policy does not support it');
      if (!variation || typeof variation !== 'object' || Object.keys(variation).some(key => key !== 'edges') || !Array.isArray(variation.edges) || !variation.edges.length) invalid('it needs a non-empty edges list');
      const requirements = definition.anchorSelectionPolicy && definition.anchorSelectionPolicy.requirements || [];
      const edgeIds = new Set(), origins = new Set();
      variation.edges.forEach(edge => {
        if (!edge || typeof edge !== 'object' || Object.keys(edge).some(key => !VARIATION_EDGE_FIELDS.includes(key))) invalid('an edge has unknown fields');
        if (!['edgeId','requirementId','fromExerciseId','toExerciseId'].every(key => validId(edge[key]))) invalid('an edge needs edge, requirement and exercise IDs');
        if (edgeIds.has(edge.edgeId)) invalid('duplicate edge '+edge.edgeId);
        edgeIds.add(edge.edgeId);
        const requirement = requirements.find(item => item.requirementId === edge.requirementId);
        if (!requirement) invalid(edge.edgeId+' names an unknown anchor requirement');
        if (origins.has(edge.requirementId+'\n'+edge.fromExerciseId)) invalid('one edge per anchor exercise');
        origins.add(edge.requirementId+'\n'+edge.fromExerciseId);
        const from = exercises[edge.fromExerciseId], to = exercises[edge.toExerciseId];
        if (!from || !to || from.id === to.id) invalid(edge.edgeId+' needs two different catalogue exercises');
        if (requirement.exerciseIds && ![from.id, to.id].every(exerciseId => requirement.exerciseIds.includes(exerciseId))) invalid(edge.edgeId+' must stay within the requirement candidates');
        if (requirement.directElbowAction && ![from, to].every(exercise => exercise.directElbowAction === requirement.directElbowAction)) invalid(edge.edgeId+' must keep the direct action');
        if (![from, to].every(exercise => modeOf(exercise) === requirement.prescriptionMode)) invalid(edge.edgeId+' must keep the requirement prescription mode');
        const evidence = edge.evidence || {}, timed = requirement.prescriptionMode === 'time';
        const threshold = timed ? 'minimumSecondsPerSet' : 'minimumRepsPerSet';
        if (Object.keys(evidence).sort().join() !== ['consecutiveSessions', threshold].sort().join() || !sessionCount(evidence.consecutiveSessions)
          || !(timed ? Number.isFinite(evidence[threshold]) && evidence[threshold] > 0 : Number.isInteger(evidence[threshold]) && evidence[threshold] > 0)) invalid(edge.edgeId+' needs explicit consecutiveSessions and '+threshold);
        if (!sessionCount(edge.repromptAfterSessions)) invalid(edge.edgeId+' needs explicit repromptAfterSessions');
        const start = edge.startingTarget || {};
        if (Object.keys(start).some(key => !['target','progressionIntent'].includes(key)) || !start.target
          || (start.target.type === 'timed' ? 'time' : 'reps') !== requirement.prescriptionMode) invalid(edge.edgeId+' needs a starting target in the requirement mode');
        Model.createSessionPrescription({prescriptionId: 'variation-check', programmeInstanceId: 'variation-check', sessionRole: 'check',
          preferredAnchors: [{...startingTargetFor(definition, requirement, edge), importance: 'preferred'}]});
      });
    }
    // The new exercise starts from the reviewed edge target with the requirement's dose
    // and protocols. No load, reps, seconds or resistance setup carries across.
    function startingTargetFor(definition, requirement, edge) {
      const target = {requirementId: requirement.requirementId, exerciseId: edge.toExerciseId, importance: requirement.importance};
      for (const key of ['targetSets','targetExposures','prescriptionMode','allowedProtocols','progressionIntent']) if (requirement[key] !== undefined) target[key] = clone(requirement[key]);
      target.target = clone(edge.startingTarget.target);
      if (edge.startingTarget.progressionIntent !== undefined) target.progressionIntent = edge.startingTarget.progressionIntent;
      return target;
    }
    const edgeFrom = (definition, anchor) => definition.variationProgressionPolicy
      && definition.variationProgressionPolicy.edges.find(edge => edge.requirementId === anchor.requirementId && edge.fromExerciseId === anchor.exerciseId) || null;
    // One applied result's evidence for the anchor's current exercise. Absent or only
    // substituted anchor work is no evidence either way (null); every other performed
    // attempt either qualifies or restarts the consecutive count.
    function variationEvidenceEntry(anchor, result, evidence, hold) {
      const planned = (result.plannedWork || []).filter(item => item.requirementId === anchor.requirementId && item.section === 'main');
      const work = evidence.performances.filter(item => item.requirementId === anchor.requirementId && item.section === 'main');
      const own = work.filter(item => item.exerciseId === anchor.exerciseId);
      if (!planned.length || !own.length) return null;
      const target = anchor.currentTarget || anchor, field = target.prescriptionMode === 'time' ? 'seconds' : 'reps';
      const values = own.flatMap(item => item.sets.map(set => set[field].value));
      const entry = {sessionResultId: result.sessionResultId, occurredAt: result.endedAt || result.startedAt,
        outcome: 'qualifying', minimumValue: values.length && values.every(value => value !== null) ? Math.min(...values) : null,
        conditionsKey: Model.canonicalJson({protocol: own[0].protocol, mode: own[0].prescriptionMode,
          conditions: own[0].protocolConditions, sides: own.map(item => item.side).sort(), occurrences: own.length})};
      const sides = exercises[anchor.exerciseId].sidedness === 'per-side' ? 2 : 1;
      const expected = target.targetExposures || target.targetSets * sides;
      const plannedTarget = item => { const work = planned.find(entry => entry.occurrenceId === item.occurrenceId);
        return work && work.prescription ? work.prescription[field] : null; };
      if (hold) entry.outcome = hold;
      else if (own.length !== work.length || own.length !== planned.length || planned.length !== expected || own.some(item => item.status !== 'completed')) entry.outcome = 'incomplete';
      else if (own.some(item => !History.comparePerformances(item, item).comparable || item.prescriptionMode !== target.prescriptionMode
        || item.protocol !== own[0].protocol || !Model.sameRecord(item.protocolConditions, own[0].protocolConditions))) entry.outcome = 'incomparable';
      else if (entry.minimumValue === null || own.some(item => !item.sets.length || !Number.isFinite(plannedTarget(item)))) entry.outcome = 'unknown-actuals';
      else if (own.some(item => item.sets.some(set => set[field].value < plannedTarget(item)))) entry.outcome = 'below-target';
      return entry;
    }
    function recordVariationEvidence(def, policy, mode, state, result, evidence) {
      const at = result.endedAt || result.startedAt;
      if (!def.variationProgressionPolicy || !at) return state.anchors;
      const hold = policy.progressionHold({definition: def, state: snapshot(state), result, mode});
      return (state.anchors || []).map(original => {
        const progression = original.variationProgression;
        if (!edgeFrom(def, original) || progression && progression.exerciseId !== original.exerciseId) return original;
        const since = progression ? progression.since : original.selectedAt || state.startedAt || null;
        if (since && Date.parse(at) < Date.parse(since)) return original;
        const entry = variationEvidenceEntry(original, result, evidence, hold);
        if (!entry) return original;
        const anchor = clone(original);
        anchor.variationProgression = progression ? clone(progression) : {schemaVersion: 1, exerciseId: anchor.exerciseId, since, evidence: [], declined: [], transitions: []};
        anchor.variationProgression.evidence = [...anchor.variationProgression.evidence.filter(item => item.sessionResultId !== entry.sessionResultId), entry]
          .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.sessionResultId.localeCompare(b.sessionResultId))
          .slice(-Model.VARIATION_EVIDENCE_LIMIT);
        return anchor;
      });
    }
    function currentVariationRecommendations(def, policy, state, context) {
      if (!def.variationProgressionPolicy || state.status !== 'active') return [];
      if (!context || !Array.isArray(context.equipment)) throw new Error('Variation progression needs today’s equipment.');
      const mode = policy.getModeSettings ? policy.getModeSettings({definition: def, state: snapshot(state)}) : {};
      if (mode.allowProgression === false) return [];
      return (state.anchors || []).flatMap(anchor => {
        const edge = edgeFrom(def, anchor), progression = anchor.variationProgression;
        if (!edge || !progression || progression.exerciseId !== anchor.exerciseId || !progression.evidence.length) return [];
        const threshold = edge.evidence.minimumRepsPerSet || edge.evidence.minimumSecondsPerSet, entries = progression.evidence;
        const latest = entries[entries.length - 1], streak = [];
        for (let index = entries.length - 1; index >= 0; index--) {
          const entry = entries[index];
          if (entry.outcome !== 'qualifying' || entry.minimumValue < threshold || entry.conditionsKey !== latest.conditionsKey) break;
          streak.unshift(entry);
        }
        if (streak.length < edge.evidence.consecutiveSessions) return [];
        const declined = progression.declined.find(item => item.edgeId === edge.edgeId);
        if (declined && streak.filter(entry => Date.parse(entry.occurredAt) > Date.parse(declined.declinedAt)).length < edge.repromptAfterSessions) return [];
        const alternatives = policy.anchorAlternatives({definition: def, state: snapshot(state), catalogue: exercises,
          context: snapshot({equipment: context.equipment}), requirementId: anchor.requirementId});
        if (!alternatives.includes(edge.toExerciseId)) return [];
        const requirement = def.anchorSelectionPolicy.requirements.find(item => item.requirementId === anchor.requirementId);
        return [{recommendationId: edge.edgeId+'@'+latest.sessionResultId, edgeId: edge.edgeId, requirementId: anchor.requirementId,
          fromExerciseId: edge.fromExerciseId, toExerciseId: edge.toExerciseId,
          evidenceSessionResultIds: streak.slice(-edge.evidence.consecutiveSessions).map(entry => entry.sessionResultId),
          evidence: clone(edge.evidence), currentTarget: clone(anchor.currentTarget || null), startingTarget: startingTargetFor(def, requirement, edge)}];
      });
    }
    function variationProgressionRecommendations(definition, state, context) {
      const policy = policyFor(definition), def = snapshot(definition); validateState(def, state);
      return clone(currentVariationRecommendations(def, policy, state, context));
    }
    function variationDecision(definition, state, input, decide) {
      const policy = policyFor(definition), def = snapshot(definition); validateState(def, state);
      if (!input || typeof input.recommendationId !== 'string' || !input.now) throw new Error('A variation decision needs a recommendationId and an explicit timestamp.');
      const recommendation = currentVariationRecommendations(def, policy, state, input).find(item => item.recommendationId === input.recommendationId);
      return decide(clone(state), recommendation, def);
    }
    // A confirmation is the only operation that changes a stable anchor's identity.
    // Its transition ID makes a replayed confirmation an exact no-op.
    function confirmVariationProgression(definition, state, input) {
      return variationDecision(definition, state, input, (next, recommendation) => {
        if ((state.anchors || []).some(anchor => anchor.variationProgression && anchor.variationProgression.transitions
          .some(item => item.transitionId === input.recommendationId))) return {status: 'already-applied', state: next};
        if (!recommendation) return {status: 'stale', state: next};
        const anchor = next.anchors.find(item => item.requirementId === recommendation.requirementId);
        const transitions = [...anchor.variationProgression.transitions, {transitionId: recommendation.recommendationId, edgeId: recommendation.edgeId,
          fromExerciseId: recommendation.fromExerciseId, toExerciseId: recommendation.toExerciseId, confirmedAt: input.now,
          evidenceSessionResultIds: recommendation.evidenceSessionResultIds, previousTarget: clone(anchor.currentTarget || null)}].slice(-Model.VARIATION_TRANSITION_LIMIT);
        ['suggestedLoad','loadUnit','loadInterpretation','latestSubstitution'].forEach(key => { delete anchor[key]; });
        Object.assign(anchor, {exerciseId: recommendation.toExerciseId, selectedAt: input.now, currentTarget: recommendation.startingTarget, comparisonBaseline: null,
          // Older results applied later belong to the previous exercise's series.
          progression: {decision: 'variation-progression', lastSessionResultId: recommendation.evidenceSessionResultIds.slice(-1)[0], lastOccurredAt: input.now},
          variationProgression: {schemaVersion: 1, exerciseId: recommendation.toExerciseId, since: input.now, evidence: [], declined: [], transitions}});
        if (next.currentTargets && next.currentTargets.anchorTargets) delete next.currentTargets.anchorTargets[recommendation.requirementId];
        return {status: 'confirmed', state: Model.assertValid('programme-state', next)};
      });
    }
    // Declining records only when it was offered, so the same evidence never re-prompts.
    function declineVariationProgression(definition, state, input) {
      return variationDecision(definition, state, input, (next, recommendation) => {
        if ((state.anchors || []).some(anchor => anchor.variationProgression && anchor.variationProgression.declined
          .some(item => item.recommendationId === input.recommendationId))) return {status: 'already-declined', state: next};
        if (!recommendation) return {status: 'stale', state: next};
        const progression = next.anchors.find(item => item.requirementId === recommendation.requirementId).variationProgression;
        progression.declined = [...progression.declined.filter(item => item.edgeId !== recommendation.edgeId),
          {edgeId: recommendation.edgeId, recommendationId: recommendation.recommendationId, declinedAt: input.now}];
        return {status: 'declined', state: Model.assertValid('programme-state', next)};
      });
    }
    function validateState(definition, state) {
      Model.assertValid('programme-state', state);
      if (state.programmeDefinitionId !== definition.id || state.programmeDefinitionVersion !== definition.version) throw new Error('Programme State is pinned to a different definition/version.');
      const settings = state.currentTargets && state.currentTargets.programmeSettings;
      const policy = policies.get(definition.type);
      if (settings && policy.validateProgrammeSettings) policy.validateProgrammeSettings({definition: snapshot(definition), settings: snapshot(settings)});
      if (policy.validateState) policy.validateState({definition: snapshot(definition), state: snapshot(state)});
    }
    function validateProgrammeState(definition, state) {
      policyFor(definition); validateState(definition,state);
      return clone(state);
    }
    function atTime(state, now) {
      if (now !== undefined && now !== null) {
        // Validate the supplied timestamp independently of enduring target chronology.
        Model.createProgrammeState({...clone(state), startedAt: now, currentTargets: null});
        if (state.startedAt) state.nominalProgress = Math.max(state.nominalProgress || 0, (Date.parse(now) - Date.parse(state.startedAt)) / DAY, 0);
      }
      return state;
    }
    function preflight(prescription) {
      if (!assessSessionPrescription) return {status: 'feasible', hardConflicts: []};
      return assessSessionPrescription({catalogue: exercises, sessionPrescription: snapshot(prescription)});
    }
    function assessProgrammeFeasibility(definition, context = {}) {
      const policy = policyFor(definition), def = snapshot(definition), input = snapshot(context);
      const assessment = clone(policy.assessFeasibility({definition: def, catalogue: exercises, context: input,
        assessSessionPrescription: assessSessionPrescription ? preflight : undefined}));
      if (assessment.status !== 'infeasible' && assessment.prescription) {
        Model.assertValid('session-prescription', assessment.prescription);
        const generatorAssessment = preflight(assessment.prescription);
        assessment.conflicts.push(...(generatorAssessment.hardConflicts || []));
        assessment.status = assessment.conflicts.length ? 'infeasible' : generatorAssessment.status;
        if (assessSessionPrescription) assessment.generatorAssessment = clone(generatorAssessment);
        if (def.supportedDurations && !input.duration && assessment.status !== 'infeasible') {
          assessment.durationAssessments = def.supportedDurations.map(duration => ({duration,
            assessment: clone(preflight(Model.createSessionPrescription({...assessment.prescription, duration})))}));
          assessment.durationAssessments.forEach(item => assessment.conflicts.push(...(item.assessment.hardConflicts || []).map(conflict => ({...conflict, duration: item.duration}))));
          if (assessment.conflicts.length) assessment.status = 'infeasible';
          else if (assessment.durationAssessments.some(item => item.assessment.status === 'partially-feasible')) assessment.status = 'partially-feasible';
        }
      }
      return assessment;
    }
    function startProgramme(definition, context, now) {
      const policy = policyFor(definition), def = snapshot(definition);
      const settingsInput = Object.prototype.hasOwnProperty.call(context, 'programmeSettings') ? context.programmeSettings : def.defaultProgrammeSettings;
      const settings = settingsInput === undefined ? null : Model.createProgrammeSettings(settingsInput);
      if (Object.prototype.hasOwnProperty.call(context, 'sessionContext')) Model.assertSessionContext(context.sessionContext);
      if (settings && policy.validateProgrammeSettings) policy.validateProgrammeSettings({definition: def, settings: snapshot(settings)});
      const input = snapshot(context);
      if (!now) throw new Error('Starting a programme needs an explicit timestamp.');
      const assessment = assessProgrammeFeasibility(def, input);
      if (assessment.status === 'infeasible') return {status: 'infeasible', state: null, assessment: clone(assessment)};
      const state = Model.createProgrammeState({programmeInstanceId: input.programmeInstanceId,
        programmeDefinitionId: def.id, programmeDefinitionVersion: def.version,
        status: 'active', mode: 'development', startedAt: now, nominalProgress: 0, meaningfulSessionsCompleted: 0,
        anchors: [], currentTargets: {}, recentSessionSummaries: [], recentOverrides: [], recentSubstitutions: [], lastAppliedSessionResultId: null});
      const additions = policy.initialiseState({definition: def, catalogue: exercises, context: snapshot({...input, now}), assessment: snapshot(assessment), state: snapshot(state)});
      // Identity, lifecycle and reconciliation are engine-owned, never policy additions.
      state.anchors = clone(additions.anchors || []);
      state.currentTargets = clone(additions.currentTargets || {});
      state.currentTargets.reconciliation = {appliedSessionResultIds: []};
      state.currentTargets.dose = {exposure: 0, patterns: {}, bodyRegions: {}, confidence: 'unknown', hasUnknownExposure: false};
      // This namespace belongs to user choices, never policy initialisation/derived work.
      delete state.currentTargets.programmeSettings;
      if (settings) state.currentTargets.programmeSettings = settings;
      Model.assertValid('programme-state', state);
      const today = {...clone(input), now, prescriptionId: 'start-feasibility'};
      const planned = planNextSession(def, state, [], today);
      if (planned.status === 'infeasible') return {status: 'infeasible', state: null, assessment: {status: 'infeasible', conflicts: planned.conflicts}};
      return {status: planned.status, state, assessment: clone(assessment)};
    }
    function planNextSession(definition, state, trainingHistory, todayContext) {
      const policy = policyFor(definition), def = snapshot(definition);
      validateState(def, state);
      if (state.status !== 'active') throw new Error('Only an active programme can plan a session.');
      if (Object.prototype.hasOwnProperty.call(todayContext, 'sessionContext')) Model.assertSessionContext(todayContext.sessionContext);
      const today = snapshot(todayContext);
      if (!today.now) throw new Error('Planning needs an explicit todayContext.now.');
      const sessionState = atTime(clone(state), today.now);
      for (const [requirementId, exerciseId] of Object.entries(today.anchorSubstitutions || {})) {
        if (!policy.anchorAlternatives || !policy.anchorAlternatives({definition: def, state: snapshot(sessionState), catalogue: exercises, context: today, requirementId}).includes(exerciseId)) throw new Error('Invalid Coach anchor substitute.');
        const anchor = sessionState.anchors.find(item => item.requirementId === requirementId);
        const requirement = def.anchorSelectionPolicy.requirements.find(item => item.requirementId === requirementId);
        Object.assign(anchor, {exerciseId, currentTarget: clone(requirement), comparisonBaseline: null});
        if (sessionState.currentTargets && sessionState.currentTargets.anchorTargets) delete sessionState.currentTargets.anchorTargets[requirementId];
      }
      const projected = snapshot(sessionState);
      const history = History.createHistory(trainingHistory, exercises);
      const base = {definition: def, catalogue: exercises, state: projected, history, today,
        assessSessionPrescription: assessSessionPrescription ? preflight : undefined};
      const mode = policy.getModeSettings ? snapshot(policy.getModeSettings(base)) : snapshot({});
      const missedSessionResponse = policy.respondToMissedSessions ? policy.respondToMissedSessions({...base, mode}) : null;
      const priorities = snapshot(policy.calculatePriorities({...base, mode, missedSessionResponse}));
      let prescription = policy.buildPrescription({...base, mode, priorities, missedSessionResponse});
      if (policy.reduceForShortSession) prescription = policy.reduceForShortSession({...base, mode, priorities, prescription: snapshot(prescription)});
      Model.assertValid('session-prescription', prescription);
      if (prescription.programmeInstanceId !== state.programmeInstanceId) throw new Error('Policy prescription names a different programme.');
      // Explicit programme recovery requirements are contextual feasibility, not debt.
      const conflicts = [];
      if (policy.assessPlannedSession) conflicts.push(...policy.assessPlannedSession({...base, mode, prescription: snapshot(prescription)}).conflicts);
      const recent = history.recentPerformedSessions({programmeInstanceId: state.programmeInstanceId, until: today.now,
        sections: def.doseTargets && def.doseTargets.sections});
      const last = recent.find(session => session.endedAt || session.startedAt);
      const minimumRecoveryHours = def.sequencingRules && def.sequencingRules.minimumRecoveryHours;
      if (last && Number.isFinite(minimumRecoveryHours)
        && (Date.parse(today.now) - Date.parse(last.endedAt || last.startedAt)) / 3600000 < minimumRecoveryHours) conflicts.push({code: 'recovery-interval'});
      const minimumDuration = def.feasibilityRequirements && def.feasibilityRequirements.minimumDurationMinutes;
      if (minimumDuration && prescription.duration < minimumDuration) conflicts.push({code: 'insufficient-duration'});
      if (def.supportedDurations && !def.supportedDurations.includes(prescription.duration)) conflicts.push({code: 'unsupported-duration'});
      const assessment = preflight(prescription);
      conflicts.push(...(assessment.hardConflicts || []));
      return {status: conflicts.length ? 'infeasible' : assessment.status,
        prescription: conflicts.length ? null : clone(prescription), conflicts: clone(conflicts), assessment: clone(assessment),
        rationale: {nominalProgress: projected.nominalProgress, priorities: clone(priorities), missedSessionResponse: clone(missedSessionResponse)}};
    }

    function applySessionResult(definition, state, sessionResult, trainingHistory, rebuilding = false) {
      const policy = policyFor(definition), def = snapshot(definition);
      validateState(def, state); Model.assertValid('session-result', sessionResult);
      if (sessionResult.source !== 'coach' || sessionResult.programmeInstanceId !== state.programmeInstanceId) throw new Error('Session Result does not belong to this Coach programme.');
      const currentTargets = state.currentTargets || {}, reconciliation = currentTargets.reconciliation || {};
      const ids = [...new Set([...(reconciliation.appliedSessionResultIds || []),
        ...(state.lastAppliedSessionResultId ? [state.lastAppliedSessionResultId] : []),
        ...(state.recentSessionSummaries || []).map(summary => summary.sessionResultId).filter(Boolean)])];
      // The #54 marker handles retry of the latest result; the retained ID ledger handles
      // older retries even when recent summaries are compacted by a future consumer.
      if (ids.includes(sessionResult.sessionResultId)) return clone(state);
      const history = History.createHistory([...trainingHistory, sessionResult], exercises);
      const result = snapshot(sessionResult), evidence = history.sessionEvidence(result.sessionResultId);
      const next = atTime(clone(state), result.endedAt || result.startedAt);
      const base = {definition: def, catalogue: exercises, state: snapshot(next), history, result, evidence};
      const mode = policy.getModeSettings ? snapshot(policy.getModeSettings(base)) : snapshot({});
      const dose = policy.interpretDose({...base, mode});
      if (!dose || typeof dose.meaningful !== 'boolean' || !dose.exposure || !Number.isFinite(dose.exposure.value) || dose.exposure.value < 0) throw new Error('Policy returned invalid performed dose.');
      // Even a policy cannot award a meaningful session from an empty/skipped result.
      const hasPerformedCredit = evidence.performances.some(item => item.exposure.value > 0);
      const meaningful = hasPerformedCredit && dose.meaningful;
      next.meaningfulSessionsCompleted = (next.meaningfulSessionsCompleted || 0) + Number(meaningful);
      next.currentTargets = next.currentTargets || {};
      next.currentTargets.reconciliation = {appliedSessionResultIds: [...ids, result.sessionResultId]};
      const total = next.currentTargets.dose || {exposure: 0, patterns: {}, bodyRegions: {}, confidence: 'unknown'};
      const unknownExposure = evidence.performances.some(item => item.exposure.confidence === 'unknown') && dose.exposure.confidence === 'unknown';
      total.hasUnknownExposure = total.hasUnknownExposure === true || unknownExposure;
      if (hasPerformedCredit) {
        const priorExposure = total.exposure;
        total.exposure += dose.exposure.value;
        for (const field of ['patterns','bodyRegions']) Object.entries(dose[field] || {}).forEach(([key, value]) => { total[field][key] = (total[field][key] || 0) + value; });
        for (const field of ['directElbowActions','compoundContext']) {
          if (!dose[field]) continue;
          total[field] = total[field] || {};
          Object.entries(dose[field]).forEach(([key, exposure]) => { total[field][key] = (total[field][key] || 0) + exposure.value; });
        }
        total.confidence = total.hasUnknownExposure || (priorExposure > 0 && total.confidence === 'unknown') || dose.exposure.confidence === 'unknown' ? 'unknown' : 'derived';
        if (policy.interpretProgression) next.anchors = clone(policy.interpretProgression({...base, mode}));
      }
      if (unknownExposure) total.confidence = 'unknown';
      next.currentTargets.dose = total;
      // Opt-in only: definitions without reviewed variation edges keep identical anchors.
      next.anchors = recordVariationEvidence(def, policy, mode, next, result, evidence);
      next.recentSessionSummaries = [...(next.recentSessionSummaries || []), {sessionResultId: result.sessionResultId,
        endedAt: result.endedAt || null, finalStatus: result.finalStatus, meaningful, exposure: clone(dose.exposure)}];
      if (meaningful) {
        next.currentTargets.lastMeaningfulSessionResultId = result.sessionResultId;
        next.recentOverrides = [...(next.recentOverrides || []), ...(result.overrides || []).map(override => ({...clone(override), sessionResultId: result.sessionResultId}))];
        next.recentSubstitutions = [...(next.recentSubstitutions || []), ...(result.substitutions || []).map(substitution => ({...clone(substitution), sessionResultId: result.sessionResultId}))];
      }
      if (!def.openEnded) {
        const counts = next.currentTargets.blockMeaningfulCounts || {};
        if (!next.currentTargets.blockMeaningfulCounts) {
          (state.recentSessionSummaries || []).filter(item => item.meaningful).forEach(item => {
            const block = Math.floor((Date.parse(item.endedAt)-Date.parse(state.startedAt)) / (def.nominalDurationDays*DAY));
            counts[block] = (counts[block] || 0) + 1;
          });
        }
        const block = Math.floor((Date.parse(result.endedAt || result.startedAt)-Date.parse(state.startedAt)) / (def.nominalDurationDays*DAY));
        if (meaningful) counts[block] = (counts[block] || 0) + 1;
        next.currentTargets.blockMeaningfulCounts = counts;
      }
      next.recentSessionSummaries = next.recentSessionSummaries.slice(-64);
      next.recentOverrides = next.recentOverrides.slice(-32);
      next.recentSubstitutions = next.recentSubstitutions.slice(-32);
      next.lastAppliedSessionResultId = result.sessionResultId;
      if (!rebuilding && policy.applyPerformedState) next.currentTargets = clone(policy.applyPerformedState({
        ...base, state: snapshot(next), meaningful}));
      if (policy.isComplete && policy.isComplete({...base, mode, state: snapshot(next)})) next.status = 'completed';
      return Model.assertValid('programme-state', next);
    }
    // Repair evidence-derived totals explicitly, never on render. Membership,
    // lifecycle, chosen mode, review decisions and current anchor targets remain
    // user/policy state: historical mode changes are not a persisted event log.
    // Exact comparable anchor series are rebuilt by TrainingHistory separately.
    function rebuildDerivedState(definition, state, trainingHistory) {
      policyFor(definition); validateState(definition, state);
      let rebuilt = clone(state);
      rebuilt.meaningfulSessionsCompleted = 0;
      rebuilt.lastAppliedSessionResultId = null;
      rebuilt.recentSessionSummaries = []; rebuilt.recentOverrides = []; rebuilt.recentSubstitutions = [];
      rebuilt.currentTargets = rebuilt.currentTargets || {};
      rebuilt.currentTargets.reconciliation = {appliedSessionResultIds: []};
      rebuilt.currentTargets.dose = {exposure: 0, patterns: {}, bodyRegions: {}, confidence: 'unknown', hasUnknownExposure: false};
      delete rebuilt.currentTargets.blockMeaningfulCounts;
      delete rebuilt.currentTargets.lastMeaningfulSessionResultId;
      const history = History.createHistory(trainingHistory, exercises);
      const sessions = history.sessionsForProgramme(state.programmeInstanceId).filter(result => result.source === 'coach');
      for (const result of sessions) {
        rebuilt = applySessionResult(definition, rebuilt, result, [], true);
        rebuilt.anchors = clone(state.anchors); rebuilt.status = state.status;
      }
      return Model.assertValid('programme-state', rebuilt);
    }
    function transition(state, field, value) {
      Model.assertValid('programme-state', state);
      if (state.status === 'completed') throw new Error('A completed programme cannot change lifecycle or mode.');
      return Model.createProgrammeState({...clone(state), [field]: value});
    }
    function updateProgrammeSettings(definition, state, patch, context = {}) {
      const policy = policyFor(definition); validateState(definition, state);
      if (state.status === 'completed') throw new Error('A completed programme cannot change settings.');
      const current = state.currentTargets && state.currentTargets.programmeSettings;
      const settings = current ? Model.updateProgrammeSettings(current, patch) : Model.createProgrammeSettings(patch);
      if (policy.validateSettingsChange) policy.validateSettingsChange({definition: snapshot(definition),
        previous: current ? snapshot(current) : null, settings: snapshot(settings), context: snapshot(context)});
      const next = clone(state);
      next.currentTargets = next.currentTargets || {};
      next.currentTargets.programmeSettings = settings;
      validateState(definition, next);
      return next;
    }
    function beginSession(definition, state, prescription, now) {
      const policy = policyFor(definition); validateState(definition,state);
      Model.assertValid('session-prescription',prescription);
      if (state.status !== 'active' || prescription.programmeInstanceId !== state.programmeInstanceId) throw new Error('Invalid programme for session start.');
      atTime(clone(state),now);
      return policy.beginSession ? Model.assertValid('programme-state',policy.beginSession({
        definition: snapshot(definition), state: snapshot(state), prescription: snapshot(prescription), now})) : clone(state);
    }
    function sportReview(definition, state, now) {
      const policy = policyFor(definition); validateState(definition,state); atTime(clone(state),now);
      return policy.sportReviewRecommendation ? clone(policy.sportReviewRecommendation({definition: snapshot(definition), state: snapshot(state), now})) : null;
    }
    function recordSportReview(definition, state, response, now) {
      const policy = policyFor(definition); validateState(definition,state); atTime(clone(state),now);
      if (!policy.recordSportReview) throw new Error('This programme has no sport check-in.');
      return Model.assertValid('programme-state',policy.recordSportReview({definition: snapshot(definition), state: snapshot(state), response: snapshot(response), now}));
    }
    function programmeReview(definition, state, now) {
      policyFor(definition); validateState(definition, state);
      const progress = atTime(clone(state), now).nominalProgress || 0;
      if (definition.openEnded) return {due: false, block: 0, nominalProgress: progress, meaningfulSessions: state.meaningfulSessionsCompleted, targetMet: false};
      const block = definition.openEnded ? 0 : Math.floor(progress / definition.nominalDurationDays);
      const acknowledged = state.currentTargets && state.currentTargets.blockReview && state.currentTargets.blockReview.acknowledgedBlocks || 0;
      const start = Date.parse(state.startedAt) + Math.max(0, block-1) * definition.nominalDurationDays * DAY;
      const end = start + definition.nominalDurationDays * DAY;
      const meaningfulSessions = state.currentTargets && state.currentTargets.blockMeaningfulCounts
        ? state.currentTargets.blockMeaningfulCounts[block-1] || 0
        : (state.recentSessionSummaries || []).filter(item => item.meaningful && Date.parse(item.endedAt) >= start && Date.parse(item.endedAt) < end).length;
      return {due: state.status === 'active' && block > acknowledged, block, nominalProgress: progress,
        meaningfulSessions, targetMet: meaningfulSessions >= definition.completionCriteria.blockMeaningfulSessionTarget};
    }
    function acknowledgeBlockReview(definition, state, now) {
      if (state.status === 'completed') throw new Error('A completed programme cannot acknowledge a block review.');
      const review = programmeReview(definition, state, now);
      const next = atTime(clone(state), now);
      next.currentTargets = next.currentTargets || {};
      next.currentTargets.blockReview = {acknowledgedBlocks: review.block, acknowledgedAt: now};
      return Model.assertValid('programme-state', next);
    }
    function getAnchorAlternatives(definition, state, context, requirementId) {
      const policy = policyFor(definition); validateState(definition, state);
      return policy.anchorAlternatives ? clone(policy.anchorAlternatives({definition: snapshot(definition), state: snapshot(state),
        catalogue: exercises, context: snapshot(context), requirementId})) : [];
    }
    return Object.freeze({assessProgrammeFeasibility, startProgramme, planNextSession, applySessionResult, rebuildDerivedState, updateProgrammeSettings,
      beginSession, sportReview, recordSportReview, validateProgrammeState,
      variationProgressionRecommendations, confirmVariationProgression, declineVariationProgression,
      programmeReview, acknowledgeBlockReview, getAnchorAlternatives,
      finishProgramme: state => transition(state, 'status', 'completed'),
      pauseProgramme: state => transition(state, 'status', 'paused'), resumeProgramme: state => transition(state, 'status', 'active'),
      enterMaintenanceMode: state => transition(state, 'mode', 'maintenance'), exitMaintenanceMode: state => transition(state, 'mode', 'development')});
  }

  root.GarageFitCoachEngine = {createEngine};
})(typeof window !== 'undefined' ? window : globalThis);
