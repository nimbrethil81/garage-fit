const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context');

const plain = value => JSON.parse(JSON.stringify(value));

function harness({unsupported = false, busy = false} = {}) {
  let now = 0, timerId = 0;
  const timers = new Map(), utterances = [], cancelled = [], visibilityListeners = [];
  const voice = {name:'English UK',lang:'en-GB',voiceURI:'uk'};
  let active = null;
  const synthesis = {
    get speaking() { return busy && !!active; },
    pending:false,
    speak(utterance) {active = utterance; utterances.push(utterance);},
    cancel() {
      if (active) {cancelled.push(active.text); active.onerror?.();}
      active = null;
    },
    getVoices() {return [voice];}
  };
  const app = loadAppContext(new Map(), {rampupUi:true, configure(context) {
    context.performance = {now:()=>now};
    context.wallNow = ()=>100000+now;
    context.document.visibilityState = 'visible';
    context.document.addEventListener = (name, listener) => {
      if (name === 'visibilitychange') visibilityListeners.push(listener);
    };
    context.setInterval = cb => {timers.set(++timerId,cb); return timerId;};
    context.clearInterval = id => timers.delete(id);
    context.speechSynthesis = unsupported ? undefined : synthesis;
  }});
  const run = code=>vm.runInContext(code,app);
  run('Date.now=wallNow');
  app.chooseSpokenVoice('0');
  const step = async (ms = 250, player = 'workoutState.timer') => {now += ms; await timers.get(run(player))?.();};
  async function generated(blocks, parts = {}, kit = ['kettlebell','dumbbells','box']) {
    app.fixture = {schemaVersion:2, duration:20, focus:'balanced',
      warmup:{exercises:[],restSeconds:0}, rampup:{exercises:[],restSeconds:0},
      cooldown:{exercises:[],restSeconds:0}, main:{blocks},...parts};
    app.kit = kit;
    run('generatorState.workout=fixture;state.ownedEquipment=kit;');
    const timeline = plain(app.buildGeneratedTimeline(app.fixture));
    app.startGeneratedWorkout();
    assert.deepEqual(plain(run('generatorState.timeline')),timeline);
    return timeline;
  }
  const phase = () => run('currentGeneratedPhase()');
  const workoutCue = () => app.document.getElementById('workoutEquipmentCue').textContent;
  const routineCue = () => app.document.getElementById('routineEquipmentCue').textContent;
  const exercise = (id, options = {}) => ({...app.GarageFitData.exercises[id], ...options});
  const equipmentSpeech = () => utterances.filter(u=>u.text.startsWith('Get your '));
  return {app, run, step, generated, phase, workoutCue, routineCue, exercise, equipmentSpeech, utterances, cancelled, voice,
    endSpeech() {const ended=active;active=null;ended?.onend?.();},
    async visibility(value) {
      app.document.visibilityState = value;
      for (const listen of visibilityListeners) await listen();
    },
    get active() {return active;},
    get now() {return now;}};
}
const rounds = (exercises, rest=0, count=1) => ({id:'fixture',protocol:'rounds',exercises,
  prescription:{rounds:count,exerciseRestSeconds:rest,roundRestSeconds:rest}});

test('equipment resolver handles every catalogue ID, AND-of-OR groups and a future canonical ID', () => {
  const {app} = harness();
  const {equipment, exercises} = app.GarageFitData;
  const future = {id:'sled',name:'Sled'};
  const resolve = owned => app.GarageFitEquipmentCues.createResolver(exercises,[...equipment,future],app.GarageFitGenerator.sectionEquipmentSetup,owned);
  const all = [...equipment,future].map(item=>[item.id]);
  assert.deepEqual(plain(resolve([]).groups({id:'air-squat'})),[]);
  assert.deepEqual(plain(resolve(all.flat()).groups({equipment:all})),plain(all));
  const exercise = {equipment:[['dumbbells'],['bench','box'],['dumbbells']]};
  assert.equal(resolve(['bench','box']).label(resolve(['bench','box']).groups(exercise)),'dumbbells and bench');
  assert.equal(resolve(['box']).label(resolve(['box']).groups(exercise)),'dumbbells and box');
  assert.equal(resolve([]).label(resolve([]).groups(exercise)),'dumbbells and either bench or box');
  assert.deepEqual(exercise.equipment,[['dumbbells'],['bench','box'],['dumbbells']]);
});

