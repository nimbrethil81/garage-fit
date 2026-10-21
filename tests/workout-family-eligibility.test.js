const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
const {savedWorkoutV2,blockFixtures}=require('./helpers/protocol-fixtures');
global.window=global;
require('../data/equipment');require('../data/exercises');require('../data/workout-families');
require('../js/workout-families');require('../js/generator');
const F=GarageFitWorkoutFamilies,G=GarageFitGenerator,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value));
const catalogueBefore=JSON.stringify(C);
const bounds=(type,minValue=1,maxValue=60,extra={})=>({type,minValue,maxValue,...extra});
const entry=(exerciseId,role='flow',prescriptions=[bounds('timed')],extra={})=>({exerciseId,role,
  protocols:['rounds','paired_sets','timed_intervals'],prescriptions,...extra});
// These are contract fixtures, not the production catalogue policy owned by #179/180.
const mobilityEntries=[entry('hamstring-sweeps','flow',[bounds('timed'),bounds('reps',1,10,{secondsPerRep:4})]),
  entry('downward-upward-dog'),entry('trx-squat-overhead'),entry('wall-angel'),
  entry('cossack-squat','flow',[bounds('reps',1,10),bounds('timed')]),entry('hamstring-sweeps','short',[bounds('timed',1,10)])];
const athleticEntries=[entry('knee-to-opposite-elbow','control'),entry('skater-jumps','control'),
  entry('bear-crawl','control',[bounds('timed')],{requiresMovementRoom:true})];
const strengthEntries=['reverse-lunge','band-pallof-press','ring-row','ring-press-up'].map(id=>
  entry(id,'control',[bounds(C[id].prescription.type,1,C[id].prescription.type.includes('timed')?60:20)],{protocols:['rounds','paired_sets']}));
strengthEntries[0].prescriptions.push(bounds('unilateral-timed'));
const challengeEntries=Object.values(blockFixtures(C,{emom:true})).flatMap(block=>block.exercises.map(exercise=>
  entry(exercise.id,'challenge',[bounds(exercise.prescription.type,1,60)],{protocols:[...G.MAIN_PROTOCOLS]})))
  .filter((value,index,array)=>array.findIndex(item=>item.exerciseId===value.exerciseId)===index);
for(const [workoutFamilyId,entries] of [['mobility-movement-quality',mobilityEntries],['athletic-movement',athleticEntries],
  ['strength-control',strengthEntries],['full-body-challenges',challengeEntries]])
  F.registerMembershipPolicy({workoutFamilyId,entries});
const context=(overrides={})=>({workoutFamilyId:'mobility-movement-quality',workoutFamilyVersion:1,role:'flow',...overrides});
const dose=(type,value)=>({plannedPrescription:{type,value}});
function block(ids=['hamstring-sweeps','downward-upward-dog'],targets=[dose('timed',30),dose('timed',25)],familyContext=context()){
  return {id:'main-1',protocol:'rounds',intent:'strength',familyContext,exercises:ids.map(id=>copy(C[id])),
    prescription:{rounds:1,exerciseRestSeconds:5,roundRestSeconds:0},...(targets?{occurrenceTargets:targets}:{})};
}
function workout(b){const w=savedWorkoutV2(C);w.main.blocks=[b];return w;}

test('reviewed memberships are copied, deeply immutable, version-pinned and registered only once',()=>{
  const member=F.getMembership(context(),'hamstring-sweeps');
  assert.ok(Object.isFrozen(member)&&Object.isFrozen(member.protocols)&&Object.isFrozen(member.prescriptions[0]));
  mobilityEntries[0].prescriptions[0].maxValue=999;
  assert.equal(member.prescriptions[0].maxValue,60);
  assert.equal(F.getMembership(copy(context()),'hamstring-sweeps'),member);
  assert.equal(F.getMembership(context({role:'unknown'}),'hamstring-sweeps'),null);
  assert.equal(F.getMembership(context(),'hamstring-sweep'),null,'IDs are exact; related variants receive no implicit grant');
  assert.throws(()=>F.registerMembershipPolicy({workoutFamilyId:'mobility-movement-quality',entries:[]}),/only once/);
  assert.throws(()=>F.registerMembershipPolicy({workoutFamilyId:'core-stability',workoutFamilyVersion:2,entries:[]}),/version/);
  for(const entries of [[entry('plank'),entry('plank')],[entry('plank','flow',[bounds('timed',0,30)])],
    [entry('plank','flow',[bounds('timed',1,301)])],[entry('plank','flow',[bounds('reps',1,10,{secondsPerRep:0})])],
    [entry('plank','flow',[bounds('timed',1,10,{secondsPerRep:4})])],[entry('plank','flow',[bounds('timed')],{protocols:['invented']})]])
    assert.throws(()=>F.registerMembershipPolicy({workoutFamilyId:'core-stability',entries}),/membership|bounds/);
  assert.throws(()=>F.getMembership(context({workoutFamilyVersion:2}),'hamstring-sweeps'),/version/);
});

