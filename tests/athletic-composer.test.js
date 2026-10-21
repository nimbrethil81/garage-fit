const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
global.window=global;
for(const path of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','data/athletic-membership','js/athletic-composer'])require('../'+path);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises,FAMILY='athletic-movement';
const PROFILES={10:[120,180,180,120],15:[180,240,300,180],20:[180,360,360,300],30:[240,540,600,420],45:[300,840,900,660]};
const SEEDS=[1,31,733,2026,424242,0xdeadbeef,987654321,2147483647];
const copy=x=>JSON.parse(JSON.stringify(x));
function rng(seed){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const generate=(extra={})=>G.generate({workoutFamilyId:FAMILY,duration:20,difficulty:'normal',catalogue:C,equipment:[],random:rng(31),...extra});
const seconds=phases=>phases.reduce((sum,p)=>sum+(p.kind==='exercise'?(p.timed?p.seconds:p.estimatedSeconds/G.sideCount(p.exercise)):p.seconds),0);
const stage=b=>b.id.split('-')[1];
const resolved=w=>w.main.blocks.flatMap(b=>G.resolveBlockSteps(b).filter(s=>s.kind==='exercise').map(s=>({b,s,ex:b.exercises[s.exerciseIndex]})));
const SCENARIOS=[{}, {movementRoom:true}, {movementRoom:true,excludedImpact:['medium','high']},
  {movementRoom:true,excludedImpact:[]}, {movementRoom:false,bodyPositions:['standing'],equipment:['trx','dumbbells']}];

test('five durations × three difficulties × eight seeds × five constraints share exact canonical player plans',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  vm.runInContext(fs.readFileSync('js/rampup-ui.js','utf8'),app);
  const styles=new Set();let sessions=0;
  for(const duration of Object.keys(PROFILES).map(Number))for(const difficulty of ['easy','normal','hard'])for(const seed of SEEDS)for(const constraint of SCENARIOS) {
    const w=generate({duration,difficulty,...constraint,random:rng(seed)});sessions++;styles.add(w.familyStyleId);
    assert.equal(w.workoutFamilyId,FAMILY);assert.equal(w.workoutFamilyVersion,1);assert.equal(w.bodyFocus,'full-body');
    assert.equal(w.estimatedSeconds,duration*60);assert.equal(G.mainSeconds(w.main.blocks,w.setupEquipment),duration*60);
    assert.deepEqual(G.validateMain(w.main,C,w.setupEquipment,duration*60),[]);
    assert.ok(['warmup','rampup','cooldown'].every(key=>w[key].exercises.length===0&&w[key].estimatedSeconds===0));
    const stages=w.main.blocks.map(stage);
    assert.equal(stages[0],'preparation');assert.equal(stages.at(-1),'finish');
    assert.ok(stages.indexOf('footwork')<stages.indexOf('control'));assert.ok(stages.indexOf('control')<stages.indexOf('integrated'));
    const allocation=[0,0,0,0];
    for(const [index,b] of w.main.blocks.entries()) {
      const phase=stage(b)==='preparation'?0:stage(b)==='footwork'?1:stage(b)==='control'?2:3;
      allocation[phase]+=b.estimatedSeconds+(index<w.main.blocks.length-1?G.BLOCK_TRANSITION_SECONDS:0);
      assert.ok(b.exercises.length>=2&&b.exercises.length<=4);
      assert.ok(new Set(b.exercises.map(ex=>ex.id)).size>=2);
      assert.ok(b.prescription.rounds>=1&&b.prescription.rounds<=6);
      assert.deepEqual(G.validateOccurrenceTargets(b,C),[]);assert.deepEqual(G.validateOccurrenceRecovery(b),[]);
      assert.ok(b.occurrenceRecoverySeconds.every(n=>n>=8&&n<=65));
      assert.equal(b.exercises[0].bodyPosition,'standing');assert.equal(b.exercises.at(-1).bodyPosition,'standing');
      const steps=G.resolveBlockSteps(b),work=steps.filter(s=>s.kind==='exercise');
      assert.equal(steps.reduce((sum,s)=>sum+(s.kind==='exercise'?s.estimatedSeconds:s.seconds),0),b.estimatedSeconds);
      assert.equal(steps.at(-1).kind,'exercise');
      for(const [i,s] of work.entries()) {
        const ex=b.exercises[s.exerciseIndex],p=s.plannedPrescription;
        assert.deepEqual(ex,C[ex.id]);assert.ok(F.getMembership(b.familyContext,ex.id));
        assert.ok(G.generatedPhaseEligible(ex,'main',w.setupEquipment,difficulty,b.familyContext));
        assert.equal(s.estimatedSeconds,p.value*G.sideCount(ex));
        assert.equal(p.type,G.sideCount(ex)===2?'unilateral-timed':'timed');
        assert.ok(p.value>=10&&p.value<=30);if(G.sideCount(ex)===2)assert.ok(p.value<=22);
        if(ex.impact==='high')assert.ok(difficulty==='hard'&&constraint.movementRoom===true&&constraint.excludedImpact?.length===0&&p.value<=15);
        if(!constraint.movementRoom)assert.ok(!F.getMembership(b.familyContext,ex.id).requiresMovementRoom);
        if(i<work.length-1) {
          const next=b.exercises[work[i+1].exerciseIndex],gap=b.occurrenceRecoverySeconds[i];
          if(ex.impact==='high'||next.impact==='high')assert.ok(gap>=40);
          else if(ex.bodyPosition!==next.bodyPosition||ex.bodyPosition==='floor')assert.ok(gap>=25);
          else if(ex.impact==='medium'||next.impact==='medium')assert.ok(gap>=20);
          else if(G.sideCount(ex)===2||G.sideCount(next)===2)assert.ok(gap>=16);
        }
      }
      if(stage(b)==='integrated')assert.ok(['reset','finish'].includes(stage(w.main.blocks[index+1])),'demanding practice leads into active recovery');
    }
    for(let phase=0;phase<4;phase++)assert.ok(Math.abs(allocation[phase]-PROFILES[duration][phase])<=Math.max(...PROFILES[duration])*.081);
    const work=resolved(w),ids=new Set(work.map(item=>item.ex.id));
    for(const id of ['forward-back-line-steps','lateral-step-and-stick','quarter-turn-pivot-steps','single-leg-balance-reach','knee-to-opposite-elbow'])assert.ok(ids.has(id),id);
    assert.ok(work.filter(item=>item.b.familyContext.role==='integrated').length>=2);
    for(let i=1;i<work.length;i++)assert.ok(work[i-1].ex.impact!=='high'||work[i].ex.impact!=='high','including rounds and block boundaries');
    const strengthSeconds=work.filter(item=>item.ex.strength>=3).reduce((sum,item)=>sum+item.s.estimatedSeconds,0);
    assert.ok(strengthSeconds<duration*60*.3,'strength-like approved combinations remain a minority');
    if(duration>=30)assert.ok(new Set(w.main.blocks.filter(b=>stage(b)==='control').map(b=>b.exercises.map(e=>e.id).join(','))).size>=3,'varied balance/control combinations');
    app.input=copy(w);const timeline=app.buildGeneratedTimeline(app.input),phases=timeline.filter(p=>p.kind==='exercise');
    assert.equal(seconds(timeline)-3,w.estimatedSeconds);
    const plan=app.GarageFitSessionTracker.plannedWorkFromTimeline(timeline);
    assert.equal(plan.length,phases.length);assert.equal(new Set(plan.map(p=>p.occurrenceId)).size,plan.length);
    assert.ok(timeline.filter(p=>p.kind!=='exercise').every(p=>!p.occurrenceId));
    let cursor=0;
    for(const {s,ex} of work)for(let side=0;side<G.sideCount(ex);side++) {
      const p=phases[cursor],planned=plan[cursor++];
      assert.equal(p.exercise.id,ex.id);assert.equal(p.seconds,s.plannedPrescription.value);
      assert.deepEqual(copy(p.plannedPrescription),copy(s.plannedPrescription));
      assert.equal(planned.occurrenceId,p.occurrenceId);
      if(side===1)assert.equal(timeline.indexOf(p),timeline.indexOf(phases[cursor-2])+1,'sides are consecutive without rest');
    }
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),copy(w));
  }
  assert.equal(sessions,600);assert.deepEqual([...styles].sort(),['dynamic-balance','footwork-coordination','integrated-movement']);
});

