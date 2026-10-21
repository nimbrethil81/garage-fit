const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../data/exercises.js');
require('../data/sport-profiles.js');
require('../data/sport-capabilities.js');
require('../data/programmes.js');
require('../js/coach-model.js');
require('../js/training-history.js');
require('../js/sport-coverage.js');
require('../js/coach-policies.js');
require('../js/coach-tennis-policy.js');
require('../js/coach-engine.js');
const {definition, ringsDefinition, ringResult, performance, context} = require('./helpers/coach-policy-fixtures.js');
const Model = GarageFitCoachModel, Policies = GarageFitCoachPolicies, History = GarageFitTrainingHistory;
const catalogue = GarageFitData.exercises, clone = value => JSON.parse(JSON.stringify(value));
const engine = GarageFitCoachEngine.createEngine({catalogue});
const START = '2026-10-01T08:00:00Z', RINGS = ['rings'];
const day = n => new Date(Date.parse(START) + n * 86400000 + 3600000).toISOString();

function begin(def = ringsDefinition()) {
  return engine.startProgramme(def, {programmeInstanceId: 'rings-instance', equipment: RINGS}, START).state;
}
// Applies results in order with the accumulated history, as the controller does.
function applyAll(state, results, history = [], def = ringsDefinition()) {
  for (const result of results) { state = engine.applySessionResult(def, state, result, history); history = [...history, result]; }
  return {state, history};
}
const recommendations = (state, def = ringsDefinition(), equipment = RINGS) => engine.variationProgressionRecommendations(def, state, {equipment});
const dipSessions = (from, count, options = {}) => Array.from({length: count}, (_, index) => ringResult('dip-'+(from+index), day(from+index), options));
const anchor = (state, requirementId = 'anchor-dip') => state.anchors.find(item => item.requirementId === requirementId);
const outcomes = (state, requirementId = 'anchor-dip') => anchor(state, requirementId).variationProgression.evidence.map(item => item.outcome);

test('released programmes do not opt in, keep their anchors and expose no recommendation', () => {
  for (const [id, versions] of Object.entries(GarageFitData.programmes)) for (const [version, def] of Object.entries(versions)) {
    assert.equal(def.variationProgressionPolicy, undefined, id+' v'+version);
  }
  const legacy = definition(), state = engine.startProgramme(legacy, context(), START).state;
  const applied = engine.applySessionResult(legacy, state, performance({endedAt: day(1)}), []);
  assert.ok(applied.anchors.every(item => !Object.prototype.hasOwnProperty.call(item, 'variationProgression')));
  assert.deepEqual(engine.variationProgressionRecommendations(legacy, applied, {equipment: context().equipment}), []);
  assert.deepEqual(engine.declineVariationProgression(legacy, applied, {recommendationId: 'x', equipment: [], now: day(2)}).state, applied);
  assert.equal(engine.confirmVariationProgression(legacy, applied, {recommendationId: 'x', equipment: [], now: day(2)}).status, 'stale');
  // A legacy record without the namespace stays valid; the namespace is checked when present.
  assert.doesNotThrow(() => Model.assertValid('programme-state', applied));
});

test('only policies with explicit hold semantics can opt in; Tennis does not inherit support', () => {
  assert.equal(typeof Policies.generalStrengthPolicy.progressionHold, 'function');
  assert.equal(typeof Policies.buildArmsPolicy.progressionHold, 'function');
  assert.equal(GarageFitCoachTennisPolicy.progressionHold, undefined);
  const registry = Policies.createRegistry({'general-strength': {...Policies.generalStrengthPolicy, progressionHold: undefined}});
  const custom = GarageFitCoachEngine.createEngine({catalogue, registry});
  assert.throws(() => custom.startProgramme(ringsDefinition(), {programmeInstanceId: 'x', equipment: RINGS}, START), /does not support it/);
  const tennis = clone(GarageFitData.programmes['tennis-conditioning'][6]);
  tennis.variationProgressionPolicy = clone(ringsDefinition().variationProgressionPolicy);
  assert.throws(() => engine.assessProgrammeFeasibility(tennis, {equipment: RINGS}), /variation progression policy/);
});

