// Catalogue expansion Batch 2 (#110): 12 Main exercises, including the Reverse crunch
// already referenced by the 5-Minute Ab Blast.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');

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
const mainIds=workout=>workout.main.blocks.flatMap(block=>block.exercises).map(exercise=>exercise.id);

// [id, name, equipment, patterns, bodyFocus, difficulty, mainRole, prescription, load, sidedness, instruction]
// The front raise is a straight-arm raise, not a press: like the lateral raise it has no pattern.
const BATCH=[
  ['dumbbell-arnold-press','Dumbbell Arnold press',[['dumbbells']],['push'],'upper','moderate','primary',{type:'reps',value:10},'Medium','bilateral',
    'Hold the dumbbells in front of your shoulders with palms facing you, then rotate your palms outward as you press overhead.'],
  ['dumbbell-alternating-front-raise','Alternating dumbbell front raise',[['dumbbells']],[],'upper','easy','supporting',{type:'reps',value:12},'Light','alternating',
    'Hold the dumbbells by your thighs, raise one straight arm to shoulder height, then lower and alternate arms.'],
  ['dumbbell-kickstand-romanian-deadlift','Dumbbell kickstand Romanian deadlift',[['dumbbells']],['hinge'],'lower','moderate','primary',{type:'unilateral-reps',value:8},'Medium','per-side',
    'Place one foot slightly behind the other for balance, hinge at your hips over the front leg, then stand tall; repeat on the other side.'],
  ['dumbbell-close-grip-floor-press','Dumbbell close-grip floor press',[['dumbbells']],['push'],'upper','moderate','primary',{type:'reps',value:10},'Medium','bilateral',
    'Lie on your back holding dumbbells close together above your chest, then bend your elbows to lower and press back up.'],
  ['reverse-crunch','Reverse crunch',[],['core'],'core','easy','primary',{type:'reps',value:12},null,'bilateral',
    'Lie on your back with knees bent, draw them towards your chest and gently curl your hips off the floor before lowering.'],
  ['hollow-body-hold','Hollow-body hold',[],['core'],'core','hard','primary',{type:'timed',value:20},null,'none',
    'Lie on your back, press your lower back into the floor and hold your shoulders and legs slightly raised, bending your knees if your back lifts.'],
  ['bear-plank-shoulder-taps','Bear plank shoulder taps',[],['core','push'],'core','moderate','supporting',{type:'timed',value:30},null,'alternating',
    'Start on hands and toes with knees hovering, then tap alternate shoulders without twisting your hips.'],
  ['reverse-lunge-knee-drive','Reverse lunge to knee drive',[],['lunge'],'lower','moderate','primary',{type:'unilateral-reps',value:10},null,'per-side',
    'Step back into a lunge, then drive the rear knee forwards and upwards as you return to standing; repeat on the other side.'],
  ['trx-body-saw','TRX body saw',[['trx']],['core'],'core','hard','primary',{type:'timed',value:30},null,'none',
    'Place your feet in the TRX straps and hold a forearm plank, then slowly shift your body backwards and forwards without letting your hips sag.'],
  ['trx-high-row','TRX high row',[['trx']],['pull'],'upper','moderate','primary',{type:'reps',value:10},null,'bilateral',
    'Face the anchor and lean back, then pull the handles towards your upper chest with elbows raised outwards.'],
  ['kettlebell-lateral-lunge','Kettlebell lateral lunge',[['kettlebell']],['lunge'],'lower','moderate','primary',{type:'reps',value:12},'Medium','alternating',
    'Hold the kettlebell at your chest, step sideways into a lunge, return to standing and alternate sides.'],
  ['kettlebell-rack-march','Kettlebell rack march',[['kettlebell']],['core'],'core','moderate','supporting',{type:'unilateral-timed',value:30},'Medium','per-side',
    'Hold the kettlebell at one shoulder and march on the spot, keeping your torso upright and steady; repeat with it at the other shoulder.']
];
const IDS=BATCH.map(row=>row[0]);

// ---- Catalogue entries ----

