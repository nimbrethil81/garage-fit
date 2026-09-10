(function (root) {
  const catalogue = {};

  // Sidedness describes how an exercise engages the body's left/right sides, independent of
  // phase-specific prescription/timing (which only determines presentation):
  //  - bilateral: both sides work together in the same movement (e.g. squat, push-up)
  //  - alternating: sides alternate within a single continuous exercise (e.g. walking lunge)
  //  - per-side: one side is completed, then the other, as distinct phases (e.g. reverse lunge)
  //  - none: the movement has no meaningful left/right distinction (e.g. an isometric hold)
  function resolveSidedness(options) {
    if (options.sidedness) return options.sidedness;
    const prescriptionType = (options.prescription && options.prescription.type) || '';
    if (options.unilateral || prescriptionType.includes('unilateral')) return 'per-side';
    return 'bilateral';
  }

  function add(id, name, options) {
    options = options || {};
    const sidedness = resolveSidedness(options);
    const unilateral = options.unilateral !== undefined ? options.unilateral : sidedness === 'per-side';
    catalogue[id] = Object.assign({
      id,
      name,
      equipment: [],
      patterns: [],
      movementPlanes: ['sagittal'],
      bodyPosition: 'standing',
      strength: 1,
      cardio: 1,
      prescription: { type: 'timed', value: 30 },
      estimatedSeconds: 30,
      sideOrder: ['right', 'left'],
      impact: 'low',
      load: null,
      generator: false,
      warmup: false,
      warmupPhase: null,
      warmupPrescription: null,
      warmupEstimatedSeconds: null,
      warmupAreas: [],
      rampup: false,
      rampupPrescription: null,
      rampupEstimatedSeconds: null,
      prepIntensity: null,
      prepFatigue: null,
      prepComplexity: null,
      main: false,
      cooldown: false,
      alternativeGroup: null,
      instructions: ''
    }, options, { sidedness, unilateral });
  }

  function prep(options, intensity, fatigue, complexity, rampupPrescription) {
    return Object.assign({}, options, {
      prepIntensity: intensity,
      prepFatigue: fatigue,
      prepComplexity: complexity
    }, rampupPrescription ? {
      rampup: true,
      rampupPrescription,
      rampupEstimatedSeconds: rampupPrescription.value
    } : {});
  }

  add('air-squat', 'Air squat', prep({ patterns:['squat'], warmupAreas:['hips','knees','ankles'], strength:3, cardio:3, prescription:{type:'reps',value:10}, estimatedSeconds:25, impact:'medium', generator:true, warmup:true, warmupPhase:'dynamic', warmupPrescription:{type:'timed',value:20}, warmupEstimatedSeconds:20, main:true },3,2,1,{type:'timed',value:40,minValue:30,maxValue:45}));
  add('reverse-lunge', 'Reverse lunge', { patterns:['lunge'], strength:3, cardio:3, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('walking-lunge', 'Walking lunge', { patterns:['lunge'], strength:3, cardio:3, prescription:{type:'reps',value:20}, estimatedSeconds:45, sidedness:'alternating', impact:'medium', generator:true, main:true, instructions:'Alternate left and right legs with each walking lunge step.' });
  add('push-up', 'Push-up', prep({ patterns:['push'], bodyPosition:'floor', strength:4, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, generator:true, main:true },4,3,2,{type:'timed',value:30,minValue:20,maxValue:40}));
  add('pike-push-up', 'Pike push-up', { patterns:['push'], bodyPosition:'floor', strength:4, cardio:2, prescription:{type:'reps',value:8}, estimatedSeconds:25, generator:true, main:true });
  add('plank', 'Plank', prep({ patterns:['core'], bodyPosition:'floor', strength:3, cardio:1, prescription:{type:'timed',value:30}, estimatedSeconds:30, sidedness:'none', generator:true, main:true },2,2,1,{type:'timed',value:30,minValue:20,maxValue:40}));
  add('side-plank', 'Side plank', { patterns:['core'], movementPlanes:['frontal'], bodyPosition:'floor', strength:3, cardio:1, prescription:{type:'unilateral-timed',value:20}, estimatedSeconds:40, unilateral:true, generator:true, main:true });
  add('abdominal-crunch', 'Abdominal crunch', { patterns:['core'], bodyPosition:'floor', strength:2, cardio:2, prescription:{type:'timed',value:30}, estimatedSeconds:30, generator:true, main:true });
  add('bicycle-crunch', 'Bicycle crunch', { patterns:['core','conditioning'], movementPlanes:['sagittal','transverse'], bodyPosition:'floor', strength:2, cardio:3, prescription:{type:'reps',value:20}, estimatedSeconds:30, sidedness:'alternating', generator:true, main:true });
  add('leg-raises', 'Leg raises', { patterns:['core'], bodyPosition:'floor', strength:3, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, generator:true, main:true });
  add('mountain-climbers', 'Mountain climbers', prep({ patterns:['core','conditioning'], bodyPosition:'floor', strength:2, cardio:5, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'medium', sidedness:'alternating', generator:true, main:true },4,2,2,{type:'timed',value:35,minValue:25,maxValue:45}));
  add('jumping-jacks', 'Jumping jacks', prep({ patterns:['conditioning'], warmupAreas:['hips','knees','ankles'], movementPlanes:['frontal'], strength:1, cardio:5, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'high', generator:true, warmup:true, warmupPhase:'dynamic', warmupPrescription:{type:'timed',value:20}, warmupEstimatedSeconds:20, main:true },4,1,1,{type:'timed',value:40,minValue:30,maxValue:45}));
  add('high-knees', 'High knees', prep({ patterns:['conditioning'], strength:1, cardio:5, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'high', sidedness:'alternating', generator:true, main:true },5,2,1,{type:'timed',value:35,minValue:25,maxValue:45}));
  add('burpees', 'Burpees', prep({ patterns:['push','conditioning'], warmupAreas:['hips','knees','ankles','shoulders'], bodyPosition:'mixed', strength:2, cardio:5, prescription:{type:'reps',value:10}, estimatedSeconds:35, impact:'high', generator:true, warmup:true, warmupPhase:'late', warmupPrescription:{type:'timed',value:15}, warmupEstimatedSeconds:15, main:true },5,3,2,{type:'timed',value:30,minValue:20,maxValue:35}));
  add('squat-jumps', 'Squat jumps', prep({ patterns:['squat','conditioning'], strength:2, cardio:5, prescription:{type:'reps',value:10}, estimatedSeconds:30, impact:'high', generator:true, main:true },5,3,2,{type:'timed',value:30,minValue:20,maxValue:35}));
  add('skater-jumps', 'Skater jumps', prep({ patterns:['lunge','conditioning'], movementPlanes:['frontal'], strength:2, cardio:5, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'high', sidedness:'alternating', generator:true, main:true },5,3,2,{type:'timed',value:30,minValue:20,maxValue:35}));

  add('goblet-squat', 'Goblet squat', prep({ equipment:[['dumbbells']], patterns:['squat'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, impact:'medium', load:'Heavy', generator:true, main:true },4,3,2,{type:'timed',value:30,minValue:20,maxValue:35}));
  add('dumbbell-front-squat', 'Dumbbell front squat', { equipment:[['dumbbells']], patterns:['squat'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, impact:'medium', load:'Heavy', generator:true, main:true });
  add('dumbbell-reverse-lunge', 'Dumbbell reverse lunge', { equipment:[['dumbbells']], patterns:['lunge'], strength:5, cardio:2, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:45, unilateral:true, impact:'medium', load:'Medium', generator:true, main:true });
  add('dumbbell-romanian-deadlift', 'Dumbbell Romanian deadlift', prep({ equipment:[['dumbbells']], patterns:['hinge'], strength:5, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Heavy', generator:true, main:true },3,2,2,{type:'timed',value:30,minValue:20,maxValue:35}));
  add('dumbbell-deadlift', 'Dumbbell deadlift', { equipment:[['dumbbells']], patterns:['hinge'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Heavy', generator:true, main:true });
  add('dumbbell-floor-press', 'Dumbbell floor press', { equipment:[['dumbbells']], patterns:['push'], bodyPosition:'floor', strength:5, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Medium', generator:true, main:true });
  add('dumbbell-shoulder-press', 'Dumbbell shoulder press', { equipment:[['dumbbells']], patterns:['push'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Medium', generator:true, main:true });
  add('dumbbell-bent-over-row', 'Dumbbell bent-over row', { equipment:[['dumbbells']], patterns:['pull','hinge'], strength:5, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Medium', generator:true, main:true });
  add('single-arm-dumbbell-row', 'Single-arm dumbbell row', { equipment:[['dumbbells']], patterns:['pull'], strength:5, cardio:1, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:50, unilateral:true, load:'Medium', generator:true, main:true });
  add('dumbbell-thruster', 'Dumbbell thruster', { equipment:[['dumbbells']], patterns:['squat','push','conditioning'], strength:4, cardio:5, prescription:{type:'timed',value:35}, estimatedSeconds:35, impact:'medium', load:'Medium', generator:true, main:true });
  add('dumbbell-clean-and-press', 'Dumbbell clean and press', { equipment:[['dumbbells']], patterns:['hinge','push','conditioning'], strength:4, cardio:4, prescription:{type:'reps',value:10}, estimatedSeconds:40, impact:'medium', load:'Medium', generator:true, main:true });
  add('dumbbell-farmer-carry', 'Dumbbell farmer carry', prep({ equipment:[['dumbbells']], patterns:['carry','core'], strength:4, cardio:3, prescription:{type:'timed',value:30}, estimatedSeconds:30, load:'Heavy', generator:true, main:true },3,2,1,{type:'timed',value:35,minValue:25,maxValue:45}));

  add('kettlebell-goblet-squat', 'Kettlebell goblet squat', prep({ equipment:[['kettlebell']], patterns:['squat'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, impact:'medium', generator:true, main:true },4,3,2,{type:'timed',value:30,minValue:20,maxValue:35}));
  add('kettlebell-deadlift', 'Kettlebell deadlift', prep({ equipment:[['kettlebell']], patterns:['hinge'], strength:5, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, generator:true, main:true },3,2,2,{type:'timed',value:30,minValue:20,maxValue:35}));
  add('kettlebell-swing', 'Kettlebell swing', prep({ equipment:[['kettlebell']], patterns:['hinge','conditioning'], strength:4, cardio:5, prescription:{type:'reps',value:15}, estimatedSeconds:30, impact:'medium', generator:true, main:true },5,3,3,{type:'timed',value:30,minValue:20,maxValue:35}));
  add('kettlebell-reverse-lunge', 'Kettlebell reverse lunge', { equipment:[['kettlebell']], patterns:['lunge'], strength:4, cardio:2, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('kettlebell-clean', 'Kettlebell clean', { equipment:[['kettlebell']], patterns:['hinge','conditioning'], strength:4, cardio:4, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('kettlebell-clean-and-press', 'Kettlebell clean and press', { equipment:[['kettlebell']], patterns:['hinge','push'], strength:5, cardio:4, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:55, unilateral:true, impact:'medium', generator:true, main:true });
  add('kettlebell-shoulder-press', 'Kettlebell shoulder press', { equipment:[['kettlebell']], patterns:['push'], strength:5, cardio:2, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:45, unilateral:true, generator:true, main:true });
  add('single-arm-kettlebell-row', 'Single-arm kettlebell row', { equipment:[['kettlebell']], patterns:['pull'], strength:5, cardio:1, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:50, unilateral:true, generator:true, main:true });
  add('kettlebell-figure-eight', 'Kettlebell figure-of-eight', prep({ equipment:[['kettlebell']], patterns:['core','conditioning'], warmupAreas:['hips','trunk'], movementPlanes:['transverse'], strength:3, cardio:4, prescription:{type:'timed',value:30}, estimatedSeconds:30, impact:'medium', sidedness:'alternating', generator:true, warmup:true, warmupPhase:'late', warmupPrescription:{type:'timed',value:15}, warmupEstimatedSeconds:15, main:true },4,2,3,{type:'timed',value:35,minValue:25,maxValue:40}));
  add('kettlebell-farmer-carry', 'Kettlebell farmer carry', prep({ equipment:[['kettlebell']], patterns:['carry','core'], strength:4, cardio:3, prescription:{type:'timed',value:30}, estimatedSeconds:30, generator:true, main:true },3,2,1,{type:'timed',value:35,minValue:25,maxValue:45}));

  add('pull-up', 'Pull-up', { equipment:[['pullup-bar']], patterns:['pull'], bodyPosition:'hanging', strength:5, cardio:2, prescription:{type:'reps',value:5}, estimatedSeconds:25, generator:true, main:true });
  add('chin-up', 'Chin-up', { equipment:[['pullup-bar']], patterns:['pull'], bodyPosition:'hanging', strength:5, cardio:2, prescription:{type:'reps',value:5}, estimatedSeconds:25, generator:true, main:true });
  add('hanging-knee-raise', 'Hanging knee raise', { equipment:[['pullup-bar']], patterns:['core','pull'], bodyPosition:'hanging', strength:4, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, generator:true, main:true });
  add('toes-to-bar', 'Toes-to-bar', { equipment:[['pullup-bar']], patterns:['core','pull'], bodyPosition:'hanging', strength:5, cardio:2, prescription:{type:'reps',value:5}, estimatedSeconds:25, generator:true, main:true });
  add('dead-hang', 'Dead hang', prep({ equipment:[['pullup-bar']], patterns:['pull'], bodyPosition:'hanging', strength:3, cardio:1, prescription:{type:'timed',value:30}, estimatedSeconds:30, sidedness:'none', generator:true, main:true },2,1,1,{type:'timed',value:25,minValue:20,maxValue:30}));

  [
    ['trx-row','TRX row',['pull'],5,2,{type:'reps',value:10}],['trx-squat','TRX squat',['squat'],3,3,{type:'reps',value:12}],
    ['trx-reverse-lunge','TRX reverse lunge',['lunge'],4,3,{type:'unilateral-reps',value:8}],['trx-split-squat','TRX split squat',['lunge'],4,2,{type:'unilateral-reps',value:8}],
    ['trx-chest-press','TRX chest press',['push'],4,2,{type:'reps',value:10}],['trx-triceps-press','TRX triceps press',['push'],4,2,{type:'reps',value:10}],
    ['trx-biceps-curl','TRX biceps curl',['pull'],4,2,{type:'reps',value:10}],['trx-hamstring-curl','TRX hamstring curl',['hinge','core'],4,2,{type:'reps',value:10}],
    ['trx-knee-tuck','TRX knee tuck',['core','conditioning'],3,4,{type:'reps',value:10}],['trx-mountain-climber','TRX mountain climber',['core','conditioning'],3,5,{type:'timed',value:30}]
  ].forEach(x=>add(x[0],x[1],{equipment:[['trx']],patterns:x[2],strength:x[3],cardio:x[4],prescription:x[5],estimatedSeconds:x[5].type.includes('unilateral')?45:30,unilateral:x[5].type.includes('unilateral'),impact:x[0].includes('mountain')?'medium':'low',bodyPosition:['trx-hamstring-curl','trx-knee-tuck','trx-mountain-climber'].includes(x[0])?'floor':'standing',generator:true,main:true}));
  Object.assign(catalogue['trx-row'], prep(catalogue['trx-row'],3,2,2,{type:'timed',value:30,minValue:20,maxValue:40}));
  Object.assign(catalogue['trx-squat'], prep(catalogue['trx-squat'],3,2,1,{type:'timed',value:35,minValue:25,maxValue:45}));
  Object.assign(catalogue['trx-mountain-climber'], prep(catalogue['trx-mountain-climber'],5,3,3,{type:'timed',value:30,minValue:20,maxValue:35}));
  catalogue['trx-mountain-climber'].sidedness='alternating';

  [
    ['barbell-deadlift','Barbell deadlift',['hinge'],5,1,10],['barbell-romanian-deadlift','Barbell Romanian deadlift',['hinge'],5,1,10],
    ['barbell-bent-over-row','Barbell bent-over row',['pull','hinge'],5,1,10],['barbell-overhead-press','Barbell overhead press',['push'],5,1,8],
    ['barbell-floor-press','Barbell floor press',['push'],5,1,10],['barbell-front-squat','Barbell front squat',['squat'],5,2,8],
    ['barbell-clean','Barbell clean',['hinge','conditioning'],5,4,8],['barbell-clean-and-press','Barbell clean and press',['hinge','push','conditioning'],5,4,8]
  ].forEach(x=>add(x[0],x[1],{equipment:[['barbell']],patterns:x[2],strength:x[3],cardio:x[4],prescription:{type:'reps',value:x[5]},estimatedSeconds:35,impact:x[4]>3?'medium':'low',bodyPosition:x[0]==='barbell-floor-press'?'floor':'standing',generator:true,main:true}));

  add('dumbbell-bench-press', 'Dumbbell bench press', { equipment:[['dumbbells'],['bench']], patterns:['push'], bodyPosition:'supported', strength:5, cardio:1, prescription:{type:'reps',value:10}, estimatedSeconds:30, load:'Medium', generator:true, main:true });
  add('dumbbell-bench-row', 'Dumbbell bench row', { equipment:[['dumbbells'],['bench']], patterns:['pull'], bodyPosition:'supported', strength:5, cardio:1, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:50, unilateral:true, load:'Medium', generator:true, main:true });
  add('bulgarian-split-squat', 'Bulgarian split squat', { equipment:[['bench','box']], patterns:['lunge'], strength:5, cardio:2, prescription:{type:'unilateral-reps',value:8}, estimatedSeconds:50, unilateral:true, impact:'medium', generator:true, main:true });
  add('bench-dips', 'Bench dips', { equipment:[['bench']], patterns:['push'], bodyPosition:'supported', strength:4, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, generator:true, main:true });
  add('step-ups', 'Step-ups', prep({ equipment:[['bench','box']], patterns:['lunge','conditioning'], strength:3, cardio:4, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true },4,2,2,{type:'timed',value:35,minValue:25,maxValue:45}));
  add('box-jumps', 'Box jumps', { equipment:[['box']], patterns:['squat','conditioning'], strength:3, cardio:5, prescription:{type:'reps',value:10}, estimatedSeconds:35, impact:'high', generator:true, main:true });
  add('box-step-ups', 'Box step-ups', { equipment:[['box']], patterns:['lunge','conditioning'], strength:3, cardio:4, prescription:{type:'unilateral-reps',value:10}, estimatedSeconds:45, unilateral:true, impact:'medium', generator:true, main:true });
  add('box-squat', 'Box squat', { equipment:[['box']], patterns:['squat'], strength:4, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:30, impact:'medium', generator:true, main:true });
  add('incline-push-up', 'Incline push-up', { equipment:[['box']], patterns:['push'], bodyPosition:'supported', strength:3, cardio:2, prescription:{type:'reps',value:10}, estimatedSeconds:25, generator:true, main:true });

  [
    ['band-row','Band row',['pull'],4,2],['band-chest-press','Band chest press',['push'],4,2],['band-shoulder-press','Band shoulder press',['push'],4,2],
    ['band-pull-apart','Band pull-apart',['pull'],3,1],['band-face-pull','Band face pull',['pull'],4,1],['band-biceps-curl','Band biceps curl',['pull'],3,2],
    ['band-triceps-extension','Band triceps extension',['push'],3,2],['banded-squat','Banded squat',['squat'],4,3],['banded-lateral-walk','Banded lateral walk',['lunge'],3,3],
    ['band-romanian-deadlift','Band Romanian deadlift',['hinge'],4,2]
  ].forEach(x=>add(x[0],x[1],{equipment:[['bands']],patterns:x[2],movementPlanes:x[0]==='banded-lateral-walk'?['frontal']:['sagittal'],strength:x[3],cardio:x[4],prescription:{type:'reps',value:x[0]==='banded-lateral-walk'?10:12},estimatedSeconds:30,impact:x[0]==='banded-squat'?'medium':'low',generator:true,main:true}));
  Object.assign(catalogue['band-pull-apart'], prep(catalogue['band-pull-apart'],2,1,1,{type:'timed',value:30,minValue:20,maxValue:35}));
  catalogue['band-pull-apart'].warmup=true;
  catalogue['band-pull-apart'].warmupPhase='dynamic';
  catalogue['band-pull-apart'].warmupPrescription={type:'timed',value:20};
  catalogue['band-pull-apart'].warmupEstimatedSeconds=20;
  catalogue['band-pull-apart'].warmupAreas=['shoulders'];

  add('wall-sit', 'Wall sit', { patterns:['squat'], bodyPosition:'supported', prescription:{type:'timed',value:30}, estimatedSeconds:30, sidedness:'none', main:true });
  add('chair-step-ups', 'Step-ups onto a chair', { patterns:['lunge','conditioning'], prescription:{type:'timed',value:30}, estimatedSeconds:30, main:true });
  add('chair-triceps-dips', 'Triceps dips on a chair', { patterns:['push'], bodyPosition:'supported', prescription:{type:'timed',value:30}, estimatedSeconds:30, main:true });
  add('push-up-rotation', 'Push-ups with rotation', { patterns:['push','core'], movementPlanes:['sagittal','transverse'], bodyPosition:'floor', prescription:{type:'timed',value:30}, estimatedSeconds:30, main:true });
  add('floor-wipers', 'Floor wipers', { equipment:[['barbell']], patterns:['core'], movementPlanes:['transverse'], bodyPosition:'floor', prescription:{type:'reps',value:50}, estimatedSeconds:90, sidedness:'alternating', main:true });

  const warmups = [
    ['knees-up','Knees up','dynamic',3,1,1,['sagittal'],'standing',true,['hips','knees']],['bum-kicks','Bum kicks','dynamic',3,1,1,['sagittal'],'standing',true,['hips','knees']],['open-close-gates','Open gates, close gates','basic',1,1,1,['frontal','transverse'],'standing',false,['hips']],['hand-opposite-toe','Hand to opposite toe','dynamic',2,1,2,['sagittal','transverse'],'standing',false,['hips']],
    ['body-hoops','Body hoops','basic',1,1,1,['transverse'],'standing',false,['trunk']],['body-twists','Body twists','basic',1,1,1,['transverse'],'standing',false,['trunk']],['arm-circles-backwards','Arm circles backwards','basic',1,1,1,['frontal'],'standing',false,['shoulders']],['arm-circles-forwards','Arm circles forwards','basic',1,1,1,['frontal'],'standing',false,['shoulders']],
    ['arm-side-circles','Arm side circles','basic',1,1,1,['frontal'],'standing',false,['shoulders']],['walk-plank-push-up','Walk to plank and push up','late',3,2,2,['sagittal'],'mixed',true,['hips','shoulders']],['star-jumps','Star jumps','late',4,1,1,['frontal'],'standing',true,['hips','knees','ankles']]
  ];
  warmups.forEach(x=>add(x[0],x[1],prep({warmup:true,warmupPhase:x[2],prescription:{type:'timed',value:20},warmupPrescription:{type:'timed',value:20},warmupEstimatedSeconds:20,estimatedSeconds:20,impact:['star-jumps','knees-up','bum-kicks'].includes(x[0])?'medium':'low',movementPlanes:x[6],bodyPosition:x[7],warmupAreas:x[9]},x[3],x[4],x[5],x[8]?{type:'timed',value:35,minValue:25,maxValue:45}:null)));
  add('step-back-lunge', 'Step back lunge', prep({ patterns:['lunge'], warmupAreas:['hips','knees','ankles'], warmup:true, warmupPhase:'dynamic', unilateral:true, warmupPrescription:{type:'unilateral-timed',value:15}, prescription:{type:'unilateral-timed',value:15}, warmupEstimatedSeconds:30, estimatedSeconds:30, impact:'medium' },2,2,2,{type:'timed',value:30,minValue:20,maxValue:35}));
  add('trx-squat-overhead', 'TRX squat to overhead press', prep({ equipment:[['trx']], patterns:['squat','push'], warmupAreas:['hips','knees','ankles','shoulders'], warmup:true, warmupPhase:'late', warmupPrescription:{type:'timed',value:20}, prescription:{type:'timed',value:20}, warmupEstimatedSeconds:20, estimatedSeconds:20 },3,2,2,{type:'timed',value:35,minValue:25,maxValue:40}));
  add('trx-lunge-warmup', 'TRX lunge', prep({ equipment:[['trx']], patterns:['lunge'], warmupAreas:['hips','knees','ankles'], warmup:true, warmupPhase:'dynamic', warmupPrescription:{type:'timed',value:20}, prescription:{type:'timed',value:20}, warmupEstimatedSeconds:20, estimatedSeconds:20 },2,2,2,{type:'timed',value:30,minValue:20,maxValue:35}));
  add('hangout-pullup-bar', 'Hangout on a pull-up bar', prep({ equipment:[['pullup-bar']], patterns:['pull'], warmupAreas:['shoulders'], bodyPosition:'hanging', warmup:true, warmupPhase:'late', warmupPrescription:{type:'timed',value:20}, prescription:{type:'timed',value:20}, warmupEstimatedSeconds:20, estimatedSeconds:20 },2,1,1,{type:'timed',value:25,minValue:20,maxValue:30}));

  const cooldowns = [
    ['toe-touch','Toe touch'],['inside-thigh-stretch','Inside thigh stretch'],['wide-toe-touch','Wide toe touch'],
    ['hip-flexor-arm-stretch','Hip flexor, arm pull and overhead tricep'],['kneeling-hamstring','Kneeling hamstring'],['frog-stretch','Frog'],
    ['standing-quads','Standing quads'],['downward-upward-dog','Downward dog to upward dog'],['plank-calf-stretch','Plank calf stretch'],
    ['pigeon-stretch','Pigeon'],['runners-stretch',"Runner's stretch"],['childs-pose',"Child's pose"],['chest-opener','Chest opener'],
    ['side-stretch','Side stretch'],['glute-stretch','Glute stretch'],['lying-torso-twist','Lying torso twist'],['full-body-stretch','Full body stretch']
  ];
  const unilateralCooldowns = new Set(['inside-thigh-stretch','wide-toe-touch','hip-flexor-arm-stretch','kneeling-hamstring','standing-quads','pigeon-stretch','runners-stretch','lying-torso-twist']);
  const floorCooldowns = new Set(['kneeling-hamstring','frog-stretch','downward-upward-dog','plank-calf-stretch','pigeon-stretch','childs-pose','glute-stretch','lying-torso-twist','full-body-stretch']);
  cooldowns.forEach(x=>add(x[0],x[1],{cooldown:true,bodyPosition:floorCooldowns.has(x[0])?'floor':'standing',unilateral:unilateralCooldowns.has(x[0]),prescription:{type:unilateralCooldowns.has(x[0])?'unilateral-timed':'timed',value:15},estimatedSeconds:unilateralCooldowns.has(x[0])?30:15}));
  catalogue['childs-pose'].alternativeGroup='back-lat-stretch';
  catalogue['glute-stretch'].alternativeGroup='glute-stretch-family';
  add('trx-lean-back-sink', 'TRX lean back and sink', { alternativeGroup:'back-lat-stretch', equipment:[['trx']], cooldown:true, prescription:{type:'timed',value:15}, estimatedSeconds:15 });
  add('trx-lunge-calf-chest', 'TRX lunge, calf and chest opener', { equipment:[['trx']], cooldown:true, unilateral:true, prescription:{type:'unilateral-timed',value:15}, estimatedSeconds:30 });
  add('trx-glute-standing', 'TRX glute standing', { alternativeGroup:'glute-stretch-family', equipment:[['trx']], cooldown:true, unilateral:true, prescription:{type:'unilateral-timed',value:15}, estimatedSeconds:30 });
  add('trx-side-stretch', 'TRX side stretch', { equipment:[['trx']], movementPlanes:['frontal'], cooldown:true, unilateral:true, prescription:{type:'unilateral-timed',value:15}, estimatedSeconds:30 });

  root.GarageFitData = root.GarageFitData || {};
  root.GarageFitData.exercises = catalogue;
})(window);