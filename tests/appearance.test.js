const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/appearance.js', 'utf8');
function boot(storage = new Map(), dark = false, blocked = false) {
  const attributes = {}, select = {}, status = {}, meta = {};
  let changed, ready;
  const media = {matches:dark, addEventListener:(_, fn)=>changed=fn};
  const window = {
    matchMedia:()=>media,
    localStorage:{getItem:k=>{if(blocked)throw Error();return storage.get(k);}, setItem:(k,v)=>{if(blocked)throw Error();storage.set(k,v);}},
    document:{documentElement:{setAttribute:(k,v)=>attributes[k]=v},querySelector:()=>({setAttribute:(k,v)=>meta[k]=v}),getElementById:id=>id==='appearance'?select:status,addEventListener:(_,fn)=>ready=fn}
  };
  vm.runInNewContext(source, {window});
  return {attributes, select, status, meta, choose:window.GarageFitAppearance.choose, ready, os(value){media.matches=value;changed();}};
}
test('unset and invalid preferences follow the OS without a migration write',()=>{
  for(const value of [undefined,'invalid','null']) {
    const storage=new Map(value===undefined?[]:[['gf_appearance_v1',value]]), h=boot(storage,true);
    assert.equal(h.select.value,'automatic');assert.equal(h.attributes['data-appearance'],'dark');
    h.os(false);assert.equal(h.attributes['data-appearance'],'light');assert.equal(storage.get('gf_appearance_v1'),value);
    assert.equal(h.meta.content,'#f7f3ec');
  }
});
test('all explicit choices persist through restart; only Automatic follows OS changes',()=>{
  const storage=new Map();
  for(const choice of ['light','dark','automatic']) {
    const h=boot(storage);h.choose(choice);assert.equal(storage.get('gf_appearance_v1'),choice);
    const restarted=boot(storage,true);restarted.ready();assert.equal(restarted.select.value,choice);
    assert.equal(restarted.attributes['data-appearance'],choice==='automatic'?'dark':choice);
    restarted.os(false);assert.equal(restarted.attributes['data-appearance'],choice==='automatic'?'light':choice);
  }
});
test('unavailable storage still supports live appearance and reports unsaved explicit choices',()=>{
  const h=boot(new Map(),false,true);h.choose('dark');assert.equal(h.attributes['data-appearance'],'dark');
  assert.match(h.status.textContent,/could not save/);h.choose('automatic');h.os(true);assert.equal(h.attributes['data-appearance'],'dark');
  h.choose('invalid');assert.equal(h.select.value,'automatic');
});
test('startup resolves appearance before styles; Settings has a labelled native three-way control',()=>{
  const html=fs.readFileSync('index.html','utf8');
  assert.ok(html.indexOf('src="js/appearance.js"')<html.indexOf('rel="stylesheet"'));
  assert.match(html,/<label for="appearance">Appearance<select id="appearance"/);
  for(const value of ['automatic','light','dark'])assert.match(html,new RegExp('<option value="'+value+'">'));
});

test('Settings groups actual preferences with decorative navigation chevrons and an inline Appearance control',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const settings=html.match(/<main id="settings"[\s\S]*?<\/main>/)[0];
  const sections=[...settings.matchAll(/<section class="settings-section" aria-labelledby="([^"]+)">([\s\S]*?)<\/section>/g)];
  assert.equal(sections.length,3);
  for(const [i,label] of ['Appearance','Audio','About'].entries()){
    const [,id,body]=sections[i];
    assert.ok(body.includes('<h2 id="'+id+'">'+label+'</h2>'));
    assert.match(body,/class="settings-group"/);
    assert.match(body,/class="settings-row /);
  }
  assert.match(sections[0][2],/<label for="appearance">Appearance<select id="appearance" aria-describedby="appearanceHelp appearanceStatus" onchange="GarageFitAppearance.choose\(this.value\)"/);
  assert.doesNotMatch(sections[0][2],/settings-chevron/);
  for(const [label,handler] of [['Spoken Cues',"showScreen('spokenCues')"],['About','openAbout()']]){
    assert.ok(settings.includes('onclick="'+handler+'"><span>'+label+'</span><span class="settings-chevron" aria-hidden="true">›</span></button>'));
  }
  assert.doesNotMatch(settings,/→/);
  assert.match(settings,/id="appearanceStatus" role="status"/);
});
