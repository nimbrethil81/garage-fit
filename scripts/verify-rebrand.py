"""Verify #376 at one origin, using a pre-rebrand preview to supply the old build.
Run both preview_server.py instances, then:
python3 scripts/verify-rebrand.py OUTPUT [NEW_URL] [OLD_URL]
Developer-only Playwright/Chromium; physical installed iPhone remains unverified.
"""
import ast
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
url = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:8000'
old = sys.argv[3] if len(sys.argv) > 3 else 'http://127.0.0.1:8001'
# Reuse the maintained synthetic Coach/results fixture without running that script.
seed = next(node.value.value for node in ast.parse(Path('scripts/verify-backup.py').read_text()).body
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'seed' for t in node.targets))
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 320, 'height': 800})
    page = context.new_page(); errors = []
    session = context.new_cdp_session(page)
    session.send('Network.enable')
    session.send('Network.setCacheDisabled', {'cacheDisabled': True})
    page.on('pageerror', lambda error: errors.append(str(error)))
    def baseline(route):
        route.fulfill(response=route.fetch(url=route.request.url.replace(url, old, 1)))
    page.route(url + '/**', baseline)
    page.goto(url + '/'); page.wait_for_function('window.garageFitAppReady===true')
    assert page.title() == 'Garage Fit'
    page.evaluate(seed)
    page.evaluate("""()=>{
      localStorage.setItem('gf_generator_duration','20');
      localStorage.setItem('gf_generator_focus','strength');
      localStorage.setItem('gf_generator_difficulty','hard');
      localStorage.setItem('gf_generator_history','[["goblet-squat","plank"]]');
      GarageFitAppearance.choose('dark');
    }""")
    page.reload(); page.wait_for_function('window.garageFitAppReady===true')
    before = page.evaluate('Object.fromEntries(Object.entries(localStorage))')
    history = page.evaluate('async()=>JSON.stringify(await GarageFitCoachStore.createStore(localStorage).listSessionResults())')
    page.unroute(url + '/**', baseline)
    page.reload(); page.wait_for_function('window.garageFitAppReady===true')
    after = page.evaluate('Object.fromEntries(Object.entries(localStorage))')
    assert before == after, 'Update changed live storage'
    assert history == page.evaluate('async()=>JSON.stringify(await GarageFitCoachStore.createStore(localStorage).listSessionResults())')
    assert page.title() == 'PickSetGo'
    captures = []
    for mode in ['light', 'dark']:
        for width in [320, 390]:
            page.set_viewport_size({'width': width, 'height': 800})
            page.evaluate('(mode)=>GarageFitAppearance.choose(mode)', mode)
            for screen in ['home', 'workouts', 'generator', 'coach', 'more']:
                page.evaluate({'home': 'goHome()', 'workouts': 'goWorkouts()',
                               'generator': 'goGenerator()', 'coach': 'coachUI.open()',
                               'more': "showScreen('more')"}[screen])
                page.locator('#' + screen).evaluate('e=>e.scrollTop=0')
                host = page.locator('#' + screen + ' [data-masthead]')
                host.evaluate('e=>{for(let p=e;p;p=p.parentElement)p.scrollTop=0;window.scrollTo(0,0)}')
                assert host.bounding_box()['y'] >= 0, 'Masthead must be visible'
                assert host.get_attribute('aria-label') == 'PickSetGo'
                assert host.inner_text() == 'PickSetGo'
                metrics = host.evaluate('''e=>{
                  const name=e.querySelector('.brand-name'), accent=name.querySelector('strong');
                  const box=name.getBoundingClientRect(), parent=e.getBoundingClientRect();
                  return {neutral:getComputedStyle(name).color,accent:getComputedStyle(accent).color,
                    expected:getComputedStyle(e).getPropertyValue('--work-text').trim(),
                    fits:box.right<=parent.right+1, text:accent.textContent};
                }''')
                assert metrics['fits'] and metrics['text'] == 'Set'
                assert metrics['accent'] != metrics['neutral']
                assert page.locator('#bottomNav').is_visible()
                assert page.locator('#' + screen).evaluate('e=>e.scrollWidth<=e.clientWidth+1')
                filename = f'{mode}-{width}-{screen}.png'
                page.screenshot(path=str(out / filename)); captures.append(filename)
    assert not errors, errors
    (out / 'results.json').write_text(json.dumps({'unchangedStorageKeys': sorted(before),
        'exactStoragePreserved': True, 'historyPreserved': True, 'captures': captures,
        'browserErrors': errors, 'physicalIPhoneVerified': False}, indent=2))
    browser.close()
print('Same-origin GarageFit → PickSetGo update preserved all storage; 20 primary-tab captures passed')
