const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('fixed workout catalogue loads the reusable detail UI module', () => {
  const workoutsData = fs.readFileSync(path.join(root, 'data/workouts.js'), 'utf8');
  assert.match(workoutsData, /js\/workouts-ui\.js/);
});

test('fixed workout detail model covers all current Workouts-mode entries', () => {
  const source = fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8');
  const context = {
    console,
    document: { readyState:'loading' },
    addEventListener() {},
    FIXED_WORKOUTS: {
      cindy: {
        id:'cindy', name:'Cindy', subtitle:'20 min AMRAP',
        termination:{ type:'amrap', durationSeconds:1200 },
        provenance:'Benchmark provenance',
        exercises:[
          { id:'pull-up', name:'Pull-ups', reps:5 },
          { id:'push-up', name:'Push-ups', reps:10 },
          { id:'air-squat', name:'Air squats', reps:15 }
        ]
      },
      workout300: {
        id:'workout300', name:'300 Workout', termination:{ type:'fixed-rounds', rounds:1 },
        exercises:[{ id:'pull-up', name:'Pull-ups', reps:25 }]
      }
    },
    SEVEN_MINUTE_WORKOUT:[{ name:'Jumping jacks', work:30 }],
    fixedWorkoutExercises(workout) { return workout.exercises; }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename:'js/workouts-ui.js' });

  const ui = context.GarageFitWorkoutUI;
  assert.ok(ui);

  const seven = ui.detailDefinition('sevenMinute');
  assert.equal(seven.name, '7 Minute Workout');
  assert.equal(seven.format, '7 min timed circuit');
  assert.deepEqual(Array.from(seven.exercises, exercise=>exercise.target), ['30 sec']);

  const cindy = ui.detailDefinition('cindy');
  assert.equal(cindy.format, '20 min AMRAP');
  assert.match(cindy.description, /Repeat the sequence/);
  assert.deepEqual(Array.from(cindy.exercises, exercise=>exercise.target), ['5 reps','10 reps','15 reps']);

  const workout300 = ui.detailDefinition('workout300');
  assert.equal(workout300.format, 'For time');
  assert.equal(workout300.personalBest, true);
  assert.equal(workout300.exercises[0].target, '25 reps');
});

test('opening workout detail is separate from starting a workout', () => {
  const source = fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8');
  const openBody = source.match(/function openWorkoutDetail\(workoutId\) \{([\s\S]*?)\n  \}/);
  assert.ok(openBody);
  assert.doesNotMatch(openBody[1], /startSevenMinuteWorkout|startFixedWorkout/);
  assert.match(source, /function startSelectedWorkout\(\)/);
  assert.match(source, /Start workout/);
});
