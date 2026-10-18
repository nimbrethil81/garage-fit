// Workout Patterns 1 (#76): the existing paired_sets protocol presented as a superset.
// The protocol id, prescription, steps and dose are unchanged; only presentation differs.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {loadAppContext} = require('./helpers/app-context.js');
const {traceBlock} = require('./helpers/protocol-fixtures.js');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
const G = GarageFitGenerator, catalogue = GarageFitData.exercises;
const plain = value => JSON.parse(JSON.stringify(value));
function random(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

// The player with a controllable clock and timers, loaded with one superset block.
function player(prescription = {sets: 3, betweenExercisesSeconds: 10, betweenSetsSeconds: 60}, exercises = ['goblet-squat','trx-row']) {
  const app = loadAppContext(new Map(), {ownIntrinsics: true}), run = code => vm.runInContext(code, app);
  run('var testNow=Date.now();Date.now=()=>testNow');
  const timers = new Map(); let id = 0;
  app.setInterval = callback => { timers.set(++id, callback); return id; };
  app.clearInterval = timer => timers.delete(timer);
  run(`state.ownedEquipment=['dumbbells','kettlebell','bench','trx','bands'];
    generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:20,focus:'strength',equipment:state.ownedEquipment,random:(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;})(3)});
    generatorState.workout.main.blocks=[{id:'main-1',protocol:'paired_sets',intent:'strength',
      exercises:${JSON.stringify(exercises)}.map(id=>CATALOGUE[id]),prescription:${JSON.stringify(prescription)}}];
    delete generatorState.workout.main.estimatedDurationSeconds;`);
  const el = name => app.document.getElementById(name);
  return {app, run, el,
    start() { app.startStandaloneGeneratedWorkout(); },
    tick(ms = 1000) { run(`testNow+=${ms}`); timers.get(run('generatorState.phaseTimer'))(); },
    timeline: () => run('generatorState.timeline'),
    index: () => run('generatorState.timelineIndex'),
    // What the player shows: progress label, heading, primary action and next-item name.
    screen: () => [el('workoutMovementProgress').textContent, el('workoutExercise').textContent,
      el('completeMovementAction').textContent, el('completeMovementNext').textContent],
    mainIndexes() { return plain(this.timeline()).map((phase, index) => [phase, index]).filter(([phase]) => phase.section === 'main' && phase.kind !== 'transition').map(([, index]) => index); }};
}

test('a superset plays A then B each set, labels each set and changeover, and rests only between pairs', () => {
  const p = player();
  p.start();
  const screens = p.mainIndexes().map(index => { p.app.enterGeneratedPhase(index); return p.screen(); });
  assert.deepEqual(plain(screens), [
    ['Block 1 of 1 · Superset · Set 1 of 3 · A', 'Goblet squat', 'Next', 'Change over'],
    ['Block 1 of 1 · Superset · Set 1 of 3', 'Change over', 'Skip rest', 'TRX row'],
    ['Block 1 of 1 · Superset · Set 1 of 3 · B', 'TRX row', 'Next', 'Rest'],
    ['Block 1 of 1 · Superset · Set 1 of 3 complete', 'Set 1 complete', 'Skip rest', 'Goblet squat'],
    ['Block 1 of 1 · Superset · Set 2 of 3 · A', 'Goblet squat', 'Next', 'Change over'],
    ['Block 1 of 1 · Superset · Set 2 of 3', 'Change over', 'Skip rest', 'TRX row'],
    ['Block 1 of 1 · Superset · Set 2 of 3 · B', 'TRX row', 'Next', 'Rest'],
    ['Block 1 of 1 · Superset · Set 2 of 3 complete', 'Set 2 complete', 'Skip rest', 'Goblet squat'],
    ['Block 1 of 1 · Superset · Set 3 of 3 · A', 'Goblet squat', 'Next', 'Change over'],
    ['Block 1 of 1 · Superset · Set 3 of 3', 'Change over', 'Skip rest', 'TRX row'],
    ['Block 1 of 1 · Superset · Set 3 of 3 · B', 'TRX row', 'Next', 'Cool-down']
  ]);
  // The changeover between A and B is never presented as a completed set or superset.
  const changeovers = screens.filter((screen, index) => p.timeline()[p.mainIndexes()[index]].kind === 'set-change');
  assert.ok(changeovers.length === 3 && changeovers.every(screen => !/complete/i.test(screen.join(' '))));
  // The stored protocol id is unchanged for playback and tracked records.
  assert.ok(p.timeline().filter(phase => phase.section === 'main' && phase.kind !== 'transition').every(phase => phase.protocol === 'paired_sets'));
});

test('a superset with no changeover goes straight from A to B, and per-side A plays both sides first', () => {
  const p = player({sets: 2, betweenExercisesSeconds: 0, betweenSetsSeconds: 45}, ['reverse-lunge','push-up']);
  p.start();
  const kinds = p.mainIndexes().map(index => { const phase = p.timeline()[index]; return phase.kind === 'exercise' ? phase.exerciseIndex+(phase.side ? ':'+phase.side : '') : phase.kind; });
  assert.deepEqual(plain(kinds), ['0:right','0:left','1','set-rest','0:right','0:left','1']);
  p.app.enterGeneratedPhase(p.mainIndexes()[1]);
  assert.equal(p.screen()[0], 'Block 1 of 1 · Superset · Set 1 of 2 · A');
  assert.equal(p.screen()[3], 'Push-up', 'the next item after A is B, with no changeover');
});

test('Previous steps back through the superset occurrences, and pause holds the changeover', () => {
  const p = player();
  p.start();
  const [a1, change1, b1, rest1, a2] = p.mainIndexes();
  p.app.enterGeneratedPhase(b1);
  p.app.previousGeneratedPhase();
  assert.equal(p.index(), a1, 'from B back to A of the same set');
  p.app.enterGeneratedPhase(a2);
  p.app.previousGeneratedPhase();
  assert.equal(p.index(), b1, 'from A of set 2 back to B of set 1, skipping rests');
  // Done on A moves into the changeover countdown; pausing holds it; resuming continues it.
  p.app.enterGeneratedPhase(a1);
  p.app.generatedPrimaryAction();
  assert.equal(p.index(), change1);
  p.tick(); assert.equal(p.run('Math.ceil(generatorState.remaining)'), 9);
  p.app.toggleWorkoutPause();
  p.run('testNow+=5000'); p.app.previousGeneratedPhase(); p.app.generatedPrimaryAction();
  assert.equal(p.index(), change1, 'paused navigation and actions are ignored');
  p.app.toggleWorkoutPause();
  assert.equal(p.run('Math.ceil(generatorState.remaining)'), 9, 'paused time is not counted');
  for (let second = 0; second < 9; second++) p.tick();
  assert.equal(p.index(), b1, 'the changeover ends into B');
  // Skip rest after the pair goes to the next set's A.
  p.app.enterGeneratedPhase(rest1);
  p.app.generatedPrimaryAction();
  assert.equal(p.index(), a2);
});

test('Done and Skip rest record only performed superset work', async () => {
  const p = player();
  const store = p.run('GarageFitCoachStore.createStore(localStorage)');
  p.app.startGeneratedWorkout({store, source: 'generator', meaningful: (outcome, planned) => planned.section === 'main'});
  const [a1, change1, b1] = p.mainIndexes();
  p.app.enterGeneratedPhase(a1); p.app.generatedPrimaryAction();
  assert.equal(p.index(), change1);
  p.app.generatedPrimaryAction();
  assert.equal(p.index(), b1, 'Skip rest moves straight to B without recording anything');
  await p.run('generatorState.tracker.flush()');
  const outcomes = plain(p.run('generatorState.tracker.performedWork()'));
  assert.deepEqual(outcomes.map(outcome => [outcome.occurrenceId, outcome.status]), [['main:b0:s1:e0', 'completed']]);
});

test('preview, player and timeline agree on sets, changeover, rest and total time', () => {
  const p = player();
  p.start();
  const block = plain(p.run('generatorState.workout.main.blocks[0]'));
  const label = p.run('GarageFitWorkoutPreview.protocolLabel(generatorState.workout.main.blocks[0])');
  assert.equal(label, 'Superset · 3 sets · A then B · 10 sec changeover · 60 sec rest after each pair');
  const main = plain(p.timeline()).filter(phase => phase.section === 'main' && phase.kind !== 'transition');
  assert.equal(main.filter(phase => phase.kind === 'exercise').length, 6);
  assert.deepEqual(main.filter(phase => phase.kind === 'set-change').map(phase => phase.seconds), [10, 10, 10]);
  assert.deepEqual(main.filter(phase => phase.kind === 'set-rest').map(phase => phase.seconds), [60, 60]);
  const trace = traceBlock(G, block);
  assert.deepEqual(trace.problems, []);
  assert.equal(block.estimatedDurationSeconds, trace.seconds);
  assert.equal(block.estimatedDurationSeconds, 3 * (25 + 30 + 10) + 2 * 60);
  // The generated preview marks the pair A and B and uses the same label.
  p.app.renderGeneratedPreview();
  const rows = p.el('previewList').children;
  assert.equal(rows[0].children[1].children[0].textContent, label);
  assert.deepEqual([rows[1], rows[2]].map(row => row.children[0].textContent), ['A','B']);
});

test('superset copy stays within existing player label lengths and needs no new layout', () => {
  const p = player();
  p.start();
  const longestRounds = 'Block 1 of 2 · Round 3 of 3 · Exercise 4 of 4'.length;
  for (const index of p.mainIndexes()) { p.app.enterGeneratedPhase(index); assert.ok(p.screen()[0].length <= longestRounds, p.screen()[0]); }
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'workout-preview.css'), 'utf8');
  assert.doesNotMatch(html, /class="[^"]*superset/i, 'no superset-specific markup');
  assert.doesNotMatch(css, /superset/i, 'no superset-specific styling');
  assert.match(html, /id="workoutExercise" aria-live="polite"/, 'changeover and set-complete headings are announced');
});

