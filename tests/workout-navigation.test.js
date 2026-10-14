const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {loadAppContext} = require('./helpers/app-context');

function harness() {
  const app=loadAppContext(new Map(),{ownIntrinsics:true}),run=code=>vm.runInContext(code,app);
  run('var testNow=Date.now();Date.now=()=>testNow');
  const timers=new Map();let id=0;
  app.setInterval=callback=>{timers.set(++id,callback);return id;};
  app.clearInterval=id=>timers.delete(id);
  const el=id=>app.document.getElementById(id),stage=el('workoutStage');
  const target={closest:()=>null};
  const pointer=(extra={})=>({target,isPrimary:true,button:0,pointerId:1,clientX:40,clientY:50,detail:1,...extra});
  return {app,run,el,stage,target,pointer,
    time(ms){run(`testNow+=${ms}`);},
    tick(ms=1000){run(`testNow+=${ms}`);timers.get(run('generatorState.phaseTimer'))();},
    tap(extra={}){app.workoutPanelPointerDown(pointer(extra));app.workoutPanelClick(pointer(extra));},
    key(key,extra={}){app.workoutPanelKey({key,target:stage,currentTarget:stage,preventDefault(){},...extra});},
    generated(){run("state.ownedEquipment=['dumbbells','kettlebell','bench','trx','bands'];generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:30,focus:'balanced',equipment:state.ownedEquipment,random:(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;})(7)})");app.startStandaloneGeneratedWorkout();},
    phase:()=>run('currentGeneratedPhase()'),
    timeline:()=>run('generatorState.timeline')};
}

test('fixed rounds show Next until the actual last occurrence, and AMRAP previews the next round',()=>{
  const h=harness();h.app.startWorkout();
  assert.equal(h.el('completeMovementBtn').textContent,'Next');
  assert.match(h.el('generatedNext').textContent,/Up next.*50 reps/);
  h.run('workoutState.workout={...workoutState.workout,termination:{type:"fixed-rounds",rounds:2}};workoutState.idx=activeFixedExercises().length-1');h.app.renderWorkout();
  assert.equal(h.el('completeMovementBtn').textContent,'Next');assert.match(h.el('generatedNext').textContent,/Round 2 of 2.*Pull-ups/);
  h.run('workoutState.round=2');h.app.renderWorkout();
  assert.equal(h.el('completeMovementBtn').textContent,'Finish workout');assert.equal(h.el('generatedNext').textContent,'Up next · Workout complete');
  h.app.startFixedWorkout('cindy');h.app.completeWorkoutMovement();h.app.completeWorkoutMovement();
  assert.equal(h.el('completeMovementBtn').textContent,'Next');assert.match(h.el('generatedNext').textContent,/Round 2.*repeat until time is up.*Pull-ups.*5 reps/);
});

test('fixed Previous followed by Next restores occurrence history, and paused navigation is blocked',()=>{
  const h=harness();h.app.startFixedWorkout('cindy');
  for(let i=0;i<3;i++)h.app.completeWorkoutMovement();
  const score=h.run('JSON.stringify({round:workoutState.round,history:workoutState.history,reps:workoutState.additionalReps})');
  h.app.previousWorkoutMovement();h.app.completeWorkoutMovement();assert.equal(h.run('JSON.stringify({round:workoutState.round,history:workoutState.history,reps:workoutState.additionalReps})'),score);
  h.tap();const index=h.run('workoutState.idx');h.app.previousWorkoutMovement();h.app.completeWorkoutMovement();assert.equal(h.run('workoutState.idx'),index);
  assert.equal(h.el('previousWorkoutBtn').disabled,true);assert.equal(h.el('completeMovementBtn').disabled,true);
});

