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

test('the shared disclosure displays canonical instructions and resets between exercises', () => {
  const { context, el } = setup();
  const squat = context.createInstructionDisclosure(vm.runInContext("CATALOGUE['air-squat']",context));
  assert.equal(squat.children[0].textContent, 'How to do it');
  assert.match(squat.children[1].textContent, /knees in line with your toes/);
  assert.equal(context.createInstructionDisclosure({id:'unknown'}), null);
  const info = context.createInstructionDisclosure(vm.runInContext("CATALOGUE['trx-knee-tuck']",context));
  assert.equal(info.children[0].textContent, 'How to do it');
  assert.match(info.children[1].textContent, /feet in the TRX straps/);
  context.setInstructionDisclosure('workoutInstruction', { id:'air-squat' });
  assert.equal(el('workoutInstruction').classList.contains('hidden'), false);
  assert.equal(el('workoutInstructionText').textContent, squat.children[1].textContent);
  context.setInstructionDisclosure('workoutInstruction', { id:'trx-knee-tuck' });
  assert.equal(el('workoutInstruction').classList.contains('hidden'), false);
  assert.match(el('workoutInstructionText').textContent, /feet in the TRX straps/);
  el('workoutInstruction').open = true;
  context.setInstructionDisclosure('workoutInstruction', { id:'wall-angel' });
  assert.equal(el('workoutInstruction').open, false);
  assert.match(el('workoutInstructionText').textContent, /back against a wall/);
});

test('reviewed kettlebell movements and separated stretches have clear instructions', () => {
  const { context } = setup();
  for (const id of ['kettlebell-deadlift','kettlebell-shoulder-press','single-arm-kettlebell-row','arm-across-pull','triceps-stretch']) {
    const instruction=vm.runInContext(`CATALOGUE[${JSON.stringify(id)}].instruction`,context);
    assert.ok(instruction && instruction.length<=180,id);
  }
  assert.match(vm.runInContext("CATALOGUE['single-arm-kettlebell-row'].instruction",context),/change sides halfway/i);
  assert.equal(vm.runInContext("CATALOGUE['hip-flexor-arm-stretch'].name",context),'Hip flexor stretch');
  assert.equal(vm.runInContext("CATALOGUE['trx-glute-standing'].name",context),'TRX glute stretch');
});

test('Arm Circles and the two knee movements have unambiguous catalogue copy', () => {
  const { context } = setup();
  const armCircles=context.GarageFitData.exercises['arm-side-circles'];
  const crossBody=context.GarageFitData.exercises['knee-to-opposite-elbow'];
  const highKnees=context.GarageFitData.exercises['high-knees'];
  assert.equal(armCircles.name,'Arm Circles');
  assert.equal(armCircles.instruction,'Extend your arms out to the sides and make controlled circles, changing direction halfway through.');
  assert.equal(crossBody.name,'Knee to Opposite Elbow');
  assert.equal(crossBody.instruction,'Stand tall and bring each knee towards the opposite elbow, alternating sides with a gentle torso rotation.');
  assert.equal(highKnees.name,'High Knees Running in Place');
  assert.equal(highKnees.instruction,'Run on the spot, driving your knees upwards and pumping your arms to build your heart rate.');
});

test("Runner's stretch is the plank-based lunge stretch in the Library and per-side player", () => {
  const { context, el }=setup();
  const stretch=context.GarageFitData.exercises['runners-stretch'];
  assert.equal(stretch.name,"Runner's stretch");
  assert.equal(stretch.bodyPosition,'floor');
  assert.equal(stretch.sidedness,'per-side');
  assert.deepEqual(JSON.parse(JSON.stringify(stretch.prescription)),{type:'unilateral-timed',value:15});
  assert.equal(stretch.estimatedSeconds,30);
  assert.match(stretch.instruction,/straight-arm plank.*foot outside the hand on that side.*back leg extended.*return to plank.*other side/);
  assert.doesNotMatch(stretch.instruction,/wall|calf/);
  context.openExerciseDetail(stretch.id);
  assert.equal(el('libraryDetailName').textContent,"Runner's stretch");
  assert.equal(el('libraryDetailInstruction').textContent,stretch.instruction);
  // Plans are dynamic: start seeded bodyweight cool-downs until one includes the stretch.
  context.Math=Object.assign(Object.create(Math),{random:(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;})(3)});
  for(let attempt=0;attempt<40&&!vm.runInContext('state.list',context).some(step=>step.id===stretch.id);attempt++)context.startRoutine('cooldown','bodyweight');
  const steps=vm.runInContext('state.list',context),names=[];
  for(let i=0;i<steps.length;i++)if(steps[i].id===stretch.id){
    vm.runInContext(`state.idx=${i}`,context);context.enterWork();
    names.push(el('exerciseName').textContent);
    assert.equal(el('routineInstructionText').textContent,stretch.instruction);
  }
  assert.deepEqual(names,["Runner's stretch - Right","Runner's stretch - Left"]);
  const phases=context.makeGeneratedExercisePhases(stretch,'cooldown',null,0);
  assert.deepEqual(Array.from(phases,phase=>[phase.side,phase.seconds]),[['right',15],['left',15]]);
});

