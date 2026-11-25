const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');

// GF-EVENING1 (#394) deliberately supersedes the former fixed seven-exercise, 340-second
// prescription with a generated, gentle six-minute standing-to-floor reset.

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
require('../data/workouts.js');
require('../js/evening-reset.js');

const catalogue = GarageFitData.exercises;
const Evening = GarageFitEveningReset;
const seeded = (seed=1) => () => ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const clone = value => JSON.parse(JSON.stringify(value));
const PROHIBITED_NAME_PATTERN = /jump|burpee|mountain climber|high knee|running|plyometric|sprint|skater|punch|plank|push-up|press-up|squat jump|lunge/i;
const REGION_OF = new Map(Evening.eligible().map(entry => [entry.exercise.id, entry]));

// Group consecutive per-side steps back into the activity slots they represent.
function slotsOf(plan) {
  const slots = [];
  for (const step of plan.exercises) {
    const last = slots.at(-1);
    if (step.side && last && last.id === step.id && last.steps.length === 1) last.steps.push(step);
    else slots.push({ id: step.id, steps: [step] });
  }
  return slots;
}

function assertSoundPlan(plan) {
  assert.deepEqual(Evening.validate(plan), { valid: true, errors: [] });
  assert.equal(plan.id, 'eveningFullBodyReset');
  assert.equal(plan.name, 'Evening Full-Body Reset');
  assert.equal(plan.termination.type, 'fixed-sequence');
  assert.equal(plan.termination.rounds, undefined);
  // Exactly six minutes of work and changeovers; the 3-second get-ready is separate.
  assert.equal(plan.exercises.reduce((sum, step) => sum + step.durationSeconds + step.transitionAfter, 0), 360);
  assert.equal(plan.exercises.at(-1).transitionAfter, 0);
  const slots = slotsOf(plan);
  assert.equal(slots.length, 8);
  assert.equal(new Set(slots.map(slot => slot.id)).size, 8, 'no repeats except paired sides');
  const entries = slots.map(slot => catalogue[slot.id]);
  // Five movement/mobility slots then three stretches, roughly 60/40 by work time.
  assert.deepEqual(entries.map(ex => !!ex.cooldown), [false,false,false,false,false,true,true,true]);
  const work = list => list.reduce((sum, slot) => sum + slot.steps.reduce((s, step) => s + step.durationSeconds, 0), 0);
  const movementShare = work(slots.slice(0, 5)) / work(slots);
  assert.ok(movementShare >= 0.55 && movementShare <= 0.65, movementShare);
  // Standing first, one descent, never back to standing; the floor set-up only settles.
  assert.deepEqual(entries.map(ex => ex.bodyPosition), ['standing','standing','standing','floor','floor','floor','floor','floor']);
  const levels = slots.map(slot => REGION_OF.get(slot.id).level);
  levels.slice(1).forEach((level, index) => assert.ok(level >= levels[index], 'floor sequence never moves back up'));
  assert.equal(REGION_OF.get(slots.at(-1).id).setup, 'lying');
  // The longer changeover sits exactly at the standing-to-floor boundary.
  plan.exercises.forEach((step, index) => {
    const next = plan.exercises[index + 1];
    if (!next) return;
    const descent = catalogue[step.id].bodyPosition === 'standing' && catalogue[next.id].bodyPosition === 'floor';
    assert.equal(step.transitionAfter, descent ? 10 : 5, step.name);
  });
  // Canonical sidedness: both sides consecutively, canonical order, equal periods.
  for (const slot of slots) {
    const ex = catalogue[slot.id];
    if (ex.sidedness === 'per-side') {
      assert.deepEqual(slot.steps.map(step => step.side), ex.sideOrder);
      assert.deepEqual(slot.steps.map(step => step.name), ex.sideOrder.map(side => ex.name + ' - ' + (side === 'right' ? 'Right' : 'Left')));
      assert.equal(slot.steps[0].durationSeconds, slot.steps[1].durationSeconds);
      assert.equal(slot.steps[0].durationSeconds * 2, 40);
    } else {
      assert.equal(slot.steps.length, 1);
      assert.equal(slot.steps[0].side, undefined);
      assert.ok([35, 40].includes(slot.steps[0].durationSeconds));
      if (ex.cooldown) assert.equal(slot.steps[0].durationSeconds, 40);
    }
  }
  // Shoulders/upper body, trunk/back, hips and lower body across the session.
  const regions = new Set(slots.flatMap(slot => REGION_OF.get(slot.id).regions));
  assert.deepEqual([...regions].sort(), ['hips','lower','trunk','upper']);
  return slots;
}

