// Workout Patterns 8 (#83): continuous exercise complexes.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
const {blockFixtures,savedWorkoutV2,traceBlock}=require('./helpers/protocol-fixtures');
const fixtures=require('./helpers/coach-fixtures');
const {pilot}=require('./helpers/coach-pilot');
global.window=global;
for(const file of ['data/equipment','data/exercises','js/generator','js/coach-model','js/coach-store','js/session-tracker','js/training-history','js/workout-preview'])require('../'+file);
const G=GarageFitGenerator,T=GarageFitSessionTracker,H=GarageFitTrainingHistory,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value));
const kit=GarageFitData.equipment.map(e=>e.id);
const random=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
const defaultTarget=exercise=>({type:exercise.prescription.type,value:Math.min(exercise.prescription.value,exercise.prescription.type==='timed'?30:8)});
// Hammer curl → shoulder press → wood chop (timed), one standing dumbbell setup.
const fixture=()=>blockFixtures(C,{complex:true}).complex;
function block(ids,prescription={}){
  return {id:'main-1',protocol:'complex',intent:'accessory',exercises:ids.map(id=>copy(C[id])),
    prescription:{sequences:2,targets:ids.map(id=>defaultTarget(C[id])),changeoverSeconds:10,sequenceRestSeconds:75,...prescription}};
}
function harness(b=fixture()){
  let now=0;
  const app=loadAppContext(new Map(),{ownIntrinsics:true,configure(context){context.performance={now:()=>now}}});
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id);
  app.complexNow=()=>Date.parse('2026-10-18T08:00:00Z')+now;run('Date.now=complexNow');
  const workout=savedWorkoutV2(C);workout.main.blocks=[b];
  run(`generatorState.workout=JSON.parse(${JSON.stringify(JSON.stringify(workout))})`);
  const spoken=[];app.announceExercise=(exercise,parts)=>spoken.push([].concat(parts).join(' '));
  return {app,run,el,spoken,phase:()=>run('currentGeneratedPhase()'),
    main:()=>run("generatorState.timeline.map((phase,index)=>({phase,index})).filter(({phase})=>phase.kind==='exercise'&&phase.section==='main')")};
}

test('each movement resolves as its own explicit occurrence; changeovers stay inside a sequence and recovery follows it',()=>{
  const b=fixture(),before=copy(b),trace=traceBlock(G,b),work=trace.steps.filter(s=>s.kind==='exercise');
  assert.deepEqual(G.validateComplexBlock(b,C),[]);assert.deepEqual(trace.problems,[]);
  assert.equal(G.blockRepeatCount(b),3);assert.equal(work.length,9);
  assert.deepEqual(work.map(s=>s.complexSequence+':'+s.exerciseIndex),['1:0','1:1','1:2','2:0','2:1','2:2','3:0','3:1','3:2']);
  assert.deepEqual(trace.steps.filter(s=>s.kind!=='exercise').map(s=>s.kind+':'+s.seconds),
    ['complex-change:10','complex-change:10','complex-rest:75','complex-change:10','complex-change:10','complex-rest:75','complex-change:10','complex-change:10']);
  assert.ok(work.every(s=>Object.isFrozen(s)&&Object.isFrozen(s.plannedPrescription)&&s.variableTarget));
  assert.deepEqual(work.map(s=>s.plannedPrescription.value),[8,8,30,8,8,30,8,8,30]);
  // Rep movements need confirmation; the timed movement keeps its measured timer.
  assert.ok(work.filter(s=>s.exerciseIndex<2).every(s=>!s.timed&&s.completion==='explicit'&&s.estimatedSeconds===24));
  assert.ok(work.filter(s=>s.exerciseIndex===2).every(s=>s.timed&&s.seconds===30&&s.estimatedSeconds===30&&!s.completion));
  assert.equal(trace.seconds,3*(24+24+30)+6*10+2*75);assert.equal(G.estimateBlockDuration(b),trace.seconds);
  const ids=work.map(s=>T.occurrenceIdFor({...s,section:'main',blockIndex:0}));
  assert.equal(new Set(ids).size,9);assert.ok(ids.every(id=>/^main:b0:q[1-3]:e[0-2]$/.test(id)));
  assert.deepEqual(b,before,'resolution never mutates the block');
  const conditions=G.protocolConditions(b);conditions.targets[0].value=1;
  assert.deepEqual(Object.keys(G.protocolConditions(b)).sort(),['changeoverSeconds','sequenceRestSeconds','targets']);
  assert.equal(b.prescription.targets[0].value,8,'conditions are a deep copy');
  assert.deepEqual(G.validateMain({blocks:[b]},C,kit,trace.seconds).filter(s=>s!=='main:duration-out-of-tolerance'),[]);
  assert.ok(G.validateMain({blocks:[b]},C,kit,trace.seconds-1).includes('main:duration-over-budget'));
  const continuous={...b,prescription:{...b.prescription,changeoverSeconds:0}};
  assert.equal(G.resolveBlockSteps(continuous).filter(s=>s.kind==='complex-change').length,0);
  const w=savedWorkoutV2(C);w.main.blocks=[{...b,estimatedDurationSeconds:1}];G.normaliseWorkout(w);
  assert.equal(w.main.blocks[0].estimatedDurationSeconds,trace.seconds,'saved estimates are recomputed');
  b.prescription.targets[0].value=3;assert.equal(w.main.blocks[0].prescription.targets[0].value,8,'normalisation owns its targets');
});

