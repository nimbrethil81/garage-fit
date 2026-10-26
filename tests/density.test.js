const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
const {blockFixtures,savedWorkoutV2,traceBlock}=require('./helpers/protocol-fixtures');
const fixtures=require('./helpers/coach-fixtures');
global.window=global;
for(const file of ['data/equipment','data/exercises','js/generator','js/coach-model','js/coach-store','js/session-tracker','js/training-history','js/workout-preview'])require('../'+file);
const G=GarageFitGenerator,T=GarageFitSessionTracker,H=GarageFitTrainingHistory,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value)),kit=GarageFitData.equipment.map(e=>e.id);
const random=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
const fixture=()=>blockFixtures(C,{density:true}).density;
function harness(){
  let now=0,wall=Date.parse('2026-10-18T08:00:00Z'),nextTimer=0;
  const timers=new Map(),events=new Map(),storage=new Map();
  const listen=(name,callback)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(callback)};
  const app=loadAppContext(storage,{ownIntrinsics:true,configure(context){
    context.performance={now:()=>now};context.wallNow=()=>wall;
    context.setInterval=callback=>{timers.set(++nextTimer,callback);return nextTimer};context.clearInterval=id=>timers.delete(id);
    context.addEventListener=listen;context.document.addEventListener=listen;context.document.visibilityState='visible';
  }});
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id),workout=savedWorkoutV2(C);workout.main.blocks=[fixture()];
  run('Date.now=wallNow');run(`generatorState.workout=JSON.parse(${JSON.stringify(JSON.stringify(workout))})`);
  const tracker=()=>run('generatorState.tracker'),phase=()=>run('currentGeneratedPhase()');
  const flush=async()=>{await tracker()?.flush();await Promise.resolve()};
  const time=ms=>{now+=ms;wall+=ms};
  return {app,run,el,storage,timers,tracker,phase,time,flush,wallJump:ms=>wall+=ms,
    phases:()=>run("generatorState.timeline.filter(p=>p.protocol==='density'&&p.kind==='exercise')"),
    async start(coach=false){
      if(coach){
        await run(`var densityStore=GarageFitCoachStore.createStore(localStorage);var densityTracker=GarageFitSessionTracker.createTracker({store:densityStore,source:'coach',draftId:'density-coach',programmeInstanceId:'prog-1',prescriptionId:'rx-1',workoutId:'density-test',plannedWork:GarageFitSessionTracker.plannedWorkFromTimeline(buildGeneratedTimeline(generatorState.workout)),meaningful:(o,p)=>p.section==='main'});densityTracker.start()`);
        run('coachUI.isActive=()=>true');app.startGeneratedWorkout({tracker:run('densityTracker')});
      }else app.startStandaloneGeneratedWorkout();
      await flush();app.enterGeneratedPhase(run("generatorState.timeline.findIndex(p=>p.protocol==='density')"));await flush();
    },
    async pulse(ms){const callback=timers.get(run('generatorState.phaseTimer'));time(ms);if(callback)await callback();await flush()},
    async event(name){for(const callback of events.get(name)||[])await callback();await flush()}
  };
}

test('density resolves unique fixed targets, while duration reserves the full safe cap',()=>{
  const b=fixture(),before=copy(b),trace=traceBlock(G,b),work=trace.steps.filter(s=>s.kind==='exercise');
  assert.deepEqual(G.validateDensityBlock(b,C),[]);assert.deepEqual(trace.problems,[]);
  assert.equal(G.estimateBlockDuration(b),300);assert.equal(trace.seconds,300);assert.equal(G.blockRepeatCount(b),3);
  assert.equal(work.length,6);assert.ok(work.every(s=>Object.isFrozen(s)&&Object.isFrozen(s.plannedPrescription)&&s.completion==='explicit'&&!s.timed&&s.variableTarget));
  const ids=work.map(s=>T.occurrenceIdFor({...s,section:'main',blockIndex:0}));
  assert.equal(new Set(ids).size,6);assert.deepEqual(ids,['main:b0:d1:e0','main:b0:d1:e1','main:b0:d2:e0','main:b0:d2:e1','main:b0:d3:e0','main:b0:d3:e1']);
  assert.deepEqual(trace.steps.filter(s=>s.kind!=='exercise').map(s=>s.seconds),[15,45,15,45,15]);
  const conditions=G.protocolConditions(b);conditions.targets[0].value=1;assert.deepEqual(b,before);
  const w=savedWorkoutV2(C);w.main.blocks=[{...b,estimatedDurationSeconds:1}];G.normaliseWorkout(w);assert.equal(w.main.estimatedDurationSeconds,300);
  assert.ok(G.validateMain(w.main,C,kit,299).includes('main:duration-over-budget'));
  assert.match(GarageFitWorkoutPreview.protocolLabel(b),/3 fixed rounds · 300 sec cap/);
  assert.equal(GarageFitWorkoutPreview.occurrenceTargetLabel(b,0),'8 reps');
});

