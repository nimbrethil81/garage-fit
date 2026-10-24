const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fixtures = require('./helpers/coach-fixtures.js');
const {loadAppContext} = require('./helpers/app-context.js');

global.window = global;
for (const path of ['data/equipment','data/exercises','js/generator','js/coach-model','js/coach-store','js/session-tracker','js/training-history']) require('../'+path+'.js');
const G = GarageFitGenerator, Tracker = GarageFitSessionTracker, Model = GarageFitCoachModel, History = GarageFitTrainingHistory;
const catalogue = GarageFitData.exercises;
const kit = GarageFitData.equipment.map(item => item.id);
const copy = value => JSON.parse(JSON.stringify(value));
function random(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
function block(ids = ['push-up','plank'], minutes = 5) {
  return {id:'main-1',protocol:'emom',intent:'conditioning',exercises:ids.map(id => copy(catalogue[id])),
    prescription:{minutes,slotSeconds:60,targets:ids.map(id => copy(catalogue[id].prescription))}};
}
function plan(b = block()) {
  const phases = G.resolveBlockSteps(b).map(step => ({...step,section:'main',blockIndex:0,protocol:'emom',
    protocolConditions:G.protocolConditions(b),exercise:b.exercises[step.exerciseIndex]}));
  phases.forEach(phase => { phase.occurrenceId = Tracker.occurrenceIdFor(phase); });
  return Tracker.plannedWorkFromTimeline(phases);
}
class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key,value) { this.map.set(key,String(value)); }
  removeItem(key) { this.map.delete(key); }
}
const rx = overrides => fixtures.prescription({requiredAnchors:[],movementPriorities:[],equipment:kit,...overrides});

test('EMOM has a bounded prescription, exact minute windows and immutable ordered targets', () => {
  const b = block(), before = copy(b), steps = G.resolveBlockSteps(b);
  assert.deepEqual(G.validateMain({blocks:[b]},catalogue,kit,300),[]);
  assert.equal(G.estimateBlockDuration(b),300);
  assert.equal(G.blockRepeatCount(b),5);
  assert.deepEqual(steps.map(step => [step.exerciseIndex,step.minute,step.slotIndex,step.startsAtSeconds,step.endsAtSeconds]),
    [[0,1,0,0,60],[1,2,1,60,120],[0,3,2,120,180],[1,4,3,180,240],[0,5,4,240,300]]);
  steps.forEach((step,index) => {
    assert.equal(step.kind,'exercise');
    assert.equal(step.completion,'explicit');
    assert.ok(Object.isFrozen(step) && Object.isFrozen(step.target));
    assert.deepEqual(step.target,b.prescription.targets[index % 2]);
    assert.equal(step.timed,index % 2 === 1);
    assert.equal(step.seconds,index % 2 === 1 ? 30 : undefined);
  });
  assert.deepEqual(b,before);
  assert.ok(steps.every(step => !step.kind.includes('rest')), 'remaining recovery depends on the actual finish');
});

test('normalisation preserves explicit targets, recomputes duration, and adds only the external transition', () => {
  const first = block(), second = block(['jumping-jacks'],2);
  first.estimatedDurationSeconds = 1;
  const input = {schemaVersion:2,main:{blocks:[first,second]}};
  const normal = G.normaliseWorkout(input);
  assert.equal(normal.schemaVersion,2);
  assert.equal(normal.main.estimatedDurationSeconds,423);
  assert.equal(normal.main.blocks[0].estimatedSeconds,300);
  assert.notEqual(normal.main.blocks[0].prescription.targets,first.prescription.targets);
  assert.deepEqual(G.validateMain(normal.main,catalogue,kit,423),[]);
  assert.ok(G.validateMain(normal.main,catalogue,kit,422).includes('main:duration-over-budget'));
  const conditions = G.protocolConditions(first);
  conditions.targets[0].value = 1;
  assert.equal(first.prescription.targets[0].value,10);
});