test('setup, position, load, pattern, fatigue and technique continuity fail closed',()=>{
  const cases=[
    [['dumbbell-shoulder-press','trx-row'],'setup-change'],
    [['push-up','air-squat'],'position-change'],
    [['dumbbell-floor-fly','dumbbell-plank-pull-through'],'load-change'],
    [['dumbbell-shoulder-press','dumbbell-overhead-triceps-extension'],'shared-pattern'],
    [['kettlebell-swing','kettlebell-figure-eight'],'fatigue'],
    [['dumbbell-bent-over-row','dumbbell-shoulder-press','dumbbell-wood-chop'],'technical'],
    [['banded-lateral-walk','banded-squat','band-romanian-deadlift'],'local-fatigue']];
  for(const [ids,issue] of cases){
    const b=block(ids);assert.ok(G.validateComplexBlock(b,C).includes(issue),ids.join('+'));
    assert.deepEqual(G.resolveBlockSteps(b),[]);assert.equal(G.estimateBlockDuration(b),0);
  }
  for(const ids of [['dumbbell-hammer-curl','dumbbell-shoulder-press'],['kettlebell-deadlift','kettlebell-goblet-squat'],['push-up','glute-bridge','plank'],['trx-row','trx-squat']])
    assert.deepEqual(G.validateComplexBlock(block(ids),C),[],ids.join('+'));
});