test('unsafe or contradictory density blocks fail closed, including sides, load, overrides and forged metadata',()=>{
  const invalid=[];
  for(const change of [{repeats:1},{repeats:4},{repeats:2.5},{timeCapSeconds:179},{timeCapSeconds:421},{timeCapSeconds:NaN},{exerciseRestSeconds:14},{roundRestSeconds:44},{roundRestSeconds:61},{rounds:3},{targets:[{type:'reps',value:8}]},{targets:[{type:'reps',value:9},{type:'reps',value:8}]},{targets:[{type:'timed',value:8},{type:'reps',value:8}]}])
    invalid.push({...fixture(),prescription:{...fixture().prescription,...change}});
  invalid.push({...fixture(),prescription:{...fixture().prescription,timeCapSeconds:180}});
  for(const id of ['side-plank','reverse-lunge','burpees','goblet-squat','dumbbell-shoulder-press','barbell-bent-over-row','plank','kettlebell-swing']){
    assert.equal(G.protocolCompatible(C[id],'density'),false,id);const b=fixture();b.exercises[0]=copy(C[id]);invalid.push(b);
  }
  for(const mutate of [b=>b.occurrenceTargets=Array(6).fill(null),b=>b.exercises[0].coachAnchor={requirementId:'bad'},b=>b.exercises[1]=copy(b.exercises[0]),b=>b.exercises.pop()]){const b=fixture();mutate(b);invalid.push(b)}
  for(const b of invalid){assert.ok(G.validateDensityBlock(b).length);assert.deepEqual(G.resolveBlockSteps(b),[]);assert.equal(G.estimateBlockDuration(b),0);assert.throws(()=>G.normaliseWorkout({main:{blocks:[b]}}),/density/)}
  const forged=fixture();forged.exercises[0].id='burpees';assert.ok(G.validateDensityBlock(forged,C).length);
  const slow=fixture();slow.exercises[0].estimatedSeconds=100;assert.ok(G.validateDensityBlock(slow,C).length);
});

test('early target completion stops the block, preserves unknown actual load and records each occurrence once',async()=>{
  const h=harness();await h.start();const phases=h.phases();
  assert.equal(h.el('workoutRingNum').textContent,'300');assert.equal(h.el('workoutTarget').textContent,'8 reps');
  assert.equal(h.el('workoutTarget').classList.contains('hidden'),false);assert.match(h.el('workoutDensityStatus').textContent,/48 reps remaining/);
  assert.equal(h.el('previousWorkoutBtn').disabled,true);
  for(let n=0;n<6;n++){
    h.time(5000);await h.app.generatedPrimaryAction();
    if(n<5){assert.equal(h.phase().kind,'density-rest');assert.equal(h.el('completeMovementBtn').disabled,true);await h.app.generatedPrimaryAction();await h.pulse(n%2===0?15000:45000)}
  }
  assert.equal(h.run('densityRun().ended'),'target-complete');assert.match(h.el('workoutDensityStatus').textContent,/0 reps remaining · 6 of 6/);
  assert.equal(h.el('completeMovementAction').textContent,'Continue');assert.equal(h.el('workoutRingWrap').classList.contains('hidden'),true);
  assert.equal(h.tracker().performedWork().length,6);assert.ok(h.tracker().performedWork().every(p=>!p.sets));
  assert.match(h.tracker().outcome(phases[5].occurrenceId).note,/completed before/);
  await h.app.generatedPrimaryAction();assert.equal(h.phase().protocol,'density','repeat tap cannot also Continue');
  h.time(400);await h.app.generatedPrimaryAction();assert.equal(h.phase().kind,'transition');
  h.app.previousGeneratedPhase();assert.notEqual(h.phase().protocol,'density','completed density cannot be replayed');
  assert.equal(h.tracker().performedWork().length,6);
});