test('generated preview adds a collapsed disclosure for familiar and complex exercises', () => {
  const { context, el } = setup();
  vm.runInContext("generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:10,focus:'balanced',equipment:['trx'],random:()=>0.4});generatorState.workout.main.blocks[0].exercises[0]=CATALOGUE['trx-knee-tuck'];generatorState.workout.main.blocks[0].exercises[1]=CATALOGUE['air-squat']",context);
  context.renderGeneratedPreview();
  const rows=el('previewList').children.filter(row=>row.className!=='preview-block-heading');
  assert.equal(rows[0].children[1].children.some(child=>child.className==='exercise-instruction'),true);
  assert.equal(rows[1].children[1].children.some(child=>child.className==='exercise-instruction'),true);
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

test('every Prep & Recover warm-up and cool-down variant displays instructions on every player step', () => {
  const { context, el }=setup();
  const catalogue=context.GarageFitData.exercises;
  for (const kind of ['warmup','cooldown']) for (const variant of ['bodyweight','equipment']) {
    context.startRoutine(kind,variant);
    const steps=vm.runInContext('state.list',context);
    for (let i=0;i<steps.length;i++) {
      vm.runInContext(`state.idx=${i}`,context);
      context.enterWork();
      assert.equal(el('routineInstruction').classList.contains('hidden'),false,steps[i].id);
      assert.equal(el('routineInstructionText').textContent,catalogue[steps[i].id].instruction,steps[i].id);
      assert.equal(el('exerciseName').textContent,steps[i].name);
    }
    // Per-side stretches play as named right and left steps.
    for (const step of Array.from(steps).filter(step=>step.side)) assert.equal(step.name,catalogue[step.id].name+' - '+(step.side==='right'?'Right':'Left'));
  }
});

test('generated player instructions cover preparation, Main and unilateral timed cool-downs', () => {
  const { context, el }=setup();
  vm.runInContext("generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:10,focus:'balanced',equipment:['trx'],random:()=>0.4});generatorState.workout.cooldown.exercises=[CATALOGUE['kneeling-hamstring'],CATALOGUE['side-stretch']]",context);
  context.startGeneratedWorkout();
  const timeline=vm.runInContext('generatorState.timeline',context);
  const sections=new Set(),hamstrings=[];
  for (let i=0;i<timeline.length;i++) {
    const phase=timeline[i];if(phase.kind!=='exercise')continue;
    context.enterGeneratedPhase(i);sections.add(phase.section);
    assert.equal(el('workoutInstruction').classList.contains('hidden'),false,phase.exercise.id);
    assert.equal(el('workoutInstructionText').textContent,context.GarageFitData.exercises[phase.exercise.id].instruction);
    if(phase.exercise.id==='kneeling-hamstring')hamstrings.push([phase.side,phase.seconds]);
    if(phase.exercise.id==='side-stretch'){
      assert.match(el('workoutInstructionText').textContent,/changing sides halfway/);
      const tracker=context.GarageFitTimedCues.createTracker(phase.exercise.timedCues,phase.seconds);
      context.showDueTimedCues(tracker,phase.seconds/2,'workoutTimedCue');
      assert.equal(el('workoutTimedCue').textContent,'Change sides');
    }
  }
  assert.deepEqual([...sections],['warmup','main','cooldown']);
  assert.deepEqual(hamstrings,[['right',15],['left',15]]);
  assert.match(context.GarageFitData.exercises['kneeling-hamstring'].instruction,/straight in front.*straight back.*other side/);
});

test('fixed post-run stretches use clarified names and canonical instructions on each side', () => {
  const { context, el }=setup();
  context.document.readyState='loading';
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/workouts-ui.js'),'utf8'),context);
  context.GarageFitWorkoutUI.startFixedSequenceWorkout('postRunReset');
  const steps=vm.runInContext('state.list',context);
  for(let i=0;i<steps.length;i++){
    vm.runInContext(`state.idx=${i}`,context);context.enterWork();
    assert.equal(el('routineInstruction').classList.contains('hidden'),false,steps[i].id);
    assert.equal(el('routineInstructionText').textContent,context.GarageFitData.exercises[steps[i].id].instruction);
    if(steps[i].id==='kneeling-hamstring')assert.match(el('exerciseName').textContent,/Kneeling hamstring stretch - (Left|Right)/);
    if(steps[i].id==='standing-quads')assert.match(el('exerciseName').textContent,/Standing quadriceps stretch - (Left|Right)/);
  }
});

test('spoken exercise cues separate side and quantity into queued utterances without timers', () => {
  const { context, spoken, cancelled } = setup();
  const parts = (...a) => JSON.parse(vm.runInContext(`JSON.stringify(exerciseCueParts(${a.map(x => JSON.stringify(x)).join(',')}))`, context));
  assert.deepEqual(parts('Kneeling hamstring stretch - Left', '30 seconds'), ['Kneeling hamstring stretch, left side.', '30 seconds']);
  assert.deepEqual(parts('Kneeling hamstring stretch', '30 seconds', 'Right'), ['Kneeling hamstring stretch, right side.', '30 seconds']);
  assert.deepEqual(parts('Body hoops', '12 seconds'), ['Body hoops. 12 seconds']);
  context.announceExercise({ id: 'none' }, parts('Runner\'s stretch - Left', '30 seconds'), 30);
  assert.deepEqual(spoken, ['Runner\'s stretch, left side.', '30 seconds']);
  assert.equal(cancelled.length, 1, 'one cancel per cue clears stale speech');
});
