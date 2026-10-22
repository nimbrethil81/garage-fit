const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadAppContext}=require('./helpers/app-context');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const section=html.match(/<main id="workoutPatterns"[\s\S]*?<\/main>/)[0];
const entries=[...section.matchAll(/<details id="pattern-([a-z-]+)"[^>]*><summary><span class="pattern-name">([^<]+)<\/span>[\s\S]*?<\/details>/g)];

test('More lists Workout Patterns beside Exercise Library and navigates there and back',()=>{
  const more=html.match(/<main id="more"[\s\S]*?<\/main>/)[0];
  assert.match(more,/onclick="showScreen\('workoutPatterns'\)"[^>]*>[\s\S]*Workout Patterns →<\/span><\/button>/);
  assert.doesNotMatch(more,/Learn how different workouts work|library-entry-note/);
  assert.match(more,/openExerciseLibrary\(\)/);
  assert.match(section,/aria-label="Back to More" onclick="appBack\(\)"/);
  const app=loadAppContext();
  app.openMore();app.showScreen('workoutPatterns');
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
  const names=entries.map(match=>match[2]);
  assert.deepEqual(names,generated.map(id=>display[id]));
  assert.equal(entries.length,9);
  assert.doesNotMatch(section,/paired_sets|timed_intervals|\brounds\b protocol/);
});

test('each entry is a native disclosure with the four required sections',()=>{
  for(const [block,id,name] of entries){
    assert.match(block,/<summary>/,name);
    assert.match(block,/<summary><span class="pattern-name">[^<]+<\/span><\/summary>/,`${name}: collapsed card shows name only`);
    for(const heading of ['What is it?','How does it work?','Why does GarageFit use it?','Example'])assert.ok(block.includes(`<h3>${heading}</h3>`),`${name}: ${heading}`);
    assert.doesNotMatch(block,/<details[^>]*\bopen\b/,`${name} starts collapsed`);
  }
  assert.equal((section.match(/<details /g)||[]).length,9);
  assert.doesNotMatch(section,/<select|<input|type="radio"|type="checkbox"/);
});

test('copy matches current EMOM, Superset, Density and AMRAP behaviour',()=>{
  const body=id=>entries.find(match=>match[1]===id)[0];
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
