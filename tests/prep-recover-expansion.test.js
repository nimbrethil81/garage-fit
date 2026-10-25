const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
const G=GarageFitGenerator,C=GarageFitData.exercises;
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const ADDED=["seated-knee-extensions","wall-ankle-dorsiflexion-rocks","ankle-alphabet","standing-lateral-weight-shifts","standing-scapular-protraction-retraction","wall-push-up-plus","wrist-circles","standing-forearm-rotations","standing-thoracic-rotation-with-reach","standing-cross-body-reaches","alternating-overhead-reach-side-shift","seated-spinal-rotation-stretch","supine-knees-to-chest-stretch"];
const REUSED=["supine-heel-slides","quadruped-wrist-rocks","quadruped-thoracic-rotation","controlled-shoulder-rotations","side-lying-open-books","seated-thoracic-extension","four-square-steps","standing-hinge-and-reach","wall-push-up","ring-scapular-row","standing-lat-stretch","butterfly-stretch","low-cobra-pose","extended-puppy-pose"];
// Full live catalogue: explicit suitable examples prove selection without distribution quotas.
const FIXTURES=[
  ["warmup","supine-heel-slides",10,"strength",1,"normal",[]],
  ["warmup","quadruped-thoracic-rotation",10,"strength",1,"normal",[]],
  ["warmup","standing-thoracic-rotation-with-reach",10,"strength",2,"hard",[]],
  ["warmup","seated-knee-extensions",10,"strength",4,"normal",[]],
  ["warmup","side-lying-open-books",10,"strength",5,"hard",[]],
  ["cooldown","extended-puppy-pose",10,"strength",5,"hard",[]],
  ["cooldown","low-cobra-pose",10,"strength",5,"hard",[]],
  ["warmup","seated-thoracic-extension",10,"strength",8,"hard",[]],
  ["cooldown","supine-knees-to-chest-stretch",10,"strength",8,"hard",[]],
  ["warmup","standing-forearm-rotations",10,"strength",10,"normal",[]],
  ["warmup","controlled-shoulder-rotations",10,"balanced",2,"hard",[]],
  ["warmup","ankle-alphabet",10,"balanced",4,"normal",[]],
  ["warmup","quadruped-wrist-rocks",10,"balanced",5,"hard",[]],
  ["warmup","wrist-circles",10,"balanced",7,"normal",[]],
  ["cooldown","butterfly-stretch",10,"balanced",7,"normal",[]],
  ["cooldown","standing-lat-stretch",10,"balanced",9,"easy",[]],
  ["cooldown","seated-spinal-rotation-stretch",10,"balanced",10,"normal",[]],
  ["warmup","alternating-overhead-reach-side-shift",10,"cardio",10,"normal",[]],
  ["rampup","wall-push-up",30,"strength",2,"hard",[]],
  ["warmup","standing-lateral-weight-shifts",30,"strength",3,"easy",[]],
  ["warmup","wall-ankle-dorsiflexion-rocks",30,"strength",6,"easy",[]],
  ["warmup","wall-push-up-plus",30,"strength",7,"normal",[]],
  ["warmup","standing-cross-body-reaches",30,"balanced",9,"easy",[]],
  ["warmup","four-square-steps",30,"cardio",6,"easy",[]],
  ["rampup","wall-push-up-plus",45,"strength",5,"hard",[]],
  ["warmup","standing-scapular-protraction-retraction",45,"strength",6,"easy",[]],
  ["warmup","standing-hinge-and-reach",45,"strength",10,"normal",[]],
  ["rampup","ring-scapular-row",10,"strength",3,"easy",["rings"]],
  ["rampup","four-square-steps",45,"strength",3190374152,"normal",["bands","rings"]],
  ["rampup","alternating-overhead-reach-side-shift",45,"strength",15,"easy",[]],
  ["rampup","standing-scapular-protraction-retraction",45,"balanced",28,"easy",[]]
];

test('Prep & Recover P1 additions and phase reuse really reach every flagged generated preparation phase',()=>{
  const seen=new Set();
  for(const [phase,id,duration,focus,seed,difficulty,equipment] of FIXTURES){
    const w=G.generate({catalogue:C,equipment,duration,focus,difficulty,random:random(seed)});
    const selected=w[phase].exercises.find(ex=>ex.id===id);
    assert.ok(selected,phase+' '+id);seen.add(phase+':'+id);
    assert.equal(selected.prescription.type,C[id].sidedness==='per-side'?'unilateral-timed':'timed',id);
    assert.ok(!w.warmup.exercises.concat(w.rampup.exercises).some(ex=>ex.id==='star-jumps'));
    assert.deepEqual(G.validatePreparation(w.warmup,w.rampup,w.main.blocks.flatMap(b=>b.exercises)),[]);
  }
  for(const id of ADDED.concat(REUSED))for(const phase of ['warmup','rampup','cooldown'])
    if(C[id][phase])assert.ok(seen.has(phase+':'+id),phase+' '+id+' lacks real selection proof');
});

