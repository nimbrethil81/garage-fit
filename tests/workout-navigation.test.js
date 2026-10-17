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
  const el=id=>app.document.getElementById(id);
  return {app,run,el,
    time(ms){run(`testNow+=${ms}`);},
    tick(ms=1000){run(`testNow+=${ms}`);timers.get(run('generatorState.phaseTimer'))();},
    tap(){app.toggleWorkoutPause();},
    generated(){run("state.ownedEquipment=['dumbbells','kettlebell','bench','trx','bands'];generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:30,focus:'balanced',equipment:state.ownedEquipment,random:(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;})(7)})");app.startStandaloneGeneratedWorkout();},
    phase:()=>run('currentGeneratedPhase()'),
    timeline:()=>run('generatorState.timeline')};
}


const next=h=>h.el('completeMovementNext'),action=h=>h.el('completeMovementAction').textContent;
const previewName=(timeline,index)=>{const n=timeline[index+1];if(!n)return '';if(n.kind==='exercise')return n.exercise.name;if(n.kind==='interval-rest'||n.kind==='set-change')return 'Change over';if(n.kind==='block-transition')return 'Next block';if(n.kind==='transition'){const after=timeline.slice(index+2).find(p=>p.kind==='exercise');return {warmup:'Warm-up',rampup:'Ramp-up',main:'Main workout',cooldown:'Cool-down'}[after.section]}return 'Rest'};

test('fixed rounds show Next until the actual last occurrence, and the button previews only the next name',()=>{
  const h=harness();h.app.startWorkout();
  assert.equal(action(h),'Next');assert.equal(next(h).textContent,h.run('activeFixedExercises()[1].name'));assert.equal(next(h).classList.contains('hidden'),false);
  h.run('workoutState.workout={...workoutState.workout,termination:{type:"fixed-rounds",rounds:2}};workoutState.idx=activeFixedExercises().length-1');h.app.renderWorkout();
  assert.equal(action(h),'Next');assert.equal(next(h).textContent,'Pull-ups');
  h.run('workoutState.round=2');h.app.renderWorkout();
  assert.equal(action(h),'Finish workout');assert.equal(next(h).textContent,'');assert.equal(next(h).classList.contains('hidden'),true);
  h.app.startFixedWorkout('cindy');h.app.completeWorkoutMovement();h.app.completeWorkoutMovement();
  assert.equal(action(h),'Next');assert.equal(next(h).textContent,h.run('activeFixedExercises()[(workoutState.idx+1)%activeFixedExercises().length].name'));
  h.run('workoutState.idx=activeFixedExercises().length-1');h.app.renderWorkout();assert.equal(next(h).textContent,'Pull-ups');
});

test('fixed Previous followed by Next restores occurrence history, and paused navigation is blocked',()=>{
  const h=harness();h.app.startFixedWorkout('cindy');
  for(let i=0;i<3;i++)h.app.completeWorkoutMovement();
  const score=h.run('JSON.stringify({round:workoutState.round,history:workoutState.history,reps:workoutState.additionalReps})');
  h.app.previousWorkoutMovement();h.app.completeWorkoutMovement();assert.equal(h.run('JSON.stringify({round:workoutState.round,history:workoutState.history,reps:workoutState.additionalReps})'),score);
  h.tap();const index=h.run('workoutState.idx');h.app.previousWorkoutMovement();h.app.completeWorkoutMovement();assert.equal(h.run('workoutState.idx'),index);
  assert.equal(h.el('previousWorkoutBtn').disabled,true);assert.equal(h.el('completeMovementBtn').disabled,true);
});

