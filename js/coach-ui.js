(function (root) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const Model = () => root.GarageFitCoachModel;
  // Application orchestration. Programme decisions stay in the pure engine;
  // records go through the store and execution evidence through the tracker.
  function createController({store, engine, catalogue, buildTimeline, clock = () => new Date().toISOString(),
    id = prefix => prefix+':'+(root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now()+':'+Math.random()),
    definitionFor = state => root.GarageFitData.programmes[state.programmeDefinitionId][state.programmeDefinitionVersion]} = {}) {
    let state = null, results = [], preview = null, tracker = null, draft = null, pendingResult = null, preparationContext = null;
    const definition = () => definitionFor(state);
    const meaningful = (outcome, planned) => planned.section === 'main' && ['completed','partial'].includes(outcome.status)
      && (!outcome.sets || outcome.sets.some(set => set.reps > 0 || set.seconds > 0));
    async function load() {
      const listed = await store.listSessionResults();
      if (listed.errors.length) throw listed.errors[0];
      results = listed.results.slice().sort((a,b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));
      // Reconcile every persisted result, including an inactive instance, before
      // clearing a final draft. Retrying any application is an engine no-op.
      for (const result of results.filter(item => item.source === 'coach')) {
        const previous = await store.loadProgrammeState(result.programmeInstanceId);
        if (!previous) throw new Error('Saved session has no programme state.');
        const next = engine.applySessionResult(definitionFor(previous), previous, result, results);
        if (!Model().sameRecord(previous, next)) await store.saveProgrammeState(next);
      }
      const reference = await store.loadActiveProgramme();
      state = reference ? await store.loadProgrammeState(reference.programmeInstanceId) : null;
      if (reference && !state) throw new Error('The saved programme could not be loaded.');
      draft = await store.loadSessionDraft();
      if (draft && draft.finalisation.sessionResultId && results.some(item => item.sessionResultId === draft.finalisation.sessionResultId)) {
        await store.clearSessionDraft(); draft = null;
      }
      return snapshot();
    }
    function snapshot() { return {state: state && clone(state), results: clone(results.filter(item => state && item.programmeInstanceId === state.programmeInstanceId)),
      preview, interruptedDraft: draft && !tracker ? clone(draft) : null}; }
    function assess(def, equipment) { return engine.assessProgrammeFeasibility(def, {equipment}); }
    async function start(def, equipment) {
      if (draft || state && state.status !== 'completed') throw new Error('Finish the current programme before starting another.');
      const started = engine.startProgramme(def, {equipment, programmeInstanceId: id('programme')}, clock());
      if (!started.state) return started;
      await store.saveProgrammeState(started.state);
      await store.saveActiveProgramme(Model().createActiveProgramme(Model().programmeDefinitionRef(started.state)));
      state = started.state; preview = null; return started;
    }
    function today(input = {}) { return {...input, now: clock(), prescriptionId: id('prescription')}; }
    function plan(input) { return engine.planNextSession(definition(), state, results, today(input)); }
    function prepare(input) {
      if (draft || tracker) throw new Error('Save the current session before preparing another.');
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
      // Safe order: immutable evidence -> updated state -> clear the draft.
      await store.saveSessionResult(pendingResult);
      const previous = await store.loadProgrammeState(pendingResult.programmeInstanceId);
      const next = engine.applySessionResult(definitionFor(previous), previous, pendingResult, results);
      await store.saveProgrammeState(next);
      state = next;
      if (!results.some(item => item.sessionResultId === pendingResult.sessionResultId)) results.push(pendingResult);
      await store.clearSessionDraft();
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
    return {load, snapshot, assess, start, plan, prepare, alternatives, substitute, begin, finish, manage,
      review: () => engine.programmeReview(definition(), state, clock())};
  }

  function mount({catalogue, equipment, getEquipment, buildTimeline, play, showScreen, stopPlayer}) {
    let storage;
    try { storage=root.localStorage; } catch (error) { storage=null; }
    const store = root.GarageFitCoachStore.createStore(storage);
    const engine = root.GarageFitCoachEngine.createEngine({catalogue, assessSessionPrescription: root.GarageFitGenerator.assessSessionPrescription});
    const controller = createController({store, engine, catalogue, buildTimeline});
    const def = root.GarageFitData.programmes['general-strength-4w'][1];
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
    function resetOptions() { options = {duration: def.sessionTemplate.duration, equipment: getEquipment().slice(), easyToday: false, bodyFocus: null}; }
    const patternNames = {squat: 'squat', hinge: 'hinge', lunge: 'lunge', push: 'push', pull: 'pull', core: 'core', carry: 'carry'};
    function conflictText(conflicts) {
      return [...new Set((conflicts || []).map(item => {
        if (item.code === 'missing-pattern') return 'Add equipment for '+item.pattern+' work.';
        if (item.code === 'anchor-unavailable') return 'No suitable '+item.requirementId.replace('anchor-','')+' anchor is available.';
        if (['equipment-mismatch','required-anchor-unavailable','difficulty-ineligible'].includes(item.code)) return 'A required anchor is unavailable today. Restore its equipment or choose an approved substitute.';
        if (['insufficient-duration','unsupported-duration','insufficient-main-time'].includes(item.code)) return 'Required work needs a supported duration that fits. Try 30 or 45 minutes.';
        return 'A programme requirement cannot be met with today’s options. Adjust equipment or duration.';
      }))].join(' ');
    }
    function rationale(plan) {
      const patterns = plan.rationale.priorities.movements.filter(item => item.deficit > 0).map(item => patternNames[item.pattern]);
      if (plan.prescription && plan.prescription.sessionRole==='maintenance') return 'Keep your anchor challenge with fewer sets and less supporting work in '+plan.prescription.duration+' minutes.';
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
      if (current.interruptedDraft) { wrap.append(heading('Interrupted session'),paragraph('Your recorded work is safe. Save it before starting another session.'),button('Save performed work',() => showEnd('exit',null),true)); return; }
      if (!state || state.status==='completed') {
        wrap.append(paragraph('A training goal, stable anchors and sessions adapted to the work you actually do.'),button(def.name, overview, true));
        if (state) wrap.append(paragraph('Previous programme finished · '+state.meaningfulSessionsCompleted+' meaningful sessions. Your history is saved.'));
        return;
      }
      wrap.append(heading(def.name));
      const review=controller.review(), blockDays=review.nominalProgress%def.nominalDurationDays, weeks=Math.ceil(def.nominalDurationDays/7);
      const frequency=state.mode==='maintenance'?def.maintenancePolicy.frequency:def.recommendedFrequency;
      wrap.append(paragraph((review.due?'Four-week block complete':'Week '+Math.min(weeks,Math.floor(blockDays/7)+1)+' of '+weeks)+' · '+state.meaningfulSessionsCompleted+' meaningful sessions'),paragraph((state.mode==='maintenance'?'Maintenance':'Development')+' · '+frequency.minSessionsPerWeek+'–'+frequency.maxSessionsPerWeek+' sessions per week'));
      if (state.status==='paused') { wrap.append(paragraph('Paused · anchors and history preserved.'),button('Resume',() => manage('resume'),true)); }
      else if (review.due) {
        wrap.append(heading('Four-week review'),paragraph(review.meaningfulSessions+' meaningful sessions in this block'+(review.targetMet?' · Block target met':'')),
          button('Continue building',() => manage('continue'),true),button('Move to maintenance',() => manage('maintenance')),button('Finish programme',() => manage('finish')));
      } else {
        const plan=controller.plan(options), card=document.createElement('section'); card.className='coach-card'; card.append(heading('Up next'),paragraph(plan.prescription?rationale(plan):conflictText(plan.conflicts)),button('Start session', prepare,true)); wrap.append(card); renderAdjust(wrap);
      }
      const progress=document.createElement('details'), summary=document.createElement('summary'); summary.textContent='Programme progress and management'; progress.append(summary);
      state.anchors.forEach(anchor => progress.append(paragraph(catalogue[anchor.exerciseId].name+' · '+(anchor.currentTarget || anchor).targetSets+' × '+(anchor.currentTarget || anchor).target.maxReps+' reps · '+(anchor.progression && ['add-rep','reset-after-load'].includes(anchor.progression.decision)?'progressed':'holding'))));
      current.results.slice(-5).reverse().forEach(result => progress.append(paragraph(new Date(result.endedAt).toLocaleDateString()+' · '+result.finalStatus+' · '+result.performedWork.filter(work=>work.status!=='skipped').length+' work occurrences')));
      progress.append(button(state.status==='paused'?'Resume':'Pause',() => manage(state.status==='paused'?'resume':'pause')),
        button(state.mode==='maintenance'?'Return to development':'Move to maintenance',() => manage(state.mode==='maintenance'?'development':'maintenance')),button('Finish programme',() => manage('finish'))); wrap.append(progress);
    }
    function overview() {
      const assessment=controller.assess(def,getEquipment()), wrap=el('coachContent'); wrap.innerHTML='';
      const anchor=def.anchorSelectionPolicy.requirements[0];
      wrap.append(heading(def.name),paragraph(def.objective+' over a nominal four-week block. Aim for '+def.completionCriteria.blockMeaningfulSessionTarget+' meaningful sessions, at '+def.recommendedFrequency.minSessionsPerWeek+'–'+def.recommendedFrequency.maxSessionsPerWeek+' per week.'),
        paragraph(def.sessionTemplate.duration+' minutes by default; '+def.supportedDurations.filter(duration=>duration!==def.sessionTemplate.duration).join(' or ')+' minutes when needed. '+def.anchorSelectionPolicy.requirements.length+' stable squat, push and pull anchors start at '+anchor.targetSets+' × '+anchor.target.maxReps+' reps.'),
        paragraph(assessment.status==='infeasible'?'Blocked · '+conflictText(assessment.conflicts):assessment.status==='partially-feasible'?'Partially feasible · required anchors fit; supporting choices may be adjusted.':'Feasible · your equipment supports this programme.'),
        button('Set up usual equipment',() => root.openEquipment('coach')));
      if (assessment.status!=='infeasible') wrap.append(button('Start programme',async () => { await controller.start(def,getEquipment()); resetOptions(); render(); },true));
      wrap.append(button('Back',render));
    }
    function prepare() {
      const preview=controller.prepare(options);
      if (preview.status==='infeasible') { showBlocked(preview); return; }
      renderPreview(preview);
    }
    function showBlocked(preview) {
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
          const timed=block.protocol==='timed_intervals' || exercise.prescription.type.includes('timed');
          row.append(paragraph((anchor?'Required anchor · ':'')+exercise.name+' · '+(block.protocol==='timed_intervals'?block.prescription.workSeconds:exercise.prescription.value)+(timed?' sec':' reps')+(exercise.sidedness==='per-side'?' each side':'')));
          if (anchor) row.append(paragraph(anchor.plannedTarget.targetSets+' sets · '+(anchor.plannedTarget.progressionIntent || 'Confirm actual work')),button('Substitute',() => showSubstitutes(anchor.requirementId,preview.today)));
          else row.append(button('Swap',() => { root.GarageFitGenerator.swap(workout,index,exerciseIndex,{catalogue,equipment:preview.today.equipment}); renderPreview(preview); }));
          wrap.append(row);
        });
      });
      preparation('Cool-down',workout.cooldown);
      if (outcome.softRelaxations.length) wrap.append(paragraph('Some supporting choices were adjusted to keep the required work.'));
      wrap.append(button('Begin workout',async () => { const tracker=await controller.begin(); sessionActive=true; await play(workout,tracker); },true),button('Back to Coach',() => { showScreen('coach'); render(); })); showScreen('coachPreview');
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
    function renderAnchor(phase, tracker) {
      const anchor=sessionActive && phase && phase.kind==='exercise' && phase.section==='main' && phase.exercise.coachAnchor;
      el('coachAnchorLog').classList.toggle('hidden',!anchor); el('coachSkipBtn').classList.toggle('hidden',!sessionActive || !phase || phase.kind!=='exercise' || phase.timed);
      if (!anchor) return;
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
      if (set.reps!==null && (!Number.isInteger(set.reps)||set.reps<0) || set.load!==null && (!Number.isFinite(set.load)||set.load<0)) throw new Error('Enter non-negative actual reps and load, or leave unknown values blank.');
      if (set.load!==null) Object.assign(set,{loadUnit:el('coachLoadUnit').value,loadInterpretation:el('coachLoadInterpretation').value});
      return set;
    }
    function updateActualSummary() {
      try { const set=actualSet(); el('coachActualSummary').textContent='Done confirms: '+(set.reps===null?'unknown reps':set.reps+' reps')+' · '+(set.load===null?'load unknown':set.load+' '+set.loadUnit+(set.loadInterpretation==='per-item'?' each':' total')); } catch(error) { el('coachActualSummary').textContent=error.message; }
    }
    async function record(phase, tracker, action, elapsed) {
      if (busy) return false; return run(async () => {
        if (!phase || phase.kind!=='exercise') return true;
        if (phase.timed) await tracker.recordTimed(phase.occurrenceId,{plannedSeconds:phase.seconds,elapsedSeconds:elapsed});
        else if (action==='skip') await tracker.recordSkip(phase.occurrenceId);
        else if (phase.section==='main' && phase.exercise.coachAnchor) { const set=actualSet(); await tracker.recordAnchor(phase.occurrenceId,{status:'completed',sets:[set],targetAchieved:set.reps===null?null:set.reps>=phase.exercise.prescription.value}); }
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