test('definitions must name reviewed, candidate-bound, mode-matched edges with explicit thresholds', () => {
  const edit = change => { const def = ringsDefinition(); change(def.variationProgressionPolicy.edges[0], def); return def; };
  const rejects = (change, pattern) => assert.throws(() => engine.assessProgrammeFeasibility(edit(change), {equipment: RINGS}), pattern);
  rejects(edge => { edge.inferred = true; }, /unknown fields/);
  rejects(edge => { edge.requirementId = 'anchor-missing'; }, /unknown anchor requirement/);
  rejects(edge => { edge.toExerciseId = 'ring-press-up'; }, /requirement candidates/);
  rejects(edge => { edge.toExerciseId = 'foot-assisted-ring-dip'; }, /two different/);
  // A strong support hold is never a reviewed pathway to dips (unlike movement demands).
  rejects((edge, def) => { Object.assign(def.variationProgressionPolicy.edges[1], {toExerciseId: 'ring-dip'}); }, /requirement candidates/);
  rejects(edge => { edge.evidence = {consecutiveSessions: 3, minimumSecondsPerSet: 20}; }, /minimumRepsPerSet/);
  rejects(edge => { edge.evidence.consecutiveSessions = 0; }, /consecutiveSessions/);
  rejects(edge => { edge.evidence.consecutiveSessions = 9; }, /consecutiveSessions/);
  rejects(edge => { delete edge.repromptAfterSessions; }, /repromptAfterSessions/);
  rejects(edge => { edge.startingTarget = {target: {type: 'timed', seconds: 10}}; }, /starting target/);
  rejects((edge, def) => { def.variationProgressionPolicy.edges.push({...clone(edge), edgeId: 'second'}); }, /one edge per anchor exercise/);
  rejects((edge, def) => { def.variationProgressionPolicy.edges[1].edgeId = edge.edgeId; }, /duplicate edge/);
  rejects((edge, def) => { def.variationProgressionPolicy = {edges: []}; }, /non-empty/);
  assert.equal(engine.assessProgrammeFeasibility(ringsDefinition(), {equipment: RINGS}).status, 'feasible');
});

test('an assisted rep anchor is recommended only after consecutive complete, confirmed sessions at the threshold', () => {
  let state = begin();
  assert.deepEqual(state.anchors.map(item => item.exerciseId), ['foot-assisted-ring-dip','foot-assisted-ring-support-hold']);
  ({state} = applyAll(state, dipSessions(1, 2)));
  assert.deepEqual(recommendations(state), [], 'two sessions are not enough');
  const before = clone(state);
  ({state} = applyAll(state, dipSessions(3, 1), dipSessions(1, 2)));
  const [item] = recommendations(state);
  assert.equal(item.recommendationId, 'assisted-ring-dip-to-ring-dip@dip-3');
  assert.deepEqual(item.evidenceSessionResultIds, ['dip-1','dip-2','dip-3']);
  assert.deepEqual([item.fromExerciseId, item.toExerciseId], ['foot-assisted-ring-dip','ring-dip']);
  assert.deepEqual(item.startingTarget, {requirementId: 'anchor-dip', exerciseId: 'ring-dip', importance: 'required', targetSets: 2, prescriptionMode: 'reps',
    allowedProtocols: ['rounds'], progressionIntent: 'New exercise: build steady reps', target: {type: 'reps', minReps: 3, maxReps: 3}});
  // A recommendation is a read: no stable anchor identity or target changes.
  assert.equal(anchor(state).exerciseId, 'foot-assisted-ring-dip');
  assert.deepEqual(anchor(state).currentTarget, anchor(before).currentTarget);
  assert.deepEqual(engine.variationProgressionRecommendations(ringsDefinition(), state, {equipment: RINGS}), [item]);
  assert.equal(anchor(state).exerciseId, 'foot-assisted-ring-dip');
});

test('partial, unknown, below-target, held, incomparable and thin evidence each restart the count', () => {
  const cases = [
    ['incomplete', {status: ['completed','partial']}],
    ['incomplete', {values: [10]}],
    ['unknown-actuals', {values: [10, null]}],
    ['below-target', {planned: 11, values: [10, 10]}],
    ['hold-easy-today', {overrides: [{type: 'easy-today'}]}],
    ['incomparable', {side: 'omit'}]
  ];
  for (const [outcome, options] of cases) {
    let {state, history} = applyAll(begin(), dipSessions(1, 2));
    ({state, history} = applyAll(state, [ringResult('bad', day(3), options)], history));
    assert.equal(outcomes(state).at(-1), outcome, JSON.stringify(options));
    ({state, history} = applyAll(state, dipSessions(4, 2), history));
    assert.deepEqual(recommendations(state), [], outcome+' must not be bridged');
    ({state} = applyAll(state, dipSessions(6, 1), history));
    assert.equal(recommendations(state).length, 1, outcome+' then three fresh sessions');
  }
  // Below the edge threshold is a performed attempt that does not qualify.
  let {state, history} = applyAll(begin(), dipSessions(1, 2));
  ({state} = applyAll(state, [ringResult('nine', day(3), {values: [10, 9]})], history));
  assert.equal(outcomes(state).at(-1), 'qualifying'); assert.deepEqual(recommendations(state), []);
  // Changed rest conditions are not one comparable series.
  ({state, history} = applyAll(begin(), dipSessions(1, 2)));
  ({state} = applyAll(state, [ringResult('rest', day(3), {conditions: {exerciseRestSeconds: 30, roundRestSeconds: 60}})], history));
  assert.deepEqual(recommendations(state), []);
});

