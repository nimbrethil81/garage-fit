# Exercise artwork

Runtime assets live in `assets/exercises/<canonical-id>.webp`. Set the optional
`illustration: true` catalogue field and use `GarageFitData.exerciseIllustration(id)`;
unillustrated or unknown IDs return null. Future consumers must handle image errors
by hiding the image and keeping instructions/playback usable. No images are loaded
by this foundation, and no cache or service worker is required.

Keep complete compositions and original aspect ratios; display with contain, never
crop. Reference PNGs and the JPEG character roster here are authoring sources only.
The four unchanged pilot PNGs/WebPs are byte-identical to the supplied approved
handover ZIP (SHA-256 39e99fc6f2f9bc65c6f50252b3536bae196509348e8b47c8553423c7380c5f40).

The separately attached TRX row and Skaters JPEGs supersede both archive versions.
Their originals are retained as `*-source.jpg`; reference PNGs remove only the
edge-connected near-white background (ImageMagick, 8% flood-fill at 0,0), preserving
white clothing. WebPs use quality 90 with unchanged dimensions and exact alpha.
No artwork was regenerated or cropped. JPEG light edging and enclosed white regions
remain subject to human artwork review, including device-size usability.

`manifest.json` records binary provenance/integrity. Node tests enforce expected
files, associations, headers and size limits. Run `python scripts/verify-exercise-artwork.py`
with Pillow for full decode, dimensions and reference/production alpha verification.
Before extending the pilot, update the expected asset list and manifest and perform
a human review against light/dark backgrounds; this issue adds no display surfaces.
