const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');

// #192 (approved General Fitness Decision 7 C): occasional, optional, embedded comparable benchmarks.
const DAY = 86400000;
const T0 = Date.parse('2026-10-05T08:00:00Z');
const at = days => new Date(T0 + days * DAY).toISOString();
const SC = {workoutFamilyId: 'strength-control', workoutFamilyVersion: 1};
const IDS = ['push-up', 'air-squat', 'leg-raises'];

// A General Fitness v2 context for pure planning and generation with synthetic performed results.
function context(storage) {
  const p = pilot(storage, 'general-fitness', 2);
  p.run(`
    const GF=pilotDef, gfEngine=pilotEngine, policy=GarageFitCoachGeneralFitnessPolicy, IDS=['push-up','air-squat','leg-raises'];
    let gfSeed=11;
    const seeded=()=>{gfSeed=gfSeed+0x6D2B79F5|0;let t=Math.imul(gfSeed^gfSeed>>>15,1|gfSeed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
    const PLANNED={type:'reps',timed:false,seconds:null,reps:10,side:null,protocol:'rounds',
      protocolConditions:{exerciseRestSeconds:30,roundRestSeconds:0},round:1,set:null,cycle:null,exerciseIndex:0};
    // One saved session. benchmarks: [{id, reps, status, setup, conditions, mode}] become benchmark occurrences.
    function gfResult(id, when, family, options={}) {
      const bench=options.benchmarks||[];
      const planned=bench.map((item,i)=>({occurrenceId:id+':b'+i,exerciseId:item.exerciseId||item.id,section:'main',blockIndex:0,requirementId:'benchmark:'+item.id,
        prescription:{...PLANNED,exerciseIndex:i,...(item.conditions?{protocolConditions:item.conditions}:{}),...(item.prescription||{})}}));
      const main=[{occurrenceId:id+':m0',exerciseId:'goblet-squat',section:'main',blockIndex:1,requirementId:null,prescription:null}];
      const performed=bench.filter(item=>item.status!=='skipped').map((item,i)=>({occurrenceId:id+':b'+bench.indexOf(item),exerciseId:item.exerciseId||item.id,
        status:item.status||'completed',sets:[{...(item.reps===undefined?{}:{reps:item.reps}),...(item.setup===null?{}:{resistanceSetup:item.setup||'bodyweight'}),...(item.load?{load:item.load,loadUnit:'kg',loadInterpretation:'total'}:{})}]}));
      return GarageFitCoachModel.createSessionResult({sessionResultId:id,source:'coach',programmeInstanceId:options.instance||'gf',prescriptionId:'rx-'+id,
        ...(family?{workoutFamilyId:family,workoutFamilyVersion:1,familyStyleId:'straight-sets'}:{}),
        startedAt:when,endedAt:when,finalStatus:options.finalStatus||'completed',plannedWork:[...planned,...main],
        performedWork:[...performed,{occurrenceId:id+':m0',exerciseId:'goblet-squat',status:'completed'}],
        anchorResults:bench.map(item=>({requirementId:'benchmark:'+item.id,exerciseId:item.exerciseId||item.id,status:item.status==='skipped'?'skipped':item.status||'completed'}))});
    }
    function gfStart(now) { return gfEngine.startProgramme(GF,{programmeInstanceId:'gf',equipment:[]},now).state; }
    function gfApply(state, results, result) { results.push(result); return gfEngine.applySessionResult(GF,state,result,results); }
    function gfPlan(state, results, now, extra={}) {
      return gfEngine.planNextSession(GF,state,results,{now,prescriptionId:'rx:'+now,equipment:[],duration:30,...extra});
    }
    function gfHistory(results) { return GarageFitTrainingHistory.createHistory(results,CATALOGUE); }
  `);
  return p;
}

test('General Fitness v2 adds a closed, conservative benchmark policy; v1 stays released and unchanged', async () => {
  const p = context();
  assert.ok(p.run('Object.isFrozen(GF) && Object.isFrozen(GF.benchmarkPolicy.benchmarks[0])'));
  assert.deepEqual([p.run('GF.version'), p.run('GF.anchorSelectionPolicy'), p.run('GF.progressionPolicy')], [2, undefined, undefined]);
  const v1 = p.json("GarageFitData.programmes['general-fitness'][1]");
  assert.equal(v1.benchmarkPolicy, undefined, 'the released definition is not changed in place');
  const { benchmarkPolicy, version, ...rest } = p.json('GF');
  assert.deepEqual(rest, (({ version, ...others }) => others)(v1), 'v2 differs from v1 only by version and benchmark policy');
  assert.deepEqual(benchmarkPolicy.benchmarks.map(item => item.exerciseId), IDS);
  assert.ok(benchmarkPolicy.minimumIntervalDays >= 28 && benchmarkPolicy.minimumDurationMinutes >= 20);
  assert.equal(p.run("Object.keys(GarageFitData.programmes['general-fitness']).join()"), '1,2');
  const invalid = [
    `{...copy.benchmarkPolicy,minimumIntervalDays:21}`, `{...copy.benchmarkPolicy,minimumDurationMinutes:15}`,
    `{...copy.benchmarkPolicy,minimumMeaningfulSessions:0}`, `{...copy.benchmarkPolicy,extra:true}`, `{...copy.benchmarkPolicy,benchmarks:[]}`,
    `{...copy.benchmarkPolicy,workoutFamilyVersion:9}`,
    `{...copy.benchmarkPolicy,benchmarks:[{...copy.benchmarkPolicy.benchmarks[0],exerciseId:'dumbbell-curl'}]}`,
    `{...copy.benchmarkPolicy,benchmarks:[{...copy.benchmarkPolicy.benchmarks[0],exerciseId:'plank'}]}`,
    `{...copy.benchmarkPolicy,benchmarks:[{...copy.benchmarkPolicy.benchmarks[0],exerciseId:'reverse-lunge'}]}`,
    `{...copy.benchmarkPolicy,benchmarks:[copy.benchmarkPolicy.benchmarks[0],copy.benchmarkPolicy.benchmarks[0]]}`
  ];
  for (const source of invalid) assert.throws(() => p.run(`(()=>{const copy=JSON.parse(JSON.stringify(GF));
    GarageFitCoachPolicies.createDefaultRegistry().get('general-fitness').validateDefinition({...copy,benchmarkPolicy:${source}});})()`), /General Fitness/, source);
  assert.doesNotThrow(() => p.run("GarageFitCoachPolicies.createDefaultRegistry().get('general-fitness').validateDefinition(GF)"));
  // A saved v1 instance keeps its pinned definition: no benchmark is ever planned for it.
  const old = pilot(new Map(), 'general-fitness', 1);
  await old.run('pilot.start(pilotDef,[])');
  const plan = old.json('pilot.plan({equipment:[],duration:30})');
  assert.equal(plan.rationale.priorities.benchmark, undefined);
  assert.equal(plan.prescription.workoutFamilyPlan.benchmark, undefined);
  assert.equal(plan.prescription.programmeContext.benchmark, undefined);
});

