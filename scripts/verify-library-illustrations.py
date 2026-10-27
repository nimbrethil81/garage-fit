"""Check Library illustrations in local Chromium; physical-device review remains separate.
Run: python scripts/verify-library-illustrations.py (requires developer Playwright/Chromium).
"""
import functools
import http.server
from pathlib import Path
import threading
import json
import subprocess
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path('/tmp/library-illustrations')
IDS = ['dumbbell-romanian-deadlift', 'dumbbell-lateral-raise', 'trx-reverse-lunge',
       'trx-row', 'skater-jumps', 'side-plank']

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

OUTPUT.mkdir(parents=True, exist_ok=True)
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for width, height in [(320, 568), (375, 667), (390, 844), (768, 1024)]:
            for theme in ['dark', 'light']:
                page = browser.new_page(viewport={'width': width, 'height': height}, color_scheme=theme)
                page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
                for exercise_id in IDS:
                    page.evaluate('id=>openExerciseDetail(id)', exercise_id)
                    page.wait_for_function('document.querySelector("#libraryDetailIllustration img")?.style.visibility === "visible"')
                    assert page.locator('#libraryDetailInstruction').inner_text() == page.evaluate('id=>GarageFitData.exercises[id].instruction', exercise_id)
                    assert page.locator('#exerciseDetail').evaluate('e=>e.scrollWidth<=e.clientWidth'), (width, exercise_id)
                    image = page.locator('#libraryDetailIllustration img')
                    assert image.evaluate('e=>e.naturalWidth>0&&getComputedStyle(e).objectFit==="contain"')
                    for selector in ['#libraryDetailInstruction', '#libraryDetailIllustration']:
                        box = page.locator(selector).bounding_box()
                        assert box['x'] >= 0 and box['x']+box['width'] <= width, (width, exercise_id, box)
                        assert box['y'] >= 0 and box['y']+box['height'] <= height, (height, exercise_id, box)
                    page.screenshot(path=str(OUTPUT / f'{width}-{theme}-{exercise_id}.png'))
                # A failed request must leave the text and Back action usable.
                page.route('**/assets/exercises/trx-row.webp', lambda route: route.abort())
                page.evaluate("openExerciseDetail('trx-row')")
                page.wait_for_function('document.getElementById("libraryDetailIllustration").classList.contains("hidden")')
                assert page.locator('#libraryDetailIllustration img').count() == 0
                assert page.locator('#libraryDetailInstruction').is_visible()
                page.evaluate('appBack()')
                assert page.locator('#exerciseLibrary').is_visible()
                page.evaluate("openExerciseDetail('air-squat')")
                assert page.locator('#libraryDetailIllustration').is_hidden()
                page.close()
                print(width, height, theme, 'six images, containment, instruction, failed load and Back passed')
        browser.close()
        files = sorted(OUTPUT.glob('*.png'))
        assert len(files) == 48
        (OUTPUT / 'manifest.json').write_text(json.dumps({
            'app': 'GarageFit', 'scope': 'exercise-library-illustrations',
            'captured_at': datetime.now(timezone.utc).isoformat(),
            'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'source_reference': subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip(),
            'working_tree_dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()),
            'screenshots': [f.name for f in files], 'result': 'passed',
            'note': 'Local Chromium emulation; not physical-device validation.'
        }, indent=2) + '\n')
finally:
    server.shutdown()
