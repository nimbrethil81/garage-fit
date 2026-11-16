const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
const {pilot}=require('./helpers/coach-pilot');
global.window=global;
for(const f of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','js/strength-cardio-composer'])require('../'+f);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises,ID='full-body-challenges';
const STYLES=['rounds','emom','ladder','amrap','intervals'];
let forced=null,quality,injectWeak=false;
// Developer-only seam: exercise the actual registered composer/gate with a bounded style
// exclusion, without adding a production style picker or relaxing any validation.
const register=G.registerFamilyComposer;
G.registerFamilyComposer=(id,version,compose,validate)=>{
  if(id===ID&&version===2){quality=validate;return register(id,version,(o,r,a)=>{
    if(injectWeak){injectWeak=false;return {familyStyleId:'rounds',blocks:[weakRounds()],generalPreparation:{focus:'balanced'}};}
    return compose(o,r,forced?{excludedStyleIds:STYLES.filter(s=>s!==forced)}:a);
  },validate);}
  return register(id,version,compose,validate);
};
require('../js/core-challenge-composer');G.registerFamilyComposer=register;
const copy=x=>JSON.parse(JSON.stringify(x));
const BROAD=['dumbbells','kettlebell','trx','rings','barbell','bands'];
function rng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const make=(extra={})=>G.generate({catalogue:C,workoutFamilyId:ID,workoutFamilyVersion:F.currentVersion(ID),duration:15,difficulty:'normal',equipment:BROAD,random:rng(7),...extra});
function style(id,extra={}) {forced=id;try{return make(extra);}finally{forced=null;}}
const gate=w=>G.validateFamilyWorkout(w,{catalogue:C,equipment:w.setupEquipment||BROAD});
function measured(block) {
  const steps=G.resolveBlockSteps(block),work=steps.filter(s=>s.kind==='exercise');
  return {work:work.reduce((n,s)=>n+(s.estimatedSeconds??(s.timed?s.seconds:Math.ceil(block.exercises[s.exerciseIndex].estimatedSeconds*(s.target?.value??block.exercises[s.exerciseIndex].prescription.value)/block.exercises[s.exerciseIndex].prescription.value))),0),
    rest:steps.filter(s=>s.kind!=='exercise').reduce((n,s)=>n+s.seconds,0),occurrences:work.length};
}

test('v2 publishes only the five approved styles; strict historical defaults remain v1',()=>{
  assert.deepEqual(F.getDefinition(ID,2).styles.map(s=>s.id),STYLES);
  assert.deepEqual(F.getDefinition(ID,2).compositionPolicy,{id:ID,version:2});
  assert.deepEqual(F.getDefinition(ID,2).membershipPolicy,{id:ID,version:1});
  assert.equal(F.currentVersion(ID),2);assert.equal(F.getDefinition(ID).version,1);
  assert.equal(F.resolveRequest({workoutFamilyId:ID}).workoutFamilyVersion,1);
  assert.deepEqual(F.getDefinition(ID,1).styles.map(s=>s.id),['rounds','emom','ladder','pyramid','density']);
});

test('each format is reachable at each difficulty with distinct executable doses and recovery',()=>{
  const protocols={rounds:'rounds',emom:'emom',ladder:'ladder',amrap:'amrap',intervals:'timed_intervals'};
  for(const id of STYLES)for(const difficulty of ['easy','normal','hard']) {
    const w=style(id,{difficulty,duration:id==='ladder'&&difficulty!=='hard'?45:15});
    assert.equal(w.familyStyleId,id);assert.equal(w.workoutFamilyVersion,2);
    assert.deepEqual(gate(w),{valid:true,technicalIssues:[],qualityIssues:[]});
    assert.ok(w.main.blocks.every(b=>b.protocol===protocols[id]));
    assert.ok(w.estimatedSeconds<=w.duration*60);
    for(const b of w.main.blocks) {
      const dose=measured(b);
      assert.ok(dose.work>0);
      if(id==='amrap') {
        assert.equal(dose.occurrences,b.exercises.length,'one finite planned pass; cap does not create rounds');
        assert.equal(dose.rest,0);assert.ok(b.prescription.capSeconds>=180&&b.prescription.capSeconds<=480);
        assert.ok(b.prescription.targets.every(t=>t.value>=({easy:4,normal:6,hard:8}[difficulty])&&t.value<=8));
        assert.equal(G.estimateBlockDuration(b),b.prescription.capSeconds);
      }
      if(id==='emom') {
        assert.equal(dose.occurrences,b.prescription.minutes);
        assert.ok(dose.work<b.prescription.minutes*60,'minute windows are separate from target work');
      }
      if(id==='rounds'||id==='intervals'||id==='ladder')assert.ok(dose.rest>0);
    }
  }
});

test('bounded representative durations/difficulties retain feasible bodyweight, limited, TRX/bands and constrained low-impact routes',()=>{
  for(const duration of [10,15,20,30,45])for(const [index,difficulty] of ['easy','normal','hard'].entries()) {
    const equipment=[[],['dumbbells'],['trx','bands']][index];
    const w=make({duration,difficulty,equipment,random:rng(duration+index),excludedImpact:['high']});
    assert.ok(gate(w).valid,JSON.stringify(gate(w)));
    assert.equal(w.workoutFamilyVersion,2);
    assert.ok(w.warmup.exercises.length&&w.rampup.exercises.length&&w.cooldown.exercises.length);
    assert.ok(w.main.blocks.flatMap(b=>b.exercises).every(ex=>ex.impact!=='high'));
  }
  const standing=make({duration:20,equipment:['bands'],bodyPositions:['standing'],excludedImpact:['high'],random:rng(19)});
  assert.ok(gate(standing).valid);
  assert.ok(standing.main.blocks.flatMap(b=>b.exercises).every(ex=>ex.bodyPosition==='standing'));
  assert.throws(()=>make({catalogue:{'air-squat':C['air-squat']}}),e=>e.code==='family-not-feasible'&&e.workoutFamilyId===ID&&e.reasons.length>0);
});

function densityRegression() {
  const pair=(ids,repeats,timeCapSeconds)=>({protocol:'density',intent:'conditioning',exercises:ids.map(id=>copy(C[id])),
    prescription:{repeats,targets:ids.map(()=>({type:'reps',value:8})),timeCapSeconds,exerciseRestSeconds:15,roundRestSeconds:45}});
  return [pair(['trx-chest-press','trx-squat'],3,360),pair(['bicycle-crunch','push-up'],2,222)].map((b,i)=>({...b,id:'main-'+(i+1)}));
}

test('REG1 retains the 585s/210s rest/80-rep v1 diagnostic and rejects its substance independently of style',()=>{
  const blocks=densityRegression();
  assert.ok(blocks.every(b=>!G.validateDensityBlock(b,C).length));
  assert.equal(G.mainSeconds(blocks,BROAD),585);
  assert.equal(blocks.reduce((n,b)=>n+measured(b).rest,0),210);
  assert.equal(blocks.reduce((n,b)=>n+b.prescription.repeats*b.prescription.targets.reduce((sum,t)=>sum+t.value,0),0),80);
  const issues=quality({main:{blocks},difficulty:'normal',familyStyleId:'density'},{catalogue:C});
  assert.ok(issues.includes('insufficient-prescribed-work'),JSON.stringify(issues));
  // Upper/lower/core work is 112/60/24 s of 196 s, within the balance bounds.
  // Its substantive failure is insufficient work, independently of the removed style.
  assert.ok(!issues.includes('unbalanced-prescribed-work'),JSON.stringify(issues));
});

function weakRounds() {return {id:'main-1',protocol:'rounds',intent:'conditioning',
    exercises:['trx-chest-press','trx-squat','bicycle-crunch','push-up'].map(id=>copy(C[id])),
    prescription:{rounds:2,exerciseRestSeconds:45,roundRestSeconds:85}};}
test('REG2 rejects a technically legal, filled, four-movement Rounds candidate for weak work and redundant pressing',()=>{
  const w=make(),block=weakRounds();
  assert.equal(G.estimateBlockDuration(block),585);
  assert.deepEqual(G.validateMain({blocks:[block]},C,BROAD,600),[]);
  const weak=G.normaliseWorkout({...w,familyStyleId:'rounds',main:{blocks:[block]}}),out=gate(weak);
  assert.ok(out.qualityIssues.includes('quality:insufficient-prescribed-work'));
  assert.ok(out.qualityIssues.includes('quality:redundant-movement-pattern'));
  assert.equal(out.valid,false);
});

test('reconciled removal of substantial prescribed rounds cannot bypass the edit gate',()=>{
  const w=style('rounds'),block=w.main.blocks[0];
  assert.ok(block.prescription.rounds>=3);
  block.prescription.rounds=2;delete block.estimatedSeconds;delete block.estimatedDurationSeconds;
  G.normaliseWorkout(w);
  // Truthfully reconcile the session estimate, including unchanged preparation/setup.
  w.estimatedSeconds=w.warmup.estimatedSeconds+w.rampup.estimatedSeconds+w.main.estimatedDurationSeconds+w.cooldown.estimatedSeconds;
  const out=gate(w);
  assert.deepEqual(out.technicalIssues,[]);
  assert.ok(out.qualityIssues.includes('quality:challenge-main-budget'));
});

test('shared gate rejects a weak style and falls back within v2, with substantive diagnostics',()=>{
  injectWeak=true;
  const w=make();
  assert.equal(w.workoutFamilyId,ID);assert.equal(w.workoutFamilyVersion,2);
  assert.notEqual(w.familyStyleId,'rounds');assert.ok(gate(w).valid);
  assert.ok(w.familyDiagnostics.some(d=>d.familyStyleId==='rounds'&&d.issues.includes('quality:insufficient-prescribed-work')));
});

test('AMRAP difficulty changes real rep targets without inventing more planned rounds',()=>{
  for(const [difficulty,reps] of [['easy',5],['normal',6],['hard',8]]) {
    const w=style('amrap',{difficulty});
    assert.ok(w.main.blocks.every(b=>b.prescription.targets.every(t=>t.value===reps)));
  }
});

test('positive Easy fixed work may legitimately use more recovery and less work than Normal',()=>{
  const block={id:'main-1',protocol:'rounds',intent:'conditioning',
    exercises:['wall-push-up','squat-to-alternating-knee-drive','plank-arm-reaches'].map(id=>C[id]),
    prescription:{rounds:2,exerciseRestSeconds:30,roundRestSeconds:70}};
  assert.deepEqual(G.validateMain({blocks:[block]},C,[],420),[]);
  assert.deepEqual(quality({main:{blocks:[block]},difficulty:'easy',familyStyleId:'rounds'},{catalogue:C}),[]);
  assert.ok(quality({main:{blocks:[block]},difficulty:'normal',familyStyleId:'rounds'},{catalogue:C}).includes('insufficient-prescribed-work'));
});

test('underworked minute windows, overlong intervals and redundant edits fail the same quality gate',()=>{
  const emom=style('emom'),b=emom.main.blocks[0];
  const before=G.estimateBlockDuration(b);b.prescription.targets=b.prescription.targets.map(t=>({type:t.type,value:t.type==='timed'?5:3}));
  assert.equal(G.estimateBlockDuration(b),before);
  assert.ok(gate(G.normaliseWorkout(emom)).qualityIssues.includes('quality:emom-underworked-or-overloaded'));
  const intervals=style('intervals'),i=intervals.main.blocks[0];i.prescription.workSeconds=60;
  assert.ok(gate(G.normaliseWorkout(intervals)).qualityIssues.includes('quality:interval-dose-or-recovery'));
  const w=make(),identity=[w.workoutFamilyVersion,w.familyStyleId];
  G.swap(w,0,0,{catalogue:C,equipment:BROAD,random:rng(31)});
  assert.deepEqual([w.workoutFamilyVersion,w.familyStyleId],identity);assert.ok(gate(w).valid);
  G.swapPreparation(w,'warmup',0,{catalogue:C,equipment:BROAD,random:rng(32)});assert.ok(gate(w).valid);
});

test('Generator actual Start route follows current v2 and records the delivered identity',async()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true}),run=source=>vm.runInContext(source,app);
  run("Math.random=(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296})(7)");
  app.selectGeneratorFamily(ID);app.selectGeneratorDuration(15);app.setOwnedEquipment(BROAD);app.generateWorkout();
  assert.equal(run('generatorState.workout.workoutFamilyVersion'),2);
  app.startStandaloneGeneratedWorkout();await run('generatorState.tracker.flush()');
  const identity=copy(run('generatorState.tracker.draft()'));
  assert.equal(identity.workoutFamilyVersion,2);
  assert.equal(identity.familyStyleId,run('generatorState.workout.familyStyleId'));
});

