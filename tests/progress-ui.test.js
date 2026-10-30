const test = require('node:test');
const assert = require('node:assert/strict');
const {pilot} = require('./helpers/coach-pilot');
const {performance} = require('./helpers/coach-policy-fixtures');
const fixture = (id, overrides={}) => performance({sessionResultId:id,source:'generator',programmeInstanceId:null,prescriptionId:null,
  startedAt:'2026-10-29T08:00:00Z',endedAt:'2026-10-29T08:30:00Z',...overrides});
async function ui(records=[]) {
  const p=pilot();await p.run('firstUse.ready');await p.run('coachUI.init()');
  p.run(`const NativeProgressDate=Date;
    Date=class extends NativeProgressDate {constructor(...args){super(...(args.length?args:['2026-10-30T12:00:00Z']));} static now(){return +new NativeProgressDate('2026-10-30T12:00:00Z');}};
    function progressNodes(id){const visit=n=>[n,...(n.children||[]).flatMap(visit)];return visit(document.getElementById(id));}
    function progressText(id){return progressNodes(id).map(n=>n.textContent).join(' ');}
    function progressAction(id,label){return progressNodes(id).find(n=>n.onclick&&(n.attributes['aria-label']===label||n.textContent===label||n.children?.some(c=>c.textContent===label)));}`);
  for(const record of records) await p.run(`pilotStore.saveSessionResult(${JSON.stringify(record)})`);
  p.text=id=>p.run(`progressText('${id}')`);
  p.click=(id,label)=>p.run(`progressAction(${JSON.stringify(id)},${JSON.stringify(label)}).onclick()`);
  return p;
}
test('More and Coach share the overview, including no-programme Coach selection; opening is read-only',async()=>{
  const p=await ui([fixture('one')]);const before=[...p.storage.entries()].filter(([key])=>key!=='gf_first_use_v1');
  await p.run("progressUI.open('more')");assert.equal(p.run('currentScreen'),'yourProgress');
  assert.match(p.text('yourProgressContent'),/Sessions this week.*Last 4 weeks.*Recorded meaningful training only/);
  assert.equal(p.run("document.getElementById('bottomNav').classList.contains('hidden')"),false);
  assert.equal(p.run('appBack()'),true);assert.equal(p.run('currentScreen'),'more');
  await p.run('coachUI.open()');await p.click('coachContent','Your progress');
  assert.equal(p.run('currentScreen'),'yourProgress');p.run('appBack()');assert.equal(p.run('currentScreen'),'coach');
  assert.deepEqual([...p.storage.entries()].filter(([key])=>key!=='gf_first_use_v1'),before);
});
test('summary counts only performed Main training, across programmes, within local calendar and rolling windows',async()=>{
  const p=await ui();
  const records=[fixture('one'),fixture('other',{source:'coach',programmeInstanceId:'other',prescriptionId:'rx'}),
    fixture('support',{source:'fixed',workoutId:'deskBreak'}),fixture('stretch',{source:'fixed',workoutId:'postRunReset'}),
    fixture('empty',{performedWork:[]}),fixture('abandoned',{finalStatus:'abandoned'}),
    fixture('zero',{performedWork:[{occurrenceId:'main-1',exerciseId:'goblet-squat',status:'completed',sets:[{reps:0}]}]}),
    fixture('unlinked',{plannedWork:[]}),fixture('old',{endedAt:'2026-09-01T09:00:00Z',startedAt:'2026-09-01T08:00:00Z'}),
    fixture('future',{endedAt:'2026-11-01T09:00:00Z',startedAt:'2026-11-01T08:00:00Z'}),
    fixture('partial',{finalStatus:'partial',performedWork:[{occurrenceId:'main-1',exerciseId:'goblet-squat',status:'partial',sets:[{reps:2}]}]})];
  const input=JSON.stringify(records);p.run(`globalThis.records=${input}`);
  assert.deepEqual(p.json("GarageFitProgressUI.summary(records,new Date('2026-10-30T12:00:00Z'))"),{week:3,fourWeeks:3});
  assert.equal(p.run('JSON.stringify(records)'),input);
  assert.equal(p.run("GarageFitProgressUI.classification(records[2])"),'Movement break');
  assert.equal(p.run("GarageFitProgressUI.classification(records[3])"),'Recovery');
  // Monday midnight begins a new week, while Sunday's session remains in 4 weeks.
  assert.deepEqual(p.json("GarageFitProgressUI.summary([records[0]],new Date('2026-11-02T00:00:00'))"),{week:0,fourWeeks:1});
});
test('three recent rows, single history action, chronological date groups and supporting-only filter',async()=>{
  const p=await ui([fixture('one'),fixture('two',{startedAt:'2026-10-28T08:00:00Z',endedAt:'2026-10-28T09:00:00Z'}),fixture('three',{source:'fixed',workoutId:'deskBreak'}),fixture('four',{source:'fixed',workoutId:'postRunReset'})]);
  await p.run("progressUI.open('more')");
  assert.equal(p.run("progressNodes('yourProgressContent').filter(n=>n.className==='progress-row'&&n.attributes['aria-label']!=='View programme progress').length"),3);
  assert.equal(p.run("progressNodes('yourProgressContent').filter(n=>n.onclick&&n.children.some(c=>c.textContent==='View history')).length"),1);
  await p.click('yourProgressContent','View history');assert.match(p.text('trainingHistoryContent'),/Movement break.*Recovery/);
  await p.click('trainingHistoryContent','Training only');assert.doesNotMatch(p.text('trainingHistoryContent'),/Desk Break|Post-run Stretch/);
  assert.match(p.text('trainingHistoryContent'),/Yesterday.*Wednesday.*28.*2026/);
});
test('history detail back restores exact filter, scroll and selected row; programme back restores overview',async()=>{
  const p=await ui([fixture('one'),fixture('support',{source:'fixed',workoutId:'deskBreak'})]);
  await p.run('coachUI.controller.start(GarageFitData.programmes["tennis-conditioning"][1],["dumbbells","bench"])');
  await p.run("progressUI.open('more')");assert.match(p.text('yourProgressContent'),/0 programme sessions completed/);
  p.run("document.getElementById('yourProgress').scrollTop=81");
  await p.click('yourProgressContent','View programme progress');assert.equal(p.run('currentScreen'),'coachProgress');
  p.run('appBack()');assert.equal(p.run('currentScreen'),'yourProgress');assert.equal(p.run("document.getElementById('yourProgress').scrollTop"),81);
  await p.click('yourProgressContent','View history');await p.click('trainingHistoryContent','Training only');
  p.run("document.getElementById('trainingHistory').scrollTop=137;progressUI.openDetail('one')");assert.equal(p.run('currentScreen'),'sessionDetails');
  p.run('appBack()');assert.equal(p.run('currentScreen'),'trainingHistory');assert.equal(p.run("document.getElementById('trainingHistory').scrollTop"),137);
  assert.equal(p.run("progressNodes('trainingHistoryContent').find(n=>n.children.some(c=>c.textContent==='Training only')).attributes['aria-pressed']"),'true');
  p.run('appBack()');assert.equal(p.run('currentScreen'),'yourProgress');p.run('appBack()');assert.equal(p.run('currentScreen'),'more');
});
test('read-only detail keeps actual occurrences, side, timing, measured zero and unknowns without planned dose',async()=>{
  const record=fixture('partial',{finalStatus:'partial',actualDurationSeconds:1080,plannedWork:[
    {occurrenceId:'a',exerciseId:'goblet-squat',section:'main',prescription:{type:'reps',reps:99,side:'left',plannedLoad:{value:100}}},
    {occurrenceId:'b',exerciseId:'plank',section:'main',prescription:{type:'timed',seconds:90}},
    {occurrenceId:'c',exerciseId:'push-up',section:'main',prescription:{type:'reps',reps:99}},
    {occurrenceId:'skip',exerciseId:'push-up',section:'main',prescription:{type:'reps',reps:99}}],performedWork:[
    {occurrenceId:'a',exerciseId:'goblet-squat',status:'completed',sets:[{reps:0,seconds:10,load:0,loadUnit:'kg',loadInterpretation:'total'}]},
    {occurrenceId:'b',exerciseId:'plank',status:'partial',sets:[{seconds:12}]},
    {occurrenceId:'c',exerciseId:'push-up',status:'completed'},
    {occurrenceId:'skip',exerciseId:'push-up',status:'skipped'}]});
  const p=await ui([record]);await p.run("progressUI.open('more');");p.run("progressUI.openDetail('partial','yourProgress')");
  const text=p.text('sessionDetailsContent');assert.match(text,/18 min.*Recorded duration/);assert.match(text,/left.*0 reps · 10 sec · 0 kg total/);
  assert.match(text,/12 sec/);assert.match(text,/Amount not recorded/);assert.match(text,/Remaining planned exercises/);
  assert.doesNotMatch(text,/99|100|90 sec/);
  assert.equal(p.run("progressNodes('sessionDetailsContent').filter(n=>n.onclick).length"),0);
});
test('legacy unknown identity and duration remain unknown; sparse and supporting-only states are neutral',async()=>{
  const p=await ui([fixture('legacy',{actualDurationSeconds:null,plannedWork:[],performedWork:[{occurrenceId:'old',exerciseId:null,status:'partial'}]})]);
  await p.run("progressUI.open('more')");assert.match(p.text('yourProgressContent'),/Building your performance history/);
  p.run("progressUI.openDetail('legacy')");assert.match(p.text('sessionDetailsContent'),/Recorded session.*Duration not recorded.*Exercise not identified/);
  assert.doesNotMatch(p.text('sessionDetailsContent'),/undefined|NaN/);
  const support=await ui([fixture('desk',{source:'fixed',workoutId:'deskBreak'})]);await support.run("progressUI.open('more')");
  support.run('progressUI.openHistory()');await support.click('trainingHistoryContent','Training only');assert.match(support.text('trainingHistoryContent'),/No recorded training yet.*Supporting activities remain/);
});
test('new zero-session Tennis programme retains older Generator and other-programme history with separate programme credit',async()=>{
  const p=await ui([fixture('generator'),fixture('old-coach',{source:'coach',programmeInstanceId:'old-strength',prescriptionId:'old-rx'})]);
  await p.run('coachUI.controller.start(GarageFitData.programmes["tennis-conditioning"][1],["dumbbells","bench"])');
  const before=p.json('coachUI.controller.snapshot().state');await p.run('coachUI.openProgress()');
  assert.equal(p.run("progressNodes('yourProgressContent').filter(n=>n.attributes['aria-label']?.startsWith('Recorded session')).length"),2);
  assert.match(p.text('yourProgressContent'),/Tennis Conditioning.*0 programme sessions completed/);
  assert.deepEqual(p.json('coachUI.controller.snapshot().state'),before);
});
test('strict insights require measured comparable exercise/side/protocol/load and suppress outdated or partial improvements',async()=>{
  const p=await ui();const a=fixture('a'),b=fixture('b',{endedAt:'2026-10-30T09:00:00Z',performedWork:[{occurrenceId:'main-1',exerciseId:'goblet-squat',status:'completed',sets:[{reps:10,load:16,loadUnit:'kg',loadInterpretation:'total'}]}]});
  const compare=(x,y)=>{p.run(`globalThis.comparison=GarageFitProgressUI.insights(GarageFitTrainingHistory.createHistory(${JSON.stringify([x,y])},CATALOGUE))`);return p.json('comparison');};
  assert.equal(compare(a,b)[0].change,'improved-reps');
  for(const modify of [r=>r.performedWork[0].sets[0].load=null,r=>r.performedWork[0].sets[0].loadInterpretation='per-item',r=>r.performedWork[0].status='partial',r=>r.plannedWork[0].prescription.side='left',r=>r.plannedWork[0].prescription.protocolConditions.roundRestSeconds=30]){
    const changed=JSON.parse(JSON.stringify(b));modify(changed);assert.equal(compare(a,changed).length,0);
  }
});
test('performance insights compare all rounds and reject a shorter dose or a later partial baseline',async()=>{
  const p=await ui();
  const multi=(id,reps)=>fixture(id,{endedAt:id==='before'?'2026-10-29T09:00:00Z':'2026-10-30T09:00:00Z',
    plannedWork:[1,2].map(i=>({...fixture('x').plannedWork[0],occurrenceId:'round-'+i})),
    performedWork:reps.map((value,i)=>({occurrenceId:'round-'+(i+1),exerciseId:'goblet-squat',status:'completed',sets:[{reps:value,load:16,loadUnit:'kg',loadInterpretation:'total'}]}))});
  const before=multi('before',[8,8]), after=multi('after',[9,8]);
  const compare=records=>p.json(`GarageFitProgressUI.insights(GarageFitTrainingHistory.createHistory(${JSON.stringify(records)},CATALOGUE))`);
  assert.equal(compare([before,after])[0].change,'improved-reps');
  assert.equal(compare([before,multi('after',[10])]).length,0,'a missing round cannot become an improvement');
  assert.equal(compare([before,multi('after',[10,7])]).length,0,'one improved round cannot hide a lower round');
  const latest=multi('after',[10,10]);latest.sessionResultId='partial';latest.endedAt='2026-10-31T09:00:00Z';latest.performedWork[1].status='partial';
  assert.equal(compare([before,after,latest]).length,0,'a later partial baseline suppresses old gains');
});
test('unavailable or partly corrupt storage shows accessible warnings and never presents missing records as a real empty history',async()=>{
  const p=await ui();
  p.run("globalThis.errorUI=GarageFitProgressUI.mount({store:{async listSessionResults(){throw new Error('blocked')}},catalogue:CATALOGUE,showScreen,getProgramme:async()=>null,returnToOrigin:()=>{},openProgramme:()=>{}})");
  await p.run("errorUI.open('more')");assert.match(p.text('yourProgressContent'),/totals may be incomplete.*Saved activity is unavailable/);
  assert.ok(p.run("progressNodes('yourProgressContent').some(n=>n.attributes.role==='alert')"));
  p.run(`globalThis.errorUI=GarageFitProgressUI.mount({store:{async listSessionResults(){return {results:[${JSON.stringify(fixture('good'))}],errors:[new Error('corrupt')]}}},catalogue:CATALOGUE,showScreen,getProgramme:async()=>null,returnToOrigin:()=>{},openProgramme:()=>{}})`);
  await p.run("errorUI.open('more')");assert.match(p.text('yourProgressContent'),/totals may be incomplete.*Recorded session/);
  const improved=fixture('improved',{endedAt:'2026-10-30T09:00:00Z',performedWork:[{occurrenceId:'main-1',exerciseId:'goblet-squat',status:'completed',sets:[{reps:10,load:16,loadUnit:'kg',loadInterpretation:'total'}]}]});
  p.run(`globalThis.errorUI=GarageFitProgressUI.mount({store:{async listSessionResults(){return {results:${JSON.stringify([fixture('before'),improved])},errors:[new Error('missing comparison record')]}}},catalogue:CATALOGUE,showScreen,getProgramme:async()=>null,returnToOrigin:()=>{},openProgramme:()=>{}})`);
  await p.run("errorUI.open('more')");assert.doesNotMatch(p.text('yourProgressContent'),/More recorded reps/);

});
test('leaving during a pending read keeps the destination and empty overview has no invented sessions',async()=>{
  const p=await ui();await p.run("progressUI.open('more')");assert.match(p.text('yourProgressContent'),/Your history starts here/);
  p.run("let resolveRead;globalThis.slowUI=GarageFitProgressUI.mount({store:{listSessionResults:()=>new Promise(resolve=>resolveRead=resolve)},catalogue:CATALOGUE,showScreen,getProgramme:async()=>null,returnToOrigin:()=>showScreen('more'),openProgramme:()=>{}});globalThis.pendingRead=slowUI.open('more');slowUI.backOverview();resolveRead({results:[],errors:[]})");
  await p.run('pendingRead');assert.equal(p.run('currentScreen'),'more');
});

