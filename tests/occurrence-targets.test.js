const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {loadAppContext}=require('./helpers/app-context');
const {blockFixtures,savedWorkoutV2,traceBlock}=require('./helpers/protocol-fixtures');
const fixtures=require('./helpers/coach-fixtures');
const {performance}=require('./helpers/coach-policy-fixtures');
const {pilot}=require('./helpers/coach-pilot');
global.window=global;
require('../data/equipment');require('../data/exercises');require('../js/generator');
require('../js/coach-model');require('../js/coach-store');require('../js/session-tracker');require('../js/training-history');
const G=GarageFitGenerator,T=GarageFitSessionTracker,H=GarageFitTrainingHistory,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value));
const dose=(type,value,load)=>({plannedPrescription:{type,value},...(load?{plannedLoad:{suggestedLoad:load,loadUnit:'kg',loadInterpretation:'per-item'}}:{})});
function block(id='push-up',targets=[dose('reps',4,8),dose('reps',8),null]){
  return {id:'main-1',protocol:'rounds',intent:'strength',exercises:[copy(C[id])],
    prescription:{rounds:targets.length,exerciseRestSeconds:0,roundRestSeconds:10},occurrenceTargets:targets};
}
function appFor(b,{rampup=false}={}){
  let now=0;
  const app=loadAppContext(new Map(),{ownIntrinsics:true,configure(context){context.performance={now:()=>now};}});
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id);
  app.targetWallNow=()=>Date.parse('2026-10-17T08:00:00Z')+now;run('Date.now=targetWallNow');
  if(rampup)vm.runInContext(fs.readFileSync('js/rampup-ui.js','utf8'),app);
  const workout=savedWorkoutV2(C);workout.main.blocks=[b];
  run(`generatorState.workout=JSON.parse(${JSON.stringify(JSON.stringify(workout))});`);
  const spoken=[];app.announceExercise=(exercise,parts)=>spoken.push([].concat(parts).join(' '));
  return {app,run,el,spoken,waitForIntent(){app.toggleWorkoutPause();now+=400;app.toggleWorkoutPause()},time:ms=>{now+=ms},phase:()=>run('currentGeneratedPhase()'),
    main:()=>run("generatorState.timeline.map((phase,index)=>({phase,index})).filter(({phase})=>phase.kind==='exercise'&&phase.section==='main')")};
}

test('pure occurrence resolver scales published estimates, counts sides and never mutates catalogue or plan',()=>{
  const b=block(),before=copy(b),canonical=copy(C['push-up']);
  const steps=G.resolveBlockSteps(b).filter(step=>step.kind==='exercise');
  assert.deepEqual(steps.map(step=>step.plannedPrescription.value),[4,8,10]);
  assert.deepEqual(steps.slice(0,2).map(step=>step.estimatedSeconds),[Math.ceil(C['push-up'].estimatedSeconds*.4),Math.ceil(C['push-up'].estimatedSeconds*.8)]);
  assert.equal(G.estimateBlockDuration(b),steps[0].estimatedSeconds+steps[1].estimatedSeconds+C['push-up'].estimatedSeconds+20);
  assert.ok(Object.isFrozen(steps[0])&&Object.isFrozen(steps[0].plannedPrescription)&&Object.isFrozen(steps[0].plannedLoad));
  b.occurrenceTargets[0].plannedPrescription.value=99;assert.equal(steps[0].plannedPrescription.value,4);
  b.occurrenceTargets=before.occurrenceTargets;assert.deepEqual(b,before);assert.deepEqual(C['push-up'],canonical);
  for(const [id,type] of [['reverse-lunge','unilateral-reps'],['side-plank','unilateral-timed']]){
    const exercise=C[id],target=dose(type,7),resolved=G.resolveOccurrenceTarget(exercise,target);
    assert.equal(resolved.estimatedSeconds,type.includes('timed')?14:Math.ceil(exercise.estimatedSeconds/2*7/exercise.prescription.value)*2);
  }
  assert.equal(G.resolveOccurrenceTarget(C.plank,dose('timed',12.5)).estimatedSeconds,12.5);
});

