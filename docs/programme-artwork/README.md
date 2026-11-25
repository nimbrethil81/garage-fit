# Programme artwork

Use the approved PNG masters here and the decorative WebPs in
`assets/programmes/<programme-id>.webp`. The four stable programme IDs are
`general-fitness`, `general-strength-4w`, `build-arms` and `tennis-conditioning`.
Programme artwork uses its own mapping and stays independent of the exercise lookup.
Keep the full composition and aspect ratio with `object-fit: contain`. The themed
Coach card provides the surface. Missing artwork hides only the image, leaving
programme selection usable.

## Provenance and integrity

The owner-supplied `garagefit-coach-artwork-v1.zip` (#341) contained cuts from
`a_clean_vector_illustration_style_composition_with.png` (1774×887 RGBA), extracted
as the supplied 887×443 programme masters. No extension, manual redraw or generative
replacement was used. The original PNG/WebP pairs were integrated byte-for-byte.
`supplied-manifest.json` records their source quadrants, dimensions, alpha and original
hashes. `light-dark-preview.jpg` is a composited review aid outside the runtime UI.
The supplied graphics are raster artwork.

The corrected Tennis pair (#365, PR #372) removes a horizontal line. The current
887×444 files are transparent, with PNG/WebP alpha matching exactly.
[`manifest.json`](manifest.json) records current hashes, the original archive and
approved replacements, with `replacesSha256` linking to the original Tennis files.
The other three pairs match the supplied manifest. Preserve both manifests and the
source assets. `node --test tests/programme-artwork.test.js` checks associations,
formats, hashes and byte bounds. Use real-app Light/Dark and compact-to-wide mobile
captures for future visual changes. Verify on an installed iPhone where possible.

## Rights boundary

The owner supplied the compositions for integration and approved the real Coach
cards on 30 October 2026. Original author/operator, tool terms and any underlying
third-party permission remain undocumented, including for the preview JPEG. Asset
hashes, transparency and visual approval establish integrity and acceptance. Obtain
the source creator and applicable permission before asserting commercial clearance.
Follow the [naming and provenance checklist](../exercise-artwork/README.md#checklist-for-future-catalogue-and-programme-changes)
for later artwork or names.
