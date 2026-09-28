const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
const DURATIONS = [10,15,20,30,45];
const FOCUSES = ['strength','balanced','cardio'];
const KITS = [[],['dumbbells'],['dumbbells','kettlebell','pullup-bar','trx','barbell','bench','box','bands']];
const LOWER = new Set(['hips','knees','ankles']);
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function lowerJoints(ex) { return (ex.warmupAreas||[]).filter(area=>LOWER.has(area)).length; }
function meaningful(ex) { return lowerJoints(ex)>=2; }
function upperTrunkOnly(ex) { return lowerJoints(ex)===0; }
function each(fn) {
  for (const duration of DURATIONS) for (const focus of FOCUSES) for (const equipment of KITS) for (let seed=1;seed<=8;seed++) {
    fn(GarageFitGenerator.generate({catalogue,duration,focus,equipment,random:random(seed*31+duration)}),{duration,focus,equipment,seed});
  }
}
const label = (ctx, workout) => `${ctx.duration}/${ctx.focus}/${ctx.equipment.join('+')||'none'}/${ctx.seed}: ${workout.warmup.exercises.map(ex=>ex.id).join(', ')}`;

test('30-minute warm-up gains one exercise of budget taken from Main; Ramp-up and Cool-down unchanged', () => {
  const b = GarageFitGenerator.BUDGETS;
  assert.deepEqual(b[30], {warmup:175,rampup:120,main:1325,cooldown:180});
  assert.deepEqual(b[45], {warmup:225,rampup:160,main:2015,cooldown:300});
  // Phase totals are unchanged from the previous allocation (150+120+1350+180 and 200+160+2040+300).
  assert.equal(b[30].warmup+b[30].rampup+b[30].main+b[30].cooldown, 1800);
  assert.equal(b[45].warmup+b[45].rampup+b[45].main+b[45].cooldown, 2700);
  // Shorter durations keep their existing allocation.
  assert.deepEqual(b[10], {warmup:65,rampup:55,main:420,cooldown:60});
  assert.deepEqual(b[15], {warmup:100,rampup:80,main:600,cooldown:120});
  assert.deepEqual(b[20], {warmup:115,rampup:95,main:870,cooldown:120});
});

test('warm-up exercise count scales across every duration and focus', () => {
  const expected = {10:3,15:4,20:5,30:7,45:9};
  each((workout,ctx) => {
    assert.equal(workout.warmup.exercises.length, expected[ctx.duration], label(ctx,workout));
    assert.ok(Math.abs(workout.warmup.estimatedSeconds-GarageFitGenerator.BUDGETS[ctx.duration].warmup)<=10, label(ctx,workout));
  });
});

test('generated workouts stay within total-duration tolerance for every duration and focus', () => {
  each((workout,ctx) => {
    // Same tolerance the existing Main/duration tests use.
    const minutes = workout.estimatedSeconds/60;
    assert.ok(Math.abs(minutes-ctx.duration)<=Math.max(3,ctx.duration*.18), `${label(ctx,workout)} total ${minutes}`);
  });
});

test('warm-ups never include high-impact exercises', () => {
  each((workout,ctx) => assert.ok(!workout.warmup.exercises.some(ex=>ex.impact==='high'), label(ctx,workout)));
});

test('warm-ups include duration-appropriate meaningful lower-body preparation', () => {
  each((workout,ctx) => {
    const count = workout.warmup.exercises.filter(meaningful).length;
    const minimum = ctx.duration>=30 ? 2 : 1;
    assert.ok(count>=minimum, `${label(ctx,workout)} meaningful ${count}`);
  });
});

test('medium and long warm-ups are not dominated by shoulder/trunk-only preparation', () => {
  each((workout,ctx) => {
    const exercises = workout.warmup.exercises;
    const upper = exercises.filter(upperTrunkOnly).length;
    if (ctx.duration>=20) assert.ok(upper<=Math.floor(exercises.length/2), `${label(ctx,workout)} upper/trunk-only ${upper}`);
    else assert.ok(upper<=Math.ceil(exercises.length/2), `${label(ctx,workout)} upper/trunk-only ${upper}`);
  });
});

test('body hoops and other trunk/shoulder mobility never count as lower-body preparation', () => {
  for (const id of ['body-hoops','body-twists','arm-circles-forwards','arm-circles-backwards','arm-side-circles','band-pull-apart','hangout-pullup-bar']) {
    assert.equal(meaningful(catalogue[id]), false, id);
  }
});

