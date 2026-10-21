const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {savedWorkoutV2}=require('./helpers/protocol-fixtures');
global.window=global;
require('../data/equipment');require('../data/exercises');require('../data/workout-families');
require('../js/workout-families');require('../js/generator');require('../data/mobility-membership');require('../data/athletic-membership');
const F=GarageFitWorkoutFamilies,G=GarageFitGenerator,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value));
const FAMILY='athletic-movement',ROLES=['footwork','control','integrated'];
const context=(role,extra={})=>({workoutFamilyId:FAMILY,workoutFamilyVersion:1,role,...extra});
// Approved A1-A13 treatment; A9 and A13 are deferred and must stay absent.
const NEW=['lateral-shuffle','single-leg-balance-reach','forward-back-line-steps','quarter-turn-pivot-steps','lateral-step-and-stick','grapevine-cross-steps'];
const ADAPTED=['bear-crawl'];
const REUSED=['skater-jumps','reverse-lunge-knee-drive','alternating-lateral-lunge','knee-to-opposite-elbow'];
const ALL=[...NEW,...ADAPTED,...REUSED];
const ROLE_TABLE={'lateral-shuffle':['footwork','integrated'],'skater-jumps':['integrated'],'single-leg-balance-reach':['control'],
  'bear-crawl':['control','integrated'],'forward-back-line-steps':['footwork','control'],'reverse-lunge-knee-drive':['control','integrated'],
  'quarter-turn-pivot-steps':['footwork','control'],'lateral-step-and-stick':['footwork','control'],
  'alternating-lateral-lunge':['integrated'],'grapevine-cross-steps':['footwork','integrated'],'knee-to-opposite-elbow':['control']};
const NEEDS_ROOM=['lateral-shuffle','skater-jumps','bear-crawl','grapevine-cross-steps'];
const DEFERRED=['forward-backward-acceleration-and-stop','forward-hop-and-stick','forward-backward-acceleration-stop','forward-hop-stick'];
const ROOM={movementRoom:true},HARD={excludedImpact:[],movementRoom:true};
const eligible=(role,difficulty='normal',extra={},owned=[])=>Object.values(C)
  .filter(exercise=>G.generatedPhaseEligible(exercise,'main',owned,difficulty,context(role,extra))).map(exercise=>exercise.id);
function block(ids,role,protocol='rounds',familyContext=context(role,ROOM)){
  const exercises=ids.map(id=>copy(C[id]));
  return {id:'main-1',protocol,intent:'accessory',familyContext,exercises,
    prescription:protocol==='rounds'?{rounds:1,exerciseRestSeconds:5,roundRestSeconds:0}
      :{workSeconds:30,transitionSeconds:5,cycles:1}};
}

