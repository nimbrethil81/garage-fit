const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {savedWorkoutV2}=require('./helpers/protocol-fixtures');
global.window=global;
require('../data/equipment');require('../data/exercises');require('../data/workout-families');
require('../js/workout-families');require('../js/generator');require('../data/mobility-membership');
const F=GarageFitWorkoutFamilies,G=GarageFitGenerator,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value));
const FAMILY='mobility-movement-quality',ROLES=['prep','focused','flow','finish'];
const context=(role,extra={})=>({workoutFamilyId:FAMILY,workoutFamilyVersion:1,role,...extra});
// Approved M1-M15 and their reviewed roles.
const NEW=['ninety-ninety-hip-switches','thread-the-needle','kneeling-ankle-rocks','worlds-greatest-stretch','cat-cow',
  'adductor-rock-backs','standing-hip-rotations','squat-to-stand'];
const ADAPTED=['cossack-squat','downward-upward-dog','trx-squat-overhead'];
const REUSED=['wall-angel','hamstring-sweeps','leg-swings-forward-back','leg-swings-side'];
const ROLE_TABLE={'ninety-ninety-hip-switches':['focused','flow'],'thread-the-needle':['focused','flow'],
  'kneeling-ankle-rocks':['prep','focused'],'worlds-greatest-stretch':['flow'],'cossack-squat':['flow'],'cat-cow':['prep','finish'],
  'wall-angel':['focused','finish'],'adductor-rock-backs':['focused'],'downward-upward-dog':['flow','finish'],
  'standing-hip-rotations':['prep','focused'],'hamstring-sweeps':['prep','flow'],'leg-swings-forward-back':['prep'],
  'leg-swings-side':['prep'],'squat-to-stand':['prep','flow'],'trx-squat-overhead':['prep','flow']};
const ALL=[...NEW,...ADAPTED,...REUSED];
const eligible=(role,owned,difficulty='normal',extra={})=>Object.values(C)
  .filter(exercise=>G.generatedPhaseEligible(exercise,'main',owned,difficulty,context(role,extra))).map(exercise=>exercise.id);
function block(ids,role,protocol='rounds',familyContext=context(role)){
  const exercises=ids.map(id=>copy(C[id]));
  return {id:'main-1',protocol,intent:'accessory',familyContext,exercises,
    prescription:protocol==='rounds'?{rounds:1,exerciseRestSeconds:5,roundRestSeconds:0}
      :{workSeconds:30,transitionSeconds:5,cycles:1}};
}

