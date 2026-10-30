const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

// A small DOM models controls and their observable disabled/focus behaviour.
// Native file transport and storage guarantees are tested in their own modules.
class Element {
  constructor(tag,document){this.tagName=tag;this.document=document;this.children=[];this.attributes={};this._text='';this.disabled=false;}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join(' ');}
  set innerHTML(value){assert.equal(value,'');this._text='';this.children=[];}
  append(...nodes){this.children.push(...nodes);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  removeAttribute(key){delete this.attributes[key];}
  querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tagName===tag?[n]:[]),...n.querySelectorAll(tag)]);}
  querySelector(selector){return this.querySelectorAll('button').find(n=>selector==='.back-btn'&&n.className==='back-btn')||null;}
  focus(){this.document.activeElement=this;}
  click(){if(!this.disabled)return this.onclick?.();}
}
function harness(options={}){
  const document={nodes:{},activeElement:null,createElement(tag){return new Element(tag,this);},getElementById(id){return this.nodes[id]||(this.nodes[id]=new Element('div',this));}};
  const back=document.createElement('button');back.className='back-btn';document.getElementById('backupRestore').append(back);
  const context=vm.createContext({document,Date});context.window=context;
  vm.runInContext(fs.readFileSync('js/backup-ui.js','utf8'),context);
  const calls={prepare:[],verify:[],restore:[],save:[],reload:0,activity:0,recovery:0};
  let current='settings',preservationVerified=false,meaningful=true;
  const archive={createdAt:'2026-10-24T12:00:00Z',sections:{preferences:{entries:[['gf_equipment_inventory','[]'],['gf_equipment_configured','true']]}}};
  const validated={archive,summary:{sessions:4,completed:2,partial:1,programmes:1,preferences:2}};
  const backup={
    async prepare(opts){calls.prepare.push(opts);return {text:'prepared',filename:'GarageFit-backup.json',status:'prepared'};},
    async validate(text){if(text==='bad')throw Object.assign(new Error('The backup is incomplete or changed.'),{code:'integrity-failed'});return validated;},
    async verify(text,opts){calls.verify.push([text,opts]);if(text!=='prepared')throw Object.assign(new Error('Choose the file you just prepared.'),{code:'verification-mismatch'});if(opts.preserve)preservationVerified=true;},
    inspectDestination(){return {meaningful,preservationVerified,summary:{sessions:3,programmes:1}};},
    async restore(text,opts){calls.restore.push([text,opts]);assert.equal(meaningful&&!preservationVerified,false);return {status:'restored'};},
    ...options.backup
  };
  const api=context.GarageFitBackupUI.mount({document,backup,
    showScreen(id){current=id;},saveFile(file){calls.save.push(file);return Promise.resolve({status:'offered'});},readFile:async file=>file.text,
    onRestored(){calls.reload++;},returnToActivity(){calls.activity++;},retryRecovery(){calls.recovery++;},...options,backup});
  const content=document.getElementById('backupRestoreContent');
  const buttons=()=>content.querySelectorAll('button');
  const click=async label=>{const b=buttons().find(n=>n.textContent===label);assert.ok(b,'button '+label+' present');return b.click();};
  const view=()=>content.attributes['data-backup-view'];
  return {api,document,calls,backup,content,buttons,click,view,text:()=>content.textContent,get current(){return current;},
    meaningful(value){meaningful=value;},invalidate(){preservationVerified=false;}};
}

test('backup preparation, offered file, user report and independent verification remain distinct',async()=>{
  const h=harness();h.api.open();assert.equal(h.current,'backupRestore');
  assert.match(h.text(),/Backups are manual; devices do not sync/);
  await h.click('Create backup');assert.equal(h.view(),'ready');
  assert.match(h.text(),/Preparing a file does not mean it has been saved/);
  const promise=h.click('Save backup file');
  assert.equal(h.calls.save.length,1,'native API is invoked in the click handler before awaiting');
  await promise;assert.equal(h.view(),'offered');assert.match(h.text(),/Saving has not been verified/);
  await h.click('I saved it — skip verification');assert.equal(h.view(),'home');
  assert.match(h.text(),/You reported saving a file. It has not been independently verified/);
  await h.click('Create backup');await h.click('Save backup file');
  await h.api.selectFile({name:'saved.json',text:'prepared'},'verify');assert.equal(h.view(),'verified');
  assert.match(h.text(),/matches the prepared backup/);await h.click('Done');
  assert.match(h.text(),/independently verified.*snapshot, not a live backup/);
});

