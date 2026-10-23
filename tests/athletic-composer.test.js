const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {loadAppContext}=require('./helpers/app-context');
global.window=global;
for(const path of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','data/athletic-membership','js/athletic-composer'])require('../'+path);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises,FAMILY='athletic-movement';
// New workouts use the current published composition (v3). v1 and v2 stay composable and are pinned below.
const VERSION=F.currentVersion(FAMILY);
const PROFILES={10:[120,180,180,120],15:[180,240,300,180],20:[180,360,360,300],30:[240,540,600,420],45:[300,840,900,660]};
const SEEDS=[1,31,733,2026,424242,0xdeadbeef,987654321,2147483647];
const copy=x=>JSON.parse(JSON.stringify(x));
function rng(seed){return ()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const generate=(extra={})=>G.generate({workoutFamilyId:FAMILY,workoutFamilyVersion:VERSION,duration:20,difficulty:'normal',catalogue:C,equipment:[],random:rng(31),...extra});
const v1=(extra={})=>generate({workoutFamilyVersion:1,...extra});
const v3=(extra={})=>generate({workoutFamilyVersion:3,...extra});
// Structural identity of a composition: blocks, drills, rounds, resolved targets and recoveries.
const shape=w=>[w.familyStyleId,w.main.blocks.map(b=>[b.id,b.exercises.map(e=>e.id),b.prescription.rounds,b.occurrenceTargets.map(t=>t.plannedPrescription.value),b.occurrenceRecoverySeconds])];
const scripts=w=>w.main.blocks.map(b=>b.id+': '+b.exercises.map(e=>e.id).join(', '));
const seconds=phases=>phases.reduce((sum,p)=>sum+(p.kind==='exercise'?(p.timed?p.seconds:p.estimatedSeconds/G.sideCount(p.exercise)):p.seconds),0);
const stage=b=>b.id.split('-')[1];
const resolved=w=>w.main.blocks.flatMap(b=>G.resolveBlockSteps(b).filter(s=>s.kind==='exercise').map(s=>({b,s,ex:b.exercises[s.exerciseIndex]})));
const SCENARIOS=[{}, {movementRoom:true}, {movementRoom:true,excludedImpact:['medium','high']},
  {movementRoom:true,excludedImpact:[]}, {movementRoom:false,bodyPositions:['standing'],equipment:['trx','dumbbells']}];

// Representative production construction stays in Fast; the full matrix samples every constraint/seed combination.
test('representative Athletic sessions preserve eligibility, exact budgets and durable player plans',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  for(const [duration,difficulty,movementRoom] of [[10,'easy',false],[20,'normal',true],[45,'hard',true]]) {
    const w=generate({duration,difficulty,movementRoom});
    assert.deepEqual(G.validateMain(w.main,C,w.setupEquipment,duration*60),[]);
    assert.equal(w.estimatedSeconds,duration*60);
    assert.ok(resolved(w).every(({b,ex})=>G.generatedPhaseEligible(ex,'main',w.setupEquipment,difficulty,b.familyContext)&&ex.impact!=='high'));
    app.input=copy(w);const timeline=app.buildGeneratedTimeline(app.input);
    assert.equal(seconds(timeline)-3,duration*60);
    const plan=app.GarageFitSessionTracker.plannedWorkFromTimeline(timeline);
    assert.equal(plan.length,timeline.filter(p=>p.kind==='exercise').length);
    assert.equal(new Set(plan.map(p=>p.occurrenceId)).size,plan.length);
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),copy(w));
  }
});

