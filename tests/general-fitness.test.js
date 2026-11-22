const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');

// #190 General Fitness: anchor-free family scheduling on the common Coach engine.
const FAMILIES = ['strength-control','cardio-conditioning','full-body-challenges','athletic-movement','core-stability','mobility-movement-quality'];
const DEMANDING = ['strength-control','cardio-conditioning','full-body-challenges'];
const T0 = Date.parse('2026-10-05T08:00:00Z');
const at = hours => new Date(T0 + hours * 3600000).toISOString();

// A pure engine context with synthetic performed results; generation stays in the controller tests.
function context(storage, version = 1) {
  const p = pilot(storage, 'general-fitness', version);
  p.run(`
    const GF=pilotDef;
    const gfEngine=pilotEngine;
    let gfSeed=11;
    const seeded=()=>{gfSeed=gfSeed+0x6D2B79F5|0;let t=Math.imul(gfSeed^gfSeed>>>15,1|gfSeed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
    function gfResult(id, when, family, options={}) {
      const source=options.source||'coach', exercises=options.exerciseIds||['air-squat','push-up','plank'];
      return GarageFitCoachModel.createSessionResult({sessionResultId:id, source,
        programmeInstanceId:source==='coach'?(options.instance||'gf'):null, prescriptionId:source==='coach'?'rx-'+id:null,
        ...(family?{workoutFamilyId:family,workoutFamilyVersion:options.version||1,familyStyleId:options.style||'style'}:{}),
        startedAt:when, endedAt:when, finalStatus:options.finalStatus||'completed',
        plannedWork:exercises.map((exerciseId,i)=>({occurrenceId:id+':'+i,exerciseId,section:'main'})),
        performedWork:exercises.map((exerciseId,i)=>({occurrenceId:id+':'+i,exerciseId,status:'completed'}))});
    }
    function gfStart(now, equipment=[]) { return gfEngine.startProgramme(GF,{programmeInstanceId:'gf',equipment},now).state; }
    function gfPlan(state, results, now, extra={}) {
      return gfEngine.planNextSession(GF,state,results,{now,prescriptionId:'rx:'+now,equipment:[],duration:30,...extra});
    }
  `);
  return p;
}
// Plans N sessions at a weekly frequency, recording the intended family as performed.
function sequence(p, perWeek, sessions = 20) {
  return p.json(`(()=>{
    let state=gfStart(${JSON.stringify(at(0))}); const results=[], families=[], plans=[];
    for(let i=0;i<${sessions};i++){
      const now=new Date(${T0}+Math.round(i*7/${perWeek}*24)*3600000).toISOString();
      const plan=gfPlan(state,results,now); plans.push(plan);
      const family=plan.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId; families.push(family);
      const result=gfResult('s'+i,now,family); results.push(result);
      state=gfEngine.applySessionResult(GF,state,result,results);
    }
    return {families, state, last:plans.at(-1)};
  })()`);
}

test('General Fitness v1 is an immutable, open-ended, anchor-free definition on the shared policy registry', () => {
  const p = context();
  assert.ok(p.run('Object.isFrozen(GF) && Object.isFrozen(GF.familyBalancePolicy.families[0].effects)'));
  assert.equal(p.run('GF.type'), 'general-fitness'); assert.equal(p.run('GF.openEnded'), true);
  assert.equal(p.run('GF.anchorSelectionPolicy'), undefined);
  assert.deepEqual(p.json('GarageFitCoachPolicies.createDefaultRegistry().types()'), ['general-strength','build-arms','tennis-conditioning','general-fitness']);
  assert.deepEqual(p.json('GF.familyBalancePolicy.families.map(item=>item.workoutFamilyId)'), FAMILIES);
  assert.deepEqual(p.json('GF.supportedDurations'), [10,15,20,30,45]);
  const invalid = [
    `{...copy,anchorSelectionPolicy:{requirements:[]}}`,
    `{...copy,completionCriteria:{...copy.completionCriteria,minimumMeaningfulSessions:8}}`,
    `{...copy,missedSessionPolicy:{strategy:'catch-up'}}`,
    `{...copy,supportedDurations:[25]}`,
    `{...copy,familyBalancePolicy:{...copy.familyBalancePolicy,families:copy.familyBalancePolicy.families.slice(1)}}`,
    `{...copy,familyBalancePolicy:{...copy.familyBalancePolicy,families:[...copy.familyBalancePolicy.families.slice(1),{...copy.familyBalancePolicy.families[0],workoutFamilyVersion:9}]}}`
  ];
  for (const source of invalid) assert.throws(() => p.run(`(()=>{const copy=JSON.parse(JSON.stringify(GF));
    GarageFitCoachPolicies.createDefaultRegistry().get('general-fitness').validateDefinition(${source});})()`), /General Fitness/, source);
  // Existing published programme policies keep their own frozen strategy objects.
  assert.ok(p.run(`(()=>{const registry=GarageFitCoachPolicies.createDefaultRegistry();
    return registry.get('general-strength').buildPrescription===GarageFitCoachPolicies.generalStrengthPolicy.buildPrescription
      && registry.get('build-arms').interpretDose===GarageFitCoachPolicies.buildArmsPolicy.interpretDose
      && registry.get('tennis-conditioning').buildPrescription===GarageFitCoachTennisPolicy.buildPrescription;})()`));
});

test('Athletic v1 and v5 are one family for balance and variety; released definitions stay pinned but plan the current Athletic composition', () => {
  for (const version of [1, 2]) {
    const p = context(undefined, version);
    const out = p.json(`(()=>{
      const before=JSON.stringify(GF), state=gfStart(${JSON.stringify(at(0))}), now=${JSON.stringify(at(30))};
      const view=plan=>{const priorities=plan.rationale.priorities;return {effects:priorities.effects,
        families:priorities.families.map(({workoutFamilyId,balanceScore,varietyPenalty,score})=>({workoutFamilyId,balanceScore,varietyPenalty,score})),
        basis:priorities.history.sessions.map(item=>item.basis)};};
      const one=gfPlan(state,[gfResult('a',${JSON.stringify(at(1))},'athletic-movement',{version:1})],now);
      const two=gfPlan(state,[gfResult('a',${JSON.stringify(at(1))},'athletic-movement',{version:5})],now);
      return {one:view(one),two:view(two),candidates:two.prescription.workoutFamilyPlan.candidates.map(({workoutFamilyId,workoutFamilyVersion})=>[workoutFamilyId,workoutFamilyVersion]),
        pinned:GF.familyBalancePolicy.families.map(item=>item.workoutFamilyVersion),unchanged:JSON.stringify(GF)===before};
    })()`);
    assert.deepEqual(out.two, out.one, 'GF v'+version+': a v5 Athletic session earns exactly what a v1 session earns');
    assert.deepEqual(out.one.basis, ['family-identity']);
    assert.ok(out.one.families.find(item => item.workoutFamilyId === 'athletic-movement').varietyPenalty > 0, 'recency counts the family, not its version');
    assert.deepEqual(Object.fromEntries(out.candidates), {'strength-control':3,'cardio-conditioning':2,'full-body-challenges':2,'athletic-movement':6,'core-stability':1,'mobility-movement-quality':3});
    assert.deepEqual(out.pinned, [1,1,1,1,1,1], 'the released definition is not edited');
    assert.equal(out.unchanged, true);
    const w=p.json(`(()=>{const plan=gfPlan(gfStart(${JSON.stringify(at(0))}),[],${JSON.stringify(at(30))});
      const rx=plan.prescription;rx.workoutFamilyPlan.candidates=rx.workoutFamilyPlan.candidates.filter(c=>c.workoutFamilyId==='athletic-movement');
      return GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:rx,random:seeded});})()`);
    assert.equal(w.workoutFamilyVersion,6,'the current composition is actually generated through the Coach prescription');
    assert.ok(w.main.blocks.flatMap(b=>b.exercises).some(e=>['four-square-steps','tandem-step-and-hold','reverse-lunge-with-rotation','transverse-lunge-to-balance'].includes(e.id)));
  }
});

