const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fixtures=require('./helpers/coach-fixtures');
const {loadAppContext}=require('./helpers/app-context');
const {pilot}=require('./helpers/coach-pilot');

global.window=global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/coach-model.js');
require('../js/generator.js');
const G=GarageFitGenerator,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value));
const random=initial=>{let seed=initial;return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};};
const part=(ids=[],restSeconds=0)=>({exercises:ids.map(id=>copy(C[id])),restSeconds,
  estimatedSeconds:ids.reduce((sum,id)=>sum+C[id].estimatedSeconds,0)+Math.max(0,ids.length-1)*restSeconds});
const block=(ids,rounds=1,rest=15)=>({id:'main-1',protocol:'rounds',intent:'strength',exercises:ids.map(id=>copy(C[id])),
  prescription:{rounds,exerciseRestSeconds:rest,roundRestSeconds:45}});
function workout(blocks,overrides={}){
  blocks=blocks.map((item,index)=>({...item,id:'main-'+(index+1)}));
  const result={id:'setup-test',schemaVersion:2,duration:30,focus:'strength',difficulty:'normal',bodyFocus:'full-body',
    warmup:part(['jumping-jacks']),rampup:part(),cooldown:part(['childs-pose']),main:{blocks},...overrides};
  result.estimatedSeconds=result.warmup.estimatedSeconds+result.rampup.estimatedSeconds+result.cooldown.estimatedSeconds+G.mainSeconds(blocks);
  return G.normaliseWorkout(result);
}
function timeline(value){return copy(loadAppContext().buildGeneratedTimeline(copy(value)));}
function plannedTimelineSeconds(value,phases=timeline(value)){
  // Ramp-up is presented separately. Legacy player ready/phase transitions add 9 sec;
  // setup replacements preserve that legacy offset and add only their planned delta.
  const fixedBlocks=new Set();
  return phases.reduce((sum,phase)=>{
    if(phase.kind==='exercise'&&['emom','density','amrap'].includes(phase.protocol)){
      if(fixedBlocks.has(phase.blockIndex))return sum;
      fixedBlocks.add(phase.blockIndex);return sum+G.estimateBlockDuration(value.main.blocks[phase.blockIndex]);
    }
    if(phase.kind==='density-rest')return sum;
    return sum+(phase.kind==='exercise'?(phase.timed?phase.seconds:(phase.estimatedSeconds??phase.exercise.estimatedSeconds)/G.sideCount(phase.exercise)):phase.seconds||0);
  },0)+value.rampup.estimatedSeconds-9;
}
const anchor=(id,extra={})=>fixtures.anchor({requirementId:'anchor-'+id,exerciseId:id,targetSets:1,
  target:{type:'reps',minReps:4,maxReps:4},suggestedLoad:null,loadUnit:null,loadInterpretation:null,
  allowedProtocols:['rounds'],...extra});
const prescription=extra=>fixtures.prescription({equipment:['rings'],movementPriorities:[],requiredAnchors:[],optionalMainExerciseIds:[],...extra});
const nodes=node=>[node,...(node.children||[]).flatMap(nodes)];

test('one owned high-to-low boundary replaces three seconds, survives normalisation and plays once',()=>{
  const w=workout([block(['ring-pull-up'],2),block(['ring-fallout'],2)]);
  assert.equal(w.setupTransitions.length,1);
  assert.deepEqual(w.setupTransitions[0],{section:'main',blockIndex:1,exerciseIndex:0,fromProfile:'rings-high',toProfile:'rings-low',
    seconds:45,replacesSeconds:3,additionalSeconds:42,instruction:'Adjust rings to low position'});
  assert.equal(w.main.estimatedDurationSeconds,G.estimateBlockDuration(w.main.blocks[0])+G.estimateBlockDuration(w.main.blocks[1])+45);
  const snapshot=copy(w);
  for(let n=0;n<5;n++)assert.deepEqual(G.normaliseWorkout(w),snapshot);
  const phases=timeline(w);
  assert.equal(phases.filter(phase=>phase.kind==='setup-transition').length,1);
  assert.equal(phases.filter(phase=>phase.kind==='block-transition').length,0);
  assert.equal(plannedTimelineSeconds(w,phases),w.estimatedSeconds);
  w.setupTransitions[0].seconds=999;w.setupTransitions[0].instruction='stale';
  assert.deepEqual(G.normaliseWorkout(w),snapshot,'derived setup plans cannot retain stale timing or instructions');
});

