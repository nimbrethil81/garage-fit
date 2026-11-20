const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {loadAppContext}=require('./helpers/app-context');
global.window=global;
for(const path of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','js/strength-cardio-composer'])require('../'+path);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises;
const FAMILY='resistance-endurance',STYLES=['muscular-endurance','metcon'];
// Capture the registered composer so tests can steer a style or corrupt one attempt without a
// second registration; production registration and the shared gate are otherwise untouched.
const hook={forced:null,corrupt:null},register=G.registerFamilyComposer;
let compose=null;
G.registerFamilyComposer=(id,version,fn,quality)=>{
  if(id===FAMILY)compose=fn;
  return register(id,version,id!==FAMILY?fn:(options,request,attempt)=>{
    const made=fn(options,request,hook.forced?{excludedStyleIds:STYLES.filter(style=>style!==hook.forced)}:attempt);
    return hook.corrupt?hook.corrupt(made,attempt):made;
  },quality);
};
require('../js/resistance-endurance-composer');
G.registerFamilyComposer=register;
const RE=GarageFitResistanceEndurance;
const copy=value=>JSON.parse(JSON.stringify(value));
function rng(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const EQUIPMENT={bodyweight:[],limited:['dumbbells'],broad:['dumbbells','kettlebell','pullup-bar','trx','rings','barbell','bench','box','bands']};
const generate=(extra={})=>G.generate({workoutFamilyId:FAMILY,workoutFamilyVersion:1,duration:20,difficulty:'normal',catalogue:C,equipment:[],random:rng(7),...extra});
const validate=(workout,equipment=[])=>G.validateFamilyWorkout(workout,{catalogue:C,equipment});
const forced=(style,extra)=>{hook.forced=style;try{return generate(extra);}finally{hook.forced=null;}};
const exercisesOf=workout=>workout.main.blocks.flatMap(block=>block.exercises);
const roles=block=>block.exercises.map(RE.role);

function assertSession(w,{duration,difficulty,equipment}) {
  assert.equal(w.workoutFamilyId,FAMILY);assert.equal(w.workoutFamilyVersion,1);assert.ok(STYLES.includes(w.familyStyleId));
  assert.deepEqual(validate(w,equipment),{valid:true,technicalIssues:[],qualityIssues:[]});
  // Generic preparation surrounds Main and the whole session fits the selected duration.
  assert.ok(w.warmup.exercises.length&&w.rampup.exercises.length&&w.cooldown.exercises.length);
  assert.ok(w.estimatedSeconds<=duration*60&&w.estimatedSeconds>=duration*60*.85,'estimate '+w.estimatedSeconds);
  assert.ok(w.main.blocks.every(b=>['rounds','paired_sets'].includes(b.protocol)&&b.familyContext===undefined&&b.occurrenceTargets===undefined));
  for(const ex of exercisesOf(w)) {
    assert.deepEqual(ex,C[ex.id],'canonical prescription preserved');
    assert.ok(G.generatedPhaseEligible(ex,'main',equipment,difficulty));
    // Safely repeatable work: no Heavy or strength-5 lifts; hard-rated work only on Hard; no jumping on Easy.
    assert.ok(ex.load!=='Heavy'&&ex.strength<=4);
    assert.ok(difficulty==='hard'||ex.difficulty!=='hard',ex.id);
    assert.ok(difficulty!=='easy'||ex.impact!=='high',ex.id);
  }
  for(const block of w.main.blocks) {
    assert.ok(block.exercises.filter(ex=>ex.impact==='high').length<=1);
    assert.ok(block.exercises.filter(ex=>ex.conditioning&&ex.difficulty==='hard'&&ex.equipment.length).length<=1,'one technical loaded lift per block');
    assert.ok(block.exercises.every((ex,i)=>!i||!G.sharedPatterns(block.exercises[i-1],ex).some(p=>['squat','hinge','lunge','push','pull','carry'].includes(p))));
    const lowerLift=ex=>ex.strength>=4&&ex.patterns.some(p=>['squat','hinge','lunge'].includes(p));
    assert.ok(block.protocol!=='rounds'||block.exercises.every((ex,i)=>!i||!(lowerLift(ex)&&lowerLift(block.exercises[i-1]))),'no stacked loaded lower-body lifts');
  }
  const shares=RE.sessionShares(w.main.blocks);
  if(w.familyStyleId==='metcon') {
    assert.ok(shares.resistance>=.5&&shares.conditioning>=.25,JSON.stringify(shares));
    for(const block of w.main.blocks) {
      const r=roles(block);
      assert.equal(block.protocol,'rounds');
      assert.ok(r.includes('conditioning')&&r.filter(x=>x==='resistance').length>=r.filter(x=>x==='conditioning').length);
      assert.ok(r.every((x,i)=>x!=='conditioning'||r[(i+1)%r.length]!=='conditioning'),'conditioning stations are separated');
    }
  } else {
    assert.ok(shares.resistance>=.7&&shares.conditioning===0,JSON.stringify(shares));
    assert.ok(w.main.blocks.every(block=>roles(block).filter(x=>x==='support').length<=1));
  }
}

test('Strength & Stamina is the seventh canonical family with stable ids, two automatic styles and no new settings',()=>{
  assert.equal(F.FAMILY_IDS.length,7);assert.equal(F.FAMILY_IDS[6],FAMILY);
  const definition=F.getDefinition(FAMILY);
  assert.equal(definition.name,'Strength & Stamina');assert.equal(F.currentVersion(FAMILY),1);
  assert.deepEqual(definition.styles,[{id:'muscular-endurance',name:'Muscular Endurance'},{id:'metcon',name:'Metcon'}]);
  assert.deepEqual(definition.bodyFocus,['full-body']);
  assert.deepEqual(definition.feasibilityRequirements.supportedDurations,[10,15,20,30,45]);
  assert.ok(Object.isFrozen(definition)&&Object.isFrozen(definition.styles));
  assert.equal(F.resolveRequest({workoutFamilyId:FAMILY,bodyFocus:'upper'}).bodyFocus,'full-body');
  assert.throws(()=>F.resolveRequest({workoutFamilyId:FAMILY,familyStyleId:'metcon'}),error=>error.code==='invalid-family-request');
  // The old working name is not displayed anywhere new.
  assert.ok(!/Resistance Endurance/.test(fs.readFileSync('data/workout-families.js','utf8')));
  assert.match(fs.readFileSync('index.html','utf8'),/js\/strength-cardio-composer.js[\s\S]*js\/core-challenge-composer.js[\s\S]*js\/resistance-endurance-composer.js/);
});

test('exercise roles come from existing metadata: one role per movement, no double credit for dual-purpose lifts',()=>{
  const role=id=>RE.role(C[id]);
  assert.equal(role('air-squat'),'resistance');          // controlled bodyweight squat counts
  assert.equal(role('push-up'),'resistance');
  assert.equal(role('kettlebell-swing'),'conditioning'); // dual-purpose: conditioning only
  assert.equal(role('dumbbell-thruster'),'conditioning');
  assert.equal(role('plank'),'support');                 // trunk work earns no resistance credit
  assert.equal(role('dumbbell-squat-to-calf-raise'),null); // cardio-led variant is neither
  assert.equal(role('step-jacks'),null);                 // gentle cardio-2 stepping is not conditioning here
  assert.equal(RE.suitable(C['goblet-squat'],'hard'),false); // Heavy
  assert.equal(RE.suitable(C['pull-up'],'hard'),false);      // strength 5
  assert.equal(RE.suitable(C['dumbbell-snatch'],'normal'),false); // hard-rated: Hard only
  assert.equal(RE.suitable(C['dumbbell-snatch'],'hard'),true);
  assert.equal(RE.suitable(C['high-knees'],'easy'),false);   // no jumping on Easy
});

test('every duration, difficulty and kit profile yields a validated resistance-led session; both styles occur',()=>{
  const seen=new Set();
  for(const [kit,equipment] of Object.entries(EQUIPMENT))for(const duration of [10,15,20,30,45])for(const difficulty of ['easy','normal','hard']) {
    const w=generate({duration,difficulty,equipment,random:rng(duration*7+difficulty.length+kit.length)});
    assertSession(w,{duration,difficulty,equipment});
    seen.add(w.familyStyleId);
  }
  assert.deepEqual([...seen].sort(),STYLES.slice().sort());
});

test('the two styles are genuinely distinct on the resolved work',()=>{
  for(const [kit,equipment] of Object.entries(EQUIPMENT))for(const difficulty of ['easy','normal','hard']) {
    const me=forced('muscular-endurance',{equipment,difficulty,duration:30,random:rng(3)});
    const mc=forced('metcon',{equipment,difficulty,duration:30,random:rng(3)});
    assert.equal(me.familyStyleId,'muscular-endurance',kit);assert.equal(mc.familyStyleId,'metcon',kit);
    assertSession(me,{duration:30,difficulty,equipment});assertSession(mc,{duration:30,difficulty,equipment});
    const a=RE.sessionShares(me.main.blocks),b=RE.sessionShares(mc.main.blocks);
    assert.ok(a.conditioning===0&&b.conditioning>=.25&&a.resistance>b.resistance);
    // Metcon recovery is shorter than Muscular Endurance recovery at the same difficulty.
    const rest=w=>Math.max(...w.main.blocks.filter(b=>b.protocol==='rounds').map(b=>b.prescription.exerciseRestSeconds));
    assert.ok(rest(mc)<=rest(me),[rest(mc),rest(me)].join());
    assert.ok(Math.min(...mc.main.blocks.map(b=>{const d=RE.blockDose(b);return d.work/(d.work+d.rest);}))>=RE.POLICY.metcon[difficulty].density);
  }
});

test('Metcon stays resistance-led: token resistance, cardio-only and dual-purpose substitutes fail closed',()=>{
  const w=forced('metcon',{equipment:EQUIPMENT.broad,difficulty:'normal',duration:20,random:rng(5)});
  assert.equal(validate(w,EQUIPMENT.broad).valid,true);
  // Same names-per-slot pattern (R C R C) but short resistance against long conditioning: time-weighted share fails.
  const token=copy(w);token.main.blocks=[{...token.main.blocks[0],exercises:['air-squat','low-impact-speed-skaters','push-up','boxer-step-and-punches'].map(id=>copy(C[id]))}];
  assert.ok(RE.sessionShares(token.main.blocks).resistance<.5);
  assert.ok(G.validateFamilyWorkout(token,{catalogue:C,equipment:EQUIPMENT.broad}).qualityIssues.includes('quality:not-resistance-led'));
  // Cardio only: every station conditioning.
  const cardio=copy(w);cardio.main.blocks.forEach(block=>{block.exercises=block.exercises.map((ex,i)=>copy(C[['jumping-jacks','mountain-climbers','fast-feet','kettlebell-swing','step-ups','bear-crawl'][i]]));});
  const issues=validate(cardio,EQUIPMENT.broad).qualityIssues;
  assert.ok(issues.includes('quality:not-resistance-led')&&issues.includes('quality:style-structure-mismatch'));
  // A dual-purpose lift is not resistance credit: swings in the resistance stations do not rescue it.
  const swings=copy(w);swings.main.blocks.forEach(block=>{block.exercises=block.exercises.map(ex=>RE.role(ex)==='resistance'?copy(C['kettlebell-swing']):ex);});
  assert.ok(validate(swings,EQUIPMENT.broad).qualityIssues.includes('quality:not-resistance-led'));
});

test('Muscular Endurance rejects conditioning, Heavy and hard-rated substitutes outside Hard',()=>{
  const w=forced('muscular-endurance',{equipment:EQUIPMENT.broad,difficulty:'normal',duration:20,random:rng(9)});
  const swap=(id)=>{const edited=copy(w);edited.main.blocks[0].exercises[0]=copy(C[id]);return validate(edited,EQUIPMENT.broad).qualityIssues;};
  assert.ok(swap('jumping-jacks').includes('quality:unsuitable-exercise:jumping-jacks'));
  assert.ok(swap('goblet-squat').includes('quality:unsuitable-exercise:goblet-squat'));
  assert.ok(swap('dumbbell-renegade-row').includes('quality:unsuitable-exercise:dumbbell-renegade-row'));
  // Two demanding lower-body lifts back to back in a circuit (different patterns) are a fatiguing sequence.
  const stacked=copy(w);stacked.main.blocks[0]={...stacked.main.blocks[0],protocol:'rounds',
    exercises:['kettlebell-deadlift','kettlebell-goblet-squat','dumbbell-floor-press'].map(id=>copy(C[id]))};
  assert.ok(validate(stacked,EQUIPMENT.broad).qualityIssues.includes('quality:fatiguing-sequence'));
  // Too little recovery for the difficulty, or rest stretched past its range, is not the published structure.
  const rushed=copy(w);rushed.main.blocks[0].prescription.roundRestSeconds=10;
  assert.ok(validate(rushed,EQUIPMENT.broad).qualityIssues.includes('quality:style-structure-mismatch'));
});

test('automatic style selection is seeded, varies from the last completed style and is never a fixed rotation',()=>{
  const a=generate({random:rng(21)}),b=generate({random:rng(21)});
  delete a.id;delete b.id;
  assert.deepEqual(a,b,'same seed, same workout');
  const count=(previous)=>{let metcon=0;for(let seed=1;seed<=16;seed++){
    const w=generate({random:rng(seed),...(previous?{recentFamilySessions:{[FAMILY]:{familyStyleId:previous,completedOccurrences:[],plannedOccurrences:4}}}:{})});
    if(w.familyStyleId==='metcon')metcon++;}return metcon;};
  const neutral=count(null),afterMetcon=count('metcon'),afterEndurance=count('muscular-endurance');
  assert.ok(afterMetcon<neutral&&afterEndurance>neutral,[neutral,afterMetcon,afterEndurance].join());
  assert.ok(afterMetcon>0&&afterEndurance<16,'variation is encouraged, not enforced');
});

test('same-family fallback: a failed style yields the other style, never another family, with diagnostics',()=>{
  // Composition level: no conditioning movement is permitted, so Metcon cannot build.
  const request=F.resolveRequest({workoutFamilyId:FAMILY,workoutFamilyVersion:1});
  // The narrow supported/hanging pool may also be unable to fill Muscular Endurance: that is an honest
  // family-not-feasible, never a Metcon without conditioning.
  let built=0;
  for(let seed=1;seed<=12;seed++) {
    try {
      const made=compose({catalogue:C,duration:20,difficulty:'normal',equipment:EQUIPMENT.broad,bodyPositions:['supported','hanging'],random:rng(seed)},request,{excludedStyleIds:[]});
      assert.equal(made.familyStyleId,'muscular-endurance');built++;
    } catch(error) {assert.ok(error instanceof F.FamilyContractError&&error.code==='family-not-feasible');}
  }
  assert.ok(built>=6,'most seeds fall back to Muscular Endurance');
  // Gate level: a Metcon attempt that would read as cardio is rejected and the wrapper excludes it.
  hook.corrupt=(made,attempt)=>{
    if(made.familyStyleId!=='metcon')return made;
    const bad=copy(made);bad.blocks.forEach(block=>{block.exercises=block.exercises.map(ex=>RE.role(ex)==='resistance'?copy(C['jumping-jacks']):ex);});
    return bad;
  };
  let fallbacks=0;
  try {
    for(let seed=1;seed<=12;seed++) {
      const w=generate({random:rng(seed)});
      assert.equal(w.workoutFamilyId,FAMILY);assert.equal(w.familyStyleId,'muscular-endurance');
      if(w.familyDiagnostics){fallbacks++;assert.ok(w.familyDiagnostics.some(r=>r.code==='style-quality-failed'&&r.familyStyleId==='metcon'
        &&r.issues.includes('quality:not-resistance-led')));}
    }
  } finally {hook.corrupt=null;}
  assert.ok(fallbacks>=3,'Metcon ranked first and was rejected by the gate in several seeds');
  // Genuinely impossible: an honest family-not-feasible error, no fabricated workout or other family.
  assert.throws(()=>generate({bodyPositions:['hanging']}),error=>error instanceof F.FamilyContractError&&error.code==='family-not-feasible'
    &&error.workoutFamilyId===FAMILY&&Array.isArray(error.reasons)&&error.reasons.length>0);
});

test('swaps keep the family label only when the whole revised workout passes; edits fail closed',()=>{
  for(const style of STYLES) {
    const equipment=EQUIPMENT.limited,w=forced(style,{equipment,duration:15,difficulty:'normal',random:rng(4)});
    w.main.blocks.forEach((block,blockIndex)=>block.exercises.forEach((ex,exerciseIndex)=>{
      const swapped=G.swap(copy(w),blockIndex,exerciseIndex,{catalogue:C,equipment,random:rng(blockIndex*10+exerciseIndex)});
      assert.deepEqual(validate(swapped,equipment),{valid:true,technicalIssues:[],qualityIssues:[]},style+' '+blockIndex+':'+exerciseIndex);
      assert.equal(swapped.familyStyleId,style);
      // A replacement may change a station's role only where the whole style still validates
      // (e.g. Muscular Endurance's single support station); it never imports another style's role.
      const replaced=swapped.main.blocks[blockIndex].exercises[exerciseIndex];
      assert.ok((style==='metcon'?['resistance','conditioning']:['resistance','support']).includes(RE.role(replaced)));
    }));
  }
});

test('Strength & Stamina is available to Coach family plans and keeps its delivered identity in history labels',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true}),vm=require('node:vm');
  const out=JSON.parse(vm.runInContext(`(()=>{
    let seed=3;Math.random=()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
    const rx=GarageFitCoachModel.createSessionPrescription({prescriptionId:'rx-re',programmeInstanceId:'test',sessionRole:'family-check',
      duration:20,difficulty:'normal',bodyFocus:'full-body',equipment:[],
      workoutFamilyPlan:{candidates:[{workoutFamilyId:'${FAMILY}',workoutFamilyVersion:1,rationale:'Strength & Stamina check.'}]}});
    const w=GarageFitGenerator.generate({catalogue:GarageFitData.exercises,sessionPrescription:rx,history:[]});
    const identity=GarageFitCoachProgressUI.workoutIdentity({workoutFamilyId:w.workoutFamilyId,workoutFamilyVersion:w.workoutFamilyVersion,familyStyleId:w.familyStyleId});
    // A completed result keeps the tuple; the newest completed family session feeds the next style choice.
    const result=GarageFitCoachModel.createSessionResult({sessionResultId:'r1',source:'generator',workoutFamilyId:'${FAMILY}',workoutFamilyVersion:1,familyStyleId:'metcon',
      startedAt:'2026-11-01T08:00:00Z',endedAt:'2026-11-01T08:20:00Z',finalStatus:'completed',
      plannedWork:[{occurrenceId:'o1',exerciseId:'air-squat',section:'main'}],performedWork:[{occurrenceId:'o1',exerciseId:'air-squat',status:'completed'}]});
    const last=GarageFitTrainingHistory.createHistory([result],GarageFitData.exercises).lastCompletedFamilySessions()['${FAMILY}'];
    return JSON.stringify({family:w.workoutFamilyId,style:w.familyStyleId,replanned:w.familyReplan.replanned,
      valid:GarageFitGenerator.validateFamilyWorkout(w,{catalogue:GarageFitData.exercises,equipment:[]}).valid,identity,
      preview:generatedWorkoutIdentity(w),last:[last.workoutFamilyVersion,last.familyStyleId]});
  })()`,app));
  assert.deepEqual([out.family,out.replanned,out.valid],[FAMILY,false,true]);
  const style=out.style==='metcon'?'Metcon':'Muscular Endurance';
  assert.equal(out.identity.family,'Strength & Stamina');
  assert.equal(out.identity.label,'Strength & Stamina — '+style);
  assert.equal(out.preview,'Strength & Stamina · '+style);
  assert.deepEqual(out.last,[1,'metcon']);
});