test('maintenance, pause, missing equipment and substitutions never progress the anchor', () => {
  let {state, history} = applyAll(begin(), dipSessions(1, 3));
  assert.equal(recommendations(state).length, 1);
  assert.deepEqual(recommendations(state, ringsDefinition(), []), [], 'rings unavailable today');
  const id = recommendations(state)[0].recommendationId;
  assert.equal(engine.confirmVariationProgression(ringsDefinition(), state, {recommendationId: id, equipment: [], now: day(5)}).status, 'stale');
  assert.deepEqual(recommendations(engine.pauseProgramme(state)), []);
  const maintenance = engine.enterMaintenanceMode(state);
  assert.deepEqual(recommendations(maintenance), []);
  const held = applyAll(maintenance, [ringResult('maintenance', day(4))], history).state;
  assert.equal(outcomes(held).at(-1), 'hold-maintenance');
  assert.deepEqual(recommendations(engine.exitMaintenanceMode(held)), [], 'maintenance work restarted the count');
  // Just-for-today: performing the harder variation as a substitute is no evidence and no transition.
  const substituted = applyAll(begin(), dipSessions(1, 3, {performedExerciseId: 'ring-dip'})).state;
  assert.equal(anchor(substituted).exerciseId, 'foot-assisted-ring-dip');
  assert.equal(anchor(substituted).variationProgression, undefined);
  assert.deepEqual(recommendations(substituted), []);
  // Planning with a temporary substitute leaves the stable anchor untouched.
  const planned = engine.planNextSession(ringsDefinition(), state, history, {now: day(5), prescriptionId: 'rx-sub', equipment: RINGS,
    anchorSubstitutions: {'anchor-dip': 'ring-dip'}});
  assert.equal(planned.prescription.requiredAnchors.find(item => item.requirementId === 'anchor-dip').exerciseId, 'ring-dip');
  assert.equal(anchor(state).exerciseId, 'foot-assisted-ring-dip');
});

test('declining keeps the exact anchor and progress, and re-prompts only after more qualifying sessions', () => {
  let {state, history} = applyAll(begin(), dipSessions(1, 3));
  const [item] = recommendations(state), before = clone(state);
  const declined = engine.declineVariationProgression(ringsDefinition(), state, {recommendationId: item.recommendationId, equipment: RINGS, now: day(3.5)});
  assert.equal(declined.status, 'declined');
  const stripped = value => { const copy = clone(value); copy.anchors.forEach(entry => { if (entry.variationProgression) entry.variationProgression.declined = []; }); return copy; };
  assert.deepEqual(stripped(declined.state), stripped(before), 'only the decision is recorded');
  assert.deepEqual(anchor(declined.state).variationProgression.declined, [{edgeId: item.edgeId, recommendationId: item.recommendationId, declinedAt: day(3.5)}]);
  state = declined.state;
  assert.deepEqual(recommendations(state), [], 'no prompt on the next render');
  assert.equal(engine.declineVariationProgression(ringsDefinition(), state, {recommendationId: item.recommendationId, equipment: RINGS, now: day(3.6)}).status, 'already-declined');
  assert.equal(engine.confirmVariationProgression(ringsDefinition(), state, {recommendationId: item.recommendationId, equipment: RINGS, now: day(3.6)}).status, 'stale');
  for (let index = 4; index <= 5; index++) {
    ({state, history} = applyAll(state, dipSessions(index, 1), history));
    assert.deepEqual(recommendations(state), [], 'session '+index+' after declining');
  }
  ({state, history} = applyAll(state, dipSessions(6, 1), history));
  const [again] = recommendations(state);
  assert.equal(again.recommendationId, 'assisted-ring-dip-to-ring-dip@dip-6');
  assert.deepEqual(again.evidenceSessionResultIds, ['dip-4','dip-5','dip-6']);
});

