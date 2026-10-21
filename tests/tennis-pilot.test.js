const test=require('node:test');
const assert=require('node:assert/strict');
const {create,seed,validate,confirm,summary,simulate,matrix,kits,day}=require('./helpers/tennis-pilot');
const {pilot}=require('./helpers/coach-pilot');
const copy=value=>JSON.parse(JSON.stringify(value));

test('[Full] Tennis pilot setup matrix verifies actual feasible generated outputs or explained shortages/rest',async()=>{
  const report=await matrix({focuses:['balanced'],frequencies:[1,3]});
  assert.equal(report.totals.cells,80);
  assert.ok(report.totals.feasible>0&&report.totals.startBlocked>0);
  assert.ok(report.shortages.bodyweight.some(c=>c.requirementId==='tennis-anchor-pull'));
});

test('[Full] seeded eight-week production runs preserve four anchors, immutable evidence, budgets and truthful coverage',async()=>{
  for(const frequency of [1,2,3]) {
    const r=await simulate({frequency,duration:30});
    assert.equal(r.performed,frequency*8);assert.equal(r.blocked,0);
    assert.ok(r.supportVariety>4);assert.ok(r.consolidations>0);
    assert.equal(r.initialAnchors.length,4);
    assert.ok(r.finalAnchors.every((a,i)=>a.id===r.initialAnchors[i].id&&a.reps>=r.initialAnchors[i].reps&&a.reps<=10));
    // Home small-space policy cannot truthfully promise lateral exposure.
    assert.ok(r.coverageWindows.every(w=>w.find(c=>c.id==='lateral-movement').coverage==='not-observed'));
  }
  assert.deepEqual(await simulate({weeks:2}),await simulate({weeks:2}));
});

test('generated short sessions rotate omissions rather than inventing four completed anchors',async()=>{
  const r=await simulate({frequency:1,duration:10});
  assert.equal(r.performed,8);
  assert.ok(r.examples.every(e=>e.required.filter(a=>r.initialAnchors.some(b=>b.id===a.id)).length<=1));
  assert.ok(r.finalAnchors.every((a,i)=>a.reps>r.initialAnchors[i].reps));
});

test('new omission tie-break is version-pinned and does not mutate released definitions',async()=>{
  const {p}=await create();
  assert.equal(p.run('pilotDef.version'),5);
  assert.equal(p.run('Object.isFrozen(pilotDef.anchorRotationPolicy)'),true);
  assert.equal(p.run('GarageFitData.programmes["tennis-conditioning"][4].anchorRotationPolicy'),undefined);
  const q=await create({version:4});
  assert.equal(q.p.run('pilot.snapshot().state.programmeDefinitionVersion'),4);
  assert.throws(()=>p.run(`pilotEngine.assessProgrammeFeasibility({...pilotDef,anchorRotationPolicy:{tieBreak:'calendar'}},pilotOptions)`),/rotation/);
});

