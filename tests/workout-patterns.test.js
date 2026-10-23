const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadAppContext}=require('./helpers/app-context');

const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const section=html.match(/<main id="workoutPatterns"[\s\S]*?<\/main>/)[0];
const detailSection=html.match(/<main id="workoutPatternDetail"[\s\S]*?<\/main>/)[0];
const patternsOf=app=>JSON.parse(vm.runInContext('JSON.stringify(WORKOUT_PATTERNS)',app));
const el=(app,id)=>app.document.getElementById(id);

test('More lists Workout Patterns beside Exercise Library and navigates there and back',()=>{
  const more=html.match(/<main id="more"[\s\S]*?<\/main>/)[0];
  assert.match(more,/onclick="openWorkoutPatterns\(\)"[^>]*>[\s\S]*Workout Patterns →<\/span><\/button>/);
  assert.doesNotMatch(more,/Learn how different workouts work|library-entry-note/);
  assert.match(more,/openExerciseLibrary\(\)/);
  assert.match(section,/aria-label="Back to More" onclick="appBack\(\)"/);
  const app=loadAppContext();
  app.openMore();app.openWorkoutPatterns();
  assert.equal(app.document.getElementById('workoutPatterns').classList.contains('hidden'),false);
  assert.equal(app.document.getElementById('more').classList.contains('hidden'),true);
  assert.equal(app.document.getElementById('bottomNav').classList.contains('hidden'),true);
  app.showScreen('more');
  assert.equal(app.document.getElementById('workoutPatterns').classList.contains('hidden'),true);
  assert.equal(app.document.getElementById('moreNav').classList.contains('active'),true);
  app.openExerciseLibrary();
  assert.equal(app.document.getElementById('exerciseLibrary').classList.contains('hidden'),false);
});

test('guide has nine entries: every generated Main protocol by display name, including AMRAP',()=>{
  const app=loadAppContext(),generated=[...app.GarageFitGenerator.GENERATED_PROTOCOLS];
  const display={rounds:'Mini-circuit',paired_sets:'Superset',timed_intervals:'Timed intervals',emom:'EMOM',ladder:'Ladder',pyramid:'Pyramid',complex:'Complex',density:'Density',amrap:'AMRAP'};
  assert.deepEqual(generated.slice().sort(),Object.keys(display).sort(),'guide must be updated when generated protocols change');
  const patterns=patternsOf(app);
  assert.deepEqual(patterns.map(p=>p.name),generated.map(id=>display[id]));
  assert.equal(patterns.length,9);
  assert.doesNotMatch(JSON.stringify(patterns),/paired_sets|timed_intervals|\brounds\b protocol/);
});

test('list renders nine whole-card Exercise Library-style entries without chevrons or disclosure',()=>{
  const app=loadAppContext();app.openWorkoutPatterns();
  const list=el(app,'patternList'),rows=list.children.map(li=>li.children[0]);
  assert.equal(rows.length,9);
  rows.forEach((button,i)=>{
    assert.equal(button.type,'button');assert.equal(button.className,'library-row');
    assert.equal(button.children.length,1);assert.equal(button.children[0].textContent,patternsOf(app)[i].name);
  });
  assert.match(section,/<ul class="library-list" id="patternList">/);
  assert.doesNotMatch(section+detailSection,/<details|<summary|→|›|⌄|chevron|pattern-item/);
  assert.doesNotMatch(html,/\.pattern-(item|body|name)|pattern-list/);
});

