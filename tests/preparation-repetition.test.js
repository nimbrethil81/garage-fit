const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
const zero = () => 0;

function syntheticRampExercise(id, options) {
  options = options || {};
  return Object.assign({
    id, name:id,
    equipment:[],
    patterns:[],
    conditioning:true,
    movementPlanes:['sagittal'],
    warmupAreas:[],
    bodyPosition:'standing',
    strength:2, cardio:3,
    prescription:{type:'timed',value:30},
    estimatedSeconds:30,
    impact:'low',
    load:null,
    generator:false,
    warmup:false,
    rampup:true,
    rampupPrescription:{type:'timed',value:30,minValue:20,maxValue:45},
    rampupEstimatedSeconds:30,
    prepIntensity:3, prepFatigue:2, prepComplexity:1,
    main:false, cooldown:false,
    sidedness:'bilateral', unilateral:false,
    repetitionClass:null
  }, options);
}

// ---- Exact-duplicate suppression (integration, via real catalogue) ----

test('an exercise already used in Warm-up is not normally repeated in Ramp-up', () => {
  const warmup = [catalogue['jumping-jacks']];
  const rampup = GarageFitGenerator.selectRampup(catalogue, 55, [], [], warmup, 'cardio', zero);
  assert.ok(rampup.exercises.length > 0);
  assert.ok(!rampup.exercises.some(ex => ex.id === 'jumping-jacks'), rampup.exercises.map(ex=>ex.id).join(', '));
});

test('Jumping Jacks specifically cannot appear in both Warm-up and Ramp-up in a normally generated workout', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const workout = GarageFitGenerator.generate({
      catalogue, duration:20, focus:'cardio', equipment:[], random:random(seed)
    });
    const inWarmup = workout.warmup.exercises.some(ex => ex.id === 'jumping-jacks');
    const inRampup = workout.rampup.exercises.some(ex => ex.id === 'jumping-jacks');
    assert.ok(!(inWarmup && inRampup), 'seed '+seed);
  }
});

// ---- Constrained-catalogue fallback ----

test('an exact duplicate remains available as a last resort when the catalogue is genuinely constrained', () => {
  const warmup = [catalogue['jumping-jacks']];
  const constrained = { 'jumping-jacks': catalogue['jumping-jacks'] };
  const rampup = GarageFitGenerator.selectRampup(constrained, 55, [], [], warmup, 'cardio', zero);
  assert.equal(rampup.exercises.length, 1);
  assert.equal(rampup.exercises[0].id, 'jumping-jacks');
});

// ---- Same repetition-class: discouraged, not banned ----

test('an exercise sharing a repetition class with a Warm-up exercise scores lower than an otherwise-identical exercise from a different class', () => {
  const warmupItem = syntheticRampExercise('warm-basic', { repetitionClass:'basic-conditioning' });
  const sameClass = syntheticRampExercise('ramp-same-class', { repetitionClass:'basic-conditioning' });
  const differentClass = syntheticRampExercise('ramp-different-class', { repetitionClass:'other-class' });
  const noClass = syntheticRampExercise('ramp-no-class');
  const sameScore = GarageFitGenerator.scoreRampupCandidate(sameClass, 0.5, [], [warmupItem], [], [], 'balanced');
  const differentScore = GarageFitGenerator.scoreRampupCandidate(differentClass, 0.5, [], [warmupItem], [], [], 'balanced');
  const noClassScore = GarageFitGenerator.scoreRampupCandidate(noClass, 0.5, [], [warmupItem], [], [], 'balanced');
  assert.ok(sameScore < differentScore, `same=${sameScore}, different=${differentScore}`);
  assert.ok(sameScore < noClassScore, `same=${sameScore}, noClass=${noClassScore}`);
});

test('a same-repetition-class exercise remains eligible (discouraged, not forbidden) when it is the only alternative to an exact duplicate', () => {
  const warmupItem = syntheticRampExercise('warm-basic', { repetitionClass:'basic-conditioning' });
  const sameClassOnly = { 'warm-basic':warmupItem, 'ramp-same-class':syntheticRampExercise('ramp-same-class', { repetitionClass:'basic-conditioning' }) };
  const rampup = GarageFitGenerator.selectRampup(sameClassOnly, 55, [], [], [warmupItem], 'balanced', zero);
  assert.equal(rampup.exercises.length, 1);
  assert.equal(rampup.exercises[0].id, 'ramp-same-class');
});

