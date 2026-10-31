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
    function action(label,id=visible()){return nodes(id).find(node=>(node.attributes?.['aria-label']===label||node.textContent===label)&&node.onclick);}
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
const names = {strength: '4-Week General Strength', arms: 'Build Arms', tennis: 'Tennis', fitness: 'General Fitness'};
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
  const before = p.state(), durable = [...p.storage.entries()].filter(([key])=>key!=='gf_first_use_v1');
  await p.click('View today’s workout');
  assert.deepEqual(p.state(), before); assert.deepEqual([...p.storage.entries()].filter(([key])=>key!==p.app.GarageFitWorkoutDiagnostics.KEY&&key!=='gf_first_use_v1'), durable, 'a preview writes no Coach or training records');
  assert.ok(p.storage.has(p.app.GarageFitWorkoutDiagnostics.KEY), 'the visible composition alone is retained for diagnostics');
  assert.equal(await p.run('pilotStore.loadSessionDraft()'), null);
  await p.click('Start workout', 'coachPreviewContent');
  await p.run("coachUI.showEnd('exit',60)");
  p.run("const originalFinish=coachUI.controller.finish;coachUI.controller.finish=async()=>{throw new Error('Save failed; retry');}");
  await p.run("coachUI.saveFeedback('easy')");
  assert.equal(p.run('currentScreen'), 'coachResult', 'failed saves retain feedback and retry');
  assert.match(p.run("document.getElementById('coachResultError').textContent"), /Save failed/);
  assert.equal(p.run("nodes('coachContent').some(node=>node.className.includes('coach-save-status'))"), false, 'no confirmation before successful save');
  p.run('coachUI.controller.finish=originalFinish');
  await p.run("coachUI.showEnd('exit',60)"); await p.run("coachUI.saveFeedback('easy')");
  assert.equal(p.weekly().text, '0 sessions this week', 'ended early without main work');
  assert.equal(p.run("nodes('coachContent').find(node=>node.attributes.role==='status').className"), 'coach-save-status');
  await p.click('View today’s workout'); await p.click('Start workout', 'coachPreviewContent');
  await p.run(`(async()=>{const tracker=coachPlayerTracker();const work=tracker.plannedWork().find(item=>item.requirementId==='anchor-squat');
    await tracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:6,load:12,loadUnit:'kg',loadInterpretation:'total'}]});})()`);
  await p.run("coachUI.showEnd('exit',600)"); await p.run("coachUI.saveFeedback('about-right')");
  assert.equal(p.weekly().text, '1 session this week'); assert.deepEqual(p.weekly().segments, ['filled minimum','minimum','']);
  assert.match(p.text(), /Session saved · partial · 1 anchors recorded/);
  assert.equal(p.run("nodes('coachContent').find(node=>node.attributes.role==='status').className"), 'coach-save-status');
});

test('non-Tennis Adjust today summarises real choices, saves shared inventory and offers no Tennis readiness', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'arms');
  assert.equal(p.summary(), 'Adjust today · 30 min available · Dumbbells');
  assert.equal(p.run("field('Readiness today (optional)')"), undefined);
  p.run("let plans=0;const plan=coachUI.controller.plan;coachUI.controller.plan=input=>{plans++;return plan(input);};const adjust=nodes('coachContent').find(node=>node.id==='coachAdjustToday');adjust.open=true;adjust.ontoggle();");
  assert.equal(p.run('plans'), 0, 'opening the disclosure never replans');
  await p.click('20 min'); await p.click('Bench');
  p.run("field('Easy today').checked=true"); await p.run("field('Easy today').onchange()");
  p.run("field('Body emphasis').value='upper'"); await p.run("field('Body emphasis').onchange()");
  assert.equal(p.summary(), 'Adjust today · 20 min available · Dumbbells, Bench · Easy today · Upper emphasis');
  assert.equal(p.run("nodes('coachContent').find(node=>node.id==='coachAdjustToday').open"), true);
  assert.equal(p.run("action('20 min').attributes['aria-pressed']"), 'true');
  assert.deepEqual(p.json('state.ownedEquipment'), ['dumbbells','bench']);
  assert.deepEqual(JSON.parse(p.storage.get('gf_equipment_inventory')), ['dumbbells','bench']);
  assert.ok(p.run("nodes('coachContent').find(node=>node.className==='coach-help'&&node.children[0].attributes['aria-label']==='About My Equipment')"));
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
  await p.click('View today’s workout'); await p.click('Start workout', 'coachPreviewContent');
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

