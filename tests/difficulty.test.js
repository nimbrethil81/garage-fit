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
const mainOf = workout => workout.main.blocks.flatMap(block => block.exercises);

// Bounded deterministic matrix: 4 equipment configs x 2 durations x 3 focuses x 4 seeds = 96 workouts.
function matrix(difficulty) {
  const workouts = [];
  for (const equipment of CONFIGS) for (const duration of [20,45]) for (const focus of ['strength','balanced','cardio']) for (let seed=1;seed<=4;seed++)
    workouts.push(G.generate({ catalogue, duration, focus, equipment, random:random(seed*53+duration), difficulty }));
  return workouts;
}
const generated = {};
const workoutsFor = difficulty => generated[difficulty] || (generated[difficulty] = matrix(difficulty));
function share(workouts, level) {
  const exercises = workouts.flatMap(mainOf);
  return exercises.filter(exercise => exercise.difficulty===level).length / exercises.length;
}
const withoutId = workout => Object.assign({}, workout, { id:null });

// ---- Metadata ----

test('every generated Main and Ramp-up exercise declares a valid difficulty', () => {
  for (const exercise of Object.values(catalogue).filter(item => item.generator || item.rampup))
    assert.ok(G.EXERCISE_DIFFICULTIES.has(exercise.difficulty), exercise.id+' has difficulty '+exercise.difficulty);
  assert.deepEqual([...G.EXERCISE_DIFFICULTIES], ['easy','moderate','hard']);
  for (const level of G.EXERCISE_DIFFICULTIES)
    assert.ok(Object.values(catalogue).some(exercise => exercise.generator && exercise.difficulty===level), 'no generator exercise is '+level);  // Editorial rule: repeated jumping with a flight phase is never easy.
  for (const exercise of Object.values(catalogue).filter(item => item.impact==='high' && item.difficulty!=null))
    assert.notEqual(exercise.difficulty, 'easy', exercise.id);
});

test('difficulty is validated and required when authoring generated exercises', () => {
  const copy = JSON.parse(JSON.stringify(catalogue));
  copy['push-up'].difficulty = 'normal';
  assert.ok(G.validateCatalogue(copy).includes('push-up: invalid difficulty "normal"'));
  const definition = { instruction:catalogue.plank.instruction, id:'unrated', name:'Unrated', generator:true, main:true, prescription:{ type:'timed', value:30 },
    patterns:['core'], conditioning:false, strength:2, cardio:2, bodyFocus:'core' };
  assert.throws(() => GarageFitData.buildExerciseCatalogue([definition]), /unrated: generated Main and Ramp-up exercises must declare difficulty/);
  assert.equal(GarageFitData.buildExerciseCatalogue([Object.assign({ difficulty:'easy' }, definition)]).unrated.difficulty, 'easy');
  assert.equal(GarageFitData.buildExerciseCatalogue([{ id:'fixed-only', name:'Fixed only', instruction:catalogue.plank.instruction, main:true, prescription:{ type:'timed', value:30 } }])['fixed-only'].difficulty, null);
});

// ---- Workout option ----

test('workout difficulty defaults to Normal and rejects unknown values', () => {
  assert.deepEqual(G.WORKOUT_DIFFICULTIES, ['easy','normal','hard']);
  assert.equal(G.workoutDifficulty(undefined), 'normal');
  assert.equal(G.workoutDifficulty('Hard'), 'hard');
  assert.throws(() => G.workoutDifficulty('spicy'), /Unknown workout difficulty/);
  const workout = G.generate({ catalogue, duration:20, focus:'balanced', equipment:[], random:random(3) });
  assert.equal(workout.difficulty, 'normal');
});

test('Normal is neutral: no exclusions, no score credit, and identical generation to the default', () => {
  for (const exercise of Object.values(catalogue)) {
    assert.equal(G.difficultyExcluded(exercise,'normal'), false, exercise.id);
    assert.equal(G.difficultyCredit(exercise,'normal'), 0, exercise.id);
  }
  for (const equipment of CONFIGS) for (const duration of [10,30]) for (const focus of ['strength','balanced','cardio']) {
    const options = { catalogue, duration, focus, equipment, history:[['push-up','goblet-squat']] };
    const implicit = G.generate(Object.assign({ random:random(duration+focus.length) }, options));
    const explicit = G.generate(Object.assign({ random:random(duration+focus.length), difficulty:'normal' }, options));
    assert.deepEqual(withoutId(explicit), withoutId(implicit), `${equipment.join('+')||'bodyweight'} ${duration} ${focus}`);
  }
});

// ---- Easy ----

