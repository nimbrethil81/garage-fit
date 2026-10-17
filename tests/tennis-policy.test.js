const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
for (const file of ['data/exercises','data/sport-profiles','data/sport-capabilities','data/programmes',
  'js/coach-model','js/training-history','js/sport-coverage','js/coach-policies','js/coach-tennis-policy','js/coach-engine','js/generator']) require('../'+file);
const {sessionResult} = require('./helpers/coach-fixtures');
const {pilot} = require('./helpers/coach-pilot');
const copy = value => JSON.parse(JSON.stringify(value));
const catalogue = GarageFitData.exercises, definition = GarageFitData.programmes['tennis-conditioning'][1];
const Model = GarageFitCoachModel, Generator = GarageFitGenerator;
const NOW = '2026-10-12T08:00:00Z', equipment = ['dumbbells'];
const engine = GarageFitCoachEngine.createEngine({catalogue, assessSessionPrescription: Generator.assessSessionPrescription});
const start = (frequency = 2, overrides = {}, def = definition) => engine.startProgramme(def,
  {equipment,programmeInstanceId:'tennis',programmeSettings:{sportId:'tennis',weeklyCoachFrequency:frequency},...overrides},NOW);
const plan = (state, results = [], duration = 30, overrides = {}, def = definition) => engine.planNextSession(def,state,results,
  {now:NOW,prescriptionId:'tennis-rx',equipment,duration,...overrides});
const stable = (state, prescription) => prescription.requiredAnchors.filter(item => state.anchors.some(anchor => anchor.requirementId === item.requirementId));
const random = seed => () => { seed = (seed*1664525+1013904223) >>> 0; return seed/4294967296; };
const generate = (prescription,seed) => Generator.generate({catalogue,sessionPrescription:prescription,random:random(seed)});
const withoutId = workout => { const snapshot = copy(workout); delete snapshot.id; return snapshot; };
let id = 0;
function resultFor(prescription, options = {}) {
  const plannedWork = [], performedWork = [];
  for (const anchor of prescription.requiredAnchors) {
    const exercise = catalogue[anchor.exerciseId];
    const sides = exercise.sidedness === 'per-side' ? ['left','right'] : [null];
    for (let set = 0; set < anchor.targetSets; set++) for (const side of sides) {
      const occurrenceId = anchor.requirementId+'-'+set+'-'+side, timed = anchor.prescriptionMode === 'time';
      plannedWork.push({occurrenceId,exerciseId:anchor.exerciseId,requirementId:anchor.requirementId,section:'main',
        prescription:{type:exercise.prescription.type,protocol:'rounds',side,timed,
          ...(timed ? {seconds:anchor.target.seconds} : {reps:anchor.target.maxReps}),
          protocolConditions:options.conditions || {exerciseRestSeconds:20,roundRestSeconds:60}}});
      if (options.only && !options.only.includes(anchor.requirementId)) continue;
      const measurements = timed ? {seconds:anchor.target.seconds} : {reps:options.reps ?? anchor.target.maxReps,
        load:options.load === undefined ? 12 : options.load,loadUnit:'kg',loadInterpretation:'total'};
      performedWork.push({occurrenceId,exerciseId:anchor.exerciseId,status:'completed',sets:[measurements]});
    }
  }
  return copy(Model.createSessionResult(sessionResult({sessionResultId:'tennis-result-'+(++id),programmeInstanceId:prescription.programmeInstanceId,
    prescriptionId:prescription.prescriptionId,generatedAt:NOW,startedAt:NOW,endedAt:NOW,
    plannedWork,performedWork,anchorResults:[],substitutions:[],feedback:{},overrides:prescription.programmeContext.overrides,
    finalStatus:options.finalStatus || 'completed',...options.result})));
}

