// #402 (GF-CARDIO1 Stage B): Cardio & Conditioning v2, the shared same-block variant rule and the
// traditional Generator Cardio Normal/Hard policies. Bounded deterministic samples only.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
global.window=global;
for(const file of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator',
  'js/strength-cardio-composer','js/core-challenge-composer','data/athletic-membership','data/mobility-membership',
  'js/athletic-composer','js/mobility-composer','js/resistance-endurance-composer','js/routine-generator','data/programmes','data/sport-profiles','data/sport-capabilities',
  'js/coach-model','js/training-history','js/sport-coverage','js/coach-policies','js/coach-general-fitness-policy','js/coach-tennis-policy','js/coach-engine'])require('../'+file);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises,H=GarageFitData.historicalExerciseDefinitions;
const CARDIO='cardio-conditioning',GENTLE=['step-jacks','side-step-knee-lift','high-knee-power-steps'];
const KITS={bodyweight:[],limited:['dumbbells'],broad:['dumbbells','kettlebell','pullup-bar','trx','rings','barbell','bench','box','bands']};
const REPORTED_KIT=['dumbbells','kettlebell','trx','rings','barbell'];
const copy=value=>JSON.parse(JSON.stringify(value));
const rng=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const ids=w=>w.main.blocks.flatMap(b=>b.exercises.map(ex=>ex.id));
const v2=(extra={})=>G.generate({catalogue:C,workoutFamilyId:CARDIO,workoutFamilyVersion:2,duration:20,difficulty:'normal',equipment:[],random:rng(1),...extra});
const valid=(w,equipment)=>G.validateFamilyWorkout(w,{catalogue:C,equipment});
const quality=(w,equipment)=>valid(w,equipment).qualityIssues;
const FLOORS={normal:{cardioDemand:3.2,conditioningShare:.5,density:.6},hard:{cardioDemand:3.5,conditioningShare:.65,density:.66}};
const INTERVALS={easy:['30/30','30/20'],normal:['40/20','30/20','45/15'],hard:['40/20','45/15','30/15']};

// A Main swapped into an existing family workout, with estimates recomputed exactly as an edit would be.
function withMain(base,blocks,{version,historical=false,difficulty=base.difficulty}) {
  const w=copy(base),source=id=>copy(historical&&H[id]?{...C[id],...H[id]}:C[id]);
  Object.assign(w,{workoutFamilyVersion:version,familyStyleId:'endurance',difficulty});
  w.main.blocks=blocks.map((b,index)=>({id:'main-'+(index+1),protocol:'rounds',intent:'conditioning',exercises:b.ids.map(source),
    prescription:{rounds:b.rounds,exerciseRestSeconds:15,roundRestSeconds:45},rounds:b.rounds,rest:{exercise:15,round:45}}));
  if(historical)delete w.exerciseCatalogueVersion;else w.main.blocks.forEach(b=>b.exerciseCatalogueVersion=2);
  for(const b of w.main.blocks)b.estimatedDurationSeconds=b.estimatedSeconds=G.estimateBlockDuration(b,w.setupEquipment);
  w.blocks=w.main.blocks;w.main.estimatedDurationSeconds=G.mainSeconds(w.main.blocks,w.setupEquipment);
  w.estimatedSeconds=w.warmup.estimatedSeconds+w.rampup.estimatedSeconds+w.cooldown.estimatedSeconds+w.main.estimatedDurationSeconds;
  return w;
}
const reportedBase=()=>G.generate({catalogue:C,workoutFamilyId:CARDIO,workoutFamilyVersion:1,duration:30,difficulty:'normal',equipment:REPORTED_KIT,random:rng(3)});
// Diagnostics 2026-11-10 (General Fitness v2, Cardio v1 endurance, 30 min Normal): the exact Main.
const REPORTED=[{rounds:2,ids:['trx-mountain-climber','alternating-lateral-lunge','side-step-knee-lift','mountain-climbers','air-squat']},
  {rounds:3,ids:['boxing-slip-and-punch','high-knee-power-steps','step-jacks','kettlebell-deadlift-to-calf-raise','kettlebell-figure-eight']}];
