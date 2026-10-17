const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');

// Drives the mounted Coach UI; controls are looked up on the visible Coach screen.
async function ui(storage = new Map(), equipment = ['dumbbells','bench']) {
  const p = pilot(storage);
  p.run(`const NativeDate=Date;let uiNow='2026-10-12T08:00:00Z';
    Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[uiNow]));} static now(){return Date.parse(uiNow);}};
    state.ownedEquipment=${JSON.stringify(equipment)};
    function nodes(id){const visit=node=>[node,...(node.children||[]).flatMap(visit)];return visit(document.getElementById(id));}
    function visible(){return [['coachSettings','coachSettingsContent'],['coachProgress','coachProgressContent']].find(([screen])=>!document.getElementById(screen).classList.contains('hidden'))?.[1]||'coachContent';}
    function field(label){return nodes(visible()).find(node=>node.attributes?.['aria-label']===label);}
    function action(label,id=visible()){return nodes(id).find(node=>node.textContent===label&&node.onclick);}
    function copyText(id=visible()){return nodes(id).map(node=>node.textContent).join(' ');}`);
  await p.run('coachUI.open()');
  p.click = (label, id) => p.run(`action(${JSON.stringify(label)}${id ? ','+JSON.stringify(id) : ''}).onclick()`);
  p.has = label => !!p.run(`action(${JSON.stringify(label)})`);
  p.field = label => p.run(`field(${JSON.stringify(label)})`);
  p.state = () => p.json('coachUI.controller.snapshot().state');
  p.text = () => p.run('copyText()');
  p.screen = id => !p.run(`document.getElementById(${JSON.stringify(id)}).classList.contains('hidden')`);
  return p;
}
const names = {strength: '4-Week General Strength', arms: 'Build Arms', tennis: 'Tennis'};
async function start(p, key) { await p.click(names[key]); await p.click('Start programme'); assert.ok(p.state()); }

test('all three programme homes open the same Programme settings screen and Back keeps the Coach shell', async () => {
  for (const key of ['strength', 'arms', 'tennis']) {
    const p = await ui(); await start(p, key);
    const before = p.state();
    await p.click('Programme settings');
    assert.ok(p.screen('coachSettings'), key);
    assert.equal(p.run("document.getElementById('bottomNav').classList.contains('hidden')"), true);
    assert.match(p.text(), /Training plan.*Programme management.*Status Active/);
    assert.ok(p.has('Pause')); assert.ok(p.has('Finish programme'));
    assert.equal(p.has('Move to maintenance'), key === 'strength', 'maintenance only where the programme supports it');
    // Today-only adjustments stay on Coach home.
    assert.doesNotMatch(p.text(), /Available time|Easy today|Readiness today|Equipment available today/);
    assert.deepEqual(p.state(), before, 'opening settings writes nothing');
    await p.run('coachUI.back()');
    assert.ok(p.screen('coach')); assert.equal(p.run("document.getElementById('bottomNav').classList.contains('hidden')"), false);
    assert.equal(p.run("document.getElementById('coachNav').attributes['aria-current']"), 'page');
    assert.ok(p.has('Programme settings')); assert.ok(p.has('Your progress'));
    assert.doesNotMatch(p.text(), /Programme management|Finish programme|Save tennis settings/, 'management left Coach home');
  }
});

test('General Strength shows its read-only plan and keeps maintenance, pause and confirmed finish', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'strength');
  await p.click('Programme settings');
  assert.match(p.text(), /Set by the programme; these are not editable/);
  assert.match(p.text(), /Sessions per week 2–3 in development; 1–2 in maintenance/);
  assert.match(p.text(), /Mode Development/);
  assert.match(p.text(), /Four-week block Week 1 of 4 · aim for 8 meaningful sessions/);
  assert.match(p.text(), /Session length 30 min by default; 20, 45 min also supported/);
  assert.match(p.text(), /Strength targets 3 stable targets/);
  assert.equal(p.field('Training focus'), undefined); assert.equal(p.field('GarageFit sessions per week'), undefined);
  assert.equal(p.field('Important event date'), undefined, 'no irrelevant event settings');
  const instance = p.state().programmeInstanceId, anchors = p.state().anchors;
  await p.click('Move to maintenance');
  assert.equal(p.state().mode, 'maintenance'); assert.match(p.text(), /Mode Maintenance/); assert.ok(p.has('Return to development'));
  await p.click('Return to development'); assert.equal(p.state().mode, 'development');
  await p.click('Pause'); assert.equal(p.state().status, 'paused');
  assert.match(p.text(), /Paused.*Status Paused · targets and history preserved/);
  await p.click('Resume'); assert.equal(p.state().status, 'active');
  await p.click('Finish programme');
  assert.match(p.text(), /This ends the programme\. Your targets and session history stay saved/);
  await p.click('Keep programme'); assert.equal(p.state().status, 'active'); assert.ok(p.has('Finish programme'));
  await p.click('Finish programme'); await p.click('Confirm finish programme');
  const finished = p.state();
  assert.equal(finished.status, 'completed'); assert.equal(finished.programmeInstanceId, instance); assert.deepEqual(finished.anchors, anchors);
  assert.ok(p.screen('coach')); assert.match(p.text(), /Previous programme finished/);
});

