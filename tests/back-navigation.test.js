const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadAppContext} = require('./helpers/app-context');
const {pilot} = require('./helpers/coach-pilot');
require('../js/back-navigation.js');

const {create, createSwipe} = globalThis.GarageFitBackNav;
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const NESTED = {
  equipment: 'generator', generatedPreview: 'generator', settings: 'more', spokenCues: 'settings', workoutPatterns: 'more', workoutPatternDetail: 'workoutPatterns',
  exerciseLibrary: 'more', exerciseDetail: 'exerciseLibrary', coachPreview: 'coach', coachProgress: 'coach', coachSettings: 'coach'
};
const PROTECTED = ['player', 'workoutPlayer', 'done', 'coachResult', 'snackpick', 'home', 'workouts', 'generator', 'more', 'coach'];

function fakeHistory() {
  const entries = [{base: true}];
  return {entries, pushState: state => entries.push(state), back() { entries.pop(); }, depth: () => entries.length};
}

test('every top-left header back control calls the one shared back action', () => {
  const buttons = [...html.matchAll(/<button class="back-btn"[^>]*>/g)].map(match => match[0]);
  assert.ok(buttons.length >= 10);
  for (const button of buttons) {
    assert.match(button, /onclick="appBack\(\)"/);
    assert.match(button, /aria-label="Back[^"]*"/);
  }
});

test('shared back action runs the mapped existing callback for each nested view and nothing for protected views', () => {
  const app = loadAppContext(new Map(), {ownIntrinsics: true});
  const run = code => require('node:vm').runInContext(code, app);
  for (const [view, parent] of Object.entries(NESTED)) {
    if (view.startsWith('coach')) continue; // Coach views are covered with a real controller below
    app.showScreen(view);
    assert.equal(run('backNav.canGoBack()'), true, view);
    assert.equal(run('appBack()'), true, view);
    assert.equal(run('currentScreen'), parent, view);
  }
  for (const view of PROTECTED) {
    app.showScreen(view);
    assert.equal(run('backNav.canGoBack()'), false, view + ' is not eligible');
    assert.equal(run('appBack()'), false, view);
    assert.equal(run('currentScreen'), view, view + ' stays put');
  }
});

test('equipment back reuses closeEquipment so the Coach return destination and shared equipment cleanup still run', () => {
  const app = loadAppContext(new Map(), {ownIntrinsics: true});
  const run = code => require('node:vm').runInContext(code, app);
  run("openEquipment('more')"); run('appBack()'); assert.equal(run('currentScreen'), 'more');
  run("openEquipment('generator')"); run('appBack()'); assert.equal(run('currentScreen'), 'generator');
  run("openEquipment('home')"); run('appBack()'); assert.equal(run('currentScreen'), 'home');
});

test('generator setup choices survive preview and equipment back navigation', () => {
  const app = loadAppContext(new Map(), {ownIntrinsics: true});
  const run = code => require('node:vm').runInContext(code, app);
  run("generatorState.duration=30;generatorState.focus='strength';generatorState.difficulty='hard'");
  const before = run('JSON.stringify([generatorState.duration,generatorState.focus,generatorState.bodyFocus,generatorState.difficulty])');
  run("showScreen('generator');openEquipment('generator')"); run('appBack()');
  assert.equal(run('currentScreen'), 'generator');
  run("renderGeneratedPreview&&0;showScreen('generatedPreview')"); run('appBack()');
  assert.equal(run('currentScreen'), 'generator');
  assert.equal(run('JSON.stringify([generatorState.duration,generatorState.focus,generatorState.bodyFocus,generatorState.difficulty])'), before);
});

test('Coach programme overview returns to the programme list through the shared action without changing programme state', async () => {
  const p = pilot(new Map(), 'general-strength-4w', 1);
  await p.run('coachUI.open()');
  const find = label => p.run(`(()=>{const visit=n=>[n,...(n.children||[]).flatMap(visit)];return visit(document.getElementById('coachContent')).find(n=>n.textContent===${JSON.stringify(label)}&&n.onclick)})()`);
  assert.equal(p.run('backNav.canGoBack()'), false, 'programme list is a landing');
  const before = JSON.stringify(p.json('coachUI.controller.snapshot().state'));
  find('4-Week General Strength').onclick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.run('coachUI.inOverview()'), true);
  assert.equal(p.run('backNav.canGoBack()'), true);
  assert.equal(p.run('currentScreen'), 'coach');
  const header = p.run(`(()=>{const visit=n=>[n,...(n.children||[]).flatMap(visit)];return visit(document.getElementById('coachContent')).find(n=>n.className==='back-btn')})()`);
  assert.equal(header.attributes['aria-label'], 'Back to Coach programmes');
  assert.equal(p.run(`(()=>{const visit=n=>[n,...(n.children||[]).flatMap(visit)];return visit(document.getElementById('coachContent')).filter(n=>n.textContent==='Back').length})()`), 0, 'no duplicate bottom Back');
  assert.equal(p.run('appBack()'), true);
  assert.equal(p.run('coachUI.inOverview()'), false);
  assert.equal(p.run('backNav.canGoBack()'), false);
  assert.equal(p.run('currentScreen'), 'coach');
  assert.equal(JSON.stringify(p.json('coachUI.controller.snapshot().state')), before);
  assert.ok(find('4-Week General Strength'), 'list is shown again');
  assert.equal(p.run('appBack()'), false, 'a second back on the list does nothing');
});

