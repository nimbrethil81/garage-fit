const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function create(seed) {
  return GarageFitGenerator.generate({
    catalogue,
    duration:30,
    focus:'balanced',
    equipment:['dumbbells','kettlebell','trx','pullup-bar'],
    random:random(seed)
  });
}

test('balanced warm-ups always include meaningful lower-joint preparation',()=>{
  const lower=new Set(['hips','knees','ankles']);
  for(let seed=1;seed<=100;seed++){
    const warmup=create(seed).warmup.exercises;
    assert.ok(warmup.some(ex=>(ex.warmupAreas||[]).filter(area=>lower.has(area)).length>=2),warmup.map(ex=>ex.id).join(', '));
  }
});

test('30-minute balanced repeated blocks avoid duplicate lunge-family exercises when alternatives exist',()=>{
  for(let seed=1;seed<=100;seed++){
    const block=create(seed).blocks[0];
    const lunges=block.exercises.filter(ex=>(ex.patterns||[]).includes('lunge'));
    assert.ok(lunges.length<=1,`${block.rounds} rounds: ${block.exercises.map(ex=>ex.id).join(', ')}`);
  }
});

test('walking lunge is a single alternating exercise rather than separate left/right work',()=>{
  const exercise=catalogue['walking-lunge'];
  assert.equal(exercise.sidedness,'alternating');
  assert.equal(exercise.unilateral,false);
  assert.equal(exercise.prescription.type,'reps');
  assert.match(exercise.instructions,/alternate left and right/i);
});

test('catalogue models sidedness as a distinct, valid concept for every exercise',()=>{
  const valid=new Set(['bilateral','alternating','per-side','none']);
  for(const exercise of Object.values(catalogue)) assert.ok(valid.has(exercise.sidedness),`${exercise.id}: ${exercise.sidedness}`);
  assert.deepEqual(GarageFitGenerator.validateCatalogue(catalogue),[]);
});

test('per-side exercises are backed by a unilateral prescription, alternating exercises are not',()=>{
  assert.equal(catalogue['reverse-lunge'].sidedness,'per-side');
  assert.equal(catalogue['reverse-lunge'].prescription.type,'unilateral-reps');
  assert.equal(catalogue['trx-glute-standing'].sidedness,'per-side');
  assert.equal(catalogue['trx-glute-standing'].prescription.type,'unilateral-timed');
  for(const id of ['walking-lunge','mountain-climbers','high-knees','bicycle-crunch','floor-wipers','skater-jumps','trx-mountain-climber','kettlebell-figure-eight']){
    assert.equal(catalogue[id].sidedness,'alternating',id);
    assert.equal(catalogue[id].prescription.type.includes('unilateral'),false,id);
  }
});

test('glute stretch and TRX glute standing belong to the same stretch family and never co-occur in cooldown',()=>{
  assert.ok(catalogue['glute-stretch'].alternativeGroup);
  assert.equal(catalogue['glute-stretch'].alternativeGroup,catalogue['trx-glute-standing'].alternativeGroup);
  let sawBoth=false;
  for(let seed=1;seed<=150;seed++){
    const ids=create(seed).cooldown.exercises.map(ex=>ex.id);
    if(ids.includes('glute-stretch')&&ids.includes('trx-glute-standing')) sawBoth=true;
  }
  assert.equal(sawBoth,false);
});

test('cooldown never selects two exercises from the same stretch family, for any family',()=>{
  for(let seed=1;seed<=150;seed++){
    const cooldown=create(seed).cooldown.exercises;
    const groups=cooldown.map(ex=>ex.alternativeGroup).filter(Boolean);
    assert.equal(new Set(groups).size,groups.length,cooldown.map(ex=>ex.id).join(', '));
  }
});

test('abdominal crunch and dumbbell thruster are timed so the player auto-advances without a manual Done press',()=>{
  for(const id of ['abdominal-crunch','dumbbell-thruster']){
    const exercise=catalogue[id];
    assert.equal(exercise.prescription.type,'timed',id);
    assert.equal(exercise.prescription.value,exercise.estimatedSeconds,id);
  }
});