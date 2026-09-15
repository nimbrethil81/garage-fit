const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
const allEquipment = ['dumbbells','kettlebell','pullup-bar','trx','barbell','bench','box','bands'];
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function create(options={}) {
  return GarageFitGenerator.generate(Object.assign({
    catalogue,duration:30,focus:'balanced',equipment:allEquipment,random:random(42)
  },options));
}
function synthetic(id, pattern, equipment=[]) {
  return {
    id,name:id,equipment:equipment.length?[[equipment]]:[],patterns:[pattern],
    movementPlanes:['sagittal'],warmupAreas:[],bodyPosition:'standing',
    strength:4,cardio:2,prescription:{type:'reps',value:10},estimatedSeconds:30,
    impact:'low',load:null,generator:true,main:true,warmup:false,rampup:false,
    cooldown:false,sidedness:'bilateral',unilateral:false,
    mainProtocols:['rounds','paired_sets']
  };
}

test('generated Main uses the versioned block model while retaining the temporary blocks alias',()=>{
  const workout=create();
  assert.equal(workout.schemaVersion,2);
  assert.ok(Array.isArray(workout.main.blocks));
  assert.ok(workout.main.blocks.length>=1);
  assert.equal(workout.blocks,workout.main.blocks);
  for(const block of workout.main.blocks){
    assert.ok(['rounds','paired_sets','timed_intervals'].includes(block.protocol));
    assert.ok(['strength','conditioning','accessory','finisher'].includes(block.intent));
    assert.ok(block.estimatedDurationSeconds>0);
    assert.equal(block.estimatedDurationSeconds,GarageFitGenerator.estimateBlockDuration(block));
  }
});

test('catalogue opts exercises into timed intervals explicitly',()=>{
  assert.ok(catalogue['mountain-climbers'].mainProtocols.includes('timed_intervals'));
  assert.equal(catalogue['barbell-deadlift'].mainProtocols.includes('timed_intervals'),false);
  assert.equal(GarageFitGenerator.protocolCompatible(catalogue['mountain-climbers'],'timed_intervals'),true);
  assert.equal(GarageFitGenerator.protocolCompatible(catalogue['barbell-deadlift'],'timed_intervals'),false);
});

test('legacy top-level and flat Main structures migrate to a rounds block',()=>{
  const exercise=catalogue['air-squat'];
  const topLevel={focus:'strength',blocks:[{id:'main',rounds:2,rest:{exercise:10,round:30},exercises:[exercise]}]};
  GarageFitGenerator.normaliseWorkout(topLevel);
  assert.equal(topLevel.main.blocks[0].protocol,'rounds');
  assert.deepEqual(topLevel.main.blocks[0].prescription,{rounds:2,exerciseRestSeconds:10,roundRestSeconds:30});

  const flat={focus:'cardio',main:{exercises:[exercise],rounds:3,rest:{exercise:5,round:20}}};
  GarageFitGenerator.normaliseWorkout(flat);
  assert.equal(flat.main.blocks[0].intent,'conditioning');
  assert.equal(flat.main.blocks[0].prescription.rounds,3);
});

test('malformed protocol prescriptions fail cleanly',()=>{
  const exercise=catalogue['air-squat'];
  const invalid=[
    {id:'r',protocol:'rounds',intent:'strength',exercises:[exercise],prescription:{rounds:0}},
    {id:'p',protocol:'paired_sets',intent:'strength',exercises:[exercise],prescription:{sets:3}},
    {id:'t',protocol:'timed_intervals',intent:'conditioning',exercises:[exercise],prescription:{cycles:2,workSeconds:0,transitionSeconds:10}},
    {id:'x',protocol:'ladder',intent:'strength',exercises:[exercise],prescription:{}}
  ];
  for(const block of invalid)assert.ok(GarageFitGenerator.validateMain({blocks:[block]},catalogue,allEquipment).length>0,block.id);
});

test('rounds playback resolves exercise order, rests and completion exactly',()=>{
  const block={protocol:'rounds',exercises:[catalogue['air-squat'],catalogue['push-up']],prescription:{rounds:2,exerciseRestSeconds:10,roundRestSeconds:30}};
  const steps=GarageFitGenerator.resolveBlockSteps(block);
  assert.deepEqual(steps.filter(step=>step.kind==='exercise').map(step=>[step.exerciseIndex,step.round]),[[0,1],[1,1],[0,2],[1,2]]);
  assert.deepEqual(steps.filter(step=>step.kind!=='exercise').map(step=>[step.kind,step.seconds]),[['rest',10],['round-rest',30],['rest',10]]);
  assert.equal(steps.at(-1).kind,'exercise');
});