test('malformed and unbounded EMOM prescriptions fail centrally without executable steps', () => {
  const mutations = [
    b => { delete b.prescription.minutes; },
    ...[0,-1,1.5,13,Infinity,'5'].map(value => b => { b.prescription.minutes = value; }),
    ...[undefined,0,59,61,'60'].map(value => b => { b.prescription.slotSeconds = value; }),
    b => { b.prescription.rounds = 5; },
    b => { b.prescription.workSeconds = 30; },
    b => { b.prescription.targets = []; },
    b => { b.prescription.targets = null; },
    b => { b.prescription.targets[0] = null; },
    ...[0,-1,1.5,11,Infinity,'10'].map(value => b => { b.prescription.targets[0].value = value; }),
    b => { b.prescription.targets[0].type = 'timed'; },
    b => { b.prescription.targets[0].restSeconds = 20; },
    b => { b.prescription.targets[1].value = 60; },
    b => { b.exercises = []; },
    b => { b.exercises = null; },
    b => { b.exercises = {}; },
    b => { b.exercises[0] = null; },
    b => { b.exercises.push(copy(b.exercises[0]));b.prescription.targets.push(copy(b.prescription.targets[0])); },
    b => { b.prescription.minutes = 1; },
    b => { b.exercises = Array(4).fill(b.exercises[0]); },
  ];
  mutations.forEach((mutate,index) => {
    const b = block(); mutate(b);
    assert.ok(G.validateEmomBlock(b).length,'case '+index);
    assert.ok(G.validateMain({blocks:[b]},catalogue,kit).length,'case '+index);
    assert.equal(G.estimateBlockDuration(b),0,'case '+index);
    assert.deepEqual(G.resolveBlockSteps(b),[],'case '+index);
    assert.throws(() => G.normaliseWorkout({main:{blocks:[b]}}),/Invalid EMOM/,'case '+index);
  });
});

test('first-wave eligibility rejects heavy, technical, per-side, high-impact and incompatible work', () => {
  for (const id of ['barbell-deadlift','barbell-clean','goblet-squat','kettlebell-swing','dumbbell-thruster','dumbbell-snatch',
    'side-plank','reverse-lunge','walking-lunge','pull-up','burpees','box-jumps','glute-bridge']) {
    assert.equal(G.protocolCompatible(catalogue[id],'emom'),false,id);
    const b = block([id]);
    assert.ok(G.validateEmomBlock(b,catalogue).length,id);
    assert.equal(G.estimateBlockDuration(b),0,id);
  }
  for (const id of ['push-up','plank','air-squat','band-row','trx-row','jumping-jacks','mountain-climbers'])
    assert.equal(G.protocolCompatible(catalogue[id],'emom'),true,id);
  const b = block(['band-row']);
  assert.ok(G.validateMain({blocks:[b]},catalogue,[]).includes('main-1:equipment:band-row'));
  // A copied block cannot disguise a canonical unsafe exercise as a safe one.
  const unsafe = block(['barbell-deadlift']);
  Object.assign(unsafe.exercises[0],copy(catalogue['push-up']),{id:'barbell-deadlift'});
  assert.ok(G.validateMain({blocks:[unsafe]},catalogue,kit).some(issue => issue.includes('ineligible')));
});

test('unknown safety metadata, overlong estimates, and blanket EMOM catalogue opt-ins cannot bypass policy', () => {
  for (const patch of [{difficulty:null},{impact:null},{strength:null},{equipment:'bands'},{sidedness:'per-side'},{unilateral:true},{estimatedSeconds:41},
    {estimatedSeconds:NaN},{prescription:{type:'distance',value:10}},{mainProtocols:['emom']},{main:false},{generator:false}]) {
    const b = block(['push-up']); Object.assign(b.exercises[0],patch);
    assert.equal(G.protocolCompatible(b.exercises[0],'emom'),false,JSON.stringify(patch));
    assert.ok(G.validateEmomBlock(b).length);
  }
  const timed = block(['plank']);
  timed.exercises[0].prescription.value = 60;timed.prescription.targets[0].value = 60;
  assert.ok(G.validateEmomBlock(timed).length);
  const capped = block(['mountain-climbers','trx-mountain-climber']);
  capped.exercises[1].frequency = 'occasional';
  assert.ok(G.validateEmomBlock(capped).some(issue => issue.startsWith('family-cap')));
});

test('explicit reduced occurrence targets never mutate the canonical prescription', () => {
  const b = block();b.prescription.targets = [{type:'reps',value:6},{type:'timed',value:20}];
  assert.deepEqual(G.validateMain({blocks:[b]},catalogue,kit),[]);
  const work = plan(b);
  assert.equal(work[0].prescription.reps,6);
  assert.equal(work[1].prescription.seconds,20);
  assert.equal(work[0].prescription.target.value,6);
  assert.equal(catalogue['push-up'].prescription.value,10);
  assert.equal(catalogue.plank.prescription.value,30);
  assert.deepEqual(work.map(item => item.prescription.minute),[1,2,3,4,5]);
  assert.equal(new Set(work.map(item => item.occurrenceId)).size,5);
  assert.equal(work[0].occurrenceId,'main:b0:m1:slot0:e0');
  assert.equal(Tracker.occurrenceIdFor({section:'main',blockIndex:0,exerciseIndex:0,round:1}),'main:b0:r1:e0');
});