test('Tennis selects four distinct stable roles, pins its release and saves default instance settings', () => {
  const defaults = engine.startProgramme(definition,{programmeInstanceId:'defaults',equipment},NOW).state;
  assert.equal(defaults.currentTargets.programmeSettings.sportId,'tennis');
  assert.equal(defaults.currentTargets.programmeSettings.weeklyCoachFrequency,2);
  assert.equal(defaults.currentTargets.programmeSettings.focus,'balanced');
  assert.equal(defaults.programmeDefinitionVersion,1);
  assert.ok(Object.isFrozen(definition.sessionRoles[2]));
  for (const kit of [equipment,['kettlebell','pullup-bar'],['trx'],['bands']]) {
    const started = start(2,{equipment:kit});
    assert.notEqual(started.status,'infeasible');
    assert.deepEqual(started.state.anchors.map(item => item.roleId),['knee','hinge','push','pull']);
    assert.equal(new Set(started.state.anchors.map(item => item.exerciseId)).size,4);
    assert.ok(started.state.anchors.every(item => item.currentTarget.targetSets === 2 && item.currentTarget.target.maxReps === 6));
  }
  const noPull = start(2,{equipment:[]});
  assert.equal(noPull.state,null);
  assert.ok(noPull.assessment.conflicts.some(item => item.requirementId === 'tennis-anchor-pull' && item.message));
  assert.equal(start(2,{anchorSelections:{'tennis-anchor-knee':'push-up'}}).state,null);
  const squat = start(2,{anchorSelections:{'tennis-anchor-knee':'air-squat'}}).state;
  assert.equal(squat.anchors[0].pattern,'squat');
  assert.throws(() => start(2,{programmeSettings:{sportId:'unknown'}}));
});

test('all 1/2/3-frequency roles and five budgets honour selected targets, side exposures, rest and total time', () => {
  for (const frequency of [1,2,3]) {
    let state = start(frequency).state;
    const originalIdentities = state.anchors.map(item => item.exerciseId), results = [], roles = [];
    for (let turn = 0; turn < frequency; turn++) {
      const previews = [];
      for (const duration of [10,15,20,30,45]) {
        const before = copy(state), planned = plan(state,results,duration);
        assert.ok(planned.prescription,JSON.stringify(planned.conflicts));
        previews.push(planned);
        assert.deepEqual(state,before);
        const anchors = stable(state,planned.prescription);
        assert.ok(duration > 15 || anchors.length <= 2);
        assert.ok(anchors.every(anchor => anchor.targetSets === 2 && anchor.allowedProtocols.join() === 'rounds'));
        for (const seed of [1,29]) {
          const workout = generate(planned.prescription,seed);
          assert.ok(workout.estimatedSeconds <= duration*60,frequency+'/'+duration+': '+workout.estimatedSeconds);
          assert.ok(workout.warmup.estimatedSeconds > 0 && workout.rampup.estimatedSeconds > 0 && workout.cooldown.estimatedSeconds > 0);
          assert.equal(workout.prescriptionOutcome.requiredAnchorPlacements.length,planned.prescription.requiredAnchors.length);
          for (const anchor of anchors) {
            const placements = workout.prescriptionOutcome.requiredAnchorPlacements.filter(item => item.requirementId === anchor.requirementId);
            assert.equal(placements.reduce((sum,item) => sum+item.expectedSetCount,0),2);
            assert.equal(placements.reduce((sum,item) => sum+item.expectedExposureCount,0),catalogue[anchor.exerciseId].sidedness === 'per-side' ? 4 : 2);
            const block = workout.main.blocks[placements[0].blockIndex];
            assert.equal(block.protocol,'rounds');
            assert.equal(block.prescription.exerciseRestSeconds,20);
            assert.equal(block.prescription.roundRestSeconds,60);
          }
          assert.deepEqual(withoutId(workout),withoutId(generate(planned.prescription,seed)));
        }
      }
      roles.push(previews[3].prescription.sessionRole);
      if (roles.at(-1) === 'conditioning-resilience') assert.equal(stable(state,previews[3].prescription).length,0);
      const result = resultFor(previews[3].prescription);
      state = engine.applySessionResult(definition,state,result,results); results.push(result);
      assert.deepEqual(state.anchors.map(item => item.exerciseId),originalIdentities);
    }
    assert.deepEqual(roles,definition.sessionRoles[frequency].map(role => role.id));
  }
});

