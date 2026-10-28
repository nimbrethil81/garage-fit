"""Optional browser layout regression/evidence check (Playwright + Chromium).

Serve the checkout, then run:
  python scripts/verify-player-layout.py --url http://127.0.0.1:8000 --output /tmp/player-layout
Set CHROMIUM_PATH to use a Chromium binary other than /usr/bin/chromium.
No browser dependency is added to the app or its Node test suite.
"""
import argparse
from datetime import datetime, timezone
import importlib.util
import json
import os
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
 // #235: one muted preview directly above a centred primary action, never inside it.
 const primary=controls.querySelector('#skipPhaseBtn,#completeMovementBtn'),preview=controls.querySelector('.next-preview'),pb=box(primary);
 if(primary.querySelector('.next-preview,#routineNextName,#completeMovementNext')||!preview)failures.push('preview inside primary');
 else if(getComputedStyle(preview).visibility==='visible'&&(box(preview).bottom>pb.y+1||preview.textContent.trim()==='Next:'))failures.push('preview misplaced or empty');
 if(preview&&new Set([preview,...preview.querySelectorAll('*')].map(e=>getComputedStyle(e).color)).size>1)failures.push('preview colour not uniform');
 // GF-R1 (#280): where Previous exists (workout player) Previous is LEFT of the
 // primary action in ONE row, at every size; only the routine player, which has no
 // Previous control, centres its primary action.
 const previous=controls.querySelector('#previousWorkoutBtn');
 if(previous){
   const pr=box(previous),portrait=v.width<540&&p.clientHeight>580;
   if(!visible(previous))failures.push('previous not visible');
   else{
     if(Math.abs(pr.y-pb.y)>1||Math.abs(pr.bottom-pb.bottom)>1)failures.push('previous and primary not in one row');
     if(pr.right>pb.x+1)failures.push('previous not left of primary');
     if(pr.x<nav.x-1||pb.right>nav.right+1)failures.push('previous/primary outside navigation');
     if(pr.bottom>pb.y&&pr.y<pb.bottom&&pr.right>pb.x+1)failures.push('previous overlaps primary');
     if(portrait){
       if(pr.width<100||pb.width<100)failures.push('portrait row buttons too narrow');
       if(pr.x+pr.width/2>nav.x+nav.width/2||pb.x+pb.width/2<nav.x+nav.width/2)failures.push('portrait row not left/right');
       const preview=controls.querySelector('.next-preview');
       if(box(preview).bottom>Math.min(pr.y,pb.y)+1)failures.push('preview not above navigation row');
     }
   }
 }else{
   if(Math.abs(pb.x+pb.width/2-nav.x-nav.width/2)>1)failures.push('primary off centre');
   if(v.width<540&&Math.abs(pb.width/nav.width-.7)>.02)failures.push('primary not ~70% wide');
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
   const divider=getComputedStyle(r,'::after'),dividerBottom=ring.bottom-parseFloat(divider.bottom);
   if(divider.display==='none'||parseFloat(divider.width)<20||dividerBottom>box(r.parentElement).bottom+0.5)failures.push('timer divider missing or outside timer space');
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
    settle(page)
    page.mouse.move(0,0)
    page.screenshot(path=str(output/(label+'.png')),animations='disabled')
    # Record the only two visual regions approved for WP-V1–V4 comparisons.
    regions=page.locator('#workoutPlayer:not(.hidden) #workoutMovementProgress, #workoutPlayer:not(.hidden) .overall-progress').evaluate_all('nodes=>nodes.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})')
    region_file=output/'progress-regions.json'
    saved=json.loads(region_file.read_text()) if region_file.exists() else {}
    saved[label+'.png']=regions
    region_file.write_text(json.dumps(saved,indent=2)+'\n')


def fixture_blocks():
    return json.loads(subprocess.check_output(['node','-e',"global.window=global;require('./data/exercises.js');console.log(JSON.stringify(require('./tests/helpers/protocol-fixtures').blockFixtures(GarageFitData.exercises,{emom:true,ladder:true,pyramid:true,complex:true,density:true,amrap:true})))"],text=True))


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
            page.locator('#coachActualLoad').focus();settle(page)
            page.locator('#coachAnchorEdit .player-detail-content').evaluate('e=>e.scrollTop=0')
            page.locator('#coachActualLoad').evaluate("e=>e.scrollIntoView({block:'nearest'})")
            check(page,report,label+'-keyboard',optional=True,allow_reflow=True)
            assert page.locator('#coachActualLoad').evaluate("e=>{const r=e.getBoundingClientRect(),c=e.closest('.player-detail-content').getBoundingClientRect();return r.top>=c.top-1&&r.bottom<=c.bottom+1}")
            capture(page,output,label+'-keyboard')
            page.evaluate("delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'))")
        check(page,report,label+'-'+selector[1:]+'-restored',optional=True)
        capture(page,output,label+'-'+selector[1:])
        close.focus();page.keyboard.press('Escape');settle(page)
        assert not page.locator(selector).evaluate('e=>e.open')
        assert summary.evaluate('e=>e===document.activeElement')
        check(page,report,label+'-closed')


def instruction_speech_checks(browser, url):
    # Stub the browser speech boundary, retaining the app's real shared speaker,
    # selected-voice path and native disclosure/keyboard/touch interactions.
    for unsupported in [False, True]:
        page=browser.new_page(viewport={'width':393,'height':852},has_touch=True)
        page.add_init_script(timers.CLOCK)
        page.add_init_script("""window.__spoken=[];window.__speechQueue=[];window.__cancels=0;
          Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
            getVoices:()=>[],addEventListener(){},
            cancel(){__cancels++;__speechQueue.length=0},
            speak(u){__spoken.push(u.text);__speechQueue.push(u.text)}
          }});""")
        if unsupported:
            page.add_init_script("Object.defineProperty(window,'SpeechSynthesisUtterance',{value:undefined})")
        page.goto(url)
        page.wait_for_function("typeof speakDisplayedInstruction==='function'")
        for player, details, start in [
            ('player','routineInstruction',timers.ROUTINE),
            ('workoutPlayer','workoutInstruction',"startFixedWorkout('workout300')")
        ]:
            page.evaluate(start)
            page.evaluate("id=>setInstructionDisclosure(id,CATALOGUE['trx-row'])",details)
            page.wait_for_function("id=>document.getElementById(id+'Image').datasetReady",arg=details)
            summary=page.locator('#'+details+' > summary')
            content=page.locator('#'+details+' .player-detail-content')
            close=page.locator('#'+details+' .player-detail-close')
            before=page.evaluate('__spoken.length')
            summary.tap();settle(page)
            assert page.evaluate('__spoken.length')==before
            assert close.evaluate('e=>e===document.activeElement')
            assert content.locator('.player-instruction-speaker').count()==(0 if unsupported else 1)
            if unsupported:
                assert content.get_attribute('role') is None
                content.tap()
                assert page.evaluate('__spoken.length')==before
                close.click()
                continue
            assert content.get_attribute('role')=='button'
            assert 'Read exercise instruction aloud' in content.get_attribute('aria-label')
            snapshot=page.evaluate('JSON.stringify({state,workoutState,generatorState})')
            expected=page.locator('#'+details+'Text').text_content()
            for action in ['image','text','tap','tap','Enter','Space']:
                cancellations=page.evaluate('__cancels')
                if action=='image':
                    page.locator('#'+details+'Image img').tap()
                elif action=='text':
                    page.locator('#'+details+'Text').tap()
                elif action=='tap':
                    # Hit blank space at the bottom of the expanded content.
                    content.tap(position={'x':12,'y':content.bounding_box()['height']-12})
                else:
                    content.focus();page.keyboard.press(action)
                assert page.evaluate('__speechQueue')==[expected]
                assert page.evaluate('__cancels')==cancellations+1
                assert page.evaluate('JSON.stringify({state,workoutState,generatorState})')==snapshot
            # Close, Escape and toggling the native summary never speak.
            before=page.evaluate('__spoken.length')
            close.click();settle(page)
            assert summary.evaluate('e=>e===document.activeElement')
            summary.click();settle(page)
            content.focus();page.keyboard.press('Escape');settle(page)
            assert not page.locator('#'+details).evaluate('e=>e.open')
            assert summary.evaluate('e=>e===document.activeElement')
            summary.click();settle(page)
            summary.evaluate('e=>e.click()');settle(page)
            assert not page.locator('#'+details).evaluate('e=>e.open')
            assert page.evaluate('__spoken.length')==before
            page.evaluate("speak('Automatic cue.')")
            assert page.evaluate('__speechQueue')==['Automatic cue.']
            # No other optional surface receives a narration target.
            assert page.locator('#coachAnchorEdit [role=button],#densityPartial [role=button]').count()==0
        page.close()


def illustrated_checks(page, report, output, label):
    for player, details, start in [('player','routineInstruction',timers.ROUTINE),
                                    ('workoutPlayer','workoutInstruction',"startFixedWorkout('workout300')")]:
        page.evaluate(start)
        for exercise_id in ['trx-row','skater-jumps','side-plank','air-squat']:
            page.evaluate("args=>setInstructionDisclosure(args[0],CATALOGUE[args[1]])", [details,exercise_id])
            if exercise_id!='air-squat':
                page.wait_for_function("id=>document.getElementById(id+'Image').datasetReady", arg=details)
            page.locator('#'+details+' > summary').click();settle(page)
            check(page,report,label+'-'+player+'-'+exercise_id,optional=True)
            image=page.locator('#'+details+'Image')
            report[-1]['artwork']='visible' if image.is_visible() else 'text-only'
            if exercise_id=='air-squat':assert image.is_hidden()
            if image.is_visible():
                assert image.bounding_box()['width']>=160
                assert image.locator('img').evaluate('e=>e.naturalWidth>0&&getComputedStyle(e).objectFit==="contain"')
            ring=page.locator('#'+player+' .ring-wrap:visible')
            surface=page.locator('#'+details+' .player-detail-surface')
            if ring.count():
                r,d=ring.bounding_box(),surface.bounding_box()
                assert abs(r['width']-r['height'])<.1 and r['width']>=100
                assert ring.evaluate('e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
                assert r['y']+r['height']<=d['y']+1 or r['x']+r['width']<=d['x']+1, (label,r,d)
            if exercise_id=='trx-row':capture(page,output,label+'-'+player+'-illustrated')
            page.locator('#'+details+' .player-detail-close').click();settle(page)


def shell_navigation_checks(browser, url):
    """The tab bar follows the visual viewport, including after player exit.

    Chromium cannot reproduce iOS fixed-position containing-block quirks. Supply
    differing visual/layout viewport heights explicitly, then check real geometry.
    Substitute safe-area env values in served styles without overriding app sizing.
    """
    for theme,safe_bottom in [('light',0),('light',34),('dark',0),('dark',34)]:
        page=browser.new_page(viewport={'width':393,'height':852},device_scale_factor=3,has_touch=True)
        def safe_areas(route):
            response=route.fetch()
            body=response.text().replace('env(safe-area-inset-top)','59px').replace('env(safe-area-inset-bottom)',str(safe_bottom)+'px')
            route.fulfill(response=response,body=body)
        page.route('**/index.html',safe_areas)
        page.route('**/css/*.css',safe_areas)
        page.add_init_script("""window.__shellHeight=852;window.__shellTop=0;
          Object.defineProperty(visualViewport,'height',{get:()=>__shellHeight});
          Object.defineProperty(visualViewport,'offsetTop',{get:()=>__shellTop});""")
        page.goto(url.rstrip('/')+'/index.html')
        page.wait_for_function("typeof coachUI!=='undefined' && coachUI")
        page.evaluate('(theme)=>document.documentElement.dataset.appearance=theme',theme)
        for height,top in [(852,0),(700,0),(760,24),(852,0)]:
            page.evaluate("""([h,t])=>{__shellHeight=h;__shellTop=t;visualViewport.dispatchEvent(new Event('resize'))}""",[height,top])
            for tab in ['home','workouts','generator','coach','more']:
                page.evaluate('(tab)=>showLanding(tab)',tab)
                settle(page)
                metrics=page.evaluate("""()=>{
                  const nav=document.getElementById('bottomNav'),r=nav.getBoundingClientRect();
                  const buttons=[...nav.querySelectorAll('button')];
                  return {bottom:r.bottom,targets:buttons.map(b=>{
                    const r=b.getBoundingClientRect();return {bottom:r.bottom,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};
                  })};
                }""")
                assert abs(metrics['bottom']-(top+height+safe_bottom))<1,(theme,tab,height,metrics)
                assert all(b['bottom']<=top+height and b['hit'] for b in metrics['targets']),(theme,tab,height,metrics)
            for player in ['player','workoutPlayer']:
                page.evaluate('(id)=>showScreen(id)',player)
                assert not page.locator('#bottomNav').is_visible()
                page.evaluate("showLanding('workouts')")
                settle(page)
                assert abs(page.locator('#bottomNav').bounding_box()['y']+page.locator('#bottomNav').bounding_box()['height']-(top+height+safe_bottom))<1
        page.close()
    print('Shell navigation passed: both themes, zero/34px bottom safe areas, five tabs, visual viewport changes and both player returns',flush=True)


def standalone_root_checks(browser, url):
    """Contract check for the measured iPhone 15 discrepancy, not an iOS compositor reproduction."""
    report=[]
    for theme in ['light','dark']:
        page=browser.new_page(viewport={'width':393,'height':852},device_scale_factor=3,has_touch=True)
        def safe_areas(route):
            response=route.fetch()
            route.fulfill(response=response,body=response.text().replace('env(safe-area-inset-top)','59px').replace('env(safe-area-inset-bottom)','34px'))
        page.route('**/index.html',safe_areas);page.route('**/css/*.css',safe_areas)
        page.add_init_script("""Object.defineProperty(navigator,'standalone',{value:true});
          window.__rootHeight=793;
          Object.defineProperty(window,'innerHeight',{get:()=>793});
          Object.defineProperty(visualViewport,'height',{get:()=>__rootHeight});""")
        page.goto(url.rstrip('/')+'/index.html')
        page.wait_for_function("typeof coachUI!=='undefined' && coachUI")
        page.evaluate('(theme)=>document.documentElement.dataset.appearance=theme',theme)
        for height,expected in [(793,852),(380,380),(793,852)]:
            page.evaluate("h=>{__rootHeight=h;visualViewport.dispatchEvent(new Event('resize'))}",height)
            for tab in ['home','workouts','generator','coach','more']:
                page.evaluate('(tab)=>showLanding(tab)',tab);settle(page)
                result=page.evaluate("""()=>{
                  const app=document.getElementById('app'),nav=document.getElementById('bottomNav');
                  return {position:getComputedStyle(app).position,height:app.getBoundingClientRect().height,
                    top:nav.getBoundingClientRect().top,bottom:nav.getBoundingClientRect().bottom,navHeight:nav.getBoundingClientRect().height,
                    targets:[...nav.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect(),icon=b.firstElementChild.getBoundingClientRect(),label=b.lastElementChild.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width,iconTop:icon.top,iconHeight:icon.height,labelTop:label.top,labelBottom:label.bottom,labelHeight:label.height,hit:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})};
                }""")
                assert result['position']=='relative' and abs(result['height']-expected)<1,(tab,height,result)
                assert abs(result['bottom']-expected)<1,(tab,height,result)
                # Measured visible layout from 40521292f at 393px: 81px bar,
                # 64px targets, 21px icons and natural 23px/11.5px labels.
                # Its shell extended 34px off-screen; this root does not.
                assert abs(result['navHeight']-81)<1,(tab,height,result)
                assert max(b['iconTop'] for b in result['targets'])-min(b['iconTop'] for b in result['targets'])<1,(tab,height,result)
                assert all(abs(b['top']-result['top']-9)<1 and abs(b['height']-64)<1 and b['width']>=44 and abs(b['bottom']-(expected-8))<1 and b['hit'] for b in result['targets']),(tab,height,result)
                assert all(abs(b['iconTop']-result['top']-17)<1 and b['iconHeight']==21 and abs(b['labelTop']-result['top']-42)<1 and b['labelBottom']<=expected-16 for b in result['targets']),(tab,height,result)
                assert [b['labelHeight'] for b in result['targets']]==[23,11.5,11.5,11.5,11.5],(tab,height,result)
                report.append(dict(theme=theme,tab=tab,reportedHeight=height,**result))
        for player in ['player','workoutPlayer']:
            page.evaluate('(id)=>showScreen(id)',player);settle(page)
            assert page.locator('#app').evaluate("e=>getComputedStyle(e).position==='fixed' && e.getBoundingClientRect().height===793")
            page.evaluate("showLanding('workouts')");settle(page)
            assert page.locator('#app').evaluate('e=>e.getBoundingClientRect().height===852')
        page.close()
    print('Standalone root passed: 793/852 discrepancy, keyboard/recovery, safe menu targets and unchanged players, both themes',flush=True)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8000')
    parser.add_argument('--output',type=Path,default=Path('/tmp/player-layout'))
    parser.add_argument('--navigation-only',action='store_true',help='Check the primary tab shell without running player fixtures')
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    report=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
        navigation=standalone_root_checks(browser,args.url)
        shell_navigation_checks(browser,args.url)
        (args.output/'navigation-report.json').write_text(json.dumps(navigation,indent=2))
        if args.navigation_only:
            browser.close()
            return
        blocks=fixture_blocks()
        instruction_speech_checks(browser,args.url)
        timers.native_entry_checks(browser,args.url)
        for size in [(375,667),(390,844),(393,852),(430,932),(375,540),(320,568),(360,640),(667,375)]:
            label=f'{size[0]}x{size[1]}'
            page=timers.fresh(browser,args.url,size);page.add_style_tag(content=SAFE_AREAS+'\n*,*::before,*::after{transition:none!important;animation:none!important}')
            illustrated_checks(page,report,args.output,label)
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
                # Finish workout is the longest primary label; it must stay in the row.
                page.evaluate("document.getElementById('completeMovementAction').textContent='Finish workout'")
                check(page,report,label+'-'+workout+'-finish-label')
                assert page.locator('#completeMovementBtn').text_content().strip()=='Finish workout'
                page.evaluate("document.getElementById('completeMovementAction').textContent='Next'")
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
            # AMRAP: one cap clock across repeated rounds, then the active exercise at zero.
            protocols(page,blocks)
            page.evaluate("enterGeneratedPhase(generatorState.timeline.findIndex(p=>p.protocol==='amrap'));document.getElementById('workoutExercise').textContent='TRX chest press with a slow controlled return'")
            check(page,report,label+'-amrap-long');capture(page,args.output,label+'-amrap-long')
            optional_checks(page,report,args.output,label+'-amrap')
            for _ in range(3):
                page.evaluate('__now+=400');page.locator('#completeMovementBtn').click()
                page.wait_for_function('!coachAdvancing')
            assert 'Round 2' in page.locator('#workoutMovementProgress').text_content()
            check(page,report,label+'-amrap-round-2')
            page.locator('#workoutRing').click();check(page,report,label+'-amrap-paused');page.locator('#workoutRing').click()
            timers.pulse(page,'generatorState.phaseTimer',300000)
            assert page.locator('#workoutRingNum').text_content()=='0'
            check(page,report,label+'-amrap-zero');capture(page,args.output,label+'-amrap-zero')
            page.evaluate('__now+=400');page.locator('#completeMovementBtn').click()
            page.wait_for_function("currentGeneratedPhase().protocol!=='amrap'")
            check(page,report,label+'-amrap-ended')
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
    (args.output/'manifest.json').write_text(json.dumps({
        'app':'GarageFit','scope':'player-instructions','captured_at':datetime.now(timezone.utc).isoformat(),
        'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
        'source_reference':subprocess.check_output(['git','branch','--show-current'],text=True).strip(),
        'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],text=True).strip()),
        'screenshots':sorted(f.name for f in args.output.glob('*.png')),'result':'passed',
        'note':'Chromium emulation, not physical iPhone/Safari validation.'
    },indent=2)+'\n')
    print(f'Passed {len(report)} measured layouts, native entry points and Coach actual recording. Evidence: {args.output}',flush=True)


if __name__=='__main__':main()
