const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');

global.window = global;
require('../data/exercises.js');
require('../data/workouts.js');
const catalogue = GarageFitData.exercises;
const workout = GarageFitData.fixedWorkouts.postRunReset;

test('curated plans preserve coverage, sides, timing, eligibility and standing to floor order', () => {
  let recent=[];
  for (const seed of [0, 0.3, 0.7, 0.99]) {
    const plan=GarageFitPostRunStretch.generate({random:()=>seed,recent});
    assert.equal(plan.name,'Post Run Stretch');
    assert.equal(plan.termination.type,'fixed-sequence');
    assert.equal(plan.exercises.reduce((sum,ex)=>sum+ex.durationSeconds+ex.transitionAfter,0),360);
    const ids=[...new Set(plan.exercises.map(ex=>ex.id))];
    for(const region of ['calves','quadriceps','hamstrings','hip-flexors','glutes'])
      assert.ok(ids.some(id=>catalogue[id].stretchTargets.includes(region)),region);
    let floor=false;
    for(const id of ids){
      const ex=catalogue[id];
      assert.deepEqual(ex.equipment,[]);
      assert.equal(ex.cooldown,true);
      if(ex.bodyPosition==='floor')floor=true;
      else assert.equal(floor,false);
      const pair=plan.exercises.filter(step=>step.id===id);
      assert.deepEqual(pair.map(step=>step.side),['right','left']);
      assert.equal(pair[0].durationSeconds,pair[1].durationSeconds);
      assert.ok(pair[0].durationSeconds>=30&&pair[0].durationSeconds<=40);
    }
    if(recent.length){
      assert.notEqual(ids[0],recent[0]);
      assert.notEqual(ids[3],recent[3]);
    }
    recent=ids;
  }
});

test('recency tolerates blocked or malformed storage',()=>{
  assert.deepEqual(GarageFitPostRunStretch.readRecent({getItem(){throw Error();}}),[]);
  assert.deepEqual(GarageFitPostRunStretch.readRecent({getItem(){return '{}';}}),[]);
  GarageFitPostRunStretch.recordStarted(null,workout);
});

// ---- Full playback simulation (mirrors the harness used by tests/evening-full-body-reset.test.js) ----

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value=>this.values.add(value)); }
  remove(...values) { values.forEach(value=>this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force===undefined) force=!this.values.has(value);
    force ? this.values.add(value) : this.values.delete(value);
    return force;
  }
}
class Element {
  constructor(id='') { this.id=id;this.classList=new ClassList();this.style={};this.children=[];this.attributes={};this.disabled=false;this.textContent='';this.innerHTML='';this.value=''; }
  setAttribute(key,value) { this.attributes[key]=String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child);return child; }
  querySelector() { return new Element(); }
  addEventListener() {}
  focus() {}
}

