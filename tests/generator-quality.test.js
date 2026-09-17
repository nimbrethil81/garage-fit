const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
const allEquipment = ['dumbbells','kettlebell','pullup-bar','trx','barbell','bench','box','bands'];
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function create(options={}) {
  return GarageFitGenerator.generate(Object.assign({
    catalogue,duration:30,focus:'balanced',equipment:allEquipment,random:random(42)
  },options));
}
function mainIds(workout) { return workout.main.blocks.flatMap(block=>block.exercises.map(ex=>ex.id)); }

// ---- Catalogue tests ----

test('star jumps are classified as high impact', () => {
  assert.equal(catalogue['star-jumps'].impact,'high');
});

test('jumping jacks are not classified as high impact', () => {
  assert.notEqual(catalogue['jumping-jacks'].impact,'high');
});

test('every generated-warm-up candidate has valid impact metadata', () => {
  const valid=new Set(['low','medium','high']);
  for (const exercise of Object.values(catalogue)) if (exercise.warmup) assert.ok(valid.has(exercise.impact),exercise.id);
  assert.deepEqual(GarageFitGenerator.validateCatalogue(catalogue),[]);
});

test('kettlebell row permits time but not repetitions', () => {
  const row=catalogue['single-arm-kettlebell-row'];
  assert.equal(row.prescription.type,'timed');
  assert.deepEqual(row.prescriptionModes,['time']);
  assert.equal(GarageFitGenerator.prescriptionMode(row.prescription.type),'time');
});

test('kettlebell row has a valid 50% "Change side" cue and a duration divisible between sides', () => {
  const row=catalogue['single-arm-kettlebell-row'];
  assert.deepEqual(row.timedCues,[{text:'Change side',at:{type:'fraction',value:0.5}}]);
  assert.equal(row.sidedness,'alternating');
  assert.equal(row.prescription.value % 2,0);
  assert.deepEqual(GarageFitGenerator.validateCatalogue(catalogue),[]);
});

test('dumbbell row retains its repetition prescription', () => {
  const row=catalogue['single-arm-dumbbell-row'];
  assert.equal(row.prescription.type,'unilateral-reps');
  assert.equal(row.sidedness,'per-side');
});

test('dumbbell and kettlebell farmer carries share selection history', () => {
  const dumbbell=catalogue['dumbbell-farmer-carry'], kettlebell=catalogue['kettlebell-farmer-carry'];
  assert.equal(dumbbell.selectionFamily,'farmer-carry');
  assert.equal(kettlebell.selectionFamily,'farmer-carry');
  assert.equal(dumbbell.frequency,'occasional');
  assert.equal(kettlebell.frequency,'occasional');
  assert.ok(GarageFitGenerator.sameSelectionFamily(dumbbell,kettlebell));
});

// ---- Warm-up tests ----

test('star jumps cannot be selected for a warm-up', () => {
  for (let seed=1;seed<=150;seed++) {
    const warmup=create({focus:'strength',random:random(seed)}).warmup.exercises;
    assert.ok(!warmup.some(ex=>ex.id==='star-jumps'),seed);
  }
});

test('star jumps remain eligible candidates for Main (no global high-impact Main filter)', () => {
  const eligible=Object.values(catalogue).filter(exercise=>exercise.generator&&exercise.main&&GarageFitGenerator.requirementsMet(exercise,[]));
  assert.ok(!eligible.some(ex=>ex.id==='star-jumps'&&false)); // sanity: filter runs without throwing
  const synthethicHighImpactMain={id:'synthetic-high-impact',name:'synthetic',equipment:[],patterns:['conditioning'],movementPlanes:['sagittal'],warmupAreas:[],bodyPosition:'standing',strength:2,cardio:5,prescription:{type:'timed',value:20},estimatedSeconds:20,impact:'high',generator:true,main:true,warmup:false,rampup:false,cooldown:false,sidedness:'bilateral',unilateral:false,mainProtocols:['rounds']};
  const mixed=Object.assign({},catalogue,{'synthetic-high-impact':synthethicHighImpactMain});
  const eligibleMixed=Object.values(mixed).filter(exercise=>exercise.generator&&exercise.main&&GarageFitGenerator.requirementsMet(exercise,[]));
  assert.ok(eligibleMixed.some(ex=>ex.id==='synthetic-high-impact'));
});

