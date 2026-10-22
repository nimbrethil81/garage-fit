const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');
const fixtures = require('./helpers/coach-fixtures');

global.window = global;
require('../data/sport-profiles.js');
require('../js/coach-model.js');
require('../js/coach-store.js');
const Model = GarageFitCoachModel;
const defaults = () => Model.createProgrammeSettings({sportId: 'tennis'});
const settings = p => p.json('pilot.snapshot().state.currentTargets.programmeSettings');
const configure = p => p.run("pilot.saveProgrammeSettings({sportId:'tennis',usualPlayingDays:['tuesday','saturday'],typicalSportIntensity:'hard'})");
const recordOne = p => p.run(`pilotTracker.recordAnchor(pilotTracker.plannedWork().find(item=>item.requirementId).occurrenceId,
  {status:'completed',sets:[{reps:4,load:null}]})`);

test('sport profiles are immutable configuration boundaries, with independent instance defaults', () => {
  const profile = GarageFitData.sportProfiles.tennis;
  assert.equal(profile.id, 'tennis');
  for (const value of [GarageFitData.sportProfiles, profile, profile.capabilities, profile.configuration,
    profile.configuration.focuses, profile.defaults, profile.defaults.usualPlayingDays]) assert.ok(Object.isFrozen(value));
  assert.deepEqual(defaults(), {schemaVersion:1, sportId:'tennis',focus:'balanced',weeklyCoachFrequency:2,
    usualPlayingDays:[],typicalSportIntensity:'moderate',intent:'ongoing',significantEventDate:null});
  const a = defaults(), b = defaults(); a.usualPlayingDays.push('monday'); a.focus = 'power';
  assert.deepEqual(b, defaults()); assert.deepEqual(profile.defaults.usualPlayingDays, []);
  const input = {sportId:'tennis',usualPlayingDays:['friday']}, made = Model.createProgrammeSettings(input);
  made.usualPlayingDays.push('sunday'); assert.deepEqual(input.usualPlayingDays, ['friday']);
});

test('all approved focuses, frequencies, intensities, days and intents are accepted', () => {
  for (const focus of ['balanced','movement','power','endurance','resilience']) {
    for (const weeklyCoachFrequency of [1,2,3]) {
      for (const typicalSportIntensity of ['light','moderate','hard']) {
        const made = Model.createProgrammeSettings({sportId:'tennis',focus,weeklyCoachFrequency,typicalSportIntensity});
        assert.equal(made.focus, focus); assert.equal(made.weeklyCoachFrequency, weeklyCoachFrequency);
      }
    }
  }
  assert.doesNotThrow(() => Model.createProgrammeSettings({sportId:'tennis',usualPlayingDays:GarageFitData.sportProfiles.tennis.configuration.playingDays}));
  assert.equal(Model.createProgrammeSettings({sportId:'tennis',intent:'event'}).significantEventDate, null);
  assert.equal(Model.createProgrammeSettings({sportId:'tennis',intent:'event',significantEventDate:'2028-02-29'}).significantEventDate, '2028-02-29');
});

