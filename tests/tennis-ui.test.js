const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');
const {sessionResult} = require('./helpers/coach-fixtures');

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

test('compact Tennis home orders the weekly progress, collapsed adjustments and actual workout CTA without dead links',async()=>{
  const p=await ui();await start(p);
  assert.deepEqual(p.json("document.getElementById('coachContent').children.slice(0,4).map(node=>node.className)"),
    ['coach-tennis-intro','coach-weekly','generator-options','coach-card']);
  assert.match(p.run("nodes().find(node=>node.className==='coach-status').textContent"),/Development/);
  assert.match(p.run("nodes().find(node=>node.className==='coach-weekly').children[0].textContent"),/0 of 2 sessions this week/);
  assert.equal(p.run("nodes().find(node=>node.id==='coachAdjustToday').open"),false);
  assert.ok(p.run("action('Your progress')"),'shared progress destination is live');
  assert.equal(p.run("action('Programme settings')"),undefined);
  const before=p.state(), durable=[...p.storage.entries()];
  await p.click('View today’s workout');
  assert.deepEqual(p.state(),before);assert.deepEqual([...p.storage.entries()],durable);
  assert.ok(p.run('coachUI.controller.snapshot().preview.workout'));
  assert.equal(await p.run('pilotStore.loadSessionDraft()'),null);
  assert.equal((await p.run('pilotStore.listSessionResults()')).results.length,0);
});

test('Adjust today summarizes real choices and persisted preferences, retains expansion, and opening it never replans',async()=>{
  const p=await ui();await start(p);
  p.run("let plans=0;const plan=coachUI.controller.plan;coachUI.controller.plan=input=>{plans++;return plan(input);};const adjust=nodes().find(node=>node.id==='coachAdjustToday');adjust.open=true;adjust.ontoggle();");
  assert.equal(p.run('plans'),0);
  const inventory=p.json('state.ownedEquipment');
  await p.change('Readiness today (optional)','tired');await p.click('15 min');await p.click('Dumbbells');
  assert.match(p.run("nodes().find(node=>node.id==='coachAdjustToday').children[0].attributes['aria-label']"),/Tired.*15 min available.*Bodyweight only/);
  assert.equal(p.run("nodes().find(node=>node.id==='coachAdjustToday').open"),true);
  assert.deepEqual(p.json('state.ownedEquipment'),inventory);
  await p.click('Dumbbells');
  await p.change('Training focus','movement');await p.change('Typical tennis intensity','hard');
  await p.click('Save tennis settings');
  assert.match(p.run("nodes().find(node=>node.id==='coachAdjustToday').children[0].attributes['aria-label']"),/Focus: Movement & agility.*hard tennis/);
  p.run("const adjusted=nodes().find(node=>node.id==='coachAdjustToday');adjusted.open=false;adjusted.ontoggle();coachUI.back();");
  assert.equal(p.run("nodes().find(node=>node.id==='coachAdjustToday').open"),false);
  const reopened=await ui(p.storage);
  assert.match(reopened.run("nodes().find(node=>node.id==='coachAdjustToday').children[0].attributes['aria-label']"),/Normal.*Focus: Movement & agility.*hard tennis/);
  assert.equal(reopened.run("nodes().find(node=>node.id==='coachAdjustToday').open"),false);
  assert.ok(reopened.run("nodes().find(node=>node.className==='coach-help'&&node.children[0].attributes['aria-label']==='About readiness')"));
});

function weeklyFixture(state,id,endedAt,overrides={}) {
  return sessionResult({sessionResultId:id,programmeInstanceId:state.programmeInstanceId,
    generatedAt:new Date(Date.parse(endedAt)-900000).toISOString(),startedAt:new Date(Date.parse(endedAt)-600000).toISOString(),
    endedAt,actualDurationSeconds:600,...overrides});
}
function weekly(p,state,results,now) {
  return p.json(`GarageFitCoachUI.tennisWeeklyProgress({definition:pilotDef,state:${JSON.stringify(state)},results:${JSON.stringify(results)},catalogue:CATALOGUE,now:${JSON.stringify(now)}})`);
}