test('exactly eight new unique Mobility entries are family-only, bodyweight and fully instructed',()=>{
  assert.equal(new Set(ALL).size,15);assert.equal(NEW.length+ADAPTED.length+REUSED.length,15);
  assert.deepEqual(G.validateCatalogue(C),[]);
  for(const id of NEW){
    const ex=C[id];assert.ok(ex,id);assert.match(id,/^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.deepEqual(ex.equipment,[],id);
    assert.equal(ex.generator||ex.main||ex.warmup||ex.rampup||ex.cooldown,false,id+' must not be promoted to any generated phase');
    assert.equal(ex.impact,'low',id);assert.equal(ex.difficulty,null,id);assert.equal(ex.family,null,id);
    assert.ok(ex.prescription.type.includes('timed'),id);
    assert.equal(ex.prescription.type.startsWith('unilateral'),ex.sidedness==='per-side',id);
    assert.ok(ex.instruction.length<=180&&ex.instruction.split(/(?<=\.)\s+/).length===1,id);
  }
  assert.equal(Object.keys(C).filter(id=>NEW.includes(id)).length,8);
  assert.equal(C['squat-to-stand'].sidedness,'bilateral');assert.equal(C['ninety-ninety-hip-switches'].sidedness,'alternating');
  assert.equal(C['worlds-greatest-stretch'].unilateral,true);
});

test('the seven referenced existing entries keep their canonical phase flags and definitions',()=>{
  const flags=id=>['generator','main','warmup','rampup','cooldown'].filter(key=>C[id][key]);
  assert.deepEqual(flags('cossack-squat'),['generator','main','rampup']);
  assert.deepEqual(flags('downward-upward-dog'),['cooldown']);
  assert.deepEqual(flags('trx-squat-overhead'),['warmup','rampup']);
  assert.deepEqual(flags('wall-angel'),['main']);
  for(const id of ['hamstring-sweeps','leg-swings-forward-back','leg-swings-side'])assert.deepEqual(flags(id),['warmup'],id);
  assert.deepEqual(C['cossack-squat'].prescription,{type:'reps',value:10});
  assert.deepEqual(C['wall-angel'].prescription,{type:'timed',value:40});
});

test('membership grants exactly the approved roles and nothing else, and is registered once',()=>{
  for(const role of ROLES){
    const expected=ALL.filter(id=>ROLE_TABLE[id].includes(role)).sort();
    assert.deepEqual(eligible(role,['trx']).sort(),expected,role);
    assert.deepEqual(eligible(role,[]).sort(),expected.filter(id=>id!=='trx-squat-overhead'),role+' bodyweight');
  }
  for(const id of ALL)for(const role of ROLES)
    assert.equal(!!F.getMembership(context(role),id),ROLE_TABLE[id].includes(role),id+':'+role);
  assert.equal(F.getMembership(context('flow'),'plank'),null);
  assert.throws(()=>F.registerMembershipPolicy({workoutFamilyId:FAMILY,entries:[]}),/only once/);
  assert.ok(Object.isFrozen(F.getMembership(context('flow'),'cat-cow')));
});

test('every M1-M15 is reachable in its intended roles; TRX only with TRX, across all difficulties',()=>{
  for(const id of ALL){
    for(const role of ROLE_TABLE[id])for(const difficulty of ['easy','normal','hard']){
      const owned=id==='trx-squat-overhead'?['trx']:[];
      assert.equal(G.generatedPhaseEligible(C[id],'main',owned,difficulty,context(role)),true,id+':'+role+':'+difficulty);
      assert.equal(G.protocolCompatible(C[id],'rounds',context(role)),true,id);
      const b=block([id],role);
      assert.deepEqual(G.validateMain({blocks:[b]},C,owned),[],id+':'+role);
      const steps=G.resolveBlockSteps(b).filter(step=>step.kind==='exercise');
      assert.equal(steps.length,1,id);
      assert.equal(G.estimateBlockDuration(b),C[id].estimatedSeconds,id);
      // A contextual per-side target plans both sides at equal duration.
      const sided=C[id].unilateral,type=sided?'unilateral-timed':'timed';
      const timedBlock={...b,occurrenceTargets:[{plannedPrescription:{type,value:20}}]};
      assert.deepEqual(G.validateMain({blocks:[timedBlock]},C,owned),[],id);
      assert.equal(G.resolveBlockSteps(timedBlock)[0].estimatedSeconds,sided?40:20,id);
    }
    // Outside the approved roles, or without a role grant, nothing is authorised.
    for(const role of ROLES.filter(item=>!ROLE_TABLE[id].includes(item)))
      assert.equal(G.generatedPhaseEligible(C[id],'main',['trx'],'normal',context(role)),false,id+':'+role);
  }
  assert.equal(G.generatedPhaseEligible(C['trx-squat-overhead'],'main',[],'normal',context('prep')),false);
  assert.ok(G.validateMain({blocks:[block(['trx-squat-overhead'],'prep')]},C,[]).some(issue=>issue.includes('family:ineligible')));
});

test('role sequences build valid blocks in shared Main validation, including timed intervals for continuous movements',()=>{
  for(const role of ROLES){
    const ids=ALL.filter(id=>ROLE_TABLE[id].includes(role)&&id!=='trx-squat-overhead');
    const b=block(ids,role);
    assert.deepEqual(G.validateMain({blocks:[b]},C,[]),[],role);
    const w=savedWorkoutV2(C);w.main.blocks=[b];G.normaliseWorkout(w);
    assert.equal(w.main.blocks[0].estimatedDurationSeconds,G.estimateBlockDuration(b),role);
    assert.ok(G.estimateBlockDuration(b)>0,role);
  }
  for(const id of ALL){
    // Canonical protocol rules stay authoritative: per-side and rep/default-protocol movements cannot use intervals.
    const continuous=!C[id].main&&C[id].sidedness!=='per-side'&&C[id].prescription.type.includes('timed');
    assert.equal(G.protocolCompatible(C[id],'timed_intervals',context(ROLE_TABLE[id][0])),continuous,id);
    assert.equal(G.protocolCompatible(C[id],'paired_sets',context(ROLE_TABLE[id][0])),false,id+' is never a superset member');
  }
  const intervals=block(['cat-cow','squat-to-stand'],'prep','timed_intervals');
  assert.deepEqual(G.validateMain({blocks:[intervals]},C,[]),[]);
  assert.equal(G.estimateBlockDuration(intervals)>0,true);
});

test('contextual prescriptions stay inside reviewed bounds and keep canonical defaults',()=>{
  const dose=(type,value)=>[{plannedPrescription:{type,value}}];
  const withTarget=(id,role,type,value)=>({...block([id],role),occurrenceTargets:dose(type,value)});
  assert.deepEqual(G.validateMain({blocks:[withTarget('hamstring-sweeps','prep','timed',30)]},C,[]),[]);
  assert.deepEqual(G.validateMain({blocks:[withTarget('worlds-greatest-stretch','flow','unilateral-timed',45)]},C,[]),[]);
  for(const [id,role,type,value] of [['worlds-greatest-stretch','flow','unilateral-timed',46],['worlds-greatest-stretch','flow','timed',30],
    ['cat-cow','prep','timed',61],['cat-cow','prep','reps',8],['leg-swings-side','prep','unilateral-reps',8],['cossack-squat','flow','reps',13]])
    assert.ok(G.validateMain({blocks:[withTarget(id,role,type,value)]},C,[]).length,id+':'+type+':'+value);
  assert.deepEqual(G.validateMain({blocks:[withTarget('cossack-squat','flow','reps',6)]},C,[]),[]);
  assert.equal(G.resolveBlockSteps(withTarget('cossack-squat','flow','timed',30))[0].estimatedSeconds,30);
  assert.equal(G.resolveBlockSteps(withTarget('cossack-squat','flow','reps',5))[0].estimatedSeconds,20);
  assert.equal(G.estimateBlockDuration(withTarget('thread-the-needle','focused','unilateral-timed',25)),50);
});

test('position, impact and Easy constraints stay hard gates in Mobility contexts',()=>{
  const standing=eligible('flow',['trx'],'normal',{bodyPositions:['standing']});
  assert.ok(standing.includes('squat-to-stand')&&standing.includes('cossack-squat')&&!standing.includes('downward-upward-dog'));
  assert.equal(eligible('flow',[],'normal',{excludedImpact:['medium']}).includes('cossack-squat'),false);
  assert.equal(eligible('flow',[],'easy').includes('cossack-squat'),true,'moderate Cossack squat is not excluded from Easy');
  for(const id of ALL)assert.notEqual(C[id].difficulty,'hard',id);
});

test('ordinary Generator, warm-up, cool-down and Main eligibility are unchanged outside Mobility',()=>{
  for(const id of NEW)for(const phase of ['main','warmup','rampup','cooldown'])
    assert.equal(G.generatedPhaseEligible(C[id],phase,['trx','dumbbells','bands','bench','box']),false,id+':'+phase);
  assert.equal(G.generatedPhaseEligible(C['downward-upward-dog'],'main',[]),false);
  assert.equal(G.generatedPhaseEligible(C['wall-angel'],'main',[]),false);
  assert.equal(G.generatedPhaseEligible(C['hamstring-sweeps'],'main',[]),false);
  assert.equal(G.generatedPhaseEligible(C['downward-upward-dog'],'cooldown',[]),true);
  assert.equal(G.generatedPhaseEligible(C['trx-squat-overhead'],'warmup',['trx']),true);
  // Same pre-#178 seeded baseline as the family-eligibility regression: no extra draws.
  let seed=31,draws=0;
  const w=G.generate({duration:10,focus:'strength',bodyFocus:'upper',difficulty:'easy',equipment:[],catalogue:C,
    random:()=>{draws++;seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}});delete w.id;
  assert.equal(draws,68);
  assert.equal(createHash('sha256').update(JSON.stringify(w)).digest('hex'),'f6b2266805a3e7bd97e2e733105240fcdb9ccdaa5ee43c611a04a79d7d183c5f');
  const ids=new Set();
  for(let i=0;i<60;i++){
    let s=i+1;const workout=G.generate({duration:[10,20,30,45][i%4],equipment:['trx','dumbbells'],catalogue:C,random:()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;}});
    for(const section of [workout.warmup,workout.rampup,workout.cooldown,...workout.main.blocks])
      for(const exercise of section.exercises||[])ids.add(exercise.id);
  }
  assert.deepEqual(NEW.filter(id=>ids.has(id)),[]);
});