test('a useful rest combines new items, waits for priority speech and holds the visual until first use',async()=>{
  const h=harness({busy:true});
  const kit=h.exercise('goblet-squat',{equipment:[['kettlebell'],['bench','box']]});
  await h.generated([rounds([h.exercise('push-up'),kit,h.exercise('kettlebell-swing')],20,2)]);
  h.app.enterGeneratedPhase(1);
  assert.equal(h.workoutCue(),'');
  h.app.enterGeneratedPhase(2);
  assert.equal(h.workoutCue(),'Get ready: kettlebell and box');
  await h.step(1000);
  assert.equal(h.equipmentSpeech().length,0);
  h.endSpeech();
  await h.step(1000);
  assert.equal(h.equipmentSpeech()[0]?.text,'Get your kettlebell and box ready.');
  assert.equal(h.equipmentSpeech()[0].voice?.voiceURI,h.voice.voiceURI);
  h.endSpeech();
  h.app.renderGeneratedPhase();
  assert.equal(h.workoutCue(),'Get ready: kettlebell and box');
  assert.equal(h.equipmentSpeech().length,1);
  h.app.enterGeneratedPhase(3);
  assert.equal(h.workoutCue(),'');
  h.app.previousGeneratedPhase();
  assert.equal(h.workoutCue(),'');
  h.app.enterGeneratedPhase(2);
  assert.equal(h.workoutCue(),'');
  h.app.enterGeneratedPhase(8);
  assert.equal(h.workoutCue(),'');
});

test('short recovery looks back to timed work and yields to the midpoint and 3-2-1',async()=>{
  const h=harness({busy:true});
  const timed=h.exercise('body-hoops',{prescription:{type:'timed',value:24}});
  const target=h.exercise('goblet-squat',{equipment:[['kettlebell']]});
  await h.generated([rounds([timed,target],3)]);
  h.app.enterGeneratedPhase(1);
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  h.endSpeech();
  await h.step(1500);
  const low=h.active;
  assert.equal(low?.text,'Get your kettlebell ready when you can.');
  await h.step(10500,'generatorState.phaseTimer');
  assert.equal(h.active?.text,'Change direction');
  assert.ok(h.cancelled.includes(low.text));
  low.onend(); // A stale browser event must not count as delivery.
  h.endSpeech();
  for (let second=13; second<=23; second++) await h.step(1000,'generatorState.phaseTimer');
  await h.step();
  assert.deepEqual(Array.from(h.app.playerAudioDiagnostics().filter(event=>event.event==='tick-eligible'),event=>event.position),[3,2,1]);
  assert.equal(h.equipmentSpeech().length,1);
  h.app.enterGeneratedPhase(2);
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  h.app.generatedPrimaryAction();
  assert.equal(h.phase().exercise.id,target.id);
  assert.equal(h.workoutCue(),'');
  await h.step(5000);
  assert.equal(h.equipmentSpeech().length,1);
  assert.deepEqual(h.utterances.filter(u=>u.text==='Change direction').map(u=>u.text),['Change direction']);
});