function loadApp() {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const elements = Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  for (const id of ['partialRepsDialog','doneStats','generatedDoneStats','amrapDoneStats']) elements[id].classList.add('hidden');
  const storage = new Map();
  const spoken = [];
  const intervals = new Map(); let nextInterval = 1;
  const context = {
    console, Math, Set,
    SpeechSynthesisUtterance: function(text){this.text=text;},
    speechSynthesis: { cancel(){}, speak(utterance){spoken.push(utterance.text);} },
    document: { getElementById:id=>elements[id]||(elements[id]=new Element(id)), createElement:()=>new Element(), addEventListener(){}, head:new Element(), querySelector(){return null;} },
    localStorage: { getItem:key=>storage.has(key)?storage.get(key):null, setItem:(key,value)=>storage.set(key,String(value)), removeItem:key=>storage.delete(key) },
    navigator: {},
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
    setInterval: callback => { const id=nextInterval++; intervals.set(id,callback); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: callback => callback(),
    addEventListener() {}
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of ['data/equipment.js','data/exercises.js','data/workouts.js','data/workout-families.js','js/workout-families.js','js/generator.js','js/routine-generator.js','js/desk-break.js','js/training-history.js','js/timed-cues.js','js/speech-voices.js','js/completion-signal.js','js/coach-model.js','js/coach-store.js','js/session-tracker.js','js/workout-preview.js','js/masthead.js','js/back-navigation.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename:file });
  }
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline, context, { filename:'index-inline.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8'), context, { filename:'js/workouts-ui.js' });
  elements.bottomNav.parentNode={insertBefore(){}};
  context.GarageFitWorkoutUI.install();
  return { context, elements, intervals, spoken };
}

function tick(intervals, timerId, times) {
  for (let i=0;i<times;i++) intervals.get(timerId)();
}

test('preview launches the same plan and completes every timed step exactly once', () => {
  const {context,elements,intervals}=loadApp();
  const ui=context.GarageFitWorkoutUI;
  ui.openWorkoutDetail('postRunReset');
  const preview=ui.detailDefinition('postRunReset');
  ui.startSelectedWorkout();
  const launched=vm.runInContext('state.list',context);
  assert.deepEqual(Array.from(launched,ex=>[ex.name,ex.work+' sec']),Array.from(preview.exercises,ex=>[ex.name,ex.target]));
  tick(intervals,vm.runInContext('state.timer',context),3);
  for(let i=0;i<launched.length;i++){
    assert.equal(elements.exerciseName.textContent,launched[i].name);
    tick(intervals,vm.runInContext('state.timer',context),launched[i].work);
    if(launched[i].rest)tick(intervals,vm.runInContext('state.timer',context),launched[i].rest);
  }
  assert.equal(vm.runInContext('state.running',context),false);
  assert.equal(elements.doneTitle.textContent,'Post Run Stretch Complete');
});

test('fixed stretch timer ignores queued callbacks and rapid Next at boundaries',()=>{
  const {context,intervals}=loadApp();
  const ui=context.GarageFitWorkoutUI;
  ui.startFixedSequenceWorkout('postRunReset');
  const stale=intervals.get(vm.runInContext('state.timer',context));
  ui.skipFixedSequence();
  const remaining=vm.runInContext('state.remaining',context);
  stale();ui.skipFixedSequence();
  assert.equal(vm.runInContext('state.remaining',context),remaining);
  assert.equal(vm.runInContext('state.phase',context),'work');
});

test('a rep-based fixed sequence shows its target and advances with Next', () => {
  const { context, elements, intervals } = loadApp();
  context.GarageFitData.fixedWorkouts.repExample = {
    name:'Rep example', termination:{type:'fixed-sequence'},
    exercises:[{id:'push-up',name:'Press-ups',reps:5,transitionAfter:0},{id:'dead-bug',name:'Dead bug',durationSeconds:10}]
  };
  context.GarageFitWorkoutUI.startFixedSequenceWorkout('repExample');
  tick(intervals, vm.runInContext('state.timer', context), 3);
  assert.equal(elements.phaseLabel.textContent, 'REPS');
  assert.equal(elements.routineNextAction.textContent, 'Next');
  context.GarageFitWorkoutUI.skipFixedSequence();
  assert.equal(elements.exerciseName.textContent, 'Dead bug');
  assert.equal(elements.routineNextAction.textContent, 'Next');
});

test('existing fixed workouts remain unaffected by the new fixed-sequence engine', () => {
  const cindy = GarageFitData.fixedWorkouts.cindy;
  const abBlast = GarageFitData.fixedWorkouts.abBlast;
  const workout300 = GarageFitData.fixedWorkouts.workout300;
  const evening = GarageFitData.fixedWorkouts.eveningFullBodyReset;
  assert.equal(cindy.termination.type, 'amrap');
  assert.equal(abBlast.termination.type, 'timed-sequence');
  assert.equal(workout300.termination.type, 'fixed-rounds');
  assert.equal(evening.termination.type, 'timed-sequence');
});

test('stretch pause preserves time, resume advances and exit invalidates old ticks',()=>{
  const {context,intervals}=loadApp();
  context.GarageFitWorkoutUI.startFixedSequenceWorkout('postRunReset');
  tick(intervals,vm.runInContext('state.timer',context),3);
  const timer=vm.runInContext('state.timer',context), callback=intervals.get(timer);
  const before=vm.runInContext('state.remaining',context);
  context.togglePause();callback();
  assert.equal(vm.runInContext('state.remaining',context),before);
  context.togglePause();callback();
  assert.equal(vm.runInContext('state.remaining',context),before-1);
  vm.runInContext('state.running=false',context);callback();
  assert.equal(vm.runInContext('state.remaining',context),before-1);
});

test('re-entry chooses fresh alternatives and callbacks from the abandoned session cannot affect it',()=>{
  const {context,intervals}=loadApp();
  const ui=context.GarageFitWorkoutUI;
  ui.openWorkoutDetail('postRunReset');ui.startSelectedWorkout();
  const first=vm.runInContext('state.list[0].id',context);
  const stale=intervals.get(vm.runInContext('state.timer',context));
  vm.runInContext('state.running=false',context);
  ui.openWorkoutDetail('postRunReset');ui.startSelectedWorkout();
  assert.notEqual(vm.runInContext('state.list[0].id',context),first);
  stale();
  assert.equal(vm.runInContext('state.remaining',context),3);
});

const settleHistory = async () => { for(let i=0;i<100;i++)await Promise.resolve(); };
async function saved(context){await settleHistory();return (await context.GarageFitCoachStore.createStore(context.localStorage).listSessionResults()).results;}
function runToEnd(context,intervals){
  let count=0;
  while(vm.runInContext('state.running',context)){
    assert.ok(count++<500,'player finishes');
    intervals.get(vm.runInContext('state.timer',context))();
  }
}
for(const id of ['deskBreak','postRunReset']){
  const start=c=>id==='deskBreak'?c.GarageFitWorkoutUI.startDeskBreak():c.GarageFitWorkoutUI.startFixedSequenceWorkout(id);
  test(id+' saves actual occurrences once, with non-Main evidence and no Coach draft writes',async()=>{
    const {context,intervals}=loadApp();
    // A persisted live draft must remain byte-for-byte untouched, even if it is unreadable.
    const writes=[];const original=context.localStorage.setItem;
    context.localStorage.setItem=(key,value)=>{writes.push(key);original(key,value);};
    original('gf_coach_session_draft','live Coach draft');
    start(context);
    assert.equal((await saved(context)).length,0);
    const list=vm.runInContext('state.list',context);
    const oldTick=intervals.get(vm.runInContext('state.timer',context));
    runToEnd(context,intervals);oldTick();
    const results=await saved(context);assert.equal(results.length,1);
    const result=results[0];assert.equal(result.source,'fixed');assert.equal(result.workoutId,id);
    assert.equal(result.finalStatus,'completed');assert.equal(result.plannedWork.length,id==='deskBreak'?6:10);
    assert.deepEqual(Array.from(result.plannedWork,p=>p.exerciseId),Array.from(list,e=>e.id));
    assert.equal(result.performedWork.length,result.plannedWork.length);
    result.performedWork.forEach((p,i)=>{assert.equal(p.status,'completed');assert.equal(p.sets[0].seconds,list[i].work);assert.equal(p.sets[0].reps,undefined);});
    assert.equal(result.actualDurationSeconds,list.reduce((sum,e)=>sum+e.work+e.rest,3));
    assert.equal(new Set(result.plannedWork.map(p=>p.occurrenceId)).size,result.plannedWork.length);
    assert.ok(result.plannedWork.every(p=>p.section===(id==='deskBreak'?'movement-break':'cooldown')));
    if(id==='postRunReset')assert.deepEqual(Array.from(result.plannedWork,p=>p.prescription.side),Array.from({length:10},(_,i)=>i%2?'left':'right'));
    const history=context.GarageFitTrainingHistory.createHistory(results,context.GarageFitData.exercises);
    assert.equal(history.recentTrainingSummary().sessions.length,0);
    assert.equal(history.recentTrainingSummary({sections:['movement-break','cooldown']}).sessions.length,1);
    assert.equal(Object.keys(history.lastCompletedFamilySessions()).length,0);
    assert.equal(history.sessionsForProgramme('existing-coach').length,0);
    assert.equal(result.programmeInstanceId,undefined);
    assert.ok(Date.parse(result.endedAt)>=Date.parse(result.startedAt));
    assert.equal((await context.GarageFitCoachStore.createStore(context.localStorage).getSessionResult(result.sessionResultId)).workoutId,id);
    assert.ok(writes.every(key=>!key.includes('draft')));
    assert.equal(context.localStorage.getItem('gf_coach_session_draft'),'live Coach draft');
  });
  test(id+' partial and zero-work skips, rapid controls and stale callbacks do not invent work',async()=>{
    const {context,intervals}=loadApp();start(context);
    tick(intervals,vm.runInContext('state.timer',context),3);
    const oldTick=intervals.get(vm.runInContext('state.timer',context));oldTick();oldTick();
    vm.runInContext('Date.now=()=>2000000000000',context);
    (id==='deskBreak'?context.GarageFitWorkoutUI.skipTimedPhase:context.GarageFitWorkoutUI.skipFixedSequence)();oldTick();(id==='deskBreak'?context.GarageFitWorkoutUI.skipTimedPhase:context.GarageFitWorkoutUI.skipFixedSequence)();
    assert.equal(vm.runInContext('state.phase',context),'rest');
    // Advance through the rest naturally, then immediately skip the next work step.
    tick(intervals,vm.runInContext('state.timer',context),vm.runInContext('state.remaining',context));
    vm.runInContext('Date.now=()=>2000000001000',context);(id==='deskBreak'?context.GarageFitWorkoutUI.skipTimedPhase:context.GarageFitWorkoutUI.skipFixedSequence)();
    runToEnd(context,intervals);
    const [result]=await saved(context);
    assert.equal(result.performedWork[0].status,'partial');assert.equal(result.performedWork[0].sets[0].seconds,2);
    assert.ok(!result.performedWork.some(p=>p.occurrenceId===result.plannedWork[1].occurrenceId));
  });
  test(id+' navigation abandons transient evidence and storage failure does not block completion',async()=>{
    const {context,intervals,elements}=loadApp();start(context);
    const stale=intervals.get(vm.runInContext('state.timer',context));
    context.goWorkouts();stale();assert.equal((await saved(context)).length,0);
    start(context);context.localStorage.setItem=()=>{throw Error('blocked');};
    runToEnd(context,intervals);await settleHistory();
    assert.equal(elements.doneTitle.textContent,id==='deskBreak'?'Desk Break Complete':'Post Run Stretch Complete');
    assert.match(elements.doneSub.textContent,/History could not be saved/);
  });
}

test('rapidly skipping every specialist occurrence records no performed credit; unrelated fixed workouts record nothing',async()=>{
  for(const id of ['deskBreak','postRunReset','eveningFullBodyReset']){
    const {context,intervals}=loadApp();
    if(id==='deskBreak')context.GarageFitWorkoutUI.startDeskBreak();
    else if(id==='postRunReset')context.GarageFitWorkoutUI.startFixedSequenceWorkout(id);
    else context.GarageFitWorkoutUI.startTimedSequenceWorkout(id);
    if(id==='eveningFullBodyReset'){runToEnd(context,intervals);assert.equal((await saved(context)).length,0);continue;}
    let count=0;
    while(vm.runInContext('state.running',context)){
      assert.ok(count++<40);
      vm.runInContext('Date.now=()=>'+(2000000000000+count*1000),context);
      context.skipPhase();
    }
    const results=await saved(context);assert.equal(results.length,1);
    assert.equal(results[0].performedWork.length,0);assert.equal(results[0].actualDurationSeconds,0);
  }
});
