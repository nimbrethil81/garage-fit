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

## Naming and provenance review (issue #364, 31 October 2026)

This is a targeted repository evidence review, not a determination of commercial
rights. Archive hashes, transparent backgrounds and visual approval establish
which files were supplied and accepted; they do not establish authorship,
originality, ownership or a commercial licence.

| Material | Known source / author | Permission or licence evidence | Uncertainty and action |
| --- | --- | --- | --- |
| Dumbbell lateral raise, dumbbell Romanian deadlift, side plank and suspension strap reverse lunge PNG/WebP pairs | User-supplied handover archive identified above; original illustrator/generation operator is not identified in the repository | Supplied for GarageFit integration; no underlying commercial licence, assignment or third-party source clearance is recorded | Retain the supplied files and stable ID paths; obtain the source creator and applicable licence/rights evidence from the supplier before asserting commercial clearance |
| Suspension strap row and skater jumps PNG/WebP pairs | User-supplied corrected archive dated 2026-10-27, identified above; original creator is not established | Correction/integration approval and exact-file evidence only; no commercial-rights grant recorded | Retain the corrected files; request the same creator/licence evidence; do not infer rights from a correction or a hash |
| Six-character roster JPEG | Supplied authoring reference; original creator and source permissions are not recorded | No commercial-rights evidence recorded | Keep as an authoring reference only; verify source and reuse permission before deriving or publishing further artwork |
| Canonical exercise instructions and public names | Maintained in `data/exercises.js`; no external source attribution or source-copy licence is recorded | Repository contribution history is evidence of editing, not proof of original authorship | Reviewed branded instruction references and distinctive benchmark references; replaced branded handle/strap/anchor wording with neutral descriptions. No specific copied instructional passage was established by the available evidence, so no unsupported wholesale rewrite or originality claim is made |

All 29 formerly branded exercise display names now use “Suspension strap”; the
public equipment label is “Suspension straps”. Internal `trx` keys, artwork paths,
exercise metadata and saved identities remain intact. Ordinary established names,
including Pallof, Arnold, renegade row and World's Greatest Stretch, remain: this
review found no concrete material concern justifying their removal. The fixed
benchmark is retained only for historical compatibility; new 300-Rep Challenge
starts use GarageFit's generated policy. The seven-minute circuit uses a separately
composed order alternating on-feet, pressing and trunk work rather than the former
published sequence. None of these actions proves exclusive ownership of common
exercise names, movements or formats.

### Checklist for future catalogue and programme changes

- Use a clear descriptive equipment, exercise, workout or programme name; avoid
  needless competitor/product branding and implied endorsement or affiliation.
- Keep canonical IDs stable. Update public labels, speech, accessibility copy,
  previews and documentation together; preserve stored prescriptions and results.
- Write concise instructions from the movement itself, in GarageFit's own words;
  record any source consulted. Review distinctive wording instead of copying it.
- Compose workouts independently; do not import a named benchmark's prescription
  or sequence as a template. Document generation/counting rules and rationale.
- For each new or replaced image, record creator, original source, supplied file,
  permission/licence and evidence location, including commercial use and adaptation
  terms where applicable. Record unknowns explicitly; visual approval is separate.
- Preserve source files and hashes for integrity, check visible branding and source
  restrictions, and resolve supported concerns with a targeted rewrite/replacement.
  Do not describe uncertain material as rights-verified or regenerate it en masse.
