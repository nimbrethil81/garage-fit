const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');
const {sessionResult} = require('./helpers/coach-fixtures');

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
  p.state = () => p.json('coachUI.controller.snapshot().state');
  p.text = () => p.run('copyText()');
  p.weekly = () => p.json("(()=>{const card=nodes('coachContent').find(node=>node.className==='coach-weekly');return {text:card.children[0].textContent,segments:card.children[1].children.map(node=>node.className)};})()");
  p.summary = () => p.run("nodes('coachContent').find(node=>node.id==='coachAdjustToday').children[0].attributes['aria-label']");
  return p;
}
const names = {strength: '4-Week General Strength', arms: 'Build Arms', tennis: 'Tennis'};
async function start(p, key) { await p.click(names[key]); await p.click('Start programme'); assert.ok(p.state()); }

test('all three programmes share the compact home hierarchy with programme-appropriate status', async () => {
  for (const [key, status, weekly, extra] of [['strength', 'Development', /^0 sessions this week$/, /Week 1 of 4 · four-week block/],
    ['arms', 'Ongoing', /^0 of 3 sessions this week$/, /Build arms while maintaining whole-body training/],
    ['tennis', 'Development', /^0 of 2 sessions this week$/, /Build balanced conditioning for tennis/]]) {
    const p = await ui(); await start(p, key);
    const classes = p.json("document.getElementById('coachContent').children.map(node=>node.className)");
    assert.deepEqual(classes.slice(0, 4), ['coach-tennis-intro','coach-weekly','generator-options','coach-card'], key);
    assert.deepEqual(classes.slice(-2), ['ctrl-btn ctrl-secondary','ctrl-btn ctrl-secondary']);
    assert.match(p.run("nodes('coachContent').find(node=>node.className==='coach-status').textContent"), new RegExp(status));
    assert.match(p.weekly().text, weekly); assert.match(p.text(), extra);
    assert.equal(p.run("nodes('coachContent').find(node=>node.id==='coachAdjustToday').open"), false, 'Adjust today starts collapsed');
    assert.ok(p.has('View today’s workout')); assert.equal(p.has('Start session'), false);
    assert.ok(p.has('Your progress')); assert.ok(p.has('Programme settings'));
    assert.doesNotMatch(p.text(), /meaningful sessions ·|Up next|Programme management|Move to maintenance|Curls ·/, key+': no legacy paragraphs');
  }
});

test('weekly ranges stay truthful: General Strength 2–3 (maintenance 1–2) and Build Arms aim 3 with 2 acceptable', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'strength');
  assert.deepEqual(p.weekly().segments, ['minimum','minimum',''], 'three segments, the first two mark the minimum');
  assert.match(p.text(), /About this week.*0 sessions this week\. 2–3 recommended/);
  await p.run("coachUI.controller.manage('maintenance')"); await p.run('coachUI.open()');
  assert.equal(p.weekly().text, '0 sessions this week'); assert.deepEqual(p.weekly().segments, ['minimum','']);
  assert.match(p.text(), /1–2 recommended in maintenance/);
  assert.match(p.run("nodes('coachContent').find(node=>node.className==='coach-status').textContent"), /Maintenance/);
  const q = await ui(); await start(q, 'arms');
  assert.deepEqual(q.weekly().segments, ['minimum','minimum','']); assert.match(q.text(), /2 is acceptable/);
  assert.doesNotMatch(q.text(), /Move to maintenance|Return to development|in maintenance/, 'Build Arms never offers maintenance');
  await q.click('Programme settings'); assert.equal(q.has('Move to maintenance'), false);
});

function fixture(state, id, endedAt, overrides = {}) {
  return sessionResult({sessionResultId: id, programmeInstanceId: state.programmeInstanceId,
    generatedAt: new Date(Date.parse(endedAt)-900000).toISOString(), startedAt: new Date(Date.parse(endedAt)-600000).toISOString(),
    endedAt, actualDurationSeconds: 600, ...overrides});
}
function weekly(p, state, results, now) {
  return p.json(`GarageFitCoachUI.programmeWeeklyProgress({definition:pilotDef,state:${JSON.stringify(state)},results:${JSON.stringify(results)},catalogue:CATALOGUE,now:${JSON.stringify(now)}})`);
}