// A purposeful revision: no gentle stepping, no variant within a block (the two mountain climbers now sit in different blocks).
const REVISED=[{rounds:2,ids:['trx-mountain-climber','alternating-lateral-lunge','jumping-jacks','air-squat','fast-feet']},
  {rounds:3,ids:['boxing-slip-and-punch','mountain-climbers','kettlebell-deadlift-to-calf-raise','kettlebell-figure-eight','low-impact-speed-skaters']}];

test('Cardio v2 is the current composition; v1 stays published, composable and validatable exactly as released',()=>{
  assert.equal(F.currentVersion(CARDIO),2);
  const [one,two]=[1,2].map(version=>F.getDefinition(CARDIO,version));
  assert.equal(F.getDefinition(CARDIO),one,'the default lookup stays v1');
  assert.deepEqual({...copy(two),version:1,compositionPolicy:one.compositionPolicy},copy(one),'same family identity, styles and feasibility');
  assert.deepEqual(copy(two.compositionPolicy),{id:CARDIO,version:2});
  assert.throws(()=>G.registerFamilyComposer(CARDIO,2,()=>({}),()=>[]),/once per published policy/);
  const legacy=G.generate({catalogue:C,workoutFamilyId:CARDIO,duration:20,equipment:[],random:rng(5)});
  assert.equal(legacy.workoutFamilyVersion,1,'an explicit request without a version composes v1');
  assert.equal(valid(legacy,[]).valid,true);
  // The standalone Generator composes the current version.
  const app=loadAppContext(new Map());
  app.input=CARDIO;vm.runInContext('Math.random=(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296})(7);selectGeneratorFamily(input);generateWorkout()',app);
  const delivered=vm.runInContext('generatorState.workout',app);
  assert.equal(delivered.workoutFamilyId,CARDIO);assert.equal(delivered.workoutFamilyVersion,2);
  assert.equal(app.GarageFitGenerator.validateFamilyWorkout(delivered,{catalogue:app.GarageFitData.exercises,equipment:vm.runInContext('state.ownedEquipment',app)}).valid,true);
});

test('the reported 30-minute Normal workout stays valid as historical v1 and fails v2 for its independent causes; a revision passes',()=>{
  const base=reportedBase();
  const historical=withMain(base,REPORTED,{version:1,historical:true});
  assert.equal(historical.main.estimatedDurationSeconds,1308,'the reported Main estimate');
  assert.deepEqual(valid(historical,REPORTED_KIT),{valid:true,technicalIssues:[],qualityIssues:[]});
  const current=withMain(base,REPORTED,{version:2});
  assert.deepEqual(valid(current,REPORTED_KIT).technicalIssues,[]);
  assert.deepEqual(quality(current,REPORTED_KIT).sort(),['quality:block-family-variant:main-1:mountain-climber','quality:cardio-demand-below-floor',
    ...GENTLE.map(id=>'quality:unsuitable-exercise:'+id)].sort());
  const measured=G.cardioChallenge(current.main.blocks);
  assert.ok(Math.abs(measured.cardioDemand-3.01)<.01,'current canonical scores give demand 3.01');
  // Gentle stepping is 80 of 180 s (44%) of planned exercise work per round of block 2.
  const block=current.main.blocks[1],work=block.exercises.reduce((sum,ex)=>sum+ex.estimatedSeconds,0);
  assert.equal(block.exercises.filter(ex=>GENTLE.includes(ex.id)).reduce((sum,ex)=>sum+ex.estimatedSeconds,0)/work,80/180);
  const revised=withMain(base,REVISED,{version:2});
  assert.deepEqual(valid(revised,REPORTED_KIT),{valid:true,technicalIssues:[],qualityIssues:[]});
  // The rule is block-scoped, not session-wide: both mountain climbers remain, in different blocks.
  assert.ok(ids(revised).includes('mountain-climbers')&&ids(revised).includes('trx-mountain-climber'));
  assert.ok(revised.estimatedSeconds<=30*60);
});

