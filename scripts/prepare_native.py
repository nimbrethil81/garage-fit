"""Prepare an isolated, deterministic native web bundle from a committed revision.

No working-tree application files are read; Pages templates remain untouched.
Run: python3 scripts/prepare_native.py --ref HEAD
"""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import sys

sys.dont_write_bytecode = True
from preview_server import render_revision

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '_native-proof' / 'www'
FILES = {'index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'favicon.svg'}
DIRECTORIES = {'assets', 'css', 'data', 'icons', 'js'}


def prepare(ref):
    revision = subprocess.check_output(
        ['git', 'rev-parse', '--verify', ref + '^{commit}'], cwd=ROOT, text=True).strip()
    archive = subprocess.check_output(['git', 'archive', revision], cwd=ROOT)
    contents = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for entry in source:
            path = PurePosixPath(entry.name)
            if entry.name not in FILES and path.parts[0] not in DIRECTORIES:
                continue
            if entry.isdir():
                continue
            if not entry.isfile() or path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsupported bundled entry: ' + entry.name)
            body = source.extractfile(entry).read()
            if entry.name in ('index.html', 'css/player-layout.css'):
                body = render_revision(body.decode('utf-8'), revision).encode('utf-8')
                if b'{{' in body or body.startswith(b'---\n'):
                    raise ValueError('Unrendered template: ' + entry.name)
            contents[entry.name] = body
    if not FILES.issubset(contents):
        raise ValueError('Missing application entry files')
    # Remove only this fixed generated directory; never accept an output path.
    import shutil
    if OUTPUT.is_symlink():
        raise ValueError('Bundle output must not be a symlink')
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)
    for name, body in sorted(contents.items()):
        target = OUTPUT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    inventory = {'sourceCommit': revision, 'files': [
        {'path': name, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
        for name, body in sorted(contents.items())]}
    (OUTPUT / 'proof-manifest.json').write_text(json.dumps(inventory, indent=2) + '\n')
    return inventory


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', default='HEAD', help='committed source revision')
    args = parser.parse_args()
    result = prepare(args.ref)
    print(f"Prepared {len(result['files'])} files from {result['sourceCommit']} in {OUTPUT}")
