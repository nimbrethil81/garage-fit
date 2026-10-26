// Generated AMRAP blocks (#221): one prescribed sequence repeated on one block clock until a
// whole-minute cap. Fixed Cindy keeps its own AMRAP player (tests/amrap-workouts.test.js).
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
const fixture=()=>blockFixtures(C,{amrap:true}).amrap;

function harness({blocks}={}){
  let now=0,wall=Date.parse('2026-10-22T08:00:00Z'),nextTimer=0;
  const timers=new Map(),events=new Map(),storage=new Map(),spoken=[];
  const listen=(name,callback)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(callback)};
  const app=loadAppContext(storage,{ownIntrinsics:true,configure(context){
    context.performance={now:()=>now};context.wallNow=()=>wall;
    context.speechSynthesis={cancel(){},speak(u){spoken.push(u.text)}};
    context.setInterval=callback=>{timers.set(++nextTimer,callback);return nextTimer};context.clearInterval=id=>timers.delete(id);
    context.addEventListener=listen;context.document.addEventListener=listen;context.document.visibilityState='visible';
  }});
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id),workout=savedWorkoutV2(C);
  workout.main.blocks=blocks||[fixture()];
  run('Date.now=wallNow');run(`generatorState.workout=JSON.parse(${JSON.stringify(JSON.stringify(workout))})`);
  const tracker=()=>run('generatorState.tracker'),phase=()=>run('currentGeneratedPhase()');
  const flush=async()=>{await tracker()?.flush();await Promise.resolve()};
  const time=ms=>{now+=ms;wall+=ms};
  return {app,run,el,storage,timers,spoken,tracker,phase,time,flush,
    phases:()=>run("generatorState.timeline.filter(p=>p.protocol==='amrap'&&p.kind==='exercise')"),
    async start(coach=false){
      if(coach){
        await run(`var amrapStore=GarageFitCoachStore.createStore(localStorage);var amrapTracker=GarageFitSessionTracker.createTracker({store:amrapStore,source:'coach',draftId:'amrap-coach',programmeInstanceId:'prog-1',prescriptionId:'rx-1',workoutId:'amrap-test',plannedWork:GarageFitSessionTracker.plannedWorkFromTimeline(buildGeneratedTimeline(generatorState.workout)),meaningful:(o,p)=>p.section==='main'});amrapTracker.start()`);
        run('coachUI.isActive=()=>true');app.startGeneratedWorkout({tracker:run('amrapTracker')});
      }else app.startStandaloneGeneratedWorkout();
      await flush();app.enterGeneratedPhase(run("generatorState.timeline.findIndex(p=>p.protocol==='amrap')"));await flush();
    },
    // One 250 ms callback of the current phase timer, after `ms` of active time.
    async pulse(ms){const callback=timers.get(run('generatorState.phaseTimer'));time(ms);if(callback)await callback();await flush()},
    // Wait out the shared 350 ms double-tap guard, then act.
    async next(){time(400);await app.generatedPrimaryAction();await flush()},
    async skip(){time(400);await app.generatedSkipWork();await flush()},
    async event(name){for(const callback of events.get(name)||[])await callback();await flush()}
  };
}

test('AMRAP resolves one planned pass whose duration is exactly its cap',()=>{
  const b=fixture(),before=copy(b),trace=traceBlock(G,b),work=trace.steps.filter(s=>s.kind==='exercise');
  assert.deepEqual(G.validateAmrapBlock(b,C),[]);assert.deepEqual(trace.problems,[]);
  assert.equal(G.estimateBlockDuration(b),300);assert.equal(trace.seconds,300);assert.equal(G.blockRepeatCount(b),1);
  assert.equal(trace.steps.length,3,'no rest steps: recover as needed');
  assert.ok(work.every(s=>Object.isFrozen(s)&&Object.isFrozen(s.plannedPrescription)&&s.completion==='explicit'&&!s.timed&&s.variableTarget&&s.amrapSequence===1));
  assert.deepEqual(work.map(s=>T.occurrenceIdFor({...s,section:'main',blockIndex:0})),['main:b0:a1:e0','main:b0:a1:e1','main:b0:a1:e2']);
  assert.deepEqual(copy(G.protocolConditions(b)),{targets:b.prescription.targets});
  const conditions=G.protocolConditions(b);conditions.targets[0].value=1;assert.deepEqual(b,before);
  const w=savedWorkoutV2(C);w.main.blocks=[{...b,estimatedDurationSeconds:1}];G.normaliseWorkout(w);assert.equal(w.main.estimatedDurationSeconds,300);
  assert.deepEqual(G.validateMain(w.main,C,kit,300),[]);assert.ok(G.validateMain(w.main,C,kit,299).includes('main:duration-over-budget'));
  assert.equal(GarageFitWorkoutPreview.protocolLabel(b),'AMRAP · 5 min cap · 3 exercises in order, repeated · Steady, comfortable pace; recover as needed');
  assert.equal(GarageFitWorkoutPreview.occurrenceTargetLabel(b,0),'8 reps');
  assert.equal(G.equipmentUsageSeconds([b]).get('trx'),300,'quality scoring sees the whole cap');
});

