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
  assert.equal(exercise.unilateral,false);
  assert.equal(exercise.prescription.type,'reps');
  assert.match(exercise.instructions,/alternate left and right/i);
});