const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {loadAppContext}=require('./helpers/app-context');
const {blockFixtures,traceBlock,savedWorkoutV2}=require('./helpers/protocol-fixtures');
global.window=global;
require('../data/equipment');require('../data/exercises');require('../data/workout-families');require('../js/workout-families');require('../js/generator');
require('../data/mobility-membership');require('../data/athletic-membership');
const G=GarageFitGenerator,C=GarageFitData.exercises,copy=x=>JSON.parse(JSON.stringify(x));
const dose=(id,value)=>({plannedPrescription:{type:C[id].sidedness==='per-side'?'unilateral-timed':'timed',value}});
function rounds(ids,rounds=1){return {id:'sequence',protocol:'rounds',intent:'conditioning',exercises:ids.map(id=>copy(C[id])),prescription:{rounds,exerciseRestSeconds:5,roundRestSeconds:30}};}
const empty=()=>({exercises:[],restSeconds:0,estimatedSeconds:0});
function session(blocks,duration=10){return {id:'shared-sequence',schemaVersion:2,focus:'balanced',duration,difficulty:'normal',warmup:empty(),rampup:empty(),cooldown:empty(),main:{blocks}};}
function appFor(workout,{rampup=false}={}){
  const app=loadAppContext(new Map(),{ownIntrinsics:true});const run=s=>vm.runInContext(s,app);run('var sequenceNow=1792569600000;Date.now=()=>sequenceNow');
  if(rampup)vm.runInContext(fs.readFileSync('js/rampup-ui.js','utf8'),app);
  app.input=copy(workout);run('generatorState.workout=JSON.parse(JSON.stringify(input))');
  return {app,run,waitForIntent(){app.toggleWorkoutPause();run('sequenceNow+=400');app.toggleWorkoutPause()},el:id=>app.document.getElementById(id)};
}
const elapsed=phases=>phases.reduce((sum,phase)=>sum+(phase.kind==='exercise'?(phase.timed?phase.seconds:(phase.estimatedSeconds??phase.exercise.estimatedSeconds)/G.sideCount(phase.exercise)):phase.seconds),0);

test('characterisation: existing rounds/targets express unilateral flow; existing protocols have uniform gap classes',()=>{
  const flow=rounds(['worlds-greatest-stretch','hamstring-sweeps']);
  flow.occurrenceTargets=flow.exercises.map(ex=>dose(ex.id,20));
  assert.deepEqual(G.validateOccurrenceTargets(flow),[]);
  assert.deepEqual(traceBlock(G,flow).problems,[]);
  const h=appFor(session([flow])),timeline=h.app.buildGeneratedTimeline(h.app.input);
  assert.equal(timeline.filter(p=>p.kind==='exercise').length,flow.exercises.reduce((n,e)=>n+G.sideCount(e),0));
  for(const block of Object.values(blockFixtures(C))){
    const byKind=new Map();for(const step of G.resolveBlockSteps(block).filter(s=>s.kind!=='exercise')){
      if(!byKind.has(step.kind))byKind.set(step.kind,new Set());byKind.get(step.kind).add(step.seconds);
    }
    assert.ok([...byKind.values()].every(seconds=>seconds.size===1),'targets change work only, not exercise-sensitive recovery');
  }
  // Splitting drills into single-exercise blocks imposes a fixed three-second boundary.
  assert.equal(G.BLOCK_TRANSITION_SECONDS,3);
});

test('bounded per-gap recovery extends existing protocols without changing work positions or default plans',()=>{
  for(const block of Object.values(blockFixtures(C))){
    const before=copy(G.resolveBlockSteps(block)),work=before.filter(s=>s.kind==='exercise');
    block.occurrenceRecoverySeconds=work.slice(1).map((_,i)=>[0,12,45,null][i%4]);
    assert.deepEqual(G.validateOccurrenceRecovery(block),[]);
    const resolved=G.resolveBlockSteps(block),after=resolved.filter(s=>s.kind==='exercise');
    assert.deepEqual(after,work);assert.deepEqual(traceBlock(G,block).problems,[]);
    assert.equal(traceBlock(G,block).seconds,G.estimateBlockDuration(block));
    block.occurrenceRecoverySeconds=Array(work.length-1).fill(null);assert.deepEqual(G.resolveBlockSteps(block),before);
    delete block.occurrenceRecoverySeconds;assert.deepEqual(G.resolveBlockSteps(block),before);
  }
  const b=rounds(['forward-back-line-steps','single-leg-balance-reach','quarter-turn-pivot-steps','lateral-step-and-stick'],2);
  b.occurrenceRecoverySeconds=[5,35,10,60,8,40,12];
  assert.deepEqual(G.resolveBlockSteps(b).filter(s=>s.kind!=='exercise').map(s=>s.seconds),b.occurrenceRecoverySeconds);
  assert.equal(G.resolveBlockSteps(b).at(-1).kind,'exercise');
});

