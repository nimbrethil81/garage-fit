const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
global.window = global;
for (const file of ['data/exercises','data/sport-profiles','data/sport-capabilities','data/programmes',
  'js/coach-model','js/training-history','js/sport-coverage','js/coach-policies','js/coach-tennis-policy','js/coach-engine','js/generator']) require('../'+file);
const {sessionResult} = require('./helpers/coach-fixtures');
const {pilot} = require('./helpers/coach-pilot');
const Model = GarageFitCoachModel, catalogue = GarageFitData.exercises;
const definition = GarageFitData.programmes['tennis-conditioning'][2];
const engine = GarageFitCoachEngine.createEngine({catalogue,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription});
const now = '2026-10-12T08:00:00Z', localDate = '2026-10-12', equipment = ['dumbbells'];
const copy = value => JSON.parse(JSON.stringify(value));
const start = (settings = {}, kit = equipment, frequency = 2) => engine.startProgramme(definition,
  {programmeInstanceId:'tennis-context',equipment:kit,programmeSettings:{sportId:'tennis',weeklyCoachFrequency:frequency,...settings}},now).state;
const plan = (state, options = {}, results = []) => engine.planNextSession(definition,state,results,
  {now,localDate,equipment,duration:30,prescriptionId:'context-rx',...options});
const readiness = value => ({readiness:{value,localDate}});
const report = (intensity = 'hard', date = '2026-10-11') => ({sportId:'tennis',localDate:date,intensity});
const adaptation = planned => planned.rationale.priorities.adaptation;
const anchors = (state, rx) => rx.requiredAnchors.filter(item => state.anchors.some(anchor => anchor.requirementId === item.requirementId));
const random = seed => () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; };

test('context is closed, dated, bounded and rejects corrupt/unsupported values visibly', () => {
  const state = start();
  for (const context of [{},readiness('fresh'),readiness('normal'),readiness('tired'),
    {readiness:null,reportedSportActivity:[],plannedMatchDate:'2026-10-13'}]) assert.doesNotThrow(()=>Model.assertSessionContext(context));
  for (const context of [{readiness:{}},{readiness:{value:'unknown',localDate}},
    {readiness:{value:'tired'}},{readiness:{value:'tired',localDate:'2026-02-30'}},
    {fatigueScore:5},{reportedSportActivity:[report('unknown')]},
    {reportedSportActivity:[report(),report()]},{reportedSportActivity:Array.from({length:8},(_,i)=>report('light','2026-10-'+String(i+1).padStart(2,'0')))},
    {reportedSportActivity:[{...report(),automaticImport:true}]},{plannedMatchDate:'2026-02-30'}]) {
    assert.throws(()=>plan(state,{sessionContext:context}),/session-context/);
  }
  for (const date of ['2026-10-13','2026-10-04']) assert.throws(()=>plan(state,{sessionContext:{reportedSportActivity:[report('hard',date)]}}),/within the last/);
  assert.throws(()=>plan(state,{sessionContext:{readiness:{value:'fresh',localDate:'2026-10-13'}}}),/future/);
  assert.throws(()=>plan(state,{localDate:'2026-02-30'}),/calendar date/);
  assert.throws(()=>plan(state,{allowedImpact:['invented'],sessionContext:readiness('tired')}),/availability/);
  assert.equal(plan(state,{duration:12,sessionContext:readiness('tired')}).prescription,null);
});

test('missing, Fresh and Normal retain the same justified targets without a bonus or stored check-in', () => {
  const state = start(), before = copy(state), baseline = plan(state);
  for (const value of ['fresh','normal']) {
    const planned = plan(state,{sessionContext:readiness(value)});
    assert.equal(adaptation(planned).classification,'usual');
    assert.deepEqual(planned.prescription.requiredAnchors,baseline.prescription.requiredAnchors);
    assert.deepEqual(planned.prescription.avoidConstraints,baseline.prescription.avoidConstraints);
    assert.deepEqual(planned.prescription.programmeContext.overrides,baseline.prescription.programmeContext.overrides);
  }
  assert.equal(adaptation(baseline).readiness,'normal');
  assert.deepEqual(state,before);
  assert.equal(state.currentTargets.dose.exposure,0);
});

