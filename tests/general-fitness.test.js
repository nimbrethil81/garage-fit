const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');

// #190 General Fitness: anchor-free family scheduling on the common Coach engine.
const FAMILIES = ['strength-control','cardio-conditioning','full-body-challenges','athletic-movement','core-stability','mobility-movement-quality'];
const DEMANDING = ['strength-control','cardio-conditioning','full-body-challenges'];
const T0 = Date.parse('2026-10-05T08:00:00Z');
const at = hours => new Date(T0 + hours * 3600000).toISOString();

// A pure engine context with synthetic performed results; generation stays in the controller tests.
function context(storage) {
  const p = pilot(storage, 'general-fitness', 1);
  p.run(`
    const GF=pilotDef;
    const gfEngine=pilotEngine;
    let gfSeed=11;
    const seeded=()=>{gfSeed=gfSeed+0x6D2B79F5|0;let t=Math.imul(gfSeed^gfSeed>>>15,1|gfSeed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
    function gfResult(id, when, family, options={}) {
      const source=options.source||'coach', exercises=options.exerciseIds||['air-squat','push-up','plank'];
      return GarageFitCoachModel.createSessionResult({sessionResultId:id, source,
        programmeInstanceId:source==='coach'?(options.instance||'gf'):null, prescriptionId:source==='coach'?'rx-'+id:null,
        ...(family?{workoutFamilyId:family,workoutFamilyVersion:1,familyStyleId:options.style||'style'}:{}),
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
    `{...copy,familyBalancePolicy:{...copy.familyBalancePolicy,families:[...copy.familyBalancePolicy.families.slice(1),{...copy.familyBalancePolicy.families[0],workoutFamilyVersion:2}]}}`
  ];
  for (const source of invalid) assert.throws(() => p.run(`(()=>{const copy=JSON.parse(JSON.stringify(GF));
    GarageFitCoachPolicies.createDefaultRegistry().get('general-fitness').validateDefinition(${source});})()`), /General Fitness/, source);
  // Existing published programme policies keep their own frozen strategy objects.
  assert.ok(p.run(`(()=>{const registry=GarageFitCoachPolicies.createDefaultRegistry();
    return registry.get('general-strength').buildPrescription===GarageFitCoachPolicies.generalStrengthPolicy.buildPrescription
      && registry.get('build-arms').interpretDose===GarageFitCoachPolicies.buildArmsPolicy.interpretDose
      && registry.get('tennis-conditioning').buildPrescription===GarageFitCoachTennisPolicy.buildPrescription;})()`));
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
