const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const G=GarageFitGenerator;
const catalogue=GarageFitData.exercises;
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const MAJOR=new Set(['squat','hinge','push','pull','lunge','carry']);

// Enumerates rolls evenly across [0,1), so pick counts are proportional to pick weights.
function pickCounts(scored,margin,rolls=4000){
  const counts={};
  for(let i=0;i<rolls;i++){
    const value=(i+.5)/rolls;
    const picked=G.controlledPick(scored,()=>value,margin);
    counts[picked.id]=(counts[picked.id]||0)+1;
  }
  return counts;
}
const item=(id,score)=>({exercise:{id},score});

test('candidates tied at the shortlist cutoff are all shortlisted with equal weight, whatever their catalogue order',()=>{
  const scored=[item('a',10),item('b',9),item('c',8),item('d',7),item('e',7),item('f',7)];
  const forward=pickCounts(scored,0);
  const reversed=pickCounts(scored.slice().reverse(),0);
  for(const counts of [forward,reversed]){
    assert.ok(counts.d>0&&counts.e>0&&counts.f>0,JSON.stringify(counts));
    assert.ok(Math.abs(counts.d-counts.f)<=1&&Math.abs(counts.e-counts.f)<=1,JSON.stringify(counts));
    assert.ok(counts.a>counts.b&&counts.b>counts.c&&counts.c>counts.d,JSON.stringify(counts));
  }
  // Ties higher up share a rank too.
  const top=pickCounts([item('x',10),item('y',10),item('z',5),item('w',4)],0);
  assert.ok(Math.abs(top.x-top.y)<=1,JSON.stringify(top));
});

test('a margin admits near-misses below the cutoff at a lower, score-ordered weight and nothing beyond it',()=>{
  const scored=[item('a',10),item('b',9),item('c',8),item('d',7),item('near',5.5),item('far',2),item('none',1)];
  const strict=pickCounts(scored,0);
  assert.equal(strict.near,undefined);
  const banded=pickCounts(scored,G.SHORTLIST_MARGIN);
  assert.ok(banded.near>0&&banded.near<banded.d,JSON.stringify(banded));
  assert.equal(banded.far,undefined);
  assert.equal(banded.none,undefined);
  assert.ok(banded.a>banded.near*5,JSON.stringify(banded));
  assert.equal(G.controlledPick([],Math.random,G.SHORTLIST_MARGIN),null);
});

// Bounded, deterministic reachability sample: 320 kettlebell and 160 TRX workouts across
// Strength/Balanced at 30 and 45 minutes, where Main has room for primary and supporting work.
// The kettlebell pool is larger because two per-side hinges share its rare unilateral niche.
function sample(equipment,seeds=40){
  const workouts=[];
  for(const focus of ['strength','balanced'])for(const duration of [30,45])for(let seed=1;seed<=seeds;seed++)
    workouts.push(G.generate({catalogue,duration,focus,equipment,random:random(seed*1009+duration*31+focus.length)}));
  return workouts;
}
const mainIds=workout=>workout.main.blocks.flatMap(block=>block.exercises.map(exercise=>exercise.id));
const count=(workouts,id,phase='main')=>workouts.filter(workout=>(phase==='main'?mainIds(workout):workout[phase].exercises.map(ex=>ex.id)).includes(id)).length;
let kettlebell,trx,bodyweight,bands;
function prepareSamples(){
  kettlebell??=sample(['kettlebell'],80);
  trx??=sample(['trx']);
  bodyweight??=sample([]);
  bands??=sample(['bands'],20);
}

test('[Full] Knee to Opposite Elbow is reachable in Warm-up and never leaks into Ramp-up',()=>{
  prepareSamples();
  assert.ok(count(bodyweight,'knee-to-opposite-elbow','warmup')>=2,'cross-body knee warm-up');
  assert.equal(count(bodyweight,'knee-to-opposite-elbow','rampup'),0);
});