test('calendar preferences predict upcoming activity but cannot confirm yesterday or award work', () => {
  const usual = start({usualPlayingDays:['monday'],typicalSportIntensity:'hard'}), before = copy(usual);
  const planned = plan(usual);
  assert.equal(adaptation(planned).classification,'lighter');
  assert.deepEqual(adaptation(planned).scheduledSport,[{localDate,intensity:'hard',confirmation:'planned'}]);
  assert.deepEqual(adaptation(planned).reportedSportActivity,[]);
  assert.ok(adaptation(planned).reasons.includes('lighter before planned tennis'));
  const following = plan(usual,{now:'2026-10-13T08:00:00Z',localDate:'2026-10-13'});
  assert.equal(adaptation(following).classification,'usual');
  assert.deepEqual(adaptation(following).reportedSportActivity,[]);
  const confirmed = plan(start(),{sessionContext:{reportedSportActivity:[report()]}});
  assert.equal(adaptation(confirmed).classification,'lighter');
  assert.ok(adaptation(confirmed).reasons.includes('lighter after reported hard tennis'));
  assert.deepEqual(adaptation(confirmed).scheduledSport,[]);
  assert.deepEqual(usual,before);
  const unperformed = Model.createSessionResult(sessionResult({programmeInstanceId:usual.programmeInstanceId,
    plannedWork:[],performedWork:[],anchorResults:[],overrides:planned.prescription.programmeContext.overrides,finalStatus:'abandoned'}));
  const after = engine.applySessionResult(definition,usual,unperformed,[]);
  assert.equal(after.meaningfulSessionsCompleted,0); assert.equal(after.currentTargets.dose.exposure,0);
  assert.deepEqual(after.anchors,usual.anchors);
  assert.equal(plan(usual,{},[unperformed]).rationale.priorities.coverage.uniqueExposure.value,0);
});

test('irregular/light/moderate schedules and older reports do not invent demanding participation', () => {
  for (const intensity of ['light','moderate']) {
    const planned = plan(start({usualPlayingDays:['monday'],typicalSportIntensity:intensity}));
    assert.equal(adaptation(planned).classification,'usual');
    assert.equal(adaptation(planned).scheduledSport.length,1);
    assert.equal(adaptation(plan(start(),{sessionContext:{reportedSportActivity:[report(intensity)]}})).classification,'usual');
  }
  assert.deepEqual(adaptation(plan(start())).scheduledSport,[]);
  for (const date of ['2026-10-10','2026-10-05']) {
    assert.equal(adaptation(plan(start(),{sessionContext:{reportedSportActivity:[report('hard',date)]}})).classification,'usual');
  }
  const stale = plan(start(),{sessionContext:{readiness:{value:'tired',localDate:'2026-10-11'}}});
  assert.equal(adaptation(stale).readiness,'normal');
});

test('local midnight, weekday/week/year boundaries and DST use calendar dates, not UTC offsets', () => {
  const state = start({usualPlayingDays:['monday'],typicalSportIntensity:'hard'});
  const lateSunday = plan(state,{now:'2026-10-11T23:30:00-07:00',localDate:'2026-10-11'});
  assert.deepEqual(adaptation(lateSunday).scheduledSport.map(item=>item.localDate),['2026-10-12']);
  // The same instant has a different UTC label; the explicit local date wins.
  assert.deepEqual(adaptation(lateSunday),adaptation(plan(state,{now:'2026-10-12T06:30:00Z',localDate:'2026-10-11'})));
  const oldCheckIn = plan(state,{now:'2026-10-12T00:01:00-07:00',sessionContext:{readiness:{value:'tired',localDate:'2026-10-11'}}});
  assert.equal(adaptation(oldCheckIn).readiness,'normal');
  const year = plan(start({usualPlayingDays:['friday'],typicalSportIntensity:'hard'}),{now:'2026-12-31T23:30:00Z',localDate:'2026-12-31'});
  assert.deepEqual(adaptation(year).scheduledSport.map(item=>item.localDate),['2027-01-01']);
  const dst = plan(start({usualPlayingDays:['sunday'],typicalSportIntensity:'hard'}),{now:'2026-11-02T00:05:00-08:00',localDate:'2026-11-02',
    sessionContext:{reportedSportActivity:[report('hard','2026-11-01')]}});
  assert.equal(adaptation(dst).classification,'lighter');
  assert.deepEqual(adaptation(dst).scheduledSport,[]);
});