test('preview, skipped, abandoned and tiny unknown/partial loops cannot advance the performed rotation', () => {
  const state = start().state, initial = plan(state,[],10), before = copy(state);
  assert.deepEqual(plan(state,[],10),initial);
  assert.deepEqual(state,before);
  for (const kind of ['skipped','abandoned','unknown','tiny']) {
    const result = resultFor(initial.prescription,{result:{finalStatus:kind === 'abandoned' ? 'abandoned' : 'partial'}});
    result.performedWork = kind === 'abandoned' ? [] : result.performedWork.map(work => ({...work,
      status:kind === 'skipped' ? 'skipped' : 'partial',sets:kind === 'unknown' ? [] : [{reps:1}]}));
    const updated = engine.applySessionResult(definition,state,result,[]);
    const next = plan(updated,[result],10);
    assert.equal(next.prescription.sessionRole,initial.prescription.sessionRole);
    assert.deepEqual(updated.anchors.map(anchor => anchor.currentTarget),state.anchors.map(anchor => anchor.currentTarget));
  }
  const performed = resultFor(initial.prescription,{only:['tennis-anchor-knee'],finalStatus:'partial'});
  const updated = engine.applySessionResult(definition,state,performed,[]);
  assert.equal(plan(updated,[performed],10).prescription.sessionRole,'movement-conditioning');
  assert.deepEqual(engine.applySessionResult(definition,updated,performed,[performed]),updated);
  const abandoned = resultFor(initial.prescription,{only:['tennis-anchor-knee'],finalStatus:'abandoned'});
  const abandonedState = engine.applySessionResult(definition,state,abandoned,[]);
  assert.equal(abandonedState.meaningfulSessionsCompleted,0);
  assert.deepEqual(abandonedState.anchors,state.anchors);
});

test('equipment-specific and Easy/small-space shapes preserve the full budget even at the top progression target', () => {
  for (const kit of [equipment,['kettlebell','pullup-bar'],['trx'],['bands']]) {
    let state = start(3,{equipment:kit}).state;
    state.anchors.forEach(anchor => { anchor.currentTarget.target = {type:'reps',minReps:10,maxReps:10}; });
    const results = [];
    for (let turn=0;turn<3;turn++) {
      for (const duration of [10,15,20,30,45]) for (const context of [{},{easyToday:true,smallSpace:true,allowedImpact:['low']}]) {
        const planned = plan(state,results,duration,{equipment:kit,...context});
        assert.ok(planned.prescription,JSON.stringify(planned.conflicts));
        for (const seed of [7,53]) {
          const workout = generate(planned.prescription,seed);
          assert.ok(workout.estimatedSeconds<=duration*60);
          assert.ok(workout.main.estimatedDurationSeconds<=planned.prescription.mainTimeLimitSeconds);
          assert.ok(workout.prescriptionOutcome.requiredAnchorPlacements.every(placement => placement.protocol==='rounds'));
          assert.ok(stable(state,planned.prescription).every(anchor => anchor.targetSets===2 && anchor.target.maxReps===10));
        }
      }
      const performed = resultFor(plan(state,results,30,{equipment:kit}).prescription);
      state = engine.applySessionResult(definition,state,performed,results); results.push(performed);
    }
  }
});

test('single-session short omissions rotate across all four anchors and retain deferred baselines', () => {
  let state = start(1).state; const results = [], selected = [];
  for (let session = 0; session < 8; session++) {
    const prescription = plan(state,results,10).prescription, anchors = stable(state,prescription);
    assert.equal(anchors.length,1);
    selected.push(anchors[0].requirementId);
    const previous = copy(state), result = resultFor(prescription,{only:[anchors[0].requirementId],finalStatus:'partial'});
    state = engine.applySessionResult(definition,state,result,results); results.push(result);
    for (const anchor of state.anchors.filter(item => item.requirementId !== anchors[0].requirementId)) {
      assert.deepEqual(anchor,previous.anchors.find(item => item.requirementId === anchor.requirementId));
    }
  }
  assert.equal(new Set(selected.slice(0,4)).size,4);
  assert.equal(new Set(selected.slice(4)).size,4);
  const nextMonth = plan(state,results,10,{now:'2026-11-20T08:00:00Z'});
  assert.equal(nextMonth.rationale.missedSessionResponse.catchUpSessions,0);
  assert.ok(state.anchors.every(anchor => anchor.comparisonBaseline));
});