test('starts, pauses, resumes and completes sessions with zero anchors; history and draft recovery survive reload', async () => {
  const p = pilot(new Map(), 'general-fitness', 1);
  const started = await p.run('pilot.start(pilotDef,[])');
  assert.equal(started.status, 'feasible');
  const state = p.json('pilot.snapshot().state');
  assert.deepEqual(state.anchors, []); assert.equal(state.programmeDefinitionId, 'general-fitness');
  p.run('pilot.prepare({equipment:[],duration:20})');
  const preview = p.json('pilot.snapshot().preview');
  const rx = preview.plan.prescription;
  assert.equal(rx.requiredAnchors, undefined); assert.equal(rx.sessionRole, 'general-fitness');
  assert.deepEqual(rx.workoutFamilyPlan.candidates.map(item => item.workoutFamilyId).sort(), FAMILIES.slice().sort());
  assert.ok(rx.workoutFamilyPlan.candidates.every(item => item.rationale.length > 10));
  assert.equal(preview.workout.workoutFamilyId, preview.workout.familyReplan.workoutFamilyId);
  assert.ok(preview.workout.estimatedSeconds <= 20 * 60);
  assert.ok(p.run('GarageFitGenerator.validateFamilyWorkout(pilot.snapshot().preview.workout,{catalogue:CATALOGUE,equipment:[]}).valid'));
  await p.run("pilot.manage('pause')");
  assert.throws(() => p.run('pilot.prepare({equipment:[],duration:20})'), /active programme/);
  await p.run("pilot.manage('resume')");
  p.run('pilot.prepare({equipment:[],duration:20})');
  const delivered = p.json('pilot.snapshot().preview.workout');
  await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
  await p.run(`(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>item.section==='main'))await pilotTracker.recordDone(work.occurrenceId);})()`);
  const result = await p.run(`pilot.finish('complete',{difficulty:'about-right'},600)`);
  assert.equal(result.finalStatus, 'completed');
  assert.deepEqual([result.workoutFamilyId, result.workoutFamilyVersion, result.familyStyleId],
    [delivered.workoutFamilyId, delivered.workoutFamilyVersion, delivered.familyStyleId], 'the delivered family, not a planned label, is recorded');
  assert.equal(p.json('pilot.snapshot().state').meaningfulSessionsCompleted, 1);
  assert.deepEqual(p.json('pilot.snapshot().state.anchors'), []);
  // Reload: state and history are durable; an interrupted session recovers durable work only.
  const q = pilot(p.storage, 'general-fitness', 1);
  await q.run('pilot.load()');
  assert.deepEqual(q.json('pilot.snapshot().state'), p.json('pilot.snapshot().state'));
  assert.equal(q.json('pilot.snapshot().results').length, 1);
  q.run(`pilotNow='2026-10-03T08:00:00Z'`);
  q.run('pilot.prepare({equipment:[],duration:20})');
  await q.run('pilot.begin().then(value=>{pilotTracker=value;})');
  await q.run(`pilotTracker.recordDone(pilotTracker.plannedWork().find(item=>item.section==='main').occurrenceId)`);
  const r = pilot(p.storage, 'general-fitness', 1);
  r.run(`pilotNow='2026-10-03T09:00:00Z'`);
  await r.run('pilot.load()');
  const recovered = r.json('pilot.snapshot().results').at(-1);
  assert.equal(recovered.finalStatus, 'partial'); assert.ok(recovered.workoutFamilyId);
  assert.equal(r.json('pilot.snapshot().state').meaningfulSessionsCompleted, 2);
  assert.ok(r.run("GarageFitCoachModel.validate('programme-state',pilot.snapshot().state).valid"));
});

test('20-session plans at 2, 3 and 5 sessions/week balance performed effects, vary sessions and carry no debt', () => {
  const p = context();
  const share = {};
  for (const perWeek of [2, 3, 5]) {
    const {families, state} = sequence(p, perWeek);
    const counts = Object.fromEntries(FAMILIES.map(id => [id, families.filter(item => item === id).length]));
    for (const id of FAMILIES) assert.ok(counts[id] >= 1, perWeek+'/week includes '+id);
    const supporting = Math.max(...FAMILIES.slice(2).map(id => counts[id]));
    assert.ok(counts['strength-control'] >= supporting && counts['cardio-conditioning'] >= supporting, perWeek+'/week prioritises foundations '+JSON.stringify(counts));
    families.forEach((family, index) => {
      if (index && family === families[index-1]) assert.equal(family, 'strength-control', 'only strength work may sensibly repeat');
      if (index > 1) assert.ok(!(family === families[index-1] && family === families[index-2]), 'never three in a row');
    });
    assert.equal(state.meaningfulSessionsCompleted, 20); assert.deepEqual(state.anchors, []);
    share[perWeek] = (counts['strength-control'] + counts['cardio-conditioning']) / 20;
  }
  assert.ok(share[2] >= share[5], 'lower attendance concentrates on the foundations');
  // Misses: no catch-up queue or debt; a long absence plans like a fresh start.
  const resumed = p.json(`(()=>{
    let state=gfStart(${JSON.stringify(at(0))}); const results=[];
    for(let i=0;i<6;i++){ const now=new Date(${T0}+i*2*86400000).toISOString(); const plan=gfPlan(state,results,now);
      const result=gfResult('m'+i,now,plan.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId); results.push(result);
      state=gfEngine.applySessionResult(GF,state,result,results); }
    const later=gfPlan(state,results,new Date(${T0}+50*86400000).toISOString());
    const fresh=gfPlan(gfStart(${JSON.stringify(at(0))}),[],${JSON.stringify(at(1))});
    return {later, fresh};
  })()`);
  assert.equal(resumed.later.rationale.missedSessionResponse.missed, true);
  assert.equal(resumed.later.rationale.missedSessionResponse.catchUpSessions, 0);
  assert.equal(resumed.later.prescription.duration, 30);
  assert.deepEqual(resumed.later.prescription.workoutFamilyPlan, resumed.fresh.prescription.workoutFamilyPlan);
});

