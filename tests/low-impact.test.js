const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');

// GF-LOW1 (#421): a generated, quiet, equipment-free Low Impact fitness workout of 10, 15,
// 20 or 30 minutes with standing and floor work. Standard press-ups must be reachable.

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
require('../data/workouts.js');
require('../js/low-impact.js');

const catalogue = GarageFitData.exercises;
const Low = GarageFitLowImpact;
const seeded = (seed = 1) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const clone = value => JSON.parse(JSON.stringify(value));
const DURATIONS = [10, 15, 20, 30];
const PHASES = { 10: [120, 420, 60], 15: [120, 660, 120], 20: [180, 900, 120], 30: [240, 1380, 180] };
const POOL = new Map(Low.eligible().map(entry => [entry.exercise.id, entry]));
const PROHIBITED = /jump|burpee|mountain climber|high knees\b|running|sprint|pogo|hop|bear crawl|walking lunge|fast feet|wall|chair|step-up|\bbox\b/i;

function slotsOf(plan) {
  const slots = [];
  for (const step of plan.exercises) {
    const last = slots.at(-1);
    if (step.side && last && last.id === step.id && last.steps.length === 1) last.steps.push(step);
    else slots.push({ id: step.id, section: step.section, position: step.position, steps: [step] });
  }
  return slots;
}

function assertSoundPlan(plan, duration) {
  assert.deepEqual(Low.validate(plan), { valid: true, errors: [] });
  assert.equal(plan.id, 'lowImpact');
  assert.equal(plan.name, 'Low Impact');
  assert.equal(plan.durationMinutes, duration);
  assert.deepEqual(plan.termination, { type: 'fixed-sequence', durationSeconds: duration * 60 });
  // Exact selected length including every changeover; the 3-second get-ready is separate.
  assert.equal(plan.exercises.reduce((sum, step) => sum + step.durationSeconds + step.transitionAfter, 0), duration * 60);
  assert.equal(plan.exercises.at(-1).transitionAfter, 0);
  const phase = section => plan.exercises.filter(step => step.section === section).reduce((sum, step) => sum + step.durationSeconds + step.transitionAfter, 0);
  assert.deepEqual([phase('warmup'), phase('main'), phase('cooldown')], PHASES[duration]);
  const slots = slotsOf(plan);
  const order = slots.map(slot => ['warmup', 'main', 'cooldown'].indexOf(slot.section));
  order.slice(1).forEach((value, index) => assert.ok(value >= order[index], 'warm-up, Main, cool-down in order'));
  // Warm-up standing; Main groups standing and floor into coherent blocks; cool-down on the floor.
  assert.ok(slots.filter(slot => slot.section === 'warmup').every(slot => catalogue[slot.id].bodyPosition === 'standing'));
  assert.ok(slots.filter(slot => slot.section === 'cooldown').every(slot => catalogue[slot.id].bodyPosition === 'floor' && catalogue[slot.id].cooldown));
  const main = slots.filter(slot => slot.section === 'main');
  const runs = [];
  main.forEach(slot => { const position = catalogue[slot.id].bodyPosition; if (runs.at(-1)?.position !== position) runs.push({ position, slots: [] }); runs.at(-1).slots.push(slot); });
  assert.equal(runs[0].position, 'standing');
  assert.equal(runs.at(-1).position, 'floor');
  assert.ok(runs.every(run => run.slots.length >= 3), 'no rapid standing/floor alternation');
  assert.ok(runs.length <= { 10: 2, 15: 4, 20: 4, 30: 6 }[duration]);
  // Changeovers: side switch 5, same-position Main 10, position change 15, phase boundary 10, warm-up/cool-down 5.
  plan.exercises.forEach((step, index) => {
    const next = plan.exercises[index + 1];
    if (!next) return;
    const expected = step.side && next.id === step.id && next.side && step.side !== next.side ? 5
      : step.section !== next.section ? 10
      : catalogue[step.id].bodyPosition !== catalogue[next.id].bodyPosition ? 15
      : step.section === 'main' ? 10 : 5;
    assert.equal(step.transitionAfter, expected, step.name);
  });
  // Canonical sidedness: both sides consecutively, canonical order, equal periods.
  for (const slot of slots) {
    const ex = catalogue[slot.id];
    if (ex.sidedness === 'per-side') {
      assert.deepEqual(slot.steps.map(step => step.side), ex.sideOrder);
      assert.deepEqual(slot.steps.map(step => step.name), ex.sideOrder.map(side => ex.name + ' - ' + (side === 'right' ? 'Right' : 'Left')));
      assert.equal(slot.steps[0].durationSeconds, slot.steps[1].durationSeconds);
      assert.equal(ex.prescription.type, 'unilateral-timed');
    } else {
      assert.equal(slot.steps.length, 1);
      assert.equal(slot.steps[0].side, undefined);
      assert.equal(slot.steps[0].name, ex.name);
    }
    for (const step of slot.steps) {
      assert.equal(step.durationSeconds % 5, 0);
      assert.ok(step.durationSeconds >= 20 && step.durationSeconds <= 55, step.name);
      const tracker = GarageFitTimedCues.createTracker(ex.timedCues, step.durationSeconds);
      tracker.cues.forEach(cue => assert.ok(cue.offsetSeconds > 0 && cue.offsetSeconds < step.durationSeconds));
    }
  }
  // Variety: no identical or substantially equivalent movements back to back; spaced, bounded repeats.
  slots.slice(1).forEach((slot, index) => {
    assert.notEqual(slot.id, slots[index].id);
    assert.notEqual(POOL.get(slot.id).group, POOL.get(slots[index].id).group, slot.id + ' after ' + slots[index].id);
  });
  const occurrences = new Map();
  slots.forEach((slot, index) => occurrences.set(slot.id, [...(occurrences.get(slot.id) || []), index]));
  for (const [id, at] of occurrences) {
    assert.ok(at.length <= (duration >= 20 ? 2 : 1), id + ' repeats too often');
    if (at.length === 2) assert.ok(at[1] - at[0] > 5, id + ' repeat is spaced');
  }
  const pushUps = slots.filter(slot => slot.id === 'push-up');
  assert.ok(pushUps.length <= (duration === 30 ? 2 : 1), 'press-ups do not dominate');
  pushUps.forEach(slot => assert.ok(slot.steps[0].durationSeconds >= 30 && slot.steps[0].durationSeconds <= 35, 'moderate press-up dose'));
  // Main covers lower body, upper body/core and low-impact conditioning.
  const mainEx = main.map(slot => catalogue[slot.id]);
  assert.ok(mainEx.some(ex => ex.patterns.includes('squat') || ex.patterns.includes('lunge')), 'lower-body strength');
  assert.ok(mainEx.some(ex => ex.bodyFocus === 'upper' || ex.bodyFocus === 'core'), 'upper body or core');
  assert.ok(mainEx.some(ex => ex.bodyPosition === 'floor' && ex.patterns.includes('core')), 'core');
  assert.ok(mainEx.some(ex => ex.conditioning), 'conditioning');
  const signatures = runs.map(run => run.slots.map(slot => slot.id).join());
  assert.equal(new Set(signatures).size, signatures.length, 'no block is repeated identically');
  return slots;
}

