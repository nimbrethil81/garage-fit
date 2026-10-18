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
function block(kind='reps',id=kind==='reps'?'dumbbell-biceps-curl':'trx-row'){
  const reps=kind==='reverse'?[4,6,8]:kind==='intensity'?[8,4,8]:[4,8,4];
  const cues=kind==='reverse'?['heavier','medium','lighter']:['lighter','heavier','lighter'];
  return {id:'main-1',protocol:'pyramid',intent:'strength',exercises:[copy(C[id])],prescription:{
    steps:reps.map((reps,index)=>({reps,...(kind!=='reps'?{relativeLoad:cues[index]}:{})})),stepRestSeconds:kind==='reps'?60:90}};
}
function harness(b=block()){
  let now=0;
  const app=loadAppContext(new Map(),{ownIntrinsics:true,configure(context){context.performance={now:()=>now}}});
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id);
  app.pyramidNow=()=>Date.parse('2026-10-18T08:00:00Z')+now;run('Date.now=pyramidNow');
  const workout=savedWorkoutV2(C);workout.main.blocks=[b];
  run(`generatorState.workout=JSON.parse(${JSON.stringify(JSON.stringify(workout))})`);
  const spoken=[];app.announceExercise=(exercise,parts)=>spoken.push([].concat(parts).join(' '));
  return {app,run,el,spoken,time:ms=>{now+=ms},phase:()=>run('currentGeneratedPhase()'),
    main:()=>run("generatorState.timeline.map((phase,index)=>({phase,index})).filter(({phase})=>phase.kind==='exercise'&&phase.section==='main')")};
}

test('rep and intensity pyramids turn around; reverse pyramids require inverse qualitative resistance',()=>{
  for(const kind of ['reps','intensity','reverse']){
    const b=block(kind),before=copy(b),trace=traceBlock(G,b),work=trace.steps.filter(s=>s.kind==='exercise');
    assert.deepEqual(G.validatePyramidBlock(b,C),[]);assert.deepEqual(trace.problems,[]);
    assert.equal(G.pyramidKind(b.prescription.steps),kind);assert.equal(G.blockRepeatCount(b),3);
    assert.equal(trace.seconds,G.estimateBlockDuration(b));
    assert.equal(trace.seconds,work.reduce((sum,s)=>sum+s.estimatedSeconds,0)+2*b.prescription.stepRestSeconds);
    assert.deepEqual(work.map(s=>s.plannedPrescription.value),b.prescription.steps.map(s=>s.reps));
    assert.ok(work.every(s=>Object.isFrozen(s)&&Object.isFrozen(s.plannedPrescription)&&s.variableTarget&&s.completion==='explicit'));
    assert.equal(new Set(work.map(s=>T.occurrenceIdFor({...s,section:'main',blockIndex:0}))).size,3);
    assert.ok(work.every(s=>!s.plannedLoad||Object.isFrozen(s.plannedLoad)&&Object.keys(s.plannedLoad).join()==='relativeLoad'));
    assert.deepEqual(b,before);
    assert.deepEqual(G.validateMain({blocks:[b]},C,kit,trace.seconds).filter(s=>s!=='main:duration-out-of-tolerance'),[]);
    assert.ok(G.validateMain({blocks:[b]},C,kit,trace.seconds-1).includes('main:duration-over-budget'));
  }
  for(const [reps,cues] of [[[4,6,8,6,4],null],[[8,6,4,6,8],['lighter','medium','heavier','medium','lighter']]]){
    const b=block(cues?'intensity':'reps');b.prescription.steps=reps.map((reps,i)=>({reps,...(cues?{relativeLoad:cues[i]}:{})}));
    assert.deepEqual(G.validatePyramidBlock(b,C),[]);
  }
  const boundary=block('reps','band-row');boundary.prescription.steps=[6,8,12,8,6].map(reps=>({reps}));
  boundary.exercises[0].estimatedSeconds=54;assert.deepEqual(G.validatePyramidBlock(boundary),[],'40 reps and exactly 180 work seconds');
  boundary.exercises[0].estimatedSeconds=55;assert.ok(G.validatePyramidBlock(boundary).includes('unsafe-work-duration'));
});

