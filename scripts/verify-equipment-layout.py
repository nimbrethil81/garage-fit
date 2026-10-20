"""Optional real-browser checks for More spacing and My Equipment safe-area layout.

Run: python scripts/verify-equipment-layout.py --output /tmp/equipment-layout
Uses locally installed Playwright/Chromium; adds no application dependencies.
"""
import argparse
import functools
import http.server
import json
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/equipment-layout'))
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[1]
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = []
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=args.chromium, args=['--no-sandbox'])
            # Chromium reports zero env() insets. Substitute conservative iPhone
            # values in the actual CSS, including the shell's negative bottom inset.
            cases = [(393,852,59,34), (390,844,47,34), (430,932,59,34),
                     (375,667,20,0), (320,568,20,0), (852,393,0,21), (393,700,59,34), (720,900,0,0)]
            for width, height, top, bottom in cases:
                for text_scale in [1, 1.5]:
                    label = f'{width}x{height}-{text_scale}'
                    page = browser.new_page(viewport={'width':width, 'height':height}, has_touch=True)
                    html = (root/'index.html').read_text().replace('env(safe-area-inset-top)', f'{top}px').replace('env(safe-area-inset-bottom)', f'{bottom}px')
                    page.route('**/index.html', lambda route: route.fulfill(body=html, content_type='text/html'))
                    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
                    if text_scale > 1:
                        page.add_style_tag(content=f'#more button,#equipment button,#equipment p{{font-size:{text_scale*100}%}}')
                    page.evaluate("showLanding('more')")
                    gaps = page.locator('#more > .library-entry').evaluate_all('''els=>els.slice(1).map((e,i)=>e.getBoundingClientRect().top-els[i].getBoundingClientRect().bottom)''')
                    assert len(gaps) == 2 and all(abs(gap-10) < 0.5 for gap in gaps), (label, gaps)
                    page.screenshot(path=str(args.output/(label+'-more.png')))
                    page.get_by_role('button', name='My Equipment →').click()
                    screen = page.locator('#equipment')
                    done = page.get_by_role('button', name='Done', exact=True)
                    initial = done.bounding_box()
                    if width in [390,393,430,720] and height >= 800 and text_scale == 1:
                        assert initial['y']+initial['height'] <= height-bottom-14+1, (label, initial)
                        assert screen.evaluate('e=>e.scrollHeight<=e.clientHeight+1'), label
                    assert screen.evaluate('e=>e.scrollWidth<=e.clientWidth+1'), label
                    # Smaller viewports, enlarged text and a growing catalogue must
                    # scroll naturally without shrinking/covering controls.
                    for control in page.locator('#equipmentList button').all():
                        control.scroll_into_view_if_needed()
                        assert control.bounding_box()['height'] >= 44, label
                    done.scroll_into_view_if_needed()
                    screen.evaluate('e=>{e.scrollTop=e.scrollHeight}')
                    bounds = done.bounding_box()
                    assert bounds['height'] >= 54 and bounds['y']+bounds['height'] <= height-bottom-14+1, (label, bounds)
                    assert done.evaluate('e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}'), label
                    page.screenshot(path=str(args.output/(label+'-equipment.png')))
                    done.click()
                    assert page.evaluate('currentScreen') == 'more', label
                    page.evaluate("EQUIPMENT.push(...Array.from({length:12},(_,i)=>({id:'future-'+i,name:'Future equipment '+i})));openEquipment('more')")
                    done.scroll_into_view_if_needed()
                    screen.evaluate('e=>{e.scrollTop=e.scrollHeight}')
                    assert done.bounding_box()['height'] >= 54, label
                    done.click()
                    report.append({'case':label, 'card_gaps':gaps, 'done':bounds})
                    page.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    (args.output/'report.json').write_text(json.dumps(report, indent=2))
    print(f'Passed {len(report)} browser layout cases; screenshots and report: {args.output}')


if __name__ == '__main__':
    main()
