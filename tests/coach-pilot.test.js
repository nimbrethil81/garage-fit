const test = require('node:test');
const assert = require('node:assert/strict');

const {pilot} = require('./helpers/coach-pilot');

test('production start checks coverage, supported time, candidate eligibility and pins three stable anchors', async () => {
  const p=pilot();
  assert.equal(p.json('pilotDef').version,1);
  assert.deepEqual(p.json('pilotDef.supportedDurations'),[20,30,45]);
  assert.deepEqual(p.json('Object.keys(pilotDef.coverageTargets.patterns)'),['squat','hinge','lunge','push','pull','core','carry']);
  assert.equal(p.run('pilotEngine.assessProgrammeFeasibility(pilotDef,{equipment:[]}).status'),'infeasible');
  assert.equal(p.run('pilotEngine.assessProgrammeFeasibility(pilotDef,{equipment:["dumbbells"],duration:15}).status'),'infeasible');
  assert.equal(p.run(`pilotEngine.assessProgrammeFeasibility(pilotDef,{equipment:['dumbbells'],anchorSelections:{'anchor-push':'burpees'}}).status`),'infeasible');
  await p.start();
  assert.deepEqual(p.json("pilotEngine.assessProgrammeFeasibility(pilotDef,{equipment:['dumbbells']}).durationAssessments.map(item=>item.duration)"),[20,30,45]);
  const state=p.json('pilot.snapshot().state');
  assert.equal(state.programmeDefinitionId,'general-strength-4w'); assert.equal(state.programmeDefinitionVersion,1);
  assert.deepEqual(state.anchors.map(a=>[a.pattern,a.importance,a.currentTarget.targetSets,a.currentTarget.target.maxReps]),[['squat','required',2,6],['push','required',2,6],['pull','required',2,6]]);
  assert.ok(state.anchors.every(a=>a.selectedAt==='2026-10-01T08:00:00Z'));
  const before=p.json('pilot.snapshot().state');
  p.run('pilot.prepare(pilotOptions)');
  assert.equal(p.json('pilot.snapshot().preview.workout.prescriptionOutcome.requiredAnchorPlacements').length,3);
  assert.deepEqual(p.json('pilot.snapshot().state'),before);
  await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
  assert.deepEqual(p.json('pilot.snapshot().state'),before);
  assert.equal((await p.run('pilotStore.loadSessionDraft()')).finalisation.state,'in-progress');
  await p.finish();
  assert.equal(p.json('pilot.snapshot().results[0]').finalStatus,'abandoned');
  assert.equal(p.json('pilot.snapshot().state').meaningfulSessionsCompleted,0);
});

test('confirmed anchor actuals advance same-exercise targets; immutable completed result is applied exactly once', async () => {
  const p=pilot(); await p.start(); await p.begin();
  for(const requirement of ['anchor-squat','anchor-push','anchor-pull']) await p.log(requirement);
  const result=await p.finish('complete');
  const state=p.json('pilot.snapshot().state');
  assert.equal(result.performedWork.length,6); assert.equal(state.meaningfulSessionsCompleted,1); assert.equal(state.currentTargets.dose.exposure,6);
  assert.ok(result.performedWork.every(work=>work.sets[0].load===12));
  assert.ok(state.anchors.every(anchor=>anchor.currentTarget.target.maxReps===7 && anchor.comparisonBaseline.load===12));
  assert.deepEqual(p.json('pilotEngine.applySessionResult(pilotDef,pilot.snapshot().state,pilot.snapshot().results[0],pilot.snapshot().results)'),state);
  assert.equal(await p.run('pilotStore.loadSessionDraft()'),null);
  await p.run('pilot.load()'); assert.deepEqual(p.json('pilot.snapshot().state'),state);
  await p.begin(); assert.deepEqual(p.json('pilot.snapshot().state.anchors.map(item=>item.exerciseId)'),state.anchors.map(item=>item.exerciseId));
});

test('double progression holds misses, suggests heavier weight at 2x10 and resets only at confirmed heavier load', async () => {
  const p=pilot();await p.start();
  for(let target=6;target<=10;target++) {
    await p.begin();assert.equal(p.run("pilot.snapshot().preview.plan.prescription.requiredAnchors[0].target.maxReps"),target);
    await p.log();await p.finish();
  }
  assert.equal(p.run("pilot.snapshot().state.anchors[0].currentTarget.progressionIntent"),'Use the next heavier weight');
  await p.begin();await p.log('anchor-squat','9');await p.finish();
  assert.equal(p.run('pilot.snapshot().state.anchors[0].currentTarget.target.maxReps'),10);
  await p.begin();await p.log('anchor-squat','6','14');await p.finish();
  assert.equal(p.run('pilot.snapshot().state.anchors[0].currentTarget.target.maxReps'),6);
  assert.equal(p.run('pilot.snapshot().state.anchors[0].comparisonBaseline.load'),14);
  assert.equal(p.run('pilot.snapshot().state.anchors[0].progression.decision'),'reset-after-load');
});

