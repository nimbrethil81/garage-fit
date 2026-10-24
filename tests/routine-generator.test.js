const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
require('../js/routine-generator.js');

const R = GarageFitRoutineGenerator;
const G = GarageFitGenerator;
const catalogue = GarageFitData.exercises;
const KIT = GarageFitData.equipment.map(item => item.id);
const KITS = [[]].concat(KIT.map(id => [id]), [KIT]);
const COMBINATIONS = [['warmup','bodyweight'],['warmup','equipment'],['cooldown','bodyweight'],['cooldown','equipment']];
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
const routine = (kind, variant, seed, extra) => R.generateRoutine(Object.assign({kind, variant, catalogue, equipment:KIT, random:random(seed)}, extra));
const exercisesOf = item => item.exercises.map(entry => catalogue[entry.id]);
const label = item => item.kind+'/'+item.variant+': '+item.phases.map(phase => phase.name+' '+phase.work+'+'+phase.rest).join(' | ');
function memoryStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {getItem:key => values.has(key) ? values.get(key) : null, setItem:(key, value) => values.set(key, String(value)), values};
}
// Every routine across the equipment matrix, for the matrix-wide contracts.
function each(fn, seeds=6) {
  for (const [kind, variant] of COMBINATIONS) for (const equipment of KITS) for (let seed=1;seed<=seeds;seed++)
    fn(R.generateRoutine({kind, variant, catalogue, equipment, random:random(seed*131+equipment.length)}), {kind, variant, equipment, seed});
}

test('all four kind/variant combinations yield valid, playback-ready 300-second plans', () => {
  each(item => {
    assert.deepEqual(R.validateRoutine(item, catalogue), [], label(item));
    assert.equal(item.estimatedSeconds, 300, label(item));
    assert.equal(item.phases.reduce((sum, phase) => sum + phase.work + phase.rest, 0), 300, label(item));
    assert.deepEqual(item.diagnostics, []);
    item.phases.forEach((phase, index) => {
      // Routine-player shape: id, name, work and rest seconds, timed cues.
      assert.ok(catalogue[phase.id] && typeof phase.name==='string' && Array.isArray(phase.timedCues), label(item));
      assert.ok(Number.isInteger(phase.work) && phase.work>=15, label(item));
      if (index===item.phases.length-1) assert.equal(phase.rest, 0);
      else assert.ok(Number.isInteger(phase.rest) && phase.rest>=5, label(item));
    });
  });
});

test('warm-ups always cover knee, ankle, hip, shoulder and trunk mobility, pulse raising and progression', () => {
  each(item => {
    if (item.kind!=='warmup') return;
    const exercises = exercisesOf(item);
    assert.deepEqual(Object.values(item.coverage).every(Boolean), true, label(item)+' '+JSON.stringify(item.coverage));
    // The knee obligation is met only by an explicitly qualified unloaded knee movement.
    assert.equal(exercises.filter(G.kneeMobilityQualified).length, 1, label(item));
    for (const area of ['ankles','hips','shoulders','trunk']) assert.ok(exercises.some(ex => ex.warmupAreas.includes(area)), area+' '+label(item));
    assert.ok(exercises.some(ex => ex.cardio>=2 && !ex.patterns.some(pattern => ['squat','hinge','lunge','push','pull','carry'].includes(pattern))), label(item));
    assert.ok(exercises.every(ex => ex.impact!=='high' && ex.prepFatigue<=2), label(item));
    // Preparation intensity never steps down and ends on dynamic work.
    for (let i=1;i<exercises.length;i++) assert.ok(exercises[i].prepIntensity>=exercises[i-1].prepIntensity, label(item));
    assert.ok(exercises.at(-1).prepIntensity>=3, label(item));
    assert.ok(exercises[0].prepIntensity<=1, label(item));
    // Many short movements: typical 20-40 s intervals.
    for (const phase of item.phases) assert.ok(phase.side ? phase.work>=15 && phase.work<=30 : phase.work>=20 && phase.work<=40, label(item));
  });
});

