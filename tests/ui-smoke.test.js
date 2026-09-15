const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

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
let elementRegistry=null;
class Element {
  constructor(id='') {
    this._id='';this.classList=new ClassList();this.style={};this.children=[];this.attributes={};this.disabled=false;this.textContent='';this._innerHTML='';this.parentNode=null;this.className='';
    Object.defineProperty(this,'id',{enumerable:true,get:()=>this._id,set:value=>{this._id=value;if(elementRegistry&&value)elementRegistry[value]=this;}});
    Object.defineProperty(this,'innerHTML',{enumerable:true,get:()=>this._innerHTML,set:value=>{this._innerHTML=String(value);if(value==='')this.children=[];for(const match of this._innerHTML.matchAll(/\bid="([^"]+)"/g))new Element(match[1]);}});
    this.id=id;
  }
  setAttribute(key,value) { this.attributes[key]=String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { children.forEach(child=>{child.parentNode=this;this.children.push(child);}); }
  appendChild(child) { child.parentNode=this;this.children.push(child);return child; }
  insertBefore(child,before) { child.parentNode=this;const index=this.children.indexOf(before);if(index<0)this.children.push(child);else this.children.splice(index,0,child);return child; }
  querySelector() { return new Element(); }
  addEventListener() {}
  focus() {}
}

test('Generator preview/player and both fixed players initialise without runtime errors', () => {
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/<div class="workout-secondary-controls">\s*<button class="previous-btn" id="previousWorkoutBtn"[\s\S]*?<button class="ctrl-btn ctrl-secondary" id="workoutPauseBtn"[\s\S]*?<\/div>\s*<button class="ctrl-btn ctrl-primary complete-btn" id="completeMovementBtn"/);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  elementRegistry={};
  ids.forEach(id=>new Element(id));
  const elements=elementRegistry, previewParent=new Element(), previewTiming=new Element(), playerActions=new Element();
  previewParent.append(elements.previewList,previewTiming);
  playerActions.append(elements.completeMovementBtn);
  const storage=new Map();
  const spoken=[];
  const intervals=new Map();let nextInterval=1;
  const context={
    console,
    SpeechSynthesisUtterance:function(text){this.text=text;},
    speechSynthesis:{cancel(){},speak(utterance){spoken.push(utterance.text);}},
    Date,
    Math,
    JSON,
    Set,
    document:{getElementById:id=>elements[id]||null,createElement:()=>new Element(),head:new Element(),addEventListener(){},querySelector(selector){return selector==='.preview-timing'?previewTiming:new Element()}},
    localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value))},
    navigator:{},
    getComputedStyle:()=>({getPropertyValue:()=>'#000'}),
    setInterval:callback=>{const id=nextInterval++;intervals.set(id,callback);return id;},
    clearInterval:id=>intervals.delete(id),
    setTimeout:callback=>callback()
  };
  context.window=context;context.globalThis=context;
  vm.createContext(context);
  for (const file of ['data/equipment.js','data/exercises.js','data/workouts.js','js/generator.js','js/timed-cues.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline,context,{filename:'index-inline.js'});
  vm.runInContext(fs.readFileSync(path.join(root,'js/rampup-ui.js'),'utf8'),context,{filename:'js/rampup-ui.js'});

  assert.ok(context.eligibleRoutineIds('cooldown').includes('childs-pose'));
  assert.equal(context.eligibleRoutineIds('cooldown').includes('lean-back-sink'),false);
  assert.ok(context.eligibleRoutineIds('cooldown').includes('glute-stretch'));
  context.toggleEquipmentItem('trx');
  assert.ok(context.eligibleRoutineIds('cooldown').includes('trx-lean-back-sink'));
  assert.equal(context.eligibleRoutineIds('cooldown').includes('childs-pose'),false);
  assert.ok(context.eligibleRoutineIds('cooldown').includes('trx-glute-standing'));
  assert.equal(context.eligibleRoutineIds('cooldown').includes('glute-stretch'),false);
  const cooldownRoutine=context.routineList('cooldown');
  assert.ok(cooldownRoutine.some(item=>item.name==='TRX glute standing - Right'));
  assert.ok(cooldownRoutine.some(item=>item.name==='TRX glute standing - Left'));
  context.toggleEquipmentItem('trx');
  context.showLanding('generator');
  context.toggleEquipmentItem('dumbbells');
  context.toggleEquipmentItem('bench');
  context.selectGeneratorDuration(30);
  context.generateWorkout();
  assert.ok(vm.runInContext('generatorState.workout',context));
  const previewBlockCount=vm.runInContext('generatorState.workout.main.blocks.length',context);
  const previewExerciseCount=vm.runInContext('generatorState.workout.main.blocks.reduce((sum,block)=>sum+block.exercises.length,0)',context);
  assert.equal(elements.previewRounds.textContent,previewBlockCount+' main blocks');
  assert.equal(elements.previewMainTitle.textContent,'Main workout · '+previewBlockCount+' blocks');
  assert.equal(elements.previewList.children.length,previewBlockCount+previewExerciseCount);
  assert.equal(elements.previewList.children.filter(child=>child.className==='preview-block-heading').length,previewBlockCount);
  let previewRow=0;
  for(const [blockIndex,block] of vm.runInContext('generatorState.workout.main.blocks',context).entries()){
    assert.equal(elements.previewList.children[previewRow++].children[0].textContent,'B'+(blockIndex+1));
    block.exercises.forEach((_,index)=>assert.equal(elements.previewList.children[previewRow++].children[0].textContent,String(index+1).padStart(2,'0')));
  }

  context.startGeneratedWorkout();
  assert.equal(vm.runInContext('workoutState.mode',context),'generated');
  assert.ok(vm.runInContext('generatorState.timeline.length',context)>0);
  const blockCount=vm.runInContext('generatorState.workout.main.blocks.length',context);
  assert.ok(blockCount>=2);
  assert.equal(vm.runInContext("generatorState.timeline.filter(phase=>phase.kind==='block-transition').length",context),blockCount-1);
  assert.equal(vm.runInContext("generatorState.timeline.filter(phase=>phase.kind==='transition'&&phase.section==='main').length",context),1);
  assert.ok(vm.runInContext("generatorState.timeline.some(phase=>phase.kind==='exercise'&&phase.section==='rampup')",context));
  const firstSecondBlock=vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.section==='main'&&phase.blockIndex===1)",context);
  context.enterGeneratedPhase(firstSecondBlock);
  context.previousGeneratedPhase();
  assert.equal(vm.runInContext('currentGeneratedPhase().blockIndex',context),0);
  context.toggleWorkoutPause();
  assert.equal(vm.runInContext('workoutState.paused',context),true);
  context.toggleWorkoutPause();
  assert.equal(vm.runInContext('workoutState.paused',context),false);
  const sides=vm.runInContext("generatorState.timeline.filter(phase=>phase.kind==='exercise'&&phase.side).map(phase=>phase.side)",context);
  for (let index=0;index<sides.length;index+=2) assert.equal(sides.slice(index,index+2).join(','),'right,left');

  const timeline=vm.runInContext('generatorState.timeline',context);
  for (const phase of timeline.filter(p=>p.kind==='exercise')) {
    if (phase.exercise.sidedness==='per-side') assert.ok(phase.side,phase.exercise.id);
    else assert.equal(phase.side,null,phase.exercise.id+' ('+phase.exercise.sidedness+')');
  }
  for(let index=1;index<timeline.length;index++) {
    const phase=timeline[index],before=spoken.length;
    context.enterGeneratedPhase(index);
    if(phase.kind==='exercise') {
      assert.equal(spoken.length,before+1);
      assert.ok(spoken.at(-1).includes(phase.exercise.name));
      assert.ok(spoken.at(-1).includes(phase.timed?'seconds':'reps'));
      if(phase.side) assert.ok(spoken.at(-1).includes(phase.side));
    }
  }
  context.previousGeneratedPhase();
  assert.ok(spoken.at(-1).includes(vm.runInContext('currentGeneratedPhase().exercise.name',context)));

  const timedIndex=vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.timed)",context);
  vm.runInContext("generatorState.timeline["+timedIndex+"].exercise.timedCues=[{text:'Test cue',at:{type:'fraction',value:0.5}}]",context);
  context.enterGeneratedPhase(timedIndex);
  let phaseTimer=vm.runInContext('generatorState.phaseTimer',context);
  const phaseSeconds=vm.runInContext('currentGeneratedPhase().seconds',context);
  for(let second=0;second<Math.ceil(phaseSeconds/2);second++) intervals.get(phaseTimer)();
  assert.equal(elements.workoutTimedCue.textContent,'Test cue');
  assert.equal(spoken.at(-1),'Test cue');
  const cueSpeechCount=spoken.filter(text=>text==='Test cue').length;
  context.toggleWorkoutPause();
  intervals.get(phaseTimer)();
  context.toggleWorkoutPause();
  intervals.get(phaseTimer)();
  assert.equal(spoken.filter(text=>text==='Test cue').length,cueSpeechCount);
  context.enterGeneratedPhase(timedIndex+1);
  assert.equal(elements.workoutTimedCue.textContent,'');
  context.enterGeneratedPhase(timedIndex);
  assert.equal(elements.workoutTimedCue.textContent,'');
  phaseTimer=vm.runInContext('generatorState.phaseTimer',context);
  for(let second=0;second<Math.ceil(phaseSeconds/2);second++) intervals.get(phaseTimer)();
  assert.equal(spoken.filter(text=>text==='Test cue').length,cueSpeechCount+1);

  context.startWorkout();
  assert.equal(vm.runInContext('workoutState.mode',context),'fixed');
  context.startSevenMinuteWorkout();
  assert.equal(vm.runInContext('state.key',context),'sevenMinute');
});
