const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {loadAppContext:loadContext}=require('./helpers/app-context');
function loadAppContext(storage){
  const app=loadContext(storage);
  app.document.documentElement=app.document.createElement('html');
  return app;
}

test('About identifies loaded HTML and CSS separately and does not fetch a latest-server version',()=>{
  const html=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('css/player-layout.css','utf8');
  assert.ok(html.startsWith('---\nlayout: null\n---\n'));
  assert.ok(css.startsWith('---\nlayout: null\n---\n'));
  assert.match(html,/id="aboutBuild" data-commit="\{\{ site.github.build_revision \}\}"/);
  assert.match(html,/\{\{ site.github.build_revision \| slice: 0, 7 \}\}/);
  assert.equal(css.match(/--gf-layout-build:"([^"]+)"/)[1],'{{ site.github.build_revision }}');
  const build='25e9bb2abcdef01234567890123456789012345678';
  const storage=new Map(),app=loadAppContext(storage),el=id=>app.document.getElementById(id);
  el('aboutBuild').textContent=build.slice(0,7);
  el('aboutBuild').setAttribute('data-commit',build);
  el('app').getBoundingClientRect=()=>({top:0,bottom:852,height:852});
  app.screen={width:393,height:852};app.innerWidth=393;app.innerHeight=852;
  app.navigator.standalone=true;
  app.visualViewport={width:393,height:793,offsetTop:0,scale:1};
  app.getComputedStyle=()=>({getPropertyValue:()=> '"older-layout"',paddingTop:'59px',paddingBottom:'8px'});
  app.fetch=()=>{throw new Error('About must identify loaded files without fetching')};
  app.openAbout();
  assert.equal(el('about').classList.contains('hidden'),false);
  assert.equal(el('bottomNav').classList.contains('hidden'),true);
  assert.match(el('aboutDiagnostics').textContent,new RegExp('Page build: '+build.replaceAll('.','\\.')));
  assert.match(el('aboutDiagnostics').textContent,/Layout build: older-layout/);
  assert.match(el('aboutDiagnostics').textContent,/Mode: Installed app/);
  assert.match(el('aboutDiagnostics').textContent,/Visual viewport: 393 × 793/);
  assert.equal(storage.size,0);
});

test('copy diagnostics handles supported and unavailable clipboard without altering data',async()=>{
  const app=loadAppContext(),el=id=>app.document.getElementById(id);
  app.screen={width:393,height:852};
  app.matchMedia=()=>({matches:false});
  el('app').getBoundingClientRect=()=>({top:0,bottom:852,height:852});
  el('appearance').value='automatic';
  app.openAbout();
  app.innerWidth=852;app.innerHeight=393;
  app.visualViewport={width:800,height:350,offsetTop:12,scale:1.2};
  el('appearance').value='dark';
  app.document.documentElement.setAttribute('data-appearance','dark');
  let copied;
  app.navigator.clipboard={writeText:async text=>{copied=text}};
  await app.copyAboutDetails();
  assert.match(copied,/Window: 852 × 393/);
  assert.match(copied,/Visual viewport: 800 × 350/);
  assert.match(copied,/Viewport top \/ scale: 12 \/ 1.2/);
  assert.match(copied,/Appearance preference: Dark/);
  assert.match(copied,/Resolved theme: Dark/);
  assert.match(el('aboutCopyStatus').textContent,/copied/);
  app.navigator.clipboard.writeText=async()=>{throw new Error('Permission denied')};
  await app.copyAboutDetails();
  assert.match(el('aboutCopyStatus').textContent,/select and copy/);
  delete app.navigator.clipboard;
  await app.copyAboutDetails();
  assert.match(el('aboutCopyStatus').textContent,/select and copy/);
});

test('diagnostics groups technical fields, labels reported platform and handles missing APIs',()=>{
  const storage=new Map(),app=loadAppContext(storage),el=id=>app.document.getElementById(id);
  app.screen={width:393,height:852};
  app.matchMedia=()=>({matches:false});
  el('app').getBoundingClientRect=()=>({top:0,bottom:852,height:852});
  app.navigator.platform='MacIntel';
  app.navigator.userAgent='example browser UA';
  el('appearance').value='automatic';
  app.document.documentElement.setAttribute('data-appearance','light');
  app.fetch=()=>{throw new Error('No network allowed')};
  app.localStorage.getItem=app.localStorage.setItem=()=>{throw new Error('No storage allowed')};
  app.openAbout();
  let report=el('aboutDiagnostics').textContent;
  assert.match(report,/^Build\nPage build:/);
  assert.match(report,/\n\nDevice\nMode: Browser tab/);
  assert.match(report,/\n\nDisplay\nScreen:/);
  assert.match(report,/Reported OS\/platform: MacIntel/);
  assert.match(report,/User agent: example browser UA/);
  assert.match(report,/Appearance preference: Automatic\nResolved theme: Light/);
  assert.match(report,/Visual viewport: unavailable/);
  assert.equal(el('aboutMode').textContent,'Browser tab');
  el('appearance').value='light';
  app.navigator.userAgentData={platform:'Android'};
  app.openAbout();
  assert.match(el('aboutDiagnostics').textContent,/Reported OS\/platform: Android/);
  assert.match(el('aboutDiagnostics').textContent,/Appearance preference: Light/);
  delete app.navigator.userAgentData;delete app.navigator.platform;delete app.navigator.userAgent;
  app.openAbout();
  report=el('aboutDiagnostics').textContent;
  assert.match(report,/Reported OS\/platform: unavailable\nUser agent: unavailable/);
  assert.equal(storage.size,0);
});

test('About keeps diagnostics in a native collapsed disclosure with concise copy',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const about=html.match(/<main id="about"[\s\S]*?<\/main>/)[0];
  assert.match(about,/<details><summary>Diagnostics<\/summary>/);
  assert.match(about,/>Copy diagnostics<\/button>/);
  assert.match(about,/id="aboutMode"/);
});