test('[Full] primary and supporting Main exercises in dense same-pattern pools are reachable, and supporting work stays secondary',()=>{
  prepareSamples();
  const singleLeg=count(kettlebell,'kettlebell-single-leg-deadlift');
  const suitcase=count(kettlebell,'kettlebell-suitcase-deadlift');
  const twist=count(kettlebell,'kettlebell-russian-twist');
  // C1 expands the full-body pool; one suitable Upper fixture retains the rare
  // shoulder-accessory route without enlarging the distribution sweep.
  const trxWithAccessory=trx.concat(G.generate({catalogue,duration:30,focus:'strength',bodyFocus:'upper',equipment:['trx'],random:random(3)}));
  const yFly=count(trxWithAccessory,'trx-y-fly');
  assert.ok(singleLeg>=3,'kettlebell single-leg deadlift '+singleLeg);
  assert.ok(suitcase>=3,'kettlebell suitcase deadlift '+suitcase);
  assert.ok(twist>=1,'kettlebell Russian twist '+twist);
  assert.ok(yFly>=1,'TRX Y fly '+yFly);
  // Control: supporting entries remain well below their primary peers and are never repeated
  // across a workout's Main blocks.
  assert.ok(twist*4<count(kettlebell,'kettlebell-deadlift'),'twist vs deadlift');
  assert.ok(yFly*4<count(trxWithAccessory,'trx-row'),'Y fly vs row');
  for(const workout of kettlebell.concat(trxWithAccessory))for(const id of ['kettlebell-russian-twist','trx-y-fly'])
    assert.ok(mainIds(workout).filter(item=>item===id).length<=1,mainIds(workout).join(','));
});

test('[Full] the kettlebell halo is reachable in Warm-up, never in Ramp-up, and no Warm-up repeats a major pattern',()=>{
  prepareSamples();
  assert.ok(count(kettlebell,'kettlebell-halo','warmup')>=2,'halo in warm-up');
  assert.equal(count(kettlebell,'kettlebell-halo','rampup'),0);
  for(const workout of kettlebell.concat(trx)){
    const warmup=workout.warmup.exercises;
    for(let i=0;i<warmup.length;i++)for(let j=i+1;j<warmup.length;j++)
      assert.ok(!G.sharedPatterns(warmup[i],warmup[j]).some(pattern=>MAJOR.has(pattern)),warmup.map(ex=>ex.id).join(' > '));
  }
});

test('Ramp-up avoids consecutive high-impact work whenever a lower-impact alternative exists',()=>{
  for(const focus of ['balanced','cardio'])for(const duration of [30,45])for(let seed=1;seed<=20;seed++){
    const ramp=G.generate({catalogue,duration,focus,equipment:[],random:random(seed*104729+duration)}).rampup.exercises;
    for(let i=1;i<ramp.length;i++)assert.ok(!(ramp[i].impact==='high'&&ramp[i-1].impact==='high'),ramp.map(ex=>ex.id).join(' > '));
  }
});

// Warm-up expansion: every new warm-up movement is reachable in a bounded deterministic
// sample for its equipment, and none leaks into Ramp-up.
test('[Full] the warm-up expansion exercises are reachable in Warm-up and never in Ramp-up',()=>{
  prepareSamples();
  const reach={
    bodyweight:['marching-on-the-spot','standing-knee-curls','shallow-knee-bends','heel-toe-rocks','ankle-circles','calf-raises',
      'side-step-touches','leg-swings-forward-back','leg-swings-side','hamstring-sweeps','shoulder-rolls','standing-side-bends','body-hoops'],
    trx:['trx-lateral-weight-shift'],
    bands:['band-external-rotation']
  };
  const pools={bodyweight,trx,bands};
  for(const [pool,ids] of Object.entries(reach))for(const id of ids){
    assert.ok(count(pools[pool],id,'warmup')>=3,id+' in '+pool+' warm-ups: '+count(pools[pool],id,'warmup'));
    assert.equal(count(bodyweight.concat(trx,bands),id,'rampup'),0,id+' in Ramp-up');
  }
  // The essential knee-mobility movement is in every warm-up.
  for(const workout of bodyweight.concat(trx,bands))assert.ok(workout.warmup.exercises.some(ex=>ex.id==='standing-knee-curls'));
});