test('cool-downs balance posterior and anterior lower body with upper body and trunk/back, using longer holds', () => {
  let perSide = 0, bilateral = 0;
  each(item => {
    if (item.kind!=='cooldown') return;
    const exercises = exercisesOf(item);
    for (const [key, met] of Object.entries(item.coverage)) assert.ok(met, key+' '+label(item)+' '+JSON.stringify(item.coverageDoses));
    for (const [key, value] of Object.entries(item.coverageDoses)) assert.ok(value>=.5, key);
    assert.ok(exercises.length>=4 && exercises.length<=6, label(item));
    for (const phase of item.phases) assert.ok(phase.side ? phase.work>=20 && phase.work<=45 : phase.work>=30 && phase.work<=60, label(item));
    perSide += exercises.filter(ex => ex.sidedness==='per-side').length;
    bilateral += exercises.filter(ex => ex.sidedness!=='per-side').length;
    // Gentle flow: equipment set-ups and standing stretches first, then down to the floor once.
    const floor = exercises.map(ex => ex.bodyPosition==='floor');
    assert.ok(floor.indexOf(true)===-1 || floor.slice(floor.indexOf(true)).every(Boolean), label(item));
  });
  assert.ok(perSide>50 && bilateral>50, perSide+' / '+bilateral);
});

test('no exercise or direct family variant repeats and near-duplicate clusters stay within bounds', () => {
  each(item => {
    const exercises = exercisesOf(item);
    assert.equal(new Set(exercises.map(ex => ex.id)).size, exercises.length, label(item));
    const families = exercises.map(ex => ex.family).filter(Boolean);
    assert.equal(new Set(families).size, families.length, label(item));
    const counts = {};
    for (const ex of exercises) for (const key of (ex.repetitionClass ? [ex.repetitionClass] : []).concat(item.kind==='cooldown' ? ex.stretchTargets : []))
      counts[key] = (counts[key] || 0)+1;
    for (const [key, count] of Object.entries(counts)) assert.ok(count<=R.CLUSTER_LIMIT, key+' '+label(item));
  });
  // Shared coverage is not duplication: different exercises for the same joint appear together.
  let shared = 0;
  each(item => { if (item.kind==='warmup' && exercisesOf(item).filter(ex => ex.warmupAreas.includes('hips')).length>=2) shared++; });
  assert.ok(shared>20, String(shared));
});

test('equipment gates: bodyweight needs none, equipment uses only owned inventory and falls back to no gear', () => {
  each((item, context) => {
    const owned = item.variant==='equipment' ? context.equipment : [];
    for (const ex of exercisesOf(item)) assert.ok(G.requirementsMet(ex, owned), ex.id+' with '+owned.join('+')+': '+label(item));
    if (item.variant==='bodyweight') assert.ok(exercisesOf(item).every(ex => !ex.equipment.length), label(item));
  });
  const noGear = R.generateRoutine({kind:'cooldown', variant:'equipment', catalogue, equipment:[], random:random(4)});
  assert.deepEqual(R.validateRoutine(noGear, catalogue), []);
  assert.ok(exercisesOf(noGear).every(ex => !ex.equipment.length));
});

test('every eligible exercise is reachable in its routine within a bounded deterministic sample', () => {
  for (const [kind, variant] of COMBINATIONS) {
    const owned = variant==='equipment' ? KIT : [];
    const seen = new Set();
    let history = [];
    for (let seed=1;seed<=60;seed++) {
      const item = routine(kind, variant, seed, {recentHistory:history});
      item.exercises.forEach(entry => seen.add(entry.id));
      history = [item.exercises.map(entry => entry.id)].concat(history).slice(0, 3);
    }
    const eligible = Object.values(catalogue).filter(ex => G.generatedPhaseEligible(ex, kind, owned) && (kind!=='warmup' || ex.prepFatigue<=2)).map(ex => ex.id);
    assert.deepEqual(eligible.filter(id => !seen.has(id)), [], kind+'/'+variant);
  }
});

// Set-up as the routine sees it: equipment plus floor, hanging or (otherwise) standing.
const setup = (exercise, owned) => G.sectionSetupKey(exercise, owned)+'|'+(['floor','hanging'].includes(exercise.bodyPosition) ? exercise.bodyPosition : 'standing');
test('setup changes are timed transitions, and floor and equipment stretches are grouped', () => {
  each(item => {
    item.phases.forEach((phase, index) => {
      const next = item.phases[index+1];
      if (!next) return;
      if (next.id===phase.id) assert.equal(phase.transition, 'side');
      else assert.equal(phase.transition, setup(catalogue[phase.id], item.equipment)===setup(catalogue[next.id], item.equipment) ? 'exercise' : 'setup', label(item));
      assert.ok(phase.rest>=R.TRANSITION[phase.transition] && phase.rest<=R.TRANSITION[phase.transition]+2, label(item));
    });
    if (item.kind==='cooldown') {
      // Each set-up appears as one contiguous run.
      const keys = item.exercises.map(entry => setup(catalogue[entry.id], item.equipment));
      const runs = keys.filter((key, index) => key!==keys[index-1]);
      assert.equal(new Set(runs).size, runs.length, label(item));
    }
  });
});