test('malformed, oversized, sparse, trailing, unsupported and anchor recovery plans fail before playback',()=>{
  const b=rounds(['push-up','air-squat']);
  for(const values of [null,{},[],[1,2],[-1],[301],[Infinity],[undefined],new Array(1)]){
    const bad={...b,occurrenceRecoverySeconds:values};
    assert.ok(G.validateOccurrenceRecovery(bad).length);assert.deepEqual(G.resolveBlockSteps(bad),[]);assert.equal(G.estimateBlockDuration(bad),0);
    assert.throws(()=>G.normaliseWorkout(session([bad])),/occurrence recovery/);
    assert.ok(G.validateMain({blocks:[bad]},C,[],600).some(i=>i.includes('occurrence-recovery')));
  }
  const anchor=copy(b);anchor.exercises[0].coachAnchor={};anchor.occurrenceRecoverySeconds=[20];
  assert.deepEqual(G.validateOccurrenceRecovery(anchor),['occurrence-recovery-anchor']);
  for(const block of Object.values(blockFixtures(C,{emom:true,ladder:true,pyramid:true,complex:true,density:true})).slice(3))
    assert.deepEqual(G.validateOccurrenceRecovery({...block,occurrenceRecoverySeconds:[]}),['unsupported-occurrence-recovery']);
});

function familyBlock(family,role,ids,repeats=1){
  const b=rounds(ids,repeats);b.familyContext={workoutFamilyId:family,workoutFamilyVersion:1,role};
  b.occurrenceTargets=Array.from({length:repeats},()=>ids.map(id=>dose(id,20))).flat();
  b.occurrenceRecoverySeconds=b.occurrenceTargets.slice(1).map((_,i)=>i%ids.length===ids.length-1?30:5+i%3*5);
  return b;
}

test('10/15/20/30/45-minute specialist allocations use one timeline, preview and plan with no duplicated generic prep/finish',()=>{
  for(const duration of [10,15,20,30,45])for(const athletic of [false,true])for(const rampup of [false,true]){
    const family=athletic?'athletic-movement':'mobility-movement-quality';
    const ids=athletic?['forward-back-line-steps','single-leg-balance-reach','quarter-turn-pivot-steps']:['worlds-greatest-stretch','hamstring-sweeps','squat-to-stand'];
    const repeatSeconds=G.estimateBlockDuration(familyBlock(family,athletic?'control':'flow',ids))+30;
    const repeats=Math.floor((duration*60-60)/repeatSeconds);
    const blocks=athletic?[familyBlock(family,'control',ids,repeats)]:[
      familyBlock(family,'prep',['cat-cow']),familyBlock(family,'flow',ids,repeats),familyBlock(family,'finish',['cat-cow'])];
    const w=session(blocks,duration),h=appFor(w,{rampup});
    const phases=h.app.buildGeneratedTimeline(h.app.input),normal=h.app.input;
    assert.equal(elapsed(phases)-3,normal.estimatedSeconds,'only the ready countdown remains outside this whole-session estimate');
    assert.ok(normal.estimatedSeconds<=duration*60);assert.ok(normal.estimatedSeconds>duration*60*.6);
    assert.equal(normal.main.estimatedDurationSeconds,G.mainSeconds(blocks));
    assert.ok(phases.filter(p=>p.kind==='exercise').every(p=>p.section==='main'));
    assert.ok(!phases.some(p=>p.kind==='transition'));
    const plan=h.app.GarageFitSessionTracker.plannedWorkFromTimeline(phases);
    assert.equal(plan.length,phases.filter(p=>p.kind==='exercise').length);
    assert.equal(new Set(plan.map(p=>p.occurrenceId)).size,plan.length);
    assert.ok(plan.every(p=>p.prescription.seconds===20));
    assert.ok(phases.filter(p=>p.kind!=='exercise').every(p=>!p.occurrenceId));
    h.app.renderGeneratedPreview();assert.equal(h.el('previewEstimate').textContent,'≈'+Math.round(normal.estimatedSeconds/60)+' min total');
    assert.deepEqual(copy(G.normaliseWorkout(normal)),copy(normal));
  }
});

