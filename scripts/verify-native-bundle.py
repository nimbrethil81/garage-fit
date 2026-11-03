"""Check bundled assets and shared entry paths in Chromium, not WKWebView.

Run after prepare_native.py and serving _native-proof/www on localhost:
python3 scripts/verify-native-bundle.py [URL]
"""
import hashlib
import json
import sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    external, errors = [], []
    def route(request):
        if urlsplit(request.request.url).netloc != urlsplit(url).netloc:
            external.append(request.request.url)
            request.abort()
        else:
            request.continue_()
    context.route('**/*', route)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    page.wait_for_function('window.garageFitAppReady===true')
    page.wait_for_function('!isBackupBlocked()')
    inventory = context.request.get(url + '/proof-manifest.json').json()
    for entry in inventory['files']:
        response = context.request.get(url + '/' + entry['path'])
        assert response.ok, entry['path']
        assert hashlib.sha256(response.body()).hexdigest() == entry['sha256'], entry['path']
    for tab in ['home', 'workouts', 'generator', 'coach', 'more']:
        page.evaluate('(tab)=>showLanding(tab)', tab)
        assert page.locator('#' + tab).is_visible(), tab
    page.evaluate('openExerciseLibrary()')
    assert page.locator('#exerciseLibrary').is_visible()
    page.evaluate("startRoutine('warmup','bodyweight')")
    assert page.locator('#player').is_visible()
    page.evaluate('goHome();startWorkout()')
    assert page.locator('#workoutPlayer').is_visible()
    page.evaluate('goGenerator();generateWorkout()')
    assert page.locator('#generatedPreview').is_visible()
    page.evaluate('startStandaloneGeneratedWorkout()')
    assert page.locator('#workoutPlayer').is_visible()
    page.evaluate("goGenerator();showScreen('settings')")
    assert page.locator('#settings').is_visible()
    page.evaluate('openSharedProgress()')
    assert page.locator('#yourProgress').is_visible()
    assert not errors, errors
    assert not external, external
    print(json.dumps({'sourceCommit': inventory['sourceCommit'], 'assetsChecked': len(inventory['files']),
                      'externalRequests': external, 'pageErrors': errors,
                      'scope': 'Chromium local bundle; native and airplane-mode checks UNVERIFIED'}, indent=2))
    browser.close()