test('the safety cutoff releases a timed equipment offer for one later safe window',async()=>{
  const h=harness({busy:true});
  const timed=h.exercise('body-hoops',{prescription:{type:'timed',value:24}});
  await h.generated([rounds([timed,h.exercise('kettlebell-goblet-squat')],3)]);
  h.app.enterGeneratedPhase(1);
  h.endSpeech();
  await h.step(1500);
  const cancelled=h.active;
  assert.equal(cancelled?.text,'Get your kettlebell ready when you can.');
  await h.step(10250);
  assert.equal(h.active,null,'cut off before the midpoint');
  assert.deepEqual(h.cancelled.slice(-1),[cancelled.text]);
  cancelled.onend();
  await h.step(250,'generatorState.phaseTimer');
  assert.equal(h.active?.text,'Change direction');
  await h.step();
  assert.equal(h.equipmentSpeech().length,1,'the midpoint still owns speech');
  h.endSpeech();
  await h.step();
  assert.equal(h.equipmentSpeech().length,2);
  assert.equal(h.active?.text,cancelled.text);
  h.endSpeech();
  await h.step();
  assert.equal(h.equipmentSpeech().length,2,'completion consumes the offer');
  h.app.enterGeneratedPhase(3);
  await h.step();
  assert.equal(h.equipmentSpeech().length,2,'the first use closes the opportunity');
});

test('foreground return shows equipment first reached while hidden and never speaks that stale offer',async()=>{
  const h=harness({busy:true});
  await h.generated([rounds([h.exercise('push-up'),h.exercise('kettlebell-goblet-squat'),h.exercise('kettlebell-swing')])]);
  await h.visibility('hidden');
  h.app.enterGeneratedPhase(1);
  assert.equal(h.workoutCue(),'','a new cue stays unpresented while hidden');
  h.endSpeech();
  await h.step();
  assert.equal(h.equipmentSpeech().length,0);
  h.app.enterGeneratedPhase(2);
  await h.visibility('visible');
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  h.endSpeech();
  await h.step();
  assert.equal(h.equipmentSpeech().length,0);
  h.app.enterGeneratedPhase(3);
  assert.equal(h.workoutCue(),'','later use must not repeat a foreground cue');
  h.app.previousGeneratedPhase();
  assert.equal(h.workoutCue(),'','Previous must not repeat a foreground cue');
});

test('foreground return shows still-upcoming equipment and drops an opportunity that passed hidden',async()=>{
  for (const passed of [false,true]) {
    const h=harness({unsupported:true});
    await h.generated([rounds([h.exercise('push-up'),h.exercise('kettlebell-goblet-squat'),h.exercise('air-squat')])]);
    await h.visibility('hidden');
    h.app.enterGeneratedPhase(1);
    if (passed) h.app.enterGeneratedPhase(3);
    await h.visibility('visible');
    assert.equal(h.workoutCue(),passed?'':'Get ready: kettlebell');
    if (!passed) {
      await h.visibility('hidden');
      await h.visibility('visible');
      assert.equal(h.workoutCue(),'Get ready: kettlebell');
      h.app.enterGeneratedPhase(2);
      assert.equal(h.workoutCue(),'','the previously visible cue is covered at use');
    }
  }
});

test('a rep phase waits for its existing speech and can resume an interrupted attempt',async()=>{
  const h=harness({busy:true});
  await h.generated([rounds([h.exercise('push-up'),h.exercise('goblet-squat',{equipment:[['kettlebell']]})])]);
  h.app.enterGeneratedPhase(1);
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  await h.step();
  assert.equal(h.equipmentSpeech().length,0);
  h.endSpeech();
  await h.step();
  assert.equal(h.equipmentSpeech().length,1);
  h.app.pauseWorkoutClock();
  await h.step(1500);
  assert.equal(h.active,null);
  h.app.resumeWorkoutClock();
  await h.step(1000);
  assert.equal(h.equipmentSpeech().length,2);
  h.endSpeech();
  h.app.pauseWorkoutClock();h.app.resumeWorkoutClock();
  await h.step();
  assert.equal(h.equipmentSpeech().length,2);
  h.app.goGenerator();
  assert.equal(h.workoutCue(),'');
  h.app.startGeneratedWorkout();
  h.app.enterGeneratedPhase(1);
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
});

