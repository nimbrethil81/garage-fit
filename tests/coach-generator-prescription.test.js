const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context.js');
const fixtures = require('./helpers/coach-fixtures.js');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/coach-model.js');
require('../js/coach-store.js');
require('../js/session-tracker.js');
require('../js/generator.js');
const Generator = GarageFitGenerator, Model = GarageFitCoachModel;
const catalogue = GarageFitData.exercises;
const kit = GarageFitData.equipment.map(item=>item.id);
const plain = value => JSON.parse(JSON.stringify(value));
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function anchor(overrides) { return fixtures.anchor(Object.assign({allowedProtocols:['rounds']},overrides)); }
function rx(overrides) { return fixtures.prescription(Object.assign({duration:20,equipment:kit,movementPriorities:[],requiredAnchors:[anchor()]},overrides)); }
function options(prescription, seed=1, overrides={}) { return Object.assign({catalogue,sessionPrescription:prescription,random:random(seed)},overrides); }
const generate = (prescription, seed=1, overrides={}) => Generator.generate(options(prescription,seed,overrides));
const mainIds = workout => workout.main.blocks.flatMap(block=>block.exercises.map(exercise=>exercise.id));

test('optional Main pool bounds filler and swaps, while exact anchors and preparation remain independent',()=>{
  const pool=['dead-bug','mountain-climbers','side-plank','dumbbell-wood-chop'];
  const prescription=rx({optionalMainExerciseIds:pool});
  for(const seed of [1,29,95]) {
    const workout=generate(prescription,seed);
    assert.ok(workout.prescriptionOutcome.satisfiedHardRequirementIds.includes('req-1'));
    assert.ok(workout.main.blocks.flatMap(b=>b.exercises).every(e=>e.coachAnchor||pool.includes(e.id)));
    assert.ok(workout.warmup.exercises.some(e=>!pool.includes(e.id)));
    const bi=workout.main.blocks.findIndex(b=>b.exercises.some(e=>!e.coachAnchor));
    if(bi>=0) {
      const ei=workout.main.blocks[bi].exercises.findIndex(e=>!e.coachAnchor);
      Generator.swap(workout,bi,ei,{catalogue,equipment:kit,random:random(seed)});
      assert.ok(workout.main.blocks.flatMap(b=>b.exercises).every(e=>e.coachAnchor||pool.includes(e.id)));
    }
  }
  const reservedOnly=generate(rx({optionalMainExerciseIds:[]}));
  assert.ok(reservedOnly.main.blocks.every(b=>b.exercises.every(e=>e.coachAnchor)));
  assertInfeasible(rx({requiredAnchors:[],optionalMainExerciseIds:[]}),'no-eligible-main');
  assertInfeasible(rx({requiredAnchors:[],optionalMainExerciseIds:['nonexistent']}),'no-eligible-main');
  assertInfeasible(rx({requiredAnchors:[],equipment:[],optionalMainExerciseIds:['dumbbell-wood-chop']}),'no-eligible-main');
  assertInfeasible(rx({requiredAnchors:[],optionalMainExerciseIds:['mountain-climbers'],avoidConstraints:[
    {requirementId:'no-climbers',importance:'hard',exerciseId:'mountain-climbers'}]}),'no-eligible-main');
  const paired=rx({requiredAnchors:[anchor({allowedProtocols:['paired_sets']})],optionalMainExerciseIds:['dead-bug']});
  const pairedWork=generate(paired);
  assert.ok(mainIds(pairedWork).every(id=>['goblet-squat','dead-bug'].includes(id)));
  assertInfeasible({...paired,optionalMainExerciseIds:[]},'protocol-partner-unavailable');
});
function assertInfeasible(prescription, code, overrides={}) {
  let draws=0;
  const opts=options(prescription,1,Object.assign({random:()=>{draws++;return .5;}},overrides));
  const assessment=Generator.assessSessionPrescription(opts);
  assert.equal(assessment.status,'infeasible');
  assert.ok(assessment.hardConflicts.some(conflict=>conflict.code===code),JSON.stringify(assessment));
  assert.throws(()=>Generator.generate(opts),error=>error instanceof Generator.SessionPrescriptionError&&error.code==='session-prescription-infeasible'&&error.assessment.hardConflicts.some(conflict=>conflict.code===code));
  assert.equal(draws,0,'hard failure cannot enter generic selection/fallback');
  return assessment;
}