test('ineligible movements, unsafe targets, volume, rest and structure fail closed and cannot be normalised',()=>{
  const invalid=[];
  // Per-side, hanging, barbell, Heavy, high-impact and hard-technique work stays out.
  for(const id of ['single-arm-dumbbell-row','hanging-knee-raise','barbell-bent-over-row','goblet-squat','burpees','dumbbell-renegade-row']){
    assert.equal(G.protocolCompatible(C[id],'complex'),false,id);invalid.push(block([id,'dumbbell-wood-chop']));
  }
  for(const target of [{type:'reps',value:9},{type:'reps',value:2},{type:'reps',value:7.5},{type:'timed',value:8},{type:'reps',value:8,load:5}])
    invalid.push(block(['dumbbell-hammer-curl','dumbbell-shoulder-press'],{targets:[target,{type:'reps',value:8}]}));
  for(const value of [10,31])invalid.push(block(['dumbbell-hammer-curl','dumbbell-wood-chop'],{targets:[{type:'reps',value:8},{type:'timed',value}]}));
  for(const change of [{sequences:1},{sequences:5},{sequences:2.5},{changeoverSeconds:-1},{changeoverSeconds:16},{sequenceRestSeconds:59},{sequenceRestSeconds:121},{sequenceRestSeconds:NaN},{rounds:2},{targets:[{type:'reps',value:8}]}])
    invalid.push({...fixture(),prescription:{...fixture().prescription,...change}});
  const volume=fixture();volume.prescription.sequences=4;invalid.push(volume);
  const slow=fixture();slow.exercises[0].estimatedSeconds=120;invalid.push(slow);
  const override=fixture();override.occurrenceTargets=Array(9).fill(null);invalid.push(override);
  const anchor=fixture();anchor.exercises[0].coachAnchor={requirementId:'required'};invalid.push(anchor);
  const duplicate=fixture();duplicate.exercises[1]=copy(duplicate.exercises[0]);invalid.push(duplicate);
  invalid.push({...fixture(),exercises:[copy(C['dumbbell-hammer-curl'])],prescription:{...fixture().prescription,targets:[{type:'reps',value:8}]}});
  const four=block(['dumbbell-hammer-curl','dumbbell-shoulder-press','dumbbell-wood-chop']);four.exercises.push(copy(C['dumbbell-lateral-raise']));four.prescription.targets.push({type:'reps',value:8});invalid.push(four);
  for(const b of invalid){
    assert.ok(G.validateComplexBlock(b).length,JSON.stringify(b.prescription)+' '+b.exercises.map(e=>e.id));
    assert.deepEqual(G.resolveBlockSteps(b),[]);assert.equal(G.estimateBlockDuration(b),0);
    const w=savedWorkoutV2(C);w.main.blocks=[b];assert.throws(()=>G.normaliseWorkout(w),/complex/);
  }
  assert.ok(G.validateComplexBlock(fixture()).length===0&&G.validateComplexBlock(volume).includes('unsafe-volume'));
  // A copied exercise cannot borrow metadata to pass as a different catalogue entry.
  const forged=fixture();forged.exercises[0].id='barbell-bent-over-row';assert.ok(G.validateComplexBlock(forged,C).length);
});

test('swaps keep the whole complex coherent, take the replacement default target and keep its structure',()=>{
  const w=savedWorkoutV2(C);w.duration=30;w.main.blocks=[fixture()];G.normaliseWorkout(w);
  const {sequences,changeoverSeconds,sequenceRestSeconds}=w.main.blocks[0].prescription;
  for(let seed=1;seed<=12;seed++)for(const index of [0,1,2]){
    G.swap(w,0,index,{catalogue:C,equipment:kit,random:random(seed)});
    const b=w.main.blocks[0];
    assert.deepEqual(G.validateComplexBlock(b,C),[]);
    assert.deepEqual([b.prescription.sequences,b.prescription.changeoverSeconds,b.prescription.sequenceRestSeconds],[sequences,changeoverSeconds,sequenceRestSeconds]);
    assert.deepEqual(b.prescription.targets[index],defaultTarget(C[b.exercises[index].id]));
    assert.equal(b.estimatedDurationSeconds,G.estimateBlockDuration(b));
    assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[30].main);
  }
  const snapshot=copy(w.main.blocks),only=Object.fromEntries(w.main.blocks[0].exercises.map(ex=>[ex.id,C[ex.id]]));
  G.swap(w,0,1,{catalogue:only,equipment:kit,random:()=>0});assert.deepEqual(w.main.blocks,snapshot,'no safe alternative keeps the plan');
});