test('central equipment return refreshes Coach feasibility without changing programme evidence or prepared work', async () => {
  const p=await ui(new Map(),['dumbbells']); await start(p,'strength');
  await p.click('View today’s workout');
  const prepared=p.json('coachUI.controller.snapshot().preview'), state=p.state();
  const records=[...p.storage.entries()].filter(([key])=>key.startsWith('gf_coach'));
  p.run("openEquipment('more');toggleEquipmentItem('dumbbells');closeEquipment()");
  assert.deepEqual(p.json('coachUI.controller.snapshot().preview'),prepared,'prepared session retains its original context');
  await p.run('coachUI.open()');
  assert.match(p.text(),/Bodyweight only/);
  assert.equal(p.has('View today’s workout'),false,'removed kit makes future anchors infeasible');
  assert.deepEqual(p.state(),state);
  assert.deepEqual([...p.storage.entries()].filter(([key])=>key.startsWith('gf_coach')),records);
  p.run("openEquipment('coach');toggleEquipmentItem('dumbbells')"); await p.run('closeEquipment(true)');
  assert.equal(p.run('currentScreen'),'coach'); assert.ok(p.has('View today’s workout'));
  await p.click('Bench');
  assert.deepEqual(p.json('state.ownedEquipment'),['dumbbells','bench']);
  p.run("openEquipment('generator')");
  assert.deepEqual(p.json("document.getElementById('equipmentList').children.filter(node=>node.attributes['aria-pressed']==='true').map(node=>node.textContent)"),['Dumbbells','Bench']);
  const reloaded=pilot(p.storage); await reloaded.run('coachUI.open()');
  assert.deepEqual(reloaded.json('state.ownedEquipment'),['dumbbells','bench']);
  assert.deepEqual(reloaded.json('coachUI.controller.snapshot().state'),state);
});

test('shared equipment edits preserve the live Coach workout, durable draft and performed evidence', async () => {
  const p=await ui(new Map(),['dumbbells']); await start(p,'strength');
  await p.click('View today’s workout'); await p.click('Start workout','coachPreviewContent');
  await p.run(`(async()=>{const tracker=coachPlayerTracker();const work=tracker.plannedWork().find(item=>item.requirementId==='anchor-squat');
    await tracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:6,load:12,loadUnit:'kg',loadInterpretation:'total'}]});})()`);
  const prepared=p.json('coachUI.controller.snapshot().preview'),workout=p.json('generatorState.workout');
  const draft=await p.run('pilotStore.loadSessionDraft()'),state=p.state();
  await p.run('coachUI.open()');
  assert.equal(p.has('Dumbbells'),false,'active sessions retain the existing adjustment safeguard');
  p.run("toggleEquipmentItem('dumbbells')"); await p.run('coachUI.open()');
  assert.deepEqual(p.json('state.ownedEquipment'),[]);
  assert.equal(p.run('coachUI.isActive()'),true); assert.ok(p.has('Return to workout'));
  assert.deepEqual(p.json('coachUI.controller.snapshot().preview'),prepared);
  assert.deepEqual(p.json('generatorState.workout'),workout);
  assert.deepEqual(await p.run('pilotStore.loadSessionDraft()'),draft); assert.deepEqual(p.state(),state);
  await p.run("coachUI.showEnd('exit',600)"); await p.run("coachUI.saveFeedback('about-right')");
  assert.equal(p.has('View today’s workout'),false,'next plan respects bodyweight-only inventory');
  const results=await p.run('pilotStore.listSessionResults()');
  assert.equal(results.results.length,1);
  assert.ok(results.results[0].performedWork.some(work=>work.exerciseId===state.anchors.find(anchor=>anchor.requirementId==='anchor-squat').exerciseId));
});