test('a benchmark is offered rarely, only where it fits, and declining or missing it never creates debt', () => {
  const p = context();
  const offer = p.json(`(()=>{
    const out={}, state0=gfStart(${JSON.stringify(at(0))});
    const reason=(state,results,days,extra={})=>gfPlan(state,results,${JSON.stringify(at(0))}.slice(0,0)||new Date(${T0}+days*${DAY}).toISOString(),extra).rationale.priorities.benchmark;
    out.fresh=reason(state0,[],1);
    // After one meaningful Strength & Control session the next Strength & Control plan can offer it.
    const results=[]; let state=gfApply(state0,results,gfResult('s0',${JSON.stringify(at(0))},'strength-control'));
    const family=gfPlan(state,results,${JSON.stringify(at(3))}).prescription.workoutFamilyPlan.candidates[0].workoutFamilyId;
    out.family=family;
    // Force a Strength & Control intent: a history that leaves strength the clear priority.
    const other=[]; let st=gfStart(${JSON.stringify(at(0))});
    st=gfApply(st,other,gfResult('c0',${JSON.stringify(at(0))},'cardio-conditioning'));
    st=gfApply(st,other,gfResult('c1',${JSON.stringify(at(1))},'core-stability'));
    const sc=gfPlan(st,other,${JSON.stringify(at(5))});
    out.intended=sc.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId;
    out.offered=sc.rationale.priorities.benchmark; out.rx=sc.prescription.workoutFamilyPlan.benchmark; out.context=sc.prescription.programmeContext.benchmark;
    out.easy=gfPlan(st,other,${JSON.stringify(at(5))},{easyToday:true}).rationale.priorities.benchmark.reason;
    out.short=gfPlan(st,other,${JSON.stringify(at(5))},{duration:15}).rationale.priorities.benchmark.reason;
    out.fiveteen=gfPlan(st,other,${JSON.stringify(at(5))},{duration:20}).rationale.priorities.benchmark.reason;
    return out;
  })()`);
  assert.deepEqual([offer.fresh.status, offer.fresh.reason], ['not-offered', 'too-early'], 'a brand-new programme is never tested first');
  assert.equal(offer.intended, 'strength-control');
  assert.deepEqual([offer.offered.status, offer.offered.reason, offer.offered.occasions], ['offered', 'offered', 0]);
  assert.deepEqual(offer.rx.items.map(item => item.exerciseId), IDS);
  assert.deepEqual([offer.rx.workoutFamilyId, offer.rx.exerciseRestSeconds], ['strength-control', 30]);
  assert.deepEqual(offer.context, {status: 'offered', optional: true, benchmarkIds: IDS});
  assert.equal(offer.easy, 'easy-today'); assert.equal(offer.short, 'short-session'); assert.equal(offer.fiveteen, 'offered');

  const cadence = p.json(`(()=>{
    const results=[]; let state=gfStart(${JSON.stringify(at(0))});
    // Strength-led history so Strength & Control stays the intended family.
    state=gfApply(state,results,gfResult('a0',${JSON.stringify(at(0))},'cardio-conditioning'));
    const planAt=days=>gfPlan(state,results,new Date(${T0}+days*${DAY}).toISOString()).rationale.priorities.benchmark;
    const intended=days=>gfPlan(state,results,new Date(${T0}+days*${DAY}).toISOString()).prescription.workoutFamilyPlan.candidates[0].workoutFamilyId;
    const out={};
    out.beforeDay=intended(2); out.first=planAt(2).status;
    // A completed session that reached the benchmark, skipped entirely, still counts as the occasion.
    state=gfApply(state,results,gfResult('a1',${JSON.stringify(at(2))},'strength-control',{benchmarks:IDS.map(id=>({id,status:'skipped'}))}));
    out.afterSkip=planAt(10); out.afterSkipDay27=planAt(2+27); out.afterSkipDay28=planAt(2+28);
    // An abandoned or early session that never measured anything is not an occasion: nothing is lost.
    const resultsB=[]; let stateB=gfStart(${JSON.stringify(at(0))});
    stateB=gfApply(stateB,resultsB,gfResult('b0',${JSON.stringify(at(0))},'cardio-conditioning'));
    stateB=gfApply(stateB,resultsB,gfResult('b1',${JSON.stringify(at(2))},'strength-control',{finalStatus:'partial',benchmarks:IDS.map(id=>({id,status:'skipped'}))}));
    out.partialSkipped=gfPlan(stateB,resultsB,${JSON.stringify(at(4))}).rationale.priorities.benchmark.occasions;
    // Measuring even one benchmark in a partial session is an occasion.
    stateB=gfApply(stateB,resultsB,gfResult('b2',${JSON.stringify(at(5))},'strength-control',{finalStatus:'partial',benchmarks:[{id:'push-up',reps:12},{id:'air-squat',status:'skipped'},{id:'leg-raises',status:'skipped'}]}));
    out.partialMeasured=gfPlan(stateB,resultsB,${JSON.stringify(at(6))}).rationale.priorities.benchmark;
    // A long absence offers a single opportunity: no queue of missed benchmarks.
    out.longGap=gfPlan(state,results,new Date(${T0}+200*${DAY}).toISOString());
    out.state=state;
    return out;
  })()`);
  assert.equal(cadence.first, 'offered');
  assert.deepEqual([cadence.afterSkip.reason, cadence.afterSkipDay27.reason], ['recent-benchmark', 'recent-benchmark']);
  assert.notEqual(cadence.afterSkipDay28.reason, 'recent-benchmark', 'four weeks later the gate opens (it still needs Strength & Control to be intended)');
  assert.equal(cadence.afterSkip.occasions, 1);
  assert.equal(cadence.partialSkipped, 0, 'an unfinished session that measured nothing does not use up the opportunity');
  assert.deepEqual([cadence.partialMeasured.reason, cadence.partialMeasured.occasions], ['recent-benchmark', 1]);
  assert.equal(cadence.longGap.prescription.workoutFamilyPlan.benchmark.items.length, 3, 'one opportunity, not several');
  assert.equal(cadence.longGap.rationale.priorities.benchmark.occasions, 1);
  assert.equal(cadence.state.anchors.length, 0); assert.equal(cadence.state.meaningfulSessionsCompleted, 2, 'skipping benchmarks changes no credit');
  assert.equal(cadence.state.currentTargets.benchmark, undefined, 'no benchmark state is stored on the programme');
});