test('Easy keeps gentle conditioning in Main; Normal and Hard exclude it and cardio-2 work but keep preparation roles',()=>{
  let easy=null;
  for(let seed=1;seed<=12&&!easy;seed++){
    const w=v2({difficulty:'easy',duration:20,random:rng(seed)});
    if(ids(w).some(id=>['step-jacks','side-step-knee-lift'].includes(id)))easy=w;
  }
  assert.ok(easy,'bounded Easy seeds reach step jacks or side-step knee lifts');
  assert.equal(valid(easy,[]).valid,true);
  const gentle=ids(easy).filter(id=>GENTLE.includes(id));
  for(const difficulty of ['normal','hard']){
    const relabelled={...copy(easy),difficulty};
    for(const id of gentle)assert.ok(quality(relabelled,[]).includes('quality:unsuitable-exercise:'+id),difficulty+' '+id);
  }
  for(const difficulty of ['normal','hard'])for(const kit of Object.keys(KITS))for(const duration of [10,30])for(const seed of [1,2]){
    const w=v2({difficulty,duration,equipment:KITS[kit],random:rng(seed*31+duration)});
    assert.ok(w.main.blocks.flatMap(b=>b.exercises).every(ex=>!GENTLE.includes(ex.id)&&ex.cardio>=3),`${difficulty} ${kit} ${duration}`);
  }
  for(const id of ['step-jacks','side-step-knee-lift'])assert.equal(G.generatedPhaseEligible(C[id],'warmup',[]),true,id);
});

test('Normal and Hard meet their approved floors, work/rest patterns and recovery without needing high impact',()=>{
  const pattern=b=>b.prescription.workSeconds+'/'+b.prescription.transitionSeconds;
  const loads={normal:[],hard:[]},styles=new Set();
  for(const constraint of [{},{excludedImpact:['high']}])for(const kit of Object.keys(KITS))for(const duration of [10,15,20,30,45])for(const difficulty of ['normal','hard']){
    const seed=duration*7+kit.length,w=v2({difficulty,duration,equipment:KITS[kit],random:rng(seed),...constraint});
    const label=`${difficulty} ${kit} ${duration}m ${JSON.stringify(constraint)}`;
    assert.deepEqual(valid(w,KITS[kit]),{valid:true,technicalIssues:[],qualityIssues:[]},label);
    assert.ok(w.estimatedSeconds<=duration*60,label);
    const c=G.cardioChallenge(w.main.blocks),floor=FLOORS[difficulty];
    assert.ok(c.cardioDemand>=floor.cardioDemand&&c.conditioningShare>=floor.conditioningShare&&c.density>=floor.density,label+' '+JSON.stringify(c));
    for(const b of w.main.blocks){
      if(b.protocol==='timed_intervals')assert.ok(INTERVALS[difficulty].includes(pattern(b)),label+' '+pattern(b));
      if(b.protocol==='rounds'&&difficulty==='hard')assert.ok(b.prescription.roundRestSeconds>=20&&b.prescription.roundRestSeconds<=30,label);
    }
    if(constraint.excludedImpact)assert.ok(w.main.blocks.every(b=>b.exercises.every(ex=>ex.impact!=='high')),label);
    styles.add(w.familyStyleId);
    if(!constraint.excludedImpact)loads[difficulty].push(c.cardioDemand*c.density);
  }
  assert.deepEqual([...styles].sort(),['endurance','intervals','mixed-conditioning'],'automatic styles are retained');
  // Smoke check, not an approved threshold: combined workload (demand × density) of Hard ordinarily
  // exceeds Normal for the same settings and seed.
  const harder=loads.hard.filter((load,index)=>load>loads.normal[index]).length;
  assert.ok(harder>=loads.hard.length*.9,`Hard exceeded Normal in ${harder}/${loads.hard.length} matched sessions`);
});

