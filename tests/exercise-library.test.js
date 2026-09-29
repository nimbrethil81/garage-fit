const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadAppContext}=require('./helpers/app-context');

test('More opens the complete canonical Exercise Library and returns to its originating tab',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.match(html,/id="moreNav"[^>]*onclick="openMore\(\)"/);
  assert.match(html,/id="librarySearch"[^>]*type="search"/);
  assert.match(html,/id="libraryEquipment"[^>]*onchange="renderExerciseLibrary\(\)"/);
  const app=loadAppContext(),catalogue=app.GarageFitData.exercises;
  app.showLanding('workouts');app.openMore();
  assert.equal(app.document.getElementById('more').classList.contains('hidden'),false);
  app.openExerciseLibrary();
  const list=app.document.getElementById('libraryList');
  assert.equal(list.children.length,Object.keys(catalogue).length);
  const names=list.children.map(li=>li.children[0].children[0].textContent);
  assert.deepEqual(names,names.slice().sort((a,b)=>a.localeCompare(b)));
  assert.ok(names.includes('Air squat'));
  app.showScreen('more');app.closeMore();
  assert.equal(app.document.getElementById('workouts').classList.contains('hidden'),false);
});

test('name search, equipment alternatives, bodyweight and combined filters',()=>{
  const app=loadAppContext();app.openExerciseLibrary();
  const search=app.document.getElementById('librarySearch'),filter=app.document.getElementById('libraryEquipment'),list=app.document.getElementById('libraryList');
  const visible=()=>list.children.map(li=>li.children[0].children[0].textContent);
  search.value='RoW';app.renderExerciseLibrary();
  assert.ok(visible().length>0);assert.ok(visible().every(name=>name.toLowerCase().includes('row')));
  filter.value='trx';app.renderExerciseLibrary();
  assert.ok(visible().length>0);assert.ok(visible().every(name=>name.toLowerCase().includes('row')&&name.toLowerCase().includes('trx')));
  search.value='';filter.value='bodyweight';app.renderExerciseLibrary();
  assert.ok(visible().includes('Air squat'));
  assert.ok(list.children.every(li=>li.children[0].children[1].textContent==='Bodyweight'));
  search.value='does not exist';app.renderExerciseLibrary();
  assert.equal(list.children.length,0);
  assert.equal(app.document.getElementById('libraryEmpty').classList.contains('hidden'),false);
  for(const exercise of Object.values(app.GarageFitData.exercises))for(const group of exercise.equipment)for(const id of group){
    search.value=exercise.name;filter.value=id;app.renderExerciseLibrary();
    assert.ok(visible().includes(exercise.name),`${exercise.name} should match ${id}`);
  }
});

test('detail shows canonical instruction and readable equipment and contexts, including exercises without instructions',()=>{
  const app=loadAppContext(),catalogue=app.GarageFitData.exercises;
  app.openExerciseLibrary();app.openExerciseDetail('walking-lunge');
  assert.equal(app.document.getElementById('libraryDetailInstruction').textContent,catalogue['walking-lunge'].instruction);
  assert.equal(app.document.getElementById('libraryInstructionSection').classList.contains('hidden'),false);
  assert.match(app.document.getElementById('libraryDetailContexts').textContent,/Main workout/);
  app.openExerciseDetail('air-squat');
  assert.equal(app.document.getElementById('libraryInstructionSection').classList.contains('hidden'),true);
  assert.equal(app.document.getElementById('libraryDetailEquipment').textContent,'Bodyweight');
  assert.match(app.document.getElementById('libraryDetailContexts').textContent,/Warm-up.*Ramp-up/);
  const loaded=Object.values(catalogue).find(ex=>ex.equipment.length);
  app.openExerciseDetail(loaded.id);
  assert.equal(app.document.getElementById('libraryDetailEquipment').textContent,app.libraryEquipmentLabel(loaded));
  assert.doesNotMatch(app.document.getElementById('libraryDetailEquipment').textContent,/\[|\]|voiceInstruction|family|strength/);
  assert.match(app.libraryContexts(catalogue['childs-pose']),/Fixed workouts|Cool-down/);
});