test('configuration persists through bodyweight and other kit, including the middle of the next block',()=>{
  for(const middle of ['air-squat','trx-row']){
    const w=workout([block(['ring-pull-up']),block([middle,'ring-fallout'])]);
    assert.equal(w.setupTransitions.length,1);
    assert.equal(w.setupTransitions[0].exerciseIndex,1);
    assert.equal(w.setupTransitions[0].additionalSeconds,30);
    const base=C['ring-pull-up'].estimatedSeconds+C[middle].estimatedSeconds+C['ring-fallout'].estimatedSeconds+3+15;
    assert.equal(G.mainSeconds(w.main.blocks),base+30);
    assert.equal(w.main.estimatedDurationSeconds,base+30);
    assert.equal(plannedTimelineSeconds(w),w.estimatedSeconds);
    const unchanged=workout([block(['ring-pull-up']),block([middle,'ring-knee-raise'])]);
    assert.equal(unchanged.setupTransitions,undefined);
    assert.equal(timeline(unchanged).filter(phase=>phase.kind==='setup-transition').length,0);
  }
});

test('a single-pass adjustment replaces its rest, keeps longer recovery, and rejects repeated mixed setups',()=>{
  for(const rest of [0,15,45,60]){
    const b=block(['ring-pull-up','ring-fallout'],1,rest),w=workout([b]);
    assert.equal(w.setupTransitions[0].seconds,Math.max(45,rest));
    assert.equal(G.estimateBlockDuration(b),60+Math.max(45,rest));
    assert.equal(G.estimateMain(b.exercises,1,{exercise:rest,round:45}),G.estimateBlockDuration(b));
    assert.equal(plannedTimelineSeconds(w),w.estimatedSeconds);
    assert.equal(timeline(w).filter(phase=>phase.kind==='setup-transition').length,1);
  }
  assert.throws(()=>workout([block(['ring-pull-up','ring-fallout'],2)]),/setup-profile-conflict/);
  const intervals={...block(['ring-support-hold','ring-fallout']),protocol:'timed_intervals',prescription:{cycles:2,workSeconds:30,transitionSeconds:15}};
  assert.throws(()=>workout([intervals]),/setup-profile-conflict/);
});

test('phase boundaries and preparation adjustments use the same replacement budget without duplication',()=>{
  const w=workout([block(['ring-fallout'])],{warmup:part(['ring-pull-up']),cooldown:part(['ring-row'])});
  assert.deepEqual(w.setupTransitions.map(change=>[change.section,change.additionalSeconds]),[['main',42],['cooldown',42]]);
  assert.equal(w.main.estimatedDurationSeconds,C['ring-fallout'].estimatedSeconds+42);
  assert.equal(plannedTimelineSeconds(w),w.estimatedSeconds);
  assert.equal(timeline(w).filter(phase=>phase.kind==='setup-transition').length,2);
  const nested=workout([block(['air-squat','ring-fallout'])],{warmup:part(['ring-pull-up','ring-row'],5),cooldown:part(['ring-row'])});
  assert.equal(nested.setupTransitions.length,3);
  assert.equal(nested.setupTransitions[0].additionalSeconds,40);
  assert.equal(nested.setupTransitions[1].additionalSeconds,30);
  assert.equal(plannedTimelineSeconds(nested),nested.estimatedSeconds);
  assert.deepEqual(G.normaliseWorkout(copy(nested)),nested);
});

