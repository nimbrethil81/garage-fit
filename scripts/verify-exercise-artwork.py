"""Developer image decoding check (Python Pillow); no browser dependency."""
from pathlib import Path
from PIL import Image, ImageChops
import json
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'docs/exercise-artwork/manifest.json').read_text())
for name, files in manifest.items():
    with Image.open(root / files['png']['path']) as reference, Image.open(root / files['webp']['path']) as production:
        reference.load()
        production.load()
        assert reference.format == 'PNG' and production.format == 'WEBP'
        assert reference.size == production.size
        assert production.getchannel('A').getextrema() == (0, 255)
        assert not ImageChops.difference(reference.getchannel('A'), production.getchannel('A')).getbbox()
        print(name, production.size, 'decoded; alpha matches reference')