test('unknown resistance, skipped anchors, partial exits, substitutions and absence preserve unearned targets',async()=>{
  const {p}=await create({frequency:1});const baseline=p.json('pilot.snapshot().state.anchors');
  seed(p,95);p.run('pilot.prepare(pilotOptions)');await p.run('pilot.begin().then(t=>pilotTracker=t)');
  await confirm(p,{unknown:true,skip:'tennis-anchor-knee'});await p.finish('complete');
  assert.deepEqual(p.json('pilot.snapshot().state.anchors.map(a=>a.currentTarget)'),baseline.map(a=>a.currentTarget));
  assert.ok(p.json('pilot.snapshot().state.anchors').every(a=>a.comparisonBaseline===null));
  assert.equal(summary(p).capabilities.find(c=>c.capabilityId==='lateral-movement').coverage,'not-observed');
  p.run(`pilotNow=${JSON.stringify(day(7))}`);p.run('pilot.prepare(pilotOptions)');
  const before=p.json('pilot.snapshot().state');
  const alternative=p.json("pilot.alternatives('tennis-anchor-knee',pilotOptions)").find(id=>id!==baseline[0].exerciseId);
  assert.ok(alternative);p.run(`pilot.substitute('tennis-anchor-knee',${JSON.stringify(alternative)},pilotOptions)`);
  await p.run('pilot.begin().then(t=>pilotTracker=t)');await confirm(p,{only:'tennis-anchor-knee'});await p.finish();
  assert.deepEqual(p.json('pilot.snapshot().state.anchors.map(a=>a.currentTarget)'),before.anchors.map(a=>a.currentTarget));
  assert.deepEqual(p.json('pilot.snapshot().state.anchors.map(a=>a.exerciseId)'),before.anchors.map(a=>a.exerciseId));
  assert.deepEqual(p.json('pilot.snapshot().state.anchors.map(a=>a.comparisonBaseline)'),before.anchors.map(a=>a.comparisonBaseline));
  assert.ok(p.json('pilot.snapshot().results.at(-1).substitutions').length>0);
  p.run(`pilotNow=${JSON.stringify(day(14))}`);p.run('pilot.prepare(pilotOptions)');await p.run('pilot.begin().then(t=>pilotTracker=t)');
  await confirm(p,{partial:true});const partial=await p.finish();assert.equal(partial.finalStatus,'partial');
  const earned=p.json('pilot.snapshot().state');
  await p.run("pilot.manage('pause')");p.run(`pilotNow=${JSON.stringify(day(90))}`);await p.run("pilot.manage('resume')");
  p.run('pilot.prepare(pilotOptions)');
  assert.deepEqual(p.json('pilot.snapshot().state.anchors'),earned.anchors);
  assert.equal(p.run('pilot.snapshot().state.meaningfulSessionsCompleted'),earned.meaningfulSessionsCompleted);
  assert.equal(p.run('pilot.snapshot().preview.plan.rationale.missedSessionResponse.catchUpSessions'),0);
});

test('actual hard tennis and merely scheduled tennis stay distinct; event expiry explicitly returns to ongoing',async()=>{
  const {p}=await create({settings:{usualPlayingDays:['thursday'],typicalSportIntensity:'hard'}});
  const before=p.json('pilot.snapshot().state');
  const planned=p.run('pilot.plan(pilotOptions)');
  assert.equal(planned.rationale.priorities.adaptation.reportedSportActivity.length,0);
  const resting=p.run("pilot.prepare({...pilotOptions,sessionContext:{readiness:{value:'tired',localDate:'2026-10-01'},reportedSportActivity:[{sportId:'tennis',localDate:'2026-10-01',intensity:'hard'}]}})");
  assert.equal(resting.plan.prescription,null);
  assert.equal(await p.run('pilotStore.loadSessionDraft()'),null);assert.deepEqual(p.json('pilot.snapshot().state'),before);
  await p.run("pilot.saveProgrammeSettings({intent:'event',significantEventDate:'2026-10-02'})");
  const preview=p.run('pilot.prepare(pilotOptions)');if(preview.workout)validate(p,preview,30);
  p.run(`pilotNow=${JSON.stringify(day(2))}`);assert.equal(p.run('pilot.plan(pilotOptions).prescription'),null);
  await p.run("pilot.saveProgrammeSettings({intent:'ongoing',significantEventDate:null,significantEventLabel:null})");
  assert.deepEqual(p.json('pilot.snapshot().state.anchors'),before.anchors);
  assert.equal(p.run('pilot.snapshot().state.meaningfulSessionsCompleted'),0);
});

