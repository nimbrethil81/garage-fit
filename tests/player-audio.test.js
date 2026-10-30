const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
function harness(){
  const events={},sounds=[],contexts=[];let resolve,reject;
  const app=loadAppContext(new Map(),{configure(c){
    c.document.addEventListener=(name,cb)=>{(events[name]??=[]).push(cb)};
    c.AudioContext=class {
      constructor(){this.state='suspended';this.currentTime=0;this.destination={};this.resumes=0;contexts.push(this)}
      resume(){this.resumes++;return new Promise((yes,no)=>{resolve=()=>{this.state='running';yes()};reject=no})}
      createOscillator(){const sound={};sounds.push(sound);return {frequency:{set value(v){sound.frequency=v}},connect(){},start(){sound.started=true},stop(t){sound.duration=t},disconnect(){}}}
      createGain(){const sound=sounds.at(-1);return {connect(){},disconnect(){},gain:{setValueAtTime(v){sound.volume=v},exponentialRampToValueAtTime(){}}}}
    };
  }});
  return {app,sounds,contexts,run:s=>vm.runInContext(s,app),event(name,event={isTrusted:true}){for(const cb of events[name]||[])cb(event)},async resume(){resolve();await new Promise(setImmediate)},async deny(){reject(new Error('NotAllowedError'));await new Promise(setImmediate)}};
}
test('trusted gestures unlock Web Audio before timers; tick and completion retain distinct sounds',async()=>{
  const h=harness();h.event('click',{isTrusted:false});assert.equal(h.contexts.length,0);
  h.event('touchend');assert.equal(h.contexts[0].resumes,1);await h.resume();
  h.run('exerciseCountdownTick(GarageFitTimedCues.createCountdown(),3,true);playCompletionChime()');
  assert.deepEqual(h.sounds.map(s=>[s.frequency,s.duration,s.volume]),[[520,.07,.08],[880,.12,.15]]);
});
test('suspended audio does not schedule stale sounds; failed resume can recover on a later gesture',async()=>{
  const h=harness();h.run('beep()');assert.equal(h.sounds.length,0);await h.deny();
  h.event('keydown');assert.equal(h.contexts[0].resumes,2);await h.resume();assert.equal(h.sounds.length,0);
  h.run('beep()');assert.equal(h.sounds.length,1);
  h.contexts[0].state='interrupted';h.app.document.visibilityState='visible';h.event('visibilitychange');
  h.run('beep()');assert.equal(h.sounds.length,1);await h.resume();assert.equal(h.sounds.length,1);
  h.run('beep()');assert.equal(h.sounds.length,2);
});
test('foreground alone does not create audio; closed contexts are replaced by a gesture',async()=>{
  const h=harness();h.app.document.visibilityState='visible';h.event('visibilitychange');assert.equal(h.contexts.length,0);
  h.event('click');await h.resume();h.contexts[0].state='closed';h.event('click');assert.equal(h.contexts.length,2);await h.resume();
});
test('a gesture retries resume even when an earlier browser-blocked request is still pending',async()=>{
  const h=harness();h.run('beep()');h.event('click');
  assert.equal(h.contexts[0].resumes,2);await h.resume();
  assert.equal(h.sounds.length,0);h.run('beep()');assert.equal(h.sounds.length,1);
});
