const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
require('../data/workouts.js');

const G=GarageFitGenerator;
const catalogue=GarageFitData.exercises;
const NEW=['glute-bridge','scapular-pull-up','dumbbell-floor-fly','dumbbell-wood-chop','ski-abs'];
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const mainIds=workout=>workout.main.blocks.flatMap(block=>block.exercises.map(exercise=>exercise.id));
const prepIds=(workout,phase)=>workout[phase].exercises.map(exercise=>exercise.id);

test('the batch entries match the approved metadata',()=>{
  const gb=catalogue['glute-bridge'],sp=catalogue['scapular-pull-up'],ff=catalogue['dumbbell-floor-fly'],wc=catalogue['dumbbell-wood-chop'],sa=catalogue['ski-abs'];
  assert.deepEqual(gb.equipment,[]);
  assert.deepEqual([gb.patterns,gb.conditioning,gb.strength,gb.cardio,gb.impact,gb.sidedness,gb.bodyPosition,gb.mainRole],[['hinge'],false,3,1,'low','bilateral','floor','primary']);
  assert.deepEqual(gb.prescription,{type:'reps',value:12});
  assert.equal(gb.estimatedSeconds,30);
  assert.deepEqual(gb.mainProtocols,['rounds','paired_sets']);
  assert.deepEqual(gb.rampupPrescription,{type:'timed',value:30,minValue:20,maxValue:35});
  assert.deepEqual([gb.prepIntensity,gb.prepFatigue,gb.prepComplexity],[2,2,1]);
  assert.deepEqual(sp.equipment,[['pullup-bar']]);
  assert.deepEqual([sp.patterns,sp.conditioning,sp.strength,sp.cardio,sp.impact,sp.sidedness,sp.bodyPosition,sp.mainRole,sp.family],[['pull'],false,3,1,'low','bilateral','hanging','supporting',null]);
  assert.deepEqual(sp.prescription,{type:'reps',value:10});
  assert.equal(sp.estimatedSeconds,30);
  assert.deepEqual(sp.mainProtocols,['rounds','paired_sets']);
  assert.deepEqual(sp.rampupPrescription,{type:'timed',value:25,minValue:20,maxValue:30});
  assert.deepEqual([sp.prepIntensity,sp.prepFatigue,sp.prepComplexity],[2,1,2]);
  assert.deepEqual(ff.equipment,[['dumbbells']]);
  assert.deepEqual([ff.patterns,ff.conditioning,ff.strength,ff.cardio,ff.impact,ff.load,ff.sidedness,ff.bodyPosition,ff.movementPlanes,ff.mainRole],[['push'],false,4,1,'low','Light','bilateral','floor',['transverse'],'supporting']);
  assert.deepEqual(ff.prescription,{type:'reps',value:10});
  assert.equal(ff.estimatedSeconds,35);
  assert.deepEqual(ff.mainProtocols,['rounds','paired_sets']);
  assert.deepEqual(wc.equipment,[['dumbbells']]);
  assert.deepEqual([wc.patterns,wc.conditioning,wc.strength,wc.cardio,wc.impact,wc.load,wc.sidedness,wc.bodyPosition,wc.movementPlanes,wc.mainRole],[['core'],false,4,3,'low','Medium','alternating','standing',['transverse'],'supporting']);
  assert.deepEqual(wc.prescription,{type:'timed',value:40});
  assert.deepEqual(wc.prescriptionModes,['time']);
  assert.ok(wc.mainProtocols.includes('timed_intervals'));
  assert.deepEqual(sa.equipment,[]);
  assert.deepEqual([sa.patterns,sa.conditioning,sa.strength,sa.cardio,sa.impact,sa.sidedness,sa.bodyPosition,sa.movementPlanes,sa.mainRole],[['core'],true,3,5,'high','alternating','floor',['frontal','transverse'],'primary']);
  assert.deepEqual(sa.prescription,{type:'timed',value:30});
  assert.ok(sa.mainProtocols.includes('timed_intervals'));
});

test('phase flags: only Glute bridge and Scapular pull-up reach Ramp-up; none reach Warm-up or Cool-down',()=>{
  for(const id of NEW){
    const ex=catalogue[id];
    assert.ok(ex.generator&&ex.main,id);
    assert.equal(ex.warmup,false,id);
    assert.equal(ex.cooldown,false,id);
    assert.equal(ex.rampup,['glute-bridge','scapular-pull-up'].includes(id),id);
    assert.equal(ex.voiceInstruction,true,id);
    assert.ok(ex.instruction.length<=180,id);
    assert.equal(ex.instruction.split(/(?<=\.)\s+/).length,1,id);
  }
  assert.deepEqual(G.validateCatalogue(catalogue),[]);
});

test('Dumbbell floor fly needs dumbbells but no bench; Ski abs stays high impact',()=>{
  assert.deepEqual(catalogue['dumbbell-floor-fly'].equipment,[['dumbbells']]);
  assert.equal(catalogue['ski-abs'].impact,'high');
});

