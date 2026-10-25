const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const {loadAppContext}=require('./helpers/app-context');
const {catalogueBeforePrepP1}=require('./helpers/coach-fixtures');
global.window=global;
for(const path of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','data/mobility-membership','js/mobility-composer'])require('../'+path);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises;
const FAMILY='mobility-movement-quality',ROLES=['prep','focused','flow','finish'];
const PROFILES={10:[60,240,240,60],15:[120,300,360,120],20:[180,420,480,120],30:[180,660,780,180],45:[240,1020,1200,240]};
const SEEDS=[1,31,733,2026,424242,0xdeadbeef,987654321,2147483647];
const copy=x=>JSON.parse(JSON.stringify(x));
function rng(seed){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const generate=(extra={})=>G.generate({workoutFamilyId:FAMILY,duration:20,difficulty:'normal',catalogue:C,equipment:[],random:rng(31),...extra});
const seconds=phases=>phases.reduce((sum,p)=>sum+(p.kind==='exercise'?(p.timed?p.seconds:p.estimatedSeconds/G.sideCount(p.exercise)):p.seconds),0);
const exerciseIds=w=>new Set(w.main.blocks.flatMap(b=>b.exercises.map(ex=>ex.id)));

// Representative production construction stays in Fast; Full retains every matrix seed and assertion.
test('representative Mobility sessions preserve eligibility, exact budgets and durable player plans',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  for(const [duration,difficulty,equipment] of [[10,'easy',[]],[20,'normal',['trx']],[45,'hard',[]]]) {
    const w=generate({duration,difficulty,equipment});
    assert.deepEqual(G.validateMain(w.main,C,equipment,duration*60),[]);
    assert.equal(w.estimatedSeconds,duration*60);
    assert.ok(w.main.blocks.every(b=>b.exercises.every(ex=>G.generatedPhaseEligible(ex,'main',equipment,difficulty,b.familyContext)&&ex.impact!=='high')));
    app.input=copy(w);const timeline=app.buildGeneratedTimeline(app.input);
    assert.equal(seconds(timeline)-3,duration*60);
    const plan=app.GarageFitSessionTracker.plannedWorkFromTimeline(timeline);
    assert.equal(plan.length,timeline.filter(p=>p.kind==='exercise').length);
    assert.equal(new Set(plan.map(p=>p.occurrenceId)).size,plan.length);
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),copy(w));
  }
});

test('[Full] five durations × three difficulties × eight seeds × bodyweight/TRX resolve progressive, bounded player plans',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  vm.runInContext(fs.readFileSync('js/rampup-ui.js','utf8'),app);
  const styles=new Set();let sessions=0;
  for(const duration of Object.keys(PROFILES).map(Number))for(const difficulty of ['easy','normal','hard'])for(const seed of SEEDS)for(const equipment of [[],['trx']]) {
    const w=generate({duration,difficulty,equipment,random:rng(seed)});sessions++;styles.add(w.familyStyleId);
    assert.equal(w.workoutFamilyId,FAMILY);assert.equal(w.workoutFamilyVersion,1);assert.equal(w.bodyFocus,'full-body');
    assert.deepEqual(w.main.blocks.map(b=>b.familyContext.role),ROLES);
    assert.deepEqual(G.validateMain(w.main,C,equipment,duration*60),[]);
    assert.equal(w.estimatedSeconds,duration*60);
    // #242: structural generic sections stay empty, but prep/finish read as Warm-up/Cool-down with
    // their published profile time; focused practice and flow are Main; no separate Ramp-up.
    assert.ok(['warmup','rampup','cooldown'].every(key=>w[key].exercises.length===0&&w[key].estimatedSeconds===0));
    const sections=G.trainingSectionPlan(w);
    assert.deepEqual(sections.blocks.map(b=>b.section),['warmup','main','main','cooldown']);
    assert.deepEqual([sections.seconds.warmup,sections.seconds.rampup,sections.seconds.main,sections.seconds.cooldown],
      [PROFILES[duration][0],0,PROFILES[duration][1]+PROFILES[duration][2],PROFILES[duration][3]]);
    assert.equal(w.estimatedSeconds,G.mainSeconds(w.main.blocks,equipment));
    for(const [phase,b] of w.main.blocks.entries()) {
      assert.equal(b.protocol,'rounds');assert.equal(b.prescription.rounds,1,'ordered visits, no generic repeated circuit');
      assert.deepEqual(G.validateOccurrenceTargets(b,C),[]);assert.deepEqual(G.validateOccurrenceRecovery(b),[]);
      assert.ok(Math.abs(b.estimatedSeconds-PROFILES[duration][phase])<=PROFILES[duration][phase]*.15+3);
      const resolved=G.resolveBlockSteps(b);
      assert.equal(resolved.reduce((sum,s)=>sum+(s.kind==='exercise'?s.estimatedSeconds:s.seconds),0),b.estimatedSeconds);
      assert.equal(resolved.at(-1).kind,'exercise');
      for(const s of resolved.filter(s=>s.kind==='exercise')) {
        const e=b.exercises[s.exerciseIndex],p=s.plannedPrescription;
        assert.deepEqual(e,C[e.id],'canonical catalogue is not rewritten');
        assert.equal(s.estimatedSeconds,p.value*G.sideCount(e),'per-side time counted twice');
        assert.equal(p.type,G.sideCount(e)===2?'unilateral-timed':'timed');
        assert.ok(p.value>=10&&p.value<=50);
        assert.ok(F.getMembership(b.familyContext,e.id));
        assert.ok(G.generatedPhaseEligible(e,'main',equipment,difficulty,b.familyContext));
        assert.equal(e.impact==='high',false);
        if(!equipment.length)assert.notEqual(e.id,'trx-squat-overhead');
        if(difficulty==='easy')assert.equal(e.impact,'low');
      }
      for(const [index,gap] of b.occurrenceRecoverySeconds.entries()) {
        assert.ok(gap>=3&&gap<=12);
        if(b.exercises[index].bodyPosition!==b.exercises[index+1].bodyPosition)assert.equal(gap,12);
      }
      if(phase>0)assert.equal(w.main.blocks[phase-1].exercises.at(-1).bodyPosition,b.exercises[0].bodyPosition,'phase boundary stays at one body level');
    }
    const ids=exerciseIds(w);
    for(const id of ['wall-angel','kneeling-ankle-rocks','adductor-rock-backs','thread-the-needle','ninety-ninety-hip-switches','worlds-greatest-stretch','downward-upward-dog','cat-cow'])assert.ok(ids.has(id),id);
    app.input=copy(w);const timeline=app.buildGeneratedTimeline(app.input);
    assert.equal(seconds(timeline)-3,w.estimatedSeconds,'only shared Ready countdown is outside the budget');
    const work=timeline.filter(p=>p.kind==='exercise');
    const plan=app.GarageFitSessionTracker.plannedWorkFromTimeline(timeline);
    assert.equal(plan.length,work.length);assert.equal(new Set(plan.map(p=>p.occurrenceId)).size,plan.length);
    assert.ok(timeline.filter(p=>p.kind!=='exercise').every(p=>!p.occurrenceId));
    for(let index=0;index<work.length;index++)if(work[index].side==='right') {
      assert.equal(work[index+1].side,'left');assert.equal(work[index+1].exercise.id,work[index].exercise.id);
      assert.equal(timeline.indexOf(work[index+1]),timeline.indexOf(work[index])+1,'no rest or recovery between sides');
    }
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),copy(w));
  }
  assert.equal(sessions,240);assert.deepEqual([...styles].sort(),['integrated-flow','joint-focused']);
});