test('recovery preference blocks a benchmark, and benchmarks stay rare without changing the planned family sequence', () => {
  const p = context();
  const recent = p.json(`(()=>{const results=[]; let state=gfStart(${JSON.stringify(at(0))});
    state=gfApply(state,results,gfResult('d0',${JSON.stringify(at(0))},'strength-control'));
    return gfPlan(state,results,new Date(${T0}+10*3600000).toISOString()).rationale.priorities;})()`);
  assert.deepEqual([recent.recovery.preferLowerDemand, recent.benchmark.reason], [true, 'recovery-preferred']);
  // 24 weeks at three sessions a week. Whenever a benchmark is offered it is performed (the most demanding case).
  const simulate = definition => p.json(`(()=>{
    const def=${definition}; const results=[]; let state=gfEngine.startProgramme(def,{programmeInstanceId:'gf',equipment:[]},${JSON.stringify(at(0))}).state;
    const out=[];
    for(let i=0;i<72;i++){
      const now=new Date(${T0}+Math.round(i*7/3*24)*3600000).toISOString();
      const plan=gfEngine.planNextSession(def,state,results,{now,prescriptionId:'rx:'+i,equipment:[],duration:30});
      const family=plan.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId, benchmark=plan.prescription.workoutFamilyPlan.benchmark;
      out.push({now,family,benchmark:!!benchmark,reason:plan.rationale.priorities.benchmark&&plan.rationale.priorities.benchmark.reason});
      const result=gfResult('s'+i,now,family,{benchmarks:benchmark?IDS.map(id=>({id,reps:10})):[]});
      state=gfEngine.applySessionResult(def,state,result,(results.push(result),results));
    }
    return out;
  })()`);
  const withBenchmarks = simulate('GF'), without = simulate("GarageFitData.programmes['general-fitness'][1]");
  assert.deepEqual(withBenchmarks.map(item => item.family), without.map(item => item.family), 'offering benchmarks never changes which family is planned');
  const offered = withBenchmarks.filter(item => item.benchmark);
  assert.ok(offered.length >= 4 && offered.length <= 6, 'about every four to six weeks over 24 weeks: ' + offered.length);
  offered.forEach(item => assert.equal(item.family, 'strength-control'));
  offered.slice(1).forEach((item, index) => assert.ok(Date.parse(item.now) - Date.parse(offered[index].now) >= 28 * DAY, 'never closer than four weeks'));
  assert.ok(offered.length / withBenchmarks.length < 0.1, 'a small minority of sessions');
  assert.ok(without.every(item => !item.benchmark && item.reason === undefined), 'the released definition never offers one');
  const gaps = offered.slice(1).map((item, index) => Math.round((Date.parse(item.now) - Date.parse(offered[index].now)) / DAY));
  assert.ok(gaps.every(gap => gap <= 6 * 7 + 7), 'offers are not postponed indefinitely: ' + gaps);
});

test('the Generator embeds the benchmark first in the intended family without changing identity, time or other work', () => {
  const p = context();
  p.run(`
    const SPEC=policy.benchmarkSpec(GF);
    const CANDIDATES=[{workoutFamilyId:'strength-control',workoutFamilyVersion:1,rationale:'Strength first'},{workoutFamilyId:'cardio-conditioning',workoutFamilyVersion:1,rationale:'Cardio next'}];
    function gfRx(duration, extra={}, plan={}) { return GarageFitCoachModel.createSessionPrescription({prescriptionId:'rx',programmeInstanceId:'gf',sessionRole:'general-fitness',
      duration,difficulty:extra.difficulty||'normal',equipment:extra.equipment||[],workoutFamilyPlan:{candidates:CANDIDATES,benchmark:SPEC,...plan}}); }
    function build(duration, extra={}, seed=7, plan={}) {
      gfSeed=seed; return GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:gfRx(duration,extra,plan),random:seeded,equipment:extra.equipment||[]});
    }
  `);
  for (const [duration, equipment, difficulty] of [[20, [], 'normal'], [30, [], 'normal'], [45, [], 'hard'], [30, ['dumbbells', 'kettlebell', 'bands', 'trx', 'bench'], 'normal']]) {
    const out = p.json(`(()=>{const workout=build(${duration},{equipment:${JSON.stringify(equipment)},difficulty:'${difficulty}'});
      return {workout,check:GarageFitGenerator.validateFamilyWorkout(workout,{catalogue:CATALOGUE,equipment:${JSON.stringify(equipment)}})};})()`);
    const key = duration + '/' + equipment.length + '/' + difficulty, blocks = out.workout.main.blocks, first = blocks[0];
    assert.equal(out.workout.workoutFamilyId, 'strength-control', key);
    assert.deepEqual(out.check, {valid: true, technicalIssues: [], qualityIssues: []}, key);
    assert.ok(out.workout.estimatedSeconds <= duration * 60, key + ' stays within the selected duration');
    // Fixed conditions: one unloaded round of the reviewed exercises, same rest every time, first in Main.
    assert.deepEqual([first.protocol, first.prescription, first.exercises.map(item => item.id)], ['rounds', {rounds: 1, exerciseRestSeconds: 30, roundRestSeconds: 0}, IDS], key);
    assert.deepEqual(first.benchmark.items.map(item => item.benchmarkId), IDS);
    assert.equal(blocks.filter(block => block.benchmark).length, 1);
    assert.ok(blocks.slice(1).every(block => !block.benchmark && block.exercises.every(item => !item.coachAnchor)), 'family blocks carry no benchmark');
    assert.ok(blocks.length >= 2, 'the family still delivers its own work');
    assert.equal(out.workout.familyReplan.replanned, false);
    assert.equal(out.workout.warmup.exercises.length > 0, true);
  }
  // Same plan without a benchmark delivers the same family and style family; the benchmark only borrows time.
  const withBenchmark = p.json('build(30)'), without = p.json('build(30,{},7,{benchmark:null})');
  assert.equal(withBenchmark.workoutFamilyId, without.workoutFamilyId);
  assert.ok(without.main.blocks.every(block => !block.benchmark));
  assert.ok(withBenchmark.main.estimatedDurationSeconds <= without.main.estimatedDurationSeconds + 240 + 140);
  // An ineligible reviewed exercise is dropped (air squats are medium impact); the rest is the ordinary family session.
  const lowImpact = p.json("build(30,{},7,{excludedImpact:['medium']})");
  assert.deepEqual(lowImpact.main.blocks[0].exercises.map(item => item.id), ['push-up', 'leg-raises']);
  assert.equal(lowImpact.workoutFamilyId, 'strength-control');
  const none = p.json(`(()=>{gfSeed=7;return GarageFitGenerator.generate({catalogue:CATALOGUE,random:seeded,sessionPrescription:GarageFitCoachModel.createSessionPrescription({prescriptionId:'rx',
    programmeInstanceId:'gf',sessionRole:'general-fitness',duration:30,difficulty:'normal',equipment:[],workoutFamilyPlan:{candidates:CANDIDATES,excludedImpact:['medium'],
    benchmark:{...SPEC,items:[SPEC.items[1]]}}})});})()`);
  assert.equal(none.workoutFamilyId, 'strength-control');
  assert.ok(none.main.blocks.every(block => !block.benchmark), 'with nothing eligible the family session is delivered without one');
  // A benchmark for a different family than the plan's first is a record error, never a silent change.
  assert.throws(() => p.run("gfRx(30,{},{benchmark:{...SPEC,workoutFamilyId:'cardio-conditioning'}})"), /first family/);
  assert.throws(() => p.run("gfRx(30,{},{benchmark:{...SPEC,items:[]}})"), /one to 4 benchmarks/);
  assert.throws(() => p.run("gfRx(30,{},{benchmark:{...SPEC,items:[SPEC.items[0],SPEC.items[0]]}})"), /duplicates/);
});

