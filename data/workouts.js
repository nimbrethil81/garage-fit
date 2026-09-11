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
    sevenMinute: [
      'jumping-jacks','wall-sit','push-up','abdominal-crunch','chair-step-ups','air-squat',
      'chair-triceps-dips','plank','high-knees','reverse-lunge','push-up-rotation','side-plank'
    ]
  };
})(window);
