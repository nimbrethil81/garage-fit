// Catalogue expansion Batch 1 (#85): 13 Main exercises and the sumo-squat single-variant rule.
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadAppContext}=require('./helpers/app-context');
const fixtures=require('./helpers/coach-fixtures.js');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/coach-model.js');
require('../js/generator.js');
require('../data/workouts.js');

const G=GarageFitGenerator;
const catalogue=GarageFitData.exercises;
const clone=value=>JSON.parse(JSON.stringify(value));
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const mainOf=workout=>workout.main.blocks.flatMap(block=>block.exercises);
const mainIds=workout=>mainOf(workout).map(exercise=>exercise.id);
const SUMO=['dumbbell-sumo-squat','kettlebell-sumo-squat'];
const bothSumo=ids=>SUMO.every(id=>ids.includes(id));

// [id, name, equipment, patterns, bodyFocus, difficulty, mainRole, prescription, load, sidedness, instruction]
const BATCH=[
  ['dumbbell-hammer-curl','Dumbbell hammer curl',[['dumbbells']],['pull'],'upper','easy','supporting',{type:'reps',value:10},'Medium','bilateral',
    'Stand holding dumbbells with palms facing inward, curl towards your shoulders and lower slowly, keeping elbows beside your body.'],
  ['dumbbell-overhead-triceps-extension','Dumbbell overhead triceps extension',[['dumbbells']],['push'],'upper','easy','supporting',{type:'reps',value:10},'Medium','bilateral',
    'Hold one dumbbell overhead with both hands, bend elbows to lower it behind your head and straighten your arms, keeping upper arms still and ribs down.'],
  ['dumbbell-reverse-fly','Dumbbell reverse fly',[['dumbbells']],['pull'],'upper','moderate','supporting',{type:'reps',value:12},'Light','bilateral',
    'Stand holding dumbbells, bend forward at your hips with soft knees, raise arms out to the sides and lower, keeping elbows slightly bent and your back straight.'],
  ['dumbbell-sumo-squat','Dumbbell sumo squat',[['dumbbells']],['squat'],'lower','moderate','primary',{type:'reps',value:10},'Heavy','bilateral',
    'Stand with feet wide and toes turned slightly out, hold a dumbbell between your legs, squat and stand, keeping knees in line with toes.'],
  ['alternating-lateral-lunge','Alternating lateral lunge',[],['lunge'],'lower','moderate','primary',{type:'reps',value:12},null,'alternating',
    'Step sideways, bend the stepping knee while keeping the other leg straight, then return and switch sides.'],
  ['squat-pulses','Squat pulses',[],['squat'],'lower','moderate','supporting',{type:'timed',value:30},null,'bilateral',
    'Stand with feet shoulder-width apart, lower into a squat and make small up-and-down movements, keeping knees in line with toes without standing fully upright.'],
  ['dead-bug','Dead bug',[],['core'],'core','easy','primary',{type:'reps',value:12},null,'alternating',
    'Lie on your back with arms raised and knees bent above hips, extend the opposite arm and leg, then return and switch sides, keeping your lower back against the floor.'],
  ['plank-up-downs','Plank up-downs',[],['core','push'],'core','moderate','primary',{type:'timed',value:30},null,'alternating',
    'From a forearm plank, press onto your hands one arm at a time, lower and alternate the leading arm, keeping hips steady.'],
  ['trx-t-fly','TRX T fly',[['trx']],['pull'],'upper','moderate','supporting',{type:'reps',value:10},null,'bilateral',
    'Face the anchor and lean back holding the handles with straight arms, open arms into a T to raise your body and lower slowly, keeping shoulders down.'],
  ['trx-glute-bridge','TRX glute bridge',[['trx']],['hinge'],'lower','moderate','primary',{type:'reps',value:12},null,'bilateral',
    'Lie on your back with heels in the TRX straps and knees bent, lift and lower your hips with feet steady, stopping before your lower back arches.'],
  ['kettlebell-suitcase-deadlift','Kettlebell suitcase deadlift',[['kettlebell']],['hinge'],'lower','moderate','primary',{type:'unilateral-reps',value:8},'Medium','per-side',
    'Stand with the kettlebell beside one foot, bend hips and knees to grip it, then stand without leaning sideways; lower and repeat on the other side.'],
  ['kettlebell-around-the-body-pass','Kettlebell around-the-body pass',[['kettlebell']],['core'],'core','easy','supporting',{type:'timed',value:30},'Light','none',
    'Stand tall and pass the kettlebell around your waist from hand to hand, reversing direction halfway.'],
  ['kettlebell-sumo-squat','Kettlebell sumo squat',[['kettlebell']],['squat'],'lower','moderate','primary',{type:'reps',value:10},'Heavy','bilateral',
    'Stand with feet wide and toes turned slightly out, hold the kettlebell between your legs, squat and stand, keeping knees in line with toes.']
];
const IDS=BATCH.map(row=>row[0]);

