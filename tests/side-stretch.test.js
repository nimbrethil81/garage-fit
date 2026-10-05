const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAppContext } = require('./helpers/app-context.js');

test('Side stretch works both sides in one unchanged total interval', () => {
  const app = loadAppContext();
  const stretch = app.GarageFitData.exercises['side-stretch'];
  assert.equal(stretch.sidedness, 'alternating');
  assert.equal(stretch.unilateral, false);
  assert.equal(stretch.prescription.type, 'timed');
  assert.equal(stretch.prescription.value, 15);
  assert.equal(stretch.estimatedSeconds, 15);
  assert.equal(app.formatPrescription(stretch), '15 sec');
  assert.match(stretch.instruction, /other side/);
  assert.deepEqual(JSON.parse(JSON.stringify(stretch.timedCues)), [
    { text:'Change sides', at:{ type:'fraction', value:0.5 } }
  ]);
  const routine = app.routineList('cooldown', 'bodyweight');
  const entries = routine.filter(exercise => exercise.id === stretch.id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'Side stretch');
  assert.equal(entries[0].work, 15);
  const phases = app.makeGeneratedExercisePhases(stretch, 'cooldown', null, 0);
  assert.equal(phases.length, 1);
  assert.equal(phases[0].side, null);
  assert.equal(phases[0].seconds, 15);
  assert.equal(app.GarageFitGenerator.validateCatalogue(app.GarageFitData.exercises).length, 0);
});

for (const player of ['routine', 'generated']) {
  test(`${player} cool-down cues Change sides once at the midpoint and keeps other stretches cue-free`, () => {
    const app = loadAppContext();
    const spoken = [];
    let tick;
    app.setInterval = callback => { tick = callback; return 1; };
    app.speechSynthesis.speak = utterance => spoken.push(utterance.text);
    const cueElement = app.document.getElementById(player === 'routine' ? 'routineTimedCue' : 'workoutTimedCue');
    const duration = player === 'routine' ? 15 : 30;
    if (player === 'routine') {
      app.startRoutine('cooldown', 'bodyweight');
      vm.runInContext("state.idx=state.list.findIndex(ex=>ex.id==='side-stretch')", app);
      app.enterWork();
    } else {
      app.generateWorkout();
      vm.runInContext(`
        generatorState.workout.cooldown.exercises=[
          GarageFitGenerator.phaseExercise(CATALOGUE['side-stretch'],'cooldown',${duration}),
          CATALOGUE['toe-touch']
        ];
        generatorState.timeline=buildGeneratedTimeline(generatorState.workout);
        workoutState.paused=false;
      `, app);
      const index = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.exercise.id==='side-stretch')", app);
      app.enterGeneratedPhase(index);
    }
    assert.equal(cueElement.textContent, '');
    for (let elapsed = 1; elapsed < Math.ceil(duration / 2); elapsed++) tick();
    assert.equal(cueElement.textContent, '');
    const pause = player === 'routine' ? 'state.paused' : 'workoutState.paused';
    vm.runInContext(`${pause}=true`, app);
    tick();
    assert.equal(cueElement.textContent, '');
    vm.runInContext(`${pause}=false`, app);
    tick();
    assert.equal(cueElement.textContent, 'Change sides');
    tick();
    assert.equal(spoken.filter(text => text === 'Change sides').length, 1);

    if (player === 'routine') {
      vm.runInContext("state.idx=state.list.findIndex(ex=>ex.id==='toe-touch')", app);
      app.enterWork();
      assert.equal(vm.runInContext('state.remaining', app), 15);
    } else {
      const index = vm.runInContext("generatorState.timeline.findIndex(phase=>phase.kind==='exercise'&&phase.exercise.id==='toe-touch')", app);
      app.enterGeneratedPhase(index);
      assert.equal(vm.runInContext('generatorState.remaining', app), 15);
    }
    assert.equal(cueElement.textContent, '');
    for (let elapsed = 1; elapsed <= 14; elapsed++) tick();
    assert.equal(cueElement.textContent, '');
    assert.equal(spoken.filter(text => text === 'Change sides').length, 1);
  });
}