test('a preview substitution and a Coach inventory use the final first exercise and share playback rules',async()=>{
  const h=harness({unsupported:true});
  const first=h.exercise('step-ups',{equipment:[['bench','box']]});
  await h.generated([rounds([h.exercise('push-up'),h.exercise('goblet-squat',{equipment:[['kettlebell']]})])], {
    warmup:{restSeconds:0,exercises:[]},
    rampup:{restSeconds:0,exercises:[{...first,prescription:{type:'timed',value:20}}]}
  }, ['bench','kettlebell']);
  h.run("showScreen('generatedPreview'); renderGeneratedPreview()");
  assert.equal(h.app.document.getElementById('generatorEquipmentPreview').textContent,'Get ready: bench');
  h.run("generatorState.workout.rampup.exercises[0].equipment=[['dumbbells']]; renderGeneratedPreview()");
  assert.equal(h.app.document.getElementById('generatorEquipmentPreview').textContent,'Get ready: dumbbells');
  h.app.startStandaloneGeneratedWorkout();
  assert.equal(h.workoutCue(),'');
  h.run("generatorState.workout.rampup.exercises[0].equipment=[['bench','box']]");
  h.app.startGeneratedWorkout(null,['box','kettlebell']);
  assert.equal(h.workoutCue(),'Get ready: box');
  h.app.enterGeneratedPhase(1);
  assert.doesNotMatch(h.workoutCue(),/box/);
  assert.equal(h.equipmentSpeech().length,0);
});

test('routine and fixed runs resolve canonical equipment and leave exact playback plans alone',async()=>{
  const h=harness({unsupported:true});
  h.run("state.ownedEquipment=['dumbbells','bands','trx','rings','kettlebell','barbell','bench','box','pullup-bar'];startRoutine('warmup','equipment')");
  const routine=h.run('state.routine');
  assert.equal(h.run('state.list.reduce((sum,ex)=>sum+ex.work+ex.rest,0)'),300);
  assert.equal(h.run('state.remaining'),3);
  const first=h.exercise(routine.exercises[0].id);
  assert.equal(!!h.routineCue(),!!first.equipment.length);
  h.app.skipPhase();
  assert.equal(h.run('state.remaining'),h.run('state.list[0].work'));
  h.app.goHome();
  assert.equal(h.routineCue(),'');
  h.run(`startResolvedFixedWorkout({id:'fixture', name:'Rep fixture',termination:{type:'fixed-rounds',rounds:2},exercises:[
    {id:'push-up',reps:7},{id:'kettlebell-goblet-squat',reps:8},{id:'kettlebell-swing',reps:9}
  ]},['kettlebell'])`);
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  h.app.completeWorkoutMovement();
  assert.equal(h.workoutCue(),'');
  assert.equal(h.run('completedWorkoutReps()'),7);
  h.app.previousWorkoutMovement();
  assert.equal(h.workoutCue(),'');
  h.app.goWorkouts();
  h.app.startSevenMinuteWorkout();
  assert.equal(h.workoutCue(),'');
});

test('an earlier recovery beats a short transition and the cue persists across intervening work',async()=>{
  const h=harness({unsupported:true});
  await h.generated([rounds([h.exercise('kettlebell-goblet-squat')])], {
    warmup:{restSeconds:15,exercises:[h.exercise('arm-side-circles'),h.exercise('body-hoops',{prescription:{type:'timed',value:4}})]}
  });
  h.app.enterGeneratedPhase(2);
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  h.app.enterGeneratedPhase(3);
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  h.app.enterGeneratedPhase(4);
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  h.app.enterGeneratedPhase(5);
  assert.equal(h.workoutCue(),'');
});

