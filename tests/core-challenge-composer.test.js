const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {loadAppContext}=require('./helpers/app-context');
global.window=global;
for(const path of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','js/strength-cardio-composer','js/core-challenge-composer'])require('../'+path);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises;
const CORE='core-stability',CHALLENGE='full-body-challenges';
const copy=x=>JSON.parse(JSON.stringify(x));
function rng(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const EQUIPMENT={bodyweight:[],limited:['dumbbells'],bands:['bands'],trx:['trx'],broad:['dumbbells','kettlebell','pullup-bar','trx','rings','barbell','bench','box','bands']};
const DURATIONS=[10,15,20,30,45],DIFFICULTIES=['easy','normal','hard'];
const generate=(workoutFamilyId,extra={})=>G.generate({workoutFamilyId,duration:20,difficulty:'normal',catalogue:C,equipment:[],random:rng(7),...extra});
const exercisesOf=w=>w.main.blocks.flatMap(b=>b.exercises);
const mean=(list,key)=>list.reduce((sum,ex)=>sum+ex[key],0)/list.length;
const timed=ex=>String(ex.prescription.type).includes('timed');
const isHold=ex=>ex.cardio<=2&&timed(ex)&&['none','per-side'].includes(ex.sidedness);

// Independent restatement of the documented balance rule: every body region is credited and none dominates.
function regionCredit(list) {
  const credit={upper:0,lower:0,core:0};
  for(const ex of list)for(const region of Object.keys(credit))credit[region]+=ex.bodyFocus===region?1:ex.bodyFocus==='full-body'?1/3:0;
  return credit;
}
const emomSeconds=(ex,target)=>Math.max(target.type==='timed'?target.value:0,Math.ceil(ex.estimatedSeconds*target.value/ex.prescription.value));
const WORK_CAP={easy:30,normal:35,hard:40};

// A displayed style must describe the resolved blocks, not merely label them.
const STRUCTURE={
  'controlled-stability':(blocks,w)=>blocks.every(b=>b.protocol==='rounds'&&b.exercises.length>=3&&b.prescription.rounds>=2&&b.prescription.rounds<=4
    &&b.prescription.exerciseRestSeconds>=15&&b.prescription.roundRestSeconds>=45),
  'dynamic-core':blocks=>blocks.every(b=>b.protocol==='paired_sets'&&b.exercises.length===2&&b.exercises.filter(isHold).length===1
    &&b.prescription.sets>=3&&b.prescription.betweenSetsSeconds>=30&&b.prescription.betweenExercisesSeconds===10),
  rounds:(blocks,w)=>blocks.length<=2&&blocks.every(b=>b.protocol==='rounds'&&b.exercises.length>=3&&b.prescription.rounds>=(w.duration>=20?4:3)
    &&b.prescription.exerciseRestSeconds>=10&&b.prescription.roundRestSeconds>=30)
    &&blocks.every(b=>b.exercises.every(ex=>ex.load!=='Heavy'&&ex.strength<5&&(ex.impact!=='high'||w.difficulty==='hard'))),
  emom:(blocks,w)=>blocks.every(b=>b.protocol==='emom'&&b.exercises.length>=2&&b.prescription.minutes>=4&&b.prescription.minutes<=b.exercises.length*4
    &&b.prescription.slotSeconds===60&&b.prescription.targets.every((target,i)=>emomSeconds(b.exercises[i],target)<=WORK_CAP[w.difficulty])),
  ladder:blocks=>blocks.every(b=>b.protocol==='ladder'&&b.exercises.length===2&&b.prescription.stepRestSeconds>=20&&b.prescription.repSteps.length>=3),
  pyramid:blocks=>blocks.length>=3&&blocks.every(b=>b.protocol==='pyramid'&&b.exercises.length===1&&b.prescription.stepRestSeconds>=60&&b.prescription.steps.length>=3),
  density:(blocks,w)=>w.difficulty!=='easy'&&blocks.every(b=>b.protocol==='density'&&b.exercises.length===2&&b.prescription.roundRestSeconds>=45&&b.prescription.exerciseRestSeconds>=15)
};

function assertSession(w,family,{duration,difficulty,equipment}) {
  const budget=G.BUDGETS[duration],exercises=exercisesOf(w),blocks=w.main.blocks;
  assert.equal(w.workoutFamilyId,family);assert.equal(w.workoutFamilyVersion,1);
  assert.ok(F.getDefinition(family).styles.some(s=>s.id===w.familyStyleId));
  assert.equal(w.duration,duration);assert.equal(w.difficulty,difficulty);assert.equal(w.bodyFocus,'full-body');
  // Generic preparation and cool-down surround Main; the whole session fits the selected duration.
  assert.ok(w.warmup.exercises.length&&w.cooldown.exercises.length);
  assert.ok(w.estimatedSeconds<=duration*60&&w.estimatedSeconds>=duration*60*.84,'estimate '+w.estimatedSeconds);
  assert.ok(w.main.estimatedDurationSeconds<=budget.main&&w.main.estimatedDurationSeconds>=budget.main*.85,'main '+w.main.estimatedDurationSeconds);
  assert.equal(w.main.estimatedDurationSeconds,G.mainSeconds(blocks,equipment));
  assert.deepEqual(G.validateMain(w.main,C,equipment,budget.main),[]);
  assert.ok(STRUCTURE[w.familyStyleId](blocks,w),'structure must match '+w.familyStyleId);
  assert.ok(blocks.every(b=>b.familyContext===undefined&&b.occurrenceTargets===undefined&&b.occurrenceRecoverySeconds===undefined));
  for(const ex of exercises) {
    assert.deepEqual(ex,C[ex.id]);
    assert.ok(G.generatedPhaseEligible(ex,'main',equipment,difficulty));
    assert.ok(difficulty!=='easy'||ex.difficulty!=='hard');
  }
  const uses={};
  for(const ex of exercises)uses[ex.id]=(uses[ex.id]||0)+1;
  assert.ok(Math.max(...Object.values(uses))<=2,'no exercise appears in more than two places');
  if(family===CORE) {
    // Trunk-led, low impact and controlled; asymmetric carries can train the trunk.
    assert.ok(exercises.every(ex=>ex.bodyFocus==='core'&&ex.patterns.includes('core')&&!ex.patterns.includes('push')
      &&ex.impact==='low'&&ex.cardio<=3));
    assert.ok(exercises.filter(isHold).length>=exercises.length*.25,'holds carry a meaningful share');
    assert.ok(mean(exercises,'cardio')<=2.5,'control, not conditioning');
    assert.ok(new Set(exercises.map(ex=>ex.id)).size>=3);
  } else {
    const credit=regionCredit(exercises);
    assert.ok(exercises.length>=3);
    for(const value of Object.values(credit))assert.ok(value>=exercises.length*.15-1e-9&&value<=exercises.length*.5+1e-9,JSON.stringify(credit));
    const sets=blocks.filter(b=>b.exercises.length>1).map(b=>b.exercises.map(ex=>ex.id).sort().join('+'));
    assert.equal(new Set(sets).size,sets.length,'a multi-exercise block never repeats');
    // Each protocol keeps its own sensitive-recovery rules through the canonical validators.
    for(const b of blocks) {
      if(b.protocol==='rounds') {
        const flow=[...b.exercises,...(b.prescription.rounds>1?[b.exercises[0]]:[])];
        assert.ok(b.exercises.filter(ex=>ex.impact==='high').length<=1&&flow.every((ex,i)=>!i||ex.impact!=='high'||flow[i-1].impact!=='high'));
      }
      if(b.protocol==='emom')assert.deepEqual(G.validateEmomBlock(b,C),[]);
      if(b.protocol==='ladder')assert.deepEqual(G.validateLadderBlock(b,C),[]);
      if(b.protocol==='pyramid')assert.deepEqual(G.validatePyramidBlock(b,C),[]);
      if(b.protocol==='density')assert.deepEqual(G.validateDensityBlock(b,C),[]);
    }
  }
}

const REPRESENTATIVE=[[10,'easy','bodyweight'],[15,'normal','bodyweight'],[20,'normal','limited'],[30,'hard','limited'],[45,'hard','broad'],[45,'easy','broad'],[20,'hard','bands']];

test('both families register working composers and resolve honest structures with identities from the shared definition',()=>{
  assert.throws(()=>G.registerFamilyComposer(CORE,1,()=>({})),/once per published policy/);
  assert.throws(()=>G.registerFamilyComposer(CHALLENGE,1,()=>({})),/once per published policy/);
  const styles={[CORE]:new Set(),[CHALLENGE]:new Set()};
  for(const [duration,difficulty,key] of REPRESENTATIVE)for(const family of [CORE,CHALLENGE])for(const seed of [1,2]) {
    const equipment=EQUIPMENT[key],w=generate(family,{duration,difficulty,equipment,random:rng(seed*977+duration)});
    assertSession(w,family,{duration,difficulty,equipment});styles[family].add(w.familyStyleId);
  }
  assert.ok(styles[CORE].size>=1&&styles[CHALLENGE].size>=3,'representative seeds reach more than one automatic style');
});

test('every supported style is reachable and displays only the structure it actually has',()=>{
  const need={[CORE]:['controlled-stability','dynamic-core'],[CHALLENGE]:['rounds','emom','ladder','pyramid','density']};
  for(const family of [CORE,CHALLENGE]) {
    const seen=new Set();
    for(let seed=1;seed<=40&&seen.size<need[family].length;seed++)for(const [duration,difficulty,key] of [[20,'hard','broad'],[30,'normal','broad'],[15,'hard','trx'],[10,'normal','broad'],[10,'hard','bodyweight']]) {
      const equipment=EQUIPMENT[key],w=generate(family,{duration,difficulty,equipment,random:rng(seed*131+duration)});
      assertSession(w,family,{duration,difficulty,equipment});seen.add(w.familyStyleId);
    }
    assert.deepEqual([...seen].sort(),need[family].slice().sort());
  }
});

test('Core sessions are controlled trunk work: holds, controlled movement and bounded local fatigue',()=>{
  for(const [duration,difficulty,key] of [[10,'easy','bodyweight'],[30,'normal','broad'],[45,'hard','limited']])for(let seed=1;seed<=4;seed++) {
    const w=generate(CORE,{duration,difficulty,equipment:EQUIPMENT[key],random:rng(seed*17)}),exercises=exercisesOf(w);
    // Never a generic squat, row or press session, and never ballistic or conditioning-grade work.
    assert.ok(exercises.every(ex=>ex.patterns.includes('core')&&ex.bodyFocus==='core'));
    assert.ok(exercises.every(ex=>!ex.patterns.includes('push')&&ex.impact==='low'&&ex.cardio<=3));
    // Recovery follows demanding rounds and pairs.
    for(const b of w.main.blocks) {
      if(b.protocol==='rounds')assert.ok(b.prescription.roundRestSeconds>=45&&b.prescription.exerciseRestSeconds>=15);
      else assert.ok(b.prescription.betweenSetsSeconds>=30);
    }
    // Wherever the pool allows, an exercise is used once rather than repeated back to back across blocks.
    if(duration<=30)assert.equal(new Set(exercises.map(ex=>ex.id)).size,exercises.length);
  }
  // The family does not claim improved technique: it only labels its structure.
  const w=generate(CORE,{});
  assert.ok(!/technique|improv/i.test(JSON.stringify({id:w.familyStyleId,name:F.getDefinition(CORE).name,purpose:F.getDefinition(CORE).purpose})));
});

test('Challenge sessions are balanced whole-body structures; Easy never receives density or hard work',()=>{
  for(const seed of [1,2,3,4,5,6,7,8]) {
    const easy=generate(CHALLENGE,{difficulty:'easy',duration:30,equipment:EQUIPMENT.broad,random:rng(seed)});
    assert.notEqual(easy.familyStyleId,'density');
    assert.ok(exercisesOf(easy).every(ex=>ex.difficulty!=='hard'));
    for(const b of G.mainBlocks(easy).filter(b=>b.protocol==='rounds'))assert.ok(b.exercises.every(ex=>ex.impact!=='high'));
  }
  // Hard sets stronger work requirements, not shorter recovery: rest floors are the same or longer on Easy.
  const rest=difficulty=>{
    const w=generate(CHALLENGE,{difficulty,duration:30,equipment:EQUIPMENT.broad,random:rng(11)});
    return w.main.blocks.map(b=>b.prescription.roundRestSeconds||b.prescription.stepRestSeconds||60);
  };
  assert.ok(Math.min(...rest('easy'))>=Math.min(...rest('hard')));
});

test('rounds challenges are not ordinary short fixed circuits: they need a full balanced round and enough rounds',()=>{
  let seen=0;
  for(let seed=1;seed<=60&&seen<3;seed++)for(const duration of [20,30]) {
    const w=generate(CHALLENGE,{duration,difficulty:'hard',equipment:EQUIPMENT.broad,random:rng(seed*53+duration)});
    if(w.familyStyleId!=='rounds')continue;
    seen++;
    for(const b of w.main.blocks) {
      assert.ok(b.exercises.length>=4&&b.prescription.rounds>=4);
      const regions=new Set(b.exercises.map(ex=>ex.bodyFocus));
      assert.ok(['upper','lower','core'].every(region=>regions.has(region)),'each round trains upper, lower and core');
    }
  }
  assert.ok(seen>=3,'rounds challenges remain reachable');
});

test('EMOM, ladder, pyramid and density honour their canonical recovery and effort bounds with Easy/Normal/Hard',()=>{
  for(const difficulty of DIFFICULTIES)for(const seed of [1,2,3]) {
    const w=generate(CHALLENGE,{difficulty,duration:30,equipment:EQUIPMENT.broad,random:rng(seed*313)});
    for(const b of w.main.blocks) {
      assert.ok(G.estimateBlockDuration(b,EQUIPMENT.broad)>0);
      if(b.protocol==='emom')for(const [i,target] of b.prescription.targets.entries())assert.ok(emomSeconds(b.exercises[i],target)<=WORK_CAP[difficulty]);
      if(b.protocol==='ladder')assert.ok(b.prescription.stepRestSeconds>=({easy:40,normal:30,hard:20})[difficulty]);
      if(b.protocol==='pyramid')assert.ok(b.prescription.stepRestSeconds>=({easy:75,normal:60,hard:60})[difficulty]);
    }
  }
});

test('Body Focus is ignored for both families through the shared definition',()=>{
  for(const family of [CORE,CHALLENGE]) {
    const plain=generate(family,{random:rng(3)}),withFocus=generate(family,{random:rng(3),bodyFocus:'upper'});
    assert.equal(withFocus.bodyFocus,'full-body');
    assert.deepEqual(withFocus.main.blocks,plain.main.blocks);
    assert.deepEqual(F.getDefinition(family).bodyFocus,['full-body']);
  }
});

test('recent-session history lowers exercise repetition and recent protocols influence style weights',()=>{
  const overlap=useHistory=>{
    let repeated=0;
    for(const seed of [1,2,3,4,5,6]) {
      const first=exercisesOf(generate(CORE,{duration:30,equipment:EQUIPMENT.broad,random:rng(seed)})).map(ex=>ex.id);
      const second=generate(CORE,{duration:30,equipment:EQUIPMENT.broad,random:rng(seed+100),...(useHistory?{history:[first]}:{})});
      repeated+=exercisesOf(second).filter(ex=>first.includes(ex.id)).length;
    }
    return repeated;
  };
  assert.ok(overlap(true)<overlap(false));
  const count=recentProtocols=>{
    let paired=0;
    for(let seed=1;seed<=30;seed++)if(generate(CORE,{duration:20,difficulty:'hard',equipment:EQUIPMENT.limited,recentProtocols,random:rng(seed)}).familyStyleId==='dynamic-core')paired++;
    return paired;
  };
  assert.ok(count(['paired_sets'])<count([]));
});

test('impact and position constraints filter the canonical pool and infeasible requests fail honestly',()=>{
  const lowOnly=generate(CHALLENGE,{excludedImpact:['medium','high'],duration:20,equipment:EQUIPMENT.broad});
  assert.ok(exercisesOf(lowOnly).every(ex=>ex.impact==='low'));
  // C1 adds genuine floor preparation, so this restriction is now feasible without
  // leaking standing movements from the generic preparation pool.
  const floor=generate(CORE,{bodyPositions:['floor'],equipment:EQUIPMENT.broad});
  assert.ok([...exercisesOf(floor),...floor.warmup.exercises,...floor.rampup.exercises,...floor.cooldown.exercises]
    .every(ex=>ex.bodyPosition==='floor'));
  assert.equal(G.validateFamilyWorkout(floor,{catalogue:C,equipment:EQUIPMENT.broad}).valid,true);
  for(const [family,extra] of [[CORE,{excludedImpact:['low','medium','high']}],[CHALLENGE,{excludedImpact:['low','medium','high']}],
    [CORE,{bodyPositions:['standing']}],[CORE,{bodyPositions:['hanging']}],[CHALLENGE,{bodyPositions:['hanging']}]])
    assert.throws(()=>generate(family,extra),error=>error instanceof F.FamilyContractError&&error.code==='family-not-feasible'&&/cannot build/.test(error.message));
  for(const bad of [{excludedImpact:['loud']},{excludedImpact:'low'},{bodyPositions:[]},{bodyPositions:['floating']}])
    for(const family of [CORE,CHALLENGE])assert.throws(()=>generate(family,bad),error=>error.code==='invalid-family-context');
});

test('family sessions remain determined by the seed and leave Coach prescriptions and no-family generation to their own paths',()=>{
  for(const family of [CORE,CHALLENGE]) {
    const first=generate(family,{random:rng(11)}),second=generate(family,{random:rng(11)});
    assert.deepEqual({...first,id:0},{...second,id:0});
    assert.throws(()=>generate(family,{sessionPrescription:{}}),error=>error.code==='family-prescription-unsupported');
    assert.throws(()=>generate(family,{duration:25}),error=>error.code==='family-configuration-unsupported');
  }
  const legacy=()=>G.generate({duration:20,focus:'cardio',catalogue:C,equipment:[],random:rng(5)});
  assert.deepEqual({...legacy(),id:0},{...legacy(),id:0});
  assert.equal(legacy().workoutFamilyId,undefined);
  const calls=[],baseline=[];
  G.generate({duration:20,focus:'balanced',catalogue:C,equipment:[],workoutFamilyId:null,random:()=>{calls.push(1);return .3;}});
  G.generate({duration:20,focus:'balanced',catalogue:C,equipment:[],random:()=>{baseline.push(1);return .3;}});
  assert.equal(calls.length,baseline.length);
});

test('family sessions normalise idempotently and share unique planned occurrences with the player',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  for(const family of [CORE,CHALLENGE])for(const [duration,difficulty,key,seed] of [[10,'easy','bodyweight',21],[30,'normal','broad',21],[30,'hard','broad',9],[20,'normal','limited',5]]) {
    const w=generate(family,{duration,difficulty,equipment:EQUIPMENT[key],random:rng(seed)});
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),copy(w));
    app.input=copy(w);
    const plan=app.GarageFitSessionTracker.plannedWorkFromTimeline(app.buildGeneratedTimeline(app.input));
    assert.equal(new Set(plan.map(p=>p.occurrenceId)).size,plan.length);
    const main=plan.filter(p=>p.section==='main');
    assert.equal(main.length,w.main.blocks.reduce((sum,b)=>sum+G.resolveBlockSteps(b).filter(s=>s.kind==='exercise')
      .reduce((n,s)=>n+G.sideCount(b.exercises[s.exerciseIndex]),0),0));
  }
});

