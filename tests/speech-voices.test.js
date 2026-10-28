const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {loadAppContext} = require('./helpers/app-context');

const gb={voiceURI:'gb-1',name:'Device British',lang:'en-GB'};
const us={voiceURI:'us-1',name:'Device American',lang:'en-US'};
const fr={voiceURI:'fr-1',name:'Device French',lang:'fr-FR'};
const key='gf_spoken_voice_v1';
function harness({voices=[us,fr,gb],storage=new Map(),configure,ownIntrinsics=false}={}) {
  let inventory=voices, changed, cancellations=0;
  const spoken=[],timers=new Map();let timerId=0;
  const app=loadAppContext(storage,{ownIntrinsics,configure(context){
    context.speechSynthesis={getVoices:()=>inventory,addEventListener(name,fn){assert.equal(name,'voiceschanged');changed=fn;},speak:u=>spoken.push(u),cancel:()=>cancellations++};
    context.setInterval=fn=>{timers.set(++timerId,fn);return timerId;};
    context.clearInterval=id=>timers.delete(id);
    context.setTimeout=()=>{throw new Error('Speech must not add timers');};
    if(configure)configure(context);
  }});
  return {app,storage,spoken,timers,run:code=>vm.runInContext(code,app),el:id=>app.document.getElementById(id),
    inventory(value){inventory=value;changed();},cancelled:()=>cancellations};
}

test('Settings discovers device names, sorts British English first and keeps other locales selectable',()=>{
  const h=harness();h.app.showScreen('spokenCues');
  assert.deepEqual(h.el('spokenVoice').children.map(o=>o.textContent),['System default','Device British (en-GB)','Device American (en-US)','Device French (fr-FR)']);
  assert.equal(h.el('spokenVoice').value,'');
  h.app.speak('Default cue');assert.equal(h.spoken[0].voice,undefined);
  h.app.chooseSpokenVoice('2');h.app.previewSpokenVoice();
  assert.equal(h.spoken.at(-1).voice,fr);
  assert.equal(h.el('bottomNav').classList.contains('hidden'),true);
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/onclick="showScreen\('settings'\)">Settings/);
  assert.match(html,/onclick="showScreen\('spokenCues'\)"><span>Spoken Cues<\/span>/);
  assert.match(html,/<label for="spokenVoice">Voice<select id="spokenVoice" aria-describedby="spokenVoiceHelp spokenVoiceStatus"/);
  assert.match(html,/aria-label="Back to Settings" onclick="appBack\(\)"/);
  assert.match(html,/Instructions stay in English/);
});

test('late voiceschanged and reopening Settings restore the saved voice without erasing an empty inventory',()=>{
  const storage=new Map([[key,JSON.stringify(gb)]]),h=harness({voices:[],storage});
  h.app.showScreen('spokenCues');
  assert.equal(h.el('spokenVoice').value,'unavailable');
  h.app.speak('Fallback');assert.equal(h.spoken.at(-1).voice,undefined);
  assert.equal(storage.get(key),JSON.stringify(gb));
  h.inventory([us,gb]);assert.equal(h.el('spokenVoice').value,'0');
  h.app.speak('Loaded');assert.equal(h.spoken.at(-1).voice,gb);
  h.inventory([]);h.app.showScreen('settings');h.app.showScreen('spokenCues');
  assert.equal(storage.get(key),JSON.stringify(gb));
  h.inventory([{...gb,name:'Renamed by device'}]);
  h.app.speak('Renamed');assert.equal(h.spoken.at(-1).voice.name,'Renamed by device');
  h.inventory([{...gb,voiceURI:'different-voice'}]);
  h.app.speak('Missing');assert.equal(h.spoken.at(-1).voice,undefined);
});

test('choice persists on reload, distinguishes duplicate names, and can return to system default',()=>{
  const first={...gb,name:'Same'},second={...gb,name:'Same',voiceURI:'gb-2'},h=harness({voices:[second,first]});
  h.app.chooseSpokenVoice('1');
  const reloaded=harness({voices:[first,second],storage:h.storage});
  reloaded.app.speak('Reloaded');assert.equal(reloaded.spoken.at(-1).voice,second);
  reloaded.app.chooseSpokenVoice('');reloaded.app.speak('Default');
  assert.equal(reloaded.spoken.at(-1).voice,undefined);
  assert.equal(h.storage.get(key),'null');
  const ambiguous=harness({voices:[first,{...first}],storage:new Map([[key,JSON.stringify(first)]])});
  ambiguous.app.speak('Ambiguous');assert.equal(ambiguous.spoken.at(-1).voice,undefined);
});

test('all parts share one voice and preserve queue order, cancellation, rate and pitch without timers',()=>{
  const h=harness();h.app.chooseSpokenVoice('0');
  h.app.speak(['Squats.','Ten reps.'],['Keep your chest up.','Go.']);
  assert.deepEqual(h.spoken.map(u=>u.text),['Squats.','Ten reps.','Keep your chest up.','Go.']);
  for(const u of h.spoken){assert.equal(u.voice,gb);assert.equal(u.rate,1);assert.equal(u.pitch,1);}
  assert.equal(h.cancelled(),1);assert.equal(h.timers.size,0);
  h.app.cancelSpeech();assert.equal(h.cancelled(),2);
});

