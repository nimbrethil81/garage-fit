const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fixtures=require('./helpers/coach-fixtures');
const baseline=require('./fixtures/setup-profile-no-rings.json');

global.window=global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/coach-model.js');
require('../js/generator.js');
const G=GarageFitGenerator,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value));
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const profiles={
  'rings-high':['ring-pull-up','ring-chin-up','neutral-grip-ring-pull-up','ring-knee-raise'],
  'rings-standing':['ring-row','ring-face-pull','ring-triceps-extension','ring-biceps-curl'],
  'rings-low':['ring-press-up','ring-fallout'],
  'rings-support':['ring-dip','foot-assisted-ring-dip','ring-support-hold','foot-assisted-ring-support-hold']
};
const block=(ids,protocol='rounds',prescription={rounds:3,exerciseRestSeconds:15,roundRestSeconds:45},catalogue=C)=>({
  id:'main-1',protocol,intent:'strength',exercises:ids.map(id=>copy(catalogue[id])),prescription
});
const anchor=(id,overrides={})=>fixtures.anchor({requirementId:'anchor-'+id,exerciseId:id,
  target:{type:'reps',minReps:4,maxReps:4},suggestedLoad:null,loadUnit:null,loadInterpretation:null,
  ...overrides});
const prescription=overrides=>fixtures.prescription({equipment:['rings'],movementPriorities:[],
  requiredAnchors:[],...overrides});

test('setup profiles default to null, validate allowed values and classify all fourteen rings',()=>{
  assert.deepEqual(G.validateCatalogue(C),[]);
  assert.equal(C['air-squat'].setupProfile,null);
  assert.equal(GarageFitData.buildExerciseCatalogue([{id:'example',name:'Example',
    instruction:'Stand still and breathe slowly.',prescription:{type:'timed',value:20}}]).example.setupProfile,null);
  for(const [profile,ids] of Object.entries(profiles)){
    assert.deepEqual(Object.values(C).filter(ex=>ex.setupProfile===profile).map(ex=>ex.id).sort(),ids.slice().sort());
  }
  for(const setupProfile of ['',false,3,{},'rings-medium']){
    assert.ok(G.validateCatalogue({...C,'ring-row':{...C['ring-row'],setupProfile}})
      .some(error=>error.includes('ring-row: invalid setupProfile')));
  }
});

test('setup keys group compatible profiles and preserve equipment alternatives and legacy keys',()=>{
  const key=id=>G.sectionSetupKey(C[id],['rings','dumbbells','bench']);
  for(const ids of Object.values(profiles))assert.equal(new Set(ids.map(key)).size,1);
  assert.equal(new Set(Object.values(profiles).map(ids=>key(ids[0]))).size,4);
  assert.equal(key('dumbbell-bench-press'),'bench+dumbbells');
  assert.equal(key('air-squat'),'bodyweight');
  assert.equal(G.sectionSetupKey(C['step-ups'],['box']),'box');
  const ids=['ring-pull-up','ring-fallout','ring-knee-raise','ring-press-up'];
  assert.deepEqual(G.groupSectionBySetup(ids.map(id=>C[id]),['rings']).map(ex=>ex.id),
    ['ring-pull-up','ring-knee-raise','ring-fallout','ring-press-up']);
  assert.equal(G.setupProfilesCompatible([C['ring-pull-up'],C['ring-fallout']],['rings']),false);
  assert.equal(G.setupProfilesCompatible([C['ring-row'],C['ring-triceps-extension'],C['trx-row'],C['air-squat']],['rings','trx']),true);
});

