const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context');
const {pilot} = require('./helpers/coach-pilot');

// #242: Athletic Movement and Mobility own their whole progression inside Main. One shared derived
// reading (GarageFitGenerator.trainingSectionPlan) presents and accounts their preparation and finish
// as Warm-up/Cool-down without moving blocks, changing occurrence ids or adding a second sequence.
const plain = value => JSON.parse(JSON.stringify(value));
// App objects come from another realm: compare their JSON values.
const same = (actual, expected, message) => assert.deepStrictEqual(plain(actual), plain(expected), message);
function rng(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
const ATHLETIC = 'athletic-movement', MOBILITY = 'mobility-movement-quality';
// Current published v1 finish lengths (unchanged here; see the PR's version-pinning note).
const ATHLETIC_FINISH = {10:30, 15:32, 20:54, 30:76, 45:119};
const ATHLETIC_PREP = {10:120, 15:180, 20:180, 30:240, 45:300};
const MOBILITY_PROFILE = {10:[60,60], 15:[120,120], 20:[180,120], 30:[180,180], 45:[240,240]};
const app = loadAppContext(new Map(), {ownIntrinsics:true, rampupUi:true});
const run = source => vm.runInContext(source, app), setWorkout = workout => { app.input = workout; run('generatorState.workout=input'); };
const G = app.GarageFitGenerator, T = app.GarageFitSessionTracker, C = app.GarageFitData.exercises;
const generate = (workoutFamilyId, duration, extra = {}) => G.generate({workoutFamilyId, duration, difficulty:'normal', catalogue:C, equipment:[], random:rng(31), ...extra});
const stage = block => block.id.split('-')[1];
const total = seconds => seconds.warmup+seconds.rampup+seconds.main+seconds.cooldown;
// Player seconds per training section; a transition belongs to the section it ends.
function timelineSections(timeline) {
  const seconds = {warmup:0, rampup:0, main:0, cooldown:0};
  for (const phase of timeline.slice(1)) {
    const section = phase.trainingSection || phase.section;
    seconds[section] += phase.kind === 'exercise' ? (phase.timed ? phase.seconds : phase.estimatedSeconds/G.sideCount(phase.exercise)) : phase.seconds;
  }
  return seconds;
}

test('specialist stages classify by explicit stage identity across durations; the reused control role stays Main', () => {
  for (const duration of [10,15,20,30,45]) {
    const athletic = generate(ATHLETIC, duration, {movementRoom:true}), plan = G.trainingSectionPlan(athletic);
    same(plan.blocks.map(item => item.section), athletic.main.blocks.map(block => ({preparation:'warmup', finish:'cooldown'})[stage(block)] || 'main'));
    assert.equal(plan.seconds.warmup, ATHLETIC_PREP[duration]);
    assert.equal(plan.seconds.cooldown, ATHLETIC_FINISH[duration]);
    assert.equal(plan.seconds.rampup, 0, 'no invented generic Ramp-up');
    assert.equal(total(plan.seconds), athletic.estimatedSeconds); assert.equal(athletic.estimatedSeconds, duration*60);
    assert.ok(athletic.main.blocks.some((block, index) => block.familyContext.role === 'control' && plan.blocks[index].section === 'main'),
      'control drills and resets are Main practice, not preparation');
    assert.ok(['warmup','rampup','cooldown'].every(key => !athletic[key].exercises.length), 'no second sequence in the generic arrays');
    const mobility = generate(MOBILITY, duration), mobilityPlan = G.trainingSectionPlan(mobility);
    same(mobilityPlan.blocks.map(item => item.section), ['warmup','main','main','cooldown']);
    same([mobilityPlan.seconds.warmup, mobilityPlan.seconds.cooldown, mobilityPlan.seconds.rampup], [...MOBILITY_PROFILE[duration], 0]);
    assert.equal(total(mobilityPlan.seconds), duration*60);
  }
  // Classification survives JSON round trips and family-gated swaps, and a modified id never qualifies.
  const workout = generate(ATHLETIC, 20), before = plain(G.trainingSectionPlan(workout));
  same(plain(G.trainingSectionPlan(plain(workout))), before);
  G.swap(workout, 2, 0, {catalogue:C, equipment:[], random:rng(5)});
  assert.equal(G.validateFamilyWorkout(workout, {catalogue:C, equipment:[]}).valid, true);
  same(plain(G.trainingSectionPlan(workout).blocks), before.blocks);
  const relabelled = plain(workout); relabelled.main.blocks[0].id = 'athletic-reset-1';
  assert.equal(G.blockTrainingSection(relabelled.main.blocks[0]), 'main');
});

test('unaffected families, no-family generation and benchmark blocks keep their conventional sections exactly', () => {
  for (const workoutFamilyId of ['strength-control','cardio-conditioning','core-stability','full-body-challenges',undefined]) {
    for (const duration of [10,30]) {
      const workout = G.generate({workoutFamilyId, duration, difficulty:'normal', catalogue:C, equipment:['dumbbells'], focus:'balanced', random:rng(7)});
      const plan = G.trainingSectionPlan(workout);
      assert.ok(plan.blocks.every((item, index) => item.section === 'main' && item.position === index && item.count === workout.main.blocks.length));
      same(plan.seconds, {warmup:workout.warmup.estimatedSeconds, rampup:workout.rampup.estimatedSeconds,
        main:workout.main.estimatedDurationSeconds, cooldown:workout.cooldown.estimatedSeconds});
      assert.ok(plan.seconds.warmup > 0 && plan.seconds.cooldown > 0, String(workoutFamilyId));
      const phases = app.buildGeneratedTimeline(plain(workout));
      assert.ok(phases.every(phase => !phase.trainingSection && !phase.nextTrainingSection), 'conventional phases are unchanged');
    }
  }
  assert.equal(G.blockTrainingSection({id:'benchmark-1', benchmark:{}, familyContext:{workoutFamilyId:ATHLETIC, workoutFamilyVersion:1, role:'control'}}), 'main');
});

test('the shared player timeline and tracker plan keep stable Main occurrence ids but record preparation/finish purpose', () => {
  for (const [family, duration] of [[ATHLETIC,10],[ATHLETIC,30],[MOBILITY,15]]) {
    const workout = generate(family, duration, {movementRoom:true}), plan = G.trainingSectionPlan(workout);
    const timeline = app.buildGeneratedTimeline(plain(workout)), work = timeline.filter(phase => phase.kind === 'exercise');
    // Work, sides, in-block recovery and block transitions are each counted once, per section and in total.
    same(timelineSections(timeline), plan.seconds);
    assert.equal(timeline.slice(1).reduce((sum, phase) => sum + (phase.kind === 'exercise' ? phase.seconds : phase.seconds), 0), duration*60);
    for (const phase of work) {
      assert.equal(phase.section, 'main');
      assert.equal(phase.trainingSection || 'main', plan.blocks[phase.blockIndex].section);
      const {trainingSection, ...structural} = phase;
      assert.equal(T.occurrenceIdFor(structural), phase.occurrenceId, 'ids never use the derived section');
      assert.ok(phase.occurrenceId.startsWith('main:b'+phase.blockIndex+':'));
    }
    const planned = T.plannedWorkFromTimeline(timeline);
    same(planned.map(item => item.section), work.map(phase => plan.blocks[phase.blockIndex].section));
    same(planned.map(item => item.blockIndex), work.map(phase => phase.blockIndex), 'unambiguous block association');
    same([...new Set(planned.map(item => item.section))], ['warmup','main','cooldown']);
    // Section boundaries keep the block-transition timing, announced as the end of a section.
    const boundaries = timeline.filter(phase => phase.kind === 'block-transition' && phase.nextTrainingSection);
    same(boundaries.map(phase => [phase.label, phase.seconds]), [['Warm-up complete',3],['Main workout complete',3]]);
    setWorkout(plain(workout)); app.timelineInput = timeline; run('generatorState.timeline=timelineInput');
    same(boundaries.map(phase => app.generatedActivityName(phase)), ['Main workout','Cool-down']);
    same(boundaries.map(phase => app.generatedPhaseLabel(phase)), ['Main workout','Cool-down']);
    const mainCount = plan.blocks.filter(item => item.section === 'main').length;
    assert.match(app.generatedPhaseLabel(work[0]), /^Warm-up · Round 1 of \d+ · Exercise 1 of \d+$/);
    assert.match(app.generatedPhaseLabel(work.find(phase => !phase.trainingSection)), new RegExp('^Block 1 of '+mainCount+' · Round 1'));
    assert.match(app.generatedPhaseLabel(work.at(-1)), /^Cool-down · Round \d+ of \d+ · Exercise \d+ of \d+$/);
  }
});

test('standalone preview lists preparation and finish under Warm-up/Cool-down with truthful timing and no empty Ramp-up', () => {
  const el = id => app.document.getElementById(id), text = node => [node.textContent, ...(node.children || []).map(text)].join(' ');
  for (const [family, duration, warmup, cooldown] of [[ATHLETIC,10,'2 min','1 min'],[MOBILITY,30,'3 min','3 min']]) {
    setWorkout(generate(family, duration));
    app.renderGeneratedPreview();
    const plan = G.trainingSectionPlan(run('generatorState.workout')), mainCount = plan.blocks.filter(item => item.section === 'main').length;
    assert.equal(el('previewWarmup').textContent, warmup); assert.equal(el('previewCooldown').textContent, cooldown);
    assert.equal(el('previewRampupCard').classList.contains('hidden'), true);
    assert.equal(el('previewRampupListTitle').classList.contains('hidden'), true);
    assert.equal(el('previewWarmupListTitle').classList.contains('hidden'), false);
    assert.equal(el('previewMainTitle').textContent, 'Main workout · '+mainCount+' blocks');
    assert.equal(el('previewRounds').textContent, mainCount+' main blocks');
    assert.match(text(el('previewWarmupList')), /Guided sequence/);
    assert.match(text(el('previewCooldownList')), /Guided sequence/);
    assert.equal(el('previewList').children.filter(node => node.className === 'preview-block-heading').length, mainCount);
    assert.equal(el('previewEstimate').textContent, '≈'+duration+' min total');
    // A preparation-block swap is the family-gated Main swap.
    const swap = el('previewWarmupList').children.find(node => node.className !== 'preview-block-heading').children[2].children[0];
    swap.onclick();
    assert.equal(G.validateFamilyWorkout(run('generatorState.workout'), {catalogue:C, equipment:run('state.ownedEquipment')}).valid, true);
  }
  setWorkout(G.generate({duration:20, difficulty:'normal', catalogue:C, equipment:[], focus:'balanced', random:rng(3)}));
  app.renderGeneratedPreview();
  assert.equal(el('previewRampupCard').classList.contains('hidden'), false, 'conventional Ramp-up remains');
});

// Generator + Coach + tracker: performing only preparation/finish never counts as meaningful Main work.
async function coachSession(family, storage = new Map()) {
  const p = pilot(storage, 'general-fitness', 2, {rampupUi:true});
  p.run(`const baseGenerate=GarageFitGenerator.generate;
    GarageFitGenerator.generate=options=>{
      if(!options.sessionPrescription||!options.sessionPrescription.workoutFamilyPlan)return baseGenerate(options);
      const rx=JSON.parse(JSON.stringify(options.sessionPrescription));
      rx.workoutFamilyPlan.candidates=[{workoutFamilyId:${JSON.stringify(family)},workoutFamilyVersion:1,rationale:'Specialist phase route.'}];
      return baseGenerate({...options,sessionPrescription:GarageFitCoachModel.createSessionPrescription(rx)});
    };`);
  await p.start(); await p.begin('{duration:20,equipment:[]}');
  return p;
}
const recordSections = (p, sections) => p.run(`(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>${JSON.stringify(sections)}.includes(item.section)))await pilotTracker.recordDone(work.occurrenceId);})()`);

test('General Fitness Coach: preparation/finish only is never meaningful on completion, exit or recovery; Main practice counts', async () => {
  for (const family of [ATHLETIC, MOBILITY]) {
    const p = await coachSession(family);
    const workout = p.json('pilot.snapshot().preview.workout');
    assert.equal(workout.workoutFamilyId, family);
    const sections = p.json('pilotTracker.plannedWork().map(item=>item.section)');
    same([...new Set(sections)], ['warmup','main','cooldown']);
    await recordSections(p, ['warmup','cooldown']);
    const completed = await p.finish('complete');
    assert.equal(completed.finalStatus, 'completed');
    assert.equal(p.json('pilot.snapshot().state').meaningfulSessionsCompleted, 0, family+': completed preparation/finish only');
    // Contextual history never treats it as family exposure either.
    const history = p.app.GarageFitTrainingHistory.createHistory([completed], C).recentTrainingSummary();
    same(plain(history.families), []);

    const exit = await coachSession(family);
    await recordSections(exit, ['warmup']);
    assert.equal((await exit.finish('exit')).finalStatus, 'abandoned', family+': early exit after preparation only');
    assert.equal(exit.json('pilot.snapshot().state').meaningfulSessionsCompleted, 0);

    const practised = await coachSession(family);
    await recordSections(practised, ['warmup']);
    await practised.run("(async()=>{const work=pilotTracker.plannedWork().find(item=>item.section==='main');await pilotTracker.recordDone(work.occurrenceId);})()");
    const partial = await practised.finish('exit');
    assert.equal(partial.finalStatus, 'partial');
    assert.equal(practised.json('pilot.snapshot().state').meaningfulSessionsCompleted, 1, family+': actual Main practice counts');
    const summary = practised.app.GarageFitTrainingHistory.createHistory([partial], C).recentTrainingSummary();
    same(plain(summary.families).map(item => item.key), [family+'@1']);
    assert.ok(summary.sessions[0].performances.every(item => item.section === 'main'));
  }
});

test('an interrupted specialist draft with only preparation recovers as abandoned; ids survive reload', async () => {
  const p = await coachSession(MOBILITY);
  const ids = p.json('pilotTracker.plannedWork().map(item=>item.occurrenceId)');
  await recordSections(p, ['warmup']);
  const recorded = p.json('pilotTracker.performedWork().length');
  assert.ok(recorded > 0 && recorded === p.json("pilotTracker.plannedWork().filter(item=>item.section==='warmup').length"), 'preparation was performed');
  await p.run('pilotTracker.flush()');
  const reload = pilot(p.storage, 'general-fitness', 2, {rampupUi:true});
  reload.run('pilotNow='+JSON.stringify(p.run('pilotNow')));
  await reload.run('pilot.load()');
  const results = (await reload.run('pilotStore.listSessionResults()')).results;
  assert.equal(results.length, 1);
  assert.equal(results[0].finalStatus, 'abandoned');
  same(results[0].plannedWork.map(item => item.occurrenceId), ids);
  assert.equal(reload.json('pilot.snapshot().state').meaningfulSessionsCompleted, 0);
});

test('historic records that stored specialist preparation as Main remain readable and keep their recorded meaning', () => {
  const workout = generate(MOBILITY, 10), timeline = app.buildGeneratedTimeline(plain(workout));
  // Before #242 every specialist occurrence was recorded with section 'main'; nothing migrates it.
  const legacy = T.plannedWorkFromTimeline(timeline.map(phase => { const {trainingSection, ...rest} = phase; return rest; }));
  assert.ok(legacy.every(item => item.section === 'main'));
  const first = legacy[0];
  const result = app.GarageFitCoachModel.createSessionResult({sessionResultId:'result:legacy', source:'generator', workoutId:workout.id,
    workoutFamilyId:MOBILITY, workoutFamilyVersion:1, familyStyleId:workout.familyStyleId,
    startedAt:'2026-09-01T08:00:00.000Z', endedAt:'2026-09-01T08:10:00.000Z', actualDurationSeconds:600, finalStatus:'completed',
    plannedWork:legacy, performedWork:[{occurrenceId:first.occurrenceId, exerciseId:first.exerciseId, status:'completed'}], substitutions:[], anchorResults:[]});
  const summary = app.GarageFitTrainingHistory.createHistory([result], C).recentTrainingSummary();
  same(plain(summary.families).map(item => item.key), [MOBILITY+'@1'], 'old evidence is read as recorded');
  assert.equal(app.GarageFitCoachRecovery.meaningful({status:'completed'}, first), true);
});
