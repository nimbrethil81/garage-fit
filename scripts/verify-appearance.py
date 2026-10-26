"""Capture real same-state screens: python scripts/verify-appearance.py OUTPUT [dark|light] [URL].
Use latest-main URL for before captures and compare Dark PNGs pixel-for-pixel.
Requires developer-only Playwright and Chromium, as the other viewport verifiers do.
"""
import sys,json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
mode=sys.argv[2] if len(sys.argv)>2 else 'dark'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':844},color_scheme=mode)
 page.add_init_script("let seed=164;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};window.setInterval=()=>1;Date.now=()=>1793000000000;")
 page.goto(sys.argv[3] if len(sys.argv)>3 else 'http://127.0.0.1:8000');page.wait_for_function("typeof coachUI!=='undefined' && coachUI")
 if page.evaluate("typeof GarageFitAppearance!=='undefined'"): page.evaluate('(m)=>GarageFitAppearance.choose(m)',mode)
 def shot(name,code):
  page.evaluate(code);page.wait_for_timeout(450);page.mouse.move(0,0);page.screenshot(path=str(out/(name+'.png')))
 for name,code in [('generator','goGenerator()'),('generator-options',"document.querySelector('#generator .generator-options').open=true"),('equipment',"renderEquipment();showScreen('equipment')"),('preview','generateWorkout()'),('player','startStandaloneGeneratedWorkout()'),('completion','finishGeneratedWorkout()'),('workouts','goWorkouts()'),('prep','goHome()'),('more',"showScreen('more')"),('library',"renderExerciseLibrary();showScreen('exerciseLibrary')"),('coach','coachUI.open()')]:shot(name,code)
 for name,code in [
  ('generator-family-disabled',"goGenerator();selectGeneratorFamily('mobility-movement-quality')"),
  ('generator-unavailable',"selectGeneratorFamily('athletic-movement');window.captureGenerate=GarageFitGenerator.generate;GarageFitGenerator.generate=options=>captureGenerate({...options,excludedImpact:['medium','high']});generateWorkout();GarageFitGenerator.generate=captureGenerate;void 0"),
  ('equipment-selected',"openEquipment('generator');toggleEquipmentItem('dumbbells')"),
  ('equipment-return',"closeEquipment(true);selectGeneratorFamily(null)"),
  ('preview-long',"selectGeneratorDuration(45);generateWorkout()"),
  ('preview-bottom',"document.getElementById('generatedPreview').scrollTop=10000"),
  ('player-work',"startStandaloneGeneratedWorkout();enterGeneratedPhase(generatorState.timeline.findIndex(p=>p.kind==='exercise'&&p.timed));generatorState.remaining=17;renderWorkoutRing()"),
  ('player-rest',"enterGeneratedPhase(generatorState.timeline.findIndex(p=>p.kind==='rest'))"),
  ('settings',"showScreen('settings')")]:shot(name,code)
 for name in ['General Fitness','4-Week General Strength','Build Arms','Tennis']:
  page.reload();page.wait_for_function('coachUI');page.evaluate("state.ownedEquipment=['dumbbells','bench','pullup-bar','kettlebell'];coachUI.open()");page.get_by_role('button',name=name,exact=True).click();shot(name+'-setup','void 0');page.get_by_role('button',name='Start programme',exact=True).click();shot(name+'-active','void 0');page.get_by_role('button',name='Your progress',exact=True).click();shot(name+'-progress','void 0');page.evaluate("state.ownedEquipment=['dumbbells','bench','pullup-bar','kettlebell'];coachUI.open()");page.get_by_role('button',name='View today’s workout',exact=True).click();shot(name+'-preview','void 0')
  page.evaluate('localStorage.clear()')
 if mode=='light' and page.evaluate("typeof GarageFitAppearance!=='undefined'"):
  colours=page.evaluate("""()=>{const c=getComputedStyle(document.documentElement);return Object.fromEntries(['ink','surface','text','text-muted','card','card-text','card-muted','work','work-text','work-dark','rest','nav','nav-text','surface-2'].map(k=>[k,c.getPropertyValue('--'+k).trim()]))}""")
  def luminance(h):
   rgb=[int(h[i:i+2],16)/255 for i in (1,3,5)]
   rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
   return sum(v*w for v,w in zip(rgb,[.2126,.7152,.0722]))
  ratios={}
  for fg,bg in [('text','ink'),('text-muted','ink'),('text-muted','surface'),('card-text','card'),('card-muted','card'),('work-text','ink'),('work-text','surface'),('rest','ink'),('rest','surface'),('nav-text','nav')]:
   low,high=sorted([luminance(colours[fg]),luminance(colours[bg])]);ratio=(high+.05)/(low+.05)
   assert ratio>=4.5,(fg,bg,ratio)
   ratios[fg+'/'+bg]=round(ratio,2)
  for bg in ['ink','surface']:
   low,high=sorted([luminance(colours['surface-2']),luminance(colours[bg])])
   ratios['control-border/'+bg]=round((high+.05)/(low+.05),2)
   assert ratios['control-border/'+bg]>=3
  # Active navigation adds a translucent teal tint: include that composited surface.
  rgb=lambda h:[int(h[i:i+2],16) for i in (1,3,5)]
  active=[round(v*.88+t*.12) for v,t in zip(rgb(colours['nav']),rgb('#4f8a83'))]
  active_hex='#'+''.join(f'{v:02x}' for v in active)
  low,high=sorted([luminance(colours['rest']),luminance(active_hex)])
  ratios['active-navigation'] = round((high+.05)/(low+.05),2)
  assert ratios['active-navigation']>=4.5
  (out/'contrast.json').write_text(json.dumps(ratios,indent=2))
 # Browser boundary checks: persistence and a live OS switch during a real run.
 if page.evaluate("typeof GarageFitAppearance!=='undefined'"):
  page.evaluate('localStorage.clear()');page.reload();page.wait_for_function('coachUI')
  assert page.locator('html').get_attribute('data-appearance')==mode
  assert page.evaluate("localStorage.getItem('gf_appearance_v1')") is None
  page.evaluate("showScreen('settings')")
  for choice in ['dark','light','automatic']:
   page.locator('#appearance').select_option(choice);page.reload();page.wait_for_function('coachUI')
   assert page.evaluate("localStorage.getItem('gf_appearance_v1')")==choice
   assert page.locator('#appearance').input_value()==choice
   page.evaluate("showScreen('settings')")
  page.evaluate('goGenerator();generateWorkout();startStandaloneGeneratedWorkout()')
  before=page.evaluate("JSON.stringify([generatorState.timeline,generatorState.timelineIndex,generatorState.remaining,workoutState.paused,workoutState.running,generatorState.tracker?.draft])")
  for scheme in ['dark','light','dark']:
   page.emulate_media(color_scheme=scheme)
   page.wait_for_function('(scheme)=>document.documentElement.dataset.appearance===scheme',arg=scheme)
   assert page.evaluate("JSON.stringify([generatorState.timeline,generatorState.timelineIndex,generatorState.remaining,workoutState.paused,workoutState.running,generatorState.tracker?.draft])")==before
  # Switching a paused timer must preserve both pause state and remaining time.
  page.locator('#workoutRing').click()
  paused=page.evaluate('[workoutState.paused,generatorState.remaining]')
  assert paused[0]
  page.emulate_media(color_scheme='light')
  assert page.evaluate('[workoutState.paused,generatorState.remaining]')==paused
  page.evaluate("GarageFitAppearance.choose('dark')");page.emulate_media(color_scheme='light')
  assert page.locator('html').get_attribute('data-appearance')=='dark'
 b.close()
 print('Screenshots and persistence/live workout appearance checks passed:',out)
