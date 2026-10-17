const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');

// Drives the mounted Coach UI for any programme through its real controls.
async function ui(storage = new Map(), equipment = ['dumbbells','bench']) {
  const p = pilot(storage);
  p.run(`const NativeDate=Date;let uiNow='2026-10-12T08:00:00Z';
    Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[uiNow]));} static now(){return Date.parse(uiNow);}};
    state.ownedEquipment=${JSON.stringify(equipment)};
    function nodes(id='coachContent'){const visit=node=>[node,...(node.children||[]).flatMap(visit)];return visit(document.getElementById(id));}
    function labelled(label,id='coachProgressContent'){return nodes(id).find(node=>node.attributes?.['aria-label']===label);}
    function labelledLike(pattern,id='coachProgressContent'){return nodes(id).filter(node=>new RegExp(pattern).test(node.attributes?.['aria-label']||''));}
    function action(label,id='coachContent'){return nodes(id).find(node=>node.textContent===label&&node.onclick);}
    function copyText(id='coachProgressContent'){return nodes(id).map(node=>node.textContent).join(' ');}`);
  await p.run('coachUI.open()');
  p.click = (label, id = 'coachContent') => p.run(`action(${JSON.stringify(label)},${JSON.stringify(id)}).onclick()`);
  p.state = () => p.json('coachUI.controller.snapshot().state');
  p.text = (id = 'coachProgressContent') => p.run(`copyText(${JSON.stringify(id)})`);
  p.progress = async () => { await p.click('Your progress'); assert.equal(p.run("document.getElementById('coachProgress').classList.contains('hidden')"), false); };
  p.cards = () => p.json("labelledLike('','coachProgressContent').filter(node=>node.className==='coach-progress-card-button').map(node=>node.attributes['aria-label'])");
  p.open = label => p.run(`labelledLike(${JSON.stringify('^'+label)}).find(node=>node.className==='coach-progress-card-button').onclick()`);
  p.detail = label => p.json(`(()=>{const button=labelledLike(${JSON.stringify('^'+label)}).find(node=>node.className==='coach-progress-card-button');
    const panel=nodes('coachProgressContent').find(node=>node.id===button.attributes['aria-controls']);
    return {hidden:panel.hidden,expanded:button.attributes['aria-expanded'],text:[panel,...panel.children].map(node=>node.textContent).join(' ')};})()`);
  return p;
}
const programmes = {strength: ['4-Week General Strength', 'general-strength-4w', 'View today’s workout'],
  arms: ['Build Arms', 'build-arms', 'View today’s workout'], tennis: ['Tennis', 'tennis-conditioning', 'View today’s workout']};
async function start(p, key) { await p.click(programmes[key][0]); await p.click('Start programme'); assert.equal(p.state().programmeDefinitionId, programmes[key][1]); }
// Begin today's workout and record outcomes through the live tracker, then save.
async function session(p, key, record, kind = 'exit') {
  await p.click(programmes[key][2]); await p.click('Begin workout', 'coachPreviewContent');
  await p.run(`(async()=>{const tracker=coachPlayerTracker();const record=${record};await record(tracker,tracker.plannedWork());})()`);
  await p.run(`coachUI.showEnd(${JSON.stringify(kind)},600)`); await p.run("coachUI.saveFeedback('about-right')");
}
const logAnchor = (requirement, reps = 'work.prescription.reps', load = '12', unit = 'kg', interpretation = 'total') => `async(tracker,planned)=>{
  for(const work of planned.filter(item=>item.requirementId===${JSON.stringify(requirement)}))
    await tracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:${reps},load:${load},
      ...(${load}===null?{}:{loadUnit:${JSON.stringify(unit)},loadInterpretation:${JSON.stringify(interpretation)}})}]});}`;