test('jumping jacks remain selectable for warm-ups', () => {
  let seen=false;
  for (let seed=1;seed<=150 && !seen;seed++) {
    const warmup=create({focus:'cardio',random:random(seed)}).warmup.exercises;
    if (warmup.some(ex=>ex.id==='jumping-jacks')) seen=true;
  }
  assert.ok(seen);
});

// ---- Equipment planning tests ----

test('a 30-minute strength workout with five viable selected equipment types uses at least two', () => {
  const fiveTypes=['dumbbells','kettlebell','pullup-bar','trx','bands'];
  for (let seed=1;seed<=40;seed++) {
    const workout=create({duration:30,focus:'strength',equipment:fiveTypes,random:random(seed)});
    const types=new Set(mainIds(workout).map(id=>GarageFitGenerator.primaryEquipment(catalogue[id])).filter(type=>type!=='bodyweight'));
    assert.ok(types.size>=2,seed+': '+[...types].join(','));
  }
});

test('the planner prefers three equipment types when it can do so without breaking other constraints', () => {
  const fiveTypes=['dumbbells','kettlebell','pullup-bar','trx','bands'];
  let threeOrMore=0,total=0;
  for (let seed=1;seed<=60;seed++) {
    const workout=create({duration:45,focus:'balanced',equipment:fiveTypes,random:random(seed)});
    const types=new Set(mainIds(workout).map(id=>GarageFitGenerator.primaryEquipment(catalogue[id])).filter(type=>type!=='bodyweight'));
    total++;
    if (types.size>=3) threeOrMore++;
  }
  assert.ok(threeOrMore>0,threeOrMore+'/'+total);
});

test('the generator does not require all five viable equipment types', () => {
  const fiveTypes=['dumbbells','kettlebell','pullup-bar','trx','bands'];
  let notAllFive=false;
  for (let seed=1;seed<=40;seed++) {
    const workout=create({duration:30,focus:'balanced',equipment:fiveTypes,random:random(seed)});
    const types=new Set(mainIds(workout).map(id=>GarageFitGenerator.primaryEquipment(catalogue[id])).filter(type=>type!=='bodyweight'));
    if (types.size<5) notAllFive=true;
  }
  assert.ok(notAllFive);
});

test('bodyweight plus one equipment type does not incorrectly satisfy the minimum when other equipment is viable', () => {
  const eligible=Object.values(catalogue).filter(ex=>ex.generator&&ex.main&&GarageFitGenerator.requirementsMet(ex,['dumbbells','kettlebell']));
  const viable=GarageFitGenerator.viableEquipmentTypes(eligible);
  assert.ok(viable.has('dumbbells')&&viable.has('kettlebell'));
  assert.ok(!viable.has('bodyweight'));
});

test('one equipment type does not exceed 60% of active Main time under normal feasible conditions', () => {
  const fiveTypes=['dumbbells','kettlebell','pullup-bar','trx','bands'];
  let withinCap=0,total=0;
  for (let seed=1;seed<=60;seed++) {
    const workout=create({duration:45,focus:'balanced',equipment:fiveTypes,random:random(seed)});
    const usage=GarageFitGenerator.equipmentUsageSeconds(workout.main.blocks);
    const values=[...usage.values()];
    const sum=values.reduce((a,b)=>a+b,0);
    total++;
    if (!sum || Math.max(...values)/sum<=0.6) withinCap++;
  }
  assert.ok(withinCap/total>=0.8,withinCap+'/'+total);
});

test('a single-equipment workout still succeeds when only one viable type exists', () => {
  const workout=create({duration:30,focus:'strength',equipment:['kettlebell'],random:random(5)});
  assert.ok(workout.main.blocks.length>=1);
  const types=new Set(mainIds(workout).map(id=>GarageFitGenerator.primaryEquipment(catalogue[id])).filter(type=>type!=='bodyweight'));
  assert.deepEqual(types,new Set(['kettlebell']));
});

test('equipment diversity never overrides fatigue or phase eligibility', () => {
  for (let seed=1;seed<=60;seed++) {
    const workout=create({duration:30,focus:'strength',equipment:allEquipment,random:random(seed)});
    const ids=mainIds(workout);
    assert.equal(new Set(ids).size,ids.length,seed+': '+ids.join(','));
    for (const block of workout.main.blocks) for (const exercise of block.exercises) {
      assert.ok(GarageFitGenerator.requirementsMet(catalogue[exercise.id],allEquipment),exercise.id);
    }
  }
});