test('time cap refuses late Done, offers optional partial reps and never awards unseen targets',async()=>{
  const h=harness();await h.start();const phases=h.phases();h.time(5000);await h.app.generatedPrimaryAction();await h.pulse(15000);
  h.time(280001);await h.app.generatedPrimaryAction();
  assert.equal(h.run('densityRun().ended'),'time-cap');assert.equal(h.tracker().outcome(phases[0].occurrenceId).status,'completed');
  assert.equal(h.tracker().outcome(phases[1].occurrenceId).status,'skipped');assert.match(h.tracker().outcome(phases[1].occurrenceId).note,/time cap/);
  assert.equal(h.tracker().outcome(phases[2].occurrenceId),null);assert.equal(h.tracker().performedWork().length,1);
  assert.equal(h.el('densityPartial').classList.contains('hidden'),false);h.el('densityPartialReps').value='3';await h.app.saveDensityPartial({preventDefault(){}});
  const partial=h.tracker().outcome(phases[1].occurrenceId);assert.equal(partial.status,'partial');assert.deepEqual(copy(partial.sets),[{reps:3}]);
  assert.equal(partial.sets[0].load,undefined);assert.match(h.el('workoutDensityStatus').textContent,/37 reps remaining/);
  await h.app.generatedPrimaryAction();assert.equal(h.phase().protocol,'density','repeat tap cannot also Continue');
  h.time(400);await h.app.generatedPrimaryAction();assert.equal(h.phase().kind,'transition');
  h.app.enterGeneratedPhase(h.run('generatorState.timeline.length-1'));h.run('generatorState.remaining=0');await h.app.generatedPrimaryAction();await h.run('generatorState.trackedResult');
  const result=copy(h.tracker().result);assert.equal(GarageFitCoachModel.validate('session-result',result).valid,true);
  const history=H.createHistory([result,result],C),density=history.performances.filter(p=>p.protocol==='density');assert.equal(density.length,2);
  assert.ok(density.every(p=>!H.comparePerformanceEvidence(p,p).comparable));
  assert.equal(H.comparePerformances({...density[0],variableTarget:false},{...density[0],variableTarget:false}).comparable,false);
  assert.equal(H.comparePerformances({...density[0],protocol:'rounds'},density[0]).comparable,false);
});

test('pause, wall clock drift, delayed callbacks and repeated Previous preserve the original cap and evidence',async()=>{
  const h=harness();await h.start();const first=h.phase().occurrenceId;const deadline=h.run('densityRun().deadlineMs');
  h.time(5000);await h.app.generatedPrimaryAction();await h.app.previousGeneratedPhase();
  assert.equal(h.phase().occurrenceId,first);await h.app.generatedPrimaryAction();await h.app.previousGeneratedPhase();await h.app.generatedPrimaryAction();
  assert.equal(h.tracker().performedWork().length,1);assert.equal(h.run('densityRun().deadlineMs'),deadline);
  h.app.toggleWorkoutPause();h.time(900000);h.wallJump(-1200000);await h.pulse(0);
  assert.equal(h.run('densityRemaining()'),295);h.app.toggleWorkoutPause();
  await h.pulse(15000);assert.equal(h.phase().exerciseIndex,1);assert.equal(h.run('densityRemaining()'),280);
  h.wallJump(7200000);await h.pulse(600000);
  assert.equal(h.run('densityRun().ended'),'time-cap');assert.equal(h.tracker().performedWork().length,1);
  assert.equal(h.tracker().outcome(h.phases()[2].occurrenceId),null);assert.equal(h.run('densityRun().deadlineMs'),deadline);
});

test('skips do not turn a visited final target into fixed-work completion; expiry during rest credits nothing',async()=>{
  const h=harness();await h.start();await h.app.generatedSkipWork();await h.pulse(300000);
  assert.equal(h.run('densityRun().ended'),'time-cap');assert.equal(h.tracker().performedWork().length,0);assert.equal(h.el('densityPartial').classList.contains('hidden'),true);
  assert.match(h.tracker().outcome(h.phases()[1].occurrenceId).note,/time cap/);
  const x=harness();await x.start();for(let n=0;n<6;n++){await x.app.generatedSkipWork();if(n<5)await x.pulse(n%2===0?15000:45000)}
  assert.equal(x.run('densityRun().ended'),'work-ended');assert.match(x.el('workoutDensityStatus').textContent,/48 reps remaining/);assert.equal(x.tracker().performedWork().length,0);
});

test('Coach density early exit/reload recovers only durable outcomes without anchor credit',async()=>{
  const h=harness();await h.start(true);const phases=h.phases();h.time(5000);await h.app.generatedPrimaryAction();await h.pulse(15000);
  h.app.openExitDialog('workout');await h.app.confirmExitChoice();
  const result=await h.tracker().exitEarly({actualDurationSeconds:20});assert.equal(result.finalStatus,'partial');assert.equal(result.performedWork.length,1);assert.deepEqual(copy(result.anchorResults),[]);
  assert.ok(h.tracker().plannedWork().filter(p=>p.section==='main').every(p=>p.requirementId===null&&p.prescription.densityRound));
  assert.equal(h.tracker().outcome(phases[1].occurrenceId).status,'skipped');
});