test('Easy excludes hard exercises from Main and Ramp-up and favours easy ones', () => {
  for (const exercise of Object.values(catalogue)) for (const phase of ['main','rampup'])
    assert.equal(G.generatedPhaseEligible(exercise,phase,ALL_EQUIPMENT,'easy'), G.generatedPhaseEligible(exercise,phase,ALL_EQUIPMENT) && exercise.difficulty!=='hard', exercise.id+' '+phase);
  const easy = workoutsFor('easy');
  for (const workout of easy) {
    assert.equal(workout.difficulty, 'easy');
    for (const exercise of mainOf(workout).concat(workout.rampup.exercises)) assert.notEqual(exercise.difficulty, 'hard', exercise.id);
  }
  assert.ok(share(easy,'easy') >= share(workoutsFor('normal'),'easy') + .15, `easy share ${share(easy,'easy')} vs normal ${share(workoutsFor('normal'),'easy')}`);
  // Moderate work stays eligible, so Easy is not limited to the easiest movements.
  assert.ok(share(easy,'moderate') > .2);
});

test('Easy still builds complete workouts of the requested length from bodyweight alone', () => {
  for (const duration of [10,15,20,30,45]) for (const focus of ['strength','balanced','cardio']) {
    const workout = G.generate({ catalogue, duration, focus, equipment:[], random:random(duration*7+focus.length), difficulty:'easy' });
    const minutes = workout.estimatedSeconds/60;
    assert.ok(Math.abs(minutes-duration) <= Math.max(3,duration*.18), `${duration} ${focus} generated ${minutes.toFixed(1)} minutes`);
    assert.ok(workout.warmup.exercises.length && workout.rampup.exercises.length && workout.cooldown.exercises.length);
    assert.deepEqual(G.validateMain(workout.main,catalogue,[],G.BUDGETS[duration].main).filter(issue => issue!=='main:duration-out-of-tolerance'), []);
  }
});

// ---- Hard ----

test('Hard skews Main towards harder exercises without excluding easier ones', () => {
  for (const exercise of Object.values(catalogue)) for (const phase of ['main','warmup','rampup','cooldown'])
    assert.equal(G.generatedPhaseEligible(exercise,phase,ALL_EQUIPMENT,'hard'), G.generatedPhaseEligible(exercise,phase,ALL_EQUIPMENT), exercise.id+' '+phase);
  const hard = workoutsFor('hard'), normal = workoutsFor('normal');
  assert.ok(share(hard,'hard') >= share(normal,'hard') + .1, `hard share ${share(hard,'hard')} vs normal ${share(normal,'hard')}`);
  assert.ok(share(hard,'easy') + share(hard,'moderate') > .3, 'easier exercises remain part of Hard workouts');
  assert.ok(hard.filter(workout => mainOf(workout).some(exercise => exercise.difficulty==='easy')).length > hard.length/4);
});

test('Hard keeps variety and fatigue safeguards ahead of its preference', () => {
  const majors = new Set(['squat','hinge','push','pull','lunge','carry']);
  const adjacentHighImpact = workouts => workouts.reduce((sum,workout) => {
    const exercises = mainOf(workout);
    return sum + exercises.slice(1).filter((exercise,index) => exercise.impact==='high' && exercises[index].impact==='high').length;
  }, 0);
  for (const workout of workoutsFor('hard')) {
    const exercises = mainOf(workout);
    assert.equal(new Set(exercises.map(exercise => exercise.id)).size, exercises.length, 'repeated Main exercise');
    for (let index=1;index<exercises.length;index++)
      assert.equal(G.sharedPatterns(exercises[index-1],exercises[index]).some(pattern => majors.has(pattern)), false, exercises[index-1].id+' > '+exercises[index].id);
    assert.deepEqual(G.mainVarietyIssues(workout.main.blocks,workout.duration,Object.values(catalogue).filter(exercise => G.generatedPhaseEligible(exercise,'main',[]))).filter(issue => issue.startsWith('main:family-cap')), []);
  }
  assert.ok(adjacentHighImpact(workoutsFor('hard')) <= adjacentHighImpact(workoutsFor('normal')));
  // The preference is withheld from a high-impact candidate that would follow high-impact work
  // (read from labelled scores, or the stronger Hard Cardio candidate filter).
  let withheld = 0, credited = 0;
  for (let seed=1;seed<=12;seed++) G.generate({ catalogue, duration:30, focus:'cardio', equipment:[], random:random(seed), difficulty:'hard', trace:event => {
    if (event.type!=='pick' || event.phase!=='main') return;
    for(const stage of event.stages||[])if(stage.label==='cardio-impact-recovery'){
      withheld+=stage.removed.length;
      assert.ok(stage.removed.every(exercise=>exercise.impact==='high'));
      assert.ok(event.scored.every(({exercise})=>exercise.impact!=='high'));
    }
    for (const { exercise } of event.scored) {
      const parts = event.explain(exercise);
      if (parts['adjacent-high-impact']) { withheld++; assert.equal(parts.difficulty, undefined, exercise.id); }
      else if (parts.difficulty) credited++;
    }
  } });
  assert.ok(withheld > 0 && credited > 0, `withheld ${withheld}, credited ${credited}`);
});

