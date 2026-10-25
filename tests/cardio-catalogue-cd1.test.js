const test=require('node:test');
const assert=require('node:assert/strict');
global.window=global;
for(const file of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator',
  'js/strength-cardio-composer','js/core-challenge-composer','data/athletic-membership','data/mobility-membership',
  'js/athletic-composer','js/mobility-composer','js/routine-generator','data/programmes','data/sport-profiles','data/sport-capabilities',
  'js/coach-model','js/training-history','js/sport-coverage','js/coach-policies','js/coach-general-fitness-policy','js/coach-tennis-policy','js/coach-engine'])require('../'+file);
const G=GarageFitGenerator,C=GarageFitData.exercises;
const IDS=['power-march','step-jacks','standing-knee-drive-march','alternating-hamstring-curl-steps','side-step-knee-lift',
  'forward-back-aerobic-steps','low-impact-speed-skaters','alternating-straight-punches','boxer-step-and-punches','alternating-hooks',
  'boxing-slip-and-punch','step-back-burpee','squat-to-alternating-knee-drive','high-knee-power-steps','low-pogo-hops',
  'dumbbell-alternating-punch-out','dumbbell-squat-to-calf-raise','kettlebell-deadlift-to-calf-raise'];
const SHORT=new Set([IDS[11],...IDS.slice(14)]),PREP=[IDS[0],IDS[1],...IDS.slice(3,6),IDS[7]];
const EQUIPMENT=['dumbbells','kettlebell'];
const rng=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const exercises=w=>w.main.blocks.flatMap(b=>b.exercises);
const family=(extra={})=>G.generate({catalogue:C,workoutFamilyId:'cardio-conditioning',equipment:EQUIPMENT,duration:30,random:rng(1),...extra});
function assertSeen(seen,ids){for(const id of ids)assert.ok(seen.has(id),id+' must actually be selected');}
function checkDoses(w){
  for(const b of w.main.blocks)for(const item of G.resolvedOccurrences(b))if(IDS.includes(item.exercise.id)){
    const timed=item.timed||item.exercise.prescription.type==='timed';
    const seconds=item.timed?item.seconds:item.exercise.prescription.value;
    assert.equal(timed,true,item.exercise.id);
    assert.ok(seconds<=(SHORT.has(item.exercise.id)?30:45),item.exercise.id+' '+b.protocol+' '+seconds);
    assert.equal(G.sideCount(item.exercise),1);
  }
}

test('CD1 has eighteen distinct cardio-led entries, fifteen bodyweight, with reviewed continuous timed doses',()=>{
  assert.equal(new Set(IDS).size,18);assert.equal(IDS.filter(id=>!C[id].equipment.length).length,15);
  assert.deepEqual(G.validateCatalogue(C),[]);
  for(const [i,id] of IDS.entries()){
    const ex=C[id];
    assert.ok(ex.generator&&ex.main&&ex.conditioning,id);
    assert.ok(ex.cardio>=3&&ex.cardio>ex.strength,id);
    assert.equal(ex.difficulty,i<8?'easy':'moderate',id);
    assert.equal(ex.impact,id==='low-pogo-hops'?'medium':'low',id);
    assert.deepEqual(ex.prescription,{type:'timed',value:SHORT.has(id)?30:40});
    assert.deepEqual(ex.prescriptionModes,['time']);assert.equal(G.sideCount(ex),1,id);
    assert.equal(ex.cooldown||ex.rampup,false,id);assert.equal(ex.warmup,PREP.includes(id),id);
    assert.equal(ex.equipment.length>0,i>=15,id);
    if(i>=15)assert.equal(ex.load,'Light',id);
    for(const protocol of ['ladder','pyramid','density','amrap'])assert.equal(G.protocolCompatible(ex,protocol),false,id+' '+protocol);
    assert.equal(G.protocolCompatible(ex,'timed_intervals'),!SHORT.has(id),id);
    assert.equal(G.protocolCompatible(ex,'emom'),!SHORT.has(id),id);
    if(PREP.includes(id)){
      assert.equal(ex.warmupPrescription.value,20);assert.equal(ex.warmupPrescription.minValue,15);assert.equal(ex.warmupPrescription.maxValue,25);
      assert.equal(ex.prepFatigue,1);assert.equal(ex.kneeMobility,false);
    }
  }
  assert.match(C['dumbbell-alternating-punch-out'].instruction,/very light.*slowly press.*without forceful punches, snapping or locking elbows/);
  assert.equal(C['dumbbell-alternating-punch-out'].voiceInstruction,true);
  // Existing identities keep their narrower prep, technical or recovery roles.
  for(const id of ['marching-on-the-spot','standing-knee-curls','side-step-touches','forward-back-line-steps','easy-recovery-walk'])assert.equal(C[id].generator,false,id);
  assert.equal(C['standing-knee-curls'].kneeMobility,true);
  assert.equal(GarageFitData.workoutFamilyCurrentVersions['cardio-conditioning'],1);
});