test('Evening Full-Body Reset keeps its stable identity as a generated six-minute fixed sequence', () => {
  const workout = GarageFitData.fixedWorkouts.eveningFullBodyReset;
  assert.equal(workout.id, 'eveningFullBodyReset');
  assert.equal(workout.name, 'Evening Full-Body Reset');
  assert.equal(workout.generated, true);
  assert.deepEqual(workout.termination, { type:'fixed-sequence', durationSeconds:360 });
  assert.deepEqual(workout.exercises, [], 'the superseded fixed prescription is not retained as a playable default');
});

test('bounded seeded plans are coherent, exact, sided and balanced', () => {
  const random = seeded(394);
  const seen = new Set();
  for (let run = 0; run < 150; run++) {
    const plan = Evening.generate({ random });
    assertSoundPlan(plan);
    seen.add(plan.exercises.map(step => step.id).join());
    assert.match(plan.description, /standing.*floor/i);
    assert.doesNotMatch(plan.description + plan.completionMessage, /HIIT|conditioning|calorie|fat.burn|challenge|high.intensity|sleep|insomnia|cure|treat|heal/i);
  }
  assert.ok(seen.size > 100, 'plans vary across uses');
});

test('every selectable exercise is verified against its actual catalogue entry and instruction', () => {
  const pool = Evening.eligible();
  assert.ok(pool.length >= 25);
  for (const { exercise: ex, kind } of pool) {
    assert.equal(ex, catalogue[ex.id]);
    assert.deepEqual(ex.equipment, [], ex.id);
    assert.equal(ex.impact, 'low', ex.id);
    assert.ok(ex.cardio <= 2 && ex.strength <= 2, ex.id);
    assert.ok(!['moderate','hard'].includes(ex.difficulty), ex.id);
    assert.doesNotMatch(ex.name, PROHIBITED_NAME_PATTERN, ex.id);
    // Small clear floor area: no wall, furniture or required support.
    assert.doesNotMatch(ex.instruction, /\b(wall|chair|counter|bench|sofa|couch|bed|table|door|step|box)\b/i, ex.id);
    assert.doesNotMatch(ex.instruction.replace(/support if needed/gi, ''), /\b(hold|holding|face|facing|using) (a |the )?support\b/i, ex.id);
    assert.doesNotMatch(ex.instruction, /face down|prone|bounc(e|ing) /i, ex.id);
    assert.ok(!ex.prescriptionModes || ex.prescriptionModes.includes('time'), ex.id);
    assert.equal(ex.cooldown === true, kind === 'stretch', ex.id);
    assert.equal(ex.bodyPosition, kind === 'standing' ? 'standing' : 'floor', ex.id);
    if (ex.sidedness === 'per-side') assert.ok(ex.timedCues.every(cue => !/side/i.test(cue.text)), ex.id);
  }
  // Known catalogue entries that rely on a wall/support, are deep or strenuous, or are prone.
  for (const id of ['wall-angel','standing-calf-stretch','bent-knee-calf-stretch','standing-lat-stretch','ankle-circles',
    'leg-swings-forward-back','leg-swings-side','standing-hip-rotations','standing-quads','wall-push-up','wall-ankle-dorsiflexion-rocks',
    'seated-spinal-rotation-stretch','pigeon-stretch','frog-stretch','runners-stretch','low-cobra-pose','downward-upward-dog',
    'glute-bridge','dead-bug','push-up','superman','marching-on-the-spot','single-leg-balance-reach','worlds-greatest-stretch']) {
    assert.ok(catalogue[id], id);
    assert.ok(!REGION_OF.has(id), id + ' must not be selectable');
  }
});

test('adversarial catalogue changes exclude unsafe entries rather than substituting them', () => {
  const base = clone(catalogue);
  const variants = {
    wall: ex => { ex.instruction = 'With your back against a wall and arms bent in a W, slide your arms up and down slowly.'; },
    support: ex => { ex.instruction = 'Stand tall holding a support, lift one knee and draw a slow circle with it, keeping still.'; },
    equipment: ex => { ex.equipment = [['dumbbells']]; },
    impact: ex => { ex.impact = 'medium'; },
    hard: ex => { ex.difficulty = 'hard'; },
    sidedness: ex => { ex.sidedness = 'sideways'; },
    cue: ex => { ex.sidedness = 'per-side'; ex.timedCues = [{ text:'Change side', at:{ type:'fraction', value:0.5 } }]; },
    position: ex => { ex.bodyPosition = 'supported'; }
  };
  for (const [name, mutate] of Object.entries(variants)) {
    const copy = clone(base); mutate(copy['cat-cow']);
    assert.ok(!Evening.eligible(copy).some(entry => entry.exercise.id === 'cat-cow'), name);
    const plan = Evening.generate({ catalogue: copy, random: seeded(7) });
    assertSoundPlan(plan);
    assert.ok(!plan.exercises.some(step => step.id === 'cat-cow'), name);
    assert.equal(Evening.validate(plan, copy).valid, true);
  }
  // A plan containing an entry that has since become unsafe is rejected, not repaired.
  const plan = Evening.generate({ random: seeded(3) });
  const copy = clone(base); copy[plan.exercises[0].id].instruction = 'Face a wall with both hands resting on it and lean forwards gently and slowly.';
  assert.equal(Evening.validate(plan, copy).valid, false);
});