test('shared preview, voice and player label every movement, changeover and recovery through Done, timed work, Previous and Skip',async()=>{
  const b=fixture(),h=harness(b);h.app.startStandaloneGeneratedWorkout();const tracker=h.run('generatorState.tracker');await tracker.flush();
  const preview=h.app.GarageFitWorkoutPreview;
  assert.equal(preview.protocolLabel(b),'Complex · 3 sequences · 3 movements in order on one setup · 10 sec changeover · 75 sec rest between sequences');
  assert.deepEqual([0,1,2].map(i=>preview.occurrenceTargetLabel(b,i)),['8 reps · Medium','8 reps · Medium','30 sec · Medium']);
  const main=h.main();assert.equal(main.length,9);h.app.enterGeneratedPhase(main[0].index);
  assert.equal(h.el('workoutMovementProgress').textContent,'Block 1 of 1 · Complex · Sequence 1 of 3 · Movement 1 of 3');
  assert.equal(h.el('workoutTarget').textContent,'8 reps');assert.match(h.spoken.at(-1),/^Complex movement 1 of 3\. Dumbbell hammer curl\. 8 reps/);
  assert.equal(h.el('coachSkipBtn').classList.contains('hidden'),false);assert.equal(h.el('completeMovementNext').textContent,'Change over');
  h.app.generatedPrimaryAction();await tracker.flush();
  assert.equal(h.phase().kind,'complex-change');assert.equal(h.run('generatorState.remaining'),10);
  assert.match(h.el('workoutMovementProgress').textContent,/Sequence 1 of 3 · Change over$/);
  assert.equal(h.el('completeMovementAction').textContent,'Next');assert.equal(h.el('completeMovementNext').textContent,'Dumbbell shoulder press');
  h.app.generatedPrimaryAction();h.app.generatedPrimaryAction();h.app.generatedPrimaryAction();
  // The timed movement: measured, not credited beyond what elapsed.
  assert.equal(h.phase().occurrenceId,main[2].phase.occurrenceId);assert.equal(h.phase().timed,true);
  assert.equal(h.el('completeMovementAction').textContent,'Next');assert.equal(h.el('coachSkipBtn').classList.contains('hidden'),true);
  assert.equal(h.el('completeMovementNext').textContent,'Rest');
  h.run('generatorState.remaining=18');h.app.generatedPrimaryAction();await tracker.flush();
  assert.equal(tracker.outcome(main[2].phase.occurrenceId).status,'partial');
  assert.equal(h.phase().kind,'complex-rest');assert.equal(h.el('workoutExercise').textContent,'Sequence 1 complete');
  assert.match(h.el('workoutMovementProgress').textContent,/Sequence 1 of 3 complete$/);assert.equal(h.run('generatorState.remaining'),75);
  // Previous redoes the same occurrence and replaces its outcome.
  h.app.previousGeneratedPhase();assert.equal(h.phase().occurrenceId,main[2].phase.occurrenceId);
  h.run('generatorState.remaining=0');h.app.generatedPrimaryAction();await tracker.flush();
  assert.equal(tracker.outcome(main[2].phase.occurrenceId).status,'completed');
  h.app.generatedPrimaryAction();assert.equal(h.phase().occurrenceId,main[3].phase.occurrenceId);
  assert.match(h.el('workoutMovementProgress').textContent,/Sequence 2 of 3 · Movement 1 of 3$/);
  h.app.generatedSkipWork();await tracker.flush();assert.equal(tracker.outcome(main[3].phase.occurrenceId).status,'skipped');
  const planned=tracker.plannedWork().filter(p=>p.section==='main');
  assert.equal(planned.length,9);assert.equal(new Set(planned.map(p=>p.occurrenceId)).size,9);
  assert.ok(planned.every(p=>p.requirementId===null&&p.prescription.protocol==='complex'&&p.prescription.variableTarget&&p.prescription.complexSequence>=1));
  assert.deepEqual(copy(planned.slice(0,3).map(p=>[p.prescription.reps,p.prescription.seconds])),[[8,null],[8,null],[null,30]]);
  const performed=tracker.performedWork().filter(p=>p.occurrenceId.startsWith('main:'));
  assert.deepEqual(copy(performed.map(p=>p.occurrenceId)),[0,1,2].map(i=>main[i].phase.occurrenceId),'skipped work earns nothing');
  // Done invents no reps or load; timed work records only the measured seconds.
  assert.equal(performed.find(p=>p.occurrenceId===main[0].phase.occurrenceId).sets,undefined);
  assert.deepEqual(copy(performed.find(p=>p.occurrenceId===main[2].phase.occurrenceId).sets),[{seconds:30}]);
});