test('confirming once changes the stable anchor, starts a distinct series and is idempotent', () => {
  let {state, history} = applyAll(begin(), dipSessions(1, 3));
  const [item] = recommendations(state), support = clone(anchor(state, 'anchor-support'));
  const confirmed = engine.confirmVariationProgression(ringsDefinition(), state, {recommendationId: item.recommendationId, equipment: RINGS, now: day(4)});
  assert.equal(confirmed.status, 'confirmed');
  const next = anchor(confirmed.state);
  assert.equal(next.exerciseId, 'ring-dip'); assert.equal(next.selectedAt, day(4));
  assert.deepEqual(next.currentTarget, item.startingTarget);
  assert.equal(next.comparisonBaseline, null);
  assert.ok(['suggestedLoad','loadUnit','loadInterpretation'].every(key => next[key] === undefined && next.currentTarget[key] === undefined));
  assert.deepEqual(next.variationProgression.evidence, []);
  assert.deepEqual(next.variationProgression.transitions.map(entry => [entry.transitionId, entry.fromExerciseId, entry.toExerciseId, entry.evidenceSessionResultIds]),
    [[item.recommendationId, 'foot-assisted-ring-dip', 'ring-dip', ['dip-1','dip-2','dip-3']]]);
  assert.equal(next.variationProgression.transitions[0].previousTarget.target.maxReps, 8);
  assert.deepEqual(anchor(confirmed.state, 'anchor-support'), support);
  assert.equal(confirmed.state.meaningfulSessionsCompleted, state.meaningfulSessionsCompleted);
  assert.deepEqual(confirmed.state.currentTargets.dose, state.currentTargets.dose);
  // Replay is a no-op; the original state is not mutated.
  const replay = engine.confirmVariationProgression(ringsDefinition(), confirmed.state, {recommendationId: item.recommendationId, equipment: RINGS, now: day(5)});
  assert.equal(replay.status, 'already-applied'); assert.deepEqual(replay.state, confirmed.state);
  assert.equal(anchor(state).exerciseId, 'foot-assisted-ring-dip');
  state = confirmed.state;
  // Planning prescribes the new exercise at its own starting target with no inherited load.
  const planned = engine.planNextSession(ringsDefinition(), state, history, {now: day(5), prescriptionId: 'rx-next', equipment: RINGS});
  const request = planned.prescription.requiredAnchors.find(entry => entry.requirementId === 'anchor-dip');
  assert.equal(request.exerciseId, 'ring-dip'); assert.deepEqual(request.target, {type: 'reps', minReps: 3, maxReps: 3});
  assert.equal(request.suggestedLoad, undefined);
  // An older, previously unapplied assisted result cannot rewrite the new series.
  const late = ringResult('late', day(3.5));
  const afterLate = engine.applySessionResult(ringsDefinition(), state, late, history);
  assert.deepEqual(anchor(afterLate), anchor(state));
  // Re-applying an applied result is still an exact no-op.
  assert.deepEqual(engine.applySessionResult(ringsDefinition(), state, history[2], history), state);
  // New-exercise work forms its own series; the assisted history is preserved unchanged.
  const ring = ringResult('ring-1', day(6), {exerciseId: 'ring-dip', planned: 3, values: [3, 3]});
  ({state, history} = applyAll(state, [ring], history));
  assert.equal(anchor(state).exerciseId, 'ring-dip');
  assert.deepEqual(anchor(state).variationProgression.evidence, [], 'no edge from ring dip means no new evidence record');
  const series = History.createHistory(history, catalogue).anchorPerformanceSeries('anchor-dip', {programmeInstanceId: 'rings-instance'});
  assert.deepEqual(series.map(group => [group.exerciseId, group.performances.length]), [['foot-assisted-ring-dip', 6], ['ring-dip', 2]]);
  // Explicit derived-state repair preserves the user's confirmed transition.
  const rebuilt = engine.rebuildDerivedState(ringsDefinition(), state, history);
  assert.deepEqual(rebuilt.anchors, state.anchors);
});