test('cross-source performed history informs variety without crediting General Fitness sessions', async () => {
  const p = context();
  const fresh = p.json(`gfPlan(gfStart(${JSON.stringify(at(0))}),[],${JSON.stringify(at(48))})`);
  assert.equal(fresh.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId, 'strength-control');
  const informed = p.json(`(()=>{
    const state=gfStart(${JSON.stringify(at(0))});
    const results=[gfResult('standalone',${JSON.stringify(at(10))},'strength-control',{source:'generator'}),
      gfResult('fixed',${JSON.stringify(at(12))},null,{source:'fixed',exerciseIds:['plank','dead-bug']}),
      gfResult('other-coach',${JSON.stringify(at(14))},null,{instance:'gs',exerciseIds:['goblet-squat']})];
    const plan=gfPlan(state,results,${JSON.stringify(at(48))});
    let refused=null; try { gfEngine.applySessionResult(GF,state,results[0],results); } catch(error) { refused=error.message; }
    return {plan,refused,state};
  })()`);
  const sources = informed.plan.rationale.priorities.history.sessions;
  assert.deepEqual(sources.map(item => [item.source, item.basis]), [['coach','exercise-metadata'],['fixed','exercise-metadata'],['generator','family-identity']]);
  assert.notEqual(informed.plan.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId, 'strength-control');
  assert.equal(informed.plan.rationale.priorities.history.credit, 'none');
  assert.match(informed.refused, /does not belong/);
  assert.equal(informed.state.meaningfulSessionsCompleted, 0);
  // Through the controller: a saved standalone result changes the plan, never the credited state.
  const c = pilot(new Map(), 'general-fitness', 1);
  await c.run('pilot.start(pilotDef,[])');
  const before = c.json('pilot.plan({equipment:[],duration:20}).prescription.workoutFamilyPlan.candidates[0]');
  await c.run(`pilotStore.saveSessionResult(GarageFitCoachModel.createSessionResult({sessionResultId:'standalone',source:'generator',
    workoutFamilyId:${JSON.stringify(before.workoutFamilyId)},workoutFamilyVersion:1,familyStyleId:'x',startedAt:'2026-09-29T08:00:00Z',endedAt:'2026-09-29T08:30:00Z',finalStatus:'completed',
    plannedWork:[{occurrenceId:'o1',exerciseId:'air-squat',section:'main'}],performedWork:[{occurrenceId:'o1',exerciseId:'air-squat',status:'completed'}]}))`);
  await c.run('pilot.load()');
  assert.notEqual(c.json('pilot.plan({equipment:[],duration:20}).prescription.workoutFamilyPlan.candidates[0]').workoutFamilyId, before.workoutFamilyId);
  assert.equal(c.json('pilot.snapshot().state').meaningfulSessionsCompleted, 0);
  assert.deepEqual(c.json('pilot.snapshot().results'), [], 'other-source results are context, not programme results');
});

test('recent demanding work, confirmed hard activity and Easy today permit lower-intensity and Mobility sessions', () => {
  const p = context();
  const plans = p.json(`(()=>{
    const state=gfStart(${JSON.stringify(at(0))});
    const demanding=[gfResult('hard',${JSON.stringify(at(30))},'strength-control')];
    const yesterday=gfPlan(state,demanding,${JSON.stringify(at(40))});
    const later=gfPlan(state,demanding,${JSON.stringify(at(80))});
    const easy=gfPlan(state,[],${JSON.stringify(at(40))},{easyToday:true});
    const mobilityState=state, results=[];
    // A history rich in every other effect leaves Mobility as the clear priority.
    ['strength-control','cardio-conditioning','strength-control','cardio-conditioning','core-stability','athletic-movement','full-body-challenges']
      .forEach((family,i)=>results.push(gfResult('r'+i,new Date(${T0}+i*86400000).toISOString(),family)));
    const mobility=gfPlan(mobilityState,results,new Date(${T0}+9*86400000).toISOString(),{difficulty:'easy',duration:15});
    return {yesterday,later,easy,mobility};
  })()`);
  assert.ok(!DEMANDING.includes(plans.yesterday.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId));
  assert.deepEqual(plans.yesterday.rationale.priorities.recovery, {preferLowerDemand: true, reasons: ['recent-demanding-session']});
  assert.match(plans.yesterday.prescription.workoutFamilyPlan.candidates[0].rationale, /lower-demand/);
  assert.equal(plans.later.rationale.priorities.recovery.preferLowerDemand, false);
  assert.equal(plans.easy.prescription.difficulty, 'easy');
  assert.deepEqual(plans.easy.prescription.programmeContext.overrides, [{type: 'easy-today'}]);
  assert.equal(plans.mobility.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId, 'mobility-movement-quality');
  // The planned Mobility session is generated, validated and fits the shorter, easier request.
  const workout = p.json(`GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:${JSON.stringify(plans.mobility.prescription)},random:seeded})`);
  assert.equal(workout.workoutFamilyId, 'mobility-movement-quality'); assert.equal(workout.difficulty, 'easy');
  assert.ok(workout.estimatedSeconds <= 15 * 60);
  assert.equal(workout.workoutFamilyVersion, 3, 'General Fitness composes the current Mobility version (#272)');
  // The Coach route threads existing completed-session evidence to the composer (transient; stored records are untouched).
  const lowerFocus = ['kneeling-ankle-rocks','adductor-rock-backs','ninety-ninety-hip-switches','standing-hip-rotations','heel-toe-rocks','half-kneeling-hip-flexor-rocks-with-reach'];
  const evidence = {'mobility-movement-quality': {workoutFamilyVersion: 2, plannedOccurrences: 6, completedOccurrences: lowerFocus.map(exerciseId => ({exerciseId, blockIndex: 1}))}};
  const focus = recentFamilySessions => p.json(`(()=>{const draws=[.1,.3];let s=7;const random=()=>draws.length?draws.shift():(s=(s*1664525+1013904223)>>>0)/4294967296;
    return GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:${JSON.stringify(plans.mobility.prescription)},recentFamilySessions:${JSON.stringify(recentFamilySessions)},random}).main.blocks[1].exercises.map(item=>item.id);})()`);
  assert.notDeepEqual(focus(evidence), focus({}), 'a recent lower-body session shifts the next emphasis through the Coach route too');
});

test('external activity preferences influence priorities conservatively and never create credit', async () => {
  const p = context();
  const plans = p.json(`(()=>{
    const state=gfStart(${JSON.stringify(at(0))}), prefs=GarageFitCoachModel.createCoachPreferences({usualExternalActivities:[{activityType:'Football',sessionsPerWeek:3},{activityType:'Cycling',sessionsPerWeek:6}]});
    const none=gfPlan(state,[],${JSON.stringify(at(30))});
    const typical=gfPlan(state,[],${JSON.stringify(at(30))},{externalActivity:GarageFitCoachModel.externalActivityContext(prefs,{},'2026-10-06')});
    const sessionContext={reportedSportActivity:[{sportId:'tennis',localDate:'2026-10-05',intensity:'hard'}]};
    const reported=gfPlan(state,[],${JSON.stringify(at(30))},{localDate:'2026-10-06',sessionContext,externalActivity:GarageFitCoachModel.externalActivityContext(prefs,sessionContext,'2026-10-06')});
    const light={reportedSportActivity:[{sportId:'tennis',localDate:'2026-10-05',intensity:'light'}]};
    const lightPlan=gfPlan(state,[],${JSON.stringify(at(30))},{localDate:'2026-10-06',sessionContext:light,externalActivity:GarageFitCoachModel.externalActivityContext(prefs,light,'2026-10-06')});
    return {none,typical,reported,lightPlan,state};
  })()`);
  const ext = plans.typical.rationale.priorities.externalActivity;
  assert.deepEqual([ext.typicalSessionsPerWeek, ext.mobilityPreference, ext.confidence], [9, 0.5, 'approximate'], 'bounded nudge');
  assert.equal(plans.typical.rationale.priorities.recovery.preferLowerDemand, false, 'typical routines are not confirmed activity');
  const mobility = plan => plan.rationale.priorities.effects.find(item => item.effect === 'mobility');
  assert.ok(mobility(plans.typical).targetShare > mobility(plans.none).targetShare);
  assert.ok(plans.typical.rationale.priorities.effects.every(item => item.performedSessions === 0), 'no external effect credit');
  assert.deepEqual(plans.reported.rationale.priorities.recovery.reasons, ['reported-hard-activity']);
  assert.ok(!DEMANDING.includes(plans.reported.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId));
  assert.equal(plans.lightPlan.rationale.priorities.recovery.preferLowerDemand, false);
  // Controller: saved preferences reach planning only for this opted-in definition, creating no records.
  const c = pilot(new Map(), 'general-fitness', 1);
  await c.run('pilot.start(pilotDef,[])');
  await c.run("pilot.saveExternalActivityPreferences([{activityType:'Swimming',sessionsPerWeek:1}])");
  assert.equal(c.json('pilot.plan({equipment:[],duration:20}).rationale.priorities.externalActivity').typicalSessionsPerWeek, 1);
  assert.deepEqual(c.json('pilot.snapshot().results'), []);
  assert.equal(c.json('pilot.snapshot().state').meaningfulSessionsCompleted, 0);
});

