"""Focused #338 browser integration check; does not certify audible iPhone output.
Serve with scripts/preview_server.py, then run this script [URL] [OUTPUT].
Uses the existing developer Playwright/Chromium installation, no app dependency.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000'
out = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/player-audio')
out.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mode in ['supported', 'unsupported', 'failed-startup']:
        context = browser.new_context(viewport={'width':393, 'height':852}, color_scheme='light')
        context.add_init_script("""
          window.spoken338=[];
          Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel(){},speak(u){spoken338.push(u.text)},addEventListener(){}}});
        """ + ("Object.defineProperty(window,'SpeechSynthesisUtterance',{value:undefined});" if mode == 'unsupported' else ''))
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        # Run the actual BackupBrowser and recovery; defer only its result so the
        # shipped inline startup and real player-layout DOM ordering are exercised.
        def delay(route):
            response = route.fetch()
            route.fulfill(response=response, body=response.text() + """
              const create338=GarageFitBackupBrowser.create;
              GarageFitBackupBrowser.create=(options)=>{
                const browser=create338(options),start=browser.start;
                browser.start=(recover)=>start(recover).then(()=>new Promise((resolve,reject)=>{
                  window.release338=resolve;window.fail338=()=>reject(new Error('Synthetic recovery failure'));
                }));return browser;
              };
            """)
        page.route('**/js/backup-browser.js', delay)
        page.goto(url)
        page.wait_for_function("typeof release338==='function'")
        assert page.evaluate('speechVoices===null && document.getElementById("app").inert')
        assert page.locator('.player-instruction-speaker').count() == 0
        page.evaluate('fail338()' if mode == 'failed-startup' else 'release338()')
        if mode != 'failed-startup':
            page.wait_for_function('window.garageFitAppReady===true')
        else:
            page.wait_for_function('!document.getElementById("app").inert')
        supported = mode == 'supported'
        assert page.locator('.player-instruction-speaker').count() == (2 if supported else 0)
        if mode != 'failed-startup':
            for player, instruction in [('player','routineInstruction'), ('workoutPlayer','workoutInstruction')]:
                page.evaluate("""([player,id])=>{showScreen(player);setInstructionDisclosure(id,{id:'trx-row'});} """, [player,instruction])
                before = page.evaluate('spoken338.length')
                page.locator(f'#{instruction} summary').click()
                assert page.evaluate('spoken338.length') == before
                content = page.locator(f'#{instruction} .player-detail-content')
                if supported:
                    # Click actual illustration when layout has room, otherwise text.
                    image = page.locator(f'#{instruction}Image img')
                    page.wait_for_timeout(200)
                    (image if image.is_visible() else page.locator(f'#{instruction}Text')).click()
                    assert page.evaluate('spoken338.length') == before + 1
                    content.click()
                    content.focus(); page.keyboard.press('Enter'); page.keyboard.press('Space')
                    assert page.evaluate('spoken338.length') == before + 4
                    assert page.evaluate('spoken338.at(-1)') == page.evaluate("GarageFitData.exercises['trx-row'].instruction")
                else:
                    assert content.get_attribute('role') is None
                    content.click(); assert page.evaluate('spoken338.length') == before
                page.screenshot(path=str(out / f'{mode}-{player}.png'))
                page.locator(f'#{instruction} .player-detail-close').focus()
                page.keyboard.press('Escape')
                assert not page.locator(f'#{instruction}').evaluate('(e)=>e.open')
        assert not errors, errors
        results.append({'mode':mode,'passed':True,'build':page.locator('#aboutBuild').get_attribute('data-commit')})
        context.close()
    browser.close()
(out/'results.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results))