test('ongoing General Fitness v1/v2 instances deliver v2 through the shared route without restarting',async()=>{
  for(const version of [1,2]) {
    const p=pilot(undefined,'general-fitness',version);await p.start();
    const before=p.json('pilot.snapshot().state');
    p.run(`const challengePlan=pilotEngine.planNextSession(pilotDef,pilot.snapshot().state,[],{now:'2026-11-16T12:00:00Z',prescriptionId:'next',duration:15,equipment:${JSON.stringify(BROAD)}});
      const challengeRx=JSON.parse(JSON.stringify(challengePlan.prescription));
      challengeRx.workoutFamilyPlan.candidates=challengeRx.workoutFamilyPlan.candidates.filter(c=>c.workoutFamilyId==='${ID}');
      const delivered=GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:challengeRx,random:${rng.toString()}(7)});`);
    const w=p.json('delivered');assert.equal(w.workoutFamilyVersion,2);assert.ok(gate(w).valid);
    const standalone=make();delete w.id;delete standalone.id;
    assert.deepEqual(w.main,standalone.main,'same family composer and validation across routes');
    assert.deepEqual(p.json('pilot.snapshot().state'),before,'no instance rewrite/restart');
    assert.ok(p.run('pilotDef.familyBalancePolicy.families.every(f=>f.workoutFamilyVersion===1)'));
  }
});