test('long sessions broaden the approved pool and practise varied connected sweeps with changing doses',()=>{
  for(const difficulty of ['easy','normal','hard'])for(const seed of SEEDS) {
    const workouts=[10,15,20,30,45].map(duration=>generate({duration,difficulty,random:rng(seed)}));
    const sizes=workouts.map(w=>exerciseIds(w).size);
    assert.ok(sizes[2]>sizes[0]);assert.ok(sizes[3]>=sizes[2]);assert.ok(sizes[4]>=sizes[3]);
    assert.ok(sizes[4]>=13,'the long session uses the broad approved bodyweight pool');
    for(const w of workouts.slice(3))for(const b of w.main.blocks.filter(b=>['focused','flow'].includes(b.familyContext.role))) {
      const ids=b.exercises.map(e=>e.id),unique=new Set(ids);
      assert.ok(unique.size>=6);
      assert.ok(new Set(b.occurrenceTargets.map(t=>t.plannedPrescription.value)).size>1,'progressive doses, not cloned circuit targets');
      assert.ok(ids.every((id,i)=>i===0||id!==ids[i-1]));
      let changes=0;for(let i=1;i<ids.length;i++)if(b.exercises[i].bodyPosition!==b.exercises[i-1].bodyPosition)changes++;
      assert.ok(changes<=Math.ceil(ids.length/unique.size)*3,'group connected floor/mixed/standing practice');
    }
    const finish=workouts.at(-1).main.blocks.at(-1).exercises;
    assert.ok(finish.slice(1).every(e=>e.bodyPosition==='floor'),'gentle finish descends only once');
  }
});

test('internal styles resolve automatically and change phase emphasis without legacy preference influence',()=>{
  const joint=generate({random:()=>.1}),flow=generate({random:()=>.9});
  assert.equal(joint.familyStyleId,'joint-focused');assert.equal(flow.familyStyleId,'integrated-flow');
  assert.ok(joint.main.blocks[1].estimatedSeconds>flow.main.blocks[1].estimatedSeconds);
  assert.ok(joint.main.blocks[2].estimatedSeconds<flow.main.blocks[2].estimatedSeconds);
  const longJoint=generate({duration:45,random:()=>.1}),longFlow=generate({duration:45,random:()=>.9});
  assert.ok(longJoint.main.blocks[1].exercises.length<longFlow.main.blocks[1].exercises.length,'longer joint exposures vs short focused primers');
  assert.ok(longJoint.main.blocks[2].exercises.length>longFlow.main.blocks[2].exercises.length,'longer connected flow exposures vs brief complementary practice');
  assert.ok(longFlow.main.blocks[2].occurrenceRecoverySeconds.includes(3));
  assert.ok(!longJoint.main.blocks[2].occurrenceRecoverySeconds.includes(3));
  const legacy=generate({focus:'strength',workoutStyle:'pyramid',bodyFocus:'upper'}),plain=generate();
  delete plain.id;delete legacy.id;assert.deepEqual(legacy,plain);
  assert.throws(()=>generate({familyStyleId:'joint-focused'}),e=>e.code==='invalid-family-request');
});

test('restricted or unsupported requests fail honestly without crossing families or assuming space/equipment',()=>{
  for(const bodyPositions of [['standing'],['floor'],['hanging']])assert.throws(()=>generate({bodyPositions}),e=>e.code==='family-not-feasible');
  assert.throws(()=>generate({excludedImpact:['low']}),e=>e.code==='family-not-feasible');
  for(const extra of [{bodyPositions:[]},{excludedImpact:null},{excludedImpact:'high'},{movementRoom:'yes'}])
    assert.throws(()=>generate(extra),e=>e.code==='invalid-family-context');
  for(const extra of [{duration:5},{difficulty:'maximal'}])assert.throws(()=>generate(extra),e=>e.code==='family-configuration-unsupported');
  assert.throws(()=>generate({workoutFamilyId:'athletic-movement'}),e=>e.code==='family-composer-unavailable');
  assert.throws(()=>generate({sessionPrescription:{}}),e=>e.code==='family-prescription-unsupported');
  assert.doesNotThrow(()=>generate({movementRoom:false}));
  const low=generate({excludedImpact:['medium','high']});assert.ok(low.main.blocks.flatMap(b=>b.exercises).every(e=>e.impact==='low'));
});

test('shared registry is version-pinned and single-registration; production and test harness load the same composer',()=>{
  assert.throws(()=>G.registerFamilyComposer(FAMILY,1,()=>{}),/registered once/);
  assert.throws(()=>G.registerFamilyComposer(FAMILY,4,()=>{}),e=>e.code==='unsupported-workout-family-version');
  assert.match(fs.readFileSync('index.html','utf8'),/data\/mobility-membership.js[\s\S]*js\/mobility-composer.js/);
  const app=loadAppContext(new Map());
  assert.equal(app.GarageFitGenerator.generate({workoutFamilyId:FAMILY,duration:10,catalogue:app.GarageFitData.exercises,random:()=>.2}).workoutFamilyId,FAMILY);
});

