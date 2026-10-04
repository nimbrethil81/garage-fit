const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const G=GarageFitGenerator;
const catalogue=GarageFitData.exercises;
const NEW=['bear-crawl','dumbbell-push-press','band-pallof-press','trx-pike','dumbbell-biceps-curl'];
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const mainIds=workout=>workout.main.blocks.flatMap(block=>block.exercises.map(exercise=>exercise.id));

test('the batch entries match the approved metadata',()=>{
  const bc=catalogue['bear-crawl'],pp=catalogue['dumbbell-push-press'],pa=catalogue['band-pallof-press'],tp=catalogue['trx-pike'],bcurl=catalogue['dumbbell-biceps-curl'];
  assert.deepEqual(bc.equipment,[]);
  assert.deepEqual([bc.family,bc.repetitionClass,bc.patterns,bc.conditioning,bc.strength,bc.cardio,bc.impact,bc.sidedness,bc.bodyPosition,bc.movementPlanes,bc.mainRole],[null,null,['core'],true,3,4,'low','alternating','floor',['sagittal'],'primary']);
  assert.deepEqual(bc.prescription,{type:'timed',value:30});
  assert.ok(bc.mainProtocols.includes('timed_intervals'));
  assert.deepEqual(pp.equipment,[['dumbbells']]);
  assert.deepEqual([pp.family,pp.repetitionClass,pp.patterns,pp.conditioning,pp.strength,pp.cardio,pp.impact,pp.load,pp.sidedness,pp.bodyPosition,pp.mainRole],['overhead-press',null,['push'],true,4,4,'medium','Medium','bilateral','standing','primary']);
  assert.deepEqual(pp.prescription,{type:'reps',value:10});
  assert.equal(pp.estimatedSeconds,30);
  assert.deepEqual(pp.mainProtocols,['rounds','paired_sets']);
  assert.deepEqual(pa.equipment,[['bands']]);
  assert.deepEqual([pa.family,pa.repetitionClass,pa.patterns,pa.conditioning,pa.strength,pa.cardio,pa.impact,pa.load,pa.sidedness,pa.bodyPosition,pa.movementPlanes,pa.mainRole],[null,null,['core'],false,3,1,'low','Light','per-side','standing',['transverse'],'supporting']);
  assert.deepEqual(pa.prescription,{type:'unilateral-timed',value:20});
  assert.deepEqual(pa.prescriptionModes,['time']);
  assert.deepEqual(tp.equipment,[['trx']]);
  assert.deepEqual([tp.family,tp.repetitionClass,tp.patterns,tp.conditioning,tp.strength,tp.cardio,tp.impact,tp.sidedness,tp.bodyPosition,tp.movementPlanes,tp.mainRole],[null,null,['core'],false,4,2,'low','bilateral','floor',['sagittal'],'primary']);
  assert.deepEqual(tp.prescription,{type:'reps',value:8});
  assert.equal(tp.estimatedSeconds,30);
  assert.deepEqual(tp.mainProtocols,['rounds','paired_sets']);
  assert.equal(tp.name,'TRX pike');
  assert.deepEqual(bcurl.equipment,[['dumbbells']]);
  assert.deepEqual([bcurl.family,bcurl.repetitionClass,bcurl.patterns,bcurl.conditioning,bcurl.strength,bcurl.cardio,bcurl.impact,bcurl.load,bcurl.sidedness,bcurl.bodyPosition,bcurl.mainRole],['biceps-curl',null,['pull'],false,3,1,'low','Medium','bilateral','standing','supporting']);
  assert.deepEqual(bcurl.prescription,{type:'reps',value:10});
  assert.equal(bcurl.estimatedSeconds,30);
  assert.deepEqual(bcurl.mainProtocols,['rounds','paired_sets']);
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

test('relationships use the existing overhead-press and biceps-curl families only',()=>{
  const press=catalogue['dumbbell-push-press'];
  assert.ok(G.sameFamily(press,catalogue['dumbbell-shoulder-press']));
  assert.ok(!G.sameFamily(press,catalogue['dumbbell-thruster']));
  assert.ok(G.sameFamily(catalogue['dumbbell-biceps-curl'],catalogue['band-biceps-curl']));
  for(const id of ['bear-crawl','band-pallof-press','trx-pike'])
    assert.ok(!catalogue[id].family&&!catalogue[id].repetitionClass,id);
});

test('Pallof press is one per-side exercise budgeted for both sides, in time mode',()=>{
  const pa=catalogue['band-pallof-press'];
  assert.equal(G.sideCount(pa),2);
  assert.equal(pa.estimatedSeconds,40);
  assert.equal(pa.unilateral,true);
  // Per-side work cannot share one timed interval (validated rule), so Main plays it in rounds or paired sets.
  assert.ok(!pa.mainProtocols.includes('timed_intervals'));
  assert.ok(G.protocolCompatible(pa,'rounds')&&G.protocolCompatible(pa,'paired_sets'));
});

// Bounded deterministic reachability samples (300 workouts each).
function sample(equipment,focus,durations=[20,30,45],seeds=100){
  const out=[];
  for(const duration of durations)for(let seed=1;seed<=seeds;seed++)
    out.push(G.generate({catalogue,duration,focus,equipment,random:random(seed*104729+duration)}));
  return out;
}
const countMain=(workouts,id)=>workouts.filter(workout=>mainIds(workout).includes(id)).length;

test('Bear crawl is reachable in bodyweight Main',()=>{
  const bodyweight=sample([],'balanced');
  assert.ok(countMain(bodyweight,'bear-crawl')>=20,'bear crawl '+countMain(bodyweight,'bear-crawl'));
});

test('Dumbbell push press is reachable and does not crowd out the shoulder press or thruster',()=>{
  const dumbbells=sample(['dumbbells'],'strength');
  const press=countMain(dumbbells,'dumbbell-push-press');
  assert.ok(press>=5,'push press '+press);
  assert.ok(countMain(dumbbells,'dumbbell-shoulder-press')+countMain(dumbbells,'dumbbell-thruster')>=press,'strict press and thruster remain at least as common');
  for(const workout of dumbbells)
    assert.ok(mainIds(workout).filter(id=>G.sameFamily(catalogue[id],catalogue['dumbbell-push-press'])).length<=3);
});

test('TRX pike is reachable alongside the existing TRX core exercises',()=>{
  const trx=sample(['trx'],'strength');
  assert.ok(countMain(trx,'trx-pike')>=10,'trx pike '+countMain(trx,'trx-pike'));
  assert.ok(countMain(trx,'trx-knee-tuck')+countMain(trx,'trx-mountain-climber')>=1);
});

test('the supporting Pallof press is reachable with bands and dumbbells and stays secondary',()=>{
  const mixed=sample(['dumbbells','bands'],'strength');
  const pallof=countMain(mixed,'band-pallof-press');
  assert.ok(pallof>=10,'pallof press '+pallof);
  assert.ok(pallof*2<countMain(mixed,'bear-crawl')+countMain(mixed,'dumbbell-push-press')+countMain(mixed,'goblet-squat')+countMain(mixed,'band-row'),'pallof vs peers');
  for(const workout of mixed)assert.ok(mainIds(workout).filter(id=>id==='band-pallof-press').length<=1);
});

test('the rare supporting Dumbbell biceps curl is reachable and stays secondary',()=>{
  const mixed=sample(['dumbbells','kettlebell'],'cardio');
  const curl=countMain(mixed,'dumbbell-biceps-curl');
  assert.ok(curl>=1,'biceps curl '+curl);
  assert.ok(curl*4<countMain(mixed,'single-arm-dumbbell-row')+countMain(mixed,'kettlebell-deadlift')+countMain(mixed,'bear-crawl'),'curl vs primary pulling');
  for(const workout of mixed)assert.ok(mainIds(workout).filter(id=>id==='dumbbell-biceps-curl').length<=1);
});

test('none of the batch appears in Warm-up, Ramp-up or Cool-down',()=>{
  for(const workout of sample(['dumbbells','bands','trx'],'balanced',[20,45],30))
    for(const phase of ['warmup','rampup','cooldown'])
      for(const id of NEW)assert.ok(!workout[phase].exercises.some(ex=>ex.id===id),phase+' '+id);
});
