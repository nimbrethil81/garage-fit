"""Optional browser layout regression/evidence check (Playwright + Chromium).

Serve the checkout, then run:
  python scripts/verify-player-layout.py --url http://127.0.0.1:8000 --output /tmp/player-layout
No browser dependency is added to the app or its Node test suite.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from playwright.sync_api import sync_playwright

spec = importlib.util.spec_from_file_location('timer_checks', Path(__file__).with_name('verify-player-timers.py'))
timers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(timers)

# These values simulate conservative iPhone safe areas even in Chromium, whose
# desktop env(safe-area-inset-*) is otherwise always zero.
SAFE_AREAS = """#app.active-player{padding-top:47px}
#player,#workoutPlayer{padding-bottom:34px;padding-left:14px;padding-right:14px}
.player-detail-surface{bottom:calc(var(--player-actions-height,54px) + 46px)}
@media(orientation:landscape){#app.active-player{padding-top:0}#player,#workoutPlayer{padding-bottom:21px;padding-left:47px;padding-right:47px}}"""
METRICS = """({optional=false,allowReflow=false}={})=>{
 const p=document.querySelector('main.screen:not(.hidden)'),stage=p.querySelector('.routine-stage,.workout-stage');
 const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};
 const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
 const controls=p.querySelector('.controls,.workout-actions'),v=visualViewport;
 const failures=[],bounds=box(p),nav=box(controls);
 for(const e of [document.documentElement,document.body,document.getElementById('app'),p]){
   if(e.scrollHeight>e.clientHeight+1)failures.push((e.id||e.tagName)+': page scroll '+e.scrollHeight+'/'+e.clientHeight);
   if(e.scrollWidth>e.clientWidth+1)failures.push((e.id||e.tagName)+': horizontal scroll');
 }
 if(!allowReflow&&(p.classList.contains('player-reflow')||stage.scrollHeight>stage.clientHeight+1))failures.push('stage requires scrolling');
 if(nav.bottom>v.offsetTop+v.height-parseFloat(getComputedStyle(p).paddingBottom)+1||nav.y<bounds.y)failures.push('navigation outside safe viewport');
 for(const e of controls.querySelectorAll('button'))if(visible(e)){
   const r=box(e);if(r.height<44||r.width<44)failures.push(e.id+': small tap target');
   if(r.y<nav.y-1||r.bottom>nav.bottom+1)failures.push(e.id+': navigation clipped');
   const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   if(!e.contains(hit))failures.push(e.id+': covered');
 }
 let ring;
 if(!optional&&!allowReflow){
  const items=[...stage.querySelectorAll(':scope > *, .routine-main-column > *, .workout-main-column > *, .workout-timer-column > *')].filter(e=>visible(e)&&e.textContent.trim()&&box(e).height>0);
  for(const e of items){const r=box(e);if(r.y<box(stage).y-1||r.bottom>nav.y+1||r.x<bounds.x-1||r.right>bounds.right+1)failures.push((e.id||e.className)+': outside stage');}
  const r=p.querySelector('.ring-wrap');
  if(visible(r)){
   ring=box(r);if(Math.abs(ring.width-ring.height)>0.1||ring.width<100)failures.push('ring geometry/legibility');
   const centre=box(r.querySelector('.ring-center'));
   if(Math.abs(centre.x+centre.width/2-ring.x-ring.width/2)>0.1||Math.abs(centre.y+centre.height/2-ring.y-ring.height/2)>0.1)failures.push('countdown off centre');
   const fg=r.querySelector('.ring-fg');if(fg.getAttribute('r')!=='90'||getComputedStyle(fg).strokeWidth!=='12px')failures.push('canonical stroke changed');
   for(const text of r.querySelectorAll('.phase-label,.timer-num,.reps-num'))if(visible(text)){
    const t=box(text);if(t.x<ring.x||t.right>ring.right||t.y<ring.y||t.bottom>ring.bottom)failures.push('ring text clipped');
   }
  }
 }
 if(optional){
   const d=p.querySelector('details[open] .player-detail-surface'),r=box(d);
   if(r.bottom>nav.y-4||r.y<bounds.y||r.height<60)failures.push('detail surface overlaps navigation/header');
 }
 if(!document.getElementById('bottomNav').classList.contains('hidden'))failures.push('tab bar consumes player space');
 return {player:p.id,viewport:[v.width,v.height],playerHeight:[p.scrollHeight,p.clientHeight],stageHeight:[stage.scrollHeight,stage.clientHeight],navigation:nav,ring,failures};
}"""


def settle(page):
    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))')


def check(page, report, label, optional=False, allow_reflow=False):
    settle(page)
    result=page.evaluate(METRICS,dict(optional=optional,allowReflow=allow_reflow))
    result['case']=label
    assert not result['failures'], json.dumps(result,indent=2)
    report.append(result)


def capture(page, output, label):
    page.screenshot(path=str(output/(label+'.png')))