// ---- Mobility composition v2 (#264): regional emphasis, duration-sensitive coverage, selective repetition, soft sequencing ----
const M=GarageFitMobilityComposer;
const TRX_ONLY=['trx-lateral-weight-shift','trx-squat-overhead','supported-squat-rocks'];
const V2_MEMBERS=Object.keys(C).filter(id=>ROLES.some(role=>F.getMembership({workoutFamilyId:FAMILY,workoutFamilyVersion:2,role},id)));
const v2=(extra={})=>generate({workoutFamilyVersion:2,...extra});
const ids=w=>w.main.blocks.flatMap(b=>b.exercises.map(e=>e.id));
const stage=(w,index)=>w.main.blocks[index].exercises.map(e=>e.id);
const level=e=>e.bodyPosition==='mixed'?1:e.bodyPosition==='floor'?0:2;
const levelChanges=list=>list.filter((e,i)=>i&&level(e)!==level(list[i-1])).length;
const hasRepeatedRun=(list,size)=>{const grams=list.slice(size-1).map((_,i)=>list.slice(i,i+size).join('>'));return new Set(grams).size<grams.length;};
const regionShare=(list,region)=>{
  const totals=M.REGIONS.map(r=>list.reduce((sum,id)=>sum+(M.regionsOf(id)[0]===r?1:M.regionsOf(id).includes(r)?.5:0),0));
  return totals[M.REGIONS.indexOf(region)]/totals.reduce((a,b)=>a+b,0);
};
const distinctIn=(list,region)=>new Set(list.filter(id=>M.regionsOf(id).includes(region))).size;
const valid=(w,equipment=[])=>copy(G.validateFamilyWorkout(w,{catalogue:C,equipment}));
const PASSES={valid:true,technicalIssues:[],qualityIssues:[]};
// The composer draws its style first and its emphasis second, so a seed fixes the emphasis of an unrestricted session.
const emphasisFor=(seed,previous=null)=>{const r=rng(seed);r();return M.chooseEmphasis(r,['lower','upper','full'],previous);};
// Forces the two leading draws (style, emphasis) and leaves every later choice to a seeded stream.
const forced=(draws,seed)=>{const r=rng(seed),queue=draws.slice();return ()=>queue.length?queue.shift():r();};
const MATRIX=[];for(const duration of [10,15,20,30,45])for(const difficulty of ['easy','normal','hard'])for(const equipment of [[],['trx']])MATRIX.push({duration,difficulty,equipment});

// Compare session composition independently of shared catalogue preparation descriptors.
const historicalGenerate=(historical,extra)=>{
  // Normalisation resolves canonical identities through the global catalogue too.
  const current=GarageFitData.exercises;GarageFitData.exercises=historical;
  try{return generate({...extra,catalogue:historical});}finally{GarageFitData.exercises=current;}
};
const composition=workout=>{
  const result=copy(workout);delete result.id;
  for(const section of [result.warmup,result.rampup,result.cooldown,...result.main.blocks,...result.blocks])
    section.exercises=section.exercises.map(ex=>({id:ex.id,prescription:ex.prescription,estimatedSeconds:ex.estimatedSeconds}));
  return result;
};

test('published Mobility v1 seeded output is unchanged by the v2 composition (#264)',()=>{
  const sessions=[],historical=catalogueBeforePrepP1(C);
  for(const duration of [10,20,45])for(const difficulty of ['easy','normal','hard'])for(const equipment of [[],['trx']])for(const seed of [1,31,2026]) {
    const options={workoutFamilyVersion:1,duration,difficulty,equipment};
    const w=historicalGenerate(historical,{...options,random:rng(seed)});
    assert.deepEqual(composition(generate({...options,random:rng(seed)})),composition(w),'live catalogue preserves v1 composition');
    delete w.id;sessions.push(w);
  }
  assert.equal(sessions.length,54);
  assert.equal(createHash('sha256').update(JSON.stringify(sessions)).digest('hex'),'4182e035fa133e021f3eda981f5d580ec959a95674092c60e6c8990581c08525');
  assert.equal(generate().workoutFamilyVersion,1,'an unversioned request is still the published v1');
});

test('saved Mobility and Athletic family sessions keep their execution contracts after P1 prep reuse',()=>{
  require('../data/athletic-membership');require('../js/athletic-composer');
  const historical=catalogueBeforePrepP1(C);
  for(const [workoutFamilyId,workoutFamilyVersion] of [[FAMILY,1],[FAMILY,2],[FAMILY,3],['athletic-movement',5]]) {
    for(const seed of [1,31,2026]) {
      const saved=historicalGenerate(historical,{workoutFamilyId,workoutFamilyVersion,duration:30,random:rng(seed)});
      assert.deepEqual(copy(G.normaliseWorkout(copy(saved))),copy(saved),'saved '+workoutFamilyId+'/'+workoutFamilyVersion);
      const original=copy(saved);
      assert.equal(G.validateFamilyWorkout(saved,{catalogue:C,equipment:[]}).valid,true);
      assert.deepEqual(copy(saved),original,'validation does not rewrite saved descriptors');
      for(const field of ['impact','bodyPosition','equipment','prescription','difficulty','family']) {
        const tampered=copy(saved),exercise=tampered.main.blocks[0].exercises[0];
        exercise[field]=field==='impact'?'high':field==='bodyPosition'?'hanging':field==='equipment'?[['rings']]:
          field==='difficulty'?'hard':field==='family'?'forged-family':{type:'timed',value:999};
        assert.throws(()=>G.normaliseWorkout(tampered),/modified-exercise|Invalid/,'safety field '+field+' remains canonical');
      }
    }
  }
});

