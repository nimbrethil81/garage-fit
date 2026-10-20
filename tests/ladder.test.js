const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
const {blockFixtures,savedWorkoutV2,traceBlock}=require('./helpers/protocol-fixtures');
const fixtures=require('./helpers/coach-fixtures');
const {pilot}=require('./helpers/coach-pilot');
global.window=global;
for(const file of ['data/equipment','data/exercises','js/generator','js/coach-model','js/coach-store','js/session-tracker','js/training-history'])require('../'+file);
const G=GarageFitGenerator,T=GarageFitSessionTracker,H=GarageFitTrainingHistory,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value));
const kit=GarageFitData.equipment.map(e=>e.id);
const random=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
const block=(repSteps=[2,4,6,8])=>({...blockFixtures(C,{ladder:true}).ladder,prescription:{repSteps,exerciseRestSeconds:15,stepRestSeconds:45}});
function harness(b=block()){
  let now=0;
  const app=loadAppContext(new Map(),{ownIntrinsics:true,configure(context){context.performance={now:()=>now}}});
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id);
  app.ladderNow=()=>Date.parse('2026-10-17T08:00:00Z')+now;run('Date.now=ladderNow');
  const workout=savedWorkoutV2(C);workout.main.blocks=[b];
  run(`generatorState.workout=JSON.parse(${JSON.stringify(JSON.stringify(workout))})`);
  const spoken=[];app.announceExercise=(exercise,parts)=>spoken.push([].concat(parts).join(' '));
  return {app,run,el,spoken,time:ms=>{now+=ms},phase:()=>run('currentGeneratedPhase()'),
    main:()=>run("generatorState.timeline.map((phase,index)=>({phase,index})).filter(({phase})=>phase.kind==='exercise'&&phase.section==='main')")};
}

test('ascending and descending ladders resolve exact immutable targets, unique positions and no final rest',()=>{
  for(const reps of [[2,4,6,8],[8,6,4,2]])for(const count of [1,2]){
    const b=block(reps);b.exercises=b.exercises.slice(0,count);const before=copy(b);
    const trace=traceBlock(G,b),work=trace.steps.filter(s=>s.kind==='exercise');
    assert.deepEqual(G.validateLadderBlock(b,C),[]);assert.deepEqual(trace.problems,[]);
    assert.deepEqual(work.map(s=>s.plannedPrescription.value),reps.flatMap(n=>Array(count).fill(n)));
    assert.equal(work.length,count*reps.length);assert.equal(G.blockRepeatCount(b),reps.length);
    assert.equal(trace.seconds,G.estimateBlockDuration(b));
    assert.equal(trace.seconds,work.reduce((n,s)=>n+s.estimatedSeconds,0)+reps.length*(count-1)*15+(reps.length-1)*45);
    assert.ok(work.every(s=>Object.isFrozen(s)&&Object.isFrozen(s.plannedPrescription)&&s.variableTarget));
    const ids=work.map(s=>T.occurrenceIdFor({...s,section:'main',blockIndex:0}));assert.equal(new Set(ids).size,work.length);
    assert.deepEqual(b,before);assert.deepEqual(G.validateMain({blocks:[b]},C,kit),[]);
  }
});

