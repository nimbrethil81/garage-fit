const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const G=GarageFitGenerator;
const catalogue=GarageFitData.exercises;
const NEW=['devils-press','dumbbell-snatch','dumbbell-renegade-row','cossack-squat','switch-kicks'];
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const mainIds=workout=>workout.main.blocks.flatMap(block=>block.exercises.map(exercise=>exercise.id));
const prepIds=(workout,phase)=>workout[phase].exercises.map(exercise=>exercise.id);

test('the batch entries match the approved metadata',()=>{
  const dp=catalogue['devils-press'],ds=catalogue['dumbbell-snatch'],rr=catalogue['dumbbell-renegade-row'],cs=catalogue['cossack-squat'],sk=catalogue['switch-kicks'];
  assert.deepEqual(dp.equipment,[['dumbbells']]);
  assert.deepEqual(dp.patterns,['hinge','push']);
  assert.deepEqual([dp.conditioning,dp.strength,dp.cardio,dp.impact,dp.load,dp.sidedness,dp.bodyPosition],[true,4,5,'high','Medium','bilateral','mixed']);
  assert.deepEqual(dp.prescription,{type:'reps',value:6});
  assert.equal(dp.estimatedSeconds,35);
  assert.equal(dp.mainRole,'primary');
  assert.ok(dp.mainProtocols.includes('timed_intervals'));
  assert.deepEqual([ds.patterns,ds.conditioning,ds.strength,ds.cardio,ds.impact,ds.sidedness,ds.movementPlanes],[['hinge'],true,4,4,'medium','alternating',['sagittal']]);
  assert.deepEqual(ds.prescription,{type:'reps',value:12});
  assert.ok(ds.mainProtocols.includes('timed_intervals'));
  assert.deepEqual([rr.patterns,rr.conditioning,rr.strength,rr.cardio,rr.impact,rr.sidedness,rr.bodyPosition,rr.movementPlanes],[['pull','core'],false,4,2,'low','alternating','floor',['sagittal','transverse']]);
  assert.deepEqual(rr.prescription,{type:'reps',value:12});
  assert.equal(rr.estimatedSeconds,40);
  assert.deepEqual(rr.mainProtocols,['rounds','paired_sets']);
  assert.deepEqual(cs.equipment,[]);
  assert.deepEqual([cs.patterns,cs.conditioning,cs.strength,cs.cardio,cs.impact,cs.sidedness,cs.movementPlanes],[['lunge'],false,4,2,'medium','alternating',['frontal']]);
  assert.deepEqual(cs.prescription,{type:'reps',value:10});
  assert.equal(cs.estimatedSeconds,40);
  assert.deepEqual(cs.mainProtocols,['rounds','paired_sets']);
  assert.deepEqual(cs.rampupPrescription,{type:'timed',value:25,minValue:20,maxValue:35});
  assert.deepEqual([cs.prepIntensity,cs.prepFatigue,cs.prepComplexity],[3,2,3]);
  assert.deepEqual(sk.equipment,[]);
  assert.deepEqual([sk.patterns,sk.conditioning,sk.strength,sk.cardio,sk.impact,sk.sidedness,sk.bodyPosition,sk.movementPlanes,sk.mainRole],[[],true,1,5,'high','alternating','standing',['sagittal'],'supporting']);
  assert.deepEqual(sk.prescription,{type:'timed',value:30});
  assert.ok(sk.mainProtocols.includes('timed_intervals'));
  assert.deepEqual(sk.rampupPrescription,{type:'timed',value:30,minValue:25,maxValue:35});
  assert.deepEqual([sk.prepIntensity,sk.prepFatigue,sk.prepComplexity],[5,2,2]);
});

test('phase flags: Main for all, Ramp-up only for Cossack squat and switch kicks, never Warm-up',()=>{
  for(const id of NEW){
    assert.ok(catalogue[id].generator&&catalogue[id].main,id);
    assert.equal(catalogue[id].warmup,false,id);
    assert.equal(catalogue[id].cooldown,false,id);
    assert.equal(catalogue[id].rampup,['cossack-squat','switch-kicks'].includes(id),id);
    assert.equal(catalogue[id].voiceInstruction,true,id);
    assert.ok(catalogue[id].instruction.length<=180,id);
  }
  assert.deepEqual(G.validateCatalogue(catalogue),[]);
});

test("Devil's press is the only two-sentence instruction in the batch",()=>{
  for(const id of NEW){
    const sentences=catalogue[id].instruction.split(/(?<=\.)\s+/);
    assert.equal(sentences.length,id==='devils-press'?2:1,id);
  }
});

test('the explosive dumbbell pair shares a repetition class, not a family',()=>{
  const a=catalogue['devils-press'],b=catalogue['dumbbell-snatch'];
  assert.equal(a.repetitionClass,'dumbbell-snatch-conditioning');
  assert.equal(b.repetitionClass,a.repetitionClass);
  assert.equal(a.family,null);
  assert.equal(b.family,null);
  assert.ok(!G.sameFamily(a,b)&&G.sameRepetitionClass(a,b));
});