test('every supported duration, difficulty and kit carries the benchmark inside a valid Strength & Control session', () => {
  const p = context();
  p.run(`
    const SWEEP_SPEC=policy.benchmarkSpec(GF);
    const SWEEP_CANDIDATES=[{workoutFamilyId:'strength-control',workoutFamilyVersion:1,rationale:'s'},{workoutFamilyId:'cardio-conditioning',workoutFamilyVersion:1,rationale:'c'}];
  `);
  let checked = 0;
  for (const equipment of [[], ['dumbbells'], ['dumbbells', 'kettlebell', 'bands', 'trx', 'bench', 'rings']])
    for (const duration of [20, 30, 45]) for (const difficulty of ['normal', 'hard']) for (const seed of [1, 2, 3, 4]) {
      const out = p.json(`(()=>{gfSeed=${seed};const w=GarageFitGenerator.generate({catalogue:CATALOGUE,random:seeded,equipment:${JSON.stringify(equipment)},
        sessionPrescription:GarageFitCoachModel.createSessionPrescription({prescriptionId:'rx',programmeInstanceId:'gf',sessionRole:'general-fitness',duration:${duration},
          difficulty:'${difficulty}',equipment:${JSON.stringify(equipment)},workoutFamilyPlan:{candidates:SWEEP_CANDIDATES,benchmark:SWEEP_SPEC}})});
        return {family:w.workoutFamilyId,replanned:w.familyReplan.replanned,benchmark:w.main.blocks[0].benchmark!=null,seconds:w.estimatedSeconds,
          valid:GarageFitGenerator.validateFamilyWorkout(w,{catalogue:CATALOGUE,equipment:${JSON.stringify(equipment)}}).valid};})()`);
      const key = [equipment.length, duration, difficulty, seed].join('/');
      assert.deepEqual([out.family, out.replanned, out.benchmark, out.valid], ['strength-control', false, true, true], key);
      assert.ok(out.seconds <= duration * 60, key);
      checked++;
    }
  assert.equal(checked, 72);
});

test('benchmark blocks are protected: no swap, no relocation, no modification, and edits to other work re-pass the gate', () => {
  const p = context();
  p.run(`
    const SPEC2=policy.benchmarkSpec(GF);
    const rxFor=duration=>GarageFitCoachModel.createSessionPrescription({prescriptionId:'rx',programmeInstanceId:'gf',sessionRole:'general-fitness',duration,difficulty:'normal',equipment:[],
      workoutFamilyPlan:{candidates:[{workoutFamilyId:'strength-control',workoutFamilyVersion:1,rationale:'Strength first'}],benchmark:SPEC2}});
    const fresh=()=>{gfSeed=3;return GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:rxFor(30),random:seeded});};
    const gate=workout=>GarageFitGenerator.validateFamilyWorkout(workout,{catalogue:CATALOGUE,equipment:[]});
  `);
  assert.ok(p.run('fresh().main.blocks[0].benchmark'));
  const error = p.json(`(()=>{const w=fresh();try{GarageFitGenerator.swap(w,0,0,{catalogue:CATALOGUE,equipment:[],random:seeded});}catch(e){return {code:e.code,id:e.exerciseId,unchanged:w.main.blocks[0].exercises[0].id};}})()`);
  assert.deepEqual(error, {code: 'benchmark-swap', id: 'push-up', unchanged: 'push-up'});
  // Swapping ordinary work around the benchmark keeps the family and passes the shared gate.
  assert.ok(p.run(`(()=>{const w=fresh();GarageFitGenerator.swap(w,1,0,{catalogue:CATALOGUE,equipment:[],random:seeded});return gate(w).valid&&w.main.blocks[0].benchmark!=null;})()`));
  const tampered = {
    moved: `w.main.blocks.push(w.main.blocks.shift())`,
    modified: `w.main.blocks[0].exercises[0].strength=1`,
    replaced: `w.main.blocks[0].exercises[0]=JSON.parse(JSON.stringify(CATALOGUE['pike-push-up']))`,
    loaded: `w.main.blocks[0].exercises[1]=JSON.parse(JSON.stringify(CATALOGUE['goblet-squat']))`,
    resting: `w.main.blocks[0].prescription.roundRestSeconds=30`,
    twoRounds: `w.main.blocks[0].prescription.rounds=2`,
    duplicate: `w.main.blocks.splice(2,0,JSON.parse(JSON.stringify(w.main.blocks[0])))`,
    wrongFamily: `w.main.blocks[0].benchmark.workoutFamilyId='cardio-conditioning'`
  };
  for (const [name, edit] of Object.entries(tampered)) {
    const verdict = p.json(`(()=>{const w=fresh();${edit};try{return gate(w);}catch(e){return {valid:false,thrown:e.message};}})()`);
    assert.equal(verdict.valid, false, name + ' is rejected by the family gate');
  }
});

test('the Generator keeps the intended family: a family that cannot carry a benchmark plans exactly as it would without one', () => {
  const p = context();
  p.run(`
    const SPEC3=policy.benchmarkSpec(GF);
    const plan3=(duration,candidates,benchmark)=>GarageFitCoachModel.createSessionPrescription({prescriptionId:'rx',programmeInstanceId:'gf',sessionRole:'general-fitness',duration,difficulty:'normal',equipment:[],
      workoutFamilyPlan:{candidates,...(benchmark?{benchmark}:{}),excludedImpact:['medium','high']}});
  `);
  // Athletic is first and cannot be built without confirmed room: the replan to Core is unchanged by a benchmark request.
  const out = p.json(`(()=>{gfSeed=5;const w=GarageFitGenerator.generate({catalogue:CATALOGUE,random:seeded,sessionPrescription:plan3(20,
    [{workoutFamilyId:'athletic-movement',workoutFamilyVersion:1,rationale:'a'},{workoutFamilyId:'core-stability',workoutFamilyVersion:1,rationale:'b'}])});return w;})()`);
  assert.equal(out.workoutFamilyId, 'core-stability');
  // A benchmark can only be requested for the first candidate, which is the benchmark's own family.
  assert.throws(() => p.run(`plan3(20,[{workoutFamilyId:'athletic-movement',workoutFamilyVersion:1,rationale:'a'}],SPEC3)`), /first family/);
  // When Strength & Control is the plan's first family but cannot be built, the replan matches the benchmark-free one.
  const replanned = p.json(`(()=>{const candidates=[{workoutFamilyId:'strength-control',workoutFamilyVersion:1,rationale:'s'},{workoutFamilyId:'core-stability',workoutFamilyVersion:1,rationale:'c'}];
    const rx=(benchmark)=>GarageFitCoachModel.createSessionPrescription({prescriptionId:'rx',programmeInstanceId:'gf',sessionRole:'general-fitness',duration:10,difficulty:'normal',equipment:[],
      workoutFamilyPlan:{candidates,...(benchmark?{benchmark}:{}),bodyPositions:['hanging']}});
    const run=benchmark=>{gfSeed=9;try{const w=GarageFitGenerator.generate({catalogue:CATALOGUE,random:seeded,sessionPrescription:rx(benchmark)});return {family:w.workoutFamilyId,benchmark:w.main.blocks.some(b=>b.benchmark)};}catch(e){return {error:e.code};}};
    return {with:run(SPEC3),without:run(null)};})()`);
  assert.deepEqual(replanned.with, replanned.without, 'asking for a benchmark never alters the outcome of a family that cannot carry it');
});