test('per-side work plays contiguously with equal sides; alternating work is one interval', () => {
  each(item => {
    item.exercises.forEach((entry, index) => {
      const occurrences = item.phases.filter(phase => phase.exerciseIndex===index);
      const exercise = catalogue[entry.id];
      if (exercise.sidedness==='per-side') {
        assert.deepEqual(occurrences.map(phase => phase.side), ['right','left'], label(item));
        assert.equal(occurrences[0].work, occurrences[1].work);
        assert.equal(item.phases.indexOf(occurrences[1]), item.phases.indexOf(occurrences[0])+1);
        assert.match(occurrences[0].name, / - Right$/);
      } else {
        assert.equal(occurrences.length, 1);
        assert.equal(occurrences[0].side, null);
        assert.equal(occurrences[0].name, exercise.name);
      }
    });
  });
});

test('timing uses whole seconds, including non-multiples of five, and preserves halfway cues', () => {
  let odd = 0, cues = 0;
  each(item => {
    for (const phase of item.phases) {
      if (phase.work%5) odd++;
      const exercise = catalogue[phase.id];
      assert.deepEqual(phase.timedCues, exercise.timedCues);
      for (const cue of phase.timedCues) {
        cues++;
        const offset = GarageFitTimedCues.cueOffsetSeconds(cue, phase.work);
        assert.equal(offset, phase.work/2);
        // Short-interval safety: a halfway cue is well inside the interval.
        assert.ok(offset>=5 && phase.work-offset>=5, label(item));
      }
    }
  });
  assert.ok(odd>100 && cues>50, odd+' / '+cues);
  // An odd-second halfway cue fires after its midpoint.
  const tracker = GarageFitTimedCues.createTracker([{text:'Change direction',at:{type:'fraction',value:.5}}], 27);
  assert.equal(GarageFitTimedCues.takeDueCues(tracker, 13).length, 0);
  assert.equal(GarageFitTimedCues.takeDueCues(tracker, 14)[0].text, 'Change direction');
});

test('the duration solver fits exact totals within bounds and repairs odd remainders with a transition', () => {
  const transitions = () => [{type:'side',seconds:5,base:5},{type:'exercise',seconds:5,base:5},{type:'side',seconds:5,base:5}];
  // Two per-side exercises (2 x value) and 15 s of transitions: an even total needs an odd adjustment.
  const items = [{sides:2,min:20,max:45,preferred:30},{sides:2,min:20,max:45,preferred:30}];
  for (const total of [131,132,141,150,175]) {
    const list = transitions();
    const solved = R.solveDurations(items, list, total);
    assert.equal(solved.feasible, true, String(total));
    assert.equal(solved.values.reduce((sum, value, index) => sum + value*items[index].sides, 0) + list.reduce((sum, item) => sum + item.seconds, 0), total);
    solved.values.forEach((value, index) => assert.ok(value>=items[index].min && value<=items[index].max));
    list.forEach(item => assert.ok(item.seconds>=item.base && item.seconds<=item.base+2));
    // The difference is spread rather than loaded onto one exercise.
    assert.ok(Math.abs(solved.values[0]-solved.values[1])<=1, String(total));
  }
  const single = R.solveDurations([{sides:1,min:20,max:40,preferred:28},{sides:1,min:20,max:40,preferred:28}], [{type:'exercise',seconds:5,base:5}], 66);
  assert.deepEqual(single, {values:[31,30],feasible:true});
  assert.equal(R.solveDurations([{sides:1,min:20,max:40,preferred:28}], [], 300).feasible, false);
});

test('generation is deterministic for a seed and varies with it', () => {
  for (const [kind, variant] of COMBINATIONS) {
    assert.deepEqual(routine(kind, variant, 9), routine(kind, variant, 9));
    const variety = new Set([1,2,3,4,5,6].map(seed => routine(kind, variant, seed).exercises.map(entry => entry.id).join(',')));
    assert.ok(variety.size>=4, kind+'/'+variant);
  }
});