test('nearby planned matches/events are preferences, while Tired on that date offers rest', () => {
  const event = start({intent:'event',significantEventDate:'2026-10-13'});
  const planned = plan(event);
  assert.equal(adaptation(planned).plannedEventDate,'2026-10-13');
  assert.equal(adaptation(planned).classification,'lighter');
  assert.equal(plan(start(),{sessionContext:{plannedMatchDate:'2026-10-13'}}).prescription.duration,20);
  assert.equal(adaptation(plan(start(),{sessionContext:{plannedMatchDate:'2026-10-15'}})).classification,'usual');
  const rest = plan(start(),{sessionContext:{...readiness('tired'),plannedMatchDate:localDate}});
  assert.equal(rest.prescription,null); assert.equal(rest.conflicts[0].code,'tennis-rest-recommended');
  const eventToday = engine.updateProgrammeSettings(definition,event,{significantEventDate:localDate});
  assert.equal(plan(eventToday,{sessionContext:readiness('tired')}).prescription,null);
});

test('lighter and Tired sessions fit every budget/frequency/kit without lowering permanent baselines', () => {
  for (const frequency of [1,2,3]) for (const kit of [equipment,['kettlebell','pullup-bar'],['trx'],['bands']]) {
    const state = start({},kit,frequency), before = copy(state);
    for (const duration of [10,15,20,30,45]) for (const kind of ['tired','reported']) {
      const sc = kind==='tired' ? readiness('tired') : {reportedSportActivity:[report()]};
      const planned = plan(state,{equipment:kit,duration,sessionContext:sc});
      assert.ok(planned.prescription,JSON.stringify(planned.conflicts));
      const rx = planned.prescription, stable = anchors(state,rx);
      assert.ok(stable.length <= 1);
      assert.ok(stable.every(item => item.targetSets===(kind==='tired'?1:2)));
      assert.equal(rx.duration,Math.min(duration,kind==='tired'?15:20));
      assert.ok(rx.programmeContext.overrides.some(item=>item.type==='easy-today'));
      for (const seed of [5,51]) {
        const workout = GarageFitGenerator.generate({catalogue,sessionPrescription:rx,random:random(seed)});
        assert.ok(workout.estimatedSeconds<=rx.duration*60);
        assert.ok(workout.main.estimatedDurationSeconds<=rx.mainTimeLimitSeconds);
        assert.ok(workout.warmup.estimatedSeconds>0 && workout.rampup.estimatedSeconds>0 && workout.cooldown.estimatedSeconds>0);
        assert.equal(workout.prescriptionOutcome.requiredAnchorPlacements.length,rx.requiredAnchors.length);
        for (const phase of [workout.warmup,workout.rampup,workout.cooldown,...workout.main.blocks]) {
          assert.ok(phase.exercises.every(item=>item.impact!=='high'));
        }
        assert.ok(workout.main.blocks.flatMap(block=>block.exercises).every(item=>!item.conditioning));
      }
    }
    assert.deepEqual(state,before);
  }
});

test('home space, caller hard avoids, impact limits and substitutions stay hard under adaptations', () => {
  const state = start(), push = 'tennis-anchor-push';
  const planned = plan(state,{duration:10,allowedImpact:['low'],sessionContext:readiness('tired'),
    anchorSubstitutions:{[push]:'push-up'},avoidConstraints:[{requirementId:'today-avoid-pull',importance:'hard',pattern:'pull'}]});
  assert.ok(planned.prescription);
  assert.equal(planned.prescription.requiredAnchors.find(item=>item.requirementId===push).exerciseId,'push-up');
  assert.equal(state.anchors.find(item=>item.requirementId===push).exerciseId,'dumbbell-floor-press');
  const workout = GarageFitGenerator.generate({catalogue,sessionPrescription:planned.prescription,random:random(17)});
  for (const phase of [workout.warmup,workout.rampup,workout.cooldown,...workout.main.blocks]) {
    assert.ok(phase.exercises.every(item=>item.impact==='low' && !item.patterns.includes('pull')));
  }
  assert.ok(plan(state).prescription.avoidConstraints.some(item=>item.exerciseId==='skater-jumps' && item.importance==='hard'));
  const noEquipment = plan(state,{equipment:[],duration:10,sessionContext:readiness('tired')});
  assert.ok(noEquipment.prescription);
  assert.ok(noEquipment.prescription.requiredAnchors.every(item=>catalogue[item.exerciseId].equipment.length===0));
  const impossible = plan(state,{allowedImpact:[],sessionContext:readiness('tired')});
  assert.equal(impossible.prescription,null);
  assert.ok(impossible.conflicts.some(item=>item.code==='tennis-no-useful-session'));
  assert.deepEqual(impossible.rationale.priorities.adaptation.reportedSportActivity,[]);
});