// ---- Catalogue entries ----

test('exactly the 13 approved exercises are present, generated-Main only, with the approved classification',()=>{
  assert.equal(new Set(IDS).size,13);
  for(const [id,name,equipment,patterns,bodyFocus,difficulty,mainRole,prescription,load,sidedness,instruction] of BATCH){
    const ex=catalogue[id];
    assert.ok(ex,id);
    assert.match(id,/^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.deepEqual([ex.name,ex.equipment,ex.patterns,ex.bodyFocus,ex.difficulty,ex.mainRole,ex.prescription,ex.load,ex.sidedness],
      [name,equipment,patterns,bodyFocus,difficulty,mainRole,prescription,load,sidedness],id);
    assert.equal(ex.instruction,instruction,id);
    assert.ok(ex.instruction.length<=180,id);
    assert.equal(ex.instruction.split(/(?<=\.)\s+/).length,1,id);
    assert.equal(ex.voiceInstruction,!id.endsWith('sumo-squat'),id);
    assert.ok(ex.generator&&ex.main,id);
    assert.equal(ex.warmup||ex.rampup||ex.cooldown,false,id);
    assert.equal(ex.repetitionClass,null,id);
  }
  assert.deepEqual(G.validateCatalogue(catalogue),[]);
});

test('Dead bug has one canonical definition shared with the fixed routines, whose playback is unchanged',()=>{
  assert.equal(Object.values(catalogue).filter(ex=>/dead bug/i.test(ex.name)).length,1);
  const fixed=GarageFitData.fixedWorkouts;
  const uses=Object.values(fixed).flatMap(workout=>(workout.exercises||[]).filter(item=>item.id==='dead-bug').map(item=>[workout.id,item]));
  assert.deepEqual(uses.map(([id,item])=>[id,item]),[
    ['abBlast',{id:'dead-bug',name:'Dead bug',durationSeconds:40}],
    ['eveningFullBodyReset',{id:'dead-bug',name:'Dead bug',durationSeconds:40}],
    ['postRunReset',{id:'dead-bug',name:'Dead bug',durationSeconds:25}]
  ].filter(([id])=>fixed[id]));
  assert.ok(uses.length>=2);
  assert.equal(catalogue['dead-bug'].name,'Dead bug');
});

test('only the two sumo variants share a family; near-similar movements stay separate',()=>{
  assert.equal(catalogue['dumbbell-sumo-squat'].family,'sumo-squat');
  assert.equal(catalogue['kettlebell-sumo-squat'].family,'sumo-squat');
  assert.deepEqual(Object.values(catalogue).filter(ex=>ex.family==='sumo-squat').map(ex=>ex.id).sort(),SUMO);
  for(const id of IDS.filter(id=>!SUMO.includes(id)))assert.equal(catalogue[id].family,null,id);
  // Distinct from the bilateral deadlift family, the Cossack squat, the floor bridge, the Y fly and the biceps curl.
  assert.equal(G.sameFamily(catalogue['kettlebell-suitcase-deadlift'],catalogue['kettlebell-deadlift']),false);
  assert.equal(G.sameFamily(catalogue['alternating-lateral-lunge'],catalogue['cossack-squat']),false);
  assert.equal(G.sameFamily(catalogue['trx-glute-bridge'],catalogue['glute-bridge']),false);
  assert.equal(G.sameFamily(catalogue['trx-t-fly'],catalogue['trx-y-fly']),false);
  assert.equal(G.sameFamily(catalogue['dumbbell-hammer-curl'],catalogue['dumbbell-biceps-curl']),false);
  assert.equal(catalogue['dumbbell-sumo-squat'].frequency,null);
  assert.equal(catalogue['kettlebell-sumo-squat'].frequency,null);
});

test('equipment gates each exercise',()=>{
  const owns=(id,equipment)=>G.generatedPhaseEligible(catalogue[id],'main',equipment);
  for(const id of ['alternating-lateral-lunge','squat-pulses','dead-bug','plank-up-downs'])assert.ok(owns(id,[]),id);
  for(const [id,needs] of BATCH.filter(row=>row[2].length).map(row=>[row[0],row[2][0][0]])){
    assert.equal(owns(id,[]),false,id);
    assert.ok(owns(id,[needs]),id);
    assert.equal(owns(id,['bands','bench','box']),false,id);
  }
  assert.equal(owns('dumbbell-sumo-squat',['kettlebell']),false);
  assert.equal(owns('kettlebell-sumo-squat',['dumbbells']),false);
});

test('direct elbow actions: hammer curl is flexion, overhead triceps extension is extension, the rest are unclassified',()=>{
  assert.equal(catalogue['dumbbell-hammer-curl'].directElbowAction,'flexion');
  assert.equal(catalogue['dumbbell-overhead-triceps-extension'].directElbowAction,'extension');
  for(const id of IDS.filter(id=>!['dumbbell-hammer-curl','dumbbell-overhead-triceps-extension'].includes(id)))assert.equal(catalogue[id].directElbowAction,null,id);
});

// ---- Sidedness, timing and protocols ----

test('alternating exercises play as one phase; the suitcase deadlift is per-side reps without timed intervals',()=>{
  for(const id of ['alternating-lateral-lunge','dead-bug','plank-up-downs']){
    assert.equal(catalogue[id].sidedness,'alternating',id);
    assert.equal(G.sideCount(catalogue[id]),1,id);
  }
  assert.equal(catalogue['alternating-lateral-lunge'].estimatedSeconds,40);
  assert.equal(catalogue['dead-bug'].estimatedSeconds,40);
  assert.equal(catalogue['plank-up-downs'].estimatedSeconds,30);
  assert.deepEqual(catalogue['plank-up-downs'].timedCues,[]);
  const suitcase=catalogue['kettlebell-suitcase-deadlift'];
  assert.equal(G.sideCount(suitcase),2);
  assert.equal(suitcase.unilateral,true);
  assert.deepEqual(suitcase.mainProtocols,['rounds','paired_sets']);
  assert.equal(G.protocolCompatible(suitcase,'timed_intervals'),false);
});

test('the around-the-body pass is one 30-second interval with a halfway Change direction cue',()=>{
  const pass=catalogue['kettlebell-around-the-body-pass'];
  assert.equal(pass.estimatedSeconds,30);
  assert.equal(G.sideCount(pass),1);
  assert.deepEqual(pass.prescriptionModes,['time']);
  assert.deepEqual(pass.timedCues,[{text:'Change direction',at:{type:'fraction',value:0.5}}]);
  const tracker=GarageFitTimedCues.createTracker(pass.timedCues,30);
  assert.deepEqual(GarageFitTimedCues.takeDueCues(tracker,14),[]);
  assert.equal(GarageFitTimedCues.takeDueCues(tracker,15)[0].text,'Change direction');
  assert.deepEqual(GarageFitTimedCues.takeDueCues(tracker,30),[]);
});

test('rep-based strength movements default to rounds and paired sets; only safe timed work opts into intervals',()=>{
  for(const id of IDS){
    const timed=catalogue[id].prescription.type==='timed';
    assert.deepEqual(catalogue[id].mainProtocols,timed?['rounds','paired_sets','timed_intervals']:['rounds','paired_sets'],id);
    if(!timed)assert.ok(catalogue[id].estimatedSeconds>=30,id);
  }
});

// ---- Sumo-squat single-variant rule ----

test('the sumo family is capped at one Main exercise, without capping other families',()=>{
  const db=catalogue['dumbbell-sumo-squat'],kb=catalogue['kettlebell-sumo-squat'];
  assert.equal(G.mainFamilyCapReached(kb,[db]),true);
  assert.equal(G.mainFamilyCapReached(db,[catalogue['push-up'],kb]),true);
  assert.equal(G.mainFamilyCapReached(kb,[catalogue['goblet-squat'],catalogue['kettlebell-goblet-squat']]),false);
  assert.equal(G.mainFamilyCapReached(catalogue['kettlebell-goblet-squat'],[catalogue['goblet-squat']]),false);
  assert.equal(G.mainFamilyCapReached(catalogue['kettlebell-reverse-lunge'],[catalogue['reverse-lunge']]),false);
  const blocks=[{exercises:[db,catalogue['push-up']]},{exercises:[kb,catalogue['plank']]}];
  assert.deepEqual(G.mainVarietyIssues(blocks,30,[]).filter(issue=>issue.startsWith('main:family-cap')),['main:family-cap:sumo-squat']);
  assert.deepEqual(G.mainVarietyIssues([{exercises:[catalogue['goblet-squat'],catalogue['kettlebell-goblet-squat']]}],30,[]).filter(issue=>issue.startsWith('main:family-cap')),[]);
});

test('generated Mains never contain both sumo variants, and each is reachable with its own equipment',()=>{
  const seen={dumbbells:0,kettlebell:0},both={dumbbell:0,kettlebell:0};
  for(const equipment of [['dumbbells','kettlebell'],GarageFitData.equipment.map(item=>item.id)])
    for(const focus of ['strength','balanced','cardio'])for(const duration of [20,30,45])for(let seed=1;seed<=8;seed++){
      const ids=mainIds(G.generate({catalogue,duration,focus,equipment,random:random(seed*7919+duration+focus.length),bodyFocus:seed%2?'lower':'full-body'}));
      assert.equal(bothSumo(ids),false,ids.join(','));
      if(ids.includes(SUMO[0]))both.dumbbell++;
      if(ids.includes(SUMO[1]))both.kettlebell++;
    }
  assert.ok(both.dumbbell>0&&both.kettlebell>0,JSON.stringify(both));
  for(const [equipment,id] of [['dumbbells',SUMO[0]],['kettlebell',SUMO[1]]]){
    for(let seed=1;seed<=30&&!seen[equipment];seed++)
      if(mainIds(G.generate({catalogue,duration:30,focus:'strength',equipment:[equipment],random:random(seed)})).includes(id))seen[equipment]++;
    assert.ok(seen[equipment],id);
  }
});

test('a constrained pool where the sumo variants are the only squats still generates, with one variant',()=>{
  const pool={};
  for(const id of [...SUMO,'push-up','plank','dumbbell-bent-over-row','kettlebell-deadlift','reverse-lunge','dumbbell-farmer-carry'])pool[id]=catalogue[id];
  G.assertValidCatalogue(pool);
  let sumo=0;
  for(const focus of ['strength','balanced'])for(const duration of [10,20,45])for(let seed=1;seed<=10;seed++){
    const workout=G.generate({catalogue:pool,duration,focus,equipment:['dumbbells','kettlebell'],random:random(seed)});
    const ids=mainIds(workout);
    assert.ok(ids.length>0);
    assert.equal(bothSumo(ids),false,ids.join(','));
    if(ids.some(id=>SUMO.includes(id)))sumo++;
  }
  assert.ok(sumo>0);
  // With only the two sumo squats eligible, the Main uses one of them.
  const tiny={};for(const id of SUMO)tiny[id]=catalogue[id];
  for(let seed=1;seed<=5;seed++){
    const ids=mainIds(G.generate({catalogue:tiny,duration:10,focus:'strength',equipment:['dumbbells','kettlebell'],random:random(seed)}));
    assert.ok(ids.length>=1&&!bothSumo(ids),ids.join(','));
  }
});

test('a swap never adds the other sumo variant, and swapping the sumo slot itself may change variant',()=>{
  const pool={};
  for(const id of [...SUMO,'goblet-squat','kettlebell-goblet-squat','push-up','plank','dumbbell-bent-over-row'])pool[id]=catalogue[id];
  const workout=()=>({duration:20,focus:'strength',main:{blocks:[
    {id:'main-1',protocol:'rounds',intent:'strength',exercises:[catalogue['dumbbell-sumo-squat'],catalogue['push-up']].map(clone),prescription:{rounds:3,exerciseRestSeconds:20,roundRestSeconds:60}},
    {id:'main-2',protocol:'rounds',intent:'strength',exercises:[catalogue['goblet-squat'],catalogue['plank']].map(clone),prescription:{rounds:3,exerciseRestSeconds:20,roundRestSeconds:60}}
  ]},warmup:{exercises:[]},rampup:{exercises:[]},cooldown:{exercises:[]}});
  const replacements=new Set();
  for(let seed=1;seed<=40;seed++){
    const swapped=G.swap(workout(),1,0,{catalogue:pool,equipment:['dumbbells','kettlebell'],random:random(seed)});
    const ids=mainIds(swapped);
    replacements.add(ids[2]);
    assert.equal(bothSumo(ids),false,ids.join(','));
  }
  assert.ok(replacements.has('kettlebell-goblet-squat'),[...replacements].join(','));
  assert.ok(!replacements.has('kettlebell-sumo-squat'));
  let changedVariant=false;
  for(let seed=1;seed<=40;seed++){
    const ids=mainIds(G.swap(workout(),0,0,{catalogue:pool,equipment:['dumbbells','kettlebell'],random:random(seed)}));
    assert.equal(bothSumo(ids),false,ids.join(','));
    if(ids[0]==='kettlebell-sumo-squat')changedVariant=true;
  }
  assert.ok(changedVariant);
  // Swaps on generated workouts keep the rule too.
  for(let seed=1;seed<=20;seed++){
    const generated=G.generate({catalogue,duration:30,focus:'strength',equipment:['dumbbells','kettlebell'],random:random(seed)});
    G.mainBlocks(generated).forEach((block,blockIndex)=>block.exercises.forEach((_,exerciseIndex)=>{
      G.swap(generated,blockIndex,exerciseIndex,{catalogue,equipment:['dumbbells','kettlebell'],random:random(seed+blockIndex+exerciseIndex)});
      assert.equal(bothSumo(mainIds(generated)),false,mainIds(generated).join(','));
    }));
  }
});

// ---- Coach Session Prescriptions ----

const sumoAnchor=(exerciseId,overrides)=>fixtures.anchor(Object.assign({requirementId:'anchor-'+exerciseId,exerciseId,targetSets:3,
  target:{type:'reps',minReps:10,maxReps:10},allowedProtocols:['rounds','paired_sets']},overrides));
const prescription=overrides=>fixtures.prescription(Object.assign({duration:30,equipment:['dumbbells','kettlebell'],movementPriorities:[]},overrides));

test('a Coach Main around a sumo anchor never adds the other variant',()=>{
  for(const id of SUMO){
    const rx=prescription({requiredAnchors:[sumoAnchor(id)]});
    assert.equal(G.assessSessionPrescription({catalogue,sessionPrescription:rx}).status,'feasible');
    for(let seed=1;seed<=20;seed++){
      const ids=mainIds(G.generate({catalogue,sessionPrescription:rx,random:random(seed)}));
      assert.ok(ids.includes(id));
      assert.equal(bothSumo(ids),false,ids.join(','));
    }
  }
});

test('two required sumo anchors are a hard conflict; a preferred one beside a required one is dropped',()=>{
  const conflicted=prescription({requiredAnchors:[sumoAnchor(SUMO[0]),sumoAnchor(SUMO[1])]});
  const assessment=G.assessSessionPrescription({catalogue,sessionPrescription:conflicted});
  assert.equal(assessment.status,'infeasible');
  assert.ok(assessment.hardConflicts.some(item=>item.code==='family-cap-conflict'&&item.exerciseIds.includes(SUMO[0])&&item.exerciseIds.includes(SUMO[1])),JSON.stringify(assessment.hardConflicts));
  assert.throws(()=>G.generate({catalogue,sessionPrescription:conflicted,random:random(1)}),error=>error instanceof G.SessionPrescriptionError);
  const preferred=prescription({requiredAnchors:[sumoAnchor(SUMO[0])],preferredAnchors:[sumoAnchor(SUMO[1],{importance:'preferred'})]});
  const soft=G.assessSessionPrescription({catalogue,sessionPrescription:preferred});
  assert.equal(soft.status,'partially-feasible');
  assert.ok(soft.softConflicts.some(item=>item.code==='family-cap-conflict'));
  for(let seed=1;seed<=20;seed++){
    const ids=mainIds(G.generate({catalogue,sessionPrescription:preferred,random:random(seed)}));
    assert.ok(ids.includes(SUMO[0]));
    assert.equal(bothSumo(ids),false,ids.join(','));
  }
  // Two preferred sumo anchors: at most one is placed.
  const twoPreferred=prescription({requiredAnchors:[],preferredAnchors:SUMO.map(id=>sumoAnchor(id,{importance:'preferred'}))});
  for(let seed=1;seed<=20;seed++)assert.equal(bothSumo(mainIds(G.generate({catalogue,sessionPrescription:twoPreferred,random:random(seed)}))),false);
});

test('Build Arms reads the new direct arm exercises without Coach-specific tags',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  const result=JSON.parse(require('node:vm').runInContext(`JSON.stringify((()=>{
    const def=GarageFitData.programmes['build-arms'][1];
    const engine=GarageFitCoachEngine.createEngine({catalogue:CATALOGUE,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription});
    const dumbbells=engine.assessProgrammeFeasibility(def,{equipment:['dumbbells']});
    const hammer=engine.assessProgrammeFeasibility(def,{equipment:['dumbbells'],anchorSelections:{'anchor-flexion':'dumbbell-hammer-curl'}});
    const fly=engine.assessProgrammeFeasibility(def,{equipment:['dumbbells'],anchorSelections:{'anchor-flexion':'dumbbell-reverse-fly'}});
    return {status:dumbbells.status,anchors:dumbbells.anchors.map(a=>a.exerciseId),hammer:hammer.status,hammerAnchor:hammer.anchors[0]&&hammer.anchors[0].exerciseId,fly:fly.status};
  })())`,app));
  // Dumbbells alone now provide both direct actions; the curl anchor keeps its established default.
  assert.equal(result.status,'feasible');
  assert.deepEqual(result.anchors,['dumbbell-biceps-curl','dumbbell-overhead-triceps-extension']);
  assert.equal(result.hammer,'feasible');
  assert.equal(result.hammerAnchor,'dumbbell-hammer-curl');
  assert.equal(result.fly,'infeasible');
  for(const id of IDS)for(const field of Object.keys(catalogue[id]))assert.doesNotMatch(field,/coach|programme/i,id);
});