test('invalid shapes, unsafe volume/rest, numbers, per-side work and anchors fail closed',()=>{
  const invalid=[];
  for(const steps of [[],[{reps:4}],new Array(3),[4,6,8].map(reps=>({reps})),[8,6,4].map(reps=>({reps})),
    [4,4,8].map(reps=>({reps})),[4,6,8,4].map(reps=>({reps})),[10,11,12,11,10].map(reps=>({reps})),
    [{reps:4},{reps:Infinity},{reps:4}],[{reps:4},{reps:8,suggestedLoad:20},{reps:4}],
    [{reps:4,relativeLoad:'lighter'},{reps:6,relativeLoad:'medium'},{reps:8,relativeLoad:'heavier'}],
    [{reps:4},{reps:8,relativeLoad:'medium'},{reps:4}]])invalid.push({...block(),prescription:{steps,stepRestSeconds:90}});
  for(const id of ['reverse-lunge','plank','burpees','pull-up','barbell-deadlift','kettlebell-swing','goblet-squat'])invalid.push(block('reps',id));
  for(const seconds of [-1,0,59,121,NaN])invalid.push({...block(),prescription:{...block().prescription,stepRestSeconds:seconds}});
  const rushed=block('reverse');rushed.prescription.stepRestSeconds=89;invalid.push(rushed);
  const anchor=block();anchor.exercises[0].coachAnchor={requirementId:'required'};invalid.push(anchor);
  const duplicate=block();duplicate.exercises.push(copy(duplicate.exercises[0]));invalid.push(duplicate);
  const slow=block();slow.exercises[0].estimatedSeconds=1000;invalid.push(slow);
  const override=block();override.occurrenceTargets=Array(3).fill(null);invalid.push(override);
  invalid.push(block('reverse','dumbbell-biceps-curl'),block('intensity','band-row'));
  for(const b of invalid){
    assert.ok(G.validatePyramidBlock(b).length,JSON.stringify(b));assert.deepEqual(G.resolveBlockSteps(b),[]);assert.equal(G.estimateBlockDuration(b),0);
    const w=savedWorkoutV2(C);w.main.blocks=[b];assert.throws(()=>G.normaliseWorkout(w),/pyramid/);
  }
  const forged=block('reverse');forged.exercises[0].id='barbell-deadlift';assert.ok(G.validatePyramidBlock(forged,C).length);
  assert.throws(()=>G.resolveOccurrenceTarget(C['trx-row'],{plannedPrescription:{type:'reps',value:4},plannedLoad:{relativeLoad:'heavier',suggestedLoad:20}}));
  assert.throws(()=>G.resolveOccurrenceTarget(C['dumbbell-biceps-curl'],{plannedPrescription:{type:'reps',value:4},plannedLoad:{relativeLoad:'heavier'}}));
});

test('a single suitable weight needs no changing-load assumption; swaps retain the entire safe plan',()=>{
  for(const kind of ['reps','reverse']){
    const w=savedWorkoutV2(C);w.main.blocks=[block(kind)];w.main.blocks[0].estimatedDurationSeconds=1;
    const original=w.main.blocks[0];G.normaliseWorkout(w);original.prescription.steps[0].reps=99;
    const prescription=copy(w.main.blocks[0].prescription);
    assert.equal(w.main.blocks[0].estimatedDurationSeconds,G.estimateBlockDuration(w.main.blocks[0]));
    for(let seed=1;seed<=12;seed++){
      G.swap(w,0,0,{catalogue:C,equipment:kit,random:random(seed)});
      assert.deepEqual(w.main.blocks[0].prescription,prescription);assert.deepEqual(G.validatePyramidBlock(w.main.blocks[0],C),[]);
      assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[30].main);
      if(kind==='reps')assert.ok(G.resolveBlockSteps(w.main.blocks[0]).every(s=>!s.plannedLoad));
      else assert.equal(w.main.blocks[0].exercises[0].equipment.flat().join(),'trx');
    }
    const snapshot=copy(w.main.blocks),only=Object.fromEntries(w.main.blocks[0].exercises.map(ex=>[ex.id,C[ex.id]]));
    G.swap(w,0,0,{catalogue:only,equipment:kit,random:()=>0});assert.deepEqual(w.main.blocks,snapshot);
  }
});