test('composer loads after the shared composer kit in the application shell',()=>{
  assert.match(fs.readFileSync('index.html','utf8'),/js\/strength-cardio-composer.js[\s\S]*js\/core-challenge-composer.js/);
  assert.ok(Object.isFrozen(GarageFitFamilyComposerKit));
});

test('[Full] five durations × three difficulties × five equipment sets × three seeds per family build valid sessions',()=>{
  const SEEDS=[1,31,2026];let sessions=0;
  for(const family of [CORE,CHALLENGE])for(const duration of DURATIONS)for(const difficulty of DIFFICULTIES)for(const key of Object.keys(EQUIPMENT))for(const seed of SEEDS) {
    const equipment=EQUIPMENT[key];let w;
    try{w=generate(family,{duration,difficulty,equipment,random:rng(seed*977+duration)});}
    catch(error){assert.fail('Unexpected infeasibility '+family+' '+duration+' '+difficulty+' '+key+' '+seed+': '+error.message);}
    sessions++;assertSession(w,family,{duration,difficulty,equipment});
  }
  assert.equal(sessions,2*5*3*5*3);
});

// C1: real draws from the complete catalogue, not an artificially narrowed exercise pool.
const C1_IDS=['side-plank-knees','bent-knee-fallout','tabletop-toe-taps','dumbbell-suitcase-carry',
  'side-plank-hip-lifts','supine-heel-slides','plank-arm-reaches','bridge-march','bent-knee-windshield-wipers',
  'dead-bug-isometric-press','bear-plank-hold','seated-knee-tucks','kettlebell-suitcase-march',
  'half-kneeling-band-pallof-press','dumbbell-dead-bug-hold'];