test('CD1 preserves a complete short Easy Cardio interval with squat and conditioning selection roles',()=>{
  const w=G.generate({catalogue:C,duration:10,focus:'cardio',difficulty:'easy',bodyFocus:'full-body',equipment:[],random:rng(260931851)});
  assert.equal(w.estimatedSeconds,540);
  assert.equal(w.main.estimatedDurationSeconds,390,'catalogue growth changes preparation, not the full Main interval');
  assert.deepEqual(G.validateMain(w.main,C,[],G.BUDGETS[10].main),[]);
  const list=exercises(w);
  assert.ok(new Set(list.map(ex=>ex.id)).size>=3);
  assert.deepEqual([...new Set(list.flatMap(G.selectionTags))].sort(),['conditioning','squat']);
  assert.ok(list.some(ex=>ex.id==='standing-knee-drive-march')&&list.some(ex=>ex.id==='step-jacks'));
  checkDoses(w);
});

test('gentle CD1 Warm-up fits a short session beside essential knee and per-side hip preparation',()=>{
  // This is a dose-fitting regression for these three roles; live-catalogue
  // selection proofs below remain separate from this deliberately constrained pool.
  const pool=Object.fromEntries(['standing-knee-curls','alternating-hamstring-curl-steps','bent-knee-fallout'].map(id=>[id,C[id]]));
  const w={warmup:G.selectWarmup(pool,G.BUDGETS[10].warmup,['dumbbells'],[],rng(258),{focus:'strength'})};
  assert.equal(w.warmup.exercises.length,3);
  assert.ok(Math.abs(w.warmup.estimatedSeconds-G.BUDGETS[10].warmup)<=10);
  const curl=w.warmup.exercises.find(ex=>ex.id==='alternating-hamstring-curl-steps');
  assert.ok(curl);assert.equal(curl.prescription.value,15);
  assert.ok(w.warmup.exercises.some(ex=>ex.kneeMobility));
  assert.ok(w.warmup.exercises.some(ex=>ex.id==='bent-knee-fallout'));
});

test('walk-to-plank push-up retains specific Ramp-up rehearsal and leaves gentle general preparation',()=>{
  const ex=C['walk-plank-push-up'];
  assert.equal(ex.warmup,false);assert.equal(G.generatedPhaseEligible(ex,'warmup',[]),false);
  assert.equal(ex.rampup,true);assert.deepEqual(ex.rampupPrescription,{type:'timed',value:35,minValue:25,maxValue:45});
  assert.deepEqual(ex.prescription,{type:'timed',value:20});
  const w=G.generate({catalogue:C,equipment:['dumbbells'],duration:30,focus:'strength',bodyFocus:'upper',random:rng(2)});
  assert.ok(w.rampup.exercises.some(ex=>ex.id==='walk-plank-push-up'));
  assert.ok(!w.warmup.exercises.some(ex=>ex.id==='walk-plank-push-up'));
});