test('Low Impact has one stable fixed-sequence identity and the 20-minute default', () => {
  const workout = GarageFitData.fixedWorkouts.lowImpact;
  assert.equal(workout.id, 'lowImpact');
  assert.equal(workout.name, 'Low Impact');
  assert.equal(workout.generated, true);
  assert.equal(workout.termination.type, 'fixed-sequence');
  assert.deepEqual(workout.exercises, []);
  assert.deepEqual(Low.durations, [10, 15, 20, 30]);
  assert.equal(Low.defaultDuration, 20);
  assert.equal(Low.generate({ random: seeded(1) }).durationMinutes, 20);
  assert.throws(() => Low.generate({ duration: 25, random: seeded(1) }), /10, 15, 20 or 30 minutes/);
});

test('bounded seeded plans for every duration are exact, phased, sided, grouped and varied', () => {
  for (const duration of DURATIONS) {
    const random = seeded(421 + duration), seen = new Set();
    for (let run = 0; run < 40; run++) {
      const plan = Low.generate({ duration, random });
      assertSoundPlan(plan, duration);
      seen.add(plan.exercises.map(step => step.id).join());
      assert.doesNotMatch(plan.description + plan.completionMessage, /HIIT|calorie|fat.burn|sleep|cure|treat|heal|safe for everyone|after (a )?meal/i);
    }
    assert.equal(seen.size, 40, duration + ' min plans vary');
  }
});

test('standard press-ups, balance, standing and floor work are reachable at every duration', () => {
  for (const duration of DURATIONS) {
    const random = seeded(7 * duration), found = new Set(), withPushUps = [];
    for (let run = 0; run < 40; run++) {
      const plan = Low.generate({ duration, random });
      plan.exercises.forEach(step => found.add(step.id));
      withPushUps.push(plan.exercises.some(step => step.id === 'push-up'));
    }
    assert.ok(found.has('push-up'), 'push-up reachable at ' + duration + ' min');
    assert.ok(withPushUps.includes(false), 'push-ups are not compulsory at ' + duration + ' min');
    assert.ok([...found].some(id => POOL.get(id).tags.includes('balance')), 'balance work reachable at ' + duration + ' min');
    assert.ok([...found].some(id => catalogue[id].bodyPosition === 'standing' && POOL.get(id).section === 'main'));
    assert.ok([...found].some(id => catalogue[id].bodyPosition === 'floor' && POOL.get(id).section === 'main'));
  }
});

test('[Full] every curated Low Impact exercise is reachable across bounded seeded generation', () => {
  const found = new Set();
  for (const duration of DURATIONS) {
    const random = seeded(1000 + duration);
    for (let run = 0; run < 150; run++) {
      const plan = Low.generate({ duration, random });
      assertSoundPlan(plan, duration);
      plan.exercises.forEach(step => found.add(step.id));
    }
  }
  assert.deepEqual([...POOL.keys()].filter(id => !found.has(id)), []);
});

test('formerly exhausted 30-minute seeds and a bounded random sweep generate quickly without failure', () => {
  // Independent review found seeds 59, 399 and 508 exhausted the search after about two seconds.
  for (const seed of [59, 399, 508]) {
    const started = Date.now();
    assertSoundPlan(Low.generate({ duration: 30, random: seeded(seed) }), 30);
    assert.ok(Date.now() - started < 500, 'seed ' + seed + ' is fast');
  }
  for (const duration of DURATIONS) {
    const random = seeded(9000 + duration), started = Date.now();
    for (let run = 0; run < 200; run++) Low.generate({ duration, random });
    assert.ok(Date.now() - started < 4000, duration + ' min generation stays bounded');
  }
});

