const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
const audit=require('../scripts/audit-exercise-reachability.js');

const G=GarageFitGenerator;
const ex=(id,fields)=>Object.assign({id,equipment:[]},fields);
const isEligible=(exercise,phase)=>phase==='main'?!!(exercise.generator&&exercise.main):!!exercise[phase];

// Synthetic catalogue: `always` and `dominant` are picked every time, `rare` once in 40 workouts,
// `never` is eligible but never picked; `fixed` (Main but not generator) and `plain` (no phase
// flags) are not generated-phase exercises at all.
const catalogue={
  always:ex('always',{generator:true,main:true}),
  dominant:ex('dominant',{generator:true,main:true}),
  rare:ex('rare',{generator:true,main:true}),
  never:ex('never',{generator:true,main:true}),
  filler1:ex('filler1',{generator:true,main:true}),
  filler2:ex('filler2',{generator:true,main:true}),
  filler3:ex('filler3',{generator:true,main:true}),
  filler4:ex('filler4',{generator:true,main:true}),
  filler5:ex('filler5',{generator:true,main:true}),
  filler6:ex('filler6',{generator:true,main:true}),
  filler7:ex('filler7',{generator:true,main:true}),
  filler8:ex('filler8',{generator:true,main:true}),
  fixed:ex('fixed',{main:true}),
  plain:ex('plain',{}),
  stretch:ex('stretch',{cooldown:true})
};
function fakeGenerate({random}){
  const roll=random();
  const main=['always','dominant'];
  if(roll<1/40)main.push('rare');
  else main.push('filler'+(1+Math.floor(roll*8)%8));
  return {main:{blocks:[{exercises:main.map(id=>({id}))}]},warmup:{exercises:[]},rampup:{exercises:[]},cooldown:{exercises:[{id:'stretch'}]}};
}
function syntheticAudit(){
  return audit.runAudit({catalogue,generate:fakeGenerate,isEligible,durations:[20],focuses:['balanced'],configs:[{key:'bodyweight',equipment:[]}],seeds:80});
}
const ids=list=>list.map(item=>item.phase+':'+item.id).sort();

test('an eligible exercise that appears is counted and is not a failure',()=>{
  const result=syntheticAudit();
  const always=result.phases.main.find(entry=>entry.id==='always');
  assert.equal(always.appearances,80);
  assert.equal(always.workouts,80);
  assert.equal(always.contexts['bodyweight|balanced|20'].appearances,80);
  assert.ok(!ids(result.failures).includes('main:always'));
  assert.equal(result.phases.cooldown.find(entry=>entry.id==='stretch').appearances,80);
});

test('an eligible exercise with zero appearances is a failure and fails the report',()=>{
  const result=syntheticAudit();
  assert.deepEqual(ids(result.failures),['main:never']);
  assert.match(audit.formatReport(result),/RESULT: FAIL \(1 unreachable\)/);
});

test('fixed-only and phase-less entries are never audited or reported as failures',()=>{
  const result=syntheticAudit();
  const audited=Object.values(result.phases).flat().map(entry=>entry.id);
  assert.ok(!audited.includes('fixed')&&!audited.includes('plain'));
  assert.ok(!result.failures.some(item=>item.id==='fixed'||item.id==='plain'));
  assert.deepEqual(result.excluded,[]);
});

test('a flagged exercise that its phase rules exclude is reported for information, not as a failure',()=>{
  // Star jumps carry the warmup flag, but the generator never puts high-impact work in Warm-up.
  assert.equal(G.generatedPhaseEligible(GarageFitData.exercises['star-jumps'],'warmup',[]),false);
  const small={'star-jumps':GarageFitData.exercises['star-jumps']};
  const result=audit.runAudit({catalogue:small,generate:fakeGenerate,isEligible:G.generatedPhaseEligible,durations:[20],focuses:['balanced'],configs:[{key:'bodyweight',equipment:[]}],seeds:2});
  // (It is still eligible for Main and Ramp-up, which this fake generator never fills.)
  assert.ok(!ids(result.failures).includes('warmup:star-jumps'));
  assert.ok(!result.phases.warmup.length);
  assert.deepEqual(ids(result.excluded),['warmup:star-jumps']);
});

test('rare and dominant exercises are warnings, not failures',()=>{
  const result=syntheticAudit();
  assert.ok(ids(result.rare).includes('main:rare'),JSON.stringify(result.rare));
  assert.ok(ids(result.dominant).includes('main:dominant'),JSON.stringify(result.dominant));
  assert.equal(result.dominant.find(item=>item.id==='dominant').equipment,'bodyweight');
  assert.ok(!result.failures.some(item=>item.id==='rare'||item.id==='dominant'));
  const passing=Object.assign({},result,{failures:[]});
  assert.match(audit.formatReport(passing),/RESULT: PASS/);
});

test('representative configurations cover bodyweight, each requirement set and all equipment',()=>{
  const configs=audit.representativeConfigs(GarageFitData.exercises,GarageFitData.equipment.map(item=>item.id));
  const keys=configs.map(config=>config.key);
  assert.equal(keys[0],'bodyweight');
  assert.deepEqual(configs[0].equipment,[]);
  for(const key of ['kettlebell','trx','pullup-bar','bands','all-equipment'])assert.ok(keys.includes(key),key);
  assert.equal(new Set(keys).size,keys.length);
  for(const exercise of Object.values(GarageFitData.exercises))
    assert.ok(configs.some(config=>G.requirementsMet(exercise,config.equipment)),exercise.id);
});

test('the audit is deterministic for a fixed sample configuration with the real generator',()=>{
  const options={catalogue:GarageFitData.exercises,generate:G.generate,isEligible:G.generatedPhaseEligible,
    durations:[15],focuses:['strength'],configs:[{key:'kettlebell',equipment:['kettlebell']}],seeds:3};
  const first=audit.runAudit(options), second=audit.runAudit(options);
  assert.equal(first.workouts,3);
  assert.deepEqual(first,second);
  assert.ok(first.phases.main.some(entry=>entry.appearances>0));
  assert.equal(audit.workoutSeed(2,1,30,5),audit.workoutSeed(2,1,30,5));
  assert.notEqual(audit.workoutSeed(2,1,30,5),audit.workoutSeed(2,1,30,6));
});