test('[Full] CD1 additions are observed across all three Cardio styles and all duration/difficulty choices stay valid',t=>{
  const seen=new Set(),styles=new Set(),counts=Object.fromEntries(IDS.map(id=>[id,0]));
  // 90 sessions: bounded cross-product covers all supported lengths and settings with/without kit.
  for(const duration of [10,15,20,30,45])for(const difficulty of ['easy','normal','hard'])for(const equipment of [[],EQUIPMENT])for(const seed of [1,2,3]){
    const w=family({duration,difficulty,equipment,random:rng(seed*977+duration)});
    assert.equal(G.validateFamilyWorkout(w,{catalogue:C,equipment}).valid,true);
    assert.ok(w.estimatedSeconds<=duration*60&&w.estimatedSeconds>=duration*60*.85);
    checkDoses(w);styles.add(w.familyStyleId);
    for(const id of new Set(exercises(w).map(ex=>ex.id)))if(id in counts){seen.add(id);counts[id]++;}
  }
  assertSeen(seen,IDS);assert.deepEqual([...styles].sort(),['endurance','intervals','mixed-conditioning']);
  t.diagnostic('CD1 selections per 90 Cardio sessions '+JSON.stringify(counts));
  const easy=family({equipment:[],difficulty:'easy',duration:45,excludedImpact:['medium','high'],random:rng(7)});
  assert.ok(exercises(easy).every(ex=>ex.impact==='low'));
  assert.ok(exercises(easy).filter(ex=>ex.bodyPosition==='standing').length>=exercises(easy).length*.75);
  assert.ok(new Set(exercises(easy).filter(ex=>IDS.includes(ex.id)).map(ex=>ex.id)).size>=5);
});

test('[Full] legacy Cardio and Mixed Main, generated Warm-up and Prep & Recover actually select intended additions',()=>{
  const seen=new Set(),warm=new Set(),routines=new Set();
  // Fixed fixtures cover all eighteen Main additions and all six prep
  // additions, including the rarer full-body boxing and light loaded routes.
  const fixtures=[
    {"focus":"balanced","bodyFocus":"full-body","equipment":[],"duration":45,"seed":1},
    {"focus":"cardio","bodyFocus":"upper","equipment":[],"duration":45,"seed":2024},
    {"focus":"cardio","bodyFocus":"full-body","equipment":[],"duration":30,"seed":20186},
    {"focus":"cardio","bodyFocus":"upper","equipment":[],"duration":45,"seed":13123},
    {"focus":"cardio","bodyFocus":"full-body","equipment":["dumbbells","kettlebell"],"duration":30,"seed":4042},
    {"focus":"cardio","bodyFocus":"upper","equipment":["dumbbells","kettlebell"],"duration":45,"seed":7069},
    {"focus":"balanced","bodyFocus":"full-body","equipment":["dumbbells","kettlebell"],"duration":30,"seed":4044},
    {"focus":"cardio","bodyFocus":"full-body","equipment":[],"duration":30,"seed":5051},
    {"focus":"cardio","bodyFocus":"full-body","equipment":[],"duration":30,"seed":3033},
    {"focus":"cardio","bodyFocus":"lower","difficulty":"hard","equipment":["dumbbells","kettlebell"],"duration":30,"seed":11},
    {"focus":"cardio","bodyFocus":"lower","difficulty":"easy","equipment":["dumbbells","kettlebell"],"duration":30,"seed":7},
    {"focus":"cardio","bodyFocus":"lower","difficulty":"hard","equipment":["dumbbells","kettlebell"],"duration":30,"seed":1}
  ];
  for(const {seed,...options} of fixtures){
    const w=G.generate({catalogue:C,...options,random:rng(seed)});
    checkDoses(w);exercises(w).forEach(ex=>seen.add(ex.id));
    for(const ex of w.warmup.exercises){
      warm.add(ex.id);
      if(PREP.includes(ex.id))assert.ok(ex.prescription.value<=25&&ex.prescription.value<40,ex.id);
    }
  }
  for(const seed of [1,7,9,55]){
    const r=GarageFitRoutineGenerator.generateRoutine({catalogue:C,kind:'warmup',variant:'bodyweight',equipment:[],random:rng(seed)});
    r.exercises.forEach(ex=>routines.add(ex.id));
    // Standalone routines use their own established 20–40 s fitter, not Warm-up maxValue.
    for(const phase of r.phases)if(PREP.includes(phase.id))assert.ok(phase.work>=20&&phase.work<40);
    assert.equal(r.estimatedSeconds,300);
  }
  assertSeen(seen,IDS);assertSeen(warm,PREP);assertSeen(routines,PREP);
});

