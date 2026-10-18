// Bounded, seeded pilot using the production controller, generated timeline,
// tracker checkpoints, immutable results and Store. Actuals below are explicit
// simulated user confirmations, never assumed from a generated prescription.
const assert = require('node:assert/strict');
const {pilot} = require('./coach-pilot');
const copy = value => JSON.parse(JSON.stringify(value));
const day = offset => new Date(Date.UTC(2026,9,1,12)+offset*86400000).toISOString();
const kits = {
  bodyweight: [], dumbbells: ['dumbbells'], kettlebell: ['kettlebell'],
  trx: ['trx'], pullup: ['pullup-bar'],
  'kb-pullup': ['kettlebell','pullup-bar'],
  'db-trx': ['dumbbells','trx'],
  mixed: ['dumbbells','kettlebell','trx','pullup-bar']
};
function seed(p, value) {
  p.run(`{let s=${value >>> 0};Math.random=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}`);
}
async function create({equipment=kits.dumbbells, frequency=2, focus='balanced', settings={},version=5}={}) {
  const p=pilot(new Map(),'tennis-conditioning',version);
  p.run(`pilotNow=${JSON.stringify(day(0))};pilotOptions.equipment=${JSON.stringify(equipment)}`);
  const started=await p.run(`pilot.start(pilotDef,pilotOptions.equipment,${JSON.stringify({sportId:'tennis',focus,weeklyCoachFrequency:frequency,...settings})})`);
  return {p,started};
}
function validate(p, preview, requested) {
  const workout=copy(preview.workout), rx=copy(preview.plan.prescription);
  assert.ok(workout.estimatedSeconds<=requested*60);
  assert.ok(workout.estimatedSeconds<=rx.maximumDurationSeconds);
  assert.ok(['feasible','partially-feasible'].includes(workout.prescriptionOutcome.status));
  for(const section of ['warmup','rampup','cooldown']) assert.ok(workout[section].estimatedSeconds>0);
  const work=p.json('GarageFitSessionTracker.plannedWorkFromTimeline(buildGeneratedTimeline(pilot.snapshot().preview.workout))');
  for(const target of rx.requiredAnchors) {
    const selected=work.filter(w=>w.requirementId===target.requirementId);
    assert.ok(workout.prescriptionOutcome.satisfiedHardRequirementIds.includes(target.requirementId));
    const perSide=p.run(`CATALOGUE[${JSON.stringify(target.exerciseId)}].sidedness==='per-side'`);
    assert.equal(selected.length,target.targetSets*(perSide?2:1),target.requirementId);
    assert.ok(selected.every(w=>w.exerciseId===target.exerciseId&&w.prescription.protocol==='rounds'));
    if(target.requirementId.startsWith('tennis-anchor-')) {
      assert.ok(selected.every(w=>w.prescription.protocolConditions.exerciseRestSeconds===20 && w.prescription.protocolConditions.roundRestSeconds===60));
      assert.ok(target.target.maxReps>=6&&target.target.maxReps<=10);
    }
  }
  if(rx.difficulty==='easy') {
    for(const section of [workout.warmup,workout.rampup,workout.cooldown])
      assert.ok(section.exercises.every(e=>e.impact!=='high'));
    assert.ok(workout.main.blocks.flatMap(b=>b.exercises).every(e=>e.impact!=='high'));
  }
  return {workout,rx,work};
}
async function confirm(p,{only=null,unknown=false,skip=null,partial=false}={}) {
  return p.run(`(async()=>{
    const stable=new Set(pilot.snapshot().state.anchors.map(a=>a.requirementId));
    const resistance=pilot.snapshot().preview.plan.prescription.programmeContext.anchorResistance;
    const entries=pilotTracker.plannedWork();
    for(const w of entries){
      if(${JSON.stringify(only)} && w.requirementId!==${JSON.stringify(only)})continue;
      if(w.requirementId===${JSON.stringify(skip)}){await pilotTracker.recordSkip(w.occurrenceId);continue;}
      if(${partial} && w.section!=='main')continue;
      if(w.prescription.timed){await pilotTracker.recordTimed(w.occurrenceId,{plannedSeconds:w.prescription.seconds,elapsedSeconds:${partial} ? w.prescription.seconds/2:w.prescription.seconds});}
      else if(stable.has(w.requirementId)){
        const actual=${unknown} ? {load:null} : resistance[w.requirementId]?.numericLoad
          ? {load:12,loadUnit:'kg',loadInterpretation:'total'} : {load:null,resistanceSetup:resistance[w.requirementId].setup};
        await pilotTracker.recordAnchor(w.occurrenceId,{status:'completed',sets:[{reps:w.prescription.reps,...actual}]});
      } else await pilotTracker.recordDone(w.occurrenceId);
      if(${partial})break;
    }
  })()`);
}
function summary(p) {
  return p.json(`GarageFitSportCoverage.createPolicy(GarageFitData.sportCapabilityPolicies.tennis[pilotDef.sportPolicy.version],CATALOGUE).summarize(
    GarageFitTrainingHistory.createHistory(pilot.snapshot().results,CATALOGUE),{
      now:pilotNow,programmeInstanceId:pilot.snapshot().state.programmeInstanceId,equipment:pilotOptions.equipment,smallSpace:true})`);
}
async function simulate({frequency=2,duration=30,equipment=kits.dumbbells,weeks=8,seedValue=95,smallSpace=true,version=5}={}) {
  const {p,started}=await create({frequency,equipment,version});
  assert.ok(started.state);
  const identities=p.json('pilot.snapshot().state.anchors.map(a=>a.exerciseId)'), baseline=p.json('pilot.snapshot().state.anchors');
  const roles={},support=new Set(),windows=[],examples=[];
  let attempted=0,performed=0,consolidations=0,blocked=0;
  for(let week=0;week<weeks;week++) for(let slot=0;slot<frequency;slot++) {
    const offset=week*7+Math.floor(slot*7/frequency), at=day(offset);
    p.run(`pilotNow=${JSON.stringify(at)}`);
    const before=p.json('pilot.snapshot().state'); seed(p,seedValue+offset);
    const preview=p.run(`pilot.prepare({...pilotOptions,duration:${duration},smallSpace:${smallSpace}})`);attempted++;
    assert.deepEqual(p.json('pilot.snapshot().state'),before,'preview is read-only');
    if(!preview.workout){blocked++;assert.ok(preview.plan.conflicts.length);continue;}
    const {workout,rx}=validate(p,preview,duration);
    roles[rx.sessionRole]=(roles[rx.sessionRole]||0)+1;
    if(rx.programmeContext.phase.phase==='consolidation')consolidations++;
    const anchors=new Set(identities);
    workout.main.blocks.flatMap(b=>b.exercises).filter(e=>!anchors.has(e.id)).forEach(e=>support.add(e.id));
    const saved=copy((await p.run('pilotStore.listSessionResults()')).results);
    await p.run('pilot.begin().then(t=>{pilotTracker=t})');
    await confirm(p);const result=await p.finish('complete');performed++;
    assert.equal(result.finalStatus,'completed');
    assert.deepEqual(copy((await p.run('pilotStore.listSessionResults()')).results).filter(r=>saved.some(s=>s.sessionResultId===r.sessionResultId)),saved,'old results immutable');
    assert.deepEqual(p.json('pilot.snapshot().state.anchors.map(a=>a.exerciseId)'),identities);
    const state=p.json('pilot.snapshot().state');
    assert.deepEqual(p.json('pilotEngine.applySessionResult(pilotDef,pilot.snapshot().state,pilot.snapshot().results.at(-1),pilot.snapshot().results)'),state,'replay has no credit');
    if(week>=2&&slot===frequency-1)windows.push(summary(p).capabilities.map(c=>({id:c.capabilityId,coverage:c.coverage})));
    if(examples.length<2)examples.push({seed:seedValue+offset,date:at.slice(0,10),role:rx.sessionRole,seconds:workout.estimatedSeconds,
      required:rx.requiredAnchors.map(a=>({id:a.exerciseId,sets:a.targetSets,target:a.target})),main:workout.main.blocks.flatMap(b=>b.exercises).map(e=>e.id)});
  }
  const final=p.json('pilot.snapshot().state');
  assert.equal(final.meaningfulSessionsCompleted,performed);
  await p.run('pilot.load(true)');assert.deepEqual(p.json('pilot.snapshot().state'),final);
  return {frequency,duration,equipment,smallSpace,attempted,performed,blocked,roles,consolidations,supportVariety:support.size,
    coverageWindows:windows,initialAnchors:baseline.map(a=>({id:a.exerciseId,reps:a.currentTarget.target.maxReps})),
    finalAnchors:final.anchors.map(a=>({id:a.exerciseId,reps:a.currentTarget.target.maxReps})),examples};
}
async function matrix({focuses=['balanced','movement','power','endurance','resilience'],frequencies=[1,2,3]}={}) {
  const totals={cells:0,feasible:0,rest:0,startBlocked:0,warnings:0}, shortages={};
  let index=0;
  for(const focus of focuses)
    for(const frequency of frequencies) for(const [name,equipment] of Object.entries(kits)) {
      const intensity=['light','moderate','hard'][index%3];
      const settings={typicalSportIntensity:intensity,usualPlayingDays:index%2?[]:['thursday']};
      const {p,started}=await create({equipment,frequency,focus,settings});
      if(!started.state){totals.cells+=5;totals.startBlocked+=5;shortages[name]=copy(started.assessment.conflicts);index++;continue;}
      for(const duration of [10,15,20,30,45]) {
        const readiness=['fresh','normal','tired',null][index%4];
        const horizon=[null,1,5,56][index%4];
        if(horizon!==null) await p.run(`pilot.saveProgrammeSettings({intent:'event',significantEventDate:${JSON.stringify(day(horizon).slice(0,10))}})`);
        else await p.run("pilot.saveProgrammeSettings({intent:'ongoing',significantEventDate:null,significantEventLabel:null})");
        const before=p.json('pilot.snapshot().state');seed(p,95+index);
        const options={equipment,duration,sessionContext:{
          ...(readiness?{readiness:{value:readiness,localDate:'2026-10-01'}}:{}),
          ...(index%5===2?{reportedSportActivity:[{sportId:'tennis',localDate:'2026-10-01',intensity:'hard'}]}:{})}};
        const preview=p.run(`pilot.prepare(${JSON.stringify(options)})`);totals.cells++;
        assert.deepEqual(p.json('pilot.snapshot().state'),before);
        if(preview.workout){validate(p,preview,duration);totals.feasible++;totals.warnings+=preview.plan.prescription.programmeContext.warnings?.length||0;}
        else {totals.rest++;assert.ok(preview.plan.conflicts.length);assert.equal(p.run('pilot.snapshot().preview'),null);}
        assert.equal(p.run('pilot.snapshot().results.length'),0);
        index++;
      }
    }
  return {totals,shortages};
}
module.exports={create,seed,validate,confirm,summary,simulate,matrix,kits,day};