test('deliberate panel taps and keyboard activation pause once and expose state',()=>{
  const h=harness();h.app.startFixedWorkout('cindy');h.time(1250);h.tap();
  assert.equal(h.run('workoutState.paused'),true);assert.equal(h.run('currentWorkoutElapsedMs()'),1250);
  assert.equal(h.el('workoutPausedState').textContent,'Paused — tap to resume');assert.equal(h.el('workoutPausedState').attributes['aria-pressed'],'true');
  h.time(9000);assert.equal(h.run('currentWorkoutElapsedMs()'),1250);assert.equal(h.el('workoutElapsed').textContent,'19:59');
  h.key('Enter');assert.equal(h.run('workoutState.paused'),false);h.time(750);assert.equal(h.run('currentWorkoutElapsedMs()'),2000);
  h.key(' ');assert.equal(h.run('workoutState.paused'),true);h.key(' ',{repeat:true});assert.equal(h.run('workoutState.paused'),true);
  h.key('Enter',{target:{}});assert.equal(h.run('workoutState.paused'),true);
  h.app.workoutPanelClick({target:h.target,detail:0});assert.equal(h.run('workoutState.paused'),false);
});

test('instruction/result/control events, drags, long presses, scroll and cancelled pointers do not toggle',()=>{
  const h=harness();h.app.startWorkout();
  for(const tag of ['summary','details','input','select','textarea','a','button','label','form','#coachAnchorLog','[contenteditable]']){
    const target={closest:selector=>selector.includes(tag)?{}:null};h.tap({target});h.app.workoutPanelClick({target,detail:0});assert.equal(h.run('workoutState.paused'),false,tag);
  }
  h.app.workoutPanelPointerDown(h.pointer());h.app.workoutPanelPointerMove(h.pointer({clientX:80}));h.app.workoutPanelPointerMove(h.pointer());h.app.workoutPanelClick(h.pointer());
  assert.equal(h.run('workoutState.paused'),false,'drag back to start');
  h.app.workoutPanelPointerDown(h.pointer());h.app.workoutPanelPointerCancel();h.app.workoutPanelClick(h.pointer());assert.equal(h.run('workoutState.paused'),false);
  h.app.workoutPanelPointerDown(h.pointer());h.time(700);h.app.workoutPanelClick(h.pointer());assert.equal(h.run('workoutState.paused'),false);
  h.app.workoutPanelPointerDown(h.pointer());h.el('workoutPlayer').scrollTop=20;h.app.workoutPanelClick(h.pointer());assert.equal(h.run('workoutState.paused'),false);
  h.tap({button:2});h.tap({isPrimary:false});assert.equal(h.run('workoutState.paused'),false);
});

test('exit cancellation restores only an originally running clock and panel modal events are ignored',()=>{
  const h=harness();h.app.startWorkout();h.app.openExitDialog('workout');h.tap();h.key('Enter');assert.equal(h.run('workoutState.paused'),true);
  h.app.cancelExit();assert.equal(h.run('workoutState.paused'),false);
  h.tap();h.app.openExitDialog('workout');h.app.cancelExit();assert.equal(h.run('workoutState.paused'),true);
});

test('every generated preview follows actual timeline occurrences including sides, loads and intervening phases',()=>{
  const h=harness();h.generated();const timeline=h.timeline();
  for(let index=0;index<timeline.length;index++){
    h.app.enterGeneratedPhase(index);const nextIndex=timeline.findIndex((p,i)=>i>index&&p.kind==='exercise'),text=h.el('generatedNext').textContent;
    if(nextIndex<0){assert.equal(text,'Up next · Workout complete');continue;}
    const next=timeline[nextIndex];assert.ok(text.includes(next.exercise.name));assert.ok(text.includes(next.timed?next.seconds+' sec':next.exercise.prescription.value+' reps'));assert.ok(text.includes(h.app.generatedPhaseLabel(next)));
    if(next.side)assert.ok(text.includes(next.side));if(h.app.generatedLoadText(next.exercise))assert.ok(text.includes(h.app.generatedLoadText(next.exercise)));
    if(nextIndex>index+1)assert.match(text,/after/);
    if(timeline[index].kind==='exercise')assert.equal(h.el('completeMovementBtn').textContent,timeline[index].timed?'Skip interval':index===timeline.length-1?'Finish workout':'Next');
  }
});