test('Hard endurance may use safe strength-4 or hard-rated movements; Easy keeps v1 interval patterns',()=>{
  const base=reportedBase();
  const hardEndurance=withMain(base,[{rounds:3,ids:['kettlebell-swing','fast-feet','mountain-climbers','dumbbell-thruster']}],{version:2,difficulty:'hard'});
  hardEndurance.main.blocks[0].prescription.roundRestSeconds=hardEndurance.main.blocks[0].rest.round=30;
  hardEndurance.main.blocks[0].prescription.exerciseRestSeconds=hardEndurance.main.blocks[0].rest.exercise=10;
  const issues=quality(hardEndurance,REPORTED_KIT);
  assert.ok(!issues.some(issue=>/unsuitable-exercise|style-structure-mismatch/.test(issue)),issues.join());
  const normal={...copy(hardEndurance),difficulty:'normal'};
  assert.ok(quality(normal,REPORTED_KIT).includes('quality:style-structure-mismatch'),'Normal endurance keeps strength ≤ 3, non-hard-rated work');
  for(const seed of [1,2,3]){
    const w=v2({difficulty:'easy',duration:15,random:rng(seed)});
    for(const b of w.main.blocks.filter(b=>b.protocol==='timed_intervals'))assert.ok(INTERVALS.easy.includes(b.prescription.workSeconds+'/'+b.prescription.transitionSeconds));
  }
});

test('low-impact-only Normal uses the approved exception without weakening ordinary Normal; low-impact Hard fails honestly',()=>{
  const lowOnly={excludedImpact:['medium','high']};
  for(const kit of Object.keys(KITS))for(const duration of [10,15,20,30,45]){
    const w=v2({...lowOnly,equipment:KITS[kit],duration,random:rng(duration*3+kit.length)}),label=kit+' '+duration;
    assert.equal(valid(w,KITS[kit]).valid,true,label);
    assert.ok(w.main.blocks.every(b=>b.exercises.every(ex=>ex.impact==='low')),label);
    const c=G.cardioChallenge(w.main.blocks);
    assert.ok(c.cardioDemand>=3&&c.density>=.66&&c.conditioningShare>=.8,label+' '+JSON.stringify(c));
    // The exception belongs to the explicit constraint: the same Main without it is judged as ordinary Normal.
    const ordinary=copy(w);delete ordinary.familyConstraints;
    if(c.cardioDemand<3.2)assert.ok(quality(ordinary,KITS[kit]).includes('quality:cardio-demand-below-floor'),label);
  }
  for(const kit of ['bodyweight','limited']){
    let error;
    assert.throws(()=>v2({...lowOnly,difficulty:'hard',equipment:KITS[kit]}),caught=>{error=caught;return caught.code==='family-not-feasible';});
    assert.equal(error.workoutFamilyId,CARDIO);
    assert.ok(error.reasons.some(reason=>reason.code==='intensity-standard-infeasible'),kit);
    assert.deepEqual(error.adjustments.map(item=>item.code).sort(),['change-difficulty','reduce-impact-exclusions'],kit);
    assert.equal(error.adjustments.find(item=>item.code==='change-difficulty').value,'normal');
    assert.deepEqual(error.adjustments.find(item=>item.code==='reduce-impact-exclusions').value,['high'],'high impact is never proposed');
  }
});