test('unknown load, partial/skipped sets, Easy today and session Hard alone never advance anchors', async () => {
  const p=pilot();await p.start();await p.begin();await p.log('anchor-squat','6','null');await p.finish();
  assert.equal(p.run('pilot.snapshot().state.anchors[0].comparisonBaseline'),null);
  assert.equal(p.run('pilot.snapshot().state.anchors[0].currentTarget.target.maxReps'),6);
  assert.equal(p.json('pilot.snapshot().results[0]').performedWork[0].sets[0].load,null);
  await p.begin();
  await p.run(`pilotTracker.recordAnchor(pilotTracker.plannedWork().find(item=>item.requirementId==='anchor-squat').occurrenceId,{status:'completed',sets:[{reps:6,load:12,loadUnit:'kg',loadInterpretation:'total'}]})`);
  await p.finish();assert.equal(p.json('pilot.snapshot().results.at(-1)').finalStatus,'partial');
  assert.equal(p.run('pilot.snapshot().state.anchors[0].currentTarget.target.maxReps'),6);
  await p.begin("{...pilotOptions,easyToday:true}");await p.log();await p.finish();
  assert.equal(p.run('pilot.snapshot().state.anchors[0].currentTarget.target.maxReps'),6);
  assert.equal(p.run('pilot.snapshot().state.anchors[0].progression.decision'),'hold-easy-today');
  await p.begin();await p.run("Promise.all(pilotTracker.plannedWork().map(work=>pilotTracker.recordSkip(work.occurrenceId)))");
  const before=p.json('pilot.snapshot().state');await p.run("pilot.finish('complete',{difficulty:'hard'},600)");
  assert.equal(p.run('pilot.snapshot().state.meaningfulSessionsCompleted'),before.meaningfulSessionsCompleted);
  assert.equal(p.run('pilot.snapshot().state.anchors[0].currentTarget.target.maxReps'),6);
});

test('today-only substitution keeps the programme anchor, records actual identity and starts a new series', async () => {
  const p=pilot();await p.start();p.run('pilot.prepare(pilotOptions)');
  p.run("pilot.substitute('anchor-squat','dumbbell-front-squat')");
  assert.equal(p.run('pilot.snapshot().preview.plan.prescription.requiredAnchors[0].exerciseId'),'dumbbell-front-squat');
  assert.equal(p.run('pilot.snapshot().state.anchors[0].exerciseId'),'goblet-squat');
  await p.run('pilot.begin().then(value=>{pilotTracker=value;})');await p.log();await p.finish();
  const result=p.json('pilot.snapshot().results[0]');
  assert.ok(result.performedWork.every(work=>work.exerciseId==='dumbbell-front-squat'));
  assert.ok(result.substitutions.every(sub=>sub.fromExerciseId==='goblet-squat'&&sub.toExerciseId==='dumbbell-front-squat'));
  assert.equal(p.run('pilot.snapshot().state.anchors[0].comparisonBaseline'),null);
  assert.equal(p.run('pilot.snapshot().state.anchors[0].currentTarget.target.maxReps'),6);
  assert.equal(p.run('pilot.snapshot().state.anchors[0].latestSubstitution.decision'),'new-exercise-series');
  assert.throws(()=>p.run("pilot.substitute('anchor-squat','burpees',pilotOptions)"),/Invalid Coach/);
  await p.begin();assert.equal(p.run('pilot.snapshot().preview.plan.prescription.requiredAnchors[0].exerciseId'),'goblet-squat');
});