test('Prep & Recover P1 expands genuine knee mobility and preserves unrelated Main and recovery roles',()=>{
  for(const id of ADDED){assert.equal(C[id].main,false,id);assert.equal(C[id].generator,false,id);assert.equal(C[id].impact,'low',id);}
  for(const id of ['standing-knee-curls','seated-knee-extensions','supine-heel-slides'])assert.ok(G.kneeMobilityQualified(C[id]),id);
  assert.equal(C['supine-heel-slides'].generator,true);assert.deepEqual(C['supine-heel-slides'].patterns,['core']);
  assert.equal(C['star-jumps'].rampup,false);assert.ok(C['star-jumps']);
  assert.equal(C['easy-recovery-walk'].cooldown,false);assert.deepEqual(C['easy-recovery-walk'].stretchTargets,[]);
  assert.equal(C['split-step-preparation'].warmup,false);
  assert.deepEqual(G.validateCatalogue(C),[]);
});

test('six families keep their shared or specialist preparation routes without promoting P1 additions into Main',()=>{
  const {loadAppContext}=require('./helpers/app-context');
  const app=loadAppContext(new Map(),{ownIntrinsics:true}),g=app.GarageFitGenerator,c=app.GarageFitData.exercises;
  for(const family of ['strength-control','cardio-conditioning','core-stability','full-body-challenges','athletic-movement','mobility-movement-quality']){
    const w=g.generate({catalogue:c,workoutFamilyId:family,duration:20,equipment:['dumbbells'],movementRoom:true,difficulty:'normal',random:random(31)});
    assert.equal(g.validateFamilyWorkout(w,{catalogue:c,equipment:['dumbbells']}).valid,true,family);
    assert.ok(w.main.blocks.every(b=>b.exercises.every(ex=>!ADDED.includes(ex.id))),family);
    if(['athletic-movement','mobility-movement-quality'].includes(family)){
      assert.ok(['warmup','rampup','cooldown'].every(p=>!w[p].exercises.length),family+' owns its whole progression');
      const sections=g.trainingSectionPlan(w);assert.ok(sections.seconds.warmup>0&&sections.seconds.cooldown>0);assert.equal(sections.seconds.rampup,0);
    }else{
      assert.ok(w.warmup.exercises.some(g.kneeMobilityQualified),family);
      assert.ok(!w.warmup.exercises.concat(w.rampup.exercises).some(ex=>ex.id==='star-jumps'),family);
    }
  }
});

test('the four production Coach programmes retain their existing shared or family-based preparation path',async()=>{
  const {pilot}=require('./helpers/coach-pilot');
  for(const [id,version] of [['general-strength-4w',2],['build-arms',1],['tennis-conditioning',8],['general-fitness',2]]){
    const p=pilot(new Map(),id,version);
    await p.run("pilot.start(pilotDef,pilotOptions.equipment)");
    p.run('Math.random=(()=>{let s=17;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};})()');
    const preview=p.run('pilot.prepare(pilotOptions)'),w=preview.workout,g=p.app.GarageFitGenerator;
    assert.ok(w,id+' feasible prescription');
    assert.ok(w.main.blocks.every(b=>b.exercises.every(ex=>!ADDED.includes(ex.id))),id);
    if(['athletic-movement','mobility-movement-quality'].includes(w.workoutFamilyId))assert.ok(['warmup','rampup','cooldown'].every(phase=>!w[phase].exercises.length),id);
    else{assert.ok(w.warmup.exercises.some(g.kneeMobilityQualified),id);assert.ok(!w.warmup.exercises.concat(w.rampup.exercises).some(ex=>ex.id==='star-jumps'),id);}
  }
});

test('an ordinary Generator ramp-up can swap to an easy ring preparation exercise without a Coach prescription',()=>{
  const w=G.generate({catalogue:C,equipment:[],duration:10,focus:'strength',difficulty:'easy',random:random(1)});
  assert.ok(!w.sessionPrescription);
  assert.ok(!w.setupEquipment);
  const candidate=C['ring-scapular-row'];
  assert.equal(candidate.difficulty,'easy');
  assert.doesNotThrow(()=>G.swapPreparation(w,'rampup',0,{catalogue:{[candidate.id]:candidate},equipment:['rings'],random:random(1)}));
  assert.equal(w.rampup.exercises[0].id,candidate.id);
  assert.ok(w.rampup.exercises[0].prepFatigue<=3);
});
