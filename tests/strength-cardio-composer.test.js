const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {loadAppContext}=require('./helpers/app-context');
global.window=global;
for(const path of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','js/strength-cardio-composer','js/core-challenge-composer'])require('../'+path);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises;
const STRENGTH='strength-control',CARDIO='cardio-conditioning';
const copy=x=>JSON.parse(JSON.stringify(x));
function rng(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const EQUIPMENT={bodyweight:[],limited:['dumbbells'],broad:['dumbbells','kettlebell','pullup-bar','trx','rings','barbell','bench','box','bands']};
const DURATIONS=[10,15,20,30,45],DIFFICULTIES=['easy','normal','hard'];
const generate=(workoutFamilyId,extra={})=>G.generate({workoutFamilyId,duration:20,difficulty:'normal',catalogue:C,equipment:[],random:rng(7),...extra});
const mean=(list,key)=>list.reduce((sum,ex)=>sum+ex[key],0)/list.length;
const exercisesOf=w=>w.main.blocks.flatMap(b=>b.exercises);

// A displayed style must describe the resolved workout, not merely label it.
const STRUCTURE={
  'straight-sets':blocks=>blocks.every(b=>b.protocol==='rounds'&&b.exercises.length===1&&b.prescription.rounds>=3&&b.prescription.roundRestSeconds>=45),
  'paired-sets':blocks=>blocks.every(b=>b.protocol==='paired_sets'&&b.prescription.sets>=3&&b.prescription.betweenSetsSeconds>=45),
  'controlled-circuits':blocks=>blocks.every(b=>b.protocol==='rounds'&&b.exercises.length>=3&&b.prescription.rounds>=2
    &&b.prescription.exerciseRestSeconds>=20&&b.prescription.roundRestSeconds>=60),
  endurance:blocks=>blocks.every(b=>b.protocol==='rounds'&&b.prescription.exerciseRestSeconds<=20&&b.prescription.roundRestSeconds<=45),
  intervals:blocks=>blocks.every(b=>b.protocol==='timed_intervals'&&b.prescription.workSeconds/b.prescription.transitionSeconds>=1
    &&b.prescription.workSeconds/b.prescription.transitionSeconds<=3),
  'mixed-conditioning':blocks=>blocks.some(b=>b.protocol==='rounds')&&blocks.some(b=>b.protocol==='timed_intervals')
};
const workShare=b=>G.resolveBlockSteps(b).filter(s=>s.kind==='exercise')
  .reduce((sum,s)=>sum+(s.timed?s.seconds:b.exercises[s.exerciseIndex].estimatedSeconds),0)/G.estimateBlockDuration(b);

function assertSession(w,family,{duration,difficulty,equipment,version=1}) {
  const budget=G.BUDGETS[duration],exercises=exercisesOf(w),blocks=w.main.blocks;
  assert.equal(w.workoutFamilyId,family);assert.equal(w.workoutFamilyVersion,version);
  assert.ok(F.getDefinition(family).styles.some(s=>s.id===w.familyStyleId));
  assert.equal(w.duration,duration);assert.equal(w.difficulty,difficulty);
  // The generic preparation/cool-down surround Main; the whole session fits the selected duration.
  assert.ok(w.warmup.exercises.length&&w.cooldown.exercises.length);
  assert.ok(w.estimatedSeconds<=duration*60&&w.estimatedSeconds>=duration*60*.85,'estimate '+w.estimatedSeconds);
  assert.ok(w.main.estimatedDurationSeconds<=budget.main&&w.main.estimatedDurationSeconds>=budget.main*.88);
  assert.equal(w.main.estimatedDurationSeconds,G.mainSeconds(blocks,equipment));
  assert.deepEqual(G.validateMain(w.main,C,equipment,budget.main),[]);
  assert.ok(STRUCTURE[w.familyStyleId](blocks),'structure must match '+w.familyStyleId);
  assert.ok(blocks.every(b=>b.familyContext===undefined&&b.occurrenceTargets===undefined));
  for(const ex of exercises) {
    assert.deepEqual(ex,C[ex.id]);
    assert.ok(G.generatedPhaseEligible(ex,'main',equipment,difficulty));
  }
  assert.ok(exercises.every(ex=>difficulty!=='easy'||ex.difficulty!=='hard'));
  if(family===STRENGTH) {
    assert.ok(blocks.every(b=>['rounds','paired_sets'].includes(b.protocol)));
    assert.ok(exercises.every(ex=>ex.strength>=2&&ex.strength>=ex.cardio&&!ex.conditioning&&ex.impact!=='high'));
    assert.ok(mean(exercises,'strength')>=2.5&&mean(exercises,'strength')>=mean(exercises,'cardio')+.5);
    assert.ok(new Set(exercises.map(ex=>ex.id)).size>=2);
  } else {
    assert.ok(exercises.every(ex=>ex.cardio>=3&&ex.cardio>=ex.strength));
    assert.ok(mean(exercises,'cardio')>=3.25&&mean(exercises,'cardio')>mean(exercises,'strength')+.5);
    assert.ok(blocks.every(b=>workShare(b)>=.5),'conditioning blocks must be work-dominant');
    assert.ok(difficulty!=='easy'||exercises.every(ex=>ex.impact!=='high'));
    let previous=null;
    for(const b of blocks) {
      assert.ok(['rounds','timed_intervals'].includes(b.protocol));
      if(b.protocol==='timed_intervals') for(const ex of b.exercises) {
        assert.equal(G.sideCount(ex),1);assert.ok(G.protocolCompatible(ex,'timed_intervals'));
        // No rep movement is held as a timed effort longer than its catalogue estimate.
        if(!String(ex.prescription.type).includes('timed'))assert.ok(b.prescription.workSeconds<=ex.estimatedSeconds);
        if(ex.impact==='high')assert.ok(b.prescription.workSeconds<=40);
      }
      const flow=[...b.exercises,...(G.blockRepeatCount(b)>1?[b.exercises[0]]:[])];
      assert.ok(flow.every((ex,i)=>!i||ex.impact!=='high'||flow[i-1].impact!=='high'));
      assert.ok(!(previous&&previous.impact==='high'&&b.exercises[0].impact==='high'));
      assert.ok(b.exercises.filter(ex=>ex.impact==='high').length<=Math.floor(b.exercises.length/2));
      if(b.protocol==='rounds')assert.ok(b.exercises.every(ex=>ex.impact!=='high'&&ex.load!=='Heavy'&&ex.strength<=3));
      previous=b.exercises.at(-1);
    }
  }
}

const REPRESENTATIVE=[[10,'easy','bodyweight'],[15,'normal','bodyweight'],[20,'normal','limited'],[30,'hard','limited'],[45,'hard','broad'],[45,'easy','broad']];

test('both families register working composers with distinct identities and consistent honest structure',()=>{
  assert.throws(()=>G.registerFamilyComposer(STRENGTH,1,()=>({})),/once per published policy/);
  assert.throws(()=>G.registerFamilyComposer(CARDIO,1,()=>({})),/once per published policy/);
  const styles={[STRENGTH]:new Set(),[CARDIO]:new Set()};
  for(const [duration,difficulty,key] of REPRESENTATIVE)for(const family of [STRENGTH,CARDIO])for(const seed of [1,2]) {
    const equipment=EQUIPMENT[key],w=generate(family,{duration,difficulty,equipment,random:rng(seed*977+duration)});
    assertSession(w,family,{duration,difficulty,equipment});styles[family].add(w.familyStyleId);
  }
  assert.ok(styles[STRENGTH].size>=2&&styles[CARDIO].size>=2,'representative seeds reach more than one automatic style');
});

test('Strength resolves long-rest straight sets, paired sets and circuits, Cardio distinct work-rest structures, within one family',()=>{
  const seen={};
  for(const family of [STRENGTH,CARDIO])for(const duration of [10,20,45])for(let seed=1;seed<=10;seed++) {
    const w=generate(family,{duration,equipment:EQUIPMENT.limited,random:rng(seed*131+duration)});
    (seen[w.familyStyleId]=seen[w.familyStyleId]||[]).push(w);
  }
  assert.deepEqual(Object.keys(seen).sort(),['controlled-circuits','endurance','intervals','mixed-conditioning','paired-sets','straight-sets']);
  // Straight sets rest at least as long, per exercise, as the short transitions of cardio circuits.
  const rest=seen['straight-sets'].flatMap(w=>w.main.blocks.map(b=>b.prescription.roundRestSeconds));
  const cardioRest=seen.endurance.flatMap(w=>w.main.blocks.map(b=>b.prescription.roundRestSeconds));
  assert.ok(Math.min(...rest)>=Math.max(...cardioRest));
  // Straight sets favour longer sessions, circuits/pairs shorter ones.
  assert.ok(seen['straight-sets'].filter(w=>w.duration===45).length>seen['straight-sets'].filter(w=>w.duration===10).length);
});

test('Strength and Cardio exercise scores separate controlled resistance from credible conditioning',()=>{
  const strength=[],cardio=[];
  for(const seed of [1,2,3,4])for(const key of ['bodyweight','limited','broad']) {
    strength.push(...exercisesOf(generate(STRENGTH,{equipment:EQUIPMENT[key],random:rng(seed)})));
    cardio.push(...exercisesOf(generate(CARDIO,{equipment:EQUIPMENT[key],random:rng(seed)})));
  }
  assert.ok(mean(strength,'strength')-mean(strength,'cardio')>=1.5);
  assert.ok(mean(cardio,'cardio')-mean(cardio,'strength')>=.75);
  assert.ok(mean(strength,'strength')>mean(cardio,'strength')&&mean(cardio,'cardio')>mean(strength,'cardio'));
});

test('Body Focus is a Strength preference only; Cardio ignores it through the shared definition',()=>{
  const share=(bodyFocus,focus)=>{
    let total=0,matching=0;
    for(const seed of [1,2,3,4,5,6]) {
      const w=generate(STRENGTH,{bodyFocus,equipment:EQUIPMENT.broad,random:rng(seed)});
      assert.equal(w.bodyFocus,bodyFocus);
      for(const ex of exercisesOf(w)){total++;if(ex.bodyFocus===focus)matching++;}
    }
    return matching/total;
  };
  assert.ok(share('upper','upper')>share('lower','upper'));
  assert.ok(share('lower','lower')>share('upper','lower'));
  assert.ok(share('core','core')>share('full-body','core'));
  assert.ok(share('upper','upper')<1,'a preference, never a hard exclusivity constraint');
  const plain=generate(CARDIO,{random:rng(3)}),withFocus=generate(CARDIO,{random:rng(3),bodyFocus:'upper'});
  assert.equal(withFocus.bodyFocus,'full-body');
  assert.deepEqual(withFocus.main.blocks,plain.main.blocks);
  assert.throws(()=>generate(STRENGTH,{bodyFocus:'sideways'}),error=>error.code==='unsupported-family-body-focus');
  assert.deepEqual(F.getDefinition(CARDIO).bodyFocus,['full-body']);
  assert.deepEqual(F.getDefinition(STRENGTH).bodyFocus,['full-body','upper','lower','core']);
});

test('recent-session history lowers exercise repetition and recent protocols influence style weights',()=>{
  const overlap=useHistory=>{
    let repeated=0;
    for(const seed of [1,2,3,4,5,6]) {
      const first=exercisesOf(generate(STRENGTH,{duration:30,equipment:EQUIPMENT.limited,random:rng(seed)})).map(ex=>ex.id);
      const second=generate(STRENGTH,{duration:30,equipment:EQUIPMENT.limited,random:rng(seed+100),...(useHistory?{history:[first]}:{})});
      repeated+=exercisesOf(second).filter(ex=>first.includes(ex.id)).length;
    }
    return repeated;
  };
  assert.ok(overlap(true)<overlap(false));
  const count=(recentProtocols)=>{
    let paired=0;
    for(let seed=1;seed<=24;seed++)if(generate(STRENGTH,{duration:15,equipment:EQUIPMENT.limited,recentProtocols,random:rng(seed)}).familyStyleId==='paired-sets')paired++;
    return paired;
  };
  assert.ok(count(['paired_sets'])<count([]));
});

test('impact and position constraints filter the canonical pool and infeasible requests fail honestly',()=>{
  const lowOnly=generate(CARDIO,{excludedImpact:['medium','high'],duration:20,equipment:EQUIPMENT.broad});
  assert.ok(exercisesOf(lowOnly).every(ex=>ex.impact==='low'));
  const standing=generate(STRENGTH,{bodyPositions:['standing'],equipment:EQUIPMENT.limited});
  assert.ok(exercisesOf(standing).every(ex=>ex.bodyPosition==='standing'));
  for(const [family,extra] of [[STRENGTH,{excludedImpact:['low','medium','high']}],[CARDIO,{excludedImpact:['low','medium','high']}],
    [STRENGTH,{bodyPositions:['hanging']}],[CARDIO,{bodyPositions:['hanging']}],[CARDIO,{excludedImpact:['medium','high'],duration:10,difficulty:'easy'}]])
    assert.throws(()=>generate(family,extra),error=>error instanceof F.FamilyContractError&&error.code==='family-not-feasible'&&/cannot build/.test(error.message));
  for(const bad of [{excludedImpact:['loud']},{excludedImpact:'low'},{bodyPositions:[]},{bodyPositions:['floating']}])
    assert.throws(()=>generate(STRENGTH,bad),error=>error.code==='invalid-family-context');
});

test('family sessions remain determined by the seed and leave Coach prescriptions and no-family generation to their own paths',()=>{
  for(const family of [STRENGTH,CARDIO]) {
    const first=generate(family,{random:rng(11)}),second=generate(family,{random:rng(11)});
    assert.deepEqual({...first,id:0},{...second,id:0});
    assert.throws(()=>generate(family,{sessionPrescription:{}}),error=>error.code==='family-prescription-unsupported');
  }
  const legacy=()=>G.generate({duration:20,focus:'cardio',catalogue:C,equipment:[],random:rng(5)});
  assert.deepEqual({...legacy(),id:0},{...legacy(),id:0});
  const calls=[];
  G.generate({duration:20,focus:'balanced',catalogue:C,equipment:[],workoutFamilyId:null,random:()=>{calls.push(1);return .3;}});
  const baseline=[];
  G.generate({duration:20,focus:'balanced',catalogue:C,equipment:[],random:()=>{baseline.push(1);return .3;}});
  assert.equal(calls.length,baseline.length);
});

test('family sessions normalise idempotently and share unique planned occurrences with the player',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  for(const family of [STRENGTH,CARDIO])for(const [duration,difficulty,key] of [[10,'easy','bodyweight'],[30,'normal','limited']]) {
    const w=generate(family,{duration,difficulty,equipment:EQUIPMENT[key],random:rng(21)});
    assert.deepEqual(copy(G.normaliseWorkout(copy(w))),copy(w));
    app.input=copy(w);
    const plan=app.GarageFitSessionTracker.plannedWorkFromTimeline(app.buildGeneratedTimeline(app.input));
    assert.equal(new Set(plan.map(p=>p.occurrenceId)).size,plan.length);
    const main=plan.filter(p=>p.section==='main');
    assert.equal(main.length,w.main.blocks.reduce((sum,b)=>sum+G.resolveBlockSteps(b).filter(s=>s.kind==='exercise')
      .reduce((n,s)=>n+G.sideCount(b.exercises[s.exerciseIndex]),0),0));
  }
});

// ---- Strength & Control composition v2: the Generator's bounded supporting route (#261) ----
// v2 keeps v1's family, styles, structure and gate; paired sets and circuits of 30+ minutes may take the Generator's
// single seeded route draw (G.drawSupportingRoute), so a suitable supporting drill can close a later block.
const supporting=ex=>ex.mainRole==='supporting',controlled=ex=>ex.strength>=2&&ex.strength>=ex.cardio&&!ex.conditioning&&ex.impact!=='high';
const strip=w=>({...copy(w),id:0,workoutFamilyVersion:0});
const detail=w=>[w.familyStyleId,w.main.blocks.map(b=>[b.protocol,b.intent,b.exercises.map(ex=>ex.id),b.prescription])];
// A traced session: `routed` holds the picks the supporting route took (route slots exist only when the route was drawn).
const traced=(family,extra)=>{
  const routed=[],w=generate(family,{...extra,trace:event=>{if(event.type==='pick'&&event.route)routed.push(event);}});
  return {w,routed};
};
const closesLaterBlock=w=>w.main.blocks.slice(1).some(b=>supporting(b.exercises.at(-1)));
const longRuns={};
const sample=version=>longRuns[version]=longRuns[version]||(()=>{
  const runs=[];
  for(const duration of [30,45])for(const key of ['limited','broad'])for(let seed=1;seed<=10;seed++)
    runs.push({duration,equipment:EQUIPMENT[key],...traced(STRENGTH,{duration,equipment:EQUIPMENT[key],workoutFamilyVersion:version,random:rng(seed*313+duration+key.length)})});
  return runs;
})();

test('v2 can draw the supporting route in paired sets and circuits; v1 and Cardio never do, and straight sets never apply it',()=>{
  const calls=[],original=G.drawSupportingRoute;
  G.drawSupportingRoute=(...args)=>{const result=original(...args);calls.push(result);return result;};
  try {
    const one=sample(1);
    assert.equal(calls.length,0,'v1 takes no route draw');
    assert.ok(one.every(run=>!run.routed.length),'v1 never opens the route');
    for(const key of ['limited','broad'])for(const duration of [30,45])for(let seed=1;seed<=6;seed++)
      assert.ok(!traced(CARDIO,{duration,equipment:EQUIPMENT[key],random:rng(seed)}).routed.length);
    assert.equal(calls.length,0,'Cardio takes no route draw');
    const two=sample(2),routedRuns=two.filter(run=>run.routed.length);
    assert.ok(calls.length>0&&routedRuns.length>=3,'the route opens under v2 ('+routedRuns.length+' of '+two.length+')');
    for(const run of routedRuns) {
      assert.notEqual(run.w.familyStyleId,'straight-sets','a one-exercise block is not a closing accessory slot');
      assert.ok(closesLaterBlock(run.w),'the drawn route closes a later block');
      for(const event of run.routed) {
        assert.equal(event.intent,'accessory');
        assert.ok(supporting(event.picked)&&!event.picked.conditioning&&event.scored.length>=G.SUPPORTING_ROUTE.minCandidates);
        assert.ok(event.scored.every(entry=>supporting(entry.exercise)&&controlled(entry.exercise)),'route candidates are suitable supporting work');
      }
    }
    // Straight sets take no draw, so their v2 sessions are exactly the released v1 sessions for the same seed.
    let straight=0;
    for(let seed=1;seed<=24;seed++) {
      const common={duration:45,equipment:EQUIPMENT.broad},a=traced(STRENGTH,{...common,workoutFamilyVersion:1,random:rng(seed)}),b=traced(STRENGTH,{...common,workoutFamilyVersion:2,random:rng(seed)});
      if(a.w.familyStyleId!=='straight-sets'||b.w.familyStyleId!=='straight-sets')continue;
      straight++;assert.deepEqual(strip(a.w),strip(b.w));assert.ok(!b.routed.length);
    }
    assert.ok(straight>=3,'straight-set seeds compared: '+straight);
  } finally {G.drawSupportingRoute=original;}
});

test('v2 supporting work stays a minor, suitable, non-repeating part: no quota, and sessions without it remain the norm',()=>{
  const runs=sample(2);
  let withSupporting=0,supportingSlots=0,slots=0;
  for(const run of runs) {
    const list=exercisesOf(run.w),extra=list.filter(supporting);
    assertSession(run.w,STRENGTH,{duration:run.duration,difficulty:'normal',equipment:run.equipment,version:2});
    assert.ok(extra.length<=2&&extra.length*3<=list.length,'supporting work stays a minor part: '+extra.length+' of '+list.length);
    assert.ok(extra.every(controlled)&&new Set(list.map(ex=>ex.id)).size===list.length);
    if(extra.length)withSupporting++;
    supportingSlots+=extra.length;slots+=list.length;
  }
  assert.ok(withSupporting>0,'supporting drills are reachable');
  assert.ok(withSupporting<runs.length*.5,'sessions without supporting work stay the norm: '+withSupporting+'/'+runs.length);
  assert.ok(supportingSlots*8<=slots,'supporting share of slots stays small: '+supportingSlots+'/'+slots);
});

test('v2 equals v1 wherever the route cannot apply, with the same feasibility, short sessions and restricted kits',()=>{
  // Below 30 minutes the shared draw takes no random value, so v2 composes exactly what v1 does.
  for(const duration of [10,15,20])for(const key of ['bodyweight','limited','broad'])for(let seed=1;seed<=4;seed++) {
    const extra={duration,equipment:EQUIPMENT[key]},random=()=>rng(seed*17+duration);
    assert.deepEqual(strip(generate(STRENGTH,{...extra,random:random(),workoutFamilyVersion:2})),strip(generate(STRENGTH,{...extra,random:random(),workoutFamilyVersion:1})));
  }
  // Restricted kits, impact and position constraints and Easy: same feasibility, and every v2 session still fits the family.
  const restrictions=[{},{excludedImpact:['medium','high']},{bodyPositions:['standing']},{bodyPositions:['floor','supported']},{difficulty:'easy'},{excludedImpact:['low','medium','high']}];
  for(const duration of [30,45])for(const key of ['bodyweight','limited'])for(const restriction of restrictions)for(const seed of [1,2,3]) {
    const extra={duration,equipment:EQUIPMENT[key],...restriction},run=version=>{
      try{return generate(STRENGTH,{...extra,random:rng(seed*29+duration),workoutFamilyVersion:version});}catch(error){return error.code;}
    };
    const one=run(1),two=run(2);
    assert.equal(typeof one==='string',typeof two==='string','same feasibility '+JSON.stringify([duration,key,restriction,seed]));
    if(typeof two==='string'){assert.equal(two,'family-not-feasible');continue;}
    assertSession(two,STRENGTH,{duration,difficulty:restriction.difficulty||'normal',equipment:EQUIPMENT[key],version:2});
    for(const ex of exercisesOf(two))assert.ok(!(restriction.excludedImpact||[]).includes(ex.impact)&&(!restriction.bodyPositions||restriction.bodyPositions.includes(ex.bodyPosition)));
  }
});

test('Strength & Control v1 compositions stay exactly as released, and all three styles keep their structure and gate under v2',()=>{
  // Published v1: one structural digest of 120 compositions across durations, difficulties, kits and seeds.
  const snapshotCatalogue=require('./helpers/coach-fixtures').catalogueBeforeC1(C);
  const digest=crypto.createHash('sha256'),styles=new Set();
  for(const duration of DURATIONS)for(const difficulty of ['easy','hard'])for(const key of ['bodyweight','limited','broad'])for(const seed of [1,2,3,4])
    digest.update(JSON.stringify(detail(generate(STRENGTH,{duration,difficulty,equipment:EQUIPMENT[key],random:rng(seed*977+duration),workoutFamilyVersion:1,catalogue:snapshotCatalogue}))));
  assert.equal(digest.digest('hex'),'cd67bb713ab222f10e30b58f9b338bb04ff88239e4e5e1b751ddbd8da4e930bd','published Strength & Control v1 compositions are unchanged');
  for(const duration of [30,45])for(const key of ['limited','broad'])for(let seed=1;seed<=12;seed++) {
    const w=generate(STRENGTH,{duration,equipment:EQUIPMENT[key],random:rng(seed*61+duration),workoutFamilyVersion:2}),context={catalogue:C,equipment:EQUIPMENT[key]};
    styles.add(w.familyStyleId);assertSession(w,STRENGTH,{duration,difficulty:'normal',equipment:EQUIPMENT[key],version:2});
    assert.equal(G.validateFamilyWorkout(w,context).valid,true);
    // v1 and v2 share one quality gate: a saved v1 workout validates as released.
    assert.equal(G.validateFamilyWorkout({...copy(w),workoutFamilyVersion:1},context).valid,true);
  }
  assert.deepEqual([...styles].sort(),['controlled-circuits','paired-sets','straight-sets']);
});

test('new Strength & Control workouts use v2 (standalone and Coach family plans) while v1 stays published and pinned records keep it',()=>{
  assert.equal(F.currentVersion(STRENGTH),2);assert.equal(F.currentVersion(CARDIO),1);
  const [one,two]=[1,2].map(version=>F.getDefinition(STRENGTH,version));
  assert.equal(F.getDefinition(STRENGTH),one,'the default lookup stays v1');
  assert.deepEqual({...copy(two),version:1,compositionPolicy:one.compositionPolicy},copy(one),'v2 is the same family: only the composition policy differs');
  assert.deepEqual(copy(two.compositionPolicy),{id:STRENGTH,version:2});
  assert.throws(()=>G.registerFamilyComposer(STRENGTH,2,()=>({}),()=>[]),/once per published policy/);
  assert.equal(generate(STRENGTH,{}).workoutFamilyVersion,1,'an explicit family request without a version composes v1');
  const app=loadAppContext(new Map());
  app.input=STRENGTH;vm.runInContext('selectGeneratorFamily(input);generateWorkout()',app);
  const delivered=vm.runInContext('generatorState.workout',app);
  assert.equal(delivered.workoutFamilyId,STRENGTH);assert.equal(delivered.workoutFamilyVersion,2);
  assert.equal(app.GarageFitGenerator.validateFamilyWorkout(delivered,{catalogue:app.GarageFitData.exercises,equipment:vm.runInContext('state.ownedEquipment',app)}).valid,true);
});

test('composer loads after the Generator in the application shell',()=>{
  assert.match(fs.readFileSync('index.html','utf8'),/js\/generator.js[\s\S]*js\/athletic-composer.js[\s\S]*js\/strength-cardio-composer.js/);
});

test('[Full] five durations × three difficulties × three equipment sets × four seeds per family (Strength & Control v1 and v2, Cardio v1) build valid sessions',()=>{
  const SEEDS=[1,31,733,2026];let sessions=0;
  for(const [family,version] of [[STRENGTH,1],[STRENGTH,2],[CARDIO,1]])for(const duration of DURATIONS)for(const difficulty of DIFFICULTIES)for(const key of Object.keys(EQUIPMENT))for(const seed of SEEDS) {
    const equipment=EQUIPMENT[key];let w;
    try{w=generate(family,{duration,difficulty,equipment,random:rng(seed*977+duration),workoutFamilyVersion:version});}
    catch(error){assert.fail('Unexpected infeasibility '+family+' '+duration+' '+difficulty+' '+key+' '+seed+': '+error.message);}
    sessions++;assertSession(w,family,{duration,difficulty,equipment,version});
  }
  assert.equal(sessions,3*5*3*3*4);
});

// #255: shared Athletic additions reach the families they suit, and family-only drills reach none of them.
test('shared single-leg and stepping drills reach Strength and Cardio (and legacy/Full-Body); family-only Athletic drills never do',()=>{
  const SHARED=['single-leg-hip-hinge-reach','lateral-lunge-to-balance','in-in-out-out-steps'];
  const FAMILY_ONLY=['lateral-line-steps','split-stance-step-switches','clock-step-balance','180-degree-step-turns','lateral-shuffle-and-stop',
    'forward-back-acceleration-and-stop','forward-hop-and-stick','lateral-bound-and-stick'];
  const seen={};
  const note=(label,w)=>{for(const ex of exercisesOf(w)){if(FAMILY_ONLY.includes(ex.id))assert.fail(label+' selected family-only '+ex.id);if(SHARED.includes(ex.id))(seen[label]=seen[label]||new Set()).add(ex.id);}};
  for(const duration of [20,45])for(let seed=1;seed<=12;seed++) {
    for(const family of [STRENGTH,CARDIO,'full-body-challenges','core-stability'])
      note(family,G.generate({workoutFamilyId:family,duration,difficulty:'normal',catalogue:C,equipment:[],random:rng(seed*97+duration)}));
    for(const focus of ['strength'])note('legacy',G.generate({duration,focus,catalogue:C,equipment:[],random:rng(seed*131+duration)}));
  }
  assert.deepEqual([...seen[STRENGTH]].filter(id=>id!=='in-in-out-out-steps').sort(),['lateral-lunge-to-balance','single-leg-hip-hinge-reach'],'Strength & Control: controlled single-leg and lateral work');
  assert.ok(!seen[STRENGTH].has('in-in-out-out-steps'),'conditioning footwork is not controlled resistance work');
  assert.ok(seen[CARDIO]&&seen[CARDIO].has('in-in-out-out-steps'),'Cardio & Conditioning: light conditioning footwork');
  assert.ok(![...seen[CARDIO]].some(id=>id!=='in-in-out-out-steps'),'strength-led drills are not cardio-led');
  assert.ok(!(seen['core-stability']||new Set()).size,'Core & Stability stays trunk-led');
  assert.ok(seen.legacy.has('single-leg-hip-hinge-reach'));
});

// Strength catalogue S1 (#274): bounded full-catalogue routes and safety.
require('../js/coach-model');
const S1_IDS=['single-leg-glute-bridge','hand-release-push-up','wall-push-up','reverse-nordic','side-lying-hip-adduction',
  'prone-swimmer-raise','dumbbell-suitcase-march','dumbbell-half-kneeling-press','dumbbell-lateral-lunge','ring-scapular-row','dumbbell-staggered-stance-row'];
const s1Random=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
const s1Main=w=>w.main.blocks.flatMap(b=>b.exercises);
const s1Generate=(family,kit,duration,bodyFocus,seed,difficulty='hard')=>G.generate({catalogue:C,equipment:kit,duration,bodyFocus,difficulty,focus:'strength',
  ...(family?{workoutFamilyId:family,workoutFamilyVersion:family==='strength-control'?2:1}:{}),random:s1Random(seed)});

test('S1 adds distinct Main identities with conservative protocols and coherent equipment variants',()=>{
  assert.deepEqual(G.validateCatalogue(C),[]);
  for(const id of S1_IDS){
    const ex=C[id];assert.ok(ex.generator&&ex.main,id);
    assert.equal(ex.conditioning,false,id);assert.equal(ex.warmup||ex.rampup||ex.cooldown,false,id);
    assert.deepEqual(ex.mainProtocols,['rounds','paired_sets'],id);
    assert.equal(G.protocolCompatible(ex,'timed_intervals'),false,id);
    for(const protocol of ['emom','density','amrap'])assert.equal(G.protocolCompatible(ex,protocol),false,id+' '+protocol);
    assert.equal(G.generatedPhaseEligible(ex,'main',ex.equipment.flat(),'easy'),id!=='reverse-nordic',id);
  }
  assert.equal(C['trx-assisted-push-up'],undefined);
  assert.equal(C['kettlebell-goblet-reverse-lunge'],undefined);
  assert.match(C['trx-chest-press'].instruction,/upright to ease/);
  assert.match(C['kettlebell-reverse-lunge'].instruction,/at your chest/);
  assert.match(C['single-arm-dumbbell-row'].instruction,/free hand on your thigh/);
  assert.match(C['dumbbell-staggered-stance-row'].instruction,/free hand off your thigh/);
  assert.equal(C['single-arm-dumbbell-row'].repetitionClass,C['dumbbell-staggered-stance-row'].repetitionClass);
  const db=C['dumbbell-suitcase-march'],kb=C['kettlebell-suitcase-march'];
  assert.ok(G.sameFamily(db,kb));assert.equal(db.repetitionClass,kb.repetitionClass);
  assert.ok(G.recentUsePenalty(db,[[kb.id]],C)>0);
  assert.equal(db.estimatedSeconds,40);assert.equal(kb.estimatedSeconds,40);
  assert.match(db.instruction,/on the spot/);
});

test('Reverse Nordic remains controlled low-rep work outside every challenge and fatigue-clock protocol',()=>{
  const ex=C['reverse-nordic'];
  assert.deepEqual(ex.prescription,{type:'reps',value:5});assert.deepEqual(ex.prescriptionModes,['reps']);
  assert.equal(ex.difficulty,'hard');assert.equal(ex.strength,5);assert.equal(ex.mainRole,'supporting');
  assert.deepEqual(ex.patterns,[],'isolated knee extension is not a squat, hinge or lunge');
  assert.match(ex.instruction,/small pain-free range/);
  for(const protocol of ['timed_intervals','emom','ladder','pyramid','complex','density','amrap'])assert.equal(G.protocolCompatible(ex,protocol),false,protocol);
  // Full-Body rounds additionally excludes strength 5. Other four styles use
  // the shared protocol predicates above, so none can rush or ramp this dose.
  assert.ok(!(ex.load!=='Heavy'&&ex.strength<5));
  const rx=require('./helpers/coach-fixtures').prescription({equipment:[],difficulty:'hard',movementPriorities:[],requiredAnchors:[
    require('./helpers/coach-fixtures').anchor({exerciseId:ex.id,target:{type:'timed',minSeconds:20,maxSeconds:20},prescriptionMode:'time'})]});
  assert.equal(G.assessSessionPrescription({catalogue:C,sessionPrescription:rx}).status,'infeasible');
});

test('S1 unilateral prescriptions play both sides once with correct total estimates',()=>{
  const app=loadAppContext();
  for(const id of S1_IDS.filter(id=>C[id].sidedness==='per-side')){
    const ex=C[id];assert.match(ex.prescription.type,/^unilateral-/);
    const phases=JSON.parse(JSON.stringify(app.makeGeneratedExercisePhases(ex,'main',null,0).map(p=>[p.side,p.seconds,p.timed])));
    if(ex.prescription.type==='unilateral-timed')assert.deepEqual(phases,[['right',20,true],['left',20,true]],id);
    else {assert.deepEqual(phases,[['right',null,false],['left',null,false]],id);assert.ok(ex.estimatedSeconds>=ex.prescription.value*2*2.5+5,id);}
  }
});

// One real full-catalogue draw per addition, retaining rare supporting selection
// without duplicating the exhaustive audit's distribution sweep.
test('every S1 addition is selected by the standalone Generator in a suitable configuration',()=>{
  for(const [id,kit,duration,focus,seed] of [
    ['single-leg-glute-bridge',[],30,'lower',1],['hand-release-push-up',['rings'],30,'upper',1],
    ['wall-push-up',[],30,'upper',5],['reverse-nordic',[],30,'upper',1],
    ['side-lying-hip-adduction',[],45,'lower',2],['prone-swimmer-raise',['kettlebell'],30,'lower',1],
    ['dumbbell-suitcase-march',['dumbbells'],45,'core',2],['dumbbell-half-kneeling-press',['dumbbells'],30,'upper',1],
    ['dumbbell-lateral-lunge',['dumbbells'],30,'lower',1],['ring-scapular-row',['rings'],45,'upper',42],
    ['dumbbell-staggered-stance-row',['dumbbells'],45,'upper',4]
  ]){
    const w=s1Generate(null,kit,duration,focus,seed);assert.ok(s1Main(w).some(e=>e.id===id),id);
    assert.deepEqual(G.validateMain(w.main,C,kit),[],id);
  }
});

test('S1 Strength v2 and deliberate secondary-family routes preserve shared quality gates',()=>{
  for(const [family,id,kit,duration,focus,seed,difficulty] of [
    ['strength-control','single-leg-glute-bridge',[],30,'upper',1],
    ['strength-control','hand-release-push-up',[],30,'upper',1],
    ['strength-control','prone-swimmer-raise',[],30,'upper',1],
    ['strength-control','reverse-nordic',[],30,'lower',1],
    ['strength-control','wall-push-up',['kettlebell'],30,'upper',1],
    ['strength-control','side-lying-hip-adduction',['rings'],30,'core',9],
    ['strength-control','dumbbell-suitcase-march',['dumbbells'],30,'upper',3],
    ['strength-control','dumbbell-lateral-lunge',['dumbbells'],30,'upper',3],
    ['strength-control','dumbbell-half-kneeling-press',['dumbbells'],45,'upper',6],
    ['strength-control','dumbbell-staggered-stance-row',['dumbbells'],30,'core',3],
    ['strength-control','ring-scapular-row',['rings'],45,'upper',50,'easy'],
    ['core-stability','dumbbell-suitcase-march',['dumbbells'],30,'core',1],
    ['full-body-challenges','hand-release-push-up',[],30,'upper',1],
    ['full-body-challenges','wall-push-up',[],30,'upper',3],
    ['full-body-challenges','prone-swimmer-raise',[],30,'upper',3],
    ['full-body-challenges','dumbbell-suitcase-march',['dumbbells'],45,'upper',66]
  ]){
    const w=s1Generate(family,kit,duration,focus,seed,difficulty);assert.ok(s1Main(w).some(e=>e.id===id),family+' '+id);
    assert.equal(G.validateFamilyWorkout(w,{catalogue:C,equipment:kit}).valid,true,id);
    if(family==='core-stability')assert.equal(w.familyStyleId,'dynamic-core');
  }
});

test('new resistance work reaches all four Coach routes while programme anchors and reviewed memberships stay pinned',async()=>{
  const {pilot}=require('./helpers/coach-pilot');
  for(const [id,version,expected,anchors] of [
    ['general-strength-4w',2,'dumbbell-staggered-stance-row',['goblet-squat','dumbbell-floor-press','dumbbell-bent-over-row']],
    ['build-arms',1,'dumbbell-staggered-stance-row',['dumbbell-biceps-curl','dumbbell-overhead-triceps-extension']],
    ['tennis-conditioning',8,'dumbbell-half-kneeling-press',['dumbbell-reverse-lunge','dumbbell-romanian-deadlift','dumbbell-floor-press','dumbbell-bent-over-row']],
    ['general-fitness',2,'dumbbell-half-kneeling-press',[]]
  ]){
    const p=pilot(new Map(),id,version);
    p.run("pilotOptions.equipment=['dumbbells','bands','bench'];pilotOptions.duration=45;pilotOptions.bodyFocus='upper';");await p.start();
    assert.deepEqual(p.json('pilot.snapshot().state.anchors.map(a=>a.exerciseId)'),anchors,id);
    p.run('let s1Seed=1;Math.random=()=>{s1Seed=(s1Seed*1664525+1013904223)>>>0;return s1Seed/4294967296;};pilot.prepare(pilotOptions);');
    const w=p.json('pilot.snapshot().preview.workout');assert.ok(s1Main(w).some(e=>e.id===expected),id);
    for(const anchor of p.json('(pilot.snapshot().preview.plan.prescription.requiredAnchors||[])'))assert.ok(s1Main(w).some(e=>e.id===anchor.exerciseId));
    const sport=p.app.GarageFitSportCoverage.createPolicy(p.app.GarageFitData.sportCapabilityPolicies.tennis[4],p.app.GarageFitData.exercises);
    for(const exerciseId of S1_IDS){
      assert.equal(sport.classifyExercise(exerciseId).status,'unmapped',exerciseId);
      for(const [family,version,roles] of [['athletic-movement',4,['footwork','control','integrated']],['mobility-movement-quality',2,['prep','focused','flow','finish']]])
        for(const role of roles)assert.equal(p.app.GarageFitWorkoutFamilies.getMembership({workoutFamilyId:family,workoutFamilyVersion:version,role},exerciseId),null);
    }
  }
});

// Existing candidates retain rare real routes rather than receiving blanket
// role promotion or a larger supporting-route probability.
test('reviewed existing resistance accessories and unilateral work remain selectable',()=>{
  for(const [family,id,kit,duration,focus,seed,difficulty] of [
    [null,'ring-face-pull',['rings'],30,'upper',73],
    ['strength-control','ring-biceps-curl',['rings'],30,'core',37],
    ['strength-control','ring-triceps-extension',['rings'],45,'upper',2,'easy'],
    [null,'dumbbell-plank-pull-through',['dumbbells'],45,'core',16],
    [null,'kettlebell-rack-march',['kettlebell'],30,'core',1],
    [null,'kettlebell-single-leg-deadlift',['kettlebell'],45,'upper',6],
    [null,'kettlebell-suitcase-deadlift',['kettlebell'],30,'lower',1],
    ['strength-control','dumbbell-split-squat',['dumbbells'],30,'lower',3],
    [null,'single-arm-dumbbell-floor-press',['dumbbells'],45,'lower',2],
    [null,'kettlebell-half-kneeling-press',['kettlebell'],30,'upper',1]
  ]){
    const w=s1Generate(family,kit,duration,focus,seed,difficulty);
    assert.ok(s1Main(w).some(ex=>ex.id===id),id);
    assert.deepEqual(G.validateMain(w.main,C,kit),[],id);
    if(C[id].mainRole==='supporting')assert.equal(s1Main(w).filter(ex=>ex.id===id).length,1,id);
  }
});
