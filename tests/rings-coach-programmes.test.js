// Rings R7 (#146): ring exercises in General Strength, Build Arms and Tennis Coach programmes.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context');
const {pilot} = require('./helpers/coach-pilot');

const app = loadAppContext(new Map(), {ownIntrinsics: true});
const json = source => JSON.parse(vm.runInContext(`JSON.stringify(${source})`, app));
vm.runInContext(`var R7={engine:GarageFitCoachEngine.createEngine({catalogue:CATALOGUE,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription}),
  registry:GarageFitCoachPolicies.createDefaultRegistry(),P:GarageFitData.programmes};`, app);
const P = json('R7.P');
const RING_IDS = json("Object.values(CATALOGUE).filter(ex=>ex.equipment.flat().includes('rings')).map(ex=>ex.id)");
const GS = 'general-strength-4w', TENNIS = 'tennis-conditioning', ARMS = 'build-arms';
const GS_RING = {'anchor-push': ['ring-press-up'], 'anchor-pull': ['ring-row', 'ring-pull-up', 'ring-chin-up']};
const TENNIS_RING = {'tennis-anchor-push': ['ring-press-up'], 'tennis-anchor-pull': ['ring-row']};
const NO_RING_KITS = [[], ['dumbbells'], ['dumbbells', 'bench'], ['kettlebell'], ['trx'], ['bands'], ['pullup-bar'], ['trx', 'bands'], ['dumbbells', 'kettlebell', 'trx', 'bands', 'pullup-bar', 'bench']];
const withoutRings = (definition, version, extra = {}) => {
  const copy = JSON.parse(JSON.stringify(definition));
  copy.version = version; Object.assign(copy, extra);
  copy.anchorSelectionPolicy.requirements.forEach(item => { if (item.exerciseIds) item.exerciseIds = item.exerciseIds.filter(id => !RING_IDS.includes(id)); });
  return copy;
};
const assess = (id, version, context) => json(`R7.engine.assessProgrammeFeasibility(R7.P[${JSON.stringify(id)}][${version}],${JSON.stringify({duration: 30, ...context})})`);
const alternatives = (id, version, anchors, context, requirementId) => json(`R7.registry.get(R7.P[${JSON.stringify(id)}][${version}].type).anchorAlternatives({definition:R7.P[${JSON.stringify(id)}][${version}],
  catalogue:CATALOGUE,state:{anchors:${JSON.stringify(anchors)}},context:${JSON.stringify(context)},requirementId:${JSON.stringify(requirementId)}})`);
const seeded = (p, seed) => p.run(`let r7Seed=${seed};Math.random=()=>{r7Seed=(r7Seed*1664525+1013904223)>>>0;return r7Seed/4294967296;};`);
const mainIds = workout => workout.main.blocks.flatMap(block => block.exercises.map(item => item.id));

