const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }

function syntheticExercise(id, pattern) {
  return {
    id,
    name:id,
    equipment:[],
    patterns:[pattern],
    movementPlanes:['sagittal'],
    warmupAreas:[],
    bodyPosition:'standing',
    strength:4,
    cardio:1,
    prescription:{type:'reps',value:10},
    estimatedSeconds:30,
    impact:'low',
    load:null,
    generator:true,
    main:true,
    warmup:false,
    rampup:false,
    cooldown:false,
    sidedness:'bilateral',
    unilateral:false
  };
}

function generatedIds(sourceCatalogue, seed, history) {
  return GarageFitGenerator.generate({
    catalogue:sourceCatalogue,
    duration:10,
    focus:'strength',
    equipment:[],
    history,
    random:random(seed)
  }).blocks[0].exercises.map(exercise=>exercise.id);
}

test('recent exact exercises and their major movement family receive soft recency penalties',()=>{
  const exact = GarageFitGenerator.recentUsePenalty(catalogue['dumbbell-farmer-carry'],[['dumbbell-farmer-carry']],catalogue);
  const family = GarageFitGenerator.recentUsePenalty(catalogue['kettlebell-farmer-carry'],[['dumbbell-farmer-carry']],catalogue);
  const unrelated = GarageFitGenerator.recentUsePenalty(catalogue['pull-up'],[['dumbbell-farmer-carry']],catalogue);
  assert.ok(exact>family,`exact=${exact}, family=${family}`);
  assert.ok(family>0,`family=${family}`);
  assert.equal(unrelated,0);
});

test('repeated generation selects a recently used exercise less often when alternatives exist',()=>{
  const sourceCatalogue = {
    'recent-squat':syntheticExercise('recent-squat','squat'),
    'fresh-squat':syntheticExercise('fresh-squat','squat'),
    hinge:syntheticExercise('hinge','hinge'),
    push:syntheticExercise('push','push'),
    pull:syntheticExercise('pull','pull')
  };
  let baseline=0, suppressed=0;
  for(let seed=1;seed<=200;seed++) {
    if(generatedIds(sourceCatalogue,seed,[]).includes('recent-squat')) baseline++;
    if(generatedIds(sourceCatalogue,seed,[['recent-squat']]).includes('recent-squat')) suppressed++;
  }
  assert.ok(suppressed<baseline,`baseline=${baseline}, suppressed=${suppressed}`);
});

test('recency suppression never makes a recent exercise ineligible',()=>{
  const sourceCatalogue = {
    squat:syntheticExercise('squat','squat'),
    hinge:syntheticExercise('hinge','hinge'),
    push:syntheticExercise('push','push')
  };
  const ids=generatedIds(sourceCatalogue,17,[['squat','hinge','push']]);
  assert.deepEqual(new Set(ids),new Set(['squat','hinge','push']));
});

test('glute stretch is modelled as a left/right cooldown exercise',()=>{
  const exercise=catalogue['glute-stretch'];
  assert.equal(exercise.sidedness,'per-side');
  assert.equal(exercise.unilateral,true);
  assert.equal(exercise.prescription.type,'unilateral-timed');
  assert.equal(exercise.prescription.value,15);
  assert.equal(exercise.estimatedSeconds,30);
});