test('screen readers hear plain superset descriptions', () => {
  const p = player();
  p.start();
  const spoken = [];
  p.app.speak = text => spoken.push(text);
  const [a1, change1, , rest1] = p.mainIndexes();
  for (const index of [a1, change1, rest1]) p.app.enterGeneratedPhase(index);
  assert.ok(spoken.includes('Change over.'));
  assert.ok(spoken.includes('Superset set 1 complete. Rest.'));
  const label = p.run('GarageFitWorkoutPreview.protocolLabel(generatorState.workout.main.blocks[0])');
  assert.doesNotMatch(label, /[→↔]/, 'words, not arrows');
  p.app.renderGeneratedPreview();
  assert.equal(p.el('previewList').children[1].children[2].children[0].attributes['aria-label'], 'Swap Goblet squat');
});

// ---- Selection suitability and dose (no selection change in #76) ----

const kits = [['dumbbells','kettlebell','pullup-bar','trx','barbell','bench','box','bands'], ['dumbbells'], ['kettlebell','trx','bands'], []];

// Optional protocols broaden the mix; retain the pair minimum across a bounded sample.
test('generated supersets pair contrasting, compatible work without mass exclusions', () => {
  let pairs = 0, sharedPrimary = 0;
  for (const equipment of kits) for (const duration of [15, 30, 45]) for (const focus of ['strength','balanced','cardio']) for (let seed = 1; seed <= 12; seed++) {
    for (const block of G.generate({catalogue, duration, focus, equipment, random: random(seed * 97 + duration)}).main.blocks) {
      if (block.protocol !== 'paired_sets') continue;
      pairs++;
      const [a, b] = block.exercises;
      assert.equal(block.exercises.length, 2);
      assert.ok(block.prescription.sets >= 2 && block.prescription.sets <= 5, String(block.prescription.sets));
      assert.equal(a.impact === 'high' && b.impact === 'high', false, a.id+' + '+b.id);
      assert.ok(block.exercises.every(exercise => G.protocolCompatible(catalogue[exercise.id], 'paired_sets')));
      if (a.patterns[0] === b.patterns[0]) sharedPrimary++;
    }
  }
  assert.ok(pairs >= 80, pairs+' pairs');
  assert.ok(sharedPrimary / pairs <= 0.03, sharedPrimary+'/'+pairs+' share a primary pattern');
});