test('weekly progress counts only credited meaningful Coach work, includes partials, and caps segments rather than the displayed count',async()=>{
  const p=pilot(new Map(),'tennis-conditioning',5);await p.start();const state=p.json('pilot.snapshot().state');
  const at='2026-10-13T08:00:00Z', make=(id,overrides={})=>weeklyFixture(state,id,at,overrides);
  const partial=make('partial',{finalStatus:'partial'});
  const zero=make('zero');zero.performedWork[0].sets[0].reps=0;
  const unknown=make('unknown',{finalStatus:'partial'});unknown.performedWork[0].status='partial';unknown.performedWork[0].sets[0].reps=null;
  const prep=make('prep');prep.plannedWork[0].section='warmup';
  const results=[make('completed'),partial,make('extra'),make('abandoned',{finalStatus:'abandoned'}),zero,unknown,prep,
    make('uncredited'),make('unrelated',{programmeInstanceId:'another'}),make('standalone',{source:'generator',programmeInstanceId:null,prescriptionId:null})];
  state.currentTargets.reconciliation.appliedSessionResultIds=results.filter(item=>item.sessionResultId!=='uncredited').map(item=>item.sessionResultId);
  state.meaningfulSessionsCompleted=999;
  for(const target of [1,2,3]) {
    state.currentTargets.programmeSettings.weeklyCoachFrequency=target;
    const summary=weekly(p,state,[...results,partial],'2026-10-14T08:00:00Z');
    assert.equal(summary.count,3);assert.equal(summary.target,target);assert.equal(summary.filled,target);
  }
  // Compacted summaries and the controller's last-eight fallback cannot truncate
  // a busy current week: the bounded week query/retained applied-ID ledger wins.
  const many=Array.from({length:70},(_,index)=>make('session-'+index));
  state.currentTargets.reconciliation.appliedSessionResultIds=many.map(item=>item.sessionResultId);
  state.recentSessionSummaries=many.slice(-64).map(item=>({sessionResultId:item.sessionResultId,meaningful:true}));
  assert.equal(weekly(p,state,many,'2026-10-14T08:00:00Z').count,70);
});

test('an active workout offers return rather than a second preview, and failed recovery remains visible',async()=>{
  const p=await ui();await start(p);await p.click('View today’s workout');await p.click('Begin workout','coachPreviewContent');
  const draft=await p.run('pilotStore.loadSessionDraft()');
  await p.run('coachUI.open()');
  assert.ok(p.run("action('Return to workout')"));assert.equal(p.run("action('View today’s workout')"),undefined);
  assert.equal(p.run("action('Pause')"),undefined);
  await p.click('Return to workout');
  assert.equal(p.run("document.getElementById('workoutPlayer').classList.contains('hidden')"),false);
  assert.deepEqual(await p.run('pilotStore.loadSessionDraft()'),draft);
  const broken=new Map(p.storage);broken.set('gf_coach_session_draft','{bad');
  const q=await ui(broken);
  assert.match(q.run('copyText()'),/could not be recovered/);assert.ok(q.run("action('Retry recovery')"));
  assert.equal(q.run("action('View today’s workout')"),undefined);
  assert.equal(broken.get('gf_coach_session_draft'),'{bad','damaged evidence is retained');
});

