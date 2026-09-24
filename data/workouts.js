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