test('duration presentation handles precision, minute carry and invalid measurements',async()=>{
  const p=await ui();
  for(const [value,expected] of [[0,'0.0 sec'],[2.6139999999999937,'2.6 sec'],[5.160000000000007,'5.2 sec'],[5.490000000000004,'5.5 sec'],[9.99,'10 sec'],[10,'10 sec'],[34.4,'34 sec'],[59.4,'59 sec'],[59.9,'1 min'],[60,'1 min'],[85,'1 min 25 sec'],[119.9,'2 min']])
    assert.equal(p.run(`GarageFitProgressUI.formatDuration(${value})`),expected);
  for(const value of ['null','undefined','NaN','Infinity','-1','"5"','{}'])
    assert.equal(p.run(`GarageFitProgressUI.formatDuration(${value})`),null);
});
test('detail formats actual seconds consistently and omits irrelevant load placeholders without writes',async()=>{
  const ids=['supine-heel-slides','open-close-gates','standing-scapular-protraction-retraction','goblet-squat'];
  const record=fixture('timing',{finalStatus:'partial',actualDurationSeconds:85,
    plannedWork:ids.map((exerciseId,i)=>({occurrenceId:'x'+i,exerciseId,section:i<3?'warmup':'main',prescription:{type:'timed',seconds:99}})),
    performedWork:ids.map((exerciseId,i)=>({occurrenceId:'x'+i,exerciseId,status:'partial',sets:[{seconds:[2.6139999999999937,5.160000000000007,5.490000000000004,34][i]}]}))});
  const p=await ui([record]);
  // Use canonical identities, so this also catches stale catalogue references.
  for(const id of ids)assert.ok(p.run(`CATALOGUE[${JSON.stringify(id)}]`),id);
  const before=[...p.storage.entries()];await p.run("progressUI.open('more')");
  assert.match(p.text('yourProgressContent'),/1 min 25 sec/);
  p.run("progressUI.openHistory()");assert.match(p.text('trainingHistoryContent'),/1 min 25 sec/);
  p.run("progressUI.openDetail('timing')");const text=p.text('sessionDetailsContent');
  assert.match(text,/2.6 sec/);assert.match(text,/5.2 sec/);assert.match(text,/5.5 sec/);
  assert.equal((text.match(/load not recorded/g)||[]).length,1);
  assert.match(text,/Partial/);assert.doesNotMatch(text,/99 sec|NaN|undefined/);
  assert.deepEqual([...p.storage.entries()],before);
});

test('load relevance uses catalogue descriptors for loaded, band and bodyweight exercises',async()=>{
 const p=await ui();
 for(const [id,expected] of [['goblet-squat',true],['band-row',true],['plank',false],['supine-heel-slides',false],['open-close-gates',false]])
   assert.equal(p.run(`GarageFitProgressUI.loadRelevant(CATALOGUE[${JSON.stringify(id)}])`),expected,id);
 assert.equal(p.run('GarageFitProgressUI.loadRelevant(null)'),true);
});