test('malformed, contradictory, unbounded or anchor overrides fail before playback',()=>{
  const invalid=[undefined,{},[],{plannedPrescription:{type:'timed',value:10}},dose('reps',0),dose('reps',-1),dose('reps',1.5),dose('reps',101),dose('reps',Infinity),
    {plannedPrescription:{type:'reps',value:4,extra:true}}, {...dose('reps',4),extra:true},
    {...dose('reps',4),plannedLoad:{suggestedLoad:0,loadUnit:'kg',loadInterpretation:'total'}},
    {...dose('reps',4),plannedLoad:{suggestedLoad:10,loadUnit:'stone',loadInterpretation:'total'}},
    {...dose('reps',4),plannedLoad:{suggestedLoad:10,loadUnit:'kg'}},
    {...dose('reps',4),plannedLoad:{suggestedLoad:1001,loadUnit:'kg',loadInterpretation:'total'}}];
  for(const target of invalid){const b=block('push-up',[target]);assert.ok(G.validateOccurrenceTargets(b).length);assert.deepEqual(G.resolveBlockSteps(b),[]);assert.equal(G.estimateBlockDuration(b),0);
    const w=savedWorkoutV2(C);w.main.blocks=[b];assert.throws(()=>G.normaliseWorkout(w),/occurrence targets/);}
  for(const targets of [null,{},[],Array(257).fill(null),new Array(3)])assert.ok(G.validateOccurrenceTargets({...block(),occurrenceTargets:targets}).length);
  assert.throws(()=>G.resolveOccurrenceTarget(C['side-plank'],dose('unilateral-timed',301)));
  assert.throws(()=>G.resolveOccurrenceTarget({...C['push-up'],estimatedSeconds:1000},dose('reps',10)));
  const anchor=block();anchor.exercises[0].coachAnchor={requirementId:'required'};
  assert.deepEqual(G.validateOccurrenceTargets(anchor),['occurrence-target-anchor']);
  const b=block();assert.ok(G.validateMain({blocks:[b]},C,[],1).includes('main:duration-over-budget'));
});

test('all protocols use shared occurrence targets with their existing repeat order and constraints',()=>{
  for(const b of Object.values(blockFixtures(C,{emom:true}))){
    const original=copy(G.resolveBlockSteps(b)),oldEstimate=G.estimateBlockDuration(b);
    assert.equal(G.validateOccurrenceTargets(b).length,0);
    const steps=original.filter(step=>step.kind==='exercise');
    b.occurrenceTargets=steps.map((step,index)=>{
      const exercise=b.exercises[step.exerciseIndex],type=step.timed?'timed':exercise.prescription.type;
      return dose(type,type.includes('timed')?10+index:3+Math.floor(index/2));
    });
    assert.deepEqual(G.validateOccurrenceTargets(b),[],b.protocol);
    const resolved=G.resolveBlockSteps(b).filter(step=>step.kind==='exercise');
    assert.equal(traceBlock(G,b).seconds,G.estimateBlockDuration(b));
    assert.deepEqual(resolved.map(step=>step.plannedPrescription.value),b.occurrenceTargets.map(target=>target.plannedPrescription.value));
    const position=G.PROTOCOL_SHAPES[b.protocol].stepKey;
    assert.deepEqual(resolved.map(step=>[step.exerciseIndex,step[position]]),steps.map(step=>[step.exerciseIndex,step[position]]));
    if(b.protocol==='emom')assert.equal(G.estimateBlockDuration(b),oldEstimate);
    delete b.occurrenceTargets;assert.deepEqual(G.resolveBlockSteps(b),original);assert.equal(G.estimateBlockDuration(b),oldEstimate);
  }
  const intervals=blockFixtures(C).timed_intervals;
  intervals.occurrenceTargets=[dose('reps',4),null,null,null];assert.ok(G.validateOccurrenceTargets(intervals).length);
  intervals.occurrenceTargets[0]=dose('timed',41);assert.ok(G.validateOccurrenceTargets(intervals).length);
  const emom=blockFixtures(C,{emom:true}).emom;emom.occurrenceTargets=[dose('reps',7),null,null,null,null];assert.ok(G.validateOccurrenceTargets(emom).length);
});