test('every programme opens the same Your progress screen with its real number of strength targets', async () => {
  for (const [key, count, labels] of [['strength', 3, ['Squat','Push','Pull']], ['arms', 2, ['Curl','Extension']], ['tennis', 4, ['Knee','Hinge','Push','Pull']]]) {
    const p = await ui(); await start(p, key);
    const before = p.state(), durable = [...p.storage.entries()];
    await p.progress();
    assert.equal(p.run("document.getElementById('bottomNav').classList.contains('hidden')"), true, 'secondary screen');
    const cards = p.cards().filter(label => !/Performed|Unmeasured|Not performed/.test(label.split(' · ')[1]));
    assert.equal(cards.length, count, key);
    labels.forEach((label, index) => assert.match(cards[index], new RegExp(' · '+label+' · \\d × \\d+ reps')));
    assert.match(p.text(), /Strength targets/);
    assert.doesNotMatch(p.text(), /persistent anchor/i);
    assert.match(p.text(), /No saved sessions yet/);
    assert.match(p.text(), /History is local to this browser and device/);
    assert.equal(/Tennis fitness/.test(p.text()), key === 'tennis');
    assert.equal(/Arm work · last 7 days/.test(p.text()), key === 'arms');
    assert.doesNotMatch(p.text(), /Pause|Finish programme|Move to maintenance/, 'management stays off Your progress');
    // Viewing progress is read-only.
    assert.deepEqual(p.state(), before); assert.deepEqual([...p.storage.entries()], durable);
    await p.run('coachUI.back()');
    assert.equal(p.run("document.getElementById('coach').classList.contains('hidden')"), false);
    assert.equal(p.run("document.getElementById('bottomNav').classList.contains('hidden')"), false);
    assert.ok(p.run(`action(${JSON.stringify(programmes[key][2])})`), 'Back keeps the active programme home');
  }
});

test('target drill-down separates prescription, actual per-side evidence and the stored next progression', async () => {
  const p = await ui(); await start(p, 'tennis');
  await p.progress(); const name = p.cards()[0].split(' · ')[0];
  let detail = p.detail(name); assert.equal(detail.hidden, true); assert.equal(detail.expanded, 'false');
  await p.open(name); detail = p.detail(name);
  assert.equal(detail.hidden, false); assert.equal(detail.expanded, 'true');
  assert.match(detail.text, /Current target 2 × 6 reps each side · prescribed Load · not yet confirmed/);
  assert.match(detail.text, /Last performed No performed sets recorded yet/);
  await p.run('coachUI.back()');
  const knee = p.state().anchors[0].requirementId;
  await session(p, 'tennis', logAnchor(knee, 'work.prescription.reps', '10', 'kg', 'per-item'), 'complete');
  await p.progress(); detail = p.detail(name);
  assert.equal(detail.hidden, false, 'expansion is retained while navigating');
  assert.match(detail.text, /Current target 2 × 7 reps each side · prescribed Planned load · 10 kg each/);
  assert.match(detail.text, /Last performed Mon, 12 Oct|Last performed .*completed · actual recorded work/);
  assert.match(detail.text, /Set 1 (right|left) · 6 reps · 10 kg each.*Set 4 (right|left) · 6 reps · 10 kg each/);
  assert.match(detail.text, /Next progression Try 7 reps at the confirmed load/);
  assert.match(p.text(), /Completed · \d+ performed exercises · counted/);
});

test('unknown loads hold progression honestly and a one-session substitute never rewrites the target series', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'strength');
  await session(p, 'strength', logAnchor('anchor-squat', 'work.prescription.reps', 'null'));
  await p.progress(); const name = p.cards()[0].split(' · ')[0]; await p.open(name);
  let detail = p.detail(name).text;
  assert.match(detail, /Set 1 · 6 reps · load not recorded/);
  assert.match(detail, /Progression is held until a full session records your actual load/);
  assert.doesNotMatch(detail, /Planned load/);
  await p.run('coachUI.back()');
  // Today-only substitute: the stable target keeps its own last performance.
  await p.click('View today’s workout'); await p.run("coachUI.controller.substitute('anchor-squat','dumbbell-front-squat')");
  await p.run("coachUI.back()"); p.run('uiNow=\'2026-10-14T08:00:00Z\'');
  await p.run("coachUI.controller.begin().then(tracker=>{globalThis.subTracker=tracker;})");
  await p.run(`(async()=>{for(const work of subTracker.plannedWork().filter(item=>item.requirementId==='anchor-squat'))
    await subTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:8,load:20,loadUnit:'kg',loadInterpretation:'total'}]});})()`);
  await p.run("coachUI.controller.finish('exit',{difficulty:'about-right'},600)");
  await p.run('coachUI.open()'); await p.progress(); await p.open(name); detail = p.detail(name).text;
  assert.equal(p.state().anchors[0].exerciseId, 'goblet-squat');
  assert.match(detail, /Set 1 · 6 reps · load not recorded/); assert.doesNotMatch(detail, /20 kg/);
  assert.match(detail, /you used Dumbbell front squat just for that session\. It is a separate series and did not change this target/);
});

