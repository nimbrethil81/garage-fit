const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const fixtures=require('./helpers/coach-fixtures');
const {blockFixtures,traceBlock}=require('./helpers/protocol-fixtures');
const {loadAppContext}=require('./helpers/app-context');
const plain=value=>JSON.parse(JSON.stringify(value));

function harness({ids=['push-up','plank'],targets=[6,20],minutes=3,storage=new Map()}={}){
  let now=0,wall=Date.now(),nextTimer=0,chimes=0;
  const timers=new Map(),events=new Map(),spoken=[],starts=[];
  const listen=(name,callback)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(callback)};
  const app=loadAppContext(storage,{ownIntrinsics:true,configure(context){
    context.performance={now:()=>now};context.wallNow=()=>wall;
    context.setInterval=(callback,delay)=>{timers.set(++nextTimer,{callback,delay});return nextTimer};
    context.clearInterval=id=>timers.delete(id);
    context.addEventListener=listen;context.document.addEventListener=listen;context.document.visibilityState='visible';
    context.speechSynthesis.speak=utterance=>spoken.push(utterance.text);
  }});
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id);
  app.beep=()=>starts.push(now);app.playCompletionChime=()=>chimes++;
  run(`Date.now=wallNow;var emomStore=GarageFitCoachStore.createStore(localStorage);
    generatorState.workout={schemaVersion:2,id:'emom-test',duration:10,focus:'balanced',
      warmup:{restSeconds:0,exercises:[{...CATALOGUE['jumping-jacks'],prescription:{type:'timed',value:1}}]},
      rampup:{restSeconds:0,exercises:[]},cooldown:{restSeconds:0,exercises:[{...CATALOGUE['childs-pose'],prescription:{type:'timed',value:1}}]},
      main:{blocks:[{id:'main-1',protocol:'emom',intent:'conditioning',
        exercises:${JSON.stringify(ids)}.map(id=>JSON.parse(JSON.stringify(CATALOGUE[id]))),
        prescription:{minutes:${minutes},slotSeconds:60,targets:${JSON.stringify(ids)}.map((id,index)=>({type:CATALOGUE[id].prescription.type,value:${JSON.stringify(targets)}[index]}))}}]}};`);
  const tracker=()=>run('generatorState.tracker'),phase=()=>run('currentGeneratedPhase()');
  const slots=()=>run("generatorState.timeline.filter(phase=>phase.protocol==='emom')");
  const first=()=>run("generatorState.timeline.findIndex(phase=>phase.protocol==='emom')");
  const time=ms=>{now+=ms;wall+=ms};
  const flush=async()=>{if(tracker())await tracker().flush();await Promise.resolve()};
  return {app,run,el,storage,timers,spoken,starts,tracker,phase,slots,first,time,flush,
    get chimes(){return chimes},get now(){return now},
    callback:()=>timers.get(run('generatorState.phaseTimer')).callback,
    wallJump(ms){wall+=ms},
    async event(name){for(const callback of events.get(name)||[])await callback();await flush()},
    async pulse(ms){const timer=timers.get(run('generatorState.phaseTimer'));time(ms);await timer.callback();await flush()},
    async start(coach=false){
      if(coach){
        await run(`var emomTracker=GarageFitSessionTracker.createTracker({store:emomStore,source:'coach',draftId:'emom-coach',programmeInstanceId:'prog-1',prescriptionId:'rx-1',workoutId:'emom-test',
          plannedWork:GarageFitSessionTracker.plannedWorkFromTimeline(buildGeneratedTimeline(generatorState.workout)),meaningful:(outcome,planned)=>planned.section==='main'});emomTracker.start()`);
        run('coachUI.isActive=()=>true');app.startGeneratedWorkout({tracker:run('emomTracker')});
      }else app.startStandaloneGeneratedWorkout();
      await flush();app.enterGeneratedPhase(first());await flush();
    },
    results:async()=>plain((await run('emomStore.listSessionResults()')).results)
  };
}

