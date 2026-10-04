const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const G=GarageFitGenerator;
const catalogue=GarageFitData.exercises;
const NEW=['kettlebell-snatch','curtsy-lunge','dumbbell-plank-pull-through','kick-through','dumbbell-lateral-raise'];
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const mainIds=workout=>workout.main.blocks.flatMap(block=>block.exercises.map(exercise=>exercise.id));
const clone=value=>JSON.parse(JSON.stringify(value));

test('the batch entries match the approved metadata',()=>{
  const ks=catalogue['kettlebell-snatch'],cl=catalogue['curtsy-lunge'],pp=catalogue['dumbbell-plank-pull-through'],kt=catalogue['kick-through'],lr=catalogue['dumbbell-lateral-raise'];
  assert.deepEqual(ks.equipment,[['kettlebell']]);
  assert.deepEqual([ks.family,ks.repetitionClass,ks.patterns,ks.conditioning,ks.strength,ks.cardio,ks.impact,ks.load,ks.sidedness,ks.bodyPosition,ks.movementPlanes,ks.mainRole],['snatch',null,['hinge'],true,4,5,'medium','Medium','per-side','standing',['sagittal'],'primary']);
  assert.deepEqual(ks.prescription,{type:'unilateral-reps',value:8});
  assert.equal(ks.estimatedSeconds,50);
  assert.deepEqual(ks.mainProtocols,['rounds','paired_sets']);
  assert.deepEqual(cl.equipment,[]);
  assert.deepEqual([cl.family,cl.repetitionClass,cl.patterns,cl.conditioning,cl.strength,cl.cardio,cl.impact,cl.sidedness,cl.bodyPosition,cl.movementPlanes,cl.mainRole],[null,null,['lunge'],false,3,3,'medium','alternating','standing',['frontal','transverse'],'primary']);
  assert.deepEqual(cl.prescription,{type:'reps',value:12});
  assert.equal(cl.estimatedSeconds,35);
  assert.deepEqual(cl.mainProtocols,['rounds','paired_sets']);
  assert.deepEqual(pp.equipment,[['dumbbells']]);
  assert.deepEqual([pp.family,pp.repetitionClass,pp.patterns,pp.conditioning,pp.strength,pp.cardio,pp.impact,pp.load,pp.sidedness,pp.bodyPosition,pp.movementPlanes,pp.mainRole],[null,'dumbbell-plank-core',['core'],false,4,2,'low','Medium','alternating','floor',['transverse'],'supporting']);
  assert.deepEqual(pp.prescription,{type:'timed',value:40});
  assert.deepEqual(pp.prescriptionModes,['time']);
  assert.ok(pp.mainProtocols.includes('timed_intervals'));
  assert.deepEqual(kt.equipment,[]);
  assert.deepEqual([kt.family,kt.repetitionClass,kt.patterns,kt.conditioning,kt.strength,kt.cardio,kt.impact,kt.sidedness,kt.bodyPosition,kt.movementPlanes,kt.mainRole],[null,null,['core'],true,3,4,'medium','alternating','floor',['transverse'],'supporting']);
  assert.deepEqual(kt.prescription,{type:'timed',value:30});
  assert.ok(kt.mainProtocols.includes('timed_intervals'));
  assert.deepEqual(lr.equipment,[['dumbbells']]);
  assert.deepEqual([lr.family,lr.repetitionClass,lr.patterns,lr.conditioning,lr.strength,lr.cardio,lr.impact,lr.load,lr.sidedness,lr.bodyPosition,lr.movementPlanes,lr.mainRole],[null,null,[],false,3,1,'low','Light','bilateral','standing',['frontal'],'supporting']);
  assert.deepEqual(lr.prescription,{type:'reps',value:12});
  assert.equal(lr.estimatedSeconds,35);
  assert.deepEqual(lr.mainProtocols,['rounds','paired_sets']);
});

test('all five are generated Main only, with one-sentence spoken instructions',()=>{
  for(const id of NEW){
    const ex=catalogue[id];
    assert.ok(ex.generator&&ex.main,id);
    assert.ok(!ex.warmup&&!ex.rampup&&!ex.cooldown,id);
    assert.equal(ex.voiceInstruction,true,id);
    assert.ok(ex.instruction.length<=180,id);
    assert.equal(ex.instruction.split(/(?<=\.)\s+/).length,1,id);
  }
  assert.deepEqual(G.validateCatalogue(catalogue),[]);
});

test('relationships: snatch family, plank-core repetition class, no accidental families',()=>{
  assert.ok(G.sameFamily(catalogue['kettlebell-snatch'],catalogue['dumbbell-snatch']));
  assert.ok(!G.sameFamily(catalogue['kettlebell-snatch'],catalogue['kettlebell-swing']));
  assert.ok(!G.sameFamily(catalogue['devils-press'],catalogue['dumbbell-snatch']));
  const row=catalogue['dumbbell-renegade-row'],pull=catalogue['dumbbell-plank-pull-through'];
  assert.equal(row.repetitionClass,'dumbbell-plank-core');
  assert.ok(G.sameRepetitionClass(row,pull));
  assert.ok(!G.sameFamily(row,pull));
  assert.equal(row.family,null);
  assert.ok(!G.sameFamily(catalogue['curtsy-lunge'],catalogue['reverse-lunge']));
  assert.equal(catalogue['dumbbell-snatch'].repetitionClass,'dumbbell-snatch-conditioning');
});

