const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
global.window=global;
for(const file of ['data/equipment','data/exercises','data/workout-families','js/workout-families','js/generator','data/mobility-membership',
  'data/athletic-membership','js/mobility-composer','js/athletic-composer','js/strength-cardio-composer','js/core-challenge-composer'])require('../'+file);
const G=GarageFitGenerator,F=GarageFitWorkoutFamilies,C=GarageFitData.exercises;
const copy=value=>JSON.parse(JSON.stringify(value));
function rng(seed){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const EQUIPMENT={bodyweight:[],limited:['dumbbells'],broad:['dumbbells','kettlebell','pullup-bar','trx','rings','barbell','bench','box','bands']};
// The gate protects what new workouts use: each family's current published version (Athletic v2, #244).
const generate=(workoutFamilyId,extra={})=>G.generate({workoutFamilyId,workoutFamilyVersion:F.currentVersion(workoutFamilyId),duration:20,difficulty:'normal',catalogue:C,equipment:[],random:rng(7),...extra});
const validate=(workout,equipment=[])=>G.validateFamilyWorkout(workout,{catalogue:C,equipment});
const infeasible=(fn)=>{
  let caught;
  assert.throws(fn,error=>{caught=error;return error instanceof F.FamilyContractError&&error.code==='family-not-feasible';});
  return caught;
};
const exercisesOf=workout=>workout.main.blocks.flatMap(block=>block.exercises);

test('every accepted family workout passes the shared technical gate and its family quality rules first time',()=>{
  for(const workoutFamilyId of F.FAMILY_IDS)for(const [duration,difficulty,equipment] of [[10,'easy','bodyweight'],[20,'normal','limited'],[45,'hard','broad']]) {
    const w=generate(workoutFamilyId,{duration,difficulty,equipment:EQUIPMENT[equipment],random:rng(duration*3+1)});
    const result=validate(w,EQUIPMENT[equipment]);
    assert.deepEqual(result,{valid:true,technicalIssues:[],qualityIssues:[]},workoutFamilyId+' '+duration);
    assert.equal(w.workoutFamilyId,workoutFamilyId);
    // The preferred style passed: no fallback diagnostics and the label is the composer's own style.
    assert.equal(w.familyDiagnostics,undefined);
    assert.ok(F.getDefinition(workoutFamilyId).styles.some(style=>style.id===w.familyStyleId));
  }
});

test('the gate rejects edits that keep a label but lose the family: Mobility weight circuit, lift-dominated Athletic',()=>{
  const mobility=generate('mobility-movement-quality',{equipment:EQUIPMENT.limited});
  // A dumbbell lift inside a Mobility phase is not an approved member of that phase.
  const loaded=copy(mobility);loaded.main.blocks[1].exercises[0]=copy(C['goblet-squat']);
  assert.ok(validate(loaded,EQUIPMENT.limited).technicalIssues.some(issue=>issue.includes('family:ineligible:goblet-squat')));
  // Replacing the whole Main with an ordinary weight circuit is technically playable, but it is not Mobility.
  const circuit=copy(mobility);
  circuit.main.blocks=[{id:'main-1',protocol:'rounds',intent:'strength',exercises:[copy(C['goblet-squat']),copy(C['dumbbell-romanian-deadlift']),copy(C['push-up'])],
    prescription:{rounds:3,exerciseRestSeconds:20,roundRestSeconds:60}}];
  G.normaliseWorkout(circuit);
  const result=validate(circuit,EQUIPMENT.limited);
  assert.equal(result.valid,false);
  assert.ok(result.qualityIssues.includes('quality:phase-structure'));

  const athletic=generate('athletic-movement',{equipment:EQUIPMENT.limited});
  const lifts=copy(athletic);
  lifts.main.blocks=['goblet-squat','dumbbell-deadlift','dumbbell-romanian-deadlift'].map((id,index)=>({id:'main-'+(index+1),protocol:'rounds',intent:'strength',
    exercises:[copy(C[id])],prescription:{rounds:3,exerciseRestSeconds:0,roundRestSeconds:90}}));
  G.normaliseWorkout(lifts);
  assert.ok(validate(lifts,EQUIPMENT.limited).qualityIssues.includes('quality:phase-structure'));
});

test('the Athletic gate rejects near-duplicate blocks session-wide while allowing deliberate repetition within a drill',()=>{
  const athletic=generate('athletic-movement',{duration:30,workoutFamilyVersion:3}),blocks=athletic.main.blocks;
  assert.deepEqual(validate(athletic),{valid:true,technicalIssues:[],qualityIssues:[]});
  assert.ok(blocks.some(block=>block.prescription.rounds>1),'repetition within a drill is normal practice');
  // A misleading regression: the balance/control block quietly replays the footwork circuit's stepping drills
  // around the balance anchor (same sidedness, so every target, recovery and the timeline still reconcile).
  const footwork=blocks.find(block=>/^athletic-footwork-/.test(block.id)),[first]=blocks.filter(block=>/^athletic-control-/.test(block.id));
  assert.equal(blocks.filter(block=>/^athletic-control-/.test(block.id)).length,1,'a spent partner pool is consolidated, not relabelled');
  const replay=copy(athletic),target=replay.main.blocks.find(block=>block.id===first.id);
  target.exercises=[C['forward-back-line-steps'],C['single-leg-balance-reach'],C['quarter-turn-pivot-steps']].map(copy);G.normaliseWorkout(replay);
  const result=validate(replay);
  assert.deepEqual(result.technicalIssues,[],'technically playable');
  assert.deepEqual(result.qualityIssues,['quality:redundant-block:'+first.id],'each block was valid alone; the session is not');
  // A reordered copy is still nothing new; so is a renamed or out-of-order stage.
  target.exercises.reverse();G.normaliseWorkout(replay);
  assert.ok(validate(replay).qualityIssues.includes('quality:redundant-block:'+first.id));
  assert.ok(footwork&&footwork.exercises.every(ex=>ex.id!=='single-leg-balance-reach'));
  const renamed=copy(athletic);renamed.main.blocks[1].id='athletic-control-2';
  assert.ok(validate(renamed).qualityIssues.some(issue=>issue.startsWith('quality:stage-identity')));
  const reordered=copy(athletic),[a,b]=[1,2];[reordered.main.blocks[a],reordered.main.blocks[b]]=[reordered.main.blocks[b],reordered.main.blocks[a]];
  assert.ok(validate(reordered).qualityIssues.includes('quality:stage-order'));
  // A control block without single-leg balance is footwork wearing a control label.
  const unbalanced=copy(athletic),control=unbalanced.main.blocks.find(block=>block.id===first.id);
  control.exercises=control.exercises.map(ex=>ex.id==='single-leg-balance-reach'?copy(C['lateral-step-and-stick']):ex);
  assert.ok(validate(unbalanced).qualityIssues.includes('quality:control-without-single-leg:'+first.id));
  // Preview swaps go through the same gate and so can never create a redundant block.
  const swapped=copy(athletic);
  for(let index=0;index<swapped.main.blocks.length;index++)for(let exercise=0;exercise<swapped.main.blocks[index].exercises.length;exercise++)
    G.swap(swapped,index,exercise,{catalogue:C,equipment:[],random:rng(index*7+exercise)});
  assert.deepEqual(validate(swapped),{valid:true,technicalIssues:[],qualityIssues:[]});
});

test('the gate checks family identity, constraints and the recomputed timeline of every family',()=>{
  // Strength & Control: a conditioning movement is not controlled resistance work.
  const strength=generate('strength-control',{equipment:EQUIPMENT.limited,bodyPositions:['standing','floor']});
  assert.deepEqual(strength.familyConstraints,{bodyPositions:['standing','floor']});
  const burpee=copy(strength);burpee.main.blocks[0].exercises[0]=copy(C.burpees);
  G.normaliseWorkout(burpee);
  const issues=validate(burpee,EQUIPMENT.limited);
  assert.ok(issues.qualityIssues.includes('quality:unsuitable-exercise:burpees'));
  assert.ok(issues.technicalIssues.some(issue=>issue.endsWith('excluded-position:burpees')),'a mixed-position movement breaks the request');
  // Stale numbers: editing a dose without recomputing the session estimate cannot pass.
  const stale=copy(strength),block=stale.main.blocks[0];
  if(block.protocol==='paired_sets')block.prescription.sets+=1;else block.prescription.rounds+=1;
  assert.ok(validate(stale,EQUIPMENT.limited).technicalIssues.includes('timeline:estimate-mismatch'));
  // Equipment is never assumed: a dumbbell session is not valid for a bodyweight-only user.
  if(exercisesOf(strength).some(ex=>ex.equipment.length))assert.equal(validate(strength,[]).valid,false);
  // An exercise copy with edited metadata is not the canonical exercise.
  const modified=copy(strength);modified.main.blocks[0].exercises[0].impact='low';modified.main.blocks[0].exercises[0].strength=5;
  assert.ok(validate(modified,EQUIPMENT.limited).technicalIssues.some(issue=>issue.includes('modified-exercise')));

  const core=generate('core-stability',{equipment:EQUIPMENT.limited});
  const squat=copy(core);squat.main.blocks[0].exercises[0]=copy(C['goblet-squat']);G.normaliseWorkout(squat);
  assert.ok(validate(squat,EQUIPMENT.limited).qualityIssues.includes('quality:unsuitable-exercise:goblet-squat'));

  const cardio=generate('cardio-conditioning');
  const relabelled={...copy(cardio),workoutFamilyId:'strength-control',familyStyleId:'straight-sets'};
  assert.equal(validate(relabelled).valid,false,'a Cardio session cannot be relabelled Strength & Control');
  assert.ok(validate({...copy(cardio),familyStyleId:'invented'}).technicalIssues.includes('identity:unsupported-family-style'));
});

test('Preview swaps revalidate the whole workout and keep each family label honest',()=>{
  for(const workoutFamilyId of F.FAMILY_IDS) {
    const equipment=EQUIPMENT.limited,w=generate(workoutFamilyId,{equipment,random:rng(11)});
    for(let index=0;index<3;index++) {
      const blockIndex=index%w.main.blocks.length,block=w.main.blocks[blockIndex];
      G.swap(w,blockIndex,index%block.exercises.length,{catalogue:C,equipment,random:rng(index+3)});
      assert.deepEqual(validate(w,equipment),{valid:true,technicalIssues:[],qualityIssues:[]},workoutFamilyId+' swap '+index);
      assert.equal(w.workoutFamilyId,workoutFamilyId);
    }
    if(w.warmup.exercises.length) {
      G.swapPreparation(w,'warmup',0,{catalogue:C,equipment,random:rng(5)});
      assert.ok(validate(w,equipment).valid,workoutFamilyId+' preparation swap');
    }
  }
  // Generic Main eligibility would offer conditioning work to a Strength slot; the family gate does not.
  const w=generate('strength-control',{equipment:EQUIPMENT.limited,random:rng(3)});
  const protocol=w.main.blocks[0].protocol;
  assert.ok(Object.values(C).some(ex=>G.generatedPhaseEligible(ex,'main',EQUIPMENT.limited,'normal')&&G.protocolCompatible(ex,protocol)&&ex.cardio>ex.strength));
  for(let seed=1;seed<=6;seed++) {
    G.swap(w,0,0,{catalogue:C,equipment:EQUIPMENT.limited,random:rng(seed)});
    const ex=w.main.blocks[0].exercises[0];
    assert.ok(ex.strength>=2&&ex.strength>=ex.cardio&&!ex.conditioning&&ex.impact!=='high',ex.id);
  }
  // Strength & Control v2 (#261): a session whose supporting route closes a later block swaps and edits through the same gate.
  let routed=null;
  for(let seed=1;seed<=60&&!routed;seed++) {
    const candidate=generate('strength-control',{duration:45,equipment:EQUIPMENT.limited,random:rng(seed)});
    if(candidate.main.blocks.slice(1).some(b=>b.exercises.at(-1).mainRole==='supporting'))routed=candidate;
  }
  assert.ok(routed&&routed.workoutFamilyVersion===2&&validate(routed,EQUIPMENT.limited).valid,'a v2 supporting-route session passes the gate');
  const blockIndex=routed.main.blocks.findIndex((b,i)=>i&&b.exercises.at(-1).mainRole==='supporting'),slot=routed.main.blocks[blockIndex].exercises.length-1;
  for(let seed=1;seed<=6;seed++) {
    G.swap(routed,blockIndex,slot,{catalogue:C,equipment:EQUIPMENT.limited,random:rng(seed)});
    const ex=routed.main.blocks[blockIndex].exercises[slot];
    assert.ok(ex.strength>=2&&ex.strength>=ex.cardio&&!ex.conditioning&&ex.impact!=='high',ex.id);
    assert.ok(validate(routed,EQUIPMENT.limited).valid,'swap '+seed);
  }
  const conditioning=Object.values(C).find(ex=>ex.conditioning&&G.generatedPhaseEligible(ex,'main',EQUIPMENT.limited,'normal')&&G.protocolCompatible(ex,routed.main.blocks[blockIndex].protocol));
  const edited=copy(routed);edited.main.blocks[blockIndex].exercises[slot]=copy(conditioning);
  assert.ok(validate(edited,EQUIPMENT.limited).qualityIssues.some(issue=>issue.includes('unsuitable-exercise:'+conditioning.id)),'an edit cannot bypass family suitability');
});

test('explicit family safety constraints cover preparation and cooldown, including preparation swaps',()=>{
  for(const constraints of [{excludedImpact:['medium','high']},{excludedImpact:['high'],bodyPositions:['standing']}]) {
    for(const family of ['strength-control','cardio-conditioning']) {
      const w=generate(family,{...constraints,random:()=>0.4});
      const check=()=>{
        assert.equal(validate(w).valid,true);
        for(const section of ['warmup','rampup','cooldown'])for(const ex of w[section].exercises) {
          assert.equal(constraints.excludedImpact.includes(ex.impact),false,section+': '+ex.id);
          if(constraints.bodyPositions)assert.ok(constraints.bodyPositions.includes(ex.bodyPosition),section+': '+ex.id);
        }
      };
      check();
      const omitted=copy(w);omitted.rampup.exercises=[];
      assert.ok(validate(omitted).technicalIssues.includes('rampup:missing-exercises'),'constraints cannot be satisfied by silently dropping preparation');
      for(const section of ['warmup','rampup'])for(let seed=1;seed<=3;seed++) {
        G.swapPreparation(w,section,0,{catalogue:C,equipment:[],random:rng(seed)});check();
      }
      const high=copy(w);high.rampup.exercises[0]=copy(C['skater-jumps']);
      assert.ok(validate(high).technicalIssues.includes('rampup:excluded-impact:skater-jumps'));
      if(constraints.bodyPositions) {
        const floor=copy(w);floor.cooldown.exercises[0]=copy(C['childs-pose']);
        assert.ok(validate(floor).technicalIssues.includes('cooldown:excluded-position:childs-pose'));
      }
    }
  }
  // C1 supplies legitimate floor preparation; Main and all preparation now fit.
  const floorCore=generate('core-stability',{bodyPositions:['floor']});
  assert.equal(validate(floorCore).valid,true);
  for(const section of ['warmup','rampup','cooldown'])
    assert.ok(floorCore[section].exercises.every(ex=>ex.bodyPosition==='floor'));
});

test('an infeasible manual family request returns verified reasons and adjustments, never another family',()=>{
  const athletic=infeasible(()=>generate('athletic-movement',{bodyPositions:['floor']}));
  assert.equal(athletic.workoutFamilyId,'athletic-movement');
  assert.deepEqual(athletic.reasons.map(reason=>[reason.code,reason.role]),[['insufficient-eligible-movements','footwork']]);
  assert.deepEqual(athletic.adjustments.map(item=>item.code),['remove-body-position-restriction']);
  // The verified adjustment really composes a valid session of the same family.
  const adjusted=generate('athletic-movement',{random:rng(2)});
  assert.equal(adjusted.workoutFamilyId,'athletic-movement');assert.ok(validate(adjusted).valid);

  // Limited space plus low-impact only: travelling drills need confirmed room. High impact is never proposed.
  const space=infeasible(()=>generate('athletic-movement',{difficulty:'hard',excludedImpact:['medium','high']}));
  assert.deepEqual(space.reasons.map(reason=>reason.code),['insufficient-eligible-movements']);
  assert.deepEqual(space.adjustments.map(item=>item.code).sort(),['confirm-movement-room','reduce-impact-exclusions']);
  assert.deepEqual(space.adjustments.find(item=>item.code==='reduce-impact-exclusions').value,['high']);
  const room=generate('athletic-movement',{difficulty:'hard',excludedImpact:['medium','high'],movementRoom:true});
  assert.ok(exercisesOf(room).every(ex=>ex.impact==='low')&&validate(room).valid);

  // Short budget: the shortest Cardio session cannot be built from low-impact bodyweight work on Easy.
  const short=infeasible(()=>generate('cardio-conditioning',{duration:10,difficulty:'easy',excludedImpact:['medium','high']}));
  assert.ok(short.adjustments.some(item=>item.code==='change-duration'&&item.value===15));
  for(const item of short.adjustments)assert.ok(!(item.field==='excludedImpact'&&!item.value.includes('high')));
  // Equipment is never relaxed or invented: no adjustment proposes other equipment.
  for(const error of [athletic,space,short])assert.ok(error.adjustments.every(item=>['bodyPositions','excludedImpact','movementRoom','duration','difficulty'].includes(item.field)));

  // Invalid constraints are rejected as such, not reported as infeasible.
  assert.throws(()=>generate('strength-control',{bodyPositions:['ceiling']}),error=>error.code==='invalid-family-context');
});

test('Coach replanning crosses family only explicitly, reporting the actual family and rationale',()=>{
  const options={duration:20,difficulty:'normal',catalogue:C,equipment:[],random:rng(9),excludedImpact:['medium','high']};
  const w=G.generateFamilyReplan(options,[
    {workoutFamilyId:'athletic-movement',rationale:'Priority: athletic movement this week.'},
    {workoutFamilyId:'core-stability',rationale:'Low-impact trunk control keeps the weekly priorities.'}]);
  assert.equal(w.workoutFamilyId,'core-stability');
  assert.equal(w.familyReplan.requestedWorkoutFamilyId,'athletic-movement');
  assert.equal(w.familyReplan.workoutFamilyId,'core-stability');
  assert.equal(w.familyReplan.familyStyleId,w.familyStyleId);
  assert.equal(w.familyReplan.replanned,true);
  assert.equal(w.familyReplan.rationale,'Low-impact trunk control keeps the weekly priorities.');
  assert.deepEqual(w.familyReplan.attempts.map(item=>[item.workoutFamilyId,item.reasons[0].code]),[['athletic-movement','insufficient-eligible-movements']]);
  assert.ok(validate(w).valid);
  const first=G.generateFamilyReplan({...options,bodyPositions:undefined},[{workoutFamilyId:'mobility-movement-quality',rationale:'Recovery day.'}]);
  assert.equal(first.familyReplan.replanned,false);assert.deepEqual(first.familyReplan.attempts,[]);
  for(const candidates of [[],[{workoutFamilyId:'core-stability'}],[{workoutFamilyId:'core-stability',rationale:'  '}],null])
    assert.throws(()=>G.generateFamilyReplan(options,candidates),error=>error.code==='invalid-family-replan');
  const none=infeasible(()=>G.generateFamilyReplan({...options,bodyPositions:['hanging']},[{workoutFamilyId:'mobility-movement-quality',rationale:'Recovery.'}]));
  assert.deepEqual(none.attempts.map(item=>item.workoutFamilyId),['mobility-movement-quality']);
  // A Coach prescription is still unsupported, not silently treated as infeasible.
  assert.throws(()=>G.generateFamilyReplan({...options,sessionPrescription:{}},[{workoutFamilyId:'core-stability',rationale:'x'}]),error=>error.code==='family-prescription-unsupported');
});

// Fixture composers in an isolated realm prove the shared fallback mechanism independently of production policy.
function realm() {
  const context={console};context.window=context;context.globalThis=context;vm.createContext(context);
  for(const file of ['data/equipment.js','data/exercises.js','data/workout-families.js','js/workout-families.js','js/generator.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
  return context;
}
const STYLES=['straight-sets','paired-sets','controlled-circuits'];
function fixture({reject=[],failStyle,ignoreExclusions=false}={}) {
  const app=realm(),calls=[];
  const blocks=()=>[{id:'main-1',protocol:'rounds',intent:'strength',exercises:[copy(C['push-up'])],
    prescription:{rounds:6,exerciseRestSeconds:0,roundRestSeconds:60}}];
  app.GarageFitGenerator.registerFamilyComposer('strength-control',1,(options,request,attempt)=>{
    calls.push(attempt.excludedStyleIds.slice());
    const style=ignoreExclusions?STYLES[0]:STYLES.find(id=>!attempt.excludedStyleIds.includes(id));
    if(!style){const error=new app.GarageFitWorkoutFamilies.FamilyContractError('family-not-feasible','No style left.');error.reason='no-buildable-style';throw error;}
    if(style===failStyle){const error=new app.GarageFitWorkoutFamilies.FamilyContractError('family-not-feasible','Cannot fit.');
      Object.assign(error,{reason:'phase-cannot-fit',familyStyleId:style});throw error;}
    return {familyStyleId:style,blocks:blocks()};
  },workout=>reject.includes(workout.familyStyleId)?['fixture-identity-lost']:[]);
  const run=extra=>app.GarageFitGenerator.generate({workoutFamilyId:'strength-control',duration:10,catalogue:app.GarageFitData.exercises,equipment:[],random:rng(1),...extra});
  return {app,calls,run};
}

test('a rejected preferred style falls back to another valid style of the same family, with reason codes',()=>{
  const preferred=fixture();
  assert.equal(preferred.run().familyStyleId,'straight-sets');
  assert.deepEqual(copy(preferred.calls),[[]]);

  const quality=fixture({reject:['straight-sets']}),w=quality.run();
  assert.equal(w.workoutFamilyId,'strength-control');assert.equal(w.familyStyleId,'paired-sets');
  assert.deepEqual(copy(quality.calls),[[],['straight-sets']]);
  assert.deepEqual(copy(w.familyDiagnostics).map(item=>[item.code,item.familyStyleId,item.issues]),[['style-quality-failed','straight-sets',['quality:fixture-identity-lost']]]);

  const composition=fixture({failStyle:'straight-sets'}),v=composition.run();
  assert.equal(v.familyStyleId,'paired-sets');
  assert.deepEqual(copy(v.familyDiagnostics).map(item=>[item.code,item.familyStyleId]),[['phase-cannot-fit','straight-sets']]);
});

test('fallback is bounded: one attempt per style, no loops, and no unverified recommendations',()=>{
  const all=fixture({reject:STYLES});
  let error;
  assert.throws(()=>all.run(),caught=>{error=caught;return caught.code==='family-not-feasible';});
  assert.deepEqual(copy(error.reasons).map(item=>[item.code,item.familyStyleId]),STYLES.map(id=>['style-quality-failed',id]));
  // The user's call made exactly one attempt per style; each adjustment trial is bounded the same way.
  assert.deepEqual(copy(all.calls.slice(0,3)),[[],['straight-sets'],['straight-sets','paired-sets']]);
  assert.ok(all.calls.length<=STYLES.length*(1+1+4),'bounded trials: '+all.calls.length);
  assert.deepEqual(copy(error.adjustments),[],'nothing verified, nothing recommended');

  const stuck=fixture({reject:['straight-sets'],ignoreExclusions:true});
  assert.throws(()=>stuck.run(),caught=>{error=caught;return caught.code==='family-not-feasible';});
  assert.deepEqual(copy(error.reasons).map(item=>item.code),['style-quality-failed','composer-ignored-style-exclusion']);
  assert.deepEqual(copy(stuck.calls.slice(0,2)),[[],['straight-sets']]);

  // A family must register its own quality rules; the gate fails closed without them.
  assert.throws(()=>realm().GarageFitGenerator.registerFamilyComposer('core-stability',1,()=>({})),/quality validator/);
});

test('same-family fallback carries its resolved actual style into the tracker result', async () => {
  const setup=fixture({reject:['straight-sets']}),workout=setup.run();
  for(const file of ['js/coach-model.js','js/session-tracker.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),setup.app,{filename:file});
  const tracker=setup.app.GarageFitSessionTracker.createTracker({
    source:'generator',workoutId:workout.id,...setup.app.GarageFitSessionTracker.identityFromWorkout(workout),
    clock:()=> '2026-10-01T08:00:00Z',store:{saveSessionDraft:async()=>{}},
    plannedWork:[{occurrenceId:'main:b0:r1:e0',exerciseId:'push-up',section:'main'}]});
  await tracker.start();await tracker.recordDone('main:b0:r1:e0');
  const result=await tracker.complete();
  assert.equal(result.workoutFamilyId,'strength-control');assert.equal(result.familyStyleId,'paired-sets');
  assert.notEqual(result.familyStyleId,workout.familyDiagnostics[0].familyStyleId);
});