test('Mobility v3 is current for new standalone and Coach selections; v1/v2 stay version-pinned (#272)',()=>{
  assert.equal(F.currentVersion(FAMILY),3);
  const definition=F.getDefinition(FAMILY,2);
  assert.deepEqual([definition.membershipPolicy.version,definition.compositionPolicy.version,definition.styles.map(style=>style.id)],[2,2,['joint-focused','integrated-flow']]);
  const first=generate({workoutFamilyVersion:1}),second=v2();
  assert.deepEqual([first.workoutFamilyVersion,second.workoutFamilyVersion],[1,2]);
  assert.deepEqual(valid(first),PASSES);assert.deepEqual(valid(second),PASSES);
  assert.ok(first.main.blocks.every(b=>b.familyContext.workoutFamilyVersion===1),'a v1 record keeps resolving its named version');
  // The standalone Generator screen asks for the current version with no extra user choice.
  const app=loadAppContext(new Map());app.input=FAMILY;vm.runInContext('selectGeneratorFamily(input);generateWorkout()',app);
  assert.equal(vm.runInContext('generatorState.workout.workoutFamilyVersion',app),3);
});

test('v2 composes exactly timed, playable Prepare -> Focus -> Flow -> Finish sessions with durable occurrence identities',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  for(const [duration,difficulty,equipment] of [[10,'easy',[]],[20,'normal',['trx']],[45,'hard',[]]]) {
    const w=v2({duration,difficulty,equipment});
    assert.deepEqual(G.validateMain(w.main,C,equipment,duration*60),[]);
    assert.equal(w.estimatedSeconds,duration*60);
    assert.deepEqual(w.main.blocks.map(b=>b.familyContext.role),ROLES);
    const sections=G.trainingSectionPlan(w);
    assert.deepEqual(sections.blocks.map(b=>b.section),['warmup','main','main','cooldown']);
    assert.deepEqual([sections.seconds.warmup,sections.seconds.cooldown,sections.seconds.rampup],[PROFILES[duration][0],PROFILES[duration][3],0]);
    assert.equal(sections.seconds.warmup+sections.seconds.main+sections.seconds.cooldown,duration*60);
    app.input=copy(w);const timeline=app.buildGeneratedTimeline(app.input);
    assert.equal(seconds(timeline)-3,duration*60,'only the shared Ready countdown is outside the budget');
    const plan=app.GarageFitSessionTracker.plannedWorkFromTimeline(timeline);
    assert.equal(plan.length,timeline.filter(p=>p.kind==='exercise').length);
    assert.equal(new Set(plan.map(p=>p.occurrenceId)).size,plan.length,'durable occurrence identities');
    assert.deepEqual(copy(plan.map(p=>p.section).filter((section,i,all)=>i===0||section!==all[i-1])),['warmup','main','cooldown']);
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),copy(w));
  }
});

test('[Full] v2 across five durations × three difficulties × bodyweight/TRX × three seeds: gated, bounded, correctly timed sessions',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  const styles=new Set();let sessions=0;
  for(const {duration,difficulty,equipment} of MATRIX)for(const seed of [1,31,733]) {
    const w=v2({duration,difficulty,equipment,random:rng(seed)});sessions++;styles.add(w.familyStyleId);
    assert.equal(w.estimatedSeconds,duration*60);
    assert.deepEqual(w.main.blocks.map(b=>b.familyContext.role),ROLES);
    assert.deepEqual(valid(w,equipment),PASSES);
    assert.ok(['warmup','rampup','cooldown'].every(key=>w[key].exercises.length===0&&w[key].estimatedSeconds===0));
    for(const [phase,b] of w.main.blocks.entries()) {
      assert.equal(b.protocol,'rounds');assert.equal(b.prescription.rounds,1);
      assert.deepEqual(G.validateOccurrenceTargets(b,C),[]);assert.deepEqual(G.validateOccurrenceRecovery(b),[]);
      assert.ok(Math.abs(b.estimatedSeconds-PROFILES[duration][phase])<=PROFILES[duration][phase]*.15+3);
      for(const s of G.resolveBlockSteps(b).filter(s=>s.kind==='exercise')) {
        const e=b.exercises[s.exerciseIndex],p=s.plannedPrescription;
        assert.deepEqual(e,C[e.id],'canonical catalogue is not rewritten');
        assert.equal(s.estimatedSeconds,p.value*G.sideCount(e),'equal time on both sides');
        assert.equal(p.type,G.sideCount(e)===2?'unilateral-timed':'timed');
        assert.ok(p.value>=10&&p.value<=50);
        if(M.isStatic(e.id))assert.ok(['focused','finish'].includes(b.familyContext.role)&&p.value<=30,'bounded static holds only in Focus/Finish');
        if(difficulty==='easy')assert.equal(e.impact,'low');
        if(!equipment.length)assert.ok(!TRX_ONLY.includes(e.id),e.id+' needs the TRX');
      }
      assert.ok(b.occurrenceRecoverySeconds.every((gap,i)=>gap>=3&&gap<=14&&(level(b.exercises[i])===level(b.exercises[i+1])||gap>=12)));
    }
    app.input=copy(w);const timeline=app.buildGeneratedTimeline(app.input);
    assert.equal(seconds(timeline)-3,w.estimatedSeconds);
    const plan=app.GarageFitSessionTracker.plannedWorkFromTimeline(timeline);
    assert.equal(new Set(plan.map(p=>p.occurrenceId)).size,plan.length);
    const work=timeline.filter(p=>p.kind==='exercise');
    for(let index=0;index<work.length;index++)if(work[index].side==='right') {
      assert.equal(work[index+1].side,'left');assert.equal(work[index+1].exercise.id,work[index].exercise.id);
      assert.equal(timeline.indexOf(work[index+1]),timeline.indexOf(work[index])+1,'no recovery between the two sides');
    }
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),copy(w));
  }
  assert.equal(sessions,90);assert.deepEqual([...styles].sort(),['integrated-flow','joint-focused']);
});

test('all 34 approved members are composed end to end in suitable contexts, including the four new movements',()=>{
  assert.equal(V2_MEMBERS.length,34);
  assert.ok(V2_MEMBERS.every(id=>M.regionsOf(id).length),'every member has a Mobility-local region mapping');
  const missing=new Set(V2_MEMBERS);
  for(const duration of [10,20,45])for(const difficulty of ['normal','easy'])for(const equipment of [[],['trx']])for(let seed=1;seed<=6;seed++) {
    for(const id of ids(v2({duration,difficulty,equipment,random:rng(seed*131+duration)}))) {
      missing.delete(id);
      if(TRX_ONLY.includes(id))assert.ok(equipment.includes('trx'),id);
      if(id==='runners-stretch')assert.notEqual(difficulty,'easy');
    }
  }
  assert.deepEqual([...missing],[],'no fixed ORDER/CORE list blocks an approved member');
});

