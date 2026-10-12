const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');

async function ui(storage = new Map(), equipment = ['dumbbells']) {
  const p = pilot(storage,'tennis-conditioning',4);
  p.run(`const NativeDate=Date;let uiNow='2026-10-12T08:00:00Z';
    Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[uiNow]));}};
    state.ownedEquipment=${JSON.stringify(equipment)};
    function nodes(id='coachContent'){const visit=node=>[node,...(node.children||[]).flatMap(visit)];return visit(document.getElementById(id));}
    function field(label){return nodes().find(node=>node.attributes?.['aria-label']===label);}
    function action(label,id='coachContent'){return nodes(id).find(node=>node.textContent===label&&node.onclick);}
    function copyText(id='coachContent'){return nodes(id).map(node=>node.textContent).join(' ');}`);
  await p.run('coachUI.open()');
  p.click = (label,id='coachContent') => p.run(`action(${JSON.stringify(label)},${JSON.stringify(id)}).onclick()`);
  p.change = (label,value) => p.run(`field(${JSON.stringify(label)}).value=${JSON.stringify(value)};field(${JSON.stringify(label)}).onchange?.()`);
  p.state = () => p.json('coachUI.controller.snapshot().state');
  return p;
}
async function start(p) { await p.click('Tennis'); await p.click('Start programme'); assert.ok(p.state()); }

test('Coach selection groups existing programmes and Tennis; minimal setup saves every approved preference',async()=>{
  const p=await ui();
  assert.match(p.run('copyText()'),/Strength & fitness.*4-Week General Strength.*Build Arms.*Cross-training.*Tennis/);
  assert.doesNotMatch(p.run('copyText()'),/Cycling|Running/);
  await p.click('Tennis');
  assert.equal(p.run("field('Training focus').value"),'balanced');
  assert.equal(p.run("field('GarageFit sessions per week').value"),'2');
  assert.equal(p.run("field('Training intent').value"),'ongoing');
  assert.equal(p.run("field('Irregular / no fixed days').checked"),true);
  await p.change('Training focus','power'); await p.change('GarageFit sessions per week','3');
  p.run("field('Irregular / no fixed days').checked=false;field('Irregular / no fixed days').onchange();field('Monday').checked=true;field('Friday').checked=true");
  await p.change('Typical tennis intensity','hard'); await p.change('Training intent','event');
  await p.change('Important event date','2026-11-20'); await p.click('Start programme');
  const state=p.state(),config=state.currentTargets.programmeSettings;
  assert.equal(state.programmeDefinitionVersion,4); assert.equal(state.anchors.length,4);
  assert.equal(config.focus,'power');assert.equal(config.weeklyCoachFrequency,3);
  assert.deepEqual(config.usualPlayingDays,['monday','friday']);assert.equal(config.typicalSportIntensity,'hard');
  assert.equal(config.intent,'event');assert.equal(config.significantEventDate,'2026-11-20');
  assert.equal(state.meaningfulSessionsCompleted,0);
  assert.equal(p.run("action('Tennis')"),undefined,'one active primary programme');
  assert.equal(p.run("document.getElementById('bottomNav').classList.contains('hidden')"),false);
});

test('equipment shortages and invalid event dates are actionable and cannot create an active programme',async()=>{
  const missing=await ui(new Map(),[]);await missing.click('Tennis');
  assert.equal(missing.run("action('Start programme')"),undefined);
  assert.match(missing.run('copyText()'),/Add equipment for a pull anchor/);
  assert.ok(missing.run("action('Set up usual equipment')"));
  assert.equal(missing.state(),null);
  for(const date of ['', '2026-10-11', '2026-02-30']) {
    const p=await ui();await p.click('Tennis');await p.change('Training intent','event');
    await p.change('Important event date',date);await p.click('Start programme');
    assert.equal(p.state(),null);assert.match(p.run("document.getElementById('coachError').textContent"),/valid event date/);
    assert.equal(await p.run('pilotStore.loadActiveProgramme()'),null);
  }
});

