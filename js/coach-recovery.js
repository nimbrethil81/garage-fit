(function (root) {
  // The one transaction/reload boundary. Evidence is saved before interpretation;
  // the draft is cleared only after both durable writes succeed. No player state
  // or current-screen work is consulted during crash recovery.
  const meaningful = (outcome, planned) => planned.section === 'main'
    && ['completed','partial'].includes(outcome.status)
    && (!outcome.sets || outcome.sets.some(set => set.reps > 0 || set.seconds > 0));
  function createRecovery({store, engine, definitionFor}) {
    const Model = root.GarageFitCoachModel;
    let reconciled = false, startupErrors = [];
    async function persist(result, history = [], clearDraft = true) {
      await store.saveSessionResult(result);
      const previous = await store.loadProgrammeState(result.programmeInstanceId);
      if (!previous) throw new Model.CoachError('invalid-record', 'Saved session has no valid programme state. Its performed evidence is retained.', {programmeInstanceId: result.programmeInstanceId});
      const next = engine.applySessionResult(definitionFor(previous), previous, result, history);
      if (!Model.sameRecord(previous, next)) await store.saveProgrammeState(next);
      if (clearDraft) await store.clearSessionDraft();
      return next;
    }
    async function reconcile(force = false) {
      if (force) reconciled = false;
      const errors = reconciled ? startupErrors.slice() : [];
      const report = error => { if (!errors.some(item => item.code === error.code && item.message === error.message)) errors.push(error); };
      // Startup is the only full-history operation. Reopening a top-level screen
      // on this controller uses bounded queries instead.
      if (!reconciled) {
        try {
          const index = await store.reconcileSessionIndex(force); index.errors.forEach(report);
          const listed = await store.listSessionResults(); listed.errors.forEach(report);
          const history = listed.results.slice().sort((a,b) => Date.parse(a.endedAt || a.startedAt) - Date.parse(b.endedAt || b.startedAt)
            || a.sessionResultId.localeCompare(b.sessionResultId));
          const states = new Map(), applied = new Map();
          for (const result of history.filter(item => item.source === 'coach')) {
            try {
              let previous = states.get(result.programmeInstanceId);
              if (!previous) previous = await store.loadProgrammeState(result.programmeInstanceId);
              if (!previous) throw new Model.CoachError('invalid-record', 'Saved session has no valid programme state. Its performed evidence is retained.', {programmeInstanceId: result.programmeInstanceId});
              if (!applied.has(result.programmeInstanceId)) applied.set(result.programmeInstanceId, new Set([
                ...((previous.currentTargets || {}).reconciliation || {}).appliedSessionResultIds || [],
                previous.lastAppliedSessionResultId, ...(previous.recentSessionSummaries || []).map(item => item.sessionResultId)]));
              states.set(result.programmeInstanceId, previous);
              if (applied.get(result.programmeInstanceId).has(result.sessionResultId)) continue;
              const next = engine.applySessionResult(definitionFor(previous), previous, result, history);
              if (!Model.sameRecord(previous, next)) await store.saveProgrammeState(next);
              states.set(result.programmeInstanceId, next);
              applied.get(result.programmeInstanceId).add(result.sessionResultId);
            } catch (error) { report(error); }
          }
          // Retry failed interpretation/write on the next explicit load.
          reconciled = !errors.some(error => ['storage-write-failed','storage-unavailable'].includes(error.code));
        } catch (error) { report(error); }
      }
      startupErrors = errors.slice();
      let draft = null, recoveredResult = null, draftBlocked = false;
      try {
        draft = await store.loadSessionDraft();
        if (draft && draft.source === 'coach') {
          // Validate the owning instance before checkpointing a recovered draft.
          // An orphan/invalid programme must leave its original evidence intact.
          const owner = await store.loadProgrammeState(draft.programmeInstanceId);
          if (!owner) throw new Model.CoachError('invalid-record', 'Interrupted session has no valid programme state. Its draft has been retained.', {programmeInstanceId: draft.programmeInstanceId});
          definitionFor(owner);
          const resultId = draft.finalisation.sessionResultId || 'result:'+draft.draftId;
          let result = await store.getSessionResult(resultId);
          if (!result) {
            const resumable = Model.createSessionDraft({...draft, finalisation: {state: 'in-progress', sessionResultId: null}});
            // Stable end time/id make repeated interrupted recovery deterministic.
            const tracker = root.GarageFitSessionTracker.createTracker({store, draft: resumable, meaningful,
              clock: () => draft.updatedAt || draft.startedAt || draft.generatedAt});
            result = await tracker.exitEarly({sessionResultId: resultId});
          }
          if (result.source !== 'coach' || result.programmeInstanceId !== draft.programmeInstanceId
            || result.workoutId !== draft.workoutId || result.prescriptionId !== draft.prescriptionId) {
            throw new Model.CoachError('session-result-conflict', 'Interrupted session conflicts with saved evidence. Both records have been retained.', {sessionResultId: resultId});
          }
          await persist(result);
          recoveredResult = result; draft = null;
        }
      } catch (error) { report(error); draftBlocked = !draft; }
      return {errors, draft, recoveredResult, draftBlocked};
    }
    return {persist, reconcile};
  }
  root.GarageFitCoachRecovery = {createRecovery, meaningful};
})(typeof window !== 'undefined' ? window : globalThis);