test('no suitable pool produces a clear error quickly, without a partial plan', () => {
  const removals = {
    'no lying stretch': ex => REGION_OF.get(ex.id)?.kind === 'stretch' && REGION_OF.get(ex.id).setup === 'lying',
    'no standing movement': ex => REGION_OF.get(ex.id)?.kind === 'standing',
    'no upper-body option': ex => REGION_OF.get(ex.id)?.regions.includes('upper'),
    'no hip or lower-body option': ex => REGION_OF.get(ex.id)?.regions.some(region => ['hips','lower'].includes(region))
  };
  for (const [name, remove] of Object.entries(removals)) {
    const copy = Object.fromEntries(Object.entries(clone(catalogue)).filter(([, ex]) => !remove(ex)));
    const started = Date.now();
    assert.throws(() => Evening.generate({ catalogue: copy, random: seeded(1) }), /Evening Full-Body Reset is unavailable/, name);
    assert.ok(Date.now() - started < 2000, name + ' search is bounded');
  }
  assert.throws(() => Evening.generate({ catalogue: {}, random: seeded(1) }), /unavailable/);
});

test('playback validation rejects malformed durations, sides and unsound sequences', () => {
  const plan = Evening.generate({ random: seeded(11) });
  assert.equal(Evening.validate(plan).valid, true);
  const perSideIndex = plan.exercises.findIndex(step => step.side);
  const standingIndex = 0, floorIndex = plan.exercises.findIndex(step => catalogue[step.id].bodyPosition === 'floor');
  const broken = {
    'string duration': p => { p.exercises[0].durationSeconds = '40'; },
    'negative changeover': p => { p.exercises[0].transitionAfter = -5; },
    'longer total': p => { p.exercises[0].durationSeconds += 5; },
    'short total': p => { p.exercises.at(-2).transitionAfter = 0; },
    'trailing changeover': p => { p.exercises.at(-1).transitionAfter = 5; },
    'wrong duration': p => { p.termination.durationSeconds = 340; },
    'rounds': p => { p.termination.type = 'timed-sequence'; },
    'missing exercise': p => { p.exercises[0].id = 'not-an-exercise'; },
    'side on bilateral': p => { p.exercises.find(step => !step.side).side = 'left'; },
    'back to standing': p => { const [floor] = p.exercises.splice(floorIndex, 1); p.exercises.splice(standingIndex, 0, floor); },
    'swapped descent': p => { const step = p.exercises[floorIndex - 1]; step.transitionAfter = 5; p.exercises[floorIndex].transitionAfter += 5; },
    'duplicate': p => { p.exercises[1] = { ...p.exercises[0] }; },
    'empty': p => { p.exercises = []; }
  };
  if (perSideIndex >= 0) Object.assign(broken, {
    'reversed sides': p => { p.exercises[perSideIndex].side = 'left'; p.exercises[perSideIndex + 1].side = 'right'; },
    'unequal sides': p => { p.exercises[perSideIndex].durationSeconds = 25; p.exercises[perSideIndex + 1].durationSeconds = 15; },
    'one side only': p => { const [first, second] = p.exercises.splice(perSideIndex, 2); first.durationSeconds = 40; first.transitionAfter = second.transitionAfter; p.exercises.splice(perSideIndex, 0, first); }
  });
  for (const [name, mutate] of Object.entries(broken)) {
    const copy = clone(plan); mutate(copy);
    assert.equal(Evening.validate(copy).valid, false, name);
  }
  assert.equal(Evening.validate(null).valid, false);
});