test('representative workouts are not dominated by tiny repeated loops', () => {
  for (const duration of [10, 20, 30, 45]) {
    let workouts = 0, dominated = 0;
    for (const equipment of kits.slice(0, 3)) for (const focus of ['strength','balanced','cardio']) for (let seed = 1; seed <= 8; seed++) {
      const blocks = G.generate({catalogue, duration, focus, equipment, random: random(seed * 31 + duration)}).main.blocks;
      const total = blocks.reduce((sum, block) => sum + block.estimatedDurationSeconds, 0);
      // A tiny straight-dose loop repeats three or fewer exercises five times.
      // Ladder steps change reps and enforce their own total-volume bounds.
      const tiny = blocks.filter(block => !['ladder','pyramid'].includes(block.protocol) && block.exercises.length <= 3 &&
        (block.protocol==='emom'?Math.ceil(G.blockRepeatCount(block)/block.exercises.length):G.blockRepeatCount(block)) >= 5);
      assert.ok(tiny.every(block => block.protocol === 'paired_sets'), duration+' '+focus);
      workouts++;
      if (tiny.reduce((sum, block) => sum + block.estimatedDurationSeconds, 0) / total > 0.5) dominated++;
    }
    assert.ok(dominated / workouts <= (duration === 45 ? 0.08 : 0), duration+': '+dominated+'/'+workouts);
  }
});
