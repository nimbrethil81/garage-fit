const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');
const {ringsDefinition} = require('./helpers/coach-policy-fixtures');

// One storage shared by a scripted Coach controller (performed sessions on an injected
// clock) and the mounted Coach screens, with a test-only opted-in rings definition.
function setup(storage = new Map()) {
  const p = pilot(storage);
  p.run(`const RINGS_DEF=JSON.parse(${JSON.stringify(JSON.stringify(ringsDefinition()))});
    GarageFitData.programmes={...GarageFitData.programmes,'test-only-rings':{1:RINGS_DEF}};
    const ringOptions={equipment:['rings'],duration:30};
    const NativeDate=Date;let uiNow='2026-10-05T09:00:00Z';
    Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[uiNow]));} static now(){return Date.parse(uiNow);}};
    state.ownedEquipment=['rings'];
    function nodes(id){const visit=node=>[node,...(node.children||[]).flatMap(visit)];return visit(document.getElementById(id));}
    function action(label,id='coachContent'){return nodes(id).find(node=>(node.attributes?.['aria-label']===label||node.textContent===label)&&node.onclick);}
    function copyText(id='coachContent'){return nodes(id).map(node=>node.textContent).join(' ');}`);
  p.session = async (day, reps = 10) => {
    p.run(`pilotNow='2026-10-${String(day).padStart(2, '0')}T08:00:00Z'`);
    p.run('pilot.prepare(ringOptions)');
    await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
    await p.run(`(async()=>{for(const work of pilotTracker.plannedWork().filter(item=>item.requirementId==='anchor-dip'))
      await pilotTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:${reps}}],targetAchieved:true});})()`);
    p.run(`pilotNow='2026-10-${String(day).padStart(2, '0')}T08:40:00Z'`);
    return p.run("pilot.finish('complete',{difficulty:'about-right'},2400)");
  };
  p.home = async () => { await p.run('coachUI.open()'); return p.run('copyText()'); };
  p.click = label => p.run(`action(${JSON.stringify(label)}).onclick()`);
  p.has = label => !!p.run(`action(${JSON.stringify(label)})`);
  p.durable = async () => JSON.parse(JSON.stringify(await p.run('pilotStore.loadProgrammeState(pilot.snapshot().state.programmeInstanceId)')));
  return p;
}
const dip = state => state.anchors.find(item => item.requirementId === 'anchor-dip');

test('Coach home offers an optional, factual progression and a durable no-nag decline', async () => {
  const p = setup();
  assert.equal((await p.run("pilot.start(RINGS_DEF,['rings'])")).status, 'feasible');
  for (const day of [2, 3]) await p.session(day);
  assert.doesNotMatch(await p.home(), /Optional progression/, 'two sessions are not enough evidence');
  await p.session(4);
  const text = await p.home();
  assert.match(text, /Optional progression/);
  assert.match(text, /Your last 3 sessions of Foot-assisted ring dip had every set completed at 10 reps or more/);
  assert.match(text, /You could try Ring dip, starting at 2 × 3 reps\. Choose it only if it feels right/);
  assert.doesNotMatch(text, /\bready\b/i, 'copy never claims readiness');
  assert.ok(p.has('Try progression') && p.has('Continue current exercise'));
  // No anchor change is possible while a session is in progress.
  p.run('pilot.prepare(ringOptions)'); await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
  assert.deepEqual(p.json("pilot.variationRecommendations(['rings'])"), []);
  const [offered] = p.json("coachUI.controller.variationRecommendations(['rings'])");
  await assert.rejects(p.run(`pilot.confirmVariation(${JSON.stringify(offered.recommendationId)},['rings'])`), /Save the session/);
  await p.run("pilot.finish('exit',{difficulty:'about-right'},60)");
  assert.equal(dip(await p.durable()).exerciseId, 'foot-assisted-ring-dip');
  // An abandoned session with no anchor work is no evidence either way.
  assert.equal(p.json("coachUI.controller.variationRecommendations(['rings'])")[0].recommendationId, offered.recommendationId);
  const before = await p.durable();
  await p.home(); await p.click('Continue current exercise');
  const declined = await p.durable();
  assert.deepEqual({...dip(declined), variationProgression: null}, {...dip(before), variationProgression: null}, 'anchor, targets and progression unchanged');
  assert.equal(dip(declined).variationProgression.declined[0].recommendationId, offered.recommendationId);
  let home = p.run('copyText()');
  assert.doesNotMatch(home, /Optional progression/); assert.match(home, /Keeping Foot-assisted ring dip/);
  // Repeated reconciliation and reopening neither re-prompt nor change state.
  await p.run('coachUI.controller.load(true)'); await p.run('coachUI.controller.load(true)');
  assert.doesNotMatch(await p.home(), /Optional progression/);
  assert.deepEqual(await p.durable(), declined);
  await p.run('pilot.load()');
  for (const day of [6, 7]) await p.session(day);
  assert.doesNotMatch(await p.home(), /Optional progression/, 'bounded re-prompt after declining');
  await p.session(8);
  assert.match(await p.home(), /Optional progression/);
});