test('restoring and replacing anchors clears only the selected today-only override', async () => {
  const p=pilot();await p.start();p.run('pilot.prepare(pilotOptions)');
  p.run("pilot.substitute('anchor-squat','dumbbell-front-squat')");
  const original=p.json('pilot.snapshot().state.anchors');
  p.run("pilot.restore('anchor-squat')");
  assert.deepEqual(p.json('pilot.snapshot().preview.today.anchorSubstitutions'),{});
  assert.equal(p.run('pilot.snapshot().preview.plan.prescription.requiredAnchors[0].exerciseId'),'goblet-squat');
  p.run("pilot.substitute('anchor-squat','dumbbell-front-squat')");
  p.run("pilot.restore('anchor-squat')");
  assert.deepEqual(p.json('pilot.snapshot().state.anchors'),original);
  await p.run('pilot.begin().then(value=>{pilotTracker=value;})');await p.log();await p.finish();
  const result=p.json('pilot.snapshot().results[0]');
  assert.equal(result.substitutions.length,0);
  assert.equal(result.performedWork[0].exerciseId,'goblet-squat');
  assert.equal(p.run('pilot.snapshot().state.anchors[0].latestSubstitution'),undefined);
});

test('Coach preview edit mode gates actions and keeps the revised workout for playback', async () => {
  const p=pilot();p.run("state.ownedEquipment=['dumbbells']");
  await p.run("coachUI.controller.start(pilotDef,['dumbbells'])");await p.run('coachUI.open()');
  p.run(`function previewButtons(id='coachPreviewContent') { const visit=node=>[node,...(node.children||[]).flatMap(visit)]; return visit(document.getElementById(id)).filter(node=>node.onclick).map(node=>node.textContent); }
    function clickPreview(label,id='coachPreviewContent') { const visit=node=>node.textContent===label&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById(id)).onclick(); }`);
  await p.run("clickPreview('Start session','coachContent')");
  assert.equal(p.json('previewButtons()').filter(label=>label==='Edit Workout').length,1);
  assert.ok(!p.json('previewButtons()').some(label=>['Swap','Substitute'].includes(label)));
  await p.run("clickPreview('Edit Workout')");
  assert.ok(p.json('previewButtons()').includes('Substitute'));
  assert.ok(p.json('previewButtons()').includes('Swap'));
  assert.match(p.run("(function visit(node){return [node.textContent,...(node.children||[]).map(visit)].join(' ')})(document.getElementById('coachPreviewContent'))"),/just for today.*supporting exercises/);
  await p.run("clickPreview('Substitute')");
  assert.equal(p.run("document.getElementById('coachSubstitute').classList.contains('hidden')"),false);
  await p.run("clickPreview('Cancel','coachSubstituteContent')");
  assert.ok(p.json('previewButtons()').includes('Done Editing'));
  await p.run("clickPreview('Substitute')");
  await p.run("clickPreview('Dumbbell front squat','coachSubstituteContent')");
  assert.ok(p.json('previewButtons()').includes('Restore prescribed exercise'));
  assert.equal(p.run('coachUI.controller.snapshot().preview.plan.prescription.requiredAnchors[0].exerciseId'),'dumbbell-front-squat');
  await p.run("clickPreview('Restore prescribed exercise')");
  assert.equal(p.run('coachUI.controller.snapshot().preview.plan.prescription.requiredAnchors[0].exerciseId'),'goblet-squat');
  await p.run("clickPreview('Swap')");
  const revised=p.json('coachUI.controller.snapshot().preview.workout.main.blocks');
  await p.run("clickPreview('Done Editing')");
  assert.ok(!p.json('previewButtons()').some(label=>['Swap','Substitute','Restore prescribed exercise'].includes(label)));
  assert.deepEqual(p.json('coachUI.controller.snapshot().preview.workout.main.blocks'),revised);
  await p.run("clickPreview('Begin workout')");
  assert.deepEqual(p.json('generatorState.workout.main.blocks'),revised);
});

test('several equipment-blocked anchors can be resolved one at a time without relaxing hard work', async () => {
  const p=pilot();await p.start();
  assert.equal(p.run("pilot.prepare({equipment:['bands'],duration:20}).status"),'infeasible');
  assert.equal(p.run("pilot.substitute('anchor-squat','banded-squat').status"),'infeasible');
  assert.equal(p.run("pilot.substitute('anchor-push','band-chest-press').status"),'infeasible');
  p.run("pilot.substitute('anchor-pull','band-row')");
  assert.deepEqual(p.json('pilot.snapshot().preview.plan.prescription.requiredAnchors.map(anchor=>anchor.exerciseId)'),['banded-squat','band-chest-press','band-row']);
  assert.equal(p.json('pilot.snapshot().preview.workout.prescriptionOutcome.requiredAnchorPlacements').length,3);
  assert.deepEqual(p.json('pilot.snapshot().state.anchors.map(anchor=>anchor.exerciseId)'),['goblet-squat','dumbbell-floor-press','dumbbell-bent-over-row']);
});

