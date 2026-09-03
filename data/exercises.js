(function (root) {
  const catalogue = {};

  function add(id, name, options) {
    catalogue[id] = Object.assign({
      id,
      name,
      equipment: [],
      patterns: [],
      strength: 1,
      cardio: 1,
      prescription: { type: 'timed', value: 30 },
      estimatedSeconds: 30,
      unilateral: false,
      sideOrder: ['right', 'left'],
      impact: 'low',
      load: null,
      generator: false,
      warmup: false,
      warmupPrescription: null,
      warmupEstimatedSeconds: null,
      main: false,
      cooldown: false,
      instructions: ''
    }, options || {});
  }

  // Equipment groups are ANDed; values within each group are alternatives (OR).
  add('air-squat', 'Air squat', { patterns:['squat'], strength:3, cardio:3, prescription:{type:'reps',value:10}, estimatedSeconds:25, impact:'medium', generator:true, warmup:true, warmupPrescription:{type:'timed',value:15}, warmupEstimatedSeconds:15, main:true });
  add('reverse-lunge', 'Reverse lunge', { patterns:['lunge'], strength:3, cardio:3, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('walking-lunge', 'Walking lunge', { patterns:['lunge'], strength:3, cardio:3, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('push-up', 'Push-up', { patterns:['push'], strength:4, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, generator:true, main:true });
  add('pike-push-up', 'Pike push-up', { patterns:['push'], strength:4, cardio:2, prescription:{type:'reps',value:8}, estimatedSeconds:25, generator:true, main:true });
  add('plank', 'Plank', { patterns:['core'], strength:3, cardio:1, prescription:{type:'timed',value:30}, estimatedSeconds:30, generator:true, main:true });
  add('side-plank', 'Side plank', { patterns:['core'], strength:3, cardio:1, prescription:{type:'unilateral-timed',value:20}, estimatedSeconds:40, unilateral:true, generator:true, main:true });
  add('abdominal-crunch', 'Abdominal crunch', { patterns:['core'], strength:2, cardio:2, prescription:{type:'reps',value:15}, estimatedSeconds:30, generator:true, main:true });
  add('bicycle-crunch', 'Bicycle crunch', { patterns:['core','conditioning'], strength:2, cardio:3, prescription:{type:'reps',value:20}, estimatedSeconds:30, generator:true, main:true });
  add('leg-raises', 'Leg raises', { patterns:['core'], strength:3, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, generator:true, main:true });
  add('mountain-climbers', 'Mountain climbers', { patterns:['core','conditioning'], strength:2, cardio:5, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'medium', generator:true, main:true });
  add('jumping-jacks', 'Jumping jacks', { patterns:['conditioning'], strength:1, cardio:5, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'high', generator:true, warmup:true, warmupPrescription:{type:'timed',value:15}, warmupEstimatedSeconds:15, main:true });
  add('high-knees', 'High knees', { patterns:['conditioning'], strength:1, cardio:5, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'high', generator:true, main:true });
  add('burpees', 'Burpees', { patterns:['push','conditioning'], strength:2, cardio:5, prescription:{type:'reps',value:10}, estimatedSeconds:35, impact:'high', generator:true, warmup:true, warmupPrescription:{type:'timed',value:15}, warmupEstimatedSeconds:15, main:true });
  add('squat-jumps', 'Squat jumps', { patterns:['squat','conditioning'], strength:2, cardio:5, prescription:{type:'reps',value:10}, estimatedSeconds:30, impact:'high', generator:true, main:true });
  add('skater-jumps', 'Skater jumps', { patterns:['lunge','conditioning'], strength:2, cardio:5, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'high', generator:true, main:true });

  add('goblet-squat', 'Goblet squat', { equipment:[['dumbbells']], patterns:['squat'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, impact:'medium', load:'Heavy', generator:true, main:true });
  add('dumbbell-front-squat', 'Dumbbell front squat', { equipment:[['dumbbells']], patterns:['squat'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, impact:'medium', load:'Heavy', generator:true, main:true });
  add('dumbbell-reverse-lunge', 'Dumbbell reverse lunge', { equipment:[['dumbbells']], patterns:['lunge'], strength:5, cardio:2, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:45, unilateral:true, impact:'medium', load:'Medium', generator:true, main:true });
  add('dumbbell-romanian-deadlift', 'Dumbbell Romanian deadlift', { equipment:[['dumbbells']], patterns:['hinge'], strength:5, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Heavy', generator:true, main:true });
  add('dumbbell-deadlift', 'Dumbbell deadlift', { equipment:[['dumbbells']], patterns:['hinge'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Heavy', generator:true, main:true });
  add('dumbbell-floor-press', 'Dumbbell floor press', { equipment:[['dumbbells']], patterns:['push'], strength:5, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Medium', generator:true, main:true });
  add('dumbbell-shoulder-press', 'Dumbbell shoulder press', { equipment:[['dumbbells']], patterns:['push'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Medium', generator:true, main:true });
  add('dumbbell-bent-over-row', 'Dumbbell bent-over row', { equipment:[['dumbbells']], patterns:['pull','hinge'], strength:5, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Medium', generator:true, main:true });
  add('single-arm-dumbbell-row', 'Single-arm dumbbell row', { equipment:[['dumbbells']], patterns:['pull'], strength:5, cardio:1, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:50, unilateral:true, load:'Medium', generator:true, main:true });
  add('dumbbell-thruster', 'Dumbbell thruster', { equipment:[['dumbbells']], patterns:['squat','push','conditioning'], strength:4, cardio:5, prescription:{type:'reps',value:10}, estimatedSeconds:35, impact:'medium', load:'Medium', generator:true, main:true });
  add('dumbbell-clean-and-press', 'Dumbbell clean and press', { equipment:[['dumbbells']], patterns:['hinge','push','conditioning'], strength:4, cardio:4, prescription:{type:'reps',value:10}, estimatedSeconds:40, impact:'medium', load:'Medium', generator:true, main:true });
  add('dumbbell-farmer-carry', 'Dumbbell farmer carry', { equipment:[['dumbbells']], patterns:['carry','core'], strength:4, cardio:3, prescription:{type:'timed',value:30}, estimatedSeconds:30, load:'Heavy', generator:true, main:true });

  add('kettlebell-goblet-squat', 'Kettlebell goblet squat', { equipment:[['kettlebell']], patterns:['squat'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, impact:'medium', generator:true, main:true });
  add('kettlebell-deadlift', 'Kettlebell deadlift', { equipment:[['kettlebell']], patterns:['hinge'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, generator:true, main:true });
  add('kettlebell-swing', 'Kettlebell swing', { equipment:[['kettlebell']], patterns:['hinge','conditioning'], strength:4, cardio:5, prescription:{type:'reps',value:15}, estimatedSeconds:30, impact:'medium', generator:true, main:true });
  add('kettlebell-reverse-lunge', 'Kettlebell reverse lunge', { equipment:[['kettlebell']], patterns:['lunge'], strength:4, cardio:2, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('kettlebell-clean', 'Kettlebell clean', { equipment:[['kettlebell']], patterns:['hinge','conditioning'], strength:4, cardio:4, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('kettlebell-clean-and-press', 'Kettlebell clean and press', { equipment:[['kettlebell']], patterns:['hinge','push'], strength:5, cardio:4, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:55, unilateral:true, impact:'medium', generator:true, main:true });
  add('kettlebell-shoulder-press', 'Kettlebell shoulder press', { equipment:[['kettlebell']], patterns:['push'], strength:5, cardio:2, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:45, unilateral:true, generator:true, main:true });
  add('single-arm-kettlebell-row', 'Single-arm kettlebell row', { equipment:[['kettlebell']], patterns:['pull'], strength:5, cardio:1, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:50, unilateral:true, generator:true, main:true });
  add('kettlebell-figure-eight', 'Kettlebell figure-of-eight', { equipment:[['kettlebell']], patterns:['core','conditioning'], strength:3, cardio:4, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'medium', generator:true, warmup:true, warmupPrescription:{type:'timed',value:15}, warmupEstimatedSeconds:15, main:true });
  add('kettlebell-farmer-carry', 'Kettlebell farmer carry', { equipment:[['kettlebell']], patterns:['carry','core'], strength:4, cardio:3, prescription:{type:'timed',value:30}, estimatedSeconds:30, generator:true, main:true });

  add('pull-up', 'Pull-up', { equipment:[['pullup-bar']], patterns:['pull'], strength:5, cardio:2, prescription:{type:'reps',value:5}, estimatedSeconds:25, generator:true, main:true });
  add('chin-up', 'Chin-up', { equipment:[['pullup-bar']], patterns:['pull'], strength:5, cardio:2, prescription:{type:'reps',value:5}, estimatedSeconds:25, generator:true, main:true });
  add('hanging-knee-raise', 'Hanging knee raise', { equipment:[['pullup-bar']], patterns:['core','pull'], strength:4, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, generator:true, main:true });
  add('toes-to-bar', 'Toes-to-bar', { equipment:[['pullup-bar']], patterns:['core','pull'], strength:5, cardio:2, prescription:{type:'reps',value:5}, estimatedSeconds:25, generator:true, main:true });
  add('dead-hang', 'Dead hang', { equipment:[['pullup-bar']], patterns:['pull'], strength:3, cardio:1, prescription:{type:'timed',value:30}, estimatedSeconds:30, generator:true, main:true });

  [
    ['trx-row','TRX row',['pull'],5,2,{type:'reps',value:10}],['trx-squat','TRX squat',['squat'],3,3,{type:'reps',value:12}],
    ['trx-reverse-lunge','TRX reverse lunge',['lunge'],4,3,{type:'unilateral-reps',value:8}],['trx-split-squat','TRX split squat',['lunge'],4,2,{type:'unilateral-reps',value:8}],
    ['trx-chest-press','TRX chest press',['push'],4,2,{type:'reps',value:10}],['trx-triceps-press','TRX triceps press',['push'],4,2,{type:'reps',value:10}],
    ['trx-biceps-curl','TRX biceps curl',['pull'],4,2,{type:'reps',value:10}],['trx-hamstring-curl','TRX hamstring curl',['hinge','core'],4,2,{type:'reps',value:10}],
    ['trx-knee-tuck','TRX knee tuck',['core','conditioning'],3,4,{type:'reps',value:10}],['trx-mountain-climber','TRX mountain climber',['core','conditioning'],3,5,{type:'timed',value:30}]
  ].forEach(x=>add(x[0],x[1],{equipment:[['trx']],patterns:x[2],strength:x[3],cardio:x[4],prescription:x[5],estimatedSeconds:x[5].type.includes('unilateral')?45:30,unilateral:x[5].type.includes('unilateral'),impact:x[0].includes('mountain')?'medium':'low',generator:true,main:true}));

  [
    ['barbell-deadlift','Barbell deadlift',['hinge'],5,1,10],['barbell-romanian-deadlift','Barbell Romanian deadlift',['hinge'],5,1,10],
    ['barbell-bent-over-row','Barbell bent-over row',['pull','hinge'],5,1,10],['barbell-overhead-press','Barbell overhead press',['push'],5,1,8],
    ['barbell-floor-press','Barbell floor press',['push'],5,1,10],['barbell-front-squat','Barbell front squat',['squat'],5,2,8],
    ['barbell-clean','Barbell clean',['hinge','conditioning'],5,4,8],['barbell-clean-and-press','Barbell clean and press',['hinge','push','conditioning'],5,4,8]
  ].forEach(x=>add(x[0],x[1],{equipment:[['barbell']],patterns:x[2],strength:x[3],cardio:x[4],prescription:{type:'reps',value:x[5]},estimatedSeconds:35,impact:x[4]>3?'medium':'low',generator:true,main:true}));

  add('dumbbell-bench-press', 'Dumbbell bench press', { equipment:[['dumbbells'],['bench']], patterns:['push'], strength:5, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Medium', generator:true, main:true });
  add('dumbbell-bench-row', 'Dumbbell bench row', { equipment:[['dumbbells'],['bench']], patterns:['pull'], strength:5, cardio:1, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:50, unilateral:true, load:'Medium', generator:true, main:true });
  add('bulgarian-split-squat', 'Bulgarian split squat', { equipment:[['bench','box']], patterns:['lunge'], strength:5, cardio:2, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:50, unilateral:true, impact:'medium', generator:true, main:true });
  add('bench-dips', 'Bench dips', { equipment:[['bench']], patterns:['push'], strength:4, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, generator:true, main:true });
  add('step-ups', 'Step-ups', { equipment:[['bench','box']], patterns:['lunge','conditioning'], strength:3, cardio:4, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('box-jumps', 'Box jumps', { equipment:[['box']], patterns:['squat','conditioning'], strength:3, cardio:5, prescription:{type:'reps',value:10}, estimatedSeconds:35, impact:'high', generator:true, main:true });
  add('box-step-ups', 'Box step-ups', { equipment:[['box']], patterns:['lunge','conditioning'], strength:3, cardio:4, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('box-squat', 'Box squat', { equipment:[['box']], patterns:['squat'], strength:4, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, impact:'medium', generator:true, main:true });
  add('incline-push-up', 'Incline push-up', { equipment:[['box']], patterns:['push'], strength:3, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, generator:true, main:true });

  [
    ['band-row','Band row',['pull'],4,2],['band-chest-press','Band chest press',['push'],4,2],['band-shoulder-press','Band shoulder press',['push'],4,2],
    ['band-pull-apart','Band pull-apart',['pull'],3,1],['band-face-pull','Band face pull',['pull'],4,1],['band-biceps-curl','Band biceps curl',['pull'],3,2],
    ['band-triceps-extension','Band triceps extension',['push'],3,2],['banded-squat','Banded squat',['squat'],4,3],['banded-lateral-walk','Banded lateral walk',['lunge'],3,3],
    ['band-romanian-deadlift','Band Romanian deadlift',['hinge'],4,2]
  ].forEach(x=>add(x[0],x[1],{equipment:[['bands']],patterns:x[2],strength:x[3],cardio:x[4],prescription:{type:'reps',value:x[0]==='banded-lateral-walk'?10:12},estimatedSeconds:30,impact:x[0]==='banded-squat'?'medium':'low',generator:true,main:true}));
  catalogue['band-pull-apart'].warmup=true;
  catalogue['band-pull-apart'].warmupPrescription={type:'timed',value:15};
  catalogue['band-pull-apart'].warmupEstimatedSeconds=15;

  // Existing fixed-workout movements that are intentionally not Generator v1 candidates.
  add('wall-sit', 'Wall sit', { patterns:['squat'], prescription:{type:'timed',value:30}, estimatedSeconds:30, main:true });
  add('chair-step-ups', 'Step-ups onto a chair', { patterns:['lunge','conditioning'], prescription:{type:'timed',value:30}, estimatedSeconds:30, main:true });
  add('chair-triceps-dips', 'Triceps dips on a chair', { patterns:['push'], prescription:{type:'timed',value:30}, estimatedSeconds:30, main:true });
  add('push-up-rotation', 'Push-ups with rotation', { patterns:['push','core'], prescription:{type:'timed',value:30}, estimatedSeconds:30, main:true });
  add('floor-wipers', 'Floor wipers', { equipment:[['barbell']], patterns:['core'], prescription:{type:'reps',value:50}, estimatedSeconds:90, main:true });

  const warmups = [
    ['knees-up','Knees up'],['bum-kicks','Bum kicks'],['open-close-gates','Open gates, close gates'],['hand-opposite-toe','Hand to opposite toe'],
    ['body-hoops','Body hoops'],['body-twists','Body twists'],['arm-circles-backwards','Arm circles backwards'],['arm-circles-forwards','Arm circles forwards'],
    ['arm-side-circles','Arm side circles'],['walk-plank-push-up','Walk to plank and push up'],['star-jumps','Star jumps']
  ];
  warmups.forEach(x=>add(x[0],x[1],{warmup:true,prescription:{type:'timed',value:15},estimatedSeconds:15,impact:['star-jumps','knees-up','bum-kicks'].includes(x[0])?'medium':'low'}));
  add('step-back-lunge', 'Step back lunge', { patterns:['lunge'], warmup:true, unilateral:true, prescription:{type:'unilateral-timed',value:15}, estimatedSeconds:30, impact:'medium' });
  add('trx-squat-overhead', 'TRX squat to overhead press', { equipment:[['trx']], warmup:true, prescription:{type:'timed',value:15}, estimatedSeconds:15 });
  add('trx-lunge-warmup', 'TRX lunge', { equipment:[['trx']], warmup:true, prescription:{type:'timed',value:15}, estimatedSeconds:15 });
  add('hangout-pullup-bar', 'Hangout on a pull-up bar', { equipment:[['pullup-bar']], warmup:true, prescription:{type:'timed',value:15}, estimatedSeconds:15 });

  const cooldowns = [
    ['toe-touch','Toe touch'],['inside-thigh-stretch','Inside thigh stretch'],['wide-toe-touch','Wide toe touch'],
    ['hip-flexor-arm-stretch','Hip flexor, arm pull and overhead tricep'],['kneeling-hamstring','Kneeling hamstring'],['frog-stretch','Frog'],
    ['standing-quads','Standing quads'],['downward-upward-dog','Downward dog to upward dog'],['plank-calf-stretch','Plank calf stretch'],
    ['pigeon-stretch','Pigeon'],['runners-stretch',"Runner's stretch"],['lean-back-sink','Lean back and sink'],['chest-opener','Chest opener'],
    ['side-stretch','Side stretch'],['glute-stretch','Glute stretch'],['lying-torso-twist','Lying torso twist'],['full-body-stretch','Full body stretch']
  ];
  const unilateralCooldowns = new Set(['inside-thigh-stretch','wide-toe-touch','hip-flexor-arm-stretch','kneeling-hamstring','standing-quads','pigeon-stretch','runners-stretch','lying-torso-twist']);
  cooldowns.forEach(x=>add(x[0],x[1],{cooldown:true,unilateral:unilateralCooldowns.has(x[0]),prescription:{type:unilateralCooldowns.has(x[0])?'unilateral-timed':'timed',value:15},estimatedSeconds:unilateralCooldowns.has(x[0])?30:15}));
  add('trx-lean-back-sink', 'TRX lean back and sink', { equipment:[['trx']], cooldown:true, prescription:{type:'timed',value:15}, estimatedSeconds:15 });
  add('trx-lunge-calf-chest', 'TRX lunge, calf and chest opener', { equipment:[['trx']], cooldown:true, unilateral:true, prescription:{type:'unilateral-timed',value:15}, estimatedSeconds:30 });
  add('trx-glute-standing', 'TRX glute standing', { equipment:[['trx']], cooldown:true, unilateral:true, prescription:{type:'unilateral-timed',value:15}, estimatedSeconds:30 });
  add('trx-side-stretch', 'TRX side stretch', { equipment:[['trx']], cooldown:true, unilateral:true, prescription:{type:'unilateral-timed',value:15}, estimatedSeconds:30 });

  root.GarageFitData = root.GarageFitData || {};
  root.GarageFitData.exercises = catalogue;
})(window);