test('settings use Store, preserve targets through failure/retry and pause/resume, and invalidate obsolete previews',async()=>{
  const p=await ui();await start(p);await p.click('Start session');
  const before=p.state();assert.ok(p.run('coachUI.controller.snapshot().preview'));
  await p.run('coachUI.back()');
  await p.change('Training focus','movement');await p.change('GarageFit sessions per week','1');
  p.run("const write=localStorage.setItem;let fail=true;localStorage.setItem=(key,value)=>{if(fail){fail=false;throw new Error('quota');}write(key,value);}");
  await p.click('Save tennis settings');assert.deepEqual(p.state(),before);
  assert.match(p.run("document.getElementById('coachError').textContent"),/Could not write/);
  assert.ok(p.run('coachUI.controller.snapshot().preview'));
  await p.click('Save tennis settings');const saved=p.state();
  assert.equal(saved.currentTargets.programmeSettings.focus,'movement');
  assert.equal(saved.currentTargets.programmeSettings.weeklyCoachFrequency,1);
  assert.deepEqual(saved.anchors,before.anchors);assert.equal(saved.programmeInstanceId,before.programmeInstanceId);
  assert.equal(p.run('coachUI.controller.snapshot().preview'),null);
  await p.click('Pause');assert.equal(p.state().status,'paused');await p.click('Resume');
  assert.equal(p.state().status,'active');assert.deepEqual(p.state().anchors,before.anchors);
  await p.change('GarageFit sessions per week','7');await p.click('Save tennis settings');
  assert.equal(p.state().currentTargets.programmeSettings.weeklyCoachFrequency,1);
  assert.match(p.run("document.getElementById('coachError').textContent"),/programme-settings/);
  const q=await ui(p.storage);assert.equal(q.state().currentTargets.programmeSettings.focus,'movement');
  await q.click('Finish programme');assert.match(q.run('copyText()'),/Previous programme finished/);
  assert.equal(q.state().status,'completed');assert.deepEqual(q.state().anchors,before.anchors);
});

test('readiness changes today’s plan, rest creates no session, and settings edits cannot corrupt live drafts',async()=>{
  const p=await ui();await start(p);const before=p.state();
  assert.equal(p.run("field('Readiness today (optional)').value"),'normal');
  await p.change('Readiness today (optional)','tired');
  assert.deepEqual(p.state().anchors,before.anchors);assert.match(p.run('copyText()'),/tired today/);
  await p.change('Important event date','2026-10-12');await p.click('Prepare for event');
  assert.match(p.run('copyText()'),/Rest today/);assert.equal(p.run("action('Start session')"),undefined);
  assert.equal(p.state().meaningfulSessionsCompleted,0);
  assert.equal((await p.run('pilotStore.listSessionResults()')).results.length,0);
  assert.equal(await p.run('pilotStore.loadSessionDraft()'),null);
  await p.click('Cancel event preparation');await p.change('Readiness today (optional)','fresh');
  await p.click('Start session');await p.click('Begin workout','coachPreviewContent');
  const live=p.state(),draft=await p.run('pilotStore.loadSessionDraft()');
  await assert.rejects(p.run("coachUI.controller.saveProgrammeSettings({focus:'power'})"),/Save the session/);
  assert.deepEqual(p.state(),live);assert.deepEqual(await p.run('pilotStore.loadSessionDraft()'),draft);
});

test('10-minute preview and the common player count actual selected anchors without marking deferred anchors skipped',async()=>{
  const p=await ui();await start(p);const initial=p.state();
  await p.click('10 min');assert.equal(p.run("action('10 min').disabled"),undefined);
  await p.click('Start session');assert.match(p.run("copyText('coachPreviewContent')"),/Warm-up.*Ramp-up.*Main.*Cool-down/);
  assert.match(p.run("copyText('coachPreviewContent')"),/Not scheduled today.*not failed or skipped work/);
  const rx=p.json('coachUI.controller.snapshot().preview.plan.prescription');
  const selected=rx.requiredAnchors.filter(item=>initial.anchors.some(anchor=>anchor.requirementId===item.requirementId));
  assert.ok(selected.length>0&&selected.length<4);
  await p.click('Begin workout','coachPreviewContent');
  p.run(`const mainIndex=generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.exercise.coachAnchor?.requirementId===${JSON.stringify(selected[0].requirementId)});enterGeneratedPhase(mainIndex);
    document.getElementById('coachActualLoad').value='12';coachUI.updateActualSummary();`);
  assert.match(p.run("document.getElementById('coachActualSummary').textContent"),/Done confirms:.*12 kg/);
  await p.run("coachAdvance('done')");await p.run("coachUI.showEnd('exit',600);coachUI.saveFeedback('about-right')");
  const result=p.json('coachUI.controller.snapshot().results[0]'),after=p.state();
  assert.equal(after.meaningfulSessionsCompleted,1);assert.equal(after.anchors.length,4);
  assert.equal(result.performedWork.filter(item=>item.status==='completed').length,1);
  const deferred=initial.anchors.filter(anchor=>!selected.some(item=>item.requirementId===anchor.requirementId));
  assert.ok(deferred.every(anchor=>!result.anchorResults.some(item=>item.requirementId===anchor.requirementId)));
  assert.ok(deferred.every(anchor=>JSON.stringify(after.anchors.find(item=>item.requirementId===anchor.requirementId))===JSON.stringify(anchor)));
  assert.match(p.run('copyText()'),/Capability coverage.*Performed exposure observed/);
  assert.doesNotMatch(p.run('copyText()'),/Week NaN|Four-week review|Move to maintenance/);
});