test('short sessions keep all required work and rest; missed sessions create no debt; maintenance preserves identity', async () => {
  const p=pilot();await p.start();
  p.run("pilotNow='2026-10-20T08:00:00Z'");
  const plan=p.json('pilot.plan({...pilotOptions,duration:20})');
  assert.equal(plan.prescription.requiredAnchors.length,3);assert.ok(plan.prescription.requiredAnchors.every(a=>a.targetSets===2));
  assert.equal(plan.rationale.missedSessionResponse.catchUpSessions,0);
  assert.deepEqual(plan.prescription.programmeContext.shortSession.priorityOrder,['required-anchors','primary-objective','essential-preparation-and-rest','optional-accessories']);
  const full=p.json('pilot.prepare(pilotOptions).workout');
  const short=p.json('pilot.prepare({...pilotOptions,duration:20}).workout');
  assert.deepEqual(short.main.blocks.slice(0,3).map(b=>b.prescription),full.main.blocks.slice(0,3).map(b=>b.prescription));
  const instance=p.run('pilot.snapshot().state.programmeInstanceId');await p.run("pilot.manage('maintenance')");
  assert.equal(p.run('pilot.snapshot().state.programmeInstanceId'),instance);
  assert.ok(p.json('pilot.plan(pilotOptions).prescription.requiredAnchors').every(a=>a.targetSets===1));
  assert.equal(p.run('pilot.plan(pilotOptions).prescription.duration'),20);
  await p.begin();await p.log();await p.finish();assert.equal(p.run('pilot.snapshot().state.anchors[0].currentTarget.target.maxReps'),6);
  assert.equal(p.run('pilot.snapshot().state.anchors[0].progression.decision'),'hold-maintenance');
});

test('four-week review is non-terminal, counts the block separately and acknowledges continue without resetting history', async () => {
  const p=pilot();await p.start();
  for(let i=0;i<8;i++) {await p.begin();await p.log();await p.finish();}
  p.run("pilotNow='2026-10-29T08:00:00Z'");
  assert.equal(p.run('pilot.review().due'),true);assert.equal(p.run('pilot.review().targetMet'),true);
  assert.equal(p.run('pilot.snapshot().state.status'),'active');
  const anchors=p.json('pilot.snapshot().state.anchors');await p.run("pilot.manage('continue')");
  assert.equal(p.run('pilot.review().due'),false);assert.deepEqual(p.json('pilot.snapshot().state.anchors'),anchors);
  p.run("pilotNow='2026-11-26T08:00:00Z'");assert.equal(p.run('pilot.review().due'),true);assert.equal(p.run('pilot.review().targetMet'),false);
  await p.run("pilot.manage('finish')");assert.equal(p.run('pilot.snapshot().state.status'),'completed');
});

test('result/state write interruption and unindexed immutable evidence recover on reload without double credit', async () => {
  const p=pilot();await p.start();await p.begin();await p.log();
  p.run(`const originalSave=pilotStore.saveProgrammeState;let failState=true;pilotStore.saveProgrammeState=async value=>{if(failState)throw new Error('simulated state write');return originalSave(value);}`);
  await assert.rejects(p.finish(),/simulated state write/);
  const reopened=pilot(p.storage);await reopened.run('pilot.load()');
  assert.equal(reopened.run('pilot.snapshot().state.meaningfulSessionsCompleted'),1);
  assert.equal(await reopened.run('pilotStore.loadSessionDraft()'),null);
  await reopened.run('pilot.load()');assert.equal(reopened.run('pilot.snapshot().state.meaningfulSessionsCompleted'),1);
  const q=pilot();await q.start();await q.begin();await q.log();
  q.run(`const originalSet=localStorage.setItem;localStorage.setItem=(key,value)=>{if(key==='gf_coach_session_result_index')throw new Error('simulated index quota');return originalSet(key,value);}`);
  await assert.rejects(q.finish(),/write/);
  const retry=pilot(q.storage);await retry.run('pilot.load()');assert.equal(retry.run('pilot.snapshot().state.meaningfulSessionsCompleted'),1);
});

test('interrupted in-progress draft saves performed work after reload and clears only after state is persisted', async () => {
  const p=pilot();await p.start();await p.begin();await p.log();
  const reload=pilot(p.storage);await reload.run('pilot.load()');assert.equal(reload.json('pilot.snapshot().interruptedDraft'),null);
  assert.equal(reload.json('pilot.snapshot().results[0]').finalStatus,'partial');
  assert.equal(reload.run('pilot.snapshot().state.meaningfulSessionsCompleted'),1);
});

