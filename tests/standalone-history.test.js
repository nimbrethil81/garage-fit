// Coach 6 (#59): completed standalone generated workouts enter shared Training History as
// source=generator Session Results. gf_generator_history stays the Generator's separate
// recency record, and standalone evidence never becomes Coach programme credit by itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context');

const plain = value => JSON.parse(JSON.stringify(value));
const seeded = seed => `(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;})(${seed})`;
const NOT_SAVED = 'Your current progress and elapsed time won’t be saved.';

// The real app shell with the ramp-up UI and a controllable phase timer.
function harness(options = {}) {
  const storage = options.storage || new Map();
  const app = loadAppContext(storage, {ownIntrinsics: true});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'rampup-ui.js'), 'utf8'), app, {filename: 'js/rampup-ui.js'});
  const intervals = new Map(); let nextInterval = 1;
  vm.runInContext('var timerNow=Date.now();Date.now=()=>timerNow',app);
  app.setInterval = callback => { const id = nextInterval++; intervals.set(id,()=>{vm.runInContext('timerNow+=1000',app);callback();}); return id; };
  app.clearInterval = id => intervals.delete(id);
  const run = code => vm.runInContext(code, app);
  run(`state.ownedEquipment=${JSON.stringify(options.equipment || ['dumbbells','kettlebell','bench','trx','bands'])};
    const testStore=GarageFitCoachStore.createStore(localStorage);`);
  return {
    app, storage, run,
    generate(seed = 7, duration = 30) {
      run(`generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:${duration},focus:'balanced',equipment:state.ownedEquipment,history:getGeneratedHistory(),random:${seeded(seed)}})`);
    },
    tick() { const callback = intervals.get(run('generatorState.phaseTimer')); assert.ok(callback, 'phase timer is running'); callback(); },
    phase: () => run('currentGeneratedPhase()'),
    indexWhere: predicate => run('generatorState.timeline').findIndex(predicate),
    coachKeys: () => [...storage.keys()].filter(key => key.startsWith('gf_coach_')),
    results: async () => plain((await run('testStore.listSessionResults()')).results),
    async playToEnd() {
      for (let guard = 0; run('workoutState.running') && guard < 2000; guard++) {
        const emom=run('isEmomPhase()');
        await app.completeWorkoutMovement();
        if(emom&&run('isEmomPhase()')){run('timerNow+=generatorState.remaining*1000');await app.updateEmomMinute();}
      }
      assert.equal(run('workoutState.running'), false);
    }
  };
}

test('generating, swapping and previewing a standalone workout records no Training History', async () => {
  const h = harness();
  h.run("showLanding('generator');generateWorkout();swapGeneratedExercise(0,0);generateWorkout()");
  assert.ok(h.run('generatorState.workout.main.blocks.length') > 0, 'a preview was generated');
  assert.deepEqual(h.coachKeys(), []);
  assert.deepEqual(await h.results(), []);
});

test('starting a standalone workout earns no history and never replaces a persisted Coach draft', async () => {
  const h = harness();
  // An interrupted Coach session is waiting to be saved.
  await h.run(`testStore.saveSessionDraft(GarageFitCoachModel.createSessionDraft({draftId:'draft:coach',source:'coach',programmeInstanceId:'programme:1',
    prescriptionId:'prescription:1',startedAt:'2026-10-01T08:00:00Z',updatedAt:'2026-10-01T08:05:00Z',plannedWork:[],occurrenceOutcomes:[],
    finalisation:{state:'in-progress',sessionResultId:null}}))`);
  const coachDraft = h.storage.get('gf_coach_session_draft');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /class="preview-start" type="button" onclick="startStandaloneGeneratedWorkout\(\)"/, 'the standalone Start button opts in');
  h.run('coachUI.isActive=()=>true'); // even a stale Coach flag cannot claim a standalone run
  h.generate();
  h.app.startStandaloneGeneratedWorkout();
  const tracker = h.run('generatorState.tracker');
  assert.ok(tracker && tracker.started);
  assert.equal(h.run('isCoachPlayer()'), false);
  const rep = h.indexWhere(p => p.kind === 'exercise' && p.section === 'main' && !p.timed);
  h.app.enterGeneratedPhase(rep);
  h.app.completeWorkoutMovement();
  await tracker.flush();
  assert.equal(tracker.performedWork().length, 1, 'the run is tracked in memory');
  assert.equal(h.storage.get('gf_coach_session_draft'), coachDraft);
  assert.deepEqual(h.coachKeys(), ['gf_coach_session_draft']);
  assert.deepEqual(await h.results(), []);
  assert.equal(h.run('generatorState.trackerError'), null);
});

