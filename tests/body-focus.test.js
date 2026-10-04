const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const G = GarageFitGenerator;
const catalogue = GarageFitData.exercises;
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
const ALL_EQUIPMENT = GarageFitData.equipment.map(item => item.id);
const CONFIGS = [[], ['dumbbells'], ['kettlebell','pullup-bar'], ALL_EQUIPMENT];
const AREAS = ['upper','lower','core'];
const MAJORS = new Set(['squat','hinge','push','pull','lunge','carry']);
const mainOf = workout => workout.main.blocks.flatMap(block => block.exercises);
const withoutId = workout => Object.assign({}, workout, { id:null });

// Bounded deterministic matrix: 4 equipment configs x 2 durations x 3 styles x 4 seeds = 96 workouts.
function matrix(bodyFocus) {
  const workouts = [];
  for (const equipment of CONFIGS) for (const duration of [20,45]) for (const focus of ['strength','balanced','cardio']) for (let seed=1;seed<=4;seed++)
    workouts.push(G.generate({ catalogue, duration, focus, equipment, random:random(seed*53+duration), bodyFocus }));
  return workouts;
}
const generated = {};
const workoutsFor = bodyFocus => generated[bodyFocus] || (generated[bodyFocus] = matrix(bodyFocus));
function share(workouts, area) {
  const exercises = workouts.flatMap(mainOf);
  return exercises.filter(exercise => exercise.bodyFocus===area).length / exercises.length;
}

// ---- Metadata ----

test('every generated Main exercise declares a valid body focus', () => {
  assert.deepEqual([...G.EXERCISE_BODY_FOCUSES], ['upper','lower','core','full-body']);
  for (const exercise of Object.values(catalogue).filter(item => item.generator))
    assert.ok(G.EXERCISE_BODY_FOCUSES.has(exercise.bodyFocus), exercise.id+' has bodyFocus '+exercise.bodyFocus);
  for (const area of G.EXERCISE_BODY_FOCUSES)
    assert.ok(Object.values(catalogue).some(exercise => exercise.generator && exercise.bodyFocus===area), 'no generator exercise is '+area);
  // Every focus area offers several generated exercises from bodyweight alone.
  for (const area of AREAS)
    assert.ok(Object.values(catalogue).filter(exercise => G.generatedPhaseEligible(exercise,'main',[]) && exercise.bodyFocus===area).length >= 2, area);
});

test('body focus is validated and required when authoring generated exercises', () => {
  const copy = JSON.parse(JSON.stringify(catalogue));
  copy['push-up'].bodyFocus = 'arms';
  assert.ok(G.validateCatalogue(copy).includes('push-up: invalid bodyFocus "arms"'));
  const definition = { id:'unplaced', name:'Unplaced', generator:true, main:true, prescription:{ type:'timed', value:30 },
    patterns:['core'], conditioning:false, strength:2, cardio:2, difficulty:'easy' };
  assert.throws(() => GarageFitData.buildExerciseCatalogue([definition]), /unplaced: generated Main exercises must declare bodyFocus/);
  assert.equal(GarageFitData.buildExerciseCatalogue([Object.assign({ bodyFocus:'core' }, definition)]).unplaced.bodyFocus, 'core');
  assert.equal(GarageFitData.buildExerciseCatalogue([{ id:'fixed-only', name:'Fixed only', main:true, prescription:{ type:'timed', value:30 } }])['fixed-only'].bodyFocus, null);
});

// ---- Workout option ----

test('workout body focus defaults to Full Body and rejects unknown values', () => {
  assert.deepEqual(G.WORKOUT_BODY_FOCUSES, ['upper','full-body','lower','core']);
  assert.equal(G.workoutBodyFocus(undefined), 'full-body');
  assert.equal(G.workoutBodyFocus('Lower'), 'lower');
  assert.throws(() => G.workoutBodyFocus('legs'), /Unknown workout body focus/);
  const workout = G.generate({ catalogue, duration:20, focus:'balanced', equipment:[], random:random(3) });
  assert.equal(workout.bodyFocus, 'full-body');
  assert.equal(G.generate({ catalogue, duration:20, focus:'balanced', equipment:[], random:random(3), bodyFocus:'core' }).bodyFocus, 'core');
});