test('a completed standalone complex validates; duplicate results add no credit and history stays incomparable',async()=>{
  const h=harness();h.app.startStandaloneGeneratedWorkout();const tracker=h.run('generatorState.tracker');await tracker.flush();
  const ids=h.main().map(({phase})=>phase.occurrenceId);
  await tracker.recordDone(ids[0]);await tracker.recordDone(ids[0]);await tracker.recordTimed(ids[2],{plannedSeconds:30,elapsedSeconds:99});await tracker.recordSkip(ids[1]);
  h.app.enterGeneratedPhase(h.run('generatorState.timeline.length-1'));h.run('generatorState.remaining=0');h.app.generatedPrimaryAction();await h.run('generatorState.trackedResult');
  const results=await h.run('GarageFitCoachStore.createStore(localStorage).listSessionResults({source:"generator"})');
  assert.equal(results.results.length,1);const result=copy(results.results[0]);
  assert.equal(GarageFitCoachModel.validate('session-result',result).valid,true);
  assert.deepEqual(result.performedWork.find(w=>w.occurrenceId===ids[2]).sets,[{seconds:30}],'timed credit never exceeds the plan');
  assert.equal(result.performedWork.find(w=>w.occurrenceId===ids[0]).sets,undefined);
  assert.deepEqual(G.recentProtocolsFromResults([result]).includes('complex'),true);
  const history=H.createHistory([result,result],C),performances=history.performances.filter(p=>p.protocol==='complex');
  assert.equal(performances.length,2,'a duplicate result adds no credit');
  for(const p of performances)assert.equal(H.comparePerformanceEvidence(p,p).comparable,false);
  const legacy={...performances[0],variableTarget:false};assert.equal(H.comparePerformances(legacy,legacy).comparable,false);
  assert.equal(H.comparePerformances({...legacy,protocol:'rounds'},legacy).comparable,false);
});

test('Coach optional complexes save early exit truthfully and never advance required anchors',async()=>{
  const p=pilot();p.run("state.ownedEquipment=['dumbbells']");
  await p.run("coachUI.controller.start(pilotDef,['dumbbells'])");await p.run('coachUI.open()');
  p.run(`function complexButton(id,text){const visit=node=>node.textContent===text&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById(id)).onclick();}`);
  await p.run("complexButton('coachContent','View today’s workout')");
  p.run(`coachUI.controller.snapshot().preview.workout.main.blocks.push(JSON.parse(${JSON.stringify(JSON.stringify(fixture()))}));`);
  await p.run("complexButton('coachPreviewContent','Start workout')");
  // Enter the appended fixture even if the unseeded preview already chose a complex.
  p.run("enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.protocol==='complex'&&phase.kind==='exercise'&&phase.blockIndex===generatorState.workout.main.blocks.length-1))");
  assert.equal(p.run("document.getElementById('coachAnchorLog').classList.contains('hidden')"),true);
  assert.equal(p.run("document.getElementById('coachSkipBtn').classList.contains('hidden')"),false);
  await p.run('completeWorkoutMovement()');assert.equal(p.run('currentGeneratedPhase().kind'),'complex-change');
  await p.run('completeWorkoutMovement()');await p.run('generatedSkipWork()');
  p.run("openExitDialog('workout')");await p.run('confirmExitChoice()');await p.run("coachUI.saveFeedback('about-right')");
  const result=p.json('coachUI.controller.snapshot().results[0]');assert.equal(result.finalStatus,'partial');
  const complexWork=result.performedWork.filter(w=>result.plannedWork.find(item=>item.occurrenceId===w.occurrenceId).prescription.protocol==='complex');
  assert.equal(complexWork.length,1);assert.equal(complexWork[0].status,'completed');assert.equal(complexWork[0].sets,undefined);
  assert.ok(result.anchorResults.every(a=>a.status==='skipped'));
  assert.ok(p.json('coachUI.controller.snapshot().state.anchors').every(a=>a.comparisonBaseline===null));
});

