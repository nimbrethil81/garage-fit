(function (root) {
  // General Fitness (#190): an anchor-free, open-ended policy on the common Coach engine.
  // It chooses an intended workout family from rolling *performed* training effects and
  // asks the shared family composers (through the prescribed Generator seam) to build it.
  // There are no anchors, no repeating movement targets, no catch-up queue and no score.
  // Approximate external preferences only nudge priorities; they never earn credit.
  const clone = value => JSON.parse(JSON.stringify(value));
  const DAY = 86400000, HOUR = 3600000;
  const EFFECTS = ['strength','conditioning','challenge','athletic','core','mobility'];
  const EFFECT_LABELS = {strength: 'strength', conditioning: 'conditioning', challenge: 'whole-body challenge',
    athletic: 'athletic movement', core: 'core stability', mobility: 'mobility'};
  const SOURCES = ['coach','generator','fixed'];

  const fail = message => { throw new Error('Invalid General Fitness definition: '+message+'.'); };
  const positive = value => Number.isFinite(value) && value > 0;
  const nonNegative = value => Number.isFinite(value) && value >= 0;
  function weightsValid(weights) {
    return weights && Object.keys(weights).length === EFFECTS.length && EFFECTS.every(effect => positive(weights[effect]));
  }
  function validateDefinition(definition) {
    const Policies = root.GarageFitCoachPolicies, Model = root.GarageFitCoachModel;
    Policies.assertDefinition(definition);
    if (!definition.openEnded) fail('it is open-ended');
    if (definition.anchorSelectionPolicy !== undefined || definition.variationProgressionPolicy !== undefined || definition.progressionPolicy !== undefined) fail('it has no anchors or anchor progression');
    const frequency = definition.recommendedFrequency || {};
    if (!positive(frequency.minSessionsPerWeek) || !(frequency.maxSessionsPerWeek >= frequency.minSessionsPerWeek)) fail('it needs a weekly frequency range');
    const durations = definition.supportedDurations;
    if (!positive(definition.coverageTargets && definition.coverageTargets.windowDays) || definition.coverageTargets.includeCrossSourceHistory !== true) fail('it needs a rolling cross-source window');
    if (!definition.doseTargets || definition.doseTargets.meaningfulRule !== 'any-performed-main-work'
      || !Array.isArray(definition.doseTargets.sections) || !definition.doseTargets.sections.length) fail('it needs the performed Main-work dose rule');
    const balance = definition.familyBalancePolicy || {};
    const families = balance.families, registry = root.GarageFitData && root.GarageFitData.workoutFamilies;
    if (!Array.isArray(families) || !families.length) fail('it needs workout families');
    const ids = new Set();
    families.forEach(family => {
      if (!family || ids.has(family.workoutFamilyId) || !registry || !registry[family.workoutFamilyId] || !registry[family.workoutFamilyId][family.workoutFamilyVersion]) fail('each family must be a unique published family version');
      ids.add(family.workoutFamilyId);
      const effects = Object.entries(family.effects || {});
      if (!effects.length || effects.some(([effect, share]) => !EFFECTS.includes(effect) || !positive(share)) || Math.abs(effects.reduce((sum, [, share]) => sum + share, 0) - 1) > 1e-9) fail('family effects must be shares of known effects');
      if (typeof family.demanding !== 'boolean' || typeof family.repeatable !== 'boolean') fail('family demand and repetition must be explicit');
    });
    if (ids.size !== Object.keys(registry).length) fail('it uses every canonical workout family');
    if (!EFFECTS.every(effect => families.some(family => family.effects[effect]))) fail('every training effect needs a family');
    // Every offered duration must be one every family version publishes support for.
    if (!Array.isArray(durations) || !durations.length || durations.some(value => families.some(family =>
      !registry[family.workoutFamilyId][family.workoutFamilyVersion].feasibilityRequirements.supportedDurations.includes(value)))) fail('it needs durations every family supports');
    if (!weightsValid(balance.effectWeights && balance.effectWeights.lowAttendance) || !weightsValid(balance.effectWeights.regularAttendance)) fail('it needs effect weights for each attendance level');
    if (!positive(balance.regularAttendanceSessionsPerWeek) || !positive(balance.attendanceWindowDays)) fail('it needs attendance thresholds');
    const variety = definition.varietyPolicy || {};
    if (!Number.isInteger(variety.recentSessions) || variety.recentSessions < 1 || !Number.isInteger(variety.maximumConsecutiveRepeatable) || variety.maximumConsecutiveRepeatable < 1
      || !['repeatPreviousPenalty','repeatableRepeatPenalty','recentRepeatPenalty'].every(key => nonNegative(variety[key]))) fail('it needs explicit variety safeguards');
    const recovery = definition.recoveryPolicy || {};
    if (!positive(recovery.recentHours) || !nonNegative(recovery.demandingPenalty) || !Number.isInteger(recovery.reportedDays) || recovery.reportedDays < 0
      || !Array.isArray(recovery.reportedIntensities)) fail('it needs an explicit recovery preference');
    const external = definition.externalActivityPolicy || {};
    if (!nonNegative(external.typicalMobilityWeightPerSession) || !nonNegative(external.maximumTypicalMobilityWeight)) fail('it needs bounded external-activity influence');
    if (!definition.sessionTemplate || !durations.includes(definition.sessionTemplate.duration)) fail('it needs a session template');
    Model.createSessionPrescription({prescriptionId: 'definition-check', programmeInstanceId: 'definition-check', sessionRole: 'check', ...definition.sessionTemplate});
    if (!definition.sequencingRules || !nonNegative(definition.sequencingRules.minimumRecoveryHours)) fail('it needs sequencing rules');
    if (!definition.missedSessionPolicy || definition.missedSessionPolicy.strategy !== 'recompute-no-debt') fail('missed sessions must recompute without debt');
    if (!definition.feasibilityRequirements || !positive(definition.feasibilityRequirements.minimumDurationMinutes)) fail('it needs a minimum duration');
    const completion = definition.completionCriteria || {};
    if (completion.minimumMeaningfulSessions !== null || completion.requireNominalDuration !== false) fail('it never completes automatically');
    if (definition.benchmarkPolicy !== undefined) validateBenchmarkPolicy(definition, families, durations);
  }

  // ---- Optional embedded comparable benchmarks (#192, approved Decision 7 C) ----
  // A definition opts in with `benchmarkPolicy` (General Fitness v2). Released v1 has none and plans
  // exactly as before. Benchmarks are unloaded one-set rep measurements, recorded through the existing
  // Session Tracker as ordinary Main work whose requirement id is `benchmark:<benchmarkId>`; the
  // existing Training History comparison decides what is comparable. Nothing here scores fitness.
  const BENCHMARK_PREFIX = 'benchmark:';
  const BENCHMARK_FIELDS = ['workoutFamilyId','workoutFamilyVersion','minimumIntervalDays','minimumMeaningfulSessions',
    'minimumDurationMinutes','exerciseRestSeconds','benchmarks','consistencyWeeks'];
  const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  function validateBenchmarkPolicy(definition, families, durations) {
    const policy = definition.benchmarkPolicy, catalogue = root.GarageFitData && root.GarageFitData.exercises;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy) || Object.keys(policy).some(key => !BENCHMARK_FIELDS.includes(key))) fail('benchmarkPolicy is a closed object');
    if (!families.some(family => family.workoutFamilyId === policy.workoutFamilyId && family.workoutFamilyVersion === policy.workoutFamilyVersion)) fail('benchmarks belong to a published family in the plan');
    // Conservative cadence: never more often than about every four weeks.
    if (!Number.isInteger(policy.minimumIntervalDays) || policy.minimumIntervalDays < 28) fail('benchmarks are offered at most about every four weeks');
    if (!Number.isInteger(policy.minimumMeaningfulSessions) || policy.minimumMeaningfulSessions < 1) fail('benchmarks wait for a first meaningful session');
    if (!durations.includes(policy.minimumDurationMinutes) || policy.minimumDurationMinutes < 20) fail('benchmarks need a session of at least 20 minutes');
    if (!Number.isInteger(policy.exerciseRestSeconds) || policy.exerciseRestSeconds < 0) fail('benchmarks need a fixed rest');
    if (!Number.isInteger(policy.consistencyWeeks) || policy.consistencyWeeks < 1 || policy.consistencyWeeks > 8) fail('consistency covers one to eight weeks');
    const items = policy.benchmarks;
    if (!Array.isArray(items) || !items.length || items.length > 4) fail('it needs one to four reviewed benchmarks');
    items.forEach(item => {
      const exercise = catalogue && catalogue[item.exerciseId];
      if (!item || Object.keys(item).some(key => !['benchmarkId','exerciseId','setupId','capability'].includes(key))
        || !slug(item.benchmarkId) || !slug(item.setupId) || typeof item.capability !== 'string' || !item.capability) fail('each benchmark needs an id, exercise, setup and capability');
      if (!exercise || exercise.prescription.type !== 'reps' || (exercise.equipment || []).length || exercise.sidedness === 'per-side' || exercise.sidedness === 'alternating')
        fail('benchmarks are unloaded bilateral rep exercises');
    });
    if (new Set(items.map(item => item.benchmarkId)).size !== items.length || new Set(items.map(item => item.exerciseId)).size !== items.length) fail('benchmarks must be unique');
  }

  function assessFeasibility({definition, context}) {
    const conflicts = [];
    if (context.duration !== undefined && !definition.supportedDurations.includes(context.duration)) conflicts.push({code: 'unsupported-duration'});
    if (context.equipment !== undefined && (!Array.isArray(context.equipment) || context.equipment.some(item => typeof item !== 'string'))) conflicts.push({code: 'invalid-equipment'});
    // No anchors means no programme-wide equipment prerequisite. Each session proves its
    // own family through composition and the shared gate, or reports why it cannot.
    return {status: conflicts.length ? 'infeasible' : 'feasible', conflicts, anchors: [], prescription: null};
  }
  const initialiseState = () => ({anchors: [], currentTargets: {}});
  const getModeSettings = ({definition}) => ({frequency: clone(definition.recommendedFrequency), coverageMultiplier: 1,
    keepAccessories: true, allowProgression: false, anchorTargetOverrides: {}});

  // Exercise-derived effect for generic work without a recorded family identity.
  function exerciseEffect(exercise) {
    if (!exercise) return null;
    if (exercise.bodyFocus === 'core') return 'core';
    if (exercise.conditioning || exercise.cardio > exercise.strength) return 'conditioning';
    return exercise.strength >= 3 ? 'strength' : null;
  }
  // Released definitions name each family by the version they were published with. New sessions are
  // composed with that family's current published version (registry-declared, never older than the
  // definition's), so a corrected composition reaches existing instances without editing a released
  // definition. Balance, variety and recency already compare families by id across versions.
  function compositionVersion(family) {
    const current = root.GarageFitData.workoutFamilyCurrentVersions && root.GarageFitData.workoutFamilyCurrentVersions[family.workoutFamilyId];
    return Number.isInteger(current) && current > family.workoutFamilyVersion ? current : family.workoutFamilyVersion;
  }
  const localDateOf = (today) => typeof today.localDate === 'string' ? today.localDate : String(today.now).slice(0, 10);
  const dayNumber = day => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m-1, d) / DAY; };

  // Performed sessions in the rolling window, across Coach instances, standalone Generator
  // and fixed workouts. Each carries a performed fraction and effect shares; nothing here
  // is a programme credit (the engine alone credits this instance's own Coach results).
  function performedSessions({definition, history, catalogue, today}) {
    const now = Date.parse(today.now), families = definition.familyBalancePolicy.families;
    const summary = history.recentTrainingSummary({limit: root.GarageFitTrainingHistory.MAX_RECENT_SESSION_LIMIT,
      since: new Date(now - definition.coverageTargets.windowDays * DAY).toISOString(), until: today.now});
    return summary.sessions.filter(session => SOURCES.includes(session.source)).map(session => {
      const result = history.sessions.find(item => item.sessionResultId === session.sessionResultId);
      const main = session.performances.filter(item => definition.doseTargets.sections.includes(item.section) || item.section === null);
      const planned = (result.plannedWork || []).filter(item => definition.doseTargets.sections.includes(item.section)).length;
      const performed = main.reduce((sum, item) => sum + (item.exposure.value || 0), 0);
      const weight = performed > 0 ? Math.min(1, planned ? performed / planned : 1) : 0;
      // Every published version of a family is that family for balance (e.g. Athletic v1 and v2, #244).
      const family = families.find(item => item.workoutFamilyId === session.workoutFamilyId) || null;
      let effects = {}, basis = 'family-identity';
      if (family) effects = clone(family.effects);
      else {
        basis = 'exercise-metadata';
        const counted = main.map(item => exerciseEffect(catalogue[item.exerciseId])).filter(Boolean);
        counted.forEach(effect => { effects[effect] = (effects[effect] || 0) + 1 / counted.length; });
      }
      const demanding = family ? family.demanding : (effects.strength || 0) + (effects.conditioning || 0) + (effects.challenge || 0) >= 0.5;
      return {sessionResultId: session.sessionResultId, source: session.source, programmeInstanceId: session.programmeInstanceId,
        occurredAt: session.occurredAt, workoutFamilyId: session.workoutFamilyId, workoutFamilyVersion: session.workoutFamilyVersion,
        familyStyleId: session.familyStyleId, weight, effects, basis, demanding};
    });
  }

  // Benchmark occasions in this instance's results: a session that reached its benchmark (completed,
  // whether measured or skipped) or measured any of it. Abandoned or early exits that never measured
  // anything offer nothing and cost nothing, so the opportunity simply returns.
  function benchmarkOccasions(history, state) {
    return history.sessions.filter(result => result.programmeInstanceId === state.programmeInstanceId
      && ['completed','partial'].includes(result.finalStatus)).map(result => {
      const planned = (result.plannedWork || []).filter(item => typeof item.requirementId === 'string' && item.requirementId.startsWith(BENCHMARK_PREFIX));
      if (!planned.length) return null;
      const ids = new Set(planned.map(item => item.occurrenceId));
      const measured = (result.performedWork || []).some(item => ids.has(item.occurrenceId));
      return result.finalStatus === 'completed' || measured ? result.endedAt || result.startedAt : null;
    }).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b));
  }
  // Is a benchmark opportunity due for today's plan? Pure, with an explicit reason, never a debt.
  function benchmarkOffer({definition, state, history, today, recovery, intendedFamily}) {
    const policy = definition.benchmarkPolicy, now = Date.parse(today.now);
    const occasions = benchmarkOccasions(history, state), last = occasions.length ? occasions[occasions.length - 1] : null;
    const nextEligibleAt = last ? new Date(Date.parse(last) + policy.minimumIntervalDays * DAY).toISOString() : null;
    const duration = today.duration || definition.sessionTemplate.duration;
    const difficulty = today.easyToday ? 'easy' : today.difficulty || definition.sessionTemplate.difficulty;
    let reason = 'offered';
    if ((state.meaningfulSessionsCompleted || 0) < policy.minimumMeaningfulSessions) reason = 'too-early';
    else if (last && now - Date.parse(last) < policy.minimumIntervalDays * DAY) reason = 'recent-benchmark';
    else if (duration < policy.minimumDurationMinutes) reason = 'short-session';
    else if (difficulty === 'easy') reason = 'easy-today';
    else if (recovery.preferLowerDemand) reason = 'recovery-preferred';
    // The policy names the published family version it was released with; the plan composes that family at its
    // current version (never older), which is still the same family for the benchmark.
    else if (!intendedFamily || intendedFamily.workoutFamilyId !== policy.workoutFamilyId || intendedFamily.workoutFamilyVersion < policy.workoutFamilyVersion) reason = 'other-family';
    return {status: reason === 'offered' ? 'offered' : 'not-offered', reason, lastOccasionAt: last, nextEligibleAt, occasions: occasions.length};
  }
  // The spec names the composed family version (`intendedFamily`, the plan's first candidate), so the Generator and the
  // Session Prescription keep one family identity when the plan composes a later version than the policy was released with.
  function benchmarkSpec(definition, intendedFamily) {
    const policy = definition.benchmarkPolicy;
    return {workoutFamilyId: policy.workoutFamilyId, workoutFamilyVersion: intendedFamily ? intendedFamily.workoutFamilyVersion : policy.workoutFamilyVersion, exerciseRestSeconds: policy.exerciseRestSeconds,
      items: policy.benchmarks.map(item => ({benchmarkId: item.benchmarkId, exerciseId: item.exerciseId, setupId: item.setupId}))};
  }

  function calculatePriorities(input) {
    const {definition, today, state} = input;
    const balance = definition.familyBalancePolicy, variety = definition.varietyPolicy, recoveryPolicy = definition.recoveryPolicy;
    const now = Date.parse(today.now), sessions = performedSessions(input);
    // Attendance adapts emphasis to actual recent frequency; misses create no debt.
    const attended = sessions.filter(item => item.weight > 0 && now - Date.parse(item.occurredAt) <= balance.attendanceWindowDays * DAY).length;
    const sessionsPerWeek = attended / (balance.attendanceWindowDays / 7);
    const level = sessionsPerWeek >= balance.regularAttendanceSessionsPerWeek ? 'regularAttendance' : 'lowAttendance';
    const weights = clone(balance.effectWeights[level]);
    // Usual external routines are approximate and type-agnostic: they never earn effect
    // credit, they only bound a small extra preference for low-demand mobility work.
    const external = today.externalActivity || null;
    const typical = external && Array.isArray(external.typical) ? external.typical : [];
    const typicalSessionsPerWeek = typical.reduce((sum, item) => sum + (Number.isFinite(item.sessionsPerWeek) ? item.sessionsPerWeek : 0), 0);
    const mobilityBonus = Math.min(definition.externalActivityPolicy.maximumTypicalMobilityWeight,
      typicalSessionsPerWeek * definition.externalActivityPolicy.typicalMobilityWeightPerSession);
    weights.mobility += mobilityBonus;
    const totalWeight = EFFECTS.reduce((sum, effect) => sum + weights[effect], 0);
    const performedTotal = sessions.reduce((sum, item) => sum + item.weight, 0);
    const effects = EFFECTS.map(effect => {
      const credited = sessions.reduce((sum, item) => sum + item.weight * (item.effects[effect] || 0), 0);
      const targetShare = weights[effect] / totalWeight;
      return {effect, label: EFFECT_LABELS[effect], targetShare, performedSessions: credited,
        need: targetShare * (performedTotal + 1) - credited, confidence: sessions.length ? 'derived' : 'unknown'};
    });
    const need = Object.fromEntries(effects.map(item => [item.effect, item.need]));
    // Recovery preference: transparent, conservative ordering only (never a rest order).
    const reasons = [];
    const latest = sessions.find(item => item.weight > 0);
    if (latest && latest.demanding && now - Date.parse(latest.occurredAt) < recoveryPolicy.recentHours * HOUR) reasons.push('recent-demanding-session');
    const reports = external && external.actual && external.actual.status === 'confirmed' ? external.actual.reports || [] : [];
    const day = dayNumber(localDateOf(today));
    if (reports.some(report => recoveryPolicy.reportedIntensities.includes(report.reportedIntensity)
      && day - dayNumber(report.localDate) >= 0 && day - dayNumber(report.localDate) <= recoveryPolicy.reportedDays)) reasons.push('reported-hard-activity');
    const recent = sessions.slice(0, variety.recentSessions);
    const families = balance.families.map((family, index) => {
      const value = Object.entries(family.effects).reduce((sum, [effect, share]) => sum + share * need[effect], 0);
      const consecutive = recent.findIndex(item => item.workoutFamilyId !== family.workoutFamilyId);
      const run = consecutive === -1 ? recent.length : consecutive;
      let varietyPenalty = 0;
      if (run > 0) varietyPenalty += family.repeatable && run < variety.maximumConsecutiveRepeatable ? variety.repeatableRepeatPenalty : variety.repeatPreviousPenalty;
      varietyPenalty += variety.recentRepeatPenalty * recent.filter(item => item.workoutFamilyId === family.workoutFamilyId).length;
      const recoveryPenalty = reasons.length && family.demanding ? recoveryPolicy.demandingPenalty : 0;
      const last = sessions.find(item => item.workoutFamilyId === family.workoutFamilyId) || null;
      return {workoutFamilyId: family.workoutFamilyId, workoutFamilyVersion: compositionVersion(family), index,
        primaryEffect: Object.entries(family.effects).sort((a, b) => b[1] - a[1])[0][0],
        balanceScore: value, varietyPenalty, recoveryPenalty, score: value - varietyPenalty - recoveryPenalty,
        lastPerformedAt: last ? last.occurredAt : null, lastFamilyStyleId: last ? last.familyStyleId : null};
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    const recovery = {preferLowerDemand: reasons.length > 0, reasons};
    return {effects, families,
      attendance: {sessionsPerWeek, level, windowDays: balance.attendanceWindowDays, recommended: clone(definition.recommendedFrequency)},
      recovery,
      ...(definition.benchmarkPolicy ? {benchmark: benchmarkOffer({definition, state, history: input.history, today, recovery, intendedFamily: families[0]})} : {}),
      externalActivity: {typicalSessionsPerWeek, mobilityPreference: mobilityBonus, confidence: typical.length ? 'approximate' : 'unknown',
        confirmedReports: reports.length},
      history: {sessions: sessions.map(item => ({sessionResultId: item.sessionResultId, source: item.source, occurredAt: item.occurredAt,
        workoutFamilyId: item.workoutFamilyId || null, familyStyleId: item.familyStyleId || null, weight: item.weight, basis: item.basis})),
        programmeInstanceId: state.programmeInstanceId, credit: 'none'}};
  }

  function familyName(id, version) {
    const versions = root.GarageFitData.workoutFamilies[id];
    return versions && versions[version] ? versions[version].name : id;
  }
  function rationaleFor(family, index, priorities, first) {
    const name = familyName(family.workoutFamilyId, family.workoutFamilyVersion), label = EFFECT_LABELS[family.primaryEffect];
    const parts = [];
    if (index === 0) {
      const top = priorities.effects.slice().sort((a, b) => b.need - a.need)[0];
      parts.push(top.effect === family.primaryEffect
        ? name+' prioritises '+label+', the training effect least covered by your recent performed sessions.'
        : name+' adds '+label+' while keeping your recent sessions varied.');
      if (priorities.recovery.preferLowerDemand && !family.recoveryPenalty) parts.push('Recent demanding work favours lower-demand training today.');
    } else parts.push(name+' is a feasible alternative for '+label+' if '+familyName(first.workoutFamilyId, first.workoutFamilyVersion)+' cannot be built with today’s settings.');
    return parts.join(' ');
  }

  function buildPrescription({definition, state, today, mode, priorities}) {
    const Model = root.GarageFitCoachModel, template = definition.sessionTemplate;
    const duration = today.duration || template.duration;
    const difficulty = today.easyToday ? 'easy' : today.difficulty || template.difficulty;
    const first = priorities.families[0];
    const plan = {candidates: priorities.families.map((family, index) => ({workoutFamilyId: family.workoutFamilyId,
      workoutFamilyVersion: family.workoutFamilyVersion, rationale: rationaleFor(family, index, priorities, first)}))};
    // An optional comparable benchmark rides in the intended family's session; it never changes the family.
    const offered = priorities.benchmark && priorities.benchmark.status === 'offered';
    if (offered) plan.benchmark = benchmarkSpec(definition, first);
    for (const field of ['excludedImpact','bodyPositions','movementRoom']) if (today[field] !== undefined && today[field] !== null) plan[field] = clone(today[field]);
    return Model.createSessionPrescription({prescriptionId: today.prescriptionId, programmeInstanceId: state.programmeInstanceId,
      // The role is the programme, never the planned family: identity comes from the delivered workout.
      sessionRole: 'general-fitness', duration, difficulty, bodyFocus: today.bodyFocus || template.bodyFocus,
      equipment: clone(today.equipment || []), workoutFamilyPlan: plan,
      programmeContext: {objective: definition.objective, frequency: clone(mode.frequency),
        intendedWorkoutFamilyId: first.workoutFamilyId, intendedWorkoutFamilyVersion: first.workoutFamilyVersion,
        recovery: clone(priorities.recovery),
        ...(offered ? {benchmark: {status: 'offered', optional: true, benchmarkIds: definition.benchmarkPolicy.benchmarks.map(item => item.benchmarkId)}} : {}),
        overrides: [...(today.easyToday ? [{type: 'easy-today'}] : []), ...(today.bodyFocus ? [{type: 'body-focus', value: today.bodyFocus}] : []),
          ...(today.duration && today.duration < template.duration ? [{type: 'duration', value: today.duration}] : [])]}});
  }

  function interpretDose(input) { return root.GarageFitCoachPolicies.generalStrengthPolicy.interpretDose(input); }
  function respondToMissedSessions({definition, state, history, today, mode}) {
    const sessions = history.sessionsForProgramme(state.programmeInstanceId, {until: today.now}).slice().reverse()
      .filter(session => interpretDose({definition, evidence: history.sessionEvidence(session.sessionResultId)}).meaningful);
    const at = sessions.length ? sessions[0].endedAt || sessions[0].startedAt : state.startedAt;
    const elapsedDays = at ? Math.max(0, (Date.parse(today.now) - Date.parse(at)) / DAY) : null;
    return {missed: elapsedDays !== null && elapsedDays > 7 / mode.frequency.minSessionsPerWeek, elapsedDays, catchUpSessions: 0, strategy: 'recompute-no-debt'};
  }

  // ---- Progress evidence (#192): three separate, factual views; there is no combined score ----
  // Capability balance: which training effects were actually performed in the rolling window, across
  // every GarageFit source. Coverage of training, never a measure of fitness or adequacy.
  function balanceSummary({definition, history, catalogue, now}) {
    const sessions = performedSessions({definition, history, catalogue, today: {now}});
    const measured = sessions.filter(item => item.weight > 0);
    return {windowDays: definition.coverageTargets.windowDays, sessionCount: measured.length,
      unmeasuredSessions: sessions.length - measured.length,
      effects: EFFECTS.map(effect => {
        const credited = measured.reduce((sum, item) => sum + item.weight * (item.effects[effect] || 0), 0);
        return {effect, label: EFFECT_LABELS[effect], performedSessions: Math.round(credited * 10) / 10,
          sessionCount: measured.filter(item => (item.effects[effect] || 0) > 0).length, status: credited > 0 ? 'performed' : 'not-performed'};
      })};
  }

  // Demonstrated comparable improvement. Only a completed, single-set rep observation of the exact
  // benchmark exercise with a recorded rep count and an explicitly confirmed setup can support a claim,
  // and only against an earlier observation the shared Training History judges comparable (same exercise,
  // side, setup, prescription mode, protocol and protocol conditions). Everything else stays unknown.
  function benchmarkImprovement({definition, history, state}) {
    const History = root.GarageFitTrainingHistory, catalogue = root.GarageFitData.exercises;
    const known = value => value !== null && value !== undefined;
    return definition.benchmarkPolicy.benchmarks.map(spec => {
      const requirementId = BENCHMARK_PREFIX + spec.benchmarkId;
      const all = history.performances.filter(item => item.programmeInstanceId === state.programmeInstanceId
        && item.requirementId === requirementId && item.section === 'main');
      const usable = all.filter(item => item.status === 'completed' && item.exerciseId === spec.exerciseId && item.sets.length === 1
        && known(item.sets[0].reps.value) && item.sets[0].load.value === null && item.sets[0].resistanceSetup);
      const point = item => ({sessionResultId: item.sessionResultId, occurredAt: item.occurredAt, reps: item.sets[0].reps.value});
      const base = {benchmarkId: spec.benchmarkId, exerciseId: spec.exerciseId, label: catalogue[spec.exerciseId].name, capability: spec.capability,
        recorded: all.length, unusable: all.length - usable.length};
      if (!all.length) return {...base, status: 'none', latest: null, previous: null, delta: null, incomparable: 0};
      if (!usable.length) return {...base, status: 'unmeasured', latest: null, previous: null, delta: null, incomparable: 0};
      const latest = usable[usable.length - 1], earlier = usable.slice(0, -1);
      const comparisons = earlier.map(item => ({item, result: History.comparePerformanceEvidence(item, latest)}));
      const match = comparisons.slice().reverse().find(entry => entry.result.comparable && ['improved-reps', 'unchanged-or-insufficient'].includes(entry.result.change));
      const incomparable = comparisons.filter(entry => !entry.result.comparable).length;
      if (!match) return {...base, status: earlier.length ? 'not-comparable' : 'baseline', latest: point(latest), previous: null, delta: null, incomparable};
      const delta = latest.sets[0].reps.value - match.item.sets[0].reps.value;
      return {...base, status: delta > 0 ? 'improved' : delta === 0 ? 'same' : 'lower', latest: point(latest), previous: point(match.item), delta, incomparable};
    });
  }

  const policy = Object.freeze({validateDefinition, assessFeasibility, initialiseState, getModeSettings, calculatePriorities,
    buildPrescription, interpretDose, respondToMissedSessions, isComplete: () => false,
    BENCHMARK_PREFIX, benchmarkOffer, benchmarkSpec, balanceSummary, benchmarkImprovement});
  root.GarageFitCoachGeneralFitnessPolicy = policy;
})(typeof window !== 'undefined' ? window : globalThis);
