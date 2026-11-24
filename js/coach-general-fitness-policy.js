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
  // Published sets are versioned independently of later registry additions.
  const ORIGINAL_FAMILY_IDS = Object.freeze(['strength-control','cardio-conditioning','athletic-movement','core-stability',
    'mobility-movement-quality','full-body-challenges']);
  const RESISTANCE_FAMILIES = ['strength-control','resistance-endurance'];
  const V3_FAMILY_IDS = Object.freeze([...ORIGINAL_FAMILY_IDS,'resistance-endurance']);
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
    // Version-aware exact family set (#399): each released definition uses exactly the canonical
    // families published when it was released, so adding a family never invalidates it.
    const expected = definition.version === 3 ? V3_FAMILY_IDS : ORIGINAL_FAMILY_IDS;
    const resistance = definition.resistanceDayPolicy;
    if (definition.version === 3) {
      if (!resistance || resistance.windowDays !== 7 || resistance.targetDays !== 2 || resistance.unitsPerDay !== 4)
        fail('v3 needs the published resistance-day policy');
    } else if (resistance !== undefined) fail('resistance-day planning belongs to v3');
    if (ids.size !== expected.length || expected.some(id => !ids.has(id))) fail('it uses every canonical workout family');
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

  // GF-AM6-CAL1: v6 can contain energetic work, but neither its name/style nor the
  // catalogue's broad conditioning flag establishes delivered demand. Use bounded
  // timed Main work only; the same calculation serves the transient generated preview
  // and saved performed evidence. See docs/athletic-v6-calibration.md.
  const athleticV6 = item => item.workoutFamilyId === 'athletic-movement' && item.workoutFamilyVersion === 6;
  function athleticConditioning(exerciseId, catalogue) {
    return (catalogue[exerciseId] && catalogue[exerciseId].cardio >= 3)
      && !!root.GarageFitWorkoutFamilies.getMembership({workoutFamilyId: 'athletic-movement', workoutFamilyVersion: 6, role: 'conditioning'}, exerciseId);
  }
  function timedSeconds(prescription) {
    return prescription && (prescription.timed === true || ['timed','unilateral-timed'].includes(prescription.type))
      && positive(prescription.seconds) ? prescription.seconds : 0;
  }
  function athleticWorkload(plannedMainSeconds, performedMainSeconds, conditioningSeconds) {
    const share = performedMainSeconds > 0 ? conditioningSeconds / performedMainSeconds : 0;
    // A minute and one fifth of the resolved Main work establish a conditioning
    // contribution. Three minutes and 30% establish the conservative recovery flag.
    const conditioning = conditioningSeconds >= 60 && share >= 0.2;
    // Athletic remains the primary effect even for an energetic v6 composition.
    const conditioningEffect = conditioning ? Math.min(1 / 3, share) : 0;
    return {plannedMainSeconds, performedMainSeconds, conditioningSeconds, conditioningShare: share,
      weight: plannedMainSeconds > 0 ? Math.min(1, performedMainSeconds / plannedMainSeconds) : 0,
      effects: {athletic: 1 - conditioningEffect, ...(conditioning ? {conditioning: conditioningEffect} : {})},
      demanding: conditioningSeconds >= 180 && share >= 0.3};
  }
  function assessAthleticV6Workload({workout, catalogue = root.GarageFitData.exercises}) {
    if (!athleticV6(workout)) return null;
    const G = root.GarageFitGenerator;
    let main = 0, conditioning = 0;
    for (const block of workout.main.blocks) {
      if (G.blockTrainingSection(block) !== 'main') continue;
      for (const step of G.resolveBlockSteps(block)) {
        if (step.kind !== 'exercise') continue;
        const exercise = block.exercises[step.exerciseIndex];
        const seconds = step.timed && positive(step.seconds) ? step.seconds * G.sideCount(exercise) : 0;
        main += seconds;
        if (athleticConditioning(exercise.id, catalogue)) conditioning += seconds;
      }
    }
    return athleticWorkload(main, main, conditioning);
  }
  function performedAthleticV6(result, performances, catalogue) {
    const planned = (result.plannedWork || []).filter(item => item.section === 'main');
    const plannedById = new Map(planned.map(item => [item.occurrenceId, item]));
    const plannedSeconds = planned.reduce((sum, item) => sum + timedSeconds(item.prescription), 0);
    let performed = 0, conditioning = 0;
    for (const item of performances) {
      const work = plannedById.get(item.occurrenceId);
      if (!work || !['completed','partial'].includes(item.status) || !(item.exposure.value > 0)) continue;
      const target = timedSeconds(work.prescription);
      const measured = item.sets.map(set => set.seconds.value).filter(value => Number.isFinite(value));
      const seconds = measured.length ? Math.min(target, measured.reduce((sum, value) => sum + value, 0))
        : target * Math.min(1, item.exposure.value);
      performed += seconds;
      // The performed exercise owns semantics after a substitution. Historical plans
      // retain no family role: conditioning membership plus cardio >= 3 is the bounded
      // energetic criterion even when the movement also has a technical role.
      if (athleticConditioning(item.exerciseId, catalogue)) conditioning += seconds;
    }
    return athleticWorkload(plannedSeconds, performed, conditioning);
  }

  // GF400-CAL1. These roles interpret saved work for scheduling only. Family
  // composers (including Metcon) retain their own versioned construction gates.
  const MAJOR_PATTERNS = ['squat','hinge','lunge','push','pull','carry'];
  const RESISTANCE_SET_PROTOCOLS = ['paired_sets','complex','ladder','pyramid'];
  const BALLISTIC_FAMILIES = ['clean','clean-and-press','snatch','kettlebell-swing'];
  const SUPPORT_PATTERNS = ['trunk','rotation','anti-rotation','anti-extension','anti-lateral-flexion','elbow-flexion','elbow-extension'];
  const MIN_REPS = 5, MIN_SECONDS = 20;
  const EPSILON = 1e-9;
  const targetFor = rx => rx && (rx.timed === true || ['timed','unilateral-timed'].includes(rx.type) ? rx.seconds : rx.reps);
  const isTimed = rx => rx.timed === true || ['timed','unilateral-timed'].includes(rx.type);
  const substantive = rx => positive(targetFor(rx)) && targetFor(rx) >= (isTimed(rx) ? MIN_SECONDS : MIN_REPS);

  function resistanceRole(exercise, rx) {
    if (!exercise || exercise.conditioning || exercise.impact === 'high' || exercise.strength < exercise.cardio) return null;
    const isolation = !!exercise.directElbowAction || /(?:^|-)chest-fly$/.test(exercise.id);
    const supporting = isolation || exercise.mainRole === 'supporting';
    const major = !supporting && exercise.patterns.some(pattern => MAJOR_PATTERNS.includes(pattern));
    if (major && (exercise.strength >= 3 || exercise.id === 'wall-push-up')) {
      if (isTimed(rx) && !exercise.prescription.type.includes('timed') && exercise.strength === exercise.cardio) return null;
      if (BALLISTIC_FAMILIES.includes(exercise.family) && !['paired_sets','complex'].includes(rx.protocol)) return null;
      return 'major';
    }
    if (exercise.strength >= 2 && (supporting || exercise.bodyFocus === 'core'
      || exercise.patterns.some(pattern => SUPPORT_PATTERNS.includes(pattern)))) return 'support';
    return null;
  }

  const knownSide = side => side === 'left' || side === 'right';
  function blockRoles(plan, performed, catalogue) {
    const performedIds = new Map(performed.map(item => [item.occurrenceId,item.exerciseId]));
    const aliases = root.GarageFitData.canonicalExerciseId;
    const blocks = new Map();
    for (const entry of plan) {
      if (entry.section !== 'main' || entry.blockIndex == null) continue;
      const totals = blocks.get(entry.blockIndex) || {active: 0, major: 0, unknown: false};
      blocks.set(entry.blockIndex, totals);
      const rx = entry.prescription;
      const id = performedIds.has(entry.occurrenceId) ? performedIds.get(entry.occurrenceId) : entry.exerciseId;
      const exercise = catalogue[aliases ? aliases(id) : id];
      const target = targetFor(rx);
      if (!exercise || !positive(target)) { totals.unknown = true; continue; }
      const sides = exercise.sidedness === 'per-side' ? 2 : 1;
      const seconds = isTimed(rx) ? target : exercise.estimatedSeconds * target / exercise.prescription.value / sides;
      if (!positive(seconds)) { totals.unknown = true; continue; }
      totals.active += seconds;
      if (substantive(rx) && resistanceRole(exercise, rx) === 'major') totals.major += seconds;
    }
    return blocks;
  }

  function performedRole(result, exercise, rx, block, benchmark) {
    const role = resistanceRole(exercise, rx);
    if (role !== 'major' || exercise.strength !== exercise.cardio || benchmark) return role;
    // #402 establishes the station role for these ambiguous movements. The
    // family id by itself cannot add or remove credit for an unambiguous lift.
    if (result.workoutFamilyId === 'cardio-conditioning' && result.workoutFamilyVersion === 2
      && ['rounds','timed_intervals'].includes(rx.protocol)) return null;
    if (RESISTANCE_SET_PROTOCOLS.includes(rx.protocol)) return 'major';
    if (!block || block.unknown) return 'unknown';
    return positive(block.active) && block.major + EPSILON >= block.active / 2 ? 'major' : null;
  }

  function trainingDate(timestamp) {
    const date = new Date(timestamp);
    return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  }
  const add = (totals, key, value) => { totals[key] = (totals[key] || 0) + value; };
  function performedResistance(result, performances, catalogue) {
    const plan = result.plannedWork || [];
    const byId = new Map(plan.map(item => [item.occurrenceId,item]));
    const blocks = blockRoles(plan, performances, catalogue);
    const dose = {major: 0, support: 0, patterns: {}, regions: {}, movements: {}, unknown: false};
    const work = {effects: {}, observed: 0, performed: 0, planned: plan.filter(item => item.section === 'main').length,
      incompleteEffects: false};
    for (const item of performances) {
      if (item.exposure.value === 0 || (item.section != null && item.section !== 'main')) continue;
      const planned = byId.get(item.occurrenceId), rx = planned?.prescription;
      const exercise = catalogue[item.exerciseId];
      if (item.section !== 'main' || !exercise || !positive(targetFor(rx)) || item.exposure.value === null
        || (!knownSide(item.side) && (exercise.sidedness === 'per-side' || rx.type?.startsWith('unilateral-')))) {
        dose.unknown = true;
        work.incompleteEffects = true;
        continue;
      }
      const benchmark = item.requirementId?.startsWith(BENCHMARK_PREFIX);
      if (benchmark && !item.sets.some(set => positive(set.reps.value))) {
        dose.unknown = true;
        work.incompleteEffects = true;
        continue;
      }
      const fraction = item.exposure.value * (knownSide(item.side) ? 0.5 : 1);
      const role = performedRole(result, exercise, rx, blocks.get(planned.blockIndex), benchmark);
      // Extra AMRAP rounds repeat the observed stations. Their dose is unknown,
      // while confirmed occurrences still establish the recorded training effects.
      if (rx.protocol === 'amrap' || role === 'unknown') dose.unknown = true;
      if (role === 'unknown') work.incompleteEffects = true;
      work.observed += fraction;
      work.performed += item.exposure.value;
      const effect = performedEffect(result, exercise, role);
      if (effect) add(work.effects, effect, fraction);
      if (!substantive(rx) || (benchmark && item.sets.reduce((sum, set) => sum + (set.reps.value || 0), 0) < MIN_REPS)
        || (role !== 'major' && role !== 'support')) continue;
      dose[role] += fraction * (role === 'support' ? 0.5 : 1);
      if (exercise.bodyFocus) add(dose.regions, exercise.bodyFocus, fraction);
      for (const pattern of exercise.patterns) {
        if (role === 'major' ? MAJOR_PATTERNS.includes(pattern) : pattern === 'core' || SUPPORT_PATTERNS.includes(pattern))
          add(dose.patterns, pattern, fraction);
      }
      // Regional scheduling counts a compound once per area. Isolation never
      // supplies upper push/pull coverage. Trunk stabilisation retains its own credit.
      if (role === 'major') {
        for (const direction of ['push','pull']) if (exercise.patterns.includes(direction)) add(dose.movements, direction, fraction);
        if (exercise.bodyFocus === 'lower' || exercise.patterns.some(pattern => ['squat','hinge','lunge'].includes(pattern)))
          add(dose.movements, 'lower', fraction);
      }
      if (exercise.bodyFocus === 'core' || exercise.patterns.includes('core')) add(dose.movements, 'core', fraction);
    }
    return {dose, work};
  }

  function performedEffect(result, exercise, role) {
    if (result.workoutFamilyId === 'mobility-movement-quality') return 'mobility';
    if (result.workoutFamilyId === 'athletic-movement') return 'athletic';
    if (role === 'major') return 'strength';
    if (exercise.conditioning || exercise.cardio > exercise.strength
      || result.workoutFamilyId === 'cardio-conditioning' && role !== 'support') return 'conditioning';
    if (exercise.bodyFocus === 'core') return 'core';
    if (role === 'support') return 'strength';
    return result.workoutFamilyId === 'full-body-challenges' ? 'challenge' : null;
  }

  function performedBalanceV3(result, performances, catalogue, family) {
    const {dose, work} = performedResistance(result, performances, catalogue);
    const total = Object.values(work.effects).reduce((sum, amount) => sum + amount, 0);
    let weight = work.planned ? Math.min(1, work.performed / work.planned) : 0;
    let effects = {};
    // A meaningful completion carries its published family demand. For
    // incomplete work, the observed mix also needs to represent enough of the
    // planned Main for a tiny fragment to carry no automatic recovery flag.
    const completed = result.finalStatus === 'completed';
    const confirmedMain = completed && performances.some(item => item.section === 'main'
      && item.status === 'completed' && item.semanticConfidence !== 'unknown' && positive(item.exposure.value));
    const sufficientWork = confirmedMain || weight + EPSILON >= 0.5;
    const demandingWork = dose.major + (work.effects.conditioning || 0);
    const contextualDemand = demandingWork > 0 && demandingWork + EPSILON >= work.observed / 2;
    let demanding = sufficientWork && (completed && family ? family.demanding
      : family?.demanding !== false && contextualDemand);
    let basis = 'performed-main';
    if (total) {
      const challengeShare = result.workoutFamilyId === 'full-body-challenges' ? 0.5 : 0;
      effects = Object.fromEntries(Object.entries(work.effects).map(([key, amount]) => [key, (1 - challengeShare) * amount / total]));
      if (challengeShare) add(effects, 'challenge', challengeShare);
    }
    if (athleticV6(result)) {
      const athletic = performedAthleticV6(result, performances, catalogue);
      weight = athletic.weight; effects = athletic.effects; demanding = athletic.demanding;
      basis = 'athletic-v6-performed-main';
    }
    return {dose, weight, effects, basis, incompleteEffects: work.incompleteEffects,
      demanding: demanding || result.feedback?.effort === 'hard' || ['hard','too-hard'].includes(result.feedback?.difficulty)};
  }

  function resistanceDays({sessions, policy, today, incomplete}) {
    const todayNumber = dayNumber(today.localDate || trainingDate(today.now));
    const dates = new Map(), patterns = {}, regions = {}, movements = {};
    for (const {occurredAt, dose} of sessions) {
      const localDate = trainingDate(occurredAt);
      const age = todayNumber - dayNumber(localDate);
      for (const key of Object.keys(dose.patterns)) add(patterns, key, dose.patterns[key]);
      for (const key of Object.keys(dose.regions)) add(regions, key, dose.regions[key]);
      for (const key of Object.keys(dose.movements)) add(movements, key, dose.movements[key]);
      if (age < 0 || age >= policy.windowDays) continue;
      const date = dates.get(localDate) || {localDate, major: 0, support: 0, unknown: false};
      date.major += dose.major; date.support += dose.support; date.unknown ||= dose.unknown;
      dates.set(localDate, date);
    }
    const days = [...dates.values()].map(date => {
      const units = date.major + Math.min(date.major, date.support);
      return {...date, units, qualifies: units + EPSILON >= policy.unitsPerDay};
    });
    return {days, qualifyingDays: days.filter(day => day.qualifies).length,
      qualifiesToday: days.some(day => day.qualifies && dayNumber(day.localDate) === todayNumber),
      incomplete: incomplete || days.some(day => day.unknown), patterns, regions, movements};
  }

  // Performed sessions in the rolling window, across Coach instances, standalone Generator
  // and fixed workouts. Each carries a performed fraction and effect shares; nothing here
  // is a programme credit (the engine alone credits this instance's own Coach results).
  function performedSessions({definition, history, catalogue, today}) {
    const now = Date.parse(today.now), families = definition.familyBalancePolicy.families;
    const limit = root.GarageFitTrainingHistory.MAX_RECENT_SESSION_LIMIT;
    const since = new Date(now - definition.coverageTargets.windowDays * DAY).toISOString();
    const results = new Map(history.sessions.map(item => [item.sessionResultId, item]));
    if (definition.resistanceDayPolicy) {
      const performances = new Map();
      for (const item of history.performances) {
        const session = performances.get(item.sessionResultId) || [];
        session.push(item);
        performances.set(item.sessionResultId, session);
      }
      const candidates = history.sessions.slice().reverse().filter(result => SOURCES.includes(result.source)
        && ['completed','partial'].includes(result.finalStatus) && performances.has(result.sessionResultId));
      const inWindow = candidates.filter(result => {
        const at = Date.parse(result.endedAt || result.startedAt);
        return at >= Date.parse(since) && at <= now;
      });
      return {incomplete: !!today.incompleteTrainingContext || inWindow.length > limit
          || candidates.some(result => !result.endedAt && !result.startedAt),
        sessions: inWindow.slice(0, limit).map(result => ({
          sessionResultId: result.sessionResultId, source: result.source, programmeInstanceId: result.programmeInstanceId,
          occurredAt: result.endedAt || result.startedAt, workoutFamilyId: result.workoutFamilyId, familyStyleId: result.familyStyleId,
          ...performedBalanceV3(result, performances.get(result.sessionResultId), catalogue,
            families.find(family => family.workoutFamilyId === result.workoutFamilyId))
        }))};
    }
    const summary = history.recentTrainingSummary({limit, since, until: today.now});
    const sessions = summary.sessions.filter(session => SOURCES.includes(session.source)).map(session => {
      const result = results.get(session.sessionResultId);
      const main = session.performances.filter(item => definition.doseTargets.sections.includes(item.section) || item.section === null);
      const planned = (result.plannedWork || []).filter(item => definition.doseTargets.sections.includes(item.section)).length;
      const performed = main.reduce((sum, item) => sum + (item.exposure.value || 0), 0);
      let weight = performed > 0 ? Math.min(1, planned ? performed / planned : 1) : 0;
      // Every published version of a family is that family for balance (e.g. Athletic v1 and v2, #244).
      const family = families.find(item => item.workoutFamilyId === session.workoutFamilyId) || null;
      let effects = {}, basis = 'family-identity';
      if (family) effects = clone(family.effects);
      else {
        basis = 'exercise-metadata';
        const counted = main.map(item => exerciseEffect(catalogue[item.exerciseId])).filter(Boolean);
        counted.forEach(effect => { effects[effect] = (effects[effect] || 0) + 1 / counted.length; });
      }
      let demanding = family ? family.demanding : (effects.strength || 0) + (effects.conditioning || 0) + (effects.challenge || 0) >= 0.5;
      if (athleticV6(session)) {
        const workload = performedAthleticV6(result, main, catalogue);
        effects = workload.effects; weight = workload.weight; demanding = workload.demanding;
        basis = 'athletic-v6-performed-main';
      }
      return {sessionResultId: session.sessionResultId, source: session.source, programmeInstanceId: session.programmeInstanceId,
        occurredAt: session.occurredAt, workoutFamilyId: session.workoutFamilyId, workoutFamilyVersion: session.workoutFamilyVersion,
        familyStyleId: session.familyStyleId, weight, effects, basis, demanding};
    });
    return {sessions};
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
    const now = Date.parse(today.now), {sessions, incomplete} = performedSessions(input);
    const resistance = definition.resistanceDayPolicy && resistanceDays({sessions, policy: definition.resistanceDayPolicy, today, incomplete});
    const incompleteBalance = resistance && (incomplete || sessions.some(item => item.incompleteEffects));
    // Attendance adapts emphasis to actual recent frequency; misses create no debt.
    const applied = resistance ? new Set([
      ...(state.currentTargets.reconciliation?.appliedSessionResultIds || []), state.lastAppliedSessionResultId,
      ...(state.recentSessionSummaries || []).filter(item => item.meaningful).map(item => item.sessionResultId)
    ]) : null;
    const attended = sessions.filter(item => item.weight > 0 && now - Date.parse(item.occurredAt) <= balance.attendanceWindowDays * DAY
      && (!applied || item.source === 'coach' && item.programmeInstanceId === state.programmeInstanceId && applied.has(item.sessionResultId))).length;
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
        need: targetShare * (performedTotal + 1) - credited,
        confidence: (resistance ? credited > 0 || !incompleteBalance && performedTotal > 0 : sessions.length > 0) ? 'derived' : 'unknown'};
    });
    const need = Object.fromEntries(effects.map(item => [item.effect, item.need]));
    // Recovery preference: transparent, conservative ordering only (never a rest order).
    const reasons = [];
    const withinRecovery = item => item.demanding && now - Date.parse(item.occurredAt) < recoveryPolicy.recentHours * HOUR;
    const latest = sessions.find(item => item.weight > 0);
    if (resistance ? sessions.some(withinRecovery) : latest && withinRecovery(latest)) reasons.push('recent-demanding-session');
    const reports = external && external.actual && external.actual.status === 'confirmed' ? external.actual.reports || [] : [];
    const day = dayNumber(localDateOf(today));
    if (reports.some(report => recoveryPolicy.reportedIntensities.includes(report.reportedIntensity)
      && day - dayNumber(report.localDate) >= 0 && day - dayNumber(report.localDate) <= recoveryPolicy.reportedDays)) reasons.push('reported-hard-activity');
    const recent = (resistance ? sessions.filter(item => item.weight > 0) : sessions).slice(0, variety.recentSessions);
    // A bounded preference to make room for a second day. It never adds debt,
    // overrides recovery, or asks for more resistance on an already qualifying date.
    const resistancePriority = resistance && !reasons.length && !today.easyToday && today.difficulty !== 'easy'
      && !resistance.qualifiesToday && resistance.qualifyingDays < definition.resistanceDayPolicy.targetDays;
    // Prefer a resistance option that can also address
    // a conditioning gap. Delivered style still follows the normal auto-selection.
    const conditioningGap = need.conditioning > need.strength;
    const families = balance.families.map((family, index) => {
      const value = Object.entries(family.effects).reduce((sum, [effect, share]) => sum + share * need[effect], 0);
      const consecutive = recent.findIndex(item => item.workoutFamilyId !== family.workoutFamilyId);
      const run = consecutive === -1 ? recent.length : consecutive;
      let varietyPenalty = 0;
      if (run > 0) varietyPenalty += family.repeatable && run < variety.maximumConsecutiveRepeatable ? variety.repeatableRepeatPenalty : variety.repeatPreviousPenalty;
      varietyPenalty += variety.recentRepeatPenalty * recent.filter(item => item.workoutFamilyId === family.workoutFamilyId).length;
      // Before composition the v6 style and delivered work are unknown. Conservatively
      // rank this possible energetic session with demanding candidates on recovery days;
      // subsequent recovery uses the actual performed calculation above.
      const potentiallyDemanding = family.demanding || athleticV6({...family, workoutFamilyVersion: compositionVersion(family)});
      const recoveryPenalty = reasons.length && potentiallyDemanding ? recoveryPolicy.demandingPenalty : 0;
      const last = sessions.find(item => item.workoutFamilyId === family.workoutFamilyId) || null;
      const resistanceBonus = resistancePriority && RESISTANCE_FAMILIES.includes(family.workoutFamilyId)
        ? variety.repeatPreviousPenalty * (conditioningGap && family.workoutFamilyId === 'resistance-endurance' ? 1.25 : 1)
        : 0;
      return {workoutFamilyId: family.workoutFamilyId, workoutFamilyVersion: compositionVersion(family), index,
        primaryEffect: Object.entries(family.effects).sort((a, b) => b[1] - a[1])[0][0],
        balanceScore: value, varietyPenalty, recoveryPenalty, ...(resistance ? {resistanceBonus} : {}),
        score: value - varietyPenalty - recoveryPenalty + resistanceBonus,
        lastPerformedAt: last ? last.occurredAt : null, lastFamilyStyleId: last ? last.familyStyleId : null};
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    const recovery = {preferLowerDemand: reasons.length > 0, reasons};
    return {effects, families,
      attendance: {sessionsPerWeek, level, windowDays: balance.attendanceWindowDays, recommended: clone(definition.recommendedFrequency)},
      recovery,
      ...(resistance ? {resistance: {...resistance, targetDays: definition.resistanceDayPolicy.targetDays,
        windowDays: definition.resistanceDayPolicy.windowDays}} : {}),
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
  function primaryFamilyReason(family, priorities) {
    if (family.resistanceBonus) return 'resistance';
    const top = priorities.effects.slice().sort((a, b) => b.need - a.need)[0];
    return top.effect === family.primaryEffect ? 'balance' : 'variety';
  }
  function rationaleFor(family, index, priorities, first) {
    const name = familyName(family.workoutFamilyId, family.workoutFamilyVersion), label = EFFECT_LABELS[family.primaryEffect];
    const parts = [];
    if (index === 0) {
      const reason = primaryFamilyReason(family, priorities);
      if (reason === 'resistance') parts.push(name+' prioritises resistance work in your training plan.');
      else parts.push(reason === 'balance'
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
    if (priorities.resistance && !priorities.recovery.preferLowerDemand && !today.bodyFocus) {
      const {movements, patterns} = priorities.resistance;
      const coverage = ['push','pull','lower','core'].map(area => ({area, amount: movements[area] || 0})).sort((a,b) => a.amount - b.amount);
      if (coverage[0].amount < coverage.at(-1).amount) {
        const least = coverage[0].area;
        plan.resistanceFocus = least === 'lower'
          ? ['squat','hinge','lunge'].sort((a,b) => (patterns[a] || 0) - (patterns[b] || 0))[0] : least;
      }
    }
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
  function balanceSummary({definition, history, catalogue, now, incompleteContext}) {
    const {sessions, incomplete} = performedSessions({definition, history, catalogue, today: {now, incompleteTrainingContext: incompleteContext}});
    const incompleteEvidence = !!definition.resistanceDayPolicy && (incomplete || sessions.some(item => item.incompleteEffects));
    const measured = sessions.filter(item => item.weight > 0);
    return {windowDays: definition.coverageTargets.windowDays, sessionCount: measured.length,
      unmeasuredSessions: sessions.length - measured.length,
      ...(incompleteEvidence ? {incompleteEvidence} : {}),
      effects: EFFECTS.map(effect => {
        const credited = measured.reduce((sum, item) => sum + item.weight * (item.effects[effect] || 0), 0);
        return {effect, label: EFFECT_LABELS[effect], performedSessions: Math.round(credited * 10) / 10,
          sessionCount: measured.filter(item => (item.effects[effect] || 0) > 0).length, status: credited > 0 ? 'performed' : incompleteEvidence ? 'unknown' : 'not-performed'};
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
    BENCHMARK_PREFIX, benchmarkOffer, benchmarkSpec, primaryFamilyReason, balanceSummary, benchmarkImprovement, assessAthleticV6Workload});
  root.GarageFitCoachGeneralFitnessPolicy = policy;
})(typeof window !== 'undefined' ? window : globalThis);
