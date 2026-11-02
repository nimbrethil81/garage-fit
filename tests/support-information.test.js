const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const copy=require('./fixtures/support-copy.json');
const html=fs.readFileSync('index.html','utf8');
const screen=id=>html.match(new RegExp('<main id="'+id+'"[\\s\\S]*?</main>'))[0];
const decode=text=>text.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');
test('approved support copy remains verbatim and FAQs stay a flat five disclosures',()=>{
  for(const [id,lines] of Object.entries(copy)){
    const text=decode(screen(id).replace(/<\/?strong>/g,'').replace(/<[^>]+>/g,'\n'));
    for(const line of lines)assert.ok(text.replace(/\s+/g,' ').includes(line),id+': '+line);
  }
  assert.equal((screen('howToUse').match(/<details>/g)||[]).length,5);
  assert.equal((screen('help').match(/<details>/g)||[]).length,6);
  assert.doesNotMatch(screen('howToUse'),/type="search"|<img|<details[^>]*open/);
  const settings=screen('settings').split('<h2 id="settingsAbout">')[1];
  assert.deepEqual([...settings.matchAll(/<button[^>]*><span>(.*?)<\/span>/g)].map(m=>decode(m[1])),['How to use PickSetGo','Help & troubleshooting','About PickSetGo']);
});
test('support composer has only the approved recipient and subject; reports stay selectable',()=>{
  const help=screen('help'),href=help.match(/href="(mailto:[^"]+)"/)[1];
  assert.equal(decodeURIComponent(href),'mailto:picksetgoapp@gmail.com?subject=PickSetGo — Problem report');
  assert.equal((help.match(/user-select:text/g)||[]).length,2);
  assert.match(help,/Nothing is sent automatically\./);
});

test('About reuses the canonical PickSetGo branding',()=>{
  const {loadAppContext}=require('./helpers/app-context');
  const app=loadAppContext();app.document.documentElement=app.document.createElement('html');app.matchMedia=()=>({matches:false});app.screen={width:375,height:667};
  app.document.getElementById('app').getBoundingClientRect=()=>({top:0,bottom:667,height:667});
  app.openAbout();
  assert.equal(app.document.getElementById('aboutBrand').innerHTML,app.GarageFitMasthead.MARK+app.GarageFitMasthead.NAME);
});