test('pagehide pauses density and returning requires Resume without extending its active-time cap',async()=>{
  const h=harness();await h.start(true);h.time(10000);const deadline=h.run('densityRun().deadlineMs');await h.event('pagehide');
  assert.equal(h.run('workoutState.paused'),true);h.time(900000);await h.event('pageshow');assert.equal(h.run('workoutState.paused'),true);
  h.app.toggleWorkoutPause();await h.pulse(290000);assert.equal(h.run('densityRun().ended'),'time-cap');assert.equal(h.run('densityRun().deadlineMs'),deadline);assert.equal(h.tracker().performedWork().length,0);
});

test('a failed durable save retains the original explicit action for retry; reload trusts only the saved draft',async()=>{
  const h=harness();await h.start(true);const id=h.phase().occurrenceId;
  h.run('var densityOriginalSave=localStorage.setItem;localStorage.setItem=()=>{throw new Error("quota")}');
  h.time(5000);await h.app.generatedPrimaryAction();assert.equal(h.run('densityRun().retry'),true);assert.equal(h.el('completeMovementAction').textContent,'Retry save');
  const draft=await h.run('densityStore.loadSessionDraft()');assert.equal(draft.occurrenceOutcomes.length,0,'optimistic memory never becomes recovery evidence');
  const recovered=await h.run('GarageFitSessionTracker.resumeTracker({store:densityStore,meaningful:(o,p)=>p.section==="main"})');assert.equal(recovered.performedWork().length,0);
  h.run('localStorage.setItem=densityOriginalSave');h.time(300000);await h.app.generatedPrimaryAction();
  assert.equal(h.run('densityRun().ended'),'time-cap');assert.equal(h.tracker().performedWork().length,1);assert.equal(h.tracker().outcome(id).status,'completed');
  assert.equal((await h.run('densityStore.loadSessionDraft()')).occurrenceOutcomes.filter(o=>o.status==='completed').length,1);
});

test('a pending action cannot advance a different workout after navigation',async()=>{
  const h=harness();await h.start();
  h.run('var densityRecord=generatorState.tracker.recordOutcome;var densityRelease;generatorState.tracker.recordOutcome=(...args)=>new Promise(resolve=>{densityRelease=()=>resolve(densityRecord(...args))})');
  const pending=h.app.generatedPrimaryAction();h.app.goGenerator();h.app.startStandaloneGeneratedWorkout();const index=h.run('generatorState.timelineIndex');
  h.run('densityRelease()');await pending;assert.equal(h.run('generatorState.timelineIndex'),index);assert.equal(h.phase().kind,'ready');
});

test('all targets confirmed before the cap remain early completion when the final save is retried after it',async()=>{
  const h=harness();await h.start(true);
  for(let n=0;n<5;n++){await h.app.generatedPrimaryAction();await h.pulse(n%2===0?15000:45000)}
  h.run('var densityLastSave=localStorage.setItem;localStorage.setItem=()=>{throw new Error("quota")}');
  await h.app.generatedPrimaryAction();assert.equal(h.run('densityRun().retry'),true);
  h.time(600000);h.run('localStorage.setItem=densityLastSave');await h.app.generatedPrimaryAction();
  assert.equal(h.run('densityRun().ended'),'target-complete');assert.equal(h.tracker().performedWork().length,6);
});

test('density hard constraints are optional-only, bounded and fail with inadequate time or pools',()=>{
  const rx=fixtures.prescription({requiredAnchors:[],movementPriorities:[],equipment:[],duration:20,workoutStyle:'balanced',protocolConstraints:[{requirementId:'density-only',importance:'hard',allowedProtocols:['density']}],mainTimeLimitSeconds:360});
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:rx}).status,'feasible');
  for(let seed=1;seed<=4;seed++){const w=G.generate({catalogue:C,sessionPrescription:rx,random:random(seed)});assert.ok(w.main.blocks.every(b=>b.protocol==='density'&&!G.validateDensityBlock(b,C).length));assert.ok(w.main.estimatedDurationSeconds<=360)}
  for(const change of [{mainTimeLimitSeconds:60},{requiredAnchors:[fixtures.anchor({exerciseId:'push-up',allowedProtocols:['density']})]},{avoidConstraints:Object.values(C).filter(ex=>G.protocolCompatible(ex,'density')).map((ex,i)=>({requirementId:'avoid-'+i,importance:'hard',exerciseId:ex.id}))}]){
    assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:{...rx,...change}}).status,'infeasible');assert.throws(()=>G.generate({catalogue:C,sessionPrescription:{...rx,...change}}),G.SessionPrescriptionError);
  }
});