test('malformed, extreme, per-side, technical, heavy and anchor ladders fail before playback',()=>{
  const invalid=[];
  for(const repSteps of [[],[2],[2,4,3],[2,2,4],[0,2],[1.5,3],[2,Infinity],[8,9,10,11,12],[2,4,6,8,10,12],new Array(3)])invalid.push({...block(),prescription:{...block().prescription,repSteps}});
  for(const id of ['reverse-lunge','side-plank','plank','burpees','pull-up','barbell-deadlift','kettlebell-swing','goblet-squat','dumbbell-floor-press']){
    const b=block();b.exercises=[copy(C[id])];invalid.push(b);
  }
  for(const patch of [{stepRestSeconds:0},{stepRestSeconds:91},{exerciseRestSeconds:-1},{exerciseRestSeconds:61},{weightIncrease:2}])invalid.push({...block(),prescription:{...block().prescription,...patch}});
  const anchor=block();anchor.exercises[0].coachAnchor={requirementId:'req-1'};invalid.push(anchor);
  const slow=block();slow.exercises[0].estimatedSeconds=10000;invalid.push(slow);
  const override=block();override.occurrenceTargets=Array(8).fill(null);invalid.push(override);
  const tooMany=block();tooMany.exercises.push(copy(C['bicycle-crunch']));invalid.push(tooMany);
  const duplicate=block();duplicate.exercises[1]=copy(duplicate.exercises[0]);invalid.push(duplicate);
  for(const b of invalid){
    assert.ok(G.validateLadderBlock(b).length,JSON.stringify(b));
    assert.deepEqual(G.resolveBlockSteps(b),[]);assert.equal(G.estimateBlockDuration(b),0);
    const w=savedWorkoutV2(C);w.main.blocks=[b];assert.throws(()=>G.normaliseWorkout(w),/ladder/);
  }
  const forged=block();forged.exercises[0]={...forged.exercises[0],id:'barbell-deadlift'};
  assert.ok(G.validateLadderBlock(forged,C).length,'canonical metadata cannot be weakened');
  assert.ok(G.validateMain({blocks:[block()]},C,[],1).includes('main:duration-over-budget'));
});

test('normalisation owns rep steps, rejects stale duration caches and swaps retain exact targets within budget',()=>{
  const b=block(),w=savedWorkoutV2(C);b.estimatedDurationSeconds=9999;w.main.blocks=[b];G.normaliseWorkout(w);
  assert.equal(w.main.blocks[0].estimatedDurationSeconds,G.estimateBlockDuration(b));
  b.prescription.repSteps[0]=99;assert.equal(w.main.blocks[0].prescription.repSteps[0],2);
  const before=copy(w.main.blocks[0].prescription);
  for(let seed=1;seed<=12;seed++){
    G.swap(w,0,seed%2,{catalogue:C,equipment:kit,random:random(seed)});
    assert.deepEqual(w.main.blocks[0].prescription,before);
    assert.deepEqual(G.validateLadderBlock(w.main.blocks[0],C),[]);
    assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[w.duration].main);
    for(const ex of w.main.blocks[0].exercises)assert.deepEqual(ex.prescription,C[ex.id].prescription);
  }
  const only={...C,'air-squat':C['air-squat'],'push-up':C['push-up']};
  for(const id of Object.keys(only))if(!['air-squat','push-up'].includes(id))delete only[id];
  const intact=savedWorkoutV2(C);intact.main.blocks=[block()];G.normaliseWorkout(intact);const snapshot=copy(intact.main.blocks);
  G.swap(intact,0,0,{catalogue:only,equipment:[],random:()=>0});assert.deepEqual(intact.main.blocks,snapshot);
});

