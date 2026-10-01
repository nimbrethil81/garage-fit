const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue=GarageFitData.exercises;
const IDS=['trx-y-fly','trx-good-morning','trx-pistol-squat','trx-single-leg-deadlift','trx-power-pull'];
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}

test('the TRX batch is five distinct, TRX-only, Main-only generator exercises with spoken instructions',()=>{
  for(const id of IDS){
    const ex=catalogue[id];
    assert.ok(ex,id);
    assert.match(ex.name,/^TRX /);
    assert.deepEqual(ex.equipment,[['trx']]);
    assert.ok(ex.generator&&ex.main);
    assert.ok(!ex.warmup&&!ex.rampup&&!ex.cooldown);
    assert.ok(ex.instruction&&ex.instruction.length<=180,id);
    assert.equal(ex.voiceInstruction,true);
    assert.equal(ex.family,null);
    assert.ok(!ex.mainProtocols.includes('timed_intervals'),id);
  }
  assert.equal(new Set(IDS.map(id=>catalogue[id].name)).size,5);
  assert.equal(catalogue['trx-pistol-squat'].name,'TRX pistol squat');
});

test('per-side TRX exercises prescribe and budget both sides; bilateral ones do not',()=>{
  for(const id of ['trx-pistol-squat','trx-single-leg-deadlift','trx-power-pull']){
    assert.equal(catalogue[id].sidedness,'per-side',id);
    assert.equal(catalogue[id].prescription.type,'unilateral-reps',id);
  }
  for(const id of ['trx-y-fly','trx-good-morning']){
    assert.equal(catalogue[id].sidedness,'bilateral',id);
    assert.equal(catalogue[id].prescription.type,'reps',id);
  }
  assert.deepEqual(catalogue['trx-single-leg-deadlift'].patterns.slice().sort(),['hinge','lunge']);
  assert.ok(catalogue['trx-pistol-squat'].patterns.includes('lunge'));
});

test('the new TRX exercises are reachable in generated TRX-only Main workouts',()=>{
  const seen=new Set();
  for(const focus of ['strength','balanced'])for(const duration of [20,30,45])for(let seed=1;seed<=60;seed++){
    const workout=GarageFitGenerator.generate({catalogue,duration,focus,equipment:['trx'],random:random(seed*7+duration)});
    for(const block of workout.main.blocks)for(const ex of block.exercises)if(IDS.includes(ex.id))seen.add(ex.id);
  }
  assert.ok(seen.size>=3,[...seen].join(','));
});
