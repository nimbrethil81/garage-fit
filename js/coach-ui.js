(function (root) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const Model = () => root.GarageFitCoachModel;
  const localDay = now => {
    const date = new Date(now);
    return [String(date.getFullYear()).padStart(4,'0'), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  };
  // Application orchestration. Programme decisions stay in the pure engine;
  // records go through the store and execution evidence through the tracker.
  function createController({store, engine, catalogue, buildTimeline, clock = () => new Date().toISOString(),
    id = prefix => prefix+':'+(root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now()+':'+Math.random()),
    definitionFor = state => {
      const versions = root.GarageFitData.programmes[state.programmeDefinitionId];
      const def = versions && versions[state.programmeDefinitionVersion];
      if (!def) throw new Error('The saved programme definition version is unavailable. Records have been retained.');
      return def;
    }} = {}) {
    let state = null, results = [], preview = null, tracker = null, draft = null, pendingResult = null, preparationContext = null;
    const definition = () => definitionFor(state);
    const meaningful = root.GarageFitCoachRecovery.meaningful;
    const recovery = root.GarageFitCoachRecovery.createRecovery({store, engine, definitionFor});
    let errors = [], blocked = false;
    async function recentHistory() {
      if (!state) { results = []; return; }
      const def = definition(), since = new Date(Date.parse(clock()) - Math.max(def.coverageTargets.windowDays, def.doseTargets.windowDays || 0) * 86400000).toISOString();
      const scoped = {programmeInstanceId: state.programmeInstanceId};
      const queries = [await store.listSessionResults({...scoped, since}), await store.listSessionResults({...scoped, limit: 8})];
      if (def.coverageTargets.includeStandaloneHistory) queries.push(await store.listSessionResults({source: 'generator', since}));
      const byId = new Map();
      queries.forEach(query => { errors.push(...query.errors); query.results.forEach(result => byId.set(result.sessionResultId, result)); });
      const lastMeaningful = (state.recentSessionSummaries || []).slice().reverse().find(item => item.meaningful);
      const lastMeaningfulId = state.currentTargets && state.currentTargets.lastMeaningfulSessionResultId || lastMeaningful && lastMeaningful.sessionResultId;
      if (lastMeaningfulId && !byId.has(lastMeaningfulId)) {
        try { const last = await store.getSessionResult(lastMeaningfulId); if (last) byId.set(last.sessionResultId, last); }
        catch (error) { errors.push(error); }
      }
      results = [...byId.values()].sort((a,b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));
    }
    async function load(force = false) {
      errors = []; blocked = false;
      // A live tracker belongs to the current player, not to crash recovery.
      if (!tracker) {
        const recovered = await recovery.reconcile(force);
        errors = recovered.errors; draft = recovered.draft; blocked = recovered.draftBlocked;
      }
      try {
        const reference = await store.loadActiveProgramme();
        state = reference ? await store.loadProgrammeState(reference.programmeInstanceId) : null;
        if (reference && (!state || !Model().sameRecord(reference, Model().createActiveProgramme(Model().programmeDefinitionRef(state))))) throw new Error('The saved active programme reference does not match its state. Records have been retained.');
        if (state) definition();
        await recentHistory();
      } catch (error) { errors.push(error); blocked = true; state = null; }
      return snapshot();
    }
    function snapshot() { return {state: state && clone(state), results: clone(results.filter(item => state && item.programmeInstanceId === state.programmeInstanceId)),
      preview, errors: errors.slice(), blocked, interruptedDraft: draft && !tracker ? clone(draft) : null}; }
    function assess(def, equipment) { return engine.assessProgrammeFeasibility(def, {equipment}); }
    async function start(def, equipment, programmeSettings) {
      if (blocked) throw new Error('Resolve the saved programme error before starting another.');
      if (draft || state && state.status !== 'completed') throw new Error('Finish the current programme before starting another.');
      const started = engine.startProgramme(def, {equipment, programmeInstanceId: id('programme'),
        ...(programmeSettings === undefined ? {} : {programmeSettings})}, clock());
      if (!started.state) return started;
      await store.saveProgrammeState(started.state);
      await store.saveActiveProgramme(Model().createActiveProgramme(Model().programmeDefinitionRef(started.state)));
      state = started.state; preview = null; return started;
    }
    function today(input = {}) {
      const now = clock(), localDate = localDay(now);
      return {...input, ...(definition().contextPolicy ? {localDate} : {}), now, prescriptionId: id('prescription')};
    }
    function plan(input) { return engine.planNextSession(definition(), state, results, today(input)); }
    function prepare(input) {
      if (draft || tracker) throw new Error('Save the current session before preparing another.');
      preview = null;
      const context = today(input), plan = engine.planNextSession(definition(), state, results, context);
      preparationContext = context;
      if (!plan.prescription) return {status: 'infeasible', plan, today: context};
      const history = results.filter(item => item.programmeInstanceId === state.programmeInstanceId).slice(-4).reverse()
        .map(item => [...new Set((item.performedWork || []).filter(work => ['completed','partial'].includes(work.status)).map(work => work.exerciseId))]);
      const workout = root.GarageFitGenerator.generate({catalogue, sessionPrescription: plan.prescription, history});
      preview = {workout, plan, today: context, generatedAt: clock()};
      return preview;
    }
    function alternatives(requirementId, context) { return engine.getAnchorAlternatives(definition(), state, context, requirementId); }
    function substitute(requirementId, exerciseId, context) {
      const input = context || preparationContext || preview && preview.today;
      if (!input) throw new Error('Prepare today’s session first.');
      return prepare({...input, anchorSubstitutions: {...(preparationContext && preparationContext.anchorSubstitutions), ...input.anchorSubstitutions, [requirementId]: exerciseId}});
    }
    async function begin() {
      if (!preview || draft) throw new Error('Prepare a session before beginning.');
      if (!tracker && definition().contextPolicy && localDay(clock()) !== localDay(preview.today.now)) {
        preview = null;
        throw new Error('The local day changed. Prepare today’s session again.');
      }
      const plannedWork = tracker ? tracker.plannedWork() : root.GarageFitSessionTracker.plannedWorkFromTimeline(buildTimeline(preview.workout));
      const substitutions = preview.today.anchorSubstitutions || {};
      plannedWork.forEach(item => { if (substitutions[item.requirementId]) item.exerciseId = state.anchors.find(anchor => anchor.requirementId === item.requirementId).exerciseId; });
      if (!tracker) {
        tracker = root.GarageFitSessionTracker.createTracker({store, clock, source: 'coach', draftId: id('draft'),
          programmeInstanceId: state.programmeInstanceId, prescriptionId: preview.plan.prescription.prescriptionId,
          workoutId: preview.workout.id, generatedAt: preview.generatedAt, plannedWork, meaningful,
          overrides: preview.plan.prescription.programmeContext.overrides});
        await tracker.start();
      } else await store.saveSessionDraft(tracker.draft());
      for (const item of plannedWork.filter(item => substitutions[item.requirementId] && substitutions[item.requirementId] !== item.exerciseId)) {
        await tracker.recordSubstitution({occurrenceId: item.occurrenceId, toExerciseId: substitutions[item.requirementId], reason: 'Just for today'});
      }
      draft = tracker.draft(); return tracker;
    }
    async function finish(kind, feedback, actualDurationSeconds) {
      if (!tracker && draft) {
        const resumable = Model().createSessionDraft({...clone(draft), finalisation: {state: 'in-progress', sessionResultId: null}});
        tracker = root.GarageFitSessionTracker.createTracker({store, clock, draft: resumable, meaningful});
      }
      if (!tracker) throw new Error('No active Coach session.');
      if (!pendingResult) pendingResult = await (kind === 'complete' ? tracker.complete({feedback, actualDurationSeconds}) : tracker.exitEarly({feedback, actualDurationSeconds}));
      state = await recovery.persist(pendingResult, results);
      await recentHistory();
      const result = pendingResult; pendingResult = null; tracker = null; draft = null; preview = null;
      return result;
    }
    async function manage(action) {
      if (draft || tracker) throw new Error('Save the session before changing the programme.');
      let next;
      if (action === 'continue') next = engine.acknowledgeBlockReview(definition(), state, clock());
      else if (action === 'maintenance') next = engine.enterMaintenanceMode(engine.acknowledgeBlockReview(definition(), state, clock()));
      else if (action === 'development') next = engine.exitMaintenanceMode(state);
      else if (action === 'pause') next = engine.pauseProgramme(state);
      else if (action === 'resume') next = engine.resumeProgramme(state);
      else if (action === 'finish') next = engine.finishProgramme(state);
      else throw new Error('Unknown programme action.');
      await store.saveProgrammeState(next); state = next; preview = null;
    }
    async function saveProgrammeSettings(patch) {
      if (blocked || !state) throw new Error('Load a valid programme before changing settings.');
      if (draft || tracker || pendingResult) throw new Error('Save the session before changing programme settings.');
      if (await store.loadSessionDraft()) throw new Error('Save the session before changing programme settings.');
      // Read the durable state, so saving preferences cannot overwrite reconciled work.
      const reference = await store.loadActiveProgramme();
      const previous = await store.loadProgrammeState(state.programmeInstanceId);
      const expected = Model().createActiveProgramme(Model().programmeDefinitionRef(state));
      if (!previous || !Model().sameRecord(reference, expected)
        || !Model().sameRecord(Model().programmeDefinitionRef(previous), Model().programmeDefinitionRef(state))) {
        throw new Error('The active programme changed. Reload Coach before saving settings.');
      }
      const next = engine.updateProgrammeSettings(definitionFor(previous), previous, patch);
      await store.saveProgrammeState(next);
      state = next; preview = null; preparationContext = null;
      await recentHistory();
      return clone(next);
    }
    return {load, snapshot, assess, start, plan, prepare, alternatives, substitute, begin, finish, manage, saveProgrammeSettings,
      review: () => engine.programmeReview(definition(), state, clock())};
  }

  function mount({catalogue, equipment, getEquipment, buildTimeline, play, showScreen, stopPlayer}) {
    let storage;
    try { storage=root.localStorage; } catch (error) { storage=null; }
    const store = root.GarageFitCoachStore.createStore(storage);
    const engine = root.GarageFitCoachEngine.createEngine({catalogue, assessSessionPrescription: root.GarageFitGenerator.assessSessionPrescription});
    const controller = createController({store, engine, catalogue, buildTimeline});
    const programmes = Object.values(root.GarageFitData.programmes).map(versions => versions[Math.max(...Object.keys(versions).map(Number))]);
    let def = programmes[0], activeResistance = null, sessionSetups = {};
    const el = id => document.getElementById(id);
    let options = null, busy = false, sessionActive = false, endKind = null, endSeconds = null, lastSaved = '', initialisation = Promise.resolve();
    function button(text, action, primary = false) {
      const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
      node.className = primary ? 'generator-primary' : 'ctrl-btn ctrl-secondary'; node.onclick = () => run(action); return node;
    }
    function paragraph(text) { const node = document.createElement('p'); node.textContent = text; return node; }
    function heading(text) { const node = document.createElement('h2'); node.textContent = text; return node; }
    async function run(action) {
      if (busy) return; busy = true;
      ['coachError','coachPlayerError','coachPreviewError','coachResultError'].forEach(id => {el(id).textContent='';});
      try { return await action(); }
      catch (error) { ['coachError','coachPreviewError','coachResultError'].forEach(id => {el(id).textContent=error.message;}); el('coachPlayerError').textContent = 'Could not save. '+error.message+' Try again before leaving.'; }
      finally { busy = false; }
    }
    function resetOptions() {
      const state = controller.snapshot().state;
      if (state) def = root.GarageFitData.programmes[state.programmeDefinitionId][state.programmeDefinitionVersion];
      options = {duration: def.sessionTemplate.duration, equipment: getEquipment().slice(), easyToday: false, bodyFocus: null};
    }
    const patternNames = {squat: 'squat', hinge: 'hinge', lunge: 'lunge', push: 'push', pull: 'pull', core: 'core', carry: 'carry'};
    function conflictText(conflicts) {
      return [...new Set((conflicts || []).map(item => {
        if (item.code === 'tennis-rest-recommended') return item.message;
        if (item.code === 'missing-pattern') return 'Add equipment for '+item.pattern+' work.';
        if (item.code === 'anchor-unavailable' && item.message) return item.message;
        if (item.code === 'tennis-no-useful-session' || item.code === 'tennis-preflight-required') return item.message || 'No useful Tennis session can be prescribed with these options.';
        if (item.code === 'anchor-unavailable') return item.directElbowAction
          ? 'No suitable direct arm '+(item.directElbowAction === 'flexion' ? 'curl' : 'extension')+' anchor is available. Compound pushing or pulling cannot replace it.'
          : 'No suitable '+item.requirementId.replace('anchor-','')+' anchor is available.';
        if (['equipment-mismatch','required-anchor-unavailable','difficulty-ineligible'].includes(item.code)) return 'A required anchor is unavailable today. Restore its equipment or choose an approved substitute.';
        if (['insufficient-duration','unsupported-duration','insufficient-main-time'].includes(item.code)) return 'Required work needs a supported duration that fits. Try 30 or 45 minutes.';
        return 'A programme requirement cannot be met with today’s options. Adjust equipment or duration.';
      }))].join(' ');
    }
    function rationale(plan) {
      const adaptation = plan.rationale.priorities.adaptation;
      if (adaptation && adaptation.recommendation) return adaptation.recommendation;
      if (adaptation && adaptation.reasons.length && plan.prescription) return adaptation.reasons.join(' · ')+'. Selected work fits '+plan.prescription.duration+' minutes with preparation and rest.';
      if (plan.prescription && plan.prescription.programmeContext.roleLabel) return plan.prescription.programmeContext.roleLabel+' today: selected targets fit '+plan.prescription.duration+' minutes with preparation and rest. Keep about 2 reps in reserve on strength anchors.';
      const patterns = plan.rationale.priorities.movements.filter(item => item.deficit > 0).map(item => patternNames[item.pattern]);
      if (plan.prescription && plan.prescription.sessionRole==='maintenance') return 'Keep your anchor challenge with fewer sets and less supporting work in '+plan.prescription.duration+' minutes.';
      if (plan.rationale.priorities.directDose) return 'Direct arm anchors first; whole-body maintenance follows'+(patterns.length ? ' with attention to '+patterns.slice(0,3).join(', ') : '')+'.';
      return plan.prescription && plan.prescription.duration < def.sessionTemplate.duration ? 'Shorter session today: keeping required anchors and reducing supporting work.'
        : patterns.length ? 'Prioritising '+patterns.slice(0,3).join(', ')+' from your recent performed work.' : 'Keep your anchors steady and maintain whole-body coverage.';
    }
    async function open() { showScreen('coach'); await initialisation; await run(async () => { await controller.load(); resetOptions(); render(); }); }
    function renderAdjust(wrap) {
      const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Adjust today'; details.className = 'generator-options'; details.append(summary);
      const durations = document.createElement('div'); durations.className = 'choice-row';
      def.supportedDurations.forEach(value => { const item = button(value+' min', () => { options.duration = value; renderAdjustValues(); }); item.setAttribute('aria-pressed', String(options.duration === value)); durations.append(item); });
      details.append(heading('Available time'), durations);
      const easy = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = options.easyToday;
      check.onchange = () => { options.easyToday = check.checked; }; easy.append(check, paragraph('Easy today · progression held')); details.append(easy);
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Body emphasis');
      [['','Whole body'],['upper','Upper'],['lower','Lower'],['core','Core']].forEach(([value,label]) => { const option = document.createElement('option'); option.value=value; option.textContent=label; select.append(option); });
      select.value=options.bodyFocus || ''; select.onchange=() => { options.bodyFocus=select.value || null; }; details.append(heading('Body emphasis'), select);
      details.append(heading('Equipment available today'));
      const kit = document.createElement('div'); kit.className = 'equipment-list';
      equipment.forEach(item => { const control = button(item.name, () => { options.equipment = options.equipment.includes(item.id) ? options.equipment.filter(id => id !== item.id) : [...options.equipment,item.id]; control.setAttribute('aria-pressed', String(options.equipment.includes(item.id))); }); control.setAttribute('aria-pressed',String(options.equipment.includes(item.id))); kit.append(control); });
      details.append(kit,paragraph('Today’s selection leaves your usual equipment inventory unchanged.')); wrap.append(details);
      function renderAdjustValues() { [...durations.children].forEach((item,index) => item.setAttribute('aria-pressed',String(options.duration===def.supportedDurations[index]))); }
    }
    function render() {
      const wrap=el('coachContent'); wrap.innerHTML=''; const current=controller.snapshot(), state=current.state;
      if (lastSaved) wrap.append(paragraph(lastSaved));
      if (current.errors.length) {
        wrap.append(paragraph('Some Coach records could not be recovered. Saved evidence has been retained.'),
          ...current.errors.map(error => paragraph(error.message)), button('Retry recovery', async () => { await controller.load(true); resetOptions(); render(); }));
        if (current.blocked) return;
      }
      if (current.interruptedDraft) { wrap.append(heading('Interrupted session'),paragraph('Your recorded work is safe. Save it before starting another session.'),button('Save performed work',() => showEnd('exit',null),true)); return; }
      if (!state || state.status==='completed') {
        wrap.append(paragraph('A training goal, stable anchors and sessions adapted to the work you actually do.'));
        programmes.forEach(programme => wrap.append(button(programme.name, () => { def=programme; overview(); }, true)));
        if (state) wrap.append(paragraph('Previous programme finished · '+state.meaningfulSessionsCompleted+' meaningful sessions. Your history is saved.'));
        return;
      }
      def = root.GarageFitData.programmes[state.programmeDefinitionId][state.programmeDefinitionVersion];
      wrap.append(heading(def.name),paragraph(def.objective));
      const review=controller.review(), blockDays=review.nominalProgress%def.nominalDurationDays, weeks=Math.ceil(def.nominalDurationDays/7);
      const tennisFrequency=def.type==='tennis-conditioning' && state.currentTargets.programmeSettings.weeklyCoachFrequency;
      const frequency=state.mode==='maintenance'?def.maintenancePolicy.frequency:def.recommendedFrequency;
      wrap.append(paragraph((def.openEnded?'Open-ended objective':review.due?'Four-week block complete':'Week '+Math.min(weeks,Math.floor(blockDays/7)+1)+' of '+weeks)+' · '+state.meaningfulSessionsCompleted+' meaningful sessions'),
        paragraph(tennisFrequency ? tennisFrequency+' Coach sessions per week. Priorities follow performed work; no catch-up debt.' : frequency.aimSessionsPerWeek ? 'Aim for '+frequency.aimSessionsPerWeek+' sessions per week; two is acceptable. No catch-up debt.' : (state.mode==='maintenance'?'Maintenance':'Development')+' · '+frequency.minSessionsPerWeek+'–'+frequency.maxSessionsPerWeek+' sessions per week'));
      if (def.doseTargets.directElbowActions) {
        const now=new Date().toISOString(), history=root.GarageFitTrainingHistory.createHistory(current.results,catalogue);
        const scope={programmeInstanceId:state.programmeInstanceId, sections:def.doseTargets.sections,
          since:new Date(Date.parse(now)-def.doseTargets.windowDays*86400000).toISOString(),until:now};
        wrap.append(heading('Arm work · last '+def.doseTargets.windowDays+' days'));
        Object.entries(def.doseTargets.directElbowActions).forEach(([action,target]) => {
          const exposure=history.directElbowExposure(action,scope);
          const unmeasured=history.performances.some(item=>item.directElbowAction===action && item.exposure.confidence==='unknown'
            && scope.sections.includes(item.section) && Date.parse(item.occurredAt)>=Date.parse(scope.since) && Date.parse(item.occurredAt)<=Date.parse(scope.until));
          wrap.append(paragraph((action==='flexion'?'Curls':'Extensions')+' · '+Number(exposure.value.toFixed(2))+' / '+target+' performed set exposures'+(unmeasured?' · some work is unmeasured':'')));
        });
        wrap.append(paragraph('Compound pushing and pulling support whole-body maintenance and are tracked separately from direct arm work.'));
      }
      if (state.status==='paused') { wrap.append(paragraph('Paused · anchors and history preserved.'),button('Resume',() => manage('resume'),true)); }
      else if (review.due) {
        wrap.append(heading('Four-week review'),paragraph(review.meaningfulSessions+' meaningful sessions in this block'+(review.targetMet?' · Block target met':'')),
          button('Continue building',() => manage('continue'),true),button('Move to maintenance',() => manage('maintenance')),button('Finish programme',() => manage('finish')));
      } else {
        const plan=controller.plan(options), card=document.createElement('section'); card.className='coach-card';
        card.append(heading('Up next'),paragraph(plan.prescription?rationale(plan):conflictText(plan.conflicts)));
        if (!plan.conflicts.some(item => item.code === 'tennis-rest-recommended')) card.append(button('Start session', prepare,true));
        wrap.append(card); renderAdjust(wrap);
      }
      const progress=document.createElement('details'), summary=document.createElement('summary'); summary.textContent='Programme progress and management'; progress.append(summary);
      state.anchors.forEach(anchor => progress.append(paragraph(catalogue[anchor.exerciseId].name+' · '+(anchor.currentTarget || anchor).targetSets+' × '+(anchor.currentTarget || anchor).target.maxReps+' reps · '+(anchor.currentTarget.progressionIntent || 'Confirm actual work'))));
      current.results.slice(-5).reverse().forEach(result => progress.append(paragraph(new Date(result.endedAt).toLocaleDateString()+' · '+result.finalStatus+' · '+result.performedWork.filter(work=>work.status!=='skipped').length+' work occurrences')));
      progress.append(button(state.status==='paused'?'Resume':'Pause',() => manage(state.status==='paused'?'resume':'pause')));
      if (def.supportsMaintenanceMode !== false) progress.append(button(state.mode==='maintenance'?'Return to development':'Move to maintenance',() => manage(state.mode==='maintenance'?'development':'maintenance')));
      progress.append(button('Finish programme',() => manage('finish'))); wrap.append(progress);
    }
    function overview() {
      const assessment=controller.assess(def,getEquipment()), wrap=el('coachContent'); wrap.innerHTML='';
      const anchor=def.anchorSelectionPolicy.requirements[0];
      wrap.append(heading(def.name),paragraph(def.type==='tennis-conditioning' ? def.objective+'. Balanced by default, with 2 Coach sessions per week; 1–3 sessions are supported. Pause or finish whenever you choose.' : def.openEnded ? def.objective+'. An open-ended objective: aim for '+def.recommendedFrequency.aimSessionsPerWeek+' sessions per week; two is acceptable. Pause or finish whenever you choose.' : def.objective+' over a nominal four-week block. Aim for '+def.completionCriteria.blockMeaningfulSessionTarget+' meaningful sessions, at '+def.recommendedFrequency.minSessionsPerWeek+'–'+def.recommendedFrequency.maxSessionsPerWeek+' per week.'),
        paragraph(def.type==='tennis-conditioning' ? 'Usually 20–30 minutes. Four stable knee, hinge, push and pull anchors build from 2 × 6 to 2 × 10 reps, about 2 reps in reserve. Each session selects the targets that fit your available 10/15/20/30/45 minutes; both sides are required where applicable. Supporting work rotates from performed history, with no catch-up debt.' : def.sessionTemplate.duration+' minutes by default; '+def.supportedDurations.filter(duration=>duration!==def.sessionTemplate.duration).join(' or ')+' minutes when needed. '+def.anchorSelectionPolicy.requirements.length+' stable '+(def.doseTargets.directElbowActions?'direct curl and extension':'squat, push and pull')+' anchors start at '+anchor.targetSets+' × '+anchor.target.maxReps+' reps.'),
        paragraph(assessment.status==='infeasible'?'Blocked · '+conflictText(assessment.conflicts):assessment.status==='partially-feasible'?'Partially feasible · required anchors fit; supporting choices may be adjusted.':'Feasible · your equipment supports this programme.'),
        button('Set up usual equipment',() => root.openEquipment('coach')));
      if (def.doseTargets.directElbowActions) wrap.append(paragraph('Build from 3 × 8 to 3 × 12, then confirm more resistance. Aim for 9 performed curl and 9 extension set exposures in each rolling 7 days, plus squat, hinge, lunge, compound push/pull, core and carry maintenance. Short sessions keep the direct anchors first.'));
      if (assessment.status!=='infeasible') wrap.append(button('Start programme',async () => { await controller.start(def,getEquipment()); resetOptions(); render(); },true));
      wrap.append(button('Back',render));
    }
    function prepare() {
      const preview=controller.prepare(options);
      if (preview.status==='infeasible') { showBlocked(preview); return; }
      renderPreview(preview);
    }
    function showBlocked(preview) {
        if (preview.plan.conflicts.some(item => item.code === 'tennis-rest-recommended')) {
          el('coachContent').append(paragraph(rationale(preview.plan))); return;
        }
        el('coachContent').append(paragraph('Blocked · '+conflictText(preview.plan.conflicts)));
        controller.snapshot().state.anchors.forEach(anchor => el('coachContent').append(button('Substitute '+catalogue[anchor.exerciseId].name,() => showSubstitutes(anchor.requirementId,preview.today))));
    }
    function renderPreview(preview) {
      const wrap=el('coachPreviewContent'); wrap.innerHTML=''; const workout=preview.workout, outcome=workout.prescriptionOutcome;
      wrap.append(heading(outcome.status==='partially-feasible'?'Adjusted':'Ready'),paragraph('≈'+Math.round(workout.estimatedSeconds/60)+' min · '+rationale(preview.plan)));
      function preparation(label, phase) {
        if (phase && phase.exercises.length) wrap.append(heading(label+' · '+Math.round(phase.estimatedSeconds/60)+' min'),paragraph(phase.exercises.map(exercise=>exercise.name).join(' · ')));
      }
      preparation('Warm-up',workout.warmup); preparation('Ramp-up',workout.rampup);
      workout.main.blocks.forEach((block,index) => {
        wrap.append(heading('Block '+(index+1)));
        block.exercises.forEach((exercise,exerciseIndex) => {
          const row=document.createElement('div'); row.className='coach-preview-row'; const anchor=exercise.coachAnchor;
          const stableAnchor=anchor && controller.snapshot().state.anchors.some(item=>item.requirementId===anchor.requirementId);
          const timed=block.protocol==='timed_intervals' || exercise.prescription.type.includes('timed');
          row.append(paragraph((anchor?(anchor.importance==='required'?(stableAnchor?'Required anchor · ':'Required support · '):'Maintenance · '):'')+exercise.name+' · '+(block.protocol==='timed_intervals'?block.prescription.workSeconds:exercise.prescription.value)+(timed?' sec':' reps')+(exercise.sidedness==='per-side'?' each side':'')));
          if (anchor) {
            row.append(paragraph(anchor.plannedTarget.targetSets+' sets · '+(anchor.plannedTarget.progressionIntent || 'Confirm actual work')));
            if (stableAnchor) row.append(button('Substitute',() => showSubstitutes(anchor.requirementId,preview.today)));
          }
          else row.append(button('Swap',() => { root.GarageFitGenerator.swap(workout,index,exerciseIndex,{catalogue,equipment:preview.today.equipment}); renderPreview(preview); }));
          wrap.append(row);
        });
      });
      preparation('Cool-down',workout.cooldown);
      if (outcome.softRelaxations.length) wrap.append(paragraph('Some supporting choices were adjusted to keep the required work.'));
      const unavailable=preview.plan.prescription.programmeContext.maintenanceUnavailable || [];
      if (unavailable.length) wrap.append(paragraph('Today’s equipment cannot provide '+unavailable.join(', ')+' maintenance. Add suitable equipment when available; there is no catch-up debt.'));
      (preview.plan.prescription.programmeContext.warnings || []).forEach(warning => wrap.append(paragraph(warning.message)));
      wrap.append(button('Begin workout',async () => { const tracker=await controller.begin(); sessionSetups={}; sessionActive=true; await play(workout,tracker); },true),button('Back to Coach',() => { showScreen('coach'); render(); })); showScreen('coachPreview');
    }
    function showSubstitutes(requirementId, context) {
      const wrap=el('coachSubstituteContent'); wrap.innerHTML='';
      wrap.append(paragraph('Just for today. Your stable programme anchor stays the same; the substitute starts a new performance series.'));
      const anchor=controller.snapshot().state.anchors.find(item=>item.requirementId===requirementId);
      const alternatives=controller.alternatives(requirementId,context).filter(id=>id!==anchor.exerciseId);
      alternatives.forEach(id => wrap.append(button(catalogue[id].name,() => {
        const preview=controller.substitute(requirementId,id,context); options={...preview.today};
        if (!preview.workout) {showScreen('coach');render();showBlocked(preview);return;} renderPreview(preview);
      })));
      if (!alternatives.length) wrap.append(paragraph('No compatible alternative is available. Restore equipment or adjust today’s options.'));
      showScreen('coachSubstitute');
    }
    async function manage(action) { await controller.manage(action); resetOptions(); render(); }
    function isProgressionAnchor(phase) {
      const anchor=phase && phase.kind==='exercise' && phase.section==='main' && !phase.timed && phase.exercise.coachAnchor;
      const state=controller.snapshot().state;
      return anchor && anchor.importance==='required' && state && state.anchors.some(item=>item.requirementId===anchor.requirementId);
    }
    function renderAnchor(phase, tracker) {
      const anchor=sessionActive && isProgressionAnchor(phase) && phase.exercise.coachAnchor;
      el('coachAnchorLog').classList.toggle('hidden',!anchor); el('coachSkipBtn').classList.toggle('hidden',!sessionActive || !phase || phase.kind!=='exercise' || phase.timed);
      if (!anchor) return;
      const preview=controller.snapshot().preview, resistance=preview.plan.prescription.programmeContext.anchorResistance;
      activeResistance=resistance && resistance[anchor.requirementId] ? {...resistance[anchor.requirementId],requirementId:anchor.requirementId, prescriptionId:preview.plan.prescription.prescriptionId} : null;
      const setup=activeResistance && !activeResistance.numericLoad;
      el('coachResistanceSetup').classList.toggle('hidden',!setup);
      el('coachNumericLoad').classList.toggle('hidden',!!setup);
      el('coachSameSetup').checked=false; el('coachHarderSetup').checked=false;
      el('coachHarderSetupLabel').classList.toggle('hidden',!setup || !activeResistance.ready);
      const planned=anchor.plannedTarget, existing=tracker.outcome(phase.occurrenceId), actual=existing && existing.sets && existing.sets[0];
      el('coachAnchorPlanned').textContent='Planned: '+phase.exercise.prescription.value+' reps'+(planned.suggestedLoad!==undefined?' at '+planned.suggestedLoad+' '+planned.loadUnit+(planned.loadInterpretation==='per-item'?' each':' total'):' · confirm your actual load when known');
      el('coachActualReps').value=actual && actual.reps!==undefined?actual.reps:phase.exercise.prescription.value;
      el('coachActualLoad').value=actual && actual.load!==undefined?actual.load:planned.suggestedLoad ?? '';
      el('coachLoadUnit').value=actual && actual.loadUnit || planned.loadUnit || 'kg';
      el('coachLoadInterpretation').value=actual && actual.loadInterpretation || planned.loadInterpretation || ((phase.exercise.equipment || []).some(group=>group.includes('dumbbells'))?'per-item':'total');
      el('coachAnchorEdit').open=false; updateActualSummary();
    }
    function actualSet() {
      const reps=el('coachActualReps').value, load=el('coachActualLoad').value;
      const set={reps: reps===''?null:Number(reps), load:load===''?null:Number(load)};
      if (activeResistance && !activeResistance.numericLoad) {
        set.load=null;
        if (el('coachSameSetup').checked || el('coachHarderSetup').checked) set.resistanceSetup=el('coachHarderSetup').checked
          ? activeResistance.prescriptionId : sessionSetups[activeResistance.requirementId] || activeResistance.setup;
      }
      if (set.reps!==null && (!Number.isInteger(set.reps)||set.reps<0) || set.load!==null && (!Number.isFinite(set.load)||set.load<0)) throw new Error('Enter non-negative actual reps and load, or leave unknown values blank.');
      if (set.load!==null) Object.assign(set,{loadUnit:el('coachLoadUnit').value,loadInterpretation:el('coachLoadInterpretation').value});
      return set;
    }
    function updateActualSummary() {
      try { const set=actualSet(); el('coachActualSummary').textContent='Done confirms: '+(set.reps===null?'unknown reps':set.reps+' reps')+' · '+(activeResistance && !activeResistance.numericLoad ? set.resistanceSetup?'resistance setup confirmed':'setup unknown; progression held' : set.load===null?'load unknown':set.load+' '+set.loadUnit+(set.loadInterpretation==='per-item'?' each':' total')); } catch(error) { el('coachActualSummary').textContent=error.message; }
    }
    async function record(phase, tracker, action, elapsed) {
      if (busy) return false; return run(async () => {
        if (!phase || phase.kind!=='exercise') return true;
        if (phase.timed) await tracker.recordTimed(phase.occurrenceId,{plannedSeconds:phase.seconds,elapsedSeconds:elapsed});
        else if (action==='skip') await tracker.recordSkip(phase.occurrenceId);
        else if (isProgressionAnchor(phase)) { const set=actualSet(); await tracker.recordAnchor(phase.occurrenceId,{status:'completed',sets:[set],targetAchieved:set.reps===null?null:set.reps>=phase.exercise.prescription.value}); if (set.resistanceSetup) sessionSetups[activeResistance.requirementId]=set.resistanceSetup; }
        else await tracker.recordDone(phase.occurrenceId);
        return true;
      });
    }
    function showEnd(kind, seconds) {
      stopPlayer(); endKind=kind; endSeconds=seconds;
      const current=controller.snapshot(), work=current.interruptedDraft?current.interruptedDraft.occurrenceOutcomes:root.coachPlayerTracker().performedWork();
      el('coachResultSummary').textContent=work.filter(item=>['completed','partial'].includes(item.status)).length+' work occurrences recorded. Only performed work counts.';
      showScreen('coachResult');
    }
    async function saveFeedback(value) {
      await run(async () => { const result=await controller.finish(endKind,{difficulty:value},endSeconds); sessionActive=false;
        lastSaved=result.finalStatus==='abandoned'?'Session saved · no meaningful main work recorded.':'Session saved · '+result.finalStatus+' · '+result.anchorResults.filter(item=>item.status!=='skipped').length+' anchors recorded';
        resetOptions(); showScreen('coach'); render(); });
    }
    return {open, overview, controller, renderAnchor, record, showEnd, saveFeedback, updateActualSummary,
      isActive: () => sessionActive, run, back: () => {showScreen('coach');render();},
      init: () => { initialisation=run(() => controller.load()); return initialisation; }};
  }
  root.GarageFitCoachUI = {createController, mount};
})(typeof window !== 'undefined' ? window : globalThis);