test('General Strength and Build Arms count credited sessions with performed main work, never Tennis dose rules', async () => {
  for (const id of ['general-strength-4w', 'build-arms']) {
    const p = pilot(new Map(), id); await p.start(); const state = p.json('pilot.snapshot().state');
    const at = '2026-10-13T08:00:00Z', make = (key, overrides = {}) => fixture(state, key, at, overrides);
    const zero = make('zero'); zero.performedWork[0].sets[0].reps = 0;
    const unknown = make('unknown', {finalStatus: 'partial'}); unknown.performedWork[0].status = 'partial'; unknown.performedWork[0].sets[0].reps = null;
    const prep = make('prep'); prep.plannedWork[0].section = 'warmup';
    const results = [make('completed'), make('partial', {finalStatus: 'partial'}), make('extra'), make('fourth'),
      make('abandoned', {finalStatus: 'abandoned'}), zero, unknown, prep, make('uncredited'), make('declined'),
      make('unrelated', {programmeInstanceId: 'another'}), make('standalone', {source: 'generator', programmeInstanceId: null, prescriptionId: null})];
    state.currentTargets.reconciliation.appliedSessionResultIds = results.filter(item => item.sessionResultId !== 'uncredited').map(item => item.sessionResultId);
    state.recentSessionSummaries = [{sessionResultId: 'declined', endedAt: at, finalStatus: 'completed', meaningful: false, exposure: {value: 0, confidence: 'derived'}}];
    const summary = weekly(p, state, results, '2026-10-14T08:00:00Z');
    assert.equal(summary.count, 4, id); assert.equal(summary.target, 3); assert.equal(summary.filled, 3, 'segments cap');
    assert.equal(summary.label, id === 'build-arms' ? '4 of 3 sessions this week' : '4 sessions this week', 'over-target count is not hidden');
  }
});

test('non-Tennis weeks use Monday local midnight, completion time and DST-length calendar weeks', async () => {
  const p = pilot(new Map(), 'general-strength-4w'); await p.start(); const state = p.json('pilot.snapshot().state');
  const previous = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  try {
    const results = [fixture(state, 'sunday', '2026-10-12T06:59:59Z'), fixture(state, 'monday', '2026-10-12T07:00:00Z'),
      fixture(state, 'next-monday', '2026-10-19T07:00:00Z')];
    state.currentTargets.reconciliation.appliedSessionResultIds = results.map(item => item.sessionResultId);
    assert.equal(weekly(p, state, results, '2026-10-12T06:59:59Z').count, 1, 'Sunday belongs to the previous week');
    assert.equal(weekly(p, state, results, '2026-10-12T07:00:00Z').count, 1);
    assert.equal(weekly(p, state, results, '2026-10-19T06:59:59Z').count, 1);
    assert.equal(weekly(p, state, results, '2026-10-19T07:00:00Z').count, 1);
    const dst = weekly(p, state, [], '2026-11-02T07:59:59Z');
    assert.equal((Date.parse(dst.end)-Date.parse(dst.start))/3600000, 169);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('a saved session updates the home count; abandoned work and previews earn nothing', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'strength');
  const before = p.state(), durable = [...p.storage.entries()];
  await p.click('View today’s workout');
  assert.deepEqual(p.state(), before); assert.deepEqual([...p.storage.entries()], durable, 'a preview writes nothing');
  assert.equal(await p.run('pilotStore.loadSessionDraft()'), null);
  await p.click('Begin workout', 'coachPreviewContent');
  await p.run("coachUI.showEnd('exit',60)"); await p.run("coachUI.saveFeedback('easy')");
  assert.equal(p.weekly().text, '0 sessions this week', 'ended early without main work');
  await p.click('View today’s workout'); await p.click('Begin workout', 'coachPreviewContent');
  await p.run(`(async()=>{const tracker=coachPlayerTracker();const work=tracker.plannedWork().find(item=>item.requirementId==='anchor-squat');
    await tracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:6,load:12,loadUnit:'kg',loadInterpretation:'total'}]});})()`);
  await p.run("coachUI.showEnd('exit',600)"); await p.run("coachUI.saveFeedback('about-right')");
  assert.equal(p.weekly().text, '1 session this week'); assert.deepEqual(p.weekly().segments, ['filled minimum','minimum','']);
  assert.match(p.text(), /Session saved · partial · 1 anchors recorded/);
});

test('non-Tennis Adjust today summarises real choices, keeps inventory and offers no Tennis readiness', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'arms');
  assert.equal(p.summary(), 'Adjust today · 30 min available · Dumbbells');
  assert.equal(p.run("field('Readiness today (optional)')"), undefined);
  p.run("let plans=0;const plan=coachUI.controller.plan;coachUI.controller.plan=input=>{plans++;return plan(input);};const adjust=nodes('coachContent').find(node=>node.id==='coachAdjustToday');adjust.open=true;adjust.ontoggle();");
  assert.equal(p.run('plans'), 0, 'opening the disclosure never replans');
  const inventory = p.json('state.ownedEquipment');
  await p.click('20 min'); await p.click('Bench');
  p.run("field('Easy today').checked=true"); await p.run("field('Easy today').onchange()");
  p.run("field('Body emphasis').value='upper'"); await p.run("field('Body emphasis').onchange()");
  assert.equal(p.summary(), 'Adjust today · 20 min available · Dumbbells, Bench · Easy today · Upper emphasis');
  assert.equal(p.run("nodes('coachContent').find(node=>node.id==='coachAdjustToday').open"), true);
  assert.equal(p.run("action('20 min').attributes['aria-pressed']"), 'true');
  assert.deepEqual(p.json('state.ownedEquipment'), inventory, 'today-only kit never changes ownership');
  assert.ok(p.run("nodes('coachContent').find(node=>node.className==='coach-help'&&node.children[0].attributes['aria-label']==='About today’s equipment')"));
  await p.click('View today’s workout');
  const today = p.json('coachUI.controller.snapshot().preview.today');
  assert.equal(today.duration, 20); assert.equal(today.easyToday, true); assert.deepEqual(today.equipment, ['dumbbells','bench']);
});

