const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');

function context(version = 1) {
  const p = pilot(new Map(), 'general-fitness', version);
  p.run(`
    const now='2026-11-16T09:00:00Z';
    const gfV6State=pilotEngine.startProgramme(pilotDef,{programmeInstanceId:'gf',equipment:[]},'2026-11-01T09:00:00Z').state;
    function result({version=6, conditioning='low-impact-speed-skaters', mode='completed', mainCount=10, conditioningCount=10, seconds=30}={}) {
      const ids=[...Array(mainCount).fill('single-leg-balance-reach'),...Array(conditioningCount).fill(conditioning)];
      const plannedWork=ids.map((exerciseId,i)=>({occurrenceId:'o'+i,exerciseId,section:'main',prescription:{type:'timed',timed:true,seconds,protocol:'rounds'}}));
      // Energetic preparation and finish must never change Main classification.
      plannedWork.push({occurrenceId:'warm',exerciseId:conditioning,section:'warmup',prescription:{type:'timed',timed:true,seconds:300}},
        {occurrenceId:'cool',exerciseId:conditioning,section:'cooldown',prescription:{type:'timed',timed:true,seconds:300}});
      const performedWork=plannedWork.map((work,i)=>({occurrenceId:work.occurrenceId,exerciseId:work.exerciseId,
        status:i<mainCount||i>=ids.length?'completed':mode==='skip'?'skipped':mode==='partial'||mode==='unknown'?'partial':'completed',
        ...(i>=mainCount&&i<ids.length&&mode==='partial'?{sets:[{seconds:seconds/2}]}:{}),
        ...(i>=mainCount&&i<ids.length&&mode==='zero'?{sets:[{seconds:0}]}:{})}));
      return GarageFitCoachModel.createSessionResult({sessionResultId:'v6',source:'generator',workoutFamilyId:'athletic-movement',workoutFamilyVersion:version,
        familyStyleId:'athletic-conditioning',startedAt:'2026-11-16T08:00:00Z',endedAt:'2026-11-16T08:30:00Z',finalStatus:'completed',plannedWork,performedWork});
    }
    function priorities(r) {return pilotEngine.planNextSession(pilotDef,gfV6State,[r],{now,prescriptionId:'next',equipment:[],duration:30}).rationale.priorities;}
    function effect(p,id){return p.effects.find(item=>item.effect===id).performedSessions;}
  `);
  return p;
}

test('v6 performed energetic Main earns proportional conditioning and recovery in both released GF definitions', () => {
  for (const version of [1,2]) {
    const p=context(version);
    const out=p.json(`(()=>{const r=result(),before=JSON.stringify(r),p=priorities(r);return {athletic:effect(p,'athletic'),conditioning:effect(p,'conditioning'),
      recovery:p.recovery,history:p.history,unchanged:before===JSON.stringify(r),state:gfV6State};})()`);
    assert.equal(out.athletic,1-1/3); assert.equal(out.conditioning,1/3);
    assert.deepEqual(out.recovery,{preferLowerDemand:true,reasons:['recent-demanding-session']});
    assert.equal(out.history.sessions[0].basis,'athletic-v6-performed-main');
    assert.equal(out.history.credit,'none'); assert.equal(out.state.meaningfulSessionsCompleted,0);
    assert.equal(out.unchanged,true);
  }
});

test('v6 skips, note-only partials, zero measurements, light cardio and warm-up/finish create no conditioning credit', () => {
  const p=context();
  for (const options of [{mode:'skip'},{mode:'unknown'},{mode:'zero'},{conditioning:'side-step-knee-lift'},
    {mainCount:20,conditioningCount:0},{conditioningCount:1}]) {
    const out=p.json(`(()=>{const p=priorities(result(${JSON.stringify(options)}));return {conditioning:effect(p,'conditioning'),recovery:p.recovery};})()`);
    assert.equal(out.conditioning,0,JSON.stringify(options));
    assert.equal(out.recovery.preferLowerDemand,false,JSON.stringify(options));
  }
});

test('measured partials earn only factual timed dose and demand thresholds use performed Main', () => {
  const p=context();
  const out=p.json(`(()=>{const p=priorities(result({mode:'partial'}));return {athletic:effect(p,'athletic'),conditioning:effect(p,'conditioning'),weight:p.history.sessions[0].weight,recovery:p.recovery};})()`);
  assert.equal(out.athletic,(1-1/3)*0.75); assert.equal(out.conditioning,0.25); assert.equal(out.weight,0.75);
  assert.equal(out.recovery.preferLowerDemand,false,'150 seconds is below the 180-second demand floor');
  const boundary=p.json(`(()=>{const p=priorities(result({mainCount:14,conditioningCount:6}));return {conditioning:effect(p,'conditioning'),recovery:p.recovery};})()`);
  assert.equal(boundary.conditioning,0.3); assert.equal(boundary.recovery.preferLowerDemand,true);
});

test('same delivered energetic work has the same demand despite different amounts of skipped planned technique', () => {
  const p=context();
  const out=p.json(`(()=>{return [20,35].map(mainCount=>{const raw=JSON.parse(JSON.stringify(result({mainCount,conditioningCount:10,seconds:20})));
    raw.performedWork.slice(5,mainCount).forEach(item=>item.status='skipped');
    const p=priorities(GarageFitCoachModel.createSessionResult(raw));return {recovery:p.recovery,weight:p.history.sessions[0].weight,athletic:effect(p,'athletic'),conditioning:effect(p,'conditioning')};});})()`);
  assert.deepEqual(out[0].recovery,out[1].recovery);
  assert.equal(out[0].recovery.preferLowerDemand,true,'200 energetic seconds / 300 performed Main seconds');
  assert.equal(out[0].weight,0.5); assert.equal(out[1].weight,1/3);
  for (const item of out) assert.ok(item.athletic > item.conditioning,'Athletic remains primary');
});