test('strict preflight infeasibility is a helpful alternative with disabled short budgets and retained progress',async()=>{
  const p=await ui();await start(p);const before=p.state();
  await p.click('10 min');
  // Supply a real policy availability constraint at the controller seam. The UI
  // has no unapproved impact/pattern controls; no feasible session is invented.
  await p.run("const realPlan=coachUI.controller.plan;coachUI.controller.plan=input=>realPlan({...input,allowedImpact:[]});coachUI.back()");
  assert.match(p.run('copyText()'),/Adjust today’s options.*Rest is also an option/);
  assert.equal(p.run("action('10 min').disabled"),true);
  assert.match(p.run('copyText()'),/cannot fit useful work/);
  assert.equal(p.run("action('Start session')"),undefined);
  assert.deepEqual(p.state(),before);assert.equal(p.run("document.getElementById('coachError').textContent"),'');
  await p.run('coachUI.controller.plan=realPlan;coachUI.back()');assert.ok(p.run("action('Start session')"));
});

test('unknown partial coverage and an interrupted session recover once, with local-only history and truthful qualifiers',async()=>{
  const p=await ui();await start(p);await p.click('10 min');await p.click('Start session');await p.click('Begin workout','coachPreviewContent');
  await p.run(`(async()=>{const work=coachPlayerTracker().plannedWork().find(item=>item.requirementId?.startsWith('tennis-anchor-'));
    await coachPlayerTracker().recordPartial(work.occurrenceId,{sets:[{reps:null,load:null}],note:'Some work performed; amount unknown'});})()`);
  const q=await ui(p.storage),before=q.state();
  assert.match(q.run('copyText()'),/Exposure unknown.*some work is unmeasured/);
  assert.match(q.run('copyText()'),/unachievable with today’s equipment and constraints|limited coverage/);
  assert.match(q.run('copyText()'),/History is local to this browser and device/);
  assert.equal(before.meaningfulSessionsCompleted,0);
  assert.equal((await q.run('pilotStore.listSessionResults()')).results.length,1);
  await q.run('coachUI.open()');assert.deepEqual(q.state(),before);
  assert.equal((await q.run('pilotStore.listSessionResults()')).results.length,1);
});

test('General Strength and Build Arms keep overview copy, durations and the common session flow',async()=>{
  for(const [name,id] of [['4-Week General Strength','general-strength-4w'],['Build Arms','build-arms']]) {
    const p=await ui();await p.click(name);
    assert.match(p.run('copyText()'),id==='build-arms'?/3 × 8 to 3 × 12/:/3 stable squat, push and pull anchors/);
    assert.equal(p.run("field('Training focus')"),undefined);
    await p.click('Start programme');assert.equal(p.state().programmeDefinitionId,id);
    assert.ok(p.run("action('20 min')"));assert.equal(p.run("action('10 min')"),undefined);
    assert.equal(p.run("field('Readiness today (optional)')"),undefined);
    await p.click('Start session');assert.ok(p.run("action('Begin workout','coachPreviewContent')"));
    assert.doesNotMatch(p.run("copyText('coachPreviewContent')"),/Not scheduled today|Capability coverage/);
    assert.equal(p.run("document.getElementById('bottomNav').classList.contains('hidden')"),true);
    await p.run('coachUI.back()');assert.equal(p.run("document.getElementById('bottomNav').classList.contains('hidden')"),false);
  }
});

test('a local day change resets transient readiness, while saved Tennis versions keep their definition pins',async()=>{
  const p=await ui();await start(p);await p.change('Readiness today (optional)','tired');
  await p.run("uiNow='2026-10-13T08:00:00Z';coachUI.back()");
  assert.equal(p.run("field('Readiness today (optional)').value"),'normal');
  for(const version of [1,2,3]) {
    const old=pilot(new Map(),'tennis-conditioning',version);await old.start();await old.run('coachUI.open()');
    assert.equal(old.run('coachUI.controller.snapshot().state.programmeDefinitionVersion'),version);
    assert.deepEqual(old.json('coachUI.controller.snapshot().state.anchors'),old.json('pilot.snapshot().state.anchors'));
  }
});
