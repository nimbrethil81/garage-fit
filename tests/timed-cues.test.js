const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../js/timed-cues.js');
require('../data/exercises.js');
require('../js/generator.js');

const { cueOffsetSeconds, createTracker, takeDueCues } = GarageFitTimedCues;
const bodyHoops = GarageFitData.exercises['body-hoops'];

test('an exercise with no timed cues retains cue-free countdown behaviour', () => {
  const tracker = createTracker([], 30);
  assert.deepEqual(takeDueCues(tracker, 15), []);
  assert.deepEqual(takeDueCues(tracker, 30), []);
});

test('Body hoops declares a generic midpoint cue', () => {
  assert.deepEqual(bodyHoops.timedCues, [
    { text: 'Change direction', at: { type: 'fraction', value: 0.5 } }
  ]);
  assert.deepEqual(GarageFitGenerator.validateCatalogue(GarageFitData.exercises), []);
});

test('a 30-second interval fires its midpoint cue at 15 seconds', () => {
  const tracker = createTracker(bodyHoops.timedCues, 30);
  assert.deepEqual(takeDueCues(tracker, 14), []);
  assert.equal(takeDueCues(tracker, 15)[0].text, 'Change direction');
});

test('relative cue timing follows a different assigned duration', () => {
  assert.equal(cueOffsetSeconds(bodyHoops.timedCues[0], 40), 20);
  const tracker = createTracker(bodyHoops.timedCues, 40);
  assert.deepEqual(takeDueCues(tracker, 19), []);
  assert.equal(takeDueCues(tracker, 20).length, 1);
});

test('a due cue fires once only across later ticks and pause-style repeated elapsed values', () => {
  const tracker = createTracker(bodyHoops.timedCues, 30);
  assert.equal(takeDueCues(tracker, 15).length, 1);
  assert.deepEqual(takeDueCues(tracker, 15), []);
  assert.deepEqual(takeDueCues(tracker, 16), []);
});

test('the model also supports multiple cues and fixed elapsed-second offsets', () => {
  const tracker = createTracker([
    { text: 'First', at: { type: 'seconds', value: 5 } },
    { text: 'Second', at: { type: 'fraction', value: 0.75 } }
  ], 20);
  assert.deepEqual(takeDueCues(tracker, 4), []);
  assert.deepEqual(takeDueCues(tracker, 5).map(cue => cue.text), ['First']);
  assert.deepEqual(takeDueCues(tracker, 15).map(cue => cue.text), ['Second']);
});

test('a newly entered exercise gets fresh cue state without carrying stale firing state', () => {
  const firstVisit = createTracker(bodyHoops.timedCues, 30);
  takeDueCues(firstVisit, 15);
  const revisited = createTracker(bodyHoops.timedCues, 30);
  assert.equal(takeDueCues(revisited, 15).length, 1);
});