test('planned EMOM work rejects missing targets or ambiguous minute windows', () => {
  const b = block(), step = G.resolveBlockSteps(b)[0];
  const phase = {...step,section:'main',blockIndex:0,protocol:'emom',exercise:b.exercises[0],occurrenceId:'main:b0:m1:slot0:e0'};
  for (const patch of [{target:null},{minute:null},{slotIndex:1},{startsAtSeconds:1},{endsAtSeconds:61},
    {target:{type:'timed',value:60}},{target:{type:'reps',value:1.5}}])
    assert.throws(() => Tracker.plannedWorkFromTimeline([{...phase,...patch}]),/explicit minute/);
});

test('bounded candidates fit short and long budgets, reserve transitions and remain seed deterministic', () => {
  for (const seconds of [60,119,120,299,420,600,870,1325,2015]) for (const seed of [1,19,57]) {
    const options = {catalogue,equipment:kit,availableSeconds:seconds,random:random(seed)};
    const a = G.buildEmomBlock(options), b = G.buildEmomBlock({...options,random:random(seed)});
    assert.ok(a);assert.deepEqual(a,b);
    assert.equal(a.estimatedSeconds,Math.min(12,Math.floor(seconds/60))*60);
    assert.ok(a.estimatedSeconds <= seconds);
    assert.deepEqual(G.validateMain({blocks:[a]},catalogue,kit,seconds).filter(issue => issue !== 'main:duration-out-of-tolerance'),[]);
    assert.equal(G.resolveBlockSteps(a).length,a.prescription.minutes);
  }
  const prefix = {id:'main-1',protocol:'rounds',intent:'strength',exercises:[copy(catalogue['push-up'])],prescription:{rounds:1,exerciseRestSeconds:0,roundRestSeconds:0}};
  assert.equal(G.buildEmomBlock({catalogue,equipment:[],availableSeconds:87,blocks:[prefix]}),null);
  const b = G.buildEmomBlock({catalogue,equipment:[],availableSeconds:88,blocks:[prefix]});
  assert.equal(b.id,'main-2');assert.equal(b.estimatedSeconds,60);
});

test('empty and small candidate pools fail or rotate without unbounded searches', () => {
  assert.equal(G.buildEmomBlock({catalogue:{},availableSeconds:600}),null);
  for (const seconds of [0,-1,59,NaN,Infinity,undefined]) assert.equal(G.buildEmomBlock({catalogue,availableSeconds:seconds}),null);
  assert.equal(G.buildEmomBlock({catalogue:{x:catalogue['barbell-deadlift']},equipment:kit,availableSeconds:600}),null);
  const one = {'push-up':catalogue['push-up']},before = copy(one);
  const b = G.buildEmomBlock({catalogue:one,availableSeconds:2015});
  assert.equal(b.exercises.length,1);assert.equal(b.prescription.minutes,12);
  assert.deepEqual(G.resolveBlockSteps(b).map(step => step.exerciseIndex),Array(12).fill(0));
  assert.deepEqual(one,before);
  assert.equal(G.buildEmomBlock({catalogue:{'band-row':catalogue['band-row']},availableSeconds:120,equipment:[]}),null);
});

test('Coach rejects EMOM anchors without drawing randomness', () => {
  const prescriptions = [rx({requiredAnchors:[fixtures.anchor({exerciseId:'push-up',allowedProtocols:['emom']})]})];
  for (const prescription of prescriptions) {
    assert.equal(Model.validate('session-prescription',prescription).valid,true);
    const options = {catalogue,sessionPrescription:prescription,random:() => { throw new Error('random draw'); }};
    assert.equal(G.assessSessionPrescription(options).status,'infeasible');
    assert.throws(() => G.generate(options),G.SessionPrescriptionError);
    assert.equal(G.buildEmomBlock({...options,availableSeconds:600}),null);
  }
  assert.deepEqual([...G.GENERATED_PROTOCOLS],['rounds','paired_sets','timed_intervals','emom','ladder','pyramid','complex','density','amrap']);
});

