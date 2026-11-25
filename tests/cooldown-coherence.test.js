const test = require('node:test');
const assert = require('node:assert/strict');
const {loadAppContext} = require('./helpers/app-context');
const {anchor, prescription} = require('./helpers/coach-fixtures');

global.window = global;
require('../data/equipment');
require('../data/exercises');
require('../js/coach-model');
require('../js/generator');

const G = GarageFitGenerator;
const catalogue = GarageFitData.exercises;
const back = 'trx-lean-back-sink';
const floorGlute = 'glute-stretch';
const strapGlute = 'trx-glute-standing';
const fixture = (...stretches) => Object.fromEntries([
  ...Object.entries(catalogue).filter(([,exercise]) => !exercise.cooldown),
  ...stretches.map(id => [id,catalogue[id]])
]);
const ids = part => part.exercises.map(exercise => exercise.id);
const generate = (pool, draw, options) => G.generate({
  catalogue:pool, duration:10, equipment:['trx'], random:()=>draw, ...options
});

test('equivalent glute stretches favour the previous setup and retain both choices',()=>{
  const pool = fixture(back,floorGlute,strapGlute);
  // Both draws initially put the back stretch first and the floor stretch second.
  const preferred = generate(pool,.15);
  const varied = generate(pool,.10);
  assert.deepEqual(ids(preferred.cooldown),[back,strapGlute]);
  assert.deepEqual(ids(varied.cooldown),[back,floorGlute]);
  const unrefined = generate(fixture(back,floorGlute),.15);
  for (const section of ['warmup','rampup','main']) {
    assert.deepEqual(preferred[section],unrefined[section]);
  }
  assert.equal(preferred.estimatedSeconds,unrefined.estimatedSeconds);
  assert.equal(preferred.cooldown.estimatedSeconds,50);
  assert.equal(preferred.cooldown.restSeconds,5);
  const phases = Array.from(loadAppContext().buildGeneratedTimeline(preferred)
    .filter(phase=>phase.section==='cooldown'),
    phase=>[phase.exercise?.id || phase.kind,phase.seconds]);
  assert.deepEqual(phases,[[back,15],['rest',5],[strapGlute,15],[strapGlute,15]]);
});

test('a setup match cannot displace a stretch that supplies otherwise missing coverage',()=>{
  const w = generate(fixture(back,'runners-stretch',strapGlute),.15);
  assert.deepEqual(ids(w.cooldown),[back,'runners-stretch']);
  assert.equal(w.cooldown.estimatedSeconds,50);
});

test('cool-down ordering groups body positions inside the same setup',()=>{
  const pool = fixture('childs-pose','chest-opener','plank-calf-stretch');
  const draws = [];
  const w = generate(pool,.01,{duration:15,equipment:[],trace:event=>{
    if (event.phase==='cooldown'&&event.type==='pick') draws.push(event.picked.id);
  }});
  assert.deepEqual(draws,['childs-pose','chest-opener','plank-calf-stretch']);
  assert.deepEqual(ids(w.cooldown),['childs-pose','plank-calf-stretch','chest-opener']);
  assert.equal(w.cooldown.estimatedSeconds,55);
});

test('prescribed Coach generation uses the same preference and honours the available time',()=>{
  const pool = fixture(back,floorGlute,strapGlute);
  const rx = prescription({duration:10,equipment:['trx','dumbbells'],movementPriorities:[],
    requiredAnchors:[anchor({allowedProtocols:['rounds']})]});
  const options = {sessionPrescription:rx,equipment:rx.equipment};
  const w = generate(pool,.15,options);
  assert.deepEqual(ids(w.cooldown),[back,strapGlute]);
  assert.deepEqual(w.prescriptionOutcome.satisfiedHardRequirementIds,['req-1']);
  const tight = generate(pool,.15,{...options,sessionPrescription:{...rx,maximumDurationSeconds:550}});
  assert.ok(tight.estimatedSeconds<=550);
  assert.ok(tight.cooldown.estimatedSeconds<=550-tight.main.estimatedDurationSeconds
    -tight.warmup.estimatedSeconds-tight.rampup.estimatedSeconds);
});

test('a small seeded equipment matrix preserves eligibility, uniqueness and timing',()=>{
  for (const equipment of [[],['trx'],GarageFitData.equipment.map(item=>item.id)]) {
    for (const duration of [10,20]) {
      const run = () => {
        let state = duration;
        return G.generate({catalogue, duration, equipment, random:()=>{
          state = (state*1664525+1013904223)>>>0;
          return state/4294967296;
        }}).cooldown;
      };
      const part = run();
      assert.deepEqual(part,run());
      assert.ok(part.exercises.length);
      assert.ok(part.exercises.every(e=>G.generatedPhaseEligible(e,'cooldown',equipment)));
      assert.equal(new Set(part.exercises.map(e=>e.family||e.id)).size,part.exercises.length);
      assert.equal(part.estimatedSeconds,part.exercises.reduce((seconds,e)=>seconds+e.estimatedSeconds,0)
        +(part.exercises.length-1)*5);
      assert.ok(part.estimatedSeconds<=G.BUDGETS[duration].cooldown+5);
    }
  }
  const single = generate(fixture(back,'childs-pose'),.01,{equipment:[]}).cooldown;
  assert.deepEqual(ids(single),['childs-pose']);
  assert.equal(single.estimatedSeconds,15);
});