test('all current cycling protocols validate setup compatibility, including canonical metadata',()=>{
  // Synthetic classifications exercise the generic seam without opting shipped rings
  // into timed protocols or changing any of their movement/protocol metadata.
  const catalogue={};
  for(const [id,source,setupProfile] of [['test-row','trx-row','rings-high'],['test-press','trx-chest-press','rings-low']]){
    catalogue[id]={...copy(C[source]),id,equipment:[['rings']],setupProfile,
      mainProtocols:['rounds','paired_sets','timed_intervals']};
  }
  const targets=[{type:'reps',value:6},{type:'reps',value:6}];
  const conditions={
    rounds:{rounds:3,exerciseRestSeconds:15,roundRestSeconds:45},
    paired_sets:{sets:3,betweenExercisesSeconds:10,betweenSetsSeconds:60},
    timed_intervals:{cycles:3,workSeconds:30,transitionSeconds:20},
    emom:{minutes:5,slotSeconds:60,targets},
    ladder:{repSteps:[2,4,6],exerciseRestSeconds:15,stepRestSeconds:45},
    complex:{sequences:2,targets,changeoverSeconds:10,sequenceRestSeconds:75},
    density:{repeats:2,targets,timeCapSeconds:300,exerciseRestSeconds:15,roundRestSeconds:45}
  };
  for(const [protocol,p] of Object.entries(conditions)){
    const b=block(Object.keys(catalogue),protocol,p,catalogue);
    assert.ok(G.validateMain({blocks:[b]},catalogue,['rings']).includes('main-1:setup-profile-conflict'),protocol);
    b.exercises.forEach(ex=>ex.setupProfile='rings-high');
    assert.ok(G.validateMain({blocks:[b]},catalogue,['rings']).includes('main-1:setup-profile-conflict'),protocol+' cannot hide canonical profiles');
    catalogue['test-press'].setupProfile='rings-high';
    assert.deepEqual(G.validateMain({blocks:[b]},catalogue,['rings']),[],protocol+' same profile');
    catalogue['test-press'].setupProfile='rings-low';
  }
  const pyramid=block(['ring-row'],'pyramid',{steps:[{reps:4},{reps:8},{reps:4}],stepRestSeconds:60});
  assert.deepEqual(G.validateMain({blocks:[pyramid]},C,['rings']),[],'a single-exercise pyramid retains its setup');
  assert.equal(G.blockSetupCompatible(block(['ring-pull-up','ring-fallout'],'rounds',{rounds:1}),C,['rings']),true);
  assert.equal(G.blockSetupCompatible(block(['ring-pull-up','ring-fallout'],'paired_sets',{sets:1}),C,['rings']),false);
});

test('ring-only equipment and mixed kits retain useful duration, diversity and compatible blocks',()=>{
  const seenProfiles=new Set();let mixedBlocks=0,configurationChanges=0;
  for(const equipment of [['rings'],['rings','trx','pullup-bar','dumbbells']]){
    for(const duration of [10,15,20,30,45])for(const focus of ['strength','balanced','cardio'])for(const seed of [7,113,901]){
      const workout=G.generate({catalogue:C,equipment,duration,focus,random:random(seed)});
      assert.deepEqual(G.validateMain(workout.main,C,equipment,G.BUDGETS[duration].main),[]);
      assert.ok(Math.abs(workout.estimatedSeconds-duration*60)<=Math.max(180,duration*60*.18),
        equipment+' '+duration+' '+focus+' '+seed+': '+workout.estimatedSeconds);
      const exercises=workout.main.blocks.flatMap(b=>b.exercises);
      assert.ok(new Set(exercises.map(ex=>ex.id)).size>=(duration===10?2:3),'work must not collapse to one ring exercise');
      for(const b of workout.main.blocks){
        assert.ok(G.setupProfilesCompatible(b.exercises,equipment));
        b.exercises.filter(ex=>ex.setupProfile).forEach(ex=>seenProfiles.add(ex.setupProfile));
        if(b.exercises.some(ex=>ex.setupProfile)&&b.exercises.some(ex=>ex.equipment.length&&!ex.setupProfile))mixedBlocks++;
      }
      const configured=workout.main.blocks.map(b=>b.exercises.find(ex=>ex.setupProfile)?.setupProfile).filter(Boolean);
      if(new Set(configured).size>1)configurationChanges++;
      for(let i=0;i<exercises.length;i++)assert.equal(G.mainFamilyCapReached(exercises[i],exercises.slice(0,i)),false);
    }
  }
  assert.deepEqual([...seenProfiles].sort(),Object.keys(profiles).sort());
  assert.ok(mixedBlocks>0,'compatible blocks can include other equipment');
  assert.ok(configurationChanges>0,'different ring configurations remain available between blocks');
});

