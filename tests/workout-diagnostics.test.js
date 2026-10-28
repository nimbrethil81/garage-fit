const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
function fixture(){const app=loadAppContext();const workout=vm.runInContext('GarageFitGenerator.generate({catalogue:CATALOGUE,duration:15,equipment:[],random:()=>0.3})',app);return {app,workout};}
test('one bounded allowlisted snapshot is idempotent, survives reload and keeps capture build',()=>{
  const {app,workout}=fixture(),data=new Map();let build='old',now='2026-10-28T10:00:00Z',writes=0;
  const options={storage:()=>({getItem:k=>data.get(k),setItem:(k,v)=>{writes++;data.set(k,v)}}),build:()=>build,clock:()=>now};
  const d=app.GarageFitWorkoutDiagnostics.create(options);
  workout.profileNotes='PRIVATE';workout.feedback={secret:'PRIVATE'};
  assert.equal(d.capture(workout,{source:'Generator',equipment:[]}),true);
  now='2026-10-28T11:00:00Z';build='new';
  assert.equal(d.capture(workout,{source:'Generator',equipment:[]}),false);assert.equal(writes,1);
  const report=app.GarageFitWorkoutDiagnostics.create(options).report();
  assert.match(report,/Composition build: old/);assert.match(report,/Currently loaded build: new/);assert.match(report,/Captured at: 2026-10-28T10:00/);assert.match(report,/Report time: 2026-10-28T11:00/);
  for(const section of ['Warm-up','Ramp-up','Main','Cool-down'])assert.ok(report.includes(section));
  for(const block of workout.main.blocks)for(const ex of block.exercises)assert.ok(report.includes('['+ex.id+']'));
  assert.doesNotMatch(report,/PRIVATE|profileNotes|feedback/);
  assert.equal(data.size,1);assert.ok([...data.values()][0].length<=app.GarageFitWorkoutDiagnostics.LIMIT);
  workout.id+='-new';assert.equal(d.capture(workout,{source:'Generator'}),true);
});
test('bad storage and oversize records preserve session copyability without affecting previews',()=>{
  const {app,workout}=fixture(),api=app.GarageFitWorkoutDiagnostics;
  for(const raw of ['{','{"version":2}','{"version":1,"text":7}','x'.repeat(api.LIMIT+1)]){
    const d=api.create({storage:()=>({getItem:()=>raw})});assert.match(d.report(),/No captured workout/);
  }
  const quota=api.create({storage:()=>({getItem:()=>null,setItem:()=>{throw Error('quota')}})});
  assert.equal(quota.capture(workout),true);assert.match(quota.report(),/Current session only/);
  const d=api.create({storage:()=>{throw Error('disabled')}});
  assert.equal(d.capture(workout,{source:'Coach',programme:'Test'}),true);const previous=d.report();
  assert.match(previous,/Current session only/);assert.match(previous,/Programme: programme: Test/);
  workout.main.blocks[0].exercises[0].name='x'.repeat(api.LIMIT);
  assert.equal(d.capture(workout),false);assert.match(d.report(),/Programme: programme: Test/);
});
test('shipped Generator captures final previews and preparation/Main swaps, unchanged redraws keep timestamp',()=>{
  const storage=new Map(),app=loadAppContext(storage,{rampupUi:true});let count=0;const capture=app.garageFitWorkoutDiagnostics.capture;
  app.garageFitWorkoutDiagnostics.capture=(...args)=>{const changed=capture(...args);if(changed)count++;return changed};
  app.generateWorkout();assert.equal(count,1);
  app.renderGeneratedPreview();assert.equal(count,1);
  for(const section of ['warmup','rampup']){
    app.swapGeneratedPreparation(section,0);
    const w=vm.runInContext('generatorState.workout',app);
    assert.ok(app.garageFitWorkoutDiagnostics.report().includes('['+w[section].exercises[0].id+']'));
  }
  app.swapGeneratedExercise(0,0);
  const w=vm.runInContext('generatorState.workout',app);
  assert.ok(app.garageFitWorkoutDiagnostics.report().includes('['+w.main.blocks[0].exercises[0].id+']'));
  const before=count;app.generateWorkout();assert.equal(count,before+1);
  assert.deepEqual([...storage.keys()],[app.GarageFitWorkoutDiagnostics.KEY]);
});
test('shared fixtures report every protocol with resolved ordered targets, recovery, loads and setup',()=>{
  const {app,workout}=fixture(),{blockFixtures}=require('./helpers/protocol-fixtures');
  const catalogue=vm.runInContext('CATALOGUE',app),blocks=blockFixtures(catalogue,{emom:true,ladder:true,pyramid:true,complex:true,density:true,amrap:true});
  workout.main.blocks=Object.values(blocks);
  workout.setupTransitions=[{section:'main',blockIndex:0,exerciseIndex:0,instruction:'Adjust rings',seconds:20}];
  const before=JSON.stringify(workout),report=app.GarageFitWorkoutDiagnostics.composition(workout);
  for(const protocol of Object.keys(blocks))assert.ok(report.includes('['+protocol+']'));
  assert.match(report,/4 reps.*6 reps.*8 reps/);assert.match(report,/relativeLoad: heavier/);
  assert.match(report,/each side/);assert.match(report,/minute: 5/);assert.match(report,/complexSequence: 3/);
  assert.match(report,/round-rest · 45 sec/);assert.match(report,/Setup: instruction: Adjust rings · seconds: 20/);
  assert.equal(JSON.stringify(workout),before);
});
test('specialist blocks retain their real section and delivered family fallback identity',()=>{
  const app=loadAppContext(),G=app.GarageFitGenerator;
  const workout=G.generate({catalogue:app.GarageFitData.exercises,workoutFamilyId:'mobility-movement-quality',duration:10,equipment:[],random:()=>0.3});
  workout.familyReplan={requestedWorkoutFamilyId:'athletic-movement',replanned:true};
  const text=app.GarageFitWorkoutDiagnostics.composition(workout,{source:'Coach',programme:'Tennis'});
  const sections=text.split(/\n(?:Warm-up|Ramp-up|Main|Cool-down) · estimated /).slice(1);
  G.trainingSectionPlan(workout).blocks.forEach(item=>assert.ok(sections[['warmup','rampup','main','cooldown'].indexOf(item.section)].includes('Block '+workout.main.blocks[item.blockIndex].id)));
  assert.match(text,/workoutFamilyId: mobility-movement-quality/);assert.match(text,/requestedWorkoutFamilyId: athletic-movement/);
});
test('internal Coach preparation and infeasible planning never create a diagnostic capture',async()=>{
  const {pilot}=require('./helpers/coach-pilot'),p=pilot();await p.start();
  p.run('pilot.prepare(pilotOptions)');assert.match(p.run('garageFitWorkoutDiagnostics.report()'),/No captured workout/);
  p.run('pilot.prepare({...pilotOptions,equipment:[]})');assert.match(p.run('garageFitWorkoutDiagnostics.report()'),/No captured workout/);
});
