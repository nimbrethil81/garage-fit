const test=require('node:test');
const assert=require('node:assert/strict');
const {loadAppContext}=require('./helpers/app-context');
const fixtures=require('./helpers/coach-fixtures');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/coach-model.js');
require('../js/generator.js');
const G=GarageFitGenerator,catalogue=GarageFitData.exercises;
const clone=value=>JSON.parse(JSON.stringify(value));
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const main=workout=>workout.main.blocks.flatMap(block=>block.exercises);
// id, display name, difficulty, role, pattern(s), body focus, position, type, dose, seconds
const BATCH=[
  ['ring-pull-up','Ring pull-up','hard','primary',['pull'],'upper','hanging','reps',5,25],
  ['ring-chin-up','Ring chin-up','hard','primary',['pull'],'upper','hanging','reps',5,25],
  ['neutral-grip-ring-pull-up','Neutral-grip ring pull-up','hard','primary',['pull'],'upper','hanging','reps',5,25],
  ['ring-row','Ring row','easy','primary',['pull'],'upper','standing','reps',10,30],
  ['ring-face-pull','Ring face pull','moderate','supporting',['pull'],'upper','standing','reps',10,35],
  ['ring-dip','Ring dip','hard','primary',['push'],'upper','supported','reps',5,30],
  ['foot-assisted-ring-dip','Foot-assisted ring dip','moderate','primary',['push'],'upper','supported','reps',8,35],
  ['ring-press-up','Ring press-up','hard','primary',['push'],'upper','floor','reps',6,30],
  ['ring-triceps-extension','Ring triceps extension','moderate','supporting',['push'],'upper','standing','reps',10,35],
  ['ring-biceps-curl','Ring biceps curl','easy','supporting',['pull'],'upper','standing','reps',10,35],
  ['ring-support-hold','Ring support hold','hard','supporting',['push'],'upper','supported','timed',15,15],
  ['foot-assisted-ring-support-hold','Foot-assisted ring support hold','easy','supporting',['push'],'upper','supported','timed',20,20],
  ['ring-knee-raise','Ring knee raise','moderate','primary',['core','pull'],'core','hanging','reps',8,30],
  ['ring-fallout','Ring fallout','moderate','supporting',['core'],'core','floor','reps',8,35]
];
const IDS=BATCH.map(row=>row[0]);

test('exactly fourteen approved rings-only entries have valid Main metadata and difficulty gates',()=>{
  assert.deepEqual(Object.values(catalogue).filter(ex=>ex.equipment.flat().includes('rings')).map(ex=>ex.id).sort(),IDS.slice().sort());
  for(const [id,name,difficulty,role,patterns,bodyFocus,position,type,value,seconds] of BATCH){
    const ex=catalogue[id];
    assert.deepEqual([ex.name,ex.equipment,ex.difficulty,ex.mainRole,ex.patterns,ex.bodyFocus,ex.bodyPosition,ex.prescription,ex.estimatedSeconds],
      [name,[['rings']],difficulty,role,patterns,bodyFocus,position,{type,value},seconds],id);
    assert.ok(ex.main&&ex.generator,id);
    assert.equal(ex.warmup||ex.rampup||ex.cooldown,false,id);
    assert.equal(ex.conditioning,false,id);
    assert.equal(ex.impact,'low',id);
    assert.equal(ex.load,null,id);
    assert.equal(ex.sidedness,type==='timed'?'none':'bilateral',id);
    assert.ok(G.generatedPhaseEligible(ex,'main',['rings']),id);
    assert.equal(G.generatedPhaseEligible(ex,'main',[]),false,id);
    assert.equal(G.generatedPhaseEligible(ex,'main',GarageFitData.equipment.map(e=>e.id).filter(id=>id!=='rings')),false,id);
    assert.equal(G.generatedPhaseEligible(ex,'main',['rings'],'easy'),difficulty!=='hard',id);
    assert.ok(ex.instruction.length>20&&ex.instruction.length<=180,id);
    assert.doesNotMatch(ex.instruction,/[\r\n]|mount|load-rated/,id);
    assert.equal(ex.instruction.split(/(?<=\.)\s+/).length,1,id);
    assert.equal(ex.directElbowAction,id==='ring-biceps-curl'?'flexion':id==='ring-triceps-extension'?'extension':null,id);
    assert.deepEqual(ex.mainProtocols,['rounds','paired_sets'],id);
    assert.equal(G.protocolCompatible(ex,'timed_intervals'),false,id);
    assert.equal(G.protocolCompatible(ex,'emom'),false,id);
    if(difficulty==='hard')for(const protocol of ['ladder','pyramid','complex','density'])assert.equal(G.protocolCompatible(ex,protocol),false,id+'/'+protocol);
    if(type==='timed')assert.deepEqual(ex.prescriptionModes,['time'],id);
  }
  assert.deepEqual(G.validateCatalogue(catalogue),[]);
});

test('pulling grips, assisted loading and kneeling fallout have explicit distinct instructions',()=>{
  assert.match(catalogue['ring-pull-up'].instruction,/palms facing away.*elbows out/);
  assert.match(catalogue['ring-chin-up'].instruction,/palms facing you.*elbows close/);
  assert.match(catalogue['neutral-grip-ring-pull-up'].instruction,/palms facing each other.*keeping that grip/);
  for(const id of ['foot-assisted-ring-dip','foot-assisted-ring-support-hold'])assert.match(catalogue[id].instruction,/feet planted.*legs/);
  assert.match(catalogue['ring-row'].instruction,/more upright to ease/);
  assert.match(catalogue['ring-fallout'].instruction,/Kneel.*limiting the reach/);
});

