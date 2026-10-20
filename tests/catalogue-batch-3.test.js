const test=require('node:test');
const assert=require('node:assert/strict');
const {loadAppContext}=require('./helpers/app-context');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/coach-model.js');
require('../js/generator.js');
const G=GarageFitGenerator, catalogue=GarageFitData.exercises;
const clone=value=>JSON.parse(JSON.stringify(value));
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const main=workout=>workout.main.blocks.flatMap(block=>block.exercises);
// id, equipment, patterns, body focus, difficulty, role, type, reps/seconds, sidedness, total estimate
const BATCH=[
  ['dumbbell-pullover','dumbbells',['pull'],'upper','moderate','supporting','reps',10,'bilateral',35],
  ['single-arm-dumbbell-floor-press','dumbbells',['push'],'upper','moderate','primary','unilateral-reps',8,'per-side',50],
  ['dumbbell-single-leg-calf-raise','dumbbells',[],'lower','moderate','supporting','unilateral-reps',12,'per-side',65],
  ['dumbbell-split-squat','dumbbells',['lunge'],'lower','moderate','primary','unilateral-reps',8,'per-side',50],
  ['bird-dog',null,['core'],'core','easy','primary','reps',12,'alternating',40],
  ['side-plank-reach-through',null,['core'],'core','moderate','primary','unilateral-reps',8,'per-side',50],
  ['fast-feet',null,[],'lower','moderate','supporting','timed',30,'alternating',30],
  ['trx-face-pull','trx',['pull'],'upper','moderate','supporting','reps',12,'bilateral',35],
  ['trx-chest-fly','trx',['push'],'upper','hard','supporting','reps',8,'bilateral',30],
  ['kettlebell-half-kneeling-press','kettlebell',['push'],'upper','moderate','primary','unilateral-reps',8,'per-side',50],
  ['kettlebell-dead-stop-swing','kettlebell',['hinge'],'lower','hard','primary','reps',10,'bilateral',40],
  ['hanging-oblique-knee-raise','pullup-bar',['core','pull'],'core','hard','primary','reps',10,'alternating',35]
];
const IDS=BATCH.map(row=>row[0]);