test('EMOM uses the resolved targets, minute identity and the shared accessible player',async()=>{
  const h=harness();await h.start();
  assert.match(h.el('workoutMovementProgress').textContent,/EMOM · Minute 1 of 3/);
  assert.equal(h.el('workoutTarget').textContent,'6 reps');
  assert.equal(h.el('workoutTarget').classList.contains('hidden'),false);
  assert.equal(h.el('workoutRingNum').textContent,'60');
  assert.equal(h.el('completeMovementAction').textContent,'Done');
  assert.equal(h.el('coachSkipBtn').classList.contains('hidden'),false);
  assert.equal(h.el('previousWorkoutBtn').disabled,true);
  assert.match(fs.readFileSync('index.html','utf8'),/id="workoutEmomStatus" role="status" aria-live="polite"/);
  assert.equal(h.starts.length,1);
  const planned=plain(h.tracker().plannedWork()).filter(entry=>entry.prescription.protocol==='emom');
  assert.deepEqual(planned.map(entry=>[entry.prescription.minute,entry.prescription.reps,entry.prescription.seconds]),[[1,6,null],[2,null,20],[3,6,null]]);
  assert.equal(new Set(planned.map(entry=>entry.occurrenceId)).size,3);
  assert.ok(h.slots().every(phase=>Object.isFrozen(phase.target)));
  assert.ok(h.slots().every(phase=>Object.isFrozen(phase.protocolConditions.targets)&&phase.protocolConditions.targets.every(Object.isFrozen)));
  const block=blockFixtures(h.app.GarageFitData.exercises,{emom:true}).emom;
  assert.deepEqual(traceBlock(h.app.GarageFitGenerator,block).problems,[]);
  assert.equal(traceBlock(h.app.GarageFitGenerator,block).seconds,300);
  assert.match(h.app.GarageFitWorkoutPreview.protocolLabel(block),/^EMOM · 5 minutes/);
  assert.equal(h.app.GarageFitWorkoutPreview.emomTargetLabel(block,0),'6 reps');
});

test('early Done confirms one rep occurrence, then rests to the original boundary',async()=>{
  const h=harness();await h.start();const id=h.phase().occurrenceId;
  h.time(12500);await h.app.generatedPrimaryAction();
  assert.equal(h.tracker().outcome(id).status,'completed');
  assert.equal(h.tracker().outcome(id).sets,undefined,'no planned reps or load become actual measures');
  assert.equal(h.run('generatorState.remaining'),47.5);
  assert.equal(h.el('completeMovementBtn').disabled,true);
  assert.equal(h.el('workoutRingState').textContent,'Rest');
  assert.match(h.el('workoutEmomStatus').textContent,/Work complete.*Rest until next minute/);
  assert.equal(h.chimes,1);
  await h.app.generatedPrimaryAction();await h.app.generatedSkipWork();h.app.previousGeneratedPhase();
  assert.equal(h.phase().minute,1);assert.equal(h.tracker().performedWork().length,1);
  await h.pulse(47500);
  assert.equal(h.phase().minute,2);assert.equal(h.el('workoutRingNum').textContent,'60');
  assert.equal(h.starts.length,2);assert.equal(h.chimes,1);
});

test('rep expiry and a late Done never auto-award planned repetitions',async()=>{
  for(const action of ['timer','done']){
    const h=harness();await h.start();const id=h.phase().occurrenceId;
    if(action==='timer')await h.pulse(60000);else{h.time(60001);await h.app.generatedPrimaryAction()}
    assert.equal(h.tracker().outcome(id).status,'skipped');
    assert.equal(h.tracker().performedWork().length,0);
    assert.equal(h.phase().minute,2);
    assert.equal(h.tracker().outcome(h.phase().occurrenceId),null);
  }
});

test('Skip work cannot skip recovery or accelerate several minutes with fast taps',async()=>{
  const h=harness();await h.start();const id=h.phase().occurrenceId;
  h.time(500);await h.app.generatedSkipWork();
  for(let n=0;n<8;n++){await h.app.generatedPrimaryAction();await h.app.generatedSkipWork()}
  assert.equal(h.phase().minute,1);assert.equal(h.run('generatorState.remaining'),59.5);
  assert.equal(h.tracker().outcome(id).status,'skipped');assert.equal(h.chimes,0);
  await h.pulse(59500);assert.equal(h.phase().minute,2);
});

test('timed targets finish independently of the minute, with no rest counted as work',async()=>{
  const h=harness({ids:['plank'],targets:[20],minutes:2});await h.start();const first=h.phase().occurrenceId;
  await h.pulse(20000);
  assert.deepEqual(plain(h.tracker().outcome(first).sets),[{seconds:20}]);
  assert.equal(h.phase().minute,1);assert.equal(h.run('generatorState.remaining'),40);
  assert.equal(h.el('workoutTarget').textContent,'20 sec work');assert.equal(h.chimes,1);
  await h.pulse(40000);const second=h.phase().occurrenceId;assert.equal(h.phase().minute,2);
  await h.pulse(7250);await h.app.generatedPrimaryAction();
  assert.deepEqual(plain(h.tracker().outcome(second).sets),[{seconds:7.25}]);
  assert.equal(h.tracker().outcome(second).status,'partial');
  await h.pulse(52750);assert.notEqual(h.phase().protocol,'emom');
  assert.deepEqual(plain(h.tracker().outcome(second).sets),[{seconds:7.25}]);
  assert.equal(h.chimes,1);
});

