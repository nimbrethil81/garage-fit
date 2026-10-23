// Coach 0: characterisation of standalone Generator behaviour (no Session Prescription).
// Locks seeded decision flow so later Coach work cannot silently change it. Fixtures are
// regenerated only for an intended, explained generator change:
//   CHARACTERISE_DUMP=1 node tests/coach-generator-characterisation.test.js
// Deliberately excluded: workout id (Date.now), estimates, display text and full exercise objects.
const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

// Pin policy with its original input; C1 reachability tests use the expanded catalogue.
const catalogue = require('./helpers/coach-fixtures').catalogueBeforeC1(GarageFitData.exercises);
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }

const KIT = ['dumbbells','kettlebell','pullup-bar','trx','barbell','bench','box','bands'];
// [label, options]; options.seed feeds the seeded random source.
const CASES = [
  ['10 strength normal full-body bodyweight', {duration:10,focus:'strength',equipment:[],seed:11}],
  ['10 balanced easy upper bodyweight',       {duration:10,focus:'balanced',difficulty:'easy',bodyFocus:'upper',equipment:[],seed:12}],
  ['10 cardio hard core dumbbells',           {duration:10,focus:'cardio',difficulty:'hard',bodyFocus:'core',equipment:['dumbbells'],seed:13}],
  ['20 strength normal lower kettlebell',     {duration:20,focus:'strength',bodyFocus:'lower',equipment:['kettlebell'],seed:21}],
  ['20 balanced normal full-body dumbbells',  {duration:20,focus:'balanced',bodyFocus:'full-body',equipment:['dumbbells'],seed:22}],
  ['20 cardio easy full-body bodyweight',     {duration:20,focus:'cardio',difficulty:'easy',equipment:[],seed:23}],
  ['20 balanced hard upper pullup+trx',       {duration:20,focus:'balanced',difficulty:'hard',bodyFocus:'upper',equipment:['pullup-bar','trx'],seed:24}],
  ['20 strength normal default (no options)', {duration:20,focus:'strength',equipment:['dumbbells','bench'],seed:25}],
  ['45 strength hard lower full kit',         {duration:45,focus:'strength',difficulty:'hard',bodyFocus:'lower',equipment:KIT,seed:41}],
  ['45 balanced normal full-body full kit',   {duration:45,focus:'balanced',equipment:KIT,seed:42}],
  ['45 cardio normal core dumbbells+bands',   {duration:45,focus:'cardio',bodyFocus:'core',equipment:['dumbbells','bands'],seed:43}],
  ['45 balanced easy upper bodyweight',       {duration:45,focus:'balanced',difficulty:'easy',bodyFocus:'upper',equipment:[],seed:44}],
  ['45 strength normal full-body kettlebell', {duration:45,focus:'strength',bodyFocus:'full-body',equipment:['kettlebell'],seed:45}]
];

function rx(p) { return p ? [p.type,p.value].join(':') : '-'; }
// Stable behavioural summary: protocol/prescription structure, ordered ids, section identity.
function summarise(workout) {
  const ids = section => workout[section].exercises.map(ex=>ex.id).join(',');
  const lines = [
    'warmup ' + ids('warmup'),
    'rampup ' + ids('rampup')
  ];
  workout.main.blocks.forEach(block => {
    lines.push([block.protocol,block.intent,JSON.stringify(block.prescription)].join(' | ') + ' :: ' +
      block.exercises.map(ex=>ex.id+'@'+rx(ex.prescription)).join(','));
  });
  lines.push('cooldown ' + ids('cooldown'));
  return lines;
}
function run(options) {
  const {seed,...rest} = options;
  return GarageFitGenerator.generate(Object.assign({catalogue,random:random(seed)},rest));
}

if (process.env.CHARACTERISE_DUMP) {
  console.log(JSON.stringify(Object.fromEntries(CASES.map(([label,options])=>[label,summarise(run(options))])),null,2));
  process.exit(0);
}

const EXPECTED = require('./fixtures/coach-generator-characterisation.json');

test('characterisation matrix covers the required dimensions', () => {
  const opts = CASES.map(([,o])=>o);
  assert.deepEqual([...new Set(opts.map(o=>o.duration))].sort((a,b)=>a-b),[10,20,45]);
  assert.deepEqual([...new Set(opts.map(o=>o.focus))].sort(),['balanced','cardio','strength']);
  assert.deepEqual([...new Set(opts.map(o=>o.difficulty||'normal'))].sort(),['easy','hard','normal']);
  assert.deepEqual([...new Set(opts.map(o=>o.bodyFocus||'full-body'))].sort(),['core','full-body','lower','upper']);
  assert.ok(opts.some(o=>!o.equipment.length) && opts.some(o=>o.equipment.length>=KIT.length) && opts.some(o=>o.equipment.length===1));
  assert.deepEqual(Object.keys(EXPECTED),CASES.map(([label])=>label));
});

for (const [label,options] of CASES) {
  test('standalone Generator output is stable: ' + label, () => {
    assert.deepEqual(summarise(run(options)),EXPECTED[label]);
  });
}

test('standalone generation is repeatable for the same seed and sensitive to the seed', () => {
  const [,options] = CASES[9];
  assert.deepEqual(summarise(run(options)),summarise(run(options)));
  assert.notDeepEqual(summarise(run(options)),summarise(run(Object.assign({},options,{seed:options.seed+1}))));
});

test('omitted difficulty/body focus equal explicit normal/full-body', () => {
  const base = {duration:20,focus:'balanced',equipment:['dumbbells'],seed:77};
  assert.deepEqual(summarise(run(base)),summarise(run(Object.assign({},base,{difficulty:'normal',bodyFocus:'full-body'}))));
});
