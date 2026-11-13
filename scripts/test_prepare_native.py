"""Bounded packaging regressions; no native-device compatibility claims."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit, unquote

sys.dont_write_bytecode = True
import prepare_native as bundle


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('src', 'href') and value and not value.startswith('#'):
                self.paths.append(value)


class BundleTests(unittest.TestCase):
    def test_pinned_bundle_is_complete_isolated_and_repeatable(self):
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=bundle.ROOT, text=True).strip()
        with tempfile.TemporaryDirectory() as folder, patch.object(bundle, 'OUTPUT', Path(folder) / 'www'):
            inventory = bundle.prepare(revision)
            first = {str(p.relative_to(bundle.OUTPUT)): p.read_bytes()
                     for p in bundle.OUTPUT.rglob('*') if p.is_file()}
            # Stale files cannot survive a repeat build.
            (bundle.OUTPUT / 'stale.js').write_text('stale')
            self.assertEqual(bundle.prepare(revision), inventory)
            second = {str(p.relative_to(bundle.OUTPUT)): p.read_bytes()
                      for p in bundle.OUTPUT.rglob('*') if p.is_file()}
            self.assertEqual(first, second)
            self.assertEqual(inventory['sourceCommit'], revision)
            for entry in inventory['files']:
                self.assertEqual(hashlib.sha256(first[entry['path']]).hexdigest(), entry['sha256'])
            self.assertFalse(any(name.startswith(('docs/', 'scripts/', 'tests/', '_native-proof/')) for name in first))
            html = first['index.html'].decode()
            self.assertNotIn('{{', html)
            self.assertFalse(html.startswith('---'))
            self.assertIn(revision, html)
            refs = References()
            refs.feed(html)
            refs.paths += [icon['src'] for icon in json.loads(first['manifest.webmanifest'])['icons']]
            for reference in refs.paths:
                url = urlsplit(reference)
                self.assertFalse(url.scheme or url.netloc, reference)
                self.assertIn(unquote(url.path), first, reference)
            # Include entire asset/data/JS trees, including dynamically resolved art/scripts.
            tracked = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', revision], cwd=bundle.ROOT, text=True).splitlines()
            for name in tracked:
                if name.split('/')[0] in bundle.DIRECTORIES:
                    self.assertIn(name, first)


if __name__ == '__main__':
    unittest.main()
