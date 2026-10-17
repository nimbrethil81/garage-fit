const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {loadAppContext}=require('./helpers/app-context');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const screens=[...html.matchAll(/<main id="([^"]+)"[^>]*>([\s\S]*?)<\/main>/g)].map(m=>({id:m[1],body:m[2]}));
const NAV={home:'routinesNav',workouts:'workoutsNav',coach:'coachNav',generator:'generatorNav',more:'moreNav'};
const TITLES={home:'Warm-up &amp; Cool-down',workouts:'Workouts',coach:'Coach',generator:'Workout Generator',more:'More'};

// Primary screens are discovered through the real showScreen() behaviour: those that show the bottom nav.
function classify(app){
  const el=id=>app.document.getElementById(id);
  const primary=[],secondary=[];
  for(const {id} of screens){
    app.showScreen(id);
    (el('bottomNav').classList.contains('hidden')?secondary:primary).push(id);
  }
  return {primary,secondary};
}

test('the five primary tabs are exactly the screens that show the bottom navigation',()=>{
  const {primary,secondary}=classify(loadAppContext());
  assert.deepEqual(primary.sort(),Object.keys(NAV).sort());
  for(const id of ['coachPreview','coachSubstitute','coachResult','player','workoutPlayer','equipment','generatedPreview'])assert.ok(secondary.includes(id),id);
});

test('every primary tab hosts exactly one shared masthead and one page title, and secondary screens none',()=>{
  const {primary,secondary}=classify(loadAppContext());
  for(const {id,body} of screens){
    const hosts=(body.match(/data-masthead/g)||[]).length,titles=[...body.matchAll(/<h1 class="screen-title">([\s\S]*?)<\/h1>/g)].map(match=>[match[0],match[1].replace(/<[^>]+>/g,'')]);
    if(primary.includes(id)){
      assert.equal(hosts,1,id+' masthead host');
      assert.equal(titles.length,1,id+' title count');
      assert.equal(titles[0][1],TITLES[id],id+' title');
    }else{
      assert.equal(hosts,0,id+' is secondary and must not carry the masthead');
    }
  }
  assert.ok(secondary.length>0);
});

test('the logo SVG and wordmark have one canonical source, filled into every host',()=>{
  assert.doesNotMatch(html,/<svg class="brand-mark"|<span class="brand-name"/,'index.html must not duplicate the logo or wordmark');
  assert.equal((html.match(/<script src="js\/masthead\.js">/g)||[]).length,1);
  const app=loadAppContext(),M=app.GarageFitMasthead;
  assert.match(M.MARK,/^<svg class="brand-mark"/);
  const makeHost=()=>{const attrs={};return {attrs,innerHTML:'',setAttribute:(k,v)=>{attrs[k]=v}}};
  const hosts=Object.keys(NAV).map(makeHost);
  assert.equal(M.mount({querySelectorAll:selector=>{assert.equal(selector,'[data-masthead]');return hosts}}),5);
  for(const host of hosts){
    assert.equal(host.attrs['aria-label'],'GarageFit');
    assert.equal(host.innerHTML,M.MARK+M.NAME);
  }
  assert.match(M.NAME,/Garage<strong>Fit<\/strong>/);
});

test('startup mounts the shared masthead before the first screen is shown',()=>{
  assert.match(html,/GarageFitMasthead\.mount\(document\);loadRoutineVariant\(\)/);
});

test('bottom nav is visible on each primary tab with correct active and aria-current state, including Coach',()=>{
  const app=loadAppContext(),el=id=>app.document.getElementById(id);
  for(const [screen,navId] of Object.entries(NAV)){
    app.showScreen(screen);
    assert.equal(el('bottomNav').classList.contains('hidden'),false,screen);
    assert.equal(el(screen).classList.contains('hidden'),false,screen);
    for(const [otherScreen,otherNav] of Object.entries(NAV)){
      const selected=otherScreen===screen;
      assert.equal(el(otherNav).classList.contains('active'),selected,screen+'/'+otherNav);
      assert.equal(el(otherNav).attributes['aria-current'],selected?'page':undefined,screen+'/'+otherNav);
    }
    assert.equal(navId,NAV[screen]);
  }
});

test('Coach masthead is static markup, independent of the asynchronous programme load',()=>{
  const coach=screens.find(s=>s.id==='coach').body;
  assert.match(coach,/^\s*<div class="home-header"><div class="brand" data-masthead><\/div><\/div>\s*<div class="home-intro"><h1 class="screen-title">Coach<\/h1><\/div>/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'js/coach-ui.js'),'utf8'),/data-masthead|brand-mark/);
});

test('Tennis setup and daily training keep the shared Coach navigation; preview returns to the same primary screen',async()=>{
  const vm=require('node:vm'), app=loadAppContext(new Map(),{ownIntrinsics:true});
  const run=source=>vm.runInContext(source,app);
  await run("state.ownedEquipment=['dumbbells'];coachUI.open()");
  run("function coachButton(text){const visit=node=>node.textContent===text&&node.onclick?node:(node.children||[]).map(visit).find(Boolean);return visit(document.getElementById('coachContent'));}");
  await run("coachButton('Tennis').onclick()");
  assert.equal(app.document.getElementById('bottomNav').classList.contains('hidden'),false);
  assert.equal(app.document.getElementById('coachNav').attributes['aria-current'],'page');
  await run("coachButton('Start programme').onclick()");
  assert.equal(app.document.getElementById('bottomNav').classList.contains('hidden'),false);
  await run("coachButton('View today’s workout').onclick()");
  assert.equal(app.document.getElementById('bottomNav').classList.contains('hidden'),true);
  run('coachUI.back()');
  assert.equal(app.document.getElementById('bottomNav').classList.contains('hidden'),false);
  assert.equal(app.document.getElementById('coachNav').attributes['aria-current'],'page');
});

test('Coach and Workouts bottom-navigation items use distinct icons',()=>{
  const icon=id=>html.match(new RegExp(`id="${id}"[^>]*>\\s*<svg[^>]*><use href="#([^"]+)"`))[1];
  assert.equal(icon('workoutsNav'),'icon-workouts');
  assert.equal(icon('coachNav'),'icon-user-round');
  assert.match(html,/<symbol id="icon-user-round"[^>]*><circle cx="12" cy="8" r="5"\/><path d="M20 21a8 8 0 0 0-16 0"\/><\/symbol>/);
});