test('unsafe, contradictory or forged AMRAP blocks fail closed',()=>{
  const invalid=[],base=fixture();
  for(const change of [{capSeconds:120},{capSeconds:540},{capSeconds:270},{capSeconds:300.5},{capSeconds:'300'},{rounds:3},{timeCapSeconds:300},
    {targets:base.prescription.targets.slice(0,2)},{targets:[{type:'reps',value:9},...base.prescription.targets.slice(1)]},
    {targets:[{type:'reps',value:3},...base.prescription.targets.slice(1)]},{targets:[{type:'timed',value:8},...base.prescription.targets.slice(1)]},
    {targets:[{type:'reps',value:8,load:'Heavy'},...base.prescription.targets.slice(1)]}])
    invalid.push({...fixture(),prescription:{...fixture().prescription,...change}});
  for(const id of ['side-plank','reverse-lunge','burpees','goblet-squat','barbell-bent-over-row','plank','kettlebell-swing','pull-up']){
    assert.equal(G.protocolCompatible(C[id],'amrap'),false,id);const b=fixture();b.exercises[0]=copy(C[id]);invalid.push(b);
  }
  // Continuity: a setup or position change, or a repeated pattern, is not a simple repeatable sequence.
  for(const id of ['air-squat','band-row','banded-squat']){const b=fixture();b.exercises[0]=copy(C[id]);invalid.push(b)}
  for(const mutate of [b=>b.occurrenceTargets=Array(3).fill(null),b=>b.exercises[0].coachAnchor={requirementId:'bad'},b=>b.exercises[1]=copy(b.exercises[0]),
    b=>{b.exercises=b.exercises.slice(0,1);b.prescription.targets=b.prescription.targets.slice(0,1)},
    b=>{b.exercises.push(copy(C['trx-knee-tuck']));b.prescription.targets.push({type:'reps',value:8})}]){const b=fixture();mutate(b);invalid.push(b)}
  for(const b of invalid){
    assert.ok(G.validateAmrapBlock(b).length,JSON.stringify(b.prescription));assert.deepEqual(G.resolveBlockSteps(b),[]);assert.equal(G.estimateBlockDuration(b),0);
    assert.throws(()=>G.normaliseWorkout({main:{blocks:[b]}}),/AMRAP|occurrence/);
  }
  const forged=fixture();forged.exercises[0].id='burpees';assert.ok(G.validateAmrapBlock(forged,C).length);
  const slow=fixture();slow.exercises.forEach(ex=>ex.estimatedSeconds=40);assert.ok(G.validateAmrapBlock(slow).includes('unsafe-round-work'));
  assert.ok(G.validateMain({blocks:[forged]},C,kit).some(issue=>issue.startsWith('main-9:')));
});