test('previews are user-triggered, replace each other, stop on selection/navigation, and cannot interrupt workouts',()=>{
  const h=harness();h.app.showScreen('spokenCues');assert.equal(h.spoken.length,0);
  const before=h.run('JSON.stringify({state,workoutState,generatorState})');
  h.app.previewSpokenVoice();h.app.previewSpokenVoice();
  assert.equal(h.spoken.length,2);assert.equal(h.cancelled(),2);
  assert.equal(h.run('JSON.stringify({state,workoutState,generatorState})'),before);
  h.app.chooseSpokenVoice('0');assert.equal(h.cancelled(),3);
  h.app.previewSpokenVoice();h.app.showScreen('settings');assert.equal(h.cancelled(),5);
  h.app.previewSpokenVoice();assert.equal(h.spoken.length,3);
  h.app.showScreen('spokenCues');h.run('state.running=true');
  h.app.previewSpokenVoice();assert.equal(h.spoken.length,3);
  h.run('state.running=false;workoutState.running=true;workoutState.paused=true');
  h.app.previewSpokenVoice();assert.equal(h.spoken.length,3);
  h.app.showScreen('spokenCues');assert.equal(h.el('previewVoiceBtn').disabled,true);
});

test('selected voice reaches routines, fixed and generated playback, midpoint cues and pause/exit cancellation',()=>{
  const h=harness();h.app.chooseSpokenVoice('0');
  h.app.startPreferredRoutine('warmup');
  const remaining=h.run('state.remaining');
  [...h.timers.values()][0]();assert.equal(h.run('state.remaining'),remaining-1);
  h.app.enterWork();
  h.run("showDueTimedCues(GarageFitTimedCues.createTracker([{text:'Halfway. Change sides.',at:{type:'fraction',value:0.5}}],30),15,'routineTimedCue')");
  assert.equal(h.spoken.at(-1).text,'Halfway. Change sides.');
  h.app.togglePause();assert.equal(h.run('state.paused'),true);
  let cancels=h.cancelled();h.app.goHome();assert.ok(h.cancelled()>cancels);
  h.app.goHome();h.app.startWorkout();
  cancels=h.cancelled();h.app.toggleWorkoutPause();assert.ok(h.cancelled()>cancels);
  const fixedCount=h.spoken.length;
  h.app.goGenerator();h.app.generateWorkout();h.app.startGeneratedWorkout();
  h.run("enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.kind==='exercise'))");
  assert.ok(h.spoken.length>fixedCount);
  for(const u of h.spoken)assert.equal(u.voice,gb);
  cancels=h.cancelled();h.app.goGenerator();assert.ok(h.cancelled()>cancels);
});

test('unavailable APIs, failing discovery, malformed preference and blocked storage never block speech or workouts',()=>{
  for(const configure of [
    c=>{delete c.speechSynthesis;},
    c=>{c.speechSynthesis.getVoices=()=>{throw new Error('unavailable');};},
    c=>{Object.defineProperty(c,'localStorage',{get(){throw new Error('blocked');}});},
    c=>{c.localStorage.getItem=()=>'{bad JSON';},
    c=>{delete c.SpeechSynthesisUtterance;},
    c=>{Object.defineProperty(c,'speechSynthesis',{get(){throw new Error('blocked');}});}
  ]){
    const h=harness({configure});
    assert.doesNotThrow(()=>{h.app.showScreen('spokenCues');h.app.chooseSpokenVoice('0');h.app.previewSpokenVoice();h.app.startPreferredRoutine('cooldown');h.app.enterWork();});
    assert.equal(h.run('state.running'),true);
  }
  const blocked=harness({configure:c=>{Object.defineProperty(c,'localStorage',{get(){throw new Error('blocked');}});}});
  blocked.app.chooseSpokenVoice('0');blocked.app.speak('In memory');assert.equal(blocked.spoken.at(-1).voice,gb);
});

test('every Main protocol and warm-up/cool-down uses the shared selected voice',()=>{
  const {blockFixtures,savedWorkoutV2}=require('./helpers/protocol-fixtures');
  for(const protocol of ['rounds','paired_sets','timed_intervals','emom','ladder','pyramid','complex','density']){
    const h=harness(),catalogue=h.app.GarageFitData.exercises;
    const workout=savedWorkoutV2(catalogue);
    workout.main.blocks=[blockFixtures(catalogue,{emom:true,ladder:true,pyramid:true,complex:true,density:true})[protocol]];
    h.app.chooseSpokenVoice('0');
    h.run('generatorState.workout='+JSON.stringify(workout));
    h.app.startGeneratedWorkout();
    for(const section of ['warmup','main','cooldown']){
      const before=h.spoken.length;
      h.run(`enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.section==='${section}'))`);
      assert.ok(h.spoken.length>before,protocol+'/'+section);
    }
    for(const u of h.spoken)assert.equal(u.voice,gb,protocol);
    h.app.goGenerator();
  }
});

test('opening Settings refreshes inventories even without a voiceschanged event',()=>{
  const h=harness();h.app.chooseSpokenVoice('0');
  const renamed={...gb,name:'New browser name'};
  h.app.speechSynthesis.getVoices=()=>[renamed];
  h.app.showScreen('spokenCues');h.app.previewSpokenVoice();
  assert.equal(h.spoken.at(-1).voice,renamed);
});

test('a real Coach programme delegates speech to the selected-voice player',async()=>{
  const h=harness({ownIntrinsics:true});h.app.chooseSpokenVoice('0');
  h.run(`state.ownedEquipment=['dumbbells','bench'];
    function clickCoach(label,id='coachContent'){
      const visit=node=>node.textContent===label&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);
      return visit(document.getElementById(id)).onclick();
    }`);
  await h.run('coachUI.open()');
  await h.run("clickCoach('4-Week General Strength')");
  await h.run("clickCoach('Start programme')");
  await h.run("clickCoach('View today’s workout')");
  await h.run("clickCoach('Start workout','coachPreviewContent')");
  assert.equal(h.run('isCoachPlayer()'),true);
  h.run("enterGeneratedPhase(generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.section==='main'))");
  assert.ok(h.spoken.length>1);
  for(const u of h.spoken)assert.equal(u.voice,gb);
  h.app.stopCoachPlayer();
});