test('invalid and unsupported choices reject before any copying/default fallback', () => {
  for (const patch of [
    {sportId:'football'}, {sportId:'toString'}, {sportId:' tennis'}, {sportId:null},
    {focus:'speed'}, {focus:null}, {focus:undefined},
    {weeklyCoachFrequency:0}, {weeklyCoachFrequency:4}, {weeklyCoachFrequency:2.5}, {weeklyCoachFrequency:'2'}, {weeklyCoachFrequency:NaN},
    {usualPlayingDays:'monday'}, {usualPlayingDays:['Monday']}, {usualPlayingDays:['irregular']}, {usualPlayingDays:[1]}, {usualPlayingDays:['tuesday','tuesday']},
    {typicalSportIntensity:'very-hard'}, {intent:'competition'}, {significantEventDate:'2026-11-01'},
    {intent:'event',significantEventDate:'2026-02-29'}, {intent:'event',significantEventDate:'2026-04-31'},
    {intent:'event',significantEventDate:'2026-10-01T00:00:00Z'}, {intent:'event',significantEventDate:'2026-1-1'},
    {intent:'event',significantEventDate:'0000-01-01'}, {intent:'event',significantEventDate:5},
    {schemaVersion:2}, {readiness:{}}, {dose:10}, {lastAppliedSessionResultId:'credit'}, {frequency:2}
  ]) {
    assert.throws(() => Model.createProgrammeSettings({sportId:'tennis',...patch}), error => error.code === 'invalid-record', String(Object.keys(patch)));
    assert.throws(() => Model.updateProgrammeSettings(defaults(), patch), error => error.code === 'invalid-record');
  }
  assert.throws(() => Model.createProgrammeSettings({}), /sportId/);
  assert.throws(() => Model.createProgrammeSettings(null), /required/);
  assert.throws(() => Model.updateProgrammeSettings({...defaults(),schemaVersion:2}, {}), /schemaVersion/);
});

