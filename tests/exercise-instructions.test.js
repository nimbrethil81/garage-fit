const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { loadAppContext } = require('./helpers/app-context');

function setup() {
  const context = loadAppContext();
  const spoken = [], cancelled = [];
  context.speechSynthesis = { cancel(){ cancelled.push(true); }, speak(utterance){ spoken.push(utterance.text); } };
  return { context, spoken, cancelled, el:id=>context.document.getElementById(id) };
}

test('the same disclosure displays instructions only where the catalogue has one', () => {
  const { context, el } = setup();
  assert.equal(context.createInstructionDisclosure(vm.runInContext("CATALOGUE['air-squat']",context)), null);
  const info = context.createInstructionDisclosure(vm.runInContext("CATALOGUE['trx-knee-tuck']",context));
  assert.equal(info.children[0].textContent, 'How to do it');
  assert.match(info.children[1].textContent, /feet in the TRX straps/);
  context.setInstructionDisclosure('workoutInstruction', { id:'air-squat' });
  assert.equal(el('workoutInstruction').classList.contains('hidden'), true);
  context.setInstructionDisclosure('workoutInstruction', { id:'trx-knee-tuck' });
  assert.equal(el('workoutInstruction').classList.contains('hidden'), false);
  assert.match(el('workoutInstructionText').textContent, /feet in the TRX straps/);
  el('workoutInstruction').open = true;
  context.setInstructionDisclosure('workoutInstruction', { id:'wall-angel' });
  assert.equal(el('workoutInstruction').open, false);
  assert.match(el('workoutInstructionText').textContent, /back against a wall/);
});

test('generated preview adds a collapsed disclosure only for instructed exercises', () => {
  const { context, el } = setup();
  vm.runInContext("generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:10,focus:'balanced',equipment:['trx'],random:()=>0.4});generatorState.workout.main.blocks[0].exercises[0]=CATALOGUE['trx-knee-tuck'];generatorState.workout.main.blocks[0].exercises[1]=CATALOGUE['air-squat']",context);
  context.renderGeneratedPreview();
  const rows=el('previewList').children.filter(row=>row.className!=='preview-block-heading');
  assert.equal(rows[0].children[1].children.some(child=>child.className==='exercise-instruction'),true);
  assert.equal(rows[1].children[1].children.some(child=>child.className==='exercise-instruction'),false);
});

test('quiet instructions stay on screen; spoken ones queue behind the name once per exercise id and reset per session', () => {
  const { context, spoken } = setup();
  context.beginInstructionSession();
  context.announceExercise({id:'walking-lunge'},'Walking lunge. 20 reps');
  assert.deepEqual(spoken,['Walking lunge. 20 reps']);
  context.announceExercise({id:'air-squat'},'Air squat. 10 reps');
  assert.equal(spoken.at(-1),'Air squat. 10 reps');
  context.announceExercise({id:'trx-knee-tuck',name:'Custom label'},'Custom label. 10 reps');
  assert.deepEqual(spoken.slice(-2),['Custom label. 10 reps',vm.runInContext("CATALOGUE['trx-knee-tuck'].instruction",context)]);
  context.announceExercise({id:'trx-knee-tuck',name:'Another label'},'Another label. 10 reps');
  assert.equal(spoken.at(-1),'Another label. 10 reps');
  context.beginInstructionSession();
  context.announceExercise({id:'trx-knee-tuck'},'TRX knee tuck. 10 reps');
  assert.equal(spoken.at(-1),vm.runInContext("CATALOGUE['trx-knee-tuck'].instruction",context));
});

test('short timed work skips narration and movement cues still take precedence', () => {
  const { context, spoken, cancelled, el } = setup();
  vm.runInContext("CATALOGUE['body-hoops'].instruction='Rotate your hips in a circle, then change direction halfway through.';CATALOGUE['body-hoops'].voiceInstruction=true",context);
  const hoops=vm.runInContext("CATALOGUE['body-hoops']",context);
  context.beginInstructionSession();
  context.announceExercise(hoops,'Body hoops. 12 seconds',12);
  assert.deepEqual(spoken,['Body hoops. 12 seconds']);
  context.announceExercise(hoops,'Body hoops. 50 seconds',50);
  assert.equal(spoken.at(-1),hoops.instruction);
  const before=cancelled.length;
  const tracker=context.GarageFitTimedCues.createTracker(hoops.timedCues,50);
  context.showDueTimedCues(tracker,25,'workoutTimedCue');
  assert.equal(spoken.at(-1),'Change direction');
  assert.equal(el('workoutTimedCue').textContent,'Change direction');
  assert.equal(cancelled.length,before+1);
});

test('fixed and generated playback use catalogue identity and reset instruction state for new workouts', () => {
  const { context, spoken, el } = setup();
  vm.runInContext("FIXED_WORKOUTS.instructionSample={id:'instructionSample',name:'Sample',termination:{type:'fixed-rounds',rounds:1},exercises:[{id:'trx-knee-tuck',name:'Tuck one',reps:1},{id:'trx-knee-tuck',name:'Tuck two',reps:1}]}",context);
  context.startFixedWorkout('instructionSample');
  const instruction=vm.runInContext("CATALOGUE['trx-knee-tuck'].instruction",context);
  assert.equal(spoken.filter(value=>value===instruction).length,1);
  assert.equal(el('workoutInstruction').classList.contains('hidden'),false);
  context.completeWorkoutMovement();
  assert.equal(spoken.filter(value=>value===instruction).length,1);
  context.startFixedWorkout('instructionSample');
  assert.equal(spoken.filter(value=>value===instruction).length,2);

  vm.runInContext("generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:10,focus:'balanced',equipment:['trx'],random:()=>0.4})",context);
  context.startGeneratedWorkout();
  vm.runInContext("generatorState.timeline.push(Object.assign({},generatorState.timeline.find(p=>p.kind==='exercise'),{exercise:CATALOGUE['trx-knee-tuck'],timed:false,seconds:null}))",context);
  context.enterGeneratedPhase(vm.runInContext('generatorState.timeline.length-1',context));
  assert.equal(spoken.filter(value=>value===instruction).length,3);
  assert.equal(el('workoutInstruction').classList.contains('hidden'),false);
});

test('fixed timed and mixed sequences retain exercise ids for the shared player', () => {
  const { context, el } = setup();
  const intervals=new Map();let nextInterval=1;
  context.setInterval=callback=>{const id=nextInterval++;intervals.set(id,callback);return id;};
  context.clearInterval=id=>intervals.delete(id);
  context.document.readyState='loading';
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/workouts-ui.js'),'utf8'),context);
  context.GarageFitWorkoutUI.startTimedSequenceWorkout('eveningFullBodyReset');
  vm.runInContext("state.idx=4",context);
  const readyTimer=vm.runInContext('state.timer',context);
  for(let second=0;second<3;second++) intervals.get(readyTimer)();
  assert.equal(el('routineInstruction').classList.contains('hidden'),false);
  assert.match(el('routineInstructionText').textContent,/back against a wall/);
  context.GarageFitWorkoutUI.startFixedSequenceWorkout('postRunReset');
  assert.equal(vm.runInContext('state.list[0].id',context),'push-up');
  assert.equal(vm.runInContext('state.list[0].work',context),30);
});