test('a completed standalone run persists one source=generator result from measured outcomes, without load', async () => {
  const h = harness();
  h.generate(5); // C1 catalogue: includes rep work displayed with a catalogue load
  h.app.startStandaloneGeneratedWorkout();
  const timeline = h.run('generatorState.timeline');
  const full = h.indexWhere(p => p.kind === 'exercise' && p.timed && p.seconds > 18);
  const early = h.indexWhere((p, i) => i !== full && p.kind === 'exercise' && p.timed && p.seconds > 18);
  const immediate = h.indexWhere((p, i) => ![full, early].includes(i) && p.kind === 'exercise' && p.timed);
  const rep = h.indexWhere(p => p.kind === 'exercise' && p.section === 'main' && !p.timed && p.exercise.load);
  assert.ok([full, early, immediate, rep].every(index => index > 0), 'workout covers timed and loaded rep work');

  // Natural timer completion -> completed with the full measured seconds.
  h.app.enterGeneratedPhase(full);
  for (let elapsed = 0; elapsed < timeline[full].seconds; elapsed++) h.tick();
  // Skip after 18 seconds -> partial with 18 measured seconds.
  h.app.enterGeneratedPhase(early);
  for (let elapsed = 0; elapsed < 18; elapsed++) h.tick();
  h.app.completeWorkoutMovement();
  // Immediate Skip -> skipped, zero seconds.
  h.app.enterGeneratedPhase(immediate);
  h.app.completeWorkoutMovement();
  // Rep Done -> coarse completion; the planned load display is not actual load.
  h.app.enterGeneratedPhase(rep);
  assert.match(h.run("document.getElementById('workoutSideNote').textContent"), new RegExp(timeline[rep].exercise.load));
  h.app.completeWorkoutMovement();
  assert.deepEqual(await h.results(), [], 'nothing is saved before normal completion');
  const outcome = id => plain(h.run('generatorState.tracker').outcome(id));
  assert.deepEqual(outcome(timeline[immediate].occurrenceId).sets, [{seconds: 0}]);
  assert.equal(outcome(timeline[immediate].occurrenceId).status, 'skipped');

  // Revisit from the start: moving through again cannot erase or duplicate recorded work.
  h.app.enterGeneratedPhase(0);
  await h.playToEnd();
  const result = plain(await h.run('generatorState.trackedResult'));
  assert.equal(h.run('generatorState.trackerError'), null);
  assert.deepEqual(await h.results(), [result]);
  assert.equal(result.source, 'generator');
  assert.equal(result.finalStatus, 'completed');
  assert.equal(result.programmeInstanceId, undefined);
  assert.equal(result.prescriptionId, undefined);
  assert.equal(result.workoutId, h.run('generatorState.workout.id'));
  assert.ok(Number.isFinite(result.actualDurationSeconds) && result.actualDurationSeconds >= 0);
  assert.deepEqual(result.anchorResults, []);
  assert.equal(result.plannedWork.length, h.run('generatorState.timeline').filter(p => p.kind === 'exercise').length);

  const performed = id => result.performedWork.filter(work => work.occurrenceId === timeline[id].occurrenceId);
  assert.deepEqual(performed(full).map(work => [work.status, work.sets]), [['completed', [{seconds: timeline[full].seconds}]]]);
  assert.deepEqual(performed(early).map(work => [work.status, work.sets]), [['partial', [{seconds: 18}]]]);
  assert.deepEqual(performed(immediate), [], 'skipped work is not performed work');
  assert.deepEqual(performed(rep), [{occurrenceId: timeline[rep].occurrenceId, exerciseId: timeline[rep].exercise.id, status: 'completed'}]);
  assert.ok(!JSON.stringify(result).includes('"load'), 'no actual or planned load is recorded');
  assert.ok(result.performedWork.every(work => work.status === 'completed' && (!work.sets || work.sets.every(set => Object.keys(set).join() === 'seconds'))
    || work.occurrenceId === timeline[early].occurrenceId));

  // Training History reads the same evidence: full, measured partial and coarse rep exposure.
  const evidence = plain(h.run(`GarageFitTrainingHistory.createHistory(${JSON.stringify([result])},CATALOGUE).sessionEvidence(${JSON.stringify(result.sessionResultId)})`));
  const exposure = id => evidence.performances.find(item => item.occurrenceId === timeline[id].occurrenceId).exposure;
  assert.deepEqual(exposure(full), {value: 1, confidence: 'derived'});
  assert.deepEqual(exposure(early), {value: 18 / timeline[early].seconds, confidence: 'derived'});
  assert.deepEqual(exposure(rep), {value: 1, confidence: 'derived'});
  assert.ok(evidence.performances.every(item => item.source === 'generator' && item.sets.every(set => set.load.value === null && set.load.confidence === 'unknown')));
  assert.deepEqual(h.coachKeys().filter(key => key === 'gf_coach_session_draft'), [], 'no draft is left behind');
});