test('restore preview keeps partial and other statuses truthful and performs no replacement',async()=>{
  const h=harness();h.api.open();await h.api.selectFile({name:'old.json',text:'incoming'});
  assert.equal(h.view(),'preview');assert.match(h.text(),/Recorded sessions 4.*Completed \/ partial 2 \/ 1/);
  assert.match(h.text(),/also include other saved activity statuses/);
  assert.match(h.text(),/Bodyweight only/);assert.match(h.text(),/Nothing is merged/);
  assert.equal(h.calls.restore.length,0);h.api.back();assert.equal(h.view(),'home');
  h.api.back();assert.equal(h.current,'settings');assert.equal(h.calls.restore.length,0);
});

test('meaningful destinations require verified preservation and an independent checked confirmation',async()=>{
  const h=harness();h.api.open();await h.api.selectFile({name:'old.json',text:'incoming'});
  await h.click('Continue to protect data');assert.equal(h.view(),'preservation');
  assert.match(h.text(),/mandatory before continuing/);assert.match(h.text(),/Recorded sessions 3/);
  await h.click('Create preservation backup');assert.equal(h.calls.prepare[0].preserve,true);
  await h.click('Save preservation file');assert.equal(h.view(),'offered');
  assert.ok(!h.buttons().some(n=>n.textContent.includes('skip verification')),'no user-report bypass for preservation');
  await h.api.selectFile({text:'prepared'},'preserve');assert.equal(h.calls.verify[0][1].preserve,true);
  await h.click('Continue to confirmation');assert.equal(h.view(),'confirm');
  const replace=h.buttons().find(n=>n.textContent==='Replace data and restore');assert.equal(replace.disabled,true);
  replace.click();assert.equal(h.calls.restore.length,0);
  const check=h.content.querySelectorAll('input').find(n=>n.id==='backupReplacementConsent');check.checked=true;check.onchange();
  await replace.click();assert.equal(h.calls.restore.length,1);assert.equal(h.calls.restore[0][0],'incoming');assert.equal(h.calls.restore[0][1].confirmed,true);
  assert.equal(h.view(),'complete');assert.equal(h.api.canLeave(),false);assert.equal(h.api.back(),false);
  assert.equal(h.calls.reload,0);await h.click('Continue to GarageFit');assert.equal(h.calls.reload,1);
});

test('changed current data invalidates a previously verified preservation before confirmation',async()=>{
  const h=harness();h.api.open();await h.api.selectFile({text:'incoming'});await h.click('Continue to protect data');
  await h.click('Create preservation backup');await h.click('Save preservation file');await h.api.selectFile({text:'prepared'},'preserve');
  h.invalidate();await h.click('Continue to confirmation');assert.equal(h.view(),'error');
  assert.match(h.text(),/Your data changed/);assert.equal(h.calls.restore.length,0);
  await h.click('Create new preservation backup');assert.equal(h.view(),'preservation');
});

test('a wrong verification file and an invalid newly selected restore file never enable replacement',async()=>{
  const h=harness();h.api.open();await h.click('Create backup');await h.click('Save backup file');
  await h.api.selectFile({text:'different'},'verify');assert.equal(h.view(),'error');assert.equal(h.calls.restore.length,0);
  await h.click('Cancel restore');await h.api.selectFile({name:'valid.json',text:'incoming'});assert.equal(h.view(),'preview');
  await h.api.selectFile({name:'broken.json',text:'bad'});assert.equal(h.view(),'error');
  assert.match(h.text(),/incomplete or changed/);assert.ok(!h.buttons().some(n=>n.textContent==='Try again'),'invalid new file discards old preview');
  assert.equal(h.calls.restore.length,0);assert.equal(h.document.getElementById('backupRestoreTitle').textContent,'Restore backup');
});