// ---- Bounded deterministic reachability ----

function sample(equipment,focuses,durations,seeds,extra={}){
  const out=[];
  for(const focus of focuses)for(const duration of durations)for(let seed=1;seed<=seeds;seed++)
    out.push(G.generate(Object.assign({catalogue,duration,focus,equipment,random:random(seed*104729+duration*7+focus.length)},extra)));
  return out;
}
const count=(workouts,id)=>workouts.filter(workout=>mainIds(workout).includes(id)).length;

test('the bodyweight additions are reachable in Main',()=>{
  const bodyweight=sample([],['strength','balanced','cardio'],[20,30,45],20);
  for(const [id,min] of [['alternating-lateral-lunge',10],['squat-pulses',5],['plank-up-downs',10]])assert.ok(count(bodyweight,id)>=min,id+' '+count(bodyweight,id));
  const core=sample([],['strength','balanced'],[30,45],20,{bodyFocus:'core'});
  assert.ok(count(core,'dead-bug')>=3,'dead bug '+count(core,'dead-bug'));
});

test('the kettlebell and TRX additions are reachable in Main',()=>{
  const kettlebell=sample(['kettlebell'],['strength','balanced'],[30,45],40);
  for(const [id,min] of [['kettlebell-sumo-squat',20],['kettlebell-suitcase-deadlift',2]])assert.ok(count(kettlebell,id)>=min,id+' '+count(kettlebell,id));
  const kettlebellCore=sample(['kettlebell'],['strength','balanced'],[30,45],20,{bodyFocus:'core'});
  assert.ok(count(kettlebellCore,'kettlebell-around-the-body-pass')>=3,'pass '+count(kettlebellCore,'kettlebell-around-the-body-pass'));
  const trx=sample(['trx'],['strength','balanced'],[30,45],40);
  for(const [id,min] of [['trx-glute-bridge',10],['trx-t-fly',3]])assert.ok(count(trx,id)>=min,id+' '+count(trx,id));
  // Supporting work stays below its primary peers.
  assert.ok(count(trx,'trx-t-fly')*2<count(trx,'trx-row'));
});

