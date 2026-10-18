(function (root) {
  // Immutable evidence views. The catalogue owns intrinsic semantics; a plan supplies
  // comparison context only, never actual reps, seconds or load. No storage or clock.
  const clone = value => JSON.parse(JSON.stringify(value));
  const known = value => value !== null && value !== undefined;
  const positive = value => Number.isFinite(value) && value > 0;
  const when = result => result.endedAt || result.startedAt || null;
  const measure = value => ({value: known(value) ? value : null, confidence: known(value) ? 'confirmed' : 'unknown'});
  // Protocol conditions that must match for two performances to be comparable. An unlisted
  // protocol is never comparable. Kept in step with GarageFitGenerator.PROTOCOL_SHAPES by tests.
  const protocolFields = Object.freeze({
    rounds: Object.freeze(['exerciseRestSeconds','roundRestSeconds']),
    paired_sets: Object.freeze(['betweenExercisesSeconds','betweenSetsSeconds']),
    timed_intervals: Object.freeze(['workSeconds','transitionSeconds']),
    emom: Object.freeze(['slotSeconds','targets']),
    ladder: Object.freeze(['exerciseRestSeconds','stepRestSeconds'])
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
    const fields = Object.prototype.hasOwnProperty.call(protocolFields, current.protocol) ? protocolFields[current.protocol] : null;
    // Minute windows and changing rep steps do not establish comparable pacing or
    // fatigue/recovery for straight-set progression, even in old records without a flag.
    if (['emom','ladder'].includes(current.protocol) || !fields || !previous.protocolConditions || !current.protocolConditions
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

  root.GarageFitTrainingHistory = {PROTOCOL_CONDITION_FIELDS: protocolFields, createHistory, comparePerformances, comparePerformanceEvidence, sumExposure};
})(typeof window !== 'undefined' ? window : globalThis);