test('family plans build the first feasible family transparently and never misreport the delivered family', () => {
  const p = context();
  p.run(`function gfRx(plan, extra={}) { return GarageFitCoachModel.createSessionPrescription({prescriptionId:'rx',programmeInstanceId:'gf',sessionRole:'general-fitness',
    duration:20,difficulty:'normal',equipment:[],workoutFamilyPlan:plan,...extra}); }`);
  const candidates = `[{workoutFamilyId:'athletic-movement',workoutFamilyVersion:1,rationale:'Athletic first'},{workoutFamilyId:'core-stability',workoutFamilyVersion:1,rationale:'Core next'}]`;
  // Without confirmed room, the medium-impact exclusion leaves Athletic infeasible (WORKOUT_FAMILIES.md).
  const workout = p.json(`GarageFitGenerator.generate({catalogue:CATALOGUE,random:seeded,sessionPrescription:gfRx({candidates:${candidates},excludedImpact:['medium','high']})})`);
  assert.equal(workout.workoutFamilyId, 'core-stability');
  assert.equal(workout.familyReplan.requestedWorkoutFamilyId, 'athletic-movement');
  assert.equal(workout.familyReplan.replanned, true);
  assert.equal(workout.familyReplan.rationale, 'Core next');
  assert.equal(workout.familyReplan.attempts[0].workoutFamilyId, 'athletic-movement');
  assert.equal(workout.prescriptionOutcome.status, 'partially-feasible');
  assert.equal(workout.sessionPrescription, undefined, 'family swaps use the family gate, not generic Main budgets');
  assert.deepEqual(p.json(`GarageFitSessionTracker.identityFromWorkout(${JSON.stringify(workout)})`),
    {workoutFamilyId: 'core-stability', workoutFamilyVersion: 1, familyStyleId: workout.familyStyleId});
  // A same-family swap keeps the family label only through the shared gate.
  const swapped = p.json(`(()=>{const w=${JSON.stringify(workout)};GarageFitGenerator.swap(w,0,0,{catalogue:CATALOGUE,equipment:[],random:seeded});return GarageFitGenerator.validateFamilyWorkout(w,{catalogue:CATALOGUE,equipment:[]}).valid;})()`);
  assert.equal(swapped, true);
  // Nothing feasible: an honest infeasible prescription with each family's reasons.
  const error = p.json(`(()=>{try{GarageFitGenerator.generate({catalogue:CATALOGUE,random:seeded,sessionPrescription:gfRx({candidates:[{workoutFamilyId:'athletic-movement',workoutFamilyVersion:1,rationale:'a'},{workoutFamilyId:'mobility-movement-quality',workoutFamilyVersion:1,rationale:'b'}],excludedImpact:['medium','high'],bodyPositions:['standing']})});}catch(error){return {code:error.code,assessment:error.assessment};}})()`);
  assert.equal(error.code, 'session-prescription-infeasible');
  assert.equal(error.assessment.hardConflicts[0].code, 'family-plan-not-feasible');
  assert.deepEqual(error.assessment.hardConflicts[0].attempts.map(item => item.workoutFamilyId), ['athletic-movement','mobility-movement-quality']);
  // Pure preflight: unpublished candidates are visible warnings; none usable is a hard conflict.
  const partial = p.json(`GarageFitGenerator.assessSessionPrescription({catalogue:CATALOGUE,sessionPrescription:gfRx({candidates:[{workoutFamilyId:'core-stability',workoutFamilyVersion:9,rationale:'x'},{workoutFamilyId:'core-stability-x',workoutFamilyVersion:1,rationale:'y'},{workoutFamilyId:'mobility-movement-quality',workoutFamilyVersion:1,rationale:'z'}]})})`);
  assert.equal(partial.status, 'feasible');
  assert.deepEqual(partial.warnings.map(item => item.code), ['family-candidate-unavailable','family-candidate-unavailable']);
  const none = p.json(`GarageFitGenerator.assessSessionPrescription({catalogue:CATALOGUE,sessionPrescription:gfRx({candidates:[{workoutFamilyId:'core-stability',workoutFamilyVersion:9,rationale:'x'}]})})`);
  assert.equal(none.status, 'infeasible'); assert.equal(none.hardConflicts[0].code, 'family-plan-unavailable');
  // The record contract keeps family plans anchor-free and bounded.
  for (const extra of [`{requiredAnchors:[{requirementId:'a',exerciseId:'air-squat',importance:'required'}]}`, `{maximumDurationSeconds:600}`, `{variationPreference:'varied'}`])
    assert.throws(() => p.run(`gfRx({candidates:${candidates}},${extra})`), /not supported with a workout family plan/);
  for (const plan of [`{candidates:[]}`, `{candidates:[${candidates}[0],${candidates}[0]]}`, `{candidates:${candidates},excludedImpact:['extreme']}`])
    assert.throws(() => p.run(`gfRx(${plan})`), /Invalid session-prescription/);
});

test('durations and difficulty produce suitable bodyweight family sessions', () => {
  const p = context();
  for (const duration of [10, 45]) for (const difficulty of ['easy', 'hard']) {
    const outcome = p.json(`(()=>{const plan=gfPlan(gfStart(${JSON.stringify(at(0))}),[],${JSON.stringify(at(2))},{duration:${duration},difficulty:'${difficulty}'});
      const workout=GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:plan.prescription,random:seeded});
      return {plan:plan.prescription.workoutFamilyPlan.candidates.map(item=>item.workoutFamilyId),workout,
        valid:GarageFitGenerator.validateFamilyWorkout(workout,{catalogue:CATALOGUE,equipment:[]}).valid};})()`);
    assert.ok(outcome.valid, duration+' '+difficulty);
    assert.ok(outcome.plan.includes(outcome.workout.workoutFamilyId));
    assert.equal(outcome.workout.difficulty, difficulty); assert.equal(outcome.workout.duration, duration);
    assert.ok(outcome.workout.estimatedSeconds <= duration * 60);
  }
  const unsupported = p.json(`gfPlan(gfStart(${JSON.stringify(at(0))}),[],${JSON.stringify(at(2))},{duration:25})`);
  assert.equal(unsupported.prescription, null);
  assert.ok(unsupported.conflicts.some(item => item.code === 'unsupported-duration'));
});