test('Batch 3 contains the twelve approved Main-only movements with accurate prescriptions and equipment',()=>{
  assert.equal(new Set(IDS).size,12);
  for(const [id,equipment,patterns,bodyFocus,difficulty,mainRole,type,value,sidedness,seconds] of BATCH){
    const ex=catalogue[id];
    assert.ok(ex,id);
    assert.match(id,/^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.deepEqual([ex.equipment,ex.patterns,ex.bodyFocus,ex.difficulty,ex.mainRole,ex.prescription,ex.sidedness,ex.estimatedSeconds],
      [equipment?[[equipment]]:[],patterns,bodyFocus,difficulty,mainRole,{type,value},sidedness,seconds],id);
    assert.ok(ex.generator&&ex.main,id);
    assert.equal(ex.warmup||ex.rampup||ex.cooldown,false,id);
    assert.equal(ex.directElbowAction,null,id);
    assert.equal(ex.load,equipment==='dumbbells'||equipment==='kettlebell'?'Medium':null,id);
    assert.ok(ex.instruction.length>0&&ex.instruction.length<=180,id);
    assert.equal(ex.instruction.split(/(?<=\.)\s+/).length,1,id);
    assert.deepEqual(ex.timedCues,[],id);
    assert.deepEqual(ex.mainProtocols,id==='fast-feet'?['rounds','paired_sets','timed_intervals']:['rounds','paired_sets'],id);
    assert.equal(ex.conditioning,id==='fast-feet',id);
    assert.ok(G.generatedPhaseEligible(ex,'main',equipment?[equipment]:[]),id);
    if(equipment){
      assert.equal(G.generatedPhaseEligible(ex,'main',[]),false,id);
      assert.equal(G.generatedPhaseEligible(ex,'main',['bands','bench','box','barbell']),false,id);
    }
    assert.equal(G.generatedPhaseEligible(ex,'main',equipment?[equipment]:[],'easy'),difficulty!=='hard',id);
  }
  assert.deepEqual(G.validateCatalogue(catalogue),[]);
  assert.equal(catalogue['fast-feet'].impact,'medium'); // small bouncing steps, per the impact rubric
  assert.ok(catalogue['kettlebell-dead-stop-swing'].cardio<catalogue['kettlebell-swing'].cardio);
  for(const id of ['trx-chest-fly','kettlebell-dead-stop-swing'])assert.equal(catalogue[id].voiceInstruction,true,id);
});

test('per-side sets play right then left and budget both sides; alternating totals and Fast feet play once',()=>{
  const app=loadAppContext();
  for(const [id,,,,,,type,value,sidedness,seconds] of BATCH){
    const ex=catalogue[id];
    const phases=clone(app.makeGeneratedExercisePhases(ex,'main',null,0).map(phase=>[phase.side,phase.seconds,phase.timed]));
    if(sidedness==='per-side'){
      assert.equal(G.sideCount(ex),2,id);
      assert.deepEqual(phases,[['right',null,false],['left',null,false]],id);
      assert.match(app.formatPrescription(ex),new RegExp('^'+value+' reps each side'),id);
      // ~3 seconds per rep on each side plus setup and the side change.
      assert.ok(seconds>=value*2*2.5+5,id);
    }else{
      assert.equal(G.sideCount(ex),1,id);
      assert.deepEqual(phases,[[null,type==='timed'?30:null,type==='timed']],id);
    }
  }
});

const PAIRS=[
  ['single-arm-dumbbell-floor-press','dumbbell-floor-press','floor-press'],
  ['dumbbell-split-squat','trx-split-squat','split-squat'],
  ['trx-face-pull','band-face-pull','face-pull'],
  ['kettlebell-half-kneeling-press','kettlebell-shoulder-press','overhead-press'],
  ['kettlebell-dead-stop-swing','kettlebell-swing','kettlebell-swing'],
  ['hanging-oblique-knee-raise','hanging-knee-raise','hanging-knee-raise']
];
test('direct variants share soft families; distinct mechanics stay distinct and sumo keeps its hard cap',()=>{
  for(const [a,b,family] of PAIRS){
    assert.equal(catalogue[a].family,family,a);
    assert.equal(G.sameFamily(catalogue[a],catalogue[b]),true,a);
    assert.equal(G.mainFamilyCapReached(catalogue[a],[catalogue[b]]),false,a);
    assert.equal(G.mainFamilyCapReached(catalogue[b],[catalogue[a]]),false,b);
    assert.ok(G.recentUsePenalty(catalogue[a],[[b]],catalogue)>0,a);
  }
  assert.ok(G.sameFamily(catalogue['kettlebell-dead-stop-swing'],catalogue['kettlebell-single-arm-swing']));
  for(const [a,b] of [['side-plank-reach-through','side-plank'],['trx-chest-fly','trx-chest-press']])
    assert.equal(G.sameFamily(catalogue[a],catalogue[b]),false,a);
  for(const id of IDS){assert.equal(catalogue[id].repetitionClass,null,id);assert.equal(catalogue[id].frequency,null,id);}
  assert.equal(G.mainFamilyCapReached(catalogue['dumbbell-sumo-squat'],[catalogue['kettlebell-sumo-squat']]),true);
});

function sample(equipment,bodyFocus,focuses=['strength','balanced'],seeds=30){
  const workouts=[];
  for(const focus of focuses)for(const duration of [30,45])for(let seed=1;seed<=seeds;seed++)
    workouts.push(G.generate({catalogue,equipment,bodyFocus,duration,focus,random:random(seed*104729+duration*7+focus.length)}));
  return workouts;
}
function reachable(workouts,ids){
  for(const id of ids){
    const count=workouts.filter(workout=>main(workout).some(ex=>ex.id===id)).length;
    assert.ok(count>0,id+' selected in '+count+'/'+workouts.length+' workouts');
  }
}

test('bodyweight and hanging additions are reachable under appropriate focuses',()=>{
  reachable(sample([],'core'),['bird-dog','side-plank-reach-through']);
  reachable(sample([],'lower',['cardio','balanced']),['fast-feet']);
  reachable(sample(['pullup-bar'],'core'),['hanging-oblique-knee-raise']);
});
test('dumbbell primaries and pullover are reachable in longer Main workouts',()=>{
  reachable(sample(['dumbbells'],'upper'),['single-arm-dumbbell-floor-press','dumbbell-pullover']);
  reachable(sample(['dumbbells'],'lower'),['dumbbell-split-squat']);
});
test('the patternless supporting calf raise is reachable without fabricated lower-body patterns',()=>{
  assert.deepEqual(catalogue['dumbbell-single-leg-calf-raise'].patterns,[]);
  const workouts=sample(['dumbbells'],'lower');
  reachable(workouts,['dumbbell-single-leg-calf-raise']);
  for(const workout of workouts)assert.ok(main(workout).filter(ex=>ex.id==='dumbbell-single-leg-calf-raise').length<=1);
});
test('TRX accessories and both kettlebell additions are reachable',()=>{
  reachable(sample(['trx'],'upper'),['trx-face-pull','trx-chest-fly']);
  reachable(sample(['kettlebell'],'upper'),['kettlebell-half-kneeling-press']);
  reachable(sample(['kettlebell'],'lower'),['kettlebell-dead-stop-swing']);
});

test('the expanded accessory pool retains old and new supporting opportunities',()=>{
  const workouts=sample(['dumbbells','trx','pullup-bar'],'upper',['strength','balanced'],60);
  reachable(workouts,['dumbbell-floor-fly','dumbbell-hammer-curl','dumbbell-overhead-triceps-extension',
    'dumbbell-lateral-raise','dumbbell-alternating-front-raise','dumbbell-pullover','trx-face-pull','trx-chest-fly']);
  for(const workout of workouts){
    const exercises=main(workout);
    assert.equal(new Set(exercises.map(ex=>ex.id)).size,exercises.length);
    for(const ex of exercises.filter(ex=>ex.mainRole==='supporting'))assert.equal(exercises.filter(other=>other.id===ex.id).length,1);
  }
});

test('new exercises can satisfy an explicit Coach anchor without changing programme anchor definitions',()=>{
  const fixtures=require('./helpers/coach-fixtures');
  for(const [id,equipment,,,,,type,value] of BATCH.filter(row=>row[6]!=='timed')){
    const rx=fixtures.prescription({duration:30,equipment:equipment?[equipment]:[],movementPriorities:[],requiredAnchors:[
      fixtures.anchor({requirementId:'anchor-'+id,exerciseId:id,targetSets:3,target:{type:'reps',minReps:value,maxReps:value},allowedProtocols:['rounds','paired_sets']})
    ]});
    assert.equal(G.assessSessionPrescription({catalogue,sessionPrescription:rx}).status,'feasible',id);
    assert.ok(main(G.generate({catalogue,sessionPrescription:rx,random:random(5)})).some(ex=>ex.id===id),id);
  }
});


test('a larger equipment pool retries rejected variety attempts before falling back to a short Main',()=>{
  const equipment=['kettlebell','pullup-bar'],attempts=[];
  const workout=G.generate({catalogue,equipment,duration:45,focus:'cardio',bodyFocus:'lower',random:random(8*53+45),
    trace:event=>{if(event.type==='main-attempt')attempts.push(event);}});
  assert.equal(attempts.slice(0,10).filter(attempt=>attempt.issues.includes('main:equipment-diversity-below-minimum')).length,10);
  assert.ok(attempts.length>10&&attempts.length<=20);
  assert.ok(Math.abs(workout.estimatedSeconds-45*60)<=45*60*.18);
  assert.deepEqual(G.validateMain(workout.main,catalogue,equipment,G.BUDGETS[45].main),[]);
  const eligible=Object.values(catalogue).filter(ex=>G.generatedPhaseEligible(ex,'main',equipment));
  assert.deepEqual(G.mainVarietyIssues(workout.main.blocks,45,eligible),[]);
});
