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
test('WebKit playback session is selected before context creation; unsupported or denied session is non-fatal',async()=>{
  for(const denied of [false,true]){
    const order=[];
    const app=loadAppContext(new Map(),{configure(c){
      c.navigator.audioSession={get type(){return 'auto'},set type(value){order.push(value);if(denied)throw new TypeError('blocked')}};
      c.AudioContext=class {constructor(){order.push('context');this.state='running';this.currentTime=0;this.destination={}}createOscillator(){return {frequency:{},connect(){},start(){},stop(){}}}createGain(){return {connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}}}}};
    }});
    app.beep();assert.deepEqual(order,['playback','context']);
    const evidence=app.playerAudioDiagnostics();
    assert.ok(evidence.some(e=>e.event===(denied?'session-failed':'session-playback')));
    assert.equal(evidence.at(-1).event,'chime-scheduled');
  }
});
test('diagnostics distinguish skipped, failed and scheduled audio without retaining sensitive data',async()=>{
  const h=harness();h.run('beep()');await h.deny();
  assert.ok(h.app.playerAudioDiagnostics().some(e=>e.event==='sound-skipped'));
  assert.ok(h.app.playerAudioDiagnostics().some(e=>e.event==='resume-failed'));
  h.event('click');await h.resume();
  h.contexts[0].createOscillator=()=>{throw new TypeError('private detail')};h.run('beep()');
  assert.equal(h.app.playerAudioDiagnostics().at(-1).event,'sound-failed');
  assert.equal(h.app.playerAudioDiagnostics().at(-1).error,'TypeError');
  for(let i=0;i<50;i++)h.run('beep()');
  assert.equal(h.app.playerAudioDiagnostics().length,40);
  const copy=h.app.playerAudioDiagnostics();copy[0].event='changed';
  assert.notEqual(h.app.playerAudioDiagnostics()[0].event,'changed');
  assert.ok(!JSON.stringify(copy).includes('private detail'));
});

test('audio history correlates two anonymous exercise phases with skipped then scheduled countdowns',async()=>{
  const h=harness();
  h.run(`workoutState.mode='generated';workoutState.running=true;
    generatorState.timeline=[{kind:'exercise',timed:true,protocol:'ordinary'},{kind:'exercise',timed:true,protocol:'ordinary'}];generatorState.timelineIndex=0;
    var firstCountdown=GarageFitTimedCues.createCountdown();exerciseCountdownTick(firstCountdown,3,true);exerciseCountdownTick(firstCountdown,2,true);exerciseCountdownTick(firstCountdown,1,true);`);
  assert.deepEqual(Array.from(h.app.playerAudioDiagnostics().filter(e=>e.event==='sound-skipped'),e=>e.position),[3,2,1]);
  await h.resume();
  h.run(`generatorState.timelineIndex=1;var secondCountdown=GarageFitTimedCues.createCountdown();exerciseCountdownTick(secondCountdown,3,true);exerciseCountdownTick(secondCountdown,2,true);exerciseCountdownTick(secondCountdown,1,true);`);
  const events=h.app.playerAudioDiagnostics(),eligible=events.filter(e=>e.event==='tick-eligible'),scheduled=events.filter(e=>e.event==='tick-scheduled');
  assert.deepEqual(Array.from(eligible,e=>e.position),[3,2,1,3,2,1]);
  assert.deepEqual(Array.from(scheduled,e=>e.position),[3,2,1]);
  assert.notEqual(eligible[0].phase,eligible[3].phase);
  h.run(`workoutState={mode:'generated',running:true,paused:false};generatorState.timeline=[{kind:'exercise',timed:true,protocol:'ordinary'}];generatorState.timelineIndex=0;var nextRunCountdown=GarageFitTimedCues.createCountdown();exerciseCountdownTick(nextRunCountdown,3,true);`);
  assert.equal(h.app.playerAudioDiagnostics().filter(e=>e.event==='tick-eligible').at(-1).phase,1);
  assert.ok(events.every(e=>!('exerciseId'in e)&&!('name'in e)));
  assert.match(h.app.playerAudioReport(),/Device audibility: unknown — scheduled does not mean heard/);
  assert.match(h.app.playerAudioReport(),/Audio clock: event-time samples only/);
});

test('countdown history marks intentional and stale suppression and bounds report output',()=>{
  const h=harness();
  h.run(`workoutState.mode='generated';workoutState.running=true;generatorState.timelineIndex=0;generatorState.timeline=[{kind:'exercise',timed:true,protocol:'ordinary'}];for(let i=0;i<60;i++)recordPlayerAudio('statechange');
    generatorState.timeline[0]={kind:'rest',protocol:'ordinary'};
    var restCountdown=GarageFitTimedCues.createCountdown();exerciseCountdownTick(restCountdown,3,false);
    generatorState.timeline[0]={kind:'exercise',timed:true,protocol:'ordinary'};var staleCountdown=GarageFitTimedCues.createCountdown();
    staleCountdown.observedAt=Date.now()-2000;exerciseCountdownTick(staleCountdown,3,true);
    generatorState.timeline[0]={kind:'exercise',timed:false,protocol:'density'};var capCountdown=GarageFitTimedCues.createCountdown();exerciseCountdownTick(capCountdown,3,false);
    `);
  const events=h.app.playerAudioDiagnostics(),report=h.app.playerAudioReport();
  assert.ok(events.some(e=>e.event==='tick-suppressed'&&e.category==='rest'&&e.outcome==='ineligible'));
  assert.ok(events.some(e=>e.event==='tick-suppressed'&&e.outcome==='stale-position'));
  assert.ok(events.some(e=>e.event==='tick-suppressed'&&e.category==='protocol-cap'&&e.outcome==='ineligible'));
  assert.equal(events.length,40);
  assert.match(report,/History discarded by 40-event buffer: yes/);
  assert.match(report,/Formatted history truncated to fit 8 KB Audio-section limit: no/);
  assert.ok(Buffer.byteLength(report,'utf8')<=8192);
  assert.doesNotMatch(report,/exerciseId|workoutId|private detail/);
});

test('formatted audio history truncates to 8 KB independently of the event ring',()=>{
  const h=harness();
  h.run(`playerAudioEvents.push({event:'x'.repeat(9000),state:'running',visibility:'visible',elapsedMs:1,phase:1,category:'timed-exercise',error:null});`);
  const report=h.app.playerAudioReport();
  assert.match(report,/History discarded by 40-event buffer: no/);
  assert.match(report,/Formatted history truncated to fit 8 KB Audio-section limit: yes/);
  assert.ok(Buffer.byteLength(report,'utf8')<=8192);
});
