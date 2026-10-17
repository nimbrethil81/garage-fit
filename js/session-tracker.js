(function (root) {
  // Session Tracker: execution semantics for one generated-workout run.
  //
  // The player owns presentation and timing; the tracker owns what actually happened.
  // For a tracked execution the order is: record outcome -> persist the Session Draft ->
  // advance the timeline. Moving through the timeline is never evidence by itself.
  //
  //   occurrenceIdFor(phase)            stable id of one executable exercise occurrence
  //   plannedWorkFromTimeline(timeline) planned occurrences of a generated timeline
  //   timedOutcome(planned, elapsed)    completed / partial / skipped from a timer
  //   createTracker(options)            one active Session Draft, finalised into a Session Result
  //   resumeTracker(options)            continue an in-progress draft loaded through the store
  //
  // Persistence goes only through the injected Coach store (js/coach-store.js) and only at
  // checkpoints (start, an outcome, an anchor or substitution, finalisation); the tracker has
  // no per-tick entry point. No programme policy lives here: what counts as meaningful work
  // for an early exit is supplied by the caller.

  const PERFORMED = ['completed','partial'];
  const isMissing = value => value === null || value === undefined;
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

  // ---- Occurrence identity ----
  // Derived only from timeline structure (section, block, round/set/cycle, position, side),
  // never from display text, so it is deterministic and survives Previous/forward navigation.
  function occurrenceIdFor(phase) {
    const parts = [phase.section];
    if (phase.section === 'main') parts.push('b'+(phase.blockIndex || 0));
    if (Number.isInteger(phase.round)) parts.push('r'+phase.round);
    if (Number.isInteger(phase.set)) parts.push('s'+phase.set);
    if (Number.isInteger(phase.cycle)) parts.push('c'+phase.cycle);
    if (Number.isInteger(phase.minute)) parts.push('m'+phase.minute);
    if (Number.isInteger(phase.slotIndex)) parts.push('slot'+phase.slotIndex);
    parts.push('e'+phase.exerciseIndex);
    if (phase.side) parts.push(phase.side);
    return parts.join(':');
  }

  // Planned occurrences in timeline order. Generated Coach anchor metadata supplies the
  // requirement/target by default; callers can override linkage with requirementIdFor(phase).
  // Standalone timelines have none. Suggested targets are never copied into actual results.
  function plannedWorkFromTimeline(timeline, options = {}) {
    const requirementIdFor = options.requirementIdFor || (phase => phase.section === 'main' && phase.exercise.coachAnchor ? phase.exercise.coachAnchor.requirementId : null);
    const seen = new Set();
    return timeline.filter(phase => phase.kind === 'exercise').map(phase => {
      if (!phase.occurrenceId) throw new Error('Timeline exercise phase has no occurrenceId.');
      if (seen.has(phase.occurrenceId)) throw new Error('Duplicate occurrenceId '+JSON.stringify(phase.occurrenceId)+' in timeline.');
      seen.add(phase.occurrenceId);
      const exercise = phase.exercise, prescription = phase.plannedPrescription || exercise.prescription || {};
      const emom = phase.protocol === 'emom', target = emom && phase.target;
      if(emom&&(!target||!['reps','timed'].includes(target.type)||!Number.isFinite(target.value)||target.value<=0||target.type==='timed'&&target.value>=60
        ||target.type==='reps'&&!Number.isInteger(target.value)||!Number.isInteger(phase.minute)||phase.minute<1
        ||phase.slotIndex!==phase.minute-1||phase.startsAtSeconds!==phase.slotIndex*60||phase.endsAtSeconds!==phase.minute*60))
        throw new Error('EMOM planned work needs an explicit minute, window and target.');
      const timed=emom?target.type==='timed':!!phase.timed;
      if(phase.plannedPrescription){
        if(!root.GarageFitGenerator)throw new Error('Occurrence targets need the shared Generator resolver.');
        root.GarageFitGenerator.resolveOccurrenceTarget(exercise,{plannedPrescription:phase.plannedPrescription,
          ...(phase.plannedLoad?{plannedLoad:phase.plannedLoad}:{})},phase.protocol==='timed_intervals'?{timedIntervalSeconds:phase.protocolConditions.workSeconds}:{});
        if(timed!==prescription.type.includes('timed')||timed&&phase.seconds!==prescription.value
          ||emom&&(target.type!==prescription.type||target.value!==prescription.value))throw new Error('Contradictory occurrence target.');
      }
      return {
        occurrenceId: phase.occurrenceId,
        exerciseId: exercise.id,
        section: phase.section,
        blockIndex: phase.section === 'main' ? (phase.blockIndex || 0) : null,
        requirementId: phase.variableTarget ? null : requirementIdFor(phase) || null,
        prescription: {
          type: emom ? target.type : prescription.type || null,
          timed,
          seconds: timed ? (emom ? target.value : phase.seconds) : null,
          reps: timed ? null : (emom ? target.value : Number.isFinite(prescription.value) ? prescription.value : null),
          side: phase.side || null,
          protocol: phase.protocol || null,
          ...(phase.protocolConditions ? {protocolConditions: clone(phase.protocolConditions)} : {}),
          round: Number.isInteger(phase.round) ? phase.round : null,
          set: Number.isInteger(phase.set) ? phase.set : null,
          cycle: Number.isInteger(phase.cycle) ? phase.cycle : null,
          exerciseIndex: phase.exerciseIndex,
          ...(phase.variableTarget ? {variableTarget:true} : {}),
          ...(phase.plannedPrescription ? {plannedPrescription:clone(phase.plannedPrescription)} : {}),
          ...(phase.plannedLoad ? {plannedLoad:clone(phase.plannedLoad)} : {}),
          ...(emom ? {minute:phase.minute,slotIndex:phase.slotIndex,startsAtSeconds:phase.startsAtSeconds,endsAtSeconds:phase.endsAtSeconds,target:clone(target)} : {}),
          ...(phase.section === 'main' && exercise.coachAnchor && !phase.variableTarget ? {plannedTarget: clone(exercise.coachAnchor.plannedTarget)} : {})
        }
      };
    });
  }

  // ---- Outcome semantics ----
  // The timer knows the work done: full -> completed, some -> partial, none -> skipped.
  function timedOutcome(plannedSeconds, elapsedSeconds) {
    if (!(Number.isFinite(plannedSeconds) && plannedSeconds > 0)) throw new Error('plannedSeconds must be a positive number.');
    const elapsed = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    const actualSeconds = Math.min(plannedSeconds, Math.max(0, elapsed));
    const status = actualSeconds >= plannedSeconds ? 'completed' : actualSeconds > 0 ? 'partial' : 'skipped';
    return {status, actualSeconds};
  }

  function toTimestamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw new Error('Session Tracker clock returned an invalid time.');
    return date.toISOString();
  }

  // Early exit is partial only when meaningful work was performed; the caller decides what is
  // meaningful with a list of occurrence ids or a predicate (outcome, planned) => boolean.
  function meaningfulTest(meaningful) {
    if (typeof meaningful === 'function') return meaningful;
    if (meaningful instanceof Set || Array.isArray(meaningful)) {
      const ids = new Set(meaningful);
      return outcome => ids.has(outcome.occurrenceId);
    }
    return null;
  }

  function createTracker(options = {}) {
    const Model = root.GarageFitCoachModel;
    if (!Model) throw new Error('GarageFitCoachModel must be loaded before GarageFitSessionTracker.');
    const {store, draft: resumed} = options;
    if (!store || typeof store.saveSessionDraft !== 'function') throw new Error('Session Tracker needs a Coach store.');
    const now = () => toTimestamp((options.clock || (() => new Date()))());
    const recordResults = options.recordResults === true;
    const meaningfulOption = options.meaningful;

    // Link fields copied onto both the draft and the result.
    const origin = resumed || options;
    const link = {
      source: origin.source,
      programmeInstanceId: origin.programmeInstanceId,
      prescriptionId: origin.prescriptionId,
      workoutId: origin.workoutId,
      generatedAt: origin.generatedAt
    };
    if (origin.overrides) link.overrides = clone(origin.overrides);
    Object.keys(link).forEach(key => { if (link[key] === undefined) delete link[key]; });
    const plannedWork = clone(resumed ? resumed.plannedWork || [] : options.plannedWork || []);
    const plannedById = new Map(plannedWork.map(planned => [planned.occurrenceId, planned]));
    if (plannedById.size !== plannedWork.length) throw new Error('plannedWork occurrence ids must be unique.');

    let draftId = resumed ? resumed.draftId : options.draftId;
    let startedAt = resumed ? resumed.startedAt || null : null;
    let state = resumed ? 'started' : 'idle'; // idle -> started -> finalising -> finalised
    let result = null, pendingResult = null;
    // occurrenceId -> {status, sets, note, targetAchieved, exerciseId (explicit only)}
    const outcomes = new Map();
    const substitutions = new Map();
    let writes = Promise.resolve();
    let writeCount = 0;

    if (resumed) {
      if (!resumed.finalisation || resumed.finalisation.state !== 'in-progress') throw new Error('Only an in-progress Session Draft can be resumed.');
      (resumed.substitutions || []).forEach(sub => { if (sub.occurrenceId) substitutions.set(sub.occurrenceId, clone(sub)); });
      (resumed.occurrenceOutcomes || []).forEach(outcome => {
        const raw = clone(outcome);
        // Keep an exercise id as explicit only where it differs from what would be resolved.
        if (raw.exerciseId === defaultExerciseId(raw.occurrenceId)) delete raw.exerciseId;
        outcomes.set(raw.occurrenceId, raw);
      });
    }

    function defaultExerciseId(occurrenceId) {
      const sub = substitutions.get(occurrenceId), planned = plannedById.get(occurrenceId);
      return sub ? sub.toExerciseId : planned ? planned.exerciseId : null;
    }
    function planned(occurrenceId) {
      const entry = plannedById.get(occurrenceId);
      if (!entry) throw new Error('Unknown occurrenceId '+JSON.stringify(occurrenceId)+'.');
      return entry;
    }
    function requireStarted() {
      if (state === 'idle') throw new Error('Session Tracker has not started.');
      if (state !== 'started') throw new Error('Session Tracker is already finalised.');
    }
    // Apply a change to one keyed entry, undoing it if the resulting draft is invalid.
    function change(map, key, value) {
      const had = map.has(key), previous = map.get(key);
      map.set(key, value);
      try { return checkpoint(); }
      catch (error) { had ? map.set(key, previous) : map.delete(key); throw error; }
    }

    // Outcomes in planned order, each naming the exercise actually performed.
    function resolvedOutcomes(filter) {
      return plannedWork.filter(entry => outcomes.has(entry.occurrenceId)).map(entry => {
        const raw = outcomes.get(entry.occurrenceId);
        const outcome = {occurrenceId: entry.occurrenceId, exerciseId: raw.exerciseId || defaultExerciseId(entry.occurrenceId), status: raw.status};
        ['sets','note','targetAchieved'].forEach(key => { if (!isMissing(raw[key])) outcome[key] = clone(raw[key]); });
        return outcome;
      }).filter(outcome => !filter || filter(outcome));
    }

    // One anchor result per requirement, aggregated over its linked occurrences. In a draft an
    // unrecorded occurrence is still pending; once final it was not performed.
    function anchorResults(final) {
      const byRequirement = new Map();
      plannedWork.forEach(entry => {
        if (!entry.requirementId) return;
        if (!byRequirement.has(entry.requirementId)) byRequirement.set(entry.requirementId, []);
        byRequirement.get(entry.requirementId).push(entry);
      });
      const results = [];
      byRequirement.forEach((linked, requirementId) => {
        const recorded = linked.filter(entry => outcomes.has(entry.occurrenceId));
        if (!final && !recorded.length) return;
        const resolved = resolvedOutcomes(outcome => linked.some(entry => entry.occurrenceId === outcome.occurrenceId));
        const performed = resolved.filter(outcome => PERFORMED.includes(outcome.status));
        const status = linked.every(entry => outcomes.has(entry.occurrenceId) && outcomes.get(entry.occurrenceId).status === 'completed') ? 'completed'
          : performed.length ? 'partial'
          : final || recorded.length === linked.length ? 'skipped' : null;
        const sets = performed.flatMap(outcome => outcome.sets || []);
        results.push({
          requirementId,
          exerciseId: performed.length ? performed[0].exerciseId : defaultExerciseId(linked[0].occurrenceId),
          occurrenceId: linked.length === 1 ? linked[0].occurrenceId : null,
          status,
          sets: sets.length ? sets : null
        });
      });
      return results;
    }

    function draftRecord(finalisation) {
      return Model.createSessionDraft(Object.assign({draftId}, link, {
        startedAt,
        updatedAt: now(),
        plannedWork,
        occurrenceOutcomes: resolvedOutcomes(),
        substitutions: [...substitutions.values()],
        anchorResults: anchorResults(false),
        finalisation: finalisation || {state: 'in-progress', sessionResultId: null}
      }));
    }

    // Checkpoint: snapshot now (so the evidence is fixed at the action), write in order.
    function checkpoint(finalisation) {
      const snapshot = draftRecord(finalisation);
      writeCount++;
      const write = writes.then(() => store.saveSessionDraft(snapshot));
      writes = write.catch(() => {});
      return write;
    }

    function setOutcome(occurrenceId, outcome) {
      requireStarted();
      planned(occurrenceId);
      const raw = {status: outcome.status};
      ['exerciseId','sets','note','targetAchieved'].forEach(key => { if (!isMissing(outcome[key])) raw[key] = clone(outcome[key]); });
      return change(outcomes, occurrenceId, raw);
    }

    // A skip that performed no work does not erase work already recorded for the occurrence
    // (e.g. moving forward again after Previous); any performed work replaces it.
    function skipKeepsPerformed(occurrenceId) {
      const existing = outcomes.get(occurrenceId);
      return !!existing && PERFORMED.includes(existing.status);
    }

    function performedWork() { return resolvedOutcomes(outcome => PERFORMED.includes(outcome.status)); }

    function buildResult(finalStatus, finishOptions) {
      const sessionResultId = finishOptions.sessionResultId || 'result:'+draftId;
      const fields = Object.assign({sessionResultId}, link, {
        startedAt,
        endedAt: now(),
        actualDurationSeconds: isMissing(finishOptions.actualDurationSeconds) ? null : finishOptions.actualDurationSeconds,
        finalStatus,
        plannedWork,
        performedWork: finalStatus === 'skipped-before-start' ? [] : performedWork(),
        substitutions: [...substitutions.values()],
        anchorResults: anchorResults(true)
      });
      if (finishOptions.feedback) fields.feedback = finishOptions.feedback;
      return Model.createSessionResult(fields);
    }

    // Once finalisation begins the outcome is decided and recording closes. If a write fails,
    // finalising again retries the writes with the same result (saveSessionResult is idempotent
    // for identical content), whichever finaliser is called.
    async function finalise(finalStatus, finishOptions, hadDraft) {
      if (state === 'finalised') throw new Error('Session Tracker is already finalised.');
      if (!pendingResult) pendingResult = buildResult(finalStatus, finishOptions || {});
      state = 'finalising';
      const built = pendingResult, sessionResultId = built.sessionResultId;
      if (hadDraft) {
        await writes;
        await checkpoint({state: 'finalising', sessionResultId});
      }
      if (recordResults) await store.saveSessionResult(built);
      if (hadDraft) await checkpoint({state: 'finalised', sessionResultId});
      state = 'finalised';
      result = built;
      return built;
    }
    function requireFinalisable() {
      if (state === 'idle') throw new Error('Session Tracker has not started.');
      if (state === 'finalised') throw new Error('Session Tracker is already finalised.');
    }

    const tracker = {
      get draftId() { return draftId; },
      get started() { return state !== 'idle'; },
      get finalised() { return state === 'finalised'; },
      get result() { return result; },
      // Number of Session Draft writes issued (one per checkpoint).
      get writeCount() { return writeCount; },
      plannedWork: () => clone(plannedWork),
      draft: () => draftRecord(result ? {state: 'finalised', sessionResultId: result.sessionResultId} : undefined),
      outcome(occurrenceId) { return resolvedOutcomes(outcome => outcome.occurrenceId === occurrenceId)[0] || null; },
      performedWork,
      // Resolves once every checkpoint issued so far has been written.
      flush() { return writes; },

      start() {
        if (state !== 'idle') throw new Error('Session Tracker has already started.');
        startedAt = now();
        if (!draftId) draftId = 'draft:'+(link.workoutId || 'session')+':'+startedAt;
        state = 'started';
        try { return checkpoint(); }
        catch (error) { state = 'idle'; startedAt = null; throw error; }
      },

      // Deliberate record or replacement of one occurrence's outcome.
      recordOutcome(occurrenceId, outcome) {
        if (!outcome || !Model.OCCURRENCE_STATUSES.includes(outcome.status)) throw new Error('Outcome status must be one of '+Model.OCCURRENCE_STATUSES.join(', ')+'.');
        return setOutcome(occurrenceId, outcome);
      },
      recordDone(occurrenceId, details) { return setOutcome(occurrenceId, Object.assign({}, details, {status: 'completed'})); },
      recordSkip(occurrenceId) {
        requireStarted();
        planned(occurrenceId);
        if (skipKeepsPerformed(occurrenceId)) return checkpoint();
        return setOutcome(occurrenceId, {status: 'skipped'});
      },
      // Partial needs genuine evidence: logged sets or a note describing what was done.
      recordPartial(occurrenceId, evidence = {}) {
        if (!(Array.isArray(evidence.sets) && evidence.sets.length) && !evidence.note) throw new Error('A partial outcome needs logged sets or a note.');
        return setOutcome(occurrenceId, Object.assign({}, evidence, {status: 'partial'}));
      },
      // Timed work measured by the player's timer; actual seconds are logged, never entered.
      recordTimed(occurrenceId, {plannedSeconds, elapsedSeconds}) {
        requireStarted();
        const entry=planned(occurrenceId);
        if(entry.prescription&&(entry.prescription.protocol==='emom'||entry.prescription.variableTarget)){
          if(!entry.prescription.timed)throw new Error((entry.prescription.protocol==='emom'?'EMOM':'Occurrence')+' rep work requires an explicit outcome.');
          plannedSeconds=entry.prescription.seconds;
        }
        const {status, actualSeconds} = timedOutcome(plannedSeconds, elapsedSeconds);
        if (status === 'skipped' && skipKeepsPerformed(occurrenceId)) return checkpoint();
        return setOutcome(occurrenceId, {status, sets: [{seconds: actualSeconds}]});
      },
      // Anchor confirmation: per-set actual reps/time and load as supplied. Anything not
      // supplied stays unknown; planned reps or suggested loads are never copied in.
      recordAnchor(occurrenceId, {status, sets, targetAchieved, note} = {}) {
        if (!planned(occurrenceId).requirementId) throw new Error('Occurrence '+JSON.stringify(occurrenceId)+' is not linked to an anchor requirement.');
        if (!Model.OCCURRENCE_STATUSES.includes(status)) throw new Error('Anchor status must be one of '+Model.OCCURRENCE_STATUSES.join(', ')+'.');
        return setOutcome(occurrenceId, {status, sets: sets || null, targetAchieved: typeof targetAchieved === 'boolean' ? targetAchieved : null, note});
      },
      // One substitution per occurrence; a later one for the same occurrence replaces it.
      recordSubstitution({occurrenceId, toExerciseId, fromExerciseId, reason}) {
        requireStarted();
        const entry = planned(occurrenceId);
        return change(substitutions, occurrenceId, {occurrenceId, requirementId: entry.requirementId || null, fromExerciseId: fromExerciseId || entry.exerciseId, toExerciseId, reason: reason || null});
      },

      // ---- Finalisation into an immutable Session Result ----
      // Normal end of the timeline.
      async complete(finishOptions) { requireFinalisable(); return finalise('completed', finishOptions, true); },
      // Controlled early exit: partial with meaningful performed work, otherwise abandoned.
      async exitEarly(finishOptions = {}) {
        requireFinalisable();
        if (pendingResult) return finalise(pendingResult.finalStatus, finishOptions, true);
        const isMeaningful = meaningfulTest(finishOptions.meaningful !== undefined ? finishOptions.meaningful : meaningfulOption);
        if (!isMeaningful) throw new Error('Early exit needs meaningful-work context (occurrence ids or a predicate).');
        const meaningful = performedWork().some(outcome => isMeaningful(outcome, plannedById.get(outcome.occurrenceId)));
        return finalise(meaningful ? 'partial' : 'abandoned', finishOptions, true);
      },
      // Explicit decision not to do a planned session; nothing was started or performed.
      async skipBeforeStart(finishOptions) {
        if (state !== 'idle' && !(pendingResult && pendingResult.finalStatus === 'skipped-before-start')) throw new Error('A started session cannot be skipped before start.');
        if (!draftId) draftId = 'draft:'+(link.workoutId || 'session')+':'+now();
        return finalise('skipped-before-start', finishOptions, false);
      }
    };
    return tracker;
  }

  // Continue the in-progress draft held by the store, or null when there is none.
  async function resumeTracker(options = {}) {
    const draft = await options.store.loadSessionDraft();
    if (!draft || draft.finalisation.state !== 'in-progress') return null;
    return createTracker(Object.assign({}, options, {draft}));
  }

  root.GarageFitSessionTracker = { occurrenceIdFor, plannedWorkFromTimeline, timedOutcome, createTracker, resumeTracker };
})(typeof window !== 'undefined' ? window : globalThis);