test('confirmed standalone early exit keeps the not-saved promise and creates no Session Result', async () => {
  const h = harness();
  h.generate();
  h.app.startStandaloneGeneratedWorkout();
  const tracker = h.run('generatorState.tracker');
  h.app.enterGeneratedPhase(h.indexWhere(p => p.kind === 'exercise' && p.section === 'main' && !p.timed));
  h.app.completeWorkoutMovement();
  h.app.enterGeneratedPhase(h.indexWhere(p => p.kind === 'exercise' && p.timed));
  h.tick(); h.tick();
  h.app.openExitDialog('workout');
  assert.equal(h.run("document.getElementById('exitDialogCopy').textContent"), NOT_SAVED);
  h.app.confirmExitChoice();
  await tracker.flush();
  assert.equal(h.run('generatorState.tracker'), null, 'the unfinished draft is discarded');
  assert.equal(h.run('generatorState.trackedResult'), null);
  assert.equal(tracker.finalised, false);
  assert.deepEqual(h.coachKeys(), []);
  assert.deepEqual(await h.results(), []);
  assert.equal(h.storage.has('gf_generator_history'), false, 'exit still records no Generator recency');
});

test('completed standalone generation updates gf_generator_history exactly as an untracked run does', async () => {
  const untracked = harness(), tracked = harness();
  for (const h of [untracked, tracked]) h.storage.set('gf_generator_history', JSON.stringify([['push-up'], ['air-squat']]));
  for (const h of [untracked, tracked]) h.generate(31);
  untracked.app.startGeneratedWorkout();
  tracked.app.startStandaloneGeneratedWorkout();
  for (const h of [untracked, tracked]) await h.playToEnd();
  const result = plain(await tracked.run('generatorState.trackedResult'));
  assert.equal(tracked.storage.get('gf_generator_history'), untracked.storage.get('gf_generator_history'));
  const recency = JSON.parse(tracked.storage.get('gf_generator_history'));
  assert.equal(recency.length, 3);
  assert.deepEqual(recency[0], [...new Set(tracked.run('generatorState.workout.main.blocks').flatMap(block => block.exercises.map(exercise => exercise.id)))]);
  assert.ok(!tracked.storage.get('gf_generator_history').includes(result.sessionResultId));
  assert.deepEqual(untracked.coachKeys(), []);
  assert.deepEqual((await tracked.results()).map(item => item.source), ['generator']);
  for (const id of ['doneTitle','doneSub','generatedDoneRounds','generatedDoneExercises','doneBtn']) {
    assert.equal(tracked.run(`document.getElementById('${id}').textContent`), untracked.run(`document.getElementById('${id}').textContent`));
  }
});