test('exactly the 12 approved exercises are present, generated-Main only, with the approved classification',()=>{
  assert.equal(new Set(IDS).size,12);
  for(const [id,name,equipment,patterns,bodyFocus,difficulty,mainRole,prescription,load,sidedness,instruction] of BATCH){
    const ex=catalogue[id];
    assert.ok(ex,id);
    assert.match(id,/^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.deepEqual([ex.name,ex.equipment,ex.patterns,ex.bodyFocus,ex.difficulty,ex.mainRole,ex.prescription,ex.load,ex.sidedness],
      [name,equipment,patterns,bodyFocus,difficulty,mainRole,prescription,load,sidedness],id);
    assert.equal(ex.instruction,instruction,id);
    assert.ok(ex.instruction.length<=180,id);
    assert.equal(ex.instruction.split(/(?<=\.)\s+/).length,1,id);
    // The familiar Reverse crunch keeps the Ab Blast's audio unchanged.
    assert.equal(ex.voiceInstruction,id!=='reverse-crunch',id);
    assert.ok(ex.generator&&ex.main,id);
    assert.equal(ex.warmup||ex.rampup||ex.cooldown,false,id);
    assert.equal(ex.directElbowAction,null,id);
    assert.deepEqual(ex.timedCues,[],id);
    for(const field of Object.keys(ex))assert.doesNotMatch(field,/coach|programme/i,id);
  }
  assert.deepEqual(G.validateCatalogue(catalogue),[]);
});

test('Reverse crunch has one canonical definition behind the Ab Blast id, whose playback is unchanged',()=>{
  assert.deepEqual(Object.values(catalogue).filter(ex=>/reverse crunch/i.test(ex.name)).map(ex=>ex.id),['reverse-crunch']);
  const fixed=GarageFitData.fixedWorkouts;
  const uses=Object.values(fixed).flatMap(workout=>(workout.exercises||[]).filter(item=>item.id==='reverse-crunch').map(item=>[workout.id,item]));
  assert.deepEqual(uses,[['abBlast',{id:'reverse-crunch',name:'Reverse crunch',durationSeconds:40}]]);
  assert.deepEqual(fixed.abBlast.exercises.map(item=>[item.id,item.durationSeconds]),[
    ['sit-up',40],['side-plank',30],['side-plank',30],['reverse-crunch',40],['plank',40],['dead-bug',40],['bicycle-crunch',40],['flutter-kicks',40]
  ]);
  assert.equal(fixed.abBlast.termination.durationSeconds,300);
  // The timed sequence still plays 40 seconds with no cue; the player now shows the written instruction.
  const app=loadAppContext();
  app.document.readyState='loading';
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/workouts-ui.js'),'utf8'),app);
  app.GarageFitWorkoutUI.startTimedSequenceWorkout('abBlast');
  const step=vm.runInContext("JSON.stringify(state.list.find(item=>item.id==='reverse-crunch'))",app);
  assert.deepEqual(JSON.parse(step),{id:'reverse-crunch',name:'Reverse crunch',work:40,rest:0,timedCues:[]});
  assert.equal(app.GarageFitData.exercises['reverse-crunch'].instruction,BATCH.find(row=>row[0]==='reverse-crunch')[10]);
});

test('equipment gates each exercise',()=>{
  const owns=(id,equipment)=>G.generatedPhaseEligible(catalogue[id],'main',equipment);
  for(const id of ['reverse-crunch','hollow-body-hold','bear-plank-shoulder-taps','reverse-lunge-knee-drive'])assert.ok(owns(id,[]),id);
  for(const [id,needs] of BATCH.filter(row=>row[2].length).map(row=>[row[0],row[2][0][0]])){
    assert.equal(owns(id,[]),false,id);
    assert.ok(owns(id,[needs]),id);
    assert.equal(owns(id,['bands','bench','box','barbell']),false,id);
  }
});

test('difficulty settings gate the hard holds and keep the rest',()=>{
  for(const id of ['hollow-body-hold','trx-body-saw'])
    assert.equal(G.generatedPhaseEligible(catalogue[id],'main',['trx'],'easy'),false,id);
  for(const id of IDS.filter(id=>!['hollow-body-hold','trx-body-saw'].includes(id)))
    assert.ok(G.generatedPhaseEligible(catalogue[id],'main',['dumbbells','kettlebell','trx'],'easy'),id);
});

// ---- Sidedness, timing and protocols ----

test('alternating exercises are one phase with their stated total; per-side reps account for both sides',()=>{
  const app=loadAppContext();
  const phases=id=>clone(app.makeGeneratedExercisePhases(catalogue[id],'main',null,0).map(phase=>[phase.side,phase.seconds]));
  for(const [id,seconds] of [['dumbbell-alternating-front-raise',35],['kettlebell-lateral-lunge',45]]){
    assert.equal(G.sideCount(catalogue[id]),1,id);
    assert.equal(catalogue[id].estimatedSeconds,seconds,id);
    assert.deepEqual(phases(id),[[null,null]],id);
  }
  for(const [id,label] of [['dumbbell-kickstand-romanian-deadlift','8 reps each side · Medium'],['reverse-lunge-knee-drive','10 reps each side']]){
    const ex=catalogue[id];
    assert.equal(G.sideCount(ex),2,id);
    assert.equal(ex.unilateral,true,id);
    // Both sides, set-up and the side change are in the estimate (one side of 8–10 reps is ~25 s).
    assert.equal(ex.estimatedSeconds,50,id);
    assert.equal(app.formatPrescription(ex),label);
    assert.deepEqual(phases(id),[['right',null],['left',null]],id);
  }
});

test('continuous timed holds and taps are one interval; the rack march is 30 seconds on each side',()=>{
  const app=loadAppContext();
  const phases=id=>clone(app.makeGeneratedExercisePhases(catalogue[id],'main',null,0).map(phase=>[phase.side,phase.seconds,phase.timed]));
  assert.deepEqual(phases('bear-plank-shoulder-taps'),[[null,30,true]]);
  assert.deepEqual(phases('hollow-body-hold'),[[null,20,true]]);
  assert.deepEqual(phases('trx-body-saw'),[[null,30,true]]);
  const march=catalogue['kettlebell-rack-march'];
  assert.equal(march.estimatedSeconds,60);
  assert.equal(app.formatPrescription(march),'30 sec each side · Medium');
  assert.deepEqual(phases('kettlebell-rack-march'),[['right',30,true],['left',30,true]]);
});

test('rep-based strength movements use rounds and paired sets; only continuous timed work opts into intervals',()=>{
  const intervals=['hollow-body-hold','bear-plank-shoulder-taps','trx-body-saw'];
  for(const id of IDS)
    assert.deepEqual(catalogue[id].mainProtocols,intervals.includes(id)?['rounds','paired_sets','timed_intervals']:['rounds','paired_sets'],id);
  // The per-side rack march is never compressed into one interval slot.
  assert.equal(G.protocolCompatible(catalogue['kettlebell-rack-march'],'timed_intervals'),false);
  for(const id of ['hollow-body-hold','bear-plank-shoulder-taps','trx-body-saw','kettlebell-rack-march'])
    assert.deepEqual(catalogue[id].prescriptionModes,['time'],id);
  // Generated Mains never put the rack march in a timed-interval block.
  for(let seed=1;seed<=40;seed++){
    const workout=G.generate({catalogue,duration:30,focus:seed%2?'balanced':'cardio',equipment:['kettlebell'],bodyFocus:'core',random:random(seed)});
    for(const block of workout.main.blocks)if(block.protocol==='timed_intervals')
      assert.equal(block.exercises.some(ex=>ex.sidedness==='per-side'),false,block.exercises.map(ex=>ex.id).join(','));
  }
});

// ---- Relationships ----

test('equipment and grip variants share the existing families; related but distinct movements stay separate',()=>{
  const family=id=>catalogue[id].family;
  assert.equal(family('dumbbell-arnold-press'),family('dumbbell-shoulder-press'));
  assert.equal(family('dumbbell-arnold-press'),'overhead-press');
  assert.equal(family('dumbbell-close-grip-floor-press'),family('dumbbell-floor-press'));
  assert.equal(family('dumbbell-close-grip-floor-press'),'floor-press');
  assert.deepEqual(Object.values(catalogue).filter(ex=>ex.family==='trx-row').map(ex=>ex.id).sort(),['ring-row','trx-high-row','trx-row']);
  assert.deepEqual(Object.values(catalogue).filter(ex=>ex.family==='lateral-lunge').map(ex=>ex.id).sort(),['alternating-lateral-lunge','kettlebell-lateral-lunge']);
  // Close duplicates without being variants of one exercise.
  assert.equal(G.sameFamily(catalogue['bear-plank-shoulder-taps'],catalogue['plank-shoulder-taps']),false);
  assert.equal(G.sameRepetitionClass(catalogue['bear-plank-shoulder-taps'],catalogue['plank-shoulder-taps']),true);
  assert.deepEqual(Object.values(catalogue).filter(ex=>ex.repetitionClass==='plank-shoulder-taps').map(ex=>ex.id).sort(),['bear-plank-shoulder-taps','plank-arm-reaches','plank-shoulder-taps']);
  // Mechanically distinct: pattern proximity, not family identity.
  assert.equal(G.sameFamily(catalogue['dumbbell-kickstand-romanian-deadlift'],catalogue['dumbbell-romanian-deadlift']),false);
  assert.equal(G.sameFamily(catalogue['reverse-lunge-knee-drive'],catalogue['reverse-lunge']),false);
  for(const id of ['dumbbell-alternating-front-raise','dumbbell-kickstand-romanian-deadlift','reverse-crunch','hollow-body-hold','bear-plank-shoulder-taps','reverse-lunge-knee-drive','trx-body-saw','kettlebell-rack-march'])
    assert.equal(family(id),null,id);
  for(const id of IDS)assert.equal(catalogue[id].frequency,null,id);
});

test('the new families are not capped: near-duplicates are scored, not excluded, and the sumo cap still holds',()=>{
  for(const [a,b] of [['dumbbell-arnold-press','dumbbell-shoulder-press'],['dumbbell-close-grip-floor-press','dumbbell-floor-press'],['trx-high-row','trx-row'],['kettlebell-lateral-lunge','alternating-lateral-lunge']]){
    assert.equal(G.mainFamilyCapReached(catalogue[a],[catalogue[b]]),false,a);
    assert.equal(G.mainFamilyCapReached(catalogue[b],[catalogue[a]]),false,b);
    assert.deepEqual(G.mainVarietyIssues([{exercises:[catalogue[a],catalogue[b]]}],30,[]).filter(issue=>issue.startsWith('main:family-cap')),[],a);
    // Recent use of a variant counts towards the recency penalty.
    assert.ok(G.recentUsePenalty(catalogue[a],[[b]],catalogue)>0,a);
  }
  assert.equal(G.mainFamilyCapReached(catalogue['kettlebell-sumo-squat'],[catalogue['dumbbell-sumo-squat']]),true);
  // Core work shares no major pattern, so unrelated core exercises carry no recency penalty.
  assert.equal(G.recentUsePenalty(catalogue['trx-body-saw'],[['hollow-body-hold']],catalogue),0);
});

test('a swap may replace a press with its family variant, unlike the sumo single-variant family',()=>{
  const pool={};
  for(const id of ['dumbbell-shoulder-press','dumbbell-arnold-press','dumbbell-floor-press','dumbbell-close-grip-floor-press','air-squat','plank','dumbbell-bent-over-row'])pool[id]=catalogue[id];
  const workout=()=>({duration:20,focus:'strength',main:{blocks:[
    {id:'main-1',protocol:'rounds',intent:'strength',exercises:[catalogue['dumbbell-shoulder-press'],catalogue['air-squat']].map(clone),prescription:{rounds:3,exerciseRestSeconds:20,roundRestSeconds:60}},
    {id:'main-2',protocol:'rounds',intent:'strength',exercises:[catalogue['dumbbell-floor-press'],catalogue['plank']].map(clone),prescription:{rounds:3,exerciseRestSeconds:20,roundRestSeconds:60}}
  ]},warmup:{exercises:[]},rampup:{exercises:[]},cooldown:{exercises:[]}});
  const replacements=new Set();
  for(let seed=1;seed<=40;seed++)replacements.add(mainIds(G.swap(workout(),1,0,{catalogue:pool,equipment:['dumbbells'],random:random(seed)}))[2]);
  assert.ok(replacements.has('dumbbell-close-grip-floor-press'),[...replacements].join(','));
});

test('a generated Main may hold two members of an uncapped family, but rarely next to each other',()=>{
  let together=0,adjacent=0;
  for(const focus of ['strength','balanced'])for(const duration of [30,45])for(let seed=1;seed<=25;seed++){
    const workout=G.generate({catalogue,duration,focus,equipment:['dumbbells'],bodyFocus:'upper',random:random(seed*31+duration)});
    for(const block of workout.main.blocks)block.exercises.forEach((ex,index)=>{
      const next=block.exercises[index+1];
      if(next&&G.sameFamily(ex,next)&&IDS.some(id=>id===ex.id||id===next.id))adjacent++;
    });
    const ids=mainIds(workout);
    if(ids.includes('dumbbell-arnold-press')&&ids.includes('dumbbell-shoulder-press'))together++;
  }
  // Adjacent press variants share a major pattern, which Main scores down heavily.
  assert.equal(adjacent,0);
  assert.ok(together<20,String(together));
});

// ---- Coach Session Prescriptions ----

test('Coach Session Prescriptions accept the new exercises as anchors with their own sides',()=>{
  const fixtures=require('./helpers/coach-fixtures.js');
  const anchor=(exerciseId,target)=>fixtures.anchor({requirementId:'anchor-'+exerciseId,exerciseId,targetSets:3,target,allowedProtocols:['rounds','paired_sets']});
  for(const [id,equipment,target] of [
    ['dumbbell-arnold-press',['dumbbells'],{type:'reps',minReps:10,maxReps:10}],
    ['dumbbell-kickstand-romanian-deadlift',['dumbbells'],{type:'reps',minReps:8,maxReps:8}],
    ['trx-high-row',['trx'],{type:'reps',minReps:10,maxReps:10}]
  ]){
    const rx=fixtures.prescription({duration:30,equipment,movementPriorities:[],requiredAnchors:[anchor(id,target)]});
    assert.equal(G.assessSessionPrescription({catalogue,sessionPrescription:rx}).status,'feasible',id);
    for(let seed=1;seed<=5;seed++)assert.ok(mainIds(G.generate({catalogue,sessionPrescription:rx,random:random(seed)})).includes(id),id);
  }
});

// ---- Bounded deterministic reachability ----

function sample(equipment,focuses,durations,seeds,extra={}){
  const out=[];
  for(const focus of focuses)for(const duration of durations)for(let seed=1;seed<=seeds;seed++)
    out.push(G.generate(Object.assign({catalogue,duration,focus,equipment,random:random(seed*104729+duration*7+focus.length)},extra)));
  return out;
}
const count=(workouts,id)=>workouts.filter(workout=>mainIds(workout).includes(id)).length;

test('[Full] the bodyweight additions are reachable in Main',()=>{
  const bodyweight=sample([],['strength','balanced','cardio'],[20,30,45],10);
  for(const [id,min] of [['hollow-body-hold',5],['reverse-lunge-knee-drive',5]])assert.ok(count(bodyweight,id)>=min,id+' '+count(bodyweight,id));
  const core=sample([],['strength','balanced'],[30,45],20,{bodyFocus:'core'});
  for(const [id,min] of [['bear-plank-shoulder-taps',3],['hollow-body-hold',10]])assert.ok(count(core,id)>=min,id+' '+count(core,id));
  // Accessible foundations are favoured at Easy; hard holds retain their own Normal sample.
  const accessible=sample([],['strength','balanced'],[30,45],20,{bodyFocus:'core',difficulty:'easy'});
  assert.ok(count(accessible,'reverse-crunch')>=3,'reverse crunch '+count(accessible,'reverse-crunch'));
  // Supporting work stays below its primary peers.
  assert.ok(count(core,'bear-plank-shoulder-taps')<count(core,'hollow-body-hold'));
});

test('[Full] the dumbbell additions are reachable in Main; the front raise is supporting work used once at most',()=>{
  const upper=sample(['dumbbells'],['strength','balanced'],[30,45],20,{bodyFocus:'upper'});
  for(const [id,min] of [['dumbbell-arnold-press',10],['dumbbell-close-grip-floor-press',5]])assert.ok(count(upper,id)>=min,id+' '+count(upper,id));
  const lower=sample(['dumbbells'],['strength','balanced'],[30,45],20,{bodyFocus:'lower'});
  assert.ok(count(lower,'dumbbell-kickstand-romanian-deadlift')>=5,'kickstand '+count(lower,'dumbbell-kickstand-romanian-deadlift'));
  // The dumbbell upper-body accessory pool is crowded (see the PR's audit notes); an easy Upper focus reaches it.
  const easyUpper=sample(['dumbbells','pullup-bar'],['strength','balanced'],[30,45],50,{bodyFocus:'upper',difficulty:'easy'});
  assert.ok(count(easyUpper,'dumbbell-alternating-front-raise')>=2,'front raise '+count(easyUpper,'dumbbell-alternating-front-raise'));
  for(const workout of upper.concat(easyUpper))assert.ok(mainIds(workout).filter(id=>id==='dumbbell-alternating-front-raise').length<=1);
});

test('[Full] the kettlebell and TRX additions are reachable in Main',()=>{
  const kettlebell=sample(['kettlebell'],['strength','balanced'],[30,45],20);
  assert.ok(count(kettlebell,'kettlebell-lateral-lunge')>=5,'lateral lunge '+count(kettlebell,'kettlebell-lateral-lunge'));
  const kettlebellCore=sample(['kettlebell'],['strength','balanced'],[30,45],20,{bodyFocus:'core'});
  assert.ok(count(kettlebellCore,'kettlebell-rack-march')>=5,'rack march '+count(kettlebellCore,'kettlebell-rack-march'));
  const trx=sample(['trx'],['strength','balanced'],[30,45],20);
  for(const [id,min] of [['trx-body-saw',5],['trx-high-row',3]])assert.ok(count(trx,id)>=min,id+' '+count(trx,id));
  // The high row adds variety without displacing the standard TRX row.
  assert.ok(count(trx,'trx-high-row')*2<count(trx,'trx-row'));
});