def fixture_blocks():
    return json.loads(subprocess.check_output(['node','-e',"global.window=global;require('./data/exercises.js');console.log(JSON.stringify(require('./tests/helpers/protocol-fixtures').blockFixtures(GarageFitData.exercises,{emom:true,ladder:true,pyramid:true,complex:true,density:true})))"],text=True))


def protocols(page, blocks):
    page.evaluate("""blocks=>{
      generatorState.workout={schemaVersion:2,id:'layout-check',duration:30,focus:'balanced',bodyFocus:'full-body',difficulty:'normal',
        warmup:{restSeconds:5,exercises:[CATALOGUE['jumping-jacks']]},rampup:{restSeconds:5,exercises:[]},
        cooldown:{restSeconds:5,exercises:[CATALOGUE['kneeling-hamstring']]},main:{blocks:Object.values(blocks)}};
      startStandaloneGeneratedWorkout();
    }""",blocks)
    return page.evaluate("""()=>{
      const seen=new Set();return generatorState.timeline.flatMap((p,i)=>{
        const key=[p.section,p.protocol,p.kind,p.timed,p.side].join(':');
        if(seen.has(key))return [];seen.add(key);return [{i,key}];
      });
    }""")


def optional_checks(page, report, output, label):
    for selector in ['#workoutInstruction','#coachAnchorEdit','#densityPartial','#routineInstruction']:
        summary=page.locator(selector+' > summary')
        if not summary.is_visible():continue
        # Exercise real summary activation; the panel must not pause playback.
        if 'Instruction' in selector:
            page.locator(selector+' p').evaluate("e=>e.textContent+=' Keep your movement controlled and breathe steadily.'.repeat(60)")
        summary.click();settle(page)
        check(page,report,label+'-'+selector[1:],optional=True)
        if 'Instruction' in selector:
            content=page.locator(selector+' .player-detail-content')
            assert content.evaluate('e=>e.scrollHeight>e.clientHeight')
            content.evaluate('e=>e.scrollTop=e.scrollHeight')
            check(page,report,label+'-long-help-scrolled',optional=True)
        close=page.locator(selector+' .player-detail-close')
        assert close.evaluate('e=>e===document.activeElement')
        if selector=='#coachAnchorEdit':
            page.locator('#coachActualReps').fill('7');page.locator('#coachActualLoad').fill('12.5')
            assert '7 reps' in page.locator('#coachActualSummary').text_content()
            assert '7 reps' in page.locator('#coachAnchorEdit .player-detail-confirmation').text_content()
            # Chromium cannot show the iOS keyboard: emulate its visual viewport,
            # including Safari's panned offset, without altering layoutViewport.
            page.evaluate("""()=>{window.__viewportSnapshot={height:visualViewport.height,offsetTop:visualViewport.offsetTop};
              Object.defineProperty(visualViewport,'height',{configurable:true,value:300});
              Object.defineProperty(visualViewport,'offsetTop',{configurable:true,value:32});
              visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'));}""")
            page.locator('#coachActualLoad').focus()
            page.locator('#coachActualLoad').evaluate("e=>e.scrollIntoView({block:'nearest'})")
            check(page,report,label+'-keyboard',optional=True,allow_reflow=True)
            assert page.locator('#coachActualLoad').evaluate("e=>{const r=e.getBoundingClientRect(),c=e.closest('.player-detail-content').getBoundingClientRect();return r.top>=c.top-1&&r.bottom<=c.bottom+1}")
            capture(page,output,label+'-keyboard')
            page.evaluate("delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'))")
        capture(page,output,label+'-'+selector[1:])
        close.focus();page.keyboard.press('Escape');settle(page)
        assert not page.locator(selector).evaluate('e=>e.open')
        assert summary.evaluate('e=>e===document.activeElement')
        check(page,report,label+'-closed')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8000')
    parser.add_argument('--output',type=Path,default=Path('/tmp/player-layout'))
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    report=[];blocks=fixture_blocks()
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        timers.native_entry_checks(browser,args.url)
        for size in [(375,667),(393,852),(430,932),(375,540),(320,568),(667,375)]:
            label=f'{size[0]}x{size[1]}'
            page=timers.fresh(browser,args.url,size);page.add_style_tag(content=SAFE_AREAS)
            page.evaluate(timers.ROUTINE)
            check(page,report,label+'-routine');capture(page,args.output,label+'-routine')
            page.evaluate("document.getElementById('exerciseName').textContent='Kneeling hamstring stretch - Right';state.remaining=137;renderTick(137,300)")
            check(page,report,label+'-routine-long');page.locator('#routineRing').click()
            check(page,report,label+'-routine-paused');page.locator('#routineRing').click()
            optional_checks(page,report,args.output,label+'-routine')
            page.evaluate('enterRestOrNext()');check(page,report,label+'-routine-rest')
            for kind in ['warmup','cooldown']:
                page.evaluate(f"startRoutine('{kind}','bodyweight');enterWork()")
                check(page,report,label+'-'+kind)
            for workout in ['workout300','cindy']:
                page.evaluate(f"startFixedWorkout('{workout}')")
                check(page,report,label+'-'+workout);capture(page,args.output,label+'-'+workout)
            # Fixed reps accept large explicit targets without ellipsising them.
            page.evaluate("FIXED_WORKOUTS.layoutTarget={...FIXED_WORKOUTS.workout300,id:'layoutTarget',exercises:[{...FIXED_WORKOUTS.workout300.exercises[0],reps:999999}]};startFixedWorkout('layoutTarget')")
            check(page,report,label+'-large-rep-target')
            assert '999999' in page.locator('#workoutTarget').text_content()
            # Untimed fixed sequence work uses the other player's pause/target.
            page.evaluate("FIXED_WORKOUTS.layoutReps={name:'Rep sequence',termination:{type:'fixed-sequence'},exercises:[{id:'push-up',name:'Push-ups',reps:5}]};GarageFitWorkoutUI.startFixedSequenceWorkout('layoutReps')")
            for _ in range(3):timers.pulse(page,'state.timer')
            check(page,report,label+'-fixed-reps')
            for item in protocols(page,blocks):
                page.evaluate('i=>enterGeneratedPhase(i)',item['i'])
                check(page,report,label+'-'+item['key'])
                if item['key'].startswith('main:') and ':exercise:' in item['key']:
                    capture(page,args.output,label+'-'+item['key'].replace(':','-'))
            # Start a fresh density run for long labels, partial entry and pause.
            protocols(page,blocks)
            page.evaluate("enterGeneratedPhase(generatorState.timeline.findIndex(p=>p.protocol==='density'));document.getElementById('workoutExercise').textContent='Push-ups with a controlled lowering phase'")
            check(page,report,label+'-density-long');capture(page,args.output,label+'-density-long')
            optional_checks(page,report,args.output,label+'-density')
            page.locator('#workoutRing').click();check(page,report,label+'-density-paused');page.locator('#workoutRing').click()
            # Expiry exposes the optional partial-rep form. Its existing submit
            # handler must still persist evidence after the form is contained.
            timers.pulse(page,'generatorState.phaseTimer',300000)
            check(page,report,label+'-density-cap')
            optional_checks(page,report,args.output,label+'-density-cap')
            page.locator('#densityPartial > summary').click()
            page.locator('#densityPartialReps').fill('3')
            partial_id=page.evaluate('densityRun().partialPhase.occurrenceId')
            page.locator('#densityPartialSave').click()
            page.wait_for_function('densityRun().partialPhase===null')
            partial_outcome=page.evaluate('id=>generatorState.tracker.outcome(id)',partial_id)
            assert partial_outcome['status']=='partial' and partial_outcome['sets'][0]['reps']==3,partial_outcome
            check(page,report,label+'-density-partial-saved')
            # Exercise orientation changes on the same active session.
            page.set_viewport_size({'width':852,'height':393});check(page,report,label+'-rotate')
            page.set_viewport_size({'width':size[0],'height':size[1]});check(page,report,label+'-rotate-back')
            timers.start_coach(page)
            page.evaluate("enterGeneratedPhase(generatorState.timeline.findIndex(p=>p.exercise?.coachAnchor))")
            check(page,report,label+'-coach-anchor');capture(page,args.output,label+'-coach-anchor')
            optional_checks(page,report,args.output,label+'-coach')
            # Real Next persists entered Coach actuals; no DOM-only form test.
            occurrence=page.evaluate('currentGeneratedPhase().occurrenceId')
            page.locator('#completeMovementBtn').click()
            page.wait_for_function('id=>currentGeneratedPhase().occurrenceId!==id',arg=occurrence)
            outcome=page.evaluate('id=>generatorState.tracker.outcome(id)',occurrence)
            assert outcome['sets'][0]['reps']==7 and outcome['sets'][0]['load']==12.5,outcome
            # Emulate extreme text enlargement: readable content may reflow in
            # a contained stage, but navigation and the page still cannot scroll.
            page.set_viewport_size({'width':375,'height':540})
            page.evaluate("startFixedWorkout('workout300');document.getElementById('workoutExercise').textContent='Push-ups with a controlled lowering phase'")
            page.add_style_tag(content='.workout-exercise{font-size:54px!important}.workout-target{font-size:46px!important}.movement-progress{font-size:22px!important}')
            check(page,report,label+'-enlarged-text',allow_reflow=True)
            assert page.locator('#workoutPlayer').evaluate("e=>e.classList.contains('player-reflow')")
            page.locator('#workoutStage').evaluate('e=>e.scrollTop=e.scrollHeight')
            check(page,report,label+'-enlarged-text-scrolled',allow_reflow=True)
            page.close();print('Viewport passed:',label,flush=True)
        browser.close()
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(f'Passed {len(report)} measured layouts, native entry points and Coach actual recording. Evidence: {args.output}',flush=True)


if __name__=='__main__':main()