test('shared composite equipment and resolved alternatives retain configuration memory',()=>{
  const high={...copy(C['ring-pull-up']),equipment:[['rings'],['bench']]};
  const low={...copy(C['ring-fallout']),equipment:[['rings']]};
  const plan=exercises=>({main:{blocks:[{...block([]),exercises}]}});
  assert.equal(G.planSetupTransitions(plan([high,low]),['rings','bench']).length,1);
  assert.equal(G.planSetupTransitions(plan([high,low,{...low,equipment:[['rings'],['bench']]}]),['rings','bench']).length,1,'accompanying bench cannot retain a stale ring height');
  const alternative={...high,equipment:[['trx','rings']]};
  assert.equal(G.planSetupTransitions(plan([alternative,low]),['rings']).length,1);
  assert.equal(G.planSetupTransitions(plan([alternative,low]),['trx','rings']).length,0,'different resolved equipment has no shared setup');
  const repeated={...block([]),exercises:[alternative,low],prescription:{rounds:2,exerciseRestSeconds:15,roundRestSeconds:45}};
  const w=workout([repeated],{setupEquipment:['trx','rings']});
  assert.equal(w.setupTransitions,undefined);
  assert.deepEqual(G.normaliseWorkout(copy(w)),w);
  assert.equal(plannedTimelineSeconds(w),w.estimatedSeconds);
});

test('Coach preflight includes adjustment time at exact Main and maximum-duration boundaries',()=>{
  const base=prescription({requiredAnchors:[anchor('ring-pull-up'),anchor('ring-fallout')]});
  const assessment=G.assessSessionPrescription({catalogue:C,sessionPrescription:base});
  assert.equal(assessment.status,'feasible');
  const required=assessment.requiredMainSeconds;
  assert.equal(required,20+18+45);
  const preparation=G.BUDGETS[base.duration].warmup+G.BUDGETS[base.duration].rampup+G.BUDGETS[base.duration].cooldown;
  for(const [key,limit] of [['mainTimeLimitSeconds',required],['maximumDurationSeconds',required+preparation]]){
    const exact={...base,[key]:limit};
    assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:exact}).status,'feasible',key+' exact');
    const w=G.generate({catalogue:C,sessionPrescription:exact,random:random(114)});
    assert.equal(w.main.estimatedDurationSeconds,required);
    assert.equal(w.setupTransitions.length,1);
    assert.equal(plannedTimelineSeconds(w),w.estimatedSeconds);
    assert.ok(w.estimatedSeconds<=required+preparation);
    const short={...exact,[key]:limit-1};
    const result=G.assessSessionPrescription({catalogue:C,sessionPrescription:short});
    assert.equal(result.status,'infeasible',key+' one second short');
    assert.equal(result.hardConflicts.find(item=>item.code==='insufficient-main-time').requiredSeconds,required);
    assert.throws(()=>G.generate({catalogue:C,sessionPrescription:short,random:()=>{throw Error('preflight must precede random draws');}}),G.SessionPrescriptionError);
  }
});

test('ring plans respect nominal and Main budgets across every duration with exact replay timing',()=>{
  for(const equipment of [['rings'],['rings','trx','dumbbells','pullup-bar']])for(const duration of [10,15,20,30,45])for(const focus of ['strength','balanced','cardio'])for(const seed of [7,114,901]){
    const w=G.generate({catalogue:C,equipment,duration,focus,random:random(seed)});
    if(w.main.blocks.some(b=>b.exercises.some(ex=>ex.setupProfile)))assert.ok(w.estimatedSeconds<=duration*60,equipment+' '+duration+' '+focus+' '+seed+': '+w.estimatedSeconds);
    if(w.main.blocks.some(b=>b.exercises.some(ex=>ex.setupProfile)))assert.ok(w.main.estimatedDurationSeconds<=duration*60-w.warmup.estimatedSeconds-w.rampup.estimatedSeconds-w.cooldown.estimatedSeconds);
    assert.deepEqual(G.normaliseWorkout(copy(w)),w);
    assert.equal(plannedTimelineSeconds(w),w.estimatedSeconds,equipment+' '+duration+' '+focus+' '+seed+' '+JSON.stringify(w.main.blocks.map(b=>({p:b.protocol,rx:b.prescription,ids:b.exercises.map(ex=>ex.id)}))));
    w.main.blocks.forEach(b=>assert.ok(G.blockSetupCompatible(b,C,equipment)));
  }
});

