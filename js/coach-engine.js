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
      return policy;
    }
    function validateState(definition, state) {
      Model.assertValid('programme-state', state);
      if (state.programmeDefinitionId !== definition.id || state.programmeDefinitionVersion !== definition.version) throw new Error('Programme State is pinned to a different definition/version.');
      const settings = state.currentTargets && state.currentTargets.programmeSettings;
      const policy = policies.get(definition.type);
      if (settings && policy.validateProgrammeSettings) policy.validateProgrammeSettings({definition: snapshot(definition), settings: snapshot(settings)});
    }
    function atTime(state, now) {
      if (now !== undefined && now !== null) {
        // Timestamp validation shares the existing record contract, including timezone.
        Model.createProgrammeState({...clone(state), startedAt: now});
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
      const assessment = clone(policy.assessFeasibility({definition: def, catalogue: exercises, context: input}));
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
      const settings = Object.prototype.hasOwnProperty.call(context, 'programmeSettings') ? Model.createProgrammeSettings(context.programmeSettings) : null;
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
      const base = {definition: def, catalogue: exercises, state: projected, history, today};
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

    function applySessionResult(definition, state, sessionResult, trainingHistory) {
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
        rebuilt = applySessionResult(definition, rebuilt, result, []);
        rebuilt.anchors = clone(state.anchors); rebuilt.status = state.status;
      }
      return Model.assertValid('programme-state', rebuilt);
    }
    function transition(state, field, value) {
      Model.assertValid('programme-state', state);
      if (state.status === 'completed') throw new Error('A completed programme cannot change lifecycle or mode.');
      return Model.createProgrammeState({...clone(state), [field]: value});
    }
    function updateProgrammeSettings(definition, state, patch) {
      policyFor(definition); validateState(definition, state);
      if (state.status === 'completed') throw new Error('A completed programme cannot change settings.');
      const current = state.currentTargets && state.currentTargets.programmeSettings;
      const settings = current ? Model.updateProgrammeSettings(current, patch) : Model.createProgrammeSettings(patch);
      const next = clone(state);
      next.currentTargets = next.currentTargets || {};
      next.currentTargets.programmeSettings = settings;
      validateState(definition, next);
      return next;
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
      programmeReview, acknowledgeBlockReview, getAnchorAlternatives,
      finishProgramme: state => transition(state, 'status', 'completed'),
      pauseProgramme: state => transition(state, 'status', 'paused'), resumeProgramme: state => transition(state, 'status', 'active'),
      enterMaintenanceMode: state => transition(state, 'mode', 'maintenance'), exitMaintenanceMode: state => transition(state, 'mode', 'development')});
  }

  root.GarageFitCoachEngine = {createEngine};
})(typeof window !== 'undefined' ? window : globalThis);