test('same-block variants: rounds and timed intervals reject different IDs of one family anywhere in the block, nothing else',()=>{
  const block=(protocol,list,id='main-1')=>({id,protocol,exercises:list.map(id=>C[id])});
  const climbers=['trx-mountain-climber','air-squat','fast-feet','mountain-climbers'];
  assert.deepEqual(G.blockFamilyVariantIssues([block('rounds',climbers)]),['block-family-variant:main-1:mountain-climber'],'non-adjacent variants');
  assert.deepEqual(G.blockFamilyVariantIssues([block('timed_intervals',climbers)]),['block-family-variant:main-1:mountain-climber']);
  // One chosen exercise repeated over rounds or cycles is the protocol, not a duplicate.
  const repeated={...block('rounds',['mountain-climbers','air-squat','fast-feet']),prescription:{rounds:4,exerciseRestSeconds:10,roundRestSeconds:30}};
  assert.deepEqual(G.blockFamilyVariantIssues([repeated]),[]);
  assert.deepEqual(G.blockFamilyVariantIssues([block('rounds',['trx-mountain-climber','air-squat','fast-feet'],'main-1'),block('rounds',['mountain-climbers','bear-crawl','jumping-jacks'],'main-2')]),[],'different blocks');
  for(const protocol of ['emom','paired_sets','amrap','density','complex'])assert.deepEqual(G.blockFamilyVariantIssues([block(protocol,climbers)]),[],protocol);
  // A shared repetition class (both boxing drills) is not a canonical family.
  assert.equal(C['boxer-step-and-punches'].repetitionClass,C['boxing-slip-and-punch'].repetitionClass);
  assert.deepEqual(G.blockFamilyVariantIssues([block('rounds',['boxer-step-and-punches','boxing-slip-and-punch','fast-feet'])]),[]);
  // Traditional Cardio generation applies the same rule at every difficulty; Normal/Hard never use gentle stepping.
  for(const difficulty of ['easy','normal','hard'])for(const kit of ['bodyweight','broad'])for(const duration of [15,30,45])for(const seed of [1,2]){
    const w=G.generate({catalogue:C,focus:'cardio',difficulty,duration,equipment:KITS[kit],random:rng(seed*13+duration)}),label=`${difficulty} ${kit} ${duration} ${seed}`;
    assert.deepEqual(G.blockFamilyVariantIssues(w.main.blocks),[],label);
    if(difficulty!=='easy')assert.ok(ids(w).every(id=>!GENTLE.includes(id)),label);
  }
});

test('prospective swaps apply the same rules and leave the workout intact when no valid alternative exists',()=>{
  for(const difficulty of ['normal','hard'])for(const kit of ['bodyweight','broad']){
    const w=v2({difficulty,duration:20,equipment:KITS[kit],random:rng(kit.length+difficulty.length)}),before=ids(w);
    w.main.blocks.forEach((b,blockIndex)=>b.exercises.forEach((_,index)=>G.swap(w,blockIndex,index,{catalogue:C,equipment:KITS[kit],random:rng(blockIndex*7+index)})));
    assert.ok(ids(w).some((id,index)=>id!==before[index]),'swaps actually replace exercises');
    assert.deepEqual(valid(w,KITS[kit]),{valid:true,technicalIssues:[],qualityIssues:[]},difficulty+' '+kit);
    assert.ok(ids(w).every(id=>!GENTLE.includes(id)));
  }
  // Every Main exercise already appears in both blocks (the v2 exposure limit); the only other
  // candidates are gentle stepping and a direct variant of a movement in the same block.
  const both=['trx-mountain-climber','jumping-jacks','alternating-lateral-lunge','kettlebell-figure-eight','boxing-slip-and-punch'];
  const saturated=withMain(reportedBase(),[{rounds:2,ids:both},{rounds:2,ids:both.slice().reverse()}],{version:2});
  assert.equal(valid(saturated,REPORTED_KIT).valid,true);
  const offered=new Set([...both,...GENTLE,'mountain-climbers']);
  const narrow=Object.fromEntries(Object.entries(C).map(([id,ex])=>[id,ex.main&&ex.generator&&!offered.has(id)?{...ex,generator:false}:ex]));
  // Slots 1–4 share their block with the TRX climber, so the bodyweight climber would be a variant there.
  for(let index=1;index<both.length;index++){
    const before=copy(saturated);
    G.swap(saturated,0,index,{catalogue:narrow,equipment:REPORTED_KIT,random:rng(index+1)});
    assert.deepEqual(copy(saturated),before,'slot '+index+' keeps the original');
  }
  // Replacing the TRX climber itself with the bodyweight one leaves no variant pair: a legitimate swap.
  const replaced=copy(saturated);
  G.swap(replaced,0,0,{catalogue:narrow,equipment:REPORTED_KIT,random:rng(1)});
  assert.equal(replaced.main.blocks[0].exercises[0].id,'mountain-climbers');
  assert.equal(valid(replaced,REPORTED_KIT).valid,true);
  // Traditional Cardio swaps: no gentle stepping on Normal/Hard, no in-block variant, and Hard keeps its gate.
  for(const difficulty of ['normal','hard'])for(const seed of [1,2,3]){
    const w=G.generate({catalogue:C,focus:'cardio',difficulty,duration:20,equipment:KITS.broad,random:rng(seed)}),before=ids(w);
    w.main.blocks.forEach((b,blockIndex)=>b.exercises.forEach((_,index)=>G.swap(w,blockIndex,index,{catalogue:C,equipment:KITS.broad,random:rng(seed*5+index)})));
    assert.ok(ids(w).some((id,index)=>id!==before[index]),'swaps actually replace exercises');
    assert.deepEqual(G.blockFamilyVariantIssues(w.main.blocks),[]);
    assert.ok(ids(w).every(id=>!GENTLE.includes(id)));
    if(difficulty==='hard')assert.equal(G.cardioChallenge(w.main.blocks).suitable,true,'seed '+seed);
  }
});