function c1Random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}

test('C1 metadata keeps controlled dynamic work, unilateral doses and deliberate route exclusions',()=>{
  assert.equal(new Set(C1_IDS).size,15);
  for(const id of C1_IDS){
    const ex=C[id];
    assert.ok(ex.generator&&ex.main,id);
    assert.equal(ex.impact,'low',id);
    assert.equal(ex.conditioning,false,id);
    assert.equal(ex.cooldown,false,id);
    assert.ok(ex.instruction.length<=180,id);
    assert.deepEqual(ex.mainProtocols,['rounds','paired_sets'],id);
    assert.equal(G.generatedPhaseEligible(ex,'main',EQUIPMENT.broad,'easy'),id!=='dumbbell-dead-bug-hold',id);
    if(ex.sidedness==='per-side')assert.match(ex.prescription.type,/^unilateral-/);
    if(timed(ex))assert.equal(ex.estimatedSeconds,ex.prescription.value*(ex.sidedness==='per-side'?2:1),id);
  }
  for(const id of ['dumbbell-suitcase-carry','kettlebell-suitcase-march']){
    assert.ok(C[id].patterns.includes('carry'));
    assert.equal(isHold(C[id]),false,'locomotion is dynamic, not an isometric hold');
  }
  assert.match(C['dumbbell-suitcase-carry'].instruction,/clear path/);
  assert.match(C['kettlebell-suitcase-march'].instruction,/on the spot/);
  assert.match(C['dumbbell-dead-bug-hold'].instruction,/above your chest/);
  assert.equal(C['plank-shoulder-taps'].mainRole,'supporting');
  assert.ok(C['plank-shoulder-taps'].patterns.includes('push'));
  assert.equal(C['floor-wipers'].generator,false,'demanding fixed-only work is not promoted');
  assert.deepEqual(C['floor-wipers'].prescription,{type:'reps',value:50});
  assert.equal(C['glute-bridge'].bodyFocus,'lower');
  assert.notEqual(C['band-pallof-press'].id,C['half-kneeling-band-pallof-press'].id);
  assert.equal(C['dumbbell-farmer-carry'].bodyFocus,'full-body');
});

