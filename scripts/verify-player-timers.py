"""Optional browser regression/evidence check. Requires Playwright, Pillow and Chromium.

Serve this checkout locally; optionally serve an unchanged pre-#164 checkout too:
  python scripts/verify-player-timers.py --url http://127.0.0.1:8000 \
      --reference-url http://127.0.0.1:8001 --output /tmp/player-timers
The app itself and its Node test suite remain dependency-free.
"""
import argparse
import io
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
from playwright.sync_api import sync_playwright

CLOCK = """window.__intervals=new Map();window.__timer=0;window.__now=0;
const epoch=Date.now();Date.now=()=>epoch+window.__now;
Object.defineProperty(performance,'now',{value:()=>window.__now});
window.setInterval=fn=>{window.__intervals.set(++window.__timer,fn);return window.__timer};
window.clearInterval=id=>window.__intervals.delete(id);
let seed=164;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
window.__pulse=async(ms,id)=>{window.__now+=ms;await window.__intervals.get(id)?.()};"""
ROUTINE = """startRoutine('warmup','bodyweight');
state.list=[{id:'arm-side-circles',name:'Arm Circles',work:30,rest:30},
{id:'body-twists',name:'Standing torso twists',work:30,rest:0}];
state.idx=0;enterWork();state.remaining=17;renderTick(17,30);"""
GENERATED = """state.ownedEquipment=['dumbbells'];
generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:20,focus:'balanced',equipment:state.ownedEquipment,random:()=>0.4});
startStandaloneGeneratedWorkout();"""
TIMED = """enterGeneratedPhase(generatorState.timeline.findIndex(p=>p.kind==='exercise'&&p.timed&&p.section==='warmup'));
currentGeneratedPhase().seconds=30;generatorState.remaining=17;renderWorkoutRing();"""
METRICS = """e=>{const rect=x=>{const b=x.getBoundingClientRect(),r=e.getBoundingClientRect();return [b.x-r.x,b.y-r.y,b.width,b.height]};
const n=e.querySelector('.timer-num'),l=e.querySelector('.phase-label'),s=getComputedStyle(n),fg=e.querySelector('.ring-fg'),f=getComputedStyle(fg);
return {ring:rect(e),number:rect(n),label:rect(l),font:[s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.fontVariantNumeric],stroke:[f.stroke,f.strokeWidth,f.strokeLinecap],offset:Number(fg.style.strokeDashoffset)}}"""


def fresh(browser, url, size):
    page=browser.new_page(viewport={'width':size[0],'height':size[1]},has_touch=True)
    page.set_default_timeout(30000)
    page.add_init_script(CLOCK)
    page.goto(url)
    page.wait_for_function("typeof coachUI!=='undefined' && coachUI")
    return page


def pulse(page, state, ms=1000):
    page.evaluate(f'__pulse({ms},{state})')


def controls(page, ring_id, state, remaining, timer, next_id, pause_id):
    ring=page.locator('#'+ring_id)
    assert ring.is_visible() and not page.locator('#'+pause_id).is_visible()
    before=page.evaluate(remaining)
    number=ring.locator('.timer-num').bounding_box()
    # Real touch activation, a click, Space and Enter each toggle exactly once.
    for method in ['tap','click','Space','Enter']:
        if method=='tap': ring.tap()
        elif method=='click': ring.click()
        else:
            ring.focus()
            page.keyboard.press(method)
            assert ring.evaluate("e=>e.matches(':focus-visible') && getComputedStyle(e).outlineWidth==='3px'")
        assert page.evaluate(state) is True, method
        assert ring.get_attribute('aria-pressed')=='true'
        assert 'resume timer' in ring.get_attribute('aria-label')
        assert ring.locator('.timer-num').bounding_box()==number
        assert page.locator('#'+next_id).is_disabled()
        pulse(page,timer,5000)
        assert page.evaluate(remaining)==before
        ring.click()
        assert page.evaluate(state) is False
    pulse(page,timer)
    assert page.evaluate(remaining)==before-1
    # Instructions are independent, including their native disclosure behaviour.
    details='#routineInstruction' if ring_id=='routineRing' else '#workoutInstruction'
    if page.locator(details+' summary').is_visible():
        page.locator(details+' summary').click()
        assert page.evaluate(state) is False
        assert page.locator(details).get_attribute('open') is not None