test('direct equipment variants share recency without hard caps; grip and assistance progressions stay distinct',()=>{
  for(const [ring,other] of [['ring-pull-up','pull-up'],['ring-chin-up','chin-up'],['ring-row','trx-row'],
    ['ring-face-pull','trx-face-pull'],['ring-biceps-curl','trx-biceps-curl'],['ring-triceps-extension','trx-triceps-press'],
    ['ring-press-up','push-up'],['ring-knee-raise','hanging-knee-raise']]){
    assert.ok(G.sameFamily(catalogue[ring],catalogue[other]),ring);
    assert.ok(G.recentUsePenalty(catalogue[ring],[[other]],catalogue)>0,ring);
    assert.equal(G.mainFamilyCapReached(catalogue[ring],[catalogue[other]]),false,ring);
  }
  for(const [a,b] of [['ring-pull-up','ring-chin-up'],['ring-pull-up','neutral-grip-ring-pull-up'],
    ['ring-dip','foot-assisted-ring-dip'],['ring-support-hold','foot-assisted-ring-support-hold']]){
    assert.equal(G.sameFamily(catalogue[a],catalogue[b]),false,a);
    assert.ok(G.sameRepetitionClass(catalogue[a],catalogue[b]),a);
    assert.equal(G.mainFamilyCapReached(catalogue[a],[catalogue[b]]),false,a);
  }
  for(const id of ['pull-up','chin-up','hanging-knee-raise','toes-to-bar','dead-hang']){
    assert.deepEqual(catalogue[id].equipment,[['pullup-bar']],id);
    assert.match(catalogue[id].instruction,/bar/,id);
  }
  assert.equal(catalogue['toes-to-bar'].name,'Toes-to-bar');
});

test('Library rings filter lists each approved movement once and details retain the ring icon and instruction',()=>{
  const app=loadAppContext();app.openExerciseLibrary();
  app.document.getElementById('libraryEquipment').value='rings';app.renderExerciseLibrary();
  const rows=app.document.getElementById('libraryList').children;
  assert.equal(rows.length,14);
  assert.deepEqual(rows.map(row=>row.children[0].children.find(child=>child.className==='library-name').textContent).sort(),BATCH.map(row=>row[1]).sort());
  for(const id of IDS){
    app.openExerciseDetail(id);
    assert.equal(app.document.getElementById('libraryDetailEquipment').textContent,'Gymnastic rings');
    assert.equal(app.document.getElementById('libraryDetailInstruction').textContent,catalogue[id].instruction);
    assert.equal(app.GarageFitEquipmentIcons.primaryEquipmentId(catalogue[id]),'rings');
  }
});

test('all fourteen ring exercises are reachable in a bounded sample, including supporting holds',()=>{
  const seen=new Set();let workouts=0;
  // 240 deterministic ring-only workouts; Easy explicitly exercises the assisted progressions.
  for(const bodyFocus of ['upper','core'])for(const focus of ['strength','balanced'])for(const duration of [30,45])for(const difficulty of ['normal','easy'])for(let seed=1;seed<=15;seed++){
    const workout=G.generate({catalogue,equipment:['rings'],bodyFocus,focus,duration,difficulty,random:random(seed*104729+duration*7+focus.length)});
    workouts++;
    assert.deepEqual(G.validateMain(workout.main,catalogue,['rings'],G.BUDGETS[duration].main),[]);
    for(const ex of main(workout)){
      if(IDS.includes(ex.id))seen.add(ex.id);
      assert.ok(!ex.equipment.length||ex.equipment.flat().every(id=>id==='rings'),ex.id);
      if(ex.mainRole==='supporting')assert.equal(main(workout).filter(other=>other.id===ex.id).length,1,ex.id);
    }
  }
  assert.equal(workouts,240);
  assert.deepEqual(IDS.filter(id=>!seen.has(id)),[],'unreachable ring exercises');
});

test('ring prescriptions execute once per set and Coach anchors preserve reps or timed holds',()=>{
  const app=loadAppContext();
  for(const id of IDS){
    const ex=catalogue[id],timed=ex.prescription.type==='timed';
    const phases=clone(app.makeGeneratedExercisePhases(ex,'main',null,0).map(phase=>[phase.side,phase.seconds,phase.timed]));
    assert.deepEqual(phases,[[null,timed?ex.prescription.value:null,timed]],id);
    const target=timed?{type:'timed',seconds:ex.prescription.value}:{type:'reps',minReps:ex.prescription.value,maxReps:ex.prescription.value};
    const rx=fixtures.prescription({duration:30,equipment:['rings'],movementPriorities:[],requiredAnchors:[
      fixtures.anchor({requirementId:'anchor-'+id,exerciseId:id,targetSets:3,target,suggestedLoad:null,loadUnit:null,loadInterpretation:null,progressionIntent:'maintain'})
    ]});
    assert.equal(G.assessSessionPrescription({catalogue,sessionPrescription:rx}).status,'feasible',id);
    const workout=G.generate({catalogue,sessionPrescription:rx,random:random(5)});
    assert.ok(main(workout).some(item=>item.id===id),id);
    const steps=workout.main.blocks.flatMap(block=>G.resolveBlockSteps(block).filter(step=>step.kind==='exercise'&&block.exercises[step.exerciseIndex].id===id).map(step=>step.plannedPrescription||block.exercises[step.exerciseIndex].prescription));
    assert.ok(steps.length>=3,id);
    for(const prescription of steps)assert.deepEqual(prescription,ex.prescription,id);
  }
});