test('a delayed callback catches up to absolute boundaries and earns nothing for unentered minutes',async()=>{
  const h=harness({ids:['plank'],targets:[20],minutes:3});await h.start();const slots=h.slots();
  await h.pulse(125000);
  assert.equal(h.phase().minute,3);assert.equal(h.run('generatorState.remaining'),55);
  assert.deepEqual(plain(h.tracker().outcome(slots[0].occurrenceId).sets),[{seconds:20}]);
  assert.equal(h.tracker().outcome(slots[1].occurrenceId).status,'skipped');
  assert.equal(h.tracker().outcome(slots[2].occurrenceId),null);
  assert.equal(h.chimes,0,'no completion cue for an old minute during catch-up');
  await h.pulse(20000);
  assert.equal(h.run('generatorState.remaining'),35);
  assert.equal(h.tracker().outcome(slots[2].occurrenceId).status,'completed');
});

test('page backgrounding never measures work for minutes that were not presented',async()=>{
  const h=harness({ids:['plank'],targets:[20],minutes:3});await h.start();const slots=h.slots();
  h.app.document.visibilityState='hidden';await h.pulse(60000);await h.pulse(60000);await h.pulse(5000);
  assert.equal(h.tracker().outcome(slots[1].occurrenceId).status,'skipped');
  assert.equal(h.tracker().outcome(slots[2].occurrenceId),null);
  assert.equal(h.starts.length,1,'no queued cues for unseen minutes');
  h.app.document.visibilityState='visible';await h.event('visibilitychange');
  assert.equal(h.starts.length,2);assert.equal(h.run('generatorState.remaining'),55);
  h.time(4500);await h.app.generatedPrimaryAction();
  assert.deepEqual(plain(h.tracker().outcome(slots[2].occurrenceId).sets),[{seconds:4.5}]);
});

test('joining a late minute caps timed evidence at its boundary and never credits overrun',async()=>{
  const h=harness({ids:['plank'],targets:[20],minutes:2});await h.start();
  await h.pulse(119000);const id=h.phase().occurrenceId;
  assert.equal(h.phase().minute,2);assert.equal(h.run('generatorState.remaining'),1);
  await h.pulse(5000);
  assert.equal(h.phase().kind,'transition');
  assert.deepEqual(plain(h.tracker().outcome(id).sets),[{seconds:1}]);
  assert.equal(h.tracker().outcome(id).status,'partial');
});

test('pause at the boundary freezes active time and resuming creates no shifted or duplicate minute',async()=>{
  const h=harness();await h.start();await h.pulse(59999);
  h.app.toggleWorkoutPause();const elapsed=h.run('currentWorkoutElapsedMs()');
  await h.pulse(100000);assert.equal(h.phase().minute,1);assert.equal(h.run('currentWorkoutElapsedMs()'),elapsed);
  assert.equal(h.el('workoutRingState').textContent,'Paused');
  h.app.toggleWorkoutPause();await h.pulse(1);
  assert.equal(h.phase().minute,2);assert.equal(h.run('generatorState.remaining'),60);
  assert.equal(h.starts.length,2);
  h.app.toggleWorkoutPause();await h.pulse(5000);h.app.toggleWorkoutPause();await h.pulse(20000);
  assert.equal(h.run('generatorState.remaining'),40);assert.equal(h.chimes,1);
});

test('a wall-clock change does not move a monotonic EMOM boundary',async()=>{
  const h=harness({ids:['plank'],targets:[20],minutes:2});await h.start();h.wallJump(-3600000);
  await h.pulse(10000);assert.equal(h.run('generatorState.remaining'),50);
  h.wallJump(7200000);await h.pulse(10000);
  assert.equal(h.phase().minute,1);assert.equal(h.run('generatorState.remaining'),40);
  assert.deepEqual(plain(h.tracker().performedWork()[0].sets),[{seconds:20}]);
});

