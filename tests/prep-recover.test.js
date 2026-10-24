const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAppContext } = require('./helpers/app-context');

// Executable specification of the Prep & Recover tab: one-tap, dynamically generated
// five-minute Warm Up and Cool Down in the standalone routine player.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const home = html.match(/<main id="home"[\s\S]*?<\/main>/)[0];
const HISTORY_KEY = 'gf_routine_recent_v1';
const COMBINATIONS = [['warmup','bodyweight'],['warmup','equipment'],['cooldown','bodyweight'],['cooldown','equipment']];

function seeded(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
// App context with a seeded random source and a manual one-second clock for the routine player.
function app(options={}) {
  const storage = options.storage || new Map();
  const context = loadAppContext(storage);
  const spoken = [];
  context.Math = Object.assign(Object.create(Math), {random:seeded(options.seed || 7)});
  context.speechSynthesis.speak = utterance => spoken.push(utterance.text);
  let interval = null;
  context.setInterval = callback => { interval = callback; return 1; };
  context.clearInterval = () => { interval = null; };
  context.__inventory = options.inventory || [];
  vm.runInContext('state.ownedEquipment=__inventory.slice()', context);
  const run = code => vm.runInContext(code, context);
  return {context, storage, spoken, run,
    tick() { if (interval) interval(); },
    ticking() { return !!interval; },
    list: () => run('state.list'),
    screen: id => !context.document.getElementById(id).classList.contains('hidden'),
    el: id => context.document.getElementById(id)};
}
const total = list => list.reduce((sum, item) => sum + item.work + item.rest, 0);
// Values built in the app's VM realm compare structurally after a JSON round trip.
const plain = value => JSON.parse(JSON.stringify(value));
// Plays the routine to the end, one tick per second; returns the seconds the clock ran.
function playToEnd(a, onTick) {
  let seconds = 0;
  while (a.ticking() && seconds<1000) { a.tick(); seconds++; if (onTick) onTick(seconds); }
  return seconds;
}

test('Prep & Recover branding: nav label, heading, two cards and the unchanged shared variant toggle', () => {
  const nav = html.match(/<button class="nav-btn[^"]*" id="routinesNav"[\s\S]*?<\/button>/)[0];
  assert.match(nav, /<span>Prep &amp; Recover<\/span>/);
  assert.match(nav, /onclick="showLanding\('home'\)"/);
  // Each phrase stays together, so the title only wraps between them on narrow screens.
  assert.match(home, /<h1 class="screen-title"><span class="title-phrase">Warm-up &amp;<\/span> <span class="title-phrase">Cool-down<\/span><\/h1>/);
  assert.match(html, /\.title-phrase\{white-space:nowrap\}/);
  assert.deepEqual([...home.matchAll(/<span class="label">([^<]+)<\/span>/g)].map(match => match[1]), ['Warm Up','Cool Down']);
  assert.match(home, /startPreferredRoutine\('warmup'\)/);
  assert.match(home, /startPreferredRoutine\('cooldown'\)/);
  assert.deepEqual([...home.matchAll(/id="routineMode\w+"[^>]*>([^<]+)</g)].map(match => match[1]), ['Bodyweight','With equipment']);
  assert.match(home, /role="group" aria-label="Routine type"/);
  // No new options, previews or friction.
  assert.doesNotMatch(home, /<select|<input|Ramp Up|Snack|duration|difficulty|focus|intensity|preview|regenerate|equipToggle|openEquipment/i);
  assert.doesNotMatch(html, />Routines<|Choose a routine|Back to routines|fixedRoutines|routineList|expandLegacyTimed/);
  // Narrow screens: the two-word label wraps centred inside its tab rather than overflowing.
  assert.match(html, /\.nav-btn span:last-child\{text-align:center;line-height:1\.15\}/);
  assert.match(html, /@media\(max-width:380px\)\{\.nav-btn\{min-width:0;padding:8px 2px;font-size:9px;letter-spacing:0\}\}/);
});

test('cards show 5 min for the shared variant, which persists and defaults to Bodyweight', () => {
  const a = app();
  a.context.renderHome();
  assert.equal(a.el('warmupSub').textContent, 'Bodyweight · 5 min');
  assert.equal(a.el('cooldownSub').textContent, 'Bodyweight · 5 min');
  assert.equal(a.el('tile-warmup').attributes['aria-label'], 'Start Warm Up, Bodyweight, 5 minutes');
  a.context.setRoutineVariant('equipment');
  assert.equal(a.storage.get('gf_routine_variant'), 'equipment');
  assert.equal(a.el('cooldownSub').textContent, 'With equipment · 5 min');
  assert.equal(a.el('tile-cooldown').attributes['aria-label'], 'Start Cool Down, With equipment, 5 minutes');
  assert.equal(a.el('routineModeEquipment').attributes['aria-pressed'], 'true');
  assert.equal(a.el('routineModeBodyweight').attributes['aria-pressed'], 'false');
  const reloaded = app({storage:a.storage});
  reloaded.context.loadRoutineVariant(); reloaded.context.renderHome();
  assert.equal(reloaded.el('warmupSub').textContent, 'With equipment · 5 min');
  const fresh = app({storage:new Map([['gf_routine_variant','gym']])});
  fresh.context.loadRoutineVariant();
  assert.equal(fresh.run('routineVariant'), 'bodyweight');
});

test('a plan is generated only when Start is pressed', () => {
  const a = app();
  let calls = 0;
  const original = a.context.GarageFitRoutineGenerator.generateRoutine;
  a.context.GarageFitRoutineGenerator.generateRoutine = options => { calls++; return original(options); };
  a.context.renderHome(); a.context.setRoutineVariant('equipment'); a.context.setRoutineVariant('bodyweight'); a.context.showLanding('home');
  assert.equal(calls, 0);
  a.context.startPreferredRoutine('warmup');
  assert.equal(calls, 1);
  assert.ok(a.screen('player'));
});

test('one tap starts each kind and variant immediately with a validated 300-second plan', () => {
  const kit = loadAppContext().GarageFitData.equipment.map(item => item.id);
  for (const [kind, variant] of COMBINATIONS) for (const seed of [1,2,3]) {
    const a = app({seed, inventory:kit});
    a.context.setRoutineVariant(variant);
    a.context.startPreferredRoutine(kind);
    assert.ok(a.screen('player'), kind+'/'+variant);
    assert.equal(a.el('routineName').textContent, kind==='warmup' ? 'Warm Up' : 'Cool Down');
    const routine = a.run('state.routine'), list = a.list();
    assert.deepEqual(plain(a.context.GarageFitRoutineGenerator.validateRoutine(routine, a.context.GarageFitData.exercises)), []);
    assert.equal(total(list), 300);
    // The playlist is the plan, second for second: no rounding at hand-off.
    assert.deepEqual(plain(list.map(item => [item.id, item.name, item.work, item.rest])), plain(routine.phases.map(phase => [phase.id, phase.name, phase.work, phase.rest])));
    // Get Ready is a 3-second pre-start outside the programme.
    assert.equal(a.run('state.phase'), 'ready');
    assert.equal(a.run('state.remaining'), 3);
    assert.equal(a.el('routineNextName').textContent, list[0].name.replace(/ - (Left|Right)$/i,''));
  }
});

test('variant and inventory: bodyweight needs nothing, equipment uses only owned kit and falls back without it', () => {
  const catalogue = loadAppContext().GarageFitData.exercises;
  const kit = loadAppContext().GarageFitData.equipment.map(item => item.id);
  const equipmentOf = list => plain(list.flatMap(item => catalogue[item.id].equipment.flat()));
  for (let seed=1;seed<=8;seed++) {
    const bodyweight = app({seed, inventory:kit});
    bodyweight.context.startRoutine('cooldown', 'bodyweight');
    assert.deepEqual(equipmentOf(bodyweight.list()), []);
    const bands = app({seed, inventory:['bands']});
    bands.context.startRoutine('warmup', 'equipment');
    assert.ok(bands.list().every(item => catalogue[item.id].equipment.every(group => group.includes('bands'))), JSON.stringify(bands.list().map(item => item.id)));
    const none = app({seed, inventory:[]});
    none.context.startRoutine('cooldown', 'equipment');
    assert.deepEqual(equipmentOf(none.list()), []);
    assert.equal(total(none.list()), 300);
  }
});

test('the player plays every phase for its exact duration and finishes only at the end', () => {
  for (const [kind, variant] of COMBINATIONS) {
    const a = app({seed:11});
    a.context.startRoutine(kind, variant);
    const seconds = playToEnd(a);
    assert.equal(seconds, 3+300, kind+'/'+variant);
    assert.ok(a.screen('done'));
    assert.equal(a.el('doneBtn').textContent, 'Back to Prep & Recover');
    assert.equal(a.el('doneSub').textContent, kind==='warmup' ? "Warm-up complete. Let's go." : 'Cool-down complete. Nice work.');
    assert.equal(a.run('state.running'), false);
    a.context.goDoneHome();
    assert.ok(a.screen('home'));
  }
  // Across seeds, non-multiple-of-five intervals are played as given.
  let oddSeen = 0;
  for (let seed=1;seed<=6;seed++) {
    const a = app({seed}); a.context.startRoutine('warmup', 'bodyweight');
    const item = a.list().find(entry => entry.work%5);
    if (!item) continue;
    oddSeen++;
    const index = a.list().indexOf(item);
    a.run('state.idx='+index); a.context.enterWork();
    assert.equal(a.run('state.remaining'), item.work);
    for (let s=0;s<item.work-1;s++) a.tick();
    assert.equal(a.run('state.phase'), 'work');
    a.tick();
    assert.notEqual(a.run('state.phase'), 'work');
  }
  assert.ok(oddSeen>0);
});

test('zero rest advances straight to the next exercise; only the last exercise finishes', () => {
  const a = app();
  a.context.startRoutine('cooldown', 'bodyweight');
  a.run("state.list=[{id:'toe-touch',name:'Standing toe-touch stretch',side:null,work:12,rest:0,timedCues:[]},{id:'chest-opener',name:'Chest opener',side:null,work:13,rest:0,timedCues:[]}];state.routineRun=null;state.idx=0");
  a.context.enterWork();
  for (let s=0;s<12;s++) a.tick();
  assert.ok(a.screen('player'));
  assert.equal(a.run('state.idx'), 1);
  assert.equal(a.run('state.phase'), 'work');
  assert.equal(a.run('state.remaining'), 13);
  for (let s=0;s<13;s++) a.tick();
  assert.ok(a.screen('done'));
});

test('per-side work plays right then left as two equal, consecutive phases', () => {
  for (let seed=1;seed<=4;seed++) {
    const a = app({seed});
    a.context.startRoutine('cooldown', 'bodyweight');
    const list = a.list(), catalogue = a.context.GarageFitData.exercises;
    list.forEach((item, index) => {
      if (catalogue[item.id].sidedness!=='per-side') return assert.equal(item.side, null);
      if (item.side==='right') {
        assert.equal(list[index+1].id, item.id);
        assert.equal(list[index+1].side, 'left');
        assert.equal(list[index+1].work, item.work);
        assert.match(item.name, / - Right$/);
        assert.match(list[index+1].name, / - Left$/);
      }
    });
  }
});

test('a short arm-circle interval cues its direction change once at the midpoint, through pause and resume', () => {
  const a = app();
  a.context.startRoutine('warmup', 'bodyweight');
  a.run("state.list=[{id:'arm-side-circles',name:'Arm Circles',side:null,work:21,rest:5,timedCues:CATALOGUE['arm-side-circles'].timedCues},{id:'body-twists',name:'Standing torso twists',side:null,work:20,rest:0,timedCues:[]}];state.idx=0");
  a.context.enterWork();
  const cue = a.el('routineTimedCue');
  for (let s=1;s<=10;s++) a.tick();
  assert.equal(cue.textContent, '');
  a.context.togglePause();
  for (let s=0;s<5;s++) a.tick();
  assert.equal(cue.textContent, '');
  assert.equal(a.run('state.remaining'), 11);
  a.context.togglePause();
  a.tick();
  assert.equal(cue.textContent, 'Change direction');
  for (let s=0;s<9;s++) a.tick();
  assert.equal(a.spoken.filter(text => text==='Change direction').length, 1);
  assert.equal(a.el('routineInstructionText').textContent, a.context.GarageFitData.exercises['arm-side-circles'].instruction);
});

test('completed routines record only occurrences that ran to completion', () => {
  const a = app({seed:5});
  a.context.startRoutine('cooldown', 'bodyweight');
  const list = a.list();
  // Skip every occurrence of the first exercise as it starts; let the rest run.
  const skippedId = list[0].id;
  let guard = 0;
  while (a.ticking() && guard++<1000) {
    if (a.run('state.phase')==='work' && a.list()[a.run('state.idx')].id===skippedId) { a.context.skipPhase(); continue; }
    a.tick();
  }
  assert.ok(a.screen('done'));
  const history = JSON.parse(a.storage.get(HISTORY_KEY));
  assert.equal(history.version, 1);
  assert.deepEqual(history.warmup, []);
  assert.equal(history.cooldown.length, 1);
  assert.deepEqual(history.cooldown[0].ids, [...new Set(list.map(item => item.id))].filter(id => id!==skippedId));
  // Generator Main history and Coach records are not used.
  assert.equal(a.storage.has('gf_generator_history'), false);
  // The next Start reads it as recent history.
  let recent = null;
  const original = a.context.GarageFitRoutineGenerator.generateRoutine;
  a.context.GarageFitRoutineGenerator.generateRoutine = options => { recent = options.recentHistory; return original(options); };
  a.context.goDoneHome(); a.context.startRoutine('cooldown', 'equipment');
  assert.deepEqual(JSON.parse(JSON.stringify(recent)), [history.cooldown[0].ids]);
});

test('exited and skipped-through routines leave no completion credit', () => {
  const a = app({seed:6});
  a.context.startRoutine('warmup', 'bodyweight');
  for (let s=0;s<60;s++) a.tick();
  a.context.openExitDialog('routine');
  assert.equal(a.run('state.paused'), true);
  a.context.confirmExitChoice();
  assert.ok(a.screen('home'));
  assert.equal(a.run('state.routineRun'), null);
  assert.equal(a.storage.has(HISTORY_KEY), false);
  // Skipping every phase reaches Done without recording anything.
  a.context.startRoutine('warmup', 'bodyweight');
  for (let guard=0; a.run('state.running') && guard<200; guard++) a.context.skipPhase();
  assert.ok(a.screen('done'));
  assert.equal(a.storage.has(HISTORY_KEY), false);
});

test('missing, corrupted or unavailable storage never prevents a routine', () => {
  for (const value of [undefined, 'not json', '{"version":1,"warmup":"x"}', '{"version":9}']) {
    const storage = new Map(value===undefined ? [] : [[HISTORY_KEY, value]]);
    const a = app({storage});
    a.context.startRoutine('warmup', 'bodyweight');
    assert.ok(a.screen('player'));
    assert.equal(total(a.list()), 300);
  }
  const a = app();
  a.context.localStorage.getItem = () => { throw new Error('blocked'); };
  a.context.localStorage.setItem = () => { throw new Error('blocked'); };
  a.context.startRoutine('cooldown', 'bodyweight');
  assert.ok(a.screen('player'));
  assert.doesNotThrow(() => playToEnd(a));
  assert.ok(a.screen('done'));
});

test('a plan that cannot be validated is never played; the error is shown instead', () => {
  const a = app();
  const original = a.context.GarageFitRoutineGenerator.generateRoutine;
  a.context.GarageFitRoutineGenerator.generateRoutine = options => Object.assign(original(options), {diagnostics:['warmup:missing-knee-mobility']});
  a.context.showScreen('home');
  a.context.startRoutine('warmup', 'bodyweight');
  assert.ok(a.screen('home'));
  assert.equal(a.screen('player'), false);
  assert.match(a.el('routineError').textContent, /couldn’t be prepared/);
  assert.match(home, /<p id="routineError" class="coach-error" role="alert"><\/p>/);
  a.context.GarageFitRoutineGenerator.generateRoutine = original;
  a.context.startRoutine('warmup', 'bodyweight');
  assert.ok(a.screen('player'));
  assert.equal(a.el('routineError').textContent, '');
});

test('fixed Workouts keep their data; the authored routine lists are retired', () => {
  const data = loadAppContext().GarageFitData;
  assert.equal(data.fixedRoutines, undefined);
  assert.deepEqual(Object.keys(data.fixedWorkouts), ['workout300','cindy','abBlast','eveningFullBodyReset','postRunReset','sevenMinute']);
  // The routine player still serves the fixed 7 Minute Workout.
  const a = app();
  a.context.startSevenMinuteWorkout();
  assert.equal(a.el('routineName').textContent, '7 Minute Workout');
  assert.equal(a.run('state.routineRun'), null);
  playToEnd(a);
  assert.equal(a.el('doneBtn').textContent, 'Back to workouts');
  assert.equal(a.storage.has(HISTORY_KEY), false);
});

test('recovery alternative families retain TRX pairs and reviewed Mobility calf/hamstring variants', () => {
  const catalogue = loadAppContext().GarageFitData.exercises;
  const families = {};
  for (const exercise of Object.values(catalogue)) if (exercise.cooldown && exercise.family) (families[exercise.family] = families[exercise.family] || []).push(exercise.id);
  assert.deepEqual(families, {
    'back-lat-stretch': ['childs-pose','trx-lean-back-sink'],
    'chest-opener': ['chest-opener','trx-lunge-calf-chest'],
    'glute-stretch': ['glute-stretch','trx-glute-standing'],
    'side-stretch': ['side-stretch','trx-side-stretch'],
    'supported-hamstring-stretch': ['kneeling-hamstring','supine-hamstring-stretch'],
    'standing-calf-stretch': ['standing-calf-stretch','bent-knee-calf-stretch']
  });
});

test('fixed-workout data no longer mutates catalogue relationship metadata', () => {
  const data = loadAppContext().GarageFitData;
  assert.equal(data.fixedCooldownAlternativeGroups, undefined);
  for (const exercise of Object.values(data.exercises)) assert.equal(exercise.alternativeGroup, undefined, exercise.id);
});