test('[Full] every duration, difficulty and equipment set yields a validated family session or an honest limitation', () => {
  const p = context();
  const report = {};
  for (const equipment of [[], ['dumbbells'], ['dumbbells','kettlebell','bands','trx','bench']])
    for (const duration of [10, 15, 20, 30, 45]) for (const difficulty of ['easy', 'normal', 'hard']) {
      const outcome = p.json(`(()=>{const plan=gfPlan(gfStart(${JSON.stringify(at(0))},${JSON.stringify(equipment)}),[],${JSON.stringify(at(2))},{equipment:${JSON.stringify(equipment)},duration:${duration},difficulty:'${difficulty}'});
        try{const workout=GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:plan.prescription,random:seeded});
          return {family:workout.workoutFamilyId,replanned:workout.familyReplan.replanned,seconds:workout.estimatedSeconds,
            valid:GarageFitGenerator.validateFamilyWorkout(workout,{catalogue:CATALOGUE,equipment:${JSON.stringify(equipment)}}).valid};}
        catch(error){return {error:error.code,conflicts:error.assessment&&error.assessment.hardConflicts};}})()`);
      const key = equipment.length+'/'+duration+'/'+difficulty;
      report[key] = outcome.family || outcome.error;
      if (outcome.error) assert.equal(outcome.error, 'session-prescription-infeasible', key);
      else { assert.ok(outcome.valid, key); assert.ok(outcome.seconds <= duration * 60, key); }
    }
  assert.ok(Object.values(report).every(value => FAMILIES.includes(value)), JSON.stringify(report));
});

test('[Full] controller-run 20-session sequences at 2, 3 and 5 sessions/week deliver distinct, balanced sessions', async () => {
  for (const perWeek of [2, 3, 5]) {
    const p = pilot(new Map(), 'general-fitness', 1);
    p.run(`let seed=${perWeek};Math.random=()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};`);
    await p.run("pilot.start(pilotDef,['dumbbells'])");
    const sessions = [];
    for (let i = 0; i < 20; i++) {
      p.run(`pilotNow=new Date(${T0}+${Math.round(i * 7 / perWeek * 24)}*3600000).toISOString()`);
      p.run("pilot.prepare({equipment:['dumbbells'],duration:20})");
      await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
      await p.run(`(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>item.section==='main'))await pilotTracker.recordDone(work.occurrenceId);})()`);
      const result = await p.run(`pilot.finish('complete',{difficulty:'about-right'},600)`);
      sessions.push({family: result.workoutFamilyId, style: result.familyStyleId,
        exercises: new Set(result.performedWork.map(item => item.exerciseId))});
    }
    const counts = Object.fromEntries(FAMILIES.map(id => [id, sessions.filter(item => item.family === id).length]));
    for (const id of FAMILIES) assert.ok(counts[id] >= 1, perWeek+'/week: '+id);
    assert.ok(counts['strength-control'] + counts['cardio-conditioning'] >= 8, perWeek+'/week foundations '+JSON.stringify(counts));
    sessions.slice(1).forEach((session, index) => {
      const previous = sessions[index], shared = [...session.exercises].filter(id => previous.exercises.has(id)).length;
      assert.ok(session.family !== previous.family || session.style !== previous.style || shared / session.exercises.size < 0.5,
        perWeek+'/week session '+(index+1)+' is recognisably distinct');
    });
    assert.equal(p.json('pilot.snapshot().state').meaningfulSessionsCompleted, 20);
  }
});

test('General Fitness released plans deliver current Mobility v3 from ordinary history-ranked candidates (#272)',()=>{
  for(const version of [1,2]) {
    const p=context(undefined,version);
    const out=p.json(`(()=>{const before=JSON.stringify(GF),state=gfStart(${JSON.stringify(at(0))}),results=[];
      ['strength-control','cardio-conditioning','strength-control','cardio-conditioning','core-stability','athletic-movement','full-body-challenges']
        .forEach((family,i)=>results.push(gfResult('r'+i,new Date(${T0}+i*86400000).toISOString(),family)));
      const plan=gfPlan(state,results,new Date(${T0}+9*86400000).toISOString(),{difficulty:'easy',duration:30});
      const ranked=plan.prescription.workoutFamilyPlan.candidates.map(c=>c.workoutFamilyId);
      const workout=GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:plan.prescription,random:seeded});
      return {family:workout.workoutFamilyId,version:workout.workoutFamilyVersion,ranked,
        validation:GarageFitGenerator.validateFamilyWorkout(workout,{catalogue:CATALOGUE,equipment:[]}),
        seconds:workout.estimatedSeconds,unchanged:before===JSON.stringify(GF),anchors:plan.prescription.requiredAnchors||[]};})()`);
    assert.equal(out.ranked[0],'mobility-movement-quality');assert.deepEqual(out.ranked.slice().sort(),FAMILIES.slice().sort());
    assert.equal(out.family,'mobility-movement-quality');assert.equal(out.version,3);assert.equal(out.seconds,1800);
    assert.equal(out.validation.valid,true);assert.equal(out.unchanged,true);assert.deepEqual(out.anchors,[]);
  }
});

test('both General Fitness definitions deliver mixed Strength & Control v3 on a fresh 30-minute session',async()=>{
  for(const version of [1,2]) {
    const p=context(undefined,version);
    await p.start();
    const out=p.json(`(()=>{const plan=pilot.plan({equipment:['dumbbells'],duration:30});gfSeed=31;
      const w=GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:plan.prescription,random:seeded,equipment:['dumbbells']});
      return {family:w.workoutFamilyId,version:w.workoutFamilyVersion,style:w.familyStyleId,blocks:w.main.blocks.map(b=>[b.protocol,b.exercises.length]),
        check:GarageFitGenerator.validateFamilyWorkout(w,{catalogue:CATALOGUE,equipment:['dumbbells']})};})()`);
    assert.deepEqual([out.family,out.version,out.style],['strength-control',3,'mixed-strength']);
    assert.ok(new Set(out.blocks.map(([protocol,size])=>protocol+':'+(size===1?'single':'multiple'))).size>=2);
    assert.deepEqual(out.check,{valid:true,technicalIssues:[],qualityIssues:[]});
  }
});

// #399: registering Strength & Stamina (`resistance-endurance`) as a seventh canonical family must not
// invalidate the released six-family definitions. The family set is checked exactly, by definition version.
test('General Fitness v1/v2 keep their exact six-family set with seven canonical families registered', async () => {
  for (const version of [1, 2]) {
    const p = context(undefined, version);
    assert.deepEqual(p.json('GarageFitWorkoutFamilies.FAMILY_IDS.slice().sort()'), [...FAMILIES, 'resistance-endurance'].sort());
    const validate = source => p.run(`(()=>{const copy=JSON.parse(JSON.stringify(GF));
      GarageFitCoachPolicies.createDefaultRegistry().get('general-fitness').validateDefinition(${source});return true;})()`);
    assert.equal(validate('GF'), true, 'the released definition still validates unchanged');
    const added = `{...copy.familyBalancePolicy.families[0],workoutFamilyId:'resistance-endurance',effects:{strength:0.5,conditioning:0.5}}`;
    // Exact, not a size check: neither an extra family nor a substitution is a valid v1/v2 set.
    assert.throws(() => validate(`{...copy,familyBalancePolicy:{...copy.familyBalancePolicy,families:[...copy.familyBalancePolicy.families,${added}]}}`), /every canonical workout family/);
    assert.throws(() => validate(`{...copy,familyBalancePolicy:{...copy.familyBalancePolicy,families:[...copy.familyBalancePolicy.families.slice(0,5),${added}]}}`), /every canonical workout family/);
    // v3 publishes a distinct seven-family policy.
    assert.equal(validate("GarageFitData.programmes['general-fitness'][3]"), true);
    assert.throws(() => validate(`{...copy,version:3,resistanceDayPolicy:{windowDays:7,targetDays:2,unitsPerDay:4}}`), /every canonical workout family/);
    // Existing instances still plan exactly the six released families and run the cross-source context:
    // a standalone Strength & Stamina result is read through the exercise-metadata fallback, never relabelled.
    await p.start();
    const out = p.json(`(()=>{const state=gfStart(${JSON.stringify(at(0))});
      const result=gfResult('re',${JSON.stringify(at(10))},'resistance-endurance',{source:'generator',style:'metcon',exerciseIds:['air-squat','jumping-jacks','push-up']});
      const plan=gfPlan(state,[result],${JSON.stringify(at(48))});
      return {candidates:plan.prescription.workoutFamilyPlan.candidates.map(item=>item.workoutFamilyId),
        history:plan.rationale.priorities.history.sessions.map(item=>[item.workoutFamilyId,item.familyStyleId,item.basis])};})()`);
    assert.deepEqual(out.candidates.slice().sort(), FAMILIES.slice().sort());
    assert.deepEqual(out.history, [['resistance-endurance', 'metcon', 'exercise-metadata']]);
    assert.ok(p.run('Object.isFrozen(GarageFitData.programmes["general-fitness"]['+version+'])'));
  }
});

