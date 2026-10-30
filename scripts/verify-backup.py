"""Exercise #354 file workflows, tab protection and recovery using synthetic data.
Run: python3 scripts/verify-backup.py OUTPUT [URL]
Requires developer-only Playwright/Chromium, like verify-progress.py.
Native iPhone picker/share/VoiceOver acceptance still requires a real device.
"""
import json
import subprocess
from datetime import datetime, timezone
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
(out/'manifest.json').unlink(missing_ok=True)
url = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:8000'
measurements = []
seed = r"""async()=>{
 const store=GarageFitCoachStore.createStore(localStorage), now='2026-10-30T08:00:00.000Z';
 const engine=GarageFitCoachEngine.createEngine({catalogue:CATALOGUE,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription});
 const def=GarageFitData.programmes['general-strength-4w'][2];
 const started=engine.startProgramme(def,{equipment:['dumbbells','bench'],programmeInstanceId:'backup-visual-programme'},now);
 if(!started.state)throw Error('Synthetic programme could not start');
 await store.saveProgrammeState(started.state);
 await store.saveActiveProgramme(GarageFitCoachModel.createActiveProgramme(GarageFitCoachModel.programmeDefinitionRef(started.state)));
 for(let i=0;i<2;i++){
  const partial=i===1;
  const plannedWork=[{occurrenceId:'main-1',exerciseId:'goblet-squat',section:'main',prescription:{type:'reps',reps:8}},
   {occurrenceId:'main-2',exerciseId:'plank',section:'main',prescription:{type:'timed',seconds:60}}];
  const performedWork=[{occurrenceId:'main-1',exerciseId:'goblet-squat',status:'completed',sets:[{reps:8}]},
   {occurrenceId:'main-2',exerciseId:'plank',status:partial?'partial':'completed',sets:[{seconds:partial?12:60}]}];
  await store.saveSessionResult(GarageFitCoachModel.createSessionResult({schemaVersion:1,sessionResultId:'backup-visual-'+i,
   source:'generator',programmeInstanceId:null,prescriptionId:null,workoutId:null,startedAt:now,endedAt:now,
   actualDurationSeconds:partial?72:120,finalStatus:partial?'partial':'completed',plannedWork,performedWork,anchorResults:[]}));
 }
 setOwnedEquipment(['dumbbells','bench']);
 localStorage.setItem('gf_first_use_v1',JSON.stringify({version:1,audience:'existing',explored:true,modes:['home','coach'],acknowledged:null}));
}"""
# A valid interrupted journal is constructed from the real registry/store APIs.
# Alter only a preference to stand in for an interrupted replacement. Recovery
# must restore the exact marker before first-use or Coach clients initialise.
stage_journal = r"""async()=>{
 const sort=e=>e.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 const original={preferences:sort(GarageFitBackupRegistry.keys.flatMap(key=>{
  const raw=localStorage.getItem(key);return raw===null?[]:[[key,raw]];
 })),coach:GarageFitCoachStore.createBackupAccess(localStorage).snapshotRaw()};
 const target=JSON.parse(JSON.stringify(original));
 const appearance=target.preferences.find(entry=>entry[0]==='gf_appearance_v1');
 if(appearance)appearance[1]=appearance[1]==='dark'?'light':'dark';
 const payload={version:1,original,target};
 localStorage.setItem(GarageFitBackup.JOURNAL,JSON.stringify({...payload,checksum:await GarageFitBackup.fingerprint(payload)}));
 localStorage.removeItem('gf_first_use_v1');
 return original;
}"""

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 def new_context(mode='light',width=390,share=False):
  context=browser.new_context(viewport={'width':width,'height':800},color_scheme=mode,accept_downloads=True)
  # Use the browser download fallback for deterministic file-system round trips.
  context.add_init_script("Object.defineProperty(navigator,'standalone',{value:true});Object.defineProperty(window,'showSaveFilePicker',{value:undefined});Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true});")
  if share:
   context.add_init_script("Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});Object.defineProperty(navigator,'share',{value:async()=>{window.backupShareCalled=true}});")
  return context
 def ready(page):
  page.wait_for_function('window.garageFitAppReady===true')
  page.wait_for_function('!isBackupBlocked()')
 def open_backup(page):
  page.evaluate("showScreen('settings')")
  page.get_by_role('button',name='Backup & Restore',exact=True).click()
  page.wait_for_selector('#backupRestoreContent[data-backup-view="home"]')
 def view(page,name):
  page.wait_for_selector(f'#backupRestoreContent[data-backup-view="{name}"]')
 def shot(page,name,mode,width):
  screen=page.locator('#backupRestore')
  assert screen.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),name
  assert page.locator('#bottomNav button').count()==5
  assert page.locator('#bottomNav').is_visible()
  for button in screen.locator('button:visible').all():
   assert button.evaluate('(e)=>e.getBoundingClientRect().height>=44'),f'{name}: {button.inner_text()}'
  assert page.locator('#backupRestoreTitle').evaluate('(e)=>document.activeElement===e'),name+' heading focus'
  file=out/f'{mode}-{width}-{name}.png';page.screenshot(path=str(file))
  measurements.append({'state':name,'mode':mode,'width':width,'file':file.name,'noOverflow':True,'touchTargets44':True,'headingFocus':True,'fiveTabs':True})
 def choose(page,button,path):
  with page.expect_file_chooser() as selection:
   page.get_by_role('button',name=button,exact=True).click()
  selection.value.set_files(str(path))
 def save(page,button,path):
  with page.expect_download() as downloaded:
   page.get_by_role('button',name=button,exact=True).click()
  downloaded.value.save_as(str(path));view(page,'offered')
  assert 'Saving has not been verified' in page.locator('#backupRestoreContent').inner_text()
  return path
 failures=[]
 for mode in ['light','dark']:
  for width in [390,320]:
   context=new_context(mode,width);page=context.new_page()
   page.on('pageerror',lambda error:failures.append(str(error)))
   page.goto(url);ready(page);page.evaluate('(mode)=>GarageFitAppearance.choose(mode)',mode)
   page.evaluate(seed);page.reload();ready(page)
   marker=page.evaluate("localStorage.getItem('gf_first_use_v1')")
   original_state=page.evaluate("GarageFitCoachStore.createBackupAccess(localStorage).snapshotRaw()")
   open_backup(page);shot(page,'02-backup-home',mode,width)
   page.get_by_role('button',name='Moving to another device',exact=True).click();view(page,'help');shot(page,'12-migration',mode,width)
   page.evaluate('appBack()');view(page,'home')
   page.get_by_role('button',name='Create backup',exact=True).click();view(page,'ready');shot(page,'03-file-ready',mode,width)
   exported=save(page,'Save backup file',out/f'{mode}-{width}-ordinary.json');shot(page,'04-save-unverified',mode,width)
   parsed=json.loads(exported.read_text());assert parsed['app']=='GarageFit';assert len(parsed['sections']['coach']['entries'])>=4
   choose(page,'Verify saved file',exported);view(page,'verified');shot(page,'04-file-verified',mode,width)
   page.get_by_role('button',name='Done',exact=True).click();view(page,'home')
   choose(page,'Choose backup file',exported);view(page,'preview');shot(page,'05-restore-preview',mode,width)
   assert '1 / 1' in page.locator('#backupRestoreContent').inner_text()
   page.get_by_role('button',name='Continue to protect data',exact=True).click();view(page,'preservation');shot(page,'07-preservation-required',mode,width)
   assert page.get_by_role('button',name='Replace data and restore',exact=True).count()==0
   page.get_by_role('button',name='Create preservation backup',exact=True).click();view(page,'ready')
   preserved=save(page,'Save preservation file',out/f'{mode}-{width}-preservation.json')
   assert page.get_by_role('button',name='I saved it — skip verification',exact=True).count()==0
   choose(page,'Verify saved file',preserved);view(page,'verified')
   page.get_by_role('button',name='Continue to confirmation',exact=True).click();view(page,'confirm');shot(page,'08-confirm-replace',mode,width)
   assert page.get_by_role('button',name='Replace data and restore',exact=True).is_disabled()
   # A mutation after successful preservation invalidates the destructive gate.
   page.evaluate("localStorage.setItem('gf_generator_focus','cardio')")
   page.get_by_label('I understand that my data will be replaced.',exact=True).check()
   page.get_by_role('button',name='Replace data and restore',exact=True).click();view(page,'error');shot(page,'08-data-changed',mode,width)
   assert page.evaluate("localStorage.getItem('gf_generator_focus')")=='cardio'
   page.get_by_role('button',name='Create new preservation backup',exact=True).click();view(page,'preservation')
   page.get_by_role('button',name='Create preservation backup',exact=True).click();view(page,'ready')
   preserved=save(page,'Save preservation file',out/f'{mode}-{width}-preservation-current.json')
   choose(page,'Verify saved file',preserved);view(page,'verified')
   page.get_by_role('button',name='Continue to confirmation',exact=True).click();view(page,'confirm')
   # Real sibling tabs hold shared leases and prevent the replacement from starting.
   peer=context.new_page();peer.goto(url);ready(peer)
   page.get_by_label('I understand that my data will be replaced.',exact=True).check()
   page.get_by_role('button',name='Replace data and restore',exact=True).click();view(page,'error')
   assert 'Close other GarageFit tabs' in page.locator('#backupRestoreContent').inner_text()
   peer.close();page.get_by_role('button',name='Try again',exact=True).click();view(page,'confirm')
   page.get_by_label('I understand that my data will be replaced.',exact=True).check()
   page.get_by_role('button',name='Replace data and restore',exact=True).click();view(page,'complete');shot(page,'09-restore-complete',mode,width)
   assert page.evaluate("backupBrowser.status().retained")
   assert page.evaluate("(()=>{try{localStorage.setItem('late-write','stale');return false}catch(e){return e.code==='operation-in-progress'}})()")
   page.get_by_role('button',name='Continue to GarageFit',exact=True).click();ready(page)
   assert page.evaluate("localStorage.getItem('gf_first_use_v1')")==marker
   assert page.evaluate("GarageFitCoachStore.createBackupAccess(localStorage).snapshotRaw()")==original_state
   assert page.evaluate("localStorage.getItem('gf_generator_focus')") is None
   # Invalid input is rejected before writes, and a visible actionable state remains.
   open_backup(page);bad=out/f'{mode}-{width}-invalid.json';bad.write_text('{bad json')
   before=page.evaluate("Object.entries(localStorage)")
   choose(page,'Choose backup file',bad);view(page,'error');shot(page,'06-invalid-file',mode,width)
   assert page.evaluate("Object.entries(localStorage)")==before
   page.get_by_role('button',name='Cancel restore',exact=True).click();view(page,'home')
   # Large text should scroll vertically, keep controls usable, and retain gutters.
   page.evaluate("document.querySelector('#backupRestore').style.fontSize='150%';document.querySelectorAll('#backupRestoreContent p,#backupRestoreContent button').forEach(e=>e.style.fontSize='1.5em')")
   page.locator('#backupRestoreTitle').focus();shot(page,'large-text',mode,width)
   page.keyboard.press('Tab');assert page.evaluate("document.activeElement.tagName==='BUTTON'")
   page.locator('#backupRestore').evaluate('e=>e.scrollTop=e.scrollHeight')
   assert page.get_by_role('button',name='Moving to another device',exact=True).evaluate("e=>e.getBoundingClientRect().bottom<=document.getElementById('bottomNav').getBoundingClientRect().top"),'large text final action stays above navigation'
   page.locator('#backupRestoreTitle').evaluate('e=>e.focus({preventScroll:true})')
   shot(page,'large-text-bottom',mode,width)
   context.close()
 # Native sharing has a separate offered/unverified state; mock only the OS API.
 context=new_context(share=True);page=context.new_page();page.goto(url);ready(page);open_backup(page)
 page.get_by_role('button',name='Create backup',exact=True).click();view(page,'ready')
 page.get_by_role('button',name='Save backup file',exact=True).click();view(page,'offered')
 assert page.evaluate('window.backupShareCalled===true')
 assert 'Saving has not been verified' in page.locator('#backupRestoreContent').inner_text()
 context.close()
 # Recovery with a sibling tab must block before app clients or first-use writes.
 context=new_context();page=context.new_page();page.goto(url);ready(page);page.evaluate(seed);page.reload();ready(page)
 page.evaluate("GarageFitAppearance.choose('light')")
 peer=context.new_page();peer.goto(url);ready(peer)
 original=page.evaluate(stage_journal)
 page.reload();view(page,'recovery')
 assert page.evaluate('window.garageFitAppReady===false&&firstUse===null&&coachUI===null')
 assert page.evaluate("localStorage.getItem('gf_first_use_v1')") is None
 shot(page,'10-recovery-blocked','light',390)
 peer.close();page.get_by_role('button',name='Retry recovery',exact=True).click();ready(page)
 assert page.evaluate("localStorage.getItem(GarageFitBackup.JOURNAL)") is None
 assert page.evaluate("GarageFitCoachStore.createBackupAccess(localStorage).snapshotRaw()")==original['coach']
 assert page.evaluate("localStorage.getItem('gf_first_use_v1')")==dict(original['preferences'])['gf_first_use_v1']
 # Live activity blocks entry without discarding the in-flight player state.
 page.evaluate("state.running=true;openBackupRestore()")
 view(page,'active');shot(page,'11-active-workout','light',390)
 assert page.evaluate('state.running===true')
 page.evaluate('state.running=false')
 context.close();browser.close()
 assert not failures,failures
(out/'manifest.json').write_text(json.dumps({
 'app':'GarageFit','scope':'backup-restore',
 'captured_at':datetime.now(timezone.utc).isoformat(),
 'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
 'source_branch':subprocess.check_output(['git','branch','--show-current'],text=True).strip(),
 'worktree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],text=True).strip()),
 'capture_result':'passed','captures':measurements,'browserErrors':failures,
 'nativeIPhoneVerified':False,'syntheticFixtures':True},indent=2))
print(f'{len(measurements)} captures; file round trips, preservation, real tabs and startup recovery passed')
