const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {loadAppContext}=require('./helpers/app-context');

test('About identifies loaded HTML and CSS separately and does not fetch a latest-server version',()=>{
  const html=fs.readFileSync('index.html','utf8'),css=fs.readFileSync('css/player-layout.css','utf8');
  const build=html.match(/id="aboutBuild">([^<]+)</)[1];
  assert.match(build,/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
  assert.equal(css.match(/--gf-layout-build:"([^"]+)"/)[1],build);
  const storage=new Map(),app=loadAppContext(storage),el=id=>app.document.getElementById(id);
  el('aboutBuild').textContent=build;
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
  el('aboutDiagnostics').textContent='Page build: example';
  let copied;
  app.navigator.clipboard={writeText:async text=>{copied=text}};
  await app.copyAboutDetails();
  assert.equal(copied,'Page build: example');
  assert.match(el('aboutCopyStatus').textContent,/copied/);
  delete app.navigator.clipboard;
  await app.copyAboutDetails();
  assert.match(el('aboutCopyStatus').textContent,/select and copy/);
});