test('generated labels distinguish outstanding cooldown, rests, final reps and Coach feedback',()=>{
  const h=harness();h.generated();let timeline=h.timeline();
  const mainLast=timeline.findLastIndex(p=>p.kind==='exercise'&&p.section==='main');h.app.enterGeneratedPhase(mainLast);
  if(!timeline[mainLast].timed)assert.equal(h.el('completeMovementBtn').textContent,'Next');assert.match(h.el('generatedNext').textContent,/Cool-down/);
  h.app.enterGeneratedPhase(mainLast+1);assert.equal(h.el('completeMovementBtn').textContent,'Skip');
  h.run('generatorState.timeline.at(-1).timed=false;generatorState.timeline.at(-1).seconds=null');h.app.enterGeneratedPhase(timeline.length-1);
  assert.equal(h.el('completeMovementBtn').textContent,'Finish workout');
  h.run('generatorState.standaloneTracking=false;coachUI.isActive=()=>true');h.app.renderGeneratedPhase();
  assert.equal(h.el('completeMovementBtn').textContent,'Next');assert.equal(h.el('generatedNext').textContent,'Up next · Session feedback');
});

test('phase timers preserve fractional remaining time through pause, do not repeat cues, and record measured seconds',async()=>{
  const h=harness();h.generated();const index=h.timeline().findIndex(p=>p.kind==='exercise'&&p.timed&&p.seconds>10);
  h.run(`generatorState.timeline[${index}].exercise.timedCues=[{text:'Test cue',at:{type:'fraction',value:0.5}}]`);h.app.enterGeneratedPhase(index);
  const phase=h.phase(),spoken=[];h.app.speechSynthesis.speak=u=>spoken.push(u.text);
  h.tick(250);h.time(375);h.tap();assert.equal(h.run('generatorState.remaining'),phase.seconds-.625);
  const elapsed=h.run('currentWorkoutElapsedMs()'),position=h.run('generatorState.timelineIndex');h.tick(10000);
  assert.equal(h.run('generatorState.remaining'),phase.seconds-.625);assert.equal(h.run('currentWorkoutElapsedMs()'),elapsed);assert.equal(h.run('generatorState.timelineIndex'),position);
  h.key('Enter');h.tick(phase.seconds*500);assert.equal(spoken.filter(t=>t==='Test cue').length,1);
  h.tap();h.tick(5000);h.tap();h.tick(250);assert.equal(spoken.filter(t=>t==='Test cue').length,1);
  h.app.completeWorkoutMovement();const tracker=h.run('generatorState.tracker');await tracker.flush();
  assert.equal(tracker.outcome(phase.occurrenceId).sets[0].seconds,phase.seconds/2+.875);
  assert.equal(tracker.outcome(phase.occurrenceId).status,'partial');
});

test('Previous/Next on tracked generated reps records one occurrence and paused navigation records none',async()=>{
  const h=harness();h.generated();const index=h.timeline().findIndex(p=>p.kind==='exercise'&&!p.timed);
  h.app.enterGeneratedPhase(index);const phase=h.phase();h.app.completeWorkoutMovement();h.app.previousGeneratedPhase();h.app.completeWorkoutMovement();
  const tracker=h.run('generatorState.tracker');await tracker.flush();assert.equal(tracker.performedWork().filter(p=>p.occurrenceId===phase.occurrenceId).length,1);
  h.tap();const position=h.run('generatorState.timelineIndex');h.app.previousGeneratedPhase();h.app.completeWorkoutMovement();assert.equal(h.run('generatorState.timelineIndex'),position);assert.equal(tracker.performedWork().length,1);
});

test('Coach save is busy before advance, blocks tap/keyboard/navigation, and failure retains the occurrence',async()=>{
  const h=harness();h.generated();const index=h.timeline().findIndex(p=>p.kind==='exercise'&&!p.timed);h.app.enterGeneratedPhase(index);
  let resolve;const write=new Promise(r=>resolve=r);h.app.testRecord=()=>write;
  h.run('generatorState.standaloneTracking=false;coachUI.isActive=()=>true;coachUI.record=testRecord');
  const pending=h.app.completeWorkoutMovement();assert.equal(h.el('completeMovementBtn').disabled,true);assert.equal(h.el('workoutStage').attributes['aria-busy'],'true');
  h.tap();h.key('Enter');h.app.previousWorkoutMovement();await h.app.completeWorkoutMovement();assert.equal(h.run('workoutState.paused'),false);assert.equal(h.run('generatorState.timelineIndex'),index);
  resolve(false);await pending;assert.equal(h.run('generatorState.timelineIndex'),index);assert.equal(h.el('completeMovementBtn').disabled,false);
  h.app.testRecord=()=>Promise.resolve(true);h.run('coachUI.record=testRecord');await h.app.completeWorkoutMovement();assert.equal(h.run('generatorState.timelineIndex'),index+1);
});

