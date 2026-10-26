const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;
require('../data/exercises');require('../js/desk-break');
const D=GarageFitDeskBreak,C=GarageFitData.exercises;
function seeded(seed){return ()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);}

test('Desk Break deterministic seeds preserve safety, balance, timing, floor grouping and variety',()=>{
  const snapshot=JSON.stringify(C),plans=new Set(),firsts=new Set(),lowerSlots=new Set();let floorPlans=0,standingPlans=0;
  const pool=D.eligible(C);
  assert.equal(pool.length,18,'all curated IDs remain eligible in the canonical catalogue');
  for(let seed=1;seed<=64;seed++){
    const plan=D.generate({random:seeded(seed)}),ex=plan.exercises.map(e=>C[e.id]);
    plans.add(plan.exercises.map(e=>e.id).join(','));firsts.add(ex[0].id);
    assert.equal(plan.termination.durationSeconds,180);
    assert.equal(plan.transitionSeconds*5+plan.exercises.reduce((s,e)=>s+e.durationSeconds,0),180);
    assert.equal(ex.length,6);assert.equal(new Set(ex.map(e=>e.id)).size,6);
    assert.ok(pool.find(p=>p.exercise.id===ex[0].id).gentle);assert.equal(ex[0].bodyPosition,'standing');
    assert.ok(ex.filter(e=>e.cardio>=3).length>=2);
    assert.ok(ex.some(e=>e.patterns.some(p=>['squat','lunge'].includes(p))));
    assert.ok(ex.some(e=>e.bodyFocus==='upper'||e.patterns.includes('core')||e.id==='knee-to-opposite-elbow'));
    lowerSlots.add(ex.findIndex(e=>e.patterns.some(p=>['squat','lunge'].includes(p))));
    let floors=ex.filter(e=>e.bodyPosition==='floor').length;
    assert.ok(floors<=2);if(floors){floorPlans++;assert.ok(ex.slice(-floors).every(e=>e.bodyPosition==='floor'));}else standingPlans++;
    for(let i=0;i<6;i++){
      assert.deepEqual(ex[i].equipment,[]);assert.notEqual(ex[i].impact,'high');assert.notEqual(ex[i].difficulty,'hard');assert.notEqual(ex[i].sidedness,'per-side');
      assert.equal(plan.exercises[i].reps,undefined);assert.equal(plan.exercises[i].durationSeconds,25);
      if(i){
        assert.ok(!ex[i].patterns.some(p=>ex[i-1].patterns.includes(p)));
        const armSupport=['push-up','plank','bird-dog'];
        assert.ok(!(armSupport.includes(ex[i].id)&&armSupport.includes(ex[i-1].id)),'avoid consecutive shoulder-loaded floor movements');
      }
    }
  }
  assert.ok(plans.size>40);assert.equal(firsts.size,3);assert.ok(lowerSlots.size>2);assert.ok(floorPlans&&standingPlans);
  assert.equal(JSON.stringify(C),snapshot,'timing overrides never mutate catalogue prescriptions');
});

test('Desk Break recency is a soft preference over the last three sessions only',()=>{
  const base=D.generate({random:seeded(7)});
  const recent=[base.exercises.map(e=>e.id)];
  const fresh=D.generate({random:seeded(7),recent});
  const overlap=plan=>plan.exercises.filter(e=>recent[0].includes(e.id)).length;
  assert.ok(overlap(fresh)<overlap(base));
  const all=D.eligible(C).map(p=>p.exercise.id);
  assert.equal(D.generate({recent:[all,all,all],random:seeded(4)}).exercises.length,6);
  assert.deepEqual(D.generate({recent:[all,[],[],[]],random:seeded(7)}),base);
});

test('Desk Break handles stale/malformed/unavailable storage and records only explicit starts',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  assert.deepEqual(D.readRecent(storage),[]);
  data.set('gf_desk_break_recent_v1','{"stale":true}');assert.deepEqual(D.readRecent(storage),[]);
  data.set('gf_desk_break_recent_v1','[null,[],[4],"bad"]');assert.deepEqual(D.readRecent(storage),[]);
  D.generate({random:seeded(1)});assert.equal(data.size,1);
  for(let i=0;i<5;i++)D.recordStarted(storage,D.generate({random:seeded(i)}));
  assert.equal(D.readRecent(storage).length,3);assert.equal(data.size,1);
  const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.deepEqual(D.readRecent(blocked),[]);assert.doesNotThrow(()=>D.recordStarted(blocked,D.generate()));
  assert.deepEqual(D.readRecent(undefined),[]);
});

test('Desk Break fails safely without required coverage or a gentle standing start',()=>{
  for(const exclude of [()=>true,e=>e.patterns.includes('squat')||e.patterns.includes('lunge'),e=>D.eligible(C).some(p=>p.gentle&&p.exercise.id===e.id)]){
    const catalogue=Object.fromEntries(Object.entries(C).filter(([,e])=>!exclude(e)));
    assert.throws(()=>D.generate({catalogue,random:seeded(1)}),/not enough suitable movements/);
  }
  const catalogue=JSON.parse(JSON.stringify(C));
  for(const entry of D.eligible(C))catalogue[entry.exercise.id].equipment=[['chair']];
  assert.throws(()=>D.generate({catalogue}),/not enough suitable movements/);
});