test('every selectable exercise passes setup, noise, space, impact and timed-prescription checks', () => {
  const pool = Low.eligible();
  assert.ok(pool.length >= 50);
  assert.ok(POOL.has('push-up'), 'standard press-ups are eligible');
  assert.equal(POOL.get('push-up').section, 'main');
  assert.equal(catalogue['push-up'].bodyPosition, 'floor');
  for (const { exercise: ex, section } of pool) {
    assert.equal(ex, catalogue[ex.id]);
    assert.deepEqual(ex.equipment, [], ex.id);
    assert.notEqual(ex.impact, 'high', ex.id);
    assert.notEqual(ex.difficulty, 'hard', ex.id);
    assert.ok(ex.cardio <= 3, ex.id + ' is not a high-intensity effort');
    assert.ok(['standing', 'floor'].includes(ex.bodyPosition), ex.id);
    assert.doesNotMatch(ex.name, PROHIBITED, ex.id);
    assert.doesNotMatch(ex.instruction, /\b(wall|chair|counter|bench|sofa|couch|bed|table|door|box)\b/i, ex.id);
    assert.doesNotMatch(ex.instruction.replace(/support if needed/gi, ''), /\b(hold|holding|face|facing|using) (a |the )?support\b/i, ex.id);
    assert.doesNotMatch(ex.instruction.replace(/without jumping/gi, ''), /\bjump|\bhop|\bjog|\brun\b|\bsprint|\btravel/i, ex.id);
    if (ex.impact === 'medium') assert.ok(!ex.conditioning && ex.patterns.some(p => ['squat', 'lunge'].includes(p)), ex.id + ' medium impact only for controlled squats/lunges');
    // Timed only where the catalogue supports it; rep-only movements are never converted.
    assert.ok(!ex.prescriptionModes || ex.prescriptionModes.includes('time'), ex.id);
    if (ex.sidedness === 'per-side') assert.equal(ex.prescription.type, 'unilateral-timed', ex.id);
    else assert.ok(ex.prescription.type === 'timed' || ex.mainProtocols.includes('timed_intervals'), ex.id);
    if (ex.sidedness === 'per-side') assert.ok(ex.timedCues.every(cue => !/side/i.test(cue.text)), ex.id);
    assert.equal(ex.cooldown === true, section === 'cooldown', ex.id);
  }
  for (const id of ['dead-bug', 'bird-dog', 'glute-bridge', 'reverse-lunge', 'walking-lunge', 'curtsy-lunge', 'jumping-jacks', 'mountain-climbers',
    'low-pogo-hops', 'fast-feet', 'in-in-out-out-steps', 'bum-kicks', 'wall-push-up', 'chair-step-ups', 'wall-angel', 'hollow-body-hold', 'v-ups',
    'pike-push-up', 'bear-crawl', 'kick-through', 'hand-release-push-up', 'plank-shoulder-taps', 'standing-calf-stretch', 'standing-quads',
    'seated-spinal-rotation-stretch', 'forward-back-aerobic-steps', 'lateral-shuffle', 'grapevine-cross-steps', 'easy-recovery-walk']) {
    assert.ok(catalogue[id], id);
    assert.ok(!POOL.has(id), id + ' must not be selectable');
  }
});

test('adversarial catalogue drift excludes unsafe entries rather than substituting them', () => {
  const base = clone(catalogue);
  const variants = {
    wall: ex => { ex.instruction = 'Face a wall with hands at chest height, bend your elbows to bring your chest towards it, then press away.'; },
    support: ex => { ex.instruction = 'Stand tall holding a support, lower your chest by bending your elbows, then press up, keeping your body straight.'; },
    jumping: ex => { ex.instruction = 'Start in a plank, jump your hands apart and together, landing softly and keeping your body straight throughout.'; },
    equipment: ex => { ex.equipment = [['dumbbells']]; },
    impact: ex => { ex.impact = 'high'; },
    hard: ex => { ex.difficulty = 'hard'; },
    repOnly: ex => { ex.mainProtocols = ['rounds', 'paired_sets']; },
    repsMode: ex => { ex.prescriptionModes = ['reps']; },
    position: ex => { ex.bodyPosition = 'supported'; },
    cue: ex => { ex.timedCues = [{ text: 'Halfway', at: { type: 'seconds', value: 10 } }]; }
  };
  for (const [name, mutate] of Object.entries(variants)) {
    const copy = clone(base); mutate(copy['push-up']);
    assert.ok(!Low.eligible(copy).some(entry => entry.exercise.id === 'push-up'), name);
    for (const duration of [10, 30]) {
      const plan = Low.generate({ duration, catalogue: copy, random: seeded(5) });
      assert.ok(!plan.exercises.some(step => step.id === 'push-up'), name);
      assert.equal(Low.validate(plan, copy).valid, true, name);
    }
  }
  // A previewed plan whose press-up has since become unsuitable is refused, not repaired.
  let plan, random = seeded(3);
  do plan = Low.generate({ duration: 20, random }); while (!plan.exercises.some(step => step.id === 'push-up'));
  const copy = clone(base); copy['push-up'].equipment = [['bench']];
  assert.equal(Low.validate(plan, copy).valid, false);
});

test('an unreachable pool produces a clear, bounded error without a partial plan', () => {
  const removals = {
    'no floor support work': id => POOL.get(id)?.tags.includes('support'),
    'no standing lower-body strength': id => POOL.get(id)?.tags.includes('lower') && POOL.get(id).section === 'main',
    'no conditioning': id => POOL.get(id)?.tags.some(tag => tag === 'cardio' || tag === 'punch'),
    'no warm-up pulse raiser': id => POOL.get(id)?.tags.includes('pulse'),
    'no spine stretch': id => POOL.get(id)?.section === 'cooldown' && POOL.get(id).tags.includes('spine')
  };
  for (const [name, remove] of Object.entries(removals)) {
    const copy = Object.fromEntries(Object.entries(clone(catalogue)).filter(([id]) => !remove(id)));
    for (const duration of DURATIONS) {
      const started = Date.now();
      assert.throws(() => Low.generate({ duration, catalogue: copy, random: seeded(1) }), /Low Impact is unavailable/, name);
      assert.ok(Date.now() - started < 3000, name + ' search is bounded');
    }
  }
  assert.throws(() => Low.generate({ catalogue: {}, random: seeded(1) }), /unavailable/);
});