test('automatic AMRAP is modest Balanced/Cardio conditioning, once per Main, with deterministic valid fallbacks',()=>{
  const eligible=Object.values(C).filter(ex=>ex.generator&&ex.main),state={blocks:[{protocol:'rounds'}]};
  const weight=(focus='balanced',intent='conditioning',seconds=300,pool=eligible,s=state)=>G.protocolWeights(focus,intent,seconds,pool,s).find(p=>p.value==='amrap').weight;
  // Base weight 1, plus the existing +1 protocol-variety tie-breaker after a different block.
  assert.equal(weight(),2);assert.equal(weight('cardio','finisher'),2);assert.equal(weight('balanced','conditioning',300,eligible,{blocks:[]}),1);
  assert.equal(weight('balanced','conditioning',300,eligible,{...state,recentProtocols:['amrap']}),1.5);
  assert.equal(weight('strength'),0);assert.equal(weight('balanced','strength'),0);assert.equal(weight('balanced','accessory'),0);
  assert.equal(weight('balanced','conditioning',179),0);assert.equal(weight('balanced','conditioning',481),0);
  assert.equal(weight('balanced','conditioning',300,eligible,{blocks:[{protocol:'amrap'}]}),0);
  assert.equal(weight('balanced','conditioning',300,[C['push-up'],C['trx-row'],C['air-squat']].filter(Boolean).slice(0,1)),0);
  const hits={balanced:0,cardio:0,strength:0};
  // Bounded seeds/kit cover both eligible styles; Strength never selects AMRAP.
  for(const duration of [15,20,30])for(const focus of ['balanced','cardio','strength'])for(let seed=1;seed<=24;seed++){
    const options={catalogue:C,duration,focus,equipment:kit},w=G.generate({...options,random:random(seed*7+duration)});
    const amraps=w.main.blocks.filter(b=>b.protocol==='amrap');hits[focus]+=amraps.length;
    assert.ok(amraps.length<=1,'at most one AMRAP per Main');
    if(!amraps.length)continue;
    assert.deepEqual(G.validateMain(w.main,C,kit,G.BUDGETS[duration].main).filter(s=>s!=='main:duration-out-of-tolerance'),[]);
    assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[duration].main);
    for(const b of amraps){
      assert.deepEqual(G.validateAmrapBlock(b,C),[]);assert.ok(['conditioning','finisher'].includes(b.intent));
      assert.ok(b.exercises.length>=2&&b.exercises.length<=3);assert.ok(b.prescription.capSeconds>=180&&b.prescription.capSeconds<=480);
      assert.equal(b.estimatedDurationSeconds,b.prescription.capSeconds);assert.ok(b.exercises.every(ex=>!ex.coachAnchor));
    }
    assert.deepEqual(w.main,G.generate({...options,random:random(seed*7+duration)}).main);
  }
  assert.ok(hits.balanced>0&&hits.cardio>0,JSON.stringify(hits));assert.equal(hits.strength,0);
  // Without a compatible pair the established formats remain.
  const limited=Object.fromEntries(Object.entries(C).filter(([id,ex])=>!G.protocolCompatible(ex,'amrap')||id==='push-up'));
  for(let seed=1;seed<=4;seed++){
    const w=G.generate({catalogue:limited,duration:20,focus:'cardio',equipment:kit,random:random(seed)});
    assert.ok(w.main.blocks.every(b=>b.protocol!=='amrap'));assert.deepEqual(G.validateMain(w.main,limited,kit,G.BUDGETS[20].main),[]);
  }
});

test('Coach reserves rounds anchors first and reaches AMRAP only as optional conditioning',()=>{
  const rx=fixtures.prescription({duration:20,workoutStyle:'balanced',equipment:kit,
    requiredAnchors:[fixtures.anchor({exerciseId:'goblet-squat',allowedProtocols:['rounds']})],
    protocolConstraints:[{requirementId:'safe-formats',importance:'hard',allowedProtocols:['rounds','amrap']}]});
  let hits=0;
  for(let seed=1;seed<=16;seed++){
    const w=G.generate({catalogue:C,sessionPrescription:rx,random:random(seed)});
    for(const p of w.prescriptionOutcome.requiredAnchorPlacements)assert.equal(w.main.blocks[p.blockIndex].protocol,'rounds');
    assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[20].main);
    for(const b of w.main.blocks.filter(b=>b.protocol==='amrap')){hits++;assert.ok(b.exercises.every(ex=>!ex.coachAnchor));assert.equal(b.intent,'conditioning')}
  }
  assert.ok(hits>0,'optional AMRAP is automatically chosen after reserved anchors');
  // Anchors can never become AMRAP work; Strength and AMRAP-excluding prescriptions never get it.
  const anchorOnly={...rx,protocolConstraints:[],requiredAnchors:[fixtures.anchor({exerciseId:'push-up',targetSets:1,target:{type:'reps',minReps:8,maxReps:10},allowedProtocols:['amrap']})]};
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:anchorOnly}).status,'infeasible');
  assert.throws(()=>G.generate({catalogue:C,sessionPrescription:anchorOnly,random:random(1)}),G.SessionPrescriptionError);
  for(const change of [{workoutStyle:'strength'},{protocolConstraints:[{requirementId:'no-amrap',importance:'hard',allowedProtocols:['rounds','paired_sets','timed_intervals','emom']}]}])
    for(let seed=1;seed<=8;seed++)assert.ok(G.generate({catalogue:C,sessionPrescription:{...rx,...change},random:random(seed)}).main.blocks.every(b=>b.protocol!=='amrap'));
});

