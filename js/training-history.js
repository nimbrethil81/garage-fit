(function (root) {
  // Immutable evidence views. The catalogue owns intrinsic semantics; a plan supplies
  // comparison context only, never actual reps, seconds or load. No storage or clock.
  const clone = value => JSON.parse(JSON.stringify(value));
  const known = value => value !== null && value !== undefined;
  const positive = value => Number.isFinite(value) && value > 0;
  const when = result => result.endedAt || result.startedAt || null;
  const measure = value => ({value: known(value) ? value : null, confidence: known(value) ? 'confirmed' : 'unknown'});
  const RECENT_SESSION_LIMIT = 12, MAX_RECENT_SESSION_LIMIT = 64;
  function recentLimit(limit = RECENT_SESSION_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECENT_SESSION_LIMIT)
      throw new Error('Recent training evidence limit must be an integer from 1 to '+MAX_RECENT_SESSION_LIMIT+'.');
    return limit;
  }
  // Protocol conditions that must match for two performances to be comparable. An unlisted
  // protocol is never comparable. Kept in step with GarageFitGenerator.PROTOCOL_SHAPES by tests.
  const protocolFields = Object.freeze({
    rounds: Object.freeze(['exerciseRestSeconds','roundRestSeconds']),
    paired_sets: Object.freeze(['betweenExercisesSeconds','betweenSetsSeconds']),
    timed_intervals: Object.freeze(['workSeconds','transitionSeconds']),
    emom: Object.freeze(['slotSeconds','targets']),
    ladder: Object.freeze(['exerciseRestSeconds','stepRestSeconds']),
    pyramid: Object.freeze(['stepRestSeconds']),
    complex: Object.freeze(['targets','changeoverSeconds','sequenceRestSeconds']),
    density: Object.freeze(['targets','timeCapSeconds','exerciseRestSeconds','roundRestSeconds'])
  });

  function exposureFor(outcome, prescription) {
    const sets = outcome.sets || [];
    // An explicit zero measurement contradicts completion; it is not performed dose.
    const measured = sets.flatMap(set => [set.reps, set.seconds]).filter(known);
    if (measured.length && !measured.some(positive)) return {value: 0, confidence: 'confirmed'};
    if (outcome.status === 'completed') return {value: 1, confidence: 'derived'};
    const mode = prescription && (prescription.timed === true ? 'time' : prescription.type);
    const timed = mode === 'time' || mode === 'timed' || mode === 'unilateral-timed';
    const field = timed ? 'seconds' : 'reps';
    const repeats = prescription && Number.isInteger(prescription.sets) && prescription.sets > 0 ? prescription.sets : 1;
    const target = prescription && prescription[field] * repeats;
    const actual = sets.map(set => set[field]).filter(known);
    if (positive(target) && actual.length) return {value: Math.min(1, actual.reduce((sum, value) => sum + value, 0) / target), confidence: 'derived'};
    // A note-only partial outcome tells us some work happened, but not how much.
    return {value: null, confidence: 'unknown'};
  }

  function performanceFor(result, outcome, planned, catalogue) {
    const canonicalExerciseId = root.GarageFitData && root.GarageFitData.canonicalExerciseId;
    const exerciseId = outcome.exerciseId && canonicalExerciseId ? canonicalExerciseId(outcome.exerciseId) : outcome.exerciseId;
    const exercise = catalogue[exerciseId] || catalogue[outcome.exerciseId];
    const prescription = planned && planned.prescription;
    const mode = prescription && (prescription.timed === true ? 'time'
      : ['reps','unilateral-reps'].includes(prescription.type) ? 'reps'
      : ['timed','unilateral-timed'].includes(prescription.type) ? 'time' : null);
    return {
      sessionResultId: result.sessionResultId, source: result.source, programmeInstanceId: result.programmeInstanceId || null,
      workoutFamilyId: result.workoutFamilyId || null, workoutFamilyVersion: result.workoutFamilyVersion || null,
      familyStyleId: result.familyStyleId || null,
      occurredAt: when(result), occurrenceId: outcome.occurrenceId,
      exerciseId: exerciseId || null, requirementId: planned && planned.requirementId || null,
      section: planned && planned.section || null, status: outcome.status,
      exposure: exposureFor(outcome, prescription),
      patterns: exercise ? (exercise.patterns || []).filter(pattern => root.GarageFitCoachModel.MOVEMENT_PATTERNS.includes(pattern)) : [],
      bodyRegion: exercise && exercise.bodyFocus || null,
      directElbowAction: exercise && exercise.directElbowAction || null,
      semanticConfidence: exercise ? 'derived' : 'unknown',
      prescriptionMode: mode || null, protocol: prescription && prescription.protocol || null,
      variableTarget: !!(prescription && prescription.variableTarget),
      plannedPrescription: prescription && prescription.plannedPrescription ? clone(prescription.plannedPrescription) : null,
      plannedLoad: prescription && prescription.plannedLoad ? clone(prescription.plannedLoad) : null,
      // Absent side/conditions are unknown, rather than silently bilateral or compatible.
      side: prescription && Object.prototype.hasOwnProperty.call(prescription, 'side') ? prescription.side : 'unknown',
      protocolConditions: prescription && prescription.protocolConditions ? {...clone(prescription.protocolConditions),
        ...(mode === 'time' ? {workSeconds: prescription.seconds ?? null} : {})} : null,
      sets: (outcome.sets || []).map(set => ({
        reps: measure(set.reps), seconds: measure(set.seconds), load: measure(set.load),
        loadUnit: known(set.load) ? set.loadUnit || null : null,
        loadInterpretation: known(set.load) ? set.loadInterpretation || null : null,
        resistanceSetup: set.resistanceSetup || null
      }))
    };
  }

  function comparePerformances(previous, current) {
    const Model = root.GarageFitCoachModel;
    const reasons = [];
    if (!previous || !current) return {comparable: false, reasons: ['missing-performance']};
    if (!previous.exerciseId || previous.exerciseId !== current.exerciseId) reasons.push('different-exercise');
    if (!previous.prescriptionMode || previous.prescriptionMode !== current.prescriptionMode) reasons.push('prescription-mode');
    if (!previous.protocol || previous.protocol !== current.protocol) reasons.push('protocol');
    // Variable doses change preceding fatigue/recovery too. Until a format establishes
    // comparison conditions, even matching individual targets do not establish a series.
    if (previous.variableTarget || current.variableTarget) reasons.push('occurrence-target-conditions');
    if (previous.side === 'unknown' || current.side === 'unknown' || previous.side !== current.side) reasons.push('side');
    // Recovery overrides are additive JSON conditions; malformed/unsupported saved values
    // cannot establish comparable evidence. Older records have no such field.
    const recoveryKnown=item=>{
      const values=item.protocolConditions&&item.protocolConditions.occurrenceRecoverySeconds;
      return values===undefined||['rounds','paired_sets','timed_intervals'].includes(item.protocol)
        &&Array.isArray(values)&&values.length<256
        &&Array.from(values).every(value=>value===null||Number.isFinite(value)&&value>=0&&value<=300);
    };
    if(![previous,current].every(recoveryKnown))reasons.push('unknown-recovery-conditions');
    const fields = Object.prototype.hasOwnProperty.call(protocolFields, current.protocol) ? protocolFields[current.protocol] : null;
    // Minute windows and changing rep steps do not establish comparable pacing or
    // fatigue/recovery for straight-set progression, even in old records without a flag.
    if (['emom','ladder','pyramid','complex','density'].includes(current.protocol) || !fields || !previous.protocolConditions || !current.protocolConditions
      || [previous, current].some(item => fields.some(field => !Number.isFinite(item.protocolConditions[field]) || item.protocolConditions[field] < 0))) reasons.push('unknown-protocol-conditions');
    else if (!Model.sameRecord(previous.protocolConditions, current.protocolConditions)) reasons.push('protocol-conditions');
    return {comparable: reasons.length === 0, reasons};
  }

  // Compare actual measures only. Unknown load does not even establish "same load".
  // A multi-set occurrence must have the same set count and evidence for every set.
  function comparePerformanceEvidence(previous, current) {
    const comparison = comparePerformances(previous, current);
    if (!comparison.comparable) return {...comparison, change: 'incomparable'};
    const before = previous.sets, after = current.sets;
    if (!before.length || before.length !== after.length) return {...comparison, change: 'insufficient-evidence'};
    const field = current.prescriptionMode === 'time' ? 'seconds' : 'reps';
    // An explicitly confirmed nonnumeric setup can establish same resistance,
    // never a quantified load increase or equivalence to a different exercise.
    const setupConfirmed = before.concat(after).every(set => set.resistanceSetup && !known(set.load.value));
    if (setupConfirmed) {
      if (before.some((set,i) => set.resistanceSetup !== after[i].resistanceSetup)) return {...comparison, comparable: false,
        reasons: ['resistance-setup'], change: 'new-resistance-baseline'};
      if (before.concat(after).some(set => !known(set[field].value))) return {...comparison, change: 'insufficient-evidence'};
      const deltas = after.map((set,i) => set[field].value-before[i][field].value);
      return {...comparison, change: deltas.every(delta => delta >= 0) && deltas.some(delta => delta > 0)
        ? field === 'reps' ? 'improved-reps' : 'improved-time' : 'unchanged-or-insufficient',
        performanceDelta: Math.min(...deltas), loadDelta: null};
    }
    if (before.concat(after).some(set => !known(set.load.value) || !set.loadUnit || !set.loadInterpretation)) return {...comparison, change: 'unknown-load'};
    if (before.concat(after).some(set => !known(set[field].value))) return {...comparison, change: 'insufficient-evidence'};
    if (before.some((set, i) => set.loadUnit !== after[i].loadUnit || set.loadInterpretation !== after[i].loadInterpretation)) return {...comparison, comparable: false, reasons: ['load-unit-or-interpretation'], change: 'incomparable-load'};
    const performanceDeltas = after.map((set, i) => set[field].value - before[i][field].value);
    const loadDeltas = after.map((set, i) => set.load.value - before[i].load.value);
    const sameLoad = loadDeltas.every(delta => delta === 0);
    const improvedPerformance = performanceDeltas.every(delta => delta >= 0) && performanceDeltas.some(delta => delta > 0);
    const improvedLoad = loadDeltas.every(delta => delta >= 0) && loadDeltas.some(delta => delta > 0) && performanceDeltas.every(delta => delta >= 0);
    return {...comparison,
      change: sameLoad && improvedPerformance ? (field === 'reps' ? 'improved-reps' : 'improved-time') : improvedLoad ? 'improved-load' : 'unchanged-or-insufficient',
      performanceDelta: Math.min(...performanceDeltas), loadDelta: Math.min(...loadDeltas)
    };
  }

  function sumExposure(performances) {
    const unknown = performances.some(performance => performance.exposure.confidence === 'unknown');
    return {value: performances.reduce((sum, performance) => sum + (performance.exposure.value || 0), 0),
      confidence: unknown ? 'unknown' : performances.length ? 'derived' : 'unknown'};
  }

  function createHistory(results, catalogue) {
    const Model = root.GarageFitCoachModel;
    if (!Model) throw new Error('GarageFitCoachModel must be loaded before Training History.');
    if (!Array.isArray(results) || !catalogue || typeof catalogue !== 'object') throw new Error('History needs Session Results and a canonical catalogue.');
    const unique = new Map();
    results.forEach(result => {
      Model.assertValid('session-result', result);
      const existing = unique.get(result.sessionResultId);
      if (existing && !Model.sameRecord(existing, result)) throw new Model.CoachError('session-result-conflict', 'History contains conflicting immutable Session Results.', {sessionResultId: result.sessionResultId});
      unique.set(result.sessionResultId, clone(result));
    });
    const sessions = [...unique.values()].sort((a, b) => {
      const ta = when(a), tb = when(b);
      return (ta && tb ? Date.parse(ta) - Date.parse(tb) : ta ? -1 : tb ? 1 : 0) || a.sessionResultId.localeCompare(b.sessionResultId);
    });
    const performances = sessions.flatMap(result => {
      // Contextual activity is retained as a session, never translated into resistance dose.
      if (result.source === 'external' || result.finalStatus === 'skipped-before-start') return [];
      const planned = new Map((result.plannedWork || []).map(work => [work.occurrenceId, work]));
      return (result.performedWork || []).filter(outcome => ['completed','partial'].includes(outcome.status))
        .map(outcome => performanceFor(result, outcome, planned.get(outcome.occurrenceId), catalogue));
    });
    Model.deepFreeze(sessions); Model.deepFreeze(performances);
    // includeStandalone widens a programme filter to performed work recorded outside any
    // programme (e.g. completed standalone generated workouts). Such sessions keep their
    // source; they are context for a programme, never its sessions or anchor evidence.
    const inScope = (item, options) => !options.programmeInstanceId || item.programmeInstanceId === options.programmeInstanceId
      || options.includeStandalone === true && !item.programmeInstanceId;
    const filter = (items, options = {}, sessionItem = false) => items.filter(item => {
      const time = sessionItem ? when(item) : item.occurredAt;
      return inScope(item, options)
        && (!options.since || time && Date.parse(time) >= Date.parse(options.since))
        && (!options.until || time && Date.parse(time) <= Date.parse(options.until))
        && (sessionItem || !options.sections || options.sections.includes(item.section));
    });
    const recent = (items, options) => {
      const ordered = items.slice().reverse();
      return Number.isInteger(options.limit) ? ordered.slice(0, options.limit) : ordered;
    };
    return Object.freeze({
      sessions, performances,
      // Bounded context, newest first, across all sources/instances by default. Counts
      // describe recency, not a recommendation to prohibit controlled repetition.
      // Actual numeric measures remain on performances; exposure is only a labelled
      // completion/fraction estimate and must never be read as measured reps or load.
      recentTrainingSummary(options = {}) {
        const limit = recentLimit(options.limit);
        // Existing progress can still display factual unmeasured outcomes from an
        // interrupted, non-meaningful run. Such runs never enter variety/balance dose.
        const eligible = new Set(sessions.filter(item => ['completed','partial'].includes(item.finalStatus)).map(item => item.sessionResultId));
        const work = filter(performances, {...options, sections: options.sections || ['main',null]})
          .filter(item => eligible.has(item.sessionResultId) && (item.exposure.value > 0 || item.exposure.confidence === 'unknown'));
        const ids = new Set(work.map(item => item.sessionResultId));
        const selected = recent(filter(sessions, options, true).filter(item => when(item) && ids.has(item.sessionResultId)), {limit});
        const evidence = selected.map((session, recency) => ({
          sessionResultId: session.sessionResultId, source: session.source,
          programmeInstanceId: session.programmeInstanceId || null, occurredAt: when(session), recency,
          workoutFamilyId: session.workoutFamilyId || null, workoutFamilyVersion: session.workoutFamilyVersion || null,
          familyStyleId: session.familyStyleId || null,
          // Self-reported effort is not inferred from family, difficulty, pacing or load.
          intensity: typeof session.feedback?.effort === 'string'
            ? {value: session.feedback.effort, confidence: 'reported'} : {value: null, confidence: 'unknown'},
          performances: work.filter(item => item.sessionResultId === session.sessionResultId)
        }));
        const dimensions = {families: [], styles: [], exercises: [], patterns: [], protocols: []};
        const add = (dimension, key, session, matching, identity = {}) => {
          if (!key) return;
          let entry = dimension.find(item => item.key === key);
          if (!entry) { entry = {key, ...identity, sessionCount: 0, lastOccurredAt: session.occurredAt,
            recency: session.recency, sessionResultIds: [], ...(matching ? {performances: []} : {})}; dimension.push(entry); }
          entry.sessionCount++; entry.sessionResultIds.push(session.sessionResultId);
          if (matching) entry.performances.push(...matching);
        };
        evidence.forEach(session => {
          const familyKey = session.workoutFamilyId && session.workoutFamilyId+'@'+session.workoutFamilyVersion;
          const identity = {workoutFamilyId: session.workoutFamilyId, workoutFamilyVersion: session.workoutFamilyVersion};
          add(dimensions.families, familyKey, session, null, identity);
          add(dimensions.styles, familyKey && familyKey+'/'+session.familyStyleId, session, null, {...identity, familyStyleId: session.familyStyleId});
          for (const [dimension, values, matches] of [
            [dimensions.exercises, session.performances.map(item => item.exerciseId), (item,key) => item.exerciseId === key],
            [dimensions.patterns, session.performances.flatMap(item => item.patterns), (item,key) => item.patterns.includes(key)],
            [dimensions.protocols, session.performances.map(item => item.protocol), (item,key) => item.protocol === key]
          ]) new Set(values.filter(Boolean)).forEach(key => add(dimension,key,session,session.performances.filter(item => matches(item,key))));
        });
        for (const dimension of [dimensions.exercises,dimensions.patterns,dimensions.protocols]) dimension.forEach(entry => {
          entry.exposure = sumExposure(entry.performances); entry.occurrenceCount = entry.performances.length; delete entry.performances;
        });
        return Model.deepFreeze({limit, sessions: evidence, ...dimensions});
      },
      sessionsForProgramme(programmeInstanceId, options = {}) { return filter(sessions, {...options, programmeInstanceId, includeStandalone: false}, true); },
      recentPerformedSessions(options = {}) {
        const ids = new Set(filter(performances, options).filter(item => item.exposure.value > 0 || item.exposure.confidence === 'unknown').map(item => item.sessionResultId));
        return recent(filter(sessions, options, true).filter(item => ids.has(item.sessionResultId)), options);
      },
      // Explicit contextual contributions retain their confidence and provenance in a
      // separate view. They never enter performed work or resistance-dose queries.
      contextualEvidence(options = {}) {
        return Model.deepFreeze(filter(sessions, options, true).filter(item => item.feedback && item.feedback.contextualContribution)
          .map(item => ({sessionResultId: item.sessionResultId, occurredAt: when(item), contribution: clone(item.feedback.contextualContribution)})));
      },
      exactExercisePerformances(exerciseId, options = {}) { return recent(filter(performances, options).filter(item => item.exerciseId === exerciseId), options); },
      movementPatternExposure(pattern, options = {}) { return sumExposure(filter(performances, options).filter(item => item.patterns.includes(pattern))); },
      directElbowExposure(action, options = {}) { return sumExposure(filter(performances, options).filter(item => item.directElbowAction === action)); },
      compoundPatternExposure(pattern, options = {}) { return sumExposure(filter(performances, options).filter(item => !item.directElbowAction && item.patterns.includes(pattern))); },
      bodyRegionExposure(bodyRegion, options = {}) { return sumExposure(filter(performances, options).filter(item => item.bodyRegion === bodyRegion)); },
      anchorPerformanceSeries(requirementId, options = {}) {
        const series = [];
        let exerciseId = null, epoch = 0;
        filter(performances, options).filter(item => item.requirementId === requirementId).forEach(performance => {
          // A substitution or incompatible/unknown protocol starts a new series. Returning
          // to an old exercise does not import a substituted exercise's progression.
          if (performance.exerciseId !== exerciseId) { exerciseId = performance.exerciseId; epoch++; }
          // Left/right observations can interleave while retaining separate comparable
          // series. Changing exercise ends both sides' current progression run.
          const last = series.slice().reverse().find(group => group.epoch === epoch
            && comparePerformances(group.performances[group.performances.length - 1], performance).comparable);
          if (last && comparePerformances(last.performances[last.performances.length - 1], performance).comparable) last.performances.push(performance);
          else series.push({exerciseId: performance.exerciseId, epoch, performances: [performance]});
        });
        return Model.deepFreeze(series.map(({exerciseId, performances}) => ({exerciseId, performances})));
      },
      sessionEvidence(sessionResultId) {
        const work = performances.filter(item => item.sessionResultId === sessionResultId);
        return Model.deepFreeze({performances: work, exposure: sumExposure(work)});
      }
    });
  }

  // Read at most N matching immutable results after metadata filtering. Old index
  // metadata is rebuildable in the existing store; this creates no history cache.
  async function loadRecentSummary(store, catalogue, options = {}) {
    const limit = recentLimit(options.limit);
    const query = await store.listSessionResults({sources: ['coach','generator','fixed'], performedOnly: true,
      limit, candidateLimit: limit, ...(options.since ? {since: options.since} : {}), ...(options.until ? {until: options.until} : {})});
    return {summary: createHistory(query.results,catalogue).recentTrainingSummary({...options,limit}), errors: query.errors};
  }
  root.GarageFitTrainingHistory = {PROTOCOL_CONDITION_FIELDS: protocolFields, RECENT_SESSION_LIMIT, MAX_RECENT_SESSION_LIMIT,
    createHistory, loadRecentSummary, comparePerformances, comparePerformanceEvidence, sumExposure};
})(typeof window !== 'undefined' ? window : globalThis);