test('rest is explainable and preparing it invalidates a prior preview without a result/draft', async () => {
  const p = pilot(new Map(),'tennis-conditioning',2); await p.start();
  p.run("pilot.prepare(pilotOptions)");
  const before = p.json('pilot.snapshot().state'), storage = [...p.storage.entries()];
  const rest = p.json(`pilot.prepare({...pilotOptions,sessionContext:{readiness:{value:'tired',localDate:'2026-10-01'},
    reportedSportActivity:[{sportId:'tennis',localDate:'2026-10-01',intensity:'hard'}]}})`);
  assert.equal(rest.plan.prescription,null); assert.match(rest.plan.conflicts[0].message,/Rest today/);
  assert.equal(p.run('pilot.snapshot().preview'),null);
  await assert.rejects(p.run('pilot.begin()'),/Prepare a session/);
  assert.deepEqual(p.json('pilot.snapshot().state'),before); assert.deepEqual([...p.storage.entries()],storage);
  assert.equal(await p.run('pilotStore.loadSessionDraft()'),null);
  assert.equal((await p.run('pilotStore.listSessionResults()')).results.length,0);
  p.run('pilot.prepare(pilotOptions)');
  assert.throws(()=>p.run("pilot.prepare({...pilotOptions,sessionContext:{readiness:{value:'unknown'}}})"),/session-context/);
  assert.equal(p.run('pilot.snapshot().preview'),null);
});

test('one Tired session holds targets, earns only performed dose, replays once and never persists the response', async () => {
  const p = pilot(new Map(),'tennis-conditioning',2); await p.start();
  const original = p.json('pilot.snapshot().state');
  await p.begin("{...pilotOptions,sessionContext:{readiness:{value:'tired',localDate:'2026-10-01'}}}");
  const rx = p.json('pilot.snapshot().preview.plan.prescription');
  const push = rx.requiredAnchors.find(item=>item.requirementId==='tennis-anchor-push'); assert.equal(push.targetSets,1);
  await p.log(push.requirementId); const result = await p.finish();
  const after = p.json('pilot.snapshot().state');
  assert.deepEqual(after.anchors.map(item=>item.currentTarget),original.anchors.map(item=>item.currentTarget));
  assert.ok(after.meaningfulSessionsCompleted>0 && after.currentTargets.dose.exposure>0);
  assert.equal(after.currentTargets.sessionContext,undefined);
  assert.deepEqual(p.json(`pilotEngine.applySessionResult(pilotDef,pilot.snapshot().state,${JSON.stringify(result)},[])`),after);
  const rebuilt = p.json('pilotEngine.rebuildDerivedState(pilotDef,pilot.snapshot().state,pilot.snapshot().results)');
  assert.deepEqual(rebuilt.currentTargets.programmeSettings,after.currentTargets.programmeSettings);
  assert.equal(rebuilt.currentTargets.dose.exposure,after.currentTargets.dose.exposure);
  p.run("pilotNow='2026-10-02T08:00:00Z'");
  const normal = p.json('pilot.plan(pilotOptions).prescription');
  assert.equal(normal.difficulty,'normal');
  assert.ok(normal.requiredAnchors.filter(item=>item.requirementId.startsWith('tennis-anchor-')).every(item=>item.targetSets===2));
  assert.equal(normal.programmeContext.adaptation.readiness,'normal');
  const reopened = pilot(p.storage,'tennis-conditioning',2); await reopened.run('pilot.load()');
  assert.deepEqual(reopened.json('pilot.snapshot().state'),after);
});