// A completed standalone session built through the real tracker and stores.
function standaloneResult(h, {endedAt = '2026-10-03T08:30:00Z', work}) {
  const planned = work.map((item, index) => ({occurrenceId: item.occurrenceId || 'main:b0:r1:e'+index, exerciseId: item.exerciseId, section: 'main', blockIndex: 0, requirementId: null,
    prescription: item.prescription || {type: 'reps', timed: false, seconds: null, reps: 10, side: null, protocol: 'rounds',
      protocolConditions: {exerciseRestSeconds: 20, roundRestSeconds: 60}, round: 1, set: null, cycle: null, exerciseIndex: index}}));
  return h.run(`(async()=>{
    const work=${JSON.stringify(work)};
    const tracker=GarageFitSessionTracker.createTracker({store:GarageFitCoachStore.withEphemeralDraft(testStore),source:'generator',recordResults:true,
      plannedWork:${JSON.stringify(planned)},clock:()=>new Date(${JSON.stringify(endedAt)})});
    await tracker.start();
    for(const [index,entry] of tracker.plannedWork().entries()) await (work[index].sets?tracker.recordOutcome(entry.occurrenceId,{status:'completed',sets:work[index].sets}):tracker.recordDone(entry.occurrenceId));
    return JSON.parse(JSON.stringify(await tracker.complete({actualDurationSeconds:1200})));
  })()`);
}

test('completed standalone row and squat derive pull, squat and body-region exposure as standalone context', async () => {
  const h = harness();
  const result = await standaloneResult(h, {work: [{exerciseId: 'dumbbell-bent-over-row'}, {exerciseId: 'goblet-squat'}]});
  assert.deepEqual((await h.results()).map(item => item.sessionResultId), [result.sessionResultId]);
  h.run(`const testHistory=GarageFitTrainingHistory.createHistory(${JSON.stringify([result])},CATALOGUE)`);
  const query = code => plain(h.run('testHistory.'+code));
  assert.deepEqual(query("movementPatternExposure('pull')"), {value: 1, confidence: 'derived'});
  assert.deepEqual(query("movementPatternExposure('squat')"), {value: 1, confidence: 'derived'});
  assert.deepEqual(query("movementPatternExposure('push')"), {value: 0, confidence: 'unknown'});
  assert.deepEqual(query("bodyRegionExposure('upper')"), {value: 1, confidence: 'derived'});
  assert.deepEqual(query("bodyRegionExposure('lower')"), {value: 1, confidence: 'derived'});
  const row = query("exactExercisePerformances('dumbbell-bent-over-row')");
  assert.deepEqual(row.map(item => [item.source, item.programmeInstanceId, item.requirementId, item.sets.length]), [['generator', null, null, 0]]);
  assert.deepEqual(query('recentPerformedSessions()').map(item => item.sessionResultId), [result.sessionResultId]);
  // A programme-scoped query sees standalone work only when it explicitly asks for context,
  // and a standalone session is never one of the programme's sessions.
  assert.deepEqual(query("movementPatternExposure('pull',{programmeInstanceId:'programme:1'})").value, 0);
  assert.deepEqual(query("movementPatternExposure('pull',{programmeInstanceId:'programme:1',includeStandalone:true})"), {value: 1, confidence: 'derived'});
  assert.deepEqual(query("exactExercisePerformances('goblet-squat',{programmeInstanceId:'programme:1',includeStandalone:true})").length, 1);
  assert.deepEqual(query("sessionsForProgramme('programme:1',{includeStandalone:true})"), []);
  assert.deepEqual(query("anchorPerformanceSeries('anchor-squat',{includeStandalone:true})"), []);
});

function coach(h) {
  h.run(`
    const pilotDef=GarageFitData.programmes['general-strength-4w'][1];
    const pilotEngine=GarageFitCoachEngine.createEngine({catalogue:CATALOGUE,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription});
    let pilotNow='2026-10-01T08:00:00Z',pilotId=0,pilotTracker=null;
    const pilot=GarageFitCoachUI.createController({store:testStore,engine:pilotEngine,catalogue:CATALOGUE,buildTimeline:buildGeneratedTimeline,
      clock:()=>pilotNow,id:prefix=>prefix+':'+(++pilotId)});
  `);
  return {
    start: () => h.run("pilot.start(pilotDef,['dumbbells'])"),
    begin: () => { h.run("pilot.prepare({equipment:['dumbbells'],duration:30})"); return h.run('pilot.begin().then(value=>{pilotTracker=value;})'); },
    logAnchors: (reps = 'work.prescription.reps') => h.run(`(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>item.requirementId))
      await pilotTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:${reps},load:12,loadUnit:'kg',loadInterpretation:'total'}]});})()`),
    finish: kind => h.run(`pilot.finish('${kind}',{difficulty:'about-right'},900)`),
    state: () => plain(h.run('pilot.snapshot().state'))
  };
}

