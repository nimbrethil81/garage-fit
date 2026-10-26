const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
const {blockFixtures}=require('./helpers/protocol-fixtures');
const copy=value=>JSON.parse(JSON.stringify(value));

function harness(protocols=['timed_intervals'],{prep=true,coach=false}={}){
  let now=0;
  const app=loadAppContext(new Map(),{ownIntrinsics:true,rampupUi:true,configure(context){context.performance={now:()=>now}}});
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id);
  run('var progressWall=0;Date.now=()=>progressWall');
  const fixtures=blockFixtures(app.GarageFitData.exercises,{emom:true,ladder:true,pyramid:true,complex:true,density:true,amrap:true});
  app.progressFixture={schemaVersion:2,id:'journey-fixture',duration:30,focus:'balanced',difficulty:'normal',
    warmup:{restSeconds:0,exercises:prep?[{...copy(app.GarageFitData.exercises['jumping-jacks']),prescription:{type:'timed',value:20}}]:[]},
    rampup:{restSeconds:0,exercises:prep?[{...copy(app.GarageFitData.exercises['air-squat']),prescription:{type:'reps',value:5}}]:[]},
    main:{blocks:protocols.map((protocol,i)=>({...copy(fixtures[protocol]),id:'main-'+i}))},
    cooldown:{restSeconds:0,exercises:prep?[{...copy(app.GarageFitData.exercises['childs-pose']),prescription:{type:'timed',value:30}}]:[]}};
  run('generatorState.workout=progressFixture');
  if(coach)run('coachUI.isActive=()=>true');
  app.startGeneratedWorkout();
  return {app,run,el,
    journey:()=>copy(run('workoutJourney()')),
    timeline:()=>run('generatorState.timeline'),
    enter(predicate){const index=this.timeline().findIndex(predicate);assert.ok(index>=0);app.enterGeneratedPhase(index);return index},
    time(ms){now+=ms;run(`progressWall+=${ms}`)},
    render(){app.renderWorkoutJourney()}
  };
}

test('journey includes actual warm-up, ramp-up, individual Main blocks and cool-down only',()=>{
  const h=harness(['rounds','timed_intervals']);
  const journey=h.journey();
  assert.deepEqual(journey.segments.map(s=>s.label),['Warm-up','Ramp-up','Main workout · Block 1','Main workout · Block 2','Cool-down']);
  assert.ok(journey.segments.every(s=>s.seconds>0&&s.fraction>=0&&s.fraction<=1));
  assert.ok(journey.segments[2].seconds>journey.segments[0].seconds,'long block receives more planned duration than short prep');
  const empty=harness(['timed_intervals'],{prep:false}).journey();
  assert.deepEqual(empty.segments.map(s=>s.label),['Main workout']);
});

test('per-side rep and timed occurrences budget every side exactly once using the canonical estimates',()=>{
  for(const [protocol,id,repeats] of [['paired_sets','reverse-lunge',3],['rounds','side-plank',3]]){
    const h=harness([protocol],{prep:false}),journey=h.journey();
    const entries=journey.segments[0].entries.filter(entry=>{
      const phase=h.timeline()[entry.index];return phase.kind==='exercise'&&phase.exercise.id===id;
    });
    assert.equal(entries.length,repeats*2);
    const estimate=h.run(`generatorState.workout.main.blocks[0].exercises.find(ex=>ex.id===${JSON.stringify(id)}).estimatedSeconds`);
    assert.equal(entries.reduce((sum,entry)=>sum+entry.seconds,0),estimate*repeats);
  }
});

test('timed work fills within a segment; rest retains block ownership and fills; Previous rewinds position',async()=>{
  const h=harness(['timed_intervals']);
  h.enter(p=>p.section==='main'&&p.kind==='exercise');
  const start=h.journey();
  h.run('generatorState.remaining=20');h.render();
  const half=h.journey();
  assert.ok(half.value>start.value,'twenty seconds of timed work moves progress before Next');
  assert.equal(half.label,'Main workout');
  assert.equal(half.round,'Round 1 of 2');
  await h.app.generatedPrimaryAction();
  assert.equal(h.run('currentGeneratedPhase().kind'),'interval-rest');
  const rest=h.journey();
  assert.equal(rest.label,half.label);
  h.run('generatorState.remaining=10');h.render();
  assert.ok(h.journey().value>rest.value,'recovery contributes to journey progress');
  h.app.previousGeneratedPhase();
  assert.ok(h.journey().value<rest.value);
  assert.equal(h.el('workoutPhaseLabel').textContent,'Main workout');
});