test('Try progression durably changes the stable anchor once and survives interrupted startup', async () => {
  const storage = new Map(), p = setup(storage);
  await p.run("pilot.start(RINGS_DEF,['rings'])");
  for (const day of [2, 3, 4]) await p.session(day);
  const resultsBefore = p.json('pilot.snapshot().results').length;
  await p.home();
  const [offered] = p.json("coachUI.controller.variationRecommendations(['rings'])");
  await p.click('Try progression');
  const confirmed = await p.durable();
  assert.equal(dip(confirmed).exerciseId, 'ring-dip');
  assert.deepEqual(dip(confirmed).currentTarget.target, {type: 'reps', minReps: 3, maxReps: 3});
  assert.equal(dip(confirmed).variationProgression.transitions.length, 1);
  assert.equal(confirmed.anchors.find(item => item.requirementId === 'anchor-support').exerciseId, 'foot-assisted-ring-support-hold');
  const home = p.run('copyText()');
  assert.match(home, /Now training Ring dip · starting at 2 × 3 reps\./); assert.doesNotMatch(home, /Optional progression/);
  // Replayed confirmation is a no-op; an unknown suggestion is refused without a write.
  await p.run(`coachUI.controller.confirmVariation(${JSON.stringify(offered.recommendationId)},['rings'])`);
  await assert.rejects(p.run("coachUI.controller.declineVariation('assisted-ring-dip-to-ring-dip@bogus',['rings'])"), /out of date/);
  assert.deepEqual(await p.durable(), confirmed);
  // Your progress names the explicit choice and keeps prior Session Results.
  await p.run('coachUI.openProgrammeProgress()');
  assert.match(p.run("copyText('coachProgressContent')"), /You chose to progress from Foot-assisted ring dip on .*Its history is kept as a separate series/);
  await p.run('pilot.load()');
  assert.equal(p.json('pilot.snapshot().results').length, resultsBefore);
  // The next session prescribes the new exercise at its own target.
  p.run("pilotNow='2026-10-06T08:00:00Z'"); p.run('pilot.prepare(ringOptions)');
  const anchors = p.json("pilot.snapshot().preview.plan.prescription.requiredAnchors");
  assert.deepEqual(anchors.find(item => item.requirementId === 'anchor-dip').target, {type: 'reps', minReps: 3, maxReps: 3});
  assert.equal(anchors.find(item => item.requirementId === 'anchor-dip').exerciseId, 'ring-dip');
  // Interrupt a ring-dip session mid-way; startup recovery finalises durable work only.
  await p.run('pilot.begin().then(value=>{pilotTracker=value;})');
  await p.run(`(async()=>{const work=pilotTracker.plannedWork().find(item=>item.requirementId==='anchor-dip');
    await pilotTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps:3}]});})()`);
  const reloaded = setup(storage);
  await reloaded.run('pilot.load()');
  const recovered = reloaded.json('pilot.snapshot().state');
  assert.equal(reloaded.json('pilot.snapshot().results').at(-1).finalStatus, 'partial');
  assert.equal(dip(recovered).exerciseId, 'ring-dip');
  assert.deepEqual(dip(recovered).variationProgression.transitions, dip(confirmed).variationProgression.transitions);
  await reloaded.run('pilot.load(true)');
  assert.deepEqual(reloaded.json('pilot.snapshot().state'), recovered, 'repeated reconciliation is a no-op');
});