test('approved warm-up and cool-down IDs can be family Main without changing canonical phase flags',()=>{
  for(const id of ['hamstring-sweeps','downward-upward-dog']){
    assert.equal(G.generatedPhaseEligible(C[id],'main',[]),false);
    assert.equal(G.generatedPhaseEligible(C[id],'main',[],'normal',context()),true);
    assert.equal(G.generatedPhaseEligible(C[id],'main',[],'normal',context({role:'unknown'})),false);
    assert.equal(G.protocolCompatible(C[id],'rounds',context()),true);
  }
  const b=block();assert.deepEqual(G.validateMain({blocks:[b]},C,[]),[]);
  assert.deepEqual(G.resolveBlockSteps(b).filter(s=>s.kind==='exercise').map(s=>s.plannedPrescription.value),[30,25]);
  assert.equal(G.generatedPhaseEligible(C['hamstring-sweeps'],'warmup',[]),true);
  assert.equal(G.generatedPhaseEligible(C['downward-upward-dog'],'cooldown',[]),true);
  assert.equal(G.generatedPhaseEligible(C.plank,'main',[],'normal',context()),false);
  assert.deepEqual(G.validateCatalogue(C),[]);
  assert.equal(JSON.stringify(C),catalogueBefore);
});

test('equipment, Easy exclusions, impact, position and conservative movement-room requirements remain hard gates',()=>{
  assert.equal(G.generatedPhaseEligible(C['trx-squat-overhead'],'main',[],'normal',context()),false);
  assert.equal(G.generatedPhaseEligible(C['trx-squat-overhead'],'main',['trx'],'normal',context()),true);
  assert.equal(G.generatedPhaseEligible(C['downward-upward-dog'],'main',[],'normal',context({bodyPositions:['standing']})),false);
  const athletic=context({workoutFamilyId:'athletic-movement',role:'control'});
  assert.equal(G.generatedPhaseEligible(C['skater-jumps'],'main',[],'hard',athletic),false,'high impact excluded by default');
  assert.equal(G.generatedPhaseEligible(C['skater-jumps'],'main',[],'easy',{...athletic,excludedImpact:[]}),false);
  assert.equal(G.generatedPhaseEligible(C['skater-jumps'],'main',[],'hard',{...athletic,excludedImpact:[]}),true);
  assert.equal(G.generatedPhaseEligible(C['skater-jumps'],'main',[],'hard',{...athletic,excludedImpact:[],difficulty:'easy'}),false);
  assert.equal(G.generatedPhaseEligible(C['bear-crawl'],'main',[],'normal',athletic),false);
  assert.equal(G.generatedPhaseEligible(C['bear-crawl'],'main',[],'normal',{...athletic,movementRoom:true}),true);
  for(const invalid of [{excludedImpact:['unknown']},{difficulty:'unknown'},{movementRoom:'yes'},{extra:true}])
    assert.equal(G.generatedPhaseEligible(C['hamstring-sweeps'],'main',[],'normal',context(invalid)),false);
  const b=block(['trx-squat-overhead'],[dose('timed',30)]);
  assert.ok(G.validateMain({blocks:[b]},C,[]).some(issue=>issue.includes('family:ineligible')));
  assert.deepEqual(G.validateMain({blocks:[b]},C,['trx']),[]);
});

test('contextual timed/reps conversions require reviewed modes, bounds and pacing; defaults stay canonical',()=>{
  assert.throws(()=>G.resolveOccurrenceTarget(C['cossack-squat'],dose('timed',30)));
  assert.equal(G.resolveOccurrenceTarget(C['cossack-squat'],dose('timed',30),{familyContext:context()}).estimatedSeconds,30);
  assert.equal(G.resolveOccurrenceTarget(C['hamstring-sweeps'],dose('reps',6),{familyContext:context()}).estimatedSeconds,24);
  assert.equal(G.resolveOccurrenceTarget(C['cossack-squat'],dose('reps',5),{familyContext:context()}).estimatedSeconds,20);
  assert.throws(()=>G.resolveOccurrenceTarget(C['downward-upward-dog'],dose('reps',6),{familyContext:context()}));
  const defaults=block(['hamstring-sweeps'],null);
  assert.equal(G.estimateBlockDuration(defaults),C['hamstring-sweeps'].estimatedSeconds);
  const w=workout(block(['hamstring-sweeps','cossack-squat'],[dose('reps',6),dose('timed',25)]));
  const before=copy(w);G.normaliseWorkout(w);
  assert.equal(w.main.blocks[0].estimatedDurationSeconds,54);
  assert.deepEqual(w.main.blocks[0].exercises.map(ex=>ex.prescription),before.main.blocks[0].exercises.map(ex=>ex.prescription));
  assert.equal(JSON.stringify(C),catalogueBefore);
  const strength=context({workoutFamilyId:'strength-control',role:'control'});
  for(const [id,type,value,seconds] of [['reverse-lunge','unilateral-reps',7,32],['band-pallof-press','unilateral-timed',12,24]]){
    const b=block([id],[dose(type,value)],strength),step=G.resolveBlockSteps(b)[0];
    assert.equal(step.estimatedSeconds,seconds);assert.equal(G.estimateBlockDuration(b),seconds);
    assert.equal(step.plannedPrescription.type,type);
  }
});

