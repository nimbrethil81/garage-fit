const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');

for (const programme of ['general-strength-4w','build-arms']) {
  const setup = async () => { const p=pilot(new Map(),programme); await p.start(); await p.begin(); return p; };
  const first = p => p.json('pilotTracker.plannedWork().find(item=>item.requirementId)');
  const recordOne = p => p.run(`pilotTracker.recordAnchor(pilotTracker.plannedWork().find(item=>item.requirementId).occurrenceId,
    {status:'completed',sets:[{reps:4,load:null}]})`);

  test(programme+': crash recovery saves only durable work, partial once, start alone zero', async () => {
    const p=await setup(), work=first(p); await recordOne(p);
    const reload=pilot(p.storage,programme); await reload.run('pilot.load()');
    const result=reload.json('pilot.snapshot().results[0]'), state=reload.json('pilot.snapshot().state');
    assert.equal(result.finalStatus,'partial');
    assert.deepEqual(result.performedWork.map(item=>item.occurrenceId),[work.occurrenceId]);
    assert.equal(result.performedWork[0].sets[0].load,null);
    assert.equal(state.meaningfulSessionsCompleted,1); assert.equal(state.currentTargets.dose.exposure,1);
    assert.equal(state.anchors[0].currentTarget.target.maxReps,programme==='build-arms'?8:6);
    if (programme==='build-arms') assert.equal(state.currentTargets.dose.directElbowActions.flexion,1);
    await reload.run('pilot.load()'); assert.deepEqual(reload.json('pilot.snapshot().state'),state);
    assert.equal(await reload.run('pilotStore.loadSessionDraft()'),null);
    const empty=await setup(), emptyReload=pilot(empty.storage,programme); await emptyReload.run('pilot.load()');
    assert.equal(emptyReload.json('pilot.snapshot().results[0]').finalStatus,'abandoned');
    assert.equal(emptyReload.json('pilot.snapshot().state').currentTargets.dose.exposure,0);
  });

  for (const step of ['session_result:', 'session_result_index', 'programme_state:', 'clear']) {
    for (const after of [false,true]) {
      test(programme+': interruption '+(after?'after ':'before ')+step+' converges on retry/reload', async () => {
        const p=await setup();
        await p.log(programme==='build-arms'?'anchor-flexion':'anchor-squat');
        p.run(`const realSet=localStorage.setItem, realRemove=localStorage.removeItem;
          let failOnce=true;
          const injected=()=>{failOnce=false;throw Object.assign(new Error('injected quota'),{name:'QuotaExceededError'});};
          localStorage.setItem=(key,value)=>{
            if(failOnce && key.includes(${JSON.stringify(step)})){
              if(${after})realSet(key,value); injected();
            } return realSet(key,value);
          };
          localStorage.removeItem=key=>{
            if(failOnce && ${JSON.stringify(step)}==='clear'){
              if(${after})realRemove(key); injected();
            } return realRemove(key);
          };`);
        await assert.rejects(p.finish(),/storage/);
        const reopened=pilot(p.storage,programme); await reopened.run('pilot.load()');
        const state=reopened.json('pilot.snapshot().state');
        const expected=programme==='build-arms'?3:2;
        assert.equal(state.meaningfulSessionsCompleted,1);
        assert.equal(state.currentTargets.dose.exposure,expected);
        assert.equal(state.anchors[0].currentTarget.target.maxReps,programme==='build-arms'?9:7);
        assert.equal(reopened.json('pilot.snapshot().results').length,1);
        assert.equal(await reopened.run('pilotStore.loadSessionDraft()'),null);
        await reopened.run('pilot.load()'); assert.deepEqual(reopened.json('pilot.snapshot().state'),state);

      });
    }
  }

  test(programme+': a live save retry after a persistence failure preserves the same result', async () => {
    for (const step of ['session_result:', 'session_result_index', 'programme_state:', 'clear']) {
      const p=await setup();await recordOne(p);
      p.run(`const set=localStorage.setItem,remove=localStorage.removeItem;let failed=false;
        localStorage.setItem=(key,value)=>{if(!failed&&key.includes(${JSON.stringify(step)})){failed=true;throw new Error('write interruption');}return set(key,value);};
        localStorage.removeItem=key=>{if(!failed&&${JSON.stringify(step)}==='clear'){failed=true;throw new Error('clear interruption');}return remove(key);};`);
      await assert.rejects(p.finish(),/storage/);await p.finish();
      assert.equal(p.json('pilot.snapshot().state').meaningfulSessionsCompleted,1);
      assert.equal(p.json('pilot.snapshot().results').length,1);
      assert.equal(await p.run('pilotStore.loadSessionDraft()'),null);
    }
  });

  test(programme+': shared preview, partial, skip, unknown-load and rebuild invariants', async () => {
    const p=pilot(new Map(),programme); await p.start();
    const initial=p.json('pilot.snapshot().state');
    p.run('pilot.prepare(pilotOptions)'); assert.deepEqual(p.json('pilot.snapshot().state'),initial);
    await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
    assert.deepEqual(p.json('pilot.snapshot().state'),initial);
    await p.run(`pilotTracker.recordPartial(pilotTracker.plannedWork().find(item=>item.requirementId).occurrenceId,{sets:[{reps:2,load:null}]})`);
    const planned=first(p); await p.finish();
    let state=p.json('pilot.snapshot().state');
    assert.equal(state.currentTargets.dose.exposure,2/planned.prescription.reps);
    assert.equal(state.anchors[0].comparisonBaseline,null);
    p.run("pilotNow='2026-10-04T08:00:00Z'"); await p.begin();
    await p.run('Promise.all(pilotTracker.plannedWork().map(work=>pilotTracker.recordSkip(work.occurrenceId)))');
    await p.run("pilot.finish('complete',{difficulty:'easy'},600)");
    assert.equal(p.json('pilot.snapshot().state').currentTargets.dose.exposure,state.currentTargets.dose.exposure);
    const rebuilt=p.json(`pilotEngine.rebuildDerivedState(pilotDef,
      {...pilot.snapshot().state,meaningfulSessionsCompleted:999,currentTargets:{...pilot.snapshot().state.currentTargets,dose:{exposure:999}}},pilot.snapshot().results)`);
    assert.equal(rebuilt.meaningfulSessionsCompleted,1);
    assert.equal(rebuilt.currentTargets.dose.exposure,state.currentTargets.dose.exposure);
    assert.deepEqual(rebuilt.anchors,p.json('pilot.snapshot().state.anchors'));
    assert.deepEqual(p.json('pilotEngine.rebuildDerivedState(pilotDef,pilot.snapshot().state,pilot.snapshot().results)'),rebuilt);
    assert.throws(()=>p.run("pilotEngine.applySessionResult(GarageFitData.programmes['"+(programme==='build-arms'?'general-strength-4w':'build-arms')+"'][1],pilot.snapshot().state,pilot.snapshot().results[0],[])"),/different definition/);
    assert.throws(()=>p.run("pilotEngine.applySessionResult(pilotDef,pilot.snapshot().state,{...pilot.snapshot().results[0],programmeInstanceId:'another'},[])"),/does not belong/);
  });
}