test('EMOM uses settled recovery, keeps its minute boundary and drops prompts on skip-rest',async()=>{
  const h=harness({busy:true});
  const exercises=[h.exercise('push-up'),h.exercise('plank',{equipment:[['box']]})];
  const block={id:'emom-kit',protocol:'emom',intent:'conditioning',exercises,
    prescription:{minutes:3,slotSeconds:60,targets:[{type:'reps',value:6},{type:'timed',value:20}]}};
  const timeline=await h.generated([block]);
  assert.deepEqual(timeline.filter(p=>p.protocol==='emom').map(p=>p.startsAtSeconds),[0,60,120]);
  h.app.enterGeneratedPhase(1);
  assert.equal(h.workoutCue(),'Get ready: box');
  h.endSpeech();
  await h.step(1500);
  assert.equal(h.equipmentSpeech().length,0);
  await h.app.updateEmomMinute('done');
  await h.step(1000);
  assert.equal(h.active?.text,'Get your box ready.');
  assert.equal(h.run('emomRun().originMs'),0);
  const obsolete=h.active;
  await h.app.updateEmomMinute('skip-rest');
  assert.equal(h.phase().minute,2);
  assert.equal(h.run('generatorState.remaining'),60);
  assert.equal(h.workoutCue(),'');
  assert.ok(h.cancelled.includes(obsolete.text));
  obsolete.onend();
  h.endSpeech();
  await h.step(5000);
  assert.equal(h.equipmentSpeech().length,1);
});

test('an inserted recovery keeps the pending cue attached to its movement and offers it once',async()=>{
  const h=harness({busy:true});
  const emom={id:'emom-insert',protocol:'emom',intent:'conditioning',exercises:[h.exercise('push-up')],
    prescription:{minutes:1,slotSeconds:60,targets:[{type:'reps',value:6}]}};
  const timeline=await h.generated([emom,rounds([h.exercise('kettlebell-goblet-squat'),h.exercise('kettlebell-swing')])]);
  h.app.enterGeneratedPhase(1);
  await h.step(4500);
  await h.app.updateEmomMinute('done');
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  const target=h.run('generatorState.timeline[3]');
  assert.equal(target.occurrenceId,timeline[3].occurrenceId);
  h.run("generatorState.timeline.splice(2,0,{kind:'rest',section:'main',seconds:15})");
  await h.step(400);
  assert.equal(h.equipmentSpeech().length,0,'the minute announcement keeps the prep cue pending');
  await h.app.updateEmomMinute('skip-rest');
  assert.equal(h.phase().kind,'rest');
  assert.equal(h.run('generatorState.remaining'),15);
  assert.equal(h.workoutCue(),'Get ready: kettlebell','the pending cue follows the original target across the insertion');
  h.endSpeech();
  await h.step(1000);
  assert.equal(h.active?.text,'Get your kettlebell ready.','the inserted recovery supplies a speech window');
  h.endSpeech();
  h.app.generatedPrimaryAction();
  assert.equal(h.phase().kind,'block-transition');
  h.app.enterGeneratedPhase(4);
  assert.equal(h.phase(),target);
  assert.equal(h.phase().occurrenceId,timeline[3].occurrenceId);
  assert.equal(h.workoutCue(),'');
  h.app.enterGeneratedPhase(5);
  await h.step(1000);
  assert.equal(h.workoutCue(),'');
  assert.equal(h.equipmentSpeech().length,1);
});