test('normalisation recalculates stale estimates and owns a copy of the bounded override list',()=>{
  const b=block(),w=savedWorkoutV2(C);b.estimatedDurationSeconds=9999;w.main.blocks=[b];
  w.estimatedSeconds=9999;w.warmup.estimatedSeconds=60;w.rampup.estimatedSeconds=30;w.cooldown.estimatedSeconds=60;
  G.normaliseWorkout(w);assert.equal(w.main.blocks[0].estimatedDurationSeconds,G.estimateBlockDuration(b));
  assert.equal(w.estimatedSeconds,150+G.estimateBlockDuration(b));
  b.occurrenceTargets[0].plannedPrescription.value=99;assert.equal(w.main.blocks[0].occurrenceTargets[0].plannedPrescription.value,4);
  assert.equal(w.schemaVersion,2);
});

test('safe swaps preserve occurrence modes and targets without mutating exercise metadata',()=>{
  for(const [id,type] of [['plank','timed'],['push-up','reps'],['reverse-lunge','unilateral-reps']]){
    const w=savedWorkoutV2(C);w.main.blocks=[block(id,[dose(type,8),dose(type,12)])];
    const targets=copy(w.main.blocks[0].occurrenceTargets);
    G.swap(w,0,0,{catalogue:C,equipment:GarageFitData.equipment.map(item=>item.id),random:()=>.2});
    const b=w.main.blocks[0];assert.deepEqual(G.validateOccurrenceTargets(b,C),[]);
    assert.equal(b.exercises[0].prescription.type,type);assert.deepEqual(b.occurrenceTargets,targets);
    assert.deepEqual(b.exercises[0].prescription,C[b.exercises[0].id].prescription);
    assert.equal(b.estimatedDurationSeconds,G.estimateBlockDuration(b));
  }
});

test('player, voice, preview and next hints follow each occurrence through Previous, pause and default fallback',async()=>{
  for(const rampup of [false,true]){
    const h=appFor(block(),{rampup});h.app.startStandaloneGeneratedWorkout();await h.run('generatorState.tracker.flush()');
    const main=h.main();h.app.enterGeneratedPhase(main[0].index);
    assert.equal(h.el('workoutTarget').textContent,'4 reps');assert.match(h.el('workoutSideNote').textContent,/8 kg each/);assert.match(h.spoken.at(-1),/4 reps.*8 kg each/);
    assert.equal(h.app.GarageFitWorkoutPreview.occurrenceTargetLabel(h.run('generatorState.workout.main.blocks[0]'),0),'4 reps · 8 kg each → 8 reps → 10 reps');
    h.waitForIntent();h.app.generatedPrimaryAction();await h.run('generatorState.tracker.flush()');
    assert.equal(h.el('completeMovementNext').textContent,C['push-up'].name);
    h.waitForIntent();h.app.generatedPrimaryAction();assert.equal(h.el('workoutTarget').textContent,'8 reps');assert.doesNotMatch(h.el('workoutSideNote').textContent,/8 kg/);
    h.app.toggleWorkoutPause();assert.equal(h.el('completeMovementBtn').disabled,true);assert.equal(h.el('workoutTarget').textContent,'8 reps');h.app.toggleWorkoutPause();
    h.app.previousGeneratedPhase();assert.equal(h.el('workoutTarget').textContent,'4 reps');assert.match(h.el('workoutSideNote').textContent,/8 kg/);
    h.app.enterGeneratedPhase(main[2].index);assert.equal(h.el('workoutTarget').textContent,'10 reps');assert.doesNotMatch(h.el('workoutSideNote').textContent,/8 kg/);
    const tracker=h.run('generatorState.tracker'),plan=tracker.plannedWork().filter(item=>item.section==='main');
    assert.deepEqual(copy(plan.map(item=>item.prescription.reps)),[4,8,10]);
    assert.equal(tracker.outcome(plan[0].occurrenceId).sets,undefined);
    assert.equal(new Set(plan.map(item=>item.occurrenceId)).size,3);
  }
});