test('a future registry advance reaches actual Generator and General Fitness consumers',()=>{
  const p=pilot(undefined,'general-fitness',1);p.run(`
    GarageFitData.workoutFamilyCurrentVersions={...GarageFitData.workoutFamilyCurrentVersions,'${ID}':3};
    GarageFitData.workoutFamilies={...GarageFitData.workoutFamilies,'${ID}':{...GarageFitData.workoutFamilies['${ID}'],3:{...GarageFitData.workoutFamilies['${ID}'][2],version:3}}};`);
  p.run(fs.readFileSync('js/workout-families.js','utf8'));
  p.run(`
    const futureState=pilotEngine.startProgramme(pilotDef,{programmeInstanceId:'old-instance',equipment:[]},'2026-10-01T08:00:00Z').state;
    const futurePlan=pilotEngine.planNextSession(pilotDef,futureState,[],{now:'2026-11-16T12:00:00Z',prescriptionId:'future',duration:15,equipment:[]});`);
  assert.equal(p.run(`futurePlan.prescription.workoutFamilyPlan.candidates.find(c=>c.workoutFamilyId==='${ID}').workoutFamilyVersion`),3);
  assert.equal(p.run(`(()=>{const rx=JSON.parse(JSON.stringify(futurePlan.prescription));rx.workoutFamilyPlan.candidates=rx.workoutFamilyPlan.candidates.filter(c=>c.workoutFamilyId==='${ID}');return GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:rx,random:${rng.toString()}(7)}).workoutFamilyVersion;})()`),3);
  // Isolated future publication before the family API captures its immutable registry.
  const data={};vm.createContext(data);vm.runInContext(fs.readFileSync('data/workout-families.js','utf8'),data);
  data.GarageFitData.workoutFamilies={...data.GarageFitData.workoutFamilies,[ID]:{...data.GarageFitData.workoutFamilies[ID],3:{...data.GarageFitData.workoutFamilies[ID][2],version:3}}};
  data.GarageFitData.workoutFamilyCurrentVersions={...data.GarageFitData.workoutFamilyCurrentVersions,[ID]:3};
  vm.runInContext(fs.readFileSync('js/workout-families.js','utf8'),data);
  const app=loadAppContext();app.GarageFitWorkoutFamilies=data.GarageFitWorkoutFamilies;
  const original=app.GarageFitGenerator.generate;let requested;
  app.GarageFitGenerator.generate=o=>{requested=o;return original(o);};
  app.selectGeneratorFamily(ID);app.generateWorkout();assert.equal(requested.workoutFamilyVersion,3);
  assert.equal(vm.runInContext('generatorState.workout.workoutFamilyVersion',app),3);
});