test('Coach reserves rounds anchors first and automatically reaches optional density within the remaining budget',()=>{
  const rx=fixtures.prescription({duration:20,workoutStyle:'balanced',equipment:kit,
    requiredAnchors:[fixtures.anchor({exerciseId:'goblet-squat',allowedProtocols:['rounds']})],
    protocolConstraints:[{requirementId:'safe-formats',importance:'hard',allowedProtocols:['rounds','density']}]});
  let hits=0;
  for(let seed=1;seed<=16;seed++){
    const w=G.generate({catalogue:C,sessionPrescription:rx,random:random(seed)});
    for(const p of w.prescriptionOutcome.requiredAnchorPlacements)assert.equal(w.main.blocks[p.blockIndex].protocol,'rounds');
    assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[20].main);
    hits+=w.main.blocks.filter(b=>b.protocol==='density').length;
  }
  assert.ok(hits>0,'optional density is automatically chosen after reserved anchors');
});

test('automatic density is modest supporting work with deterministic targets, safe fallbacks and full budget fit',()=>{
  const eligible=Object.values(C).filter(ex=>ex.generator&&ex.main),state={blocks:[{protocol:'rounds'}]};
  const weight=(focus='balanced',intent='accessory',seconds=300,pool=eligible,s=state)=>G.protocolWeights(focus,intent,seconds,pool,s).find(p=>p.value==='density').weight;
  assert.ok(weight()>0);assert.equal(weight('balanced','accessory',300,eligible,{...state,duration:10}),0);assert.equal(weight('strength'),0);assert.equal(weight('balanced','strength'),0);assert.equal(weight('balanced','accessory',300,eligible,{...state,difficulty:'easy'}),0);
  assert.equal(weight('balanced','accessory',179),0);assert.equal(weight('balanced','accessory',421),0);assert.equal(weight('balanced','accessory',300,eligible,{blocks:[]}),0);
  assert.equal(weight('balanced','accessory',300,[C['push-up'],C['trx-row']]),0);
  let hits=0;
  for(const duration of [10,15,20,30,45])for(const focus of ['balanced','cardio'])for(const seed of [1,7,11,24,29,51,72,93]){
    const options={catalogue:C,duration,focus,equipment:kit},w=G.generate({...options,random:random(seed)});
    if(w.main.blocks.some(b=>b.protocol==='density'))assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[duration].main);assert.deepEqual(G.validateMain(w.main,C,kit,G.BUDGETS[duration].main).filter(s=>s!=='main:duration-out-of-tolerance'),[]);
    for(const [index,b] of w.main.blocks.entries())if(b.protocol==='density'){
      hits++;assert.ok(index>0);assert.deepEqual(G.validateDensityBlock(b,C),[]);assert.equal(w.main.blocks.filter(b=>b.protocol==='density').length,1);
      assert.ok(b.exercises.every(ex=>!ex.coachAnchor));assert.deepEqual(w.main,G.generate({...options,random:random(seed)}).main);
    }
  }
  assert.ok(hits>0,'bounded seeds reach density');
});

test('swaps retain density targets, cap and setup, while unsuitable pools keep established formats',()=>{
  const w=savedWorkoutV2(C);w.main.blocks=[fixture()];w.main.blocks[0].prescription.timeCapSeconds=360;w.main.blocks[0].exercises=[copy(C['band-row']),copy(C['banded-squat'])];G.normaliseWorkout(w);
  const prescription=copy(w.main.blocks[0].prescription),original=w.main.blocks[0].exercises.map(e=>e.id).join();let changed=false;
  for(let seed=1;seed<=8;seed++){
    G.swap(w,0,0,{catalogue:C,equipment:kit,random:random(seed)});const b=w.main.blocks[0];
    assert.deepEqual(b.prescription,prescription);assert.deepEqual(G.validateDensityBlock(b,C),[]);assert.equal(b.estimatedDurationSeconds,prescription.timeCapSeconds);changed ||= b.exercises.map(e=>e.id).join()!==original;
  }
  assert.ok(changed);
  const limited=Object.fromEntries(Object.entries(C).filter(([id,ex])=>!G.protocolCompatible(ex,'density')||id==='push-up'));
  for(let seed=1;seed<=4;seed++){
    const w=G.generate({catalogue:limited,duration:20,focus:'cardio',equipment:kit,random:random(seed)});
    assert.ok(w.main.blocks.every(b=>b.protocol!=='density'));assert.deepEqual(G.validateMain(w.main,limited,kit,G.BUDGETS[20].main),[]);
  }
});