test('history distinguishes completed, partial and ended-early sessions without crediting unperformed work', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'strength');
  await session(p, 'strength', '()=>{}');
  await session(p, 'strength', logAnchor('anchor-squat'));
  await p.progress();
  assert.match(p.text(), /Partial · 2 performed exercises · counted.*Ended early · no main work counted · 0 performed exercises · not counted/);
  assert.equal(p.state().meaningfulSessionsCompleted, 1);
  assert.match(p.text(), /Week 1 of 4 · 1 of 8 meaningful sessions this block/);
  assert.match(p.text(), /Development · 2–3 sessions per week · 1 meaningful sessions in total/);
});

test('General Strength phase reports maintenance, pause and a due four-week review truthfully', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'strength');
  await p.run("coachUI.controller.manage('maintenance')"); await p.run('coachUI.open()'); await p.progress();
  assert.match(p.text(), /Maintenance · 1–2 sessions per week/);
  await p.open(p.cards()[0].split(' · ')[0]);
  assert.match(p.detail(p.cards()[0].split(' · ')[0]).text, /Next progression Maintenance keeps this challenge steady; progression is held/);
  await p.run("coachUI.controller.manage('development')");await p.run("coachUI.controller.manage('pause')");
  await p.run('coachUI.open()'); await p.progress();
  assert.match(p.text(), /Paused.*Paused · targets and history are preserved/);
  await p.run("coachUI.controller.manage('resume')");
  p.run("uiNow='2026-11-10T08:00:00Z'"); await p.run('coachUI.open()'); await p.progress();
  assert.match(p.text(), /Four-week block complete · 0 of 8 meaningful sessions · review on Coach home/);
  await p.run('coachUI.back()'); assert.ok(p.run("action('Continue building')"), 'the due decision stays actionable on Coach home');
});

test('Build Arms progress keeps seven-day curl/extension exposure, unknown amounts and no maintenance features', async () => {
  const p = await ui(); await start(p, 'arms');
  await session(p, 'arms', `async(tracker,planned)=>{
    const curl=planned.filter(item=>item.requirementId==='anchor-flexion');
    for(const work of curl) await tracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:8,load:8,loadUnit:'kg',loadInterpretation:'per-item'}]});
    const extension=planned.find(item=>item.requirementId==='anchor-extension');
    await tracker.recordPartial(extension.occurrenceId,{sets:[{reps:null,load:null}],note:'Some work performed; amount unknown'});}`);
  await p.progress();
  assert.match(p.text(), /Open-ended programme · aim for 3 sessions per week; 2 is acceptable/);
  assert.match(p.text(), /Curls · 3 \/ 9 performed set exposures/);
  assert.match(p.text(), /Extensions · 0 \/ 9 performed set exposures Some work is unmeasured/);
  assert.doesNotMatch(p.text(), /Maintenance|Tennis fitness|check-in/);
  const curl = p.cards().find(label => / · Curl · /.test(label)).split(' · ')[0];
  await p.open(curl); assert.match(p.detail(curl).text, /Set 1 · 8 reps · 8 kg each/);
  const extension = p.cards().find(label => / · Extension · /.test(label)).split(' · ')[0];
  await p.open(extension); assert.match(p.detail(extension).text, /Last performed .*partial.*reps not recorded · load not recorded/);
  // Seven days later the rolling window is empty again.
  p.run("uiNow='2026-10-20T08:00:00Z'"); await p.run('coachUI.open()'); await p.progress();
  assert.match(p.text(), /Curls · 0 \/ 9/);
});