// Real tracker flow through the shared controller with a deterministic clock.
async function controllerWith(storage = new Map()) {
  const p = pilot(storage, 'general-fitness', 2);
  p.run(`let seed=21;Math.random=()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};`);
  await p.run('pilot.start(pilotDef,[])');
  p.day = days => p.run(`pilotNow=new Date(${T0}+${days}*${DAY}).toISOString()`);
  p.offered = () => p.json("pilot.plan({equipment:[],duration:30}).rationale.priorities.benchmark");
  // Complete ordinary sessions day by day until a benchmark is offered; return the day.
  p.untilOffered = async (from, last = from + 20) => {
    for (let day = from; day <= last; day++) {
      p.day(day);
      if (p.offered().status === 'offered') return day;
      p.run("pilot.prepare({equipment:[],duration:30})");
      await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
      await p.run(`(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>item.section==='main'))await pilotTracker.recordDone(work.occurrenceId);})()`);
      await p.run(`pilot.finish('complete',{difficulty:'about-right'},600)`);
    }
    throw new Error('no benchmark was offered');
  };
  p.benchmarkWork = () => p.json("pilotTracker.plannedWork().filter(item=>item.requirementId&&item.requirementId.startsWith('benchmark:'))");
  return p;
}
const recordAll = (p, reps, setup = 'bodyweight') => p.run(`(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>item.requirementId&&item.requirementId.startsWith('benchmark:'))){
  await pilotTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:${reps},${setup?`resistanceSetup:'${setup}'`:''}}]});}
  for(const work of pilotTracker.plannedWork().filter(item=>item.section==='main'&&!item.requirementId))await pilotTracker.recordDone(work.occurrenceId);})()`);

test('an offered benchmark is performed through the shared tracker and survives save, reload and recovery without touching anchors', async () => {
  const p = await controllerWith();
  const day = await p.untilOffered(0);
  p.day(day); p.run("pilot.prepare({equipment:[],duration:30})");
  const preview = p.json('pilot.snapshot().preview');
  const delivered = preview.workout;
  assert.equal(delivered.workoutFamilyId, 'strength-control');
  assert.equal(preview.plan.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId, 'strength-control', 'the intended family is unchanged');
  await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
  const planned = p.benchmarkWork();
  assert.deepEqual(planned.map(item => item.requirementId), IDS.map(id => 'benchmark:' + id));
  assert.deepEqual(planned.map(item => item.exerciseId), IDS);
  assert.ok(planned.every(item => item.section === 'main' && item.blockIndex === 0 && item.prescription.protocol === 'rounds' && item.prescription.side === null
    && item.prescription.protocolConditions.exerciseRestSeconds === 30 && item.prescription.protocolConditions.roundRestSeconds === 0), 'planned work carries the comparison conditions');
  // Perform two benchmarks with explicit reps and setup; skip the third.
  await p.run(`(async()=>{const work=pilotTracker.plannedWork().filter(item=>item.requirementId&&item.requirementId.startsWith('benchmark:'));
    await pilotTracker.recordAnchor(work[0].occurrenceId,{status:'completed',sets:[{reps:14,resistanceSetup:'bodyweight'}]});
    await pilotTracker.recordAnchor(work[1].occurrenceId,{status:'completed',sets:[{reps:25}]});
    await pilotTracker.recordSkip(work[2].occurrenceId);
    for(const w of pilotTracker.plannedWork().filter(item=>item.section==='main'&&!item.requirementId))await pilotTracker.recordDone(w.occurrenceId);})()`);
  // Interrupt: a reload recovers the durable benchmark outcomes only.
  const q = pilot(p.storage, 'general-fitness', 2);
  q.run(`pilotNow=new Date(${T0}+${day}*${DAY}+3600000).toISOString()`);
  await q.run('pilot.load()');
  const recovered = q.json('pilot.snapshot().results').at(-1);
  assert.equal(recovered.finalStatus, 'partial');
  const benchmarkIds = new Set(recovered.plannedWork.filter(item => item.requirementId?.startsWith('benchmark:')).map(item => item.occurrenceId));
  const byId = Object.fromEntries(recovered.performedWork.filter(item => benchmarkIds.has(item.occurrenceId)).map(item => [item.exerciseId, item]));
  assert.deepEqual(byId['push-up'].sets, [{reps: 14, resistanceSetup: 'bodyweight'}]);
  assert.deepEqual(byId['air-squat'].sets, [{reps: 25}], 'a missing setup stays unknown');
  assert.equal(byId['leg-raises'], undefined, 'a skipped benchmark records nothing');
  assert.ok(recovered.anchorResults.some(item => item.requirementId === 'benchmark:leg-raises' && item.status === 'skipped'));
  assert.equal(q.json('pilot.snapshot().state').anchors.length, 0);
  // Save-and-reload of a normally completed benchmark session, evidence and cadence included.
  const r = await controllerWith();
  const rday = await r.untilOffered(0);
  r.day(rday); r.run("pilot.prepare({equipment:[],duration:30})");
  await r.run('pilot.begin().then(value=>{pilotTracker=value;})');
  await recordAll(r, 15);
  const saved = JSON.parse(JSON.stringify(await r.run(`pilot.finish('complete',{difficulty:'about-right'},600)`)));
  assert.equal(saved.finalStatus, 'completed');
  assert.equal(saved.workoutFamilyId, 'strength-control'); assert.deepEqual(saved.anchorResults.filter(item => item.requirementId.startsWith('benchmark:')).map(item => item.status), ['completed', 'completed', 'completed']);
  const before = r.json('pilot.snapshot().state');
  const reloaded = pilot(r.storage, 'general-fitness', 2);
  reloaded.run(`pilotNow=new Date(${T0}+${rday + 1}*${DAY}).toISOString()`);
  await reloaded.run('pilot.load()');
  assert.deepEqual(reloaded.json('pilot.snapshot().state'), before);
  assert.deepEqual(before.anchors, []); assert.equal(before.currentTargets.benchmark, undefined);
  assert.equal(reloaded.json('pilot.progressEvidence().benchmarkResults').length, 1);
  assert.equal(reloaded.json("pilot.plan({equipment:[],duration:30}).rationale.priorities.benchmark.reason"), 'recent-benchmark');
  const improvement = reloaded.json('GarageFitCoachGeneralFitnessPolicy.benchmarkImprovement({definition:pilotDef,state:pilot.snapshot().state,history:GarageFitTrainingHistory.createHistory(pilot.progressEvidence().benchmarkResults,CATALOGUE)})');
  assert.deepEqual(improvement.map(item => [item.benchmarkId, item.status, item.latest.reps]), IDS.map(id => [id, 'baseline', 15]));
});

test('skipping or omitting a benchmark keeps the session, family and credit unchanged and leaves no debt', async () => {
  const p = await controllerWith();
  const day = await p.untilOffered(0);
  const creditedBefore = p.json('pilot.snapshot().state').meaningfulSessionsCompleted;
  p.day(day); p.run("pilot.prepare({equipment:[],duration:30})");
  await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
  // Decline everything: skip each benchmark and perform the ordinary family work.
  await p.run(`(async()=>{for(const w of pilotTracker.plannedWork().filter(item=>item.requirementId))await pilotTracker.recordSkip(w.occurrenceId);
    for(const w of pilotTracker.plannedWork().filter(item=>item.section==='main'&&!item.requirementId))await pilotTracker.recordDone(w.occurrenceId);})()`);
  const result = await p.run(`pilot.finish('complete',{difficulty:'about-right'},600)`);
  assert.equal(result.finalStatus, 'completed'); assert.equal(result.workoutFamilyId, 'strength-control');
  assert.equal(p.json('pilot.snapshot().state').meaningfulSessionsCompleted, creditedBefore + 1, 'the ordinary work earns the usual credit');
  assert.equal(result.performedWork.filter(item => result.plannedWork.find(work => work.occurrenceId === item.occurrenceId)?.requirementId).length, 0, 'nothing is recorded for a skipped benchmark');
  // No debt: it is not offered again for four weeks, and then once.
  p.day(day + 7); assert.equal(p.offered().reason, 'recent-benchmark');
  p.day(day + 27); assert.equal(p.offered().reason, 'recent-benchmark');
  p.day(day + 29); assert.notEqual(p.offered().reason, 'recent-benchmark');
  // Progress remains explicit about the absence of evidence.
  const improvement = p.json('GarageFitCoachGeneralFitnessPolicy.benchmarkImprovement({definition:pilotDef,state:pilot.snapshot().state,history:GarageFitTrainingHistory.createHistory(pilot.progressEvidence().benchmarkResults,CATALOGUE)})');
  assert.ok(improvement.every(item => item.status === 'none'));
});

