const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');
const {traceBlock} = require('./helpers/protocol-fixtures');

const DURATIONS = [10,15,20,30,45], DIFFICULTIES = ['easy','normal','hard'];
const SEEDS = [31,2026];
// Each profile runs the complete 180-route matrix, not just a few favourable examples.
const PROFILES = [
  {name:'bodyweight',equipment:[]},
  {name:'equipment',equipment:['dumbbells','trx','rings'],movementRoom:true},
  {name:'low-impact-room',equipment:[],excludedImpact:['medium','high'],movementRoom:true},
  {name:'small-space-standing',equipment:[],excludedImpact:['high'],movementRoom:false,bodyPositions:['standing']}
];
const plain = value => JSON.parse(JSON.stringify(value));
function rng(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }

// Independently walk the shipped player schedule, including the post-inline Ramp-up
// extension. Ready and generic section-boundary cues are outside the estimate.
function verifyTimeline(p, workout, equipment) {
  const G=p.app.GarageFitGenerator, T=p.app.GarageFitSessionTracker;
  assert.equal(G.validateFamilyWorkout(workout,{catalogue:p.app.GarageFitData.exercises,equipment}).valid,true);
  const before=plain(workout), timeline=p.app.buildGeneratedTimeline(workout);
  assert.deepEqual(plain(workout),before,'player normalization cannot repair an accepted stale plan');
  const work=timeline.filter(step=>step.kind==='exercise'), plan=T.plannedWorkFromTimeline(timeline);
  assert.equal(plan.length,work.length);
  assert.equal(new Set(work.map(step=>step.occurrenceId)).size,work.length);
  assert.ok(timeline.filter(step=>step.kind!=='exercise').every(step=>!step.occurrenceId));
  let seconds=0;
  const caps=new Set();
  for (const step of timeline) {
    if (step.protocol==='density') {
      if(!caps.has(step.blockIndex)) {seconds+=workout.main.blocks[step.blockIndex].prescription.timeCapSeconds;caps.add(step.blockIndex);}
    } else if(step.protocol==='emom'&&step.kind==='exercise') seconds+=step.endsAtSeconds-step.startsAtSeconds;
    else if(step.kind==='exercise') seconds+=step.timed?step.seconds:(step.estimatedSeconds??step.exercise.estimatedSeconds)/G.sideCount(step.exercise);
    else seconds+=step.seconds;
    if(step.kind==='exercise') {
      assert.ok(G.requirementsMet(step.exercise,equipment),step.exercise.id);
      const constraints=workout.familyConstraints||{};
      assert.equal((constraints.excludedImpact||[]).includes(step.exercise.impact),false,'excluded impact in '+step.section+': '+step.exercise.id);
      if(constraints.bodyPositions)assert.ok(constraints.bodyPositions.includes(step.exercise.bodyPosition),'excluded position in '+step.section+': '+step.exercise.id);
      if(step.exercise.sidedness==='per-side') {
        const index=timeline.indexOf(step), other=timeline[index+(step.side==='right'?1:-1)];
        assert.equal(other.exercise.id,step.exercise.id);
        assert.equal(other.seconds,step.seconds);
        assert.notEqual(other.side,step.side);
      }
    }
  }
  const warm=workout.warmup.exercises.length>0,ramp=workout.rampup.exercises.length>0,cool=workout.cooldown.exercises.length>0;
  const overhead=3+3*Number(warm&&ramp)+3*Number(warm||ramp)+3*Number(cool);
  assert.equal(seconds-overhead,workout.estimatedSeconds,'full player including Ramp-up agrees with preview');
  assert.ok(workout.estimatedSeconds<=workout.duration*60);
  for(const block of workout.main.blocks) {
    const trace=traceBlock(G,block);
    assert.deepEqual(trace.problems,[]);
    assert.deepEqual(plain(G.validateOccurrenceTargets(block,p.app.GarageFitData.exercises)),[]);
    assert.deepEqual(plain(G.validateOccurrenceRecovery(block)),[]);
  }
  return {timeline,plan};
}