test('Coach hard complex constraints reserve optional work safely; anchors can never become complexes',()=>{
  const rx=fixtures.prescription({requiredAnchors:[],movementPriorities:[],equipment:['dumbbells'],duration:20,
    protocolConstraints:[{requirementId:'complex-only',importance:'hard',allowedProtocols:['complex']}],mainTimeLimitSeconds:420});
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:rx}).status,'feasible');
  for(let seed=1;seed<=4;seed++){
    const w=G.generate({catalogue:C,sessionPrescription:rx,random:random(seed)});
    assert.ok(w.main.blocks.length>=1&&w.main.blocks.every(b=>b.protocol==='complex'&&!G.validateComplexBlock(b,C).length));
    assert.ok(w.main.estimatedDurationSeconds<=420);
  }
  const short={...rx,mainTimeLimitSeconds:60};assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:short}).status,'infeasible');
  assert.throws(()=>G.generate({catalogue:C,sessionPrescription:short}),G.SessionPrescriptionError);
  for(const id of ['dumbbell-shoulder-press','push-up']){
    const impossible={...rx,equipment:kit,requiredAnchors:[fixtures.anchor({exerciseId:id,allowedProtocols:['complex']})]};
    assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:impossible}).status,'infeasible',id);
  }
  const avoided={...rx,avoidConstraints:Object.values(C).filter(ex=>G.protocolCompatible(ex,'complex')).map((ex,i)=>({requirementId:'avoid-'+i,importance:'hard',exerciseId:ex.id}))};
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:avoided}).status,'infeasible');
  const phases=G.resolveBlockSteps(fixture()).filter(s=>s.kind==='exercise').map(step=>({...step,section:'main',protocol:'complex',
    exercise:{...C[fixture().exercises[step.exerciseIndex].id],coachAnchor:{requirementId:'bad'}},occurrenceId:'q'+step.complexSequence+':'+step.exerciseIndex}));
  assert.ok(T.plannedWorkFromTimeline(phases,{requirementIdFor:()=> 'bad'}).every(p=>p.requirementId===null&&!p.prescription.plannedTarget));
});

test('bounded automatic seeds reach complexes after an established block at 15–45 minutes, deterministically',()=>{
  // Catalogue growth and AMRAP selection (#221) change full-kit draws; seed 106 retains the 15-minute complex case.
  const cases=[[15,'balanced',kit,106],[20,'strength',[],10],[20,'cardio',['dumbbells'],9],[30,'balanced',['kettlebell','trx','bands'],7],[45,'cardio',[],5],[45,'balanced',kit,24]];
  const setups=new Set();
  for(const [duration,focus,equipment,seed] of cases){
    const options={catalogue:C,duration,focus,equipment},w=G.generate({...options,random:random(seed)});
    const index=w.main.blocks.findIndex(b=>b.protocol==='complex');assert.ok(index>0,JSON.stringify([duration,focus,equipment]));
    const b=w.main.blocks[index];setups.add(JSON.stringify(b.exercises[0].equipment));
    assert.deepEqual(G.validateComplexBlock(b,C),[]);assert.equal(w.main.blocks.filter(x=>x.protocol==='complex').length,1);
    assert.deepEqual(G.validateMain(w.main,C,equipment,G.BUDGETS[duration].main).filter(s=>s!=='main:duration-out-of-tolerance'),[]);
    assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[duration].main);
    const all=w.main.blocks.flatMap(x=>x.exercises.map(e=>e.id));assert.equal(new Set(all).size,all.length,'no Main exercise reuse');
    assert.deepEqual(w.main,G.generate({...options,random:random(seed)}).main);
  }
  assert.ok(setups.size>=2,'more than one kind of setup');
  const eligible=Object.values(C).filter(ex=>ex.generator&&ex.main);
  const weight=(seconds,blocks=[{protocol:'rounds'}],focus='balanced')=>G.protocolWeights(focus,'accessory',seconds,eligible,{blocks}).find(p=>p.value==='complex').weight;
  assert.ok(weight(300)>0);assert.ok(weight(300,undefined,'cardio')>0);
  assert.equal(weight(300,[]),0,'never the opening block');assert.equal(weight(239),0);assert.equal(weight(721),0);
  assert.equal(weight(300,[{protocol:'complex'}]),0,'at most one per Main');
  assert.equal(G.protocolWeights('balanced','accessory',300,eligible.filter(ex=>ex.id==='push-up'||ex.id==='trx-row'),{blocks:[{protocol:'rounds'}]}).find(p=>p.value==='complex').weight,0,'no compatible pair, no complex');
});