test('an abandoned session before the benchmark is measured offers it again later with no penalty', async () => {
  const p = await controllerWith();
  const day = await p.untilOffered(0);
  p.day(day); p.run("pilot.prepare({equipment:[],duration:30})");
  await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
  const abandoned = await p.run(`pilot.finish('exit',{difficulty:'about-right'},30)`);
  assert.equal(abandoned.finalStatus, 'abandoned');
  p.day(day + 1);
  assert.equal(p.offered().reason === 'recent-benchmark', false, 'an abandoned run is not a benchmark occasion');
});

// Synthetic comparison matrix over the shared Training History rules.
test('improvement is claimed only for identical completed, measured, confirmed-setup observations', () => {
  const p = context();
  const evaluate = results => p.json(`(()=>{const results=[];let state=gfStart(${JSON.stringify(at(0))});
    ${results}
    const history=gfHistory(results);
    return policy.benchmarkImprovement({definition:GF,state,history}).map(item=>({id:item.benchmarkId,status:item.status,latest:item.latest&&item.latest.reps,previous:item.previous&&item.previous.reps,
      delta:item.delta,incomparable:item.incomparable,unusable:item.unusable,recorded:item.recorded}));})()`);
  const push = out => out.find(item => item.id === 'push-up');
  const add = (id, day, benchmarks) => `state=gfApply(state,results,gfResult('${id}',${JSON.stringify(at(day))},'strength-control',{benchmarks:${benchmarks}}));`;

  // Zero past measurements: explicit absence, never improvement.
  assert.ok(evaluate('').every(item => item.status === 'none'));
  // One measurement: a baseline, which is not enough comparable evidence.
  assert.deepEqual(push(evaluate(add('r1', 0, `[{id:'push-up',reps:10}]`))), {id: 'push-up', status: 'baseline', latest: 10, previous: null, delta: null, incomparable: 0, unusable: 0, recorded: 1});
  // Identical conditions: improved, same and lower are all reported honestly.
  assert.deepEqual([push(evaluate(add('r1', 0, `[{id:'push-up',reps:10}]`) + add('r2', 30, `[{id:'push-up',reps:13}]`))).status,
    push(evaluate(add('r1', 0, `[{id:'push-up',reps:10}]`) + add('r2', 30, `[{id:'push-up',reps:10}]`))).status,
    push(evaluate(add('r1', 0, `[{id:'push-up',reps:10}]`) + add('r2', 30, `[{id:'push-up',reps:8}]`))).status], ['improved', 'same', 'lower']);
  const improved = push(evaluate(add('r1', 0, `[{id:'push-up',reps:10}]`) + add('r2', 30, `[{id:'push-up',reps:13}]`)));
  assert.deepEqual([improved.previous, improved.latest, improved.delta], [10, 13, 3]);
  // The most recent comparable result is the comparison, even after an incomparable one in between.
  const skipped = push(evaluate(add('r1', 0, `[{id:'push-up',reps:10}]`) + add('r2', 30, `[{id:'push-up',reps:20,conditions:{exerciseRestSeconds:60,roundRestSeconds:0}}]`)
    + add('r3', 60, `[{id:'push-up',reps:12}]`)));
  assert.deepEqual([skipped.status, skipped.previous, skipped.latest, skipped.incomparable], ['improved', 10, 12, 1]);
  // Changed protocol conditions, protocol, prescription mode or side are segmented, never equivalent.
  for (const [name, change] of Object.entries({
    rest: `conditions:{exerciseRestSeconds:60,roundRestSeconds:0}`,
    protocol: `prescription:{protocol:'paired_sets',protocolConditions:{betweenExercisesSeconds:10,betweenSetsSeconds:60}}`,
    mode: `prescription:{type:'timed',timed:true,seconds:30,reps:null}`,
    side: `prescription:{side:'left'}`,
    variable: `prescription:{variableTarget:true}`
  })) {
    const item = push(evaluate(add('r1', 0, `[{id:'push-up',reps:10}]`) + add('r2', 30, `[{id:'push-up',reps:30,${change}}]`)));
    assert.equal(item.status, 'not-comparable', name); assert.equal(item.incomparable, 1, name);
    assert.equal(item.delta, null, name + ' reports no delta');
  }
  // A different confirmed setup or an added load is a new baseline, not an increase.
  const setup = push(evaluate(add('r1', 0, `[{id:'push-up',reps:10}]`) + add('r2', 30, `[{id:'push-up',reps:30,setup:'weighted-vest'}]`)));
  assert.equal(setup.status, 'not-comparable');
  // Unknown measurements never support a claim: no reps, no setup, partial, or numeric load.
  for (const [name, bad] of Object.entries({noReps: `{id:'push-up'}`, noSetup: `{id:'push-up',reps:30,setup:null}`,
    partial: `{id:'push-up',reps:30,status:'partial'}`, loaded: `{id:'push-up',reps:30,load:5}`})) {
    const item = push(evaluate(add('r1', 0, `[{id:'push-up',reps:10}]`) + add('r2', 30, `[${bad}]`)));
    assert.equal(item.status, 'baseline', name + ' leaves the earlier baseline as the only usable evidence');
    assert.equal(item.unusable, 1, name); assert.equal(item.delta, null, name);
  }
  const unmeasuredOnly = push(evaluate(add('r1', 0, `[{id:'push-up'}]`)));
  assert.deepEqual([unmeasuredOnly.status, unmeasuredOnly.latest], ['unmeasured', null]);
  // Exercises are separate: improving push-ups says nothing about squats, and instances are separate.
  const two = evaluate(add('r1', 0, `[{id:'push-up',reps:10},{id:'air-squat',reps:20}]`) + add('r2', 30, `[{id:'push-up',reps:12}]`));
  assert.deepEqual(two.map(item => item.status), ['improved', 'baseline', 'none']);
  const foreign = evaluate(`results.push(gfResult('x1',${JSON.stringify(at(0))},'strength-control',{instance:'other',benchmarks:[{id:'push-up',reps:10}]}));`);
  assert.ok(foreign.every(item => item.status === 'none'), 'other programme instances are not mixed into this instance');
});

