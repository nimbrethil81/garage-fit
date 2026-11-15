const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {loadAppContext}=require('./helpers/app-context');
const deltas=require('./helpers/metadata-407-deltas.json');
const copy=x=>JSON.parse(JSON.stringify(x));
function rng(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const equipment=['dumbbells','kettlebell','pullup-bar','trx','rings','barbell','bench','box','bands'];
function setup(){const app=loadAppContext(new Map(),{rampupUi:true});return {app,G:app.GarageFitGenerator,C:app.GarageFitData.exercises,H:app.GarageFitData.historicalExerciseDefinitions};}
function historical(s,options,seed=31){
  const old={...s.C,...s.H};s.app.GarageFitData.exercises=old;
  try{
    const workout=s.G.generate({...options,catalogue:old,equipment,random:rng(seed)});
    delete workout.exerciseCatalogueVersion;
    for(const block of workout.main.blocks)delete block.exerciseCatalogueVersion;
    assert.equal(s.G.validateFamilyWorkout(workout,{catalogue:old,equipment}).valid,true);
    return workout;
  }finally{s.app.GarageFitData.exercises=s.C;}
}
test('#407 has exactly 73 approved deltas and preserves every other catalogue field',()=>{
  const {C,H}=setup(),before=copy(C);
  assert.equal(deltas.length,73);assert.equal(Object.keys(H).length,67);
  for(const {id,field,from,to} of deltas){assert.equal(C[id][field],to);assert.equal(H[id][field],from);before[id][field]=from;}
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex'),'2427a6f6a90182d0e650cb20a9967ccef8ef4d5afce23a18c2e46a7a97e2a462');
  assert.equal(Object.keys(H).filter(id=>C[id].warmup).length,7);
  assert.equal(Object.keys(H).filter(id=>C[id].rampup).length,10);
  assert.equal(deltas.filter(({id})=>C[id].rampup).length,11); // Eleven edits across ten exercises.
  for(const id of Object.keys(H)){assert.equal(C[id].main,true);assert.equal(C[id].generator,true);assert.equal(C[id].cooldown,false);assert.deepEqual(copy(H[id]),before[id]);}
});
test('#407 complete historical family definitions preserve validation and player/tracker work across published versions',()=>{
  const s=setup();
  for(const [family,version,duration,difficulty] of [
    ['cardio-conditioning',1,30,'normal'],['cardio-conditioning',1,10,'easy'],
    ['strength-control',1,20,'normal'],['strength-control',2,20,'normal'],['strength-control',3,20,'normal'],
    ['core-stability',1,20,'normal'],['full-body-challenges',1,20,'normal'],
    ['mobility-movement-quality',1,20,'normal'],['mobility-movement-quality',2,20,'normal'],['mobility-movement-quality',3,20,'normal'],
    ...[1,2,3,4,5].map(version=>['athletic-movement',version,20,'normal'])]){
    const options={workoutFamilyId:family,workoutFamilyVersion:version,duration,difficulty};
    const workout=historical(s,options),snapshot=copy(workout);
    s.app.GarageFitData.exercises={...s.C,...s.H};
    const before=copy(s.app.buildGeneratedTimeline(workout));s.app.GarageFitData.exercises=s.C;
    assert.equal(s.G.validateFamilyWorkout(workout,{catalogue:s.C,equipment}).valid,true,JSON.stringify(options));
    const after=copy(s.app.buildGeneratedTimeline(workout));assert.deepEqual(after,before);assert.deepEqual(copy(workout),snapshot);
    const current=s.G.generate({...options,catalogue:s.C,equipment,random:rng(31)});
    assert.equal(current.exerciseCatalogueVersion,2);assert.equal(s.G.validateFamilyWorkout(current,{catalogue:s.C,equipment}).valid,true);
    for(const block of current.main.blocks){assert.equal(block.exerciseCatalogueVersion,2);for(const ex of block.exercises)assert.deepEqual(copy(ex),copy(s.C[ex.id]));}
  }
});
test('#407 rejects mixed definitions, unauthorised fields and historical exceptions on current records',()=>{
  const s=setup(),w=historical(s,{workoutFamilyId:'strength-control',workoutFamilyVersion:3,duration:30,difficulty:'normal'},2);
  const changed=w.main.blocks.flatMap(b=>b.exercises).find(ex=>s.H[ex.id]&&deltas.filter(d=>d.id===ex.id).length>1);
  // A controlled fixture with multiple corrections exercises cross-field era mixing.
  const block=w.main.blocks.find(b=>b.exercises.some(ex=>s.H[ex.id]));assert.ok(block);
  const target=block.exercises.find(ex=>s.H[ex.id]);
  for(const mutate of [ex=>ex.strength=1,ex=>ex.impact='high',ex=>ex.equipment=[],ex=>ex.prescription.value=99,ex=>ex.instruction+=' edited',ex=>ex.unapproved=true]){
    const edited=copy(w),ex=edited.main.blocks.flatMap(b=>b.exercises).find(ex=>ex.id===target.id);mutate(ex);
    assert.equal(s.G.validateFamilyWorkout(edited,{catalogue:s.C,equipment}).valid,false);
  }
  const marked=copy(w);marked.exerciseCatalogueVersion=2;marked.main.blocks.forEach(b=>b.exerciseCatalogueVersion=2);
  assert.equal(s.G.validateFamilyWorkout(marked,{catalogue:s.C,equipment}).valid,false);
  const unknown=copy(w);unknown.exerciseCatalogueVersion=99;assert.equal(s.G.validateFamilyWorkout(unknown,{catalogue:s.C,equipment}).valid,false);
  const mixed=copy(w);mixed.main.blocks[0].exerciseCatalogueVersion=2;assert.equal(s.G.validateFamilyWorkout(mixed,{catalogue:s.C,equipment}).valid,false);
  assert.ok(changed,'seed 2 includes a multi-delta historical definition');
  {const edited=copy(w),ex=edited.main.blocks.flatMap(b=>b.exercises).find(ex=>ex.id===changed.id),delta=deltas.find(d=>d.id===ex.id);ex[delta.field]=delta.to;assert.equal(s.G.validateFamilyWorkout(edited,{catalogue:s.C,equipment}).valid,false);}
});
test('#407 retains the existing separation of evolving preparation declarations from saved Main',()=>{
  const s=setup(),workout=historical(s,{workoutFamilyId:'strength-control',workoutFamilyVersion:3,duration:30,difficulty:'normal'});
  const ex=workout.main.blocks.flatMap(b=>b.exercises).find(ex=>s.H[ex.id]);assert.ok(ex);
  ex.warmup=!ex.warmup;
  assert.equal(s.G.validateFamilyWorkout(workout,{catalogue:s.C,equipment}).valid,true);
});

test('#407 Coach historical planned work recovers durable outcomes without regenerating or upgrading family identity',async()=>{
  const {pilot}=require('./helpers/coach-pilot');
  const p=pilot(new Map(),'general-fitness',2,{rampupUi:true});
  // Create the draft against the published era, including its exact planned targets.
  p.run('Object.assign(CATALOGUE,GarageFitData.historicalExerciseDefinitions)');
  await p.start();await p.begin();
  const draft=await p.run('pilotStore.loadSessionDraft()'),planned=copy(draft.plannedWork);
  const work=planned.find(item=>item.section==='main');assert.ok(work);
  await p.run(`pilotTracker.recordDone(${JSON.stringify(work.occurrenceId)})`);
  const reload=pilot(p.storage,'general-fitness',2,{rampupUi:true});await reload.run('pilot.load()');
  const result=reload.json('pilot.snapshot().results[0]');
  assert.deepEqual(result.plannedWork,planned);
  assert.equal(result.workoutFamilyId,draft.workoutFamilyId);assert.equal(result.workoutFamilyVersion,draft.workoutFamilyVersion);
  assert.equal(result.finalStatus,'partial');assert.equal(result.performedWork.length,1);
  assert.equal(await reload.run('pilotStore.loadSessionDraft()'),null);
  await reload.begin();
  assert.equal(reload.run('pilot.snapshot().preview.workout.exerciseCatalogueVersion'),2);
});

test('#407 historical lookup cannot restore identities excluded from a supplied catalogue',()=>{
  const s=setup(),workout=historical(s,{workoutFamilyId:'strength-control',workoutFamilyVersion:3,duration:30,difficulty:'normal'});
  const ids=[...new Set(workout.main.blocks.flatMap(b=>b.exercises).filter(ex=>s.H[ex.id]).map(ex=>ex.id))];
  assert.ok(ids.length>1,'another affected entry still triggers historical resolution');
  const restricted={...s.C};delete restricted[ids[0]];
  assert.equal(s.G.validateFamilyWorkout(workout,{catalogue:restricted,equipment}).valid,false);
});
