"""Optional Chromium interaction/layout evidence for EMOM Skip rest (#167).

Serve the checkout, then run (requires Playwright and /usr/bin/chromium):
  python scripts/verify-emom-skip-rest.py --url http://127.0.0.1:8000
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
from playwright.sync_api import sync_playwright

spec = importlib.util.spec_from_file_location('layout', Path(__file__).with_name('verify-player-layout.py'))
layout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)
timers = layout.timers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    parser.add_argument('--output', type=Path, default=Path('/tmp/emom-skip-rest'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = []
    block = layout.fixture_blocks()['emom']
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for size in [(375,667),(393,852),(430,932),(375,540),(320,568),(667,375)]:
            label = f'{size[0]}x{size[1]}'
            page = timers.fresh(browser, args.url, size)
            page.add_style_tag(content=layout.SAFE_AREAS)
            layout.protocols(page, {'emom':block})
            page.evaluate("""async()=>{
              await generatorState.tracker.flush();
              enterGeneratedPhase(generatorState.timeline.findIndex(p=>p.protocol==='emom'));
            }""")
            button = page.locator('#completeMovementBtn')
            action = page.locator('#completeMovementAction')
            pulse = lambda ms: timers.pulse(page, 'generatorState.phaseTimer', ms)
            minute = lambda: page.evaluate('currentGeneratedPhase().minute')
            remaining = lambda: page.locator('#workoutRingNum').text_content()

            assert action.text_content() == 'Next'
            assert page.locator('#completeMovementNext').text_content() == 'Rest'
            assert not page.locator('#coachSkipBtn').is_visible()
            assert not page.locator('#workoutNextPreview').is_visible()
            assert page.locator('#completeMovementBtn #completeMovementNext').count() == 1
            assert page.locator('.workout-secondary-controls button:visible').count() == 2
            layout.check(page, report, label+'-rep-work')
            pulse(5000)
            button.click()
            page.wait_for_function('emomWork().settled')
            pulse(32000)
            assert remaining() == '23' and action.text_content() == 'Next'
            assert button.is_enabled()
            expected = page.evaluate('activityName(generatorState.timeline[generatorState.timelineIndex+1].exercise)')
            assert page.locator('#completeMovementNext').text_content() == expected
            before = page.evaluate('generatorState.tracker.draft().occurrenceOutcomes')
            layout.check(page, report, label+'-settled-rest')
            layout.capture(page, args.output, label+'-settled-rest')
            button.tap()
            button.tap()  # The duplicate cannot record work in the new minute.
            assert minute() == 2 and remaining() == '60'
            assert page.evaluate('generatorState.tracker.draft().occurrenceOutcomes') == before
            layout.check(page, report, label+'-fresh-minute')
            layout.capture(page, args.output, label+'-fresh-minute')

            page.locator('#workoutRing').click()
            assert button.is_disabled()
            pulse(10000)
            assert remaining() == '60'
            page.locator('#workoutRing').click()
            pulse(20000)
            page.wait_for_function('emomWork().settled')
            assert remaining() == '40' and action.text_content() == 'Next'
            pulse(400)
            button.focus()
            page.keyboard.press('Enter')
            page.keyboard.press('Enter')
            assert minute() == 3 and remaining() == '60'
            pulse(60000)  # No Skip rest: strict automatic 60-second beat.
            page.wait_for_function('currentGeneratedPhase().minute===4')
            assert remaining() == '60'
            pulse(20000)
            page.wait_for_function('emomWork().settled')
            pulse(400)
            button.click()
            assert minute() == 5 and remaining() == '60'
            pulse(5000)
            button.click()
            page.wait_for_function('emomWork().settled')
            assert page.locator('#completeMovementNext').text_content() == 'Cool-down'
            pulse(400)
            button.click()
            button.click()
            assert page.evaluate('currentGeneratedPhase().kind') == 'transition'
            assert page.evaluate('workoutState.running') is True
            outcomes = page.evaluate('generatorState.tracker.draft().occurrenceOutcomes')
            assert len(outcomes) == 5
            assert [o['status'] for o in outcomes] == ['completed','completed','skipped','completed','completed']
            assert outcomes[1]['sets'] == [{'seconds':20}]
            assert outcomes[3]['sets'] == [{'seconds':20}]
            layout.check(page, report, label+'-actual-next-phase')
            page.close()
            print('EMOM interactions and viewport passed:', label, flush=True)
        browser.close()
    (args.output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(f'Passed {len(report)} layouts with real click, touch and keyboard actions. Evidence: {args.output}', flush=True)


if __name__ == '__main__':
    main()
