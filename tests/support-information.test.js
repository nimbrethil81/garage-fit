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

test('privacy link follows About and reuses Settings link semantics',()=>{
  const settings=screen('settings');
  assert.match(settings,/openAbout\(\)[\s\S]*?<a class="settings-row settings-link" href="privacy\/">/);
  assert.ok(settings.includes('<a class="settings-row settings-link" href="privacy/"><span>Privacy policy</span><span class="settings-chevron" aria-hidden="true">›</span></a>'));
});

test('approved privacy policy matches the frozen issue 383 text without a parallel copy',()=>{
  const policy=fs.readFileSync('privacy/index.html','utf8');
  const text=decode(policy.match(/<main>([\s\S]*?)<\/main>/)[1].replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim().replace('Last updated: 2 November 2026','Last updated: [set actual publication date when authorised]');
  // Frozen issue #383 V1.0: normalise the approved publication date back to its editorial instruction.
  assert.equal(require('node:crypto').createHash('sha256').update(text).digest('hex'),'216b05fddd107ea7ef92c4f0f6e17213e1b4dcae92909af1e360439d2d46c0ce');
  assert.match(policy,/width=device-width, initial-scale=1/);
  assert.doesNotMatch(policy,/maximum-scale|user-scalable|position:\s*fixed|overflow:\s*hidden/);
  assert.deepEqual([...policy.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>m[1]),['../js/appearance.js']);
  assert.match(policy,/<a class="back-btn" href="\.\.\/" aria-label="Back to PickSetGo">←<\/a>/);
  assert.match(policy,/<strong>Last updated: 2 November 2026<\/strong>/);
  assert.doesNotMatch(policy,/UNPUBLISHED|\[set actual publication date|noindex/);
});