test('untimed work shows no ring and keeps a labelled pause control; the ring toggles pause on timed work',()=>{
  const h=harness();h.app.startFixedWorkout('cindy');h.time(1250);
  assert.equal(h.el('workoutRingWrap').classList.contains('hidden'),true);assert.equal(h.el('workoutTarget').classList.contains('hidden'),false);assert.equal(h.el('workoutPausedState').textContent,'Pause');
  h.tap();assert.equal(h.run('workoutState.paused'),true);assert.equal(h.run('currentWorkoutElapsedMs()'),1250);
  assert.equal(h.el('workoutPausedState').textContent,'Paused — tap to resume');assert.equal(h.el('workoutPausedState').attributes['aria-pressed'],'true');
  h.time(9000);assert.equal(h.run('currentWorkoutElapsedMs()'),1250);assert.equal(h.el('workoutElapsed').textContent,'19:59');
  h.tap();assert.equal(h.run('workoutState.paused'),false);h.time(750);assert.equal(h.run('currentWorkoutElapsedMs()'),2000);
});

test('timed phases render a ring whose countdown and progress follow the existing timer through pause and resume',()=>{
  const h=harness();h.generated();const index=h.timeline().findIndex(p=>p.kind==='exercise'&&p.timed&&p.seconds>10);h.app.enterGeneratedPhase(index);
  const phase=h.phase(),ring=h.el('workoutRingFg'),num=h.el('workoutRingNum');
  assert.equal(h.el('workoutRingWrap').classList.contains('hidden'),false);assert.equal(h.el('workoutTarget').classList.contains('hidden'),true);
  assert.equal(num.textContent,String(phase.seconds));assert.equal(ring.style.strokeDashoffset,0);
  h.tick(1000);assert.equal(num.textContent,String(phase.seconds-1));assert.ok(Math.abs(ring.style.strokeDashoffset-565.48*(1/phase.seconds))<1e-6);
  h.tap();assert.equal(h.el('workoutRing').attributes['aria-pressed'],'true');assert.equal(h.el('workoutRingState').textContent,'Paused');assert.match(h.el('workoutRing').attributes['aria-label'],/Paused/);
  const offset=ring.style.strokeDashoffset;h.tick(5000);assert.equal(num.textContent,String(phase.seconds-1));assert.equal(ring.style.strokeDashoffset,offset);
  h.tap();assert.equal(h.el('workoutRing').attributes['aria-pressed'],'false');assert.equal(h.el('workoutRingState').textContent,'');h.tick(1000);assert.equal(num.textContent,String(phase.seconds-2));
  const rest=h.timeline().findIndex(p=>p.kind==='rest');h.app.enterGeneratedPhase(rest);assert.equal(h.el('workoutRingWrap').classList.contains('hidden'),false);assert.equal(num.textContent,String(h.timeline()[rest].seconds));
  const reps=h.timeline().findIndex(p=>p.kind==='exercise'&&!p.timed);if(reps>=0){h.app.enterGeneratedPhase(reps);assert.equal(h.el('workoutRingWrap').classList.contains('hidden'),true);assert.match(h.el('workoutTarget').textContent,/reps/)}
});

test('tapping the panel, text, instructions or Coach fields no longer pauses and the old copy is gone',()=>{
  const html=fs.readFileSync('index.html','utf8'),stage=html.match(/<div class="workout-stage"[^>]*>/)[0];
  assert.doesNotMatch(stage,/onclick|onkeydown|onpointer|tabindex|role=/);assert.doesNotMatch(html,/Tap exercise panel to pause|workoutPanel|id="generatedNext"|Skip ramp-up|rampupSkipBtn|coachSkipRampup/);
  assert.doesNotMatch(fs.readFileSync('js/rampup-ui.js','utf8'),/Skip ramp-up|rampupSkipBtn/);
  assert.match(html,/<button class="workout-ring" id="workoutRing" type="button" aria-pressed="false" aria-label="Pause timer" onclick="toggleWorkoutPause\(\)">/);
  const h=harness();h.generated();h.app.enterGeneratedPhase(h.timeline().findIndex(p=>p.kind==='exercise'&&p.timed));
  assert.equal(h.el('workoutRing').disabled,false);assert.equal(h.run('workoutState.paused'),false);
});

test('exit cancellation restores only an originally running clock and ring pause is ignored behind the dialog',()=>{
  const h=harness();h.app.startWorkout();h.app.openExitDialog('workout');h.tap();assert.equal(h.run('workoutState.paused'),true);
  h.app.cancelExit();assert.equal(h.run('workoutState.paused'),false);
  h.tap();h.app.openExitDialog('workout');h.app.cancelExit();assert.equal(h.run('workoutState.paused'),true);
});

