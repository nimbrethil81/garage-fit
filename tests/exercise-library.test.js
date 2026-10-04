const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadAppContext}=require('./helpers/app-context');

test('More opens the complete canonical Exercise Library and keeps the bottom navigation with More selected',()=>{
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
  const names=list.children.map(li=>li.children[0].children.find(c=>c.className==='library-name').textContent);
  assert.deepEqual(names,names.slice().sort((a,b)=>a.localeCompare(b)));
  assert.ok(names.includes('Air squat'));
  app.showScreen('more');
  assert.equal(app.document.getElementById('bottomNav').classList.contains('hidden'),false);
  assert.equal(app.document.getElementById('moreNav').classList.contains('active'),true);
  assert.equal(app.document.getElementById('workoutsNav').classList.contains('active'),false);
  assert.doesNotMatch(html,/closeMore/);
  assert.match(html,/<main id="more"[^>]*>\s*<div class="home-header">\s*<div class="brand"/);
  assert.equal((html.match(/<h1 class="screen-title">/g)||[]).length,4);
});

test('name search, equipment alternatives, bodyweight and combined filters',()=>{
  const app=loadAppContext();app.openExerciseLibrary();
  const search=app.document.getElementById('librarySearch'),filter=app.document.getElementById('libraryEquipment'),list=app.document.getElementById('libraryList');
  const visible=()=>list.children.map(li=>li.children[0].children.find(c=>c.className==='library-name').textContent);
  search.value='RoW';app.renderExerciseLibrary();
  assert.ok(visible().length>0);assert.ok(visible().every(name=>name.toLowerCase().includes('row')));
  filter.value='trx';app.renderExerciseLibrary();
  assert.ok(visible().length>0);assert.ok(visible().every(name=>name.toLowerCase().includes('row')&&name.toLowerCase().includes('trx')));
  search.value='';filter.value='bodyweight';app.renderExerciseLibrary();
  assert.ok(visible().includes('Air squat'));
  assert.ok(list.children.every(li=>li.children[0].children[2].textContent===', Bodyweight'));
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

test('library rows show a primary equipment icon and keep full equipment meaning accessible',()=>{
  const app=loadAppContext(),catalogue=app.GarageFitData.exercises,icons=app.GarageFitEquipmentIcons;
  app.openExerciseLibrary();
  const rows=app.document.getElementById('libraryList').children.map(li=>li.children[0]);
  assert.equal(rows.length,Object.keys(catalogue).length);
  for(const row of rows){
    assert.deepEqual(row.children.map(c=>c.className),['equipment-icon','library-name','sr-only']);
    assert.match(row.children[0].innerHTML,/^<svg /);
    assert.equal(row.children[0].attributes['aria-hidden'],'true');
  }
  const byName=name=>rows.find(r=>r.children[1].textContent===name);
  assert.match(byName('Air squat').children[0].innerHTML,/<circle cx="12" cy="5"/);
  assert.match(byName('Air squat').children[2].textContent,/Bodyweight/);
  assert.equal(rows.some(r=>r.children.some(c=>c.tagName==='SMALL')),false);
  const multi=Object.values(catalogue).find(e=>e.equipment.length>1||e.equipment.some(g=>g.length>1));
  const row=rows.find(r=>r.children[1].textContent===multi.name);
  assert.equal((row.children[0].innerHTML.match(/<svg /g)||[]).length,1);
  assert.equal(row.children[2].textContent,', '+app.libraryEquipmentLabel(multi));
  assert.equal(icons.primaryEquipmentId({equipment:[['dumbbells'],['bench']]}),'dumbbells');
  assert.equal(icons.primaryEquipmentId({equipment:[['bench','box']]}),'bench');
});

test('every canonical equipment id and bodyweight has a reusable icon; unknown ids have none',()=>{
  const app=loadAppContext(),icons=app.GarageFitEquipmentIcons;
  for(const id of ['bodyweight',...app.GarageFitData.equipment.map(e=>e.id)]){
    assert.ok(icons.has(id),id);
    assert.match(icons.svg(id),/viewBox="0 0 24 24".*stroke="currentColor"/);
  }
  assert.equal(icons.svg('nope'),'');
  const used=new Set(Object.values(app.GarageFitData.exercises).flatMap(e=>e.equipment.flat()));
  for(const id of used)assert.ok(icons.has(id),id);
});

test('the retired kettlebell farmer carry is absent from the library, search and equipment filter; the dumbbell one remains',()=>{
  const app=loadAppContext();app.openExerciseLibrary();
  const search=app.document.getElementById('librarySearch'),filter=app.document.getElementById('libraryEquipment'),list=app.document.getElementById('libraryList');
  const names=()=>list.children.map(li=>li.children[0].children.find(c=>c.className==='library-name').textContent);
  assert.ok(!names().includes('Kettlebell farmer carry'));
  search.value='farmer';app.renderExerciseLibrary();
  assert.deepEqual(names(),['Dumbbell farmer carry']);
  filter.value='kettlebell';app.renderExerciseLibrary();
  assert.equal(list.children.length,0);
});
