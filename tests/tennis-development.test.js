const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
for (const file of ['data/exercises','data/sport-profiles','data/sport-capabilities','data/programmes',
  'js/coach-model','js/training-history','js/sport-coverage','js/coach-policies','js/coach-tennis-policy','js/coach-engine','js/generator']) require('../'+file);
const {sessionResult} = require('./helpers/coach-fixtures');
const {pilot} = require('./helpers/coach-pilot');
const catalogue = GarageFitData.exercises, Model = GarageFitCoachModel;
const definition = GarageFitData.programmes['tennis-conditioning'][3];
const engine = GarageFitCoachEngine.createEngine({catalogue,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription});
const copy = value => JSON.parse(JSON.stringify(value));
const day = offset => new Date(Date.parse('2026-10-01T08:00:00Z')+offset*86400000).toISOString();
const equipment = ['dumbbells'];
const start = (frequency=2, kit=equipment) => engine.startProgramme(definition,
  {programmeInstanceId:'development',equipment:kit,programmeSettings:{sportId:'tennis',weeklyCoachFrequency:frequency}},day(0)).state;
const phase = state => state.currentTargets.tennisDevelopment;
const plan = (state,offset=21,options={},results=[]) => engine.planNextSession(definition,state,results,
  {now:day(offset),equipment,duration:30,prescriptionId:'phase-rx',...options});
let resultId=0;
function performed(rx, at, options={}) {
  const plannedWork=[],performedWork=[];
  for (const target of rx.requiredAnchors) {
    const exercise=catalogue[target.exerciseId], timed=target.prescriptionMode==='time';
    for (let set=0;set<target.targetSets;set++) for (const side of exercise.sidedness==='per-side'?['left','right']:[null]) {
      const occurrenceId=target.requirementId+'-'+set+'-'+side;
      plannedWork.push({occurrenceId,exerciseId:exercise.id,requirementId:target.requirementId,section:options.section || 'main',
        prescription:{type:exercise.prescription.type,protocol:'rounds',side,timed,
          ...(timed?{seconds:target.target.seconds}:{reps:target.target.maxReps}),
          protocolConditions:{exerciseRestSeconds:20,roundRestSeconds:60}}});
      if (!options.empty) performedWork.push({occurrenceId,exerciseId:exercise.id,status:options.status || 'completed',
        sets:options.unknown?null:[timed?{seconds:options.zero?0:target.target.seconds}
          :{reps:options.zero?0:target.target.maxReps,load:12,loadUnit:'kg',loadInterpretation:'total'}]});
    }
  }
  return Model.createSessionResult(sessionResult({sessionResultId:'phase-result-'+(++resultId),
    programmeInstanceId:rx.programmeInstanceId,prescriptionId:rx.prescriptionId,
    generatedAt:at,startedAt:at,endedAt:at,plannedWork,performedWork,anchorResults:[],substitutions:[],
    finalStatus:options.finalStatus || 'completed',overrides:rx.programmeContext.overrides,feedback:{}}));
}
function development(count=6, spacing=4, frequency=2, kit=equipment) {
  let state=start(frequency,kit); const results=[];
  for (let i=0;i<count;i++) {
    const rx=plan(state,i*spacing,{equipment:kit},results).prescription, result=performed(rx,day(i*spacing));
    state=engine.applySessionResult(definition,state,result,results);results.push(result);
  }
  return {state,results};
}

test('phase gates require six actual meaningful sessions AND 21 days; previews, absence and pause earn nothing', () => {
  const empty=start();
  assert.equal(plan(empty,120).rationale.priorities.phase.phase,'development');
  const five=development(5), six=development(6,1);
  assert.equal(plan(five.state,21).rationale.priorities.phase.phase,'development');
  assert.equal(plan(six.state,20).rationale.priorities.phase.phase,'development');
  const before=copy(six.state), first=plan(six.state,21), second=plan(six.state,21);
  assert.deepEqual(second,first); assert.deepEqual(six.state,before);
  assert.equal(first.rationale.priorities.phase.phase,'consolidation');
  assert.equal(first.rationale.priorities.phase.confidence,'derived');
  assert.match(first.rationale.priorities.phase.evidenceNote,/not fitness/);
  assert.equal(phase(six.state).phase,'development');
  const paused=engine.pauseProgramme(six.state);
  assert.throws(()=>plan(paused,90),/active programme/);
  assert.deepEqual(phase(engine.resumeProgramme(paused)),phase(six.state));
  assert.equal(six.state.mode,'development');
});

