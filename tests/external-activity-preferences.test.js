const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');

const routines = [{activityType:'Tennis',sessionsPerWeek:1},{activityType:'cycling',sessionsPerWeek:2.5}];
const setup = (storage = new Map()) => {
  const p = pilot(storage);
  p.run("const OriginalDate=Date; Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:['2026-10-21T08:00:00Z']));} static now(){return Date.parse('2026-10-21T08:00:00Z');}}; const model=GarageFitCoachModel; const preferenceStore=GarageFitCoachStore.createStore(localStorage);");
  return p;
};

test('external preferences default to none without writes, persist, edit, reload and clear independently', async () => {
  const storage = new Map(), p = setup(storage);
  await p.run('firstUse.ready'); // Separate startup presentation markers from preference reads.
  const before = [...storage];
  await p.run('(async()=>{globalThis.emptyPreferences=await preferenceStore.loadCoachPreferences()})()');
  assert.deepEqual(p.json('emptyPreferences'),{schemaVersion:1,usualExternalActivities:[]});
  assert.deepEqual([...storage],before);
  await p.run(`coachUI.controller.saveExternalActivityPreferences(${JSON.stringify(routines)})`);
  const q = setup(storage);
  await q.run('(async()=>{globalThis.savedPreferences=await preferenceStore.loadCoachPreferences()})()');
  assert.deepEqual(q.json('savedPreferences.usualExternalActivities'),routines);
  await q.run("coachUI.controller.saveExternalActivityPreferences([{activityType:'running',sessionsPerWeek:3}])");
  await q.run('(async()=>{globalThis.savedContext=await coachUI.controller.externalActivityContext()})()');
  assert.equal(q.json('savedContext.typical')[0].activityType,'running');
  await q.run('coachUI.controller.clearExternalActivityPreferences()');
  await p.run('(async()=>{globalThis.cleared=await coachUI.controller.externalActivityContext()})()');
  assert.deepEqual(p.json('cleared'),{typical:[],actual:{status:'unknown',provenance:null,confidence:'unknown',reports:[]}});
  assert.deepEqual([...storage],before);
});

test('preferences reject invalid routines, guessed dated/dose fields and future schema without overwriting valid data', async () => {
  const p=setup();
  await p.run(`coachUI.controller.saveExternalActivityPreferences(${JSON.stringify(routines)})`);
  const invalid = [null,{},[{activityType:'',sessionsPerWeek:1}],[{activityType:' running',sessionsPerWeek:1}],
    [{activityType:'x'.repeat(101),sessionsPerWeek:1}],[{activityType:'running',sessionsPerWeek:0}],
    [{activityType:'running',sessionsPerWeek:-1}],[{activityType:'running',sessionsPerWeek:1e20}],[{activityType:'running',sessionsPerWeek:'2'}],
    [{activityType:'running',sessionsPerWeek:1,localDate:'2026-10-21'}],
    [{activityType:'running',sessionsPerWeek:1,seconds:300}],
    [{activityType:'Tennis',sessionsPerWeek:1},{activityType:'tennis',sessionsPerWeek:2}],
    Array.from({length:17},(_,i)=>({activityType:'activity '+i,sessionsPerWeek:1}))];
  for (const input of invalid) await assert.rejects(async()=>p.run(`coachUI.controller.saveExternalActivityPreferences(${JSON.stringify(input)})`),error=>error.code==='invalid-record');
  assert.throws(()=>p.run("model.createCoachPreferences({usualExternalActivities:[{activityType:'running',sessionsPerWeek:Infinity}]})"),error=>error.code==='invalid-record');
  await p.run('(async()=>{globalThis.saved=await preferenceStore.loadCoachPreferences()})()');
  assert.deepEqual(p.json('saved.usualExternalActivities'),routines);
  await p.run("localStorage.setItem('gf_coach_preferences',JSON.stringify({schemaVersion:2,usualExternalActivities:[]}))");
  await assert.rejects(p.run('preferenceStore.loadCoachPreferences()'),error=>error.code==='unsupported-schema-version');
  await p.run("localStorage.setItem('gf_coach_preferences','broken')");
  await assert.rejects(p.run('preferenceStore.loadCoachPreferences()'),error=>error.code==='corrupt-record');
});