test('prepared v1 Density/Pyramid preview, timeline and durable Draft/Result identity stay historical',async()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true}),run=s=>vm.runInContext(s,app);
  for(const familyStyleId of ['density','pyramid']) {
    const blocks=familyStyleId==='density'?densityRegression():['push-up','air-squat','leg-raises'].map((id,i)=>({id:'main-'+(i+1),protocol:'pyramid',intent:'strength',exercises:[C[id]],prescription:{steps:[{reps:3},{reps:6},{reps:3}],stepRestSeconds:60}}));
    const w=G.normaliseWorkout({...make({workoutFamilyVersion:1}),familyStyleId,main:{blocks}});
    run(`generatorState.workout=JSON.parse(${JSON.stringify(JSON.stringify(w))});renderGeneratedPreview();`);
    const before=run('JSON.stringify(generatorState.workout.main.blocks)');
    app.startGeneratedWorkout();assert.equal(run('generatorState.workout.workoutFamilyVersion'),1);
    assert.equal(run('JSON.stringify(generatorState.workout.main.blocks)'),before);
    assert.ok(run('generatorState.timeline.some(p=>p.protocol==='+JSON.stringify(familyStyleId)+')'));
    run(`var historicalStore=GarageFitCoachStore.createStore(localStorage);
      var historicalDraft=GarageFitCoachModel.createSessionDraft({draftId:'historical',source:'coach',programmeInstanceId:'old',prescriptionId:'old-rx',startedAt:'2026-11-01T12:00:00Z',updatedAt:'2026-11-01T12:00:00Z',workoutFamilyId:'${ID}',workoutFamilyVersion:1,familyStyleId:'${familyStyleId}',plannedWork:GarageFitSessionTracker.plannedWorkFromTimeline(generatorState.timeline),occurrenceOutcomes:[],finalisation:{state:'in-progress',sessionResultId:null}});`);
    await run('historicalStore.saveSessionDraft(historicalDraft)');
    assert.equal((await run('historicalStore.loadSessionDraft()')).workoutFamilyVersion,1);
    const result=run(`GarageFitCoachModel.createSessionResult({sessionResultId:'old-${familyStyleId}',source:'generator',programmeInstanceId:null,prescriptionId:null,workoutFamilyId:'${ID}',workoutFamilyVersion:1,familyStyleId:'${familyStyleId}',startedAt:'2026-11-01T12:00:00Z',endedAt:'2026-11-01T12:15:00Z',finalStatus:'completed',plannedWork:historicalDraft.plannedWork,performedWork:[]})`);
    await run(`historicalStore.saveSessionResult(JSON.parse(${JSON.stringify(JSON.stringify(result))}))`);
    assert.equal((await run(`historicalStore.getSessionResult('old-${familyStyleId}')`)).workoutFamilyVersion,1);
  }
});