test('unknown, zero, preparation-only, skipped and abandoned results cannot award phase work', () => {
  for (const options of [{empty:true},{status:'partial',unknown:true},{zero:true},{section:'warmup'},
    {finalStatus:'abandoned'},{finalStatus:'skipped-before-start',empty:true}]) {
    const state=start(), rx=plan(state,0).prescription, result=performed(rx,day(0),options);
    const next=engine.applySessionResult(definition,state,result,[]);
    assert.equal(phase(next).eligibleDevelopmentSessions,0,JSON.stringify(options));
    assert.equal(phase(next).sportReview.eligibleSessions,0);
    assert.equal(next.meaningfulSessionsCompleted,0);
    assert.deepEqual(engine.applySessionResult(definition,next,result,[]),next);
  }
});

test('comparable development results progress; deliberate consolidation preserves targets and exact baselines', () => {
  let state=start(1); const results=[];
  const initial=copy(state.anchors);
  for (let i=0;i<6;i++) {
    const rx=plan(state,i*4,{},results).prescription, result=performed(rx,day(i*4));
    state=engine.applySessionResult(definition,state,result,results); results.push(result);
  }
  assert.ok(state.anchors.some((anchor,index)=>anchor.currentTarget.target.maxReps>initial[index].currentTarget.target.maxReps));
  const anchors=copy(state.anchors), rx=plan(state,21,{},results).prescription;
  assert.equal(rx.difficulty,'easy'); assert.ok(rx.duration<=20);
  assert.ok(rx.requiredAnchors.filter(item=>item.requirementId.startsWith('tennis-anchor-')).every(item=>item.targetSets===1));
  state=engine.beginSession(definition,state,rx,day(21));
  assert.equal(phase(state).phase,'consolidation'); assert.equal(state.mode,'development');
  const skipped=performed(rx,day(22),{empty:true,finalStatus:'skipped-before-start'});
  state=engine.applySessionResult(definition,state,skipped,results); results.push(skipped);
  assert.equal(phase(state).phase,'consolidation');
  const abandoned=performed(rx,day(23),{finalStatus:'abandoned'});
  state=engine.applySessionResult(definition,state,abandoned,results); results.push(abandoned);
  assert.equal(phase(state).phase,'consolidation'); assert.deepEqual(state.anchors,anchors);
  const actual=performed(rx,day(24),{finalStatus:'partial'});
  state=engine.applySessionResult(definition,state,actual,results);results.push(actual);
  assert.equal(phase(state).phase,'development');
  assert.equal(phase(state).entryReason,'performed-consolidation');
  assert.equal(phase(state).developmentStartedAt,day(24));
  assert.equal(phase(state).eligibleDevelopmentSessions,0);
  assert.deepEqual(state.anchors,anchors);
  assert.deepEqual(engine.applySessionResult(definition,state,actual,results),state);
  assert.equal(plan(state,120).rationale.priorities.phase.phase,'development');
  assert.equal(plan(state,25).prescription.difficulty,'normal');
});