test('standalone history shapes Coach coverage priorities only when the definition opts in', async () => {
  const h = harness();
  const c = coach(h);
  await c.start();
  const result = await standaloneResult(h, {endedAt: '2026-10-02T08:30:00Z', work: [{exerciseId: 'dumbbell-bent-over-row'}, {exerciseId: 'band-row'}, {exerciseId: 'goblet-squat'}]});
  const deficits = (definition, results) => Object.fromEntries(plain(h.run(`pilotEngine.planNextSession(${definition},pilot.snapshot().state,${JSON.stringify(results)},
    {now:'2026-10-03T08:00:00Z',prescriptionId:'rx:test',equipment:['dumbbells'],duration:30})`)).rationale.priorities.movements.map(item => [item.pattern, item.deficit]));
  const optIn = "{...pilotDef,coverageTargets:{...pilotDef.coverageTargets,includeStandaloneHistory:true}}";
  // The released definition is unchanged: standalone context does not alter its priorities.
  assert.equal(h.run('pilotDef.coverageTargets.includeStandaloneHistory'), undefined);
  assert.deepEqual(deficits('pilotDef', [result]), deficits('pilotDef', []));
  // An opting-in definition counts performed standalone pull/hinge/squat towards coverage.
  const informed = deficits(optIn, [result]);
  assert.deepEqual(informed, {...deficits(optIn, []), pull: 0, hinge: 1, squat: 1});
  assert.ok(h.run(`pilotEngine.planNextSession(${optIn},pilot.snapshot().state,${JSON.stringify([result])},{now:'2026-10-03T08:00:00Z',prescriptionId:'rx:test',equipment:['dumbbells'],duration:30}).prescription`));
  assert.throws(() => h.run("pilotEngine.assessProgrammeFeasibility({...pilotDef,coverageTargets:{...pilotDef.coverageTargets,includeStandaloneHistory:'yes'}},{equipment:['dumbbells']})"), /explicit boolean/);
  // Planning never awards a session or dose.
  assert.equal(c.state().meaningfulSessionsCompleted, 0);
  assert.equal(c.state().currentTargets.dose.exposure, 0);
});

test('lightweight standalone evidence cannot count as a Coach session or progress a Coach anchor', async () => {
  const h = harness();
  const c = coach(h);
  await c.start();
  await c.begin(); await c.logAnchors(); const coachResult = plain(await c.finish('complete'));
  const progressed = c.state();
  assert.equal(progressed.meaningfulSessionsCompleted, 1);
  assert.equal(progressed.anchors[0].currentTarget.target.maxReps, 7);

  // The same anchor exercises performed in a standalone workout, Done without logged actuals.
  const squatPlan = coachResult.plannedWork.find(work => work.requirementId === 'anchor-squat');
  const comparable = {...squatPlan.prescription};
  h.run("pilotNow='2026-10-02T08:00:00Z'");
  const light = await standaloneResult(h, {endedAt: '2026-10-02T07:00:00Z', work: [
    {exerciseId: 'goblet-squat', prescription: comparable}, {exerciseId: 'goblet-squat', occurrenceId: 'main:b0:r2:e0', prescription: comparable},
    {exerciseId: 'dumbbell-floor-press'}, {exerciseId: 'dumbbell-bent-over-row'}]});
  await h.run('pilot.load()');
  assert.deepEqual(c.state(), progressed, 'no session, dose, progression or reconciliation credit');
  assert.deepEqual(plain(h.run('pilot.snapshot().results')).map(item => item.sessionResultId), [coachResult.sessionResultId]);
  assert.throws(() => h.run(`pilotEngine.applySessionResult(pilotDef,pilot.snapshot().state,${JSON.stringify(light)},[])`), /does not belong/);
  const stored = await h.results();
  assert.deepEqual(stored.map(item => [item.source, item.programmeInstanceId || null]), [['coach', progressed.programmeInstanceId], ['generator', null]]);

  // Comparison needs confirmed comparable actuals; coarse completion has none.
  const compareSquat = (results, sessionResultId) => plain(h.run(`(()=>{
    const squats=GarageFitTrainingHistory.createHistory(${JSON.stringify(results)},CATALOGUE).exactExercisePerformances('goblet-squat');
    return GarageFitTrainingHistory.comparePerformanceEvidence(squats.find(item=>item.source==='coach'),squats.find(item=>item.sessionResultId===${JSON.stringify(sessionResultId)}));
  })()`));
  const coarse = compareSquat(stored, light.sessionResultId);
  assert.equal(coarse.comparable, true, 'same exercise and execution conditions');
  assert.equal(coarse.change, 'insufficient-evidence');

  // A standalone result that genuinely carries comparable confirmed reps/load is valid
  // evidence for a future policy, but the released policy still grants it no credit.
  const confirmed = await standaloneResult(h, {endedAt: '2026-10-02T07:30:00Z', work: [
    {exerciseId: 'goblet-squat', prescription: comparable, sets: [{reps: 8, load: 12, loadUnit: 'kg', loadInterpretation: 'total'}]}]});
  assert.equal(compareSquat([coachResult, confirmed], confirmed.sessionResultId).change, 'improved-reps');
  await h.run('pilot.load()');
  assert.deepEqual(c.state(), progressed);

  // The next Coach session still plans and applies from Coach evidence only.
  await c.begin(); await c.logAnchors(); await c.finish('complete');
  assert.equal(c.state().meaningfulSessionsCompleted, 2);
  assert.equal(c.state().anchors[0].currentTarget.target.maxReps, 8);
});