test('[Full] five durations × three difficulties × eight seeds × five constraints share exact canonical player plans',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  vm.runInContext(fs.readFileSync('js/rampup-ui.js','utf8'),app);
  const styles=new Set();let sessions=0;
  // Published v1 stays exactly as released: one structural digest of the same 600 compositions.
  const digest=crypto.createHash('sha256'),digestV2=crypto.createHash('sha256'),digestV3=crypto.createHash('sha256');
  for(const duration of Object.keys(PROFILES).map(Number))for(const difficulty of ['easy','normal','hard'])for(const seed of SEEDS)for(const constraint of SCENARIOS) {
    digest.update(JSON.stringify(shape(v1({duration,difficulty,...constraint,random:rng(seed)}))));
    digestV2.update(JSON.stringify(shape(generate({workoutFamilyVersion:2,duration,difficulty,...constraint,random:rng(seed)}))));
    digestV3.update(JSON.stringify(shape(v3({duration,difficulty,...constraint,random:rng(seed)}))));
    const w=generate({duration,difficulty,...constraint,random:rng(seed)});sessions++;styles.add(w.familyStyleId);
    assert.equal(w.workoutFamilyId,FAMILY);assert.equal(w.workoutFamilyVersion,VERSION);assert.equal(w.bodyFocus,'full-body');
    assert.equal(w.familyDiagnostics,undefined,'the seeded style builds first time');
    assert.equal(w.estimatedSeconds,duration*60);assert.equal(G.mainSeconds(w.main.blocks,w.setupEquipment),duration*60);
    assert.deepEqual(G.validateMain(w.main,C,w.setupEquipment,duration*60),[]);
    // #242: no generic sequence is appended (structural sections stay empty), but the family's own
    // preparation and finish read as Warm-up/Cool-down; control resets stay Main; no Ramp-up.
    assert.ok(['warmup','rampup','cooldown'].every(key=>w[key].exercises.length===0&&w[key].estimatedSeconds===0));
    const sections=G.trainingSectionPlan(w);
    assert.deepEqual(sections.blocks.map(b=>b.section),w.main.blocks.map(b=>stage(b)==='preparation'?'warmup':stage(b)==='finish'?'cooldown':'main'));
    assert.ok(sections.seconds.warmup>0&&sections.seconds.cooldown>0&&sections.seconds.rampup===0);
    // v2 finish: about one minute, two from 30 minutes; it flexes only to fit bounded integrated work.
    const finish=duration>=30?120:60;
    assert.ok(sections.seconds.cooldown>=30&&sections.seconds.cooldown<=finish+20&&(duration<15||Math.abs(sections.seconds.cooldown-finish)<=5),'finish '+sections.seconds.cooldown);
    assert.equal(sections.seconds.warmup+sections.seconds.main+sections.seconds.cooldown,duration*60);
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
    // Essential practice is by role, not by identity: all three planes of footwork and single-leg balance.
    assert.deepEqual(['sagittal','frontal','transverse'].filter(plane=>!work.some(item=>item.b.familyContext.role==='footwork'&&item.ex.movementPlanes.includes(plane))),[]);
    assert.ok(work.some(item=>item.b.familyContext.role==='control'&&item.ex.sidedness==='per-side'&&item.ex.bodyPosition==='standing'));
    assert.ok(ids.has('knee-to-opposite-elbow'));
    assert.ok(work.filter(item=>item.b.familyContext.role==='integrated').length>=2);
    for(let i=1;i<work.length;i++)assert.ok(work[i-1].ex.impact!=='high'||work[i].ex.impact!=='high','including rounds and block boundaries');
    const strengthSeconds=work.filter(item=>item.ex.strength>=3).reduce((sum,item)=>sum+item.s.estimatedSeconds,0);
    assert.ok(strengthSeconds<duration*60*.3,'strength-like approved combinations remain a minority');
    // Purposeful blocks (v3): every Main block brings at least two drills no earlier Main block practised
    // (warm-up, resets and finish are bookends), so a spent approved pool consolidates instead of relabelling.
    const seen=new Set();
    for(const b of w.main.blocks.filter(b=>['footwork','control','integrated'].includes(stage(b)))) {
      const ids=[...new Set(b.exercises.map(e=>e.id))];
      assert.ok(ids.filter(id=>!seen.has(id)).length>=Math.min(2,ids.length),'redundant '+b.id);
      ids.forEach(id=>seen.add(id));
    }
    assert.ok(w.main.blocks.filter(b=>stage(b)==='control').every(b=>b.exercises.some(e=>e.sidedness==='per-side'&&e.bodyPosition==='standing')),'every control drill keeps standing single-leg work');
    if(duration<=20)assert.equal(w.main.blocks.length,5,'short sessions are not fragmented');
    // A control block per further four minutes only while it brings fresh balance work (never a copy).
    const controls=w.main.blocks.filter(b=>stage(b)==='control').length;
    assert.ok(controls>=1&&controls<=Math.max(1,Math.floor(PROFILES[duration][2]/240)),'control blocks '+controls);
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
  assert.equal(digest.digest('hex'),'e8ac4393c44c34659ed325ff2cb5c1ebc5627b31c6eaa0c4dbc6b37e15e1eab4','published Athletic v1 compositions are unchanged');
  assert.equal(digestV2.digest('hex'),'1a5a6bd0421b8457853c062ac761dc70a621e9bb63b12e929f81210f5a604efa','published Athletic v2 compositions are unchanged');
  assert.equal(digestV3.digest('hex'),'d128234ca653a0bb06473fe46f054d71ef14bbb46c5d3b8463d28a0110316c02','published Athletic v3 compositions are unchanged');
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

test('production and test harness register the same version-pinned composers; new workouts use v4',()=>{
  for(const version of [1,2,3,4])assert.throws(()=>G.registerFamilyComposer(FAMILY,version,()=>{},()=>[]),/registered once/);
  assert.throws(()=>G.registerFamilyComposer(FAMILY,5,()=>{}),e=>e.code==='unsupported-workout-family-version');
  // Every later version is the same family (identity, styles, membership) with a new composition policy; the default lookup stays v1.
  const [one,two,three,four]=[1,2,3,4].map(version=>F.getDefinition(FAMILY,version));
  assert.equal(F.getDefinition(FAMILY),one);assert.equal(VERSION,4);
  // v2 and v3 reuse membership v1; v4 (#255) resolves the extended membership v2.
  for(const [definition,version,membership] of [[two,2,1],[three,3,1],[four,4,2]]) {
    assert.deepEqual({...copy(definition),version:1,compositionPolicy:one.compositionPolicy,membershipPolicy:one.membershipPolicy},copy(one));
    assert.deepEqual(copy(definition.compositionPolicy),{id:FAMILY,version});assert.deepEqual(copy(definition.membershipPolicy),{id:FAMILY,version:membership});
  }
  // Strength & Control (#261) and Mobility (#264) moved to v2; every other family is still at its first published version.
  for(const id of F.FAMILY_IDS.filter(id=>id!==FAMILY))assert.equal(F.currentVersion(id),['strength-control','mobility-movement-quality'].includes(id)?2:1);
  assert.match(fs.readFileSync('index.html','utf8'),/data\/athletic-membership.js[\s\S]*js\/athletic-composer.js/);
  const app=loadAppContext(new Map());
  assert.equal(app.GarageFitGenerator.generate({workoutFamilyId:FAMILY,duration:10,catalogue:app.GarageFitData.exercises,random:()=>.2}).workoutFamilyId,FAMILY);
  // The standalone Generator screen asks for the current version, with no extra user choice.
  app.input=FAMILY;vm.runInContext('selectGeneratorFamily(input);generateWorkout()',app);
  const delivered=vm.runInContext('generatorState.workout',app);
  assert.equal(delivered.workoutFamilyVersion,4);
  assert.equal(app.GarageFitGenerator.validateFamilyWorkout(delivered,{catalogue:app.GarageFitData.exercises,equipment:vm.runInContext('state.ownedEquipment',app)}).valid,true);
});

// #244 acceptance example: the original standalone 30-minute Athletic, Normal, ordinary home space
// (bodyweight, no confirmed movement room). v1 cut each phase into four-minute slices, repeating the
// same three stepping drills, the same balance anchor and the only two integrated lunges.
const V1_30_MINUTE=[
  'athletic-preparation-1: knee-to-opposite-elbow, forward-back-line-steps, quarter-turn-pivot-steps',
  'athletic-footwork-2: forward-back-line-steps, lateral-step-and-stick, quarter-turn-pivot-steps',
  'athletic-footwork-3: lateral-step-and-stick, quarter-turn-pivot-steps',
  'athletic-footwork-4: forward-back-line-steps, lateral-step-and-stick',
  'athletic-control-5: quarter-turn-pivot-steps, single-leg-balance-reach, lateral-step-and-stick',
  'athletic-control-6: lateral-step-and-stick, single-leg-balance-reach, knee-to-opposite-elbow',
  'athletic-control-7: knee-to-opposite-elbow, single-leg-balance-reach, forward-back-line-steps',
  'athletic-integrated-8: alternating-lateral-lunge, reverse-lunge-knee-drive',
  'athletic-reset-9: knee-to-opposite-elbow, quarter-turn-pivot-steps',
  'athletic-integrated-10: reverse-lunge-knee-drive, alternating-lateral-lunge',
  'athletic-finish-11: quarter-turn-pivot-steps, knee-to-opposite-elbow'];
// v2 as published by #251: stages compared only with their own earlier blocks, so control recycled footwork.
const V2_30_MINUTE=[
  'athletic-preparation-1: knee-to-opposite-elbow, forward-back-line-steps, quarter-turn-pivot-steps',
  'athletic-footwork-2: lateral-step-and-stick, forward-back-line-steps, quarter-turn-pivot-steps',
  'athletic-control-3: forward-back-line-steps, single-leg-balance-reach, knee-to-opposite-elbow',
  'athletic-control-4: quarter-turn-pivot-steps, single-leg-balance-reach, lateral-step-and-stick',
  'athletic-integrated-5: reverse-lunge-knee-drive, alternating-lateral-lunge',
  'athletic-finish-6: forward-back-line-steps, quarter-turn-pivot-steps, knee-to-opposite-elbow'];
const MAIN_STAGES=['footwork','control','integrated'];
const retag=(w,version)=>({...copy(w),workoutFamilyVersion:version,main:{...copy(w.main),blocks:w.main.blocks.map(b=>({...copy(b),familyContext:{...b.familyContext,workoutFamilyVersion:version}}))}});
const qualityOf=(w,version)=>G.validateFamilyWorkout(retag(w,version),{catalogue:C,equipment:[]}).qualityIssues.filter(i=>i.startsWith('quality:redundant-block')).sort();
// Drills a Main block shares with earlier Main blocks (warm-up, resets and finish are gentle bookends).
const mainOverlap=w=>{const seen=new Set();return w.main.blocks.filter(b=>MAIN_STAGES.includes(stage(b))).map(b=>{
  const ids=[...new Set(b.exercises.map(e=>e.id))],shared=ids.filter(id=>seen.has(id)).length;ids.forEach(id=>seen.add(id));return b.id+':'+shared+'/'+ids.length;});};

test('30-minute ordinary-space Athletic: v1 slices repeat drills, v2 relabels them across stages, v3 gives each Main block a distinct purpose',()=>{
  const before=v1({duration:30}),middle=generate({workoutFamilyVersion:2,duration:30}),after=v3({duration:30});
  assert.deepEqual(scripts(before),V1_30_MINUTE,'the reported 11-block v1 pattern is reproduced exactly');
  assert.deepEqual(scripts(middle),V2_30_MINUTE,'published v2 composes exactly as released');
  // v1 subsets and reorders: the near-duplicate blocks the v2 gate rejects within a stage.
  assert.deepEqual(qualityOf(before,2),['quality:redundant-block:athletic-footwork-3','quality:redundant-block:athletic-footwork-4','quality:redundant-block:athletic-integrated-10']);
  assert.equal(G.validateFamilyWorkout(before,{catalogue:C,equipment:[]}).valid,true,'saved v1 workouts remain valid under v1 rules');
  // The #244 follow-up: v2's control blocks pass its stage-local gate yet repeat the footwork circuit's
  // drills, so a user saw forward-back and quarter-turn steps in footwork, control, warm-up and cool-down.
  assert.deepEqual(qualityOf(middle,2),[],'v2 passes its own stage-local rule');
  assert.deepEqual(qualityOf(middle,3),['quality:redundant-block:athletic-control-4']);
  assert.deepEqual(mainOverlap(middle),['athletic-footwork-2:0/3','athletic-control-3:1/3','athletic-control-4:3/3','athletic-integrated-5:0/2']);
  // Same seed, same approved pool, no new exercises: preparation → three-direction footwork → one balance/control
  // circuit built from drills footwork has not used plus the least-used stepping partner → integrated lunges → finish.
  assert.deepEqual(scripts(after),[
    'athletic-preparation-1: knee-to-opposite-elbow, forward-back-line-steps, quarter-turn-pivot-steps',
    'athletic-footwork-2: lateral-step-and-stick, forward-back-line-steps, quarter-turn-pivot-steps',
    'athletic-control-3: lateral-step-and-stick, single-leg-balance-reach, knee-to-opposite-elbow',
    'athletic-integrated-4: reverse-lunge-knee-drive, alternating-lateral-lunge',
    'athletic-finish-5: forward-back-line-steps, quarter-turn-pivot-steps, knee-to-opposite-elbow']);
  assert.deepEqual(mainOverlap(after),['athletic-footwork-2:0/3','athletic-control-3:1/3','athletic-integrated-4:0/2']);
  const ids=w=>new Set(w.main.blocks.flatMap(b=>b.exercises.map(e=>e.id)));
  assert.deepEqual([...ids(after)].sort(),[...ids(before)].sort(),'the same approved drills, nothing invented');
  // Consolidated, not thinned: the control circuit repeats within its block for skill practice.
  assert.equal(after.main.blocks[2].prescription.rounds,5);
  const plan=G.trainingSectionPlan(after).seconds;
  assert.deepEqual([plan.warmup,plan.cooldown,after.estimatedSeconds],[240,120,1800]);
  assert.deepEqual(G.trainingSectionPlan(before).seconds.cooldown,76);
  assert.deepEqual(G.validateFamilyWorkout(after,{catalogue:C,equipment:[]}),{valid:true,technicalIssues:[],qualityIssues:[]});
});

test('v3 rejects a constructed cross-stage near-duplicate block, including through preview swaps',()=>{
  const w=v3({duration:30}),index=w.main.blocks.findIndex(b=>stage(b)==='control'),at=id=>w.main.blocks.findIndex(b=>b.id===id);
  const check=workout=>G.validateFamilyWorkout(workout,{catalogue:C,equipment:[]});
  assert.equal(check(w).valid,true);
  // The control circuit swapped to footwork's own stepping drills adds nothing but the balance anchor.
  const dup=copy(w);dup.main.blocks[index].exercises=[C['forward-back-line-steps'],C['single-leg-balance-reach'],C['quarter-turn-pivot-steps']].map(copy);
  assert.deepEqual(check(dup).qualityIssues,['quality:redundant-block:'+w.main.blocks[index].id]);
  // The warm-up, resets and finish are bookends: reusing familiar drills there never counts against Main novelty.
  assert.deepEqual(check(w).qualityIssues,[]);
  assert.ok(w.main.blocks.at(-1).exercises.every(e=>w.main.blocks.slice(0,-1).some(b=>b.exercises.some(x=>x.id===e.id))));
  // Within-block repetition stays valid; the check is only about drills new to the Main session.
  assert.ok(w.main.blocks[index].prescription.rounds>=3);
  // Preview swaps run the same registered gate: whatever a swap produces still passes it, and the
  // swap that would recreate the duplicate (balance-circuit partner → a footwork drill) is never offered.
  let swaps=0;
  for(const [b,block] of w.main.blocks.entries())for(let i=0;i<block.exercises.length;i++) {
    const edited=copy(w);
    try{G.swap(edited,b,i,{catalogue:C,equipment:[],random:rng(b*7+i)});}catch(error){continue;}
    swaps++;
    assert.equal(check(edited).valid,true,'swap '+block.id+'#'+i);
  }
  assert.ok(swaps>0);
  // v2 keeps its published stage-local rule, so saved v2 workouts stay valid.
  assert.equal(check(retag(dup,2)).valid,true);
});

test('v3 depth grows with time and pool: short sessions stay concise, room adds new drills not copies',()=>{
  for(const [duration,extra,count] of [[10,{},5],[15,{movementRoom:true},5],[20,{},5],[30,{},5],[45,{},5],[45,{movementRoom:true},6]]) {
    const w=v3({duration,...extra}),stages=w.main.blocks.map(stage);
    assert.equal(w.main.blocks.length,count,duration+' '+JSON.stringify(extra)+': '+stages.join(','));
    assert.equal(G.validateFamilyWorkout(w,{catalogue:C,equipment:[]}).valid,true);
  }
  // With room at 45 minutes the travelling drills form a second footwork block that brings drills the
  // first block did not; control and integrated work each stay one long, distinct circuit.
  const rich=v3({duration:45,movementRoom:true}),by=name=>rich.main.blocks.filter(b=>stage(b)===name);
  assert.deepEqual(rich.main.blocks.map(stage),['preparation','footwork','footwork','control','integrated','finish']);
  const [a,b]=by('footwork');assert.ok(b.exercises.filter(e=>!a.exercises.some(x=>x.id===e.id)).length>=2);
  assert.ok(by('footwork')[1].exercises.some(e=>['grapevine-cross-steps','lateral-shuffle'].includes(e.id)));
  assert.deepEqual(mainOverlap(rich).map(item=>+item.split(':')[1].split('/')[0]),[0,1,1,0]);
});

test('v3 keeps the integrated pool honest: low-impact practice with room reserves its shared drills',()=>{
  // Low impact with room leaves only grapevine steps and the crawl for integrated work, so footwork
  // leaves the grapevine alone and uses its three core drills instead of spending it first.
  for(const duration of [10,30,45])for(const seed of SEEDS.slice(0,4)) {
    const w=v3({duration,movementRoom:true,excludedImpact:['medium','high'],random:rng(seed)});
    assert.equal(w.familyDiagnostics,undefined);
    assert.deepEqual(mainOverlap(w).map(item=>item.split(':')[1].split('/')[0]).slice(-1),['0'],'integrated practice is new to the session');
    assert.ok(w.main.blocks.filter(b=>stage(b)==='integrated').every(b=>b.exercises.some(e=>e.id==='bear-crawl')));
  }
});

// ---- #255: membership v2 / composition v4 -------------------------------------------------------
const NEW_255=['in-in-out-out-steps','lateral-line-steps','split-stance-step-switches','clock-step-balance','single-leg-hip-hinge-reach',
  'lateral-lunge-to-balance','180-degree-step-turns','lateral-shuffle-and-stop','forward-back-acceleration-and-stop','forward-hop-and-stick','lateral-bound-and-stick'];
const REUSED_255=['fast-feet','side-step-touches','cossack-squat'];
const idsOf=w=>new Set(w.main.blocks.flatMap(b=>b.exercises.map(e=>e.id)));

test('v4 draws the reviewed additions through staged blocks with exact, distinct scripts',()=>{
  assert.deepEqual(scripts(generate({duration:30})),[
    'athletic-preparation-1: knee-to-opposite-elbow, forward-back-line-steps, quarter-turn-pivot-steps',
    'athletic-footwork-2: 180-degree-step-turns, in-in-out-out-steps, forward-back-line-steps',
    'athletic-footwork-3: lateral-step-and-stick, fast-feet, split-stance-step-switches',
    'athletic-control-4: lateral-lunge-to-balance, single-leg-balance-reach, single-leg-hip-hinge-reach',
    'athletic-control-5: quarter-turn-pivot-steps, clock-step-balance, side-step-touches',
    'athletic-integrated-6: reverse-lunge-knee-drive, cossack-squat, alternating-lateral-lunge',
    'athletic-finish-7: forward-back-line-steps, side-step-touches, knee-to-opposite-elbow']);
  // Easy drops the Normal-and-above drills (hinge reach, lateral lunge to balance, 180-degree turns); still staged and novel.
  const easy=generate({duration:30,difficulty:'easy'});
  assert.deepEqual(scripts(easy).map(line=>line.split(':')[0]),['athletic-preparation-1','athletic-footwork-2','athletic-footwork-3','athletic-control-4','athletic-integrated-5','athletic-finish-6']);
  assert.ok(['single-leg-hip-hinge-reach','lateral-lunge-to-balance','180-degree-step-turns'].every(id=>!idsOf(easy).has(id)));
  for(const w of [generate({duration:30}),generate({duration:30,movementRoom:true}),easy])assert.deepEqual(mainOverlap(w).map(item=>+item.split(':')[1].split('/')[0]).filter(n=>n>1),[],'no Main block repeats most of its drills');
  // Published compositions never see the additions (their digests are pinned in the Full matrix).
  for(const version of [1,2,3])assert.ok(NEW_255.concat(REUSED_255).filter(id=>idsOf(generate({workoutFamilyVersion:version,duration:45,movementRoom:true,excludedImpact:[]})).has(id)&&!['fast-feet'].includes(id)).length===0,'v'+version);
});

test('v4 eligibility honours minimum difficulty, confirmed room, impact and per-role membership',()=>{
  const context=(role,extra={})=>({workoutFamilyId:FAMILY,workoutFamilyVersion:4,role,...extra});
  const ok=(id,role,difficulty,extra)=>G.generatedPhaseEligible(C[id],'main',[],difficulty,context(role,{difficulty,...extra}));
  // Normal-and-above: unavailable on Easy only.
  for(const id of ['single-leg-hip-hinge-reach','180-degree-step-turns','lateral-lunge-to-balance']) {
    const role=id==='180-degree-step-turns'?'footwork':'control';
    assert.deepEqual(['easy','normal','hard'].map(d=>ok(id,role,d)),[false,true,true],id);
  }
  // Travelling drills need confirmed room; in-place ones do not.
  for(const [id,role] of [['lateral-shuffle-and-stop','footwork'],['forward-back-acceleration-and-stop','footwork']]) {
    assert.deepEqual([ok(id,role,'normal'),ok(id,role,'normal',{movementRoom:true}),ok(id,role,'easy',{movementRoom:true})],[false,true,false],id);
  }
  for(const id of ['in-in-out-out-steps','lateral-line-steps','split-stance-step-switches'])assert.equal(ok(id,'footwork','easy'),true,id);
  assert.equal(ok('clock-step-balance','control','easy'),true);
  // Landing drills: Hard only, confirmed room, integrated role only, and only when high impact is explicitly allowed.
  for(const id of ['forward-hop-and-stick','lateral-bound-and-stick']) {
    for(const role of ['footwork','control'])assert.equal(ok(id,role,'hard',{movementRoom:true,excludedImpact:[]}),false,id+' '+role);
    assert.deepEqual(['easy','normal','hard'].map(d=>ok(id,'integrated',d,{movementRoom:true,excludedImpact:[]})),[false,false,true],id);
    assert.equal(ok(id,'integrated','hard',{movementRoom:true}),false,'default exclusion keeps high impact out');
    assert.equal(ok(id,'integrated','hard',{movementRoom:true,excludedImpact:['high']}),false);
    assert.equal(ok(id,'integrated','hard',{excludedImpact:[]}),false,'unconfirmed room');
  }
  // The additions belong to membership v2 only.
  for(const id of NEW_255)for(const role of ['footwork','control','integrated'])assert.equal(F.getMembership({workoutFamilyId:FAMILY,workoutFamilyVersion:3,role},id),null,id);
  assert.equal(F.getMembership({workoutFamilyId:FAMILY,workoutFamilyVersion:4,role:'integrated'},'cossack-squat')!==null,true);
  // In-place drills are never marked as travelling; travelling ones always are.
  const policy=id=>F.getMembership(context('footwork'),id)||F.getMembership(context('integrated'),id);
  for(const id of ['in-in-out-out-steps','lateral-line-steps','split-stance-step-switches','180-degree-step-turns','fast-feet'])assert.equal(policy(id).requiresMovementRoom,undefined,id);
  for(const id of ['lateral-shuffle-and-stop','forward-back-acceleration-and-stop','forward-hop-and-stick','lateral-bound-and-stick'])assert.equal(policy(id).requiresMovementRoom,true,id);
});

test('v4 reaches every reviewed addition in a suitable context and keeps landings optional, brief and isolated',()=>{
  const seen={};let landings=0,sessions=0;
  const scenarios=[{difficulty:'easy'},{difficulty:'normal'},{difficulty:'normal',movementRoom:true},{difficulty:'hard',movementRoom:true},
    {difficulty:'hard',movementRoom:true,excludedImpact:[]}];
  for(const duration of [20,30,45])for(const extra of scenarios)for(let seed=1;seed<=24;seed++) {
    const w=generate({duration,...extra,random:rng(seed*7919)});sessions++;
    assert.equal(w.familyDiagnostics,undefined);
    assert.equal(G.validateFamilyWorkout(w,{catalogue:C,equipment:[]}).valid,true);
    for(const id of idsOf(w)){const key=id+'@'+extra.difficulty+(extra.movementRoom?'+room':'')+(extra.excludedImpact?'+impact':'');seen[key]=(seen[key]||0)+1;}
    const hops=resolved(w).filter(x=>x.ex.impact==='high');
    if(hops.length)landings++;
    for(const [index,{b,s,ex}] of hops.entries()) {
      assert.ok(s.plannedPrescription.value<=15,'landing efforts stay brief: '+ex.id);
      assert.ok(b.exercises[0].impact!=='high'&&b.exercises.at(-1).impact!=='high','landings never open or close a block');
      assert.ok(b.occurrenceRecoverySeconds.every(n=>n>=8));
    }
  }
  const reached=id=>Object.keys(seen).some(key=>key.startsWith(id+'@'));
  assert.deepEqual(NEW_255.concat(REUSED_255).filter(id=>!reached(id)),[]);
  // Travelling and landing drills never appear without confirmed room; landings only on Hard with the explicit opt-in.
  for(const id of ['lateral-shuffle-and-stop','forward-back-acceleration-and-stop','forward-hop-and-stick','lateral-bound-and-stick'])
    assert.deepEqual(Object.keys(seen).filter(key=>key.startsWith(id+'@')&&!key.includes('+room')),[],id);
  for(const id of ['forward-hop-and-stick','lateral-bound-and-stick'])
    assert.deepEqual(Object.keys(seen).filter(key=>key.startsWith(id+'@')&&!key.endsWith('@hard+room+impact')),[],id);
  assert.ok(landings>0&&landings<sessions*.1,'optional landings stay a small minority: '+landings+'/'+sessions);
  for(const id of ['single-leg-hip-hinge-reach','lateral-lunge-to-balance','180-degree-step-turns'])assert.deepEqual(Object.keys(seen).filter(key=>key.startsWith(id+'@')&&key.includes('@easy')),[],id);
});

test('v4 swaps can never introduce a drill the session difficulty or room excludes',()=>{
  const easy=generate({duration:30,difficulty:'easy',random:rng(11)});
  for(const [b,block] of easy.main.blocks.entries())for(let i=0;i<block.exercises.length;i++) {
    const edited=copy(easy);
    try{G.swap(edited,b,i,{catalogue:C,equipment:[],random:rng(b*13+i)});}catch(error){continue;}
    assert.equal(G.validateFamilyWorkout(edited,{catalogue:C,equipment:[]}).valid,true);
    assert.ok(['single-leg-hip-hinge-reach','lateral-lunge-to-balance','180-degree-step-turns','lateral-shuffle-and-stop','forward-back-acceleration-and-stop','forward-hop-and-stick','lateral-bound-and-stick'].every(id=>!idsOf(edited).has(id)));
  }
});