test('recent completed routines steer towards fresh movements without breaking coverage', () => {
  for (const [kind, variant] of COMBINATIONS) {
    let history = [], overlap = 0, sessions = 0;
    for (let seed=1;seed<=40;seed++) {
      const item = routine(kind, variant, seed, {recentHistory:history});
      assert.deepEqual(R.validateRoutine(item, catalogue), [], label(item));
      const ids = item.exercises.map(entry => entry.id);
      if (history.length) {
        assert.notDeepEqual(ids.slice().sort(), history[0].slice().sort(), 'repeated sequence');
        overlap += ids.filter(id => history[0].includes(id)).length/ids.length; sessions++;
      }
      history = [ids].concat(history).slice(0, 3);
    }
    // Warm-ups always share the single knee-mobility movement.
    assert.ok(overlap/sessions<(kind==='warmup' ? .35 : .15), kind+'/'+variant+' '+(overlap/sessions).toFixed(2));
  }
  // An exercise in the latest session is chosen less often than without history.
  const target = 'standing-quads';
  let fresh = 0, recent = 0;
  for (let seed=1;seed<=60;seed++) {
    if (routine('cooldown', 'bodyweight', seed).exercises.some(entry => entry.id===target)) fresh++;
    if (routine('cooldown', 'bodyweight', seed, {recentHistory:[[target]]}).exercises.some(entry => entry.id===target)) recent++;
  }
  assert.ok(recent<fresh, recent+' < '+fresh);
  // Records and raw id arrays are both accepted; junk is ignored.
  assert.deepEqual(R.validateRoutine(routine('warmup', 'bodyweight', 3, {recentHistory:[{ids:['body-hoops']}, null, 'x', [42]]}), catalogue), []);
});

test('routine history is separate, versioned, bounded and tolerant of missing or corrupted data', () => {
  for (const raw of [undefined, 'not json', '[]', '{"version":0,"warmup":[["body-hoops"]]}', '{"version":1,"warmup":"x","cooldown":[null,{"ids":"x"},{"ids":[]}]}']) {
    const storage = memoryStorage(raw===undefined ? {} : {[R.HISTORY_KEY]:raw});
    assert.deepEqual(R.readRoutineHistory(storage), {version:1, warmup:[], cooldown:[]}, String(raw));
  }
  assert.deepEqual(R.readRoutineHistory({getItem() { throw new Error('blocked'); }}), {version:1, warmup:[], cooldown:[]});
  assert.equal(R.HISTORY_KEY, 'gf_routine_recent_v1');
  const storage = memoryStorage();
  for (let i=1;i<=5;i++) R.recordRoutineCompletion(storage, 'warmup', ['body-hoops','body-hoops','w'+i], '2026-10-1'+i+'T00:00:00Z');
  R.recordRoutineCompletion(storage, 'cooldown', ['toe-touch'], '2026-10-15T00:00:00Z');
  R.recordRoutineCompletion(storage, 'cooldown', [], '2026-10-16T00:00:00Z');
  const history = R.readRoutineHistory(storage);
  assert.deepEqual(R.recentRoutineIds(history, 'warmup'), [['body-hoops','w5'],['body-hoops','w4'],['body-hoops','w3']]);
  assert.deepEqual(history.cooldown, [{ids:['toe-touch'], completedAt:'2026-10-15T00:00:00Z'}]);
  // Only the routine key is written; Generator Main history is untouched.
  assert.deepEqual([...storage.values.keys()], [R.HISTORY_KEY]);
  assert.throws(() => R.recordRoutineCompletion(storage, 'main', ['x']), /Unknown routine kind/);
  assert.doesNotThrow(() => R.recordRoutineCompletion({getItem:() => null, setItem() { throw new Error('quota'); }}, 'warmup', ['x']));
});

test('only completed occurrences of normally finished runs are recorded', () => {
  const item = routine('cooldown', 'bodyweight', 5);
  const perSide = item.exercises.findIndex(entry => entry.sides.length===2);
  const occurrences = item.phases.map((phase, index) => ({phase, index}));
  const storage = memoryStorage();
  const run = R.createRoutineRun(item);
  occurrences.forEach(({phase, index}) => {
    if (phase.exerciseIndex===0) run.skip(index);
    else if (phase.exerciseIndex===perSide && phase.side==='left') run.skip(index);
    else run.complete(index);
  });
  run.complete(occurrences.find(({phase}) => phase.exerciseIndex===0).index);
  const expected = item.exercises.slice(1).map(entry => entry.id);
  assert.deepEqual(run.performedIds(), expected);
  assert.deepEqual(run.finish({storage, completedAt:'2026-10-15T12:00:00Z'}), {kind:'cooldown', ids:expected});
  assert.equal(run.finish({storage}), null);
  assert.deepEqual(R.readRoutineHistory(storage).cooldown, [{ids:expected, completedAt:'2026-10-15T12:00:00Z'}]);
  // An abandoned run, or a finished run that skipped everything, records nothing.
  const abandoned = R.createRoutineRun(item); abandoned.complete(0); abandoned.abandon();
  assert.equal(abandoned.finish({storage}), null);
  const skipped = R.createRoutineRun(item); item.phases.forEach((_, index) => skipped.skip(index));
  assert.deepEqual(skipped.finish({storage}), {kind:'cooldown', ids:[]});
  assert.equal(R.readRoutineHistory(storage).cooldown.length, 1);
});