test('shared player/voice/preview/tracker follow each step through rest, pause, Previous and redo',async()=>{
  for(const reps of [[2,4,6,8],[8,6,4,2]]){
    const h=harness(block(reps));h.app.startStandaloneGeneratedWorkout();const tracker=h.run('generatorState.tracker');await tracker.flush();
    const main=h.main();h.app.enterGeneratedPhase(main[0].index);
    assert.match(h.el('workoutMovementProgress').textContent,/Ladder · Step 1 of 4/);
    assert.equal(h.el('workoutTarget').textContent,reps[0]+' reps');assert.match(h.spoken.at(-1),new RegExp(reps[0]+' reps'));
    const preview=h.app.GarageFitWorkoutPreview;assert.match(preview.protocolLabel(block(reps)),/Ladder/);
    assert.equal(preview.occurrenceTargetLabel(block(reps),0),reps.map(n=>n+' reps').join(' → '));
    assert.equal(h.el('completeMovementNext').textContent,'Rest');
    h.app.generatedPrimaryAction();await tracker.flush();assert.equal(h.phase().kind,'rest');
    h.app.generatedPrimaryAction();assert.equal(h.el('workoutTarget').textContent,reps[0]+' reps');
    h.app.generatedPrimaryAction();await tracker.flush();assert.equal(h.phase().kind,'ladder-rest');
    assert.equal(h.el('completeMovementNext').textContent,block(reps).exercises[0].name);
    h.app.toggleWorkoutPause();assert.equal(h.el('completeMovementBtn').disabled,true);h.app.toggleWorkoutPause();
    h.app.generatedPrimaryAction();assert.equal(h.el('workoutTarget').textContent,reps[1]+' reps');
    h.app.previousGeneratedPhase();assert.equal(h.phase().occurrenceId,main[1].phase.occurrenceId);
    h.app.generatedPrimaryAction();await tracker.flush();assert.equal(tracker.performedWork().length,2,'redo replaces keyed outcome');
    const planned=tracker.plannedWork().filter(p=>p.section==='main');
    assert.deepEqual(copy(planned.map(p=>p.prescription.reps)),reps.flatMap(n=>[n,n]));
    assert.ok(planned.every(p=>p.requirementId===null&&p.prescription.ladderStep>=1));
    assert.ok(tracker.performedWork().every(p=>p.sets===undefined),'Done never invents actual reps or load');
    assert.ok(main.every(({phase})=>Object.isFrozen(phase.plannedPrescription)));
  }
});

test('Coach optional ladder Done, Skip and early exit save truthful evidence without advancing anchors',async()=>{
  const p=pilot();p.run("state.ownedEquipment=['dumbbells']");
  await p.run("coachUI.controller.start(pilotDef,['dumbbells'])");await p.run('coachUI.open()');
  p.run(`function ladderButton(id,text){const visit=node=>node.textContent===text&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById(id)).onclick();}`);
  await p.run("ladderButton('coachContent','View today’s workout')");
  p.run(`coachUI.controller.snapshot().preview.workout.main.blocks.push(JSON.parse(${JSON.stringify(JSON.stringify(block()))}));`);
  await p.run("ladderButton('coachPreviewContent','Start workout')");
  p.run("enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.protocol==='ladder'&&phase.kind==='exercise'))");
  assert.equal(p.run("document.getElementById('coachAnchorLog').classList.contains('hidden')"),true);
  const first=p.run('currentGeneratedPhase().occurrenceId');await p.run('completeWorkoutMovement()');await p.run('completeWorkoutMovement()');
  const second=p.run('currentGeneratedPhase().occurrenceId');await p.run('generatedSkipWork()');
  const tracker=p.run('generatorState.tracker');assert.equal(tracker.outcome(first).status,'completed');assert.equal(tracker.outcome(second).status,'skipped');
  p.run("openExitDialog('workout')");await p.run('confirmExitChoice()');await p.run("coachUI.saveFeedback('about-right')");
  const result=p.json('coachUI.controller.snapshot().results[0]');assert.equal(result.finalStatus,'partial');
  assert.equal(result.performedWork.length,1);assert.equal(result.performedWork[0].sets,undefined);
  assert.ok(result.anchorResults.every(a=>a.status==='skipped'));
  assert.ok(p.json('coachUI.controller.snapshot().state.anchors').every(a=>a.currentTarget.target.maxReps===6&&a.comparisonBaseline===null));
  assert.equal(GarageFitCoachModel.validate('session-result',result).valid,true);
  const history=H.createHistory([result],C).performances[0];assert.equal(H.comparePerformances(history,history).comparable,false);
  const savedWithoutFlag={...history,variableTarget:false};assert.equal(H.comparePerformances(savedWithoutFlag,savedWithoutFlag).comparable,false);
});