test('General Fitness is offered and runs home → preview/edit → player → save → progress on the shared screens', async () => {
  const p = await ui(new Map(), ['dumbbells']);
  assert.match(p.text(), /A training goal and sessions adapted to the work you actually do\. Fitness programmes.*General Fitness.*4-Week General Strength.*Build Arms.*Sport cross-training.*Tennis/);
  assert.doesNotMatch(p.text(), /stable anchors/);
  await p.click('General Fitness');
  assert.match(p.text(), /2–5 sessions per week Recommended, not obligatory\s+30 min default Adjustable for each session/);
  assert.doesNotMatch(p.text(), /\bstable\b|anchors start|Strength target/i);
  await p.click('Start programme');
  const state = p.state(); assert.equal(state.programmeDefinitionId, 'general-fitness'); assert.deepEqual(state.anchors, []);
  // The same compact hierarchy as every programme, with anchor-free copy.
  const classes = p.json("document.getElementById('coachContent').children.map(node=>node.className)");
  assert.deepEqual(classes.slice(0, 4), ['coach-tennis-intro','coach-weekly','generator-options','coach-card']);
  assert.match(p.run("nodes('coachContent').find(node=>node.className==='coach-status').textContent"), /Ongoing/);
  assert.equal(p.weekly().text, '0 sessions this week'); assert.deepEqual(p.weekly().segments, ['minimum','minimum','','','']);
  assert.equal(p.summary(), 'Adjust today · 30 min available · Dumbbells');
  assert.equal(p.run("field('Readiness today (optional)')"), undefined);
  const home = p.text();
  assert.match(home, /Easy today/); assert.doesNotMatch(home, /progression held|stable anchor|anchor substitution|Strength target|tennis/i);
  const plan = p.json('coachUI.controller.plan({duration:30,equipment:["dumbbells"]})');
  const intended = p.json(`GarageFitData.workoutFamilies[${JSON.stringify(plan.prescription.workoutFamilyPlan.candidates[0].workoutFamilyId)}][1]`);
  assert.match(home, new RegExp(`Today’s workout ${intended.name} · 30 min View today’s workout ${intended.purpose}`));
  assert.match(home, /Why this workout/);
  // Preview shows the delivered family, style and purpose; one Edit control; swaps only in edit mode.
  await p.click('View today’s workout');
  const workout = p.json('coachUI.controller.snapshot().preview.workout');
  const family = p.json(`GarageFitData.workoutFamilies[${JSON.stringify(workout.workoutFamilyId)}][1]`), style = family.styles.find(item => item.id === workout.familyStyleId);
  assert.equal(p.run("nodes('coachPreviewContent').find(node=>node.className==='preview-rounds').textContent"), family.name+' — '+style.name);
  assert.equal(p.run("nodes('coachPreviewContent').find(node=>node.className==='equipment-note coach-preview-purpose').textContent"), family.purpose);
  assert.deepEqual(p.json("nodes('coachPreviewContent').filter(node=>/Edit Workout|Done Editing/.test(node.textContent)&&node.onclick).map(node=>node.textContent)"), ['Edit Workout']);
  assert.equal(p.json("nodes('coachPreviewContent').filter(node=>node.className==='swap-btn').length"), 0);
  assert.doesNotMatch(p.run("copyText('coachPreviewContent')"), /Strength target|Substitute/);
  await p.click('Edit Workout', 'coachPreviewContent');
  assert.ok(p.json("nodes('coachPreviewContent').filter(node=>node.className==='swap-btn'&&/^Swap /.test(node.attributes['aria-label'])).length") > 0);
  assert.doesNotMatch(p.run("copyText('coachPreviewContent')"), /Strength target substitutions/);
  await p.click('Done Editing', 'coachPreviewContent');
  // Identical player entry; the saved session keeps its delivered identity.
  await p.click('Start workout', 'coachPreviewContent');
  assert.equal(p.run('currentScreen'), 'workoutPlayer'); assert.equal(p.run('coachUI.isActive()'), true);
  await p.run(`(async()=>{const tracker=coachPlayerTracker();for(const work of tracker.plannedWork().filter(item=>item.section==='main'))await tracker.recordDone(work.occurrenceId);})()`);
  await p.run("coachUI.showEnd('complete',1800)"); await p.run("coachUI.saveFeedback('about-right')");
  const label = family.name+' — '+style.name;
  assert.equal(p.weekly().text, '1 session this week');
  assert.deepEqual(p.json("nodes('coachContent').find(node=>node.className==='coach-weekly-roles').children.map(node=>node.textContent)"), ['✓ '+label]);
  assert.match(p.text(), new RegExp('Session saved · completed · '+label));
  assert.equal(p.run("nodes('coachContent').find(node=>node.attributes.role==='status').className"), 'coach-save-status coach-save-complete');
  const result = (await p.run('pilotStore.listSessionResults()')).results[0];
  assert.equal(result.workoutFamilyId, workout.workoutFamilyId); assert.equal(result.familyStyleId, workout.familyStyleId);
  await p.run('coachUI.openProgrammeProgress()');
  const progress = p.run("copyText('coachProgressContent')");
  assert.match(progress, /Open-ended programme · 2–5 sessions per week/);
  assert.match(progress, new RegExp('Recent sessions .*'+label+' · Completed'));
  assert.doesNotMatch(progress, /Strength targets|undefined/);
});