test('infeasible pools produce explicit diagnostics instead of a valid-looking routine', () => {
  const withoutKnee = Object.fromEntries(Object.entries(catalogue).filter(([id]) => id!=='standing-knee-curls'));
  const noKnee = R.generateRoutine({kind:'warmup', variant:'bodyweight', catalogue:withoutKnee, random:random(1)});
  assert.ok(noKnee.diagnostics.includes('warmup:missing-knee-mobility'));
  assert.equal(noKnee.coverage['knee-mobility'], false);
  assert.ok(R.validateRoutine(noKnee, withoutKnee).includes('warmup:missing-knee-mobility'));
  const tiny = Object.fromEntries(['toe-touch','chest-opener'].map(id => [id, catalogue[id]]));
  const short = R.generateRoutine({kind:'cooldown', variant:'bodyweight', catalogue:tiny, random:random(1)});
  assert.ok(short.diagnostics.includes('cooldown:timing-infeasible') && short.diagnostics.includes('cooldown:missing-anterior-lower'));
  assert.notEqual(short.estimatedSeconds, 300);
  assert.ok(R.validateRoutine(short, tiny).some(issue => /^timing:total-/.test(issue)));
  assert.throws(() => R.generateRoutine({kind:'main', catalogue}), /Unknown routine kind/);
  assert.throws(() => R.generateRoutine({kind:'warmup', variant:'gym', catalogue}), /Unknown routine variant/);
});

test('cool-down stretch targets are a validated classification on every cool-down stretch only', () => {
  const stretches = Object.values(catalogue).filter(ex => ex.cooldown);
  assert.ok(stretches.length>=20);
  for (const ex of stretches) assert.ok(ex.stretchTargets.length && ex.stretchTargets.every(target => G.VALID_STRETCH_TARGETS.has(target)), ex.id);
  for (const ex of Object.values(catalogue).filter(ex => !ex.cooldown)) assert.deepEqual(ex.stretchTargets, [], ex.id);
  const base = catalogue['toe-touch'];
  const errors = changes => G.validateCatalogue({[base.id]:Object.assign({}, base, changes)});
  assert.ok(errors({stretchTargets:[]}).some(error => /missing stretch targets/.test(error)));
  assert.ok(errors({stretchTargets:['legs']}).some(error => /invalid stretch targets/.test(error)));
  assert.ok(errors({stretchTargets:['back','back']}).some(error => /invalid stretch targets/.test(error)));
  assert.ok(G.validateCatalogue({'air-squat':Object.assign({}, catalogue['air-squat'], {stretchTargets:['back']})}).some(error => /non-cool-down/.test(error)));
});

test('C1 gentle preparation also reaches five-minute Prep & Recover without becoming recovery stretches',()=>{
  for(const [id,seed] of [['bent-knee-fallout',6],['supine-heel-slides',3],['tabletop-toe-taps',63]]){
    const item=routine('warmup','bodyweight',seed,{equipment:[]});
    assert.ok(item.exercises.some(ex=>ex.id===id),id);
    assert.deepEqual(R.validateRoutine(item,catalogue),[]);
    assert.equal(item.estimatedSeconds,300);
    assert.equal(catalogue[id].cooldown,false);
  }
});

test('Athletic v5 light standing preparation reaches Prep & Recover without adding recovery or floor work',()=>{
  for(const [id,seed] of [['tandem-step-and-hold',11],['split-stance-step-switches',6]]) {
    const item=routine('warmup','bodyweight',seed,{equipment:[]});
    assert.ok(item.exercises.some(ex=>ex.id===id),id);assert.deepEqual(R.validateRoutine(item,catalogue),[]);
    assert.equal(item.estimatedSeconds,300);assert.equal(catalogue[id].cooldown||catalogue[id].rampup,false,id);
  }
});
