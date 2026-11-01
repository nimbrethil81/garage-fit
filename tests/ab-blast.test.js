const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../data/exercises.js');
require('../data/workouts.js');
require('../js/ab-blast.js');
const composer = GarageFitAbBlast;
const catalogue = GarageFitData.exercises;
const legacy = GarageFitData.fixedWorkouts.abBlast;
function seeded(seed) { return () => ((seed = (Math.imul(seed,1664525)+1013904223) >>> 0)/4294967296); }

test('Ab Blast seeds give independent valid, balanced, continuous and varied plans', () => {
  const compositions = new Set(), reached = new Set(), counts = new Set();
  for (let seed=1;seed<=60;seed++) {
    const plan = composer.generate({random:seeded(seed)});
    assert.deepEqual(plan,composer.generate({random:seeded(seed)}));
    assert.deepEqual(composer.validate(plan),{valid:true,errors:[]});
    compositions.add(JSON.stringify(plan.exercises));
    counts.add(plan.exercises.length);
    plan.exercises.forEach(s => { reached.add(s.id); assert.ok(catalogue[s.id].instruction); });
  }
  assert.ok(compositions.size>40);
  assert.deepEqual([...counts].sort(),[7,8,9]);
  for (const id of ['sit-up','flutter-kicks','side-plank','hollow-body-hold','leg-raises','seated-knee-tucks','bear-plank-hold','plank-up-downs']) assert.ok(reached.has(id),id);
});

test('the unchanged legacy composition validates and is generated through ordinary choices', () => {
  assert.deepEqual(composer.validate(legacy),{valid:true,errors:[]});
  // Target order 8,7,9; catalogue pool order is the legacy followed by alternatives.
  // Ranking all ordinary choices makes the exact historical ordering and timing
  // reachable without any original-plan bypass or special generation branch.
  const draws = [0.4,0,0.8,...Array.from({length:12},(_,i)=>i/12)];
  for(let i=0;i<7;i++) draws.push(...(i===1 ? [0,0.3,0.5,0.7] : [0.5,0.3,0,0.7]));
  const plan=composer.generate({random:()=>draws.shift() ?? 0.5});
  assert.deepEqual(plan.exercises,legacy.exercises);
});

test('validator rejects time, overlap, missing catalogue, sides and protocol violations', () => {
  function reject(edit) { const plan=JSON.parse(JSON.stringify(legacy));edit(plan);assert.equal(composer.validate(plan).valid,false); }
  reject(p=>p.exercises[0].durationSeconds=35);
  reject(p=>p.exercises[0].durationSeconds=50);
  reject(p=>p.exercises[0].id='unknown');
  reject(p=>p.exercises[0].id='reverse-crunch');
  reject(p=>p.exercises[1].side='right');
  reject(p=>p.exercises[2].durationSeconds=35);
  reject(p=>p.exercises[1].transitionAfter=5);
  reject(p=>p.transitionSeconds=5);
  reject(p=>p.rounds=2);
  assert.equal(composer.validate(null).valid,false);
  assert.equal(composer.validate(legacy,{catalogue:{}}).valid,false);
});

test('infeasible catalogues fail clearly without duration padding', () => {
  assert.throws(()=>composer.generate({catalogue:{},random:()=>0}),/unavailable/);
  const subset=Object.fromEntries(['sit-up','reverse-crunch','dead-bug','bicycle-crunch','flutter-kicks','leg-raises'].map(id=>[id,catalogue[id]]));
  assert.throws(()=>composer.generate({catalogue:subset,random:()=>0}),/unavailable/);
});
