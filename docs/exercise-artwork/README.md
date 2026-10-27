# Exercise artwork

Runtime assets live in `assets/exercises/<canonical-id>.webp`. Extend the opt-in ID set beside the canonical catalogue and use `GarageFitData.exerciseIllustration(id)`;
unillustrated or unknown IDs return null. Future consumers must handle image errors
by hiding the image and keeping instructions/playback usable. No images are loaded
by this foundation, and no cache or service worker is required.

Keep complete compositions and original aspect ratios; display with contain, never
crop. Reference PNGs and the JPEG character roster here are authoring sources only.
The four unchanged pilot PNGs/WebPs are byte-identical to the supplied approved
handover ZIP (SHA-256 39e99fc6f2f9bc65c6f50252b3536bae196509348e8b47c8553423c7380c5f40).

The corrected TRX row and Skater jumps PNG/WebP pairs are copied byte-for-byte
from `garagefit-corrected-trx-row-skater-jumps.zip` supplied on 2026-10-27.
These genuine transparent RGBA references supersede the earlier JPEG-derived
assets; obsolete JPEG sources have been removed. The supplied WebPs preserve
the PNG alpha exactly and both compositions remain 1448 × 1086, without cropping,
resizing or background removal. The archive includes a revised Skater jumps figure.

`manifest.json` records binary provenance/integrity. Node tests enforce expected
files, associations, headers and size limits. Run `python scripts/verify-exercise-artwork.py`
with Pillow for full decode, dimensions and reference/production alpha verification.
Before extending the pilot, update the expected asset list and manifest and perform
a human review against light/dark backgrounds; this issue adds no display surfaces.
