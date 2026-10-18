const test = require('node:test');
const assert = require('node:assert/strict');
global.window = global;
require('../data/exercises.js');
require('../data/sport-profiles.js');
require('../data/sport-capabilities.js');
require('../js/coach-model.js');
require('../js/training-history.js');
require('../js/sport-coverage.js');
const {performance} = require('./helpers/coach-policy-fixtures');
const catalogue = GarageFitData.exercises, definition = GarageFitData.sportCapabilityPolicies.tennis[1];
const Policy = GarageFitSportCoverage, History = GarageFitTrainingHistory;
const policy = Policy.createPolicy(definition, catalogue);
const copy = value => JSON.parse(JSON.stringify(value));
const now = '2026-10-15T08:30:00Z';
const summary = (results = [], options = {}) => policy.summarize(History.createHistory(results,catalogue), {now,...options});
const cap = (view,id) => view.capabilities.find(item => item.capabilityId === id);
const result = (exerciseId, overrides = {}) => performance({
  plannedWork: [{occurrenceId:'main-1',exerciseId,section:'main',prescription:{type:'reps',reps:8,side:null,protocol:'rounds'}}],
  performedWork: [{occurrenceId:'main-1',exerciseId,status:'completed',sets:[]}], ...overrides
});

test('six reviewed capabilities are immutable/version-pinned, with core priorities and focus preferences retaining Balanced minimum', () => {
  assert.equal(policy.definition.version, 1);
  assert.deepEqual(definition.capabilities.map(c=>c.id), GarageFitData.sportProfiles.tennis.capabilities);
  assert.deepEqual(definition.capabilities.map(c=>c.priority), ['core','core','core','core','complementary','complementary']);
  assert.deepEqual(Object.keys(definition.focusPreferences), GarageFitData.sportProfiles.tennis.configuration.focuses);
  assert.ok(Object.isFrozen(definition.capabilities[0].mappings[0].exerciseIds));
  for (const focus of Object.keys(definition.focusPreferences)) {
    const view = summary([], {focus});
    assert.deepEqual(view.capabilities.filter(c=>c.preferred).map(c=>c.capabilityId).sort(), definition.focusPreferences[focus].slice().sort());
    assert.ok(view.capabilities.every(c=>c.balancedMinimum === 'positive-known-exposure'));
    assert.equal(view.capabilities.length,6);
  }
  assert.throws(()=>summary([], {focus:'mobility'}), /focus/);
  assert.throws(()=>policy.summarize(History.createHistory([], catalogue), {}), /time/);
  for (const mutate of [d=>d.version=0,d=>d.windowDays=0,d=>d.capabilities.push(d.capabilities[0]),
    d=>d.capabilities[0].priority='equal',d=>d.focusPreferences.power=['fake'],
    d=>d.capabilities[0].mappings[0].exerciseIds.push('air-squat'), d=>d.capabilities[0].mappings[0].facet='fake']) {
    const invalid=copy(definition); mutate(invalid); assert.throws(()=>Policy.createPolicy(invalid,catalogue),/Invalid/);
  }
});

test('reviewed catalogue identities resolve and never infer braking/power from broad patterns or planes', () => {
  for (const c of definition.capabilities) for (const m of c.mappings) for (const id of m.exerciseIds) {
    assert.ok(catalogue[id],id); assert.equal(catalogue[id].main,true,id);
    assert.ok(m.rationale.length>10);
  }
  const contributions = id => policy.classifyExercise(id).contributions;
  assert.deepEqual(contributions('reverse-lunge').map(c=>c.capabilityId), ['lower-body']);
  assert.ok(contributions('alternating-lateral-lunge').some(c=>c.facet==='lateral-control'));
  assert.ok(!contributions('alternating-lateral-lunge').some(c=>c.facet==='lateral-braking'));
  assert.ok(contributions('skater-jumps').some(c=>c.facet==='lateral-braking'));
  for (const id of ['dumbbell-wood-chop','band-pallof-press','trx-power-pull','kettlebell-russian-twist']) {
    assert.ok(contributions(id).some(c=>c.capabilityId==='trunk'));
    assert.ok(!contributions(id).some(c=>c.capabilityId==='power'));
  }
  assert.ok(contributions('dumbbell-reverse-fly').some(c=>c.facet==='shoulder-support'));
  assert.ok(contributions('dead-bug').some(c=>c.facet==='control'));
  assert.equal(policy.classifyExercise('dumbbell-hammer-curl').status,'unmapped');
  assert.equal(policy.classifyExercise('not-real').status,'unknown-exercise');
  assert.equal(policy.classifyExercise('toString').status,'unknown-exercise');
  assert.equal(policy.classifyExercise('skater-jumps').tennisImprovement,'unproven');
});