test('Coach drafts and Session Results are unaffected by a completed standalone run', async () => {
  const h = harness({equipment: ['dumbbells']});
  const c = coach(h);
  await c.start(); await c.begin(); await c.logAnchors();
  const coachDraft = h.storage.get('gf_coach_session_draft');
  h.generate(5, 20);
  h.app.startStandaloneGeneratedWorkout();
  await h.playToEnd();
  const standalone = plain(await h.run('generatorState.trackedResult'));
  assert.equal(h.storage.get('gf_coach_session_draft'), coachDraft, 'the active Coach draft is untouched');
  await h.run('pilot.load()');
  assert.equal(plain(h.run('pilot.snapshot().interruptedDraft')), null, 'the controller still holds its live Coach session');
  const result = plain(await c.finish('exit'));
  assert.equal(result.source, 'coach');
  assert.equal(result.finalStatus, 'partial');
  assert.equal(c.state().meaningfulSessionsCompleted, 1);
  assert.deepEqual(c.state().recentSessionSummaries.map(item => item.sessionResultId), [result.sessionResultId]);
  assert.equal(h.storage.has('gf_coach_session_draft'), false);
  const stored = await h.results();
  assert.deepEqual(stored.map(item => item.sessionResultId).sort(), [result.sessionResultId, standalone.sessionResultId].sort());
  assert.deepEqual(stored.find(item => item.source === 'generator'), standalone);
});

test('completed family workout records actual edited identity despite a reset picker and survives reload', async () => {
  const h=harness();
  h.app.selectGeneratorFamily('strength-control');
  h.run(`Math.random=${seeded(7)}`);h.app.generateWorkout();
  h.app.swapGeneratedExercise(0,0);
  const workout=plain(h.run('generatorState.workout'));
  h.app.showLanding('home');assert.equal(h.run('generatorState.workoutFamilyId'),null);
  h.app.startStandaloneGeneratedWorkout();
  const draft=plain(h.run('generatorState.tracker.draft()'));
  assert.equal(draft.workoutFamilyId,workout.workoutFamilyId);assert.equal(draft.familyStyleId,workout.familyStyleId);
  assert.equal(draft.workoutFamilyVersion,2,'the standalone screen composes the current Strength & Control version');
  await h.playToEnd();
  const result=plain(await h.run('generatorState.trackedResult'));
  assert.equal(result.workoutFamilyId,workout.workoutFamilyId);assert.equal(result.familyStyleId,workout.familyStyleId);
  assert.deepEqual(result.plannedWork,draft.plannedWork);
  const reopened=harness({storage:h.storage});
  const saved=(await reopened.results())[0];assert.deepEqual(saved,result);
  const evidence=plain((await reopened.run('GarageFitTrainingHistory.loadRecentSummary(testStore,CATALOGUE)')).summary);
  assert.equal(evidence.sessions[0].familyStyleId,workout.familyStyleId);
  assert.equal(evidence.families[0].workoutFamilyId,'strength-control');
  assert.ok(!h.storage.has('gf_coach_session_draft'));
});