test('traditional Normal targets are a preference while Hard is a bounded deterministic gate that Normal ordinarily trails',()=>{
  // A pool that cannot meet Normal's preferred targets still builds a valid Normal workout.
  const weak=Object.fromEntries(Object.entries(C).map(([id,ex])=>[id,ex.generator&&ex.main&&(ex.conditioning||ex.cardio>=4)?{...ex,generator:false}:ex]));
  const normal=G.generate({catalogue:weak,focus:'cardio',difficulty:'normal',duration:20,equipment:[],random:rng(4)});
  assert.equal(G.cardioChallenge(normal.main.blocks,G.NORMAL_CARDIO_PREFERENCE).suitable,false);
  assert.deepEqual(G.validateMain(normal.main,weak,[],G.BUDGETS[20].main),[]);
  let harder=0,pairs=0;
  for(const kit of Object.keys(KITS))for(const duration of [10,15,20,30,45]){
    const options={catalogue:C,focus:'cardio',duration,equipment:KITS[kit]};
    let attempts=0;
    const hard=G.generate({...options,difficulty:'hard',random:rng(duration+kit.length),trace:event=>{if(event.type==='main-attempt')attempts++;}});
    assert.ok(attempts<=G.HARD_CARDIO_POLICY.maxAttempts);
    const h=G.cardioChallenge(hard.main.blocks),n=G.cardioChallenge(G.generate({...options,difficulty:'normal',random:rng(duration+kit.length)}).main.blocks);
    assert.equal(h.suitable,true,kit+' '+duration);
    assert.ok(h.cardioDemand>=3.6&&h.conditioningShare>=.6&&h.lowCardioShare<=.25&&h.maxWeakSeconds<=60);
    const again=G.generate({...options,difficulty:'hard',random:rng(duration+kit.length)});delete again.id;delete hard.id;
    assert.deepEqual(again,hard,'seeded Hard generation is reproducible');
    pairs++;if(h.cardioDemand*h.density>n.cardioDemand*n.density)harder++;
  }
  // Residual exceptions are Normal sessions that are already very demanding (Normal has no upper limit).
  assert.ok(harder>=pairs*.7,`Hard exceeded Normal in ${harder}/${pairs}`);
});

