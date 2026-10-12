const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context');

function pilot(storage = new Map()) {
  const app = loadAppContext(storage, {ownIntrinsics:true});
  const run = source => vm.runInContext(source, app);
  const json = source => JSON.parse(run(`JSON.stringify(${source})`));
  run(`
    let armsSeed=61;
    Math.random=()=>{armsSeed=(armsSeed*1664525+1013904223)>>>0;return armsSeed/4294967296;};
    const armsDef=GarageFitData.programmes['build-arms'][1];
    const armsStore=GarageFitCoachStore.createStore(localStorage);
    const armsEngine=GarageFitCoachEngine.createEngine({catalogue:CATALOGUE,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription});
    let armsNow='2026-10-12T08:00:00Z',armsId=0,armsTracker=null;
    const arms=GarageFitCoachUI.createController({store:armsStore,engine:armsEngine,catalogue:CATALOGUE,buildTimeline:buildGeneratedTimeline,
      clock:()=>armsNow,id:prefix=>prefix+':'+(++armsId)});
    const armsOptions={equipment:['dumbbells','bands','trx','bench'],duration:30};
  `);
  const start = () => run('arms.start(armsDef,armsOptions.equipment)');
  const begin = async (options='armsOptions') => {
    run(`arms.prepare(${options})`);
    await run('arms.begin().then(value=>{armsTracker=value;})');
  };
  const log = (requirement='anchor-flexion', actual={load:10,loadUnit:'kg',loadInterpretation:'per-item'}) => run(`(async()=>{
    for(const work of armsTracker.plannedWork().filter(item=>item.requirementId===${JSON.stringify(requirement)}))
      await armsTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:work.prescription.reps,...${JSON.stringify(actual)}}]});
  })()`);
  const finish = () => run("arms.finish('exit',{difficulty:'hard'},600)");
  return {app,run,json,start,begin,log,finish,storage};
}

test('approved versioned programme registers, pins exactly two direct anchors and preflights supported durations', async () => {
  const p=pilot();
  assert.ok(p.json('GarageFitCoachPolicies.createDefaultRegistry().types()').includes('build-arms'));
  const definition=p.json('armsDef');
  assert.equal(definition.openEnded,true);
  assert.deepEqual(definition.doseTargets.directElbowActions,{flexion:9,extension:9});
  assert.equal(definition.doseTargets.windowDays,7);
  assert.deepEqual(Object.values(definition.coverageTargets.patterns),[1,1,1,1,1,1,1]);
  assert.equal(definition.progressionPolicy.minReps,8); assert.equal(definition.progressionPolicy.maxReps,12);
  for (const equipment of [['bands'],['trx'],['dumbbells','bench']]) {
    const assessment=p.json(`armsEngine.assessProgrammeFeasibility(armsDef,{equipment:${JSON.stringify(equipment)}})`);
    assert.equal(assessment.status,'feasible');
    assert.deepEqual(assessment.durationAssessments.map(item=>item.duration),[20,30,45]);
  }
  await p.start();
  const state=p.json('arms.snapshot().state');
  assert.equal(state.programmeDefinitionId,'build-arms'); assert.equal(state.programmeDefinitionVersion,1);
  assert.deepEqual(state.anchors.map(a=>[a.directElbowAction,a.importance,a.role,a.currentTarget.targetSets,a.currentTarget.target.maxReps]),
    [['flexion','required','primary',3,8],['extension','required','primary',3,8]]);
  assert.equal(state.anchors[0].exerciseId,'dumbbell-biceps-curl');
  assert.ok(state.anchors.every(a=>a.currentTarget.suggestedLoad===undefined));
});