test('seeded sessions show all three regional emphases with duration-sensitive coverage and focus depth',()=>{
  const sample=(duration,count=21)=>Array.from({length:count},(_,i)=>({emphasis:emphasisFor(i*7919+duration),w:v2({duration,random:rng(i*7919+duration)})}));
  for(const duration of [10,20,30,45]) {
    const runs=sample(duration);
    for(const emphasis of ['lower','upper','full'])assert.ok(runs.filter(run=>run.emphasis===emphasis).length>=4,duration+' min: '+emphasis+' is selected');
    for(const {w} of runs) {
      assert.equal(w.familyDiagnostics,undefined,'neither style needed a fallback');
      const minimum=duration===10?3:duration<=20?5:7;
      for(const region of M.REGIONS)assert.ok(distinctIn(ids(w),region)>=minimum,duration+' min covers '+region);
    }
  }
  // The emphasis is visible in the Focus stage, up to 30 minutes (longer stages spend the whole approved pool, see the docs).
  for(const duration of [10,20,30]) {
    const runs=sample(duration),mean=(emphasis,region)=>{
      const own=runs.filter(run=>run.emphasis===emphasis).map(run=>regionShare(stage(run.w,1),region));return own.reduce((a,b)=>a+b,0)/own.length;};
    for(const region of ['lower','upper']) {
      const opposite=region==='lower'?'upper':'lower',label=duration+' min '+region+' emphasis: '+mean(region,region).toFixed(2);
      assert.ok(mean(region,region)>=mean(opposite,region)+.05,label+' vs '+opposite+' '+mean(opposite,region).toFixed(2));
      assert.ok(mean(region,region)>mean('full',region),label+' vs full '+mean('full',region).toFixed(2));
    }
  }
  for(const {w} of sample(10))assert.ok(M.REGIONS.every(region=>regionShare(ids(w),region)>=.1),'10 min still practises every region briefly');
});

test('a bounded preference moves away from the previous completed emphasis only on reliable evidence, never from pacing styles',()=>{
  const lowerFocus=['kneeling-ankle-rocks','adductor-rock-backs','ninety-ninety-hip-switches','standing-hip-rotations','heel-toe-rocks','half-kneeling-hip-flexor-rocks-with-reach'];
  const upperFocus=['wall-angel','controlled-shoulder-rotations','thread-the-needle','quadruped-thoracic-rotation','wall-angel','thread-the-needle'];
  const balanced=['wall-angel','kneeling-ankle-rocks','body-twists','thread-the-needle','standing-hip-rotations','standing-side-bends'];
  const evidence=(list,extra={})=>({recentFamilySessions:{[FAMILY]:{workoutFamilyVersion:2,familyStyleId:'integrated-flow',plannedOccurrences:list.length,
    completedOccurrences:list.map(exerciseId=>({exerciseId,blockIndex:1})),...extra}}});
  assert.equal(M.inferEmphasis(lowerFocus),'lower');assert.equal(M.inferEmphasis(upperFocus),'upper');
  for(const ambiguous of [balanced,lowerFocus.slice(0,3),[...lowerFocus,'not-a-mobility-movement']])assert.equal(M.inferEmphasis(ambiguous),null);
  const recent=extra=>M.recentEmphasis(evidence(lowerFocus,extra));
  assert.equal(recent(),'lower');
  // Absent, partial, untagged, v1 or malformed evidence gives no preference; pacing styles are never read as an emphasis.
  for(const weak of [{workoutFamilyVersion:1},{plannedOccurrences:40},{completedOccurrences:[]},{plannedOccurrences:0},{completedOccurrences:lowerFocus.map(exerciseId=>({exerciseId,blockIndex:null}))}])
    assert.equal(recent(weak),null,JSON.stringify(weak).slice(0,50));
  assert.equal(M.recentEmphasis({}),null);assert.equal(M.recentEmphasis({recentFamilySessions:{[FAMILY]:{completedOccurrences:'x'}}}),null);
  for(const familyStyleId of ['joint-focused','integrated-flow'])assert.equal(M.recentEmphasis(evidence(balanced,{familyStyleId})),null);
  // The draw is mildly weighted, not a rotation: the previous emphasis stays possible and the others are more likely.
  const draws=previous=>{const counts={lower:0,upper:0,full:0},r=rng(99);for(let i=0;i<3000;i++)counts[M.chooseEmphasis(r,['lower','upper','full'],previous)]++;return counts;};
  const neutral=draws(null),after=draws('lower');
  assert.ok(Math.abs(neutral.lower-1000)<120&&Math.abs(neutral.upper-1000)<120,JSON.stringify(neutral));
  assert.ok(after.lower>450&&after.lower<750&&after.upper>after.lower&&after.full>after.lower,JSON.stringify(after));
  // End to end: the same leading draws that give a lower-body session give a different emphasis after a lower-body session,
  // and a draw far from the boundary is unchanged (a mild preference, not a ban).
  const focusShare=(draw,extra,region)=>regionShare(stage(v2({duration:10,random:forced([.1,draw],5),...extra}),1),region);
  assert.ok(focusShare(.3,{},'lower')>=.5,'without evidence this draw is a lower-body session');
  assert.ok(focusShare(.3,evidence(lowerFocus),'lower')<.4,'after a lower-body session it is not');
  assert.ok(focusShare(.1,evidence(lowerFocus),'lower')>focusShare(.3,evidence(lowerFocus),'lower')+.1,'a strongly seeded lower-body draw is still possible after one');
  const again=()=>{const w=copy(v2({duration:10,random:rng(5),...evidence(lowerFocus)}));delete w.id;return w;};
  assert.deepEqual(again(),again(),'deterministic under equivalent inputs');
});