test('pending operations block duplicate actions/back and native save cancellation returns to prepared status',async()=>{
  let resolve,preparations=0;
  const h=harness({backup:{prepare(){preparations++;return new Promise(done=>{resolve=done;});}}});h.api.open();
  const operation=h.click('Create backup');await Promise.resolve();
  assert.equal(h.api.canLeave(),false);assert.equal(h.api.back(),false);h.api.open();assert.equal(preparations,1);
  resolve({text:'prepared',filename:'file.json'});await operation;assert.equal(h.api.canLeave(),true);
  const cancelled=harness({saveFile:()=>Promise.resolve({status:'cancelled'})});cancelled.api.open();await cancelled.click('Create backup');await cancelled.click('Save backup file');
  assert.equal(cancelled.view(),'ready');assert.doesNotMatch(cancelled.text(),/offered the file/);
});

test('empty destinations still require a separate explicit replacement confirmation',async()=>{
  const h=harness();h.meaningful(false);h.api.open();await h.api.selectFile({text:'incoming'});
  await h.click('Continue to protect data');assert.equal(h.view(),'confirm');
  assert.match(h.text(),/no saved GarageFit data/);assert.equal(h.calls.prepare.length,0);
  assert.equal(h.buttons().find(n=>n.textContent==='Replace data and restore').disabled,true);
});

test('recovery blocks navigation and only offers recovery; active guard preserves workout routing',async()=>{
  const h=harness();h.api.showRecovery(new Error('Storage is unavailable.'));
  assert.equal(h.api.canLeave(),false);assert.equal(h.api.back(),false);h.api.open();assert.equal(h.view(),'recovery');
  await h.click('Recovery guidance');assert.equal(h.view(),'recoveryHelp');assert.equal(h.api.canLeave(),false);
  await h.click('Retry recovery');assert.equal(h.calls.recovery,1);assert.equal(h.calls.restore.length,0);
  const active=harness({isBlocked:()=>true});active.api.open();assert.equal(active.view(),'active');
  await active.click('Return to workout');assert.equal(active.calls.activity,1);assert.equal(active.calls.prepare.length,0);
});


test('state callbacks and disabled header back keep protected operations accessible',async()=>{
  let done;const states=[];
  const h=harness({onStateChange:state=>states.push({...state}),backup:{prepare:()=>new Promise(resolve=>{done=resolve;})}});
  h.api.open();const back=h.document.getElementById('backupRestore').querySelector('.back-btn');
  assert.equal(back.disabled,false);const preparing=h.click('Create backup');await Promise.resolve();
  assert.equal(back.disabled,true);assert.equal(states.at(-1).busy,true);assert.equal(states.at(-1).canLeave,false);
  const focused=h.document.activeElement;assert.equal(focused.attributes.role,'status');assert.match(focused.textContent,/Preparing backup/);
  assert.equal(focused.attributes['aria-hidden'],undefined);assert.equal(focused.inert,undefined);
  done({text:'prepared',filename:'copy.json'});await preparing;assert.equal(back.disabled,false);assert.equal(states.at(-1).busy,false);
  h.api.showRecovery(new Error('Needs recovery'));assert.equal(back.disabled,true);assert.equal(states.at(-1).canLeave,false);
  h.api.showComplete();assert.equal(back.disabled,true);assert.equal(states.at(-1).view,'complete');
});

test('another-tab retry rechecks the existing preservation gate instead of requiring an unnecessary backup',async()=>{
  let attempts=0;
  const h=harness({backup:{restore:async()=>{if(!attempts++)throw Object.assign(new Error('Close other tabs and try again.'),{code:'another-tab'});}}});
  h.api.open();await h.api.selectFile({text:'incoming'});await h.click('Continue to protect data');
  await h.click('Create preservation backup');await h.click('Save preservation file');await h.api.selectFile({text:'prepared'},'preserve');
  await h.click('Continue to confirmation');
  const check=h.content.querySelectorAll('input').find(n=>n.id==='backupReplacementConsent');check.checked=true;check.onchange();
  await h.click('Replace data and restore');assert.equal(h.view(),'error');await h.click('Try again');
  assert.equal(h.view(),'confirm');assert.equal(h.calls.prepare.length,1,'unchanged verified preservation is reusable');
  const consent=h.content.querySelectorAll('input').find(n=>n.id==='backupReplacementConsent');consent.checked=true;consent.onchange();
  await h.click('Replace data and restore');assert.equal(h.view(),'complete');
});