test('the dumbbell additions are reachable in Main; the arm and fly accessories stay rare supporting work',()=>{
  const dumbbells=sample(['dumbbells'],['strength','balanced'],[30,45],40);
  assert.ok(count(dumbbells,'dumbbell-sumo-squat')>=10,'sumo '+count(dumbbells,'dumbbell-sumo-squat'));
  // The dumbbell accessory pool is crowded (see the PR's audit notes); an Upper focus reaches it.
  const easyUpper=sample(['dumbbells','pullup-bar'],['strength','balanced'],[30,45],50,{bodyFocus:'upper',difficulty:'easy'});
  for(const id of ['dumbbell-overhead-triceps-extension','dumbbell-hammer-curl'])assert.ok(count(easyUpper,id)>=2,id+' '+count(easyUpper,id));
  const hardUpper=sample(['dumbbells','box'],['strength','balanced'],[30,45],50,{bodyFocus:'upper',difficulty:'hard'});
  assert.ok(count(hardUpper,'dumbbell-reverse-fly')>=2,'reverse fly '+count(hardUpper,'dumbbell-reverse-fly'));
  for(const workout of dumbbells.concat(easyUpper,hardUpper))
    for(const id of ['dumbbell-overhead-triceps-extension','dumbbell-hammer-curl','dumbbell-reverse-fly'])assert.ok(mainIds(workout).filter(item=>item===id).length<=1);
});