test('Full Body is neutral: no score credit and identical generation to the default', () => {
  for (const exercise of Object.values(catalogue)) assert.equal(G.bodyFocusCredit(exercise,'full-body'), 0, exercise.id);
  for (const equipment of CONFIGS) for (const duration of [10,30]) for (const focus of ['strength','balanced','cardio']) {
    const options = { catalogue, duration, focus, equipment, history:[['push-up','goblet-squat']] };
    const implicit = G.generate(Object.assign({ random:random(duration+focus.length) }, options));
    const explicit = G.generate(Object.assign({ random:random(duration+focus.length), bodyFocus:'full-body' }, options));
    assert.deepEqual(withoutId(explicit), withoutId(implicit), `${equipment.join('+')||'bodyweight'} ${duration} ${focus}`);
  }
});

// ---- Upper / Lower / Core ----

test('each body focus substantially favours its area', () => {
  const neutral = workoutsFor('full-body');
  for (const area of AREAS) {
    const focused = workoutsFor(area);
    assert.ok(focused.every(workout => workout.bodyFocus===area));
    const before = share(neutral,area), after = share(focused,area);
    assert.ok(after >= before + .2, `${area} share ${after.toFixed(2)} vs Full Body ${before.toFixed(2)}`);
    // The focus area is the largest area of its workouts.
    for (const other of G.EXERCISE_BODY_FOCUSES) if (other!==area) assert.ok(after > share(focused,other), `${area} vs ${other}`);
    // Every Main style shows the focus.
    for (const style of ['strength','balanced','cardio']) {
      const subset = workout => workout.focus===style;
      assert.ok(share(focused.filter(subset),area) >= share(neutral.filter(subset),area) + .15, `${area} ${style}`);
    }
  }
});

test('a body focus is a preference, not a filter: other areas stay in the workout', () => {
  for (const area of AREAS) {
    for (const exercise of Object.values(catalogue)) assert.equal(G.bodyFocusCredit(exercise,area)>0, exercise.bodyFocus===area || exercise.bodyFocus==='full-body', exercise.id);
    const focused = workoutsFor(area);
    const others = AREAS.filter(other => other!==area);
    assert.ok(others.reduce((sum,other) => sum+share(focused,other), 0) >= .2, area+' crowds out the other areas');
    // Workouts of 20 minutes or more keep exercises outside the focus area.
    for (const workout of focused) assert.ok(mainOf(workout).some(exercise => others.includes(exercise.bodyFocus)), `${area} ${workout.duration} ${workout.focus}: ${mainOf(workout).map(exercise => exercise.id).join(', ')}`);
  }
});

test('the body focus credit never builds a run of more than two focus-area exercises', () => {
  const upper = catalogue['push-up'], lower = catalogue['air-squat'], full = catalogue['burpees'];
  assert.ok(G.bodyFocusCredit(upper,'upper',[lower,upper]) > 0);
  assert.equal(G.bodyFocusCredit(upper,'upper',[upper,upper]), 0);
  assert.equal(G.bodyFocusCredit(full,'upper',[upper,upper]), 0);
  assert.equal(G.bodyFocusCredit(upper,'upper',[upper],[upper]), 0);
  assert.ok(G.bodyFocusCredit(full,'upper',[upper],[lower]) > 0);
  // In generation (read from the generator's own labelled score components).
  let withheld = 0, credited = 0;
  for (const area of AREAS) for (let seed=1;seed<=6;seed++) G.generate({ catalogue, duration:45, focus:'balanced', equipment:ALL_EQUIPMENT, random:random(seed), bodyFocus:area, trace:event => {
    if (event.type!=='pick' || event.phase!=='main') return;
    for (const { exercise } of event.scored) {
      const parts = event.explain(exercise);
      if (parts['body-focus']) credited++;
      else if (exercise.bodyFocus===area) withheld++;
    }
  } });
  assert.ok(withheld > 0 && credited > 0, `withheld ${withheld}, credited ${credited}`);
  for (const area of AREAS) for (const workout of workoutsFor(area)) {
    let run = 0, longest = 0;
    for (const exercise of mainOf(workout)) { run = exercise.bodyFocus===area ? run+1 : 0; longest = Math.max(longest,run); }
    // Lower work already runs to four in Full Body workouts; the focus never makes it longer.
    assert.ok(longest <= 4, `${area}: ${mainOf(workout).map(exercise => exercise.id).join(', ')}`);
  }
});