test('per-side plans keep exactly 360 seconds and midpoint cues fire within their own interval', () => {
  const counts = new Set();
  const random = seeded(99);
  for (let run = 0; run < 120; run++) {
    const plan = Evening.generate({ random });
    const slots = assertSoundPlan(plan);
    const perSide = slots.filter(slot => slot.steps.length === 2).length;
    counts.add(perSide);
    assert.ok(perSide <= 3);
    assert.equal(plan.exercises.filter(step => step.durationSeconds === 35).length, perSide, 'one trimmed movement per side change');
    for (const step of plan.exercises) {
      const tracker = GarageFitTimedCues.createTracker(catalogue[step.id].timedCues, step.durationSeconds);
      tracker.cues.forEach(cue => assert.ok(cue.offsetSeconds > 0 && cue.offsetSeconds < step.durationSeconds));
    }
  }
  assert.ok(counts.size >= 2 && counts.has(3), [...counts]);
  // Without per-side options the plan is the reference contract: 8 x 40 s + 6 x 5 s + 1 x 10 s.
  const bilateralOnly = Object.fromEntries(Object.entries(clone(catalogue)).filter(([, ex]) => ex.sidedness !== 'per-side'));
  const reference = Evening.generate({ catalogue: bilateralOnly, random: seeded(4) });
  assertSoundPlan(reference);
  assert.deepEqual(reference.exercises.map(step => step.durationSeconds), Array(8).fill(40));
  assert.deepEqual(reference.exercises.map(step => step.transitionAfter), [5,5,10,5,5,5,5,0]);
});

test('recency rotates started choices, tolerates broken storage and never outranks safety', () => {
  assert.deepEqual(Evening.readRecent(null), []);
  assert.deepEqual(Evening.readRecent({ getItem(){ throw Error('blocked'); } }), []);
  assert.deepEqual(Evening.readRecent({ getItem(){ return '{'; } }), []);
  assert.deepEqual(Evening.readRecent({ getItem(){ return '{"a":1}'; } }), []);
  assert.deepEqual(Evening.readRecent({ getItem(){ return '[null,[],[4],"x",["a","a"],["ok"]]'; } }), [['ok']]);
  Evening.recordStarted(null, Evening.generate({ random: seeded(1) }));
  Evening.recordStarted({ getItem(){ return null; }, setItem(){ throw Error('full'); } }, Evening.generate({ random: seeded(1) }));

  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const random = seeded(5);
  let previous = null;
  for (let run = 0; run < 5; run++) {
    const plan = Evening.generate({ random, recent: Evening.readRecent(storage) });
    assertSoundPlan(plan);
    const standing = plan.exercises.filter(step => catalogue[step.id].bodyPosition === 'standing').map(step => step.id);
    if (previous) assert.ok(!standing.some(id => previous.includes(id)), 'standing choices rotate when alternatives exist');
    Evening.recordStarted(storage, plan);
    previous = [...new Set(plan.exercises.map(step => step.id))];
  }
  const stored = JSON.parse(data.get(Evening.historyKey));
  assert.equal(stored.length, 3);
  assert.deepEqual(stored.at(-1), previous);

  // When every option is recent, a valid plan is still produced.
  const everything = [Evening.eligible().map(entry => entry.exercise.id)];
  assertSoundPlan(Evening.generate({ random: seeded(8), recent: everything }));
  // Recency never forces variation when only one safe lying stretch remains.
  const lying = Evening.eligible().filter(entry => entry.kind === 'stretch' && entry.setup === 'lying').map(entry => entry.exercise.id);
  const copy = Object.fromEntries(Object.entries(clone(catalogue)).filter(([id]) => !lying.slice(1).includes(id)));
  const only = Evening.generate({ catalogue: copy, random: seeded(2), recent: [[lying[0]]] });
  assertSoundPlan(only);
  assert.equal(only.exercises.at(-1).id, lying[0]);
});

// ---- Workouts card, detail, preview and player integration ----

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value=>this.values.add(value)); }
  remove(...values) { values.forEach(value=>this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force===undefined) force=!this.values.has(value);
    force ? this.values.add(value) : this.values.delete(value);
    return force;
  }
}
class Element {
  constructor(id='') { this.id=id;this.classList=new ClassList();this.style={};this.children=[];this.attributes={};this.disabled=false;this.textContent='';this.innerHTML='';this.value='';this.listeners={}; }
  setAttribute(key,value) { this.attributes[key]=String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child);return child; }
  querySelector() { return new Element(); }
  addEventListener(type,listener) { (this.listeners[type]=this.listeners[type]||[]).push(listener); }
  click() { (this.listeners.click||[]).forEach(listener=>listener()); }
  focus() {}
}