test('Coach result actuals survive panel pause and failed timed saves resume the measured countdown',async()=>{
  const h=harness();h.generated();h.run('generatorState.standaloneTracking=false;coachUI.isActive=()=>true;coachUI.renderAnchor=()=>{throw new Error("Pause must not rerender result inputs")};coachUI.record=async()=>false');
  h.el('coachActualReps').value='4';h.el('coachActualLoad').value='17';h.tap();h.tap();assert.equal(h.el('coachActualReps').value,'4');assert.equal(h.el('coachActualLoad').value,'17');
  h.run('coachUI.renderAnchor=()=>{}');const index=h.timeline().findIndex(p=>p.kind==='exercise'&&p.timed);h.app.enterGeneratedPhase(index);h.tick(2250);const remaining=h.run('generatorState.remaining');
  await h.app.completeWorkoutMovement();assert.equal(h.run('generatorState.timelineIndex'),index);assert.equal(h.run('generatorState.remaining'),remaining);h.tick(250);assert.equal(h.run('generatorState.remaining'),remaining-.25);
});

test('shared player surface and two navigation controls are wired in the HTML',()=>{
  const html=fs.readFileSync('index.html','utf8');assert.doesNotMatch(html,/workoutPauseBtn/);assert.match(html,/id="workoutStage"[^>]*aria-keyshortcuts="Enter Space"/);
  for(const binding of ['onclick="workoutPanelClick(event)"','onkeydown="workoutPanelKey(event)"','onpointerdown="workoutPanelPointerDown(event)"','onpointermove="workoutPanelPointerMove(event)"','onpointercancel="workoutPanelPointerCancel()"'])assert.ok(html.includes(binding));
});

test('paired sets, timed cycles, round and block boundaries preview their actual next occurrence',()=>{
  const h=harness();h.generated();
  h.run(`generatorState.workout.main.blocks=[
    {id:'pairs',protocol:'paired_sets',intent:'strength',exercises:[CATALOGUE['goblet-squat'],CATALOGUE['trx-row']],prescription:{sets:2,betweenExercisesSeconds:5,betweenSetsSeconds:60}},
    {id:'intervals',protocol:'timed_intervals',intent:'conditioning',exercises:[CATALOGUE['mountain-climbers'],CATALOGUE['jumping-jacks']],prescription:{cycles:2,workSeconds:40,transitionSeconds:20}},
    {id:'rounds',protocol:'rounds',intent:'strength',exercises:[CATALOGUE['air-squat'],CATALOGUE['push-up']],prescription:{rounds:2,exerciseRestSeconds:10,roundRestSeconds:30}}
  ];generatorState.timeline=buildGeneratedTimeline(generatorState.workout)`);
  const timeline=h.timeline();
  for(const [kind,context] of [['set-rest','Set 2 of 2'],['interval-rest','Cycle'],['round-rest','Round 2 of 2'],['block-transition','Block 2 of 3']]){
    const rest=timeline.findIndex(p=>p.kind===kind);assert.ok(rest>0,kind);h.app.enterGeneratedPhase(rest-1);
    assert.ok(h.el('generatedNext').textContent.includes(context));assert.match(h.el('generatedNext').textContent,/after/);
    assert.equal(h.el('completeMovementBtn').textContent,timeline[rest-1].timed?'Skip interval':'Next');
    h.app.enterGeneratedPhase(rest);assert.ok(h.el('generatedNext').textContent.includes(context));
  }
  const interval=timeline.findIndex(p=>p.kind==='exercise'&&p.protocol==='timed_intervals');h.app.enterGeneratedPhase(interval);assert.match(h.el('generatedNext').textContent,/40 sec/);
});