test('recovery and rings setup share one boundary after both sides and survive re-normalisation',()=>{
  for(const recovery of [0,20,60])for(const rampup of [false,true]){
    const b=rounds(['side-plank','ring-pull-up','ring-fallout']);b.occurrenceRecoverySeconds=[12,recovery];
    const w=session([b]),h=appFor(w,{rampup});
    const phases=h.app.buildGeneratedTimeline(h.app.input),normal=h.app.input;
    assert.equal(normal.setupTransitions.length,1);assert.equal(normal.setupTransitions[0].replacesSeconds,recovery);
    const setup=phases.filter(p=>p.kind==='setup-transition');assert.equal(setup.length,1);assert.equal(setup[0].seconds,Math.max(45,recovery));
    const sides=phases.filter(p=>p.exercise?.id==='side-plank');assert.equal(sides.length,2);
    assert.equal(phases[phases.indexOf(sides[0])+1],sides[1]);
    assert.equal(elapsed(phases)-3,normal.estimatedSeconds);
    assert.equal(phases.filter(p=>p.kind==='rest'&&p.seconds===12).length,1);
    const snapshot=copy(normal);G.normaliseWorkout(normal);assert.deepEqual(copy(normal),snapshot);
  }
});

test('Previous, pause, skip recovery and durable interrupted evidence keep occurrence identity and targets',async()=>{
  const b=rounds(['side-plank','push-up'],2);b.occurrenceTargets=[dose('side-plank',10),{plannedPrescription:{type:'reps',value:4}},dose('side-plank',15),{plannedPrescription:{type:'reps',value:6}}];
  b.occurrenceRecoverySeconds=[17,40,25];
  const h=appFor(session([b]));h.run("startGeneratedWorkout({store:GarageFitCoachStore.createStore(localStorage),source:'generator',draftId:'sequence-draft',recordResults:true,meaningful:()=>true})");
  const tracker=h.run('generatorState.tracker');await tracker.flush();
  const timeline=h.run('generatorState.timeline'),first=timeline.findIndex(p=>p.kind==='exercise');
  h.app.enterGeneratedPhase(first);h.run('generatorState.remaining=6');h.waitForIntent();h.app.generatedPrimaryAction();await tracker.flush();
  assert.equal(tracker.outcome(timeline[first].occurrenceId).sets[0].seconds,4);
  assert.equal(h.run('currentGeneratedPhase().side'),'left');
  h.app.toggleWorkoutPause();const paused=h.run('generatorState.timelineIndex');h.app.generatedPrimaryAction();assert.equal(h.run('generatorState.timelineIndex'),paused);h.app.toggleWorkoutPause();
  h.waitForIntent();h.app.generatedPrimaryAction();await tracker.flush();assert.equal(h.run('currentGeneratedPhase().seconds'),17);
  const count=tracker.plannedWork().length;h.waitForIntent();h.app.generatedPrimaryAction();await tracker.flush();assert.equal(tracker.plannedWork().length,count);
  assert.equal(h.el('workoutTarget').textContent,'4 reps');h.waitForIntent();h.app.generatedPrimaryAction();await tracker.flush();
  h.app.previousGeneratedPhase();assert.equal(h.el('workoutTarget').textContent,'4 reps');h.waitForIntent();h.app.generatedPrimaryAction();await tracker.flush();
  const resumed=await h.app.GarageFitSessionTracker.resumeTracker({store:h.run('GarageFitCoachStore.createStore(localStorage)'),recordResults:true,meaningful:()=>true});
  const result=await resumed.exitEarly();
  assert.equal(result.finalStatus,'partial');assert.equal(result.performedWork.length,2);
  assert.equal(new Set(result.performedWork.map(p=>p.occurrenceId)).size,2);
  assert.deepEqual(copy(result.plannedWork[0].prescription.protocolConditions.occurrenceRecoverySeconds),[17,40,25]);
  assert.equal(result.performedWork.find(p=>p.exerciseId==='push-up').sets,undefined);
  assert.equal(result.plannedWork.length,6);
});