test('the primary button names only the immediate next timeline item with truthful action semantics',()=>{
  const h=harness();h.generated();const timeline=h.timeline();
  for(let index=0;index<timeline.length;index++){
    h.app.enterGeneratedPhase(index);const phase=timeline[index],label=previewName(timeline,index);
    assert.equal(next(h).textContent,label,'next after '+index+' '+phase.kind);assert.equal(next(h).classList.contains('hidden'),!label);
    if(label)assert.doesNotMatch(next(h).textContent,/\d+ (sec|reps)|after|Round|Set \d/);
    if(phase.kind==='exercise')assert.equal(action(h),phase.timed?'Skip interval':index===timeline.length-1?'Finish workout':'Next');
    else if(['rest','set-change','interval-rest','round-rest','set-rest'].includes(phase.kind))assert.equal(action(h),'Skip rest');
  }
});

test('the next preview is the intervening rest, then the exercise after it, never skipping the rest',()=>{
  const h=harness();h.generated();const timeline=h.timeline(),rest=timeline.findIndex((p,i)=>i>0&&p.kind==='rest'&&timeline[i-1].kind==='exercise'&&timeline[i+1]&&timeline[i+1].kind==='exercise');
  h.app.enterGeneratedPhase(rest-1);assert.equal(next(h).textContent,'Rest');h.app.enterGeneratedPhase(rest);assert.equal(next(h).textContent,timeline[rest+1].exercise.name);assert.equal(action(h),'Skip rest');
  const main=timeline.findLastIndex(p=>p.kind==='exercise'&&p.section==='main');h.app.enterGeneratedPhase(main);assert.equal(next(h).textContent,'Cool-down');
});

test('generated labels distinguish final reps and Coach feedback',()=>{
  const h=harness();h.generated();const timeline=h.timeline();
  h.run('generatorState.timeline.at(-1).timed=false;generatorState.timeline.at(-1).seconds=null');h.app.enterGeneratedPhase(timeline.length-1);
  assert.equal(action(h),'Finish workout');assert.equal(next(h).textContent,'');
  h.run('generatorState.standaloneTracking=false;coachUI.isActive=()=>true');h.app.renderGeneratedPhase();
  assert.equal(action(h),'Next');assert.equal(next(h).textContent,'Session feedback');
});

