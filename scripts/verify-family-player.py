"""Bounded six-family browser release check; reuse the canonical viewport assertions.

Serve the checkout, then run with Playwright/Chromium already installed:
  python scripts/verify-family-player.py --url http://127.0.0.1:8000
Screenshots, measurements and resolved scripts go to --output (default /tmp/family-player).
This is browser emulation, not physical-device or exercise/mounting certification.
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    parser.add_argument('--output', type=Path, default=Path('/tmp/family-player'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report, scripts = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = layout.timers.fresh(browser, args.url, (320, 568))
        families = page.evaluate('GarageFitWorkoutFamilies.FAMILY_IDS')
        page.close()
        for width, height in [(320, 568), (375, 540)]:
            for route in ['generator', 'coach']:
                for family in families:
                    durations = [20, 30, 45] if family in ['mobility-movement-quality', 'athletic-movement'] else [20]
                    for duration in durations:
                        label = f'{width}x{height}-{route}-{family}-{duration}'
                        page = layout.timers.fresh(browser, args.url, (width, height))
                        page.add_style_tag(content=layout.SAFE_AREAS)
                        page.evaluate("""async ({family,duration,route})=>{
                          const options={duration,difficulty:'normal',equipment:['dumbbells','trx','rings']};
                          setOwnedEquipment(options.equipment);
                          if(route==='coach') {
                            await coachUI.controller.start(GarageFitData.programmes['general-fitness'][2],options.equipment);
                            // Use the real UI/controller and prescription seam. Pin only the
                            // candidate family so each published composer gets browser coverage.
                            const original=GarageFitGenerator.generate;
                            GarageFitGenerator.generate=opts=>{
                              const rx=JSON.parse(JSON.stringify(opts.sessionPrescription));
                              rx.workoutFamilyPlan={candidates:[{workoutFamilyId:family,workoutFamilyVersion:GarageFitWorkoutFamilies.currentVersion(family),rationale:'Release gate explicit family.'}]};
                              return original({...opts,sessionPrescription:rx});
                            };
                            await coachUI.open();
                          } else {
                            generatorState.workout=GarageFitGenerator.generate({...options,catalogue:CATALOGUE,workoutFamilyId:family,workoutFamilyVersion:GarageFitWorkoutFamilies.currentVersion(family)});
                            startStandaloneGeneratedWorkout();
                          }
                        }""", dict(family=family, duration=duration, route=route))
                        if route == 'coach':
                            page.locator('#coachAdjustToday > summary').click()
                            page.get_by_role('button', name=f'{duration} min', exact=True).click()
                            page.get_by_role('button', name='View today’s workout', exact=True).click()
                            page.get_by_role('button', name='Start workout', exact=True).click()
                            assert page.evaluate('isCoachPlayer()') is True
                        summary = page.evaluate("""async()=>{
                          await generatorState.tracker.flush();
                          const w=generatorState.workout;
                          return {family:w.workoutFamilyId,version:w.workoutFamilyVersion,style:w.familyStyleId,duration:w.duration,estimate:w.estimatedSeconds,
                            blocks:w.main.blocks.map(b=>({id:b.id,role:b.familyContext?.role,protocol:b.protocol,
                              seconds:b.estimatedSeconds,recovery:b.occurrenceRecoverySeconds,
                              work:GarageFitGenerator.resolveBlockSteps(b).filter(s=>s.kind==='exercise').map(s=>({
                                name:b.exercises[s.exerciseIndex].name,seconds:s.estimatedSeconds,target:s.plannedPrescription||b.exercises[s.exerciseIndex].prescription}))}))};
                        }""")
                        assert summary['family'] == family and summary['duration'] == duration, summary
                        scripts.append(dict(case=label, **summary))
                        # Every actual resolved phase, including sides/recovery/setup/boundaries.
                        phases = page.evaluate('generatorState.timeline.map((p,i)=>({i,kind:p.kind,section:p.section}))')
                        captured = set()
                        for phase in phases:
                            page.evaluate('i=>enterGeneratedPhase(i)', phase['i'])
                            layout.check(page, report, label+f'-phase-{phase["i"]}')
                            if phase.get('section') == 'main' and phase['kind'] not in captured:
                                captured.add(phase['kind'])
                                layout.capture(page, args.output, label+'-'+phase['kind'])
                        page.close()
                        print('Family player passed:', label, flush=True)
        browser.close()
    (args.output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    (args.output/'scripts.json').write_text(json.dumps(scripts, indent=2)+'\n')
    print(f'Passed {len(scripts)} sessions / {len(report)} resolved player layouts. Evidence: {args.output}', flush=True)


if __name__ == '__main__':
    main()