test('an exercise from a different suitable repetition class is preferred over a same-class exercise when both are available', () => {
  const warmupItem = syntheticRampExercise('warm-basic', { repetitionClass:'basic-conditioning' });
  const pool = {
    'warm-basic':warmupItem,
    'ramp-same-class':syntheticRampExercise('ramp-same-class', { repetitionClass:'basic-conditioning' }),
    'ramp-different-class':syntheticRampExercise('ramp-different-class', { repetitionClass:'other-class' })
  };
  const rampup = GarageFitGenerator.selectRampup(pool, 55, [], [], [warmupItem], 'balanced', zero);
  assert.ok(rampup.exercises.some(ex => ex.id === 'ramp-different-class'));
  assert.ok(!rampup.exercises.some(ex => ex.id === 'ramp-same-class'));
});

// ---- Existing behaviour is preserved ----

test('Ramp-up generation still succeeds normally when nothing in Warm-up overlaps', () => {
  const workout = GarageFitGenerator.generate({ catalogue, duration:30, focus:'balanced', equipment:['dumbbells','kettlebell'], random:random(4) });
  assert.ok(workout.rampup.exercises.length > 0);
});

test('FINAL-REC1 repairs excessive Ramp-up intensity drops without changing doses or determinism',()=>{
  const G=GarageFitGenerator,audit=require('../scripts/audit-exercise-reachability');
  for(const [equipment,difficulty,seed] of [[['bench','box'],'normal',388386366],[[],'easy',924399868]]){
    const options={catalogue,equipment,difficulty,duration:45,focus:'balanced',bodyFocus:'core'};
    let attempts=0,filtered=0;
    const workout=G.generate({...options,random:random(seed),trace:event=>{
      if(event.type==='rampup-attempt')attempts++;
      if(event.type==='pick'&&event.phase==='rampup'&&event.stages.some(stage=>stage.label==='intensity-progression')){
        assert.ok(attempts>=8,'valid original search is preserved before recovery');filtered++;
      }
    }});
    assert.ok(attempts>8&&attempts<=16,'bounded recovery is exercised');
    assert.ok(filtered>0,'progression is enforced before scoring');
    assert.equal(workout.rampup.exercises.length,4);
    assert.deepEqual(G.validatePreparation(workout.warmup,workout.rampup,workout.main.blocks.flatMap(b=>b.exercises)),[]);
    audit.validateAuditWorkout(workout,options,G);
    assert.deepEqual(G.validateMain(workout.main,catalogue,equipment,G.BUDGETS[45].main),[]);
    const again=G.generate({...options,random:random(seed)});
    for(const section of ['main','warmup','rampup','cooldown'])assert.deepEqual(again[section],workout[section]);
  }
});

test('a constrained valid ordering is recovered even when every greedy prefix is stranded',()=>{
  const high=syntheticRampExercise('higher',{prepIntensity:4}),low=syntheticRampExercise('lower',{prepIntensity:2,conditioning:false});
  const pool={higher:high,lower:low};let draws=0;
  const rampup=GarageFitGenerator.selectRampup(pool,80,[],[],[],'balanced',()=>{draws++;return 0;});
  assert.equal(rampup.exercises.length,2);
  assert.deepEqual(rampup.exercises.map(e=>e.prepIntensity),[2,4]);
  assert.deepEqual(GarageFitGenerator.validatePreparation({exercises:[]},rampup,[]),[]);
  assert.ok(draws<=32,'at most sixteen two-pick attempts; order search consumes no random draws');
});

test('an impossible safe Ramp-up remains explicitly invalid under the unchanged validator',()=>{
  const pool={a:syntheticRampExercise('a',{impact:'high',prepIntensity:4}),b:syntheticRampExercise('b',{impact:'high',prepIntensity:5})};
  const rampup=GarageFitGenerator.selectRampup(pool,80,[],[],[],'balanced',zero);
  assert.equal(rampup.exercises.length,2,'retain the existing constrained-pool return contract');
  assert.ok(GarageFitGenerator.validatePreparation({exercises:[]},rampup,[]).some(issue=>issue.startsWith('impact:')));
});