test('invalid, stale, forged and unapproved overrides fail rather than silently reverting to defaults',()=>{
  const candidates=[block(['hamstring-sweeps'],[dose('timed',61)]),block(['hamstring-sweeps'],[dose('unilateral-timed',20)]),
    block(['hamstring-sweeps'],[dose('reps',1.5)]),block(['hamstring-sweeps'],[dose('timed',0)]),
    block(['hamstring-sweeps'],[null],context({role:'unknown'})),block(['hamstring-sweeps'],null,context({workoutFamilyVersion:2})),
    block(['hamstring-sweeps'],null,context({role:'short'})),block(['hamstring-sweeps'],[null],context({role:'short'}))];
  const forged=block();forged.exercises[0].prescription.value=5;candidates.push(forged);
  const phantom=block();phantom.exercises[0].id='not-in-catalogue';candidates.push(phantom);
  for(const invalidContext of [false,0,'',true,1,'flow',[]]){
    candidates.push(block(['hamstring-sweeps'],[dose('timed',20)],invalidContext));
    assert.equal(G.generatedPhaseEligible(C['hamstring-sweeps'],'main',[],'normal',invalidContext),false);
    assert.equal(G.protocolCompatible(C['hamstring-sweeps'],'rounds',invalidContext),false);
  }
  for(const b of candidates){
    assert.ok(G.validateMain({blocks:[b]},C,[]).length);
    assert.deepEqual(G.resolveBlockSteps(b),[]);assert.equal(G.estimateBlockDuration(b),0);
    assert.throws(()=>G.normaliseWorkout(workout(b)),/family context|occurrence targets/);
  }
  const intervals=block(['hamstring-sweeps'],[dose('timed',31)]);intervals.protocol='timed_intervals';
  intervals.prescription={cycles:1,workSeconds:30,transitionSeconds:0};
  assert.ok(G.validateOccurrenceTargets(intervals,C).length);
  const copied=copy(C['trx-squat-overhead']);copied.equipment=[];
  const b=block(['trx-squat-overhead']);b.exercises=[copied];
  assert.ok(G.validateFamilyBlock(b,C,[]).some(issue=>issue.includes('modified-exercise')));
});

test('existing protocol validators stay authoritative for family blocks, including advanced protocols',()=>{
  for(const original of Object.values(blockFixtures(C,{emom:true}))){
    const b=copy(original);b.familyContext=context({workoutFamilyId:'full-body-challenges',role:'challenge',excludedImpact:[]});
    assert.deepEqual(G.validateMain({blocks:[b]},C,['dumbbells','kettlebell','trx']),[],b.protocol);
    assert.deepEqual(G.resolveBlockSteps(b),G.resolveBlockSteps(original));
    assert.equal(G.estimateBlockDuration(b),G.estimateBlockDuration(original));
  }
  const b=block(['cossack-squat'],[dose('timed',30)]);b.protocol='timed_intervals';b.prescription={cycles:1,workSeconds:30,transitionSeconds:0};
  assert.equal(G.protocolCompatible(C['cossack-squat'],'timed_intervals',context()),false,'membership cannot loosen canonical protocol restrictions');
  assert.deepEqual(G.resolveBlockSteps(b),[]);
});

test('setup safety and family grants survive serialisation and constrain ordinary swaps',()=>{
  const strength=context({workoutFamilyId:'strength-control',role:'control'});
  const mixed=block(['ring-row','ring-press-up'],[dose('reps',6),dose('reps',6)],strength);
  mixed.prescription.rounds=2;mixed.occurrenceTargets=mixed.occurrenceTargets.concat(copy(mixed.occurrenceTargets));
  assert.ok(G.validateMain({blocks:[mixed]},C,['rings']).some(issue=>issue.includes('setup-profile-conflict')));
  const w=copy(workout(block(['hamstring-sweeps'],[dose('timed',25)])));
  const inputContext=w.main.blocks[0].familyContext,originalContext=copy(inputContext);G.normaliseWorkout(w);
  assert.notEqual(w.main.blocks[0].familyContext,inputContext);
  G.swap(w,0,0,{catalogue:C,equipment:[],random:()=>.3});
  const b=w.main.blocks[0];assert.notEqual(b.exercises[0].id,'hamstring-sweeps');
  assert.ok(['wall-angel','downward-upward-dog','cossack-squat'].includes(b.exercises[0].id));
  assert.deepEqual(b.familyContext,originalContext);assert.deepEqual(b.occurrenceTargets,[dose('timed',25)]);
  assert.deepEqual(G.validateMain(w.main,C,[]),[]);
  assert.deepEqual(b.exercises[0].prescription,C[b.exercises[0].id].prescription);
});