test('assessment is pure, structured and independent of random/history',()=>{
  const prescription=Model.deepFreeze(rx()),before=plain(prescription);
  const assessment=Generator.assessSessionPrescription(options(prescription,1,{random:()=>{throw new Error('assessment used random');}}));
  assert.equal(assessment.status,'feasible');
  assert.deepEqual(assessment.hardConflicts,[]);
  assert.deepEqual(assessment.softConflicts,[]);
  assert.equal(assessment.prescriptionId,prescription.prescriptionId);
  assert.ok(assessment.requiredMainSeconds>0&&assessment.requiredMainSeconds<=assessment.availableMainSeconds);
  assert.deepEqual(prescription,before);
  assert.deepEqual(assessment,Generator.assessSessionPrescription(options(prescription,100,{history:[['goblet-squat']]})));
});

test('omitted/null prescription and an empty prescription preserve standalone output and random consumption',()=>{
  const run=prescription=>{
    let draws=0;const seeded=random(901);
    const workout=Generator.generate({catalogue,duration:20,focus:'balanced',equipment:kit,sessionPrescription:prescription,random:()=>{draws++;return seeded();}});
    delete workout.id;delete workout.prescriptionOutcome;
    return {workout,draws};
  };
  assert.deepEqual(run(null),run(undefined));
  assert.deepEqual(run(rx({requiredAnchors:[],workoutStyle:'balanced'})),run(undefined));
  assert.deepEqual(run(rx({requiredAnchors:[],workoutStyle:'balanced',optionalMainExerciseIds:null})),run(undefined));
});

test('required anchors survive many seeds, recent penalties, supporting roles and recipe rotation',()=>{
  const prescription=rx({requiredAnchors:[anchor(),anchor({requirementId:'curl',exerciseId:'dumbbell-biceps-curl',targetSets:3,target:{type:'reps',minReps:8,maxReps:12}})]});
  for(let seed=1;seed<=80;seed++){
    const workout=generate(prescription,seed,{focus:'cardio',bodyFocus:'lower',history:Array(4).fill(['goblet-squat','dumbbell-biceps-curl'])});
    assert.ok(mainIds(workout).includes('goblet-squat'));
    assert.ok(mainIds(workout).includes('dumbbell-biceps-curl'));
    assert.deepEqual(workout.prescriptionOutcome.satisfiedHardRequirementIds,['req-1','curl']);
    assert.ok(workout.main.estimatedDurationSeconds<=Generator.BUDGETS[20].main);
    const placements=workout.prescriptionOutcome.requiredAnchorPlacements;
    assert.equal(placements.length,2);
    for(const placement of placements){
      assert.equal(placement.expectedExposureCount,3);
      assert.equal(workout.main.blocks[placement.blockIndex].exercises[placement.exerciseIndex].id,placement.exerciseId);
    }
  }
});

test('preferred anchors are strongly favoured but can miss normal shortlist selection',()=>{
  const preferred=anchor({importance:'preferred',requirementId:'preferred',exerciseId:'dumbbell-biceps-curl'});
  let preferredHits=0,baselineHits=0;
  for(let seed=1;seed<=100;seed++){
    const variedSeed=(seed*2654435761)>>>0;
    const workout=generate(rx({requiredAnchors:[],preferredAnchors:[preferred]}),variedSeed);
    if(workout.prescriptionOutcome.preferredSatisfied.includes('preferred'))preferredHits++;
    else{
      assert.ok(workout.prescriptionOutcome.preferredMissed.includes('preferred'));
      assert.ok(workout.prescriptionOutcome.softRelaxations.some(item=>item.requirementIds.includes('preferred')));
    }
    baselineHits+=Number(mainIds(Generator.generate({catalogue,duration:20,focus:'strength',equipment:kit,random:random(variedSeed)})).includes(preferred.exerciseId));
  }
  assert.ok(preferredHits>baselineHits+20,preferredHits+' versus '+baselineHits);
  assert.ok(preferredHits<100,'preferred work must remain optional');
});