test('blocked, paused, active, review-due and switching states keep their routes', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'strength');
  // Blocked: today's kit cannot supply the anchors.
  await p.click('Dumbbells');
  assert.match(p.text(), /Adjust today’s options/); assert.equal(p.has('View today’s workout'), false);
  assert.ok(p.json("nodes('coachContent').filter(node=>/^Substitute /.test(node.textContent)).length") > 0);
  await p.click('Dumbbells'); assert.ok(p.has('View today’s workout'));
  // Paused.
  await p.run("coachUI.controller.manage('pause')"); await p.run('coachUI.open()');
  assert.ok(p.has('Resume')); assert.equal(p.has('View today’s workout'), false); assert.ok(p.has('Programme settings'));
  await p.click('Resume'); assert.equal(p.state().status, 'active');
  // Active workout: return rather than a second preview.
  await p.click('View today’s workout'); await p.click('Begin workout', 'coachPreviewContent');
  await p.run('coachUI.open()');
  assert.ok(p.has('Return to workout')); assert.equal(p.has('View today’s workout'), false);
  assert.match(p.run("nodes('coachContent').find(node=>node.className==='coach-status').textContent"), /Workout in progress/);
  await p.run("coachUI.showEnd('exit',60)"); await p.run("coachUI.saveFeedback('easy')");
  // Review due: a compact actionable notice, with confirmed finish through settings.
  p.run("uiNow='2026-11-10T08:00:00Z'"); await p.run('coachUI.open()');
  assert.match(p.run("nodes('coachContent').find(node=>node.className==='coach-status').textContent"), /Review due/);
  assert.match(p.text(), /Four-week review 0 meaningful sessions in this block/);
  assert.equal(p.has('View today’s workout'), false);
  await p.click('Finish programme');
  assert.ok(p.run("!document.getElementById('coachSettings').classList.contains('hidden')")); assert.ok(p.has('Confirm finish programme'));
  await p.click('Keep programme'); await p.run('coachUI.back()');
  await p.click('Continue building'); assert.equal(p.state().currentTargets.blockReview.acknowledgedBlocks, 1);
  assert.ok(p.has('View today’s workout')); assert.match(p.text(), /Development .*Week 1 of 4 · four-week block/, 'day 29 starts the next block');
  // Switching programmes.
  await p.run("coachUI.controller.manage('finish')"); await p.run('coachUI.open()');
  p.run("state.ownedEquipment=['dumbbells','bench']"); await start(p, 'arms');
  assert.match(p.text(), /Build Arms Ongoing.*0 of 3 sessions this week/);
});