test('Tennis progress shows six coverage cards with observed, unknown and infeasible distinctions, event phase and switching', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'tennis');
  await p.progress();
  const capabilities = p.json("nodes('coachProgressContent').filter(node=>/coach-capability-card/.test(node.className)).map(node=>node.children[0].attributes['aria-label'])");
  assert.equal(capabilities.length, 6);
  assert.ok(capabilities.every(label => / · Not performed/.test(label)), 'new programme has no false coverage');
  assert.doesNotMatch(p.text(), /improved|mastered|score|%/i);
  assert.match(p.text(), /Ongoing development · no fixed end date/);
  await p.run('coachUI.back()');
  const knee = p.state().anchors[0].requirementId;
  await session(p, 'tennis', logAnchor(knee), 'complete');
  await p.progress();
  const after = p.json("nodes('coachProgressContent').filter(node=>/coach-capability-card/.test(node.className)).map(node=>node.children[0].attributes['aria-label'])");
  assert.ok(after.some(label => / · Performed/.test(label)));
  const observed = after.find(label => / · Performed/.test(label)).split(' · ')[0];
  await p.open(observed); assert.match(p.detail(observed).text, /Performed: /);
  // Event-focused programmes show the event horizon and held progression.
  await p.run("coachUI.controller.saveProgrammeSettings({intent:'event',significantEventDate:'2026-10-20',significantEventLabel:'Club final'})");
  await p.run('coachUI.open()'); await p.progress();
  assert.match(p.text(), /Event preparation.*Event · Club final · 2026-10-20 · 8 days away/);
  const name = p.cards()[0].split(' · ')[0]; await p.open(name);
  assert.match(p.detail(name).text, /Event preparation holds established resistance and reps/);
  // Switching programmes: finish Tennis, start Build Arms, progress follows the new programme.
  await p.run("coachUI.controller.manage('finish')"); await p.run('coachUI.open()');
  p.run("state.ownedEquipment=['dumbbells','bench']");
  await start(p, 'arms'); await p.progress();
  assert.doesNotMatch(p.text(), /Tennis fitness/); assert.match(p.text(), /Arm work/);
  assert.match(p.text(), /No saved sessions yet/, 'another programme’s sessions are not shown');
});

test('a live session draft is untouched by Your progress, and a recovered interruption shows only its performed work', async () => {
  const p = await ui(new Map(), ['dumbbells']); await start(p, 'strength');
  await p.click('View today’s workout'); await p.click('Begin workout', 'coachPreviewContent');
  await p.run(`(async()=>{const work=coachPlayerTracker().plannedWork().find(item=>item.requirementId==='anchor-squat');
    await coachPlayerTracker().recordDone(work.occurrenceId);})()`);
  const draft = await p.run('pilotStore.loadSessionDraft()'), state = p.state(); assert.ok(draft);
  await p.run('coachUI.openProgress()'); assert.match(p.text(), /Strength targets/);
  await p.run('coachUI.back()');
  assert.equal(p.run('coachUI.isActive()'), true);
  assert.deepEqual(await p.run('pilotStore.loadSessionDraft()'), draft); assert.deepEqual(p.state(), state);
  const q = await ui(p.storage, ['dumbbells']); await q.progress();
  assert.match(q.text(), /Partial · 1 performed exercise · counted/);
  assert.equal((await q.run('pilotStore.listSessionResults()')).results.length, 1);
});

test('pure helpers label sections and keep unknown or substituted evidence out of the stable series', () => {
  const p = pilot();
  const Progress = 'GarageFitCoachProgressUI';
  assert.equal(p.run(`${Progress}.sectionLabel({directElbowAction:'extension',pattern:'push'})`), 'Extension');
  assert.equal(p.run(`${Progress}.sectionLabel({roleId:'hinge',pattern:'hinge'})`), 'Hinge');
  assert.equal(p.run(`${Progress}.loadText(12,'kg','per-item')`), '12 kg each');
  assert.equal(p.run(`${Progress}.loadText(null,'kg','total')`), null);
  const performance = (id, exerciseId, at) => ({sessionResultId: id, occurrenceId: 'main:b0:r1:e0', occurredAt: at, exerciseId, requirementId: 'anchor-squat',
    section: 'main', programmeInstanceId: 'p', status: 'completed', side: null,
    sets: [{reps: {value: 6}, seconds: {value: null}, load: {value: null}, loadUnit: null, loadInterpretation: null, resistanceSetup: null}]});
  const history = {performances: [performance('a', 'goblet-squat', '2026-10-01T08:00:00Z'), performance('b', 'dumbbell-front-squat', '2026-10-03T08:00:00Z'),
    {...performance('c', 'goblet-squat', '2026-10-05T08:00:00Z'), programmeInstanceId: 'other'}]};
  const last = p.json(`${Progress}.lastPerformed({requirementId:'anchor-squat',exerciseId:'goblet-squat'},${JSON.stringify(history)},'p')`);
  assert.equal(last.sessionResultId, 'a'); assert.equal(last.sets[0].load, null);
  assert.equal(p.run(`${Progress}.lastPerformed({requirementId:'anchor-squat',exerciseId:'air-squat'},${JSON.stringify(history)},'p')`), null);
  assert.deepEqual(p.json(`${Progress}.nextProgression({currentTarget:{progressionIntent:'Use the next heavier weight'},progression:{decision:'suggest-load'}},{state:{mode:'development'}})`),
    {text: 'Use the next heavier weight', note: null});
});