test('all 15 C1 identities are selected in appropriate Core sessions, including accessible supporting work',()=>{
  // id, kit, duration, difficulty, seed: fifteen end-to-end fixtures, no frequency quota.
  const fixtures=[
    ['side-plank-knees',[],10,'easy',2],['bent-knee-fallout',[],30,'easy',12],
    ['tabletop-toe-taps',[],30,'easy',4],['dumbbell-suitcase-carry',['dumbbells'],30,'hard',2],
    ['side-plank-hip-lifts',[],30,'hard',1],['supine-heel-slides',[],15,'easy',5],
    ['plank-arm-reaches',[],30,'hard',1],['bridge-march',[],30,'hard',2],
    ['bent-knee-windshield-wipers',[],30,'hard',3],['dead-bug-isometric-press',[],10,'easy',25],
    ['bear-plank-hold',[],30,'hard',1],['seated-knee-tucks',[],30,'hard',1],
    ['kettlebell-suitcase-march',['kettlebell'],30,'hard',1],
    ['half-kneeling-band-pallof-press',['bands'],30,'hard',7],['dumbbell-dead-bug-hold',['dumbbells'],30,'hard',1]
  ];
  for(const [id,equipment,duration,difficulty,seed] of fixtures){
    const w=generate(CORE,{equipment,duration,difficulty,random:c1Random(seed)});
    assert.ok(exercisesOf(w).some(ex=>ex.id===id),id);
    assertSession(w,CORE,{equipment,duration,difficulty});
    assert.equal(G.validateFamilyWorkout(w,{catalogue:C,equipment}).valid,true,id);
    if(C[id].cardio===3)assert.equal(w.familyStyleId,'dynamic-core');
    assert.ok(!exercisesOf(w).some(ex=>ex.id==='plank-shoulder-taps'),'push demand stays outside Core');
  }
  const seen=new Set();
  for(let seed=1;seed<=20;seed++)for(const ex of exercisesOf(generate(CORE,{duration:30,difficulty:'easy',random:c1Random(seed)})))seen.add(ex.id);
  for(const id of ['dead-bug','bird-dog','reverse-crunch'])assert.ok(seen.has(id),'foundation '+id);
});

