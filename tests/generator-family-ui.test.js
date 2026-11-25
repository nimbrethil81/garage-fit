const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {loadAppContext}=require('./helpers/app-context');
const run=(app,code)=>vm.runInContext(code,app);
const plain=value=>JSON.parse(JSON.stringify(value));
const el=(app,id)=>app.document.getElementById(id);
function seeded(app){run(app,'Math.random=(seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296})(7)')}

test('Additional options has one registry-driven family group with accessible default and native disabled controls',()=>{
 const app=loadAppContext();app.renderGenerator();app.renderGenerator();
 const buttons=el(app,'familyChoices').children;
 // None / Any plus the seven canonical families; Strength & Stamina (#399) is appended last.
 assert.equal(buttons.length,8);
 assert.equal(buttons[7].textContent,'Strength & Stamina');
 assert.deepEqual(buttons.map(button=>button.textContent),['None / Any',...Object.values(app.GarageFitData.workoutFamilies).map(versions=>versions[1].name)]);
 assert.equal(buttons[0].attributes['aria-pressed'],'true');
 const html=fs.readFileSync('index.html','utf8');
 assert.equal((html.match(/id="familyChoices"/g)||[]).length,1);
 assert.match(html,/id="familyChoices" role="group" aria-labelledby="familyChoicesLabel"/);
 assert.match(html,/id="generatorFamilyError" role="alert" tabindex="-1"/);
});

test('family disables preferences without changing storage and restores them across rerender and workflow navigation',()=>{
 const storage=new Map(),app=loadAppContext(storage);
 app.selectGeneratorFocus('cardio');app.selectGeneratorBodyFocus('upper');
 const before=plain([...storage]);
 for(const family of Object.keys(app.GarageFitData.workoutFamilies)){
  app.selectGeneratorFamily(family);app.renderGenerator();app.showScreen('generatedPreview');app.showLanding('generator');app.openEquipment('generator');app.closeEquipment();
  assert.ok(el(app,'focusChoices').children.every(button=>button.disabled));
  assert.equal(el(app,'bodyFocusChoices').children.every(button=>button.disabled),family!=='strength-control');
  app.selectGeneratorFocus('strength');if(family!=='strength-control')app.selectGeneratorBodyFocus('lower');
  assert.equal(run(app,'generatorState.focus'),'cardio');assert.equal(run(app,'generatorState.bodyFocus'),'upper');
  assert.deepEqual(plain([...storage]),before);
 }
 app.selectGeneratorFamily(null);
 assert.ok(el(app,'focusChoices').children.every(button=>!button.disabled));
 assert.ok(el(app,'bodyFocusChoices').children.every(button=>!button.disabled));
 assert.equal(el(app,'focusChoices').children.find(button=>button.attributes['aria-pressed']==='true').textContent,'Cardio');
 assert.equal(el(app,'bodyFocusChoices').children.find(button=>button.attributes['aria-pressed']==='true').textContent,'Upper');
});

test('family choice is transient; unrelated navigation and reload restore Any without relabelling the workout',()=>{
 const storage=new Map(),app=loadAppContext(storage);app.selectGeneratorFamily('mobility-movement-quality');seeded(app);app.generateWorkout();
 const workout=plain(run(app,'generatorState.workout'));
 app.showLanding('home');assert.equal(run(app,'generatorState.workoutFamilyId'),null);
 assert.deepEqual(plain(run(app,'generatorState.workout')),workout);
 assert.equal(run(loadAppContext(storage),'generatorState.workoutFamilyId'),null);
});

test('Any preserves seeded legacy generation and existing preview copy',()=>{
 const app=loadAppContext();app.selectGeneratorFamily('core-stability');app.selectGeneratorFamily(null);seeded(app);
 const original=app.GarageFitGenerator.generate;let received;
 app.GarageFitGenerator.generate=options=>{received=options;return original(options)};
 app.generateWorkout();assert.ok(!Object.hasOwn(received,'workoutFamilyId'));
 const workout=plain(run(app,'generatorState.workout'));seeded(app);const expected=plain(original({...received}));
 delete workout.id;delete expected.id;assert.deepEqual(workout,expected);
 assert.equal(el(app,'previewKicker').textContent,'20 min · Mixed');
 assert.ok(el(app,'previewFamilyPurpose').classList.contains('hidden'));
});

test('explicit generation uses effective family semantics and actual family/style/description in preview and player',()=>{
 const app=loadAppContext();app.selectGeneratorFocus('cardio');app.selectGeneratorBodyFocus('upper');app.selectGeneratorDuration(15);app.selectGeneratorDifficulty('easy');app.setOwnedEquipment(['dumbbells']);
 for(const id of app.GarageFitWorkoutFamilies.FAMILY_IDS){
  const duration=id==='resistance-endurance'?20:15;
  app.selectGeneratorDuration(duration);app.selectGeneratorFamily(id);seeded(app);app.generateWorkout();
  const workout=run(app,'generatorState.workout'),definition=app.GarageFitWorkoutFamilies.getDefinition(id,workout.workoutFamilyVersion),style=app.GarageFitWorkoutFamilies.getStyle(id,workout.familyStyleId,workout.workoutFamilyVersion);
  assert.equal(workout.workoutFamilyId,id);assert.equal(workout.duration,duration);assert.equal(workout.difficulty,'easy');
  assert.equal(workout.bodyFocus,id==='strength-control'?'upper':'full-body');
  assert.ok(el(app,'previewKicker').textContent.includes(definition.name+' · '+style.name));
  assert.equal(el(app,'previewFamilyPurpose').textContent,app.GarageFitWorkoutFamilies.getDescription(id));
  app.startGeneratedWorkout();assert.ok(el(app,'workoutPlayerTitle').textContent.includes(definition.name+' · '+style.name));
 }
});