test('completed measurements, performed substitutions and preparation-only results cannot invent timed conditioning', () => {
  const p=context();
  const out=p.json(`(()=>{const views=[];
    for(const kind of ['short-measurement','light-substitution','no-main']) {
      const raw=JSON.parse(JSON.stringify(result(kind==='no-main'?{mainCount:0,conditioningCount:0}:{})));
      if(kind==='short-measurement')raw.performedWork.slice(10,20).forEach(item=>item.sets=[{seconds:1}]);
      if(kind==='light-substitution')raw.performedWork.slice(10,20).forEach(item=>item.exerciseId='side-step-knee-lift');
      const p=priorities(GarageFitCoachModel.createSessionResult(raw));views.push({kind,conditioning:effect(p,'conditioning'),recovery:p.recovery,weight:p.history.sessions[0]?.weight||0});
    }return views;})()`);
  for (const view of out) {assert.equal(view.conditioning,0,view.kind);assert.equal(view.recovery.preferLowerDemand,false,view.kind);}
  assert.equal(out[0].weight,310/600);
  assert.equal(out[1].weight,1);
  assert.equal(out[2].weight,0);
});

test('v1-v5 Athletic history retains released family effects while prospective v6 gets conservative recovery ranking', () => {
  const p=context();
  for (const version of [1,2,3,4,5]) {
    const out=p.json(`(()=>{const p=priorities(result({version:${version}}));return {athletic:effect(p,'athletic'),conditioning:effect(p,'conditioning'),recovery:p.recovery,basis:p.history.sessions[0].basis};})()`);
    assert.equal(out.athletic,1); assert.equal(out.conditioning,0); assert.equal(out.recovery.preferLowerDemand,false);
    assert.equal(out.basis,'family-identity');
  }
  const out=p.json(`(()=>{const p=priorities(result());return p.families.find(item=>item.workoutFamilyId==='athletic-movement');})()`);
  assert.equal(out.workoutFamilyVersion,6); assert.equal(out.recoveryPenalty,1.5);
});

test('resolved v6 assessment matches the ordinary timeline result and stays separate from immutable records', async () => {
  const p=context();
  const out=p.json(`(()=>{const w=GarageFitGenerator.generate({catalogue:CATALOGUE,equipment:[],duration:30,difficulty:'normal',workoutFamilyId:'athletic-movement',workoutFamilyVersion:6,random:()=>.5});
    const workload=GarageFitCoachGeneralFitnessPolicy.assessAthleticV6Workload({workout:w});
    const plannedWork=GarageFitSessionTracker.plannedWorkFromTimeline(buildGeneratedTimeline(w));
    const r=GarageFitCoachModel.createSessionResult({sessionResultId:'resolved',source:'generator',workoutFamilyId:w.workoutFamilyId,workoutFamilyVersion:6,familyStyleId:w.familyStyleId,
      startedAt:'2026-11-16T08:00:00Z',endedAt:'2026-11-16T08:30:00Z',finalStatus:'completed',plannedWork,
      performedWork:plannedWork.map(item=>({occurrenceId:item.occurrenceId,exerciseId:item.exerciseId,status:'completed'}))});
    const p=priorities(r);return {workload,athletic:effect(p,'athletic'),conditioning:effect(p,'conditioning'),demanding:p.recovery.preferLowerDemand,
      savedFields:Object.keys(r),workoutFields:Object.keys(w),mainSeconds:plannedWork.filter(item=>item.section==='main').reduce((sum,item)=>sum+item.prescription.seconds,0)};})()`);
  assert.equal(out.workload.plannedMainSeconds,out.mainSeconds);
  assert.equal(out.conditioning,out.workload.effects.conditioning || 0);
  assert.equal(out.athletic,out.workload.effects.athletic);
  assert.equal(out.demanding,out.workload.demanding);
  assert.ok(!out.savedFields.includes('deliveredWorkload')); assert.ok(!out.workoutFields.includes('deliveredWorkload'));
  await p.start();
  await p.run(`const athleticController=GarageFitCoachUI.createController({store:pilotStore,catalogue:CATALOGUE,buildTimeline:buildGeneratedTimeline,clock:()=>now,id:prefix=>prefix+':'+(++pilotId),
    engine:{...pilotEngine,planNextSession(...args){const plan=pilotEngine.planNextSession(...args);plan.prescription.workoutFamilyPlan.candidates=plan.prescription.workoutFamilyPlan.candidates.filter(item=>item.workoutFamilyId==='athletic-movement');return plan;}}});athleticController.load();`);
  const preview=p.json(`(()=>{Math.random=()=>.5;const p=athleticController.prepare({equipment:[],duration:30});
    const before=p.deliveredWorkload;GarageFitGenerator.swap(p.workout,1,0,{catalogue:CATALOGUE,equipment:[],random:()=>.8});
    const expected=GarageFitCoachGeneralFitnessPolicy.assessAthleticV6Workload({workout:p.workout});
    return {workload:athleticController.snapshot().preview.deliveredWorkload,expected,hasWorkload:Object.hasOwn(p.workout,'deliveredWorkload'),getter:typeof Object.getOwnPropertyDescriptor(p,'deliveredWorkload').get};})()`);
  assert.deepEqual(preview.workload,preview.expected); assert.equal(preview.hasWorkload,false);
  assert.equal(preview.getter,'function','edited previews always derive the current workload');
});