test('missing direct actions cannot be replaced by compound work; unsuitable anchors and unsupported time fail', () => {
  const p=pilot();
  for (const [equipment,missing] of [[[], 'flexion'],[['dumbbells'],'extension'],[['bench'],'flexion'],[['pullup-bar'],'extension']]) {
    const assessment=p.json(`armsEngine.assessProgrammeFeasibility(armsDef,{equipment:${JSON.stringify(equipment)}})`);
    assert.equal(assessment.status,'infeasible');
    assert.ok(assessment.conflicts.some(item=>item.directElbowAction===missing));
  }
  for (const [requirement,exercise] of [['anchor-flexion','chin-up'],['anchor-flexion','dumbbell-bent-over-row'],['anchor-extension','push-up'],['anchor-extension','dumbbell-floor-press'],['anchor-extension','chair-triceps-dips']]) {
    assert.equal(p.run(`armsEngine.assessProgrammeFeasibility(armsDef,{equipment:armsOptions.equipment,anchorSelections:{'${requirement}':'${exercise}'}}).status`),'infeasible');
  }
  assert.equal(p.run('armsEngine.assessProgrammeFeasibility(armsDef,{equipment:["bands"],duration:15}).status'),'infeasible');
  assert.equal(p.run(`(()=>{const c=JSON.parse(JSON.stringify(CATALOGUE));c['band-biceps-curl'].main=false;return GarageFitCoachEngine.createEngine({catalogue:c}).assessProgrammeFeasibility(armsDef,{equipment:['bands']}).status;})()`),'infeasible');
  assert.equal(p.run(`(()=>{const c=JSON.parse(JSON.stringify(CATALOGUE));c['band-biceps-curl'].mainProtocols=['timed_intervals'];return GarageFitCoachEngine.createEngine({catalogue:c}).assessProgrammeFeasibility(armsDef,{equipment:['bands']}).status;})()`),'infeasible');
});

test('only performed canonical direct work earns separate dose; partial reps/time are proportional and compounds remain context', async () => {
  const p=pilot(); await p.start(); await p.begin();
  await p.run(`(async()=>{
    const flex=armsTracker.plannedWork().filter(w=>w.requirementId==='anchor-flexion');
    await armsTracker.recordAnchor(flex[0].occurrenceId,{status:'completed',sets:[{reps:8}]});
    await armsTracker.recordAnchor(flex[1].occurrenceId,{status:'partial',sets:[{reps:4}]});
    await armsTracker.recordSkip(flex[2].occurrenceId);
    const extension=armsTracker.plannedWork().find(w=>w.requirementId==='anchor-extension');
    await armsTracker.recordAnchor(extension.occurrenceId,{status:'completed',sets:[{reps:8}]});
    const compound=armsTracker.plannedWork().find(w=>w.section==='main'&&!CATALOGUE[w.exerciseId].directElbowAction&&CATALOGUE[w.exerciseId].patterns.includes('pull'));
    await armsTracker.recordDone(compound.occurrenceId);
  })()`);
  await p.finish();
  const dose=p.json('arms.snapshot().state.currentTargets.dose');
  assert.deepEqual(dose.directElbowActions,{flexion:1.5,extension:1});
  assert.equal(dose.compoundContext.pull,1);
  const history=p.json(`(()=>{const h=GarageFitTrainingHistory.createHistory(arms.snapshot().results,CATALOGUE);return {flex:h.directElbowExposure('flexion'),extension:h.directElbowExposure('extension'),pull:h.compoundPatternExposure('pull')}})()`);
  assert.equal(history.flex.value,1.5); assert.equal(history.extension.value,1); assert.equal(history.pull.value,1);
  await p.begin(); await p.finish();
  assert.deepEqual(p.json('arms.snapshot().state.currentTargets.dose.directElbowActions'),dose.directElbowActions);
  assert.equal(p.run(`(()=>{const r=JSON.parse(JSON.stringify(arms.snapshot().results[0]));r.sessionResultId='timed';r.plannedWork=[{occurrenceId:'t',exerciseId:'chair-triceps-dips',section:'main',prescription:{type:'timed',seconds:30}}];r.performedWork=[{occurrenceId:'t',exerciseId:'chair-triceps-dips',status:'partial',sets:[{seconds:15}]}];return GarageFitTrainingHistory.createHistory([r],CATALOGUE).directElbowExposure('extension').value})()`),0.5);
});