test('corrupt records are isolated; invalid drafts/reference/state block overwriting, not app startup', async () => {
  const p=pilot(); await p.start(); await p.begin(); await p.log(); await p.finish();
  const saved=new Map(p.storage), validId=p.json('pilot.snapshot().results[0]').sessionResultId;
  p.storage.set('gf_coach_session_result:broken','{bad');
  p.storage.set('gf_coach_session_result_index','{bad');
  const q=pilot(p.storage); await q.run('pilot.load()');
  assert.equal(q.json('pilot.snapshot().state').meaningfulSessionsCompleted,1);
  assert.equal(q.json('pilot.snapshot().results[0]').sessionResultId,validId);
  assert.ok(q.json('pilot.snapshot().errors').length);
  assert.equal(q.storage.get('gf_coach_session_result:broken'),'{bad');
  for(const corruptKey of ['gf_coach_session_draft','gf_coach_active_programme',...saved.keys()].filter(key=>key==='gf_coach_session_draft'||key==='gf_coach_active_programme'||key.startsWith('gf_coach_programme_state:'))) {
    const storage=new Map(saved);storage.set(corruptKey,'{bad');
    const r=pilot(storage);await r.run('pilot.load()');
    assert.ok(r.run('pilot.snapshot().blocked'));
    await assert.rejects(r.start(),/Resolve/);
    assert.equal(storage.get(corruptKey),'{bad');
    assert.equal((await r.run(`pilotStore.getSessionResult(${JSON.stringify(validId)})`)).sessionResultId,validId);
  }
});