// Main policy: a candidate sharing a non-null repetitionClass with the previous Main exercise is
// penalised, but remains selectable when nothing else is available.
const clone=value=>JSON.parse(JSON.stringify(value));
const state=previous=>({exercises:previous?[previous]:[],usedIds:new Set(),blocks:[],owned:[]});
const bareBase=catalogue['kettlebell-swing'];
function candidate(id,repetitionClass){
  return Object.assign(clone(bareBase),{id,family:null,repetitionClass,equipment:[]});
}

test('Main selection prefers a different exercise over one sharing the previous repetition class',()=>{
  const previous=candidate('previous','shared-class');
  const same=candidate('same','shared-class');
  const other=candidate('other',null);
  const otherClass=candidate('other-class','different-class');
  const pick=pool=>G.selectBlockExercises(pool,1,'balanced','conditioning','rounds',state(previous),[],()=>0,{})[0].id;
  assert.notEqual(pick([same,other]),'same');
  assert.notEqual(pick([same,otherClass]),'same');
  // Null classes never count as a relationship.
  const nullPrevious=candidate('previous',null);
  const nullPick=pool=>G.selectBlockExercises(pool,1,'balanced','conditioning','rounds',state(nullPrevious),[],()=>0,{})[0].id;
  assert.equal(nullPick([candidate('a',null),candidate('b',null)]),'a');
});

test('the repetition-class rule is a penalty, not an exclusion',()=>{
  const previous=candidate('previous','shared-class');
  const only=candidate('only','shared-class');
  const picked=G.selectBlockExercises([only],1,'balanced','conditioning','rounds',state(previous),[],()=>0,{});
  assert.deepEqual(picked.map(item=>item.id),['only']);
  // Within one selection, the second pick avoids the class of the first.
  const pool=[candidate('x','c'),candidate('y','c'),candidate('z',null)];
  const two=G.selectBlockExercises(pool,2,'balanced','conditioning','rounds',state(null),[],()=>0,{});
  assert.ok(!(two[0].repetitionClass&&two[0].repetitionClass===two[1].repetitionClass),two.map(item=>item.id).join(','));
});

// Bounded deterministic reachability samples (160 workouts each).
function sample(equipment,focuses,durations,seeds=20){
  const out=[];
  for(const focus of focuses)for(const duration of durations)for(let seed=1;seed<=seeds;seed++)
    out.push(G.generate({catalogue,duration,focus,equipment,random:random(seed*7919+duration*17+focus.length*131)}));
  return out;
}
const countMain=(workouts,id)=>workouts.filter(workout=>mainIds(workout).includes(id)).length;
const countPrep=(workouts,id,phase)=>workouts.filter(workout=>prepIds(workout,phase).includes(id)).length;
const dumbbells=sample(['dumbbells'],['strength','balanced','cardio'],[30,45]);
const bodyweight=sample([],['balanced','cardio'],[30,45],40);

test('dumbbell Main exercises are reachable, including both members of the shared class',()=>{
  for(const id of ['devils-press','dumbbell-snatch','dumbbell-renegade-row'])
    assert.ok(countMain(dumbbells,id)>=2,id+' '+countMain(dumbbells,id));
});

test('bodyweight Main and Ramp-up reachability for Cossack squat and switch kicks',()=>{
  assert.ok(countMain(bodyweight,'cossack-squat')>=2,'cossack main '+countMain(bodyweight,'cossack-squat'));
  assert.ok(countMain(bodyweight,'switch-kicks')>=2,'switch kicks main '+countMain(bodyweight,'switch-kicks'));
  assert.ok(countPrep(bodyweight,'cossack-squat','rampup')>=2,'cossack ramp-up');
  assert.ok(countPrep(bodyweight,'switch-kicks','rampup')>=2,'switch kicks ramp-up');
  for(const workout of bodyweight.concat(dumbbells))for(const id of NEW)
    assert.ok(!prepIds(workout,'warmup').includes(id),id);
});

test('Devil\'s press and dumbbell snatch are not usually adjacent in generated Main',()=>{
  let adjacent=0,both=0;
  for(const workout of dumbbells){
    const ids=mainIds(workout);
    if(ids.includes('devils-press')&&ids.includes('dumbbell-snatch'))both++;
    for(let i=1;i<ids.length;i++)
      if(new Set([ids[i-1],ids[i]]).size===2&&ids[i-1].match(/^(devils-press|dumbbell-snatch)$/)&&ids[i].match(/^(devils-press|dumbbell-snatch)$/))adjacent++;
  }
  assert.ok(adjacent*2<=both,'adjacent '+adjacent+' of '+both);
});