test('typical routines never imply attendance; confirmed means explicit reported context, retaining date-only provenance', () => {
  const p=setup();
  p.run(`const preferences=model.createCoachPreferences({usualExternalActivities:${JSON.stringify(routines)}});
    const typical=model.externalActivityContext(preferences,{plannedMatchDate:'2026-10-21'},'2026-10-21');
    const actual=model.externalActivityContext(preferences,{reportedSportActivity:[{sportId:'tennis',localDate:'2026-10-20',intensity:'hard'}]},'2026-10-21');`);
  assert.deepEqual(p.json('typical.actual'),{status:'unknown',provenance:null,confidence:'unknown',reports:[]});
  for(const item of p.json('typical.typical')) {
    assert.equal(item.status,'typical'); assert.equal(item.provenance,'user-preference'); assert.equal(item.confidence,'approximate');
    assert.equal('localDate' in item,false); assert.equal('dose' in item,false);
  }
  assert.deepEqual(p.json('actual.actual'),{status:'confirmed',provenance:'session-context.reportedSportActivity',confidence:'user-reported',
    reports:[{activityType:'tennis',localDate:'2026-10-20',reportedIntensity:'hard'}]});
  assert.equal(p.run('Object.isFrozen(actual.actual.reports[0])'),true);
  assert.deepEqual(p.json('actual.typical'),p.json('typical.typical'));
  for (const day of ['2026-10-22','2026-10-14']) assert.throws(()=>p.run(`model.externalActivityContext(preferences,{reportedSportActivity:[{sportId:'tennis',localDate:'${day}',intensity:'hard'}]},'2026-10-21')`),error=>error.code==='invalid-record');
  assert.throws(()=>p.run("model.externalActivityContext(preferences,{reportedSportActivity:[{sportId:'tennis',localDate:'2026-10-20',intensity:'hard'}]})"),error=>error.code==='invalid-record');
});

test('preferences and reads leave programme pins, credited history, Tennis planning isolated', async () => {
  for (const name of ['general-strength','tennis-conditioning','build-arms']) {
    const storage=new Map(),p=setup(storage);
    await p.run('coachUI.open()');
    // Use existing definitions rather than inventing General Fitness scheduling.
    const id=p.run(`Object.keys(GarageFitData.programmes).find(id=>Object.values(GarageFitData.programmes[id]).some(def=>def.type==='${name}'))`);
    assert.ok(id,name);
    await p.run(`coachUI.controller.start(Object.values(GarageFitData.programmes[${JSON.stringify(id)}]).at(-1),['dumbbells','bench'])`);
    p.run("function stablePlan(){return JSON.parse(JSON.stringify(coachUI.controller.plan({equipment:['dumbbells','bench']})),(key,value)=>key==='prescriptionId'||key==='now'?undefined:value)}; const beforePlan=stablePlan()");
    const before=p.json('coachUI.controller.snapshot()'), records=[...storage];
    await p.run(`coachUI.controller.saveExternalActivityPreferences(${JSON.stringify(routines)})`);
    await p.run('coachUI.controller.externalActivityContext()');
    assert.deepEqual(p.json('coachUI.controller.snapshot()'),before);
    assert.deepEqual(p.json('stablePlan()'),p.json('beforePlan'),'published planning ignores preferences');
    assert.deepEqual([...storage].filter(([key])=>key!=='gf_coach_preferences'),records);
    await p.run('coachUI.controller.load()');
    assert.deepEqual(p.json('coachUI.controller.snapshot().state'),before.state,'reload retains exact published state');
    assert.deepEqual(p.json('coachUI.controller.snapshot().results'),[],'no fictional sessions or credit');
  }
});