test('unilateral progression needs both full sets on both sides and verified comparable actual load', () => {
  let state = start(1).state; const results = [], knee = 'tennis-anchor-knee';
  const prescription = plan(state,[],30).prescription;
  const incomplete = resultFor(prescription,{only:[knee],finalStatus:'partial'});
  incomplete.performedWork = incomplete.performedWork.filter(work => !work.occurrenceId.endsWith('right'));
  state = engine.applySessionResult(definition,state,incomplete,[]); results.push(incomplete);
  assert.equal(state.anchors[0].comparisonBaseline,null);
  assert.equal(state.anchors[0].currentTarget.target.maxReps,6);
  for (let reps = 6; reps <= 10; reps++) {
    const planned = plan(state,results,30).prescription;
    assert.equal(planned.requiredAnchors.find(item => item.requirementId === knee).target.maxReps,reps);
    const result = resultFor(planned,{only:[knee],finalStatus:'partial'});
    state = engine.applySessionResult(definition,state,result,results); results.push(result);
  }
  assert.equal(state.anchors[0].currentTarget.target.maxReps,10);
  assert.equal(state.anchors[0].currentTarget.suggestedLoad,12);
  assert.equal(state.anchors[0].currentTarget.progressionIntent,'Use the next heavier available load');
  const incompatible = resultFor(plan(state,results,30).prescription,{only:[knee],reps:6,load:14,conditions:{exerciseRestSeconds:1,roundRestSeconds:1}});
  const held = engine.applySessionResult(definition,state,incompatible,results);
  assert.equal(held.anchors[0].comparisonBaseline.load,12);
  const heavier = resultFor(plan(state,results,30).prescription,{only:[knee],reps:6,load:14});
  state = engine.applySessionResult(definition,state,heavier,results);
  assert.equal(state.anchors[0].currentTarget.target.maxReps,6);
  assert.equal(state.anchors[0].comparisonBaseline.load,14);
});

test('temporary replacement uses the same knee role with a fresh exercise series and preserves the programme anchor', () => {
  const state = start(1).state, requirementId = 'tennis-anchor-knee';
  const alternatives = engine.getAnchorAlternatives(definition,state,{equipment},requirementId);
  assert.ok(alternatives.includes('air-squat'));
  assert.ok(!alternatives.includes('dumbbell-romanian-deadlift'));
  const planned = plan(state,[],30,{anchorSubstitutions:{[requirementId]:'air-squat'}});
  assert.equal(planned.prescription.requiredAnchors.find(item => item.requirementId === requirementId).exerciseId,'air-squat');
  const result = resultFor(planned.prescription,{only:[requirementId]});
  const updated = engine.applySessionResult(definition,state,result,[]);
  assert.equal(updated.anchors[0].exerciseId,'dumbbell-reverse-lunge');
  assert.equal(updated.anchors[0].comparisonBaseline,null);
  assert.equal(updated.anchors[0].latestSubstitution.decision,'new-exercise-series');
  assert.equal(updated.anchors[0].currentTarget.target.maxReps,6);
});

