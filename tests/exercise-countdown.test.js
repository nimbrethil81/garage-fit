const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
require('../js/timed-cues.js');
const {createCountdown,takeCountdownTick}=GarageFitTimedCues;

test('countdown consumes each position once, skips missed seconds and silences inactive phases',()=>{
  const c=createCountdown();
  const tick=(r,active=true,t=0)=>takeCountdownTick(c,r,active,t);
  assert.equal(tick(4),false);
  assert.equal(tick(3,true,1000),true);
  assert.equal(tick(2.9,true,1250),false);
  assert.equal(tick(2,true,2000),true);
  assert.equal(tick(1,false,3000),false);
  assert.equal(tick(1,true,3100),false);
  assert.equal(tick(0,true,4000),false);
  const delayed=createCountdown();
  takeCountdownTick(delayed,5,true,0);
  assert.equal(takeCountdownTick(delayed,1,true,4000),false);
  assert.equal(takeCountdownTick(delayed,1,true,4250),false);
  assert.equal(takeCountdownTick(createCountdown(),2,true,0),true);
});

function harness(){
  let now=0,id=0;const timers=new Map(),ticks=[];
  const app=loadAppContext(new Map(),{configure(c){
    c.wallNow=()=>now;c.setInterval=cb=>{timers.set(++id,cb);return id};
    c.clearInterval=i=>timers.delete(i);
  }});
  const run=code=>vm.runInContext(code,app);
  run('Date.now=wallNow;renderGeneratedCountdown=()=>{}');app.beep=(...args)=>{if(args[0]===520)ticks.push(args)};
  return {app,run,ticks,pulse(ms=1000){now+=ms;for(const cb of [...timers.values()])cb()},callback(){return [...timers.values()].at(-1)}};
}

test('routine exercise ticks, pause and stale navigation callbacks; ready and rest stay silent',()=>{
  const h=harness();
  h.run("state.running=true;state.phase='work';state.list=[{name:'Hold',work:5},{name:'Next',work:5}];state.remaining=5;runTimer(5,()=>{})");
  h.pulse();h.pulse();assert.equal(h.ticks.length,1);
  const stale=h.callback();
  h.run('state.paused=true');h.pulse();assert.equal(h.ticks.length,1);
  h.run('state.paused=false');h.pulse();h.pulse();assert.equal(h.ticks.length,3);
  h.run("state.phase='rest';state.remaining=3;runTimer(3,()=>{})");
  stale();h.pulse();h.pulse();assert.equal(h.ticks.length,3);
  h.run("state.phase='ready';state.remaining=3;runTimer(3,()=>{})");
  h.pulse();assert.equal(h.ticks.length,3);
});

test('generated countdown gates semantic type, deduplicates 250ms updates and rejects stale callbacks',()=>{
  const h=harness();
  h.run("workoutState.mode='generated';workoutState.running=true;generatorState.timeline=[{kind:'exercise',timed:true,seconds:5,exercise:{name:'Hold'}}];generatorState.timelineIndex=0;startGeneratedCountdown(5)");
  h.pulse(2000); // delayed observation is suppressed
  assert.equal(h.ticks.length,0);
  h.pulse(250);h.pulse(750);assert.equal(h.ticks.length,1);
  const stale=h.callback();
  h.run("generatorState.timeline=[{kind:'rest',seconds:3}];startGeneratedCountdown(3)");
  stale();h.pulse();h.pulse();assert.equal(h.ticks.length,1);
  h.run("generatorState.timeline=[{kind:'exercise',timed:false,seconds:3,exercise:{}}];startGeneratedCountdown(3)");
  h.pulse();assert.equal(h.ticks.length,1);
});
