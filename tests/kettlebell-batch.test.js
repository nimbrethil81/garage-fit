const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue=GarageFitData.exercises;
const NEW=['kettlebell-floor-press','kettlebell-single-leg-deadlift','kettlebell-halo','kettlebell-russian-twist','kettlebell-single-arm-swing'];
const MAIN=NEW.filter(id=>id!=='kettlebell-halo');
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}

test('the kettlebell batch is five distinct single-kettlebell entries with spoken instructions',()=>{
  for(const id of NEW){
    const ex=catalogue[id];
    assert.ok(ex,id);
    assert.deepEqual(ex.equipment,[['kettlebell']]);
    assert.ok(ex.instruction&&ex.instruction.length<=180,id);
    assert.equal(ex.voiceInstruction,true);
  }
  assert.equal(new Set(NEW.map(id=>catalogue[id].name)).size,5);
  assert.equal(catalogue['kettlebell-single-leg-deadlift'].family,null);
  assert.match(catalogue['kettlebell-single-leg-deadlift'].instruction,/one hand.*opposite leg/);
});

test('floor press shares the floor-press family; swings share a family but are not cleans',()=>{
  assert.equal(catalogue['kettlebell-floor-press'].family,catalogue['dumbbell-floor-press'].family);
  assert.equal(catalogue['kettlebell-single-arm-swing'].family,catalogue['kettlebell-swing'].family);
  assert.notEqual(catalogue['kettlebell-single-arm-swing'].family,catalogue['kettlebell-clean'].family);
  assert.equal(catalogue['kettlebell-single-arm-swing'].sidedness,'per-side');
  assert.equal(catalogue['kettlebell-swing'].sidedness,'bilateral');
});

test('per-side entries prescribe both sides; Russian twist is one continuous alternating interval',()=>{
  for(const id of ['kettlebell-floor-press','kettlebell-single-leg-deadlift','kettlebell-single-arm-swing']){
    assert.equal(catalogue[id].sidedness,'per-side',id);
    assert.equal(catalogue[id].prescription.type,'unilateral-reps',id);
    assert.ok(!catalogue[id].mainProtocols.includes('timed_intervals'),id);
  }
  const twist=catalogue['kettlebell-russian-twist'];
  assert.equal(twist.sidedness,'alternating');
  assert.deepEqual(twist.prescription,{type:'timed',value:30});
});

test('the halo is preparation-only, with a midpoint direction cue in both phases',()=>{
  const halo=catalogue['kettlebell-halo'];
  assert.ok(halo.warmup&&halo.rampup);
  assert.ok(!halo.main&&!halo.generator);
  assert.deepEqual(halo.patterns,[]);
  assert.equal(halo.warmupPrescription.value,20);
  assert.equal(halo.rampupPrescription.value,30);
  for(const seconds of [halo.warmupPrescription.value,halo.rampupPrescription.value]){
    const tracker=GarageFitTimedCues.createTracker(halo.timedCues,seconds);
    assert.deepEqual(GarageFitTimedCues.takeDueCues(tracker,seconds/2-1),[]);
    assert.equal(GarageFitTimedCues.takeDueCues(tracker,seconds/2)[0].text,'Change direction');
  }
});

test('Main eligibility: the four Main entries are generator/Main kettlebell exercises; the halo never appears in Main',()=>{
  for(const id of MAIN){
    const ex=catalogue[id];
    assert.ok(ex.generator&&ex.main,id);
    assert.ok(!ex.warmup&&!ex.rampup&&!ex.cooldown,id);
  }
  // Frequency of the rarer entries depends on generator scoring (reported on the PR), so only
  // the ones that are reliably selected are asserted as reachable.
  const seen=new Set();
  for(const focus of ['strength','balanced','cardio'])for(const duration of [20,30])for(let seed=1;seed<=25;seed++){
    const kb=GarageFitGenerator.generate({catalogue,duration,focus,equipment:['kettlebell'],random:random(seed*11+duration)});
    for(const block of kb.main.blocks)for(const ex of block.exercises){
      assert.notEqual(ex.id,'kettlebell-halo');
      if(MAIN.includes(ex.id))seen.add(ex.id);
    }
    const none=GarageFitGenerator.generate({catalogue,duration,focus,equipment:[],random:random(seed)});
    for(const section of [none.warmup,none.rampup,none.main.blocks[0]])for(const ex of section.exercises)assert.ok(!NEW.includes(ex.id));
  }
  assert.ok(seen.has('kettlebell-floor-press')&&seen.has('kettlebell-single-arm-swing'),[...seen].join(','));
});

test('fitting the halo into a Warm-up or Ramp-up budget keeps its timed prescription and direction cue',()=>{
  const halo=catalogue['kettlebell-halo'];
  for(const [kind,seconds] of [['warmup',20],['rampup',30]]){
    const prescription=kind==='warmup'?halo.warmupPrescription:halo.rampupPrescription;
    const prepared=Object.assign({},halo,{prescription:Object.assign({},prescription),estimatedSeconds:seconds});
    const fitted=GarageFitGenerator.fitTimedDurations([prepared],seconds,5,kind).exercises[0];
    assert.equal(fitted.prescription.type,'timed');
    assert.equal(fitted.prescription.value,seconds);
    assert.deepEqual(fitted.timedCues,[{text:'Change direction',at:{type:'fraction',value:0.5}}]);
  }
});