test('three automatic styles change phase emphasis, drill choices and technical pacing',()=>{
  const workouts=[.1,.5,.9].map(value=>generate({duration:30,movementRoom:true,random:()=>value}));
  const budgets=w=>['footwork','control','integrated'].map(s=>w.main.blocks.filter(b=>stage(b)===s).reduce((sum,b)=>sum+b.estimatedSeconds+3,0));
  assert.ok(budgets(workouts[0])[0]>budgets(workouts[1])[0]);
  assert.ok(budgets(workouts[1])[1]>budgets(workouts[0])[1]);
  assert.ok(budgets(workouts[2])[2]>budgets(workouts[0])[2]);
  const balanceDose=w=>resolved(w).filter(x=>x.ex.id==='single-leg-balance-reach').map(x=>x.s.plannedPrescription.value);
  assert.ok(Math.max(...balanceDose(workouts[1]))>Math.max(...balanceDose(workouts[0])));
  const a=generate(),b=generate({focus:'cardio',workoutStyle:'density',bodyFocus:'upper'});delete a.id;delete b.id;assert.deepEqual(a,b);
  assert.throws(()=>generate({familyStyleId:'dynamic-balance'}),e=>e.code==='invalid-family-request');
});

test('high impact is optional on Hard, reachable only by opt-in and never adjacent across the whole workout',()=>{
  let withHigh=0,withoutHigh=0;
  for(let seed=0;seed<100;seed++) {
    const w=generate({duration:45,difficulty:'hard',movementRoom:true,excludedImpact:[],random:rng(seed*98765431)});
    const work=resolved(w),high=work.filter(x=>x.ex.impact==='high');
    if(high.length)withHigh++;else withoutHigh++;
    for(const {b} of high)assert.equal(w.familyStyleId,'integrated-movement');
    for(const b of w.main.blocks){assert.notEqual(b.exercises[0].impact,'high');assert.notEqual(b.exercises.at(-1).impact,'high');}
    for(let i=1;i<work.length;i++)assert.ok(work[i-1].ex.impact!=='high'||work[i].ex.impact!=='high');
  }
  assert.ok(withHigh>0&&withoutHigh>0);
  for(const difficulty of ['easy','normal','hard'])assert.ok(resolved(generate({difficulty,movementRoom:true})).every(x=>x.ex.impact!=='high'));
});