test('explicit optional EMOM candidates preserve Coach anchors, hard avoids, protocol and time constraints', () => {
  const prescription = rx({requiredAnchors:[fixtures.anchor({allowedProtocols:['rounds']})],mainTimeLimitSeconds:600,
    protocolConstraints:[{requirementId:'optional-patterns',importance:'hard',allowedProtocols:['rounds','emom']}],
    avoidConstraints:[{requirementId:'avoid-push',importance:'hard',pattern:'push'}]});
  const options = {catalogue,sessionPrescription:prescription,availableSeconds:1000,random:random(1)};
  const assessment = G.assessSessionPrescription(options);
  assert.equal(assessment.status,'feasible');
  const candidate = G.buildEmomBlock(options);
  assert.ok(candidate);
  assert.ok(candidate.estimatedSeconds+assessment.requiredMainSeconds+G.BLOCK_TRANSITION_SECONDS<=600);
  assert.ok(candidate.exercises.every(exercise => exercise.id !== 'goblet-squat' && !exercise.patterns.includes('push') && !exercise.coachAnchor));
  const automatic = G.generate({...options,random:random(1)});
  assert.ok(automatic.main.blocks.some(block => block.protocol === 'emom'));
  assert.ok(automatic.main.blocks.filter(block=>block.protocol==='emom').every(block=>G.validateEmomBlock(block,catalogue).length===0));
  assert.ok(automatic.prescriptionOutcome.requiredAnchorPlacements.every(placement => placement.protocol === 'rounds'));
  assert.equal(G.buildEmomBlock({...options,blocks:[]}),null,'required prefix cannot be dropped');
  assert.equal(G.buildEmomBlock({...options,sessionPrescription:{...prescription,mainTimeLimitSeconds:assessment.requiredMainSeconds+62}}),null);
  assert.equal(G.buildEmomBlock({...options,sessionPrescription:{...prescription,protocolConstraints:[{requirementId:'rounds-only',importance:'hard',allowedProtocols:['rounds']}]}}),null);
  const capped = G.buildEmomBlock({...options,sessionPrescription:{...prescription,maximumDurationSeconds:800}});
  assert.ok(capped);
  assert.ok(capped.estimatedSeconds+assessment.requiredMainSeconds+G.BLOCK_TRANSITION_SECONDS
    +G.BUDGETS[30].warmup+G.BUDGETS[30].rampup+G.BUDGETS[30].cooldown<=800);
});

test('the player retains the explicit EMOM minute windows and occurrence targets', () => {
  const context = loadAppContext();context.emom = block();
  const phases=vm.runInContext('var emomTimeline=[];appendBlockTimeline(emomTimeline,emom,0,1);emomTimeline',context);
  assert.deepEqual(copy(Tracker.plannedWorkFromTimeline(phases)),plan());
  assert.ok(phases.every(phase=>Object.isFrozen(phase.target)));
});

test('EMOM planning alone earns no work; timed overrun is capped to the occurrence target', async () => {
  const plannedWork = plan(), clock = () => new Date('2026-10-17T10:00:00Z');
  const tracker = Tracker.createTracker({store:GarageFitCoachStore.createStore(new MemoryStorage()),source:'generator',workoutId:'emom',plannedWork,clock});
  await tracker.start();
  assert.deepEqual(tracker.performedWork(),[]);
  assert.throws(() => tracker.recordTimed(plannedWork[0].occurrenceId,{plannedSeconds:60,elapsedSeconds:60}),/rep work/);
  await tracker.recordTimed(plannedWork[1].occurrenceId,{plannedSeconds:600,elapsedSeconds:600});
  await tracker.recordPartial(plannedWork[0].occurrenceId,{sets:[{reps:3}]});
  await tracker.recordSkip(plannedWork[2].occurrenceId);
  const result = await tracker.exitEarly({meaningful:() => true});
  assert.equal(result.performedWork.length,2);
  assert.deepEqual(result.performedWork.find(work => work.occurrenceId === plannedWork[1].occurrenceId).sets,[{seconds:30}]);
  assert.equal(result.performedWork.some(work => work.occurrenceId === plannedWork[3].occurrenceId),false);
  assert.equal(Model.validate('session-result',result).valid,true);
  assert.equal(result.schemaVersion,1);
  const history = History.createHistory([result],catalogue);
  assert.equal(history.performances.length,2);
  assert.deepEqual(history.performances.map(performance => performance.exposure.value),[.3,1]);
});

test('EMOM history remains explicitly incomparable with unknown work/recovery conditions and other protocols', () => {
  const performance = {exerciseId:'push-up',prescriptionMode:'reps',protocol:'emom',side:null,protocolConditions:G.protocolConditions(block()),sets:[]};
  for (const previous of [performance,{...performance,protocolConditions:null},{...performance,protocol:'rounds'},
    {...performance,protocol:'timed_intervals'}]) {
    const comparison = History.comparePerformances(previous,performance);
    assert.equal(comparison.comparable,false);
    assert.ok(comparison.reasons.includes('unknown-protocol-conditions'));
    assert.equal(History.comparePerformanceEvidence(previous,performance).change,'incomparable');
  }
});
