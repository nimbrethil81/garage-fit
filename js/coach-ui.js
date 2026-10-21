(function (root) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const Model = () => root.GarageFitCoachModel;
  const localDay = now => {
    const date = new Date(now);
    return [String(date.getFullYear()).padStart(4,'0'), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  };
  // Monday 00:00 through the next Monday in the browser's local calendar.
  // Calendar setters (not 7*24 hours) keep the boundaries correct across DST.
  function localWeek(now) {
    const start=new Date(now); start.setHours(0,0,0,0);
    start.setDate(start.getDate()-(start.getDay()+6)%7);
    const end=new Date(start); end.setDate(end.getDate()+7);
    return {start,end};
  }
  // Saved Coach results credited to this programme that ended in the current local
  // week. The applied ledger excludes saved-but-uncredited evidence; retained
  // summaries preserve a previous non-meaningful credit decision.
  function creditedThisWeek({state,results,catalogue,now}) {
    const {start,end}=localWeek(now), summaries=new Map((state.recentSessionSummaries || []).map(item=>[item.sessionResultId,item]));
    const applied=new Set([...(state.currentTargets.reconciliation?.appliedSessionResultIds || []),state.lastAppliedSessionResultId,...summaries.keys()]);
    const candidates=[...new Map(results.filter(result=>result.source==='coach' && result.programmeInstanceId===state.programmeInstanceId
      && applied.has(result.sessionResultId) && ['completed','partial'].includes(result.finalStatus)
      // Credit belongs to the local week in which the performed session ended.
      && Date.parse(result.endedAt)>=start.getTime() && Date.parse(result.endedAt)<end.getTime()
      && Date.parse(result.endedAt)<=Date.parse(now)).map(result=>[result.sessionResultId,result])).values()]
      .filter(result=>summaries.get(result.sessionResultId)?.meaningful!==false);
    return {candidates,history:root.GarageFitTrainingHistory.createHistory(candidates,catalogue),start,end};
  }
  function tennisWeeklyProgress({definition,state,results,catalogue,now}) {
    const {candidates,history,start,end}=creditedThisWeek({state,results,catalogue,now});
    // Reuse the pinned Tennis policy's performed-dose interpretation, including unknown/zero work.
    const credited=candidates.filter(result=>root.GarageFitCoachTennisPolicy.interpretDose({definition,state,result,history,
        evidence:history.sessionEvidence(result.sessionResultId)}).meaningful);
    const count=credited.length;
    const target=state.currentTargets.programmeSettings.weeklyCoachFrequency;
    // Labels come from the result's recorded role id and the pinned definition, never the current rotation.
    const labels=new Map(Object.values(definition.sessionRoles || {}).flat().map(role=>[role.id,role.label]));
    const roles=credited.slice().sort((a,b)=>Date.parse(a.endedAt)-Date.parse(b.endedAt)).map(result=>({
      sessionResultId:result.sessionResultId,roleId:result.sessionRole || null,
      label:labels.get(result.sessionRole) || 'Workout type unavailable',partial:result.finalStatus==='partial'}));
    return {count,target,filled:Math.min(count,target),roles,start:start.toISOString(),end:end.toISOString()};
  }
  // Short plain-English purpose per Tennis role id (presentation copy only).
  const ROLE_PURPOSES={'full-body':'Trains the whole body for tennis in one session.',
    'strength-stability':'Builds strength and stability for your legs, upper body and trunk.',
    'movement-conditioning':'Builds court movement, power and conditioning.',
    'strength':'Builds strength in your legs, upper body and trunk.',
    'movement-power':'Builds court movement and power.',
    'conditioning-resilience':'Builds conditioning and resilience.'};
  // Where each programme message belongs in the Coach preview. `status` is a subdued
  // adjustment label, `notices` stay visible with a remedy, and `why` is the collapsed
  // Why this workout? explanation. Unknown warning codes stay visible rather than
  // being hidden. The Generator's own main-underfilled diagnostic was never shown.
  function previewMessages({plan, workout, state, catalogue}) {
    const context=plan.prescription.programmeContext, status=[], notices=[], why=[];
    if ((workout.prescriptionOutcome?.softRelaxations || []).length) status.push('Adjusted · Some supporting choices changed to keep your strength targets.');
    const deferred=(context.deferredAnchorRequirementIds || []).map(id=>state.anchors.find(anchor=>anchor.requirementId===id)).filter(Boolean);
    if (deferred.length) why.push('Not scheduled today · '+deferred.map(anchor=>catalogue[anchor.exerciseId].name).join(', ')+'. Their targets are retained; this is not failed or skipped work.');
    const unavailable=context.maintenanceUnavailable || [];
    if (unavailable.length) {
      notices.push('Today’s equipment cannot provide '+unavailable.join(', ')+' maintenance. Add suitable equipment when available.');
      why.push('Maintenance that today’s equipment cannot provide creates no catch-up debt.');
    }
    // Capability diagnostics are not actionable today; group them in plain language.
    const labels=new Map((plan.rationale.priorities.coverage?.capabilities || []).map(cap=>[cap.capabilityId,cap.label]));
    const warnings=context.warnings || [], codes=code=>warnings.filter(warning=>warning.code===code);
    const impossible=codes('tennis-capability-unavailable'), blocked=new Set(impossible.map(warning=>warning.capabilityId));
    const label=warning=>labels.get(warning.capabilityId) || warning.capabilityId.replaceAll('-',' ');
    warnings.forEach(warning => {
      if (warning.code==='tennis-session-role-unavailable') {
        status.push('Adjusted · Today’s planned session type has no target that fits, so another type was chosen.'); why.push(warning.message);
      } else if (warning.code==='tennis-anchor-unavailable') notices.push(warning.message+' Try more time or restore its equipment to include it.');
      else if (warning.code==='tennis-capability-time-limit') why.push(warning.message);
      else if (!['tennis-capability-unavailable','tennis-capability-facets-unavailable'].includes(warning.code)) notices.push(warning.message || 'A programme requirement could not be fully met today.');
    });
    if (impossible.length) why.push('Not possible with today’s equipment, space or session limits: '+impossible.map(label).join(', ')+'.');
    const partial=codes('tennis-capability-facets-unavailable').filter(warning=>!blocked.has(warning.capabilityId));
    if (partial.length) why.push('Partly limited today, so no coverage is assumed: '+partial.map(warning=>label(warning)+' ('+warning.facets.join(', ').replaceAll('-',' ')+')').join(', ')+'.');
    return {status, notices, why};
  }
  let policyRegistry=null;
  // General Strength and Build Arms use their own pinned policy's meaningful-work
  // rule (any performed main work), never Tennis dose interpretation. Their
  // weekly frequency is a fixed range or aim from the versioned definition.
  function programmeWeeklyProgress({definition,state,results,catalogue,now}) {
    if (definition.type==='tennis-conditioning') {
      const weekly=tennisWeeklyProgress({definition,state,results,catalogue,now});
      return {...weekly,minimum:weekly.target,label:weekly.count+' of '+weekly.target+' sessions this week',note:null};
    }
    const policy=(policyRegistry=policyRegistry || root.GarageFitCoachPolicies.createDefaultRegistry()).get(definition.type);
    const {candidates,history,start,end}=creditedThisWeek({state,results,catalogue,now});
    const count=candidates.filter(result=>policy.interpretDose({definition,state,result,history,
      evidence:history.sessionEvidence(result.sessionResultId)}).meaningful).length;
    const maintenance=state.mode==='maintenance', frequency=maintenance?definition.maintenancePolicy.frequency:definition.recommendedFrequency;
    const plural=value=>value===1?' session':' sessions';
    const aim=!maintenance && frequency.aimSessionsPerWeek;
    const target=aim || frequency.maxSessionsPerWeek;
    return {count,target,minimum:frequency.minSessionsPerWeek,filled:Math.min(count,target),start:start.toISOString(),end:end.toISOString(),
      label:aim ? count+' of '+aim+plural(aim)+' this week' : count+plural(count)+' this week',
      note:aim ? frequency.minSessionsPerWeek+' is acceptable' : frequency.minSessionsPerWeek+'–'+frequency.maxSessionsPerWeek+' recommended'+(maintenance?' in maintenance':'')};
  }
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
    let state = null, results = [], preview = null, previewKey = null, tracker = null, draft = null, pendingResult = null, preparationContext = null;
    const definition = () => definitionFor(state);
    const meaningful = root.GarageFitCoachRecovery.meaningful;
    const recovery = root.GarageFitCoachRecovery.createRecovery({store, engine, definitionFor});
    let errors = [], blocked = false;
    async function recentHistory() {
      if (!state) { results = []; return; }
      const def = definition(), now=clock(), since = new Date(Math.min(localWeek(now).start.getTime(),
        Date.parse(now) - Math.max(def.coverageTargets.windowDays, def.doseTargets.windowDays || 0) * 86400000)).toISOString();
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
        if (state) engine.validateProgrammeState(definition(),state);
        await recentHistory();
      } catch (error) { errors.push(error); blocked = true; state = null; }
      return snapshot();
    }
    function snapshot() { return {state: state && clone(state), results: clone(results.filter(item => state && item.programmeInstanceId === state.programmeInstanceId)),
      preview, errors: errors.slice(), blocked, interruptedDraft: draft && !tracker ? clone(draft) : null}; }
    function assess(def, equipment, programmeSettings) { return engine.assessProgrammeFeasibility(def,
      {equipment, ...(programmeSettings === undefined ? {} : {programmeSettings})}); }
    async function start(def, equipment, programmeSettings) {
      if (blocked) throw new Error('Resolve the saved programme error before starting another.');
      if (draft || state && state.status !== 'completed') throw new Error('Finish the current programme before starting another.');
      const now = clock();
      const started = engine.startProgramme(def, {equipment, programmeInstanceId: id('programme'),
        ...(def.contextPolicy ? {localDate: localDay(now)} : {}),
        ...(programmeSettings === undefined ? {} : {programmeSettings})}, now);
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
    // Everything that shapes today's session: the user's choices (not the request
    // time or id), the local day, the programme state and the performed history.
    function preparationKey(input) {
      const {now, prescriptionId, localDate, ...choices} = input || {};
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      return JSON.stringify(canonical({choices, day: localDay(clock()), state, results: results.map(item => item.sessionResultId)}));
    }
    function prepare(input) {
      if (draft || tracker) throw new Error('Save the current session before preparing another.');
      preview = null; previewKey = null;
      const key = preparationKey(input), context = today(input), plan = engine.planNextSession(definition(), state, results, context);
      preparationContext = context;
      if (!plan.prescription) return {status: 'infeasible', plan, today: context};
      const history = results.filter(item => item.programmeInstanceId === state.programmeInstanceId).slice(-4).reverse()
        .map(item => [...new Set((item.performedWork || []).filter(work => ['completed','partial'].includes(work.status)).map(work => work.exerciseId))]);
      const workout = root.GarageFitGenerator.generate({catalogue, sessionPrescription: plan.prescription, history, recentProtocols:root.GarageFitGenerator.recentProtocolsFromResults(results)});
      preview = {workout, plan, today: context, generatedAt: clock()}; previewKey = key;
      return preview;
    }
    // Reopening an unchanged preview returns the same prepared (and possibly
    // edited) session. Changed choices, day, state or history prepare afresh.
    function previewToday(input) {
      if (draft || tracker) throw new Error('Save the current session before preparing another.');
      return preview && previewKey === preparationKey(input) ? preview : prepare(input);
    }
    function alternatives(requirementId, context) { return engine.getAnchorAlternatives(definition(), state, today(context), requirementId); }
    function substitute(requirementId, exerciseId, context) {
      const input = context || preparationContext || preview && preview.today;
      if (!input) throw new Error('Prepare today’s session first.');
      return prepare({...input, anchorSubstitutions: {...(preparationContext && preparationContext.anchorSubstitutions), [requirementId]: exerciseId}});
    }
    function restore(requirementId) {
      const input = preparationContext || preview && preview.today;
      if (!input) throw new Error('Prepare today’s session first.');
      const anchorSubstitutions = {...input.anchorSubstitutions};
      delete anchorSubstitutions[requirementId];
      return prepare({...input, anchorSubstitutions});
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
        const next = engine.beginSession(definition(),state,preview.plan.prescription,clock());
        if (!Model().sameRecord(next,state)) {
          await store.saveProgrammeState(next);
          state = next;
        }
        tracker = root.GarageFitSessionTracker.createTracker({store, clock, source: 'coach', draftId: id('draft'),
          programmeInstanceId: state.programmeInstanceId, prescriptionId: preview.plan.prescription.prescriptionId,
          workoutId: preview.workout.id, sessionRole: preview.plan.prescription.sessionRole, generatedAt: preview.generatedAt, plannedWork, meaningful,
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
    async function saveProgrammeChange(change) {
      if (blocked || !state) throw new Error('Load a valid programme before changing it.');
      if (draft || tracker || pendingResult) throw new Error('Save the session before changing the programme.');
      if (await store.loadSessionDraft()) throw new Error('Save the session before changing the programme.');
      // Read the durable state, so saving preferences cannot overwrite reconciled work.
      const reference = await store.loadActiveProgramme();
      const previous = await store.loadProgrammeState(state.programmeInstanceId);
      const expected = Model().createActiveProgramme(Model().programmeDefinitionRef(state));
      if (!previous || !Model().sameRecord(reference, expected)
        || !Model().sameRecord(Model().programmeDefinitionRef(previous), Model().programmeDefinitionRef(state))) {
        throw new Error('The active programme changed. Reload Coach before saving settings.');
      }
      const next = change(definitionFor(previous), previous);
      await store.saveProgrammeState(next);
      state = next; preview = null; preparationContext = null;
      await recentHistory();
      return clone(next);
    }
    const saveProgrammeSettings = patch => saveProgrammeChange((def,previous) => {
      const now = clock();
      return engine.updateProgrammeSettings(def,previous,patch,{now,localDate:localDay(now)});
    });
    const saveSportReview = response => saveProgrammeChange((def,previous) => engine.recordSportReview(def,previous,response,clock()));
    return {load, snapshot, assess, start, plan, prepare, previewToday, alternatives, substitute, restore, begin, finish, manage, saveProgrammeSettings,
      saveSportReview, sportReview: () => engine.sportReview(definition(),state,clock()),
      review: () => engine.programmeReview(definition(), state, clock())};
  }

  function mount({catalogue, equipment, getEquipment, setEquipment, buildTimeline, play, showScreen, stopPlayer}) {
    let storage;
    try { storage=root.localStorage; } catch (error) { storage=null; }
    const store = root.GarageFitCoachStore.createStore(storage);
    const engine = root.GarageFitCoachEngine.createEngine({catalogue, assessSessionPrescription: root.GarageFitGenerator.assessSessionPrescription});
    const controller = createController({store, engine, catalogue, buildTimeline});
    const programmes = Object.values(root.GarageFitData.programmes).map(versions => versions[Math.max(...Object.keys(versions).map(Number))]);
    let def = programmes[0], activeResistance = null, sessionSetups = {};
    const el = id => document.getElementById(id);
    let options = null, busy = false, sessionActive = false, endKind = null, endSeconds = null, lastSaved = '', initialisation = Promise.resolve(), adjustmentOpen = false, previewEditing = false, disclosureOpen = {};
    function button(text, action, primary = false) {
      const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
      node.className = primary ? 'generator-primary' : 'ctrl-btn ctrl-secondary'; node.onclick = () => run(action); return node;
    }
    function paragraph(text) { const node = document.createElement('p'); node.textContent = text; return node; }
    function heading(text) { const node = document.createElement('h2'); node.textContent = text; return node; }
    const tennisViews = root.GarageFitCoachTennisUI.createViews({button,paragraph,heading,catalogue});
    const progressViews = root.GarageFitCoachProgressUI.createViews({button,paragraph,heading,catalogue});
    const isTennis = () => def.type === 'tennis-conditioning';
    async function run(action) {
      if (busy) return; busy = true;
      const focused=document.activeElement, focusLabel=focused?.getAttribute?.('aria-label'), focusText=focused?.textContent;
      const messages=['coachError','coachPreviewError','coachResultError','coachProgressError','coachSettingsError'];
      [...messages,'coachPlayerError'].forEach(id => {el(id).textContent='';});
      try { return await action(); }
      catch (error) { messages.forEach(id => {el(id).textContent=error.message;}); el('coachPlayerError').textContent = 'Could not save. '+error.message+' Try again before leaving.'; }
      finally {
        busy = false;
        // A rerender replaces controls; return keyboard focus to the same control.
        if (focused?.isConnected===false) ['coachContent','coachPreviewContent','coachProgressContent','coachSettingsContent'].flatMap(id=>[...el(id).querySelectorAll('button,select,input,summary')])
          .find(node=>focusLabel ? node.getAttribute('aria-label')===focusLabel : node.textContent===focusText)?.focus();
      }
    }
    function resetOptions() {
      previewEditing = false;
      const state = controller.snapshot().state;
      if (state) def = root.GarageFitData.programmes[state.programmeDefinitionId][state.programmeDefinitionVersion];
      options = {duration: def.sessionTemplate.duration, equipment: getEquipment().slice(), easyToday: false, bodyFocus: null};
      if (def.contextPolicy) options.sessionContext = {readiness: {value:'normal',localDate:localDay(new Date().toISOString())}};
      adjustmentOpen = false;
      disclosureOpen = {};
    }
    const patternNames = {squat: 'squat', hinge: 'hinge', lunge: 'lunge', push: 'push', pull: 'pull', core: 'core', carry: 'carry'};
    function conflictText(conflicts) {
      return [...new Set((conflicts || []).map(item => {
        if (item.code === 'tennis-rest-recommended') return item.message;
        if (item.code === 'missing-pattern') return 'Add equipment for '+item.pattern+' work.';
        if (item.code === 'recovery-interval') return 'Take more recovery time before your next workout.';
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
      if (isTennis()) return tennisViews.whyToday(plan);
      const adaptation = plan.rationale.priorities.adaptation;
      if (adaptation && adaptation.recommendation) return adaptation.recommendation;
      const event = plan.rationale.priorities.event;
      if (event) return event.rationale+' '+event.evidenceNote
        +(adaptation ? ' '+adaptation.reasons.filter(reason => reason !== event.rationale).join(' · ') : '');
      const phase = plan.rationale.priorities.phase;
      if (phase) return phase.rationale+' '+phase.evidenceNote
        +(adaptation && adaptation.reasons.length ? ' '+adaptation.reasons.join(' · ')+'.' : '');
      if (adaptation && adaptation.reasons.length && plan.prescription) return adaptation.reasons.join(' · ')+'. Selected work fits '+plan.prescription.duration+' minutes with preparation and rest.';
      if (plan.prescription && plan.prescription.programmeContext.roleLabel) return plan.prescription.programmeContext.roleLabel+' today: selected targets fit '+plan.prescription.duration+' minutes with preparation and rest. Keep about 2 reps in reserve on strength anchors.';
      const patterns = plan.rationale.priorities.movements.filter(item => item.deficit > 0).map(item => patternNames[item.pattern]);
      if (plan.prescription && plan.prescription.sessionRole==='maintenance') return 'Keep your anchor challenge with fewer sets and less supporting work in '+plan.prescription.duration+' minutes.';
      if (plan.rationale.priorities.directDose) return 'Direct arm anchors first; whole-body maintenance follows'+(patterns.length ? ' with attention to '+patterns.slice(0,3).join(', ') : '')+'.';
      return plan.prescription && plan.prescription.duration < def.sessionTemplate.duration ? 'Shorter session today: keeping required anchors and reducing supporting work.'
        : patterns.length ? 'Prioritising '+patterns.slice(0,3).join(', ')+' from your recent performed work.' : 'Keep your anchors steady and maintain whole-body coverage.';
    }
    async function open() { showScreen('coach'); await initialisation; await run(async () => {
      await controller.load(); lastSaved='';
      resetOptions(); render();
    }); }
    function renderToday(focusLabel) {
      render();
      // Replanning replaces the controls; keep keyboard focus on the same choice.
      const controls=el('coachContent').querySelectorAll('button,select,input');
      [...controls].find(node=>node.getAttribute('aria-label')===focusLabel || node.textContent===focusLabel)?.focus();
    }
    function renderAdjust(wrap) {
      const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Adjust today'; details.className = 'generator-options'; details.append(summary);
      details.id='coachAdjustToday';
      const readiness=options.sessionContext?.readiness?.value || 'normal';
      // Summarise the actual choices; non-Tennis programmes have no readiness or sport settings.
      const values=[...(def.contextPolicy ? [readiness.charAt(0).toUpperCase()+readiness.slice(1)] : []),options.duration+' min available',
        options.equipment.length ? equipment.filter(item=>options.equipment.includes(item.id)).map(item=>item.name).join(', ') : 'Bodyweight only'];
      if (options.easyToday) values.push('Easy today');
      if (options.bodyFocus) values.push(options.bodyFocus.charAt(0).toUpperCase()+options.bodyFocus.slice(1)+' emphasis');
      if (isTennis()) {
        const config=controller.snapshot().state.currentTargets.programmeSettings;
        if (config.focus!=='balanced') values.push('Focus: '+tennisViews.focusName(config.focus));
        if (config.usualPlayingDays.length) values.push('Tennis: '+config.usualPlayingDays.map(day=>day.slice(0,3)).join(', '));
        if (config.typicalSportIntensity!=='moderate') values.push(config.typicalSportIntensity+' tennis');
        if (config.intent==='event') values.push('Event: '+config.significantEventDate);
      }
      if (Object.keys(options.anchorSubstitutions || {}).length) values.push('Anchor substitution today');
      const value=document.createElement('span'); value.className='coach-adjust-summary';
      value.textContent=values.join(' · '); summary.appendChild(value);
      summary.setAttribute('aria-label','Adjust today · '+value.textContent);
      details.open = adjustmentOpen; details.ontoggle = () => { if (details.isConnected!==false) adjustmentOpen = details.open; };
      const durations = document.createElement('div'); durations.className = 'choice-row';
      const unavailable = [];
      def.supportedDurations.forEach(value => {
        const item = button(value+' min', () => { options.duration = value; adjustmentOpen=true; renderToday(value+' min'); });
        item.setAttribute('aria-pressed', String(options.duration === value));
        if (isTennis()) {
          const plan = controller.plan({...options,duration:value});
          if (!plan.prescription && !plan.conflicts.some(conflict => conflict.code==='tennis-rest-recommended')) {
            item.disabled = true; item.setAttribute('aria-label',value+' minutes unavailable with today’s options'); unavailable.push(value);
          }
        }
        durations.append(item);
      });
      details.append(heading('Available time'), durations);
      if (unavailable.length) details.append(help('About unavailable durations',unavailable.join('/')+' minutes cannot fit useful work with today’s options. Try a longer duration, restore equipment or use an approved substitute.'));
      if (def.contextPolicy) {
        const readiness = tennisViews.selectField('Readiness today (optional)',[['fresh','Fresh'],['normal','Normal'],['tired','Tired']],options.sessionContext?.readiness?.value || 'normal');
        readiness.select.onchange = () => {
          options.sessionContext = {...options.sessionContext,readiness:{value:readiness.select.value,localDate:localDay(new Date().toISOString())}};
          adjustmentOpen=true; renderToday('Readiness today (optional)');
        };
        details.append(readiness.field,help('About readiness','Normal if unanswered. This check-in affects today’s session, not your persistent targets.'));
      }
      const easy = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = options.easyToday;
      check.setAttribute('aria-label','Easy today');
      check.onchange = () => { options.easyToday = check.checked; adjustmentOpen=true; renderToday('Easy today'); }; easy.append(check, paragraph('Easy today · progression held')); details.append(easy);
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Body emphasis');
      [['','Whole body'],['upper','Upper'],['lower','Lower'],['core','Core']].forEach(([value,label]) => { const option = document.createElement('option'); option.value=value; option.textContent=label; select.append(option); });
      select.value=options.bodyFocus || ''; select.onchange=() => { options.bodyFocus=select.value || null; adjustmentOpen=true; renderToday('Body emphasis'); }; if (!isTennis()) details.append(heading('Body emphasis'), select);
      details.append(heading('My Equipment'));
      const kit = document.createElement('div'); kit.className = 'equipment-list';
      equipment.forEach(item => { const control = button(item.name, () => { const owned=getEquipment(); setEquipment(owned.includes(item.id) ? owned.filter(id => id !== item.id) : [...owned,item.id]); adjustmentOpen=true; renderToday(item.name); }); control.setAttribute('aria-pressed',String(options.equipment.includes(item.id))); kit.append(control); });
      details.append(kit,help('About My Equipment','Saved across GarageFit for future workouts. Already prepared workouts and workouts in progress keep their original equipment and exercises.')); wrap.append(details);
    }
    // Accessible tappable help rather than long inline explanations.
    function help(label,copy) {
      const info=document.createElement('details'), control=document.createElement('summary');
      info.className='coach-help'; control.textContent='ⓘ '+label; control.setAttribute('aria-label',label);
      info.append(control,paragraph(copy)); retainDisclosure(info,label); return info;
    }
    function render() {
      // Ownership is shared. Only future planning reads the latest selection;
      // prepared prescriptions and live trackers retain their original context.
      if (options) options.equipment=getEquipment().slice();
      const wrap=el('coachContent'); wrap.innerHTML=''; const current=controller.snapshot(), state=current.state;
      if (current.errors.length) {
        wrap.append(paragraph('Some Coach records could not be recovered. Saved evidence has been retained.'),
          ...current.errors.map(error => paragraph(error.message)), button('Retry recovery', async () => { await controller.load(true); resetOptions(); render(); }));
        if (current.blocked) return;
      }
      if (current.interruptedDraft) { wrap.append(heading('Interrupted session'),paragraph('Your recorded work is safe. Save it before starting another session.'),button('Save performed work',() => showEnd('exit',null),true)); return; }
      if (!state || state.status==='completed') {
        wrap.append(paragraph('A training goal, stable anchors and sessions adapted to the work you actually do.'));
        wrap.append(heading('Strength & fitness'));
        programmes.filter(programme => programme.type !== 'tennis-conditioning').forEach(programme => wrap.append(button(programme.name, () => { def=programme; overview(); }, true)));
        wrap.append(heading('Cross-training'));
        programmes.filter(programme => programme.type === 'tennis-conditioning').forEach(programme => wrap.append(button('Tennis', () => { def=programme; overview(); }, true)));
        if (state) wrap.append(paragraph('Previous programme finished · '+state.meaningfulSessionsCompleted+' meaningful sessions. Your history is saved.'));
        return;
      }
      def = root.GarageFitData.programmes[state.programmeDefinitionId][state.programmeDefinitionVersion];
      renderHome(wrap,current);
    }
    function retainDisclosure(details,key) {
      if (Object.prototype.hasOwnProperty.call(disclosureOpen,key)) details.open=disclosureOpen[key];
      details.ontoggle=()=>{if (details.isConnected!==false) disclosureOpen[key]=details.open;};
    }
    // The approved compact Coach home for every programme: title and status, this
    // week's credited sessions, collapsed Adjust today, the workout CTA, then the
    // shared Your progress and Programme settings destinations.
    function renderHome(wrap, current) {
      const state=current.state, now=new Date().toISOString(), tennis=isTennis();
      if (options.sessionContext?.readiness && options.sessionContext.readiness.localDate!==localDay(now))
        options.sessionContext.readiness={value:'normal',localDate:localDay(now)};
      const review=def.openEnded?null:controller.review(), reviewDue=!!review?.due && state.status==='active';
      const plan=state.status==='active' && !sessionActive && !reviewDue?controller.plan(options):null;
      const intro=document.createElement('div'), title=document.createElement('div'), status=document.createElement('span');
      intro.className='coach-tennis-intro'; title.className='coach-programme-heading'; status.className='coach-status';
      status.textContent=reviewDue && !sessionActive?'Review due':programmeStatus(state);
      title.append(heading(def.name),status); intro.append(title,paragraph(def.objective));
      if (review && !reviewDue) {
        const weeks=Math.ceil(def.nominalDurationDays/7);
        intro.append(paragraph('Week '+Math.min(weeks,Math.floor(review.nominalProgress%def.nominalDurationDays/7)+1)+' of '+weeks+' · four-week block'));
      }
      wrap.append(intro);
      const weekly=programmeWeeklyProgress({definition:def,state,results:current.results,catalogue,now});
      const progressCard=document.createElement('section'), segments=document.createElement('div');
      progressCard.className='coach-weekly'; segments.className='coach-weekly-segments'; segments.setAttribute('aria-hidden','true');
      progressCard.setAttribute('aria-label','Current week, Monday to Sunday');
      progressCard.append(paragraph(weekly.label));
      for(let index=0;index<weekly.target;index++) {
        const segment=document.createElement('span');
        // Filled segments show actual credited sessions; outlined ones mark the minimum.
        segment.className=[index<weekly.filled?'filled':'',index<weekly.minimum && weekly.minimum<weekly.target?'minimum':''].filter(Boolean).join(' ');
        segments.append(segment);
      }
      progressCard.append(segments);
      if (weekly.roles && weekly.roles.length) {
        const list=document.createElement('ul'); list.className='coach-weekly-roles'; list.setAttribute('aria-label','Workouts completed this week');
        weekly.roles.forEach(item=>{const li=document.createElement('li'); li.textContent='✓ '+item.label+(item.partial?' (partial)':''); list.append(li);});
        progressCard.append(list);
      }
      if (weekly.note) progressCard.append(help('About this week',weekly.label+'. '+weekly.note+'. Credited sessions with performed main work count; previews, drafts and sessions without performed main work do not. No catch-up debt.'));
      wrap.append(progressCard);
      if (sessionActive) {
        const card=document.createElement('section'); card.className='coach-card';
        card.append(heading('Workout in progress'),button('Return to workout',()=>showScreen('workoutPlayer'),true)); wrap.append(card); return;
      }
      if (state.status==='paused') wrap.append(paragraph('Paused · anchors and history preserved.'),button('Resume',() => manage('resume'),true));
      else if (reviewDue) {
        const card=document.createElement('section'); card.className='coach-card coach-review';
        card.append(heading('Four-week review'),paragraph(review.meaningfulSessions+' meaningful sessions in this block'+(review.targetMet?' · Block target met':'')),
          button('Continue building',() => manage('continue'),true),button('Move to maintenance',() => manage('maintenance')),
          button('Finish programme',()=>{openSettings();confirmingFinish=true;renderSettings();}));
        wrap.append(card);
      }
      else {
        renderAdjust(wrap);
        const card=document.createElement('section'); card.className='coach-card';
        const role=plan.prescription?.programmeContext.roleLabel;
        const rest=plan.conflicts.some(item=>item.code==='tennis-rest-recommended');
        const expired=plan.rationale.priorities.event?.phase==='expired';
        card.append(heading(expired ? 'Event date has passed' : plan.prescription ? 'Today’s workout' : rest ? 'Rest today' : 'Adjust today’s options'));
        if (plan.prescription) {
          card.append(paragraph([role,plan.prescription.duration+' min'].filter(Boolean).join(' · ')),button('View today’s workout',prepare,true));
          if (tennis && role && ROLE_PURPOSES[plan.prescription.sessionRole]) card.append(paragraph(ROLE_PURPOSES[plan.prescription.sessionRole]));
          const event=plan.rationale.priorities.event;
          if (event && ['reduced','final'].includes(event.phase)) card.append(paragraph(event.rationale));
          if (!tennis) card.append(help('Why this workout',rationale(plan)));
        }
        else if (expired) card.append(button('Continue ongoing training',async()=>{
          await controller.saveProgrammeSettings({intent:'ongoing',significantEventDate:null,significantEventLabel:null});render();
        },true),button('Change event date',()=>{openSettings();el('coachSettingsContent').querySelector('input[aria-label="Important event date"]')?.focus();}));
        else if (rest) card.append(paragraph(conflictText(plan.conflicts)));
        else {
          card.append(paragraph(conflictText(plan.conflicts)),paragraph('Try more time, restore equipment or choose a compatible substitute.'+(tennis?' You can also rest.':'')));
          state.anchors.forEach(anchor=>card.append(button('Substitute '+catalogue[anchor.exerciseId].name,()=>showSubstitutes(anchor.requirementId,options))));
        }
        wrap.append(card);
      }
      if (lastSaved) wrap.append(paragraph(lastSaved));
      if (def.sportReviewPolicy && controller.sportReview()?.due) wrap.append(paragraph('An optional tennis check-in is ready in Your progress.'));
      wrap.append(progressLink(),settingsLink());
    }
    function progressLink() {
      const link=button('Your progress',openProgress); link.classList?.add('coach-destination'); return link;
    }
    function settingsLink() {
      const link=button('Programme settings',openSettings); link.classList?.add('coach-destination'); return link;
    }
    let settingsNotice='', confirmingFinish=false;
    function openSettings() {
      settingsNotice=''; confirmingFinish=false;
      renderSettings(); showScreen('coachSettings');
      el('coachSettings').querySelector?.('.back-btn')?.focus?.();
    }
    // Rows that the programme definition fixes; they are shown, never edited.
    function readOnlyRows(wrap, rows) {
      const list=document.createElement('dl'); list.className='coach-settings-rows';
      rows.forEach(([label,value])=>{
        const term=document.createElement('dt'), detail=document.createElement('dd'); term.textContent=label; detail.textContent=value; list.append(term,detail);
      });
      wrap.append(list);
    }
    // One settings destination for every programme. Only the active programme's
    // existing settings and lifecycle commands render; nothing new is editable.
    function renderSettings() {
      const wrap=el('coachSettingsContent'); wrap.innerHTML='';
      const current=controller.snapshot(), state=current.state;
      if (!state || state.status==='completed' || current.blocked) {
        wrap.append(paragraph('No active programme. Your saved history is retained.'),button('Back to Coach',()=>{showScreen('coach');render();}));
        return;
      }
      def=root.GarageFitData.programmes[state.programmeDefinitionId][state.programmeDefinitionVersion];
      const locked=sessionActive || !!current.interruptedDraft;
      const intro=document.createElement('div'), title=document.createElement('div'), status=document.createElement('span');
      intro.className='coach-tennis-intro'; title.className='coach-programme-heading'; status.className='coach-status';
      status.textContent=programmeStatus(state); title.append(heading(def.name),status); intro.append(title,paragraph(def.objective)); wrap.append(intro);
      if (settingsNotice) { const notice=paragraph(settingsNotice); notice.setAttribute('role','status'); wrap.append(notice); }
      if (locked) wrap.append(paragraph('Save or finish your current workout before changing programme settings. Your recorded work is safe.'));
      const plan=progressViews.section('Training plan','coach-settings-plan');
      const review=def.openEnded?null:controller.review();
      const durations=def.sessionTemplate.duration+' min by default; '+def.supportedDurations.filter(value=>value!==def.sessionTemplate.duration).join(', ')+' min also supported';
      if (isTennis()) {
        const config=state.currentTargets.programmeSettings, development=state.currentTargets.tennisDevelopment;
        readOnlyRows(plan,[['Training phase',development?.phase==='consolidation'?'Consolidation':'Development'],
          ['Strength targets',state.anchors.length+' stable targets keep their progress when settings change']]);
        if (locked) readOnlyRows(plan,[['Training focus',tennisViews.focusName(config.focus)],['GarageFit sessions per week',String(config.weeklyCoachFrequency)],
          ['Usual tennis playing days',config.usualPlayingDays.length?config.usualPlayingDays.map(day=>day.charAt(0).toUpperCase()+day.slice(1,3)).join(', '):'Irregular / no fixed days'],
          ['Typical tennis intensity',config.typicalSportIntensity.charAt(0).toUpperCase()+config.typicalSportIntensity.slice(1)],
          ['Training intent',config.intent==='event'?'Event · '+(config.significantEventLabel?config.significantEventLabel+' · ':'')+config.significantEventDate:'Ongoing development']]);
        else {
          const form=tennisViews.settingsForm(config);
          plan.append(form.wrap,button('Save tennis settings',async()=>{
            await controller.saveProgrammeSettings(form.read()); settingsNotice='Tennis settings saved.'; renderSettings();
          },true));
          if (def.eventPolicy) renderEventSettings(plan,state);
        }
      } else {
        const strength=!def.openEnded, frequency=def.recommendedFrequency;
        plan.append(paragraph('Set by the programme; these are not editable.'));
        readOnlyRows(plan,[
          ['Sessions per week',strength ? frequency.minSessionsPerWeek+'–'+frequency.maxSessionsPerWeek+' in development; '
            +def.maintenancePolicy.frequency.minSessionsPerWeek+'–'+def.maintenancePolicy.frequency.maxSessionsPerWeek+' in maintenance'
            : 'Aim for '+frequency.aimSessionsPerWeek+'; '+frequency.minSessionsPerWeek+' is acceptable'],
          ['Mode',strength ? (state.mode==='maintenance'?'Maintenance':'Development') : 'Open-ended development · no maintenance mode'],
          ...(strength ? [['Four-week block',review.due?'Block complete · review due':'Week '+Math.min(Math.ceil(def.nominalDurationDays/7),Math.floor(review.nominalProgress%def.nominalDurationDays/7)+1)
            +' of '+Math.ceil(def.nominalDurationDays/7)+' · aim for '+def.completionCriteria.blockMeaningfulSessionTarget+' meaningful sessions']] : []),
          ...(def.doseTargets.directElbowActions ? [['Direct arm work',def.doseTargets.directElbowActions.flexion+' curl and '+def.doseTargets.directElbowActions.extension
            +' extension set exposures per rolling '+def.doseTargets.windowDays+' days']] : []),
          ['Session length',durations],
          ['Strength targets',state.anchors.length+' stable targets']]);
      }
      wrap.append(plan);
      const manageSection=progressViews.section('Programme management','coach-settings-management');
      readOnlyRows(manageSection,[['Status',state.status==='paused'?'Paused · targets and history preserved':'Active']]);
      if (!locked) {
        const act=action=>async()=>{ await controller.manage(action); resetOptions(); settingsNotice=''; confirmingFinish=false; renderSettings(); };
        if (review?.due && state.status==='active') {
          manageSection.append(heading('Four-week review'),paragraph(review.meaningfulSessions+' meaningful sessions in this block'+(review.targetMet?' · Block target met':'')),
            button('Continue building',act('continue'),true),button('Move to maintenance',act('maintenance')));
        } else if (def.supportsMaintenanceMode!==false && !def.openEnded) {
          manageSection.append(button(state.mode==='maintenance'?'Return to development':'Move to maintenance',act(state.mode==='maintenance'?'development':'maintenance')));
        }
        manageSection.append(button(state.status==='paused'?'Resume':'Pause',act(state.status==='paused'?'resume':'pause')));
        if (!confirmingFinish) manageSection.append(button('Finish programme',()=>{confirmingFinish=true;renderSettings();el('coachSettingsContent').querySelector?.('.coach-finish-confirm button')?.focus?.();}));
        else {
          const confirm=document.createElement('div'); confirm.className='coach-finish-confirm'; confirm.setAttribute('role','group'); confirm.setAttribute('aria-label','Confirm finish programme');
          confirm.append(paragraph('Finish '+def.name+'? This ends the programme. Your targets and session history stay saved, and you can start a new programme afterwards.'),
            button('Confirm finish programme',async()=>{ await controller.manage('finish'); resetOptions(); confirmingFinish=false; showScreen('coach'); render(); },true),
            button('Keep programme',()=>{confirmingFinish=false;renderSettings();}));
          manageSection.append(confirm);
        }
      }
      wrap.append(manageSection);
    }
    function programmeStatus(state) {
      if (state.status==='paused') return 'Paused';
      if (sessionActive) return 'Workout in progress';
      if (isTennis()) return state.currentTargets.programmeSettings.intent==='event'?'Event preparation'
        : state.currentTargets.tennisDevelopment?.phase==='consolidation'?'Consolidation':'Development';
      return state.mode==='maintenance'?'Maintenance':def.openEnded?'Ongoing':'Development';
    }
    function openProgress() {
      renderProgress(); showScreen('coachProgress');
      el('coachProgress').querySelector?.('.back-btn')?.focus?.();
    }
    // One progress destination for every programme; only supported features render.
    function renderProgress() {
      const wrap=el('coachProgressContent'); wrap.innerHTML='';
      const current=controller.snapshot(), state=current.state;
      if (!state || state.status==='completed' || current.blocked) {
        wrap.append(paragraph('No active programme. Your saved history is retained.'),button('Back to Coach',()=>{showScreen('coach');render();}));
        return;
      }
      def=root.GarageFitData.programmes[state.programmeDefinitionId][state.programmeDefinitionVersion];
      const now=new Date().toISOString(), history=root.GarageFitTrainingHistory.createHistory(current.results,catalogue);
      const plan=isTennis() && state.status==='active' && !sessionActive && !current.interruptedDraft ? controller.plan(options) : null;
      const intro=document.createElement('div'), title=document.createElement('div'), status=document.createElement('span');
      intro.className='coach-tennis-intro'; title.className='coach-programme-heading'; status.className='coach-status';
      status.textContent=programmeStatus(state); title.append(heading(def.name),status); intro.append(title);
      const phase=progressViews.section('Programme phase','coach-progress-phase');
      let hold=null;
      if (isTennis()) {
        const development=state.currentTargets.tennisDevelopment, config=state.currentTargets.programmeSettings;
        phase.append(paragraph('Training phase · '+(development?.phase==='consolidation'?'Consolidation':'Development')
          +(plan?.rationale.priorities.phase?.phase==='consolidation' && development?.phase!=='consolidation'?' · consolidation recommended next':'')));
        const event=root.GarageFitCoachTennisPolicy.eventHorizon({definition:def,state,today:{localDate:localDay(now)}});
        if (event) {
          phase.append(paragraph('Event · '+(event.label ? event.label+' · ' : '')+event.eventDate+' · '+(event.daysUntil<0?'date passed':event.daysUntil+' days away')),paragraph(event.rationale));
          if (event.holdProgression) hold='Event preparation holds established resistance and reps.';
        } else phase.append(paragraph('Ongoing development · no fixed end date'));
        phase.append(paragraph(config.weeklyCoachFrequency+' GarageFit sessions per week · '+state.meaningfulSessionsCompleted+' meaningful sessions in total'));
      } else if (def.openEnded) {
        const frequency=def.recommendedFrequency;
        phase.append(paragraph('Open-ended programme · aim for '+frequency.aimSessionsPerWeek+' sessions per week; '+frequency.minSessionsPerWeek+' is acceptable'),
          paragraph(state.meaningfulSessionsCompleted+' meaningful sessions in total'));
      } else {
        const review=controller.review(), length=def.nominalDurationDays, weeks=Math.ceil(length/7), target=def.completionCriteria.blockMeaningfulSessionTarget;
        const index=Math.floor(review.nominalProgress/length), counts=state.currentTargets.blockMeaningfulCounts;
        const blockStart=Date.parse(state.startedAt)+index*length*86400000;
        const inBlock=counts ? counts[index] || 0 : (state.recentSessionSummaries || []).filter(item=>item.meaningful
          && Date.parse(item.endedAt)>=blockStart && Date.parse(item.endedAt)<blockStart+length*86400000).length;
        const frequency=state.mode==='maintenance'?def.maintenancePolicy.frequency:def.recommendedFrequency;
        phase.append(paragraph(review.due ? 'Four-week block complete · '+review.meaningfulSessions+' of '+target+' meaningful sessions'+(review.targetMet?' · block target met':'')+' · review on Coach home'
          : 'Week '+Math.min(weeks,Math.floor(review.nominalProgress%length/7)+1)+' of '+weeks+' · '+inBlock+' of '+target+' meaningful sessions this block'),
          paragraph((state.mode==='maintenance'?'Maintenance':'Development')+' · '+frequency.minSessionsPerWeek+'–'+frequency.maxSessionsPerWeek+' sessions per week · '
            +state.meaningfulSessionsCompleted+' meaningful sessions in total'));
      }
      if (state.status==='paused') phase.append(paragraph('Paused · targets and history are preserved.'));
      wrap.append(intro,phase,progressViews.strengthTargets({state,history,holdReason:hold}));
      if (def.doseTargets.directElbowActions) wrap.append(progressViews.armsExposure({definition:def,state,history,now}));
      if (isTennis()) {
        const pin=def.sportPolicy, policy=root.GarageFitSportCoverage.createPolicy(root.GarageFitData.sportCapabilityPolicies[pin.sportId][pin.version],catalogue);
        const summary=plan?.rationale.priorities.coverage || policy.summarize(history,{now,programmeInstanceId:state.programmeInstanceId,
          focus:state.currentTargets.programmeSettings.focus,equipment:options.equipment,smallSpace:def.contextPolicy?.homeSmallSpace});
        wrap.append(progressViews.capabilityGrid(summary));
      }
      if (def.sportReviewPolicy) {
        const review=controller.sportReview();
        if (review && (review.due || review.latestFeedback)) {
          const check=progressViews.section('Tennis check-in'); renderSportReview(check,review,renderProgress); wrap.append(check);
        }
      }
      wrap.append(progressViews.sessionHistory({state,results:current.results}));
    }
    function renderEventSettings(wrap, state) {
      const config=state.currentTargets.programmeSettings, details=document.createElement('div'); details.className='coach-settings-event';
      const now=new Date().toISOString(), localDate=localDay(now), expired=config.intent==='event' && config.significantEventDate<localDate;
      const saved=message=>{settingsNotice=message;renderSettings();};
      details.append(heading('Training intent and event'),
        paragraph(config.intent==='event' ? 'Preparing for '+(config.significantEventLabel || 'your event')+' · '+config.significantEventDate : 'Ongoing development'),
        paragraph('Choose an important dated event explicitly. Usual tennis playing days remain routine commitments. Event preparation keeps the same anchors, programme and history.'));
      if (expired) { details.append(paragraph('Your event date has passed. Return to ongoing development or choose a new date; no missed work needs repaying.')); }
      const date=document.createElement('input'); date.type='date'; date.min=localDate;
      date.value=config.significantEventDate || ''; date.setAttribute('aria-label','Important event date');
      const label=document.createElement('input'); label.type='text'; label.maxLength=60;
      label.value=config.significantEventLabel || ''; label.setAttribute('aria-label','Event label (optional)');
      details.append(paragraph('Event date'),date,paragraph('Short label (optional)'),label,
        button(config.intent==='event'?'Save event changes':'Prepare for event',async()=>{
          await controller.saveProgrammeSettings({intent:'event',significantEventDate:date.value,significantEventLabel:label.value.trim() || null});saved('Event saved.');
        }));
      if (config.intent==='event') details.append(button(expired?'Return to ongoing development':'Cancel event preparation',async()=>{
        await controller.saveProgrammeSettings({intent:'ongoing',significantEventDate:null,significantEventLabel:null});saved('Returned to ongoing development.');
      }));
      wrap.append(details);
    }
    function renderSportReview(wrap, review, rerender=render) {
      if (review.latestFeedback) wrap.append(paragraph('Last sport check-in · '+new Date(review.latestFeedback.timestamp).toLocaleDateString()
        +' · movement: '+review.latestFeedback.movement+', endurance: '+review.latestFeedback.endurance+', comfort: '+review.latestFeedback.comfort
        +'. Your impressions are context; exercise progress comes from confirmed performed work.'));
      if (!review.due) return;
      const details=document.createElement('details'), summary=document.createElement('summary');
      summary.textContent='Optional tennis progress check-in'; details.append(summary,
        paragraph('How has tennis felt lately? No recent tennis experience can be Not sure. A worse answer suggests an easier session for review; it does not diagnose injury or change your load baseline.'));
      const answers={movement:'unsure',endurance:'unsure',comfort:'unsure'};
      [['movement','Court movement'],['endurance','Match endurance'],['comfort','Physical comfort']].forEach(([key,label]) => {
        const select=document.createElement('select'); select.setAttribute('aria-label',label);
        [['unsure','Not sure'],['better','Better'],['same','Same'],['worse','Worse']].forEach(([value,text]) => {
          const option=document.createElement('option'); option.value=value; option.textContent=text; select.append(option);
        });
        select.value='unsure'; select.onchange=()=>{answers[key]=select.value;}; details.append(paragraph(label),select);
      });
      const save=async response=>{await controller.saveSportReview(response);rerender();};
      details.append(button('Save tennis check-in',()=>save(answers)),button('Skip check-in',()=>save(null)));
      wrap.append(details);
    }
    function overview() {
      if (isTennis()) { tennisOverview(); return; }
      const assessment=controller.assess(def,getEquipment()), wrap=el('coachContent'); wrap.innerHTML='';
      const anchor=def.anchorSelectionPolicy.requirements[0];
      wrap.append(heading(def.name),paragraph(def.type==='tennis-conditioning' ? def.objective+'. Balanced by default, with 2 Coach sessions per week; 1–3 sessions are supported. Pause or finish whenever you choose.' : def.openEnded ? def.objective+'. An open-ended objective: aim for '+def.recommendedFrequency.aimSessionsPerWeek+' sessions per week; two is acceptable. Pause or finish whenever you choose.' : def.objective+' over a nominal four-week block. Aim for '+def.completionCriteria.blockMeaningfulSessionTarget+' meaningful sessions, at '+def.recommendedFrequency.minSessionsPerWeek+'–'+def.recommendedFrequency.maxSessionsPerWeek+' per week.'),
        paragraph(def.type==='tennis-conditioning' ? 'Usually 20–30 minutes. Four stable knee, hinge, push and pull anchors build from 2 × 6 to 2 × 10 reps, about 2 reps in reserve. Each session selects the targets that fit your available 10/15/20/30/45 minutes; both sides are required where applicable. Supporting work rotates from performed history, with no catch-up debt.' : def.sessionTemplate.duration+' minutes by default; '+def.supportedDurations.filter(duration=>duration!==def.sessionTemplate.duration).join(' or ')+' minutes when needed. '+def.anchorSelectionPolicy.requirements.length+' stable '+(def.doseTargets.directElbowActions?'direct curl and extension':'squat, push and pull')+' anchors start at '+anchor.targetSets+' × '+anchor.target.maxReps+' reps.'),
        paragraph(assessment.status==='infeasible'?'Blocked · '+conflictText(assessment.conflicts):assessment.status==='partially-feasible'?'Partially feasible · required anchors fit; supporting choices may be adjusted.':'Feasible · your equipment supports this programme.'),
        button('Set up usual equipment',() => root.openEquipment('coach')));
      if (def.doseTargets.directElbowActions) wrap.append(paragraph('Build from 3 × 8 to 3 × 12, then confirm more resistance. Aim for 9 performed curl and 9 extension set exposures in each rolling 7 days, plus squat, hinge, lunge, compound push/pull, core and carry maintenance. Short sessions keep the direct anchors first.'));
      if (assessment.status!=='infeasible') wrap.append(button('Start programme',async () => {
        const started=await controller.start(def,getEquipment());
        if (!started.state) { wrap.append(paragraph(conflictText(started.assessment.conflicts))); return; }
        resetOptions(); render();
      },true));
      wrap.append(button('Back',render));
    }
    function tennisOverview() {
      const wrap=el('coachContent'); wrap.innerHTML='';
      const defaults=Model().createProgrammeSettings(def.defaultProgrammeSettings);
      const form=tennisViews.settingsForm(defaults,{includeEvent:!!def.eventPolicy,localDate:localDay(new Date().toISOString())});
      wrap.append(heading(def.name),paragraph('Usually 20–30 minutes. Four stable knee, hinge, push and pull anchors build from 2 × 6 to 2 × 10 reps, about 2 reps in reserve. Each session selects only the targets that fit your time.'),form.wrap);
      const assessment=controller.assess(def,getEquipment(),defaults), feasibility=paragraph('');
      const showAssessment=value=>{feasibility.textContent=value.status==='infeasible'?'Equipment needs attention · '+conflictText(value.conflicts)
        : 'Your equipment supports all four anchor roles. Short-session feasibility is checked for each session.';};
      showAssessment(assessment); wrap.append(feasibility,button('Set up usual equipment',()=>root.openEquipment('coach')));
      if (assessment.status!=='infeasible') wrap.append(button('Start programme',async()=>{
        const config=Model().updateProgrammeSettings(defaults,form.read()), checked=controller.assess(def,getEquipment(),config);
        showAssessment(checked); if (checked.status==='infeasible') return;
        const started=await controller.start(def,getEquipment(),config);
        if (!started.state) {
          feasibility.textContent=conflictText(started.assessment.conflicts)+' Your choices have been kept here; choose ongoing development or adjust the event date if today’s work cannot fit.';
          return;
        }
        lastSaved=''; resetOptions(); render();
      },true));
      wrap.append(paragraph('History is local to this browser and device. Only actual performed work earns progress.'),button('Back',render));
    }
    function prepare() {
      previewEditing = false; delete disclosureOpen['preview-why'];
      const preview=controller.previewToday(options);
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
    function text(tag, className, value) { const node=document.createElement(tag); node.className=className; node.textContent=value; return node; }
    function rowControl(label, accessibleName, action) {
      const node=button(label,action); node.className='swap-btn'; node.setAttribute('aria-label',accessibleName); return node;
    }
    // Generator protocol label plus the rest the player will actually give.
    function blockLabel(block) {
      // A superset label already names its changeover and post-pair rest.
      const rest=block.protocol==='rounds' && block.prescription.rounds>1 ? block.prescription.roundRestSeconds+' sec rest between rounds' : null;
      return [root.GarageFitWorkoutPreview.protocolLabel(block),rest].filter(Boolean).join(' · ');
    }
    // Strength target rows show sets, the performed quantity and Coach load guidance.
    function targetPrescription(exercise, block) {
      const planned=exercise.coachAnchor.plannedTarget, sets=planned.targetSets;
      const quantity=block.protocol==='timed_intervals' ? block.prescription.workSeconds+' sec' : root.GarageFitWorkoutPreview.formatPrescription({...exercise,load:null});
      const load=planned.suggestedLoad!=null ? planned.suggestedLoad+' '+planned.loadUnit+(planned.loadInterpretation==='per-item'?' each':' total') : exercise.load;
      return (sets ? sets+(sets===1?' set':' sets')+' × ' : '')+quantity+(load ? ' · '+load : '');
    }
    function effortCue(anchor, context) {
      const reserve=context.repsInReserve ?? context.essentialConstraints?.repsInReserve;
      return anchor.plannedTarget.progressionIntent || (reserve ? 'Leave about '+reserve+' reps in reserve' : null);
    }
    // Generator-style preview: the same section, block and row primitives, with a
    // small Strength target label for stable programme anchors and one Edit mode.
    function renderPreview(preview) {
      const ui=root.GarageFitWorkoutPreview, wrap=el('coachPreviewContent'); wrap.innerHTML='';
      const workout=preview.workout, prescription=preview.plan.prescription, context=prescription.programmeContext, state=controller.snapshot().state;
      const stable=new Set(state.anchors.map(anchor=>anchor.requirementId));
      const messages=previewMessages({plan:preview.plan,workout,state,catalogue});
      const header=document.createElement('div'); header.className='coach-preview-header';
      header.append(text('div','preview-kicker',prescription.duration+' min · '+programmeStatus(state)),text('h2','preview-rounds',context.roleLabel || def.name));
      wrap.append(header);
      messages.status.forEach(message => { const node=text('p','coach-preview-status',message); node.setAttribute('role','status'); wrap.append(node); });
      messages.notices.forEach(message => wrap.append(text('p','coach-preview-notice',message)));
      function section(title, list) {
        const node=document.createElement('section'); node.className='coach-preview-section';
        node.append(ui.sectionHeading(title),list); wrap.append(node);
      }
      function phase(title, part) {
        if (!part || !part.exercises.length) return;
        const list=text('ol','preview-list','');
        part.exercises.forEach((exercise,index) => {
          ui.appendSetupTransitions(list,workout,{section:title==='Warm-up'?'warmup':title==='Cool-down'?'cooldown':'rampup',exerciseIndex:index});
          list.append(ui.exerciseRow({index,name:exercise.name,prescription:ui.formatPrescription(exercise)}));
        });
        section(title+' · '+Math.round(part.estimatedSeconds/60)+' min',list);
      }
      phase('Warm-up',workout.warmup); phase('Ramp-up',workout.rampup);
      const blocks=workout.main.blocks, main=text('ol','preview-list','');
      blocks.forEach((block,index) => {
        main.append(ui.blockHeading({index,total:blocks.length,prescription:blockLabel(block)}));
        block.exercises.forEach((exercise,exerciseIndex) => {
          ui.appendSetupTransitions(main,workout,{section:'main',blockIndex:index,exerciseIndex});
          const anchor=exercise.coachAnchor, target=!!anchor && stable.has(anchor.requirementId), controls=[];
          if (previewEditing && target) {
            controls.push(rowControl('Substitute','Substitute '+exercise.name,() => showSubstitutes(anchor.requirementId,preview.today)));
            if (preview.today.anchorSubstitutions?.[anchor.requirementId]) controls.push(rowControl('Restore','Restore prescribed exercise for '+exercise.name,() => {
              const revised=controller.restore(anchor.requirementId); options={...revised.today};
              if (!revised.workout) { previewEditing=false; showScreen('coach'); render(); showBlocked(revised); return; }
              renderPreview(revised);
            }));
          } else if (previewEditing && (!anchor || anchor.importance!=='required')) {
            controls.push(rowControl('Swap','Swap '+exercise.name,() => { root.GarageFitGenerator.swap(workout,index,exerciseIndex,{catalogue,equipment:preview.today.equipment}); renderPreview(preview); }));
          }
          main.append(ui.exerciseRow({index:exerciseIndex,marker:ui.supersetMarker(block,exerciseIndex),name:exercise.name,
            prescription:ui.occurrenceTargetLabel(block,exerciseIndex)||(target ? targetPrescription(exercise,block) : block.protocol==='emom' ? ui.emomTargetLabel(block,exerciseIndex) : block.protocol==='timed_intervals' ? block.prescription.workSeconds+' sec' : ui.formatPrescription(exercise)),
            targetLabel:target ? 'Strength target' : null, instruction:catalogue[exercise.id]?.instruction,
            cue:[target ? effortCue(anchor,context) : null,...(exercise.timedCues || []).map(cue=>cue.text)].filter(Boolean).join(' · '),controls}));
        });
      });
      section('Main workout · '+blocks.length+' block'+(blocks.length===1?'':'s'),main);
      phase('Cool-down',workout.cooldown);
      wrap.append(text('div','preview-estimate','≈'+Math.round(workout.estimatedSeconds/60)+' min total'));
      if (previewEditing) wrap.append(paragraph('Strength target substitutions are just for today. Replanning may change supporting exercises; review the revised workout before starting.'));
      const why=document.createElement('details'), summary=text('summary','','Why this workout?'); why.className='generator-options coach-why';
      const reason=rationale(preview.plan).trim();
      why.append(summary,paragraph(reason.charAt(0).toUpperCase()+reason.slice(1)+(/[.!?]$/.test(reason)?'':'.')),...messages.why.map(paragraph));
      if (isTennis()) why.append(...tennisViews.coverageSummary(preview.plan.rationale.priorities.coverage).map(paragraph));
      retainDisclosure(why,'preview-why'); wrap.append(why);
      const actions=document.createElement('div'); actions.className='preview-actions coach-preview-actions';
      const edit=button(previewEditing?'Done Editing':'Edit Workout',() => { previewEditing=!previewEditing; renderPreview(preview); el('coachPreviewContent').querySelector('.coach-preview-actions button').focus(); });
      edit.className='preview-regenerate'; edit.setAttribute('aria-pressed',String(previewEditing));
      const start=button('Start workout',async () => { const tracker=await controller.begin(); sessionSetups={}; sessionActive=true; await play(workout,tracker); },true);
      start.className='preview-start';
      actions.append(edit,start);
      wrap.append(actions,button('Back to Coach',() => { previewEditing=false; showScreen('coach'); render(); })); showScreen('coachPreview');
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
      wrap.append(button('Cancel',backFromSubstitute));
      showScreen('coachSubstitute');
    }
    function backFromSubstitute() {
      const preview=controller.snapshot().preview;
      if (preview) renderPreview(preview); else { showScreen('coach'); render(); }
    }
    async function manage(action) { await controller.manage(action); resetOptions(); render(); }
    function isProgressionAnchor(phase) {
      const anchor=phase && phase.kind==='exercise' && phase.section==='main' && phase.protocol==='rounds' && !phase.variableTarget && !phase.timed && phase.exercise.coachAnchor;
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
      try { const set=actualSet(); el('coachActualSummary').textContent='Next confirms: '+(set.reps===null?'unknown reps':set.reps+' reps')+' · '+(activeResistance && !activeResistance.numericLoad ? set.resistanceSetup?'resistance setup confirmed':'setup unknown; progression held' : set.load===null?'load unknown':set.load+' '+set.loadUnit+(set.loadInterpretation==='per-item'?' each':' total')); } catch(error) { el('coachActualSummary').textContent=error.message; }
    }
    async function record(phase, tracker, action, elapsed) {
      if (busy) return false; return run(async () => {
        if (!phase || phase.kind!=='exercise') return true;
        if (phase.timed) await tracker.recordTimed(phase.occurrenceId,{plannedSeconds:phase.seconds,elapsedSeconds:elapsed});
        else if (action==='skip' || ['emom','ladder','pyramid','complex','density'].includes(phase.protocol) && action!=='done') await tracker.recordSkip(phase.occurrenceId);
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
        const stableIds=new Set(controller.snapshot().state.anchors.map(anchor=>anchor.requirementId));
        const recorded=result.anchorResults.filter(item=>item.status!=='skipped' && (!isTennis() || stableIds.has(item.requirementId))).length;
        lastSaved=result.finalStatus==='abandoned'?'Session saved · no meaningful main work recorded.':'Session saved · '+result.finalStatus+' · '+recorded+' anchors recorded';
        resetOptions(); showScreen('coach'); render(); });
    }
    return {open, overview, controller, renderAnchor, record, showEnd, saveFeedback, updateActualSummary,
      isActive: () => sessionActive, run, backFromSubstitute, openProgress, openSettings, back: () => {previewEditing=false;showScreen('coach');render();},
      init: () => { initialisation=run(() => controller.load()); return initialisation; }};
  }
  root.GarageFitCoachUI = {createController, mount, tennisWeeklyProgress, programmeWeeklyProgress, previewMessages};
})(typeof window !== 'undefined' ? window : globalThis);
