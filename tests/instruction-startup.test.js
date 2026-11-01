const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');

function harness(unsupported=false){
  let release,fail;const spoken=[],events={},surfaces=[];
  const ready=new Promise((yes,no)=>{release=yes;fail=no});
  const app=loadAppContext(new Map(),{configure(c){
    c.speechSynthesis={cancel(){},speak(u){spoken.push(u.text)},getVoices(){return []}};
    if(unsupported)delete c.SpeechSynthesisUtterance;
    c.addEventListener=(name,cb)=>(events[name]??=[]).push(cb);
    c.Event=class {constructor(type){this.type=type}};
    c.dispatchEvent=e=>(events[e.type]||[]).forEach(cb=>cb(e));
  },beforeInline(c){
    // Control the asynchronous lease/recovery boundary; run the deployed inline
    // startup branch, including inert app, recovery and deferred initialisation.
    c.GarageFitBackupBrowser={create:()=>({storage:c.localStorage,start:()=>ready,status:()=>({canLeave:true})})};
    c.GarageFitBackup={create:()=>({})};
    c.GarageFitBackupUI={mount:()=>({showRecovery(){},canLeave:()=>true})};
  }});
  const doc=app.document;
  function node(){
    const n=doc.createElement('div'),listeners={};
    n.prepend=child=>n.children.unshift(child);
    n.addEventListener=(type,cb)=>(listeners[type]??=[]).push(cb);
    n.fire=(type,event={})=>(listeners[type]||[]).forEach(cb=>cb(event));
    n.contains=child=>n.children.includes(child);
    return n;
  }
  const players=['routineInstruction','workoutInstruction'].map(id=>{
    const details=doc.getElementById(id);details.id=id;
    const summary=node();summary.textContent='How to do it';
    details.children=[summary,doc.getElementById(id+'Text'),doc.getElementById(id+'Image')];
    details.querySelector=()=>summary;details.addEventListener=()=>{};
    const stage=node();stage.querySelectorAll=()=>[details];
    const player=node();player.querySelector=()=>stage;player.querySelectorAll=()=>[];
    return player;
  });
  doc.querySelectorAll=()=>players;
  const create=doc.createElement;
  doc.createElement=()=>{const n=create();const listeners={};
    n.prepend=child=>n.children.unshift(child);
    n.addEventListener=(type,cb)=>(listeners[type]??=[]).push(cb);
    n.fire=(type,event={})=>(listeners[type]||[]).forEach(cb=>cb(event));
    if(n.style)n.style.setProperty=()=>{};
    surfaces.push(n);return n;
  };
  doc.getElementById('app').style.setProperty=()=>{};
  app.ResizeObserver=app.MutationObserver=class {observe(){} disconnect(){}};
  vm.runInContext(fs.readFileSync('js/player-layout.js','utf8'),app);
  return {app,spoken,release,fail,contents:()=>surfaces.filter(n=>n.className==='player-detail-content')};
}
for(const unsupported of [false,true])test(`real layout binding survives deferred protected startup (unsupported=${unsupported})`,async()=>{
  const h=harness(unsupported);
  assert.equal(vm.runInContext('speechVoices',h.app),null);
  assert.equal(h.app.document.getElementById('app').inert,true);
  for(const content of h.contents())assert.equal(content.getAttribute('role'),null);
  h.release();await new Promise(setImmediate);
  assert.equal(h.app.garageFitAppReady,true);
  for(const [i,id] of ['routineInstruction','workoutInstruction'].entries()){
    const content=h.contents()[i];
    assert.equal(content.getAttribute('role'),unsupported?null:'button');
    assert.equal(content.children.filter(n=>n.className==='player-instruction-speaker').length,unsupported?0:1);
    h.app.showScreen(i?'workoutPlayer':'player');h.app.setInstructionDisclosure(id,{id:'air-squat'});
    h.app.document.getElementById(id).open=true;
    const before=h.spoken.length;assert.equal(h.spoken.length,before);
    content.fire('click');assert.equal(h.spoken.length,before+(unsupported?0:1));
    for(const key of ['Enter',' '])content.fire('keydown',{key,preventDefault(){}});
    assert.equal(h.spoken.length,before+(unsupported?0:3));
    h.app.dispatchEvent(new h.app.Event('garagefit-ready'));
    assert.equal(content.children.filter(n=>n.className==='player-instruction-speaker').length,unsupported?0:1);
  }
});
test('failed protected startup leaves readable instruction content without false speech affordance',async()=>{
  const h=harness();h.fail(new Error('recovery blocked'));await new Promise(setImmediate);
  assert.equal(h.app.garageFitAppReady,false);
  for(const content of h.contents()){
    assert.equal(content.getAttribute('role'),null);
    assert.ok(content.children.length>=2);
    assert.doesNotThrow(()=>content.fire('click'));
  }
  assert.equal(h.spoken.length,0);
});
