const test = require('node:test');
const assert = require('node:assert/strict');

global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const catalogue = GarageFitData.exercises;
function random(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function create(options={}) { return GarageFitGenerator.generate(Object.assign({catalogue,duration:20,focus:'balanced',equipment:[],random:random(42)},options)); }

test('catalogue supports required AND and OR equipment rules',()=>{
  assert.equal(GarageFitGenerator.requirementsMet(catalogue['dumbbell-bench-press'],['dumbbells']),false);
  assert.equal(GarageFitGenerator.requirementsMet(catalogue['dumbbell-bench-press'],['dumbbells','bench']),true);
  assert.equal(GarageFitGenerator.requirementsMet(catalogue['step-ups'],['bench']),true);
  assert.equal(GarageFitGenerator.requirementsMet(catalogue['step-ups'],['box']),true);
});

test('preparation catalogue metadata is complete and valid',()=>{
  assert.deepEqual(GarageFitGenerator.validateCatalogue(catalogue),[]);
  for(const exercise of Object.values(catalogue).filter(ex=>ex.warmup||ex.rampup)) assert.equal(GarageFitGenerator.preparationMetadataValid(exercise),true,exercise.id);
});

test('bodyweight generation never invents equipment or a Pull role',()=>{
  for(const focus of ['strength','balanced','cardio']){
    const workout=create({focus,equipment:[],random:random(focus.length)});
    for(const exercise of workout.blocks[0].exercises){assert.deepEqual(exercise.equipment,[]);assert.equal(exercise.patterns.includes('pull'),false);}
    for(const exercise of workout.warmup.exercises.concat(workout.rampup.exercises)) assert.deepEqual(exercise.equipment,[]);
  }
});

test('generated sessions approximately fit every requested duration and focus and include ramp-up',()=>{
  for(const duration of [10,15,20,30,45]) for(const focus of ['strength','balanced','cardio']){
    const workout=create({duration,focus,equipment:['dumbbells','bench','kettlebell'],random:random(duration+focus.length)});
    const minutes=workout.estimatedSeconds/60;
    assert.ok(Math.abs(minutes-duration)<=Math.max(3,duration*.18),`${duration} ${focus} generated ${minutes.toFixed(1)} minutes`);
    assert.ok(workout.warmup.exercises.length>0);
    assert.ok(workout.rampup.exercises.length>0);
    assert.equal(workout.blocks.length,1);
  }
});

test('v1 preparation budgets are focus-independent',()=>{
  const expected={10:[65,55],15:[100,80],20:[115,95],30:[150,120],45:[200,160]};
  for(const [duration,[warmup,rampup]] of Object.entries(expected)){
    assert.equal(GarageFitGenerator.BUDGETS[duration].warmup,warmup);
    assert.equal(GarageFitGenerator.BUDGETS[duration].rampup,rampup);
  }
});

test('ramp-up count scales with duration and uses bounded timed prescriptions',()=>{
  const expected={10:[1,1],15:[1,3],20:[2,3],30:[2,4],45:[3,4]};
  for(const duration of [10,15,20,30,45]){
    for(let seed=1;seed<=20;seed++){
      const ramp=create({duration,equipment:['dumbbells','kettlebell','pullup-bar','trx'],random:random(seed)}).rampup;
      assert.ok(ramp.exercises.length>=expected[duration][0]&&ramp.exercises.length<=expected[duration][1],`${duration}: ${ramp.exercises.length}`);
      for(const ex of ramp.exercises){assert.ok(ex.prescription.type.includes('timed'));assert.ok(ex.prescription.value>=20&&ex.prescription.value<=45,`${ex.id} ${ex.prescription.value}`);}
    }
  }
});

test('ramp-up generally rises in intensity without consecutive high-impact work',()=>{
  let pairs=0,drops=0;
  for(let seed=1;seed<=100;seed++){
    const exercises=create({duration:45,focus:'cardio',equipment:['dumbbells','kettlebell','trx'],random:random(seed)}).rampup.exercises;
    for(let i=1;i<exercises.length;i++){
      pairs++; if(exercises[i].prepIntensity<exercises[i-1].prepIntensity) drops++;
      assert.equal(exercises[i].impact==='high'&&exercises[i-1].impact==='high',false,exercises[i-1].id+'>'+exercises[i].id);
      assert.ok(exercises[i].prepIntensity>=exercises[i-1].prepIntensity-1);
    }
  }
  assert.ok(drops/pairs<.35,`${drops}/${pairs} intensity drops`);
});

test('late ramp-up is at least as main-specific as early ramp-up on average',()=>{
  let early=0,late=0,count=0;
  const specificity=(ex,main)=>main.slice(0,3).reduce((sum,item,index)=>sum+GarageFitGenerator.sharedPatterns(ex,item).length*[1,.6,.3][index],0);
  for(let seed=1;seed<=100;seed++){
    const workout=create({duration:30,focus:'balanced',equipment:['dumbbells','kettlebell','pullup-bar','trx'],random:random(seed)});
    if(workout.rampup.exercises.length<2)continue;
    early+=specificity(workout.rampup.exercises[0],workout.blocks[0].exercises);late+=specificity(workout.rampup.exercises.at(-1),workout.blocks[0].exercises);count++;
  }
  assert.ok(late>=early,`${late}/${count} late vs ${early}/${count} early`);
});

test('ramp-up never hands high-fatigue matching work directly into main',()=>{
  for(let seed=1;seed<=100;seed++){
    const workout=create({duration:30,equipment:['dumbbells','kettlebell','pullup-bar','trx'],random:random(seed)}), last=workout.rampup.exercises.at(-1), first=workout.blocks[0].exercises[0];
    if(GarageFitGenerator.sharedPatterns(last,first).length) assert.ok(last.prepFatigue<=3,last.id+'>'+first.id);
  }
});

test('Cardio main selection avoids consecutive high-impact movements',()=>{
  for(let seed=1;seed<=50;seed++){const exercises=create({focus:'cardio',equipment:[],random:random(seed)}).blocks[0].exercises;assert.equal(exercises.some((exercise,index)=>index>0&&exercise.impact==='high'&&exercises[index-1].impact==='high'),false);}
});

test('Strength main selection normally separates overlapping movement patterns',()=>{
  let adjacentOverlaps=0,adjacentPairs=0;
  for(let seed=1;seed<=100;seed++){
    const exercises=create({duration:15,focus:'strength',equipment:['kettlebell'],random:random(seed)}).blocks[0].exercises;
    for(let index=1;index<exercises.length;index++){adjacentPairs++;if(exercises[index].patterns.some(pattern=>exercises[index-1].patterns.includes(pattern)))adjacentOverlaps++;}
    const ids=exercises.map(exercise=>exercise.id),a=ids.indexOf('kettlebell-clean-and-press'),b=ids.indexOf('kettlebell-shoulder-press');assert.notEqual(Math.abs(a-b),1,ids.join(', '));
  }
  assert.ok(adjacentOverlaps/adjacentPairs<.1,`${adjacentOverlaps}/${adjacentPairs}`);
});

test('recent completed workout receives a strong but non-blocking penalty',()=>{
  const first=create({equipment:['dumbbells'],random:random(9)}),firstIds=first.blocks[0].exercises.map(ex=>ex.id),repeated=create({equipment:['dumbbells'],random:random(9)}).blocks[0].exercises.map(ex=>ex.id),withHistory=create({equipment:['dumbbells'],history:[firstIds],random:random(9)}).blocks[0].exercises.map(ex=>ex.id);assert.deepEqual(repeated,firstIds);assert.ok(withHistory.filter(id=>firstIds.includes(id)).length<repeated.length);
});

test('main swap preserves eligibility and avoids duplicates',()=>{
  const workout=create({equipment:['dumbbells','bench'],random:random(3)}),previous=workout.blocks[0].exercises[0].id;GarageFitGenerator.swap(workout,0,{catalogue,equipment:['dumbbells','bench'],random:random(8)});const ids=workout.blocks[0].exercises.map(ex=>ex.id);assert.notEqual(ids[0],previous);assert.equal(new Set(ids).size,ids.length);
});

test('preparation swap preserves phase eligibility, duration and metadata',()=>{
  for(const section of ['warmup','rampup']){
    const workout=create({duration:30,equipment:['dumbbells','kettlebell','trx'],random:random(7)}),before=workout[section].estimatedSeconds,current=workout[section].exercises[0].id;GarageFitGenerator.swapPreparation(workout,section,0,{catalogue,equipment:['dumbbells','kettlebell','trx'],random:random(13)});const replacement=workout[section].exercises[0];assert.equal(replacement[section],true);assert.equal(GarageFitGenerator.preparationMetadataValid(replacement),true);assert.equal(workout[section].estimatedSeconds,before);assert.notEqual(replacement.id,current);
  }
});

test('cool-down alternatives replace legacy stretch and never appear together',()=>{
  assert.equal(catalogue['lean-back-sink'],undefined);assert.equal(catalogue['childs-pose'].name,"Child's pose");const seen=new Set();for(const duration of [10,15,20,30,45])for(let seed=1;seed<=40;seed++){const workout=create({duration,equipment:['trx'],random:random(seed)});const groups=workout.cooldown.exercises.map(ex=>ex.alternativeGroup).filter(Boolean);assert.equal(new Set(groups).size,groups.length);workout.cooldown.exercises.forEach(ex=>seen.add(ex.id));}assert.ok(seen.has('childs-pose'));assert.ok(seen.has('trx-lean-back-sink'));
});

test('cool-down sequencing groups repeated equipment setups',()=>{
  const equipment=['dumbbells','kettlebell','pullup-bar','trx'];let multiple=0;for(let seed=1;seed<=100;seed++){const exercises=create({duration:30,focus:'strength',equipment,random:random(seed)}).cooldown.exercises,setups=exercises.map(ex=>GarageFitGenerator.sectionSetupKey(ex,equipment)),runs=setups.filter((s,i)=>i===0||s!==setups[i-1]);assert.equal(new Set(runs).size,runs.length,setups.join(', '));if(setups.filter(s=>s==='trx').length>=2)multiple++;}assert.ok(multiple>0);
});
