"""Capture #348 synthetic evidence states and check shared navigation/layout.
Run against scripts/preview_server.py: python3 scripts/verify-progress.py OUTPUT [URL].
Developer-only Playwright/Chromium, matching the existing visual verifiers.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
url = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:8000'
# All records below are synthetic visual-test evidence, saved through the real store.
seed = r"""async(count=24)=>{
 const store=GarageFitCoachStore.createStore(localStorage);
 for(let i=0;i<count;i++){
  const date=new Date('2026-10-30T08:00:00Z');date.setDate(date.getDate()-i);
  const support=i===1||i===3,partial=i===2;
  const section=support?'cooldown':'main';
  const plannedWork=[{occurrenceId:'main-1',exerciseId:'goblet-squat',section,
   prescription:{type:'reps',reps:99,side:null,protocol:'rounds',protocolConditions:{exerciseRestSeconds:20,roundRestSeconds:60}}},
   {occurrenceId:'main-2',exerciseId:'plank',section,prescription:{type:'timed',seconds:60,side:null}}];
  const performedWork=[{occurrenceId:'main-1',exerciseId:'goblet-squat',status:'completed'},
   {occurrenceId:'main-2',exerciseId:'plank',status:partial?'partial':'completed',sets:[{seconds:partial?12:30}]}];
  if(partial)plannedWork.push({occurrenceId:'skipped',exerciseId:'push-up',section,prescription:{type:'reps',reps:99}});
  await store.saveSessionResult(GarageFitCoachModel.createSessionResult({schemaVersion:1,sessionResultId:'visual-'+i,
   source:support?'fixed':'generator',programmeInstanceId:null,prescriptionId:null,workoutId:support?(i===1?'deskBreak':'postRunReset'):null,
   startedAt:date.toISOString(),endedAt:date.toISOString(),actualDurationSeconds:partial?1080:support?180:1800,
   finalStatus:partial?'partial':'completed',plannedWork,performedWork,anchorResults:[]}));
 }
}"""
measurements=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for mode in ['dark','light']:
  for width in [393,375]:
   page=browser.new_page(viewport={'width':width,'height':852},color_scheme=mode)
   page.add_init_script("Object.defineProperty(navigator,'standalone',{value:true});const RealDate=Date;Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-30T12:00:00Z']))}static now(){return +new RealDate('2026-10-30T12:00:00Z')}}")
   failures=[];page.on('pageerror',lambda e:failures.append(str(e)))
   page.goto(url);page.wait_for_function('coachUI');page.evaluate('(m)=>GarageFitAppearance.choose(m)',mode)
   def shot(name):
    screen=page.locator('main.screen:not(.hidden)')
    assert screen.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),name
    assert page.locator('#bottomNav button').count()==5
    for b in screen.locator('button:visible').all() if name in ['empty','overview','history-all','history-training','partial','completed','supporting','zero-tennis','large-text'] else []:
     assert b.evaluate('(e)=>e.getBoundingClientRect().height>=44'),name
    page.screenshot(path=str(out/f'{mode}-{width}-{name}.png'))
   page.evaluate("progressUI.open('more')");shot('empty')
   page.evaluate(seed,1);page.evaluate("progressUI.open('more')");shot('sparse')
   page.evaluate(seed,24);page.evaluate("progressUI.open('more')");shot('overview')
   page.keyboard.press('Tab');assert page.evaluate('document.activeElement.textContent')=='View history'
   page.get_by_role('button',name='View history',exact=True).click();shot('history-all')
   page.get_by_role('button',name='Training only',exact=True).click();shot('history-training')
   history=page.locator('#trainingHistory');history.evaluate('e=>e.scrollTop=150')
   before=history.evaluate('e=>e.scrollTop')
   page.evaluate("progressUI.openDetail('visual-2')");shot('partial')
   assert '99' not in page.locator('#sessionDetailsContent').inner_text()
   page.evaluate('appBack()');assert history.evaluate('e=>e.scrollTop')==before
   assert page.get_by_role('button',name='Training only',exact=True).get_attribute('aria-pressed')=='true'
   page.evaluate("progressUI.openDetail('visual-0')");shot('completed')
   page.evaluate("progressUI.openDetail('visual-1')");shot('supporting')
   page.evaluate("state.ownedEquipment=['dumbbells','bench'];coachUI.open()")
   page.get_by_role('button',name='Tennis',exact=True).click();page.get_by_role('button',name='Start programme',exact=True).click()
   page.get_by_role('button',name='Your progress',exact=True).click();shot('zero-tennis')
   assert '0 programme sessions completed' in page.locator('#yourProgressContent').inner_text()
   page.locator('#yourProgress').evaluate('e=>e.scrollTop=e.scrollHeight');shot('zero-tennis-bottom')
   page.get_by_role('button',name='View programme progress',exact=True).click();shot('programme-progress')
   page.evaluate('appBack()');assert page.evaluate('currentScreen')=='yourProgress'
   # Swipe calls the same route. A gesture starting at the left edge returns to Coach.
   page.evaluate("""()=>{for(const [type,x] of [['touchstart',8],['touchmove',140],['touchend',140]]){const e=new Event(type,{bubbles:true});Object.defineProperty(e,'touches',{value:[{clientX:x,clientY:300}]});Object.defineProperty(e,'changedTouches',{value:[{clientX:x,clientY:300}]});document.dispatchEvent(e)}}""");assert page.evaluate('currentScreen')=='coach'
   page.evaluate("progressUI.open('coach')")
   page.add_style_tag(content='#app:not(.active-player){padding-top:47px;padding-bottom:34px}')
   page.locator('#yourProgress').evaluate('e=>e.scrollTop=e.scrollHeight');shot('safe-areas')
   nav=page.locator('#bottomNav').bounding_box();assert nav['y']+nav['height']<=852-34+1
   last=page.get_by_role('button',name='View programme progress',exact=True).bounding_box();assert last['y']+last['height']<=nav['y']+1
   page.evaluate("document.body.style.zoom='1.5'");shot('large-text')
   page.evaluate("document.body.style.zoom='1';goGenerator()");shot('generator')
   page.evaluate('generateWorkout();startStandaloneGeneratedWorkout()');shot('player')
   page.evaluate('stopGeneratedPhaseTimer();stopWorkoutClock()')
   assert not failures,failures
   measurements.append({'mode':mode,'width':width,'installed_emulation':True,'navigation':'pass','horizontal_overflow':False,'touch_targets':'pass','text_zoom':1.5,'simulated_safe_insets':{'top':47,'bottom':34},'edge_swipe':'pass'})
   page.close()
 browser.close()
(out/'checks.json').write_text(json.dumps(measurements,indent=2))
print('Progress captures and browser checks passed:',out)