test('unknown actual resistance holds progression; a confirmed band/TRX setup can advance without a fabricated load', () => {
  const state = start(1).state, knee = 'tennis-anchor-knee';
  const unknown = resultFor(plan(state,[],30).prescription,{only:[knee],load:null});
  const held = engine.applySessionResult(definition,state,unknown,[]);
  assert.equal(held.anchors[0].comparisonBaseline,null);
  assert.equal(held.anchors[0].currentTarget.target.maxReps,6);
  const bandState = start(1,{equipment:['bands']}).state;
  const prescription = plan(bandState,[],30,{equipment:['bands']}).prescription;
  const pull = 'tennis-anchor-pull', performed = resultFor(prescription,{only:[pull],load:null});
  performed.performedWork.forEach(work => { work.sets[0].resistanceSetup = 'confirmed-band-setup'; });
  const advanced = engine.applySessionResult(definition,bandState,performed,[]).anchors.find(anchor => anchor.requirementId === pull);
  assert.equal(advanced.currentTarget.target.maxReps,7);
  assert.equal(advanced.comparisonBaseline.resistanceSetup,'confirmed-band-setup');
  assert.equal(advanced.currentTarget.suggestedLoad,undefined);
});

test('support choices rotate from actual IDs, partial coverage stays fractional, and focus keeps missing core priorities', () => {
  const state = start().state, initial = plan(state,[],30), result = resultFor(initial.prescription);
  const partial = copy(result);
  partial.sessionResultId += '-partial';
  partial.performedWork = partial.performedWork.map(work => ({...work,status:'partial',sets:[{reps:1}]}));
  const incomplete = plan(state,[partial],30);
  assert.equal(incomplete.prescription.sessionRole,initial.prescription.sessionRole);
  const actual = plan(state,[result],30);
  const firstTrunk = initial.prescription.requiredAnchors.find(item => item.requirementId === 'tennis-support-trunk');
  const nextTrunk = actual.prescription.requiredAnchors.find(item => item.requirementId === 'tennis-support-trunk');
  assert.notEqual(nextTrunk.exerciseId,firstTrunk.exerciseId);
  const focused = engine.updateProgrammeSettings(definition,state,{focus:'power'});
  const priorities = plan(focused,[],10).rationale.priorities.capabilities;
  assert.ok(priorities.slice(0,4).every(item => item.priority === 'core'));
  assert.ok(priorities.find(item => item.capabilityId === 'power').preferred);
  assert.equal(plan(state,[result],30).rationale.priorities.coverage.uniqueExposure.value,result.performedWork.length);
  const reversed = plan(state,[result,partial],30);
  assert.deepEqual(reversed,plan(state,[partial,result],30));
});

test('short start assesses actual shapes, while unavailable floors and capability constraints report truthful conflicts', () => {
  const short = start(3,{duration:10});
  assert.ok(short.state);
  assert.deepEqual(short.assessment.durationAssessments.map(item => item.duration),[10,15,20,30,45]);
  assert.ok(short.assessment.durationAssessments[0].roles.every(item => item.prescription.requiredAnchors.length > 0));
  const isolated = GarageFitCoachEngine.createEngine({catalogue});
  assert.equal(isolated.startProgramme(definition,{programmeInstanceId:'no-preflight',equipment},NOW).state,null);
  assert.equal(start(2,{duration:12}).state,null);
  const impossible = start(2,{duration:10,allowedImpact:[]});
  assert.equal(impossible.state,null);
  assert.ok(impossible.assessment.conflicts.some(item => item.code === 'tennis-no-useful-session'));
  const state = start().state, constrained = plan(state,[],10,{smallSpace:true,allowedImpact:['low']});
  assert.ok(constrained.prescription);
  assert.ok(constrained.prescription.programmeContext.warnings.some(item => item.code === 'tennis-capability-unavailable' && item.capabilityId === 'lateral-movement'));
  const workout = generate(constrained.prescription,7);
  assert.ok(workout.main.blocks.flatMap(block => block.exercises).every(item => item.impact === 'low'));
  const noEquipment = plan(state,[],10,{equipment:[]});
  if (noEquipment.prescription) assert.ok(!stable(state,noEquipment.prescription).some(anchor => anchor.exerciseId === 'dumbbell-bent-over-row'));
});