test('Previous and direct revisits cannot reset a clock, duplicate credit or reopen completed work',async()=>{
  const h=harness();await h.start();const first=h.phase().occurrenceId;
  await h.app.generatedPrimaryAction();await h.pulse(60000);await h.pulse(15000);
  h.app.previousGeneratedPhase();assert.equal(h.phase().minute,2);
  h.app.enterGeneratedPhase(h.first());await h.flush();await Promise.resolve();
  assert.equal(h.phase().minute,2);assert.equal(h.run('generatorState.remaining'),45);
  await h.pulse(5000);assert.equal(h.run('generatorState.remaining'),40);
  assert.equal(h.tracker().performedWork().filter(work=>work.occurrenceId===first).length,1);
  assert.deepEqual(plain(h.tracker().performedWork().find(work=>work.exerciseId==='plank').sets),[{seconds:20}]);
});

test('the final minute waits for its boundary, and stale callbacks cannot fire after exit or a new run',async()=>{
  const h=harness({ids:['push-up'],targets:[6],minutes:1});await h.start();const old=h.callback();
  h.time(1000);await h.app.generatedPrimaryAction();await h.pulse(58999);assert.equal(h.phase().minute,1);
  await h.pulse(1);assert.equal(h.phase().kind,'transition');assert.equal(h.timers.size,2);
  await old();assert.equal(h.phase().kind,'transition');
  h.app.openExitDialog('workout');h.app.confirmExitChoice();h.time(180000);await old();
  assert.equal(h.run('workoutState.running'),false);assert.deepEqual(await h.results(),[]);
  await h.start();const index=h.run('generatorState.timelineIndex'),before=h.chimes;await old();
  assert.equal(h.run('generatorState.timelineIndex'),index);assert.equal(h.chimes,before);
});

test('Coach optional work uses the same tracker, with truthful early exit and durable recovery',async()=>{
  const h=harness({ids:['plank'],targets:[20],minutes:3});await h.start(true);
  const first=h.phase().occurrenceId;await h.pulse(20000);await h.pulse(40000);
  const second=h.phase().occurrenceId;h.time(7500);
  h.app.openExitDialog('workout');await h.app.coachExit();await h.flush();
  assert.equal(h.run('workoutState.running'),false);
  assert.deepEqual(plain(h.tracker().outcome(first).sets),[{seconds:20}]);
  assert.deepEqual(plain(h.tracker().outcome(second).sets),[{seconds:7.5}]);
  assert.deepEqual(plain(h.tracker().draft().anchorResults),[]);
  const draft=plain(await h.run('emomStore.loadSessionDraft()'));
  assert.equal(draft.occurrenceOutcomes.length,2);
  // A fresh tracker reconstructs only durable outcomes, never an unentered third minute.
  await h.run('emomStore.saveProgrammeState('+JSON.stringify(fixtures.programmeState())+')');
  const report=await h.run(`var emomRecovery=GarageFitCoachRecovery.createRecovery({store:emomStore,engine:{applySessionResult:(_definition,state)=>state},definitionFor:()=>({})});emomRecovery.reconcile()`);
  const result=report.recoveredResult;
  assert.deepEqual(plain(result.performedWork.map(work=>work.sets)),[[{seconds:20}],[{seconds:7.5}]]);
  assert.equal(result.finalStatus,'partial');assert.deepEqual(plain(result.anchorResults),[]);
  assert.equal(h.run('GarageFitCoachModel.validate("session-result",'+JSON.stringify(result)+').valid'),true);
  assert.equal(await h.run('emomStore.loadSessionDraft()'),null);
  assert.equal((await h.run('emomRecovery.reconcile()')).recoveredResult,null);
  assert.equal((await h.results()).length,1);
});

test('Coach supporting reps without Done stay skipped, including the generic timer recording entry point',async()=>{
  const h=harness();await h.start(true);const first=h.phase();await h.pulse(60000);
  assert.equal(h.tracker().outcome(first.occurrenceId).status,'skipped');
  assert.deepEqual(plain(h.tracker().draft().anchorResults),[]);
  await h.run('coachUI').record(first,h.tracker(),'timer',60);
  assert.equal(h.tracker().outcome(first.occurrenceId).status,'skipped');
  assert.equal(h.tracker().performedWork().length,0);
});

test('leaving EMOM clears minute presentation before a fixed workout uses the shared player',async()=>{
  const h=harness();await h.start();await h.app.generatedPrimaryAction();
  h.app.goHome();h.app.startFixedWorkout('workout300');
  assert.equal(h.el('workoutEmomStatus').classList.contains('hidden'),true);
  assert.equal(h.el('workoutSideNote').classList.contains('hidden'),false);
  assert.equal(h.el('previousWorkoutBtn').attributes['aria-label'],undefined);
  assert.equal(h.el('completeMovementAction').textContent,'Next');
});