test('playback validation rejects malformed durations, sides, phases and sequences', () => {
  let plan, random = seeded(11);
  do plan = Low.generate({ duration: 20, random }); while (!plan.exercises.some(step => step.side) || !plan.exercises.some(step => step.id === 'push-up'));
  assert.equal(Low.validate(plan).valid, true);
  const perSide = plan.exercises.findIndex(step => step.side);
  const firstFloor = plan.exercises.findIndex(step => step.section === 'main' && step.position === 'floor');
  const broken = {
    'string duration': p => { p.exercises[0].durationSeconds = '35'; },
    'negative changeover': p => { p.exercises[0].transitionAfter = -5; },
    'longer total': p => { p.exercises[0].durationSeconds += 5; },
    'phase moved': p => { p.exercises[0].durationSeconds += 5; p.exercises.at(-1).durationSeconds -= 5; },
    'trailing changeover': p => { p.exercises.at(-1).transitionAfter = 5; },
    'wrong total': p => { p.termination.durationSeconds = 1500; },
    'wrong duration': p => { p.durationMinutes = 25; },
    'rounds': p => { p.termination.type = 'timed-sequence'; },
    'missing exercise': p => { p.exercises[0].id = 'not-an-exercise'; },
    'rep-only exercise': p => { p.exercises[0].id = 'dead-bug'; },
    'wrong section': p => { p.exercises[0].section = 'main'; },
    'side on bilateral': p => { p.exercises.find(step => !step.side).side = 'left'; },
    'short floor changeover': p => { p.exercises[firstFloor - 1].transitionAfter = 10; p.exercises[firstFloor].durationSeconds += 5; },
    'back to back': p => { p.exercises[1] = { ...p.exercises[0] }; },
    'extra press-up': p => { const index = p.exercises.findIndex(step => step.section === 'main' && step.position === 'floor' && step.id !== 'push-up' && !step.side); Object.assign(p.exercises[index], { id: 'push-up', name: 'Push-ups' }); },
    'empty': p => { p.exercises = []; },
    'name contradicts side': p => { p.exercises[perSide].name = p.exercises[perSide].name.replace(/Right$/, 'Left'); },
    'renamed exercise': p => { p.exercises[0].name = 'Something else'; },
    'reversed sides': p => { p.exercises[perSide].side = 'left'; p.exercises[perSide + 1].side = 'right'; },
    'unequal sides': p => { p.exercises[perSide].durationSeconds += 5; p.exercises[perSide + 1].durationSeconds -= 5; },
    'one side only': p => { const [first, second] = p.exercises.splice(perSide, 2); first.durationSeconds *= 2; first.transitionAfter = second.transitionAfter + 5; p.exercises.splice(perSide, 0, first); }
  };
  for (const [name, mutate] of Object.entries(broken)) {
    const copy = clone(plan); mutate(copy);
    assert.equal(Low.validate(copy).valid, false, name);
  }
  assert.equal(Low.validate(null).valid, false);
});

test('recency rotates started choices, tolerates broken storage and never outranks the rules', () => {
  assert.deepEqual(Low.readRecent(null), []);
  assert.deepEqual(Low.readRecent({ getItem() { throw Error('blocked'); } }), []);
  assert.deepEqual(Low.readRecent({ getItem() { return '{'; } }), []);
  assert.deepEqual(Low.readRecent({ getItem() { return '{"a":1}'; } }), []);
  assert.deepEqual(Low.readRecent({ getItem() { return '[null,[],[4],"x",["a","a"],["ok"]]'; } }), [['ok']]);
  Low.recordStarted(null, Low.generate({ random: seeded(1) }));
  Low.recordStarted({ getItem() { return null; }, setItem() { throw Error('full'); } }, Low.generate({ random: seeded(1) }));

  const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const random = seeded(5);
  let previous = null;
  for (let run = 0; run < 4; run++) {
    const plan = Low.generate({ duration: 10, random, recent: Low.readRecent(storage) });
    assertSoundPlan(plan, 10);
    const warmup = plan.exercises.filter(step => step.section === 'warmup').map(step => step.id);
    if (previous) assert.ok(!warmup.some(id => previous.includes(id)), 'warm-up choices rotate when alternatives exist');
    Low.recordStarted(storage, plan);
    previous = [...new Set(plan.exercises.map(step => step.id))];
  }
  const stored = JSON.parse(data.get(Low.historyKey));
  assert.equal(stored.length, 3);
  assert.deepEqual(stored.at(-1), previous);
  // When every option is recent, a valid plan is still produced for every duration.
  const everything = [[...POOL.keys()]];
  for (const duration of DURATIONS) assertSoundPlan(Low.generate({ duration, random: seeded(8), recent: everything }), duration);
});

// ---- Workouts card, detail, preview, player and history integration ----

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) { if (force === undefined) force = !this.values.has(value); force ? this.values.add(value) : this.values.delete(value); return force; }
}
class Element {
  constructor(id = '') {
    this.id = id; this.classList = new ClassList(); this.style = {}; this.children = []; this.attributes = {}; this.disabled = false; this.textContent = ''; this.value = ''; this.listeners = {}; this._html = '';
  }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = String(value); if (value === '') this.children = []; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  querySelector() { return new Element(); }
  addEventListener(type, listener) { (this.listeners[type] = this.listeners[type] || []).push(listener); }
  click() { (this.listeners.click || []).forEach(listener => listener()); }
  focus() {}
}