test('Main swaps account for both incoming and outgoing setup changes before selection',()=>{
  const w=workout([block(['ring-pull-up']),block(['ring-knee-raise'])]);
  const rx=prescription({optionalMainExerciseIds:['ring-pull-up','ring-fallout','ring-knee-raise'],mainTimeLimitSeconds:w.main.estimatedDurationSeconds+10,
    maximumDurationSeconds:G.BUDGETS[30].warmup+G.BUDGETS[30].rampup+G.BUDGETS[30].cooldown+w.main.estimatedDurationSeconds+10});
  w.sessionPrescription=rx;
  const before=copy(w);
  G.swap(w,1,0,{catalogue:{'ring-fallout':C['ring-fallout']},equipment:['rings'],random:()=>0});
  assert.deepEqual(w,before,'new adjustment must fit even when the work alone would fit');
  w.sessionPrescription.mainTimeLimitSeconds+=100;w.sessionPrescription.maximumDurationSeconds+=100;
  G.swap(w,1,0,{catalogue:{'ring-fallout':C['ring-fallout']},equipment:['rings'],random:()=>0});
  assert.equal(w.main.blocks[1].exercises[0].id,'ring-fallout');
  assert.equal(w.setupTransitions.length,1);
  assert.equal(plannedTimelineSeconds(w),w.estimatedSeconds);
  const estimated=w.estimatedSeconds;
  G.swap(w,1,0,{catalogue:{'ring-knee-raise':C['ring-knee-raise']},equipment:['rings'],random:()=>0});
  assert.equal(w.setupTransitions,undefined);
  assert.equal(w.estimatedSeconds,estimated+30-35-42);
});

test('Generator preview presents the owned setup instruction and its allowance exactly once',()=>{
  const app=loadAppContext();
  app.testWorkout=copy(workout([block(['ring-pull-up']),block(['ring-fallout'])]));
  vm.runInContext('generatorState.workout=testWorkout;renderGeneratedPreview()',app);
  const setup=nodes(app.document.getElementById('previewList')).filter(node=>node.className==='preview-setup-transition');
  assert.equal(setup.length,1);
  const text=nodes(setup[0]).map(node=>node.textContent).join(' ');
  assert.match(text,/Adjust rings to low position/);assert.match(text,/45 sec planned allowance/);assert.match(text,/Pause if you need longer/);
});