test('all frequencies and budgets retain feasible reduced-demand work, preparation, rest and coverage', () => {
  for (const frequency of [1,2,3]) for (const kit of [equipment,['trx'],['bands'],['kettlebell','pullup-bar']]) {
    const {state,results}=development(6,4,frequency,kit);
    for (const duration of [10,15,20,30,45]) {
      const planned=plan(state,21,{equipment:kit,duration},results);
      assert.ok(planned.prescription,frequency+':'+kit+':'+duration);
      const rx=planned.prescription;
      assert.equal(rx.programmeContext.phase.phase,'consolidation');
      assert.ok(rx.requiredAnchors.length>0);
      assert.ok(rx.requiredAnchors.every(item=>item.targetSets===1));
      const workout=GarageFitGenerator.generate({catalogue,sessionPrescription:rx,random:()=>0.4});
      assert.ok(workout.estimatedSeconds<=Math.min(duration,20)*60);
      assert.ok(workout.warmup.exercises.length && workout.cooldown.exercises.length);
      assert.ok(workout.main.blocks.every(block=>['rounds','paired_sets'].includes(block.protocol)));
      assert.ok(rx.avoidConstraints.some(avoid=>avoid.exerciseId==='skater-jumps'));
      assert.ok(planned.rationale.priorities.coverage.capabilities.length===6);
    }
  }
});

test('context safeguards can further reduce or defer consolidation without ending it', () => {
  const {state}=development(), readiness={value:'tired',localDate:'2026-10-22'};
  const tired=plan(state,21,{sessionContext:{readiness}});
  assert.ok(tired.prescription.duration<=15);
  const rest=plan(state,21,{sessionContext:{readiness,plannedMatchDate:'2026-10-22'}});
  assert.equal(rest.prescription,null); assert.equal(rest.conflicts[0].code,'tennis-rest-recommended');
  assert.equal(phase(state).phase,'development');
  const unavailable=plan(state,21,{allowedImpact:[]});
  assert.equal(unavailable.prescription,null);
  assert.equal(phase(state).eligibleDevelopmentSessions,6);
});

test('sport check-in requires 28 days and four sessions; dismissal and answers restart both gates', () => {
  const empty=start(), three=development(3), four=development(4);
  assert.equal(engine.sportReview(definition,empty,day(100)).due,false);
  assert.equal(engine.sportReview(definition,three.state,day(28)).due,false);
  assert.equal(engine.sportReview(definition,four.state,day(27)).due,false);
  assert.equal(engine.sportReview(definition,four.state,day(28)).due,true);
  const dismissed=engine.recordSportReview(definition,four.state,null,day(28));
  assert.equal(phase(dismissed).sportReview.lastPromptAt,day(28));
  assert.equal(engine.sportReview(definition,dismissed,day(100)).due,false);
  assert.throws(()=>engine.recordSportReview(definition,dismissed,null,day(29)),/not due/);
  let state=dismissed;
  for (let i=0;i<4;i++) {
    const result=performed(plan(state,30+i).prescription,day(30+i));
    state=engine.applySessionResult(definition,state,result,[]);
  }
  assert.equal(engine.sportReview(definition,state,day(55)).due,false);
  assert.equal(engine.sportReview(definition,state,day(56)).due,true);
  const answers={movement:'unsure',endurance:'same',comfort:'better'};
  const next=engine.recordSportReview(definition,state,answers,day(56));
  assert.deepEqual(phase(next).sportReview.latestFeedback,{...answers,timestamp:day(56)});
  assert.equal(engine.sportReview(definition,next,day(56)).confidence,'subjective');
  assert.deepEqual(next.anchors,state.anchors);
  assert.equal(next.meaningfulSessionsCompleted,state.meaningfulSessionsCompleted);
});

test('one worse answer prompts only an easier review session; no dose, phase change, diagnosis or baseline downgrade', () => {
  const {state}=development(4), anchors=copy(state.anchors);
  let next=engine.recordSportReview(definition,state,{movement:'worse',endurance:'same',comfort:'unsure'},day(28));
  assert.equal(phase(next).phase,'development');
  assert.deepEqual(next.currentTargets.dose,state.currentTargets.dose);
  assert.deepEqual(next.anchors,anchors);
  const rx=plan(next,28).prescription;
  assert.equal(rx.difficulty,'easy');
  assert.match(rx.programmeContext.adaptation.reasons.join(' '),/subjective context/);
  const skipped=performed(rx,day(28),{empty:true,finalStatus:'abandoned'});
  next=engine.applySessionResult(definition,next,skipped,[]);
  assert.equal(phase(next).sportReview.easierNextSession,true);
  const result=performed(rx,day(29));
  next=engine.applySessionResult(definition,next,result,[skipped]);
  assert.equal(phase(next).sportReview.easierNextSession,false);
  assert.deepEqual(next.anchors,anchors);
  assert.equal(plan(next,30).prescription.difficulty,'normal');
});

