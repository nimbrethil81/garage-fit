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
// Approved A1-A13 treatment (v1): A9 and A13 were deferred and v1 membership never authorises them;
// membership v2 (#255) authorises them for composition v4.
const NEW=['lateral-shuffle','single-leg-balance-reach','forward-back-line-steps','quarter-turn-pivot-steps','lateral-step-and-stick','grapevine-cross-steps'];
const ADAPTED=['bear-crawl'];
const REUSED=['skater-jumps','reverse-lunge-knee-drive','alternating-lateral-lunge','knee-to-opposite-elbow'];
const ALL=[...NEW,...ADAPTED,...REUSED];
const ROLE_TABLE={'lateral-shuffle':['footwork','integrated'],'skater-jumps':['integrated'],'single-leg-balance-reach':['control'],
  'bear-crawl':['control','integrated'],'forward-back-line-steps':['footwork','control'],'reverse-lunge-knee-drive':['control','integrated'],
  'quarter-turn-pivot-steps':['footwork','control'],'lateral-step-and-stick':['footwork','control'],
  'alternating-lateral-lunge':['integrated'],'grapevine-cross-steps':['footwork','integrated'],'knee-to-opposite-elbow':['control']};
const NEEDS_ROOM=['lateral-shuffle','skater-jumps','bear-crawl','grapevine-cross-steps'];
const DEFERRED=['forward-back-acceleration-and-stop','forward-hop-and-stick'];
const V1ROLE=context('integrated');
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
  // The catalogue now defines A9/A13 (#255) but published v1 membership still never authorises them.
  for(const id of DEFERRED){assert.ok(C[id],id);for(const role of ROLES)assert.equal(F.getMembership(context(role),id),null,id+' is not in v1');}
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

// ---- #255: eleven further identities and three shared existing ones --------------------------------
const ADDED=['in-in-out-out-steps','lateral-line-steps','split-stance-step-switches','clock-step-balance','single-leg-hip-hinge-reach',
  'lateral-lunge-to-balance','180-degree-step-turns','lateral-shuffle-and-stop','forward-back-acceleration-and-stop','forward-hop-and-stick','lateral-bound-and-stick'];
const SHARED_FLAGGED=['in-in-out-out-steps','single-leg-hip-hinge-reach','lateral-lunge-to-balance'];
const V4=(role,extra={})=>({workoutFamilyId:FAMILY,workoutFamilyVersion:4,role,...extra});
test('#255 catalogue: eleven distinct canonical definitions, three shared Main flags, unchanged reused identities',()=>{
  assert.deepEqual(G.validateCatalogue(C),[]);
  assert.equal(new Set(ADDED).size,11);
  const names=Object.values(C).map(ex=>ex.name.toLowerCase());assert.equal(new Set(names).size,names.length,'no duplicate display names');
  for(const id of ADDED){
    const ex=C[id];assert.ok(ex,id);assert.deepEqual(ex.equipment,[],id);assert.equal(ex.load,null,id);
    assert.ok(ex.instruction.length<=180&&ex.instruction.split(/(?<=\.)\s+/).length===1,id);
    assert.equal(ex.prescription.type.startsWith('unilateral'),ex.sidedness==='per-side',id);
    assert.equal(ex.warmup||ex.rampup||ex.cooldown,false,id);
    // Only the three shared drills carry Main flags; the rest are authorised solely by Athletic membership v2.
    assert.equal(!!(ex.generator&&ex.main),SHARED_FLAGGED.includes(id),id);
    assert.ok(F.getMembership(V4('footwork'),id)||F.getMembership(V4('control'),id)||F.getMembership(V4('integrated'),id),id+' has a role');
  }
  // Landings are high impact and brief by default; every other addition is low or medium impact.
  assert.deepEqual(ADDED.filter(id=>C[id].impact==='high').sort(),['forward-hop-and-stick','lateral-bound-and-stick']);
  assert.equal(C['forward-hop-and-stick'].sidedness,'per-side');assert.equal(C['lateral-bound-and-stick'].sidedness,'alternating');
  assert.ok(C['forward-hop-and-stick'].prescription.value<=15&&C['lateral-bound-and-stick'].prescription.value<=15);
  // Distinctions the issue asks to preserve: stepping switch vs plyometric switch kick; clock-step vs reach; bound vs skater jump.
  assert.equal(C['split-stance-step-switches'].impact,'low');assert.equal(C['switch-kicks'].impact,'high');
  assert.deepEqual(C['clock-step-balance'].movementPlanes.slice().sort(),['frontal','sagittal','transverse']);
  assert.deepEqual(C['single-leg-balance-reach'].movementPlanes.slice().sort(),['sagittal','transverse']);
  assert.deepEqual(C['single-leg-hip-hinge-reach'].patterns,['hinge']);assert.deepEqual(C['single-leg-balance-reach'].patterns,[]);
  // The three reused identities keep their single canonical entries and flags.
  const flags=id=>['generator','main','warmup','rampup','cooldown'].filter(key=>C[id][key]);
  assert.deepEqual(flags('fast-feet'),['generator','main']);
  assert.deepEqual(flags('side-step-touches'),['warmup']);
  assert.deepEqual(flags('cossack-squat'),['generator','main','rampup']);
  // Shared with the global flags, the new Strength/Conditioning-suitable drills have the intrinsic descriptors their roles need.
  assert.deepEqual([C['single-leg-hip-hinge-reach'].difficulty,C['lateral-lunge-to-balance'].difficulty,C['in-in-out-out-steps'].difficulty],['moderate','moderate','easy']);
});