test('checkpoint and result/state/draft-clear failures reload only durable work, with no double credit',async()=>{
  for(const stage of ['checkpoint','result','state','clear']) {
    const {p}=await create();p.run('pilot.prepare(pilotOptions)');await p.run('pilot.begin().then(t=>pilotTracker=t)');
    const main=p.json("pilotTracker.plannedWork().filter(w=>w.section==='main')")[0];
    await p.run(`pilotTracker.recordDone(${JSON.stringify(main.occurrenceId)})`);
    // Inject failures at Store boundaries, leaving the actual adapter and recovery active.
    if(stage==='checkpoint'){
      p.run("const write=localStorage.setItem;localStorage.setItem=()=>{throw new Error('quota checkpoint')}");
      const next=p.json("pilotTracker.plannedWork().filter(w=>w.section==='main')")[1];
      await assert.rejects(p.run(`pilotTracker.recordDone(${JSON.stringify(next.occurrenceId)})`));
    }else {
      const method={result:'saveSessionResult',state:'saveProgrammeState',clear:'clearSessionDraft'}[stage];
      p.run(`pilotStore.${method}=async()=>{throw new Error('quota ${stage}')}`);
      await assert.rejects(p.finish());
    }
    const q=pilot(p.storage,'tennis-conditioning',4);await q.run('pilot.load()');
    assert.equal(q.run('pilot.snapshot().errors.length'),0,stage);
    const all=copy((await q.run('pilotStore.listSessionResults()')).results);
    assert.equal(all.length,1,stage);assert.equal(all[0].performedWork.length,1,stage);
    assert.equal(q.run('pilot.snapshot().state.meaningfulSessionsCompleted'),1,stage);
    assert.equal(await q.run('pilotStore.loadSessionDraft()'),null);
    const recovered=q.json('pilot.snapshot().state');await q.run('pilot.load(true)');assert.deepEqual(q.json('pilot.snapshot().state'),recovered);
  }
});

test('unavailable storage refuses a new programme without creating credit',async()=>{
  const p=pilot(new Map(),'tennis-conditioning',4);
  p.run("localStorage.setItem=()=>{throw new Error('storage unavailable')}");
  await assert.rejects(p.start());assert.equal(p.run('pilot.snapshot().state'),null);assert.equal(p.storage.size,0);
});

test('missing equipment today explains omitted anchors or fails safely without inventing work',async()=>{
  const {p}=await create();const before=p.json('pilot.snapshot().state');
  const preview=p.run('pilot.prepare({...pilotOptions,equipment:[]})');
  if(preview.workout){
    validate(p,preview,30);
    assert.ok(preview.plan.prescription.programmeContext.warnings.length>0);
    assert.ok(preview.plan.prescription.requiredAnchors.every(a=>!before.anchors.some(b=>b.exerciseId===a.exerciseId)));
  }else assert.ok(preview.plan.conflicts.length);
  assert.deepEqual(p.json('pilot.snapshot().state'),before);assert.equal(p.run('pilot.snapshot().results.length'),0);
});

test('[Full] v6 home performed sessions observe lateral control while saved v5 remains pinned',async()=>{
  for(const frequency of [2,3]) {
    const r=await simulate({frequency,version:6,weeks:8});
    assert.equal(r.performed,frequency*8);assert.equal(r.blocked,0);
    assert.ok(r.coverageWindows.every(w=>w.find(c=>c.id==='lateral-movement').coverage==='observed'));
    assert.equal(Object.keys(r.roles).length,frequency);
    assert.ok(r.finalAnchors.every((a,i)=>a.id===r.initialAnchors[i].id&&a.reps>=r.initialAnchors[i].reps));
  }
  const {p}=await create({version:5});const before=p.json('pilot.snapshot().state');
  p.run('pilot.prepare(pilotOptions)');await p.run('pilot.begin().then(t=>pilotTracker=t)');
  const draft=copy(await p.run('pilotStore.loadSessionDraft()'));
  const reopened=pilot(p.storage,'tennis-conditioning',6);
  assert.deepEqual(copy(await reopened.run('pilotStore.loadSessionDraft()')),draft);
  await reopened.run('pilot.load()');
  assert.equal(reopened.run('pilot.snapshot().state.programmeDefinitionVersion'),5);
  assert.deepEqual(reopened.json('pilot.snapshot().state.anchors'),before.anchors);
  // Existing startup reconciliation finalises interrupted drafts as before.
  assert.equal(await reopened.run('pilotStore.loadSessionDraft()'),null);
});
