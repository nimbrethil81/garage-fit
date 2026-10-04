const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const G=GarageFitGenerator;
const catalogue=GarageFitData.exercises;
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const MAJOR=new Set(['squat','hinge','push','pull','lunge','carry']);

// Enumerates rolls evenly across [0,1), so pick counts are proportional to pick weights.
function pickCounts(scored,margin,rolls=4000){
  const counts={};
  for(let i=0;i<rolls;i++){
    const value=(i+.5)/rolls;
    const picked=G.controlledPick(scored,()=>value,margin);
    counts[picked.id]=(counts[picked.id]||0)+1;
  }
  return counts;
}
const item=(id,score)=>({exercise:{id},score});

test('candidates tied at the shortlist cutoff are all shortlisted with equal weight, whatever their catalogue order',()=>{
  const scored=[item('a',10),item('b',9),item('c',8),item('d',7),item('e',7),item('f',7)];
  const forward=pickCounts(scored,0);
  const reversed=pickCounts(scored.slice().reverse(),0);
  for(const counts of [forward,reversed]){
    assert.ok(counts.d>0&&counts.e>0&&counts.f>0,JSON.stringify(counts));
    assert.ok(Math.abs(counts.d-counts.f)<=1&&Math.abs(counts.e-counts.f)<=1,JSON.stringify(counts));
    assert.ok(counts.a>counts.b&&counts.b>counts.c&&counts.c>counts.d,JSON.stringify(counts));
  }
  // Ties higher up share a rank too.
  const top=pickCounts([item('x',10),item('y',10),item('z',5),item('w',4)],0);
  assert.ok(Math.abs(top.x-top.y)<=1,JSON.stringify(top));
});

test('a margin admits near-misses below the cutoff at a lower, score-ordered weight and nothing beyond it',()=>{
  const scored=[item('a',10),item('b',9),item('c',8),item('d',7),item('near',5.5),item('far',2),item('none',1)];
  const strict=pickCounts(scored,0);
  assert.equal(strict.near,undefined);
  const banded=pickCounts(scored,G.SHORTLIST_MARGIN);
  assert.ok(banded.near>0&&banded.near<banded.d,JSON.stringify(banded));
  assert.equal(banded.far,undefined);
  assert.equal(banded.none,undefined);
  assert.ok(banded.a>banded.near*5,JSON.stringify(banded));
  assert.equal(G.controlledPick([],Math.random,G.SHORTLIST_MARGIN),null);
});

// Bounded, deterministic reachability sample: 320 kettlebell and 160 TRX workouts across
// Strength/Balanced at 30 and 45 minutes, where Main has room for primary and supporting work.
// Kettlebell is larger because the supporting route (SUPPORTING_ROUTE) shares long Mains'
// accessory slots with lower-ranked primary work such as the single-leg deadlift.
function sample(equipment,seeds=40){
  const workouts=[];
  for(const focus of ['strength','balanced'])for(const duration of [30,45])for(let seed=1;seed<=seeds;seed++)
    workouts.push(G.generate({catalogue,duration,focus,equipment,random:random(seed*1009+duration*31+focus.length)}));
  return workouts;
}
const mainIds=workout=>workout.main.blocks.flatMap(block=>block.exercises.map(exercise=>exercise.id));
const count=(workouts,id,phase='main')=>workouts.filter(workout=>(phase==='main'?mainIds(workout):workout[phase].exercises.map(ex=>ex.id)).includes(id)).length;
const kettlebell=sample(['kettlebell'],80);
const trx=sample(['trx']);

test('primary and supporting Main exercises in dense same-pattern pools are reachable, and supporting work stays secondary',()=>{
  const singleLeg=count(kettlebell,'kettlebell-single-leg-deadlift');
  const twist=count(kettlebell,'kettlebell-russian-twist');
  const yFly=count(trx,'trx-y-fly');
  assert.ok(singleLeg>=3,'kettlebell single-leg deadlift '+singleLeg);
  assert.ok(twist>=1,'kettlebell Russian twist '+twist);
  assert.ok(yFly>=1,'TRX Y fly '+yFly);
  // Control: supporting entries remain well below their primary peers and are never repeated
  // across a workout's Main blocks.
  assert.ok(twist*4<count(kettlebell,'kettlebell-deadlift'),'twist vs deadlift');
  assert.ok(yFly*4<count(trx,'trx-row'),'Y fly vs row');
  for(const workout of kettlebell.concat(trx))for(const id of ['kettlebell-russian-twist','trx-y-fly'])
    assert.ok(mainIds(workout).filter(item=>item===id).length<=1,mainIds(workout).join(','));
});

test('the kettlebell halo is reachable in Warm-up, never in Ramp-up, and no Warm-up repeats a major pattern',()=>{
  assert.ok(count(kettlebell,'kettlebell-halo','warmup')>=2,'halo in warm-up');
  assert.equal(count(kettlebell,'kettlebell-halo','rampup'),0);
  for(const workout of kettlebell.concat(trx)){
    const warmup=workout.warmup.exercises;
    for(let i=0;i<warmup.length;i++)for(let j=i+1;j<warmup.length;j++)
      assert.ok(!G.sharedPatterns(warmup[i],warmup[j]).some(pattern=>MAJOR.has(pattern)),warmup.map(ex=>ex.id).join(' > '));
  }
});

test('Ramp-up avoids consecutive high-impact work whenever a lower-impact alternative exists',()=>{
  for(const focus of ['balanced','cardio'])for(const duration of [30,45])for(let seed=1;seed<=20;seed++){
    const ramp=G.generate({catalogue,duration,focus,equipment:[],random:random(seed*104729+duration)}).rampup.exercises;
    for(let i=1;i<ramp.length;i++)assert.ok(!(ramp[i].impact==='high'&&ramp[i-1].impact==='high'),ramp.map(ex=>ex.id).join(' > '));
  }
});