test('a constrained standalone fallback retains incompatible exercises in separate blocks',()=>{
  const ids=['ring-pull-up','ring-fallout'];
  const catalogue=Object.fromEntries(Object.entries(C).map(([id,exercise])=>[id,{...exercise,generator:ids.includes(id)}]));
  const w=G.generate({catalogue,equipment:['rings'],duration:10,focus:'strength',random:()=>.5});
  assert.equal(w.main.blocks.length,2);
  assert.deepEqual(w.main.blocks.flatMap(b=>b.exercises.map(ex=>ex.id)).sort(),ids.slice().sort());
  assert.deepEqual(G.validateMain(w.main,catalogue,['rings']),[]);
  assert.ok(Math.abs(w.estimatedSeconds-600)<180);
});

test('Coach retains incompatible required anchors in separate permitted blocks with exact dose',()=>{
  const rx=prescription({requiredAnchors:[anchor('ring-pull-up'),anchor('ring-fallout')]});
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:rx}).status,'feasible');
  for(const seed of [1,113,901]){
    const w=G.generate({catalogue:C,sessionPrescription:rx,random:random(seed)});
    assert.deepEqual(G.validateMain(w.main,C,['rings']),[]);
    const placements=w.prescriptionOutcome.requiredAnchorPlacements;
    assert.equal(placements.length,2);
    assert.notEqual(placements[0].blockIndex,placements[1].blockIndex);
    for(const placement of placements)assert.equal(placement.expectedExposureCount,3);
  }
});

test('Coach paired-only work reports unavailable partners instead of hiding incompatible anchors',()=>{
  const paired=id=>anchor(id,{allowedProtocols:['paired_sets']});
  const rx=prescription({requiredAnchors:[paired('ring-pull-up'),paired('ring-fallout')],optionalMainExerciseIds:[]});
  const assessment=G.assessSessionPrescription({catalogue:C,sessionPrescription:rx});
  assert.equal(assessment.status,'infeasible');
  assert.ok(assessment.hardConflicts.some(c=>c.code==='protocol-partner-unavailable'));
  assert.throws(()=>G.generate({catalogue:C,sessionPrescription:rx,random:()=>{throw Error('unexpected draw');}}),G.SessionPrescriptionError);
  // Interleaved high/low input must find high/high and low/low pairs.
  const compatible=prescription({requiredAnchors:['ring-pull-up','ring-press-up','ring-knee-raise','ring-fallout'].map(paired),optionalMainExerciseIds:[]});
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:compatible}).status,'feasible');
  const w=G.generate({catalogue:C,sessionPrescription:compatible,random:random(3)});
  assert.deepEqual(G.validateMain(w.main,C,['rings']),[]);
  assert.equal(w.prescriptionOutcome.requiredAnchorPlacements.length,4);
  // The split-dose fallback must also respect profiles when unequal required doses
  // cannot use the ordinary equal-dose reservation path.
  const split=prescription({requiredAnchors:[paired('ring-pull-up'),anchor('ring-knee-raise',{allowedProtocols:['paired_sets'],targetSets:2}),
    anchor('ring-fallout',{allowedProtocols:['paired_sets'],targetSets:1})],optionalMainExerciseIds:[]});
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:split}).status,'infeasible');
});