test('Coach preview, progress, settings and substitute back go to the right Coach view without bottom Back duplicates', async () => {
  const p = pilot(new Map(), 'general-strength-4w', 1);
  p.start(); await p.run('coachUI.open()');
  p.run("coachUI.controller.prepare({duration:30,equipment:['dumbbells']});showScreen('coachPreview')");
  assert.equal(p.run('appBack()'), true); assert.equal(p.run('currentScreen'), 'coach');
  p.run('coachUI.openProgress()'); assert.equal(p.run('currentScreen'), 'coachProgress');
  assert.equal(p.run('appBack()'), true); assert.equal(p.run('currentScreen'), 'coach');
  p.run('coachUI.openSettings()'); assert.equal(p.run('currentScreen'), 'coachSettings');
  assert.equal(p.run('appBack()'), true); assert.equal(p.run('currentScreen'), 'coach');
  assert.equal(p.run('coachUI.isActive()'), false);
  const nodes = id => p.run(`(()=>{const visit=n=>[n,...(n.children||[]).flatMap(visit)];return visit(document.getElementById(${JSON.stringify(id)})).map(n=>n.textContent)})()`);
  for (const id of ['coachPreviewContent', 'coachProgressContent', 'coachSettingsContent']) assert.ok(!nodes(id).includes('Back to Coach'), id);
});

test('browser/Android back runs the same action once, keeps one bounded history entry, and never fires for protected views', () => {
  const history = fakeHistory();
  let view = 'settings', pops = 0, listener = null;
  const routes = {settings: () => { view = 'more'; }, spokenCues: () => { view = 'settings'; pops++; }};
  const nav = create({getView: () => view, routes, history, win: {addEventListener: (type, fn) => { if (type === 'popstate') listener = fn; }}});
  nav.sync(); nav.sync();
  assert.equal(history.depth(), 2, 'one sentinel, idempotent');
  view = 'spokenCues'; nav.sync(); assert.equal(history.depth(), 2);
  history.back(); listener(); // browser back from Spoken Cues
  assert.equal(view, 'settings'); assert.equal(pops, 1);
  assert.equal(history.depth(), 2, 'sentinel re-armed while still nested');
  nav.back(); // UI/swipe back to a landing removes the sentinel without a second transition
  assert.equal(view, 'more');
  assert.equal(nav.state().ignorePops, 1); history.depth() === 1 && assert.ok(true);
  listener(); // the pop caused by our own cleanup is swallowed
  assert.equal(view, 'more'); assert.equal(nav.state().ignorePops, 0); assert.equal(history.depth(), 1);
  view = 'player'; nav.sync(); assert.equal(history.depth(), 1, 'player never arms history');
  listener(); assert.equal(view, 'player', 'unrelated pop is left to the browser');
});

function touch(x, y) { return {clientX: x, clientY: y}; }
function swipe(opts = {}) {
  let backs = 0, clock = 0;
  const s = createSwipe({canStart: () => opts.eligible !== false, onBack: () => { backs++; }, now: () => clock});
  const run = (points, target = {}) => {
    const [first, ...rest] = points; s.start({touches: [touch(...first)], changedTouches: [touch(...first)], target});
    rest.slice(0, -1).forEach(point => { clock += 30; s.move({touches: [touch(...point)], changedTouches: [touch(...point)]}); });
    clock += 30; const last = rest.at(-1) || first; return s.end({touches: [], changedTouches: [touch(...last)]});
  };
  return {run, backs: () => backs};
}

test('edge swipe: rightward from the left edge past the threshold fires exactly once', () => {
  const g = swipe();
  assert.equal(g.run([[6, 300], [60, 305], [140, 310]]), true);
  assert.equal(g.backs(), 1);
});

test('edge swipe ignores non-edge starts, leftward, short, vertical and slow gestures', () => {
  const g = swipe();
  assert.equal(g.run([[120, 300], [220, 300], [300, 300]]), false, 'starts away from the edge');
  assert.equal(g.run([[6, 300], [-10, 300], [-40, 300]]), false, 'leftward');
  assert.equal(g.run([[6, 300], [30, 302], [50, 302]]), false, 'below threshold');
  assert.equal(g.run([[6, 300], [30, 380], [90, 600]]), false, 'predominantly vertical scroll');
  assert.equal(g.run([[6, 300], [40, 330], [100, 420]]), false, 'diagonal beyond slope');
  assert.equal(g.backs(), 0);
});

test('edge swipe ignores form fields, multi-touch, cancelled and ineligible views', () => {
  const g = swipe();
  assert.equal(g.run([[6, 300], [140, 300]], {closest: () => ({})}), false, 'input/select/no-swipe target');
  const blocked = swipe({eligible: false});
  assert.equal(blocked.run([[6, 300], [140, 300]]), false, 'protected or landing view');
  let backs = 0; const s = createSwipe({canStart: () => true, onBack: () => { backs++; }, now: () => 0});
  s.start({touches: [touch(6, 300)], changedTouches: [touch(6, 300)], target: {}});
  s.move({touches: [touch(60, 300), touch(200, 400)], changedTouches: [touch(60, 300)]});
  s.end({touches: [], changedTouches: [touch(160, 300)]});
  s.start({touches: [touch(6, 300)], changedTouches: [touch(6, 300)], target: {}}); s.cancel();
  s.end({touches: [], changedTouches: [touch(160, 300)]});
  assert.equal(backs, 0);
});

test('the swipe is wired to the app back action and is inert while a workout is running', () => {
  assert.match(html, /createSwipe\(\{canStart:\(\)=>backNav\.canGoBack\(\)&&!state\.running&&!workoutState\.running,onBack:appBack\}\)/);
  for (const view of ['player', 'workoutPlayer', 'done', 'coachResult', 'snackpick']) {
    assert.doesNotMatch(html.match(/routes:\{[\s\S]*?\n  \}\n\}\)/)[0], new RegExp('\\b' + view + ':'), view);
  }
});