test('lower-body Main demand is derived from existing patterns and raises the lower-body target', () => {
  const lowerMain = ['goblet-squat','dumbbell-romanian-deadlift','dumbbell-reverse-lunge'].map(id=>catalogue[id]);
  const upperMain = ['push-up','single-arm-dumbbell-row','dumbbell-shoulder-press'].map(id=>catalogue[id]);
  const conditioningMain = ['jumping-jacks','mountain-climbers','push-up'].map(id=>catalogue[id]);
  assert.equal(GarageFitGenerator.lowerBodyDemand(lowerMain,'strength'), 1);
  assert.equal(GarageFitGenerator.lowerBodyDemand(upperMain,'strength'), 0);
  assert.ok(GarageFitGenerator.lowerBodyDemand(conditioningMain,'cardio') > GarageFitGenerator.lowerBodyDemand(conditioningMain,'balanced'));
  // 10/15 minutes: one; 20: one, two with lower-body Main; 30: two; 45: two, three with lower-body Main.
  for (const focus of FOCUSES) {
    assert.equal(GarageFitGenerator.lowerPrepTarget(3,1,focus), 1);
    assert.equal(GarageFitGenerator.lowerPrepTarget(4,1,focus), 1);
    assert.equal(GarageFitGenerator.lowerPrepTarget(5,0,focus), 1);
    assert.equal(GarageFitGenerator.lowerPrepTarget(5,1,focus), 2);
    assert.equal(GarageFitGenerator.lowerPrepTarget(7,0,focus), 2);
    assert.equal(GarageFitGenerator.lowerPrepTarget(9,0,focus), 2);
    assert.equal(GarageFitGenerator.lowerPrepTarget(9,1,focus), 3);
  }
});

test('lower-body Main demand increases lower-body warm-up preparation for every focus', () => {
  const lowerMain = ['goblet-squat','dumbbell-romanian-deadlift','dumbbell-reverse-lunge'].map(id=>catalogue[id]);
  const upperMain = ['push-up','single-arm-dumbbell-row','dumbbell-shoulder-press'].map(id=>catalogue[id]);
  for (const focus of FOCUSES) for (const budget of [115,175,225]) {
    let lower=0, upper=0;
    for (let seed=1;seed<=40;seed++) {
      const withLower = GarageFitGenerator.selectWarmup(catalogue,budget,['dumbbells'],lowerMain,random(seed),{focus}).exercises;
      const withUpper = GarageFitGenerator.selectWarmup(catalogue,budget,['dumbbells'],upperMain,random(seed),{focus}).exercises;
      const minimum = budget>=175 ? 2 : 1;
      assert.ok(withUpper.filter(meaningful).length>=minimum, `${focus} ${budget} upper Main`);
      assert.ok(withLower.filter(meaningful).length>=minimum+(budget===175?0:1), `${focus} ${budget} lower Main: ${withLower.map(ex=>ex.id).join(', ')}`);
      lower+=withLower.filter(meaningful).length; upper+=withUpper.filter(meaningful).length;
    }
    assert.ok(lower>upper, `${focus} ${budget}: ${lower} <= ${upper}`);
  }
});

test('balanced 30-minute warm-ups pair lower-body preparation with upper/trunk mobility', () => {
  for (let seed=1;seed<=60;seed++) {
    const warmup = GarageFitGenerator.generate({catalogue,duration:30,focus:'balanced',equipment:['dumbbells','kettlebell','trx','pullup-bar'],random:random(seed)}).warmup.exercises;
    assert.ok(warmup.filter(meaningful).length>=2, warmup.map(ex=>ex.id).join(', '));
    assert.ok(warmup.some(upperTrunkOnly), warmup.map(ex=>ex.id).join(', '));
  }
});

test('warm-up still progresses by preparation intensity into Ramp-up', () => {
  each((workout,ctx) => {
    const warmup = workout.warmup.exercises;
    for (let i=1;i<warmup.length;i++) assert.ok(warmup[i].prepIntensity>=warmup[i-1].prepIntensity, label(ctx,workout));
    const lastWarmup = warmup[warmup.length-1], firstRamp = workout.rampup.exercises[0];
    if (firstRamp) assert.ok(firstRamp.prepIntensity>=lastWarmup.prepIntensity-1, `${label(ctx,workout)} > ${firstRamp.id}`);
  });
});

test('seeded generation remains deterministic', () => {
  for (const duration of DURATIONS) for (const focus of FOCUSES) {
    const a = GarageFitGenerator.generate({catalogue,duration,focus,equipment:[],random:random(7)});
    const b = GarageFitGenerator.generate({catalogue,duration,focus,equipment:[],random:random(7)});
    assert.deepEqual(a.warmup.exercises.map(ex=>ex.id), b.warmup.exercises.map(ex=>ex.id));
    assert.deepEqual(a.rampup.exercises.map(ex=>ex.id), b.rampup.exercises.map(ex=>ex.id));
  }
});

test('swapping a warm-up exercise preserves lower-body coverage and regional balance', () => {
  for (let seed=1;seed<=30;seed++) {
    const workout = GarageFitGenerator.generate({catalogue,duration:30,focus:'balanced',equipment:[],random:random(seed)});
    for (let index=0;index<workout.warmup.exercises.length;index++) {
      GarageFitGenerator.swapPreparation(workout,'warmup',index,{catalogue,equipment:[],random:random(seed+index)});
      const warmup = workout.warmup.exercises;
      assert.ok(warmup.filter(meaningful).length>=2, warmup.map(ex=>ex.id).join(', '));
      assert.ok(warmup.filter(upperTrunkOnly).length<=Math.floor(warmup.length/2), warmup.map(ex=>ex.id).join(', '));
      assert.ok(!warmup.some(ex=>ex.impact==='high'));
    }
  }
});