test('General Fitness preview reports a replanned family or style fallback; anchor-free pause and blocked copy stay neutral', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'fitness');
  const plan = p.json('coachUI.controller.plan({duration:30,equipment:[]})'), state = p.state();
  const workout = {main: {blocks: []}, prescriptionOutcome: {softRelaxations: []},
    familyReplan: {requestedWorkoutFamilyId: 'mobility-movement-quality', requestedWorkoutFamilyVersion: 1, workoutFamilyId: 'core-stability', replanned: true},
    familyDiagnostics: [{familyStyleId: 'dynamic-core'}]};
  const messages = p.json(`GarageFitCoachUI.previewMessages({plan:${JSON.stringify(plan)},workout:${JSON.stringify(workout)},state:${JSON.stringify(state)},catalogue:CATALOGUE})`);
  assert.deepEqual(messages.status, ['Adjusted · Mobility & Movement Quality could not be built with today’s options, so another workout type was chosen.',
    'Adjusted · An alternative style within this family was selected to suit your settings.']);
  assert.deepEqual(messages.notices, []);
  await p.run("coachUI.controller.manage('pause')"); await p.run('coachUI.open()');
  assert.match(p.text(), /Paused · history preserved\./); assert.doesNotMatch(p.text(), /anchors and history/);
  await p.click('Resume');
  p.run("coachUI.controller.plan=()=>({prescription:null,conflicts:[{code:'family-plan-unavailable'}],rationale:{priorities:{}}})"); await p.run('coachUI.open()');
  assert.match(p.text(), /Adjust today’s options .*Try more time or restore equipment\./);
  assert.equal(p.json("nodes('coachContent').filter(node=>/^Substitute /.test(node.textContent)).length"), 0);
});


test('General Fitness setup uses accessible family disclosures and preserves equipment, back and blocked routes', async () => {
  const p=await ui(); await p.click('General Fitness');
  const labels=['Strength & Control','Cardio & Conditioning','Full-Body Challenges','Athletic Movement','Core & Stability','Mobility & Movement Quality'];
  assert.deepEqual(p.json("nodes('coachContent').filter(n=>n.attributes?.['aria-expanded']!==undefined).map(n=>n.children[0].textContent)"),labels);
  for (const label of labels) {
    const query=`nodes('coachContent').find(n=>n.onclick&&n.children[0]?.textContent===${JSON.stringify(label)})`;
    assert.equal(p.run(`${query}.type`),'button');
    assert.equal(p.run(`${query}.attributes['aria-expanded']`),'false');
    p.run(`${query}.onclick()`);
    assert.equal(p.run(`${query}.attributes['aria-expanded']`),'true');
    assert.equal(p.run(`nodes('coachContent').find(n=>n.id===${query}.attributes['aria-controls']).hidden`),false);
    p.run(`${query}.onclick()`);
    assert.equal(p.run(`${query}.attributes['aria-expanded']`),'false');
  }
  const families=p.json("GarageFitData.programmes['general-fitness'][2].familyBalancePolicy.families");
  for (const family of families) assert.ok(p.text().includes(p.run(`GarageFitData.workoutFamilies[${JSON.stringify(family.workoutFamilyId)}][${family.workoutFamilyVersion}].purpose`)));
  assert.match(p.text(),/Optional progress checks Around every four weeks.*may be offered.*Take it or skip it/);
  assert.doesNotMatch(p.text(),/anchors|open-ended|catch-up|external activit|equipment you choose|family-selection/i);
  await p.click('Set up usual equipment');
  assert.equal(p.run("document.getElementById('equipment').classList.contains('hidden')"),false);
  p.run("closeEquipment()");
  await p.run("field('Back to Coach programmes').onclick()");
  assert.ok(p.has('General Fitness'));
  p.run("coachUI.controller.assess=()=>({status:'infeasible',conflicts:[{code:'missing-pattern',pattern:'push'}]})");
  await p.click('General Fitness');
  assert.match(p.text(),/Blocked · Add equipment for push work/);
  assert.equal(p.has('Start programme'),false); assert.ok(p.has('Set up usual equipment'));
});