test('weekly progress uses Monday local midnight, completion dates, DST calendar weeks and year boundaries',async()=>{
  const p=pilot(new Map(),'tennis-conditioning',5);await p.start();const state=p.json('pilot.snapshot().state');
  const previous=process.env.TZ;process.env.TZ='America/Los_Angeles';
  try {
    const results=[weeklyFixture(state,'sunday','2026-10-12T06:59:59Z'),weeklyFixture(state,'monday','2026-10-12T07:00:00Z'),
      weeklyFixture(state,'next-monday','2026-10-19T07:00:00Z')];
    state.currentTargets.reconciliation.appliedSessionResultIds=results.map(item=>item.sessionResultId);
    assert.equal(weekly(p,state,results,'2026-10-12T07:00:00Z').count,1);
    assert.equal(weekly(p,state,results,'2026-10-19T06:59:59Z').count,1);
    assert.equal(weekly(p,state,results,'2026-10-19T07:00:00Z').count,1);
    const dst=weekly(p,state,[],'2026-11-02T07:59:59Z');
    assert.equal(dst.start,'2026-10-26T07:00:00.000Z');assert.equal(dst.end,'2026-11-02T08:00:00.000Z');
    assert.equal((Date.parse(dst.end)-Date.parse(dst.start))/3600000,169);
    const year=weeklyFixture(state,'year','2027-01-01T07:00:00Z');
    state.currentTargets.reconciliation.appliedSessionResultIds=['year'];
    assert.equal(weekly(p,state,[year],'2027-01-04T07:59:59Z').count,1);
    assert.equal(weekly(p,state,[year],'2027-01-04T08:00:00Z').count,0);
  } finally {if(previous===undefined) delete process.env.TZ;else process.env.TZ=previous;}
});

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
  assert.equal(state.programmeDefinitionVersion,5); assert.equal(state.anchors.length,4);
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
  const p=await ui();await start(p);await p.click('View today’s workout');
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
  assert.deepEqual(p.state().anchors,before.anchors);assert.match(p.run('copyText()'),/Tired/);
  await p.change('Important event date','2026-10-12');await p.click('Prepare for event');
  assert.match(p.run('copyText()'),/Rest today/);assert.equal(p.run("action('View today’s workout')"),undefined);
  assert.equal(p.state().meaningfulSessionsCompleted,0);
  assert.equal((await p.run('pilotStore.listSessionResults()')).results.length,0);
  assert.equal(await p.run('pilotStore.loadSessionDraft()'),null);
  await p.click('Cancel event preparation');await p.change('Readiness today (optional)','fresh');
  await p.click('View today’s workout');await p.click('Begin workout','coachPreviewContent');
  const live=p.state(),draft=await p.run('pilotStore.loadSessionDraft()');
  await assert.rejects(p.run("coachUI.controller.saveProgrammeSettings({focus:'power'})"),/Save the session/);
  assert.deepEqual(p.state(),live);assert.deepEqual(await p.run('pilotStore.loadSessionDraft()'),draft);
});

test('Tennis short preview keeps deferred anchors visible while edit mode protects required work',async()=>{
  const p=await ui();await start(p);await p.click('10 min');await p.click('View today’s workout');
  const preview=()=>p.run("copyText('coachPreviewContent')");
  assert.match(preview(),/Not scheduled today/);
  assert.ok(p.run("action('Edit Workout','coachPreviewContent')"));
  assert.equal(p.run("action('Substitute','coachPreviewContent')"),undefined);
  assert.equal(p.run("action('Swap','coachPreviewContent')"),undefined);
  await p.click('Edit Workout','coachPreviewContent');
  assert.ok(p.run("action('Substitute','coachPreviewContent')"));
  assert.match(preview(),/Not scheduled today/);
  await p.click('Substitute','coachPreviewContent');
  await p.run('coachUI.backFromSubstitute()');
  assert.ok(p.run("action('Done Editing','coachPreviewContent')"));
  await p.click('Done Editing','coachPreviewContent');
  assert.equal(p.run("action('Substitute','coachPreviewContent')"),undefined);
  assert.match(preview(),/Not scheduled today/);
});