function loadApp(options = {}) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  for (const id of ['partialRepsDialog', 'doneStats', 'generatedDoneStats', 'amrapDoneStats']) elements[id].classList.add('hidden');
  const storage = new Map(), spoken = [], intervals = new Map(); let nextInterval = 1;
  const context = {
    console, Math, Set,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    speechSynthesis: { cancel() {}, speak(utterance) { spoken.push(utterance.text); } },
    document: { getElementById: id => elements[id] || (elements[id] = new Element(id)), createElement: () => new Element(), addEventListener() {}, head: new Element(), querySelector() { return null; } },
    localStorage: { get length() { return storage.size; }, key: i => [...storage.keys()][i] || null, getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    navigator: {},
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
    setInterval: callback => { const id = nextInterval++; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: callback => callback(),
    addEventListener() {}
  };
  if (options.random) { context.Math = Object.create(Math); context.Math.random = options.random; }
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of ['data/equipment.js', 'data/exercises.js', 'data/workouts.js', 'data/workout-families.js', 'js/workout-families.js', 'js/generator.js', 'js/routine-generator.js', 'js/desk-break.js', 'js/ab-blast.js', 'js/evening-reset.js', 'js/low-impact.js', 'js/training-history.js', 'js/timed-cues.js', 'js/speech-voices.js', 'js/completion-signal.js', 'js/coach-model.js', 'js/coach-store.js', 'js/first-use.js', 'js/session-tracker.js', 'js/coach-recovery.js', 'js/coach-progress-ui.js', 'js/workout-preview.js', 'js/masthead.js', 'js/back-navigation.js', 'js/progress-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline, context, { filename: 'index-inline.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8'), context, { filename: 'js/workouts-ui.js' });
  elements.bottomNav.parentNode = { insertBefore() {} };
  context.GarageFitWorkoutUI.install();
  const run = code => vm.runInContext(code, context);
  return { context, elements, intervals, spoken, storage, run, ui: context.GarageFitWorkoutUI };
}
const tick = (intervals, timerId, times) => { for (let i = 0; i < times; i++) intervals.get(timerId)(); };
const settleHistory = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
async function saved(context) { await settleHistory(); return (await context.GarageFitCoachStore.createStore(context.localStorage).listSessionResults()).results; }
const total = definition => definition.exercises.reduce((sum, ex) => sum + Number.parseInt(ex.target, 10), 0);
const durationButtons = elements => elements.lowImpactDurationChoices.children;
function previewFor(app, predicate, guardLimit = 80) {
  let guard = 0;
  do { app.elements.fixedWorkoutDetailRegenerate.click(); assert.ok(guard++ < guardLimit); }
  while (!predicate(app.ui.detailDefinition('lowImpact')));
}
function runToEnd(app) {
  let count = 0;
  while (app.run('state.running')) { assert.ok(count++ < 5000, 'player finishes'); app.intervals.get(app.run('state.timer'))(); }
}

test('the Workouts card communicates a generated 10–30 minute bodyweight workout', () => {
  const { ui } = loadApp({ random: seeded(21) });
  assert.deepEqual({ ...ui.cardMeta.lowImpact }, { name: 'Low Impact', kicker: 'Small space', number: '10–30', format: 'Quiet full-body · No equipment', summary: '10–30 min · Bodyweight', generated: true, range: true });
  const source = fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8');
  assert.match(source, /\['abBlast','lowImpact','eveningFullBodyReset','postRunReset'\]/);
  assert.match(source, /if\(meta\.range\)button\.querySelector\('\.workout-number'\)\.classList\.add\('workout-number-range'\)/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /<script src="js\/evening-reset.js"><\/script>\n<script src="js\/low-impact.js"><\/script>/);
});

test('detail opens at 20 minutes with an accessible duration choice and a full preview', () => {
  const app = loadApp({ random: seeded(42) }), { ui, elements } = app;
  ui.openWorkoutDetail('lowImpact');
  assert.equal(elements.fixedWorkoutDetailTitle.textContent, 'Low Impact');
  assert.equal(elements.fixedWorkoutDetailFormat.textContent, '20 min · Quiet full-body');
  assert.match(elements.fixedWorkoutDetailDescription.textContent, /controlled strength and low-impact conditioning/i);
  assert.match(elements.fixedWorkoutDetailDescription.textContent, /no jumping and no equipment/i);
  assert.match(elements.fixedWorkoutDetailDescription.textContent, /small clear floor space; a mat is optional/i);
  assert.equal(elements.lowImpactDuration.classList.contains('hidden'), false);
  assert.equal(elements.fixedWorkoutDetailRegenerate.classList.contains('hidden'), false);
  assert.equal(elements.fixedWorkoutDetailStart.disabled, false);
  assert.equal(elements.challenge300Error.textContent, '');
  assert.match(fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8'), /<h2 id="lowImpactDurationLabel">Duration<\/h2><div class="choice-row" id="lowImpactDurationChoices" role="group" aria-labelledby="lowImpactDurationLabel">/);
  // The choice sits at the top of the detail, directly under the title and above the description and preview.
  assert.match(fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8'), /id="fixedWorkoutDetailTitle"><\/h2><div class="generator-card fixed-detail-duration hidden" id="lowImpactDuration">[\s\S]*?<\/div><\/div><p class="fixed-detail-description"/);
  const buttons = durationButtons(elements);
  assert.deepEqual(buttons.map(button => button.textContent), ['10 min', '15 min', '20 min', '30 min']);
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-pressed')), ['false', 'false', 'true', 'false']);
  assert.ok(buttons.every(button => button.type === 'button'));
  const definition = ui.detailDefinition('lowImpact');
  assert.ok(definition.exercises.length >= 16);
  assert.match(definition.exercises[0].note, /^Warm-up · 3 min$/);
  assert.ok(definition.exercises.some(ex => ex.note === 'Main · 15 min · Standing'));
  assert.ok(definition.exercises.some(ex => ex.note === 'Move to the floor'));
  assert.ok(definition.exercises.some(ex => ex.note === 'Back to standing'));
  assert.ok(definition.exercises.some(ex => ex.note === 'Cool-down · 2 min'));
  // The selector exists only on Low Impact; other specialist details are unchanged.
  ui.openWorkoutDetail('eveningFullBodyReset');
  assert.equal(elements.lowImpactDuration.classList.contains('hidden'), true);
  assert.equal(elements.challenge300Error.textContent, '');
  ui.openWorkoutDetail('postRunReset');
  assert.equal(elements.lowImpactDuration.classList.contains('hidden'), true);
  assert.equal(elements.fixedWorkoutDetailRegenerate.classList.contains('hidden'), true);
});

test('duration changes and Regenerate replace only the unstarted preview; re-opening resets to 20', () => {
  const app = loadApp({ random: seeded(9) }), { ui, elements, storage } = app;
  ui.openWorkoutDetail('lowImpact');
  for (const [index, minutes] of [[0, 10], [1, 15], [3, 30], [2, 20]]) {
    const before = ui.detailDefinition('lowImpact');
    durationButtons(elements)[index].click();
    const after = ui.detailDefinition('lowImpact');
    assert.equal(elements.fixedWorkoutDetailFormat.textContent, minutes + ' min · Quiet full-body');
    assert.deepEqual(durationButtons(elements).map(button => button.getAttribute('aria-pressed')), [10, 15, 20, 30].map(value => String(value === minutes)));
    assert.notDeepEqual(after.exercises.map(ex => ex.name), before.exercises.map(ex => ex.name));
    // The listed preview totals the selected time once its changeovers are added.
    assert.ok(total(after) < minutes * 60 && total(after) > minutes * 60 * 0.7);
  }
  durationButtons(elements)[0].click();
  const first = ui.detailDefinition('lowImpact');
  elements.fixedWorkoutDetailRegenerate.click();
  const second = ui.detailDefinition('lowImpact');
  assert.equal(elements.fixedWorkoutDetailFormat.textContent, '10 min · Quiet full-body', 'Regenerate keeps the selected duration');
  assert.equal(durationButtons(elements)[0].getAttribute('aria-pressed'), 'true');
  assert.notDeepEqual(second.exercises.map(ex => ex.id), first.exercises.map(ex => ex.id));
  assert.equal(storage.has(Low.historyKey), false, 'previews, duration changes and Regenerate are not starts');
  ui.openWorkoutDetail('lowImpact');
  assert.equal(elements.fixedWorkoutDetailFormat.textContent, '20 min · Quiet full-body', 'each new opening starts at 20 minutes');
  assert.equal(durationButtons(elements)[2].getAttribute('aria-pressed'), 'true');
});

test('Start plays exactly the displayed validated plan, once, and records only that start', () => {
  for (const index of [0, 1, 2, 3]) {
    const app = loadApp({ random: seeded(50 + index) }), { ui, elements, storage, run } = app;
    ui.openWorkoutDetail('lowImpact');
    durationButtons(elements)[index].click();
    const preview = ui.detailDefinition('lowImpact');
    elements.fixedWorkoutDetailStart.click();
    assert.equal(run('state.key'), 'fixedSequence');
    assert.equal(elements.routineName.textContent, 'Low Impact');
    const launched = run('state.list');
    assert.deepEqual(clone(Array.from(launched, ex => [ex.id, ex.name, ex.work + ' sec'])), clone(preview.exercises.map(ex => [ex.id, ex.name, ex.target])));
    assert.equal(Array.from(launched, ex => ex.work + ex.rest).reduce((a, b) => a + b, 0), [10, 15, 20, 30][index] * 60);
    // Side identity travels with each per-side step.
    assert.deepEqual(Array.from(launched, ex => ex.side), Array.from(launched, ex => / - Right$/.test(ex.name) ? 'right' : / - Left$/.test(ex.name) ? 'left' : null));
    assert.deepEqual(JSON.parse(storage.get(Low.historyKey)), [[...new Set(preview.exercises.map(ex => ex.id))]]);
    ui.startSelectedWorkout(); ui.startFixedSequenceWorkout('lowImpact');
    assert.equal(run('state.list'), launched, 'a repeated Start neither restarts nor regenerates');
    assert.equal(JSON.parse(storage.get(Low.historyKey)).length, 1);
  }
});

test('generation and Start validation failures disable Start and never launch a stale plan', () => {
  const app = loadApp(), { ui, elements, storage, context, run } = app;
  const generate = context.GarageFitLowImpact.generate, validate = context.GarageFitLowImpact.validate;
  ui.openWorkoutDetail('lowImpact');
  context.GarageFitLowImpact.generate = () => { throw new Error('Low Impact is unavailable: test pool.'); };
  durationButtons(elements)[3].click();
  assert.equal(elements.challenge300Error.textContent, 'Low Impact is unavailable: test pool.');
  assert.equal(elements.fixedWorkoutDetailStart.disabled, true);
  assert.equal(ui.detailDefinition('lowImpact').exercises.length, 0, 'the earlier plan is discarded');
  assert.equal(elements.fixedWorkoutDetailFormat.textContent, '30 min · Quiet full-body');
  ui.startSelectedWorkout(); ui.startFixedSequenceWorkout('lowImpact');
  assert.equal(run('state.running'), false);
  assert.equal(storage.has(Low.historyKey), false);
  context.GarageFitLowImpact.generate = generate;
  elements.fixedWorkoutDetailRegenerate.click();
  assert.equal(elements.challenge300Error.textContent, '');
  assert.equal(elements.fixedWorkoutDetailStart.disabled, false);
  assert.equal(elements.fixedWorkoutDetailFormat.textContent, '30 min · Quiet full-body');
  ui.openWorkoutDetail('postRunReset');
  assert.equal(elements.fixedWorkoutDetailStart.disabled, false, 'Low Impact errors do not leak');
  ui.openWorkoutDetail('lowImpact');
  context.GarageFitLowImpact.validate = () => ({ valid: false, errors: ['The plan must last exactly 20 minutes.'] });
  ui.startSelectedWorkout();
  assert.equal(run('state.running'), false);
  assert.match(elements.challenge300Error.textContent, /could not start\. The plan must last exactly 20 minutes\./);
  assert.equal(ui.detailDefinition('lowImpact').exercises.length, 0);
  assert.equal(elements.fixedWorkoutDetailStart.disabled, true);
  assert.equal(storage.has(Low.historyKey), false);
  context.GarageFitLowImpact.validate = validate;
});

test('unavailable storage does not block preview, Start or completion', () => {
  const app = loadApp();
  app.context.localStorage.getItem = () => { throw Error('blocked'); };
  app.context.localStorage.setItem = () => { throw Error('blocked'); };
  app.ui.openWorkoutDetail('lowImpact');
  durationButtons(app.elements)[0].click();
  assert.equal(app.elements.fixedWorkoutDetailStart.disabled, false);
  app.ui.startSelectedWorkout();
  assert.equal(app.run('state.running'), true);
  runToEnd(app);
  assert.equal(app.elements.doneTitle.textContent, 'Low Impact Complete');
});

test('playback runs every step once with exact changeovers, sides and timed cues', () => {
  const app = loadApp({ random: seeded(17) }), { ui, elements, intervals, spoken, run, context } = app;
  ui.openWorkoutDetail('lowImpact');
  durationButtons(elements)[0].click();
  previewFor(app, definition => definition.exercises.some(ex => / - Right$/.test(ex.name)) &&
    definition.exercises.some(ex => context.GarageFitData.exercises[ex.id].timedCues.length));
  ui.startSelectedWorkout();
  const list = run('state.list');
  assert.equal(run('state.remaining'), 3, 'separate 3-second get-ready');
  tick(intervals, run('state.timer'), 3);
  let seconds = 0, cues = 0;
  for (let index = 0; index < list.length; index++) {
    assert.equal(run('state.idx'), index);
    assert.equal(run('state.phase'), 'work');
    assert.equal(elements.exerciseName.textContent, list[index].name);
    assert.equal(run('state.remaining'), list[index].work);
    const cue = context.GarageFitData.exercises[list[index].id].timedCues[0];
    tick(intervals, run('state.timer'), list[index].work);
    if (cue) { assert.ok(spoken.includes(cue.text)); cues++; }
    seconds += list[index].work;
    if (index < list.length - 1) {
      assert.equal(run('state.phase'), 'rest');
      assert.equal(run('state.remaining'), list[index].rest);
      assert.equal(spoken.at(-1), list[index + 1].name);
      seconds += list[index].rest;
      tick(intervals, run('state.timer'), list[index].rest);
    }
  }
  assert.ok(cues > 0);
  assert.equal(seconds, 600);
  assert.equal(run('state.running'), false);
  assert.equal(elements.doneTitle.textContent, 'Low Impact Complete');
  assert.equal(elements.doneSub.textContent, 'Low Impact complete. Nicely done.');
  assert.equal(elements.doneBtn.textContent, 'Back to workouts');
  assert.equal(intervals.size, 0, 'no timers survive completion');
});

test('rapid Next bursts, pause/resume and stale callbacks cannot double-advance or invent work', () => {
  const app = loadApp({ random: seeded(23) }), { ui, intervals, run, context } = app;
  let now = 1000; context.Date = { now: () => now, prototype: Date.prototype };
  ui.openWorkoutDetail('lowImpact'); ui.startSelectedWorkout();
  const readyTick = intervals.get(run('state.timer'));
  for (let i = 0; i < 10; i++) context.skipPhase();
  assert.equal(run('state.phase'), 'work'); assert.equal(run('state.idx'), 0);
  readyTick(); assert.equal(run('state.remaining'), run('state.list[0].work'), 'stale ready tick ignored');
  const workTick = intervals.get(run('state.timer'));
  context.togglePause(); workTick(); context.skipPhase();
  assert.equal(run('state.remaining'), run('state.list[0].work'), 'paused time and Next are frozen');
  context.togglePause(); workTick(); workTick();
  now += 400; context.skipPhase(); assert.equal(run('state.phase'), 'rest');
  for (let i = 0; i < 10; i++) context.skipPhase();
  assert.equal(run('state.phase'), 'rest', 'a burst within the debounce advances once');
  now += 400; context.skipPhase(); assert.equal(run('state.idx'), 1);
  workTick(); assert.equal(run('state.remaining'), run('state.list[1].work'), 'stale work tick cannot touch the next step');
});

test('confirmed exit saves nothing, leaves no live timers, and re-entry is a fresh 20-minute preview', async () => {
  const app = loadApp({ random: seeded(29) }), { ui, intervals, run, context, elements } = app;
  ui.openWorkoutDetail('lowImpact'); durationButtons(elements)[1].click(); ui.startSelectedWorkout();
  tick(intervals, run('state.timer'), 3);
  const stale = intervals.get(run('state.timer'));
  context.openExitDialog('routine'); context.confirmExitChoice();
  assert.equal(run('state.running'), false);
  stale();
  assert.equal((await saved(context)).length, 0);
  ui.openWorkoutDetail('lowImpact');
  assert.equal(elements.fixedWorkoutDetailFormat.textContent, '20 min · Quiet full-body');
  ui.startSelectedWorkout();
  stale();
  assert.equal(run('state.remaining'), 3);
});

test('a completed run saves honest phased evidence once and counts as Training, not Coach credit', async () => {
  const app = loadApp({ random: seeded(31) }), { ui, context, run, intervals, elements } = app;
  await run('firstUse.ready');
  ui.openWorkoutDetail('lowImpact'); durationButtons(elements)[0].click();
  previewFor(app, definition => definition.exercises.some(ex => / - Right$/.test(ex.name)));
  ui.startSelectedWorkout();
  const list = run('state.list');
  const oldTick = intervals.get(run('state.timer'));
  runToEnd(app); oldTick();
  const results = await saved(context);
  assert.equal(results.length, 1);
  const [result] = results;
  assert.equal(result.source, 'fixed'); assert.equal(result.workoutId, 'lowImpact'); assert.equal(result.finalStatus, 'completed');
  assert.equal(result.programmeInstanceId, undefined);
  assert.equal(result.actualDurationSeconds, 600, 'the get-ready countdown is not exercise time');
  assert.deepEqual(Array.from(result.plannedWork, p => p.exerciseId), Array.from(list, e => e.id));
  const plan = JSON.parse(context.localStorage.getItem(Low.historyKey)).at(-1);
  assert.deepEqual(plan, [...new Set(list.map(e => e.id))]);
  const sections = Array.from(result.plannedWork, p => p.section);
  assert.ok(sections.includes('warmup') && sections.includes('main') && sections.includes('cooldown'));
  assert.ok(!sections.includes('movement-break'));
  result.plannedWork.forEach(p => assert.equal(p.section, Low.eligible().find(entry => entry.exercise.id === p.exerciseId).section));
  assert.deepEqual(Array.from(result.plannedWork, p => p.prescription.side || null), Array.from(list, e => e.side));
  assert.equal(new Set(result.plannedWork.map(p => p.occurrenceId)).size, result.plannedWork.length);
  result.performedWork.forEach((p, i) => { assert.equal(p.status, 'completed'); assert.equal(p.sets[0].seconds, list[i].work); });
  assert.equal(context.GarageFitProgressUI.label(result), 'Low Impact');
  assert.equal(context.GarageFitProgressUI.isTraining(result), true);
  assert.equal(context.GarageFitProgressUI.classification(result), 'Training');
  assert.deepEqual(clone(context.GarageFitProgressUI.summary(results, new Date(Date.parse(result.endedAt) + 1000))), { week: 1, fourWeeks: 1 });
  const history = context.GarageFitTrainingHistory.createHistory(results, context.GarageFitData.exercises);
  assert.equal(history.sessionsForProgramme('existing-coach').length, 0);
  assert.ok(history.performances.filter(item => item.section === 'main').length > 0);
  assert.equal(run('firstUse.snapshot().completed'), true);
  assert.equal(elements.firstSaveddone.classList.contains('hidden'), false);
});

test('partial, skipped and warm-up-only runs record only actual work and are not Training without Main', async () => {
  {
    const app = loadApp({ random: seeded(37) }), { ui, context, run, intervals, elements } = app;
    ui.openWorkoutDetail('lowImpact'); durationButtons(elements)[0].click(); ui.startSelectedWorkout();
    tick(intervals, run('state.timer'), 3);
    tick(intervals, run('state.timer'), 2);
    run('Date.now=()=>2000000000000'); context.skipPhase();
    assert.equal(run('state.phase'), 'rest');
    tick(intervals, run('state.timer'), run('state.remaining'));
    run('Date.now=()=>2000000001000'); context.skipPhase();
    runToEnd(app);
    const [result] = await saved(context);
    assert.equal(result.performedWork[0].status, 'partial'); assert.equal(result.performedWork[0].sets[0].seconds, 2);
    assert.ok(!result.performedWork.some(p => p.occurrenceId === result.plannedWork[1].occurrenceId));
    assert.equal(context.GarageFitProgressUI.classification(result), 'Training');
  }
  {
    // Perform the warm-up only, then skip every remaining step: honest, but not training.
    const app = loadApp({ random: seeded(41) }), { ui, context, run, intervals, elements } = app;
    ui.openWorkoutDetail('lowImpact'); durationButtons(elements)[0].click(); ui.startSelectedWorkout();
    const list = run('state.list');
    let count = 0, clock = 2000000000000;
    while (run('state.running')) {
      assert.ok(count++ < 5000);
      const step = list[run('state.idx')];
      const inWarmup = Low.eligible().find(entry => entry.exercise.id === step.id).section === 'warmup';
      if (run('state.phase') === 'ready' || (inWarmup && run('state.phase') !== 'rest')) intervals.get(run('state.timer'))();
      else { clock += 1000; run('Date.now=()=>' + clock); context.skipPhase(); }
    }
    const [result] = await saved(context);
    assert.ok(result.performedWork.length > 0);
    assert.ok(result.performedWork.every(p => result.plannedWork.find(w => w.occurrenceId === p.occurrenceId).section === 'warmup'));
    assert.equal(context.GarageFitProgressUI.isTraining(result), false);
    assert.equal(context.GarageFitProgressUI.classification(result), 'Recorded activity');
    assert.equal(context.GarageFitProgressUI.label(result), 'Low Impact');
  }
  {
    const app = loadApp(), { ui, context, run, elements } = app;
    await run('firstUse.ready');
    ui.openWorkoutDetail('lowImpact'); durationButtons(elements)[0].click(); ui.startSelectedWorkout();
    let count = 0;
    while (run('state.running')) { assert.ok(count++ < 200); run('Date.now=()=>' + (2000000000000 + count * 1000)); context.skipPhase(); }
    const [result] = await saved(context);
    assert.equal(result.performedWork.length, 0);
    assert.equal(result.actualDurationSeconds, 0);
    assert.equal(context.GarageFitProgressUI.isTraining(result), false);
    assert.equal(run('firstUse.snapshot().completed'), false);
  }
});

test('navigation abandons transient evidence and a storage failure does not block completion', async () => {
  const app = loadApp(), { ui, context, intervals, run, elements } = app;
  ui.openWorkoutDetail('lowImpact'); ui.startSelectedWorkout();
  const stale = intervals.get(run('state.timer'));
  context.goWorkouts(); stale();
  assert.equal((await saved(context)).length, 0);
  ui.openWorkoutDetail('lowImpact'); durationButtons(elements)[0].click(); ui.startSelectedWorkout();
  context.localStorage.setItem = () => { throw Error('blocked'); };
  runToEnd(app); await settleHistory();
  assert.equal(elements.doneTitle.textContent, 'Low Impact Complete');
  assert.match(elements.doneSub.textContent, /History could not be saved/);
});