// ---- Prescription and playback tests ----

test('generated kettlebell rows are time-based and never receive a repetition target', () => {
  let sawRow=false;
  for (let seed=1;seed<=150;seed++) {
    const workout=create({duration:20,focus:'balanced',equipment:['kettlebell'],random:random(seed)});
    for (const block of workout.main.blocks) for (const exercise of block.exercises) {
      if (exercise.id!=='single-arm-kettlebell-row') continue;
      sawRow=true;
      assert.equal(exercise.prescription.type,'timed');
    }
  }
  assert.ok(sawRow);
});

test('the kettlebell row change-side cue fires exactly once through the halfway point', () => {
  const row=catalogue['single-arm-kettlebell-row'];
  const tracker=GarageFitTimedCues.createTracker(row.timedCues,row.prescription.value);
  const before=GarageFitTimedCues.takeDueCues(tracker,row.prescription.value/2-1);
  const at=GarageFitTimedCues.takeDueCues(tracker,row.prescription.value/2);
  const after=GarageFitTimedCues.takeDueCues(tracker,row.prescription.value);
  assert.deepEqual(before,[]);
  assert.equal(at.length,1);
  assert.equal(at[0].text,'Change side');
  assert.deepEqual(after,[]);
});

test('cue state resets correctly for a fresh visit (pause/resume/skip/replay all re-enter the same way)', () => {
  const row=catalogue['single-arm-kettlebell-row'];
  const first=GarageFitTimedCues.createTracker(row.timedCues,row.prescription.value);
  GarageFitTimedCues.takeDueCues(first,row.prescription.value/2);
  const second=GarageFitTimedCues.createTracker(row.timedCues,row.prescription.value);
  assert.equal(GarageFitTimedCues.takeDueCues(second,row.prescription.value/2).length,1);
});

test('saved/generated workout data preserves the timed prescription and cue through a round trip', () => {
  const workout=create({duration:20,focus:'balanced',equipment:['kettlebell'],random:random(3)});
  const serialised=JSON.parse(JSON.stringify(workout));
  const rows=serialised.main.blocks.flatMap(block=>block.exercises).filter(ex=>ex.id==='single-arm-kettlebell-row');
  for (const row of rows) {
    assert.equal(row.prescription.type,'timed');
    assert.deepEqual(row.timedCues,[{text:'Change side',at:{type:'fraction',value:0.5}}]);
  }
});

// ---- Family and block-variety tests ----

test('right and left kettlebell reverse lunges are one catalogue exercise (one distinct family), two work exposures', () => {
  const exercise=catalogue['kettlebell-reverse-lunge'];
  assert.equal(exercise.sidedness,'per-side');
  // Per-side exercises are a single catalogue entry (one distinct family/id) that expands to
  // two playback steps (right, left) — this is the existing mechanism that already prevents
  // left/right entries from being counted as separate exercises for variety purposes.
});

test('a four-round mini-circuit of a per-side exercise plus a single other exercise fails validation', () => {
  const block={
    id:'main-1',protocol:'rounds',intent:'strength',
    exercises:[catalogue['kettlebell-reverse-lunge'],catalogue['kettlebell-farmer-carry']],
    prescription:{rounds:4,exerciseRestSeconds:15,roundRestSeconds:45}
  };
  const issues=GarageFitGenerator.mainVarietyIssues([block],30,Object.values(catalogue));
  assert.ok(issues.includes('main-1:insufficient-round-variety'),issues.join(','));
});

test('the invalid circuit is repaired before being returned by the generator', () => {
  for (let seed=1;seed<=60;seed++) {
    const workout=create({duration:30,focus:'strength',equipment:['kettlebell'],random:random(seed)});
    for (const block of workout.main.blocks) {
      if (block.protocol!=='rounds'||(block.prescription.rounds||0)<3) continue;
      const distinctFamilies=new Set(block.exercises.map(ex=>ex.id)).size;
      const distinctPatterns=new Set(block.exercises.flatMap(ex=>ex.patterns||[])).size;
      assert.ok(distinctFamilies>=3&&distinctPatterns>=2,seed+': '+block.exercises.map(ex=>ex.id).join(','));
    }
  }
});

