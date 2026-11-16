const test=require('node:test'),assert=require('node:assert/strict');
const {loadAppContext}=require('./helpers/app-context');
const {create,seed,confirm}=require('./helpers/tennis-pilot');
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
global.window=global;
for(const f of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','data/athletic-membership','js/athletic-composer'])require('../'+f);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises;
const rng=(seed,style)=>{let first=true;return()=>{if(first&&style!==undefined){first=false;return style;}seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};};
const generate=(extra={})=>G.generate({workoutFamilyId:'athletic-movement',workoutFamilyVersion:6,duration:20,difficulty:'normal',catalogue:C,equipment:[],random:rng(7),...extra});
const copy=x=>JSON.parse(JSON.stringify(x));
const additions=['low-impact-speed-skaters','boxer-step-and-punches','squat-to-alternating-knee-drive','high-knee-power-steps','step-jacks','side-step-knee-lift','forward-back-aerobic-steps','power-march','jumping-jacks'];

test('v6 membership adds exactly nine identities, preserving every prior role and prescription',()=>{
 const roles=['footwork','control','integrated','conditioning'];
 const ids=version=>Object.keys(C).filter(id=>roles.some(role=>F.getMembership({workoutFamilyId:'athletic-movement',workoutFamilyVersion:version,role},id)));
 assert.equal(ids(5).length,36);assert.equal(ids(6).length,45);assert.deepEqual(ids(6).filter(id=>!ids(5).includes(id)).sort(),additions.slice().sort());
 for(const id of ids(5))for(const role of roles.slice(0,3)){
  const context={workoutFamilyId:'athletic-movement',role},old=F.getMembership({...context,workoutFamilyVersion:5},id);
  if(old)assert.deepEqual(F.getMembership({...context,workoutFamilyVersion:6},id),old);
 }
 for(const id of additions){assert.equal(C[id].bodyPosition,'standing');assert.deepEqual(C[id].equipment,[]);assert.ok(G.protocolCompatible(C[id],'rounds',{workoutFamilyId:'athletic-movement',workoutFamilyVersion:6,role:'conditioning'}));}
});

test('v6 three styles resolve exact supported durations with standing, no-room and low-impact constraints',()=>{
 const app=loadAppContext(new Map(),{ownIntrinsics:true}),styles=new Set();
 for(const duration of [10,15,20,30,45])for(const difficulty of ['easy','normal','hard'])for(const style of [.1,.5,.9])for(const excludedImpact of [['high'],['medium','high']]){
  const w=generate({duration,difficulty,excludedImpact,random:rng(7,style)});styles.add(w.familyStyleId);
  assert.equal(w.estimatedSeconds,duration*60);assert.equal(G.mainSeconds(w.main.blocks,[]),duration*60);
  assert.equal(G.validateFamilyWorkout(w,{catalogue:C,equipment:[]}).valid,true);
  assert.ok(w.main.blocks.flatMap(b=>b.exercises).every(ex=>!excludedImpact.includes(ex.impact)));
  const sections=G.trainingSectionPlan(w);assert.ok(sections.seconds.warmup>0&&sections.seconds.cooldown>=30);
  const timeline=app.buildGeneratedTimeline(copy(w)),plan=app.GarageFitSessionTracker.plannedWorkFromTimeline(timeline);
  assert.ok(plan.some(item=>item.section==='main'));assert.ok(plan.some(item=>item.section==='warmup'));
  assert.deepEqual(G.normaliseWorkout(copy(w)),w);
 }
 assert.deepEqual([...styles].sort(),['agility-balance','athletic-conditioning','movement-circuit']);
});

test('all nine additions are reachable; jumping jacks are optional and Medium exclusion wins',()=>{
 const reached=new Set();let withoutJacks=false;
 for(let seed=1;seed<=30;seed++){
  const w=generate({duration:30,random:rng(seed,.9)}),ids=w.main.blocks.flatMap(b=>b.exercises.map(ex=>ex.id));
  ids.forEach(id=>reached.add(id));withoutJacks ||= !ids.includes('jumping-jacks');
 }
 assert.deepEqual(additions.filter(id=>!reached.has(id)),[]);assert.ok(withoutJacks);
 const restricted=generate({excludedImpact:['medium','high']});assert.ok(!restricted.main.blocks.some(b=>b.exercises.some(ex=>ex.id==='jumping-jacks')));
 assert.throws(()=>generate({bodyPositions:['floor']}),e=>e.code==='family-not-feasible');
});

test('style compositions differ, completed history softly changes choices, and edits retain technical anchors',()=>{
 const styles=[.1,.5,.9].map(style=>generate({duration:30,random:rng(7,style)}));
 const shape=w=>JSON.stringify(w.main.blocks.map(b=>[b.familyContext.role,b.exercises.map(e=>e.id)]));
 assert.equal(new Set(styles.map(shape)).size,3);
 const original=styles[0],completed=original.main.blocks.flatMap(b=>b.exercises.map(ex=>({exerciseId:ex.id})));
 const history={ 'athletic-movement':{familyStyleId:original.familyStyleId,workoutFamilyVersion:6,plannedOccurrences:completed.length,completedOccurrences:completed}};
 assert.notEqual(shape(generate({duration:30,random:rng(7,.1),recentFamilySessions:history})),shape(original));
 const bad=copy(original),control=bad.main.blocks.find(b=>b.familyContext.role==='control'&&G.blockTrainingSection(b)==='main');
 control.exercises=control.exercises.map(ex=>ex.sidedness==='per-side'?copy(C['reverse-lunge-knee-drive']):ex);
 assert.equal(G.validateFamilyWorkout(bad,{catalogue:C,equipment:[]}).valid,false);
 assert.equal(shape(generate({random:rng(31)})),shape(generate({random:rng(31)})));
});

test('v6 rejects removed or light-only conditioning, including the underfilled edited-workout counterexample',()=>{
 const original=generate({random:rng(1)}),removed=copy(original);
 removed.main.blocks=removed.main.blocks.filter(block=>block.familyContext.role!=='conditioning');
 G.normaliseWorkout(removed);
 assert.equal(removed.estimatedSeconds,900);assert.equal(removed.duration,20);
 const energetic=removed.main.blocks.filter(block=>G.blockTrainingSection(block)==='main').flatMap(block=>block.exercises)
  .filter(ex=>ex.cardio>=3&&F.getMembership({workoutFamilyId:'athletic-movement',workoutFamilyVersion:6,role:'conditioning'},ex.id));
 assert.equal(energetic.length,0,'no equivalent energetic Main work remains');
 const missing=G.validateFamilyWorkout(removed,{catalogue:C,equipment:[]});
 assert.equal(missing.valid,false);assert.deepEqual(missing.technicalIssues,[]);
 assert.ok(missing.qualityIssues.includes('quality:missing-conditioning-exposure'));
 assert.ok(missing.qualityIssues.includes('quality:resolved-duration'));
 // Isolate exposure from timing: retain every target, round and recovery, but
 // replace conditioning with eligible light movements that cannot supply it.
 const light=copy(original),ids=['step-jacks','forward-back-aerobic-steps','side-step-knee-lift'];
 for(const block of light.main.blocks.filter(block=>block.familyContext.role==='conditioning'))
  block.exercises=block.exercises.map((_,index)=>copy(C[ids[index%ids.length]]));
 G.normaliseWorkout(light);assert.equal(light.estimatedSeconds,1200);
 const lightOnly=G.validateFamilyWorkout(light,{catalogue:C,equipment:[]});
 assert.equal(lightOnly.valid,false);assert.deepEqual(lightOnly.technicalIssues,[]);
 assert.ok(lightOnly.qualityIssues.includes('quality:missing-conditioning-exposure'));
 assert.ok(!lightOnly.qualityIssues.includes('quality:resolved-duration'));
});

test('v6 rejects isolated timing changes while valid target edits and real swaps retain the exact clock',()=>{
 const original=generate({random:rng(1)}),index=original.main.blocks.findIndex(block=>block.familyContext.role==='footwork');
 assert.equal(original.main.blocks[index].occurrenceTargets[0].plannedPrescription.value,28);
 for(const delta of [-1,1]) {
  const edited=copy(original);edited.main.blocks[index].occurrenceTargets[0].plannedPrescription.value+=delta;G.normaliseWorkout(edited);
  assert.equal(edited.estimatedSeconds,1200+delta);
  const result=G.validateFamilyWorkout(edited,{catalogue:C,equipment:[]});
  assert.equal(result.valid,false);assert.deepEqual(result.qualityIssues,['quality:resolved-duration']);
 }
 const valid=copy(original),targets=valid.main.blocks[index].occurrenceTargets;
 targets[0].plannedPrescription.value++;targets[1].plannedPrescription.value--;G.normaliseWorkout(valid);
 assert.equal(valid.estimatedSeconds,1200);assert.equal(G.validateFamilyWorkout(valid,{catalogue:C,equipment:[]}).valid,true);
 const before=valid.main.blocks[index].exercises[0].id;
 G.swap(valid,index,0,{catalogue:C,equipment:[],random:rng(31)});
 assert.notEqual(valid.main.blocks[index].exercises[0].id,before,'a genuine supported replacement remains available');
 assert.equal(valid.estimatedSeconds,1200);assert.equal(G.validateFamilyWorkout(valid,{catalogue:C,equipment:[]}).valid,true);
 for(const version of [1,2,3,4,5]) {
  const historical=generate({workoutFamilyVersion:version,random:rng(31)});
  assert.equal(historical.workoutFamilyVersion,version);assert.equal(G.validateFamilyWorkout(historical,{catalogue:C,equipment:[]}).valid,true);
 }
});

test('comparison command validates complete three-consumer samples and reproduces the committed report',()=>{
 const root=path.resolve(__dirname,'..'),run=spawnSync(process.execPath,['scripts/sample-athletic-v6.js'],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 assert.equal(run.stdout,fs.readFileSync(path.join(root,'docs/athletic-v6-samples.md'),'utf8'));
 for(const consumer of ['Generator','General Fitness','Tennis']) {
  const section=run.stdout.split('## '+consumer+'\n')[1]?.split('\n## ')[0];assert.ok(section,consumer);
  const rows=section.split('\n').filter(line=>/^\| (20|30|45) \//.test(line));assert.equal(rows.length,9,consumer);
  for(const minutes of [20,30,45])assert.equal(rows.filter(line=>line.startsWith('| '+minutes+' /')).length,3);
  for(const style of ['movement-circuit','agility-balance','athletic-conditioning'])assert.ok(section.includes(style),consumer+' '+style);
  assert.ok(run.stdout.includes('- '+consumer+', 30 minutes, draw 0.1, immediately preceding fully completed same-seed v6 session:'));
 }
 assert.match(run.stdout,/## Completed-history example/);
 assert.match(run.stdout,/not proof of enjoyment or user testing/);
});

test('Tennis v10 uses shared v6 with transient emphasis, protected days and v9 remain pinned',async()=>{
 const {p}=await create({version:10});seed(p,7);
 p.run(`function movementPlan(extra={}) {
  const state=pilot.snapshot().state,today={...pilotOptions,...extra,now:pilotNow,prescriptionId:'v10-sample'};
  const history=GarageFitTrainingHistory.createHistory([],CATALOGUE);
  const priorities=GarageFitCoachTennisPolicy.calculatePriorities({definition:pilotDef,catalogue:CATALOGUE,state,history,today});
  priorities.role=pilotDef.sessionRoles[2][1];
  return GarageFitCoachTennisPolicy.buildPrescription({definition:pilotDef,catalogue:CATALOGUE,state,history,today,priorities,
    assessSessionPrescription:GarageFitGenerator.assessSessionPrescription});
 }
 function useMovement(){const preview=pilot.prepare(pilotOptions);preview.plan.prescription=movementPlan();
  preview.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,sessionPrescription:preview.plan.prescription});return preview;}`);
 const preview=p.json('useMovement()');
 assert.equal(preview.workout.workoutFamilyVersion,6);assert.equal(preview.workout.workoutFamilyId,'athletic-movement');
 assert.equal(preview.plan.prescription.programmeContext.athleticProgrammeContext,undefined);
 const rx=preview.plan.prescription;
 const paired=p.json(`(()=>{const rx=${JSON.stringify(rx)};function draw(){let s=7;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
 const viaCoach=GarageFitGenerator.generate({sessionPrescription:rx,catalogue:CATALOGUE,random:draw()});
 const explicit=GarageFitGenerator.generate({duration:rx.duration,difficulty:rx.difficulty,equipment:rx.equipment,catalogue:CATALOGUE,
 workoutFamilyId:'athletic-movement',workoutFamilyVersion:6,...rx.workoutFamilyPlan,athleticProgrammeContext:'tennis',random:draw()});
 return [viaCoach,explicit].map(w=>[w.familyStyleId,w.main.blocks.map(b=>b.exercises.map(ex=>ex.id))]);})()`);
 assert.deepEqual(paired[0],paired[1],'actual Coach route carries the transient Tennis emphasis');
 p.run('pilotOptions.easyToday=true');const protectedDay=p.json('pilot.prepare(pilotOptions)');assert.equal(protectedDay.workout.workoutFamilyId,undefined);
 p.run('pilotOptions.easyToday=false;useMovement()');await p.run('pilot.begin().then(t=>pilotTracker=t)');await confirm(p);const result=await p.finish('complete');
 assert.equal(result.workoutFamilyVersion,6);assert.ok(p.run('pilot.snapshot().state.meaningfulSessionsCompleted')>0);
 // Keep the original skipped-work counterexample explicit: finishing the player
 // must not credit an unperformed or incomplete Athletic Main.
 const withheld=p.json(`(()=>{const completed=pilot.snapshot().results.at(-1);
  const mainIds=completed.plannedWork.filter(item=>item.section==='main').map(item=>item.occurrenceId);
  return [mainIds,mainIds.slice(0,1)].map(skippedIds=>{
   const raw=JSON.parse(JSON.stringify(completed));
   raw.performedWork.forEach(item=>{if(skippedIds.includes(item.occurrenceId)){item.status='skipped';delete item.sets;}});
   const result=GarageFitCoachModel.createSessionResult(raw),history=GarageFitTrainingHistory.createHistory([result],CATALOGUE);
   return GarageFitCoachTennisPolicy.interpretDose({definition:pilotDef,state:pilot.snapshot().state,result,history,
    evidence:history.sessionEvidence(result.sessionResultId)}).meaningful;
  });})()`);
 assert.deepEqual(withheld,[false,false],'skipped Main and a missing Main occurrence earn no Tennis completion credit');
 const old=await create({version:9});assert.equal(old.p.run('pilotDef.movementFamilyPolicy.workoutFamilyVersion'),5);
});