// ---- Swaps ----

test('swaps keep the workout difficulty', () => {
  for (let seed=1;seed<=6;seed++) {
    const easy = G.generate({ catalogue, duration:30, focus:'strength', equipment:ALL_EQUIPMENT, random:random(seed), difficulty:'easy' });
    easy.main.blocks.forEach((block,blockIndex) => block.exercises.forEach((_,exerciseIndex) => {
      G.swap(easy,blockIndex,exerciseIndex,{ catalogue, equipment:ALL_EQUIPMENT, random:random(seed*11+exerciseIndex) });
      assert.notEqual(easy.main.blocks[blockIndex].exercises[exerciseIndex].difficulty, 'hard');
    }));
    easy.rampup.exercises.forEach((_,index) => {
      G.swapPreparation(easy,'rampup',index,{ catalogue, equipment:ALL_EQUIPMENT, random:random(seed*13+index) });
      assert.notEqual(easy.rampup.exercises[index].difficulty, 'hard');
    });
  }
  let hardSwaps = 0, normalSwaps = 0;
  for (let seed=1;seed<=30;seed++) for (const [difficulty,count] of [['hard',v => hardSwaps+=v],['normal',v => normalSwaps+=v]]) {
    const workout = G.generate({ catalogue, duration:20, focus:'strength', equipment:ALL_EQUIPMENT, random:random(seed) });
    workout.difficulty = difficulty;
    G.swap(workout,0,0,{ catalogue, equipment:ALL_EQUIPMENT, random:random(seed*17) });
    count(workout.main.blocks[0].exercises[0].difficulty==='hard' ? 1 : 0);
  }
  assert.ok(hardSwaps > normalSwaps, `hard swaps ${hardSwaps} vs normal ${normalSwaps}`);
});

// Whole-Main cardiovascular demand, rather than a count of Hard-labelled moves.
test('Hard Cardio rejects the reported Main by work time without banning its exercises', () => {
  const block={protocol:'rounds',exercises:['low-pogo-hops','single-leg-glute-bridge','ski-abs','alternating-lateral-lunge'].map(id=>catalogue[id]),
    prescription:{rounds:3,exerciseRestSeconds:10,roundRestSeconds:30}};
  const result=G.cardioChallenge([block]);
  assert.equal(result.workSeconds,465); // Includes both sides of the 55-second bridge.
  assert.equal(result.conditioningShare,60/155);
  assert.equal(result.suitable,false);
  // Preserve the published-era proxy fixture; its original ratings made this
  // low-impact alternative sufficient. #407 truthfully lowers those ratings.
  // Current generated Hard Cardio adequacy remains asserted in the matrices below.
  const ids=['step-jacks','boxer-step-and-punches','power-march'];
  const lowImpact={...block,exercises:ids.map(id=>GarageFitData.historicalExerciseDefinitions[id])};
  assert.equal(G.cardioChallenge([lowImpact]).suitable,true);
  assert.equal(G.cardioChallenge([{...lowImpact,exercises:ids.map(id=>catalogue[id])}]).suitable,false);
});

test('cardio challenge weights resolved interval, rep and per-side targets rather than rest or slots', () => {
  const bridge=catalogue['single-leg-glute-bridge'],jacks=catalogue['jumping-jacks'];
  const rounds={protocol:'rounds',exercises:[bridge,jacks],prescription:{rounds:1,exerciseRestSeconds:10,roundRestSeconds:30}};
  assert.equal(G.cardioChallenge([rounds]).workSeconds,85);
  const interval={protocol:'timed_intervals',exercises:[jacks],prescription:{cycles:3,workSeconds:20,transitionSeconds:10}};
  assert.equal(G.cardioChallenge([interval]).workSeconds,60);
  const emom={protocol:'emom',exercises:[jacks],prescription:{minutes:3,slotSeconds:60,targets:[{type:'timed',value:20}]}};
  assert.deepEqual(G.validateEmomBlock(emom),[]);
  assert.equal(G.cardioChallenge([emom]).workSeconds,60);
  const changed={...rounds,occurrenceTargets:[{plannedPrescription:{type:'unilateral-reps',value:4}},null]};
  assert.deepEqual(G.validateOccurrenceTargets(changed),[]);
  assert.equal(G.cardioChallenge([changed]).workSeconds,58); // 14 s each side + 30 s jacks.
  const amrap=require('./helpers/protocol-fixtures').blockFixtures(catalogue,{amrap:true}).amrap;
  assert.deepEqual(G.validateAmrapBlock(amrap,catalogue),[]);
  const capped=G.cardioChallenge([amrap]);
  assert.equal(capped.workSeconds,amrap.prescription.capSeconds);
  assert.equal(capped.maxWeakSeconds,amrap.prescription.capSeconds);
  assert.equal(capped.suitable,false);
  const weak={...rounds,exercises:[bridge],prescription:{rounds:3,exerciseRestSeconds:0,roundRestSeconds:30}};
  assert.equal(G.cardioChallenge([weak]).maxWeakSeconds,165);
});