// These sweeps exercise real production composers through BOTH construction routes;
// individual catalogue, duration-profile and fallback tests stay in their existing suites.
test('six representative families use the shipped Ramp-up player and truthful work-only tracker plan',()=>{
  const p=pilot(new Map(),'general-fitness',2,{rampupUi:true});
  for(const workoutFamilyId of p.app.GarageFitWorkoutFamilies.FAMILY_IDS) {
    const workout=p.app.GarageFitGenerator.generate({workoutFamilyId,duration:10,difficulty:'normal',equipment:[],catalogue:p.app.GarageFitData.exercises,random:rng(31)});
    const {timeline}=verifyTimeline(p,workout,[]);
    assert.equal(timeline.some(step=>step.section==='rampup'&&step.kind==='exercise'),workout.rampup.exercises.length>0);
    const rx=p.run(`GarageFitCoachModel.createSessionPrescription({prescriptionId:'representative',programmeInstanceId:'gate',sessionRole:'general-fitness',duration:10,difficulty:'normal',equipment:[],workoutFamilyPlan:{candidates:[{workoutFamilyId:${JSON.stringify(workoutFamilyId)},workoutFamilyVersion:1,rationale:'Explicit family release check.'}]}})`);
    const coach=p.app.GarageFitGenerator.generate({catalogue:p.app.GarageFitData.exercises,sessionPrescription:rx,random:rng(31)});
    assert.deepEqual(plain(coach.main),plain(workout.main),'representative route parity');
    verifyTimeline(p,coach,[]);
  }
});

test('[Full] integrated six-family matrix: 180 routes × two seeds × four safety/equipment profiles', t => {
  const p=pilot(new Map(),'general-fitness',2,{rampupUi:true}), G=p.app.GarageFitGenerator;
  const catalogue=p.app.GarageFitData.exercises, counts={passed:0,infeasible:0,unverified:0}, byProfile={};
  const infeasible=[], parity=new Map();
  for(const profile of PROFILES) {
    const {name,...context}=profile, totals=byProfile[name]={passed:0,infeasible:0};
    for(const family of p.app.GarageFitWorkoutFamilies.FAMILY_IDS) for(const duration of DURATIONS)
      for(const difficulty of DIFFICULTIES) for(const seed of SEEDS) for(const route of ['generator','coach']) {
        const label=[name,family,duration,difficulty,seed,route].join('/');
        const key=[name,family,duration,difficulty,seed].join('/');
        const {equipment,...constraints}=context;
        let workout;
        try {
          if(route==='generator') workout=G.generate({catalogue,workoutFamilyId:family,duration,difficulty,...context,random:rng(seed)});
          else {
            p.app.matrixInput={duration,difficulty,equipment,workoutFamilyPlan:{candidates:[{workoutFamilyId:family,workoutFamilyVersion:1,rationale:'Integrated release gate: explicit family.'}],...constraints}};
            workout=p.run(`GarageFitGenerator.generate({catalogue:CATALOGUE,random:${rng.toString()}(${seed}),sessionPrescription:GarageFitCoachModel.createSessionPrescription({prescriptionId:'matrix',programmeInstanceId:'gate',sessionRole:'general-fitness',...JSON.parse(JSON.stringify(matrixInput))})})`);
          }
        } catch(error) {
          const reasons=route==='generator'?error.reasons:error.assessment?.hardConflicts?.flatMap(conflict=>conflict.attempts||[]).flatMap(attempt=>attempt.reasons||[]);
          assert.equal(error.code,route==='generator'?'family-not-feasible':'session-prescription-infeasible',label+': '+error.stack);
          assert.ok(reasons?.length,label+': unavailability needs concrete reasons');
          assert.ok(reasons.every(reason=>['no-buildable-style','insufficient-eligible-movements','phase-cannot-fit','preparation-not-feasible'].includes(reason.code)),label+': technical/quality failures are defects, not genuine infeasibility');
          // Baseline bodyweight and confirmed equipment have no artificial position/impact restriction.
          assert.ok(name==='low-impact-room'||name==='small-space-standing',label+': unexpected baseline infeasibility');
          infeasible.push({label,reasons:plain(reasons).map(reason=>reason.code)});
          if(route==='generator')parity.set(key,'infeasible');else assert.equal(parity.get(key),'infeasible',label+': route parity');
          counts.infeasible++;totals.infeasible++;continue;
        }
        assert.equal(workout.workoutFamilyId,family,label+': explicit family must never cross');
        assert.equal(workout.workoutFamilyVersion,1);
        assert.equal(workout.duration,duration);assert.equal(workout.difficulty,difficulty);
        assert.deepEqual(plain(workout.familyConstraints||{}),constraints,label+': no silent constraint relaxation');
        try {verifyTimeline(p,workout,equipment);} catch(error) {error.message=label+': '+error.message;throw error;}
        const signature=JSON.stringify([workout.familyStyleId,workout.main,workout.warmup,workout.rampup,workout.cooldown]);
        if(route==='generator')parity.set(key,signature);else assert.equal(signature,parity.get(key),label+': same seed and constraints resolve identically');
        counts.passed++;totals.passed++;
      }
  }
  assert.equal(counts.passed+counts.infeasible,1440);
  t.diagnostic(JSON.stringify({counts,byProfile,infeasible}));
});