test('capped density and AMRAP prepare the established successor only after the cap resolves',async()=>{
  const {blockFixtures}=require('./helpers/protocol-fixtures');
  for (const protocol of ['density','amrap']) {
    const h=harness({busy:true});
    const block=blockFixtures(h.app.GarageFitData.exercises,{density:true,amrap:true})[protocol];
    const cap=block.prescription.timeCapSeconds ?? block.prescription.capSeconds;
    const next=rounds([h.exercise('kettlebell-goblet-squat')]);
    await h.generated([block,next],{},['kettlebell','trx']);
    h.app.enterGeneratedPhase(1);
    for (let i=0; i<(protocol==='amrap'?4:1); i++) {
      assert.doesNotMatch(h.workoutCue(),/kettlebell/);
      h.endSpeech();
      await h.step(1000);
      if (protocol==='amrap') await h.app.advanceAmrapBlock('done');
      else await h.app.updateDensityBlock('done');
    }
    if (protocol==='amrap') assert.equal(h.run('amrapBlockRun().round'),2);
    const elapsed=h.run('currentWorkoutElapsedMs()');
    await h.step((cap+2)*1000-elapsed,'generatorState.phaseTimer');
    assert.equal(h.workoutCue(),'Get ready: kettlebell');
    assert.match(h.active?.text,protocol==='amrap'?/^Time is up/:/^Time cap reached/);
    await h.step();
    assert.equal(h.equipmentSpeech().length,0,'the cap announcement takes priority');
    h.endSpeech();
    await h.step();
    assert.equal(h.active?.text,'Get your kettlebell ready.');
    h.endSpeech();
    if (protocol==='amrap') await h.app.advanceAmrapBlock('skip');
    else await h.app.updateDensityBlock('done');
    assert.equal(h.phase().kind,'block-transition');
    assert.equal(h.workoutCue(),'Get ready: kettlebell');
    h.app.enterGeneratedPhase(h.run('generatorState.timelineIndex+1'));
    assert.equal(h.phase().exercise.id,'kettlebell-goblet-squat');
    assert.equal(h.workoutCue(),'');
    await h.step();
    assert.equal(h.equipmentSpeech().length,1);
  }
});

test('the final density target can prepare the next exercise before the three-second changeover',async()=>{
  const h=harness({busy:true});
  const {blockFixtures}=require('./helpers/protocol-fixtures');
  const block=blockFixtures(h.app.GarageFitData.exercises,{density:true}).density;
  const timeline=await h.generated([block,rounds([h.exercise('kettlebell-goblet-squat')])]);
  const last=timeline.findLastIndex(phase=>phase.protocol==='density');
  h.app.enterGeneratedPhase(last);
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  const deadline=h.run('densityRun().deadlineMs');
  await h.step();
  assert.equal(h.equipmentSpeech().length,0,'density instructions take priority');
  h.endSpeech();
  await h.step();
  assert.equal(h.active?.text,'Get your kettlebell ready when you can.');
  h.endSpeech();
  await h.app.updateDensityBlock('done');
  assert.equal(h.run('densityRun().deadlineMs'),deadline);
  assert.equal(h.run('densityRun().ended'),'work-ended','unconfirmed targets stay unconfirmed');
  assert.equal(h.workoutCue(),'Get ready: kettlebell');
  h.endSpeech();
  await h.step();
  assert.equal(h.equipmentSpeech().length,1,'the completion screen does not repeat delivered speech');
});

test('a second rings configuration change keeps its full existing spoken prompt',async()=>{
  const h=harness({busy:true});
  const high=h.exercise('ring-pull-up'), low=h.exercise('ring-row');
  assert.ok(high.setupProfile && low.setupProfile && high.setupProfile!==low.setupProfile);
  const timeline=await h.generated([
    {...rounds([high]),id:'high'}, {...rounds([low]),id:'low'}, {...rounds([high]),id:'high-again'}
  ],{setupEquipment:['rings']},['rings']);
  assert.equal(h.workoutCue(),'Get ready: gymnastic rings');
  h.app.enterGeneratedPhase(1);
  const setupIndexes=timeline.flatMap((phase,index)=>phase.kind==='setup-transition'?[index]:[]);
  assert.equal(setupIndexes.length,2);
  for (const index of setupIndexes) {
    h.app.enterGeneratedPhase(index);
    assert.equal(h.active?.text,timeline[index].label+'. '+timeline[index].note);
    assert.equal(h.workoutCue(),'');
  }
  assert.equal(h.equipmentSpeech().length,0);
});