test('General Fitness v1 overview omits benchmark panel', async () => {
  const p=await ui();
  p.run(`GarageFitData.programmes={...GarageFitData.programmes,'general-fitness':{1:GarageFitData.programmes['general-fitness'][1]}};
    coachUI=GarageFitCoachUI.mount({catalogue:CATALOGUE,equipment:EQUIPMENT,getEquipment:()=>state.ownedEquipment,setEquipment:()=>{},buildTimeline:buildGeneratedTimeline,play:()=>{},showScreen,stopPlayer:()=>{}});`);
  await p.run('coachUI.open()'); await p.click('General Fitness');
  assert.doesNotMatch(p.text(),/benchmark|progress checks/i);
  assert.ok(p.has('Start programme'));
});

test('programme setups share accurate facts and concise, optional progression help', async () => {
  for (const [key, frequency, focus] of [
    ['strength','2–3 sessions per week',/Squat · Push · Pull.*whole-body/],
    ['arms','2–3 sessions per week',/Curl and extension.*whole-body/],
    ['tennis','2 sessions per week default',/Strength · Movement · Conditioning · Stability/]
  ]) {
    const p=await ui(); await p.click(names[key]);
    assert.match(p.text(),new RegExp(frequency)); assert.match(p.text(),/30 min default/); assert.match(p.text(),focus);
    const help=p.json("nodes('coachContent').filter(n=>n.className==='coach-help coach-setup-help').map(n=>({tag:n.tagName,summary:n.children[0].textContent,open:!!n.open}))");
    assert.equal(help.length,1); assert.equal(help[0].open,false);
    assert.ok(p.has('Set up usual equipment')); assert.ok(p.has('Start programme'));
    if(key==='arms') assert.match(p.text(),/Aim for 3; 2 is acceptable/);
    if(key==='tennis') assert.ok(p.run("field('GarageFit sessions per week')"));
    await p.run("field('Back to Coach programmes').onclick()"); assert.ok(p.has(names[key]));
    await p.click(names[key]); await p.click('Start programme'); assert.ok(p.state());
  }
});


test('selection cards preserve categories, order, native controls and all overview/back routes', async () => {
  const p=await ui();
  const cards=()=>p.json("nodes('coachContent').filter(n=>n.attributes?.['data-programme-id']).map(n=>({id:n.attributes['data-programme-id'],label:n.attributes['aria-label'],type:n.type}))");
  assert.deepEqual(cards().map(n=>n.id),['general-fitness','general-strength-4w','build-arms','tennis-conditioning']);
  assert.deepEqual(p.json("nodes('coachContent').filter(n=>n.className==='coach-programme-category').map(n=>n.textContent)"),['Fitness programme','Fitness programme','Fitness programme','Sport cross-training']);
  assert.equal(p.json("nodes('coachContent').filter(n=>n.className==='coach-programme-chevron'&&n.attributes['aria-hidden']==='true'&&!n.onclick).length"),4);
  assert.equal(p.run("document.getElementById('coachContent').classList.contains('coach-programme-selection')"),true);
  for(const name of Object.values(names)) {
    const card=cards().find(n=>n.label===name); assert.ok(card); assert.equal(card.type,'button');
    await p.click(name); assert.ok(p.has('Start programme'));
    assert.equal(p.run("document.getElementById('coachContent').classList.contains('coach-programme-selection')"),false);
    await p.run("field('Back to Coach programmes').onclick()"); assert.equal(cards().length,4);
  }
  assert.doesNotMatch(p.text(),/Previous plan|Your history is saved/);
  p.run("nodes('coachContent').find(n=>n.src?.startsWith('assets/programmes/')).onerror()");
  assert.equal(p.run("nodes('coachContent').find(n=>n.src?.startsWith('assets/programmes/')).hidden"),true);
  await p.click('General Fitness'); assert.ok(p.has('Start programme'));
});

