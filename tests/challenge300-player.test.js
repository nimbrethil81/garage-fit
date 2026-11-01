const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {loadAppContext}=require('./helpers/app-context');
const copy=x=>JSON.parse(JSON.stringify(x));
function harness(){
  let now=1000;
  const storage=new Map([['gf_300_pb_seconds','120']]);
  const app=loadAppContext(storage,{ownIntrinsics:true,configure(c){c.performance={now:()=>now};}});
  const run=code=>vm.runInContext(code,app);
  run("state.ownedEquipment=['dumbbells','kettlebell','trx','pullup-bar','bench','barbell','box'];");
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js/workouts-ui.js'),'utf8'),app);
  const plan=run('GarageFitChallenge300.generate({catalogue:CATALOGUE,equipment:state.ownedEquipment,random:(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296})(91)})');
  return {app,run,plan,storage,el:id=>app.document.getElementById(id),time:ms=>now+=ms};
}

test('public legacy AMRAP cannot start while generated Challenge requires reviewed prescription',()=>{
  const h=harness();h.app.startFixedWorkout('cindy');
  assert.equal(h.run('workoutState.running'),false);
  assert.equal(h.app.GarageFitWorkoutUI.detailDefinition('cindy'),null);
  h.app.startWorkout();
  const detail=h.app.GarageFitWorkoutUI.detailDefinition('workout300');
  assert.equal(h.run('workoutState.running'),false,'opening a preview never starts the clock');
  assert.equal(detail.exercises.length,7);
  assert.deepEqual(Array.from(detail.exercises,e=>parseInt(e.target)),[25,50,50,50,50,50,25]);
  assert.equal(detail.personalBest,undefined,'old fixed PB is not a generated challenge baseline');
  assert.match(detail.description,/mini-sets[\s\S]*clock keeps running/);
  assert.match(detail.description,/Only full exercise targets are recorded/);
});

test('Challenge player freezes exact reviewed targets and resists rapid Next taps',()=>{
  const h=harness(),reviewed=copy(h.plan);
  h.app.startChallenge300(h.plan);
  assert.equal(h.el('workoutPlayerTitle').textContent,'300-Rep Challenge');
  assert.equal(h.el('workoutTarget').textContent,'25 reps');
  assert.equal(h.run('Object.isFrozen(workoutState.challenge)'),true);
  h.plan.exercises[0].reps=999;
  assert.equal(h.run('activeFixedExercises()[0].reps'),25);
  h.app.completeWorkoutMovement();h.app.completeWorkoutMovement();
  assert.equal(h.run('workoutState.idx'),1);
  assert.equal(h.el('workoutTarget').textContent,'50 reps');
  h.time(400);h.app.completeWorkoutMovement();
  assert.equal(h.run('workoutState.idx'),2);
  assert.equal(h.run('activeFixedExercises()[2].id'),reviewed.exercises[2].exerciseId);
  h.app.previousWorkoutMovement();
  assert.equal(h.run('workoutState.idx'),1);
  assert.equal(h.run('workoutState.completed[1]'),false);
});

test('self-paced rests keep elapsed time running, explicit pause freezes time and navigation',()=>{
  const h=harness();h.app.startChallenge300(h.plan);
  h.time(40000);assert.equal(h.run('currentWorkoutElapsedMs()'),40000);
  h.app.pauseWorkoutClock();h.time(50000);h.app.completeWorkoutMovement();
  assert.equal(h.run('currentWorkoutElapsedMs()'),40000);
  assert.equal(h.run('workoutState.idx'),0);
  h.app.resumeWorkoutClock();h.time(30000);
  assert.equal(h.run('currentWorkoutElapsedMs()'),70000);
  h.app.completeWorkoutMovement();
  assert.equal(h.run('currentWorkoutElapsedMs()'),70000,'confirming a target never resets the clock');
});

test('completion persists the exact generated prescription and leaves historical PB untouched',()=>{
  const h=harness(),reviewed=copy(h.plan);h.app.startChallenge300(h.plan);
  for(let i=0;i<7;i++){h.time(45000);h.app.completeWorkoutMovement();}
  assert.equal(h.run('workoutState.running'),false);
  assert.equal(h.storage.get('gf_300_pb_seconds'),'120');
  const result=copy(h.run('workoutState.result'));
  assert.equal(result.elapsedSeconds,315);
  assert.equal(result.status,'completed');
  assert.deepEqual(result.prescription.exercises,reviewed.exercises);
  assert.equal(h.el('doneBest').classList.contains('hidden'),true);
  h.app.completeWorkoutMovement();
  assert.equal(h.run('GarageFitChallenge300.readHistory(localStorage).results.length'),1,'completion is idempotent');
});