test('anchor rep ranges, dose, load and progression instruction are copied without catalogue/input mutation',()=>{
  const before=plain(catalogue['goblet-squat']),prescription=Model.deepFreeze(rx({requiredAnchors:[anchor({targetSets:4,target:{type:'reps',minReps:3,maxReps:5},suggestedLoad:24,loadUnit:'kg',loadInterpretation:'total',progressionIntent:'keep load; add a rep'})]}));
  const workout=generate(prescription),exercise=workout.main.blocks[0].exercises[0];
  assert.deepEqual(exercise.prescription,{type:'reps',value:5});
  assert.equal(workout.main.blocks[0].prescription.rounds,4);
  assert.deepEqual(exercise.coachAnchor.plannedTarget.target,{type:'reps',minReps:3,maxReps:5});
  assert.equal(exercise.coachAnchor.plannedTarget.suggestedLoad,24);
  assert.equal(exercise.coachAnchor.plannedTarget.progressionIntent,'keep load; add a rep');
  assert.equal(exercise.coachAnchor.actualReps,undefined);
  assert.equal(exercise.coachAnchor.actualLoad,undefined);
  exercise.coachAnchor.plannedTarget.target.minReps=99;
  assert.deepEqual(catalogue['goblet-squat'],before);
  assert.equal(prescription.requiredAnchors[0].target.minReps,3);
  assert.equal(workout.sessionPrescription.requiredAnchors[0].target.minReps,3);
  assert.equal(workout.sessionPrescription.programmeContext,undefined);
});

test('rep anchors remain comparable; timed anchors retain explicit timed targets and cycles',()=>{
  for(let seed=1;seed<=30;seed++){
    const workout=generate(rx({workoutStyle:'cardio',requiredAnchors:[anchor({allowedProtocols:['rounds','paired_sets']})]}),seed);
    assert.ok(['rounds','paired_sets'].includes(workout.prescriptionOutcome.requiredAnchorPlacements[0].protocol));
  }
  const prescription=rx({requiredAnchors:[anchor({exerciseId:'mountain-climbers',targetSets:null,targetExposures:4,target:{type:'timed',seconds:37},allowedProtocols:['timed_intervals']})]});
  const workout=generate(prescription),block=workout.main.blocks[0];
  assert.equal(block.protocol,'timed_intervals');assert.equal(block.prescription.cycles,4);assert.equal(block.prescription.workSeconds,37);
  assert.equal(workout.prescriptionOutcome.requiredAnchorPlacements[0].expectedExposureCount,4);
  assert.equal(Generator.resolveBlockSteps(block).filter(step=>step.kind==='exercise').length,4);
});

test('a hard rep mode forbids timed playback even when the catalogue and whitelist permit it',()=>{
  const source=Object.assign({},catalogue['goblet-squat'],{mainProtocols:['rounds','paired_sets','timed_intervals']});
  const constrained={'goblet-squat':source};
  assertInfeasible(rx({requiredAnchors:[anchor({prescriptionMode:'reps',allowedProtocols:['timed_intervals']})]}),'protocol-incompatible',{catalogue:constrained});
  const explicitlyTimed=generate(rx({requiredAnchors:[anchor({allowedProtocols:['timed_intervals']})]}),1,{catalogue:constrained});
  assert.equal(explicitlyTimed.prescriptionOutcome.requiredAnchorPlacements[0].protocol,'timed_intervals');
});