// #400 fixtures use the player’s actual prescription when generated, or explicit
// known/unknown performed evidence to target a particular scheduling boundary.
function v3Context(storage) {
  const p = context(storage, 3);
  p.run(`
    function evidenceResult(id, endedAt, plan, options={}) {
      const source=options.source || 'generator';
      return GarageFitCoachModel.createSessionResult({source, sessionResultId:id, endedAt, startedAt:endedAt,
        ...(source==='coach' ? {programmeInstanceId:options.instance || 'gf',prescriptionId:'rx-'+id} : {}),
        ...options.identity, finalStatus:options.status || 'completed', feedback:options.feedback,
        plannedWork:options.withoutPlan ? [] : plan,
        performedWork:plan.flatMap(entry=>{
          const outcome=options.outcomes ? options.outcomes(entry) : {status:'completed'};
          return outcome ? [{exerciseId:entry.exerciseId,occurrenceId:entry.occurrenceId,...outcome}] : [];
        })
      });
    }
    function repsPlan(exerciseId, count, reps=8, section='main') {
      return Array.from({length:count},(_,i)=>({exerciseId,occurrenceId:'occ:'+i,section,blockIndex:0,
        prescription:{type:'reps',timed:false,reps,side:null,protocol:'paired_sets'}}));
    }
    function generatedEvidence(settings, seed, options={}) {
      gfSeed=seed;
      const workout=GarageFitGenerator.generate({catalogue:CATALOGUE,random:seeded,...settings});
      const plan=GarageFitSessionTracker.plannedWorkFromTimeline(buildGeneratedTimeline(workout));
      const result=evidenceResult('generated:'+seed,'2026-10-05T09:00:00Z',plan,
        {identity:GarageFitSessionTracker.identityFromWorkout(workout),...options});
      return {workout, result, dose:gfPlan(gfStart('2026-10-05T08:00:00Z'),[result],'2026-10-07T09:00:00Z').rationale.priorities.resistance};
    }
  `);
  return p;
}

test('v3 scores actual traditional Cardio and Cardio v2 station roles independently of movement tags', () => {
  const p = v3Context();
  const cases = p.json(`[generatedEvidence({focus:'cardio',duration:10,difficulty:'normal',equipment:['dumbbells']},7),
    generatedEvidence({focus:'cardio',duration:10,difficulty:'normal',equipment:['dumbbells']},7,
      {outcomes:entry=>['devils-press','ski-abs'].includes(entry.exerciseId)?{status:'completed'}:null}),
    generatedEvidence({workoutFamilyId:'cardio-conditioning',workoutFamilyVersion:2,duration:10,difficulty:'easy',equipment:[]},7),
    generatedEvidence({focus:'cardio',duration:30,difficulty:'hard',
      equipment:['dumbbells','kettlebell','pullup-bar','trx','rings','barbell','bench','box','bands']},42)]`);
  assert.deepEqual(cases[0].workout.main.blocks[0].exercises.map(ex => ex.id),
    ['devils-press','dumbbell-suitcase-carry','walking-lunge','ski-abs']);
  assert.equal(cases[0].dose.days[0].units, 4, 'two loaded carries and controlled alternating lunges earn credit');
  assert.equal(cases[0].dose.patterns.hinge, undefined, 'the cardio-led devil’s press earns no hinge credit');
  assert.equal(cases[1].dose.days[0].units, 0, 'the conditioning stations alone do not qualify');
  assert.ok(cases[2].workout.main.blocks.flatMap(block => block.exercises).some(ex => ex.id === 'air-squat'));
  assert.equal(cases[2].dose.days[0].units, 0, 'the resolved Cardio v2 station purpose disambiguates air squats');
  assert.ok(cases[3].workout.main.blocks[0].exercises.some(ex => ex.id === 'dumbbell-clean-and-press'));
  assert.equal(cases[3].dose.days[0].units, 6, 'renegade rows and suitcase marches contribute in a longer mixed circuit');
  assert.equal(cases[3].dose.patterns.push, undefined, 'ballistic clean-and-press does not add compound push dose');
});

test('Metcon family validation and v3 performed major resistance give distinct answers for triceps isolation', () => {
  const p = v3Context();
  const out = p.json(`(()=>{
    const equipment=['dumbbells','kettlebell','pullup-bar','trx','rings','barbell','bench','box','bands'];
    const settings={workoutFamilyId:'resistance-endurance',workoutFamilyVersion:1,duration:15,difficulty:'normal',equipment};
    const sample=generatedEvidence(settings,19), valid=GarageFitGenerator.validateFamilyWorkout(sample.workout,{catalogue:CATALOGUE,equipment}).valid;
    const isolation=generatedEvidence(settings,19,{outcomes:entry=>entry.exerciseId==='ring-triceps-extension'?{status:'completed'}:null});
    const substantive=generatedEvidence(settings,7);
    const strengths=[sample,substantive].map(({result})=>gfPlan(gfStart('2026-10-05T08:00:00Z'),[result],'2026-10-07T09:00:00Z')
      .rationale.priorities.effects.find(effect=>effect.effect==='strength').performedSessions);
    return {valid, sample, isolation, substantive, strengths};
  })()`);
  assert.equal(out.valid, true);
  assert.equal(out.sample.workout.familyStyleId, 'metcon');
  assert.ok(out.sample.workout.main.blocks[0].exercises.some(ex => ex.id === 'ring-triceps-extension'));
  assert.equal(out.isolation.dose.days[0].major, 0);
  assert.equal(out.isolation.dose.days[0].support, 1.5);
  assert.equal(out.isolation.dose.days[0].units, 0);
  assert.equal(out.isolation.dose.movements.push, undefined);
  assert.equal(out.substantive.dose.qualifyingDays, 1);
  assert.ok(out.strengths[1] > out.strengths[0], 'v3 balance distinguishes different performed work in the same style');
});