test('a preview cannot carry a dated check-in or calendar prediction across local midnight', async () => {
  const p = pilot(new Map(),'tennis-conditioning',2); await p.start();
  p.run('pilotNow=new Date(2026,9,1,23,59).toISOString()');
  p.run("pilot.prepare({...pilotOptions,sessionContext:{readiness:{value:'tired',localDate:'2026-10-01'}}})");
  const oldContext = p.json('pilot.snapshot().preview.today');
  const before = [...p.storage.entries()];
  p.run('pilotNow=new Date(2026,9,2,0,1).toISOString()');
  await assert.rejects(p.run('pilot.begin()'),/local day changed/);
  assert.equal(p.run('pilot.snapshot().preview'),null);
  assert.deepEqual([...p.storage.entries()],before);
  assert.equal(p.run(`pilot.prepare(${JSON.stringify(oldContext)}).plan.prescription.programmeContext.adaptation.readiness`),'normal');
  assert.equal(p.run('pilot.prepare(pilotOptions).plan.prescription.programmeContext.adaptation.readiness'),'normal');
});

test('existing two programmes and pinned Tennis v1 do not adopt context policy or change prescriptions', () => {
  assert.equal(GarageFitData.programmes['tennis-conditioning'][1].contextPolicy,undefined);
  assert.ok(Object.isFrozen(definition.contextPolicy));
  for (const id of ['general-strength-4w','build-arms','tennis-conditioning']) {
    const def = GarageFitData.programmes[id][1], kit = id==='build-arms'?['dumbbells','bench']:equipment;
    const state = engine.startProgramme(def,{programmeInstanceId:id,equipment:kit},now).state;
    const context = {now,prescriptionId:'compatibility',equipment:kit,duration:30};
    const before = engine.planNextSession(def,state,[],context);
    const after = engine.planNextSession(def,state,[],{...context,localDate,
      sessionContext:{...readiness('tired'),reportedSportActivity:[report()],plannedMatchDate:localDate}});
    assert.deepEqual(after,before);
  }
});

test('browser controller supplies localDate for UTC clocks in positive/negative zones across midnight', () => {
  for (const [zone,date] of [['America/Los_Angeles','2026-10-11'],['Pacific/Auckland','2026-10-12']]) {
    const source = `const assert=require('node:assert/strict');const {pilot}=require('./tests/helpers/coach-pilot');
      (async()=>{const p=pilot(new Map(),'tennis-conditioning',2);await p.start();p.run("pilotNow='2026-10-12T00:30:00Z'");
        assert.equal(p.run('pilot.plan(pilotOptions).rationale.priorities.adaptation.localDate'),${JSON.stringify(date)});
      })().catch(error=>{console.error(error);process.exitCode=1;});`;
    const child = spawnSync(process.execPath,['-e',source],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,TZ:zone},encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);
  }
});