test('phase timers preserve fractional remaining time through pause, do not repeat cues, and record measured seconds',async()=>{
  const h=harness();h.generated();const index=h.timeline().findIndex(p=>p.kind==='exercise'&&p.timed&&p.seconds>10);
  h.run(`generatorState.timeline[${index}].exercise.timedCues=[{text:'Test cue',at:{type:'fraction',value:0.5}}]`);h.app.enterGeneratedPhase(index);
  const phase=h.phase(),spoken=[];h.app.speechSynthesis.speak=u=>spoken.push(u.text);
  h.tick(250);h.time(375);h.tap();assert.equal(h.run('generatorState.remaining'),phase.seconds-.625);
  const elapsed=h.run('currentWorkoutElapsedMs()'),position=h.run('generatorState.timelineIndex');h.tick(10000);
  assert.equal(h.run('generatorState.remaining'),phase.seconds-.625);assert.equal(h.run('currentWorkoutElapsedMs()'),elapsed);assert.equal(h.run('generatorState.timelineIndex'),position);
  h.tap();h.tick(phase.seconds*500);assert.equal(spoken.filter(t=>t==='Test cue').length,1);
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

test('Coach save is busy before advance, blocks pause/navigation, and failure retains the occurrence',async()=>{
  const h=harness();h.generated();const index=h.timeline().findIndex(p=>p.kind==='exercise'&&!p.timed);h.app.enterGeneratedPhase(index);
  let resolve;const write=new Promise(r=>resolve=r);h.app.testRecord=()=>write;
  h.run('generatorState.standaloneTracking=false;coachUI.isActive=()=>true;coachUI.record=testRecord');
  const pending=h.app.completeWorkoutMovement();assert.equal(h.el('completeMovementBtn').disabled,true);assert.equal(h.el('workoutRing').disabled,true);
  h.tap();h.tap();h.app.previousWorkoutMovement();await h.app.completeWorkoutMovement();assert.equal(h.run('workoutState.paused'),false);assert.equal(h.run('generatorState.timelineIndex'),index);
  resolve(false);await pending;assert.equal(h.run('generatorState.timelineIndex'),index);assert.equal(h.el('completeMovementBtn').disabled,false);
  h.app.testRecord=()=>Promise.resolve(true);h.run('coachUI.record=testRecord');await h.app.completeWorkoutMovement();assert.equal(h.run('generatorState.timelineIndex'),index+1);
});

test('Coach result actuals survive ring pause and failed timed saves resume the measured countdown',async()=>{
  const h=harness();h.generated();h.run('generatorState.standaloneTracking=false;coachUI.isActive=()=>true;coachUI.renderAnchor=()=>{throw new Error("Pause must not rerender result inputs")};coachUI.record=async()=>false');
  h.el('coachActualReps').value='4';h.el('coachActualLoad').value='17';h.tap();h.tap();assert.equal(h.el('coachActualReps').value,'4');assert.equal(h.el('coachActualLoad').value,'17');
  h.run('coachUI.renderAnchor=()=>{}');const index=h.timeline().findIndex(p=>p.kind==='exercise'&&p.timed);h.app.enterGeneratedPhase(index);h.tick(2250);const remaining=h.run('generatorState.remaining');
  await h.app.completeWorkoutMovement();assert.equal(h.run('generatorState.timelineIndex'),index);assert.equal(h.run('generatorState.remaining'),remaining);h.tick(250);assert.equal(h.run('generatorState.remaining'),remaining-.25);
});


test('shared player surface wires the ring, the pause control and one primary action in the HTML',()=>{
  const html=fs.readFileSync('index.html','utf8');assert.doesNotMatch(html,/workoutPauseBtn/);
  assert.match(html,/id="completeMovementBtn"[^>]*><span class="complete-action" id="completeMovementAction">Next<\/span><span class="complete-next hidden" id="completeMovementNext">/);
  assert.match(html,/id="workoutPausedState" type="button" aria-pressed="false" onclick="toggleWorkoutPause\(\)"/);
});

test('rest and block boundaries preview their actual immediate next item',()=>{
  const h=harness();h.generated();
  h.run(`generatorState.workout.main.blocks=[
    {id:'pairs',protocol:'paired_sets',intent:'strength',exercises:[CATALOGUE['goblet-squat'],CATALOGUE['trx-row']],prescription:{sets:2,betweenExercisesSeconds:5,betweenSetsSeconds:60}},
    {id:'intervals',protocol:'timed_intervals',intent:'conditioning',exercises:[CATALOGUE['mountain-climbers'],CATALOGUE['jumping-jacks']],prescription:{cycles:2,workSeconds:40,transitionSeconds:20}},
    {id:'rounds',protocol:'rounds',intent:'strength',exercises:[CATALOGUE['air-squat'],CATALOGUE['push-up']],prescription:{rounds:2,exerciseRestSeconds:10,roundRestSeconds:30}}
  ];generatorState.timeline=buildGeneratedTimeline(generatorState.workout)`);
  const timeline=h.timeline();
  for(const [kind,label] of [['set-rest','Rest'],['interval-rest','Change over'],['round-rest','Rest'],['block-transition','Next block']]){
    const rest=timeline.findIndex(p=>p.kind===kind);assert.ok(rest>0,kind);h.app.enterGeneratedPhase(rest-1);
    assert.equal(next(h).textContent,timeline[rest-1].kind==='exercise'&&timeline[rest].kind===kind?label:next(h).textContent);assert.equal(next(h).textContent,previewName(timeline,rest-1));
    assert.equal(action(h),timeline[rest-1].timed?'Skip interval':'Next');
    h.app.enterGeneratedPhase(rest);assert.equal(next(h).textContent,previewName(timeline,rest));
  }
});
