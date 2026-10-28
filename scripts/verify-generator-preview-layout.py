"""Check Generator preview reachability with local Playwright/Chromium.

Run: python scripts/verify-generator-preview-layout.py --output /tmp/generator-preview
Emulated safe-area values exercise the real shell CSS; this does not replace
an actual iPhone Safari/PWA check. No application dependencies are added.
"""
import argparse
import functools
import http.server
from preview_server import PreviewHandler, render_revision
import json
from itertools import product
from pathlib import Path
import subprocess
import threading
from playwright.sync_api import sync_playwright


class QuietHandler(PreviewHandler):
    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('/tmp/generator-preview'))
    parser.add_argument('--chromium', default='/usr/bin/chromium')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[1]
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    report = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=args.chromium, args=['--no-sandbox'])
            for width, height, top, bottom in [(390,844,47,34), (375,667,20,0), (320,568,20,34), (390,700,47,34)]:
                for duration,standalone in product([10,45],[False,True]):
                    label = f'{width}x{height}-{duration}min-'+('installed' if standalone else 'browser')
                    page = browser.new_page(viewport={'width':width, 'height':height}, is_mobile=True, has_touch=True, color_scheme='dark')
                    if standalone:
                        page.add_init_script("Object.defineProperty(navigator,'standalone',{value:true})")
                    page.add_init_script('let seed=297;Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}')
                    html = render_revision((root/'index.html').read_text(),revision).replace('env(safe-area-inset-top)', f'{top}px').replace('env(safe-area-inset-bottom)', f'{bottom}px')
                    page.route('**/index.html', lambda route: route.fulfill(body=html, content_type='text/html'))
                    page.goto(f'http://127.0.0.1:{server.server_port}/index.html')
                    assert page.evaluate('document.compatMode')=='CSS1Compat',label
                    page.evaluate('(duration)=>{selectGeneratorDuration(duration);generateWorkout()}', duration)
                    screen = page.locator('#generatedPreview')
                    # Every section/row must be reachable within the scrollport,
                    # including lists that would otherwise flex-shrink and clip.
                    for item in page.locator('#generatedPreview .preview-list li, #generatedPreview .preview-section-title, #previewEstimate').all():
                        item.scroll_into_view_if_needed()
                        assert item.evaluate('e=>{const r=e.getBoundingClientRect(),s=document.getElementById("generatedPreview").getBoundingClientRect();return r.top>=s.top-1&&r.bottom<=s.bottom+1}'), label
                    screen.evaluate('e=>e.scrollTop=e.scrollHeight')
                    assert screen.evaluate('e=>e.scrollWidth<=e.clientWidth+1'), label
                    boxes = []
                    for selector in ['.preview-regenerate', '.preview-start']:
                        button = screen.locator(selector)
                        box = button.bounding_box()
                        assert box['y'] >= top and box['y']+box['height'] <= height-bottom-14+1, (label,box)
                        assert box['height'] >= 44 and box['x'] >= 0 and box['x']+box['width'] <= width, (label,box)
                        # Check both vertical edges as well as the bounding box.
                        assert button.evaluate('''e=>{const r=e.getBoundingClientRect();return [r.top+2,r.bottom-2].every(y=>[r.left+r.width/2].every(x=>e.contains(document.elementFromPoint(x,y))))}'''), label
                        boxes.append(box)
                    assert boxes[0]['x']+boxes[0]['width'] < boxes[1]['x'] and abs(boxes[0]['y']-boxes[1]['y']) < 1, label
                    assert page.locator('#bottomNav').is_hidden(), label
                    page.screenshot(path=str(args.output/(label+'.png')))
                    page.evaluate('window.previousWorkout=generatorState.workout')
                    screen.locator('.preview-regenerate').tap()
                    assert page.evaluate('currentScreen === "generatedPreview" && previousWorkout !== generatorState.workout'), label
                    screen.evaluate('e=>e.scrollTop=e.scrollHeight')
                    screen.locator('.preview-start').tap()
                    assert page.evaluate('currentScreen') == 'workoutPlayer', label
                    report.append({'case':label, 'actions':boxes})
                    page.close()
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
    (args.output/'report.json').write_text(json.dumps(report, indent=2))
    print(f'Passed {len(report)} preview cases; screenshots and report: {args.output}')


if __name__ == '__main__':
    main()