test('hard AMRAP-only optional prescriptions are bounded and fail with inadequate time, pools or style',()=>{
  const rx=fixtures.prescription({requiredAnchors:[],movementPriorities:[],equipment:[],duration:20,workoutStyle:'cardio',
    protocolConstraints:[{requirementId:'amrap-only',importance:'hard',allowedProtocols:['amrap']}],mainTimeLimitSeconds:360});
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:rx}).status,'feasible');
  for(let seed=1;seed<=4;seed++){const w=G.generate({catalogue:C,sessionPrescription:rx,random:random(seed)});
    assert.ok(w.main.blocks.length===1&&w.main.blocks.every(b=>b.protocol==='amrap'&&!G.validateAmrapBlock(b,C).length));assert.ok(w.main.estimatedDurationSeconds<=360)}
  const avoidAll=Object.values(C).filter(ex=>G.protocolCompatible(ex,'amrap')).map((ex,i)=>({requirementId:'avoid-'+i,importance:'hard',exerciseId:ex.id}));
  for(const change of [{mainTimeLimitSeconds:120},{workoutStyle:'strength'},{avoidConstraints:avoidAll}]){
    assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:{...rx,...change}}).status,'infeasible',JSON.stringify(change).slice(0,40));
    assert.throws(()=>G.generate({catalogue:C,sessionPrescription:{...rx,...change},random:random(1)}),G.SessionPrescriptionError);
  }
});

test('swaps keep the cap and a valid sequence; each replacement takes its own default target',()=>{
  const w=savedWorkoutV2(C);w.main.blocks=[{...fixture(),exercises:[copy(C['band-row']),copy(C['banded-squat'])],prescription:{capSeconds:240,targets:[{type:'reps',value:6},{type:'reps',value:8}]}}];G.normaliseWorkout(w);
  let changed=false;
  for(let seed=1;seed<=8;seed++){
    G.swap(w,0,0,{catalogue:C,equipment:kit,random:random(seed)});const b=w.main.blocks[0];
    assert.equal(b.prescription.capSeconds,240);assert.deepEqual(G.validateAmrapBlock(b,C),[]);assert.equal(b.estimatedDurationSeconds,240);
    assert.equal(b.exercises[1].id,'banded-squat');assert.deepEqual(b.prescription.targets[1],{type:'reps',value:8});
    if(b.exercises[0].id!=='band-row'){changed=true;assert.deepEqual(b.prescription.targets[0],{type:'reps',value:Math.min(8,C[b.exercises[0].id].prescription.value)})}
  }
  assert.ok(changed);
  // Without a replacement that keeps one setup and distinct patterns, the plan stays intact.
  const t=savedWorkoutV2(C);t.main.blocks=[fixture()];G.normaliseWorkout(t);const before=copy(t.main.blocks[0]);
  G.swap(t,0,1,{catalogue:C,equipment:kit,random:random(1)});assert.deepEqual(copy(t.main.blocks[0]),before);
});

