const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');

function harness(){
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  vm.runInContext(fs.readFileSync('js/workouts-ui.js','utf8'),app,{filename:'js/workouts-ui.js'});
  vm.runInContext('state.ownedEquipment=GarageFitData.equipment.map(item=>item.id)',app);
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id),timers=new Map();let timer=0;
  app.setInterval=callback=>{timers.set(++timer,callback);return timer};app.clearInterval=id=>timers.delete(id);
  return {app,run,el,tick(seconds=1){for(let i=0;i<seconds;i++)timers.get(run('state.timer'))?.()}};
}

test('every routine entry point uses the ring and immediate Next name, then freezes/resumes its existing countdown',()=>{
  for(const entry of ["startRoutine('warmup','bodyweight')","startRoutine('cooldown','bodyweight')","startRoutine('rampup')","startSevenMinuteWorkout()","openSnack();startSnack(0)","GarageFitWorkoutUI.startTimedSequenceWorkout('abBlast')","GarageFitWorkoutUI.startTimedSequenceWorkout('eveningFullBodyReset')","GarageFitWorkoutUI.startFixedSequenceWorkout('postRunReset')"]){
    const h=harness();h.run(entry);assert.equal(h.el('routineNextAction').textContent,'Next',entry);
    assert.equal(h.el('routineNextName').textContent,h.app.activityName(h.run('state.list[0]')));
    assert.equal(h.el('routineRing').classList.contains('hidden'),false);assert.equal(h.el('routinePause').classList.contains('hidden'),true);
    h.tick(3);assert.equal(h.run('state.phase'),'work');const remaining=h.run('state.remaining'),offset=h.el('ringFg').style.strokeDashoffset;
    h.app.togglePause();assert.equal(h.el('routineRing').attributes['aria-pressed'],'true');assert.match(h.el('routineRing').attributes['aria-label'],/resume timer/);
    h.tick(5);assert.equal(h.run('state.remaining'),remaining);assert.equal(h.el('ringFg').style.strokeDashoffset,offset);assert.equal(h.el('skipPhaseBtn').disabled,true);
    h.app.togglePause();h.tick();assert.equal(h.run('state.remaining'),remaining-1);assert.equal(h.el('routineRing').attributes['aria-pressed'],'false');
    assert.equal(h.el('routineNextAction').textContent,'Next');
  }
});

test('routine Next skips work without completion credit and previews intervening rest; auto-advance still completes work',()=>{
  const h=harness();h.app.startRoutine('warmup','bodyweight');
  h.run("state.list=[{id:'arm-side-circles',name:'Arm circles',work:3,rest:2},{id:'standing-quads',name:'Standing quad stretch - Right',work:4,rest:0}];state.idx=0");
  const outcomes=[];h.app.recordRoutineOccurrence=status=>outcomes.push(status);
  h.app.skipPhase();assert.equal(h.el('routineNextName').textContent,'Rest');
  h.app.togglePause();h.app.skipPhase();assert.equal(h.run('state.phase'),'work');assert.deepEqual(outcomes,[]);
  h.app.togglePause();h.app.skipPhase();assert.deepEqual(outcomes,['skipped']);assert.equal(h.run('state.phase'),'rest');
  assert.equal(h.el('routineNextName').textContent,'Standing quad stretch');assert.equal(h.el('routineNextAction').textContent,'Next');
  h.tick(2);assert.equal(h.run('state.idx'),1);assert.equal(h.el('routineNextName').textContent,'');assert.equal(h.el('routineNextAction').textContent,'Next');
  h.tick(4);assert.deepEqual(outcomes,['skipped','completed']);assert.equal(h.run('state.running'),false);
});

test('routine exit/cancel restores the original pause state and ignores controls behind the dialog',()=>{
  const h=harness();h.app.startSevenMinuteWorkout();h.tick(3);h.tick();const remaining=h.run('state.remaining');
  h.app.openExitDialog('routine');h.app.togglePause();h.app.skipPhase();h.tick(5);assert.equal(h.run('state.remaining'),remaining);assert.equal(h.run('state.paused'),true);
  h.app.cancelExit();assert.equal(h.run('state.paused'),false);h.tick();assert.equal(h.run('state.remaining'),remaining-1);
  h.app.togglePause();h.app.openExitDialog('routine');h.app.cancelExit();assert.equal(h.run('state.paused'),true);
  h.app.openExitDialog('routine');h.app.confirmExitChoice();assert.equal(h.run('state.running'),false);h.app.togglePause();assert.equal(h.run('state.running'),false);
});

test('untimed fixed-sequence reps have a target and accessible pause, then restore the ring for timed work',()=>{
  const h=harness();h.run("FIXED_WORKOUTS.testReps={name:'Reps',termination:{type:'fixed-sequence'},exercises:[{id:'push-up',name:'Push-ups',reps:5,transitionAfter:0},{id:'dead-bug',name:'Dead bug',durationSeconds:10}]}");
  h.app.GarageFitWorkoutUI.startFixedSequenceWorkout('testReps');h.tick(3);
  assert.equal(h.el('routineRing').classList.contains('hidden'),true);assert.equal(h.el('routinePause').classList.contains('hidden'),false);assert.equal(h.el('routineTarget').textContent,'5 reps');assert.equal(h.el('routineNextAction').textContent,'Next');
  h.app.togglePause();h.app.GarageFitWorkoutUI.skipFixedSequence();assert.equal(h.run('state.idx'),0);
  h.app.togglePause();h.app.GarageFitWorkoutUI.skipFixedSequence();assert.equal(h.run('state.idx'),1);assert.equal(h.el('routineRing').classList.contains('hidden'),false);assert.equal(h.el('routinePause').classList.contains('hidden'),true);
  h.tick(10);assert.equal(h.run('state.running'),false);
});

test('both timer buttons share the original centre classes, geometry and responsive rules with no obsolete preview/pause layout',()=>{
  const html=fs.readFileSync('index.html','utf8'),ui=fs.readFileSync('js/workouts-ui.js','utf8');
  for(const id of ['routineRing','workoutRing']){
    const ring=html.match(new RegExp('<button class="ring-wrap" id="'+id+'"[\\s\\S]*?</button>'))[0];
    assert.match(ring,/type="button" aria-pressed="false" aria-label="Pause timer"/);assert.match(ring,/viewBox="0 0 200 200"/);assert.match(ring,/cx="100" cy="100" r="90"/);assert.match(ring,/class="phase-label"/);assert.match(ring,/class="timer-num"/);assert.match(ring,/class="reps-num hidden"/);
  }
  assert.doesNotMatch(html+ui,/nextPreview|pauseBtn|workout-ring-num|workout-ring-state|workout-ring\{/);
  assert.match(html,/width:min\(72vw,330px\);height:min\(72vw,330px\)/);assert.match(html,/\.timer-num\{font-size:82px/);
});
