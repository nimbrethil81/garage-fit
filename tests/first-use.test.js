const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
const {sessionResult}=require('./helpers/coach-fixtures');
const MARKER='gf_first_use_v1';
function setup(storage=new Map(),configure){
  const app=loadAppContext(storage,{ownIntrinsics:true,configure});
  const run=code=>vm.runInContext(code,app);
  return {app,run,storage,ready:run('firstUse?.ready'),status:()=>run('firstUse.snapshot()'),hidden:id=>app.document.getElementById(id).classList.contains('hidden')};
}

test('fresh first use keeps Generator default, optional equipment, preview compaction and interrupted return',async()=>{
  const h=setup();await h.ready;
  assert.equal(h.run('currentScreen'),'generator');
  assert.equal(h.status().isNew,true);assert.equal(h.hidden('firstUseGenerator'),false);
  assert.equal(h.hidden('firstUseFull'),false);
  h.run('setOwnedEquipment([])');
  assert.equal(h.storage.get('gf_equipment_configured'),'true');
  assert.equal(h.storage.get('gf_equipment_inventory'),'[]');
  assert.equal(h.hidden('firstUseEquipment'),true);
  h.run("showScreen('generatedPreview');showLanding('generator')");
  assert.equal(h.status().completed,false);assert.equal(h.hidden('firstUseCompact'),false);
  const reload=setup(h.storage);await reload.ready;
  assert.equal(reload.hidden('firstUseCompact'),false);assert.equal(reload.hidden('firstUseEquipment'),true);
  reload.run("openEquipment('generator');setOwnedEquipment(['dumbbells']);closeEquipment(true)");
  assert.equal(reload.run('currentScreen'),'generator');
  assert.equal(reload.storage.get('gf_equipment_inventory'),'["dumbbells"]');
});

test('existing preferences, inventories, old histories and orphaned or corrupt Coach records suppress first use without changing data',async()=>{
  for(const [key,value] of [['gf_equipment_inventory','[]'],['gf_equipment_configured','true'],['gf_generator_history','[]'],
    ['gf_routine_recent_v1','["old"]'],['gf_amrap_results','broken'],['gf_coach_programme_state:orphan','broken'],
    ['gf_coach_active_programme','broken'],['gf_coach_session_result:orphan','broken'],['gf_coach_session_draft','broken']]){
    const h=setup(new Map([[key,value]]));await h.ready;
    assert.equal(h.status().isNew,false,key);assert.equal(h.hidden('firstUseGenerator'),true,key);
    assert.equal(h.storage.get(key),value,key);
  }
});

test('unreadable storage, failed marker writes and corrupt first-use markers fail closed',async()=>{
  for(const configure of [context=>{context.localStorage.getItem=()=>{throw Error('denied');}},
    context=>{context.localStorage.setItem=()=>{throw Error('full');}}]){
    const h=setup(new Map(),configure);await h.ready;
    assert.equal(h.status().isNew,false);assert.equal(h.hidden('firstUseGenerator'),true);
  }
  for(const raw of ['{','null','{}','{"version":1,"audience":"new","explored":false,"modes":{}}','{"version":2}','{"version":1,"audience":"new","explored":false,"modes":["bad"]}']){
    const h=setup(new Map([[MARKER,raw]]));await h.ready;
    assert.equal(h.status().isNew,false);assert.equal(h.storage.get(MARKER),raw);
  }
});

test('only saved completed performed sessions qualify, across sources, exactly once and after refresh',async()=>{
  for(const [source,workoutId] of [['generator','generated'],['coach','workout-1'],['fixed','deskBreak'],['fixed','postRunReset']]){
    const h=setup();await h.ready;
    const result=sessionResult({source,workoutId});
    h.run(`var firstResult=GarageFitCoachModel.createSessionResult(${JSON.stringify(result)});var firstStore=GarageFitCoachStore.createStore(localStorage)`);
    assert.equal(await h.run('firstUse.saved(firstResult)'),false,'unsaved is not eligible');
    await h.run('firstStore.saveSessionResult(firstResult)');
    h.run("showScreen('done')");await h.run("firstUseSaved(firstResult,'done')");
    assert.equal(h.hidden('firstSaveddone'),false,source+workoutId);
    assert.equal(h.hidden('firstUseFull'),true);
    assert.equal(await h.run('firstUse.saved(firstResult)'),false);
    const reload=setup(h.storage);await reload.ready;
    assert.equal(reload.status().completed,true);assert.equal(reload.hidden('firstUseCompact'),true);
    assert.equal(await reload.run(`firstUse.saved(${JSON.stringify(result)})`),false);
  }
});

test('early exits, skipped-only, zero measured work, imported and unsupported fixed sessions never retire guidance',async()=>{
  const h=setup();await h.ready;
  const base=sessionResult();
  for(const change of [{finalStatus:'partial'},{finalStatus:'abandoned'},{source:'external'},
    {source:'fixed',workoutId:'sevenMinute'}, {performedWork:[]},
    {performedWork:[{status:'skipped',sets:[]}]},{performedWork:[{status:'completed',sets:[{seconds:0}]}]}]){
    assert.equal(h.app.GarageFitFirstUse.eligible({...base,...change}),false);
  }
  assert.equal(h.status().completed,false);
});

test('contextual introductions dismiss independently and do not block tab exploration',async()=>{
  const h=setup();await h.ready;
  h.run("showLanding('home');firstUse.dismissMode('home');showLanding('more');showLanding('workouts')");
  assert.equal(h.hidden('firstUseHome'),true);assert.equal(h.hidden('firstUseCoach'),false);
  const reload=setup(h.storage);await reload.ready;
  assert.equal(reload.hidden('firstUseHome'),true);assert.equal(reload.hidden('firstUseCoach'),false);
});

test('exploring another tab compacts guidance and introductions retire after leaving their first visit',async()=>{
  const h=setup();await h.ready;
  h.run("showLanding('home')");assert.equal(h.hidden('firstUseHome'),false);
  assert.equal(h.status().explored,true);
  h.run("showLanding('generator');showLanding('home')");
  assert.equal(h.hidden('firstUseHome'),true);
  const reload=setup(h.storage);await reload.ready;
  assert.equal(reload.hidden('firstUseHome'),true);
});

test('concurrent save callbacks acknowledge once; failed acknowledgement markers never claim success',async()=>{
  for(const markerFailure of [false,true]){
    const h=setup();await h.ready;
    h.run(`var result=GarageFitCoachModel.createSessionResult(${JSON.stringify(sessionResult())});var store=GarageFitCoachStore.createStore(localStorage)`);
    await h.run('store.saveSessionResult(result)');
    if(markerFailure){const write=h.app.localStorage.setItem;h.app.localStorage.setItem=(key,value)=>{if(key===MARKER)throw Error('full');write(key,value);};}
    const values=await h.run('Promise.all([firstUse.saved(result),firstUse.saved(result)])');
    assert.equal(values.filter(Boolean).length,markerFailure?0:1);
    const reload=setup(h.storage);await reload.ready;
    assert.equal(reload.status().completed,true,'durable history retires guidance even if acknowledgement was interrupted');
    assert.equal(await reload.run(`firstUse.saved(${JSON.stringify(sessionResult())})`),false);
  }
});