test('exactly six new unique Athletic entries are family-only, bodyweight, low-load and fully instructed',()=>{
  assert.equal(new Set(ALL).size,11);assert.equal(NEW.length+ADAPTED.length+REUSED.length,11);
  assert.deepEqual(G.validateCatalogue(C),[]);
  for(const id of NEW){
    const ex=C[id];assert.ok(ex,id);assert.match(id,/^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.deepEqual(ex.equipment,[],id);
    assert.equal(ex.generator||ex.main||ex.warmup||ex.rampup||ex.cooldown,false,id+' must not be promoted to any generated phase');
    assert.notEqual(ex.impact,'high',id);assert.equal(ex.difficulty,null,id);assert.equal(ex.family,null,id);assert.equal(ex.load,null,id);
    assert.ok(ex.prescription.type.includes('timed'),id);
    assert.equal(ex.prescription.type.startsWith('unilateral'),ex.sidedness==='per-side',id);
    assert.ok(ex.instruction.length<=180&&ex.instruction.split(/(?<=\.)\s+/).length===1,id);
  }
  assert.equal(Object.keys(C).filter(id=>NEW.includes(id)).length,6);
  assert.equal(C['single-leg-balance-reach'].sidedness,'per-side');
  assert.deepEqual(C['grapevine-cross-steps'].timedCues.map(cue=>cue.text),['Change direction']);
  for(const id of DEFERRED)assert.equal(C[id],undefined,id+' is deferred');
  assert.equal(Object.keys(C).filter(id=>/acceleration|forward-hop/.test(id)).length,0);
});

test('the five adapted or reused identities remain single canonical entries with unchanged flags',()=>{
  const flags=id=>['generator','main','warmup','rampup','cooldown'].filter(key=>C[id][key]);
  assert.deepEqual(flags('bear-crawl'),['generator','main']);
  assert.deepEqual(flags('skater-jumps'),['generator','main','rampup']);
  assert.deepEqual(flags('reverse-lunge-knee-drive'),['generator','main']);
  assert.deepEqual(flags('alternating-lateral-lunge'),['generator','main']);
  assert.deepEqual(flags('knee-to-opposite-elbow'),['warmup']);
  assert.deepEqual(C['bear-crawl'].prescription,{type:'timed',value:30});
  assert.deepEqual(C['skater-jumps'].prescription,{type:'timed',value:30});
  assert.deepEqual(C['reverse-lunge-knee-drive'].prescription,{type:'unilateral-reps',value:10});
  assert.equal(C['fast-feet'].mainRole,'supporting','Batch 3 fast-feet semantics are untouched');
  assert.equal(F.getMembership(context('footwork'),'fast-feet'),null);
});

test('membership grants exactly the approved roles with movement room, and is registered once',()=>{
  for(const role of ROLES){
    const expected=ALL.filter(id=>ROLE_TABLE[id].includes(role)).sort();
    // Skater jumps are high impact: they need an explicit Hard opt-in, never the default exclusion.
    assert.deepEqual(eligible(role,'hard',HARD).sort(),expected,role);
    assert.deepEqual(eligible(role,'normal',ROOM).sort(),expected.filter(id=>id!=='skater-jumps'),role+' default impact');
  }
  for(const id of ALL)for(const role of ROLES)
    assert.equal(!!F.getMembership(context(role),id),ROLE_TABLE[id].includes(role),id+':'+role);
  assert.equal(F.getMembership(context('control'),'plank'),null);
  assert.throws(()=>F.registerMembershipPolicy({workoutFamilyId:FAMILY,entries:[]}),/only once/);
  assert.ok(Object.isFrozen(F.getMembership(context('control'),'single-leg-balance-reach')));
  for(const role of ROLES)for(const id of DEFERRED)assert.equal(F.getMembership(context(role),id),null);
});

test('ordinary cramped space keeps low-impact bodyweight options and never assumes travelling drills are safe',()=>{
  for(const role of ROLES){
    const cramped=eligible(role,'normal'),expected=ALL.filter(id=>ROLE_TABLE[id].includes(role)&&!NEEDS_ROOM.includes(id)&&id!=='skater-jumps');
    assert.deepEqual(cramped.sort(),expected.sort(),role);
    assert.ok(cramped.length>=1,role+' remains feasible without movement room');
    for(const id of NEEDS_ROOM)assert.equal(cramped.includes(id),false,id+':'+role);
  }
  for(const id of ALL.filter(id=>!NEEDS_ROOM.includes(id)))assert.ok(C[id].impact!=='high',id);
  assert.equal(F.getMembership(context('footwork'),'lateral-shuffle').requiresMovementRoom,true);
  assert.equal(F.getMembership(context('control'),'single-leg-balance-reach').requiresMovementRoom,undefined);
  // Explicit confirmation of room alone does not lift the default high-impact exclusion.
  assert.equal(eligible('integrated','hard',ROOM).includes('skater-jumps'),false);
  assert.equal(eligible('integrated','hard',HARD).includes('skater-jumps'),true);
  assert.equal(eligible('integrated','normal',HARD).includes('skater-jumps'),true,'canonical hard difficulty is not excluded outside Easy');
  assert.equal(eligible('integrated','easy',HARD).includes('skater-jumps'),false,'Easy excludes hard drills');
  assert.equal(eligible('integrated','hard',{excludedImpact:['medium'],movementRoom:true}).includes('lateral-shuffle'),false);
  const lowOnly=eligible('footwork','hard',{excludedImpact:['medium','high'],movementRoom:true});
  assert.ok(lowOnly.includes('grapevine-cross-steps')&&!lowOnly.includes('lateral-shuffle'));
  const standing=eligible('control','normal',{bodyPositions:['standing']});
  assert.ok(standing.includes('single-leg-balance-reach')&&!eligible('control','normal',{bodyPositions:['standing'],movementRoom:true}).includes('bear-crawl'));
});

test('every approved drill is reachable in its roles and validates, plays and estimates through shared Main code',()=>{
  for(const id of ALL){
    for(const role of ROLE_TABLE[id])for(const difficulty of ['normal','hard']){
      const extra=C[id].impact==='high'?HARD:ROOM;
      assert.equal(G.generatedPhaseEligible(C[id],'main',[],difficulty,context(role,extra)),true,id+':'+role+':'+difficulty);
      assert.equal(G.protocolCompatible(C[id],'rounds',context(role)),true,id);
      const b=block([id],role,'rounds',context(role,extra));
      assert.deepEqual(G.validateMain({blocks:[b]},C,[]),[],id+':'+role);
      assert.equal(G.resolveBlockSteps(b).filter(step=>step.kind==='exercise').length,1,id);
      assert.equal(G.estimateBlockDuration(b),C[id].estimatedSeconds,id);
      const sided=C[id].unilateral,type=sided?'unilateral-timed':'timed';
      const timed={...b,occurrenceTargets:[{plannedPrescription:{type,value:20}}]};
      assert.deepEqual(G.validateMain({blocks:[timed]},C,[]),[],id);
      assert.equal(G.resolveBlockSteps(timed)[0].estimatedSeconds,sided?40:20,id);
    }
    for(const role of ROLES.filter(item=>!ROLE_TABLE[id].includes(item)))
      assert.equal(G.generatedPhaseEligible(C[id],'main',[],'hard',context(role,HARD)),false,id+':'+role);
    // Without movement room, travelling drills are not authorised in any role.
    if(NEEDS_ROOM.includes(id))assert.ok(G.validateMain({blocks:[block([id],ROLE_TABLE[id][0],'rounds',context(ROLE_TABLE[id][0]))]},C,[])
      .some(issue=>issue.includes('family:ineligible')),id);
  }
  for(const role of ROLES){
    const ids=ALL.filter(id=>ROLE_TABLE[id].includes(role)&&id!=='skater-jumps');
    const b=block(ids,role);
    assert.deepEqual(G.validateMain({blocks:[b]},C,[]),[],role);
    const w=savedWorkoutV2(C);w.main.blocks=[b];G.normaliseWorkout(w);
    assert.equal(w.main.blocks[0].estimatedDurationSeconds,G.estimateBlockDuration(b),role);
  }
  for(const id of ALL){
    const continuous=C[id].sidedness!=='per-side'&&(C[id].main?C[id].mainProtocols.includes('timed_intervals'):C[id].prescription.type.includes('timed'));
    assert.equal(G.protocolCompatible(C[id],'timed_intervals',context(ROLE_TABLE[id][0])),continuous,id);
    assert.equal(G.protocolCompatible(C[id],'paired_sets',context(ROLE_TABLE[id][0])),false,id+' is never a superset member');
  }
});

test('contextual drill timing stays inside reviewed bounds and keeps canonical defaults',()=>{
  const withTarget=(id,role,type,value,extra=ROOM)=>({...block([id],role,'rounds',context(role,extra)),occurrenceTargets:[{plannedPrescription:{type,value}}]});
  const valid=(id,role,type,value,extra)=>G.validateMain({blocks:[withTarget(id,role,type,value,extra)]},C,[]);
  assert.deepEqual(valid('lateral-shuffle','footwork','timed',40),[]);
  assert.deepEqual(valid('single-leg-balance-reach','control','unilateral-timed',30),[]);
  assert.deepEqual(valid('alternating-lateral-lunge','integrated','reps',6),[]);
  assert.deepEqual(valid('reverse-lunge-knee-drive','control','unilateral-reps',10),[]);
  assert.deepEqual(valid('skater-jumps','integrated','timed',20,HARD),[]);
  for(const [id,role,type,value,extra] of [['lateral-shuffle','footwork','timed',41],['lateral-shuffle','footwork','reps',8],
    ['single-leg-balance-reach','control','unilateral-timed',31],['single-leg-balance-reach','control','timed',20],
    ['skater-jumps','integrated','timed',31,HARD],['skater-jumps','integrated','reps',10,HARD],['bear-crawl','control','timed',41],
    ['alternating-lateral-lunge','integrated','reps',13],['reverse-lunge-knee-drive','control','unilateral-reps',11],
    ['grapevine-cross-steps','footwork','timed',9]])
    assert.ok(valid(id,role,type,value,extra).length,id+':'+type+':'+value);
  assert.equal(G.resolveBlockSteps(withTarget('alternating-lateral-lunge','integrated','timed',30))[0].estimatedSeconds,30);
  assert.equal(G.estimateBlockDuration(withTarget('single-leg-balance-reach','control','unilateral-timed',25)),50);
});

test('ordinary Generator, warm-up and Main eligibility and no-family output are unchanged',()=>{
  for(const id of NEW)for(const phase of ['main','warmup','rampup','cooldown'])
    assert.equal(G.generatedPhaseEligible(C[id],phase,['trx','dumbbells','bands','bench','box']),false,id+':'+phase);
  for(const id of ['bear-crawl','skater-jumps','reverse-lunge-knee-drive','alternating-lateral-lunge'])
    assert.equal(G.generatedPhaseEligible(C[id],'main',[]),true,id);
  assert.equal(G.generatedPhaseEligible(C['knee-to-opposite-elbow'],'main',[]),false);
  assert.equal(G.generatedPhaseEligible(C['knee-to-opposite-elbow'],'warmup',[]),true);
  let seed=31,draws=0;
  const w=G.generate({duration:10,focus:'strength',bodyFocus:'upper',difficulty:'easy',equipment:[],catalogue:C,
    random:()=>{draws++;seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}});delete w.id;
  assert.equal(draws,68);
  assert.equal(createHash('sha256').update(JSON.stringify(w)).digest('hex'),'931adac57e2aebebcce46059fd27536c0620fc2edfbec2f1ac00cc2c5b3fceb7');
  const ids=new Set();
  for(let i=0;i<60;i++){
    let s=i+1;const workout=G.generate({duration:[10,20,30,45][i%4],equipment:['trx','dumbbells'],catalogue:C,random:()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;}});
    for(const section of [workout.warmup,workout.rampup,workout.cooldown,...workout.main.blocks])
      for(const exercise of section.exercises||[])ids.add(exercise.id);
  }
  assert.deepEqual(NEW.filter(id=>ids.has(id)),[]);
});