test('v3 quantifies partial Main work, caps support, and credits unilateral and multi-pattern work once', () => {
  const p = v3Context();
  const out = p.json(`(()=>{
    const when='2026-10-05T12:00:00Z', state=gfStart('2026-10-05T08:00:00Z');
    const r=(id,plan,options)=>evidenceResult(id,when,plan,options);
    const bridge=repsPlan('single-leg-glute-bridge',4).map((entry,i)=>({...entry,prescription:{...entry.prescription,side:i%2?'left':'right'}}));
    const multi=repsPlan('dumbbell-bent-over-row',1);
    const timed=repsPlan('plank',12).map(entry=>({...entry,prescription:{type:'timed',timed:true,seconds:20,side:null}}));
    const cases=[
      r('sides',bridge,{status:'partial',outcomes:entry=>entry.occurrenceId==='occ:2'?{status:'partial',sets:[{reps:4}]}:entry.occurrenceId==='occ:3'?{status:'skipped'}:{status:'completed'}}),
      r('short-reps',repsPlan('push-up',5,4)),
      r('note',repsPlan('push-up',2),{outcomes:()=>({status:'partial',note:'Some work'})}),
      r('historical',repsPlan('push-up',3),{withoutPlan:true}),
      r('warm-up',repsPlan('push-up',6,8,'warmup')),
      r('zero',repsPlan('push-up',5),{outcomes:()=>({status:'completed',sets:[{reps:0}]})}),
      r('two-major',repsPlan('push-up',2)),
      r('supports',timed,{outcomes:entry=>entry.occurrenceId==='occ:0'?{status:'partial',sets:[{seconds:10}]}:{status:'completed'}})
    ];
    const summarise=results=>gfPlan(state,results,'2026-10-08T12:00:00Z').rationale.priorities.resistance;
    return {single:cases.map(item=>summarise([item])), capped:summarise(cases.slice(-2)), multi:summarise([r('multi',multi)])};
  })()`);
  const units = out.single.map(item => item.days[0].units);
  assert.deepEqual(units, [1.25,0,0,0,0,0,2,0]);
  assert.deepEqual(out.single.map(item => item.incomplete), [false,false,true,true,false,false,false,false]);
  assert.equal(out.capped.days[0].support, 5.75);
  assert.equal(out.capped.days[0].units, 4);
  assert.equal(out.capped.movements.pull, undefined);
  assert.equal(out.capped.movements.core, 11.5);
  assert.equal(out.multi.days[0].units, 1);
  assert.equal(out.multi.patterns.hinge, 1);
  assert.equal(out.multi.patterns.pull, 1);
});

