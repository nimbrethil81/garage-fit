const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;
for(const path of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','js/strength-cardio-composer','js/core-challenge-composer'])require('../'+path);
const G=GarageFitGenerator,C=GarageFitData.exercises;
const ids=['bodyweight-russian-twist','heel-touches','supine-arm-pulses','v-ups','superman'];
const rng=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const mainIds=w=>w.main.blocks.flatMap(b=>b.exercises.map(ex=>ex.id));

test('AB2 approved shared metadata preserves roles, time protocols and exactly three short Ramp-up memberships',()=>{
  const ratings=[[2,2,'moderate','alternating','transverse','supporting',2],[2,2,'easy','alternating','frontal','supporting',1],
    [2,2,'moderate','bilateral','sagittal','supporting',null],[4,2,'hard','bilateral','sagittal','primary',null],
    [2,1,'easy','bilateral','sagittal','supporting',1]];
  for(const [i,id] of ids.entries()){
    const ex=C[id], [strength,cardio,difficulty,sidedness,plane,role,prep]=ratings[i];
    assert.deepEqual([ex.strength,ex.cardio,ex.difficulty,ex.sidedness,ex.movementPlanes[0],ex.mainRole],
      [strength,cardio,difficulty,sidedness,plane,role],id);
    assert.deepEqual(ex.equipment,[]);assert.deepEqual(ex.patterns,['core']);
    assert.equal(ex.bodyFocus,'core');assert.equal(ex.bodyPosition,'floor');assert.equal(ex.impact,'low');
    assert.equal(ex.conditioning,false);assert.equal(ex.voiceInstruction,false);
    assert.equal(ex.generator,true);assert.equal(ex.main,true);
    assert.deepEqual(ex.prescription,{type:'timed',value:30});assert.equal(ex.estimatedSeconds,30);
    assert.deepEqual(ex.prescriptionModes,['time']);assert.deepEqual(ex.mainProtocols,['rounds','paired_sets','timed_intervals']);
    assert.equal(ex.warmup,false);assert.equal(ex.cooldown,false);
    assert.equal(ex.rampup,prep!==null);
    if(prep!==null){
      assert.deepEqual(ex.rampupPrescription,{type:'timed',value:20,minValue:20,maxValue:25});
      assert.deepEqual([ex.prepIntensity,ex.prepFatigue,ex.prepComplexity],[2,2,prep]);
    }else{
      assert.equal(ex.rampupPrescription,null);assert.equal(ex.prepIntensity,null);
    }
    assert.equal(G.generatedPhaseEligible(ex,'main',[],'easy'),id!=='v-ups');
    assert.equal(ex.family,null);assert.equal(ex.repetitionClass,null);
  }
  assert.match(C['supine-arm-pulses'].instruction,/straight legs raised/);
  assert.match(C['v-ups'].instruction,/torso and straight legs together/);
});

test('AB2 shared entries reach valid general Main, non-Core Strength, complementary Cardio and Ramp-up through ordinary selection',()=>{
  // Current-catalogue player/tracker plans stay covered independently of historical UI fixtures.
  const app=require('./helpers/app-context').loadAppContext(new Map(),{ownIntrinsics:true});
  // Small end-to-end fixtures found in bounded samples (at most 200 seeds).
  // #407 ratings change draws; refreshed seeds retain every reachability assertion.
  const fixtures=[
    ['main','v-ups','strength','core','hard',30,1],
    ['main','bodyweight-russian-twist','strength','core','hard',30,9],
    ['main','supine-arm-pulses','strength','core','hard',30,12],
    ['main','superman','strength','core','hard',30,13],
    ['main','heel-touches','strength','core','hard',30,166],
    ['main','v-ups','strength','upper','hard',30,2],
    ['main','bodyweight-russian-twist','strength','upper','hard',30,5],
    ['main','heel-touches','strength','upper','hard',30,11],
    ['main','v-ups','cardio','full-body','hard',30,2],
    ['rampup','bodyweight-russian-twist','strength','core','normal',20,6],
    ['rampup','superman','strength','core','normal',20,8],
    ['rampup','heel-touches','strength','core','normal',20,10]
  ];
  for(const [phase,id,focus,bodyFocus,difficulty,duration,seed] of fixtures){
    const w=G.generate({catalogue:C,equipment:[],focus,bodyFocus,difficulty,duration,random:rng(seed)});
    assert.ok((phase==='main'?mainIds(w):w.rampup.exercises.map(ex=>ex.id)).includes(id),phase+' '+id);
    assert.deepEqual(G.validateMain(w.main,C,[]),[],id);
    if(phase==='main'){
      const work=app.GarageFitSessionTracker.plannedWorkFromTimeline(app.buildGeneratedTimeline(w));
      assert.ok(work.some(item=>item.exerciseId===id&&item.section==='main'&&item.prescription.timed),id+' player/tracker work');
    }
    assert.deepEqual(G.validatePreparation(w.warmup,w.rampup,w.main.blocks.flatMap(b=>b.exercises)),[],id);
    assert.ok(!w.warmup.exercises.concat(w.cooldown.exercises).some(ex=>ids.includes(ex.id)));
  }
});

test('AB2 compatible Coach routes keep anchors and reviewed family memberships intact',async()=>{
  const {pilot}=require('./helpers/coach-pilot');
  for(const [programme,version,seed,expected,equipment=['dumbbells','bands','bench']] of [
    ['general-strength-4w',2,1,'v-ups'],['build-arms',1,2,'v-ups'],
    ['tennis-conditioning',8,1,'v-ups'],['general-fitness',2,1,'v-ups'],
    ['general-fitness',2,5,'bodyweight-russian-twist'],
    ['general-fitness',2,25,'heel-touches'],['general-fitness',2,2,'supine-arm-pulses',[]],
    ['general-fitness',2,3,'superman',[]]
  ]){
    const p=pilot(new Map(),programme,version);
    p.run(`pilotOptions.equipment=${JSON.stringify(equipment)};pilotOptions.duration=45;pilotOptions.bodyFocus='core';`);
    await p.start();
    const anchors=p.json('pilot.snapshot().state.anchors');
    p.run(`var abSeed=${seed};Math.random=()=>{abSeed=(Math.imul(abSeed,1664525)+1013904223)>>>0;return abSeed/4294967296;};pilot.prepare(pilotOptions)`);
    const w=p.json('pilot.snapshot().preview.workout');
    assert.ok(mainIds(w).includes(expected),programme+' '+expected);
    assert.deepEqual(p.json('pilot.snapshot().state.anchors'),anchors,programme);
    for(const id of p.json('(pilot.snapshot().preview.plan.prescription.requiredAnchors||[]).map(a=>a.exerciseId)'))
      assert.ok(mainIds(w).includes(id),programme+' anchor '+id);
    for(const [family,roles] of [['athletic-movement',['footwork','control','integrated']],['mobility-movement-quality',['prep','focused','flow','finish']]])
      for(const id of ids)for(const role of roles)
        assert.equal(p.app.GarageFitWorkoutFamilies.getMembership({workoutFamilyId:family,workoutFamilyVersion:p.app.GarageFitWorkoutFamilies.currentVersion(family),role},id),null);
  }
});