test('v6 movement roles respect short/equipment-limited, readiness, tennis, phase and event constraints',()=>{
  const {roles}=require('./helpers/tennis-movement');
  const cases=[{duration:10},{duration:15},{options:{equipment:[]}},{consolidation:true},{options:{easyToday:true}},
    ...['2026-10-02','2026-10-05','2026-10-11','2026-11-01'].map(date=>({settings:{intent:'event',significantEventDate:date}})),
    {options:{allowedImpact:['low']}},{options:{sessionContext:{readiness:{value:'tired',localDate:'2026-10-01'}}}},
    {options:{sessionContext:{reportedSportActivity:[{sportId:'tennis',localDate:'2026-10-01',intensity:'hard'}]}}},
    {options:{sessionContext:{plannedMatchDate:'2026-10-02'}}},
    {options:{allowedImpact:[]}},
    {options:{sessionContext:{readiness:{value:'tired',localDate:'2026-10-01'},plannedMatchDate:'2026-10-01'}}}];
  let shortfalls=0,rests=0;
  for(const equipment of [['dumbbells'],['trx']]) for(const scenario of cases) {
    const {rows}=roles({equipment,frequency:3,...scenario});
    for(const row of rows) {
      if(!row.workout){rests++;assert.ok(row.rest||row.assessment.hardConflicts.length);continue;}
      const rx=row.rx,workout=row.workout;
      assert.ok(workout.estimatedSeconds<=rx.duration*60);
      assert.ok(workout.main.estimatedDurationSeconds<=rx.mainTimeLimitSeconds);
      assert.equal(workout.prescriptionOutcome.requiredAnchorPlacements.length,rx.requiredAnchors.length);
      const hard=rx.avoidConstraints.filter(a=>a.importance==='hard').map(a=>a.exerciseId);
      const exercises=[workout.warmup,workout.rampup,workout.cooldown,...workout.main.blocks].flatMap(b=>b.exercises);
      assert.ok(exercises.every(e=>!hard.includes(e.id)));
      if(rx.difficulty==='easy')assert.ok(exercises.every(e=>e.difficulty!=='hard'&&e.impact!=='high'));
      if(row.role!=='strength') {
        const lateral=workout.main.blocks.flatMap(b=>b.exercises).some(e=>['alternating-lateral-lunge','cossack-squat','kettlebell-lateral-lunge'].includes(e.id));
        if(!lateral){shortfalls++;assert.ok(rx.programmeContext.warnings.some(w=>['tennis-role-movement-shortfall','tennis-session-role-unavailable'].includes(w.code)));}
      }
    }
  }
  assert.ok(shortfalls>0&&rests>0);
  const def=GarageFitData.programmes['tennis-conditioning'][6];
  let state=engine.startProgramme(def,{programmeInstanceId:'v6-phases',equipment},now).state;
  // A due consolidation holds the normal anchor targets; event constraints still win.
  state.currentTargets.tennisDevelopment.eligibleDevelopmentSessions=6;
  state.startedAt='2026-09-01T08:00:00Z';
  state.currentTargets.tennisDevelopment.developmentStartedAt=state.startedAt;
  state.currentTargets.tennisDevelopment.lastTransitionAt=state.startedAt;
  for(const days of [1,4,10]) {
    const eventDate=new Date(Date.parse(now)+days*86400000).toISOString().slice(0,10);
    const changed=engine.updateProgrammeSettings(def,state,{intent:'event',significantEventDate:eventDate},{now,localDate});
    const planned=engine.planNextSession(def,changed,[],{now,localDate,equipment,duration:30,prescriptionId:'v6-event'});
    if(!planned.prescription){assert.ok(planned.conflicts.length);continue;}
    const rx=planned.prescription;
    assert.equal(rx.programmeContext.phase.phase,'consolidation');
    assert.ok(rx.requiredAnchors.filter(a=>a.requirementId.startsWith('tennis-anchor-')).every(a=>a.targetSets===1));
    const workout=GarageFitGenerator.generate({catalogue,sessionPrescription:rx,random:random(95)});
    assert.ok(workout.estimatedSeconds<=rx.duration*60);
    assert.ok(workout.main.blocks.flatMap(b=>b.exercises).every(e=>e.impact!=='high'));
    assert.deepEqual(state.anchors.map(a=>a.currentTarget.targetSets),[2,2,2,2]);
  }
});

test('v9 constrained movement retains hard caller, impact and pre-event safeguards without strength anchors',async()=>{
  const {create,seed}=require('./helpers/tennis-pilot');
  const {p}=await create({version:9,frequency:3,settings:{intent:'event',significantEventDate:'2026-10-10'}});
  p.run(`pilotNow='2026-10-07T12:00:00Z';`);
  // Plan every role directly: a calendar adaptation must not force the family route.
  for(const roleIndex of [1,2]) {
    seed(p,31);
    p.run(`v9State=pilot.snapshot().state;v9Today={...pilotOptions,now:pilotNow,prescriptionId:'v9-constrained',allowedImpact:['low']};
      v9History=GarageFitTrainingHistory.createHistory([],CATALOGUE);
      v9Priorities=GarageFitCoachTennisPolicy.calculatePriorities({definition:pilotDef,catalogue:CATALOGUE,state:v9State,history:v9History,today:v9Today});
      v9Priorities.role=pilotDef.sessionRoles[3][${roleIndex}];
      v9Rx=GarageFitCoachTennisPolicy.buildPrescription({definition:pilotDef,catalogue:CATALOGUE,state:v9State,history:v9History,today:v9Today,priorities:v9Priorities,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription,allowRoleFallback:false});`);
    const rx=p.json('v9Rx');assert.equal(rx.workoutFamilyPlan,undefined);
    assert.ok(rx.requiredAnchors.every(a=>!a.requirementId.startsWith('tennis-anchor-')));
    if(!rx.programmeContext.emptySession) {
      p.run('v9Workout=GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:v9Rx})');
      assert.ok(p.json('v9Workout.main.blocks.flatMap(b=>b.exercises)').every(e=>e.impact==='low'&&!e.conditioning));
    }
  }
});