test('paired sets playback alternates A/B and rests between completed sets',()=>{
  const block={protocol:'paired_sets',exercises:[catalogue['goblet-squat'],catalogue['trx-row']],prescription:{sets:3,betweenExercisesSeconds:0,betweenSetsSeconds:60}};
  const steps=GarageFitGenerator.resolveBlockSteps(block);
  assert.deepEqual(steps.filter(step=>step.kind==='exercise').map(step=>[step.exerciseIndex,step.set]),[[0,1],[1,1],[0,2],[1,2],[0,3],[1,3]]);
  assert.deepEqual(steps.filter(step=>step.kind==='set-rest').map(step=>step.seconds),[60,60]);
  assert.equal(steps.at(-1).kind,'exercise');
});

test('timed intervals resolve first-class work and transition durations',()=>{
  const block={protocol:'timed_intervals',exercises:[catalogue['mountain-climbers'],catalogue['jumping-jacks']],prescription:{workSeconds:40,transitionSeconds:20,cycles:2}};
  const steps=GarageFitGenerator.resolveBlockSteps(block);
  assert.deepEqual(steps.filter(step=>step.kind==='exercise').map(step=>[step.exerciseIndex,step.cycle,step.seconds]),[[0,1,40],[1,1,40],[0,2,40],[1,2,40]]);
  assert.deepEqual(steps.filter(step=>step.kind==='interval-rest').map(step=>step.seconds),[20,20,20]);
  assert.equal(GarageFitGenerator.estimateBlockDuration(block),220);
});

test('duration influences block composition without imposing a rigid count',()=>{
  let shortSingles=0,longMultiples=0,twentySingles=0,twentyMultiples=0;
  for(let seed=1;seed<=60;seed++){
    if(create({duration:15,random:random(seed)}).main.blocks.length===1)shortSingles++;
    if(create({duration:45,random:random(seed)}).main.blocks.length>1)longMultiples++;
    const count=create({duration:20,random:random(seed)}).main.blocks.length;
    if(count===1)twentySingles++;else if(count===2)twentyMultiples++;
  }
  assert.ok(shortSingles>0,shortSingles+' short singles');
  assert.equal(longMultiples,60);
  assert.ok(twentyMultiples>twentySingles,twentySingles+'/'+twentyMultiples);
});

test('all three protocols can be generated and multiple protocols can coexist',()=>{
  const protocols=new Set();let mixed=false,sameProtocolMulti=false;
  for(const focus of ['strength','balanced','cardio'])for(let seed=1;seed<=80;seed++){
    const blocks=create({focus,random:random(seed)}).main.blocks;
    blocks.forEach(block=>protocols.add(block.protocol));
    if(new Set(blocks.map(block=>block.protocol)).size>1)mixed=true;
    if(blocks.length>1&&new Set(blocks.map(block=>block.protocol)).size===1)sameProtocolMulti=true;
  }
  assert.deepEqual(protocols,new Set(['rounds','paired_sets','timed_intervals']));
  assert.equal(mixed,true);
  assert.equal(sameProtocolMulti,true);
});

test('Block boundary is not a constraint reset',()=>{
  const major=new Set(['squat','hinge','push','pull','lunge','carry']);
  for(let seed=1;seed<=100;seed++){
    const blocks=create({random:random(seed)}).main.blocks,ids=blocks.flatMap(block=>block.exercises.map(ex=>ex.id));
    assert.equal(new Set(ids).size,ids.length,ids.join(', '));
    for(let index=1;index<blocks.length;index++){
      const before=blocks[index-1].exercises.at(-1),after=blocks[index].exercises[0];
      assert.equal(after.patterns.some(pattern=>major.has(pattern)&&before.patterns.includes(pattern)),false,before.id+' > '+after.id);
      assert.equal(before.impact==='high'&&after.impact==='high',false,before.id+' > '+after.id);
    }
  }
});