test('per-side dose maps to distinct playback occurrences and tracker planned targets, with unknown actuals',async()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  const prescription=rx({requiredAnchors:[anchor({exerciseId:'dumbbell-reverse-lunge',targetSets:3,targetExposures:6,loadInterpretation:'per-item'})]});
  app.rxJson=JSON.stringify(prescription);
  const planned=plain(vm.runInContext(`
    const prescribed=GarageFitGenerator.generate({catalogue:GarageFitData.exercises,sessionPrescription:JSON.parse(rxJson),random:()=>.5});
    GarageFitSessionTracker.plannedWorkFromTimeline(buildGeneratedTimeline(prescribed));
  `,app));
  const linked=planned.filter(entry=>entry.requirementId==='req-1');
  assert.equal(linked.length,6);assert.equal(new Set(linked.map(entry=>entry.occurrenceId)).size,6);
  assert.deepEqual(linked[0].prescription.plannedTarget.target,{type:'reps',minReps:6,maxReps:10});
  assert.equal(linked[0].prescription.plannedTarget.suggestedLoad,16);
  const map=new Map(),store=GarageFitCoachStore.createStore({getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
  const tracker=GarageFitSessionTracker.createTracker({store,source:'coach',programmeInstanceId:'prog-1',prescriptionId:'rx-1',workoutId:'w-1',draftId:'d-1',plannedWork:planned});
  await tracker.start();await tracker.recordDone(linked[0].occurrenceId);
  assert.ok(tracker.outcome(linked[0].occurrenceId).sets==null);
  assertInfeasible(rx({requiredAnchors:[anchor({exerciseId:'dumbbell-reverse-lunge',targetExposures:5})]}),'target-exposure-mismatch');
});

test('two compatible paired-only required anchors share a playable exact-dose block',()=>{
  const prescription=rx({requiredAnchors:[anchor({allowedProtocols:['paired_sets']}),anchor({requirementId:'row',exerciseId:'dumbbell-bent-over-row',allowedProtocols:['paired_sets']})]});
  const workout=generate(prescription),block=workout.main.blocks[0];
  assert.equal(block.protocol,'paired_sets');assert.equal(block.exercises.length,2);
  assert.equal(block.prescription.sets,3);assert.equal(Generator.validateMain(workout.main,catalogue,kit).length,0);
  assert.deepEqual(workout.prescriptionOutcome.requiredAnchorPlacements.map(item=>item.expectedExposureCount),[3,3]);
});

test('paired-only required dose may span multiple placements without losing or inventing exposures',()=>{
  const ids=['goblet-squat','dumbbell-bent-over-row','push-up'];
  const constrained=Object.fromEntries(ids.map(id=>[id,catalogue[id]]));
  const prescription=rx({requiredAnchors:ids.map((id,index)=>anchor({requirementId:'anchor-'+index,exerciseId:id,targetSets:2,allowedProtocols:['paired_sets']}))});
  assert.equal(Generator.assessSessionPrescription(options(prescription,1,{catalogue:constrained})).status,'feasible');
  const workout=generate(prescription,1,{catalogue:constrained});
  for(const required of prescription.requiredAnchors){
    const linked=workout.prescriptionOutcome.requiredAnchorPlacements.filter(item=>item.requirementId===required.requirementId);
    assert.equal(linked.reduce((sum,item)=>sum+item.expectedSetCount,0),2);
  }
  assert.deepEqual(workout.prescriptionOutcome.satisfiedHardRequirementIds,['anchor-0','anchor-1','anchor-2']);
  assert.equal(Generator.validateMain(workout.main,constrained,kit).length,0);
});

test('hard equipment, catalogue, phase, difficulty, mode, avoid and protocol conflicts report IDs',()=>{
  assertInfeasible(rx(),'equipment-mismatch',{equipment:[]});
  assertInfeasible(rx({requiredAnchors:[anchor({exerciseId:'missing-anchor'})]}),'missing-exercise');
  assertInfeasible(rx({requiredAnchors:[anchor({exerciseId:'childs-pose',target:null})]}),'main-ineligible');
  const hard=Object.values(catalogue).find(exercise=>exercise.generator&&exercise.main&&exercise.difficulty==='hard'&&exercise.prescription.type==='reps');
  assertInfeasible(rx({difficulty:'easy',requiredAnchors:[anchor({exerciseId:hard.id})]}),'difficulty-ineligible');
  assertInfeasible(rx({requiredAnchors:[anchor({prescriptionMode:'time'})]}),'prescription-mode-mismatch');
  assertInfeasible(rx({requiredAnchors:[anchor({target:{type:'timed',seconds:30}})]}),'prescription-mode-mismatch');
  const assessment=assertInfeasible(rx({avoidConstraints:[{requirementId:'avoid-squat',importance:'hard',pattern:'squat'}]}),'hard-avoid-conflict');
  assert.ok(assessment.hardConflicts.some(item=>item.requirementIds.includes('avoid-squat')&&item.exerciseIds.includes('goblet-squat')));
  assertInfeasible(rx({requiredAnchors:[anchor({exerciseId:'barbell-deadlift',allowedProtocols:['timed_intervals']})]}),'protocol-incompatible');
  assertInfeasible(rx({protocolConstraints:[{requirementId:'timed-only',importance:'hard',anchorRequirementId:'req-1',allowedProtocols:['timed_intervals']}]}),'protocol-incompatible');
});

test('required work and its rest must fit Main time; failure does not fall through',()=>{
  const prescription=rx({duration:10,requiredAnchors:[anchor({targetSets:20})]});
  const assessment=assertInfeasible(prescription,'insufficient-main-time');
  const conflict=assessment.hardConflicts.find(item=>item.code==='insufficient-main-time');
  assert.ok(conflict.requiredSeconds>conflict.availableSeconds);
  assertInfeasible(rx({requiredAnchors:[anchor({target:{type:'reps',minReps:200,maxReps:300}})]}),'insufficient-main-time');
});

test('explicit prescription timing ceilings reserve Main time and survive optional swaps without changing hard targets',()=>{
  const prescription=rx({duration:15,mainTimeLimitSeconds:570,maximumDurationSeconds:900,
    requiredAnchors:[anchor({targetSets:2})]});
  const assessment=Generator.assessSessionPrescription(options(prescription));
  assert.equal(assessment.availableMainSeconds,570);
  assert.equal(assessment.status,'feasible');
  for(let seed=1;seed<=24;seed++){
    const workout=generate(prescription,seed);
    assert.ok(workout.main.estimatedDurationSeconds<=570);
    assert.ok(workout.estimatedSeconds<=900);
    const original=plain(workout.prescriptionOutcome.requiredAnchorPlacements);
    workout.main.blocks.forEach((block,blockIndex)=>block.exercises.forEach((exercise,exerciseIndex)=>{
      if(exercise.coachAnchor&&exercise.coachAnchor.importance==='required')return;
      Generator.swap(workout,blockIndex,exerciseIndex,{catalogue,equipment:kit,random:random(seed)});
      assert.ok(workout.main.estimatedDurationSeconds<=570);
      assert.ok(workout.estimatedSeconds<=900);
      assert.deepEqual(workout.prescriptionOutcome.requiredAnchorPlacements,original);
    }));
  }
  assertInfeasible({...prescription,mainTimeLimitSeconds:1},'insufficient-main-time');
  assertInfeasible({...prescription,maximumDurationSeconds:1},'insufficient-main-time');
  assert.equal(Model.validate('session-prescription',{...prescription,mainTimeLimitSeconds:0}).valid,false);
});

test('a soft missing/equipment conflict yields partial feasibility and explicit preferred relaxation',()=>{
  const prescription=rx({preferredAnchors:[anchor({importance:'preferred',requirementId:'want-pullup',exerciseId:'pull-up',target:null})]});
  const opts={equipment:['dumbbells']};
  assert.equal(Generator.assessSessionPrescription(options(prescription,1,opts)).status,'partially-feasible');
  const workout=generate(prescription,1,opts);
  assert.equal(workout.prescriptionOutcome.status,'partially-feasible');
  assert.deepEqual(workout.prescriptionOutcome.preferredMissed,['want-pullup']);
  assert.ok(workout.prescriptionOutcome.softRelaxations.some(item=>item.requirementIds.includes('want-pullup')));
  assert.ok(workout.prescriptionOutcome.satisfiedHardRequirementIds.includes('req-1'));
});

test('soft avoid and protocol intent relax explicitly when required work takes precedence',()=>{
  const prescription=rx({avoidConstraints:[{requirementId:'avoid',exerciseId:'goblet-squat',importance:'soft'}],protocolConstraints:[{requirementId:'want-pairs',anchorRequirementId:'req-1',importance:'soft',allowedProtocols:['paired_sets']}]});
  const assessment=Generator.assessSessionPrescription(options(prescription));
  assert.equal(assessment.status,'partially-feasible');
  const workout=generate(prescription);
  assert.equal(workout.prescriptionOutcome.status,'partially-feasible');
  assert.ok(workout.prescriptionOutcome.softRelaxations.some(item=>item.code==='soft-avoid-selected'));
  assert.ok(workout.prescriptionOutcome.softRelaxations.some(item=>item.code==='soft-protocol-relaxed'));
});

test('bounded movement and region intent favours matching work and records unavailable priorities',()=>{
  const prescription=rx({requiredAnchors:[],movementPriorities:[{requirementId:'push',pattern:'push',priority:'primary'}],bodyRegionPriorities:[{requirementId:'upper',bodyRegion:'upper',priority:'high'}]});
  let biased=0,ordinary=0;
  for(let seed=1;seed<=40;seed++){
    biased+=generate(prescription,seed).main.blocks.flatMap(block=>block.exercises).filter(exercise=>exercise.patterns.includes('push')&&exercise.bodyFocus==='upper').length;
    ordinary+=Generator.generate({catalogue,duration:20,focus:'strength',equipment:kit,random:random(seed)}).main.blocks.flatMap(block=>block.exercises).filter(exercise=>exercise.patterns.includes('push')&&exercise.bodyFocus==='upper').length;
  }
  assert.ok(biased>ordinary,biased+' versus '+ordinary);
  const constrained={'goblet-squat':catalogue['goblet-squat']};
  const missing=rx({movementPriorities:[{requirementId:'pull',pattern:'pull',priority:'primary'}]});
  assert.equal(Generator.assessSessionPrescription(options(missing,1,{catalogue:constrained})).status,'partially-feasible');
  assert.ok(generate(missing,1,{catalogue:constrained}).prescriptionOutcome.softRelaxations.some(item=>item.requirementIds.includes('pull')));
});

test('hard avoids apply across preparation/Main/cooldown and global protocol restrictions remain hard',()=>{
  const prescription=rx({avoidConstraints:[{requirementId:'avoid',pattern:'push',importance:'hard'}],protocolConstraints:[{requirementId:'rounds',importance:'hard',allowedProtocols:['rounds']}]});
  const workout=generate(prescription);
  const exercises=workout.main.blocks.flatMap(block=>block.exercises).concat(workout.warmup.exercises,workout.rampup.exercises,workout.cooldown.exercises);
  assert.ok(exercises.every(exercise=>!exercise.patterns.includes('push')));
  assert.ok(workout.main.blocks.every(block=>block.protocol==='rounds'));
  assert.ok(workout.prescriptionOutcome.satisfiedHardRequirementIds.includes('avoid'));
  assert.ok(workout.prescriptionOutcome.satisfiedHardRequirementIds.includes('rounds'));
});

test('feasibility rejects a global paired protocol without a playable partner',()=>{
  const prescription=rx({requiredAnchors:[],protocolConstraints:[{requirementId:'pairs',importance:'hard',allowedProtocols:['paired_sets']}]});
  assertInfeasible(prescription,'no-eligible-main',{catalogue:{'goblet-squat':catalogue['goblet-squat']}});
  assertInfeasible(rx({duration:1}),'invalid-generation-context');
});

test('a soft paired-only preference can relax to rounds when no partner exists',()=>{
  const constrained={'goblet-squat':catalogue['goblet-squat']};
  const prescription=rx({requiredAnchors:[],protocolConstraints:[{requirementId:'pairs',importance:'soft',allowedProtocols:['paired_sets']}]});
  assert.equal(Generator.assessSessionPrescription(options(prescription,1,{catalogue:constrained})).status,'partially-feasible');
  const workout=generate(prescription,1,{catalogue:constrained});
  assert.equal(workout.prescriptionOutcome.status,'partially-feasible');
  assert.ok(workout.prescriptionOutcome.softRelaxations.some(item=>item.requirementIds.includes('pairs')));
});

test('soft anchor targets can miss while their ordinary catalogue exercise remains available',()=>{
  const constrained={'goblet-squat':catalogue['goblet-squat']};
  const prescription=rx({requiredAnchors:[],preferredAnchors:[anchor({importance:'preferred',targetSets:100})]});
  assert.equal(Generator.assessSessionPrescription(options(prescription,1,{catalogue:constrained})).status,'partially-feasible');
  const workout=generate(prescription,1,{catalogue:constrained});
  assert.ok(mainIds(workout).includes('goblet-squat'));
  assert.deepEqual(workout.prescriptionOutcome.preferredSatisfied,[]);
  assert.deepEqual(workout.prescriptionOutcome.preferredMissed,['req-1']);
});

test('variation intent remains soft and records conflict with required recent work',()=>{
  const prescription=rx({variationPreference:'varied'}),history=[['goblet-squat']];
  assert.equal(Generator.assessSessionPrescription(options(prescription,1,{history})).status,'partially-feasible');
  const workout=generate(prescription,1,{history});
  assert.deepEqual(workout.prescriptionOutcome.variationPreference,{requested:'varied',status:'relaxed'});
  assert.ok(workout.prescriptionOutcome.softRelaxations.some(item=>item.code==='variation-preference-relaxed'));
  Generator.swap(workout,1,0,{catalogue,equipment:kit,random:random(10)});
  assert.equal(workout.prescriptionOutcome.variationPreference.status,'relaxed');
});

test('Coach constrained fallback keeps reserved work even when family/variety rules reject optional candidates',()=>{
  const constrained={};
  for(const id of ['goblet-squat','air-squat','push-up'])constrained[id]=Object.assign({},catalogue[id],{family:'reserved-family',frequency:'occasional'});
  for(let seed=1;seed<=20;seed++){
    const workout=generate(rx(),seed,{catalogue:constrained});
    assert.deepEqual(mainIds(workout),['goblet-squat']);
    assert.equal(workout.prescriptionOutcome.requiredAnchorPlacements[0].expectedExposureCount,3);
    assert.ok(workout.prescriptionOutcome.warnings.some(item=>item.code==='main-underfilled'));
  }
});

test('generic required-anchor swaps refuse before mutation/RNG; standalone swaps still work',()=>{
  const workout=generate(rx()),before=plain(workout),placement=workout.prescriptionOutcome.requiredAnchorPlacements[0];
  assert.throws(()=>Generator.swap(workout,placement.blockIndex,placement.exerciseIndex,{catalogue,equipment:kit,random:()=>{throw new Error('swap used random');}}),error=>error.code==='required-anchor-swap'&&error.requirementId==='req-1');
  assert.deepEqual(plain(workout),before);
  assert.throws(()=>Generator.swap(workout,0,{catalogue,equipment:kit}),error=>error.code==='required-anchor-swap');
  const standalone=Generator.generate({catalogue,duration:20,focus:'balanced',equipment:kit,random:random(3)}),old=standalone.main.blocks[0].exercises[0].id;
  Generator.swap(standalone,0,0,{catalogue,equipment:kit,random:random(77)});
  assert.notEqual(standalone.main.blocks[0].exercises[0].id,old);
});

test('optional Coach swaps preserve avoids/reservations and refresh reconciliation',()=>{
  const prescription=rx({avoidConstraints:[{requirementId:'avoid',exerciseId:'air-squat',importance:'hard'}]});
  const workout=generate(prescription),required=plain(workout.prescriptionOutcome.requiredAnchorPlacements);
  assert.ok(workout.main.blocks.length>1);
  Generator.swap(workout,1,0,{catalogue,equipment:kit,random:random(8)});
  assert.deepEqual(workout.prescriptionOutcome.requiredAnchorPlacements,required);
  assert.ok(!mainIds(workout).includes('air-squat'));
});

test('prescribed generation is deterministic and hard invalid contracts expose structured errors',()=>{
  const prescription=rx({preferredAnchors:[anchor({requirementId:'curl',exerciseId:'dumbbell-biceps-curl',importance:'preferred'})]});
  const first=generate(prescription,31),second=generate(prescription,31);delete first.id;delete second.id;
  assert.deepEqual(first,second);
  assertInfeasible(rx({schemaVersion:9}),'invalid-prescription');
  assertInfeasible(rx({movementPriorities:[{pattern:'push',weight:100000}]}),'invalid-prescription');
});