test('shared preview, voice, next hints and player follow changing reps and planned resistance through pause/Previous/skip',async()=>{
  for(const kind of ['reps','intensity','reverse']){
    const b=block(kind),h=harness(b);h.app.startStandaloneGeneratedWorkout();const tracker=h.run('generatorState.tracker');await tracker.flush();
    const main=h.main();h.app.enterGeneratedPhase(main[0].index);
    assert.match(h.el('workoutMovementProgress').textContent,/Pyramid|pyramid/);assert.match(h.el('workoutMovementProgress').textContent,/Step 1 of 3/);
    assert.equal(h.el('workoutTarget').textContent,b.prescription.steps[0].reps+' reps');
    assert.match(h.spoken.at(-1),new RegExp(b.prescription.steps[0].reps+' reps'));
    const preview=h.app.GarageFitWorkoutPreview;
    assert.match(preview.protocolLabel(b),/60 sec rest|90 sec rest/);
    assert.match(preview.occurrenceTargetLabel(b,0),new RegExp(b.prescription.steps.map(s=>s.reps+' reps').join('.*')));
    if(kind!=='reps'){
      assert.match(h.el('workoutSideNote').textContent,/Planned .* resistance/);
      assert.match(h.spoken.at(-1),/Planned .* resistance/);
      assert.match(preview.occurrenceTargetLabel(b,0),/Planned .* resistance/);
    }
    h.app.generatedPrimaryAction();await tracker.flush();assert.equal(h.phase().kind,'pyramid-rest');
    assert.equal(h.run('generatorState.remaining'),b.prescription.stepRestSeconds);
    assert.match(h.el('completeMovementNext').textContent,new RegExp(b.prescription.steps[1].reps+' reps'));
    h.app.toggleWorkoutPause();assert.equal(h.el('completeMovementBtn').disabled,true);h.time(30000);h.app.toggleWorkoutPause();
    assert.equal(h.run('generatorState.remaining'),b.prescription.stepRestSeconds);
    h.app.generatedPrimaryAction();assert.equal(h.el('workoutTarget').textContent,b.prescription.steps[1].reps+' reps');
    h.app.previousGeneratedPhase();assert.equal(h.phase().occurrenceId,main[0].phase.occurrenceId);
    h.app.generatedPrimaryAction();await tracker.flush();assert.equal(tracker.performedWork().length,1);
    h.app.generatedPrimaryAction();h.app.generatedSkipWork();await tracker.flush();assert.equal(tracker.outcome(main[1].phase.occurrenceId).status,'skipped');
    const planned=tracker.plannedWork().filter(p=>p.section==='main');
    assert.deepEqual(copy(planned.map(p=>p.prescription.reps)),b.prescription.steps.map(s=>s.reps));
    assert.ok(planned.every(p=>p.requirementId===null&&p.prescription.pyramidStep>=1));
    assert.ok(tracker.performedWork().every(p=>p.sets===undefined));
  }
});

test('unknown actual loads stay unknown; partial/redo and duplicate session history never multiply credit',async()=>{
  const h=harness(block('reverse'));h.app.startStandaloneGeneratedWorkout();const tracker=h.run('generatorState.tracker');await tracker.flush();
  const main=h.main(),ids=main.map(({phase})=>phase.occurrenceId);
  await tracker.recordDone(ids[0]);await tracker.recordDone(ids[0]);
  await tracker.recordPartial(ids[1],{sets:[{reps:3}]});await tracker.recordSkip(ids[2]);
  h.app.enterGeneratedPhase(h.run('generatorState.timeline.length-1'));h.run('generatorState.remaining=0');h.app.generatedPrimaryAction();await h.run('generatorState.trackedResult');
  const results=await h.run('GarageFitCoachStore.createStore(localStorage).listSessionResults({source:"generator"})');
  assert.equal(results.results.length,1);const result=copy(results.results[0]);
  assert.equal(GarageFitCoachModel.validate('session-result',result).valid,true);
  const history=H.createHistory([result,result],C),performances=history.performances.filter(p=>p.protocol==='pyramid');
  assert.equal(performances.length,2);assert.equal(performances[0].sets.length,0);
  assert.equal(performances[1].sets[0].reps.value,3);assert.equal(performances[1].sets[0].load.confidence,'unknown');
  assert.equal(performances[1].sets[0].load.value,null);
  assert.equal(H.comparePerformanceEvidence(performances[1],performances[1]).comparable,false);
  const legacy={...performances[1],variableTarget:false};assert.equal(H.comparePerformances(legacy,legacy).comparable,false);
  const confirmed={...legacy,sets:legacy.sets.map(set=>({...set,load:{value:16,confidence:'confirmed'}}))};
  assert.equal(H.comparePerformanceEvidence(confirmed,confirmed).comparable,false,'confirmed loads cannot turn a pyramid into anchor progression');
  const round={...legacy,protocol:'rounds'};assert.equal(H.comparePerformances(round,legacy).comparable,false);
});

test('Coach optional pyramids save early exit truthfully and never advance required anchors',async()=>{
  const p=pilot();p.run("state.ownedEquipment=['dumbbells','trx']");
  await p.run("coachUI.controller.start(pilotDef,['dumbbells','trx'])");await p.run('coachUI.open()');
  p.run(`function pyramidButton(id,text){const visit=node=>node.textContent===text&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById(id)).onclick();}`);
  await p.run("pyramidButton('coachContent','View today’s workout')");
  p.run(`coachUI.controller.snapshot().preview.workout.main.blocks.push(JSON.parse(${JSON.stringify(JSON.stringify(block('reverse')))}));`);
  await p.run("pyramidButton('coachPreviewContent','Start workout')");
  p.run("enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.protocol==='pyramid'&&phase.kind==='exercise'))");
  assert.equal(p.run("document.getElementById('coachAnchorLog').classList.contains('hidden')"),true);
  await p.run('completeWorkoutMovement()');await p.run('completeWorkoutMovement()');await p.run('generatedSkipWork()');
  p.run("openExitDialog('workout')");await p.run('confirmExitChoice()');await p.run("coachUI.saveFeedback('about-right')");
  const result=p.json('coachUI.controller.snapshot().results[0]');assert.equal(result.finalStatus,'partial');
  assert.equal(result.performedWork.length,1);assert.equal(result.performedWork[0].sets,undefined);
  assert.ok(result.anchorResults.every(a=>a.status==='skipped'));
  assert.ok(p.json('coachUI.controller.snapshot().state.anchors').every(a=>a.currentTarget.target.maxReps===6&&a.comparisonBaseline===null));
});