test('traditional Hard Cardio does not deliver a Main that equipment setup fitting pushes below the gate',()=>{
  // Reported edge case (rings, 20 min, seed 8): the bounded search chose this qualifying Main, then the
  // whole session (Main 888 s + 330 s preparation/cool-down) exceeded 20 minutes, setup fitting removed a
  // round from block 2, and the delivered Main fell below the 60% conditioning floor.
  const block=(ids,rounds)=>({protocol:'rounds',intent:'conditioning',exercises:ids.map(id=>C[id]),prescription:{rounds,exerciseRestSeconds:10,roundRestSeconds:30}});
  const first=block(['ski-abs','walking-lunge','squat-jumps','plank-up-downs'],2),second=['jumping-jacks','burpees','ring-row','bear-crawl'];
  const chosen=[first,block(second,3)],fitted=[first,block(second,2)],budget=G.BUDGETS[20];
  assert.equal(G.cardioChallenge(chosen).suitable,true);
  assert.ok(G.mainSeconds(chosen,['rings'])+budget.warmup+budget.rampup+budget.cooldown>20*60);
  const after=G.cardioChallenge(fitted);
  assert.equal(after.suitable,false);assert.ok(after.conditioningShare<G.HARD_CARDIO_POLICY.conditioningShare);
  // Now the same bounded search marks such attempts, keeps searching within its 40 attempts and delivers a
  // Main that still passes the gate after the real setup fitting, deterministically.
  for(const [equipment,seed] of [[['rings'],8],[['rings','trx','pullup-bar'],18]]){
    const options={catalogue:C,focus:'cardio',difficulty:'hard',duration:20,equipment},events=[],label=equipment.join('+');
    const w=G.generate({...options,random:rng(seed),trace:event=>{if(event.type==='main-attempt'&&event.hardCardio)events.push(event.hardCardio);}});
    assert.ok(events.some(event=>event.suitable&&!event.setupSuitable),label+' reproduces a qualifying Main that setup fitting breaks');
    assert.ok(events.length<=G.HARD_CARDIO_POLICY.maxAttempts,label);
    const delivered=G.cardioChallenge(w.main.blocks);
    assert.equal(delivered.suitable,true,label);assert.equal(delivered.highImpactAdjacency,0,label);
    assert.deepEqual(G.validateMain(w.main,C,equipment,G.BUDGETS[20].main).filter(issue=>issue!=='main:duration-out-of-tolerance'),[],label);
    if(w.setupEquipment)assert.ok(w.estimatedSeconds<=20*60,label+' setup-fitted session fits its duration');
    const again=G.generate({...options,random:rng(seed)});delete again.id;delete w.id;
    assert.deepEqual(again,w,label+' deterministic');
  }
  // With setup equipment but no pool able to meet the gate, generation still fails honestly.
  const lowImpact=Object.fromEntries(Object.entries(C).map(([id,ex])=>[id,ex.generator&&ex.main&&ex.impact!=='low'?{...ex,generator:false}:ex]));
  assert.throws(()=>G.generate({catalogue:lowImpact,focus:'cardio',difficulty:'hard',duration:20,equipment:['rings','trx'],random:rng(8)}),
    error=>error.code==='cardio-intensity-not-feasible'&&error.reason==='catalogue-infeasible'
      &&error.adjustments.some(item=>item.code==='change-difficulty'&&item.value==='normal'));
});