function loadApp(options={}) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const elements = Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  for (const id of ['partialRepsDialog','doneStats','generatedDoneStats','amrapDoneStats']) elements[id].classList.add('hidden');
  const storage = new Map();
  const spoken = [];
  const intervals = new Map(); let nextInterval = 1;
  const context = {
    console, Date, Math, JSON, Set,
    SpeechSynthesisUtterance: function(text){this.text=text;},
    speechSynthesis: { cancel(){}, speak(utterance){spoken.push(utterance.text);} },
    document: { getElementById:id=>elements[id]||(elements[id]=new Element(id)), createElement:()=>new Element(), addEventListener(){}, head:new Element(), querySelector(){return options.install?null:new Element();} },
    localStorage: { get length(){return storage.size;}, key:i=>[...storage.keys()][i]||null, getItem:key=>storage.has(key)?storage.get(key):null, setItem:(key,value)=>storage.set(key,String(value)), removeItem:key=>storage.delete(key) },
    navigator: {},
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
    setInterval: callback => { const id=nextInterval++; intervals.set(id,callback); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: callback => callback(),
    addEventListener() {}
  };
  if (options.random) { context.Math = Object.create(Math); context.Math.random = options.random; }
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of ['data/equipment.js','data/exercises.js','data/workouts.js','data/workout-families.js','js/workout-families.js','js/generator.js','js/equipment-cues.js','js/routine-generator.js','js/desk-break.js','js/ab-blast.js','js/evening-reset.js','js/training-history.js','js/timed-cues.js','js/speech-voices.js','js/completion-signal.js','js/coach-model.js','js/coach-store.js','js/session-tracker.js','js/workout-preview.js','js/masthead.js','js/back-navigation.js','js/progress-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename:file });
  }
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline, context, { filename:'index-inline.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8'), context, { filename:'js/workouts-ui.js' });
  if (options.install) { elements.bottomNav.parentNode={insertBefore(){}}; context.GarageFitWorkoutUI.install(); }
  return { context, elements, intervals, spoken, storage };
}

function tick(intervals, timerId, times) {
  for (let i=0;i<times;i++) intervals.get(timerId)();
}
const settleHistory = async () => { for(let i=0;i<100;i++)await Promise.resolve(); };

test('the Workouts card and detail describe a generated, gentle six-minute reset', () => {
  const { context, elements } = loadApp({ install:true, random:seeded(21) });
  const ui = context.GarageFitWorkoutUI, meta = ui.cardMeta.eveningFullBodyReset;
  assert.deepEqual({ ...meta }, { name:'Full-Body Reset', kicker:'Evening', number:'6', format:'Gentle movement · stretching', summary:'6 min · Standing to floor', generated:true });
  ui.openWorkoutDetail('eveningFullBodyReset');
  const definition = ui.detailDefinition('eveningFullBodyReset');
  assert.equal(elements.fixedWorkoutDetailTitle.textContent, 'Evening Full-Body Reset');
  assert.equal(elements.fixedWorkoutDetailFormat.textContent, '6 min · Standing to floor');
  assert.match(elements.fixedWorkoutDetailDescription.textContent, /gentle movement and stretching/i);
  assert.doesNotMatch(definition.description, /HIIT|conditioning|calorie|challenge|sleep/i);
  assert.equal(elements.fixedWorkoutDetailRegenerate.classList.contains('hidden'), false);
  assert.equal(elements.fixedWorkoutDetailStart.disabled, false);
  assert.equal(elements.challenge300Error.textContent, '');
  assert.equal(definition.exercises.reduce((sum, ex) => sum + Number.parseInt(ex.target, 10), 0) + 5 * (definition.exercises.length - 1) + 5, 360);
  // Other specialist previews keep their existing Regenerate visibility.
  ui.openWorkoutDetail('postRunReset');
  assert.equal(elements.fixedWorkoutDetailRegenerate.classList.contains('hidden'), true);
  ui.openWorkoutDetail('abBlast');
  assert.equal(elements.fixedWorkoutDetailRegenerate.classList.contains('hidden'), false);
});

test('Regenerate changes only the unstarted preview, and Start plays exactly the displayed plan', () => {
  const { context, elements, storage } = loadApp({ install:true, random:seeded(42) });
  const ui = context.GarageFitWorkoutUI;
  ui.openWorkoutDetail('eveningFullBodyReset');
  const first = ui.detailDefinition('eveningFullBodyReset');
  elements.fixedWorkoutDetailRegenerate.click();
  const second = ui.detailDefinition('eveningFullBodyReset');
  assert.notDeepEqual(Array.from(second.exercises, ex => ex.id), Array.from(first.exercises, ex => ex.id));
  assert.equal(storage.has('gf_evening_reset_recent_v1'), false, 'previews and Regenerate do not record a session');
  elements.fixedWorkoutDetailStart.click();
  assert.equal(vm.runInContext('state.key', context), 'fixedSequence');
  const launched = vm.runInContext('state.list', context);
  assert.deepEqual(Array.from(launched, ex => [ex.id, ex.name, ex.work + ' sec']), Array.from(second.exercises, ex => [ex.id, ex.name, ex.target]));
  assert.deepEqual(JSON.parse(storage.get('gf_evening_reset_recent_v1')), [[...new Set(Array.from(second.exercises, ex => ex.id))]]);
  // A repeated Start neither restarts nor regenerates the running session.
  ui.startSelectedWorkout(); ui.startFixedSequenceWorkout('eveningFullBodyReset');
  assert.equal(vm.runInContext('state.list', context), launched);
  assert.equal(JSON.parse(storage.get('gf_evening_reset_recent_v1')).length, 1);
});