test('whole-Main exact reuse is strongly suppressed but remains selectable when required',()=>{
  const used=synthetic('used','squat'),fresh=synthetic('fresh','pull');
  const state={exercises:[used],usedIds:new Set(['used']),blocks:[],owned:[]};
  const preferred=GarageFitGenerator.selectBlockExercises([used,fresh],1,'strength','strength','rounds',state,[],()=>0,{used,fresh});
  assert.equal(preferred[0].id,'fresh');
  const constrained=GarageFitGenerator.selectBlockExercises([used],1,'strength','strength','rounds',state,[],()=>0,{used});
  assert.equal(constrained[0].id,'used');
});

test('movement, local-fatigue and equipment flow scoring see the previous block',()=>{
  const prior=synthetic('prior','push','dumbbells');
  const repeated=synthetic('repeated','push','dumbbells');
  const sameSetup=synthetic('same-setup','pull','dumbbells');
  const extraSetup=synthetic('extra-setup','pull','kettlebell');
  const state={exercises:[prior],usedIds:new Set(['prior']),blocks:[],owned:['dumbbells','kettlebell']};
  const picked=GarageFitGenerator.selectBlockExercises([repeated,sameSetup,extraSetup],1,'strength','strength','rounds',state,[],()=>0,{prior,repeated,'same-setup':sameSetup,'extra-setup':extraSetup});
  assert.equal(picked[0].id,'same-setup');
});

test('recent-workout suppression operates across all blocks without becoming a blacklist',()=>{
  const recent=['air-squat','push-up','plank','mountain-climbers','goblet-squat','trx-row'];
  let baseline=0,suppressed=0;
  for(let seed=1;seed<=80;seed++){
    const without=create({random:random(seed)}).main.blocks.flatMap(block=>block.exercises.map(ex=>ex.id));
    const withHistory=create({history:[recent],random:random(seed)}).main.blocks.flatMap(block=>block.exercises.map(ex=>ex.id));
    baseline+=without.filter(id=>recent.includes(id)).length;
    suppressed+=withHistory.filter(id=>recent.includes(id)).length;
  }
  assert.ok(suppressed<baseline,baseline+' > '+suppressed);
  const constrainedCatalogue=Object.fromEntries(recent.slice(0,3).map((id,index)=>[id,synthetic(id,['squat','hinge','push'][index])]));
  const workout=GarageFitGenerator.generate({catalogue:constrainedCatalogue,duration:10,focus:'strength',equipment:[],history:[recent.slice(0,3)],random:random(17)});
  assert.deepEqual(new Set(workout.main.blocks.flatMap(block=>block.exercises.map(ex=>ex.id))),new Set(recent.slice(0,3)));
});

test('representative durations stay within tolerance without excessive repeat counts',()=>{
  for(const duration of [10,15,20,30,45])for(const focus of ['strength','balanced','cardio'])for(let seed=1;seed<=20;seed++){
    const workout=create({duration,focus,random:random(seed)}),minutes=workout.estimatedSeconds/60;
    assert.ok(Math.abs(minutes-duration)<=Math.max(3,duration*.18),duration+' '+focus+' '+minutes);
    for(const block of workout.main.blocks){
      assert.ok(block.estimatedDurationSeconds>=120);
      const repeats=block.prescription.rounds||block.prescription.sets||block.prescription.cycles;
      assert.ok(repeats<=5,block.protocol+' '+repeats);
    }
  }
});

test('focus preferences dominate the modest protocol-variety bonus',()=>{
  const eligible=Object.values(catalogue).filter(ex=>ex.generator&&ex.main&&GarageFitGenerator.requirementsMet(ex,allEquipment));
  const state={blocks:[{protocol:'paired_sets'}],exercises:[],usedIds:new Set(),owned:allEquipment};
  const weights=Object.fromEntries(GarageFitGenerator.protocolWeights('strength','strength',600,eligible,state).map(item=>[item.value,item.weight]));
  assert.ok(weights.paired_sets>weights.timed_intervals,JSON.stringify(weights));

  const totals={strength:{paired_sets:0,timed_intervals:0},cardio:{paired_sets:0,timed_intervals:0}};
  for(const focus of ['strength','cardio'])for(let seed=1;seed<=60;seed++)for(const block of create({focus,random:random(seed)}).main.blocks)totals[focus][block.protocol]++;
  assert.ok(totals.strength.paired_sets>totals.strength.timed_intervals,JSON.stringify(totals));
  assert.ok(totals.cardio.timed_intervals>totals.cardio.paired_sets,JSON.stringify(totals));
});