test('transitions retain the phase just finished; the final timed step reaches complete journey progress',()=>{
  const h=harness(['rounds','timed_intervals']);
  h.enter(p=>p.kind==='transition'&&p.label==='Warm-up complete');
  assert.equal(h.journey().label,'Warm-up');
  h.enter(p=>p.kind==='block-transition');
  const boundary=h.journey();
  assert.equal(boundary.label,'Main workout · Block 1');
  h.run('generatorState.remaining=0');
  assert.equal(h.journey().segments[boundary.current].fraction,1);
  h.enter(p=>p.section==='cooldown'&&p.kind==='exercise');
  const last=h.journey();
  assert.ok(last.segments.slice(0,-1).every(s=>s.fraction===1));
  h.run('generatorState.remaining=0');h.render();
  assert.equal(h.journey().value,100);
  assert.equal(h.el('workoutProgressTrack').attributes['aria-valuenow'],'100');
});

test('pause freezes the journey and skipping moves through planned work without claiming performed evidence',async()=>{
  const h=harness(['ladder']);
  h.enter(p=>p.section==='main'&&p.kind==='exercise'&&!p.timed);
  const before=h.journey();
  h.time(60000);h.render();
  assert.equal(h.journey().value,before.value,'untimed reps do not fabricate clock-based precision');
  h.app.toggleWorkoutPause();
  const frozen=h.journey();h.time(120000);h.app.renderWorkoutElapsed();h.render();
  assert.deepEqual(h.journey(),frozen);
  await h.app.generatedPrimaryAction();
  assert.deepEqual(h.journey(),frozen,'paused Next does not move progress');
  h.app.toggleWorkoutPause();await h.app.generatedSkipWork();
  assert.ok(h.journey().value>before.value);
  assert.equal(h.run('generatorState.tracker'),null,'the progress view creates no tracker or performed evidence');
});

test('EMOM includes minute recovery; AMRAP and density reserve one cap independent of repeating targets',async()=>{
  for(const protocol of ['emom','amrap','density']){
    const h=harness([protocol],{prep:false});h.enter(p=>p.protocol===protocol&&p.kind==='exercise');
    const before=h.journey();
    h.time(30000);h.app.syncGeneratedCountdown();h.render();
    const after=h.journey();
    assert.ok(after.value>before.value,protocol+' progresses on its existing clock');
    assert.equal(after.segments.length,1);
    assert.equal(protocol==='emom'?after.segments[0].seconds:after.segments[0].cap,300,protocol+' cap is counted once');
    h.app.toggleWorkoutPause();const frozen=h.journey();h.time(100000);h.app.syncGeneratedCountdown();h.render();
    assert.deepEqual(h.journey(),frozen,protocol+' excludes paused time');
  }
});

test('all protocols and Coach use the same read-only journey and concise context',()=>{
  for(const protocol of ['rounds','paired_sets','timed_intervals','emom','ladder','pyramid','complex','density','amrap']){
    const standalone=harness([protocol]),coach=harness([protocol],{coach:true});
    for(const h of [standalone,coach])h.enter(p=>p.protocol===protocol&&p.kind==='exercise');
    assert.deepEqual(coach.journey(),standalone.journey(),protocol);
    const h=standalone,journey=h.journey();
    assert.equal(journey.label,'Main workout');
    assert.doesNotMatch(h.el('workoutMovementProgress').textContent,/Exercise|Movement|Block|Step|Minute|Set|Sequence/);
    const value=Number(h.el('workoutProgressTrack').attributes['aria-valuenow']);
    assert.ok(Number.isFinite(value)&&value>=0&&value<=100);
    assert.equal(h.el('workoutProgressTrack').attributes['aria-valuemax'],'100');
  }
});

test('fixed reps advance on confirmation/Previous and fixed AMRAP follows time across rounds',()=>{
  const app=loadAppContext(),run=code=>vm.runInContext(code,app);
  app.startFixedWorkout('workout300');const initial=copy(run('workoutJourney()'));
  assert.equal(initial.label,'Main workout');assert.equal(initial.segments.length,1);
  app.completeWorkoutMovement();assert.ok(run('workoutJourney().value')>initial.value);
  app.previousWorkoutMovement();assert.equal(run('workoutJourney().value'),initial.value);
  app.startFixedWorkout('cindy');
  run('workoutState.elapsedMs=600000;workoutState.startedAt=workoutNow()');app.renderWorkoutElapsed();
  assert.ok(Math.abs(run('workoutJourney().value')-50)<.01);
  const half=run('workoutJourney().value');app.completeWorkoutMovement();
  assert.ok(Math.abs(run('workoutJourney().value')-half)<.01,'AMRAP confirmation does not restart the clock');
});