test('Coach optional minimum and required/preferred partners find compatible pairs',()=>{
  const options={catalogue:C};
  // The shortest exercise (high pull-up) has no partner; low press-up/fallout do.
  const optional=prescription({optionalMainExerciseIds:['ring-pull-up','ring-press-up','ring-fallout'],
    protocolConstraints:[{requirementId:'pairs',importance:'hard',allowedProtocols:['paired_sets']}]});
  assert.equal(G.assessSessionPrescription({...options,sessionPrescription:optional}).status,'feasible');
  const w=G.generate({...options,sessionPrescription:optional,random:random(7)});
  assert.deepEqual(G.validateMain(w.main,C,['rings']),[]);
  assert.ok(w.main.blocks.every(b=>b.exercises.every(ex=>ex.setupProfile==='rings-low')));
  for(const importance of ['required','preferred']){
    const a=anchor('ring-pull-up',{importance,allowedProtocols:['paired_sets']});
    const rx=prescription({[importance==='required'?'requiredAnchors':'preferredAnchors']:[a],
      optionalMainExerciseIds:['ring-fallout','ring-knee-raise']});
    const result=G.generate({...options,sessionPrescription:rx,random:random(113)});
    assert.deepEqual(G.validateMain(result.main,C,['rings']),[]);
    for(const b of result.main.blocks.filter(b=>b.exercises.some(ex=>ex.coachAnchor))){
      assert.ok(b.exercises.every(ex=>ex.setupProfile==='rings-high'));
    }
  }
});

test('swaps reject incompatible-only replacements, can keep other kit, and protect required anchors',()=>{
  const workout=()=>({duration:30,focus:'strength',difficulty:'normal',bodyFocus:'full-body',
    warmup:{estimatedSeconds:0,exercises:[]},rampup:{estimatedSeconds:0,exercises:[]},cooldown:{estimatedSeconds:0,exercises:[]},
    main:{blocks:[block(['ring-pull-up','ring-knee-raise'],'paired_sets',{sets:3,betweenExercisesSeconds:10,betweenSetsSeconds:60})]}});
  const w=workout();G.normaliseWorkout(w);
  const before=copy(w.main.blocks);
  const incompatible={'ring-fallout':C['ring-fallout']};
  G.swap(w,0,1,{catalogue:incompatible,equipment:['rings'],random:random(1)});
  assert.deepEqual(w.main.blocks,before,'no incompatible replacement');
  G.swap(w,0,1,{catalogue:{...incompatible,'trx-row':C['trx-row']},equipment:['rings','trx'],random:random(1)});
  assert.equal(w.main.blocks[0].exercises[1].id,'trx-row');
  assert.deepEqual(G.validateMain(w.main,C,['rings','trx']),[]);
  const rx=prescription({requiredAnchors:[anchor('ring-pull-up',{allowedProtocols:['paired_sets']})],optionalMainExerciseIds:['ring-knee-raise','ring-fallout']});
  const coached=G.generate({catalogue:C,sessionPrescription:rx,random:random(9)});
  const placement=coached.prescriptionOutcome.requiredAnchorPlacements[0],snapshot=copy(coached);
  assert.throws(()=>G.swap(coached,placement.blockIndex,placement.exerciseIndex,{catalogue:C,equipment:['rings']}),/Required Coach anchor/);
  assert.deepEqual(coached,snapshot);
  const partner=placement.exerciseIndex?0:1;
  G.swap(coached,placement.blockIndex,partner,{catalogue:C,equipment:['rings'],random:random(1)});
  assert.deepEqual(G.validateMain(coached.main,C,['rings']),[]);
  assert.equal(coached.main.blocks[placement.blockIndex].exercises[placement.exerciseIndex].id,'ring-pull-up');
});

test('no-ring plans, estimates and random consumption match baseline main d454da9',()=>{
  for(const {equipment,duration,focus,seed,draws,hash} of baseline.fixtures){
    const rng=random(seed);let actualDraws=0;
    const workout=G.generate({catalogue:C,equipment,duration,focus,random:()=>{actualDraws++;return rng();}});
    delete workout.id;
    // The new default null field is an intentional catalogue shape change.
    const actual=crypto.createHash('sha256').update(JSON.stringify(workout,(key,value)=>key==='setupProfile'?undefined:value)).digest('hex');
    assert.equal(actual,hash,equipment+' '+duration+' '+focus);
    assert.equal(actualDraws,draws,equipment+' '+duration+' '+focus+' RNG');
  }
});