def native_entry_checks(browser,url):
    # Real catalogue detail/Start clicks exercise the installed Workouts UI wrapper.
    for name in ['7 Minute Workout','5-Minute Ab Blast','Evening Full-Body Reset','Post-Run Reset','Cindy','300 Workout']:
        page=fresh(browser,url,(390,844))
        page.evaluate("showLanding('workouts')")
        page.get_by_role('button',name='View '+name+' details',exact=True).click()
        page.locator('#fixedWorkoutDetailStart').click()
        routine=page.locator('#player').is_visible()
        if routine:
            assert page.locator('#routineRing').is_visible()
            pulse(page,'state.timer',1000);pulse(page,'state.timer',1000);pulse(page,'state.timer',1000)
            controls(page,'routineRing','state.paused','state.remaining','state.timer','skipPhaseBtn','routinePause')
            page.locator('#skipPhaseBtn').click()
        else:
            assert not page.locator('#workoutRing').is_visible()
            pause=page.locator('#workoutPausedState');assert pause.is_visible()
            pause.click();assert page.evaluate('workoutState.paused') is True
            pause.press('Enter');assert page.evaluate('workoutState.paused') is False
            page.locator('#completeMovementBtn').click()
            page.locator('#previousWorkoutBtn').click()
        page.close()
        print('Entry passed:',name,flush=True)
    for kind in ['warmup','cooldown']:
        page=fresh(browser,url,(390,844))
        page.locator('#tile-'+kind).click()
        for _ in range(3): pulse(page,'state.timer')
        controls(page,'routineRing','state.paused','state.remaining','state.timer','skipPhaseBtn','routinePause')
        page.locator('#player .close-btn').click()
        pulse(page,'state.timer',5000)
        assert page.evaluate('state.paused') is True
        page.locator('#stayBtn').click();assert page.evaluate('state.paused') is False
        page.close()

    page=fresh(browser,url,(390,844))
    page.locator('#generatorNav').click()
    page.get_by_role('button',name='Generate workout',exact=True).click(timeout=60000)
    page.locator('#generatedPreview .preview-start').click()
    controls(page,'workoutRing','workoutState.paused','generatorState.remaining','generatorState.phaseTimer','completeMovementBtn','workoutPausedState')
    page.locator('#completeMovementBtn').click()
    assert page.evaluate("currentGeneratedPhase().kind==='exercise'")
    page.locator('#workoutPlayer .close-btn').click()
    assert page.evaluate('workoutState.paused') is True
    page.locator('#stayBtn').click()
    assert page.evaluate('workoutState.paused') is False
    page.close()
    print('Entry passed: Generator',flush=True)


def start_coach(page):
    page.evaluate("""async()=>{state.ownedEquipment=['dumbbells'];
await coachUI.controller.start(GarageFitData.programmes['general-strength-4w'][1],state.ownedEquipment);await coachUI.open()}""")
    page.get_by_role('button',name='View today’s workout',exact=True).click(timeout=60000)
    page.get_by_role('button',name='Start workout',exact=True).click()
    assert page.evaluate('isCoachPlayer()') is True


def assert_divider_clear(page):
    note=page.locator('#workoutSideNote')
    if note.is_visible() and note.text_content().strip():
        ring=page.locator('#workoutRing').bounding_box()
        assert note.bounding_box()['y']>ring['y']+ring['height']+27, 'Divider must clear the side/load label'


