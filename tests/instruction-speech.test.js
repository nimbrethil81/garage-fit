const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context');

function setup(configure = () => {}) {
  const spoken = [], queue = [];
  let cancellations = 0;
  const voice = {voiceURI:'selected',name:'Selected voice',lang:'en-GB'};
  const app = loadAppContext(new Map(), {configure(context) {
    context.speechSynthesis = {
      getVoices:() => [voice],
      cancel() { cancellations++; queue.length = 0; },
      speak(utterance) { spoken.push(utterance); queue.push(utterance); }
    };
    configure(context);
  }});
  return {app, spoken, queue, voice, cancelled:() => cancellations,
    run:code => vm.runInContext(code, app), el:id => app.document.getElementById(id)};
}

for (const [player, id] of [['player','routineInstruction'],['workoutPlayer','workoutInstruction']]) {
  test(`${player}: opening is silent; content narration replays with the selected voice and no state changes`, () => {
    const h = setup();
    h.app.chooseSpokenVoice('0');
    h.app.showScreen(player);
    h.app.setInstructionDisclosure(id, {id:'air-squat'});
    h.app.speakDisplayedInstruction(id);
    assert.equal(h.spoken.length, 0);
    h.el(id).open = true;
    assert.equal(h.spoken.length, 0);
    const before = h.run('JSON.stringify({state,workoutState,generatorState,seen:[...instructionSeen]})');
    for (let i = 1; i <= 2; i++) {
      h.app.speakDisplayedInstruction(id);
      assert.equal(h.spoken.length, i);
      assert.equal(h.cancelled(), i);
      assert.equal(h.queue.length, 1);
      assert.equal(h.queue[0].text, h.app.GarageFitData.exercises['air-squat'].instruction);
      assert.equal(h.queue[0].voice, h.voice);
      assert.equal(h.run('JSON.stringify({state,workoutState,generatorState,seen:[...instructionSeen]})'), before);
    }
    h.app.setInstructionDisclosure(id, {id:'wall-angel'});
    assert.equal(h.queue.length, 0);
    h.app.speakDisplayedInstruction(id); // A queued activation after the phase reset is inert.
    assert.equal(h.spoken.length, 2);
    h.el(id).open = true;
    h.app.speakDisplayedInstruction(id);
    assert.equal(h.queue[0].text, h.app.GarageFitData.exercises['wall-angel'].instruction);
    h.app.showScreen('done');
    assert.equal(h.queue.length, 0);
    h.app.speakDisplayedInstruction(id);
    assert.equal(h.queue.length, 0);
  });

  test(`${player}: automatic cues replace manual speech and retain ownership across disclosure resets`, () => {
    const h = setup();
    h.app.showScreen(player);
    h.app.setInstructionDisclosure(id, {id:'air-squat'});
    h.el(id).open = true;
    h.app.speakDisplayedInstruction(id);
    h.run("showDueTimedCues(GarageFitTimedCues.createTracker([{text:'Change sides.',at:{type:'fraction',value:0.5}}],30),15,'routineTimedCue')");
    assert.deepEqual(h.queue.map(u => u.text), ['Change sides.']);
    const cancellations = h.cancelled();
    h.app.setInstructionDisclosure(id, null);
    assert.equal(h.cancelled(), cancellations);
    assert.deepEqual(h.queue.map(u => u.text), ['Change sides.']);
    h.app.speakDisplayedInstruction(id);
    assert.deepEqual(h.queue.map(u => u.text), ['Change sides.']);
    h.app.speakDisplayedInstruction('densityPartial');
    assert.equal(h.cancelled(), cancellations);
  });
}

test('unsupported speech keeps instructions readable and manual activation inert', () => {
  for (const configure of [
    c => { delete c.speechSynthesis; },
    c => { delete c.SpeechSynthesisUtterance; },
    c => { delete c.speechSynthesis.cancel; },
    c => { Object.defineProperty(c, 'speechSynthesis', {get(){throw new Error('unavailable');}}); }
  ]) {
    const h = setup(configure);
    assert.equal(h.app.instructionSpeechAvailable(), false);
    h.app.showScreen('player');
    h.app.setInstructionDisclosure('routineInstruction', {id:'air-squat'});
    h.el('routineInstruction').open = true;
    assert.ok(h.el('routineInstructionText').textContent);
    assert.doesNotThrow(() => h.app.speakDisplayedInstruction('routineInstruction'));
    assert.equal(h.spoken.length, 0);
  }
});