test('typed state, feedback and definitions reject corrupt values rather than guessing defaults', () => {
  const {state}=development(4);
  for (const response of [{movement:'maybe',endurance:'same',comfort:'same'}, {}, [],
    {movement:'same',endurance:'same',comfort:'same',dose:4}])
    assert.throws(()=>engine.recordSportReview(definition,state,response,day(28)));
  for (const patch of [{phase:'maintenance'},{eligibleDevelopmentSessions:7},{consolidationSessions:-1},
    {entryReason:'failure'},{lastTransitionAt:'yesterday'},{schemaVersion:2},{extra:0},
    {sportReview:{lastPromptAt:null,eligibleSessions:5,latestFeedback:null,easierNextSession:false}},
    {sportReview:{lastPromptAt:null,eligibleSessions:0,latestFeedback:null,easierNextSession:true}},
    {sportReview:{lastPromptAt:null,eligibleSessions:0,latestFeedback:{movement:'worse',endurance:'same',comfort:'same',timestamp:day(28)},easierNextSession:true}}]) {
    const corrupt=copy(state); Object.assign(phase(corrupt),patch);
    assert.throws(()=>Model.assertValid('programme-state',corrupt),/Invalid/);
  }
  const missing=copy(state);delete missing.currentTargets.tennisDevelopment;
  assert.throws(()=>plan(missing),/missing/);
  const unknownStart=copy(state);unknownStart.startedAt=null;
  assert.throws(()=>plan(unknownStart),/known programme start/);
  const badDefinition=copy(definition);badDefinition.phasePolicy.minimumDevelopmentSessions=0;
  assert.throws(()=>engine.assessProgrammeFeasibility(badDefinition,{equipment}),/thresholds/);
});

test('save/reload, interrupted Main recovery, same-result replay and rebuild preserve phase, reviews and old history', async () => {
  const p=pilot(new Map(),'tennis-conditioning',3);await p.start();
  for (let i=0;i<6;i++) {
    p.run(`pilotNow=${JSON.stringify(day(i*4))}`);await p.begin();
    const anchor=p.json('pilot.snapshot().preview.plan.prescription.requiredAnchors').find(item=>item.requirementId.startsWith('tennis-anchor-'));
    if (anchor) await p.log(anchor.requirementId);
    else {
      const work=p.json('pilotTracker.plannedWork()').find(item=>item.section==='main');
      await p.run(`pilotTracker.recordDone(${JSON.stringify(work.occurrenceId)})`);
    }
    await p.finish();
  }
  p.run(`pilotNow=${JSON.stringify(day(28))}`);
  await p.run("pilot.saveSportReview({movement:'same',endurance:'better',comfort:'unsure'})");
  await p.begin();
  assert.equal(p.json('pilot.snapshot().state.currentTargets.tennisDevelopment.phase'),'consolidation');
  const anchor=p.json('pilot.snapshot().preview.plan.prescription.requiredAnchors').find(item=>item.requirementId.startsWith('tennis-anchor-'));
  await p.log(anchor.requirementId);
  const q=pilot(p.storage,'tennis-conditioning',3); await q.run(`pilotNow=${JSON.stringify(day(28))};pilot.load()`);
  const state=q.json('pilot.snapshot().state');
  assert.equal(phase(state).phase,'development');
  assert.equal(phase(state).entryReason,'performed-consolidation');
  assert.equal(state.meaningfulSessionsCompleted,7);
  assert.equal(phase(state).sportReview.latestFeedback.endurance,'better');
  await q.run('pilot.load()'); assert.deepEqual(q.json('pilot.snapshot().state'),state);
  const full=await q.run("pilotStore.listSessionResults({programmeInstanceId:pilot.snapshot().state.programmeInstanceId})");
  const rebuilt=q.json(`pilotEngine.rebuildDerivedState(pilotDef,pilot.snapshot().state,${JSON.stringify(full.results)})`);
  assert.deepEqual(phase(rebuilt),phase(state));assert.deepEqual(rebuilt.anchors,state.anchors);
  assert.equal(rebuilt.meaningfulSessionsCompleted,7);assert.equal(full.results.length,7);
});