test('generation failure explains itself, disables Start and never launches a stale plan', () => {
  const { context, elements, storage } = loadApp({ install:true });
  const ui = context.GarageFitWorkoutUI, generate = context.GarageFitEveningReset.generate;
  ui.openWorkoutDetail('eveningFullBodyReset');
  assert.ok(ui.detailDefinition('eveningFullBodyReset').exercises.length);
  context.GarageFitEveningReset.generate = () => { throw new Error('Evening Full-Body Reset is unavailable: test pool.'); };
  elements.fixedWorkoutDetailRegenerate.click();
  assert.equal(elements.challenge300Error.textContent, 'Evening Full-Body Reset is unavailable: test pool.');
  assert.equal(elements.fixedWorkoutDetailStart.disabled, true);
  assert.equal(ui.detailDefinition('eveningFullBodyReset').exercises.length, 0);
  ui.startSelectedWorkout(); ui.startFixedSequenceWorkout('eveningFullBodyReset');
  assert.equal(vm.runInContext('state.running', context), false);
  assert.equal(storage.has('gf_evening_reset_recent_v1'), false);
  // A later successful Regenerate restores a startable preview; errors from other workouts do not leak.
  context.GarageFitEveningReset.generate = generate;
  elements.fixedWorkoutDetailRegenerate.click();
  assert.equal(elements.challenge300Error.textContent, '');
  assert.equal(elements.fixedWorkoutDetailStart.disabled, false);
  ui.openWorkoutDetail('postRunReset');
  assert.equal(elements.fixedWorkoutDetailStart.disabled, false);
  // A preview that no longer validates at Start is refused rather than repaired.
  ui.openWorkoutDetail('eveningFullBodyReset');
  context.GarageFitEveningReset.validate = () => ({ valid:false, errors:['The plan must last exactly six minutes.'] });
  ui.startSelectedWorkout();
  assert.equal(vm.runInContext('state.running', context), false);
  assert.match(elements.challenge300Error.textContent, /could not start\. The plan must last exactly six minutes\./);
  assert.equal(ui.detailDefinition('eveningFullBodyReset').exercises.length, 0, 'the refused plan is no longer listed');
  assert.equal(elements.fixedWorkoutDetailStart.disabled, true);
  assert.equal(storage.has('gf_evening_reset_recent_v1'), false);
});

test('unavailable storage does not block preview, Start or completion', () => {
  const { context, elements } = loadApp({ install:true });
  context.localStorage.getItem = () => { throw Error('blocked'); };
  context.localStorage.setItem = () => { throw Error('blocked'); };
  const ui = context.GarageFitWorkoutUI;
  ui.openWorkoutDetail('eveningFullBodyReset');
  assert.equal(elements.fixedWorkoutDetailStart.disabled, false);
  ui.startSelectedWorkout();
  assert.equal(vm.runInContext('state.running', context), true);
});

