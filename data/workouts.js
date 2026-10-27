(function (root) {
  'use strict';
  var KEY = 'gf_post_run_recent_v1';
  // Deliberately curated: cooldown eligibility alone permits plank-based flows.
  var POOLS = [
    ['standing-calf-stretch', 'bent-knee-calf-stretch'],
    ['standing-quads'], ['hip-flexor-arm-stretch'],
    ['kneeling-hamstring', 'supine-hamstring-stretch'], ['glute-stretch']
  ];
  function readRecent(storage) {
    try {
      var ids = JSON.parse(storage.getItem(KEY));
      return Array.isArray(ids) ? ids.filter(function(id){return typeof id === 'string';}) : [];
    } catch (_) { return []; }
  }
  function recordStarted(storage, plan) {
    try { storage.setItem(KEY, JSON.stringify(Array.from(new Set(plan.exercises.map(function(ex){return ex.id;}))))); }
    catch (_) { /* Storage is optional. */ }
  }
  function generate(options) {
    options = options || {};
    var catalogue = options.catalogue || root.GarageFitData.exercises;
    var recent = options.recent || [], random = options.random || Math.random;
    var selected = POOLS.map(function(ids) {
      var eligible = ids.map(function(id){return catalogue[id];}).filter(function(ex){
        return ex && ex.cooldown && !ex.equipment.length && ex.sidedness === 'per-side';
      });
      var fresh = eligible.filter(function(ex){return !recent.includes(ex.id);});
      var pool = fresh.length ? fresh : eligible;
      if (!pool.length) throw new Error('Post Run Stretch is unavailable: essential stretches are missing.');
      return pool[Math.min(pool.length-1, Math.floor(random()*pool.length))];
    });
    var steps = [];
    selected.forEach(function(ex, index){
      ['right','left'].forEach(function(side){
        steps.push({id:ex.id, name:ex.name+' - '+(side==='right'?'Right':'Left'), side:side,
          durationSeconds:index===0?35:30, transitionAfter:5});
      });
    });
    // One descent to the floor, with extra time to settle; no transition after finish.
    steps[5].transitionAfter = 10;
    steps[9].transitionAfter = 0;
    return {id:'postRunReset', name:'Post Run Stretch', subtitle:'6 min gentle stretching',
      description:'Gentle holds for calves, quadriceps, hip flexors, hamstrings and glutes. Stretch each side in turn, starting standing and finishing on the floor; changeovers are included in six minutes.',
      completionMessage:'Stretch complete. Nice run.', termination:{type:'fixed-sequence',durationSeconds:360},
      transitionSeconds:5, exercises:steps};
  }
  root.GarageFitPostRunStretch = {generate:generate, readRecent:readRecent, recordStarted:recordStarted};
})(window);
(function (root) {
  root.GarageFitData = root.GarageFitData || {};

  root.GarageFitData.fixedWorkouts = {
    workout300: {
      id: 'workout300',
      name: '300 Workout',
      termination: { type:'fixed-rounds', rounds:1 },
      exercises: [
        { id:'pull-up', name:'Pull-ups', reps:25 },
        { id:'barbell-deadlift', name:'Deadlifts', reps:50 },
        { id:'push-up', name:'Push-ups', reps:50 },
        { id:'box-jumps', name:'Box jumps', reps:50 },
        { id:'floor-wipers', name:'Floor wipers', reps:50 },
        { id:'kettlebell-clean-and-press', name:'Single-arm kettlebell clean and presses', reps:50, note:'25 per side' },
        { id:'pull-up', name:'Pull-ups', reps:25 }
      ]
    },
    cindy: {
      id: 'cindy',
      name: 'Cindy',
      subtitle: '20 min AMRAP',
      termination: { type:'amrap', durationSeconds:20*60 },
      exercises: [
        { id:'pull-up', name:'Pull-ups', reps:5 },
        { id:'push-up', name:'Push-ups', reps:10 },
        { id:'air-squat', name:'Air squats', reps:15 }
      ],
      provenance: 'An established functional-fitness benchmark first published by CrossFit in 2004.'
    },
    abBlast: {
      id: 'abBlast',
      name: '5-Minute Ab Blast',
      subtitle: '5 min continuous',
      completionMessage: 'Five minutes complete. Nice work.',
      termination: { type:'timed-sequence', durationSeconds:5*60 },
      exercises: [
        { id:'sit-up', name:'Sit-ups', durationSeconds:40 },
        { id:'side-plank', name:'Side plank - Left', durationSeconds:30, side:'left' },
        { id:'side-plank', name:'Side plank - Right', durationSeconds:30, side:'right' },
        { id:'reverse-crunch', name:'Reverse crunch', durationSeconds:40 },
        { id:'plank', name:'Front plank', durationSeconds:40 },
        { id:'dead-bug', name:'Dead bug', durationSeconds:40 },
        { id:'bicycle-crunch', name:'Bicycle crunch', durationSeconds:40 },
        { id:'flutter-kicks', name:'Flutter kicks', durationSeconds:40 }
      ]
    },
    eveningFullBodyReset: {
      id: 'eveningFullBodyReset',
      name: 'Evening Full-Body Reset',
      subtitle: '5:40 low-impact circuit',
      description: 'A short, low-impact bodyweight routine for evenings when you want a little full-body movement without doing a full workout.',
      completionMessage: 'Reset complete. Nice and easy.',
      termination: { type:'timed-sequence', durationSeconds:340 },
      transitionSeconds: 10,
      exercises: [
        { id:'bodyweight-squat', name:'Bodyweight squat', durationSeconds:40 },
        { id:'push-up', name:'Press-ups', durationSeconds:40 },
        { id:'alternating-reverse-lunge', name:'Alternating reverse lunges', durationSeconds:40 },
        { id:'bodyweight-good-morning', name:'Bodyweight good mornings', durationSeconds:40 },
        { id:'wall-angel', name:'Wall angels', durationSeconds:40 },
        { id:'dead-bug', name:'Dead bug', durationSeconds:40 },
        { id:'glute-bridge', name:'Glute bridge', durationSeconds:40 }
      ]
    },
    postRunReset: root.GarageFitPostRunStretch.generate({random:function(){return 0;}}),
    sevenMinute: [
      'jumping-jacks','wall-sit','push-up','abdominal-crunch','chair-step-ups','air-squat',
      'chair-triceps-dips','plank','high-knees','reverse-lunge','push-up-rotation','side-plank'
    ]
  };

  // Fixed-workout presentation is kept in its own module. Load it here because
  // workouts.js is already part of the application shell and precedes the
  // inline player bootstrap; the UI module installs only after the page loads.
  if (typeof document !== 'undefined' && document.createElement && document.head && document.head.appendChild) {
    var workoutUiScript = document.createElement('script');
    workoutUiScript.src = 'js/workouts-ui.js';
    workoutUiScript.async = false;
    document.head.appendChild(workoutUiScript);
  }
})(window);