test('v3 groups performed sources by local date across DST and year boundaries and reports bounded history', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const p = v3Context();
    const out = p.json(`(()=>{
      const state=gfStart('2026-10-19T08:00:00Z');
      const r=(id,when,count,options)=>evidenceResult(id,when,repsPlan('dumbbell-romanian-deadlift',count),options);
      const a=r('a','2026-11-01T05:30:00Z',2,{source:'coach',instance:'old-instance'}),
            b=r('b','2026-11-01T06:30:00Z',2,{source:'fixed'});
      const before=r('before','2026-10-28T03:59:59Z',4);
      const inside=r('inside','2026-10-28T04:00:00Z',4);
      const external=r('external','2026-11-01T08:00:00Z',4,{source:'external'});
      const planned=r('planned','2026-11-02T08:00:00Z',4,{outcomes:()=>null});
      const date='2026-11-03T18:00:00Z';
      const atYear=r('year','2026-12-31T23:00:00Z',4);
      const p=(results,now=date,extra)=>gfPlan(state,results,now,extra).rationale.priorities;
      const many=Array.from({length:65},(_,i)=>r('stress-'+i,'2026-11-02T14:00:00Z',1));
      return {dst:p([a,b,b,before,inside,external,planned]), year:p([atYear],'2027-01-02T15:00:00Z'),
        dense:p(many), damaged:p([],date,{incompleteTrainingContext:true})};
    })()`);
    assert.deepEqual(out.dst.resistance.days.map(date => [date.localDate,date.units]), [['2026-11-01',4],['2026-10-28',4]]);
    assert.equal(out.dst.resistance.qualifyingDays, 2);
    assert.equal(out.dst.resistance.movements.push, undefined);
    assert.equal(out.dst.resistance.movements.pull, undefined);
    assert.equal(out.dst.history.credit, 'none');
  assert.equal(out.dst.attendance.sessionsPerWeek, 0);
    assert.equal(out.year.resistance.qualifyingDays, 1);
    assert.equal(out.year.resistance.days[0].localDate, '2026-12-31');
    assert.equal(out.dense.resistance.qualifyingDays, 1);
    assert.equal(out.dense.resistance.incomplete, true);
    assert.equal(out.dense.history.sessions.length, 64);
    assert.equal(out.damaged.resistance.incomplete, true);
    assert.ok(out.damaged.effects.every(effect => effect.confidence === 'unknown'));
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('v3 recovery considers a demanding session even after mobility and gives movement coverage its own preference', () => {
  const p = v3Context();
  const out = p.json(`(()=>{
    const state=gfStart('2026-10-05T08:00:00Z');
    const before='2026-10-06T10:00:00Z';
    const after='2026-10-07T15:00:00Z';
    const strength=evidenceResult('strength','2026-10-05T19:00:00Z',repsPlan('push-up',4),
      {identity:{workoutFamilyId:'strength-control',workoutFamilyVersion:3,familyStyleId:'paired-sets'}});
    const mobility=evidenceResult('mobility','2026-10-06T08:00:00Z',repsPlan('cat-cow',2),
      {identity:{workoutFamilyId:'mobility-movement-quality',workoutFamilyVersion:3,familyStyleId:'reset'}});
    const first=gfPlan(state,[strength,mobility],before), later=gfPlan(state,[strength,mobility],after);
    const easy=gfPlan(state,[],after,{easyToday:true});
    const legacy=legacyPlan();
    return {first,later,easy,legacy};
    function legacyPlan() {
      const def=GarageFitData.programmes['general-fitness'][2];
      const old=gfEngine.startProgramme(def,{programmeInstanceId:'old',equipment:[]},'2026-10-05T08:00:00Z').state;
      return gfEngine.planNextSession(def,old,[strength,mobility],{now:before,prescriptionId:'rx:old',equipment:[],duration:30});
    }
  })()`);
  assert.ok(out.first.rationale.priorities.recovery.reasons.includes('recent-demanding-session'));
  assert.equal(out.legacy.rationale.priorities.recovery.preferLowerDemand, false);
  assert.equal(out.first.rationale.priorities.resistance.qualifyingDays, 1);
  assert.equal(out.first.prescription.workoutFamilyPlan.resistanceFocus, undefined);
  assert.ok(out.first.rationale.priorities.families.every(item => item.resistanceBonus === 0));
  assert.equal(out.first.rationale.priorities.families[0].recoveryPenalty, 0);
  assert.equal(out.first.prescription.workoutFamilyPlan.candidates.length, 7, 'demanding alternatives stay available');
  assert.equal(out.later.prescription.workoutFamilyPlan.resistanceFocus, 'pull');
  assert.ok(out.later.rationale.priorities.families.some(item => item.resistanceBonus > 0));
  assert.ok(out.easy.rationale.priorities.families.every(item => item.resistanceBonus === 0));
});

test('finishing v2 and starting v3 uses old work only as context and recovers a v3 draft exactly once', async () => {
  const p = v3Context();
  await p.run("pilot.start(GarageFitData.programmes['general-fitness'][2],['dumbbells'])");
  await p.begin("{equipment:['dumbbells'],duration:20}");
  await p.run("(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>item.section==='main')) await pilotTracker.recordDone(work.occurrenceId);})()");
  const oldResult = await p.finish('complete');
  const oldState = p.json('pilot.snapshot().state');
  assert.equal(oldState.programmeDefinitionVersion, 2);
  assert.equal(oldState.meaningfulSessionsCompleted, 1);
  await p.run("pilot.manage('finish')");
  p.run("pilotNow='2026-10-03T08:00:00Z'");
  await p.start();
  const state = p.json('pilot.snapshot().state');
  assert.notEqual(state.programmeInstanceId, oldState.programmeInstanceId);
  assert.equal(state.programmeDefinitionVersion, 3);
  assert.equal(state.meaningfulSessionsCompleted, 0);
  assert.deepEqual(p.json('pilot.snapshot().results'), []);
  assert.deepEqual(p.json('pilot.progressEvidence().benchmarkResults'), []);
  const plan = p.json("pilot.plan({equipment:['dumbbells'],duration:20})");
  assert.equal(plan.prescription.workoutFamilyPlan.candidates.length, 7);
  assert.ok(plan.rationale.priorities.history.sessions.some(item => item.sessionResultId === oldResult.sessionResultId));
  assert.equal(plan.rationale.priorities.benchmark.reason, 'too-early');
  await p.begin("{equipment:['dumbbells'],duration:20}");
  await p.run("pilotTracker.recordDone(pilotTracker.plannedWork().find(item=>item.section==='main').occurrenceId)");
  const reopened = v3Context(p.storage);
  reopened.run("pilotNow='2026-10-03T10:00:00Z'");
  await reopened.run('pilot.load(true)');
  await reopened.run('pilot.load(true)');
  assert.equal(reopened.json('pilot.snapshot().state').meaningfulSessionsCompleted, 1);
  assert.equal(reopened.json('pilot.snapshot().results').length, 1);
  const portable = reopened.json(`(()=>{
    const backup=GarageFitCoachStore.createBackupAccess(localStorage);
    return backup.materialisePortable(backup.exportPortable());
  })()`);
  const restored = v3Context(new Map(portable));
  restored.run("pilotNow='2026-10-03T10:00:00Z'");
  await restored.run('pilot.load()');
  assert.deepEqual(restored.json('pilot.snapshot().state'), reopened.json('pilot.snapshot().state'));
  assert.deepEqual(restored.json('pilot.snapshot().results'), reopened.json('pilot.snapshot().results'));
  const restoredV2 = await restored.run(`pilotStore.loadProgrammeState(${JSON.stringify(oldState.programmeInstanceId)})`);
  assert.equal(restoredV2.programmeDefinitionVersion, 2);
  assert.equal(restoredV2.status, 'completed');
});

test('v3 uses only confirmed AMRAP occurrences and measured benchmark work', () => {
  const p = v3Context();
  const out = p.json(`(()=>{
    const state=gfStart('2026-10-05T08:00:00Z'), when='2026-10-05T12:00:00Z';
    const amrap=repsPlan('push-up',2).map(work=>({...work,prescription:{...work.prescription,protocol:'amrap',amrapSequence:1}}));
    const benchmark=repsPlan('air-squat',1).map(work=>({...work,requirementId:'benchmark:air-squat',
      prescription:{...work.prescription,protocol:'rounds'}}));
    const results=[
      evidenceResult('amrap',when,amrap,{feedback:{rounds:6}}),
      evidenceResult('benchmark-unmeasured',when,benchmark,{source:'coach'}),
      evidenceResult('benchmark-low',when,benchmark,{source:'coach',outcomes:()=>({status:'completed',sets:[{reps:3}]})}),
      evidenceResult('benchmark-measured',when,benchmark,{source:'coach',outcomes:()=>({status:'completed',sets:[{reps:8}]})})
    ];
    return results.map(result=>gfPlan(state,[result],'2026-10-07T12:00:00Z').rationale.priorities.resistance);
  })()`);
  assert.deepEqual(out.map(item => item.days[0].units), [2,0,0,1]);
  assert.deepEqual(out.map(item => item.incomplete), [true,true,false,false]);
});

test('[Full] v3 plans resistance on distinct dates while retaining other training across weekly frequencies', () => {
  const p = v3Context();
  const simulation = p.json(`[2,3,4,5].map(perWeek=>{
    let state=gfStart('2026-10-05T08:00:00Z'), results=[];
    const counts={}, weeks=[];
    gfSeed=41+perWeek;
    for(let i=0;i<perWeek*5;i++){
      const hour=Math.round(i*7/perWeek*24), now=new Date(${T0}+hour*3600000).toISOString();
      const plan=gfPlan(state,results,now,{duration:i%3===0?15:20,equipment:['dumbbells']});
      const workout=GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:plan.prescription,random:seeded});
      const family=workout.workoutFamilyId;
      counts[family]=(counts[family]||0)+1;
      const work=GarageFitSessionTracker.plannedWorkFromTimeline(buildGeneratedTimeline(workout));
      const result=evidenceResult('sim-'+i,now,work,{source:'coach',identity:GarageFitSessionTracker.identityFromWorkout(workout)});
      results.push(result);
      state=gfEngine.applySessionResult(GF,state,result,results);
      if ((i+1)%perWeek===0) {
        const report=gfPlan(state,results,now,{equipment:['dumbbells']}).rationale.priorities.resistance;
        weeks.push(report.qualifyingDays);
      }
      if(plan.rationale.missedSessionResponse.catchUpSessions!==0) throw Error('Unexpected catch-up');
      if(workout.familyStyleId===undefined || !GarageFitGenerator.validateFamilyWorkout(workout,{catalogue:CATALOGUE,equipment:['dumbbells']}).valid)
        throw Error('Invalid delivered family '+family);
    }
    return {perWeek,counts,weeks,credited:state.meaningfulSessionsCompleted};
  })`);
  for (const result of simulation) {
    const note = JSON.stringify(result);
    assert.equal(result.credited, 5 * result.perWeek, note);
    assert.ok(result.weeks.filter(count => count >= 2).length >= 2, note);
    assert.ok(result.counts['strength-control'] >= 1 && result.counts['resistance-endurance'] >= 1, note);
    assert.ok(Object.keys(result.counts).some(family => !['strength-control','resistance-endurance'].includes(family)), note);
    if (result.perWeek >= 4) assert.ok(Object.keys(result.counts).length >= 4, note);
  }
});

test('v3 controller propagates bounded, undated and damaged cross-source evidence without withholding known work', async () => {
  const p = v3Context(new Map());
  await p.run(`(async()=>{
    await pilotStore.saveSessionResult(evidenceResult('undated',null,repsPlan('push-up',4)));
    for(let i=0;i<64;i++) await pilotStore.saveSessionResult(
      evidenceResult('dated-'+i,'2026-09-29T08:00:00Z',repsPlan('push-up',i===0?4:1)));
  })()`);
  await p.start();
  const flags = await p.run(`pilotStore.listSessionResults({sources:['generator'],performedOnly:true,
    since:'2026-09-28T00:00:00Z',limit:64,candidateLimit:64,reportTruncation:true})`);
  assert.equal(flags.truncated, false);
  assert.equal(flags.undated, true);
  await p.run("pilotStore.saveSessionResult(evidenceResult('overflow','2026-09-30T09:00:00Z',repsPlan('push-up',4)))");
  const damaged = [...p.storage.keys()].find(key => key.endsWith('dated-1'));
  assert.ok(damaged);
  p.storage.set(damaged, '{invalid');
  await p.run('pilot.load()');
  const priorities = p.json('pilot.plan({equipment:[],duration:20}).rationale.priorities');
  assert.equal(priorities.resistance.incomplete, true);
  assert.equal(priorities.resistance.qualifyingDays, 2);
  assert.equal(priorities.history.sessions.length, 63);
  assert.equal(priorities.attendance.sessionsPerWeek, 0);
  assert.ok(p.run('pilot.snapshot().errors.length') > 0);
});
