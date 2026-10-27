"""Serve local previews, rendering the same two revision expressions as Pages/Jekyll.
No application dependencies or writes to the checkout. Run with --port 8000.
"""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

FRONT_MATTER = '---\nlayout: null\n---\n'
REVISION = '{{ site.github.build_revision }}'
SHORT_REVISION = '{{ site.github.build_revision | slice: 0, 7 }}'


def render_revision(source, revision):
    return source.removeprefix(FRONT_MATTER).replace(SHORT_REVISION, revision[:7]).replace(REVISION, revision)


class PreviewHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path not in ('/', '/index.html', '/css/player-layout.css'):
            return super().do_GET()
        root = Path(self.directory)
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
        target = root / ('index.html' if path in ('/', '/index.html') else 'css/player-layout.css')
        body = render_revision(target.read_text(), revision).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/css; charset=utf-8' if path.endswith('.css') else 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    import functools
    root = Path(__file__).resolve().parents[1]
    ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(PreviewHandler, directory=str(root))).serve_forever()
