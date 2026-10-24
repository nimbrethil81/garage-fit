// Rings R6 release gate (#116): deterministic equipment x option matrix.
const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/coach-model.js');
require('../js/generator.js');
const G=GarageFitGenerator,C=GarageFitData.exercises;
const random=initial=>{let seed=initial;return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};};
const RING_IDS=Object.values(C).filter(ex=>ex.equipment.flat().includes('rings')).map(ex=>ex.id);
const CONFIGS={
  bodyweight:[],rings:['rings'],bar:['pullup-bar'],trx:['trx'],
  'rings+bar':['rings','pullup-bar'],'rings+trx':['rings','trx'],
  all:GarageFitData.equipment.map(e=>e.id)
};
const mainOf=w=>w.main.blocks.flatMap(b=>b.exercises);

test('[Full] equipment configurations only select ring entries when rings are owned, with valid budgets',()=>{
  assert.equal(RING_IDS.length,15); // S1 adds the reviewed scapular row.
  const ringsSeen={};
  let n=0;
  for(const [name,equipment] of Object.entries(CONFIGS))
    for(const duration of [10,15,20,30,45])
      for(const focus of ['strength','balanced','cardio'])
        for(const difficulty of ['easy','normal','hard'])
          for(const bodyFocus of ['upper','full-body','lower','core']){
            const seed=1000+(n++);
            const w=G.generate({catalogue:C,equipment,duration,focus,difficulty,bodyFocus,random:random(seed)});
            const label=[name,duration,focus,difficulty,bodyFocus].join('/');
            // Every Main rule holds, including the Main duration tolerance (#212).
            assert.deepEqual(G.validateMain(w.main,C,equipment,G.BUDGETS[duration].main),[],label);
            assert.ok(w.estimatedSeconds<=duration*60+Math.max(180,duration*60*.18),label+' '+w.estimatedSeconds);
            assert.deepEqual(G.normaliseWorkout(JSON.parse(JSON.stringify(w))),w,label);
            for(const b of w.main.blocks)assert.ok(G.blockSetupCompatible(b,C,equipment),label);
            for(const ex of mainOf(w)){
              if(RING_IDS.includes(ex.id)){
                assert.ok(equipment.includes('rings'),label+' ring entry without rings: '+ex.id);
                ringsSeen[name]=(ringsSeen[name]||0)+1;
                if(difficulty==='easy')assert.notEqual(C[ex.id].difficulty,'hard',label+' hard ring movement in Easy: '+ex.id);
              }
            }
          }
  for(const name of ['bodyweight','bar','trx'])assert.equal(ringsSeen[name]||0,0,name);
  for(const name of ['rings','rings+bar','rings+trx','all'])assert.ok(ringsSeen[name]>0,name+' should reach ring entries');
});

// #212: with rings + pull-up bar (or kettlebell + bar), the bar offers only pull/hanging work, so
// cardio, lower or Easy sessions could miss the two-type equipment minimum on every attempt and
// fall back to a short three-exercise Main (34-61% of budget on these seeds). The fittest
// otherwise-valid attempt is used instead; the family cap, round variety and setup rules still hold.
test('kits whose equipment cannot meet the diversity minimum still fill Main within tolerance',()=>{
  const cases=[[['rings','pullup-bar'],45,'cardio','easy','full-body',1889],[['rings','pullup-bar'],30,'balanced','normal','lower',1846],
    [['rings','pullup-bar'],20,'balanced','hard','full-body',1813],[['kettlebell','pullup-bar'],45,'strength','easy','lower',2586]];
  for(const [equipment,duration,focus,difficulty,bodyFocus,seed] of cases){
    const events=[],label=[equipment.join('+'),duration,focus,difficulty,bodyFocus,seed].join('/');
    const w=G.generate({catalogue:C,equipment,duration,focus,difficulty,bodyFocus,random:random(seed),trace:event=>events.push(event)});
    const eligible=Object.values(C).filter(ex=>G.generatedPhaseEligible(ex,'main',equipment,difficulty));
    assert.notEqual(events.find(event=>event.type==='main-result').attempt,null,label+' used the short fallback');
    assert.deepEqual(G.validateMain(w.main,C,equipment,G.BUDGETS[duration].main),[],label+' '+w.main.estimatedDurationSeconds);
    assert.deepEqual(G.mainVarietyIssues(w.main.blocks,duration,eligible).filter(i=>i!=='main:equipment-diversity-below-minimum'),[],label);
    assert.ok(w.main.estimatedDurationSeconds>=G.BUDGETS[duration].main*.85,label+' '+w.main.estimatedDurationSeconds);
    assert.ok(w.estimatedSeconds<=duration*60+Math.max(180,duration*60*.18),label);
    assert.ok(new Set(mainOf(w).map(ex=>ex.id)).size>=4,label);
  }
});

test('rings do not falsely satisfy unrelated bar-specific or TRX-specific exercises',()=>{
  for(const ex of Object.values(C)){
    if(RING_IDS.includes(ex.id)||!ex.equipment.length)continue;
    const needsOther=ex.equipment.every(group=>group.some(item=>item!=='rings'));
    if(needsOther)for(const phase of ['main','warmup','cooldown'])
      assert.equal(G.generatedPhaseEligible(ex,phase,['rings']),false,ex.id+'/'+phase);
  }
});

test('ring-only Main plans keep mixed setup swaps and lookups deterministic',()=>{
  const run=seed=>G.generate({catalogue:C,equipment:['rings','trx'],duration:30,focus:'balanced',random:random(seed)});
  const strip=w=>({...w,id:null});
  for(const seed of [3,31,311])assert.deepEqual(strip(run(seed)),strip(run(seed)));
});