test('released definitions stay unchanged; General Strength v2 and Tennis v7 only append reviewed ring anchors', () => {
  assert.equal(RING_IDS.length, 15); // S1 adds an accessory, with no programme anchor change.
  assert.deepEqual(Object.keys(P[GS]), ['1', '2']);
  assert.deepEqual(Object.keys(P[TENNIS]), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(Object.keys(P[ARMS]), ['1'], 'Build Arms already selects ring curls/extensions by intrinsic direct action');
  for (const [id, versions] of Object.entries(P)) for (const [version, definition] of Object.entries(versions)) {
    vm.runInContext(`R7.registry.get(R7.P[${JSON.stringify(id)}][${version}].type).validateDefinition(R7.P[${JSON.stringify(id)}][${version}])`, app);
    const released = !(id === GS && version === '2' || id === TENNIS && ['7', '8'].includes(version));
    // Anchor-free General Fitness (#190) has no anchor candidates to check.
    if (released) for (const requirement of definition.anchorSelectionPolicy ? definition.anchorSelectionPolicy.requirements : [])
      assert.ok(!(requirement.exerciseIds || []).some(item => RING_IDS.includes(item)), id + ' v' + version + ' is released and ring-free');
  }
  assert.deepEqual(P[GS][1].anchorSelectionPolicy.requirements.map(item => item.exerciseIds.slice(-2)), [['trx-squat', 'air-squat'], ['push-up', 'incline-push-up'], ['pull-up', 'chin-up']]);
  assert.deepEqual(withoutRings(P[GS][2], 1), P[GS][1]);
  assert.deepEqual(withoutRings(P[TENNIS][7], 6, {sportPolicy: {sportId: 'tennis', version: 2}}), P[TENNIS][6]);
  assert.deepEqual(P[TENNIS][7].sportPolicy, {sportId: 'tennis', version: 3});
  // #255: v8 only pins Tennis capability mapping v4 (shared single-leg and lateral-lunge-to-balance drills).
  assert.deepEqual({...P[TENNIS][8], version: 7, sportPolicy: P[TENNIS][7].sportPolicy}, P[TENNIS][7]);
  assert.deepEqual(P[TENNIS][8].sportPolicy, {sportId: 'tennis', version: 4});
  // Ring choices are appended, so released choices keep their priority.
  for (const [definition, rings] of [[P[GS][2], GS_RING], [P[TENNIS][7], TENNIS_RING]])
    for (const requirement of definition.anchorSelectionPolicy.requirements)
      assert.deepEqual(requirement.exerciseIds.filter(item => RING_IDS.includes(item)), rings[requirement.requirementId] || []);
  for (const definition of [P[GS][2], P[TENNIS][7]]) for (const requirement of definition.anchorSelectionPolicy.requirements) {
    const rings = requirement.exerciseIds.filter(item => RING_IDS.includes(item));
    assert.deepEqual(requirement.exerciseIds.slice(requirement.exerciseIds.length - rings.length), rings);
  }
});

test('Tennis capability mapping v3 credits only reviewed ring entries; mappings v1/v2 are unchanged', () => {
  const mappings = json('GarageFitData.sportCapabilityPolicies.tennis');
  const ids = mapping => mapping.capabilities.flatMap(cap => cap.mappings.flatMap(item => item.exerciseIds));
  assert.ok(!ids(mappings[1]).some(id => RING_IDS.includes(id)) && !ids(mappings[2]).some(id => RING_IDS.includes(id)));
  const stripped = JSON.parse(JSON.stringify(mappings[3])); stripped.version = 2;
  stripped.capabilities.forEach(cap => cap.mappings.forEach(item => { item.exerciseIds = item.exerciseIds.filter(id => !RING_IDS.includes(id)); }));
  assert.deepEqual(stripped, mappings[2]);
  const classify = (version, id) => json(`GarageFitSportCoverage.createPolicy(GarageFitData.sportCapabilityPolicies.tennis[${version}],CATALOGUE).classifyExercise('${id}')`);
  const mapped = RING_IDS.filter(id => classify(3, id).status === 'mapped').sort();
  assert.deepEqual(mapped, ['ring-face-pull', 'ring-press-up', 'ring-row']);
  assert.deepEqual(classify(3, 'ring-row').contributions.map(item => item.capabilityId + ':' + item.facet), ['upper-body:push-pull']);
  assert.deepEqual(classify(3, 'ring-press-up').contributions.map(item => item.capabilityId + ':' + item.facet), ['upper-body:push-pull']);
  assert.deepEqual(classify(3, 'ring-face-pull').contributions.map(item => item.capabilityId + ':' + item.facet), ['upper-body:shoulder-support']);
  for (const id of RING_IDS) assert.equal(classify(2, id).status, 'unmapped', id);
});

test('without rings, new-start anchors, feasibility and alternatives match the released versions', () => {
  for (const equipment of NO_RING_KITS) {
    for (const [id, previous, current] of [[GS, 1, 2], [TENNIS, 6, 7]]) {
      const before = assess(id, previous, {equipment}), after = assess(id, current, {equipment});
      assert.equal(after.status, before.status, id + ' ' + equipment);
      assert.deepEqual(after.anchors.map(item => item.exerciseId), before.anchors.map(item => item.exerciseId), id + ' ' + equipment);
      assert.ok(!after.anchors.some(item => RING_IDS.includes(item.exerciseId)));
      for (const requirement of P[id][current].anchorSelectionPolicy.requirements) {
        assert.deepEqual(alternatives(id, current, [], {equipment}, requirement.requirementId), alternatives(id, previous, [], {equipment}, requirement.requirementId));
        for (const ring of (current === 2 ? GS_RING : TENNIS_RING)[requirement.requirementId] || [])
          assert.equal(assess(id, current, {equipment, anchorSelections: {[requirement.requirementId]: ring}}).status, 'infeasible', ring + ' needs rings');
      }
    }
    const arms = assess(ARMS, 1, {equipment});
    assert.ok(!arms.anchors.some(item => RING_IDS.includes(item.exerciseId)), 'Build Arms ' + equipment);
    for (const requirementId of ['anchor-flexion', 'anchor-extension'])
      assert.ok(!alternatives(ARMS, 1, [], {equipment}, requirementId).some(item => RING_IDS.includes(item)));
  }
});

test('with rings, reviewed ring anchors are selectable; excluded ring movements and timed holds are rejected', () => {
  const kit = ['rings', 'dumbbells', 'bench'];
  // Other kit keeps the released default anchors; rings never displace them.
  assert.deepEqual(assess(GS, 2, {equipment: kit}).anchors.map(item => item.exerciseId), assess(GS, 1, {equipment: kit}).anchors.map(item => item.exerciseId));
  assert.deepEqual(assess(TENNIS, 7, {equipment: kit}).anchors.map(item => item.exerciseId), assess(TENNIS, 6, {equipment: kit}).anchors.map(item => item.exerciseId));
  for (const [id, current, previous, rings] of [[GS, 2, 1, GS_RING], [TENNIS, 7, 6, TENNIS_RING]]) {
    for (const [requirementId, ids] of Object.entries(rings)) for (const ring of ids) {
      const started = assess(id, current, {equipment: kit, anchorSelections: {[requirementId]: ring}});
      assert.equal(started.status, 'feasible', id + ' ' + ring);
      const anchor = started.anchors.find(item => item.requirementId === requirementId);
      assert.equal(anchor.exerciseId, ring);
      assert.deepEqual([anchor.targetSets, anchor.prescriptionMode, anchor.target, anchor.allowedProtocols], [2, 'reps', {type: 'reps', minReps: 6, maxReps: 6}, ['rounds']]);
      assert.equal(assess(id, previous, {equipment: kit, anchorSelections: {[requirementId]: ring}}).status, 'infeasible', 'released v' + previous + ' never gains ' + ring);
      assert.ok(alternatives(id, current, [], {equipment: kit}, requirementId).includes(ring));
    }
    const push = id === GS ? 'anchor-push' : 'tennis-anchor-push', pull = id === GS ? 'anchor-pull' : 'tennis-anchor-pull';
    const excluded = [[push, 'ring-dip'], [push, 'foot-assisted-ring-dip'], [push, 'ring-support-hold'], [push, 'foot-assisted-ring-support-hold'],
      [push, 'ring-triceps-extension'], [pull, 'neutral-grip-ring-pull-up'], [pull, 'ring-face-pull'], [pull, 'ring-biceps-curl'], [pull, 'ring-knee-raise'],
      ...(id === TENNIS ? [[pull, 'ring-pull-up'], [pull, 'ring-chin-up']] : [])];
    for (const [requirementId, ring] of excluded)
      assert.equal(assess(id, current, {equipment: kit, anchorSelections: {[requirementId]: ring}}).status, 'infeasible', id + ' rejects ' + ring);
  }
  // Hard ring work never becomes an easy anchor merely by lowering reps.
  for (const [id, requirementId] of [[GS, 'anchor-push'], [GS, 'anchor-pull'], [TENNIS, 'tennis-anchor-push']]) {
    const easy = alternatives(id, id === GS ? 2 : 7, [], {equipment: kit, easyToday: true}, requirementId);
    assert.ok(!easy.some(item => ['ring-press-up', 'ring-pull-up', 'ring-chin-up'].includes(item)), id + ' ' + easy);
  }
  assert.ok(alternatives(GS, 2, [], {equipment: kit, easyToday: true}, 'anchor-pull').includes('ring-row'));
  // Build Arms v1 selects by intrinsic direct action, so a saved instance can use ring
  // work as a temporary substitute today without a new version or anchor change.
  const arms = [{requirementId: 'anchor-flexion', exerciseId: 'dumbbell-biceps-curl'}, {requirementId: 'anchor-extension', exerciseId: 'dumbbell-overhead-triceps-extension'}];
  assert.ok(alternatives(ARMS, 1, arms, {equipment: kit}, 'anchor-flexion').includes('ring-biceps-curl'));
  assert.ok(alternatives(ARMS, 1, arms, {equipment: kit}, 'anchor-extension').includes('ring-triceps-extension'));
  assert.ok(!alternatives(ARMS, 1, arms, {equipment: kit}, 'anchor-extension').some(item => ['ring-dip', 'ring-support-hold', 'ring-press-up'].includes(item)));
  assert.deepEqual(assess(ARMS, 1, {equipment: kit}).anchors.map(item => item.exerciseId), ['dumbbell-biceps-curl', 'dumbbell-overhead-triceps-extension']);
});

test('rings make Tennis startable without other pulling kit; ring anchors credit upper-body coverage', () => {
  assert.equal(assess(TENNIS, 6, {equipment: ['rings']}).status, 'infeasible');
  const started = assess(TENNIS, 7, {equipment: ['rings']});
  assert.equal(started.status, 'feasible');
  assert.deepEqual(started.anchors.map(item => item.exerciseId), ['reverse-lunge', 'glute-bridge', 'push-up', 'ring-row']);
  for (const duration of started.durationAssessments) for (const role of duration.roles) {
    assert.equal(role.status, 'feasible', duration.duration + ' ' + role.sessionRole);
    const anchors = role.prescription.requiredAnchors, ids = anchors.map(item => item.exerciseId);
    // Lower-body/trunk/lateral priorities still lead; rings only fill pull or shoulder support.
    assert.ok(ids.includes('alternating-lateral-lunge') && ids.includes('plank'), duration.duration + ' ' + ids);
    assert.ok(anchors.filter(item => RING_IDS.includes(item.exerciseId)).every(item =>
      item.requirementId === 'tennis-anchor-pull' && item.exerciseId === 'ring-row'
      || item.requirementId === 'tennis-support-upper-body' && item.exerciseId === 'ring-face-pull'), ids.join());
    if (ids.includes('ring-row')) assert.ok(!anchors.some(item => item.requirementId === 'tennis-support-upper-body'), 'ring row covers upper body');
  }
});

test('Build Arms uses ring curls/extensions as direct anchors with confirmed-setup progression, not inferred load', async () => {
  const p = pilot(new Map(), ARMS, 1);
  p.run("pilotOptions.equipment=['rings']");
  await p.start();
  const state = p.json('pilot.snapshot().state');
  assert.deepEqual(state.anchors.map(item => [item.requirementId, item.exerciseId, item.currentTarget.targetSets, item.currentTarget.target.maxReps]),
    [['anchor-flexion', 'ring-biceps-curl', 3, 8], ['anchor-extension', 'ring-triceps-extension', 3, 8]]);
  assert.ok(state.anchors.every(item => item.currentTarget.suggestedLoad === undefined));
  await p.begin();
  const resistance = p.json('pilot.snapshot().preview.plan.prescription.programmeContext.anchorResistance');
  assert.deepEqual(Object.values(resistance).map(item => [item.exerciseId, item.numericLoad, item.setup]),
    [['ring-biceps-curl', false, 'initial'], ['ring-triceps-extension', false, 'initial']]);
  const log = (sets, requirement) => p.run(`(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>item.requirementId===${JSON.stringify(requirement)}))
    await pilotTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[${JSON.stringify(sets)}]});})()`);
  await log({reps: 8, load: null, resistanceSetup: 'initial'}, 'anchor-flexion');
  await log({reps: 8, load: null}, 'anchor-extension');
  await p.finish();
  const after = p.json('pilot.snapshot().state.anchors');
  assert.equal(after[0].progression.decision, 'add-rep'); assert.equal(after[0].currentTarget.target.maxReps, 9);
  assert.equal(after[0].comparisonBaseline.resistanceSetup, 'initial');
  assert.equal(after[1].progression.decision, 'hold-unknown-setup', 'an unconfirmed ring setup holds progression');
  assert.equal(after[1].currentTarget.target.maxReps, 8);
  assert.ok(after.every(item => item.currentTarget.suggestedLoad === undefined && item.comparisonBaseline?.load === undefined));
});

test('[Full] seeded Coach workouts in all three programmes contain suitable ring work with compatible setups and honest timing', async () => {
  const cases = [
    [GS, 2, ['rings', 'dumbbells', 'bench'], {'anchor-pull': 'ring-row'}],
    [TENNIS, 7, ['rings'], {}],
    [ARMS, 1, ['rings', 'kettlebell'], {}]
  ];
  for (const [id, version, equipment, substitutions] of cases) {
    const ringsSeen = new Set();
    for (const seed of [1, 7, 42]) {
      const p = pilot(new Map(), id, version);
      seeded(p, seed);
      p.run(`pilotOptions.equipment=${JSON.stringify(equipment)}`);
      await p.start();
      for (const duration of id === TENNIS ? [15, 20, 30, 45] : [20, 30, 45]) {
        p.run(`pilot.prepare({...pilotOptions,duration:${duration}})`);
        for (const [requirementId, exerciseId] of Object.entries(substitutions))
          if (p.json('pilot.snapshot().preview.plan.prescription.requiredAnchors').some(item => item.requirementId === requirementId))
            p.run(`pilot.substitute(${JSON.stringify(requirementId)},${JSON.stringify(exerciseId)})`);
        const preview = p.json('pilot.snapshot().preview'), workout = preview.workout, label = [id, seed, duration].join('/');
        const required = preview.plan.prescription.requiredAnchors.map(item => item.exerciseId);
        const placed = workout.prescriptionOutcome.requiredAnchorPlacements.map(item => item.exerciseId);
        assert.deepEqual([...new Set(placed)].sort(), [...new Set(required)].sort(), label + ' required anchors are not displaced');
        assert.ok(workout.estimatedSeconds <= duration * 60, label + ' ' + workout.estimatedSeconds);
        assert.ok(p.json(`pilot.snapshot().preview.workout.main.blocks.every(block=>GarageFitGenerator.blockSetupCompatible(block,CATALOGUE,${JSON.stringify(equipment)}))`), label);
        for (const exerciseId of mainIds(workout)) if (RING_IDS.includes(exerciseId)) ringsSeen.add(exerciseId);
        for (const block of workout.main.blocks) for (const item of block.exercises)
          if (item.coachAnchor && RING_IDS.includes(item.id)) assert.notEqual(p.run(`CATALOGUE['${item.id}'].prescription.type`), 'timed', label);
      }
    }
    assert.ok(ringsSeen.size > 0, id + ' should contain ring work');
    if (id === GS) assert.ok(ringsSeen.has('ring-row'));
    if (id === TENNIS) assert.ok(ringsSeen.has('ring-row'));
    if (id === ARMS) assert.ok(ringsSeen.has('ring-biceps-curl') && ringsSeen.has('ring-triceps-extension'));
  }
});

test('active released instances keep anchors, alternatives and recovery; new versions are explicit new starts only', async () => {
  for (const [id, version, equipment, requirementId] of [[GS, 1, ['rings', 'dumbbells', 'bench'], 'anchor-pull'], [TENNIS, 6, ['rings', 'dumbbells'], 'tennis-anchor-pull']]) {
    const storage = new Map(), p = pilot(storage, id, version);
    p.run(`pilotOptions.equipment=${JSON.stringify(equipment)}`);
    await p.start();
    const before = p.json('pilot.snapshot().state');
    assert.equal(before.programmeDefinitionVersion, version);
    const options = p.json('pilot.alternatives(' + JSON.stringify(requirementId) + ',pilotOptions)');
    assert.ok(options.length && !options.some(item => RING_IDS.includes(item)), id + ' v' + version + ' gains no ring anchor alternatives');
    await p.begin();
    await p.run(`(async()=>{const work=pilotTracker.plannedWork().find(item=>item.requirementId);
      await pilotTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:work.prescription.reps,load:10,loadUnit:'kg',loadInterpretation:'per-item'}]});})()`);
    // Interrupted session: a fresh controller finalises performed work under the saved version.
    const q = pilot(storage, id, version);
    await q.run('pilot.load()');
    assert.equal(q.run('pilot.snapshot().blocked'), false);
    const after = q.json('pilot.snapshot().state');
    assert.equal(after.programmeDefinitionVersion, version);
    assert.deepEqual(after.anchors.map(item => item.exerciseId), before.anchors.map(item => item.exerciseId));
    assert.equal(q.json('pilot.snapshot().results[0]').finalStatus, 'partial');
    assert.equal(after.meaningfulSessionsCompleted, 1);
  }
});

test('temporary ring substitutes keep the stable anchor and attribute history to the ring exercise', async () => {
  const p = pilot(new Map(), TENNIS, 7);
  p.run("pilotOptions.equipment=['trx','rings']");
  await p.start();
  assert.equal(p.json('pilot.snapshot().state.anchors')[3].exerciseId, 'trx-row');
  p.run('pilot.prepare(pilotOptions)');
  assert.ok(p.json("pilot.alternatives('tennis-anchor-pull',pilotOptions)").includes('ring-row'));
  p.run("pilot.substitute('tennis-anchor-pull','ring-row')");
  await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
  await p.run(`(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>item.requirementId==='tennis-anchor-pull'))
    await pilotTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:6,load:null,resistanceSetup:'initial'}]});})()`);
  await p.finish();
  const anchor = p.json('pilot.snapshot().state.anchors')[3];
  assert.equal(anchor.exerciseId, 'trx-row');
  assert.equal(anchor.latestSubstitution.exerciseId, 'ring-row');
  assert.equal(anchor.latestSubstitution.decision, 'new-exercise-series');
  assert.deepEqual(anchor.currentTarget.target, {type: 'reps', minReps: 6, maxReps: 6});
  const history = name => p.json(`GarageFitTrainingHistory.createHistory(pilot.snapshot().results,CATALOGUE).exactExercisePerformances('${name}').length`);
  assert.equal(history('trx-row'), 0);
  assert.equal(history('ring-row'), 2);
});

test('Mobility crossover leaves General Strength, Build Arms and Tennis anchors intact on their shared prep/recovery routes (#272)',async()=>{
  const crossover=['standing-hinge-and-reach','standing-wall-slides','standing-calf-stretch','bent-knee-calf-stretch','supine-hamstring-stretch'];
  const seen=new Set();
  for(const [id,version] of [[GS,2],[ARMS,1],[TENNIS,8]]) {
    const p=pilot(new Map(),id,version);seeded(p,31);await p.start();
    p.run('pilot.prepare({...pilotOptions,duration:30})');
    const {workout,plan}=p.json('pilot.snapshot().preview');
    assert.deepEqual([...new Set(workout.prescriptionOutcome.requiredAnchorPlacements.map(item=>item.exerciseId))].sort(),
      [...new Set(plan.prescription.requiredAnchors.map(item=>item.exerciseId))].sort(),id+' exact required anchors');
    assert.ok(workout.estimatedSeconds<=1800,id);
    assert.ok(mainIds(workout).every(ex=>!crossover.includes(ex)),id+' no new Main');
    for(const kind of ['warmup','cooldown'])for(const ex of workout[kind].exercises)if(crossover.includes(ex.id)) {
      seen.add(ex.id);assert.ok(ex.prescription.value>=10&&ex.prescription.value<=40,id+' light effective dose');
    }
  }
  assert.ok(seen.size>0,'actual programme preparation/recovery crossover');
});