test('capability balance reports performed training effects across sources and flags unmeasured work', () => {
  const p = context();
  const summary = p.json(`(()=>{const results=[];let state=gfStart(${JSON.stringify(at(0))});
    state=gfApply(state,results,gfResult('a',${JSON.stringify(at(1))},'strength-control'));
    state=gfApply(state,results,gfResult('b',${JSON.stringify(at(3))},'core-stability'));
    results.push(GarageFitCoachModel.createSessionResult({sessionResultId:'g',source:'generator',startedAt:${JSON.stringify(at(4))},endedAt:${JSON.stringify(at(4))},finalStatus:'completed',
      workoutFamilyId:'mobility-movement-quality',workoutFamilyVersion:1,familyStyleId:'integrated-flow',
      plannedWork:[{occurrenceId:'g:0',exerciseId:'air-squat',section:'main'}],performedWork:[{occurrenceId:'g:0',exerciseId:'air-squat',status:'completed'}]}));
    results.push(GarageFitCoachModel.createSessionResult({sessionResultId:'u',source:'coach',programmeInstanceId:'gf',prescriptionId:'rx-u',startedAt:${JSON.stringify(at(5))},endedAt:${JSON.stringify(at(5))},finalStatus:'partial',
      workoutFamilyId:'cardio-conditioning',workoutFamilyVersion:1,familyStyleId:'endurance',
      plannedWork:[{occurrenceId:'u:0',exerciseId:'air-squat',section:'main'}],performedWork:[{occurrenceId:'u:0',exerciseId:'air-squat',status:'partial',note:'some'}]}));
    return {now:policy.balanceSummary({definition:GF,history:gfHistory(results),catalogue:CATALOGUE,now:${JSON.stringify(at(6))}}),
      empty:policy.balanceSummary({definition:GF,history:gfHistory([]),catalogue:CATALOGUE,now:${JSON.stringify(at(6))}}),
      later:policy.balanceSummary({definition:GF,history:gfHistory(results),catalogue:CATALOGUE,now:${JSON.stringify(at(60))}})};})()`);
  const status = out => Object.fromEntries(out.effects.map(item => [item.effect, item.status]));
  assert.deepEqual(status(summary.now), {strength: 'performed', conditioning: 'not-performed', challenge: 'not-performed', athletic: 'not-performed', core: 'performed', mobility: 'performed'});
  assert.equal(summary.now.unmeasuredSessions, 1, 'unmeasured work is visible and never credited');
  assert.equal(summary.now.sessionCount, 3);
  assert.ok(summary.empty.effects.every(item => item.status === 'not-performed') && summary.empty.sessionCount === 0);
  assert.ok(summary.later.effects.every(item => item.status === 'not-performed'), 'balance covers the rolling window only');
});

// The real Coach screens: preview, player affordance and the three separate progress views.
async function ui(storage = new Map()) {
  const p = pilot(storage, 'general-fitness', 2);
  p.run(`const NativeDate=Date;let uiNow='${at(0)}';
    Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[uiNow]));} static now(){return Date.parse(uiNow);}};
    state.ownedEquipment=[];
    let seed=33;Math.random=()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
    function nodes(id='coachContent'){const visit=node=>[node,...(node.children||[]).flatMap(visit)];return visit(document.getElementById(id));}
    function action(label,id='coachContent'){return nodes(id).find(node=>node.textContent===label&&node.onclick);}
    function copyText(id='coachContent'){return nodes(id).map(node=>node.textContent).join(' ');}
    function uiDay(days){uiNow=new NativeDate(${T0}+days*${DAY}).toISOString();}`);
  await p.run('coachUI.open()');
  p.click = (label, id = 'coachContent') => p.run(`action(${JSON.stringify(label)},${JSON.stringify(id)}).onclick()`);
  p.text = (id = 'coachContent') => p.run(`copyText(${JSON.stringify(id)})`);
  p.state = () => p.json('coachUI.controller.snapshot().state');
  p.day = days => p.run(`uiDay(${days})`);
  // One saved ordinary session through the live Coach screens.
  p.session = async (days, record = '(async()=>{const tracker=coachPlayerTracker();for(const work of tracker.plannedWork().filter(item=>item.section===\'main\'))await tracker.recordDone(work.occurrenceId);})()') => {
    p.day(days); await p.run('coachUI.open()');
    await p.click('View today’s workout'); await p.click('Start workout', 'coachPreviewContent');
    await p.run(record); await p.run("coachUI.showEnd('complete',600)"); await p.run("coachUI.saveFeedback('about-right')");
  };
  return p;
}
async function uiUntilOffered(p) {
  await p.click('General Fitness'); await p.click('Start programme');
  for (let day = 0; day < 20; day++) {
    p.day(day); await p.run('coachUI.open()');
    if (p.json("coachUI.controller.plan({equipment:[],duration:30}).rationale.priorities.benchmark").status === 'offered') return day;
    await p.session(day);
  }
  throw new Error('no benchmark was offered');
}

test('the start screen describes benchmarks as occasional and optional', async () => {
  const p = await ui();
  await p.click('General Fitness');
  assert.match(p.text().replace(/\s+/g, ' '), /Every four weeks or so, a short optional benchmark may be offered first in a suitable Strength & Control session.*Skip it any time; nothing is owed/);
});

test('the preview and player offer an optional benchmark that records exactly what the user enters', async () => {
  const p = await ui();
  const day = await uiUntilOffered(p);
  p.day(day); await p.run('coachUI.open()');
  await p.click('View today’s workout');
  const preview = p.text('coachPreviewContent').replace(/\s+/g, ' ');
  assert.match(preview, /Optional benchmark first: one set each of a few bodyweight exercises/);
  assert.match(preview, /Block 1 of 4 Optional benchmark · Mini-circuit · 1 round/);
  assert.match(preview, /As many controlled reps as you can/);
  assert.match(preview, /Push-up .*Air squat .*Lying leg raise/);
  assert.ok(p.json('coachUI.controller.snapshot().preview.workout.main.blocks[0].benchmark'));
  // Edit mode protects the comparable measurement but still lets the family's other work be swapped.
  await p.click('Edit Workout', 'coachPreviewContent');
  const swappable = p.json("nodes('coachPreviewContent').filter(node=>node.textContent==='Swap'&&node.onclick).length");
  assert.equal(swappable, p.json('coachUI.controller.snapshot().preview.workout.main.blocks.slice(1).flatMap(block=>block.exercises).length'),
    'every family row is swappable and no benchmark row is');
  await p.click('Done Editing', 'coachPreviewContent');
  await p.click('Start workout', 'coachPreviewContent');
  // The first Main phase is the benchmark: the shared actuals panel appears with blank reps and optional wording.
  p.run(`const benchIndex=generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.benchmark);enterGeneratedPhase(benchIndex);`);
  assert.equal(p.run("document.getElementById('coachAnchorLog').classList.contains('hidden')"), false);
  assert.equal(p.run("document.getElementById('coachActualReps').value"), '', 'planned reps are never copied in as an actual result');
  assert.match(p.run("document.getElementById('coachAnchorPlanned').textContent"), /Optional benchmark.*Skip it any time; nothing is owed/);
  assert.equal(p.run("document.getElementById('coachSameSetupText').textContent"), 'I did this with bodyweight only, no added load');
  assert.equal(p.run("document.getElementById('coachNumericLoad').classList.contains('hidden')"), true);
  assert.equal(p.run("document.getElementById('coachSkipBtn').classList.contains('hidden')"), false, 'the benchmark can be skipped');
  assert.match(p.run("document.getElementById('coachActualSummary').textContent"), /reps not entered, so nothing to compare/);
  // Done with nothing entered records an unknown measurement, not planned reps.
  p.run("document.getElementById('coachActualReps').value='12';document.getElementById('coachSameSetup').checked=true;coachUI.updateActualSummary();");
  assert.match(p.run("document.getElementById('coachActualSummary').textContent"), /12 reps · bodyweight setup confirmed/);
  await p.run("coachAdvance('done')");
  const first = p.json("coachPlayerTracker().plannedWork().filter(item=>item.requirementId)[0]");
  assert.deepEqual(p.json(`coachPlayerTracker().outcome(${JSON.stringify(first.occurrenceId)})`).sets, [{reps: 12, load: null, resistanceSetup: 'bodyweight'}]);
  // The next benchmark: skip it.
  p.run(`enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.benchmark&&phase.benchmark.benchmarkId==='air-squat'));`);
  assert.equal(p.run("document.getElementById('coachActualReps').value"), '');
  await p.run("coachAdvance('skip')");
  const second = p.json("coachPlayerTracker().plannedWork().filter(item=>item.requirementId)[1]");
  assert.equal(p.json(`coachPlayerTracker().outcome(${JSON.stringify(second.occurrenceId)})`).status, 'skipped');
  // The third: Done with blank reps and no confirmation stays unknown.
  p.run(`enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.benchmark&&phase.benchmark.benchmarkId==='leg-raises'));`);
  await p.run("coachAdvance('done')");
  const third = p.json("coachPlayerTracker().plannedWork().filter(item=>item.requirementId)[2]");
  assert.deepEqual(p.json(`coachPlayerTracker().outcome(${JSON.stringify(third.occurrenceId)})`).sets, [{reps: null, load: null}]);
  await p.run(`(async()=>{const tracker=coachPlayerTracker();for(const work of tracker.plannedWork().filter(item=>item.section==='main'&&!item.requirementId))await tracker.recordDone(work.occurrenceId);})()`);
  await p.run("coachUI.showEnd('complete',900)"); await p.run("coachUI.saveFeedback('about-right')");
  assert.match(p.text(), /Session saved · completed · Strength & Control — .* · 1 benchmark recorded/);
  assert.equal(p.state().anchors.length, 0);
  const saved = p.json('coachUI.controller.snapshot().results').at(-1);
  assert.equal(saved.workoutFamilyId, 'strength-control');
  assert.deepEqual(saved.anchorResults.filter(item => item.requirementId.startsWith('benchmark:')).map(item => item.status), ['completed', 'skipped', 'completed']);
  // The ordinary player affordance is hidden again once the benchmark phases are over.
  p.run('enterGeneratedPhase(0);');
});