test('numeric double progression requires all three comparable sets, suggests available load and resets at confirmed heavier resistance', async () => {
  const p=pilot(); await p.start();
  for(let reps=8;reps<=12;reps++) {
    await p.begin(); assert.equal(p.run('arms.snapshot().preview.plan.prescription.requiredAnchors[0].target.maxReps'),reps);
    await p.log(); await p.finish();
  }
  assert.equal(p.run('arms.snapshot().state.anchors[0].currentTarget.progressionIntent'),'Use the next heavier available load');
  await p.begin();await p.log('anchor-flexion',{reps:8,load:12,loadUnit:'kg',loadInterpretation:'per-item'});await p.finish();
  assert.equal(p.run('arms.snapshot().state.anchors[0].currentTarget.target.maxReps'),8);
  assert.equal(p.run('arms.snapshot().state.anchors[0].comparisonBaseline.load'),12);
  assert.equal(p.run('arms.snapshot().state.anchors[0].progression.decision'),'reset-after-load');
});

test('setup anchors progress only with explicit comparable confirmation and reset only after ready plus confirmed harder setup', async () => {
  const p=pilot(); await p.start();
  for(let reps=8;reps<=12;reps++) {
    await p.begin();await p.log('anchor-extension',{resistanceSetup:'initial'});await p.finish();
  }
  assert.equal(p.run('arms.snapshot().state.anchors[1].currentTarget.progressionIntent'),'Ready for more resistance');
  await p.begin();await p.log('anchor-extension',{resistanceSetup:'initial'});await p.finish();
  assert.equal(p.run('arms.snapshot().state.anchors[1].currentTarget.target.maxReps'),12);
  await p.begin();await p.log('anchor-extension',{reps:8,resistanceSetup:'harder-confirmed'});await p.finish();
  assert.equal(p.run('arms.snapshot().state.anchors[1].currentTarget.target.maxReps'),8);
  assert.equal(p.run('arms.snapshot().state.anchors[1].comparisonBaseline.resistanceSetup'),'harder-confirmed');
  await p.begin();await p.log('anchor-extension',{resistanceSetup:'unapproved-second-change'});await p.finish();
  assert.equal(p.run('arms.snapshot().state.anchors[1].currentTarget.target.maxReps'),8);
});

test('common performance comparison uses confirmed setup identity and never transfers it across exercise or resistance changes', async () => {
  const p=pilot();await p.start();
  await p.begin();await p.log('anchor-extension',{resistanceSetup:'initial'});await p.finish();
  await p.begin();await p.log('anchor-extension',{resistanceSetup:'initial'});await p.finish();
  const comparison=p.json(`(()=>{const h=GarageFitTrainingHistory.createHistory(arms.snapshot().results,CATALOGUE),s=h.exactExercisePerformances('band-triceps-extension');return GarageFitTrainingHistory.comparePerformanceEvidence(s[3],s[0]);})()`);
  assert.equal(comparison.comparable,true);assert.equal(comparison.change,'improved-reps');assert.equal(comparison.loadDelta,null);
  const changed=p.json(`(()=>{const h=GarageFitTrainingHistory.createHistory(arms.snapshot().results,CATALOGUE),s=h.exactExercisePerformances('band-triceps-extension'),c=JSON.parse(JSON.stringify(s[0]));c.sets[0].resistanceSetup='changed';return GarageFitTrainingHistory.comparePerformanceEvidence(s[3],c);})()`);
  assert.equal(changed.comparable,false);assert.equal(changed.change,'new-resistance-baseline');
});