test('10-minute preview and the common player count actual selected anchors without marking deferred anchors skipped',async()=>{
  const p=await ui();await start(p);const initial=p.state();
  await p.click('10 min');assert.equal(p.run("action('10 min').disabled"),undefined);
  await p.click('View today’s workout');assert.match(p.run("copyText('coachPreviewContent')"),/Warm-up.*Ramp-up.*Main.*Cool-down/);
  assert.match(p.run("copyText('coachPreviewContent')"),/Not scheduled today.*not failed or skipped work/);
  const rx=p.json('coachUI.controller.snapshot().preview.plan.prescription');
  const selected=rx.requiredAnchors.filter(item=>initial.anchors.some(anchor=>anchor.requirementId===item.requirementId));
  assert.ok(selected.length>0&&selected.length<4);
  await p.click('Begin workout','coachPreviewContent');
  p.run(`const mainIndex=generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.exercise.coachAnchor?.requirementId===${JSON.stringify(selected[0].requirementId)});enterGeneratedPhase(mainIndex);
    document.getElementById('coachActualLoad').value='12';coachUI.updateActualSummary();`);
  assert.match(p.run("document.getElementById('coachActualSummary').textContent"),/Next confirms:.*12 kg/);
  await p.run("coachAdvance('done')");await p.run("coachUI.showEnd('exit',600);coachUI.saveFeedback('about-right')");
  const result=p.json('coachUI.controller.snapshot().results[0]'),after=p.state();
  assert.equal(after.meaningfulSessionsCompleted,1);assert.equal(after.anchors.length,4);
  assert.match(p.run("nodes().find(node=>node.className==='coach-weekly').children[0].textContent"),/1 of 2 sessions this week/);
  assert.equal(result.performedWork.filter(item=>item.status==='completed').length,1);
  const deferred=initial.anchors.filter(anchor=>!selected.some(item=>item.requirementId===anchor.requirementId));
  assert.ok(deferred.every(anchor=>!result.anchorResults.some(item=>item.requirementId===anchor.requirementId)));
  assert.ok(deferred.every(anchor=>JSON.stringify(after.anchors.find(item=>item.requirementId===anchor.requirementId))===JSON.stringify(anchor)));
  await p.click('Your progress');
  assert.match(p.run("copyText('coachProgressContent')"),/Tennis fitness · last 14 days.*Performed/);
  assert.doesNotMatch(p.run("copyText('coachProgressContent')")+p.run('copyText()'),/Week NaN|Four-week review|Move to maintenance/);
  await p.run('coachUI.back()');
  await p.run('coachUI.open()');
  assert.doesNotMatch(p.run('copyText()'),/Session saved ·/,'save confirmation does not become a stale home notice');
});

test('strict preflight infeasibility is a helpful alternative with disabled short budgets and retained progress',async()=>{
  const p=await ui();await start(p);const before=p.state();
  await p.click('10 min');
  // Supply a real policy availability constraint at the controller seam. The UI
  // has no unapproved impact/pattern controls; no feasible session is invented.
  await p.run("const realPlan=coachUI.controller.plan;coachUI.controller.plan=input=>realPlan({...input,allowedImpact:[]});coachUI.back()");
  assert.match(p.run('copyText()'),/Adjust today’s options.*You can also rest/);
  assert.equal(p.run("action('10 min').disabled"),true);
  assert.match(p.run('copyText()'),/cannot fit useful work/);
  assert.equal(p.run("action('View today’s workout')"),undefined);
  assert.deepEqual(p.state(),before);assert.equal(p.run("document.getElementById('coachError').textContent"),'');
  await p.run('coachUI.controller.plan=realPlan;coachUI.back()');assert.ok(p.run("action('View today’s workout')"));
});

test('unknown partial coverage and an interrupted session recover once, with local-only history and truthful qualifiers',async()=>{
  const p=await ui();await start(p);await p.click('10 min');await p.click('View today’s workout');await p.click('Begin workout','coachPreviewContent');
  await p.run(`(async()=>{const work=coachPlayerTracker().plannedWork().find(item=>item.requirementId?.startsWith('tennis-anchor-'));
    await coachPlayerTracker().recordPartial(work.occurrenceId,{sets:[{reps:null,load:null}],note:'Some work performed; amount unknown'});})()`);
  const q=await ui(p.storage),before=q.state();
  await q.click('Your progress');const progress=q.run("copyText('coachProgressContent')");
  assert.match(progress,/Unmeasured.*recorded without an amount, so exposure is unknown/);
  assert.match(progress,/Not possible with today’s equipment|Limited by equipment/);
  assert.match(progress,/History is local to this browser and device/);
  await q.run('coachUI.back()');
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