test('Coach hard pyramid constraints reserve optional work safely; anchors cannot use any pyramid variant',()=>{
  const rx=fixtures.prescription({requiredAnchors:[],equipment:['dumbbells'],duration:10,
    protocolConstraints:[{requirementId:'pyramid-only',importance:'hard',allowedProtocols:['pyramid']}],mainTimeLimitSeconds:168});
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:rx}).status,'feasible');
  const w=G.generate({catalogue:C,sessionPrescription:rx,random:random(7)});
  assert.ok(w.main.blocks.every(b=>b.protocol==='pyramid'));assert.ok(w.main.estimatedDurationSeconds<=168);
  assert.ok(w.main.blocks.every(b=>G.pyramidKind(b.prescription.steps)==='reps'),'one load never implies changing weights');
  const short={...rx,mainTimeLimitSeconds:1};assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:short}).status,'infeasible');
  assert.throws(()=>G.generate({catalogue:C,sessionPrescription:short}),G.SessionPrescriptionError);
  for(const id of ['push-up','trx-row','dumbbell-biceps-curl']){
    const impossible={...rx,requiredAnchors:[fixtures.anchor({exerciseId:id,allowedProtocols:['pyramid']})]};
    assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:impossible}).status,'infeasible');
  }
  const avoided={...rx,avoidConstraints:Object.values(C).filter(ex=>G.protocolCompatible(ex,'pyramid')).map((ex,i)=>({requirementId:'avoid-'+i,importance:'hard',exerciseId:ex.id}))};
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:avoided}).status,'infeasible');
  const phases=G.resolveBlockSteps(block()).filter(s=>s.kind==='exercise').map(step=>({...step,kind:'exercise',section:'main',protocol:'pyramid',exercise:{...C['dumbbell-biceps-curl'],coachAnchor:{requirementId:'bad'}},occurrenceId:'p'+step.pyramidStep,variableTarget:false}));
  assert.ok(T.plannedWorkFromTimeline(phases,{requirementIdFor:()=> 'bad'}).every(p=>p.requirementId===null&&!p.prescription.plannedTarget));
});

test('bounded automatic seeds reach real pyramids at 10–45 minutes, plus intensity/reverse variants, deterministically',()=>{
  // Optional complexes shift the draw stream; these bounded seeds still reach each variant.
  const cases=[[10,59],[15,59],[20,161],[30,23],[45,15]].map(([duration,seed])=>({duration,seed,equipment:kit}));
  cases.push({duration:10,seed:74,focus:'balanced',equipment:kit},
    {duration:30,seed:54,bodyFocus:'upper',equipment:['trx']},{duration:45,seed:38,bodyFocus:'upper',equipment:['trx']});
  const kinds=new Set();
  for(const {seed,...context} of cases){
    const options={catalogue:C,focus:'strength',...context},w=G.generate({...options,random:random(seed)});
    const pyramids=w.main.blocks.filter(b=>b.protocol==='pyramid');assert.equal(pyramids.length,1,JSON.stringify(context));
    const b=pyramids[0];kinds.add(G.pyramidKind(b.prescription.steps));
    assert.deepEqual(G.validatePyramidBlock(b,C),[]);
    assert.deepEqual(G.validateMain(w.main,C,context.equipment,G.BUDGETS[context.duration].main),[]);
    assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[context.duration].main);
    assert.ok(new Set(w.main.blocks.flatMap(b=>b.exercises.map(e=>e.id))).size>=3);
    assert.deepEqual(w.main,G.generate({...options,random:random(seed)}).main);
  }
  assert.deepEqual([...kinds].sort(),['intensity','reps','reverse']);
  const eligible=Object.values(C).filter(ex=>G.protocolCompatible(ex,'pyramid'));
  const weight=(focus,seconds,blocks=[])=>G.protocolWeights(focus,'strength',seconds,eligible,{blocks}).find(p=>p.value==='pyramid').weight;
  assert.ok(weight('strength',300)>0);assert.equal(weight('cardio',300),0);
  assert.equal(weight('strength',149),0);assert.equal(weight('strength',721),0);
  assert.equal(weight('strength',300,[block()]),0);
});