test('Hard Cardio whole-Main quality across durations, equipment and seeds', () => {
  const protocols=new Set();
  for(const duration of [10,15,20,30,45])for(const equipment of [[],['dumbbells'],ALL_EQUIPMENT])for(let seed=1;seed<=8;seed++){
    const workout=G.generate({catalogue,duration,focus:'cardio',difficulty:'hard',equipment,random:random(seed*53+duration)});
    const result=G.cardioChallenge(workout.main.blocks),label=`${duration}m ${equipment.length} equipment seed ${seed}`;
    assert.equal(result.suitable,true,`${label}: ${JSON.stringify(result)}`);
    assert.equal(result.highImpactAdjacency,0,label);
    assert.deepEqual(G.validateMain(workout.main,catalogue,equipment,G.BUDGETS[duration].main),[],label);
    const exercises=mainOf(workout);
    assert.equal(new Set(exercises.map(e=>e.id)).size,exercises.length,label);
    workout.main.blocks.forEach(b=>protocols.add(b.protocol));
  }
  assert.ok(protocols.size>=3,'coverage must include different Main protocols');
});

test('Hard Cardio remains playable with low-impact-only and intensity-infeasible pools', () => {
  for(const kind of ['low-impact','weak-only']){
    const constrained=Object.fromEntries(Object.entries(catalogue).map(([id,e])=>[id,e.generator&&e.main
      &&(kind==='low-impact'?e.impact!=='low':e.conditioning||e.cardio>=4)?{...e,generator:false}:e]));
    let attempts=0;
    const workout=G.generate({catalogue:constrained,duration:15,focus:'cardio',difficulty:'hard',equipment:[],random:random(7),
      trace:event=>{if(event.type==='main-attempt')attempts++;}});
    assert.ok(attempts<=G.HARD_CARDIO_POLICY.maxAttempts);
    assert.deepEqual(G.validateMain(workout.main,constrained,[],G.BUDGETS[15].main),[]);
    const result=G.cardioChallenge(workout.main.blocks);
    // #407 leaves both constrained bodyweight pools below the unchanged 3.8
    // floor. Preserve honest playable fallback, not the obsolete feasibility claim.
    const pool=Object.values(constrained).filter(e=>G.generatedPhaseEligible(e,'main',[],'hard'));
    assert.ok(Math.max(...pool.map(e=>e.cardio))<G.HARD_CARDIO_POLICY.cardioDemand);
    assert.equal(result.suitable,false);
    if(kind==='low-impact')assert.ok(mainOf(workout).every(e=>e.impact==='low'));
    assert.ok(workout.warmup.exercises.length&&workout.rampup.exercises.length&&workout.cooldown.exercises.length);
  }
});

test('#407 Hard Cardio recovery closes repeated blocks safely within the existing attempt bound',()=>{
  const cases=[[10,169],[15,333],[15,386],[30,242],[30,295],[45,98],[45,257],[45,416]];
  let closingRecoveries=0;
  for(const [duration,seed] of cases){
    let attempts=0;
    const options={catalogue,duration,focus:'cardio',difficulty:'hard',equipment:[]};
    const workout=G.generate({...options,random:random(seed),trace:event=>{
      if(event.type==='main-attempt')attempts++;
      if(event.type==='pick'&&event.stages?.some(stage=>stage.label==='cardio-repeat-impact-recovery')){
        assert.ok(attempts>=10,'the original ten attempts keep their construction');
        assert.notEqual(event.picked.impact,'high');
        closingRecoveries++;
      }
    }});
    const quality=G.cardioChallenge(workout.main.blocks),label=`${duration}m seed ${seed}`;
    assert.ok(attempts<=40,label);
    assert.ok(quality.cardioDemand>=3.8,label);
    assert.ok(quality.conditioningShare>=.65,label);
    assert.ok(quality.maxWeakSeconds<=60,label);
    assert.equal(quality.highImpactAdjacency,0,label);
    assert.equal(quality.suitable,true,label);
    assert.deepEqual(G.validateMain(workout.main,catalogue,[],G.BUDGETS[duration].main),[],label);
    assert.deepEqual(withoutId(G.generate({...options,random:random(seed)})),withoutId(workout),label+' deterministic with or without tracing');
  }
  assert.ok(closingRecoveries>0,'the regression exercises closing-edge recovery');
});