test('warm-up alone is abandoned without programme credit, and checkpoint failures can be retried before advancing', async () => {
  const p=pilot();await p.start();await p.begin();
  await p.run(`const prep=pilotTracker.plannedWork().find(item=>item.section==='warmup');pilotTracker.recordTimed(prep.occurrenceId,{plannedSeconds:prep.prescription.seconds,elapsedSeconds:4})`);
  await p.finish();assert.equal(p.json('pilot.snapshot().results[0]').finalStatus,'abandoned');
  assert.equal(p.run('pilot.snapshot().state.meaningfulSessionsCompleted'),0);
  await p.begin();
  p.run(`const checkpointSet=localStorage.setItem;let failCheckpoint=true;localStorage.setItem=(key,value)=>{if(failCheckpoint&&key==='gf_coach_session_draft')throw new Error('checkpoint failed');return checkpointSet(key,value);};`);
  await assert.rejects(p.run(`pilotTracker.recordDone(pilotTracker.plannedWork().find(item=>item.requirementId==='anchor-squat').occurrenceId)`),/write/);
  p.run('failCheckpoint=false');
  await p.run(`pilotTracker.recordSkip(pilotTracker.plannedWork().find(item=>item.requirementId==='anchor-squat').occurrenceId)`);
  assert.equal((await p.run('pilotStore.loadSessionDraft()')).occurrenceOutcomes.length,1);
  await p.finish();assert.equal(p.run('pilot.snapshot().state.meaningfulSessionsCompleted'),1);
});

test('Coach player Done, Skip, Previous and measured timed exit save exactly the performed occurrences', async () => {
  const p=pilot();
  p.run("state.ownedEquipment=['dumbbells']");
  await p.run("coachUI.controller.start(pilotDef,['dumbbells'])");
  await p.run('coachUI.open()');
  p.run(`function pilotButton(id,text){const visit=node=>node.textContent===text&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById(id));}`);
  await p.run("pilotButton('coachContent','Start session').onclick()");
  await p.run("pilotButton('coachPreviewContent','Begin workout').onclick()");
  assert.equal(p.run('isCoachPlayer()'),true);
  const anchors=p.json("generatorState.timeline.map((p,i)=>({p,i})).filter(({p})=>p.kind==='exercise'&&p.section==='main'&&p.exercise.coachAnchor)");
  const first=anchors[0].i,second=anchors.find(item=>item.p.exercise.id===anchors[0].p.exercise.id&&item.i!==first).i;
  p.run(`enterGeneratedPhase(${first});document.getElementById('coachActualLoad').value='12';`);
  await p.run('completeWorkoutMovement()');
  await p.run('previousGeneratedPhase()');
  assert.equal(p.run('generatorState.timelineIndex'),first);
  await p.run('completeWorkoutMovement()');
  assert.equal(p.run('generatorState.tracker.performedWork().length'),1);
  p.run(`enterGeneratedPhase(${second})`);await p.run("coachAdvance('skip')");
  assert.equal(p.run('generatorState.tracker.performedWork().length'),1);
  p.run(`const timed=generatorState.timeline.findIndex(p=>p.kind==='exercise'&&p.timed);enterGeneratedPhase(timed);generatorState.remaining=currentGeneratedPhase().seconds-4;openExitDialog('workout');`);
  await p.run('confirmExitChoice()');await p.run("coachUI.saveFeedback('hard')");
  const result=p.json('coachUI.controller.snapshot().results[0]');
  assert.equal(result.finalStatus,'partial');assert.equal(result.feedback.difficulty,'hard');
  assert.equal(result.performedWork.length,2);assert.equal(result.performedWork.find(work=>work.occurrenceId===anchors[0].p.occurrenceId).sets[0].load,12);
  assert.ok(result.performedWork.some(work=>work.sets[0].seconds===4));
  assert.equal(p.run('coachUI.controller.snapshot().state.anchors[0].currentTarget.target.maxReps'),6);
  await p.run('coachUI.open()');assert.equal(p.run('coachUI.controller.snapshot().state.meaningfulSessionsCompleted'),1);
  p.run('startWorkout()');assert.equal(p.run("document.getElementById('coachAnchorLog').classList.contains('hidden')"),true);
});