test('Dumbbell wood chop is one continuous 40-second interval with a halfway Change side cue',()=>{
  const chop=catalogue['dumbbell-wood-chop'];
  assert.deepEqual(chop.timedCues,[{text:'Change side',at:{type:'fraction',value:0.5}}]);
  assert.equal(chop.estimatedSeconds,40);
  assert.equal(G.sideCount(chop.sidedness),1);
  const tracker=GarageFitTimedCues.createTracker(chop.timedCues,40);
  assert.deepEqual(GarageFitTimedCues.takeDueCues(tracker,19),[]);
  assert.equal(GarageFitTimedCues.takeDueCues(tracker,20)[0].text,'Change side');
  assert.deepEqual(GarageFitTimedCues.takeDueCues(tracker,40),[]);
});

test('the fixed Evening Full-Body Reset glute bridge resolves to the catalogue entry and is unchanged',()=>{
  const fixed=GarageFitData.fixedWorkouts.eveningFullBodyReset;
  const index=fixed.exercises.findIndex(item=>item.id==='glute-bridge');
  assert.equal(index,fixed.exercises.length-1);
  assert.deepEqual(fixed.exercises[index],{id:'glute-bridge',name:'Glute bridge',durationSeconds:40});
  assert.equal(fixed.transitionSeconds,10);
  assert.deepEqual(fixed.exercises.map(item=>item.id),['bodyweight-squat','push-up','alternating-reverse-lunge','bodyweight-good-morning','wall-angel','dead-bug','glute-bridge']);
  assert.ok(fixed.exercises.every(item=>item.durationSeconds===40));
  assert.equal(catalogue['glute-bridge'].id,fixed.exercises[index].id);
  assert.match(catalogue['glute-bridge'].instruction,/^Lie on your back with knees bent/);
});

// Bounded deterministic reachability samples, each at most 300 workouts.
function sample(equipment,focus,durations,seeds,base=1){
  const out=[];
  for(const duration of durations)for(let seed=base;seed<base+seeds;seed++)
    out.push(G.generate({catalogue,duration,focus,equipment,random:random(seed*104729+duration)}));
  return out;
}
const countMain=(workouts,id)=>workouts.filter(workout=>mainIds(workout).includes(id)).length;
const countPrep=(workouts,id,phase)=>workouts.filter(workout=>prepIds(workout,phase).includes(id)).length;

test('Glute bridge, Ski abs and Dumbbell wood chop are reachable in Main',()=>{
  const bodyweight=sample([],'balanced',[20,30,45],40);
  assert.ok(countMain(bodyweight,'glute-bridge')>=10,'glute bridge '+countMain(bodyweight,'glute-bridge'));
  assert.ok(countMain(bodyweight,'ski-abs')>=10,'ski abs '+countMain(bodyweight,'ski-abs'));
  const dumbbells=sample(['dumbbells'],'balanced',[30,45],100);
  assert.ok(countMain(dumbbells,'dumbbell-wood-chop')>=5,'wood chop '+countMain(dumbbells,'dumbbell-wood-chop'));
});

test('the supporting Dumbbell floor fly and Scapular pull-up are reachable in Main, and stay secondary',()=>{
  const strength=sample(['dumbbells'],'strength',[30,45],150);
  const fly=countMain(strength,'dumbbell-floor-fly');
  assert.ok(fly>=1,'floor fly '+fly);
  const bar=sample(['pullup-bar'],'cardio',[45],60);
  const scapular=countMain(bar,'scapular-pull-up');
  assert.ok(scapular>=1,'scapular pull-up '+scapular);
  // Control: the supporting entries stay far below their primary peers.
  assert.ok(fly*4<countMain(strength,'dumbbell-floor-press')+countMain(strength,'dumbbell-bench-press')+countMain(strength,'goblet-squat'),'floor fly vs peers');
  assert.ok(scapular*4<countMain(bar,'burpees')+countMain(bar,'mountain-climbers'),'scapular vs peers');
  for(const workout of strength.concat(bar))for(const id of ['dumbbell-floor-fly','scapular-pull-up'])
    assert.ok(mainIds(workout).filter(item=>item===id).length<=1,id);
});

test('Glute bridge and Scapular pull-up are reachable in Ramp-up without breaking intensity progression',()=>{
  const strength=sample([],'strength',[45],200);
  assert.ok(countPrep(strength,'glute-bridge','rampup')>=1,'glute bridge ramp-up '+countPrep(strength,'glute-bridge','rampup'));
  const bar=sample(['pullup-bar'],'strength',[45],60);
  assert.ok(countPrep(bar,'scapular-pull-up','rampup')>=10,'scapular pull-up ramp-up '+countPrep(bar,'scapular-pull-up','rampup'));
  // Ramp-up never drops by more than one intensity step, with or without the new entries.
  for(const workout of strength.concat(bar)){
    const ramp=workout.rampup.exercises;
    for(let i=1;i<ramp.length;i++)assert.ok(ramp[i].prepIntensity>=ramp[i-1].prepIntensity-1,ramp.map(ex=>ex.id+':'+ex.prepIntensity).join(' > '));
  }
});

test('none of the batch is generated in Warm-up, and Ramp-up never gains consecutive high impact',()=>{
  for(const workout of sample([],'cardio',[20,45],50).concat(sample(['dumbbells','pullup-bar'],'balanced',[30],50))){
    for(const id of NEW)assert.ok(!prepIds(workout,'warmup').includes(id),id);
    for(const phase of ['rampup']){
      const ramp=workout[phase].exercises;
      for(let i=1;i<ramp.length;i++)assert.ok(!(ramp[i].impact==='high'&&ramp[i-1].impact==='high'),ramp.map(ex=>ex.id).join(' > '));
    }
  }
});