test('sport review and phase-entry storage failures keep durable state and allow retry; live drafts block reviews', async () => {
  const p=pilot(new Map(),'tennis-conditioning',3); await p.start();
  const {state,results}=development(6);
  // Persist genuine derived state for the controller's own identity through Store.
  const instance=p.json('pilot.snapshot().state.programmeInstanceId');state.programmeInstanceId=instance;
  for (const result of results) {
    result.programmeInstanceId=instance;
    await p.run(`pilotStore.saveSessionResult(${JSON.stringify(result)})`);
  }
  await p.run(`pilotStore.saveProgrammeState(${JSON.stringify(state)});`); await p.run(`pilotNow=${JSON.stringify(day(28))};pilot.load()`);
  const before=p.json('pilot.snapshot().state');
  p.run("const originalSave=localStorage.setItem;let fail=true;localStorage.setItem=(key,value)=>{if(fail){fail=false;throw new Error('quota');}return originalSave(key,value);}");
  await assert.rejects(p.run('pilot.saveSportReview(null)'),/Could not write/);
  assert.deepEqual(p.json('pilot.snapshot().state'),before);
  await p.run('pilot.saveSportReview(null)'); assert.equal(p.run('pilot.sportReview().due'),false);
  const reviewed=p.json('pilot.snapshot().state');
  p.run('fail=true;pilot.prepare(pilotOptions)');
  await assert.rejects(p.run('pilot.begin()'),/Could not write/);
  assert.deepEqual(p.json('pilot.snapshot().state'),reviewed);
  assert.equal(await p.run('pilotStore.loadSessionDraft()'),null);
  await p.run('pilot.begin()');
  await assert.rejects(p.run('pilot.saveSportReview(null)'),/Save the session/);
  assert.equal(p.json('pilot.snapshot().state.currentTargets.tennisDevelopment.phase'),'consolidation');
});

test('released programmes remain pinned and acquire neither automatic phases nor sport prompts', () => {
  for (const [id,version,kit] of [['general-strength-4w',1,equipment],['build-arms',1,['dumbbells','bench']],
    ['tennis-conditioning',1,equipment],['tennis-conditioning',2,equipment]]) {
    const def=GarageFitData.programmes[id][version];
    assert.equal(def.phasePolicy,undefined);
    const state=engine.startProgramme(def,{programmeInstanceId:id,equipment:kit},day(0)).state;
    assert.equal(state.currentTargets.tennisDevelopment,undefined);
    assert.equal(engine.sportReview(def,state,day(90)),null);
    const rx=engine.planNextSession(def,state,[],{now:day(90),equipment:kit,prescriptionId:'old',duration:30}).prescription;
    assert.equal(rx.programmeContext.phase,undefined);
    assert.deepEqual(engine.beginSession(def,state,rx,day(90)),state);
  }
});