test('setup playback has visible and spoken cues, uses the existing pause clock and creates no tracker work',async()=>{
  let wall=1000,nextTimer=0;const timers=new Map(),spoken=[];
  const app=loadAppContext(new Map(),{ownIntrinsics:true,configure(context){
    context.wallNow=()=>wall;
    context.setInterval=callback=>{timers.set(++nextTimer,callback);return nextTimer;};context.clearInterval=id=>timers.delete(id);
    context.speechSynthesis.speak=utterance=>spoken.push(utterance.text);
  }});
  app.workoutJSON=JSON.stringify(workout([block(['ring-pull-up']),block(['ring-fallout'])]));
  const run=code=>vm.runInContext(code,app),el=id=>app.document.getElementById(id);
  run('Date.now=wallNow;generatorState.workout=JSON.parse(workoutJSON)');
  app.startStandaloneGeneratedWorkout();
  await run('generatorState.tracker.flush()');
  const index=run("generatorState.timeline.findIndex(phase=>phase.kind==='setup-transition')");
  app.enterGeneratedPhase(index);
  assert.equal(el('workoutExercise').textContent,'Adjust rings to low position');
  assert.match(el('workoutSideNote').textContent,/Pause if you need longer/);
  assert.equal(el('workoutRingPhase').textContent,'SETUP');
  assert.equal(el('workoutRingNum').textContent,'45');
  assert.ok(spoken.some(text=>text.includes('Adjust rings to low position')));
  assert.equal(run('currentGeneratedPhase().occurrenceId'),undefined);
  assert.equal(run('generatorState.tracker.plannedWork().length'),4,'warm-up, two Main exercises and cool-down only');
  wall+=20000;app.syncGeneratedCountdown();assert.equal(run('generatorState.remaining'),25);
  app.pauseWorkoutClock();wall+=60000;app.syncGeneratedCountdown();assert.equal(run('generatorState.remaining'),25);
  app.resumeWorkoutClock();wall+=25000;
  const callback=timers.get(run('generatorState.phaseTimer'));await callback();await run('generatorState.tracker.flush()');
  assert.equal(run('currentGeneratedPhase().exercise.id'),'ring-fallout');
  assert.equal(run('generatorState.completedMain'),0);
  assert.deepEqual(copy(run('generatorState.tracker.performedWork()')),[]);
  await app.generatedPrimaryAction();assert.deepEqual(copy(run('generatorState.tracker.performedWork()')),[],'tap at automatic setup expiry cannot consume the exercise');
  wall+=400;await app.generatedPrimaryAction();await run('generatorState.tracker.flush()');
  assert.deepEqual(copy(run('generatorState.tracker.performedWork()')).map(item=>item.exerciseId),['ring-fallout']);
});


test('preparation swaps include setup at both phase boundaries and retain exact rounded time',()=>{
  const phase=(id,section,seconds)=>({exercises:[G.phaseExercise({...C[id],
    warmupPrescription:{type:'timed',value:seconds},rampupPrescription:{type:'timed',value:seconds}},section,seconds)],restSeconds:0,estimatedSeconds:seconds});
  const w=workout([block(['ring-fallout'])],{warmup:phase('ring-press-up','warmup',175),
    rampup:phase('marching-on-the-spot','rampup',120),cooldown:phase('ring-press-up','cooldown',180)});
  const candidate={...copy(C['shoulder-rolls']),setupProfile:'rings-high',equipment:[['rings']]};
  const original=w.estimatedSeconds;
  w.sessionPrescription=prescription({optionalMainExerciseIds:['ring-fallout'],maximumDurationSeconds:original});
  G.swapPreparation(w,'warmup',0,{catalogue:{[candidate.id]:candidate},equipment:['rings'],random:()=>0});
  assert.equal(w.warmup.exercises[0].id,'ring-press-up','incoming setup must fit the maximum');
  w.sessionPrescription.maximumDurationSeconds+=42;
  G.swapPreparation(w,'warmup',0,{catalogue:{[candidate.id]:candidate},equipment:['rings'],random:()=>0});
  assert.equal(w.warmup.exercises[0].id,candidate.id);
  assert.equal(w.setupTransitions.length,1);
  assert.equal(w.estimatedSeconds,original+42);
  assert.equal(plannedTimelineSeconds(w),w.estimatedSeconds);
  assert.deepEqual(G.normaliseWorkout(copy(w)),w);
});