test('an ordinary Hard Cardio failure keeps settings, stays on Generator and shows an accessible message without a preview',()=>{
  const storage=new Map(),app=loadAppContext(storage);
  app.selectGeneratorFocus('cardio');app.selectGeneratorDifficulty('hard');app.selectGeneratorDuration(15);
  const before=copy([...storage]),original=app.GarageFitGenerator.generate;
  // Only the low-impact catalogue is available: Hard is provably unreachable, Normal builds.
  const lowImpact=Object.fromEntries(Object.entries(app.GarageFitData.exercises).map(([id,ex])=>[id,ex.generator&&ex.main&&ex.impact!=='low'?{...ex,generator:false}:ex]));
  let calls=0;app.GarageFitGenerator.generate=options=>{calls++;return original({...options,catalogue:lowImpact});};
  vm.runInContext('showScreen("generator");generatorState.workout=null',app);
  app.generateWorkout();
  assert.equal(calls,1);
  assert.equal(vm.runInContext('currentScreen',app),'generator');
  assert.equal(vm.runInContext('generatorState.workout',app),null,'no misleading preview');
  assert.equal(vm.runInContext('generatorState.difficulty',app),'hard','no silent downgrade');
  assert.equal(vm.runInContext('generatorState.focus',app),'cardio');assert.equal(vm.runInContext('generatorState.duration',app),15);
  assert.deepEqual(copy([...storage]),before);
  const message=app.document.getElementById('generatorFamilyError');
  assert.equal(message.classList.contains('hidden'),false);
  assert.equal(message.textContent,"The exercises available with your equipment aren't enough for a Hard cardio workout. Try Normal difficulty.");
  // A bounded-search miss is not described as impossible; verified adjustments are listed.
  assert.equal(app.cardioFailureMessage({code:'cardio-intensity-not-feasible',reason:'search-limit',
    adjustments:[{code:'change-duration',value:20},{code:'change-difficulty',value:'normal'}]}),
    "We couldn't put together a Hard cardio workout with these settings. Try 20 minutes or Normal difficulty.");
  assert.equal(app.cardioFailureMessage({reason:'search-limit',adjustments:[]}),
    "We couldn't put together a Hard cardio workout with these settings.");
  // The explicit-family message names a proven Cardio v2 intensity infeasibility through the same slot.
  vm.runInContext('generatorState.workoutFamilyId="cardio-conditioning"',app);
  assert.equal(app.familyFailureMessage({reasons:[{code:'intensity-standard-infeasible'}],adjustments:[{code:'change-difficulty',value:'normal'}]}),
    "Cardio & Conditioning is unavailable with these settings. The available exercises can't deliver a Hard cardio workout with these settings. Try Normal difficulty.");
  vm.runInContext('generatorState.workoutFamilyId=null',app);
  // Changing a setting clears the message; the restored Generator builds Normal normally.
  app.selectGeneratorDifficulty('normal');assert.equal(message.classList.contains('hidden'),true);
  app.generateWorkout();assert.equal(vm.runInContext('generatorState.workout.difficulty',app),'normal');
});

test('General Fitness v1 and v2 plan new Cardio v2 sessions without changing released definitions',()=>{
  const engine=GarageFitCoachEngine.createEngine({catalogue:C,assessSessionPrescription:G.assessSessionPrescription});
  for(const version of [1,2]){
    const def=GarageFitData.programmes['general-fitness'][version],now='2026-11-20T08:00:00Z';
    const released=copy(def);
    const state=engine.startProgramme(def,{programmeInstanceId:'cardio-v2-'+version,equipment:[]},now).state;
    const history=['strength-control','full-body-challenges','athletic-movement','core-stability','mobility-movement-quality'].map((id,i)=>GarageFitCoachModel.createSessionResult({sessionResultId:'prior-'+i,source:'generator',workoutFamilyId:id,workoutFamilyVersion:1,familyStyleId:'prior',startedAt:now,endedAt:now,finalStatus:'completed',plannedWork:[{occurrenceId:'prior-'+i,exerciseId:'air-squat',section:'main'}],performedWork:[{occurrenceId:'prior-'+i,exerciseId:'air-squat',status:'completed'}]}));
    const plan=engine.planNextSession(def,state,history,{now,prescriptionId:'rx-'+version,equipment:[],duration:30});
    const cardio=plan.prescription.workoutFamilyPlan.candidates.find(c=>c.workoutFamilyId===CARDIO);
    assert.equal(cardio.workoutFamilyVersion,2,'GF v'+version+' plans the current Cardio composition');
    assert.deepEqual(copy(def),released,'released definition unchanged');
    const w=G.generate({catalogue:C,sessionPrescription:{...plan.prescription,workoutFamilyPlan:{...plan.prescription.workoutFamilyPlan,candidates:[cardio]}},random:rng(version)});
    assert.equal(w.workoutFamilyId,CARDIO);assert.equal(w.workoutFamilyVersion,2);
    assert.equal(valid(w,[]).valid,true);
  }
});