test('recently performed exercises are softly avoided without becoming exclusions',()=>{
  const prior=['hamstring-sweeps','squat-to-stand','body-twists','kneeling-ankle-rocks','thread-the-needle','cat-cow','wall-angel'];
  const overlap=extra=>Array.from({length:40},(_,i)=>ids(v2({duration:10,random:rng(i*31+5),...extra})).filter(id=>prior.includes(id)).length).reduce((a,b)=>a+b,0);
  const plain=overlap({}),avoided=overlap({history:[prior]});
  assert.ok(avoided<plain,'recent movements are chosen less often: '+plain+' vs '+avoided);
  assert.ok(avoided>0,'but remain available when they best fit the session');
  const everything=ids(v2({duration:45,difficulty:'easy'}));
  assert.doesNotThrow(()=>v2({duration:45,difficulty:'easy',history:[everything,everything,everything,everything]}),'novelty never overrides feasibility');
});

test('soft sequencing: standing Prepare, few body-level changes, no oscillation, no replayed sequences, active Prepare and Flow',()=>{
  for(const {duration,difficulty,equipment} of MATRIX)for(const seed of [1,733]) {
    const w=v2({duration,difficulty,equipment,random:rng(seed)}),all=ids(w),label=[duration,difficulty,equipment.length,seed].join('/');
    assert.ok(w.main.blocks[0].exercises.every(e=>e.bodyPosition==='standing'),label+': Prepare is standing');
    assert.ok(levelChanges(w.main.blocks[3].exercises)<=1,label+': the Finish descends at most once');
    if(duration<=20) {
      // Single-pass stages group body levels: standing -> floor in Focus, floor -> mixed -> standing in Flow.
      assert.ok(levelChanges(w.main.blocks[1].exercises)<=1,label+': Focus');
      assert.ok(levelChanges(w.main.blocks[2].exercises)<=(duration===10?2:duration===15?3:4),label+': Flow');
    }
    assert.ok(all.every((id,i)=>i===0||id!==all[i-1]),label+': no immediate repeat');
    assert.equal(hasRepeatedRun(all,4),false,label+': no unchanged four-movement run is replayed');
    for(const index of [0,2])assert.ok(w.main.blocks[index].exercises.every(e=>!M.isStatic(e.id)),label+': active movement in Prepare and Flow');
    for(const block of w.main.blocks)for(const [near,other] of [['shoulder-rolls','controlled-shoulder-rotations'],['ankle-circles','heel-toe-rocks'],['open-close-gates','body-hoops']]) {
      const list=block.exercises.map(e=>e.id);
      if(duration<=15)assert.ok(!(list.includes(near)&&list.includes(other)),label+': near-duplicates '+near+' / '+other+' share a stage');
    }
  }
});

test('30 and 45 minutes explore many complementary movements first, then repeat selectively without replaying a sweep or inflating doses',()=>{
  for(const duration of [30,45])for(const {difficulty,equipment} of [{difficulty:'normal',equipment:[]},{difficulty:'hard',equipment:['trx']},{difficulty:'easy',equipment:[]}])for(const seed of [1,31,733]) {
    const w=v2({duration,difficulty,equipment,random:rng(seed)}),all=ids(w),label=[duration,difficulty,equipment.length,seed].join('/');
    const counts=new Map();all.forEach(id=>counts.set(id,(counts.get(id)||0)+1));
    assert.ok(new Set(all).size>=(duration===30?18:21),label+': broad exploration of the approved pool');
    assert.ok(Math.max(...counts.values())<=6,label+': repetition is bounded');
    assert.equal(hasRepeatedRun(all,4),false,label+': no unchanged sequence is repeated');
    for(const block of w.main.blocks.slice(1,3)) {
      assert.ok(new Set(block.exercises.map(e=>e.id)).size>=6,label+': '+block.id+' draws many movements');
      assert.ok(new Set(block.occurrenceTargets.map(t=>t.plannedPrescription.value)).size>1,label+': doses are not cloned');
    }
    for(const [index,block] of w.main.blocks.entries())for(const [i,target] of block.occurrenceTargets.entries()) {
      const e=block.exercises[i],cap=G.sideCount(e)===2?(difficulty==='easy'?30:difficulty==='hard'?40:35):(index===3?50:difficulty==='easy'?35:difficulty==='hard'?50:45);
      assert.ok(target.plannedPrescription.value<=cap,label+': no dose beyond the family caps');
      if(M.isStatic(e.id))assert.ok(target.plannedPrescription.value<=30,label+': a static stretch is not lengthened to fill time');
    }
  }
});

test('the two internal styles stay distinguishable in v2 and never double as the regional emphasis',()=>{
  const joint=v2({duration:45,random:()=>.1}),flow=v2({duration:45,random:()=>.9});
  assert.equal(joint.familyStyleId,'joint-focused');assert.equal(flow.familyStyleId,'integrated-flow');
  assert.ok(joint.main.blocks[1].estimatedSeconds>flow.main.blocks[1].estimatedSeconds);
  assert.ok(joint.main.blocks[2].estimatedSeconds<flow.main.blocks[2].estimatedSeconds);
  assert.ok(flow.main.blocks[2].occurrenceRecoverySeconds.includes(3));assert.ok(!joint.main.blocks[2].occurrenceRecoverySeconds.includes(3));
  assert.ok(joint.main.blocks[1].occurrenceRecoverySeconds.includes(7));
  const legacy=v2({focus:'strength',workoutStyle:'pyramid',bodyFocus:'upper'}),plain=v2();delete plain.id;delete legacy.id;assert.deepEqual(legacy,plain);
  assert.throws(()=>v2({familyStyleId:'upper-body'}),e=>e.code==='invalid-family-request');
  // Style and emphasis are independent draws: each style pairs with a lower-body, shoulder/upper-back and full-body session.
  for(const [style,styleDraw] of [['joint-focused',.1],['integrated-flow',.9]])for(const [emphasis,emphasisDraw] of [['lower',.1],['upper',.5],['full',.9]]) {
    const w=v2({duration:10,random:forced([styleDraw,emphasisDraw],5)}),focus=stage(w,1);
    assert.equal(w.familyStyleId,style);
    if(emphasis==='full')assert.ok(M.REGIONS.every(region=>regionShare(focus,region)>=.25&&regionShare(focus,region)<=.45),style+' full-body focus is balanced');
    else assert.ok(regionShare(focus,emphasis)>=.5,style+'/'+emphasis);
  }
});