test('a recommendation made stale by newer evidence cannot be confirmed or declined', () => {
  let {state, history} = applyAll(begin(), dipSessions(1, 3));
  const [item] = recommendations(state);
  ({state, history} = applyAll(state, [ringResult('miss', day(4), {values: [10, 7]})], history));
  assert.deepEqual(recommendations(state), []);
  for (const method of ['confirmVariationProgression','declineVariationProgression']) {
    const outcome = engine[method](ringsDefinition(), state, {recommendationId: item.recommendationId, equipment: RINGS, now: day(5)});
    assert.equal(outcome.status, 'stale'); assert.deepEqual(outcome.state, state);
  }
  // A newer qualifying session also supersedes the old recommendation ID.
  ({state} = applyAll(begin(), dipSessions(1, 4)));
  assert.equal(recommendations(state)[0].recommendationId, 'assisted-ring-dip-to-ring-dip@dip-4');
  assert.equal(engine.confirmVariationProgression(ringsDefinition(), state, {recommendationId: item.recommendationId, equipment: RINGS, now: day(5)}).status, 'stale');
  assert.throws(() => engine.confirmVariationProgression(ringsDefinition(), state, {recommendationId: item.recommendationId, equipment: RINGS}), /explicit timestamp/);
  assert.throws(() => engine.variationProgressionRecommendations(ringsDefinition(), state, {}), /equipment/);
});

test('timed support holds use their own seconds threshold and never imply dip readiness', () => {
  const holds = (from, count, options = {}) => Array.from({length: count}, (_, index) => ringResult('hold-'+(from+index), day(from+index),
    {requirementId: 'anchor-support', exerciseId: 'foot-assisted-ring-support-hold', timed: true, values: [20, 20], ...options}));
  let {state, history} = applyAll(begin(), holds(1, 2));
  ({state, history} = applyAll(state, holds(3, 1, {status: 'partial', values: [20, 12]}), history));
  assert.equal(outcomes(state, 'anchor-support').at(-1), 'incomplete');
  ({state, history} = applyAll(state, holds(4, 3), history));
  const items = recommendations(state);
  assert.deepEqual(items.map(item => [item.requirementId, item.toExerciseId]), [['anchor-support', 'ring-support-hold']]);
  assert.equal(anchor(state).variationProgression, undefined, 'support-hold evidence never creates dip evidence');
  const confirmed = engine.confirmVariationProgression(ringsDefinition(), state, {recommendationId: items[0].recommendationId, equipment: RINGS, now: day(8)}).state;
  assert.equal(anchor(confirmed, 'anchor-support').exerciseId, 'ring-support-hold');
  assert.deepEqual(anchor(confirmed, 'anchor-support').currentTarget.target, {type: 'timed', seconds: 10});
  assert.equal(anchor(confirmed, 'anchor-support').currentTarget.prescriptionMode, 'time');
  assert.equal(anchor(confirmed).exerciseId, 'foot-assisted-ring-dip');
  const planned = engine.planNextSession(ringsDefinition(), confirmed, history, {now: day(9), prescriptionId: 'rx-hold', equipment: RINGS});
  assert.deepEqual(planned.prescription.requiredAnchors.find(item => item.requirementId === 'anchor-support').target, {type: 'timed', seconds: 10});
});

test('Coach Model validates the bounded variation namespace without breaking legacy records', () => {
  let {state} = applyAll(begin(), dipSessions(1, 3));
  assert.doesNotThrow(() => Model.assertValid('programme-state', state));
  const broken = change => { const copy = clone(state); change(anchor(copy).variationProgression, anchor(copy)); return copy; };
  for (const [change, pattern] of [
    [vp => { vp.exerciseId = 'ring-dip'; }, /must match the anchor exercise/],
    [vp => { vp.evidence = Array.from({length: 9}, (_, i) => ({...vp.evidence[0], sessionResultId: 's'+i})); }, /at most 8/],
    [vp => { vp.evidence[0].outcome = 'ready'; }, /outcome/],
    [vp => { vp.inferredNext = 'ring-dip'; }, /not a recognised field/],
    [vp => { vp.schemaVersion = 2; }, /schemaVersion/],
    [vp => { vp.declined = [{edgeId: 'a', recommendationId: 'a@1', declinedAt: START}, {edgeId: 'a', recommendationId: 'a@2', declinedAt: START}]; }, /duplicates edge/],
    [vp => { vp.transitions = [{transitionId: 't', edgeId: 'a', fromExerciseId: 'ring-dip', toExerciseId: 'ring-dip', confirmedAt: START, evidenceSessionResultIds: [], previousTarget: null}]; }, /must differ/]
  ]) assert.throws(() => Model.assertValid('programme-state', broken(change)), pattern);
});