test('unavailable localStorage loads a recoverable error and the rest of the app remains usable', async () => {
  const p=pilot();p.run("localStorage.getItem=()=>{throw new Error('SecurityError');}");
  await p.run('pilot.load()'); assert.ok(p.run('pilot.snapshot().blocked'));
  assert.ok(p.json('pilot.snapshot().errors').some(error=>error.code==='storage-unavailable'));
  p.run('startWorkout()');assert.equal(p.run("!document.getElementById('workoutPlayer').classList.contains('hidden')"),true);
});

test('active reference switching preserves completed/paused history and pinned definitions', async () => {
  const p=pilot();await p.start();await p.begin();await p.log();await p.finish();
  const strength=p.json('pilot.snapshot().state'), result=p.json('pilot.snapshot().results[0]');
  await p.run("pilot.manage('finish')");
  await p.run("pilot.start(GarageFitData.programmes['build-arms'][1],['dumbbells','bench'])");
  assert.equal(p.json('pilot.snapshot().state').programmeDefinitionId,'build-arms');
  assert.equal((await p.run(`pilotStore.getSessionResult(${JSON.stringify(result.sessionResultId)})`)).programmeInstanceId,strength.programmeInstanceId);
  const historical=await p.run(`pilotStore.listSessionResults({programmeInstanceId:${JSON.stringify(strength.programmeInstanceId)}})`);
  assert.equal(historical.results.length,1);
  const q=pilot(p.storage);await q.run('pilot.load()');assert.equal(q.json('pilot.snapshot().state').programmeDefinitionId,'build-arms');
  const old=await q.run(`pilotStore.loadProgrammeState(${JSON.stringify(strength.programmeInstanceId)})`);
  assert.equal(old.status,'completed');assert.equal(old.programmeDefinitionVersion,1);
});

test('summary compaction preserves review counts and a pure history rebuild', async () => {
  const p=pilot();await p.start();await p.begin();
  await p.run(`pilotTracker.recordAnchor(pilotTracker.plannedWork().find(item=>item.requirementId).occurrenceId,{status:'completed',sets:[{reps:4,load:null}]})`);
  await p.finish();
  p.run(`let compactState=pilot.snapshot().state;
    const seedResult=pilot.snapshot().results[0], compactHistory=[seedResult];
    for(let i=1;i<70;i++){
      const result=GarageFitCoachModel.createSessionResult({...seedResult,sessionResultId:'compact:'+i});
      compactState=pilotEngine.applySessionResult(pilotDef,compactState,result,[]);compactHistory.push(result);
    }`);
  assert.equal(p.run('compactState.recentSessionSummaries.length'),64);
  assert.equal(p.run("pilotEngine.programmeReview(pilotDef,compactState,'2026-10-29T08:00:00Z').meaningfulSessions"),70);
  const rebuilt=p.json('pilotEngine.rebuildDerivedState(pilotDef,compactState,compactHistory)');
  assert.equal(rebuilt.meaningfulSessionsCompleted,70);assert.equal(rebuilt.currentTargets.dose.exposure,70);
  assert.equal(rebuilt.currentTargets.reconciliation.appliedSessionResultIds.length,70);
});

test('an unavailable pinned definition version is retained and blocks reinterpretation', async () => {
  const p=pilot();await p.start();
  await p.run(`(async()=>{
    const state={...pilot.snapshot().state,programmeDefinitionVersion:2};
    await pilotStore.saveProgrammeState(state);
    await pilotStore.saveActiveProgramme(GarageFitCoachModel.createActiveProgramme(GarageFitCoachModel.programmeDefinitionRef(state)));
  })()`);
  const q=pilot(p.storage);await q.run('pilot.load()');
  assert.equal(q.run('pilot.snapshot().blocked'),true);
  assert.match(q.run('pilot.snapshot().errors[0].message'),/definition version/);
  assert.equal((await q.run("pilotStore.loadProgrammeState('programme:1')")).programmeDefinitionVersion,2);
});