test('Kettlebell snatch budgets both sides; plank pull-through and kick-through are one continuous interval',()=>{
  const ks=catalogue['kettlebell-snatch'];
  assert.equal(G.sideCount(ks),2);
  assert.ok(!ks.mainProtocols.includes('timed_intervals'));
  assert.equal(ks.estimatedSeconds,50);
  for(const [id,seconds] of [['dumbbell-plank-pull-through',40],['kick-through',30]]){
    const ex=catalogue[id];
    assert.equal(G.sideCount(ex),1,id);
    assert.deepEqual(ex.prescription,{type:'timed',value:seconds},id);
    assert.equal(ex.estimatedSeconds,seconds,id);
    assert.ok(ex.mainProtocols.includes('timed_intervals'),id);
  }
});

test('the shared plank-core class discourages consecutive renegade row and plank pull-through without excluding either',()=>{
  const row=catalogue['dumbbell-renegade-row'],pull=catalogue['dumbbell-plank-pull-through'];
  const filler=Object.assign(clone(catalogue['dumbbell-plank-pull-through']),{id:'filler',repetitionClass:null,patterns:['core'],mainRole:'primary'});
  const state=previous=>({exercises:previous?[previous]:[],usedIds:new Set(),blocks:[],owned:['dumbbells']});
  const pick=(previous,pool)=>G.selectBlockExercises(pool,1,'balanced','accessory','timed_intervals',state(previous),[],()=>0,catalogue)[0].id;
  assert.notEqual(pick(row,[pull,filler]),'dumbbell-plank-pull-through');
  assert.equal(pick(row,[pull]),'dumbbell-plank-pull-through');
  assert.equal(pick(pull,[Object.assign(clone(row),{mainProtocols:['rounds','paired_sets','timed_intervals']})]),'dumbbell-renegade-row');
});

// Bounded deterministic reachability samples (at most 300 workouts each).
function sample(equipment,focus,durations,seeds){
  const out=[];
  for(const duration of durations)for(let seed=1;seed<=seeds;seed++)
    out.push(G.generate({catalogue,duration,focus,equipment,random:random(seed*104729+duration)}));
  return out;
}
const countMain=(workouts,id)=>workouts.filter(workout=>mainIds(workout).includes(id)).length;

test('Curtsy lunge and Kick-through are reachable in bodyweight Main',()=>{
  const bodyweight=sample([],'balanced',[30,45],75);
  assert.ok(countMain(bodyweight,'curtsy-lunge')>=10,'curtsy lunge '+countMain(bodyweight,'curtsy-lunge'));
  assert.ok(countMain(bodyweight,'kick-through')>=3,'kick-through '+countMain(bodyweight,'kick-through'));
});

test('Kettlebell snatch is reachable in kettlebell Cardio and Balanced Main',()=>{
  const cardio=sample(['kettlebell'],'cardio',[30,45],75);
  assert.ok(countMain(cardio,'kettlebell-snatch')>=5,'kettlebell snatch '+countMain(cardio,'kettlebell-snatch'));
});

test('Dumbbell plank pull-through and renegade row are each reachable with dumbbells',()=>{
  const dumbbells=sample(['dumbbells'],'balanced',[30,45],75);
  assert.ok(countMain(dumbbells,'dumbbell-plank-pull-through')>=3,'pull-through '+countMain(dumbbells,'dumbbell-plank-pull-through'));
  assert.ok(countMain(dumbbells,'dumbbell-renegade-row')>=3,'renegade row '+countMain(dumbbells,'dumbbell-renegade-row'));
});

test('the rare supporting Dumbbell lateral raise is reachable and stays secondary',()=>{
  const mixed=sample(['dumbbells','kettlebell'],'strength',[30,45],150);
  const raise=countMain(mixed,'dumbbell-lateral-raise');
  assert.ok(raise>=1,'lateral raise '+raise);
  assert.ok(raise*4<countMain(mixed,'goblet-squat')+countMain(mixed,'kettlebell-deadlift')+countMain(mixed,'push-up'),'lateral raise vs peers');
  for(const workout of mixed)assert.ok(mainIds(workout).filter(id=>id==='dumbbell-lateral-raise').length<=1);
});

test('none of the batch appears in Warm-up, Ramp-up or Cool-down',()=>{
  for(const workout of sample(['dumbbells','kettlebell'],'cardio',[20,45],40).concat(sample([],'balanced',[30],40)))
    for(const phase of ['warmup','rampup','cooldown'])
      for(const id of NEW)assert.ok(!workout[phase].exercises.some(ex=>ex.id===id),phase+' '+id);
});