test('[Full] Full-Body crossover stays purposeful and Core, Mobility, Athletic and Strength Main stay outside CD1',()=>{
  const seen=new Set();
  for(const seed of [12,14,15]){
    const w=family({workoutFamilyId:'full-body-challenges',random:rng(seed)});
    assert.equal(G.validateFamilyWorkout(w,{catalogue:C,equipment:EQUIPMENT}).valid,true);
    checkDoses(w);exercises(w).forEach(ex=>seen.add(ex.id));
  }
  assertSeen(seen,['power-march','standing-knee-drive-march','low-impact-speed-skaters','alternating-straight-punches',
    'alternating-hooks','squat-to-alternating-knee-drive','high-knee-power-steps']);
  for(const workoutFamilyId of ['strength-control','core-stability','mobility-movement-quality','athletic-movement']){
    const w=family({workoutFamilyId,random:rng(7)});
    assert.ok(exercises(w).every(ex=>!IDS.includes(ex.id)),workoutFamilyId);
  }
});

test('[Full] current General Fitness plans actually deliver CD1 through the shared Cardio family without changing programme anchors',()=>{
  const engine=GarageFitCoachEngine.createEngine({catalogue:C,assessSessionPrescription:G.assessSessionPrescription});
  const def=GarageFitData.programmes['general-fitness'][2],now='2026-10-24T08:00:00Z';
  const state=engine.startProgramme(def,{programmeInstanceId:'cd1',equipment:[]},now).state;
  const history=['strength-control','full-body-challenges','athletic-movement','core-stability','mobility-movement-quality'].map((id,i)=>GarageFitCoachModel.createSessionResult({sessionResultId:'prior-'+i,source:'generator',workoutFamilyId:id,workoutFamilyVersion:1,familyStyleId:'prior',startedAt:now,endedAt:now,finalStatus:'completed',plannedWork:[{occurrenceId:'prior-'+i,exerciseId:'air-squat',section:'main'}],performedWork:[{occurrenceId:'prior-'+i,exerciseId:'air-squat',status:'completed'}]}));
  const plan=engine.planNextSession(def,state,history,{now,prescriptionId:'cd1-rx',equipment:[],duration:30});
  assert.ok(plan.prescription.workoutFamilyPlan.candidates.some(c=>c.workoutFamilyId==='cardio-conditioning'));
  const seen=new Set();
  // Preserve the real plan's complete ranked candidates and observe the delivered family.
  for(const seed of [1,2]){
    const w=G.generate({catalogue:C,sessionPrescription:plan.prescription,random:rng(seed)});
    if(w.workoutFamilyId==='cardio-conditioning'){checkDoses(w);exercises(w).forEach(ex=>seen.add(ex.id));}
  }
  assert.ok(IDS.some(id=>seen.has(id)),'actual General Fitness Cardio session');
  assert.deepEqual(state.anchors,[]);
  // CD1 does not claim tennis capability/athletic skill from general aerobic movement.
  const tennis=GarageFitSportCoverage.createPolicy(GarageFitData.sportCapabilityPolicies.tennis[4],C);
  for(const id of IDS)assert.deepEqual(tennis.classifyExercise(id).contributions,[]);
});

// Same catalogue and seeds, removing only CD1 for the pre-batch comparison; the
// original 286 entries and all composition policies are otherwise identical.
test('[Full] CD1 reports long-session set overlap against the pre-batch catalogue without a frequency target',t=>{
  const before=require('./helpers/coach-fixtures').catalogueBeforeCD1(C);
  for(const duration of [30,45]){
    const report={};
    for(const [label,catalogue] of [['before',before],['after',C]]){
      const sets=[];const standing=new Set();
      for(let seed=1;seed<=12;seed++){
        const w=family({catalogue,equipment:[],difficulty:'easy',duration,random:rng(seed*977+duration)});
        checkDoses(w);const list=exercises(w);sets.push(new Set(list.map(ex=>ex.id)));
        list.filter(ex=>ex.bodyPosition==='standing'&&ex.impact==='low').forEach(ex=>standing.add(ex.id));
      }
      let total=0,pairs=0;
      for(let i=0;i<sets.length;i++)for(let j=i+1;j<sets.length;j++){
        total+=[...sets[i]].filter(id=>sets[j].has(id)).length/new Set([...sets[i],...sets[j]]).size;pairs++;
      }
      report[label]={meanPairwiseJaccard:Number((total/pairs).toFixed(3)),uniqueLowImpactStanding:standing.size};
    }
    assert.ok(report.after.uniqueLowImpactStanding>report.before.uniqueLowImpactStanding);
    t.diagnostic(duration+' min Easy bodyweight, 12 fixed seeds: '+JSON.stringify(report));
  }
});