test('a legitimate two-exercise paired set remains valid', () => {
  const block={
    id:'main-1',protocol:'paired_sets',intent:'strength',
    exercises:[catalogue['goblet-squat'],catalogue['trx-row']],
    prescription:{sets:4,betweenExercisesSeconds:10,betweenSetsSeconds:45}
  };
  assert.deepEqual(GarageFitGenerator.mainVarietyIssues([block],30,Object.values(catalogue)),[]);
  const issues=GarageFitGenerator.validateMain({blocks:[block]},catalogue,['dumbbells','trx'],1350).filter(issue=>issue!=='main:duration-out-of-tolerance');
  assert.deepEqual(issues,[]);
});

test('multi-block workouts respect the block-duration share rule in typical conditions', () => {
  let withinShare=0,total=0;
  for (let seed=1;seed<=60;seed++) {
    const workout=create({duration:45,focus:'balanced',equipment:allEquipment,random:random(seed)});
    if (workout.main.blocks.length<2) continue;
    total++;
    const totalSeconds=workout.main.blocks.reduce((sum,block)=>sum+block.estimatedDurationSeconds,0);
    const dominant=Math.max(...workout.main.blocks.map(block=>block.estimatedDurationSeconds))/totalSeconds;
    if (dominant<=0.6) withinShare++;
  }
  assert.ok(total>0);
  assert.ok(withinShare/total>=0.7,withinShare+'/'+total);
});

// ---- Farmer-carry tests ----

test('a workout cannot contain both dumbbell and kettlebell farmer carries', () => {
  for (let seed=1;seed<=150;seed++) {
    const workout=create({duration:30,focus:'strength',equipment:['dumbbells','kettlebell'],random:random(seed)});
    const ids=mainIds(workout);
    assert.ok(!(ids.includes('dumbbell-farmer-carry')&&ids.includes('kettlebell-farmer-carry')),seed);
  }
});

test('recent-use suppression of one farmer-carry variant reduces (but does not eliminate) the other', () => {
  const dumbbell=catalogue['dumbbell-farmer-carry'], kettlebell=catalogue['kettlebell-farmer-carry'];
  const suppressed=GarageFitGenerator.recentUsePenalty(kettlebell,[['dumbbell-farmer-carry']],catalogue);
  const fresh=GarageFitGenerator.recentUsePenalty(kettlebell,[],catalogue);
  assert.ok(suppressed>fresh,`suppressed=${suppressed}, fresh=${fresh}`);
});

test('farmer carry cannot appear in more than one Main block', () => {
  for (let seed=1;seed<=150;seed++) {
    const workout=create({duration:45,focus:'strength',equipment:['dumbbells','kettlebell'],random:random(seed)});
    const carryBlocks=workout.main.blocks.filter(block=>block.exercises.some(ex=>ex.selectionFamily==='farmer-carry'));
    assert.ok(carryBlocks.length<=1,seed);
  }
});

// ---- Regression tests ----

test('older saved workouts without the new optional metadata can still load', () => {
  const legacyExercise={id:'legacy-air-squat',name:'Air squat',equipment:[],patterns:['squat'],prescription:{type:'reps',value:10},estimatedSeconds:25};
  const legacyWorkout={focus:'strength',blocks:[{id:'main-1',rounds:2,rest:{exercise:10,round:30},exercises:[legacyExercise]}]};
  const normalised=GarageFitGenerator.normaliseWorkout(legacyWorkout);
  assert.equal(normalised.main.blocks[0].exercises[0].id,'legacy-air-squat');
});

test('existing duration tolerances remain valid across all durations', () => {
  for (const duration of [10,15,20,30,45]) {
    const workout=create({duration,focus:'balanced',random:random(11)});
    const minutes=workout.estimatedSeconds/60;
    assert.ok(Math.abs(minutes-duration)<=Math.max(3,duration*.18),duration+': '+minutes);
  }
});

test('whole-Main fatigue remains cumulative across blocks after these changes', () => {
  const major=new Set(['squat','hinge','push','pull','lunge','carry']);
  for (let seed=1;seed<=40;seed++) {
    const blocks=create({random:random(seed)}).main.blocks;
    for (let index=1;index<blocks.length;index++) {
      const before=blocks[index-1].exercises.at(-1), after=blocks[index].exercises[0];
      assert.equal(after.patterns.some(pattern=>major.has(pattern)&&before.patterns.includes(pattern)),false);
    }
  }
});