test('one continuous countdown repeats the sequence by Next, crediting each movement once',async()=>{
  const h=harness();await h.start();const ids=copy(h.phases().map(p=>p.occurrenceId));
  assert.deepEqual(ids,['main:b0:a1:e0','main:b0:a1:e1','main:b0:a1:e2']);
  assert.equal(h.el('workoutRingNum').textContent,'300');assert.equal(h.el('workoutRingPhase').textContent,'AMRAP');
  assert.equal(h.el('workoutRingWrap').classList.contains('hidden'),false);assert.equal(h.el('workoutTarget').textContent,'8 reps');
  assert.equal(h.el('workoutTarget').classList.contains('hidden'),false);assert.match(h.el('workoutMovementProgress').textContent,/^Round 1$/);
  assert.equal(h.el('workoutAmrapStatus').classList.contains('hidden'),false);assert.equal(h.el('completeMovementAction').textContent,'Next');
  assert.equal(h.el('completeMovementNext').textContent,'TRX row');assert.match(h.spoken.join(' '),/AMRAP\. Round 1\..*steady, comfortable pace/);
  const deadline=h.run('amrapBlockRun().deadlineMs');
  for(let n=0;n<2;n++)await h.next();
  assert.equal(h.el('completeMovementNext').textContent,'TRX squat','the last movement previews the next round');
  await h.next();
  assert.equal(h.phase().occurrenceId,ids[0]);assert.match(h.el('workoutMovementProgress').textContent,/^Round 2$/);
  assert.equal(h.tracker().performedWork().length,3);const writes=h.tracker().writeCount;
  for(let n=0;n<6;n++)await h.next();
  assert.match(h.el('workoutMovementProgress').textContent,/Round 4/);assert.equal(h.run('amrapBlockRun().deadlineMs'),deadline);
  assert.equal(h.tracker().performedWork().length,3,'repeated rounds add no credit');assert.equal(h.tracker().writeCount,writes,'and no duplicate writes');
  assert.ok(h.tracker().performedWork().every(p=>p.status==='completed'&&!p.sets),'Next never invents reps or load');
  assert.equal(h.tracker().plannedWork().filter(p=>p.prescription.protocol==='amrap').length,3,'no planned rounds are invented');
  assert.equal(h.run('amrapBlockRemaining()'),300-3.6);
  // Pause excludes time from the one block clock, across rounds.
  h.app.toggleWorkoutPause();h.time(600000);await h.pulse(0);assert.equal(h.run('amrapBlockRemaining()'),300-3.6);h.app.toggleWorkoutPause();
  await h.pulse(10000);assert.equal(h.el('workoutRingNum').textContent,String(Math.ceil(300-13.6)));
});

test('a later round can confirm skipped work but never downgrades or duplicates it',async()=>{
  const h=harness();await h.start();const [a,b,c]=h.phases().map(p=>p.occurrenceId);
  await h.skip();await h.next();await h.skip();
  assert.equal(h.tracker().outcome(a).status,'skipped');assert.equal(h.tracker().outcome(b).status,'completed');assert.equal(h.tracker().outcome(c).status,'skipped');
  await h.next();await h.skip();await h.next();
  assert.deepEqual([a,b,c].map(id=>h.tracker().outcome(id).status),['completed','completed','completed']);
  assert.equal(h.tracker().performedWork().length,3);
});

test('at zero the active exercise may finish, then exactly one transition follows and no fresh work starts',async()=>{
  const h=harness();await h.start();const ids=copy(h.phases().map(p=>p.occurrenceId));
  await h.next(); // round 1, exercise 2 is active at zero
  await h.pulse(300000);
  assert.equal(h.run('amrapBlockRun().expired'),true);assert.equal(h.el('workoutRingNum').textContent,'0');assert.equal(h.el('workoutRingPhase').textContent,'TIME UP');
  assert.match(h.spoken.at(-1),/Time is up\. Finish or skip this exercise/);assert.match(h.el('workoutAmrapStatus').textContent,/Time is up/);
  assert.equal(h.el('previousWorkoutBtn').disabled,true);assert.equal(h.phase().occurrenceId,ids[1]);
  assert.equal(h.el('completeMovementNext').textContent,'Cool-down','after zero Next previews the following phase, not another round');
  const spokenBefore=h.spoken.length;await h.pulse(5000);assert.equal(h.spoken.length,spokenBefore,'no repeated or post-zero cues');
  await h.next();
  assert.equal(h.phase().kind,'transition');assert.equal(h.run('amrapBlockRun({blockIndex:0}).ended'),true);
  assert.equal(h.tracker().performedWork().length,2,'only the two confirmed movements count');assert.equal(h.tracker().outcome(ids[2]),null,'the unstarted movement is not credited');
  // The ended block cannot be reopened by Previous or direct navigation.
  h.app.previousGeneratedPhase();assert.notEqual(h.phase().protocol,'amrap');
  h.app.enterGeneratedPhase(h.run("generatorState.timeline.findIndex(p=>p.protocol==='amrap')"));assert.notEqual(h.phase().protocol,'amrap');
  await h.next();assert.equal(h.tracker().performedWork().length,2);
});