test('v2 restrictions: Easy, TRX owned or not, supported squat rocks, excluded impact and positions stay honest',()=>{
  const used=extra=>new Set(Array.from({length:4},(_,i)=>ids(v2({random:rng(i+1),...extra}))).flat());
  for(const duration of [10,20,45]) {
    const easy=used({duration,difficulty:'easy',equipment:['trx']});
    assert.ok(!easy.has('cossack-squat')&&!easy.has('runners-stretch'),duration+': Easy excludes medium impact and the plank-bearing stretch');
    assert.ok(![...used({duration})].some(id=>TRX_ONLY.includes(id)),duration+': no TRX movement without a TRX');
    assert.ok(![...used({duration,equipment:['dumbbells','bands','bench']})].some(id=>TRX_ONLY.includes(id)),duration+': other equipment is not a support');
    if(duration>=20)assert.ok(used({duration,equipment:['trx']}).has('supported-squat-rocks'),duration+': supported squat rocks appear with an owned TRX');
    assert.ok(!used({duration,excludedImpact:['medium','high']}).has('cossack-squat'));
  }
  // Honest infeasibility: the same family version, never another family or a relaxed rule.
  const infeasible=extra=>assert.throws(()=>v2(extra),e=>e.code==='family-not-feasible'&&e.workoutFamilyId===FAMILY&&e.workoutFamilyVersion===2,JSON.stringify(extra));
  for(const duration of [10,45]) {
    infeasible({duration,bodyPositions:['standing']});
    infeasible({duration,bodyPositions:['hanging']});infeasible({duration,bodyPositions:['supported']});
    infeasible({duration,excludedImpact:['low']});
  }
  infeasible({duration:45,bodyPositions:['floor']});
  const floor=v2({duration:20,bodyPositions:['floor']});
  assert.ok(ids(floor).every(id=>C[id].bodyPosition==='floor'),'a floor-only request gets a floor-only session');
  assert.deepEqual(valid(floor),PASSES);
  const standing=v2({duration:20,bodyPositions:['standing'],equipment:['trx']});
  assert.ok(ids(standing).every(id=>C[id].bodyPosition==='standing'));assert.deepEqual(valid(standing,['trx']),PASSES);
  const error=(()=>{try{v2({bodyPositions:['hanging']});}catch(e){return e;}return null;})();
  assert.ok(error.adjustments.some(item=>item.code==='remove-body-position-restriction'),'only verified adjustments are offered');
  for(const extra of [{bodyPositions:[]},{excludedImpact:null},{movementRoom:'yes'}])assert.throws(()=>v2(extra),e=>e.code==='invalid-family-context');
});

test('swaps and edits cannot bypass v2 membership, protocol, timing or quality gates',()=>{
  const w=v2({duration:20,equipment:['trx'],random:rng(7)});
  for(const [block,index] of [[0,0],[1,2],[2,1],[3,0]]) {
    const edited=copy(w);
    G.swap(edited,block,index,{catalogue:C,equipment:['trx'],random:rng(11)});
    assert.deepEqual(valid(edited,['trx']),PASSES,'swap '+block+':'+index);
    assert.ok(edited.main.blocks.flatMap(b=>b.exercises).every(e=>V2_MEMBERS.includes(e.id)));
  }
  const loaded=copy(w);loaded.main.blocks[1].exercises[0]=copy(C['goblet-squat']);
  assert.equal(G.validateFamilyWorkout(loaded,{catalogue:C,equipment:['trx']}).valid,false);
  const stretched=copy(w);stretched.main.blocks[2].exercises[0]=copy(C['childs-pose']);
  assert.equal(G.validateFamilyWorkout(stretched,{catalogue:C,equipment:['trx']}).valid,false,'a static hold is not a Flow movement');
  const relabelled=copy(w);relabelled.workoutFamilyVersion=1;relabelled.main.blocks.forEach(b=>{b.familyContext.workoutFamilyVersion=1;});
  assert.equal(G.validateFamilyWorkout(relabelled,{catalogue:C,equipment:['trx']}).valid,false,'v2 movements are not a valid v1 session');
});

const v3=extra=>generate({workoutFamilyVersion:3,...extra}),M3=M.forVersion(3);
test('published Mobility v2 seeded composition and saved interpretation are unchanged by v3 (#272)',()=>{
  const sessions=[],historical=catalogueBeforePrepP1(C);
  for(const duration of [10,20,45])for(const difficulty of ['easy','normal','hard'])for(const equipment of [[],['trx']])for(const seed of [1,31,2026]) {
    const options={duration,difficulty,equipment};
    const w=historicalGenerate(historical,{...options,workoutFamilyVersion:2,random:rng(seed)});
    assert.deepEqual(composition(v2({...options,random:rng(seed)})),composition(w),'live catalogue preserves v2 composition');
    delete w.id;sessions.push(w);
  }
  assert.equal(createHash('sha256').update(JSON.stringify(sessions)).digest('hex'),'1ec309aaf74c9bc78f70789cae529eb0e33fcd42c363e4b5ad0af63163902981');
  for(const w of [sessions[0],sessions.at(-1)]) {
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),w);
    assert.deepEqual(valid(w,w.main.blocks.some(b=>b.exercises.some(ex=>ex.equipment.length))?['trx']:[]),PASSES);
  }
  assert.deepEqual(M.regionsOf('upward-facing-dog'),[],'v2 map stays frozen');
  assert.throws(()=>M.forVersion(1),RangeError);assert.throws(()=>M.forVersion(99),RangeError);
  assert.deepEqual(M3.regionsOf('upward-facing-dog'),['trunk','upper']);
});