test('performed-only exact rolling two-week window is deterministic, inclusive and ignores unknown/future timestamps', () => {
  const dated = (id,date) => result('dead-bug',{sessionResultId:id,startedAt:date,endedAt:date});
  const results = [dated('boundary','2026-10-01T08:30:00Z'),dated('old','2026-10-01T08:29:59Z'),
    dated('now',now),dated('future','2026-10-15T08:30:01Z'),dated('unknown',null)];
  const view=summary([...results,results[0]]);
  assert.equal(cap(view,'trunk').exposure.value,2);
  assert.deepEqual(cap(view,'trunk').observations.map(item=>item.sessionResultId), ['boundary','now']);
  assert.deepEqual(view,summary(results.reverse()));
  assert.equal(view.window.days,14);
  assert.ok(Object.isFrozen(cap(view,'trunk').observations));
  const next=summary(results,{now:'2026-11-01T08:30:00Z'});
  assert.ok(next.capabilities.every(c=>c.coverage==='not-observed'));
  assert.ok(next.capabilities.every(c=>!('debt' in c)));
});

test('previews, prescriptions, skipped outcomes, external activities and unconfirmed identity award nothing', () => {
  const results=[result('dead-bug',{sessionResultId:'preview',performedWork:null}),
    result('dead-bug',{sessionResultId:'skipped',performedWork:[{occurrenceId:'main-1',exerciseId:'dead-bug',status:'skipped'}]}),
    result('dead-bug',{sessionResultId:'unconfirmed',performedWork:[{occurrenceId:'main-1',exerciseId:'dead-bug',status:null}]}),
    result('dead-bug',{sessionResultId:'external',source:'external',programmeInstanceId:null,prescriptionId:null}),
    result('dead-bug',{sessionResultId:'identity',performedWork:[{occurrenceId:'main-1',exerciseId:null,status:'completed'}]})];
  assert.equal(summary(results).uniqueExposure.value,0);
  assert.equal(summary(results).unclassifiedObservations[0].classification.status,'unknown-exercise');
  assert.ok(summary(results).capabilities.every(c=>c.coverage==='not-observed'));
  // A different/incomplete history catalogue must not fabricate semantics.
  assert.equal(policy.summarize(History.createHistory([result('dead-bug')],{}),{now}).uniqueExposure.value,0);
});

test('partial confidence, explicit zero and unilateral sides remain occurrence exposure, never multiplied into sets', () => {
  const outcomes=[
    {occurrenceId:'left',exerciseId:'reverse-lunge',status:'completed',sets:[{reps:8}]},
    {occurrenceId:'right',exerciseId:'reverse-lunge',status:'partial',sets:[{reps:4}]},
    {occurrenceId:'unknown',exerciseId:'reverse-lunge',status:'partial',sets:[]},
    {occurrenceId:'zero',exerciseId:'reverse-lunge',status:'completed',sets:[{reps:0}]}];
  const r=result('reverse-lunge',{performedWork:outcomes,plannedWork:outcomes.map((o,i)=>({occurrenceId:o.occurrenceId,
    exerciseId:o.exerciseId,section:'main',prescription:{type:'unilateral-reps',reps:8,side:i===0?'left':'right'}}))});
  const c=cap(summary([r]),'lower-body');
  assert.deepEqual(c.exposure,{value:1.5,confidence:'unknown'});
  assert.equal(c.observations.length,4); assert.equal(c.observations[0].side,'left');
  const unknown=cap(summary([result('dead-bug',{performedWork:[{occurrenceId:'main-1',exerciseId:'dead-bug',status:'partial',sets:[]}]})]),'trunk');
  assert.equal(unknown.coverage,'unknown'); assert.equal(unknown.exposure.confidence,'unknown');
  const timed=result('plank',{plannedWork:[{occurrenceId:'main-1',exerciseId:'plank',section:'main',prescription:{type:'timed',seconds:40}}],
    performedWork:[{occurrenceId:'main-1',exerciseId:'plank',status:'partial',sets:[{seconds:10}]}]});
  assert.equal(cap(summary([timed]),'trunk').exposure.value,.25);
});