test('Your progress keeps training consistency, capability balance and comparable improvement separate and honest', async () => {
  const p = await ui();
  await p.click('General Fitness'); await p.click('Start programme');
  p.day(1); await p.run('coachUI.open()');
  await p.click('Your progress');
  const empty = p.text('coachProgressContent').replace(/\s+/g, ' ');
  const order = ['Training consistency · last 4 weeks', 'Capability balance · last 28 days', 'Demonstrated comparable improvement', 'Recent sessions'].map(label => empty.indexOf(label));
  assert.ok(order.every(index => index > 0) && order.every((index, i) => !i || index > order[i - 1]), 'three separate sections precede Recent sessions: ' + order);
  assert.match(empty, /This week · 0 sessions .* Active weeks · 0 of 4/);
  assert.match(empty, /No performed training has been recorded in this window yet/);
  assert.match(empty, /Not enough comparable evidence yet\. Improvement is shown only when the same benchmark is recorded again under identical conditions/);
  assert.match(empty, /Push-up Push Not measured yet/);
  assert.doesNotMatch(empty, /score|fitness level|VO2|recovery score|steps|heart rate|Strength targets/i);
  assert.ok(p.json("nodes('coachProgressContent').filter(node=>node.className==='coach-progress-card-button').length") === 6 + 3, 'six balance cards and three benchmark cards');
  // Read-only: viewing progress writes nothing.
  const before = [...p.storage.entries()];
  await p.run('coachUI.openProgress()');
  assert.deepEqual([...p.storage.entries()], before);
  await p.run('coachUI.back()');

  // Two benchmark sessions four weeks apart under identical conditions, one with changed conditions in between.
  const day = await uiUntilOfferedFrom(p);
  const record = reps => `(async()=>{const tracker=coachPlayerTracker();for(const work of tracker.plannedWork().filter(item=>item.requirementId))
    await tracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:${reps},resistanceSetup:'bodyweight'}]});
    for(const work of tracker.plannedWork().filter(item=>item.section==='main'&&!item.requirementId))await tracker.recordDone(work.occurrenceId);})()`;
  await p.session(day, record(10));
  const afterOne = await openProgressText(p, day + 1);
  assert.match(afterOne, /Push-up Push Not enough comparable evidence/);
  assert.match(afterOne, /Baseline · 10 reps/);
  assert.match(afterOne, /Not enough comparable evidence yet/);
  const next = await uiUntilOfferedFrom(p, day + 28);
  assert.ok(next >= day + 28, 'not offered again within four weeks');
  await p.session(next, record(13));
  const afterTwo = await openProgressText(p, next + 1);
  assert.match(afterTwo, /3 of 3 compared benchmarks improved/);
  assert.match(afterTwo, /Improved · 10 → 13 reps/);
  assert.match(afterTwo, /Same exercise, bodyweight setup and protocol conditions/);
  assert.match(afterTwo, /Training consistency/);
  assert.match(afterTwo, /Strength Performed/);
  assert.doesNotMatch(afterTwo, /score/i);
});
async function uiUntilOfferedFrom(p, from = 0) {
  for (let day = from; day < from + 40; day++) {
    p.day(day); await p.run('coachUI.open()');
    if (p.json("coachUI.controller.plan({equipment:[],duration:30}).rationale.priorities.benchmark").status === 'offered') return day;
    await p.session(day);
  }
  throw new Error('no benchmark was offered');
}
async function openProgressText(p, day) {
  p.day(day); await p.run('coachUI.open()'); await p.click('Your progress');
  const text = p.text('coachProgressContent') + ' ' + p.json("nodes('coachProgressContent').filter(node=>node.className==='coach-progress-detail').map(node=>nodes('coachProgressContent').length&&[node,...node.children].map(child=>child.textContent).join(' '))").join(' ');
  await p.run('coachUI.back()');
  return text.replace(/\s+/g, ' ');
}

test('legacy anchor programmes and standalone workouts are untouched by benchmark support', async () => {
  const legacy = pilot(new Map(), 'general-strength-4w', 1);
  await legacy.start();
  legacy.run("pilot.prepare({equipment:['dumbbells'],duration:30})");
  const preview = legacy.json('pilot.snapshot().preview');
  assert.equal(preview.plan.prescription.workoutFamilyPlan, undefined);
  assert.ok(preview.workout.main.blocks.every(block => block.benchmark === undefined));
  assert.equal(legacy.json('pilot.progressEvidence()').benchmarkResults.length, 0);
  await legacy.begin('pilotOptions');
  assert.ok(legacy.json('pilotTracker.plannedWork()').every(item => !(item.requirementId || '').startsWith('benchmark:')));
  const standalone = pilot(new Map(), 'general-fitness', 2);
  const workout = standalone.json("GarageFitGenerator.generate({catalogue:CATALOGUE,duration:20,workoutFamilyId:'strength-control',equipment:[],random:()=>0.4})");
  assert.ok(workout.main.blocks.every(block => !block.benchmark), 'a standalone family request never carries a benchmark');
});