test('playback completes every timed step once, with the floor changeover at the descent and timed cues', () => {
  const { context, elements, intervals, spoken } = loadApp({ install:true, random:seeded(17) });
  const ui = context.GarageFitWorkoutUI;
  let guard = 0;
  // Choose a preview whose plan has both paired sides and a midpoint cue.
  do {
    ui.openWorkoutDetail('eveningFullBodyReset');
    assert.ok(guard++ < 60);
  } while (!(ui.detailDefinition('eveningFullBodyReset').exercises.some(ex => /- Right$/.test(ex.name)) &&
    ui.detailDefinition('eveningFullBodyReset').exercises.some(ex => context.GarageFitData.exercises[ex.id].timedCues.length)));
  ui.startSelectedWorkout();
  const list = vm.runInContext('state.list', context);
  assert.equal(elements.routineName.textContent, 'Evening Full-Body Reset');
  tick(intervals, vm.runInContext('state.timer', context), 3);
  let seconds = 0, cues = 0;
  for (let index = 0; index < list.length; index++) {
    assert.equal(vm.runInContext('state.idx', context), index);
    assert.equal(vm.runInContext('state.phase', context), 'work');
    assert.equal(elements.exerciseName.textContent, list[index].name);
    assert.equal(vm.runInContext('state.remaining', context), list[index].work);
    const cue = context.GarageFitData.exercises[list[index].id].timedCues[0];
    tick(intervals, vm.runInContext('state.timer', context), list[index].work);
    if (cue) { assert.ok(spoken.includes(cue.text)); cues++; }
    seconds += list[index].work;
    if (index < list.length - 1) {
      const descent = context.GarageFitData.exercises[list[index].id].bodyPosition === 'standing' && context.GarageFitData.exercises[list[index + 1].id].bodyPosition === 'floor';
      assert.equal(vm.runInContext('state.phase', context), 'rest');
      assert.equal(vm.runInContext('state.remaining', context), descent ? 10 : 5);
      assert.equal(spoken.at(-1), list[index + 1].name);
      seconds += vm.runInContext('state.remaining', context);
      tick(intervals, vm.runInContext('state.timer', context), vm.runInContext('state.remaining', context));
    }
  }
  assert.ok(cues > 0);
  assert.equal(seconds, 360);
  assert.equal(vm.runInContext('state.running', context), false);
  assert.equal(elements.doneTitle.textContent, 'Evening Full-Body Reset Complete');
  assert.equal(elements.doneSub.textContent, 'Reset complete. Nice and easy.');
  assert.equal(elements.doneBtn.textContent, 'Back to workouts');
  assert.equal(intervals.size, 0, 'no timers survive completion');
});

test('rapid Next, pause/resume and stale callbacks cannot double-advance or invent work', async () => {
  const { context, intervals } = loadApp({ install:true, random:seeded(23) });
  const ui = context.GarageFitWorkoutUI, run = code => vm.runInContext(code, context);
  let now = 1000; context.Date = { now: () => now, prototype: Date.prototype };
  ui.openWorkoutDetail('eveningFullBodyReset'); ui.startSelectedWorkout();
  const readyTick = intervals.get(run('state.timer'));
  for (let i = 0; i < 10; i++) ui.skipFixedSequence();
  assert.equal(run('state.phase'), 'work'); assert.equal(run('state.idx'), 0);
  readyTick(); assert.equal(run('state.remaining'), run('state.list[0].work'), 'stale ready tick ignored');
  const workTick = intervals.get(run('state.timer'));
  context.togglePause(); workTick(); ui.skipFixedSequence();
  assert.equal(run('state.remaining'), run('state.list[0].work'), 'paused time and Next are frozen');
  context.togglePause(); workTick(); workTick();
  now += 400; ui.skipFixedSequence(); assert.equal(run('state.phase'), 'rest');
  ui.skipFixedSequence(); assert.equal(run('state.phase'), 'rest', 'burst within the debounce advances once');
  now += 400; ui.skipFixedSequence(); assert.equal(run('state.idx'), 1);
  workTick(); assert.equal(run('state.remaining'), run('state.list[1].work'), 'stale work tick cannot touch the next step');
});

test('confirmed exit leaves no saved session or live timers, and re-entry is a fresh preview', async () => {
  const { context, intervals } = loadApp({ install:true, random:seeded(29) });
  const ui = context.GarageFitWorkoutUI, run = code => vm.runInContext(code, context);
  ui.openWorkoutDetail('eveningFullBodyReset'); ui.startSelectedWorkout();
  tick(intervals, run('state.timer'), 3);
  const stale = intervals.get(run('state.timer'));
  context.openExitDialog('routine'); context.confirmExitChoice();
  assert.equal(run('state.running'), false);
  stale();
  await settleHistory();
  assert.equal((await context.GarageFitCoachStore.createStore(context.localStorage).listSessionResults()).results.length, 0);
  ui.openWorkoutDetail('eveningFullBodyReset'); ui.startSelectedWorkout();
  stale();
  assert.equal(run('state.remaining'), 3);
});