test('Skip at zero ends the block without credit; expiry during a slow save never starts new work',async()=>{
  const h=harness();await h.start();const ids=copy(h.phases().map(p=>p.occurrenceId));
  await h.pulse(300000);await h.skip();
  assert.equal(h.phase().kind,'transition');assert.equal(h.tracker().outcome(ids[0]).status,'skipped');assert.equal(h.tracker().performedWork().length,0);
  const x=harness();await x.start();
  x.run('var amrapRecord=generatorState.tracker.recordDone;var amrapRelease;generatorState.tracker.recordDone=(...args)=>new Promise(resolve=>{amrapRelease=()=>resolve(amrapRecord(...args))})');
  x.time(400);const pending=x.app.generatedPrimaryAction();
  await x.app.generatedPrimaryAction();x.time(400);await x.app.generatedSkipWork();assert.equal(x.phase().exerciseIndex,0,'busy saves ignore further taps');
  x.time(300000);x.run('amrapRelease()');await pending;await x.flush();
  assert.equal(x.phase().kind,'transition');assert.equal(x.tracker().performedWork().length,1);assert.equal(x.tracker().outcome(ids[1]),null);
});

test('double taps, Previous and visibility return keep one position and the original deadline',async()=>{
  const h=harness();await h.start();const ids=copy(h.phases().map(p=>p.occurrenceId));
  h.time(400);await h.app.generatedPrimaryAction();await h.app.generatedPrimaryAction();await h.flush();
  assert.equal(h.phase().occurrenceId,ids[1],'a rapid second tap cannot confirm the next movement');assert.equal(h.tracker().outcome(ids[1]),null);
  assert.equal(h.el('previousWorkoutBtn').disabled,false);assert.equal(h.el('previousWorkoutName').textContent,'TRX squat');
  h.time(400);h.app.previousGeneratedPhase();assert.equal(h.phase().occurrenceId,ids[0]);assert.equal(h.tracker().outcome(ids[1]),null,'moving back records nothing');
  assert.equal(h.el('previousWorkoutBtn').disabled,true,'Previous never leaves the block or the round');
  for(let n=0;n<3;n++)await h.next();
  assert.match(h.el('workoutMovementProgress').textContent,/^Round 2$/);assert.equal(h.el('previousWorkoutBtn').disabled,true);
  const deadline=h.run('amrapBlockRun().deadlineMs');
  h.run("document.visibilityState='hidden'");h.time(400000);h.run("document.visibilityState='visible'");await h.event('visibilitychange');
  assert.equal(h.run('amrapBlockRun().expired'),true);assert.equal(h.run('amrapBlockRun().deadlineMs'),deadline);assert.equal(h.phase().occurrenceId,ids[0]);
});

test('pagehide pauses the AMRAP and returning requires Resume without extending the cap',async()=>{
  const h=harness();await h.start(true);h.time(10000);const deadline=h.run('amrapBlockRun().deadlineMs');
  await h.event('pagehide');assert.equal(h.run('workoutState.paused'),true);assert.equal(h.tracker().performedWork().length,0,'pagehide records nothing');
  h.time(900000);await h.event('pageshow');assert.equal(h.run('workoutState.paused'),true);assert.equal(h.run('amrapBlockRemaining()'),290);
  h.app.toggleWorkoutPause();await h.pulse(290000);assert.equal(h.run('amrapBlockRun().expired'),true);assert.equal(h.run('amrapBlockRun().deadlineMs'),deadline);
});