test('an unattainable session role offers other feasible work instead of imposing a weekly failure quota', () => {
  const selectedIds = start(3).state.anchors.map(anchor => anchor.exerciseId);
  const reduced = Object.fromEntries(Object.entries(catalogue).filter(([exerciseId,exercise]) => !exercise.main || selectedIds.includes(exerciseId)));
  const custom = GarageFitCoachEngine.createEngine({catalogue:reduced,assessSessionPrescription:Generator.assessSessionPrescription});
  let state = custom.startProgramme(definition,{programmeInstanceId:'limited',equipment,programmeSettings:{sportId:'tennis',weeklyCoachFrequency:3}},NOW).state;
  assert.ok(state);
  const results = [];
  for (let turn=0;turn<3;turn++) {
    const planned = custom.planNextSession(definition,state,results,{now:NOW,prescriptionId:'limited-rx',equipment,duration:10});
    assert.ok(planned.prescription);
    if (turn===2) {
      assert.equal(planned.prescription.programmeContext.requestedRole,'conditioning-resilience');
      assert.ok(planned.prescription.programmeContext.warnings.some(item => item.code==='tennis-session-role-unavailable'));
    }
    const result = resultFor(planned.prescription);
    state = custom.applySessionResult(definition,state,result,results); results.push(result);
  }
});

test('production controller/tracker/store preserve four anchors, actual unilateral outcomes and earned roles across reload', async () => {
  const p = pilot(new Map(),'tennis-conditioning'); await p.start();
  await p.begin("{...pilotOptions,duration:10}");
  const before = p.json('pilot.snapshot().state');
  assert.equal(before.anchors.length,4);
  const required = p.json('pilotTracker.plannedWork().filter(item=>item.requirementId==="tennis-anchor-knee")');
  assert.equal(required.length,4);
  assert.deepEqual(required.map(item => item.prescription.side).sort(),['left','left','right','right']);
  await p.log('tennis-anchor-knee'); await p.finish();
  const after = p.json('pilot.snapshot().state');
  assert.equal(after.anchors[0].currentTarget.target.maxReps,7);
  const reopened = pilot(p.storage,'tennis-conditioning'); await reopened.run('pilot.load()');
  assert.deepEqual(reopened.json('pilot.snapshot().state'),after);
  assert.equal(reopened.run('pilot.plan({...pilotOptions,duration:10}).prescription.sessionRole'),'movement-conditioning');
  assert.equal(after.currentTargets.programmeSettings.weeklyCoachFrequency,2);
});

test('Tennis entry and player distinguish stable progression anchors from rep and timed support targets', async () => {
  const p = pilot(new Map(),'tennis-conditioning');
  p.run("state.ownedEquipment=['dumbbells']"); await p.run('coachUI.open()');
  const element = id => p.app.document.getElementById(id);
  await element('coachContent').children.find(node => node.textContent === 'Tennis').onclick();
  assert.ok(element('coachContent').children.some(node => /Four stable knee, hinge, push and pull/.test(node.textContent)));
  await p.run("coachUI.controller.start(pilotDef,['dumbbells'])"); await p.run('coachUI.open()');
  p.run(`function tennisButton(id,text){const visit=node=>node.textContent===text&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById(id));}`);
  await p.run("tennisButton('coachContent','View today’s workout').onclick()");
  await p.run("tennisButton('coachPreviewContent','Begin workout').onclick()");
  const support = p.json("generatorState.timeline.map((phase,index)=>({phase,index})).filter(({phase})=>phase.kind==='exercise'&&phase.section==='main'&&phase.exercise.coachAnchor?.requirementId.startsWith('tennis-support-'))");
  assert.ok(support.some(item => item.phase.timed));
  for (const item of support) {
    p.run(`enterGeneratedPhase(${item.index})`);
    assert.equal(p.run("document.getElementById('coachAnchorLog').classList.contains('hidden')"),true);
    if (item.phase.timed) p.run('generatorState.remaining=0');
    await p.run('completeWorkoutMovement()');
  }
  const work = p.json('generatorState.tracker.performedWork()');
  assert.ok(work.length > 0);
  assert.ok(work.every(item => (item.sets || []).every(set => set.load === undefined || set.load === null)));
  assert.ok(p.json('coachUI.controller.snapshot().state.anchors').every(anchor => anchor.currentTarget.target.maxReps === 6));
});