test('finished history belongs only to the matching card, with credited counts including zero', async () => {
  for (const [key,count] of [['strength',3],['tennis',1],['fitness',0]]) {
    const p=await ui(); await start(p,key);
    // Inject a snapshot at the view boundary: counts remain the controller's credited value.
    p.run(`const priorSnapshot=coachUI.controller.snapshot; coachUI.controller.snapshot=()=>{const snap=priorSnapshot();return {...snap,state:{...snap.state,status:'completed',meaningfulSessionsCompleted:${count}}};}`);
    await p.run('coachUI.open()');
    const footers=p.json("nodes('coachContent').filter(n=>n.attributes?.['data-programme-id']).flatMap(n=>n.children.filter(c=>c.className==='coach-programme-history').map(c=>({id:n.attributes['data-programme-id'],text:c.textContent})))");
    assert.deepEqual(footers,[{id:{strength:'general-strength-4w',tennis:'tennis-conditioning',fitness:'general-fitness'}[key],text:'Previous plan · '+count+' session'+(count===1?'':'s')}]);
    assert.doesNotMatch(p.text(),/Your history is saved|Previous programme finished|Completed/);
  }
});

test('first Coach completion acknowledges only after feedback persistence, once, without forced next steps',async()=>{
  const p=await ui();await p.run('firstUse.ready');await start(p,'fitness');
  await p.click('View today’s workout');await p.click('Start workout','coachPreviewContent');
  await p.run(`(async()=>{for(const work of coachPlayerTracker().plannedWork().filter(item=>item.section==='main'))await coachPlayerTracker().recordDone(work.occurrenceId);})()`);
  p.run("coachUI.showEnd('complete',1800)");
  assert.equal(p.run('firstUse.snapshot().completed'),false,'feedback screen is not a saved result');
  const write=p.app.localStorage.setItem;
  p.app.localStorage.setItem=(key,value)=>{if(key.startsWith('gf_coach_'))throw Error('full');write(key,value);};
  await p.run("coachUI.saveFeedback('about-right')");
  assert.equal(p.run('firstUse.snapshot().completed'),false);
  p.app.localStorage.setItem=write;
  await p.run("coachUI.saveFeedback('about-right')");
  assert.equal(p.run('firstUse.snapshot().completed'),true);
  assert.equal(p.app.document.getElementById('firstSavedcoach').classList.contains('hidden'),false);
  p.run("showLanding('generator');showScreen('coach')");
  assert.equal(p.app.document.getElementById('firstSavedcoach').classList.contains('hidden'),true);
});

test('Coach preview includes silent canonical guidance in Main and every actual supporting-phase row',async()=>{
  const p=await ui();await start(p,'strength');
  p.run(`const guidanceRows=[];const renderGuidanceRow=GarageFitWorkoutPreview.exerciseRow;
    GarageFitWorkoutPreview.exerciseRow=options=>{guidanceRows.push(options);return renderGuidanceRow(options);};`);
  await p.click('View today’s workout');
  const workout=p.json('coachUI.controller.snapshot().preview.workout');
  const exercises=[...workout.warmup.exercises,...workout.rampup.exercises,...workout.main.blocks.flatMap(b=>b.exercises),...workout.cooldown.exercises];
  const rows=p.json('guidanceRows');assert.equal(rows.length,exercises.length);
  for(const row of rows){
    assert.ok(exercises.some(e=>e.id===row.exerciseId));
    assert.equal(row.instruction,p.app.GarageFitData.exercises[row.exerciseId].instruction);
  }
  assert.ok(rows.some(r=>r.targetLabel==='Strength target'));
  assert.equal(JSON.stringify(workout).includes('beforeYouTry'),false);
});