test('all 21 v3 additions are actually selected in bounded appropriate stages and doses (#272)',()=>{
  // Ten fixed sessions cover every admitted identity; no runtime seed search.
  const fixtures=[[10,'easy',1],[10,'easy',2026],[10,'easy',424242],[10,'normal',1],[10,'normal',424242],
    [20,'easy',1],[20,'easy',31],[45,'easy',31],[45,'easy',2026],[45,'easy',424242]];
  const missing=new Set(Object.keys(C).filter(id=>ROLES.some(role=>F.getMembership({workoutFamilyId:FAMILY,workoutFamilyVersion:3,role},id))&&!V2_MEMBERS.includes(id)));
  assert.equal(missing.size,21);
  for(const [duration,difficulty,seed] of fixtures) {
    const w=v3({duration,difficulty,random:rng(seed)});assert.deepEqual(valid(w),PASSES);
    for(const b of w.main.blocks)for(const item of G.resolvedOccurrences(b)) {
      const ex=item.exercise,entry=F.getMembership(b.familyContext,ex.id),p=entry.prescriptions.find(p=>p.type===(G.sideCount(ex)===2?'unilateral-timed':'timed'));
      assert.ok(item.seconds>=p.minValue&&item.seconds<=p.maxValue,ex.id+' per-occurrence bounds');
      assert.deepEqual(ex,C[ex.id]);missing.delete(ex.id);
      if(M3.isStatic(ex.id))assert.ok(['focused','finish'].includes(b.familyContext.role),ex.id);
    }
  }
  assert.deepEqual([...missing],[]);
});

test('v3 preserves duration, stages, regional coverage, active Flow and gated loaded poses across representative settings (#272)',()=>{
  const seen=new Set();
  for(const {duration,difficulty,equipment} of MATRIX) {
    const w=v3({duration,difficulty,equipment,random:rng(733)});
    assert.deepEqual(valid(w,equipment),PASSES);assert.equal(w.estimatedSeconds,duration*60);
    assert.deepEqual(w.main.blocks.map(b=>b.familyContext.role),ROLES);
    assert.deepEqual(G.trainingSectionPlan(w).blocks.map(b=>b.section),['warmup','main','main','cooldown']);
    assert.equal(hasRepeatedRun(ids(w),4),false);
    const minimum=duration===10?1:duration<=20?2:3;
    for(const region of M3.REGIONS)assert.ok(new Set(ids(w).filter(id=>M3.regionsOf(id).includes(region))).size>=minimum);
    for(const b of w.main.blocks) {
      assert.deepEqual(G.validateOccurrenceRecovery(b),[]);
      for(const item of G.resolvedOccurrences(b)) {
        const ex=item.exercise;seen.add(ex.id);
        assert.ok(G.generatedPhaseEligible(ex,'main',equipment,difficulty,b.familyContext));
        if(difficulty==='easy')assert.notEqual(ex.id,'upward-facing-dog');
        if(['prep','flow'].includes(b.familyContext.role))assert.equal(M3.isStatic(ex.id),false,ex.id);
      }
    }
    assert.ok(levelChanges(w.main.blocks.at(-1).exercises)<=1);
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),copy(w));
  }
  assert.ok(seen.has('upward-facing-dog'));assert.ok(seen.has('downward-facing-dog'));
  // Approved active holds can coexist with their canonical combined transition; NEAR is a preference.
  let combined=false;const flowPoses=new Set();
  for(const seed of [1,31,733]) {
    const w=v3({duration:45,difficulty:'normal',random:rng(seed)}),all=ids(w);
    combined ||= all.includes('downward-upward-dog')&&all.includes('downward-facing-dog');
    for(const ex of w.main.blocks[2].exercises)if(['upward-facing-dog','downward-facing-dog'].includes(ex.id))flowPoses.add(ex.id);
    for(const block of w.main.blocks.filter(b=>b.familyContext.role==='flow'))for(const ex of block.exercises)
      if(ex.id==='upward-facing-dog'||ex.id==='downward-facing-dog')assert.deepEqual(valid(w),PASSES);
  }
  assert.ok(combined,'near variants are not exclusions');
  assert.deepEqual([...flowPoses].sort(),['downward-facing-dog','upward-facing-dog'],'both approved active holds actually enter Flow');
  const floor=v3({duration:20,difficulty:'easy',bodyPositions:['floor'],random:rng(31)});
  assert.deepEqual(valid(floor),PASSES);
  assert.ok(floor.main.blocks[0].exercises.some(ex=>ex.id==='quadruped-wrist-rocks'),'wrist Prepare is reachable with an appropriate floor constraint');
  const altered=copy(v3({duration:20}));altered.main.blocks[2].exercises[0]=C['butterfly-stretch'];
  assert.equal(M3.isStatic('butterfly-stretch'),true);
  assert.equal(valid(altered).valid,false,'passive static membership cannot enter Flow');
});


test('v3 retains both pacing styles and soft completed-exercise recency using versioned regional evidence (#272)',()=>{
  const joint=v3({duration:20,random:forced([.1,.1],31)}),flow=v3({duration:20,random:forced([.9,.1],31)});
  assert.equal(joint.familyStyleId,'joint-focused');assert.equal(flow.familyStyleId,'integrated-flow');
  assert.ok(joint.main.blocks[1].estimatedSeconds>flow.main.blocks[1].estimatedSeconds);
  assert.deepEqual(valid(joint),PASSES);assert.deepEqual(valid(flow),PASSES);
  const fresh=v3({duration:10,random:rng(31)}),prior=ids(fresh),after=v3({duration:10,history:[prior],random:rng(31)});
  assert.ok(ids(after).filter(id=>prior.includes(id)).length<prior.length,'completed exercise recency prefers alternatives');
  assert.ok(ids(after).some(id=>prior.includes(id)),'recency never becomes a hard exclusion');
  assert.deepEqual(valid(after),PASSES);
  const addedLower=['standing-calf-stretch','bent-knee-calf-stretch','seated-ninety-ninety-hip-lift-offs','supine-hamstring-stretch'];
  assert.equal(M3.inferEmphasis(addedLower),'lower');assert.equal(M.inferEmphasis(addedLower),null,'v2 does not reinterpret new identities');
  const recent={recentFamilySessions:{[FAMILY]:{workoutFamilyVersion:3,plannedOccurrences:4,
    completedOccurrences:addedLower.map(exerciseId=>({exerciseId,blockIndex:1}))}}};
  assert.equal(M3.recentEmphasis(recent),'lower');
  recent.recentFamilySessions[FAMILY].plannedOccurrences=8;
  assert.equal(M3.recentEmphasis(recent),null,'partial evidence stays ambiguous');
});