test('historical family preview shows the shared description and retains its published identity',()=>{
 const app=loadAppContext();
 const families=app.GarageFitWorkoutFamilies,id='athletic-movement',version=1;
 assert.notEqual(families.currentVersion(id),version);
 const generate=app.GarageFitGenerator.generate;
 app.GarageFitGenerator.generate=options=>generate({...options,workoutFamilyVersion:version});
 app.selectGeneratorFamily(id);seeded(app);app.generateWorkout();
 const workout=run(app,'generatorState.workout');
 assert.equal(workout.workoutFamilyId,id);
 assert.equal(workout.workoutFamilyVersion,version);
 const family=families.getDefinition(id,version),style=families.getStyle(id,workout.familyStyleId,version);
 assert.ok(el(app,'previewKicker').textContent.includes(family.name+' · '+style.name));
 assert.equal(el(app,'previewFamilyPurpose').textContent,families.getDescription(id));
 assert.notEqual(el(app,'previewFamilyPurpose').textContent,family.purpose);
});

test('infeasible Athletic family stays on Generator with verified adjustment and no diagnostic internals',()=>{
 const app=loadAppContext();app.selectGeneratorFamily('athletic-movement');seeded(app);
 // V6 is viable with low-impact/no-room constraints; floor-only is genuinely infeasible.
 const original=app.GarageFitGenerator.generate;app.GarageFitGenerator.generate=options=>original({...options,bodyPositions:['floor']});app.generateWorkout();
 assert.equal(run(app,'currentScreen'),'generator');assert.equal(run(app,'generatorState.workout'),null);
 const message=el(app,'generatorFamilyError');assert.ok(!message.classList.contains('hidden'));
 assert.match(message.textContent,/Athletic Movement is unavailable/);assert.match(message.textContent,/Allow more body positions/);
 assert.doesNotMatch(message.textContent,/familyStyleId|insufficient-eligible|integrated-movement|budget|\(.* s/);
 app.selectGeneratorFamily(null);assert.ok(message.classList.contains('hidden'));
});

test('same-family fallback identifies actual style and explains alternative without exposing diagnostics',()=>{
 const app=loadAppContext();app.selectGeneratorFamily('mobility-movement-quality');seeded(app);app.generateWorkout();
 assert.ok(el(app,'previewFamilyAlternative').classList.contains('hidden'));
 run(app,"generatorState.workout.familyDiagnostics=[{code:'style-quality-failed',detail:'internal-secret'}]");app.renderGeneratedPreview();
 assert.equal(el(app,'previewFamilyAlternative').textContent,'We chose a different workout format to fit your settings.');
 assert.ok(!el(app,'previewFamilyAlternative').classList.contains('hidden'));
});

test('a family that cannot fit the selected time suggests only its verified adjustments',()=>{
 const app=loadAppContext();app.selectGeneratorFamily('mobility-movement-quality');
 const error=new app.GarageFitWorkoutFamilies.FamilyContractError('family-not-feasible','internal-secret');error.reasons=[{code:'phase-cannot-fit',detail:'internal-secret'}];error.adjustments=[{code:'change-duration',value:30},{code:'change-difficulty',value:'easy'}];
 app.GarageFitGenerator.generate=()=>{throw error};app.generateWorkout();
 assert.equal(run(app,'currentScreen'),'generator');assert.match(el(app,'generatorFamilyError').textContent,/We couldn't put together this workout in the time you selected\./);assert.match(el(app,'generatorFamilyError').textContent,/Try 30 minutes\. Try Easy difficulty\./);assert.doesNotMatch(el(app,'generatorFamilyError').textContent,/internal-secret/);
});

test('family errors with no verified adjustment explain only what is known',()=>{
 const app=loadAppContext();app.selectGeneratorFamily('core-stability');
 for(const code of ['insufficient-eligible-movements','missing-essential-practice']){
  assert.match(app.familyFailureMessage({reasons:[{code}]}),/There aren't enough suitable exercises for this workout\.$/);
 }
 assert.equal(app.familyFailureMessage({reasons:[{code:'style-quality-failed'}],adjustments:[{code:'unknown'}]}),
  'Core & Stability is unavailable with these settings.');
});

test('My Equipment explains how to keep workouts bodyweight-only',()=>{
 const app=loadAppContext();app.openEquipment('generator');
 const items=el(app,'equipmentList').children;
 assert.ok(items.length>0&&items.every(item=>item.attributes['aria-pressed']==='false'));
 assert.ok(el(app,'ringsSetupGuidance').classList.contains('hidden'));
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/<p class="equipment-note">You don't need to add a mat here\. Leave equipment unselected for bodyweight workouts\.<\/p>/);
});