test('#255 membership v2 table: roles, room, impact, minimum difficulty; v1 untouched',()=>{
  const table={'in-in-out-out-steps':[['footwork'],false,undefined],'lateral-line-steps':[['footwork'],false,undefined],
    'split-stance-step-switches':[['footwork','control'],false,undefined],'clock-step-balance':[['control'],false,undefined],
    'single-leg-hip-hinge-reach':[['control'],false,'normal'],'lateral-lunge-to-balance':[['control','integrated'],false,'normal'],
    '180-degree-step-turns':[['footwork'],false,'normal'],'lateral-shuffle-and-stop':[['footwork','integrated'],true,'normal'],
    'forward-back-acceleration-and-stop':[['footwork','integrated'],true,'normal'],'forward-hop-and-stick':[['integrated'],true,'hard'],
    'lateral-bound-and-stick':[['integrated'],true,'hard'],'fast-feet':[['footwork'],false,undefined],'side-step-touches':[['control'],false,undefined],
    'cossack-squat':[['integrated'],false,undefined]};
  for(const [id,[roles,room,minimum]] of Object.entries(table)) {
    assert.deepEqual(ROLES.filter(role=>F.getMembership(V4(role),id)),roles,id);
    for(const role of roles){const entry=F.getMembership(V4(role),id);assert.equal(entry.requiresMovementRoom,room||undefined,id);assert.equal(entry.minimumDifficulty,minimum,id);
      assert.deepEqual(entry.protocols,['rounds','timed_intervals'],id);}
  }
  // v2 contains every v1 entry unchanged, and v1 knows none of the additions.
  for(const id of ALL)for(const role of ROLES){const one=F.getMembership(context(role),id);if(one)assert.deepEqual(F.getMembership(V4(role),id),one,id+' '+role);}
  for(const id of Object.keys(table))for(const role of ROLES)assert.equal(F.getMembership(context(role),id),null,id);
  // Landing prescriptions are short and quality-led (unilateral where single-leg).
  assert.deepEqual(copy(F.getMembership(V4('integrated'),'forward-hop-and-stick').prescriptions),[{type:'unilateral-timed',minValue:10,maxValue:15}]);
  assert.deepEqual(copy(F.getMembership(V4('integrated'),'lateral-bound-and-stick').prescriptions),[{type:'timed',minValue:10,maxValue:15}]);
  assert.deepEqual(copy(F.getMembership(V1ROLE,'skater-jumps').prescriptions),[{type:'timed',minValue:10,maxValue:30}],'v1 jump bounds are as released');
});

test('#255 shared Main drills are reachable in the Generator by bounded deterministic seeds',()=>{
  const rng=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const reaches=(id,focus,duration,seed)=>G.generate({duration,focus,equipment:[],catalogue:C,random:rng(seed)}).main.blocks.some(b=>b.exercises.some(ex=>ex.id===id));
  assert.ok(reaches('single-leg-hip-hinge-reach','strength',10,14));
  assert.ok(reaches('lateral-lunge-to-balance','strength',20,13));
  assert.ok(reaches('in-in-out-out-steps','cardio',30,13));
  // Family-only identities are never offered by the ordinary Generator, even for generous kits.
  const kit=['dumbbells','kettlebell','pullup-bar','trx','barbell','bench','box','bands'];
  for(let seed=1;seed<=12;seed++)for(const focus of ['strength','balanced','cardio']) {
    const w=G.generate({duration:30,focus,equipment:kit,catalogue:C,random:rng(seed)});
    for(const ex of w.main.blocks.flatMap(b=>b.exercises))assert.ok(!ADDED.filter(id=>!SHARED_FLAGGED.includes(id)).includes(ex.id),ex.id);
  }
});