test('a completed standalone EMOM stores one immutable result; an unfinished run stays ephemeral',async()=>{
  const h=harness({ids:['plank'],targets:[20],minutes:1});await h.start();
  await h.pulse(60000);
  h.app.generatedPrimaryAction();await h.pulse(1000);await h.flush();
  const result=plain(await h.run('generatorState.trackedResult'));
  assert.equal(result.source,'generator');assert.equal(result.performedWork.length,2,'EMOM and the measured cool-down');
  assert.deepEqual(result.performedWork.find(work=>work.section==='main'||work.exerciseId==='plank').sets,[{seconds:20}]);
  assert.equal((await h.results()).length,1);
  const unfinished=harness();await unfinished.start();await unfinished.app.generatedPrimaryAction();
  unfinished.app.openExitDialog('workout');unfinished.app.confirmExitChoice();
  assert.deepEqual(await unfinished.results(),[]);
  assert.equal(unfinished.storage.has('gf_coach_session_draft'),false);
});

test('pagehide stops timers and a reload sees only checkpointed Coach evidence',async()=>{
  const h=harness({ids:['plank'],targets:[20],minutes:2});await h.start(true);
  const stale=h.callback();h.time(4500);await h.event('pagehide');await h.tracker().flush();
  assert.equal(h.run('workoutState.paused'),true);assert.equal(h.timers.size,0);
  h.time(180000);await stale();
  const draft=plain(await h.run('emomStore.loadSessionDraft()'));
  assert.deepEqual(draft.occurrenceOutcomes.map(outcome=>outcome.sets),[[{seconds:4.5}]]);
  assert.equal(draft.occurrenceOutcomes[0].status,'partial');
  await h.event('pageshow');assert.equal(h.run('workoutState.paused'),true);
  assert.equal(h.el('workoutPausedState').textContent,'Paused — tap to resume');
  h.app.toggleWorkoutPause();await h.pulse(10000);
  assert.equal(h.phase().minute,1);assert.equal(h.run('generatorState.remaining'),45.5);
});

test('an outstanding save cannot cue, advance or lock a different workout after interrupted navigation',async()=>{
  const h=harness();await h.start(true);let resolve;
  h.run('coachUI').record=()=>new Promise(done=>{resolve=done});
  const pending=h.app.generatedPrimaryAction();h.app.goHome();
  await h.start();assert.equal(h.el('completeMovementBtn').disabled,false);
  const before=h.chimes;resolve(true);await pending;
  assert.equal(h.chimes,before);assert.equal(h.phase().minute,1);
  await h.app.generatedPrimaryAction();assert.equal(h.tracker().performedWork().length,1);
});

test('a boundary save resolving after pagehide cannot advance the paused minute',async()=>{
  const h=harness();await h.start(true);const ui=h.run('coachUI'),record=ui.record;let resolve,pending=false;
  ui.record=()=>{if(pending)return Promise.resolve(false);pending=true;return new Promise(done=>{resolve=done})};
  h.time(60000);const saving=h.app.updateEmomMinute();await h.event('pagehide');
  resolve(true);await saving;
  assert.equal(h.phase().minute,1);assert.equal(h.run('workoutState.paused'),true);
  assert.equal(h.starts.length,1);assert.equal(h.chimes,0);
  await h.event('pageshow');ui.record=record;h.app.toggleWorkoutPause();await h.pulse(0);
  assert.equal(h.phase().minute,2);assert.equal(h.run('generatorState.remaining'),60);
});

test('slow or failed Coach writes preserve the confirmation time and the absolute minute schedule',async()=>{
  const h=harness();await h.start(true);const phase=h.phase(),ui=h.run('coachUI'),record=ui.record;
  let resolve;ui.record=()=>new Promise(done=>{resolve=done});
  h.time(5000);const saving=h.app.generatedPrimaryAction();assert.equal(h.el('completeMovementBtn').disabled,true);
  await h.pulse(65000);assert.equal(h.run('generatorState.remaining'),0);resolve(false);await saving;
  assert.equal(h.el('completeMovementAction').textContent,'Retry save');assert.equal(h.phase(),phase);
  ui.record=record;await h.app.generatedPrimaryAction();
  assert.equal(h.tracker().outcome(phase.occurrenceId).status,'completed','Done was confirmed before the boundary');
  assert.equal(h.phase().minute,2);assert.equal(h.run('generatorState.remaining'),50);
  assert.equal(h.tracker().outcome(h.phase().occurrenceId),null);
  const previous=h.callback();h.app.goHome();h.time(180000);await previous();
  assert.equal(h.run('workoutState.running'),false);
});