test('normalisation owns recovery arrays and history rejects malformed/unsupported saved conditions',()=>{
  const b=rounds(['push-up','air-squat']);b.occurrenceRecoverySeconds=[35];b.estimatedDurationSeconds=9999;
  const w=G.normaliseWorkout(session([b]));b.occurrenceRecoverySeconds[0]=200;
  assert.equal(w.main.blocks[0].occurrenceRecoverySeconds[0],35);
  const conditions=G.protocolConditions(w.main.blocks[0]);assert.ok(Object.isFrozen(conditions.occurrenceRecoverySeconds));
  require('../js/coach-model');require('../js/training-history');
  const H=GarageFitTrainingHistory;
  const performance={exerciseId:'push-up',prescriptionMode:'reps',protocol:'rounds',side:null,protocolConditions:{exerciseRestSeconds:5,roundRestSeconds:30}};
  assert.equal(H.comparePerformances(performance,performance).comparable,true,'old records retain their conditions');
  const changed={...performance,protocolConditions:{...performance.protocolConditions,occurrenceRecoverySeconds:[35]}};
  assert.ok(H.comparePerformances(performance,changed).reasons.includes('protocol-conditions'));
  for(const value of [[301],[-1],{},[undefined]]){
    const invalid={...performance,protocolConditions:{...performance.protocolConditions,occurrenceRecoverySeconds:value}};
    assert.ok(H.comparePerformances(invalid,invalid).reasons.includes('unknown-recovery-conditions'));
  }
});

test('interrupted recovery retains durable checkpoints and an unsaved target earns no performed credit',async()=>{
  const b=rounds(['push-up','air-squat']);b.occurrenceRecoverySeconds=[25];
  const h=appFor(session([b]));h.run("var sequenceStore=GarageFitCoachStore.createStore(localStorage);var sequenceFail=false;var originalSave=sequenceStore.saveSessionDraft;sequenceStore.saveSessionDraft=record=>sequenceFail?Promise.reject(new Error('checkpoint failed')):originalSave(record);startGeneratedWorkout({store:sequenceStore,source:'generator',draftId:'failed-sequence',recordResults:true,meaningful:()=>true})");
  const tracker=h.run('generatorState.tracker');await tracker.flush();const plan=tracker.plannedWork();
  await tracker.recordDone(plan[0].occurrenceId);h.run('sequenceFail=true');
  await assert.rejects(tracker.recordDone(plan[1].occurrenceId),/checkpoint failed/);
  const resumed=await h.app.GarageFitSessionTracker.resumeTracker({store:h.run('GarageFitCoachStore.createStore(localStorage)'),recordResults:true,meaningful:()=>true});
  const result=await resumed.exitEarly();assert.equal(result.performedWork.length,1);assert.equal(result.performedWork[0].occurrenceId,plan[0].occurrenceId);
  assert.deepEqual(copy(result.plannedWork[1].prescription.protocolConditions.occurrenceRecoverySeconds),[25]);
});


test('ordinary nonempty preparation preserves its trace and phase overhead in both builders',()=>{
  const w=savedWorkoutV2(C);
  w.warmup.estimatedSeconds=C['jumping-jacks'].estimatedSeconds;w.rampup.estimatedSeconds=0;w.cooldown.estimatedSeconds=C['childs-pose'].estimatedSeconds;
  w.estimatedSeconds=w.warmup.estimatedSeconds+w.cooldown.estimatedSeconds+G.mainSeconds(w.main.blocks);
  const base=appFor(w),production=appFor(w,{rampup:true});
  const a=base.app.buildGeneratedTimeline(base.app.input),b=production.app.buildGeneratedTimeline(production.app.input);
  const trace=phases=>copy(phases.map(p=>[p.kind,p.seconds,p.occurrenceId]));
  assert.deepEqual(trace(a),trace(b));assert.equal(elapsed(a)-9,w.estimatedSeconds);
  assert.equal(a.filter(p=>p.kind==='transition').length,2);
  for(const block of w.main.blocks){const n=G.resolveBlockSteps(block).filter(s=>s.kind==='exercise').length;block.occurrenceRecoverySeconds=Array(n-1).fill(null);}
  const explicit=appFor(w,{rampup:true});const same=explicit.app.buildGeneratedTimeline(explicit.app.input);
  assert.deepEqual(trace(a),trace(same));assert.equal(elapsed(same)-9,explicit.app.input.estimatedSeconds);
  assert.match(explicit.app.GarageFitWorkoutPreview.protocolLabel(explicit.app.input.main.blocks[1]),/Recovery 10–60 sec/);
});
