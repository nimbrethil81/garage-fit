const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
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
    assert.ok(['warmup','rampup','cooldown'].every(key=>w[key].exercises.length===0&&w[key].estimatedSeconds===0));
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
  assert.throws(()=>G.registerFamilyComposer(FAMILY,2,()=>{}),e=>e.code==='unsupported-workout-family-version');
  assert.match(fs.readFileSync('index.html','utf8'),/data\/mobility-membership.js[\s\S]*js\/mobility-composer.js/);
  const app=loadAppContext(new Map());
  assert.equal(app.GarageFitGenerator.generate({workoutFamilyId:FAMILY,duration:10,catalogue:app.GarageFitData.exercises,random:()=>.2}).workoutFamilyId,FAMILY);
});
