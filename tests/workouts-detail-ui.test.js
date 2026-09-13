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
      abBlast: {
        id:'abBlast', name:'5-Minute Ab Blast', subtitle:'5 min continuous',
        termination:{ type:'timed-sequence', durationSeconds:300 },
        exercises:[
          { id:'sit-up', name:'Sit-ups', durationSeconds:40 },
          { id:'side-plank', name:'Side plank - Left', durationSeconds:30 },
          { id:'side-plank', name:'Side plank - Right', durationSeconds:30 },
          { id:'reverse-crunch', name:'Reverse crunch', durationSeconds:40 },
          { id:'plank', name:'Front plank', durationSeconds:40 },
          { id:'dead-bug', name:'Dead bug', durationSeconds:40 },
          { id:'bicycle-crunch', name:'Bicycle crunch', durationSeconds:40 },
          { id:'flutter-kicks', name:'Flutter kicks', durationSeconds:40 }
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

  const abBlast = ui.detailDefinition('abBlast');
  assert.equal(abBlast.name, '5-Minute Ab Blast');
  assert.equal(abBlast.format, '5 min continuous');
  assert.match(abBlast.description, /continuous clock/i);
  assert.deepEqual(Array.from(abBlast.exercises, exercise=>exercise.target), ['40 sec','30 sec','30 sec','40 sec','40 sec','40 sec','40 sec','40 sec']);
  assert.equal(abBlast.exercises.reduce((total, exercise)=>total+Number.parseInt(exercise.target,10),0), 300);

  const workout300 = ui.detailDefinition('workout300');
  assert.equal(workout300.format, 'For time');
  assert.equal(workout300.personalBest, true);
  assert.equal(workout300.exercises[0].target, '25 reps');
});

test('opening workout detail is separate from starting a workout', () => {
  const source = fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8');
  const openBody = source.match(/function openWorkoutDetail\(workoutId\)\{([\s\S]*?)\n\n  function timedSequenceList/);
  assert.ok(openBody);
  assert.doesNotMatch(openBody[1], /startSevenMinuteWorkout|startFixedWorkout|startTimedSequenceWorkout/);
  assert.match(source, /function startSelectedWorkout\(\)/);
  assert.match(source, /Start workout/);
});

test('Ab Blast uses reusable continuous timed-sequence playback', () => {
  const workoutsData = fs.readFileSync(path.join(root, 'data/workouts.js'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'js/workouts-ui.js'), 'utf8');
  assert.match(workoutsData, /type:'timed-sequence'/);
  assert.match(source, /function startTimedSequenceWorkout\(workoutId\)/);
  assert.match(source, /function advanceTimedSequence\(\)/);
  assert.doesNotMatch(source, /setTimeout\([^\n]*transition/i);
});