test('Coach renders an optional bounded sport review, persists dismissal, and still offers training', async () => {
  const p=pilot(new Map(),'tennis-conditioning',3), {state,results}=development(4);
  // The mounted controller uses an injected VM Date for deterministic rendering.
  p.run(`const NativeDate=Date;Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[${JSON.stringify(day(28))}]));}};
    state.ownedEquipment=['dumbbells'];`);
  await p.run(`pilotStore.saveProgrammeState(${JSON.stringify(state)})`);
  for (const result of results) await p.run(`pilotStore.saveSessionResult(${JSON.stringify(result)})`);
  await p.run(`pilotStore.saveActiveProgramme(GarageFitCoachModel.createActiveProgramme(GarageFitCoachModel.programmeDefinitionRef(${JSON.stringify(state)})))`);
  await p.run('coachUI.open()');
  p.run("function findCoachButton(text,id='coachContent'){const visit=node=>node.textContent===text&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById(id));}");
  assert.ok(p.run("findCoachButton('View today’s workout')"));
  const text=(id='coachProgressContent')=>p.run(`JSON.stringify(document.getElementById('${id}'),(key,value)=>key==='onclick'?undefined:value)`);
  // A due check-in is announced on Coach home and answered in Your progress.
  assert.match(text('coachContent'),/optional tennis check-in is ready in Your progress/);
  await p.run("findCoachButton('Your progress').onclick()");
  assert.match(text(),/Optional tennis progress check-in/);
  assert.match(text(),/Court movement/);assert.match(text(),/Match endurance/);assert.match(text(),/Physical comfort/);
  assert.match(text(),/Not sure/);
  await p.run("findCoachButton('Skip check-in','coachProgressContent').onclick()");
  assert.doesNotMatch(text(),/Optional tennis progress check-in/);
  await p.run('coachUI.open()');
  assert.doesNotMatch(text('coachContent'),/check-in is ready/);
  await p.run("findCoachButton('Your progress').onclick()");
  assert.doesNotMatch(text(),/Optional tennis progress check-in/);
  await p.run('coachUI.back()');
  assert.ok(p.run("findCoachButton('View today’s workout')"));
  assert.equal(p.json('coachUI.controller.snapshot().state.meaningfulSessionsCompleted'),4);
});

test('missing phase namespace is retained and blocks a paused programme on reload', async () => {
  const p=pilot(new Map(),'tennis-conditioning',3);await p.start();await p.run("pilot.manage('pause')");
  await p.run(`const damaged=pilot.snapshot().state;delete damaged.currentTargets.tennisDevelopment;
    pilotStore.saveProgrammeState(damaged)`);
  const saved=[...p.storage.entries()];
  const q=pilot(p.storage,'tennis-conditioning',3);await q.run('pilot.load()');
  assert.equal(q.run('pilot.snapshot().blocked'),true);
  assert.equal(q.run('pilot.snapshot().state'),null);
  assert.match(q.run('pilot.snapshot().errors[0].message'),/development state is missing/);
  assert.deepEqual([...p.storage.entries()],saved);
});

test('a saved consolidation result is recovered once after its Programme State write fails', async () => {
  const p=pilot(new Map(),'tennis-conditioning',3);await p.start();
  const {state,results}=development(6), instance=p.json('pilot.snapshot().state.programmeInstanceId');
  state.programmeInstanceId=instance;
  for (const result of results) {result.programmeInstanceId=instance;await p.run(`pilotStore.saveSessionResult(${JSON.stringify(result)})`);}
  await p.run(`pilotStore.saveProgrammeState(${JSON.stringify(state)});pilotNow=${JSON.stringify(day(21))};pilot.load()`);
  await p.begin();
  const anchor=p.json('pilot.snapshot().preview.plan.prescription.requiredAnchors').find(item=>item.requirementId.startsWith('tennis-anchor-'));
  await p.log(anchor.requirementId);
  const before=p.json('pilot.snapshot().state');
  p.run("const realWrite=localStorage.setItem;let failState=true;localStorage.setItem=(key,value)=>{if(failState&&key.includes('programme_state:')){failState=false;throw new Error('state interruption');}return realWrite(key,value);}");
  await assert.rejects(p.finish(),/Could not write/);
  assert.equal((await p.run('pilotStore.listSessionResults()')).results.length,7);
  assert.deepEqual(p.json('pilot.snapshot().state'),before);
  const q=pilot(p.storage,'tennis-conditioning',3);await q.run(`pilotNow=${JSON.stringify(day(22))};pilot.load()`);
  const after=q.json('pilot.snapshot().state');
  assert.equal(phase(after).phase,'development');assert.equal(after.meaningfulSessionsCompleted,7);
  assert.deepEqual(after.anchors,before.anchors);
  await q.run('pilot.load(true)');assert.deepEqual(q.json('pilot.snapshot().state'),after);
});