test('Coach preflight handles ladder-only optional constraints, hard avoids, insufficient time and forbidden anchor conversion',()=>{
  const rx=fixtures.prescription({requiredAnchors:[],equipment:[],duration:10,protocolConstraints:[{requirementId:'ladder-only',importance:'hard',allowedProtocols:['ladder']}],mainTimeLimitSeconds:180});
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:rx}).status,'feasible');
  const workout=G.generate({catalogue:C,sessionPrescription:rx,random:random(11)});
  assert.ok(workout.main.blocks.every(b=>b.protocol==='ladder'));assert.ok(workout.main.estimatedDurationSeconds<=180);
  const short={...rx,mainTimeLimitSeconds:10};assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:short}).status,'infeasible');
  assert.throws(()=>G.generate({catalogue:C,sessionPrescription:short}),G.SessionPrescriptionError);
  const impossible={...rx,requiredAnchors:[fixtures.anchor({exerciseId:'push-up',allowedProtocols:['ladder']})]};
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:impossible}).status,'infeasible');
  const avoided={...rx,avoidConstraints:Object.values(C).filter(ex=>G.protocolCompatible(ex,'ladder')).map((ex,i)=>({requirementId:'avoid-'+i,importance:'hard',exerciseId:ex.id}))};
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:avoided}).status,'infeasible');
});


test('bounded seeds reach optional ladders across styles and 10–45 minute budgets without changing determinism',()=>{
  // Ring catalogue growth shifts full-kit draws; fixed seeds within 1–50 reach one ladder each.
  const cases=[[10,'balanced',30],[10,'cardio',37],[15,'strength',6],[20,'strength',39],[30,'strength',1],[45,'strength',19]];
  const directions=new Set();
  for(const [duration,focus,seed] of cases){
    const options={catalogue:C,duration,focus,equipment:kit},w=G.generate({...options,random:random(seed)});
    const ladders=w.main.blocks.filter(b=>b.protocol==='ladder');assert.equal(ladders.length,1);
    assert.deepEqual(G.validateMain(w.main,C,kit,G.BUDGETS[duration].main),[]);
    assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[duration].main);
    assert.ok(new Set(w.main.blocks.flatMap(b=>b.exercises.map(e=>e.id))).size>=3);
    directions.add(ladders[0].prescription.repSteps[0]<ladders[0].prescription.repSteps[1]?'ascending':'descending');
    assert.deepEqual(w.main,G.generate({...options,random:random(seed)}).main);
  }
  assert.deepEqual([...directions].sort(),['ascending','descending']);
});

test('standalone ladder skip stays skipped, completion persists once and unconfirmed targets never become actual reps',async()=>{
  const b=block([2,4]);b.exercises=b.exercises.slice(0,1);
  const h=harness(b);h.app.startStandaloneGeneratedWorkout();const tracker=h.run('generatorState.tracker');await tracker.flush();
  const first=h.main()[0];h.app.enterGeneratedPhase(first.index);
  assert.equal(h.el('coachSkipBtn').classList.contains('hidden'),false);
  h.app.generatedSkipWork();await tracker.flush();assert.equal(tracker.outcome(first.phase.occurrenceId).status,'skipped');
  h.app.generatedPrimaryAction();assert.equal(h.el('workoutTarget').textContent,'4 reps');
  h.app.generatedPrimaryAction();await tracker.flush();
  h.app.enterGeneratedPhase(h.run('generatorState.timeline.length-1'));h.run('generatorState.remaining=0');
  h.app.generatedPrimaryAction();await h.run('generatorState.trackedResult');
  const results=await h.run('GarageFitCoachStore.createStore(localStorage).listSessionResults({source:"generator"})');
  assert.equal(results.results.length,1);
  const result=results.results[0],ladder=result.performedWork.filter(w=>w.occurrenceId.includes(':l'));
  assert.equal(ladder.length,1);assert.equal(ladder[0].sets,undefined);
  assert.equal(result.plannedWork.find(w=>w.occurrenceId===first.phase.occurrenceId).prescription.reps,2);
  assert.equal(GarageFitCoachModel.validate('session-result',copy(result)).valid,true);
});