test('misses, partial/skipped sets, unknown resistance, mismatched conditions, session feedback and Easy today do not progress', async () => {
  const p=pilot(); await p.start();
  await p.begin();await p.log('anchor-flexion',{reps:7,load:10,loadUnit:'kg',loadInterpretation:'per-item'});await p.finish();
  assert.equal(p.run('arms.snapshot().state.anchors[0].currentTarget.target.maxReps'),8);
  await p.begin();await p.log('anchor-flexion',{});await p.log('anchor-extension',{});await p.finish();
  assert.equal(p.run('arms.snapshot().state.anchors[0].currentTarget.target.maxReps'),8);
  assert.equal(p.run('arms.snapshot().state.anchors[1].currentTarget.target.maxReps'),8);
  await p.begin();await p.run(`armsTracker.recordAnchor(armsTracker.plannedWork().find(w=>w.requirementId==='anchor-flexion').occurrenceId,{status:'completed',sets:[{reps:8,load:10,loadUnit:'kg',loadInterpretation:'per-item'}]})`);await p.finish();
  assert.equal(p.run('arms.snapshot().state.anchors[0].currentTarget.target.maxReps'),8);
  await p.begin('{...armsOptions,easyToday:true}');await p.log();await p.log('anchor-extension',{resistanceSetup:'initial'});await p.finish();
  assert.equal(p.run('arms.snapshot().state.anchors[0].progression.decision'),'hold-easy-today');
  assert.equal(p.run('arms.snapshot().state.anchors[1].currentTarget.target.maxReps'),8);
  await p.begin();await p.log();await p.finish();
  assert.equal(p.run('arms.snapshot().state.anchors[0].currentTarget.target.maxReps'),9);
  await p.begin();await p.log();
  await p.run(`(()=>{const baseline=arms.snapshot().state;baseline.anchors[0].comparisonBaseline.performances.forEach(w=>{w.protocolConditions.roundRestSeconds+=1});return armsStore.saveProgrammeState(baseline)})()`);
  await p.finish();assert.equal(p.run('arms.snapshot().state.anchors[0].currentTarget.target.maxReps'),9);
});

test('supporting direct anchors survive penalties; Coach substitutes preserve action, new series, and original state', async () => {
  const p=pilot();await p.start();await p.begin();
  assert.ok(p.json('arms.snapshot().preview.workout.prescriptionOutcome.requiredAnchorPlacements').some(w=>w.exerciseId==='dumbbell-biceps-curl'));
  assert.equal(p.run("CATALOGUE['dumbbell-biceps-curl'].mainRole"),'supporting');
  await p.log();await p.finish();
  const before=p.json('arms.snapshot().state.anchors');
  for(const action of ['flexion','extension']) {
    const alternatives=p.json(`arms.alternatives('anchor-${action}',armsOptions)`);
    assert.ok(alternatives.length>1);
    assert.ok(alternatives.every(id=>p.run(`CATALOGUE['${id}'].directElbowAction`)==action));
  }
  p.run("arms.prepare(armsOptions);arms.substitute('anchor-flexion','trx-biceps-curl');arms.substitute('anchor-extension','trx-triceps-press')");
  await p.run('arms.begin().then(value=>{armsTracker=value;})');
  await p.log('anchor-flexion',{resistanceSetup:'initial'});await p.log('anchor-extension',{resistanceSetup:'initial'});await p.finish();
  const result=p.json('arms.snapshot().results.at(-1)');
  assert.equal(result.substitutions.length,6);
  assert.ok(result.performedWork.every(w=>w.exerciseId.startsWith('trx-')));
  const after=p.json('arms.snapshot().state.anchors');
  assert.deepEqual(after.map(a=>a.currentTarget),before.map(a=>a.currentTarget));
  assert.equal(after[0].latestSubstitution.decision,'new-exercise-series');
  assert.deepEqual(after.map(a=>a.exerciseId),before.map(a=>a.exerciseId));
  assert.equal(p.run(`GarageFitTrainingHistory.createHistory(arms.snapshot().results,CATALOGUE).anchorPerformanceSeries('anchor-flexion').length`),2);
  assert.throws(()=>p.run("arms.prepare({...armsOptions,anchorSubstitutions:{'anchor-flexion':'chin-up'}})"),/Invalid Coach anchor substitute/);
});