test('[Full] actual 20-session General Fitness v2 experiences at 2/3/5 weekly: completed, partial and missed', async t => {
  const summaries=[];
  for(const weekly of [2,3,5]) {
    const p=pilot(new Map(),'general-fitness',2,{rampupUi:true});
    p.run(`Math.random=(${rng.toString()})(2026);`);
    await p.run('pilot.start(pilotDef,[])');
    await p.run("pilot.saveExternalActivityPreferences([{activityType:'Tennis',sessionsPerWeek:2},{activityType:'Cycling',sessionsPerWeek:2}])");
    // A real saved standalone workout is training context, never programme attendance.
    await p.run(`(async()=>{
      const workout=GarageFitGenerator.generate({catalogue:CATALOGUE,workoutFamilyId:'strength-control',duration:20,equipment:[],random:Math.random});
      const tracker=GarageFitSessionTracker.createTracker({source:'generator',store:pilotStore,clock:()=>pilotNow,
        ...GarageFitSessionTracker.identityFromWorkout(workout),workoutId:workout.id,
        plannedWork:GarageFitSessionTracker.plannedWorkFromTimeline(buildGeneratedTimeline(workout))});
      await tracker.start();
      for(const work of tracker.plannedWork().filter(item=>item.section==='main')) await tracker.recordDone(work.occurrenceId);
      await tracker.complete();await pilotStore.clearSessionDraft();await pilot.load();
    })()`);
    assert.equal(p.json('pilot.snapshot().state').meaningfulSessionsCompleted,0);
    const results=[], delivered=[], scripts=new Set(), protocols=new Set(), styles=new Map();
    let completed=0,partial=0,missed=0;
    for(let i=0;i<20;i++) {
      const date=new Date(Date.parse('2026-10-02T08:00:00Z')+Math.round(i*7/weekly*24)*3600000).toISOString();
      p.run(`pilotNow=${JSON.stringify(date)}`);
      const duration=DURATIONS[i%DURATIONS.length],equipment=[[],['dumbbells'],['rings','trx']][i%3];
      const sessionContext=i%6===1?{reportedSportActivity:[{sportId:'tennis',localDate:date.slice(0,10),intensity:'hard'}]}:{};
      const input={duration,equipment,difficulty:i%8===4?'easy':'normal',sessionContext};
      const stateBefore=p.json('pilot.snapshot().state');
      const preview=p.run(`pilot.prepare(${JSON.stringify(input)})`), workout=preview.workout;
      assert.ok(workout,'real Coach route has a delivered workout');
      verifyTimeline(p,workout,equipment);
      const priorities=plain(preview.plan.rationale.priorities);
      assert.equal(priorities.externalActivity.typicalSessionsPerWeek,4);
      assert.equal(priorities.history.credit,'none');
      // Independently recompute rolling family-effect totals from actual recorded work.
      // Full confirmations count once; explicitly measured half work counts one half.
      const known=[...results,...p.json('pilot.progressEvidence().contextResults||[]')];
      const seen=new Set();
      const rolling=known.filter(result=>!seen.has(result.sessionResultId)&&seen.add(result.sessionResultId)
        &&Date.parse(result.endedAt)<=Date.parse(date)&&Date.parse(result.endedAt)>=Date.parse(date)-28*86400000);
      for(const session of priorities.history.sessions) {
        const result=rolling.find(item=>item.sessionResultId===session.sessionResultId);
        assert.ok(result,'history must come from an actual result: '+session.sessionResultId);
        const main=result.plannedWork.filter(item=>item.section==='main');
        const exposure=result.performedWork.filter(item=>main.some(plan=>plan.occurrenceId===item.occurrenceId))
          .reduce((sum,item)=>sum+(item.status==='completed'?1:0.5),0);
        assert.ok(Math.abs(session.weight-Math.min(1,exposure/main.length))<1e-9,'performed fraction, not planned/completed label');
      }
      for(const effect of priorities.effects) {
        const expected=priorities.history.sessions.reduce((sum,session)=>{
          const result=rolling.find(item=>item.sessionResultId===session.sessionResultId);
          const family=p.app.GarageFitData.programmes['general-fitness'][2].familyBalancePolicy.families.find(item=>item.workoutFamilyId===result.workoutFamilyId);
          return sum+session.weight*(family.effects[effect.effect]||0);
        },0);
        assert.ok(Math.abs(effect.performedSessions-expected)<1e-9,effect.effect+' performed effects');
      }
      assert.ok(priorities.effects.every(effect=>effect.performedSessions>=0));
      assert.equal(preview.plan.rationale.missedSessionResponse.catchUpSessions,0);
      if(sessionContext.reportedSportActivity) {
        assert.ok(priorities.recovery.reasons.includes('reported-hard-activity'));
        assert.ok(!['strength-control','cardio-conditioning','full-body-challenges'].includes(workout.workoutFamilyId));
        assert.equal(workout.main.blocks.some(block=>block.benchmark),false);
      }
      if(i%7===3) {
        missed++;
        assert.deepEqual(p.json('pilot.snapshot().state'),stateBefore,'a missed preview earns nothing and creates no debt');
        continue;
      }
      delivered.push(workout.workoutFamilyId);
      const familyStyles=styles.get(workout.workoutFamilyId)||new Set();familyStyles.add(workout.familyStyleId);styles.set(workout.workoutFamilyId,familyStyles);
      workout.main.blocks.forEach(block=>protocols.add(block.protocol));
      scripts.add(workout.main.blocks.map(block=>block.exercises.map(ex=>ex.id).join(',')).join('/'));
      await p.run('pilot.begin().then(value=>{pilotTracker=value})');
      const isPartial=i%5===2;
      await p.run(`(async()=>{
        const main=pilotTracker.plannedWork().filter(item=>item.section==='main');
        const selected=${isPartial} ? main.slice(0,Math.max(1,Math.floor(main.length/3))) : main;
        for(const [index,work] of selected.entries()) {
          if(${isPartial}&&index===selected.length-1) {
            const timed=work.prescription.timed, field=timed?'seconds':'reps', target=work.prescription[field];
            await pilotTracker.recordPartial(work.occurrenceId,{sets:[{[field]:target/2}]});
          } else await pilotTracker.recordDone(work.occurrenceId);
        }
      })()`);
      const result=await p.run(`pilot.finish('${isPartial?'exit':'complete'}',{difficulty:'about-right'},${isPartial?duration*20:duration*60})`);
      results.push(plain(result));
      assert.equal(result.finalStatus,isPartial?'partial':'completed');
      assert.equal(result.workoutFamilyId,workout.workoutFamilyId);assert.equal(result.familyStyleId,workout.familyStyleId);
      if(isPartial)partial++;else completed++;
      assert.equal(p.json('pilot.snapshot().state').meaningfulSessionsCompleted,completed+partial);
      assert.ok(result.performedWork.every(work=>work.status!=='skipped'));
      assert.equal(result.performedWork.some(work=>work.sets?.some(set=>set.load!==undefined&&set.load!==null)),false,'no invented measured loads');
    }
    assert.equal(completed+partial+missed,20);
    assert.ok(new Set(delivered).size>=5,'meaningful variety across actual experiences');
    assert.equal(scripts.size,delivered.length,'no identical whole Main script');
    assert.ok(protocols.size>=2,'not one generic circuit protocol');
    assert.ok([...styles.values()].some(values=>values.size>=2),'internal style variety where a family recurs');
    const final=p.json('pilot.snapshot()');
    const durable=await p.run("pilotStore.listSessionResults({programmeInstanceId:pilot.snapshot().state.programmeInstanceId,limit:64})");
    assert.equal(durable.results.length,completed+partial,'no external or missed completion');
    assert.equal(durable.errors.length,0);
    assert.deepEqual(final.state.anchors,[]);
    // Reload must preserve the actual evidence and credited state after the whole experience.
    const reload=pilot(p.storage,'general-fitness',2,{rampupUi:true});
    reload.run('pilotNow='+JSON.stringify(p.run('pilotNow')));
    await reload.run('pilot.load()');
    assert.deepEqual(reload.json('pilot.snapshot().state'),final.state);
    assert.deepEqual(reload.json('pilot.snapshot().results'),final.results);
    summaries.push({weekly,completed,partial,missed,families:Object.fromEntries([...styles].map(([id,values])=>[id,[...values]])),protocols:[...protocols]});
  }
  t.diagnostic(JSON.stringify(summaries));
});