test('C1 supporting and loaded work reaches secondary families under their unchanged quality gates',()=>{
  for(const [family,version,id,equipment,duration,seed,constraints] of [
    ['strength-control',2,'bent-knee-fallout',[],30,93],
    ['strength-control',2,'supine-heel-slides',[],30,13],
    ['strength-control',2,'dumbbell-suitcase-carry',['dumbbells'],30,2],
    ['strength-control',2,'half-kneeling-band-pallof-press',['bands'],30,4],
    ['strength-control',2,'plank-shoulder-taps',[],30,19],
    [CHALLENGE,1,'plank-arm-reaches',[],30,1],
    [CHALLENGE,1,'bridge-march',[],30,2],
    [CHALLENGE,1,'seated-knee-tucks',[],30,3],
    [CHALLENGE,1,'kettlebell-suitcase-march',['kettlebell'],15,8,{bodyPositions:['standing']}]
  ]){
    const w=generate(family,{workoutFamilyVersion:version,equipment,duration,difficulty:'hard',bodyFocus:'core',random:c1Random(seed),...constraints});
    assert.ok(exercisesOf(w).some(ex=>ex.id===id),family+' '+id);
    assert.equal(G.validateFamilyWorkout(w,{catalogue:C,equipment}).valid,true);
  }
});