test('actual substitutes classify independently of planned identity; overlapping capabilities have unique global exposure', () => {
  const r=result('reverse-lunge',{performedWork:[{occurrenceId:'main-1',exerciseId:'skater-jumps',status:'completed',sets:[]}]});
  const view=summary([r]);
  assert.equal(cap(view,'lower-body').exposure.value,0);
  assert.equal(cap(view,'lateral-movement').exposure.value,1);
  assert.equal(cap(view,'power').exposure.value,1);
  assert.equal(view.uniqueExposure.value,1);
  assert.equal(cap(summary([r],{smallSpace:true,allowedImpact:['low','medium']}),'lateral-movement').exposure.value,1);
  assert.equal(cap(summary([r],{smallSpace:true,allowedImpact:['low','medium']}),'lateral-movement').achievable,false);
  assert.match(view.interpretation,/must not be added/);
  const before=copy(r); summary([r]); assert.deepEqual(r,before);
});

test('scope preserves programme and standalone semantics and excludes preparation by default', () => {
  const coach=result('dead-bug'), other=result('dead-bug',{sessionResultId:'other',programmeInstanceId:'other'});
  const standalone=result('dead-bug',{sessionResultId:'standalone',source:'generator',programmeInstanceId:null,prescriptionId:null});
  const prep=result('dead-bug',{sessionResultId:'prep',plannedWork:[{occurrenceId:'main-1',exerciseId:'dead-bug',section:'warmup'}]});
  const results=[coach,other,standalone,prep];
  assert.equal(cap(summary(results),'trunk').exposure.value,3);
  assert.equal(cap(summary(results,{programmeInstanceId:'test-instance'}),'trunk').exposure.value,1);
  assert.equal(cap(summary(results,{programmeInstanceId:'test-instance',includeStandalone:true}),'trunk').exposure.value,2);
  assert.equal(cap(summary(results,{sections:['warmup']}),'trunk').exposure.value,1);
});

test('equipment, impact, space, unsupported protocols and missing mappings explain achievable limits without awarding credit', () => {
  const bodyweight=policy.availability({equipment:[]});
  assert.ok(bodyweight.every(c=>c.achievable));
  const kit=policy.availability({equipment:['dumbbells','kettlebell','trx','pullup-bar']});
  const trunk=kit.find(c=>c.capabilityId==='trunk');
  assert.equal(trunk.candidates.find(c=>c.exerciseId==='band-pallof-press').available,false);
  assert.ok(trunk.candidates.find(c=>c.exerciseId==='dumbbell-plank-pull-through').available);
  const constrained=policy.availability({equipment:[],smallSpace:true,allowedImpact:['low','medium']});
  const lateral=constrained.find(c=>c.capabilityId==='lateral-movement');
  assert.equal(lateral.achievable,false); assert.deepEqual(lateral.missingFacets,['lateral-control','lateral-braking']);
  assert.deepEqual(lateral.candidates.find(c=>c.exerciseId==='skater-jumps').reasons,['impact','space']);
  assert.equal(constrained.find(c=>c.capabilityId==='power').achievable,false);
  assert.ok(kit.find(c=>c.capabilityId==='power').missingFacets.includes('rotational-power'));
  assert.ok(kit.find(c=>c.capabilityId==='endurance').missingFacets.includes('match-repeated-efforts'));
  assert.ok(summary([],{equipment:['dumbbells','kettlebell','trx','pullup-bar']}).capabilities.every(c=>c.coverage==='not-observed'));
  const missing=copy(catalogue); delete missing['dead-bug']; missing.plank.mainProtocols=['timed_intervals'];
  const changed=Policy.createPolicy(definition,missing);
  const candidates=changed.availability().find(c=>c.capabilityId==='trunk').candidates;
  assert.deepEqual(candidates.find(c=>c.exerciseId==='dead-bug').reasons,['missing-catalogue-exercise']);
  assert.deepEqual(candidates.find(c=>c.exerciseId==='plank').reasons,['unsupported-protocol']);
  assert.throws(()=>policy.availability({allowedImpact:['none']}), /constraints/);
});