test('per-side timed targets track measured seconds, cap overruns, survive recovery and retain early-exit evidence',async()=>{
  const h=appFor(block('side-plank',[dose('unilateral-timed',7),dose('unilateral-timed',13)]));
  h.app.startGeneratedWorkout({store:h.run('GarageFitCoachStore.createStore(localStorage)'),source:'generator',draftId:'variable-time',recordResults:true,meaningful:()=>true});
  const tracker=h.run('generatorState.tracker');await tracker.flush();
  const main=h.main();assert.deepEqual(copy(main.map(({phase})=>phase.seconds)),[7,7,13,13]);
  h.app.enterGeneratedPhase(main[0].index);h.run('generatorState.remaining=4');h.waitForIntent();h.app.generatedPrimaryAction();await tracker.flush();
  assert.equal(tracker.outcome(main[0].phase.occurrenceId).sets[0].seconds,3);
  assert.equal(h.el('workoutRingNum').textContent,'7');
  await tracker.recordTimed(main[1].phase.occurrenceId,{plannedSeconds:999,elapsedSeconds:999});
  assert.equal(tracker.outcome(main[1].phase.occurrenceId).sets[0].seconds,7);
  const store=h.run('GarageFitCoachStore.createStore(localStorage)');
  const resumed=await h.app.GarageFitSessionTracker.resumeTracker({store,recordResults:true,meaningful:()=>true});
  const result=await resumed.exitEarly();
  assert.equal(result.finalStatus,'partial');assert.equal(result.schemaVersion,1);
  assert.deepEqual(copy(result.performedWork.map(work=>work.sets[0].seconds)),[3,7]);
  assert.deepEqual(copy(result.plannedWork.filter(work=>work.section==='main').map(work=>work.prescription.seconds)),[7,7,13,13]);
});

test('variable work cannot acquire anchor linkage or fabricate actual measures and history stays conservative',async()=>{
  const h=appFor(block());h.app.startStandaloneGeneratedWorkout();const tracker=h.run('generatorState.tracker');await tracker.flush();
  const timeline=h.run('generatorState.timeline');
  const plan=T.plannedWorkFromTimeline(timeline,{requirementIdFor:()=> 'forged-anchor'}).filter(item=>item.section==='main');
  assert.ok(plan.every(item=>item.requirementId===null));
  const first=plan[0],second=plan[1];await tracker.recordDone(first.occurrenceId);await tracker.recordSkip(second.occurrenceId);
  assert.equal(tracker.outcome(first.occurrenceId).sets,undefined);assert.equal(tracker.outcome(second.occurrenceId).sets,undefined);
  const result=performance({source:'generator',programmeInstanceId:null,prescriptionId:null,plannedWork:copy(plan),
    performedWork:[{occurrenceId:first.occurrenceId,exerciseId:first.exerciseId,status:'completed',sets:[{reps:4}]},
      {occurrenceId:second.occurrenceId,exerciseId:second.exerciseId,status:'partial',sets:[{reps:4}]}]});
  const history=H.createHistory([result],C),[a,b]=history.performances;
  assert.equal(b.exposure.value,.5);assert.equal(a.sets[0].load.confidence,'unknown');
  assert.ok(H.comparePerformances(a,b).reasons.includes('occurrence-target-conditions'));
  assert.equal(H.comparePerformances(a,a).comparable,false);
  assert.equal(H.comparePerformanceEvidence(a,b).change,'incomparable');
  const legacy=H.createHistory([performance()],C).performances[0];assert.equal(H.comparePerformances(legacy,legacy).comparable,true);
});

