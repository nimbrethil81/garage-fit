// Shared Main block fixtures (one per protocol) and the step-trace check used by the
// protocol contract tests. See docs/WORKOUT_PROTOCOLS.md.
const copy = value => JSON.parse(JSON.stringify(value));

// One canonical block per protocol, including per-side work where the protocol allows it.
function blockFixtures(catalogue,{emom=false,ladder=false,pyramid=false,complex=false,density=false}={}) {
  const ex = id => copy(catalogue[id]);
  const blocks={
    rounds: {id: 'main-1', protocol: 'rounds', intent: 'strength',
      exercises: [ex('goblet-squat'), ex('side-plank'), ex('push-up')],
      prescription: {rounds: 3, exerciseRestSeconds: 15, roundRestSeconds: 45}},
    paired_sets: {id: 'main-2', protocol: 'paired_sets', intent: 'strength',
      exercises: [ex('reverse-lunge'), ex('trx-row')],
      prescription: {sets: 3, betweenExercisesSeconds: 10, betweenSetsSeconds: 60}},
    timed_intervals: {id: 'main-3', protocol: 'timed_intervals', intent: 'conditioning',
      exercises: [ex('mountain-climbers'), ex('jumping-jacks')],
      prescription: {workSeconds: 40, transitionSeconds: 20, cycles: 2}}
  };
  // The saved-v2 characterisation deliberately retains its original three blocks.
  if(emom)blocks.emom={id:'main-4',protocol:'emom',intent:'conditioning',exercises:[ex('push-up'),ex('plank')],
    prescription:{minutes:5,slotSeconds:60,targets:[{type:'reps',value:6},{type:'timed',value:20}]}};
  if(ladder)blocks.ladder={id:'main-5',protocol:'ladder',intent:'strength',exercises:[ex('air-squat'),ex('push-up')],
    prescription:{repSteps:[2,4,6,8],exerciseRestSeconds:15,stepRestSeconds:45}};
  if(pyramid)blocks.pyramid={id:'main-6',protocol:'pyramid',intent:'strength',exercises:[ex('trx-row')],
    prescription:{steps:[{reps:4,relativeLoad:'heavier'},{reps:6,relativeLoad:'medium'},{reps:8,relativeLoad:'lighter'}],stepRestSeconds:90}};
  // One standing dumbbell setup; the final movement is timed.
  if(complex)blocks.complex={id:'main-7',protocol:'complex',intent:'accessory',
    exercises:[ex('dumbbell-hammer-curl'),ex('dumbbell-shoulder-press'),ex('dumbbell-wood-chop')],
    prescription:{sequences:3,targets:[{type:'reps',value:8},{type:'reps',value:8},{type:'timed',value:30}],changeoverSeconds:10,sequenceRestSeconds:75}};
  if(density)blocks.density={id:'main-8',protocol:'density',intent:'conditioning',exercises:[ex('push-up'),ex('bicycle-crunch')],
    prescription:{repeats:3,targets:[{type:'reps',value:8},{type:'reps',value:8}],timeCapSeconds:300,exerciseRestSeconds:15,roundRestSeconds:45}};
  return blocks;
}

// A version-2 generated workout in the shape the current Generator produces, with one block
// per protocol. Saved Coach drafts/results reference its occurrences, so its playback is pinned.
function savedWorkoutV2(catalogue) {
  const blocks = Object.values(blockFixtures(catalogue));
  const ex = id => copy(catalogue[id]);
  return {
    schemaVersion: 2, id: 'saved-v2', duration: 30, focus: 'balanced', bodyFocus: 'full-body', difficulty: 'normal',
    warmup: {restSeconds: 5, exercises: [ex('jumping-jacks')]},
    rampup: {restSeconds: 5, exercises: []},
    main: {blocks},
    cooldown: {restSeconds: 5, exercises: [ex('childs-pose')]}
  };
}

// Walk a block's resolved steps. Returns the executable time (exercise steps last their own
// `seconds` when timed, otherwise the exercise's estimatedSeconds; rests last their `seconds`)
// and any violation of the step contract.
function traceBlock(Generator, block) {
  const steps = Generator.resolveBlockSteps(block), problems = [], positions = new Set();
  const shape = Generator.PROTOCOL_SHAPES[block.protocol];
  let seconds = 0;
  if (!steps.length) problems.push('no-steps');
  if (steps.length && steps[0].kind !== 'exercise') problems.push('leading-rest');
  if (steps.length && steps.at(-1).kind !== 'exercise') problems.push('trailing-rest');
  steps.forEach((step, index) => {
    if (step.kind === 'exercise') {
      const exercise = block.exercises[step.exerciseIndex];
      if (!exercise) { problems.push(index+':exercise-index'); return; }
      const position = shape && step[shape.stepKey];
      if (!Number.isInteger(position) || position < 1) problems.push(index+':position');
      const key = step.exerciseIndex+'@'+position;
      if (positions.has(key)) problems.push(index+':duplicate-position:'+key);
      positions.add(key);
      if (step.timed && !(Number.isFinite(step.seconds) && step.seconds > 0)) problems.push(index+':timed-seconds');
      if(block.protocol==='emom'){
        if(step.startsAtSeconds!==index*60||step.endsAtSeconds!==(index+1)*60)problems.push(index+':minute-window');
        seconds+=step.endsAtSeconds-step.startsAtSeconds;
      }else seconds += step.estimatedSeconds ?? (step.timed ? step.seconds : Number(exercise.estimatedSeconds) || 0);
    } else {
      const next = steps[index + 1];
      if (!(Number.isFinite(step.seconds) && step.seconds > 0)) problems.push(index+':rest-seconds');
      if (!next || next.kind !== 'exercise') problems.push(index+':rest-not-before-exercise');
      else if (next.exerciseIndex !== step.nextExerciseIndex) problems.push(index+':rest-next-mismatch');
      seconds += step.seconds;
    }
  });
  // Density reserves its cap, including pacing/recovery slack, rather than estimated work.
  if(block.protocol==='density'&&steps.length)seconds=block.prescription.timeCapSeconds;
  return {steps, seconds, problems};
}

module.exports = {blockFixtures, savedWorkoutV2, traceBlock};