test('a due four-week review stays on Coach home and in settings, without a standalone maintenance toggle', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'strength');
  p.run("uiNow='2026-11-10T08:00:00Z'"); await p.run('coachUI.open()');
  assert.ok(p.has('Continue building'), 'Coach home still announces the due decision');
  await p.click('Programme settings');
  assert.match(p.text(), /Four-week block Block complete · review due/);
  assert.match(p.text(), /Four-week review 0 meaningful sessions in this block/);
  assert.ok(p.has('Continue building')); assert.ok(p.has('Move to maintenance')); assert.ok(p.has('Finish programme'));
  await p.click('Move to maintenance');
  const state = p.state();
  assert.equal(state.mode, 'maintenance'); assert.equal(state.currentTargets.blockReview.acknowledgedBlocks, 1);
  assert.doesNotMatch(p.text(), /Four-week review/); assert.ok(p.has('Return to development'));
});

test('Build Arms shows its own read-only plan and never offers maintenance', async () => {
  const p = await ui(); await start(p, 'arms');
  await p.click('Programme settings');
  assert.match(p.text(), /Sessions per week Aim for 3; 2 is acceptable/);
  assert.match(p.text(), /Mode Open-ended development · no maintenance mode/);
  assert.match(p.text(), /Direct arm work 9 curl and 9 extension set exposures per rolling 7 days/);
  assert.match(p.text(), /Strength targets 2 stable targets/);
  assert.doesNotMatch(p.text(), /Four-week|Move to maintenance|Return to development/);
  assert.equal(p.field('Training focus'), undefined);
  await p.click('Pause'); assert.equal(p.state().status, 'paused'); await p.click('Resume');
  await p.click('Finish programme'); await p.click('Confirm finish programme');
  assert.equal(p.state().status, 'completed');
});

test('Tennis settings edit only permitted values, keep targets and inventory, and validate event dates inline', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'tennis');
  const before = p.state(), inventory = p.json('state.ownedEquipment');
  await p.click('Programme settings');
  for (const label of ['Training focus', 'GarageFit sessions per week', 'Typical tennis intensity', 'Irregular / no fixed days', 'Important event date', 'Event label (optional)'])
    assert.ok(p.field(label), label);
  assert.match(p.text(), /Training phase Development/);
  assert.doesNotMatch(p.text(), /Move to maintenance/);
  p.run("field('GarageFit sessions per week').value='3';field('Typical tennis intensity').value='light'");
  await p.click('Save tennis settings');
  const saved = p.state();
  assert.equal(saved.currentTargets.programmeSettings.weeklyCoachFrequency, 3);
  assert.equal(saved.currentTargets.programmeSettings.typicalSportIntensity, 'light');
  assert.deepEqual(saved.anchors, before.anchors); assert.equal(saved.programmeInstanceId, before.programmeInstanceId);
  assert.equal(p.field('GarageFit sessions per week').value, '3', 'saved values are shown after save');
  assert.match(p.text(), /Tennis settings saved/);
  assert.deepEqual(p.json('state.ownedEquipment'), inventory, 'settings never change equipment ownership');
  // A past date is rejected without changing the programme.
  p.run("field('Important event date').value='2026-10-01'"); await p.click('Prepare for event');
  assert.match(p.run("document.getElementById('coachSettingsError').textContent"), /event date today or in the future/);
  assert.deepEqual(p.state(), saved);
  p.run("field('Important event date').value=''"); await p.click('Prepare for event');
  assert.notEqual(p.run("document.getElementById('coachSettingsError').textContent"), ''); assert.deepEqual(p.state(), saved);
  await p.run('coachUI.back()');
  assert.match(p.run("copyText('coachContent')"), /0 of 3 sessions this week/);
});

test('a live workout locks settings with a reason and leaves the draft untouched', async () => {
  for (const [key, cta] of [['strength', 'Start session'], ['tennis', 'View today’s workout']]) {
    const p = await ui(new Map(), ['dumbbells']); await start(p, key);
    await p.click(cta); await p.click('Begin workout', 'coachPreviewContent');
    const draft = await p.run('pilotStore.loadSessionDraft()'), state = p.state(); assert.ok(draft);
    await p.run('coachUI.openSettings()');
    assert.match(p.text(), /Save or finish your current workout before changing programme settings/);
    for (const label of ['Save tennis settings', 'Pause', 'Finish programme', 'Move to maintenance', 'Prepare for event']) assert.equal(p.has(label), false, label);
    assert.equal(p.field('Training focus'), undefined);
    if (key === 'tennis') assert.match(p.text(), /GarageFit sessions per week 2/, 'current values remain readable');
    await assert.rejects(p.run("coachUI.controller.manage('pause')"), /Save the session/);
    await p.run('coachUI.back()');
    assert.deepEqual(await p.run('pilotStore.loadSessionDraft()'), draft); assert.deepEqual(p.state(), state);
    assert.equal(p.run('coachUI.isActive()'), true);
  }
});