test('body focus keeps the variety, fatigue and structure safeguards', () => {
  const adjacentHighImpact = workouts => workouts.reduce((sum,workout) => {
    const exercises = mainOf(workout);
    return sum + exercises.slice(1).filter((exercise,index) => exercise.impact==='high' && exercises[index].impact==='high').length;
  }, 0);
  for (const area of AREAS) {
    for (const workout of workoutsFor(area)) {
      const exercises = mainOf(workout);
      const owned = CONFIGS.find(config => exercises.every(exercise => G.requirementsMet(exercise,config))) || ALL_EQUIPMENT;
      assert.equal(new Set(exercises.map(exercise => exercise.id)).size, exercises.length, 'repeated Main exercise');
      for (let index=1;index<exercises.length;index++)
        assert.equal(G.sharedPatterns(exercises[index-1],exercises[index]).some(pattern => MAJORS.has(pattern)), false, exercises[index-1].id+' > '+exercises[index].id);
      assert.deepEqual(G.validateMain(workout.main,catalogue,owned,G.BUDGETS[workout.duration].main).filter(issue => issue!=='main:duration-out-of-tolerance'), []);
      assert.deepEqual(G.mainVarietyIssues(workout.main.blocks,workout.duration,[]).filter(issue => issue.startsWith('main:family-cap')), []);
      const minutes = workout.estimatedSeconds/60;
      assert.ok(Math.abs(minutes-workout.duration) <= Math.max(3,workout.duration*.18), `${area} ${workout.duration} generated ${minutes.toFixed(1)} minutes`);
      assert.ok(workout.warmup.exercises.length && workout.rampup.exercises.length && workout.cooldown.exercises.length);
    }
    // The adjacent high-impact penalty still applies (the focus credit is withheld there), so such pairs stay rare.
    assert.ok(adjacentHighImpact(workoutsFor(area)) <= Math.max(adjacentHighImpact(workoutsFor('full-body')), workoutsFor(area).length*.02), area);
  }
});

test('body focus combines with difficulty and builds complete bodyweight workouts of every length', () => {
  for (const area of AREAS) for (const duration of [10,15,20,30,45]) for (const difficulty of ['easy','hard']) {
    const workout = G.generate({ catalogue, duration, focus:'balanced', equipment:[], random:random(duration*7+area.length), bodyFocus:area, difficulty });
    assert.equal(workout.bodyFocus, area);
    if (difficulty==='easy') for (const exercise of mainOf(workout)) assert.notEqual(exercise.difficulty, 'hard', exercise.id);
    assert.deepEqual(G.validateMain(workout.main,catalogue,[],G.BUDGETS[duration].main).filter(issue => issue!=='main:duration-out-of-tolerance'), []);
  }
});

// ---- Swaps ----

test('swaps keep the workout body focus', () => {
  for (const area of AREAS) {
    let focused = 0, neutral = 0;
    for (let seed=1;seed<=30;seed++) for (const [bodyFocus,count] of [[area,v => focused+=v],['full-body',v => neutral+=v]]) {
      const workout = G.generate({ catalogue, duration:20, focus:'balanced', equipment:ALL_EQUIPMENT, random:random(seed) });
      workout.bodyFocus = bodyFocus;
      G.swap(workout,0,0,{ catalogue, equipment:ALL_EQUIPMENT, random:random(seed*17) });
      count(workout.main.blocks[0].exercises[0].bodyFocus===area ? 1 : 0);
    }
    assert.ok(focused > neutral, `${area} swaps ${focused} vs Full Body ${neutral}`);
  }
});