test('policy snapshots preserve versioned membership and constraints without mutating inputs', () => {
  const d=copy(definition), c=copy(catalogue), before=copy({d,c});
  const pinned=Policy.createPolicy(d,c);
  assert.deepEqual({d,c},before);
  d.capabilities[0].mappings[0].exerciseIds=[]; delete c['dead-bug'];
  assert.equal(pinned.classifyExercise('dead-bug').status,'mapped');
  assert.equal(pinned.classifyExercise('air-squat').status,'mapped');
  assert.ok(Object.isFrozen(pinned.definition.focusPreferences.power));
  const unmapped=summary([result('dumbbell-hammer-curl')]);
  assert.equal(unmapped.uniqueExposure.value,0);
  assert.equal(unmapped.unclassifiedObservations[0].classification.status,'unmapped');
});

test('v2 home mapping exposes controlled lateral loading only, with performed-only facet credit',()=>{
  const home=Policy.createPolicy(GarageFitData.sportCapabilityPolicies.tennis[2],catalogue);
  const available=home.availability({smallSpace:true,equipment:['kettlebell'],allowedImpact:['low','medium']});
  const lateral=available.find(c=>c.capabilityId==='lateral-movement');
  for(const id of ['alternating-lateral-lunge','cossack-squat','kettlebell-lateral-lunge']) {
    assert.ok(lateral.candidates.find(c=>c.exerciseId===id).available,id);
    assert.deepEqual(home.classifyExercise(id).contributions.filter(c=>c.capabilityId==='lateral-movement').map(c=>c.facet),['lateral-control']);
  }
  assert.deepEqual(lateral.missingFacets,['lateral-braking']);
  assert.ok(lateral.candidates.filter(c=>['banded-lateral-walk','skater-jumps'].includes(c.exerciseId)).every(c=>!c.available&&c.reasons.includes('space')));
  assert.ok(!home.availability({smallSpace:true}).find(c=>c.capabilityId==='lateral-movement').candidates.find(c=>c.exerciseId==='kettlebell-lateral-lunge').available);
  assert.equal(home.availability({smallSpace:true,allowedImpact:['low']}).find(c=>c.capabilityId==='lateral-movement').achievable,false);
  const view=results=>home.summarize(History.createHistory(results,catalogue),{now,smallSpace:true});
  const performed=result('alternating-lateral-lunge');
  assert.equal(cap(view([{...performed,performedWork:[]}]),'lateral-movement').coverage,'not-observed');
  const observed=cap(view([performed]),'lateral-movement');
  assert.equal(observed.coverage,'observed');
  assert.ok(observed.facets.find(f=>f.facet==='lateral-control').exposure.value>0);
  assert.equal(observed.facets.find(f=>f.facet==='lateral-braking').exposure.value,0);
  assert.deepEqual(observed.missingFacets,['lateral-braking']);
  assert.equal(cap(home.summarize(History.createHistory([performed],catalogue),{now:'2026-11-01T08:30:00Z',smallSpace:true}),'lateral-movement').coverage,'not-observed');
  assert.ok(policy.availability({smallSpace:true}).find(c=>c.capabilityId==='lateral-movement').candidates.every(c=>!c.available),'v1 retains its old footprint');
  assert.ok(!home.classifyExercise('reverse-lunge-knee-drive').contributions.some(c=>['power','lateral-movement'].includes(c.capabilityId)));
});