test('Desk Break automatically plays exactly 180 seconds with changeovers and no reps', () => {
  const {context:c,elements:e,intervals,storage,spoken}=loadApp();
  c.GarageFitWorkoutUI.startDeskBreak();
  const run=code=>vm.runInContext(code,c);
  assert.equal(run('state.key'),'deskBreak');
  assert.equal(storage.size,1);
  assert.equal(run('state.list.length'),6);
  assert.equal(e.routineName.textContent,'Desk Break');
  tick(intervals,run('state.timer'),3);
  let seconds=0;
  for(let i=0;i<6;i++){
    assert.equal(run('state.phase'),'work');
    assert.equal(run('state.remaining'),25);
    assert.equal(e.repsNum.classList.contains('hidden'),true);
    assert.equal(e.routineTarget.textContent,'');
    tick(intervals,run('state.timer'),25);seconds+=25;
    if(i<5){
      assert.equal(e.phaseLabel.textContent,'CHANGEOVER');
      assert.equal(spoken.at(-1),run('state.list[state.idx+1].name'));
      tick(intervals,run('state.timer'),6);seconds+=6;
    }
  }
  assert.equal(seconds,180);
  assert.equal(run('state.running'),false);
  assert.equal(e.doneTitle.textContent,'Desk Break Complete');
  assert.equal(e.doneBtn.textContent,'Back to workouts');
  assert.equal(intervals.size,0);
  c.goWorkouts();assert.equal(e.workouts.classList.contains('hidden'),false);
});

test('Desk Break fences stale timers, rapid Next bursts, pause and exit/restart',()=>{
  const {context:c,elements:e,intervals,storage}=loadApp();
  const run=code=>vm.runInContext(code,c);
  let now=1000;c.Date={now:()=>now};
  c.skipPhase=c.GarageFitWorkoutUI.skipTimedPhase;
  c.GarageFitWorkoutUI.startDeskBreak();
  const firstPlan=run('state.list');
  c.GarageFitWorkoutUI.startDeskBreak();assert.equal(run('state.list'),firstPlan);
  const readyTick=intervals.get(run('state.timer'));
  for(let i=0;i<10;i++)c.skipPhase();
  assert.equal(run('state.phase'),'work');assert.equal(run('state.idx'),0);
  const workTick=intervals.get(run('state.timer'));
  readyTick();assert.equal(run('state.remaining'),25);
  c.togglePause();workTick();c.skipPhase();assert.equal(run('state.remaining'),25);
  c.togglePause();tick(intervals,run('state.timer'),25);
  assert.equal(e.phaseLabel.textContent,'CHANGEOVER');
  c.skipPhase();assert.equal(run('state.phase'),'rest','expiry/Next overlap advances only once');
  now+=400;c.skipPhase();assert.equal(run('state.idx'),1);
  workTick();assert.equal(run('state.remaining'),25,'stale expiry cannot touch next movement');
  now+=400;c.openExitDialog('routine');c.skipPhase();assert.equal(run('state.idx'),1);
  c.cancelExit();assert.equal(run('state.paused'),false);
  c.openExitDialog('routine');c.confirmExitChoice();assert.equal(run('state.running'),false);
  const oldTick=intervals.get(run('state.timer'));
  c.GarageFitWorkoutUI.startDeskBreak();workTick();if(oldTick)oldTick();
  assert.equal(run('state.phase'),'ready');assert.equal(run('state.remaining'),3);
  assert.equal(JSON.parse(storage.get('gf_desk_break_recent_v1')).length,2);
  assert.notDeepEqual(run('state.list'),firstPlan);
});

test('Desk Break failure stays in Workouts without recording a candidate session',()=>{
  const {context:c,elements:e,storage}=loadApp();
  c.goWorkouts();c.GarageFitDeskBreak.generate=()=>{throw new Error('No balanced break available');};
  c.GarageFitWorkoutUI.startDeskBreak();
  assert.equal(e.deskBreakError.textContent,'No balanced break available');
  assert.equal(vm.runInContext('state.running',c),false);assert.equal(storage.size,0);
});

test('Desk Break manual completion boundaries are bounded and abandoned timers cannot change other routines',()=>{
  const {context:c,elements:e,intervals}=loadApp();const run=code=>vm.runInContext(code,c);
  let now=1000;c.Date={now:()=>now};c.skipPhase=c.GarageFitWorkoutUI.skipTimedPhase;
  c.GarageFitWorkoutUI.startDeskBreak();
  const abandoned=intervals.get(run('state.timer'));
  c.goHome();run("state.running=true;state.key='warmup';state.remaining=77");
  abandoned();assert.equal(run('state.remaining'),77);
  c.goWorkouts();c.GarageFitWorkoutUI.startDeskBreak();
  c.skipPhase();
  for(let i=0;i<6;i++){
    assert.equal(run('state.idx'),i);assert.equal(run('state.phase'),'work');
    const oldTick=intervals.get(run('state.timer'));
    now+=400;for(let j=0;j<10;j++)c.skipPhase();oldTick();
    if(i<5){assert.equal(run('state.phase'),'rest');now+=400;c.skipPhase();}
    else {assert.equal(run('state.running'),false);assert.equal(e.doneTitle.textContent,'Desk Break Complete');}
  }
  assert.equal(intervals.size,0);
});
