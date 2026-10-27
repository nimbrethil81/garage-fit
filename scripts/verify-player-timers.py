"""Timer interaction helpers shared by the active player browser checks.

Run this script or verify-player-layout.py with --url and --output. The viewport
suite also checks real timer controls. Pre-#166 pixel equality is superseded by
proportional ring geometry checks: timers now size to the available stage height.
"""
from pathlib import Path
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
    for name in ['7 Minute Workout','5-Minute Ab Blast','Evening Full-Body Reset','Post Run Stretch','Cindy','300 Workout']:
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
        page.evaluate("showLanding('home')")
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


if __name__ == '__main__':
    import runpy
    runpy.run_path(str(Path(__file__).with_name('verify-player-layout.py')), run_name='__main__')