// Core C1: explicit examples from the full catalogue keep rare legitimate routes
// covered without repeating a large distribution sweep in this suite.
test('Core C1 additions and plank taps reach legacy Main; preparation has its own lighter selectable doses',()=>{
  // Catalogue growth shifts draws; these keep the live catalogue and suitable focus/style routes.
  const fixtures=[
    ['side-plank-knees',[],10,'easy',34],
    ['bent-knee-fallout',[],30,'easy',24],
    ['tabletop-toe-taps',[],20,'easy',4],
    ['dumbbell-suitcase-carry',['dumbbells'],30,'hard',1],
    ['side-plank-hip-lifts',[],30,'hard',10],
    ['supine-heel-slides',[],30,'easy',2],
    ['plank-arm-reaches',[],30,'hard',3],
    ['bridge-march',[],30,'hard',7],
    ['bent-knee-windshield-wipers',[],45,'normal',6,'balanced'],
    ['dead-bug-isometric-press',[],10,'easy',18],
    ['bear-plank-hold',[],30,'hard',18],
    ['seated-knee-tucks',[],30,'hard',1],
    ['kettlebell-suitcase-march',['kettlebell'],30,'hard',1],
    ['half-kneeling-band-pallof-press',['bands'],30,'hard',25],
    ['dumbbell-dead-bug-hold',['dumbbells'],30,'hard',3],
    ['plank-shoulder-taps',[],10,'easy',67]
  ];
  for(const [id,equipment,duration,difficulty,seed,focus='strength'] of fixtures){
    const w=G.generate({catalogue,equipment,duration,difficulty,bodyFocus:'core',focus,random:random(seed)});
    assert.ok(mainIds(w).includes(id),id);
    assert.deepEqual(G.validateMain(w.main,catalogue,equipment),[],id);
  }
  for(const [phase,id,duration,difficulty,seed] of [
    ['warmup','bent-knee-fallout',10,'easy',63],
    ['warmup','supine-heel-slides',15,'easy',21],
    ['warmup','tabletop-toe-taps',30,'easy',19],
    ['rampup','tabletop-toe-taps',20,'easy',12]
  ]){
    const w=G.generate({catalogue,equipment:[],duration,difficulty,bodyFocus:'core',focus:'strength',random:random(seed)});
    assert.ok(w[phase].exercises.some(ex=>ex.id===id),phase+' '+id);
    const ex=catalogue[id],dose=ex[phase+'Prescription'];
    assert.ok(dose.value*(ex.sidedness==='per-side'?2:1)<ex.estimatedSeconds,id+' lighter preparation');
    assert.equal(ex.cooldown,false,id);
  }
});

test('Athletic v5 light tandem placement and split-stance stepping have their own selectable warm-up doses',()=>{
  for(const [id,seed] of [['tandem-step-and-hold',10],['split-stance-step-switches',23]]) {
    const w=G.generate({catalogue,equipment:[],duration:20,focus:'strength',random:random(seed)});
    assert.ok(w.warmup.exercises.some(ex=>ex.id===id),id);
    assert.ok(!w.rampup.exercises.some(ex=>ex.id===id));assert.ok(!w.cooldown.exercises.some(ex=>ex.id===id));
    assert.equal(catalogue[id].warmupPrescription.value,20);
  }
});

test('Mobility v3 crossover reaches only reviewed light preparation and low-load recovery routes (#272)',()=>{
  const fixtures=[['warmup','standing-wall-slides',15],['warmup','standing-hinge-and-reach',40],
    ['cooldown','standing-calf-stretch',12],['cooldown','bent-knee-calf-stretch',10],['cooldown','supine-hamstring-stretch',2]];
  for(const [phase,id,seed] of fixtures) {
    const w=G.generate({catalogue,duration:10,difficulty:'normal',equipment:[],focus:'balanced',random:random(seed)});
    const ex=w[phase].exercises.find(ex=>ex.id===id);assert.ok(ex,id+' actual '+phase);
    assert.equal(G.generatedPhaseEligible(catalogue[id],'main',[]),false,id);
    assert.ok(!w.main.blocks.some(b=>b.exercises.some(ex=>ex.id===id)),id);
    assert.ok(ex.prescription.value>=10&&ex.prescription.value<=40,id+' light effective dose');
    if(phase==='warmup')assert.deepEqual(G.validatePreparation(w.warmup,w.rampup,w.main.blocks.flatMap(b=>b.exercises)),[]);
    else assert.equal(ex.prescription.value,25,id+' default per-side recovery exposure');
  }
});


test('new near-direct recovery alternatives do not duplicate calf or supported hamstring holds (#272)',()=>{
  for(const seed of [3,14]) {
    const w=G.generate({catalogue,equipment:[],duration:45,focus:'balanced',random:random(seed)}),cool=w.cooldown.exercises;
    for(const family of ['standing-calf-stretch','supported-hamstring-stretch'])
      assert.ok(cool.filter(ex=>ex.family===family).length<=1,family+' recovery alternatives');
    assert.deepEqual(G.validateMain(w.main,catalogue,[]),[]);
  }
});
