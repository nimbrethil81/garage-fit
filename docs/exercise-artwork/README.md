# Exercise artwork

Use `GarageFitData.exerciseIllustration(id)` to resolve an opted-in canonical ID to
`assets/exercises/<canonical-id>.webp`. Unknown and unillustrated IDs return null.
Keep the whole composition with contain sizing. A failed image keeps instructions,
speech and playback usable. Source PNGs and the roster JPEG here are authoring
references. Keep their paths and the runtime WebPs stable.

[`manifest.json`](manifest.json) records source archives, the exact file hashes and
associations. The four unchanged pairs are dumbbell lateral raise, dumbbell Romanian
deadlift, side plank and suspension strap reverse lunge from the approved handover.
The suspension strap row and skater jumps pairs are the corrected 27 October 2026
transparent RGBA delivery from `garagefit-corrected-trx-row-skater-jumps.zip`.
Those pairs remain 1448×1086 with exact alpha, without cropping, resizing or background
removal. The earlier JPEG-derived files are superseded. Retain every manifest-referenced
source and shipped asset.

Run `node --test tests/exercise-illustrations.test.js` for paths, associations, headers
and size bounds. Run `python3 scripts/verify-exercise-artwork.py` with Pillow for
decode, dimensions and PNG/WebP alpha. Review approved artwork at real display size
in both appearance modes and update the manifest and existing fixture for an
authorised asset change.

## Naming and provenance

The supplied pairs and six-character roster have no documented original creators,
source permissions or commercial licence in the repository (#364). Keep the roster
as an authoring reference and obtain permission before deriving or publishing further
artwork. Integration approval and file integrity are separate from commercial rights.
Reviewed public exercise and equipment labels use “Suspension strap(s)”. Keep the
internal `trx` IDs, artwork paths and stored workout identities. Established descriptive
movement names and the historical fixed benchmark remain supported. Canonical exercise
instructions belong to the catalogue, with no external authorship claim.

### Checklist for future catalogue and programme changes

- Use clear descriptive names and avoid implied endorsement. Keep stable IDs and
  saved results while updating display, speech and accessibility wording together.
- Write instructions from the movement in PickSetGo's own words. Record consulted
  sources and review distinctive phrasing. Compose new workouts independently of
  named benchmarks, keeping reviewed generation and counting rules.
- For each added or replaced image, record the creator, original source, supplied
  file, permission/licence and evidence location. Record unknowns and distinguish
  visual approval from rights to publish, adapt or use commercially.
- Preserve source files and hashes, check visible branding and source restrictions,
  and resolve evidenced concerns with targeted replacements. Uncertain provenance
  stays unverified.
