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
  constructor(id='') { this.id=id;this.classList=new ClassList();this.style={};this.children=[];this.attributes={};this.disabled=false;this.textContent='';this.innerHTML=''; }
  setAttribute(key,value) { this.attributes[key]=String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child);return child; }
  querySelector() { return new Element(); }
  addEventListener() {}
  focus() {}
}

test('Generator preview/player and both fixed players initialise without runtime errors', () => {
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const storage=new Map();
  const spoken=[];
  const context={
    console,
    SpeechSynthesisUtterance:function(text){this.text=text;},
    speechSynthesis:{cancel(){},speak(utterance){spoken.push(utterance.text);}},
    Date,
    Math,
    JSON,
    Set,
    document:{getElementById:id=>elements[id]||(elements[id]=new Element(id)),createElement:()=>new Element(),addEventListener(){},querySelector(){return new Element()}},
    localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value))},
    navigator:{},
    getComputedStyle:()=>({getPropertyValue:()=>'#000'}),
    setInterval:()=>1,
    clearInterval:()=>{},
    setTimeout:callback=>callback()
  };
  context.window=context;context.globalThis=context;
  vm.createContext(context);
  for (const file of ['data/equipment.js','data/exercises.js','data/workouts.js','js/generator.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline,context,{filename:'index-inline.js'});

  context.showLanding('generator');
  context.toggleEquipmentItem('dumbbells');
  context.toggleEquipmentItem('bench');
  context.generateWorkout();
  assert.ok(vm.runInContext('generatorState.workout',context));
  assert.ok(elements.previewList.children.length>=3);

  context.startGeneratedWorkout();
  assert.equal(vm.runInContext('workoutState.mode',context),'generated');
  assert.ok(vm.runInContext('generatorState.timeline.length',context)>0);
  const sides=vm.runInContext("generatorState.timeline.filter(phase=>phase.kind==='exercise'&&phase.side).map(phase=>phase.side)",context);
  for (let index=0;index<sides.length;index+=2) assert.equal(sides.slice(index,index+2).join(','),'right,left');

  const timeline=vm.runInContext('generatorState.timeline',context);
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

  context.startWorkout();
  assert.equal(vm.runInContext('workoutState.mode',context),'fixed');
  context.startSevenMinuteWorkout();
  assert.equal(vm.runInContext('state.key',context),'sevenMinute');
});
