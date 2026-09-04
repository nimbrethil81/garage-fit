const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
function random(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function create(options = {}) {
  return GarageFitGenerator.generate(Object.assign({
    catalogue,
    duration: 20,
    focus: 'balanced',
    equipment: [],
    random: random(42)
  }, options));
}

test('catalogue supports required AND and OR equipment rules', () => {
  assert.equal(GarageFitGenerator.requirementsMet(catalogue['dumbbell-bench-press'], ['dumbbells']), false);
  assert.equal(GarageFitGenerator.requirementsMet(catalogue['dumbbell-bench-press'], ['dumbbells','bench']), true);
  assert.equal(GarageFitGenerator.requirementsMet(catalogue['step-ups'], ['bench']), true);
  assert.equal(GarageFitGenerator.requirementsMet(catalogue['step-ups'], ['box']), true);
  assert.equal(GarageFitGenerator.requirementsMet(catalogue['step-ups'], []), false);
});

test('bodyweight generation never invents equipment or a Pull role', () => {
  for (const focus of ['strength','balanced','cardio']) {
    const workout = create({focus, equipment: [], random: random(focus.length)});
    for (const exercise of workout.blocks[0].exercises) {
      assert.deepEqual(exercise.equipment, []);
      assert.equal(exercise.patterns.includes('pull'), false);
    }
  }
});

test('generated sessions approximately fit every requested duration and focus', () => {
  for (const duration of [10,15,20,30,45]) {
    for (const focus of ['strength','balanced','cardio']) {
      const workout = create({duration, focus, equipment: ['dumbbells','bench','kettlebell'], random: random(duration + focus.length)});
      const minutes = workout.estimatedSeconds / 60;
      assert.ok(Math.abs(minutes-duration) <= Math.max(3,duration*.18), `${duration} ${focus} generated ${minutes.toFixed(1)} minutes`);
      assert.equal(workout.blocks.length, 1);
    }
  }
});

test('Cardio selection avoids consecutive high-impact movements', () => {
  for (let seed=1;seed<=50;seed++) {
    const exercises=create({focus:'cardio',equipment:[],random:random(seed)}).blocks[0].exercises;
    assert.equal(exercises.some((exercise,index)=>index>0 && exercise.impact==='high' && exercises[index-1].impact==='high'),false);
  }
});

test('Strength selection normally separates exercises with overlapping movement patterns', () => {
  let adjacentOverlaps=0;
  let adjacentPairs=0;
  for (let seed=1;seed<=100;seed++) {
    const exercises=create({duration:15,focus:'strength',equipment:['kettlebell'],random:random(seed)}).blocks[0].exercises;
    for (let index=1;index<exercises.length;index++) {
      adjacentPairs++;
      if (exercises[index].patterns.some(pattern=>exercises[index-1].patterns.includes(pattern))) adjacentOverlaps++;
    }
    const ids=exercises.map(exercise=>exercise.id);
    const cleanAndPress=ids.indexOf('kettlebell-clean-and-press');
    const shoulderPress=ids.indexOf('kettlebell-shoulder-press');
    assert.notEqual(Math.abs(cleanAndPress-shoulderPress),1,ids.join(', '));
  }
  assert.ok(adjacentOverlaps/adjacentPairs < .1,`${adjacentOverlaps}/${adjacentPairs} adjacent pairs overlap`);
});

test('recent completed workout receives a strong but non-blocking penalty', () => {
  const first=create({equipment:['dumbbells'],random:random(9)});
  const firstIds=first.blocks[0].exercises.map(exercise=>exercise.id);
  const repeated=create({equipment:['dumbbells'],random:random(9)}).blocks[0].exercises.map(exercise=>exercise.id);
  const withHistory=create({equipment:['dumbbells'],history:[firstIds],random:random(9)}).blocks[0].exercises.map(exercise=>exercise.id);
  assert.deepEqual(repeated,firstIds);
  assert.ok(withHistory.filter(id=>firstIds.includes(id)).length < repeated.length);
});

test('swap preserves eligibility and avoids duplicate workout entries', () => {
  const workout=create({equipment:['dumbbells','bench'],random:random(3)});
  const previous=workout.blocks[0].exercises[0].id;
  GarageFitGenerator.swap(workout,0,{catalogue,equipment:['dumbbells','bench'],random:random(8)});
  const ids=workout.blocks[0].exercises.map(exercise=>exercise.id);
  assert.notEqual(ids[0],previous);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(workout.blocks[0].exercises.every(exercise=>GarageFitGenerator.requirementsMet(exercise,['dumbbells','bench'])));
});

test('catalogue excludes rack-dependent back squats and encodes Right-first unilateral order', () => {
  assert.equal(catalogue['barbell-back-squat'],undefined);
  for (const exercise of Object.values(catalogue).filter(item=>item.unilateral)) assert.deepEqual(exercise.sideOrder,['right','left']);
});

test('30-minute Balanced sessions put weights last in warm-up and separate patterns, including swaps and round boundaries', () => {
  const equipment=['dumbbells','kettlebell','pullup-bar','trx'];
  let weightedCount=0;
  function checkSpacing(exercises) {
    exercises.forEach((exercise,index)=>{
      const next=exercises[(index+1)%exercises.length];
      assert.equal(exercise.patterns.some(pattern=>next.patterns.includes(pattern)),false,`${exercise.id} then ${next.id}`);
    });
  }
  for(let seed=1;seed<=200;seed++) {
    const workout=create({duration:30,focus:'balanced',equipment,random:random(seed)});
    let reachedWeights=false;
    for(const exercise of workout.warmup.exercises) {
      const weighted=exercise.equipment.some(group=>group.some(id=>['dumbbells','kettlebell','barbell'].includes(id)));
      if(weighted) { reachedWeights=true;weightedCount++; }
      else assert.equal(reachedWeights,false);
    }
    checkSpacing(workout.blocks[0].exercises);
    for(let index=0;index<workout.blocks[0].exercises.length;index++) {
      GarageFitGenerator.swap(workout,index,{catalogue,equipment,random:random(seed+index)});
      checkSpacing(workout.blocks[0].exercises);
    }
  }
  assert.ok(weightedCount>0);
});

test('cool-down alternatives replace the legacy stretch and never appear together', () => {
  assert.equal(catalogue['lean-back-sink'],undefined);
  assert.equal(catalogue['childs-pose'].name,"Child's pose");
  assert.deepEqual(catalogue['childs-pose'].equipment,[]);
  const seen=new Set();
  for(const duration of [10,15,20,30,45]) for(let seed=1;seed<=40;seed++) {
    const workout=create({duration,equipment:['trx'],random:random(seed)});
    const groups=workout.cooldown.exercises.map(ex=>ex.alternativeGroup).filter(Boolean);
    assert.equal(new Set(groups).size,groups.length);
    workout.cooldown.exercises.forEach(ex=>seen.add(ex.id));
  }
  assert.ok(seen.has('childs-pose'));
  assert.ok(seen.has('trx-lean-back-sink'));
});
