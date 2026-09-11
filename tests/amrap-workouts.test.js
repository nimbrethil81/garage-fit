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

class Element {
  constructor(id='') { this.id=id;this.classList=new ClassList();this.style={};this.children=[];this.attributes={};this.disabled=false;this.textContent='';this.innerHTML='';this.value=''; }
  setAttribute(key,value) { this.attributes[key]=String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child);return child; }
  querySelector() { return new Element(); }
  addEventListener() {}
  focus() {}
}

function loadApp() {
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  for(const id of ['partialRepsDialog','doneStats','generatedDoneStats','amrapDoneStats']) elements[id].classList.add('hidden');
  const storage=new Map();
  const intervals=new Map();let nextInterval=1;
  const context={
    console,Date,Math,JSON,Set,
    SpeechSynthesisUtterance:function(text){this.text=text;},
    speechSynthesis:{cancel(){},speak(){}},
    document:{getElementById:id=>elements[id]||(elements[id]=new Element(id)),createElement:()=>new Element(),addEventListener(){},querySelector(){return new Element()}},
    localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value))},
    navigator:{},getComputedStyle:()=>({getPropertyValue:()=>'#000'}),
    setInterval:callback=>{const id=nextInterval++;intervals.set(id,callback);return id;},
    clearInterval:id=>intervals.delete(id),setTimeout:callback=>callback()
  };
  context.window=context;context.globalThis=context;
  vm.createContext(context);
  for (const file of ['data/equipment.js','data/exercises.js','data/workouts.js','js/generator.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline,context,{filename:'index-inline.js'});
  return {context,elements,storage,html};
}

test('Cindy is a canonical-catalogue 20-minute AMRAP with the established sequence',()=>{
  const {context,html}=loadApp(),cindy=context.GarageFitData.fixedWorkouts.cindy,catalogue=context.GarageFitData.exercises;
  assert.match(html,/>Cindy</);
  assert.equal(cindy.subtitle,'20 min AMRAP');
  assert.deepEqual(JSON.parse(JSON.stringify(cindy.termination)),{type:'amrap',durationSeconds:1200});
  assert.deepEqual(JSON.parse(JSON.stringify(cindy.exercises.map(({id,reps})=>({id,reps})))),[
    {id:'pull-up',reps:5},{id:'push-up',reps:10},{id:'air-squat',reps:15}
  ]);
  for(const exercise of cindy.exercises) assert.ok(catalogue[exercise.id],exercise.id);
});

test('Cindy loops after Air squats, increments its round, and keeps one continuous clock',()=>{
  const {context,elements}=loadApp();
  context.startFixedWorkout('cindy');
  const startedAt=vm.runInContext('workoutState.startedAt',context);
  assert.equal(elements.workoutElapsed.textContent,'20:00');
  assert.equal(elements.workoutExercise.textContent,'Pull-ups');
  assert.equal(elements.workoutTarget.textContent,'5 reps');
  context.completeWorkoutMovement();
  assert.equal(elements.workoutExercise.textContent,'Push-ups');
  context.completeWorkoutMovement();
  assert.equal(elements.workoutExercise.textContent,'Air squats');
  context.completeWorkoutMovement();
  assert.equal(elements.workoutExercise.textContent,'Pull-ups');
  assert.equal(vm.runInContext('workoutState.round',context),2);
  assert.equal(vm.runInContext('workoutState.completedRounds',context),1);
  context.previousWorkoutMovement();
  assert.equal(elements.workoutExercise.textContent,'Air squats');
  assert.equal(vm.runInContext('workoutState.round',context),1);
  assert.equal(vm.runInContext('workoutState.completedRounds',context),0);
  assert.equal(vm.runInContext('workoutState.additionalReps',context),15);
  context.completeWorkoutMovement();
  assert.equal(vm.runInContext('workoutState.round',context),2);
  assert.equal(vm.runInContext('workoutState.startedAt',context),startedAt);
  assert.equal(vm.runInContext('workoutState.elapsedMs',context),0);
});

test('pausing and resuming an AMRAP preserves rather than resets its overall countdown',()=>{
  const {context,elements}=loadApp();
  context.startFixedWorkout('cindy');
  vm.runInContext('workoutState.elapsedMs=45000;workoutState.startedAt=Date.now()',context);
  context.pauseWorkoutClock();
  const pausedElapsed=vm.runInContext('workoutState.elapsedMs',context);
  assert.ok(pausedElapsed>=45000&&pausedElapsed<46000,pausedElapsed);
  assert.equal(elements.workoutElapsed.textContent,'19:15');
  context.resumeWorkoutClock();
  assert.ok(vm.runInContext('workoutState.elapsedMs',context)>=45000);
  assert.equal(elements.workoutElapsed.textContent,'19:15');
});

test('AMRAP expiry stops progression and accepts bounded partial reps for a structured score',()=>{
  const {context,elements,storage}=loadApp();
  context.startFixedWorkout('cindy');
  context.completeWorkoutMovement();
  vm.runInContext('workoutState.completedRounds=6;workoutState.additionalReps=5;workoutState.elapsedMs=1200*1000;workoutState.startedAt=Date.now()',context);
  context.renderWorkoutElapsed();
  assert.equal(vm.runInContext('workoutState.running',context),false);
  assert.equal(vm.runInContext('workoutState.idx',context),1);
  assert.equal(elements.completeMovementBtn.disabled,true);
  assert.equal(elements.partialRepsDialog.classList.contains('hidden'),false);
  assert.equal(elements.partialRepsInput.max,'10');
  elements.partialRepsInput.value='7';
  context.submitPartialReps({preventDefault(){}});
  assert.equal(elements.amrapDoneScore.textContent,'6 rounds + 12 reps');
  const result=vm.runInContext('workoutState.result',context);
  assert.equal(result.workoutId,'cindy');
  assert.equal(result.terminationType,'amrap');
  assert.equal(result.durationSeconds,1200);
  assert.equal(result.completedRounds,6);
  assert.equal(result.additionalReps,12);
  assert.equal(result.partialReps,7);
  assert.deepEqual(JSON.parse(storage.get('gf_amrap_results'))[0],JSON.parse(JSON.stringify(result)));
});

test('expiry exactly between exercises can finish without partial-rep entry',()=>{
  const {context,elements}=loadApp();
  context.startFixedWorkout('cindy');
  vm.runInContext('workoutState.completedRounds=3;workoutState.additionalReps=15',context);
  context.expireAmrap(false);
  assert.equal(elements.partialRepsDialog.classList.contains('hidden'),true);
  assert.equal(elements.amrapDoneScore.textContent,'3 rounds + 15 reps');
});

test('fixed-round and Generator models retain their existing termination behaviour',()=>{
  const {context}=loadApp(),fixed=context.GarageFitData.fixedWorkouts.workout300;
  assert.deepEqual(JSON.parse(JSON.stringify(fixed.termination)),{type:'fixed-rounds',rounds:1});
  context.startWorkout();
  assert.equal(vm.runInContext('workoutState.workout.id',context),'workout300');
  context.showLanding('generator');context.generateWorkout();context.startGeneratedWorkout();
  assert.equal(vm.runInContext('workoutState.mode',context),'generated');
  assert.ok(vm.runInContext('generatorState.timeline.length',context)>0);
});
