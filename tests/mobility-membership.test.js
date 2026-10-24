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
  const snapshotCatalogue=require('./helpers/coach-fixtures').catalogueBeforeC1(C);
  let seed=31,draws=0;
  const w=G.generate({duration:10,focus:'strength',bodyFocus:'upper',difficulty:'easy',equipment:[],catalogue:snapshotCatalogue,
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

// ---- Mobility membership v2 (#263): reviewed eligibility only; composition v2 (#264) is covered in mobility-composer.test.js ----
const V2_ADDED={'ankle-circles':['prep','focused'],'heel-toe-rocks':['prep','focused'],'shoulder-rolls':['prep'],'open-close-gates':['prep'],
  'standing-side-bends':['prep','focused'],'body-hoops':['prep'],'body-twists':['prep','focused'],'shallow-knee-bends':['prep'],
  'trx-lateral-weight-shift':['prep','flow'],'hip-flexor-arm-stretch':['focused','finish'],'runners-stretch':['focused'],
  'childs-pose':['finish'],'lying-torso-twist':['finish'],'glute-stretch':['finish'],'chest-opener':['finish'],
  'quadruped-thoracic-rotation':['focused','flow'],'supported-squat-rocks':['focused','flow'],
  'controlled-shoulder-rotations':['prep','focused'],'half-kneeling-hip-flexor-rocks-with-reach':['focused','flow']};
const V2_NEW=['quadruped-thoracic-rotation','supported-squat-rocks','controlled-shoulder-rotations','half-kneeling-hip-flexor-rocks-with-reach'];
const V2_TABLE={...ROLE_TABLE,...V2_ADDED},V2_IDS=Object.keys(V2_TABLE);
const v2=(role,extra={})=>context(role,{workoutFamilyVersion:2,...extra});
const eligible2=(role,owned,difficulty='normal',extra={})=>Object.values(C)
  .filter(exercise=>G.generatedPhaseEligible(exercise,'main',owned,difficulty,v2(role,extra))).map(exercise=>exercise.id);

test('four new Mobility canonical movements are distinct, family-only, safely prescribed and instructed (#263)',()=>{
  assert.deepEqual(G.validateCatalogue(C),[]);
  const expected={'quadruped-thoracic-rotation':['per-side','floor','unilateral-timed',[]],'supported-squat-rocks':['bilateral','standing','timed',[['trx']]],
    'controlled-shoulder-rotations':['per-side','standing','unilateral-timed',[]],'half-kneeling-hip-flexor-rocks-with-reach':['per-side','floor','unilateral-timed',[]]};
  for(const id of V2_NEW){
    const ex=C[id],[side,position,type,equipment]=expected[id];
    assert.equal(ex.sidedness,side,id);assert.equal(ex.bodyPosition,position,id);assert.equal(ex.prescription.type,type,id);
    assert.deepEqual(ex.equipment,equipment,id);
    assert.equal(ex.generator||ex.main||ex.warmup||ex.rampup||ex.cooldown,false,id+' stays family-only');
    assert.equal(ex.impact,'low',id);assert.equal(ex.difficulty,null,id);assert.equal(ex.family,null,id);
    assert.ok(ex.instruction.length<=180&&ex.instruction.split(/(?<=\.)\s+/).length===1,id);
  }
  assert.equal(new Set(V2_NEW.map(id=>C[id].name)).size,4);
  // Distinct from the neighbouring movements they must not duplicate.
  assert.notEqual(C['quadruped-thoracic-rotation'].instruction,C['thread-the-needle'].instruction);
  assert.deepEqual(C['half-kneeling-hip-flexor-rocks-with-reach'].stretchTargets,[]);
  assert.equal(C['half-kneeling-hip-flexor-rocks-with-reach'].cooldown,false);
});

test('membership v2 resolves exactly 34 identities with the approved roles and keeps v1 byte-identical (#263)',()=>{
  assert.equal(V2_IDS.length,34);assert.equal(F.currentVersion(FAMILY),3,'composition v3 is current since #272');
  const def=F.getDefinition(FAMILY,2);
  assert.deepEqual([def.membershipPolicy,def.compositionPolicy],[{id:FAMILY,version:2},{id:FAMILY,version:2}]);
  for(const role of ROLES){
    const expected=V2_IDS.filter(id=>V2_TABLE[id].includes(role)).sort();
    assert.deepEqual(eligible2(role,['trx']).sort(),expected.filter(id=>id!=='runners-stretch'||role==='focused'),role);
  }
  for(const id of V2_IDS)for(const role of ROLES)assert.equal(!!F.getMembership(v2(role),id),V2_TABLE[id].includes(role),id+':'+role);
  assert.equal(new Set(ROLES.flatMap(role=>V2_IDS.filter(id=>F.getMembership(v2(role),id)))).size,34);
  for(const id of ['frog-stretch','pigeon-stretch','side-plank-reach-through','plank'])for(const role of ROLES)assert.equal(F.getMembership(v2(role),id),null,id);
  // v1 keeps exactly its 15 identities and published entries (no v2 additions, no changed prescriptions).
  for(const id of V2_IDS)for(const role of ROLES)assert.equal(!!F.getMembership(context(role),id),!!(ROLE_TABLE[id]&&ROLE_TABLE[id].includes(role)),'v1 '+id+':'+role);
  assert.equal(createHash('sha256').update(JSON.stringify(ALL.flatMap(id=>ROLES.map(role=>F.getMembership(context(role),id))))).digest('hex'),
    '5d72a0cbcd70f2196d839744b8fdaa8f6f1d1358892e1b0b0a1a552210b0f252','published membership v1 entries are frozen');
  for(const id of ALL)for(const role of ROLE_TABLE[id])
    assert.deepEqual(F.getMembership(context(role),id).prescriptions,F.getMembership(v2(role),id).prescriptions,id+':'+role);
});

test('v2 doses: new movements keep reviewed bounds; existing additions stay within 15-40 seconds; static holds are Focus/Finish only (#263)',()=>{
  const bounds={'quadruped-thoracic-rotation':[15,25],'supported-squat-rocks':[20,30],'controlled-shoulder-rotations':[15,25],'half-kneeling-hip-flexor-rocks-with-reach':[15,25]};
  for(const id of V2_IDS.filter(id=>!ALL.includes(id)))for(const role of V2_TABLE[id]){
    const entry=F.getMembership(v2(role),id),[low,high]=bounds[id]||[15,40];
    assert.equal(entry.prescriptions.length,1,id);
    assert.deepEqual([entry.prescriptions[0].minValue,entry.prescriptions[0].maxValue],[low,high],id);
    assert.equal(entry.prescriptions[0].type,C[id].sidedness==='per-side'?'unilateral-timed':'timed',id);
    assert.ok(C[id].prescription.value>=low&&C[id].prescription.value<=high,id+' canonical default sits inside its dose');
  }
  for(const id of ['hip-flexor-arm-stretch','runners-stretch','childs-pose','lying-torso-twist','glute-stretch','chest-opener'])
    for(const role of V2_TABLE[id])assert.ok(['focused','finish'].includes(role),id+' static hold is never Prepare or Flow');
  const dose=(id,role,type,value)=>({...block([id],role,'rounds',v2(role)),occurrenceTargets:[{plannedPrescription:{type,value}}]});
  assert.deepEqual(G.validateMain({blocks:[dose('quadruped-thoracic-rotation','flow','unilateral-timed',25)]},C,[]),[]);
  assert.ok(G.validateMain({blocks:[dose('quadruped-thoracic-rotation','flow','unilateral-timed',26)]},C,[]).length);
  assert.deepEqual(G.validateMain({blocks:[dose('chest-opener','finish','timed',40)]},C,[]),[]);
  assert.ok(G.validateMain({blocks:[dose('chest-opener','finish','timed',41)]},C,[]).length);
  assert.ok(G.validateMain({blocks:[dose('supported-squat-rocks','flow','timed',31)]},C,['trx']).length);
});

test('v2 safety: supported squat rocks and TRX shifts need owned TRX; runner\'s stretch is not offered at Easy (#263)',()=>{
  for(const id of ['supported-squat-rocks','trx-lateral-weight-shift'])for(const role of V2_TABLE[id])for(const difficulty of ['easy','normal','hard']){
    assert.equal(G.generatedPhaseEligible(C[id],'main',[],difficulty,v2(role)),false,id+' without TRX');
    assert.equal(G.generatedPhaseEligible(C[id],'main',['dumbbells','bands'],difficulty,v2(role)),false,id+' with other equipment');
    assert.equal(G.generatedPhaseEligible(C[id],'main',['trx'],difficulty,v2(role)),true,id+':'+difficulty);
    assert.ok(G.validateMain({blocks:[block([id],role,'rounds',v2(role))]},C,[]).some(issue=>issue.includes('family:ineligible')),id);
  }
  assert.equal(G.generatedPhaseEligible(C['runners-stretch'],'main',[],'easy',v2('focused')),false);
  for(const difficulty of ['normal','hard'])assert.equal(G.generatedPhaseEligible(C['runners-stretch'],'main',[],difficulty,v2('focused')),true,difficulty);
  assert.equal(G.generatedPhaseEligible(C['runners-stretch'],'main',[],'normal',v2('finish')),false);
  assert.equal(G.generatedPhaseEligible(C['runners-stretch'],'main',[],'normal',v2('focused',{difficulty:'easy'})),false);
});

test('every v2 identity is eligible in at least one suitable context, with valid blocks and per-side timing (#263)',()=>{
  for(const id of V2_IDS){
    const owned=['supported-squat-rocks','trx-lateral-weight-shift','trx-squat-overhead'].includes(id)?['trx']:[];
    for(const role of V2_TABLE[id]){
      assert.equal(G.generatedPhaseEligible(C[id],'main',owned,'normal',v2(role)),true,id+':'+role);
      assert.equal(G.protocolCompatible(C[id],'rounds',v2(role)),true,id);
      const b=block([id],role,'rounds',v2(role));assert.deepEqual(G.validateMain({blocks:[b]},C,owned),[],id+':'+role);
      assert.equal(G.estimateBlockDuration(b),C[id].estimatedSeconds,id);
    }
    for(const role of ROLES.filter(item=>!V2_TABLE[id].includes(item)))assert.equal(G.generatedPhaseEligible(C[id],'main',['trx'],'normal',v2(role)),false,id+':'+role);
    assert.equal(G.protocolCompatible(C[id],'paired_sets',v2(V2_TABLE[id][0])),false,id);
  }
  // Position gates remain hard: a floor movement is not selected in a standing-only context.
  const standing=eligible2('focused',['trx'],'normal',{bodyPositions:['standing']});
  assert.ok(standing.includes('controlled-shoulder-rotations')&&standing.includes('supported-squat-rocks'));
  assert.ok(!standing.includes('quadruped-thoracic-rotation')&&!standing.includes('half-kneeling-hip-flexor-rocks-with-reach'));
  // Per-side static holds cannot use one shared interval.
  assert.equal(G.protocolCompatible(C['glute-stretch'],'timed_intervals',v2('finish')),false);
});

test('the new movements and v2 additions are not promoted into ordinary Generator, warm-up or cool-down selection (#263)',()=>{
  for(const id of V2_NEW)for(const phase of ['main','warmup','rampup','cooldown'])
    assert.equal(G.generatedPhaseEligible(C[id],phase,['trx','dumbbells','bands','bench','box']),false,id+':'+phase);
  for(const id of ['childs-pose','chest-opener'])assert.equal(G.generatedPhaseEligible(C[id],'main',[]),false,id);
  assert.equal(G.generatedPhaseEligible(C['childs-pose'],'cooldown',[]),true);
  assert.equal(G.generatedPhaseEligible(C['shoulder-rolls'],'warmup',[]),true);
});

// #272: exact reviewed v3 additions; existing canonical definitions remain shared.
const V3_ADDED={
  'standing-calf-stretch':['focused','finish'],'bent-knee-calf-stretch':['focused','finish'],
  'seated-ninety-ninety-hip-lift-offs':['focused'],'supine-hamstring-stretch':['focused','finish'],
  'butterfly-stretch':['focused','finish'],'standing-hinge-and-reach':['prep','flow'],
  'side-lying-open-books':['focused','flow'],'seated-thoracic-extension':['focused'],'standing-wall-slides':['focused'],
  'standing-lat-stretch':['focused','finish'],'quadruped-wrist-rocks':['prep','focused'],
  'downward-facing-dog':['focused','flow'],'upward-facing-dog':['focused','flow'],'low-cobra-pose':['focused','finish'],
  'extended-puppy-pose':['focused','finish'],'kneeling-hamstring':['focused','finish'],
  'inside-thigh-stretch':['focused','finish'],'frog-stretch':['focused'],'plank-calf-stretch':['focused','flow'],
  'side-stretch':['focused','finish'],'arm-across-pull':['focused','finish']};

test('Mobility v3 adds exactly 21 reviewed identities, 55 total / 52 no-kit, without changing published memberships (#272)',()=>{
  const table={...V2_TABLE,...V3_ADDED};
  assert.equal(Object.keys(table).length,55);
  assert.equal(Object.keys(table).filter(id=>!C[id].equipment.length).length,52,'v2 has 31 no-kit members on current main');
  const definition=F.getDefinition(FAMILY,3);
  assert.equal(definition.membershipPolicy.version,3);assert.equal(definition.compositionPolicy.version,3);
  for(const id of Object.keys(C))for(const role of ROLES) {
    const entry=F.getMembership(context(role,{workoutFamilyVersion:3}),id);
    assert.equal(!!entry,!!table[id]?.includes(role),id+':'+role);
    if(V2_TABLE[id])assert.deepEqual(entry,F.getMembership(v2(role),id),'v2 entry retained: '+id+':'+role);
  }
  for(const id of Object.keys(V3_ADDED)) {
    const ex=C[id];assert.equal(ex.impact,'low',id);assert.equal(ex.generator||ex.main,false,id+' no ordinary Main');
    assert.ok(ex.instruction.length<=180,id);assert.equal(new Set(ex.sideOrder).size,2,id);
    for(const role of V3_ADDED[id]) {
      const c=context(role,{workoutFamilyVersion:3});
      assert.equal(G.generatedPhaseEligible(ex,'main',[],'normal',c),true,id);
      assert.equal(F.getMembership(v2(role),id),null,id+' absent from v2');
      const target=F.getMembership(c,id).prescriptions[0];
      assert.equal(target.type,ex.sidedness==='per-side'?'unilateral-timed':'timed',id);
    }
  }
  for(const id of ['upward-facing-dog','seated-ninety-ninety-hip-lift-offs','plank-calf-stretch']) {
    assert.equal(G.generatedPhaseEligible(C[id],'main',[],'easy',context('focused',{workoutFamilyVersion:3})),false,id+' gated at Easy');
  }
  // The global generic fitters have different bounds. Short loaded/extension poses stay family-only.
  for(const id of ['quadruped-wrist-rocks','upward-facing-dog','low-cobra-pose','extended-puppy-pose','butterfly-stretch','standing-lat-stretch'])
    for(const phase of ['warmup','rampup','cooldown'])assert.equal(G.generatedPhaseEligible(C[id],phase,[]),false,id+':'+phase);
});