def capture(page, ring_id, output, stem):
    page.evaluate('document.activeElement?.blur()')
    if ring_id=='workoutRing':assert_divider_clear(page)
    page.wait_for_timeout(350)  # Let the existing ring stroke transition settle.
    metrics=page.locator('#'+ring_id).evaluate(METRICS)
    page.screenshot(path=str(output/(stem+'.png')))
    # Same screen position removes subpixel placement differences between player layouts.
    # Width, typography, SVG and centre geometry remain the app's original computed values.
    page.locator('#'+ring_id).evaluate("e=>{e.style.position='fixed';e.style.left='40px';e.style.top='100px';e.style.margin='0';e.style.zIndex='50'}")
    isolation=page.add_style_tag(content='body *{visibility:hidden!important} #'+ring_id+',#'+ring_id+' *{visibility:visible!important}')
    crop=Image.open(io.BytesIO(page.locator('#'+ring_id).screenshot())).convert('RGB')
    isolation.evaluate('e=>e.remove()')
    crop.save(output/(stem+'-ring.png'))
    page.locator('#'+ring_id).evaluate("e=>e.removeAttribute('style')")
    return metrics,crop


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8000')
    parser.add_argument('--reference-url')
    parser.add_argument('--output',type=Path,default=Path('/tmp/player-timers'))
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    report=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        native_entry_checks(browser,args.url)
        for size in [(390,844),(375,568),(320,568)]:
            for phase in ['work','rest','cooldown']:
                panels=[];reference=None
                for mode in ['original','routine','generator','coach']:
                    if mode=='original' and not args.reference_url: continue
                    page=fresh(browser,args.reference_url if mode=='original' else args.url,size)
                    if mode in ['original','routine']:
                        page.evaluate(ROUTINE)
                        if phase=='rest':page.evaluate('enterRestOrNext();state.remaining=17;renderTick(17,30)')
                        if phase=='cooldown':page.evaluate("state.key='cooldown';document.getElementById('routineName').textContent='Cool Down';state.list=[{id:'chest-opener',name:'Chest opener',work:30,rest:0}];state.idx=0;enterWork();state.remaining=17;renderTick(17,30)")
                        ring='routineRing' if mode=='routine' else 'referenceRing'
                        if mode=='original':page.locator('#player .ring-wrap').evaluate("e=>e.id='referenceRing'")
                    else:
                        if mode=='coach':start_coach(page)
                        else:page.evaluate(GENERATED)
                        page.evaluate(TIMED.replace("section==='warmup'","section==='cooldown'") if phase=='cooldown' else TIMED)
                        if phase=='rest':page.evaluate("enterGeneratedPhase(generatorState.timeline.findIndex(p=>p.kind==='rest'));currentGeneratedPhase().seconds=30;generatorState.remaining=17;renderWorkoutRing()")
                        ring='workoutRing'
                    if mode in ['generator','coach']:
                        controls(page,ring,'workoutState.paused','generatorState.remaining','generatorState.phaseTimer','completeMovementBtn','workoutPausedState')
                        page.evaluate('generatorState.remaining=17;renderWorkoutRing()')
                        # Close the instruction disclosure for equivalent evidence captures.
                        page.locator('#workoutInstruction').evaluate("e=>e.open=false")
                    stem=f'{size[0]}x{size[1]}-{phase}-{mode}'
                    metrics,crop=capture(page,ring,args.output,stem)
                    if reference is None:reference=(metrics,crop)
                    expected,expected_crop=reference
                    for key in ['ring','number','label']:
                        assert all(abs(a-b)<0.02 for a,b in zip(metrics[key],expected[key])),(stem,key,metrics,expected)
                    for key in ['font','stroke']:assert metrics[key]==expected[key],(stem,key)
                    assert abs(metrics['offset']-expected['offset'])<0.001
                    assert crop.size==expected_crop.size
                    diff=ImageChops.difference(crop,expected_crop)
                    assert diff.getbbox() is None,(stem,'Ring pixels differ')
                    report.append({'capture':stem,'metrics':metrics,'pixelDifference':0})
                    print('Capture passed:',stem,flush=True)
                    panels.append((mode,Image.open(args.output/(stem+'.png')).convert('RGB')))
                    # At small heights the original-size ring remains intact; controls scroll into view.
                    if mode in ['generator','coach']:
                        page.locator('#completeMovementBtn').scroll_into_view_if_needed()
                        assert page.locator('#completeMovementBtn').is_visible()
                    page.close()
                if size[0]!=320:
                    comparison=Image.new('RGB',(size[0]*len(panels),size[1]+32),'#263238');draw=ImageDraw.Draw(comparison)
                    for i,(label,panel) in enumerate(panels):
                        draw.text((i*size[0]+12,10),label,fill='white');comparison.paste(panel,(i*size[0],32))
                    comparison.save(args.output/f'{size[0]}x{size[1]}-{phase}-comparison.png')
        # Triple-digit cap values keep the same centred stack while paused.
        page=fresh(browser,args.url,(390,844));page.evaluate(GENERATED+TIMED)
        page.evaluate("currentGeneratedPhase().seconds=300;currentGeneratedPhase().side='right';renderGeneratedPhase();generatorState.remaining=137;renderWorkoutRing()")
        assert_divider_clear(page)
        controls(page,'workoutRing','workoutState.paused','generatorState.remaining','generatorState.phaseTimer','completeMovementBtn','workoutPausedState')
        page.close();browser.close()
    (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(f'Passed: native entry points, touch/click/Space/Enter, pause freezing, disclosure isolation, exit/cancel and {len(report)} pixel/metric comparisons.')


if __name__=='__main__':main()