test('C1 accessories reach all four Coach routes without replacing their anchors or granting sport membership',async()=>{
  const {pilot}=require('./helpers/coach-pilot');
  for(const [id,version,expected,anchorIds,seed] of [
    ['general-strength-4w',2,'dumbbell-suitcase-carry',['goblet-squat','dumbbell-floor-press','dumbbell-bent-over-row'],3],
    ['build-arms',1,'bridge-march',['dumbbell-biceps-curl','dumbbell-overhead-triceps-extension'],4],
    ['tennis-conditioning',8,'plank-arm-reaches',['dumbbell-reverse-lunge','dumbbell-romanian-deadlift','dumbbell-floor-press','dumbbell-bent-over-row'],2],
    ['general-fitness',2,'bridge-march',[],2]
  ]){
    const p=pilot(new Map(),id,version);
    p.run("pilotOptions.equipment=['dumbbells','bands','bench'];pilotOptions.duration=45;pilotOptions.bodyFocus='core';");
    await p.start();
    assert.deepEqual(p.json('pilot.snapshot().state.anchors.map(a=>a.exerciseId)'),anchorIds,id);
    p.run(`let c1Seed=${seed};Math.random=()=>{c1Seed=(c1Seed*1664525+1013904223)>>>0;return c1Seed/4294967296;};`);
    p.run('pilot.prepare(pilotOptions)');
    const workout=p.json('pilot.snapshot().preview.workout');
    assert.ok(exercisesOf(workout).some(ex=>ex.id===expected),id+' '+expected);
    const required=p.json('(pilot.snapshot().preview.plan.prescription.requiredAnchors||[]).map(a=>a.exerciseId)');
    for(const anchorId of required)assert.ok(exercisesOf(workout).some(ex=>ex.id===anchorId),id+' anchor '+anchorId);
    // New core exercises remain generic accessories in Tennis strength roles;
    // reviewed movement-role optional pools and sport credit remain deliberately pinned.
    const sport=p.app.GarageFitSportCoverage.createPolicy(p.app.GarageFitData.sportCapabilityPolicies.tennis[4],p.app.GarageFitData.exercises);
    for(const exerciseId of C1_IDS)assert.equal(sport.classifyExercise(exerciseId).status,'unmapped',exerciseId);
    for(const [family,version,roles] of [['athletic-movement',4,['footwork','control','integrated']],['mobility-movement-quality',2,['prep','focused','flow','finish']]])
      for(const exerciseId of C1_IDS)for(const role of roles)assert.equal(p.app.GarageFitWorkoutFamilies.getMembership({workoutFamilyId:family,workoutFamilyVersion:version,role},exerciseId),null);
  }
});