test('short sessions preserve direct work and rest; later coverage restores omitted maintenance with no debt', async () => {
  const p=pilot();await p.start();await p.begin('{...armsOptions,duration:20}');
  const short=p.json('arms.snapshot().preview');
  assert.equal(short.plan.prescription.requiredAnchors.length,2);
  assert.ok(short.plan.prescription.requiredAnchors.every(a=>a.targetSets===3));
  assert.equal(short.plan.prescription.preferredAnchors.length,0);
  assert.equal(short.plan.prescription.workoutStyle,'strength');
  assert.equal(short.plan.prescription.difficulty,'normal');
  await p.log();await p.log('anchor-extension',{resistanceSetup:'initial'});await p.finish();
  const later=p.json('arms.plan(armsOptions)');
  assert.ok(later.rationale.priorities.movements.filter(p=>['push','pull'].includes(p.pattern)).every(p=>p.deficit===1));
  assert.deepEqual(new Set(later.prescription.preferredAnchors.map(a=>a.requirementId)),new Set(['maintenance-squat','maintenance-hinge','maintenance-lunge','maintenance-push','maintenance-pull','maintenance-core','maintenance-carry']));
  await p.begin();
  await p.run(`(async()=>{const work=armsTracker.plannedWork().filter(w=>w.section==='main'&&CATALOGUE[w.exerciseId].patterns.includes('squat')&&!CATALOGUE[w.exerciseId].directElbowAction);if(!work.length)throw new Error('Expected broader squat work');for(const w of work)await armsTracker.recordDone(w.occurrenceId)})()`);await p.finish();
  assert.equal(p.json('arms.plan(armsOptions)').rationale.priorities.movements.find(p=>p.pattern==='squat').deficit,0);
  p.run("armsNow='2026-10-21T08:00:00Z'");
  const missed=p.json('arms.plan(armsOptions)');
  assert.equal(missed.rationale.missedSessionResponse.catchUpSessions,0);
  assert.ok(missed.rationale.priorities.movements.every(p=>p.deficit===1));
  assert.equal(missed.rationale.priorities.directDose.flexion.value,0);
});

test('open-ended progress never automatically completes and persisted results recover idempotently', async () => {
  const p=pilot();await p.start();await p.begin();await p.log();await p.finish();
  const before=p.json('arms.snapshot().state');await p.run('arms.load()');
  assert.deepEqual(p.json('arms.snapshot().state'),before);
  assert.equal(p.run("armsEngine.programmeReview(armsDef,arms.snapshot().state,'2027-10-12T08:00:00Z').due"),false);
  assert.equal(p.run('arms.snapshot().state.status'),'active');
  await p.run("arms.manage('pause')");await p.run("arms.manage('resume')");await p.run("arms.manage('finish')");
  assert.equal(p.run('arms.snapshot().state.status'),'completed');
});

test('existing Coach entry point lists both programmes and renders open-ended status and dose', async () => {
  const p=pilot();await p.run('coachUI.open()');
  const el=id=>p.app.document.getElementById(id);
  assert.ok(el('coachContent').children.some(c=>c.textContent==='Build Arms'));
  const button=el('coachContent').children.find(c=>c.textContent==='Build Arms');await button.onclick();
  assert.ok(el('coachContent').children.some(c=>/direct arm curl/.test(c.textContent)));
  await p.run("coachUI.controller.start(armsDef,['bands'])");await p.run('coachUI.open()');
  const text=el('coachContent').children.map(c=>c.textContent).join(' ');
  assert.match(text,/Open-ended objective/);assert.match(text,/Curls · 0 \/ 9/);assert.match(text,/Extensions · 0 \/ 9/);
});