test('Coach failed checkpoints retry the original action; exit and reload keep only durable confirmed work',async()=>{
  const h=harness();await h.start(true);const ids=copy(h.phases().map(p=>p.occurrenceId));
  h.run('var amrapSave=localStorage.setItem;localStorage.setItem=()=>{throw new Error("quota")}');
  await h.next();assert.equal(h.phase().occurrenceId,ids[0],'a failed save does not advance');
  assert.equal(h.el('completeMovementAction').textContent,'Retry save');assert.equal(h.el('coachSkipBtn').classList.contains('hidden'),true);
  assert.equal((await h.run('amrapStore.loadSessionDraft()')).occurrenceOutcomes.length,0,'optimistic memory is not durable evidence');
  const recovered=await h.run('GarageFitSessionTracker.resumeTracker({store:amrapStore,meaningful:(o,p)=>p.section==="main"})');assert.equal(recovered.performedWork().length,0);
  h.run('localStorage.setItem=amrapSave');await h.next();assert.equal(h.phase().occurrenceId,ids[1]);
  assert.equal((await h.run('amrapStore.loadSessionDraft()')).occurrenceOutcomes.filter(o=>o.status==='completed').length,1);
  await h.next();await h.next();await h.next(); // a second-round repeat of ids[0]
  assert.equal((await h.run('amrapStore.loadSessionDraft()')).occurrenceOutcomes.length,3);
  h.app.openExitDialog('workout');await h.app.confirmExitChoice();
  const result=await h.tracker().exitEarly({actualDurationSeconds:20});
  assert.equal(result.finalStatus,'partial');assert.equal(result.performedWork.length,3);assert.deepEqual(copy(result.anchorResults),[]);
  assert.equal(GarageFitCoachModel.validate('session-result',copy(result)).valid,true);
  const planned=h.tracker().plannedWork().filter(p=>p.section==='main');
  assert.deepEqual(copy(planned.map(p=>p.occurrenceId)),ids);
  assert.ok(planned.every(p=>p.requirementId===null&&p.prescription.amrapSequence===1&&p.prescription.variableTarget&&p.prescription.reps===8&&!('round' in p.prescription&&p.prescription.round)));
  assert.deepEqual(copy(planned[0].prescription.protocolConditions),{targets:[{type:'reps',value:8},{type:'reps',value:8},{type:'reps',value:8}]});
  const history=H.createHistory([copy(result),copy(result)],C),amrap=history.performances.filter(p=>p.protocol==='amrap');
  assert.ok(amrap.length&&amrap.every(p=>!H.comparePerformanceEvidence(p,p).comparable),'AMRAP is never comparable progression evidence');
  assert.equal(H.comparePerformances({...amrap[0],protocol:'rounds'},amrap[0]).comparable,false);
});

test('standalone completion records the fixed plan; early exit stays ephemeral; navigation cannot advance a different run',async()=>{
  const h=harness();await h.start();
  for(let n=0;n<4;n++)await h.next();
  h.app.openExitDialog('workout');h.app.confirmExitChoice();
  assert.equal(h.run('generatorState.tracker'),null);assert.equal((await h.run('GarageFitCoachStore.createStore(localStorage).listSessionResults()')).results.length,0);
  assert.equal(await h.run('GarageFitCoachStore.createStore(localStorage).loadSessionDraft()'),null);
  const x=harness();await x.start();await x.next();await x.pulse(300000);await x.next();
  x.app.enterGeneratedPhase(x.run('generatorState.timeline.length-1'));x.run('generatorState.remaining=0');x.time(400);await x.app.generatedPrimaryAction();await x.run('generatorState.trackedResult');
  const result=copy(x.tracker().result);assert.deepEqual(copy(GarageFitCoachModel.validate('session-result',result).errors||[]),[]);
  assert.equal(result.plannedWork.filter(p=>p.prescription.protocol==='amrap').length,3);
  assert.deepEqual(result.performedWork.filter(p=>p.occurrenceId.startsWith('main:')).map(p=>p.occurrenceId),['main:b0:a1:e0','main:b0:a1:e1']);
  const y=harness();await y.start();
  y.run('var amrapHold=generatorState.tracker.recordDone;var amrapGo;generatorState.tracker.recordDone=(...args)=>new Promise(resolve=>{amrapGo=()=>resolve(amrapHold(...args))})');
  y.time(400);const pending=y.app.generatedPrimaryAction();y.app.goGenerator();y.app.startStandaloneGeneratedWorkout();const index=y.run('generatorState.timelineIndex');
  y.run('amrapGo()');await pending;assert.equal(y.run('generatorState.timelineIndex'),index);assert.equal(y.phase().kind,'ready');
});

test('regressions: Cindy keeps its fixed AMRAP player; EMOM and density keep their own protocol state',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  const cindy=app.GarageFitData.fixedWorkouts.cindy;
  assert.deepEqual(copy(cindy.termination),{type:'amrap',durationSeconds:1200});
  app.startFixedWorkout('cindy');
  assert.equal(vm.runInContext("workoutState.mode",app),'fixed');assert.equal(vm.runInContext('isAmrapBlockPhase()',app),false);
  assert.equal(app.document.getElementById('workoutAmrapStatus').classList.contains('hidden'),true);
  const blocks=blockFixtures(C,{emom:true,density:true,amrap:true});
  const w=savedWorkoutV2(C);w.main.blocks=[blocks.emom,blocks.density,blocks.amrap];G.normaliseWorkout(w);
  assert.deepEqual(w.main.blocks.map(b=>b.estimatedDurationSeconds),[300,300,300]);
  assert.deepEqual(G.validateMain(w.main,C,kit),[]);
});