test('event dates remain date-only across local timezones, including leap years and DST', () => {
  for (const value of ['2024-02-29','2000-02-29','2026-03-08','2026-11-01']) assert.ok(Model.isLocalDate(value));
  for (const value of ['1900-02-29','2100-02-29','2026-00-12','2026-13-01','2026-10-00','2026-10-32']) assert.equal(Model.isLocalDate(value), false);
  const previousTimezone = process.env.TZ;
  try {
    const outputs = ['America/Los_Angeles','Asia/Tokyo'].map(TZ => {
      process.env.TZ = TZ;
      return {offset:new Date(2026,10,1).getTimezoneOffset(),
        settings:Model.createProgrammeSettings({sportId:'tennis',intent:'event',significantEventDate:'2026-11-01'})};
    });
    assert.notEqual(outputs[0].offset, outputs[1].offset);
    assert.deepEqual(outputs[0].settings, outputs[1].settings);
    assert.equal(outputs[0].settings.significantEventDate,'2026-11-01');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('Programme State validates its reserved namespace; historical v1 records remain unchanged', async () => {
  const memory = new Map(), storage = {get length(){return memory.size;},key:i=>[...memory.keys()][i],
    getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
  const store = GarageFitCoachStore.createStore(storage);
  const state = fixtures.programmeState(), draft = fixtures.sessionDraft(), result = fixtures.sessionResult();
  const reference = Model.createActiveProgramme(Model.programmeDefinitionRef(state));
  memory.set('gf_coach_programme_state:prog-1',JSON.stringify(state));
  memory.set('gf_coach_active_programme',JSON.stringify(reference));
  memory.set('gf_coach_session_draft',JSON.stringify(draft));
  memory.set('gf_coach_session_result:result-1',JSON.stringify(result));
  memory.set('gf_coach_session_result_index',JSON.stringify({schemaVersion:1,sessionResultIds:['result-1']}));
  const before = new Map(memory);
  assert.deepEqual(await store.loadProgrammeState('prog-1'), state);
  assert.deepEqual(await store.loadActiveProgramme(), reference);
  assert.deepEqual(await store.loadSessionDraft(), draft);
  assert.deepEqual(await store.getSessionResult('result-1'), result);
  assert.deepEqual((await store.listSessionResults()).results, [result]);
  assert.deepEqual(memory, before); assert.equal(Model.SCHEMA_VERSION,1);
  for (const invalid of [null,{...defaults(),focus:'speed'},{...defaults(),schemaVersion:2}]) {
    await assert.rejects(store.saveProgrammeState({...state,currentTargets:{...state.currentTargets,programmeSettings:invalid}}), /programmeSettings/);
  }
  assert.deepEqual(memory, before);
  await store.saveProgrammeState({...state,currentTargets:{...state.currentTargets,programmeSettings:defaults()}});
  assert.deepEqual((await store.loadProgrammeState('prog-1')).currentTargets.programmeSettings, defaults());
});

for (const programme of ['general-strength-4w','build-arms']) {
  test(programme+': configuration is per instance, credit-free, and independent of today’s overrides', async () => {
    const p = pilot(new Map(), programme); await p.start();
    const initial = p.json('pilot.snapshot().state'), keys = [...p.storage.keys()];
    assert.equal(initial.currentTargets.programmeSettings, undefined);
    await configure(p);
    const configured = p.json('pilot.snapshot().state');
    delete configured.currentTargets.programmeSettings;
    assert.deepEqual(configured, initial); assert.deepEqual([...p.storage.keys()], keys);
    const expected = settings(p), beforePreview = p.json('pilot.snapshot().state');
    p.run('pilot.prepare({...pilotOptions,easyToday:true,sessionContext:{readiness:{value:"tired",localDate:"2026-10-01"},reportedSportActivity:[{sportId:"tennis",localDate:"2026-10-01",intensity:"hard"}]}})');
    assert.deepEqual(p.json('pilot.snapshot().state'), beforePreview);
    // Released programmes ignore future sport settings/context when making prescriptions.
    const withChoices = p.json('pilot.plan(pilotOptions).prescription');
    const withoutChoices = p.json(`pilotEngine.planNextSession(pilotDef,${JSON.stringify(initial)},[],
      {...pilotOptions,now:pilotNow,prescriptionId:${JSON.stringify(withChoices.prescriptionId)}}).prescription`);
    assert.deepEqual(withChoices, withoutChoices);
    await p.run("pilot.manage('pause')"); await p.run("pilot.manage('resume')");
    assert.deepEqual(settings(p), expected);
    await p.begin(); await recordOne(p); await p.finish();
    assert.deepEqual(settings(p), expected); assert.equal(p.json('pilot.snapshot().state').meaningfulSessionsCompleted,1);
    const q = pilot(p.storage,programme); await q.run('pilot.load()');
    assert.deepEqual(q.json('pilot.snapshot().state'), p.json('pilot.snapshot().state'));
    await q.run("pilot.saveProgrammeSettings({intent:'event',significantEventDate:'2026-11-01',weeklyCoachFrequency:1})");
    const eventState = q.json('pilot.snapshot().state');
    assert.equal(eventState.programmeInstanceId, initial.programmeInstanceId);
    assert.equal(eventState.programmeDefinitionId, initial.programmeDefinitionId);
    assert.equal(eventState.programmeDefinitionVersion, initial.programmeDefinitionVersion);
    assert.equal(eventState.meaningfulSessionsCompleted,1);
    const rebuilt = q.json('pilotEngine.rebuildDerivedState(pilotDef,pilot.snapshot().state,pilot.snapshot().results)');
    assert.deepEqual(rebuilt.currentTargets.programmeSettings, settings(q));
    assert.deepEqual(rebuilt, eventState);
    await q.run("pilot.saveProgrammeSettings({intent:'ongoing',significantEventDate:null})");
    assert.equal(settings(q).intent,'ongoing');
    await q.run("pilot.manage('finish')");
    await assert.rejects(q.run("pilot.saveProgrammeSettings({focus:'power'})"), /completed/);
    q.run('pilotId=100'); // Reloaded test controllers use a fresh deterministic ID sequence.
    await q.run("pilot.start(pilotDef,pilotOptions.equipment)");
    assert.equal(q.json('pilot.snapshot().state').currentTargets.programmeSettings, undefined);
    const historical = await q.run(`pilotStore.loadProgrammeState(${JSON.stringify(initial.programmeInstanceId)})`);
    assert.equal(historical.currentTargets.programmeSettings.intent, 'ongoing');
  });

  test(programme+': settings survive result transaction failures, interrupted sessions and rebuild', async () => {
    for (const step of ['session_result:', 'session_result_index', 'programme_state:', 'clear', 'interrupted']) {
      const p = pilot(new Map(), programme); await p.start(); await configure(p);
      const expected = settings(p); await p.begin(); await recordOne(p);
      if (step !== 'interrupted') {
        p.run(`const set=localStorage.setItem,remove=localStorage.removeItem;let failed=false;
          localStorage.setItem=(key,value)=>{if(!failed&&key.includes(${JSON.stringify(step)})){failed=true;throw new Error('interrupted write');}return set(key,value);};
          localStorage.removeItem=key=>{if(!failed&&${JSON.stringify(step)}==='clear'){failed=true;throw new Error('interrupted clear');}return remove(key);};`);
        await assert.rejects(p.finish(), /storage/);
      }
      const reopened = pilot(p.storage, programme); await reopened.run('pilot.load()');
      const state = reopened.json('pilot.snapshot().state');
      assert.deepEqual(settings(reopened), expected); assert.equal(state.meaningfulSessionsCompleted,1);
      assert.equal(state.currentTargets.dose.exposure,1);
      assert.equal(reopened.json('pilot.snapshot().results').length,1);
      assert.equal(await reopened.run('pilotStore.loadSessionDraft()'),null);
      await reopened.run('pilot.load(true)'); assert.deepEqual(reopened.json('pilot.snapshot().state'), state);
      assert.deepEqual(reopened.json('pilotEngine.rebuildDerivedState(pilotDef,pilot.snapshot().state,pilot.snapshot().results)'),state);
    }
    const p = pilot(new Map(),programme); await p.start(); await configure(p); await p.begin();
    const q = pilot(p.storage,programme); await q.run('pilot.load()');
    assert.deepEqual(settings(q),settings(p));
    assert.equal(q.json('pilot.snapshot().state').meaningfulSessionsCompleted,0);
    assert.equal(q.json('pilot.snapshot().state').currentTargets.dose.exposure,0);
  });
}

test('creation and optional policy restrictions reject visibly, preserving state/definition identity', async () => {
  const p = pilot();
  await assert.rejects(p.run("pilot.start(pilotDef,pilotOptions.equipment,{sportId:'tennis',focus:'speed'})"), /focus/);
  assert.equal(p.storage.size,0);
  await p.run("pilot.start(pilotDef,pilotOptions.equipment,{sportId:'tennis'})");
  assert.deepEqual(settings(p), defaults());
  p.run(`const registry=GarageFitCoachPolicies.createRegistry({'general-strength':{
    ...GarageFitCoachPolicies.createDefaultRegistry().get('general-strength'),
    validateProgrammeSettings:({settings})=>{if(settings.weeklyCoachFrequency===3)throw new Error('Policy does not permit three sessions');}
  }});
  const restricted=GarageFitCoachEngine.createEngine({catalogue:CATALOGUE,registry});`);
  assert.throws(() => p.run("restricted.updateProgrammeSettings(pilotDef,pilot.snapshot().state,{weeklyCoachFrequency:3})"), /does not permit/);
  assert.throws(() => p.run("restricted.startProgramme(pilotDef,{...pilotOptions,programmeInstanceId:'new',programmeSettings:{sportId:'tennis',weeklyCoachFrequency:3}},pilotNow)"), /does not permit/);
  assert.throws(() => p.run("pilotEngine.updateProgrammeSettings({...pilotDef,version:2},pilot.snapshot().state,{focus:'power'})"), /different definition/);
  assert.throws(() => p.run("GarageFitCoachPolicies.createRegistry({'invalid':{...registry.get('general-strength'),validateProgrammeSettings:true}})"), /Invalid policy hook/);
});

test('save route preserves latest performed state, rejects bad/stale updates, and retries storage failure', async () => {
  const p = pilot(); await p.start(); await configure(p);
  const before = p.json('pilot.snapshot().state'), durable = new Map(p.storage);
  await assert.rejects(p.run("pilot.saveProgrammeSettings({weeklyCoachFrequency:4})"), /weeklyCoachFrequency/);
  await assert.rejects(p.run("pilot.saveProgrammeSettings({programmeDefinitionVersion:2})"), /recognised field/);
  assert.deepEqual(p.json('pilot.snapshot().state'), before); assert.deepEqual(p.storage,durable);
  await p.begin();
  await assert.rejects(p.run("pilot.saveProgrammeSettings({focus:'power'})"), /Save the session/);
  await recordOne(p); await p.finish();
  // A stale controller must retain work reconciled by another controller.
  const q = pilot(p.storage); await q.run('pilot.load()');
  p.run("pilotNow='2026-10-04T08:00:00Z'"); await p.begin();
  await assert.rejects(q.run("pilot.saveProgrammeSettings({focus:'power'})"), /Save the session/);
  await recordOne(p); await p.finish();
  await q.run("pilot.saveProgrammeSettings({focus:'power'})");
  assert.equal(q.json('pilot.snapshot().state').meaningfulSessionsCompleted,2);
  assert.equal(q.json('pilot.snapshot().results').length,2);
  const saved = q.json('pilot.snapshot().state');
  q.run(`const save=localStorage.setItem;let failOnce=true;
    localStorage.setItem=(key,value)=>{if(failOnce){failOnce=false;throw new Error('quota');}return save(key,value);};`);
  await assert.rejects(q.run("pilot.saveProgrammeSettings({focus:'resilience'})"), /storage/);
  assert.deepEqual(q.json('pilot.snapshot().state'),saved);
  await q.run("pilot.saveProgrammeSettings({focus:'resilience'})"); assert.equal(settings(q).focus,'resilience');
  await p.run("pilot.manage('finish')"); await p.run("pilot.start(pilotDef,pilotOptions.equipment)");
  await assert.rejects(q.run("pilot.saveProgrammeSettings({focus:'power'})"), /active programme changed/);
  assert.equal(p.json('pilot.snapshot().state').currentTargets.programmeSettings,undefined);
});

test('invalid saved settings are retained and block writes; released programmes still share one active instance', async () => {
  const p = pilot(); await p.start(); await configure(p);
  const key = [...p.storage.keys()].find(key=>key.startsWith('gf_coach_programme_state:'));
  const state = JSON.parse(p.storage.get(key)); state.currentTargets.programmeSettings.schemaVersion=2;
  const raw = JSON.stringify(state); p.storage.set(key,raw);
  const q = pilot(p.storage); await q.run('pilot.load()');
  assert.ok(q.run('pilot.snapshot().blocked')); assert.match(q.run('pilot.snapshot().errors[0].message'),/programmeSettings.schemaVersion/);
  await assert.rejects(q.run("pilot.saveProgrammeSettings({focus:'power'})"), /valid programme/);
  await assert.rejects(q.start(), /Resolve/); assert.equal(q.storage.get(key),raw);
  assert.deepEqual(q.json('Object.keys(GarageFitData.programmes)'),['general-fitness','general-strength-4w','build-arms','tennis-conditioning']);
  const r = pilot(); await r.start(); await configure(r);
  await assert.rejects(r.start(), /Finish the current programme/);
  await r.run("pilot.manage('pause')"); await assert.rejects(r.start(), /Finish the current programme/);
});

test('session context is optional, isolated, explicitly reported and does not become performed evidence', () => {
  assert.doesNotThrow(() => Model.assertSessionContext({}));
  const context = {readiness:{value:'tired',localDate:'2026-10-12'},reportedSportActivity:[{sportId:'tennis',localDate:'2026-10-12',intensity:'light'}]};
  assert.equal(Model.assertSessionContext(context), context);
  for (const invalid of [null,{usualPlayingDays:['monday']},{readiness:2},
    {reportedSportActivity:[{sportId:'unknown',localDate:'2026-10-12',intensity:'hard'}]},
    {reportedSportActivity:[{sportId:'tennis',localDate:'2026-02-30',intensity:'hard'}]}]) assert.throws(() => Model.assertSessionContext(invalid), /Invalid session-context/);
  const p = pilot();
  assert.throws(() => p.run("pilotEngine.startProgramme(pilotDef,{...pilotOptions,programmeInstanceId:'new',sessionContext:{usualPlayingDays:['monday']}},pilotNow)"), /session-context/);
});