test('20-minute Cardio avoids five-pass tiny loops when the exercise pool is broad',()=>{
  for(let seed=1;seed<=100;seed++){
    const blocks=create({duration:20,focus:'cardio',random:random(seed)}).main.blocks;
    for(const block of blocks){
      const repeats=block.prescription.rounds||block.prescription.cycles||block.prescription.sets;
      const isTinyLoop=block.protocol!=='paired_sets'&&block.exercises.length<=3&&repeats>=5;
      assert.equal(isTinyLoop,false,seed+': '+block.protocol+' '+block.exercises.length+'x'+repeats);
    }
  }
});

test('small repeated blocks carry a duration-aware quality penalty',()=>{
  const exercises=[synthetic('one','squat'),synthetic('two','push'),synthetic('three','pull')];
  assert.equal(GarageFitGenerator.preferredRepeatCount('rounds',exercises.length),3);
  assert.equal(GarageFitGenerator.repetitionPenalty('rounds',exercises,3,false),0);
  assert.ok(GarageFitGenerator.repetitionPenalty('rounds',exercises,5,false)>250);
  assert.equal(GarageFitGenerator.repetitionPenalty('rounds',exercises,5,true),0);
});

test('remaining Main time can create another block instead of extending a tiny first block',()=>{
  const workout=create({duration:20,focus:'cardio',random:random(12)});
  assert.equal(workout.main.blocks.length,2);
  assert.ok(workout.main.blocks.every(block=>{
    const repeats=block.prescription.rounds||block.prescription.cycles||block.prescription.sets;
    return block.exercises.length>3||repeats<=3||block.protocol==='paired_sets';
  }));
});

test('a constrained Main pool remains playable and may use extended repetition',()=>{
  const constrainedCatalogue={
    one:synthetic('one','squat'),
    two:synthetic('two','push'),
    three:synthetic('three','pull')
  };
  const workout=GarageFitGenerator.generate({catalogue:constrainedCatalogue,duration:20,focus:'cardio',equipment:[],random:random(9)});
  assert.equal(workout.main.blocks.length,1);
  assert.deepEqual(new Set(workout.main.blocks[0].exercises.map(exercise=>exercise.id)),new Set(['one','two','three']));
  assert.equal(GarageFitGenerator.validateMain(workout.main,constrainedCatalogue,[],GarageFitGenerator.BUDGETS[20].main).filter(issue=>issue!=='main:duration-out-of-tolerance').length,0);
});

test('supporting conditioning movements remain selectable but are penalised when repeatedly prominent',()=>{
  const jumping=catalogue['jumping-jacks'];
  assert.equal(jumping.mainRole,'supporting');
  const state={exercises:[],usedIds:new Set(),blocks:[],owned:[]};
  assert.equal(GarageFitGenerator.selectBlockExercises([jumping],1,'cardio','conditioning','timed_intervals',state,[],()=>0,catalogue)[0].id,'jumping-jacks');

  const peers=[synthetic('one','squat'),synthetic('two','push')];
  const supportingBlock={protocol:'timed_intervals',exercises:peers.concat(jumping),prescription:{cycles:5,workSeconds:30,transitionSeconds:15}};
  const primaryBlock={protocol:'timed_intervals',exercises:peers.concat(Object.assign({},jumping,{mainRole:'primary'})),prescription:{cycles:5,workSeconds:30,transitionSeconds:15}};
  assert.ok(GarageFitGenerator.mainQualityPenalty([supportingBlock],870,20)>GarageFitGenerator.mainQualityPenalty([primaryBlock],870,20));

  for(let seed=1;seed<=80;seed++)for(const block of create({duration:20,focus:'cardio',random:random(seed)}).main.blocks){
    if(!block.exercises.some(exercise=>exercise.id==='jumping-jacks'))continue;
    const repeats=block.prescription.rounds||block.prescription.cycles||block.prescription.sets;
    assert.ok(repeats<=3||block.protocol==='paired_sets',seed+': jumping-jacks x'+repeats);
  }
});