test('each pattern opens the one reusable detail view with name and the four sections',()=>{
  const app=loadAppContext();app.openWorkoutPatterns();
  const patterns=patternsOf(app);
  assert.equal((detailSection.match(/<h1 id="patternDetailName">/g)||[]).length,1);
  assert.match(detailSection,/aria-label="Back to Workout Patterns" onclick="appBack\(\)"/);
  patterns.forEach((pattern,i)=>{
    el(app,'patternList').children[i].children[0].onclick();
    assert.equal(el(app,'workoutPatternDetail').classList.contains('hidden'),false);
    assert.equal(el(app,'workoutPatterns').classList.contains('hidden'),true);
    assert.equal(el(app,'patternDetailName').textContent,pattern.name);
    const sections=el(app,'patternDetailSections').children;
    assert.deepEqual(sections.map(s=>s.children[0].textContent),['What is it?','How does it work?','Why does GarageFit use it?','Example']);
    assert.deepEqual(sections.map(s=>s.children[1].textContent),[...pattern.sections]);
    sections.forEach(s=>{assert.equal(s.className,'library-detail-section');assert.ok(s.children[1].textContent.length>20)});
    app.showScreen('workoutPatterns');
  });
  // Teal headings and long-title safety are shared with the Exercise Library styles.
  assert.match(html,/\.library-detail-section h2\{[^}]*color:var\(--rest\)/);
  assert.match(html,/#exerciseDetail \.page-header h1,#workoutPatternDetail \.page-header h1\{[^}]*overflow-wrap:anywhere/);
});

test('back navigation goes detail to list to More and restores list scroll',()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true});
  const run=code=>vm.runInContext(code,app);
  app.openMore();app.openWorkoutPatterns();
  el(app,'workoutPatterns').scrollTop=240;
  el(app,'patternList').children[3].children[0].onclick();
  assert.equal(run('currentScreen'),'workoutPatternDetail');
  assert.equal(run('backNav.canGoBack()'),true);
  run('appBack()');
  assert.equal(run('currentScreen'),'workoutPatterns');
  assert.equal(el(app,'workoutPatterns').scrollTop,240);
  run('appBack()');
  assert.equal(run('currentScreen'),'more');
});

test('copy matches current EMOM, Superset, Density and AMRAP behaviour',()=>{
  const app0=loadAppContext(),ids=['mini-circuit','superset','timed-intervals','emom','ladder','pyramid','complex','density','amrap'];
  assert.deepEqual(patternsOf(app0).map(p=>p.id),ids);
  const body=id=>patternsOf(app0).find(p=>p.id===id).sections.join(' ');
  assert.match(body('emom'),/rest until the next minute/);
  assert.match(body('emom'),/skip the rest[\s\S]*fresh one-minute window/);
  assert.match(body('superset'),/A then B|A, change over to B/);
  assert.match(body('superset'),/rest only after the pair/);
  assert.match(body('density'),/not as-many-rounds-as-possible/);
  assert.match(body('density'),/time cap/);
  assert.match(body('pyramid'),/TRX/);
  const amrap=body('amrap');
  assert.match(amrap,/Cindy/);
  // Generated AMRAP (#221): Balanced/Cardio and optional Coach conditioning, 2–3 exercises, 3–8 minutes, no score.
  assert.doesNotMatch(amrap,/does not yet choose AMRAP|Cindy only/);
  assert.match(amrap,/Generated Balanced and Cardio workouts, including optional Coach conditioning/);
  assert.match(amrap,/two or three exercises lasting 3 to 8 minutes/);
  assert.match(amrap,/tap Next after each exercise/);
  assert.match(amrap,/When time is up, finish or skip the exercise you are on, then move on/);
  assert.match(amrap,/Generated AMRAP blocks keep no score/);
  const policy=loadAppContext().GarageFitGenerator.AMRAP_POLICY;
  assert.deepEqual([policy.minExercises,policy.maxExercises,policy.minCapSeconds/60,policy.maxCapSeconds/60],[2,3,3,8]);
  const cindy=loadAppContext().GarageFitData.fixedWorkouts.cindy;
  assert.equal(cindy.termination.type,'amrap');
  assert.match(amrap,new RegExp(`${cindy.termination.durationSeconds/60}-minute AMRAP of 5 pull-ups, 10 push-ups and 15 air squats`));
  assert.deepEqual([...cindy.exercises.map(e=>e.reps)],[5,10,15]);
});
