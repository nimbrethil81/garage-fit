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
  const draws = [0.8,0.4,0,0.8,...Array.from({length:18},(_,i)=>i/18)];
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

test('expanded pool is reachable, specialist-only and varied with about 20% lower-intensity plans', () => {
  const added = ['bodyweight-russian-twist','heel-touches','supine-arm-pulses','v-ups','superman'];
  const low = ['bird-dog','superman'];
  const reached = new Set(), compositions = new Set(), appearances = {};
  let lowerPlans = 0;
  // 1,000 independent deterministic seeds, 16–24% tolerance: about three
  // binomial standard errors around 20%, without asserting an exact quota.
  for (let seed=1;seed<=1000;seed++) {
    const plan = composer.generate({random:seeded(Math.imul(seed,2654435761) >>> 0)});
    assert.equal(composer.validate(plan).valid,true);
    const ids = [...new Set(plan.exercises.map(s=>s.id))];
    const count = ids.filter(id=>low.includes(id)).length;
    assert.ok(count<=1);
    lowerPlans += count;
    compositions.add([...ids].sort().join(','));
    for (const id of ids) { reached.add(id); appearances[id]=(appearances[id]||0)+1; }
  }
  assert.ok(lowerPlans>=160 && lowerPlans<=240, String(lowerPlans));
  assert.equal(reached.size,18);
  assert.ok(compositions.size>500);
  assert.ok(Math.max(...Object.values(appearances))<800);
  for (const id of [...added,'bird-dog','hollow-body-hold']) assert.ok(reached.has(id),id);
  for (const id of added) {
    const ex = catalogue[id];
    for (const phase of ['generator','main','warmup','rampup','cooldown']) assert.equal(ex[phase],false,id+': '+phase);
    assert.deepEqual(ex.equipment,[]);
    assert.equal(ex.bodyPosition,'floor');
    assert.equal(ex.bodyFocus,'core');
    assert.ok(ex.instruction.length<=180);
  }
});

test('validator caps specialist lower intensity without restricting easy legacy movements', () => {
  const one = JSON.parse(JSON.stringify(legacy));
  one.exercises[0].id='bird-dog';
  assert.equal(composer.validate(one).valid,true);
  const two = JSON.parse(JSON.stringify(one));
  two.exercises[6].id='superman';
  assert.ok(composer.validate(two).errors.includes('Too many lower-intensity movements'));
  assert.equal(composer.validate(legacy).valid,true);
});

test('lower-intensity draw falls back safely when the catalogue has none', () => {
  const subset=Object.fromEntries(Object.entries(catalogue).filter(([id])=>!['bird-dog','superman'].includes(id)));
  const plan=composer.generate({catalogue:subset,random:()=>0.1});
  assert.equal(composer.validate(plan,{catalogue:subset}).valid,true);
});
