const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
global.window = global;
for (const file of ['data/exercises','data/sport-profiles','data/sport-capabilities','data/programmes',
  'js/coach-model','js/training-history','js/sport-coverage','js/coach-policies','js/coach-tennis-policy','js/coach-engine','js/generator']) require('../'+file);
const {sessionResult} = require('./helpers/coach-fixtures');
const {pilot} = require('./helpers/coach-pilot');
const Model = GarageFitCoachModel, catalogue = GarageFitData.exercises, definitions = GarageFitData.programmes;
const definition = definitions['tennis-conditioning'][4];
const engine = GarageFitCoachEngine.createEngine({catalogue,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription});
const now='2026-10-12T08:00:00Z', localDate='2026-10-12', equipment=['dumbbells'];
const copy = value => JSON.parse(JSON.stringify(value));
const dateIn = days => new Date(Date.parse(localDate+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const start = (config={}, frequency=2) => engine.startProgramme(definition,{programmeInstanceId:'events',equipment,localDate,
  programmeSettings:{sportId:'tennis',weeklyCoachFrequency:frequency,...config}},now);
const event = (state,days,label=null) => engine.updateProgrammeSettings(definition,state,
  {intent:'event',significantEventDate:dateIn(days),significantEventLabel:label},{now,localDate});
const plan = (state,options={},results=[]) => engine.planNextSession(definition,state,results,
  {now,localDate,prescriptionId:'event-rx',equipment,duration:30,...options});
const horizon = planned => planned.rationale.priorities.event;
const random = seed => () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; };
let resultId=0;
function performed(rx, options={}) {
  const plannedWork=[], performedWork=[];
  for(const target of rx.requiredAnchors) {
    const exercise=catalogue[target.exerciseId], timed=target.prescriptionMode==='time';
    for(let set=0;set<target.targetSets;set++) for(const side of exercise.sidedness==='per-side'?['left','right']:[null]) {
      const occurrenceId=target.requirementId+'-'+set+'-'+side;
      plannedWork.push({occurrenceId,exerciseId:exercise.id,requirementId:target.requirementId,section:'main',
        prescription:{type:exercise.prescription.type,protocol:'rounds',side,timed,
          ...(timed?{seconds:target.target.seconds}:{reps:target.target.maxReps}),
          protocolConditions:{exerciseRestSeconds:20,roundRestSeconds:60}}});
      if(!options.empty) performedWork.push({occurrenceId,exerciseId:exercise.id,status:'completed',
        sets:[timed?{seconds:target.target.seconds}:{reps:target.target.maxReps,load:12,loadUnit:'kg',loadInterpretation:'total'}]});
    }
  }
  return Model.createSessionResult(sessionResult({sessionResultId:'event-result-'+(++resultId),programmeInstanceId:rx.programmeInstanceId,
    generatedAt:now,startedAt:now,endedAt:now,plannedWork,performedWork,anchorResults:[],substitutions:[],feedback:{},
    overrides:rx.programmeContext.overrides,finalStatus:options.empty?'abandoned':'completed'}));
}

test('new event policy is versioned; local horizon buckets cover initial event distances and every boundary', () => {
  assert.equal(definitions['tennis-conditioning'][3].eventPolicy,undefined);
  assert.ok(Object.isFrozen(definition.eventPolicy));
  for(const days of [1,5,21,56,180]) {
    const started=start({intent:'event',significantEventDate:dateIn(days)});
    assert.ok(started.state,JSON.stringify(started.assessment));
    assert.equal(horizon(plan(started.state)).phase,days===1?'final':days===5?'reduced':'build');
    assert.equal(started.state.anchors.length,4);
  }
  const state=start().state, before=copy(state);
  for(const [days,phase] of [[0,'final'],[2,'final'],[3,'reduced'],[7,'reduced'],[8,'refine'],[14,'refine'],[15,'build']]) {
    const changed=event(state,days), planned=plan(changed);
    assert.equal(horizon(planned).phase,phase); assert.equal(horizon(planned).daysUntil,days);
    assert.deepEqual(plan(changed),planned);
    assert.deepEqual(changed.anchors,state.anchors);
  }
  assert.deepEqual(state,before);
});

test('event dates and optional labels reject corrupt, missing, impossible and newly selected past values', () => {
  const state=start().state;
  for(const patch of [{intent:'event'}, {intent:'event',significantEventDate:'2026-02-30'},
    {intent:'event',significantEventDate:'2025-02-29'}, {intent:'unknown'},
    {intent:'event',significantEventDate:dateIn(5),significantEventLabel:'x'.repeat(61)},
    {intent:'event',significantEventDate:dateIn(5),significantEventLabel:12},
    {intent:'event',significantEventDate:dateIn(5),significantEventLabel:'   '},
    {significantEventLabel:'Tournament'}, {eventSignificance:'invented'},
    {intent:'event',significantEventDate:dateIn(-1)}]) {
    assert.throws(()=>engine.updateProgrammeSettings(definition,state,patch,{now,localDate}));
  }
  assert.throws(()=>engine.updateProgrammeSettings(definition,state,{intent:'event',significantEventDate:dateIn(5)}),/local calendar date/);
  assert.throws(()=>start({intent:'event',significantEventDate:dateIn(-1)}),/today or in the future/);
  assert.equal(Model.createProgrammeSettings({sportId:'tennis',intent:'event',significantEventDate:'2028-02-29'}).significantEventDate,'2028-02-29');
  const corrupt=copy(event(state,5));corrupt.currentTargets.programmeSettings.significantEventLabel={text:'oops'};
  assert.throws(()=>engine.validateProgrammeState(definition,corrupt),/event label/);
});

test('intent switches and explicit date changes retain instance, anchors, comparison histories, dose and phases', () => {
  const initial=start().state, result=performed(plan(initial).prescription);
  const state=engine.applySessionResult(definition,initial,result,[]), results=[result], saved=copy(results);
  let changed=event(state,5,'Club final');
  changed=event(changed,21,'Moved final');
  assert.equal(horizon(plan(changed,{},results)).phase,'build');
  changed=engine.updateProgrammeSettings(definition,changed,{intent:'ongoing',significantEventDate:null,significantEventLabel:null});
  const expected=copy(state);expected.currentTargets.programmeSettings.significantEventLabel=null;
  assert.deepEqual(changed,expected);
  assert.deepEqual(results,saved);
  assert.deepEqual(engine.rebuildDerivedState(definition,event(state,5),results).anchors,state.anchors);
  assert.deepEqual(engine.rebuildDerivedState(definition,event(state,5),results).currentTargets.tennisDevelopment,state.currentTargets.tennisDevelopment);
  const history=GarageFitTrainingHistory.createHistory(results,catalogue);
  for(const anchor of state.anchors) assert.deepEqual(history.exactExercisePerformances(anchor.exerciseId),
    GarageFitTrainingHistory.createHistory(saved,catalogue).exactExercisePerformances(anchor.exerciseId));
});

test('refinement retains targets but avoids novel difficult/high-impact/power work and holds earned progression', () => {
  const initial=start().state, first=performed(plan(initial).prescription);
  const state=engine.applySessionResult(definition,initial,first,[]), changed=event(state,10);
  const planned=plan(changed,{},[first]), rx=planned.prescription;
  assert.ok(rx); assert.equal(rx.variationPreference,'familiar');
  for(const anchor of rx.requiredAnchors.filter(item=>item.requirementId.startsWith('tennis-anchor-'))) {
    assert.match(anchor.progressionIntent,/Hold established resistance/);
    assert.equal(rx.programmeContext.anchorResistance[anchor.requirementId].ready,false);
  }
  const familiar=new Set(first.performedWork.map(work=>work.exerciseId));
  const sport=GarageFitSportCoverage.createPolicy(GarageFitData.sportCapabilityPolicies.tennis[1],catalogue);
  for(const exercise of Object.values(catalogue)) {
    const power=sport.classifyExercise(exercise.id).contributions.some(item=>item.capabilityId==='power');
    if(!familiar.has(exercise.id) && (exercise.impact==='high'||exercise.difficulty==='hard'||power))
      assert.ok(rx.avoidConstraints.some(item=>item.exerciseId===exercise.id&&item.importance==='hard'));
  }
  const second=performed(rx), after=engine.applySessionResult(definition,changed,second,[first]);
  assert.deepEqual(after.anchors,changed.anchors);
  assert.equal(after.meaningfulSessionsCompleted,changed.meaningfulSessionsCompleted+1);
  assert.deepEqual(engine.applySessionResult(definition,after,second,[first]),after);
});

test('reduced demand selects established anchors after adaptation and does not introduce unfamiliar anchors', () => {
  const initial=start().state, fresh=plan(event(initial,5)).prescription;
  assert.ok(fresh); assert.equal(fresh.requiredAnchors.filter(item=>item.requirementId.startsWith('tennis-anchor-')).length,0);
  const result=performed(plan(initial).prescription), state=engine.applySessionResult(definition,initial,result,[]);
  const changed=event(state,5), planned=plan(changed,{},[result]), rx=planned.prescription;
  const anchors=rx.requiredAnchors.filter(item=>item.requirementId.startsWith('tennis-anchor-'));
  assert.ok(anchors.length<=1); assert.ok(anchors.every(item=>item.targetSets===1));
  const w=GarageFitGenerator.generate({catalogue,sessionPrescription:rx,random:random(42)});
  assert.equal(w.prescriptionOutcome.requiredAnchorPlacements.length,rx.requiredAnchors.length);
  assert.deepEqual(engine.applySessionResult(definition,changed,performed(rx),[result]).anchors,changed.anchors);
  assert.deepEqual(engine.applySessionResult(definition,changed,performed(rx,{empty:true}),[result]).anchors,changed.anchors);
});

test('final days remain feasible or recommend rest across frequency/time budgets; generated work is gentle', () => {
  const sport=GarageFitSportCoverage.createPolicy(GarageFitData.sportCapabilityPolicies.tennis[1],catalogue);
  for(const frequency of [1,2,3]) {
    const initial=start({},frequency).state;
    for(const days of [0,1,2]) for(const duration of [10,15,20,30,45]) {
      const state=event(initial,days), planned=plan(state,{duration});
      assert.equal(horizon(planned).phase,'final');
      if(!planned.prescription) { assert.ok(planned.conflicts.some(item=>item.code==='tennis-rest-recommended'));continue; }
      const rx=planned.prescription;
      assert.ok(rx.duration<=15);assert.equal(rx.difficulty,'easy');
      assert.equal(rx.requiredAnchors.filter(item=>item.requirementId.startsWith('tennis-anchor-')).length,0);
      const workout=GarageFitGenerator.generate({catalogue,sessionPrescription:rx,random:random(frequency*100+days*10+duration)});
      assert.ok(workout.estimatedSeconds<=rx.duration*60);
      assert.equal(workout.prescriptionOutcome.requiredAnchorPlacements.length,rx.requiredAnchors.length);
      for(const exercise of workout.main.blocks.flatMap(block=>block.exercises)) {
        assert.ok(['core','upper'].includes(exercise.bodyFocus));assert.equal(exercise.difficulty,'easy');
        assert.equal(exercise.impact,'low');assert.equal(exercise.conditioning,false);
        assert.ok(!sport.classifyExercise(exercise.id).contributions.some(item=>item.capabilityId==='power'));
      }
      for(const section of [workout.warmup,workout.rampup,workout.cooldown])
        for(const exercise of section?.exercises || []) assert.equal(exercise.impact,'low');
    }
  }
});

test('sport schedule/confirmed reports/readiness can only moderate event demand; stricter conflicts fail safely', () => {
  const state=start({usualPlayingDays:['monday'],typicalSportIntensity:'hard'}).state;
  assert.equal(horizon(plan(state)),undefined);assert.equal(plan(state).rationale.priorities.adaptation.classification,'lighter');
  const changed=event(state,21);
  assert.equal(horizon(plan(changed)).phase,'build');assert.equal(plan(changed).prescription.difficulty,'easy');
  const tired={readiness:{value:'tired',localDate},reportedSportActivity:[{sportId:'tennis',localDate,intensity:'hard'}]};
  const resting=plan(event(state,1),{sessionContext:tired});
  assert.equal(resting.prescription,null);assert.ok(resting.conflicts.some(item=>item.code==='tennis-rest-recommended'));
  const noFit=plan(event(state,1),{allowedImpact:[]});
  assert.equal(noFit.prescription,null);assert.ok(noFit.conflicts.some(item=>item.code==='tennis-rest-recommended'));
  assert.equal(plan(event(state,1),{duration:12}).prescription,null);
  const noUpper=plan(event(state,1),{avoidConstraints:[{requirementId:'no-upper',importance:'hard',bodyRegion:'upper'},
    {requirementId:'no-core',importance:'hard',bodyRegion:'core'}]});
  assert.equal(noUpper.prescription,null);assert.ok(noUpper.conflicts.some(item=>item.code==='tennis-rest-recommended'));
  assert.equal(changed.meaningfulSessionsCompleted,0);assert.equal(changed.currentTargets.dose.exposure,0);
});

test('expired events and long missed periods prompt an explicit next step and never auto-credit or auto-switch', () => {
  const state=event(start().state,1), before=copy(state);
  const expired=plan(state,{now:'2027-05-01T08:00:00Z',localDate:'2027-05-01'});
  assert.equal(horizon(expired).phase,'expired');assert.equal(expired.prescription,null);
  assert.equal(horizon(expired).nextAction,'return-ongoing-or-change-event');
  assert.match(expired.conflicts[0].message,/Return to ongoing/);assert.deepEqual(state,before);
  const labelOnly=engine.updateProgrammeSettings(definition,state,{significantEventLabel:'Past final'},
    {now:'2027-05-01T08:00:00Z',localDate:'2027-05-01'});
  assert.equal(horizon(plan(labelOnly,{now:'2027-05-01T08:00:00Z',localDate:'2027-05-01'})).phase,'expired');
  const ongoing=engine.updateProgrammeSettings(definition,state,{intent:'ongoing',significantEventDate:null,significantEventLabel:null});
  assert.ok(plan(ongoing,{now:'2027-05-01T08:00:00Z',localDate:'2027-05-01'}).prescription);
  assert.deepEqual(ongoing.anchors,state.anchors);assert.equal(ongoing.meaningfulSessionsCompleted,0);
});

test('local midnight, leap/year boundaries and DST use calendar days independently of UTC instants', () => {
  const initial=start().state, state=event(initial,1);
  for(const [instant,date,days] of [['2026-10-13T00:30:00Z','2026-10-12',1],
    ['2026-10-12T23:30:00Z','2026-10-13',0],['2026-10-14T00:30:00+14:00','2026-10-14',-1]]) {
    assert.equal(horizon(plan(state,{now:instant,localDate:date})).daysUntil,days);
  }
  for(const [date,eventDate,days] of [['2026-12-31','2027-01-01',1],['2028-02-28','2028-03-01',2],
    ['2026-10-24','2026-10-26',2],['2026-03-28','2026-03-30',2]]) {
    const changed=engine.updateProgrammeSettings(definition,initial,{intent:'event',significantEventDate:eventDate},{localDate:date});
    assert.equal(GarageFitCoachTennisPolicy.eventHorizon({definition,state:changed,today:{localDate:date}}).daysUntil,days);
  }
  for(const [timezone,expected] of [['America/Los_Angeles',1],['Pacific/Kiritimati',0]]) {
    const source=`const {pilot}=require('./tests/helpers/coach-pilot');(async()=>{const p=pilot(new Map(),'tennis-conditioning',4);await p.start();
      await p.run("pilotNow='2026-10-13T00:30:00Z';pilot.saveProgrammeSettings({intent:'event',significantEventDate:'2026-10-13'})");
      require('node:assert/strict').equal(p.run('pilot.plan(pilotOptions).rationale.priorities.event.daysUntil'),${expected});})().catch(e=>{console.error(e);process.exit(1)});`;
    const run=spawnSync(process.execPath,['-e',source],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,TZ:timezone},encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
  }
});

test('controller saves event changes atomically, invalidates previews, rejects active sessions and survives recovery', async () => {
  const p=pilot(new Map(),'tennis-conditioning',4);await p.start();
  await p.run("pilot.saveProgrammeSettings({intent:'event',significantEventDate:'2026-10-22',significantEventLabel:'Final'})");
  p.run('pilot.prepare(pilotOptions)');const before=p.json('pilot.snapshot().state');
  p.run("const write=localStorage.setItem;let fail=true;localStorage.setItem=(key,value)=>{if(fail){fail=false;throw new Error('quota');}write(key,value);}");
  await assert.rejects(p.run("pilot.saveProgrammeSettings({significantEventDate:'2026-10-23'})"),/storage/);
  assert.deepEqual(p.json('pilot.snapshot().state'),before);assert.ok(p.run('pilot.snapshot().preview'));
  await p.run("pilot.saveProgrammeSettings({significantEventDate:'2026-10-23'})");assert.equal(p.run('pilot.snapshot().preview'),null);
  await p.begin();await assert.rejects(p.run("pilot.saveProgrammeSettings({intent:'ongoing',significantEventDate:null,significantEventLabel:null})"),/Save the session/);
  const anchor=p.json('pilot.snapshot().preview.plan.prescription.requiredAnchors').find(item=>item.requirementId.startsWith('tennis-anchor-'));
  await p.log(anchor.requirementId);
  const q=pilot(p.storage,'tennis-conditioning',4);await q.run('pilot.load()');
  assert.equal(q.json('pilot.snapshot().state').currentTargets.programmeSettings.significantEventLabel,'Final');
  assert.equal(q.json('pilot.snapshot().state').meaningfulSessionsCompleted,1);
  const recovered=q.json('pilot.snapshot().state');await q.run('pilot.load(true)');assert.deepEqual(q.json('pilot.snapshot().state'),recovered);
  await q.run("pilot.saveProgrammeSettings({intent:'ongoing',significantEventDate:null,significantEventLabel:null})");
  assert.deepEqual(q.json('pilot.snapshot().state').anchors,recovered.anchors);
  const durable=await q.run('pilotStore.listSessionResults()');assert.equal(durable.results.length,1);
});

test('rendered event controls change, cancel and return after expiry on the same instance', async () => {
  const p=pilot(new Map(),'tennis-conditioning',4);await p.start();
  p.run(`const RealDate=Date;Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-12T08:00:00Z']));}};
    function findButton(text){const visit=node=>node.textContent===text&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById('coachContent'));}
    function field(label){const visit=node=>node.attributes?.['aria-label']===label?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById('coachContent'));}`);
  await p.run('coachUI.open()');const before=p.json('coachUI.controller.snapshot().state');
  p.run("field('Important event date').value='2026-10-13';field('Event label (optional)').value='Club final'");
  await p.run("findButton('Prepare for event').onclick()");
  assert.equal(p.json('coachUI.controller.snapshot().state').currentTargets.programmeSettings.significantEventLabel,'Club final');
  await p.run("findButton('Cancel event preparation').onclick()");
  assert.deepEqual(p.json('coachUI.controller.snapshot().state').anchors,before.anchors);
  p.run("field('Important event date').value='2026-10-13'");await p.run("findButton('Prepare for event').onclick()");
  p.run("Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-14T08:00:00Z']));}};");
  await p.run('coachUI.open()');assert.ok(p.run("findButton('Return to ongoing development')"));
  assert.equal(p.run("findButton('Start session')"),undefined);
  await p.run("findButton('Return to ongoing development').onclick()");
  const after=p.json('coachUI.controller.snapshot().state');
  assert.equal(after.programmeInstanceId,before.programmeInstanceId);assert.equal(after.programmeDefinitionVersion,4);
  assert.deepEqual(after.anchors,before.anchors);assert.equal(after.meaningfulSessionsCompleted,0);
});

test('existing programmes and saved Tennis versions retain their prescriptions and policies', () => {
  assert.equal(definitions['general-strength-4w'][1].eventPolicy,undefined);
  assert.equal(definitions['build-arms'][1].eventPolicy,undefined);
  for(const version of [1,2,3]) {
    const def=definitions['tennis-conditioning'][version];assert.equal(def.eventPolicy,undefined);
    const state=engine.startProgramme(def,{programmeInstanceId:'saved',equipment},now).state;
    const options={now,localDate,equipment,prescriptionId:'same'};
    const baseline=engine.planNextSession(def,state,[],options);
    const changed=engine.updateProgrammeSettings(def,state,{intent:'event',significantEventDate:dateIn(5)});
    assert.deepEqual(engine.planNextSession(def,changed,[],options),baseline);
  }
});