test('Coach preview and player share setup rows and adjustment-only navigation earns no credit',async()=>{
  const p=pilot();p.run("state.ownedEquipment=['dumbbells']");
  await p.run("coachUI.controller.start(pilotDef,['dumbbells'])");await p.run('coachUI.open()');
  p.app.setupWorkoutJSON=JSON.stringify(workout([block(['ring-pull-up']),block(['ring-fallout'])]));
  p.run(`const nativeSetupGenerate=GarageFitGenerator.generate;
    GarageFitGenerator.generate=options=>{const w=nativeSetupGenerate(options);const extra=JSON.parse(setupWorkoutJSON).main.blocks;w.main.blocks.push(...extra);return GarageFitGenerator.normaliseWorkout(w)};
    function setupNodes(id){const visit=node=>[node,...(node.children||[]).flatMap(visit)];return visit(document.getElementById(id));}
    function setupAction(id,label){return setupNodes(id).find(node=>node.textContent===label&&node.onclick).onclick();}`);
  await p.run("setupAction('coachContent','View today’s workout')");
  assert.equal(p.run("setupNodes('coachPreviewContent').filter(node=>node.className==='preview-setup-transition').length"),1);
  assert.match(p.run("setupNodes('coachPreviewContent').map(node=>node.textContent).join(' ')"),/Adjust rings to low position.*45 sec planned allowance/);
  await p.run("setupAction('coachPreviewContent','Start workout')");
  const index=p.run("generatorState.timeline.findIndex(phase=>phase.kind==='setup-transition')");
  p.run(`enterGeneratedPhase(${index})`);
  assert.equal(p.run("document.getElementById('coachAnchorLog').classList.contains('hidden')"),true);
  await p.run('completeWorkoutMovement()');
  assert.equal(p.run('generatorState.timelineIndex'),index+1);
  assert.equal(p.run('generatorState.completedMain'),0);
  assert.deepEqual(p.json('generatorState.tracker.performedWork()'),[]);
  p.run("openExitDialog('workout')");await p.run('confirmExitChoice()');await p.run("coachUI.saveFeedback('about-right')");
  const result=p.json('coachUI.controller.snapshot().results[0]');
  assert.deepEqual(result.performedWork,[]);
  assert.equal(p.run('coachUI.controller.snapshot().state.meaningfulSessionsCompleted'),0);
});


test('explicit EMOM builder fits whole minutes after the actual incoming ring adjustment',()=>{
  const prefix=[block(['ring-pull-up'])];
  // A clock-compatible synthetic profile exercises the timing seam; shipped ring
  // eligibility remains unchanged.
  const source={...copy(C['trx-row']),id:'setup-emom-test',equipment:[['rings']],setupProfile:'rings-support'};
  const catalogue={[source.id]:source,'ring-pull-up':C['ring-pull-up']};
  const prefixSeconds=G.mainSeconds(prefix);
  const create=availableSeconds=>G.buildEmomBlock({catalogue,equipment:['rings'],blocks:prefix,
    availableSeconds,random:()=>0,focus:'strength'});
  const short=create(prefixSeconds+3+120);
  assert.ok(short);
  assert.equal(short.prescription.minutes,1,'45-second setup leaves only one whole minute');
  assert.equal(G.mainSeconds(prefix.concat(short)),prefixSeconds+45+60);
  assert.equal(create(prefixSeconds+45+60-1),null);
  const exact=create(prefixSeconds+45+120);
  assert.equal(exact.prescription.minutes,2);
  assert.equal(G.mainSeconds(prefix.concat(exact)),prefixSeconds+45+120);
});


test('setup budget alternative selection preserves trace determinism and reports the final attempt',()=>{
  const equipment=GarageFitData.equipment.map(item=>item.id),events=[];
  // Freeze the input that triggers this exact setup-budget alternative; other
  // setup matrices exercise the live catalogue as preparation expands.
  const catalogue=require('./helpers/coach-fixtures').catalogueBeforePrepP1(C);
  const options={catalogue,equipment,duration:10,focus:'strength',difficulty:'hard',bodyFocus:'full-body'};
  const traced=G.generate({...options,random:random(2950288821),trace:event=>{if(event.type==='main-result')events.push(event);}});
  const ordinary=G.generate({...options,random:random(2950288821)});
  delete traced.id;delete ordinary.id;
  assert.deepEqual(traced,ordinary);
  assert.equal(events.length,2);
  assert.notEqual(events[0].attempt,events[1].attempt);
  assert.equal(events[1].supportingRoute,events[0].supportingRoute);
  assert.ok(traced.estimatedSeconds<=600&&traced.estimatedSeconds>=420);
  assert.ok(new Set(traced.main.blocks.flatMap(b=>b.exercises.map(ex=>ex.id))).size>=3);
});