test('production-style Coach anchors retain exact rounds, target linkage and planned/actual separation',()=>{
  let seed=17;const prescription=fixtures.prescription({requiredAnchors:[fixtures.anchor({allowedProtocols:['rounds']})]});
  for(const duration of [10,15,20,30,45]){
    const workout=G.generate({catalogue:C,duration,equipment:GarageFitData.equipment.map(item=>item.id),sessionPrescription:prescription,random:()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}});
    for(const b of workout.main.blocks.filter(b=>b.exercises.some(ex=>ex.coachAnchor))){assert.equal(b.protocol,'rounds');assert.equal(b.occurrenceTargets,undefined);}
    const app=loadAppContext();app.workout=workout;const plan=T.plannedWorkFromTimeline(app.buildGeneratedTimeline(workout));
    const anchors=plan.filter(work=>work.requirementId);assert.ok(anchors.length);assert.ok(anchors.every(work=>work.prescription.protocol==='rounds'&&!work.prescription.variableTarget&&work.prescription.plannedTarget));
  }
});

test('Coach player hides anchor actuals for variable work and saves Done, Skip and early exit without progression',async()=>{
  const p=pilot();p.run("state.ownedEquipment=['dumbbells'];var targetNow=Date.now();Date.now=()=>targetNow");
  await p.run("coachUI.controller.start(pilotDef,['dumbbells'])");await p.run('coachUI.open()');
  p.run(`function targetButton(id,text){const visit=node=>node.textContent===text&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById(id)).onclick();}`);
  await p.run("targetButton('coachContent','View today’s workout')");
  p.run(`coachUI.controller.snapshot().preview.workout.main.blocks.push(JSON.parse(${JSON.stringify(JSON.stringify({...block(),id:'variable-support'}))}));`);
  await p.run("targetButton('coachPreviewContent','Start workout')");
  p.run("enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.exercise?.coachAnchor))");
  assert.equal(p.run("document.getElementById('coachAnchorLog').classList.contains('hidden')"),false);
  p.run("enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.variableTarget&&generatorState.workout.main.blocks[phase.blockIndex]?.id==='variable-support'))");
  assert.equal(p.run("document.getElementById('coachAnchorLog').classList.contains('hidden')"),true);
  assert.equal(p.run("document.getElementById('workoutTarget').textContent"),'4 reps');
  const first=p.run('currentGeneratedPhase().occurrenceId');await p.run('targetNow+=400;completeWorkoutMovement()');
  assert.equal(p.run(`generatorState.tracker.outcome(${JSON.stringify(first)}).sets`),undefined);
  await p.run('targetNow+=400;completeWorkoutMovement()');assert.equal(p.run("document.getElementById('workoutTarget').textContent"),'8 reps');
  const second=p.run('currentGeneratedPhase().occurrenceId');await p.run('targetNow+=400;generatedSkipWork()');
  assert.equal(p.run(`generatorState.tracker.outcome(${JSON.stringify(second)}).status`),'skipped');
  p.run("openExitDialog('workout')");await p.run('confirmExitChoice()');await p.run("coachUI.saveFeedback('about-right')");
  const result=p.json('coachUI.controller.snapshot().results[0]');assert.equal(result.finalStatus,'partial');
  assert.equal(result.performedWork.length,1);assert.equal(result.performedWork[0].sets,undefined);
  assert.ok(result.anchorResults.every(anchor=>anchor.status==='skipped'));
  assert.ok(p.json('coachUI.controller.snapshot().state.anchors').every(anchor=>anchor.currentTarget.target.maxReps===6&&anchor.comparisonBaseline===null));
});