test('constraints fail honestly when approved integrated movement cannot be composed',()=>{
  for(const extra of [{excludedImpact:['medium','high']},{excludedImpact:['low']},{bodyPositions:['floor']},{bodyPositions:['hanging']}])
    assert.throws(()=>generate(extra),e=>e.code==='family-not-feasible');
  assert.throws(()=>generate({movementRoom:false,excludedImpact:['medium','high']}),e=>e.code==='family-not-feasible'&&/integrated.*confirmed movement room/.test(e.message));
  for(const extra of [{bodyPositions:[]},{movementRoom:'yes'},{excludedImpact:null},{excludedImpact:'high'}])
    assert.throws(()=>generate(extra),e=>e.code==='invalid-family-context');
  for(const extra of [{duration:5},{difficulty:'maximal'}])assert.throws(()=>generate(extra),e=>e.code==='family-configuration-unsupported');
  assert.throws(()=>generate({sessionPrescription:{}}),e=>e.code==='family-prescription-unsupported');
  const low=generate({movementRoom:true,excludedImpact:['medium','high']});
  assert.ok(resolved(low).every(x=>x.ex.impact==='low'));
  assert.ok(resolved(low).filter(x=>x.b.familyContext.role==='integrated').every(x=>['bear-crawl','grapevine-cross-steps'].includes(x.ex.id)));
});

test('production and test harness register the same single version-pinned composer',()=>{
  assert.throws(()=>G.registerFamilyComposer(FAMILY,1,()=>{}),/registered once/);
  assert.throws(()=>G.registerFamilyComposer(FAMILY,2,()=>{}),e=>e.code==='unsupported-workout-family-version');
  assert.match(fs.readFileSync('index.html','utf8'),/data\/athletic-membership.js[\s\S]*js\/athletic-composer.js/);
  const app=loadAppContext(new Map());
  assert.equal(app.GarageFitGenerator.generate({workoutFamilyId:FAMILY,duration:10,catalogue:app.GarageFitData.exercises,random:()=>.2}).workoutFamilyId,FAMILY);
});