test('shared preview/player/tracker use contextual targets and per-side occurrence timing without invented measurements',async()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true,familyPolicies:false}),run=code=>vm.runInContext(code,app);
  app.membershipFixture=copy(mobilityEntries);app.membershipFixture[0].prescriptions[0].maxValue=60;
  run("GarageFitWorkoutFamilies.registerMembershipPolicy({workoutFamilyId:'mobility-movement-quality',entries:membershipFixture})");
  const w=workout(block(['hamstring-sweeps','cossack-squat'],[dose('reps',6),dose('timed',25)]));
  app.familyWorkout=copy(w);run('generatorState.workout=familyWorkout');
  app.startStandaloneGeneratedWorkout();const tracker=run('generatorState.tracker');await tracker.flush();
  const plan=copy(tracker.plannedWork().filter(work=>work.section==='main'));
  assert.equal(plan[0].prescription.reps,6);assert.equal(plan[1].prescription.seconds,25);
  assert.equal(new Set(plan.map(item=>item.occurrenceId)).size,2);
  assert.ok(plan.every(work=>work.prescription.variableTarget));
  assert.equal(run('GarageFitWorkoutPreview.occurrenceTargetLabel(generatorState.workout.main.blocks[0],0)'),'6 reps');
  const phases=run("generatorState.timeline.map((phase,index)=>({phase,index})).filter(({phase})=>phase.kind==='exercise'&&phase.section==='main')");
  app.enterGeneratedPhase(phases[0].index);app.generatedPrimaryAction();await tracker.flush();
  const outcome=copy(tracker.outcome(plan[0].occurrenceId));
  assert.equal(outcome.status,'completed');assert.equal(outcome.sets,undefined);
  app.strengthFixture=copy(strengthEntries);
  run("GarageFitWorkoutFamilies.registerMembershipPolicy({workoutFamilyId:'strength-control',entries:strengthFixture})");
  const perSide=block(['reverse-lunge','band-pallof-press'],[dose('unilateral-timed',12),dose('unilateral-timed',9)],
    context({workoutFamilyId:'strength-control',role:'control'}));
  app.familyWorkout=workout(perSide);run('generatorState.workout=familyWorkout');
  app.startStandaloneGeneratedWorkout();const sidedTracker=run('generatorState.tracker');await sidedTracker.flush();
  const sidedPlan=copy(sidedTracker.plannedWork().filter(work=>work.section==='main'));
  assert.deepEqual(sidedPlan.map(work=>[work.prescription.side,work.prescription.seconds]),[['right',12],['left',12],['right',9],['left',9]]);
  assert.equal(new Set(sidedPlan.map(work=>work.occurrenceId)).size,4);
  assert.deepEqual(copy(run("generatorState.timeline.filter(p=>p.kind==='exercise'&&p.section==='main').map(p=>p.seconds)")),[12,12,9,9]);
  assert.equal(G.estimateBlockDuration(perSide),47);
});

test('no-family seeded output and random draws match the pre-178 main baseline',()=>{
  const fixtures=[
    [{duration:10,focus:'strength',bodyFocus:'upper',difficulty:'easy',equipment:[]},68,'931adac57e2aebebcce46059fd27536c0620fc2edfbec2f1ac00cc2c5b3fceb7'],
    [{duration:20,focus:'balanced',bodyFocus:'lower',difficulty:'normal',equipment:['dumbbells']},111,'655da72fa8413f1331be410100453f7fa86b00592cec03fe959c133a99832a79'],
    [{duration:45,focus:'cardio',bodyFocus:'core',difficulty:'hard',equipment:['trx','bands']},189,'039cd7ab244719e91fa87432d1591f30182388c975292711e7375259866e4a03']
  ];
  for(const [options,expectedDraws,expectedHash] of fixtures){
    let seed=31,draws=0;
    const w=G.generate({...options,catalogue:C,random:()=>{draws++;seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}});delete w.id;
    assert.equal(draws,expectedDraws);assert.equal(createHash('sha256').update(JSON.stringify(w)).digest('hex'),expectedHash);
  }
  assert.equal(JSON.stringify(C),catalogueBefore);
});
