"""Touch regression for fixed workout details (uses existing local Playwright).

Run: python scripts/verify-workout-touch-scroll.py
Screenshots and measurements are saved under /tmp/workout-touch-scroll.
Uses Chromium's native touch input; never assigns scrollTop or scrollIntoView.
Real iPhone Safari still requires a manual check.
"""
import functools
import http.server
import json
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path('/tmp/workout-touch-scroll')
WORKOUTS = ['sevenMinute', 'abBlast', 'cindy', 'workout300',
            'eveningFullBodyReset', 'postRunReset']


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def swipe(page, session, up=True):
    # Start centrally in the visible exercise list when possible, away from
    # the left-edge back gesture. CDP input invokes native browser scrolling.
    box = page.locator('#fixedWorkoutDetailExercises').bounding_box()
    height = page.viewport_size['height']
    low, high = max(100, box['y']), min(height - 40, box['y'] + box['height'])
    if high - low < 90:
        low, high = 120, height - 80
    start, end = (high - 10, low + 10) if up else (low + 10, high - 10)
    x = page.viewport_size['width'] / 2
    session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': start}]})
    for step in range(1, 13):
        session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': start + (end-start)*step/12}]})
        page.wait_for_timeout(25)
    session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    page.wait_for_timeout(250)


def reachable(page, selector):
    return page.locator(selector).evaluate('''el => {
        const r = el.getBoundingClientRect();
        const list = el.closest('ol');
        const l = list ? list.getBoundingClientRect() : {top:0,bottom:innerHeight};
        const y = (r.top+r.bottom)/2, x = (r.left+r.right)/2;
        return r.top >= Math.max(0,l.top)-1 && r.bottom <= Math.min(innerHeight,l.bottom)+1
            && el.contains(document.elementFromPoint(x,y));
    }''')


def seek(page, session, selector, up):
    for _ in range(16):
        if reachable(page, selector):
            return
        swipe(page, session, up)
    raise AssertionError(f'Cannot reach {selector} by touch')


def main():
    OUTPUT.mkdir(exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            for width, height in [(390, 844), (320, 568)]:
                for workout in WORKOUTS:
                    page = browser.new_page(viewport={'width': width, 'height': height}, has_touch=True, is_mobile=True)
                    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
                    page.wait_for_function('window.GarageFitWorkoutUI && document.getElementById("workoutDetail")')
                    page.evaluate('(id)=>{showLanding("workouts");GarageFitWorkoutUI.openWorkoutDetail(id)}', workout)
                    session = page.context.new_cdp_session(page)
                    first = '#fixedWorkoutDetailExercises li:first-child'
                    last = '#fixedWorkoutDetailExercises li:last-child'
                    instruction_index = page.locator('#fixedWorkoutDetailExercises li').evaluate_all(
                        'els=>els.findIndex(e=>e.querySelector("summary"))+1')
                    assert instruction_index > 0, workout
                    instruction = f'#fixedWorkoutDetailExercises li:nth-child({instruction_index})'
                    # Both collapsed and expanded instructions must be reachable.
                    for expanded in [False, True]:
                        if expanded:
                            seek(page, session, instruction + ' summary', False)
                            bounds = page.locator(instruction + ' summary').bounding_box()
                            page.touchscreen.tap(bounds['x'] + bounds['width']/2, bounds['y'] + bounds['height']/2)
                            assert page.locator(instruction + ' details').evaluate('e=>e.open')
                        seek(page, session, last, True)
                        assert page.locator('#workoutDetail').evaluate('e=>e.scrollWidth<=e.clientWidth+1')
                        assert page.evaluate('document.scrollingElement.scrollTop') == 0
                        page.screenshot(path=str(OUTPUT / f'{width}-{workout}-{expanded}-last.png'))
                        seek(page, session, '#fixedWorkoutDetailStart', True)
                        if expanded:
                            seek(page, session, instruction + ' p', False)
                        seek(page, session, first, False)
                        seek(page, session, '#fixedWorkoutDetailBack', False)
                    page.locator('#fixedWorkoutDetailBack').tap()
                    assert page.locator('#workouts').is_visible()
                    report.append({'viewport': [width, height], 'workout': workout, 'passed': True})
                    page.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    (OUTPUT / 'report.json').write_text(json.dumps(report, indent=2))
    print(f'Passed {len(report)} touch cases, collapsed and expanded; evidence: {OUTPUT}')


if __name__ == '__main__':
    main()
