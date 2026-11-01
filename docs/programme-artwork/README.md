# Programme artwork

Issue #341 uses the user-supplied `garagefit-coach-artwork-v1.zip`. All four PNG masters and runtime WebPs are copied byte-for-byte from that archive, without regeneration, recolouring, resizing or re-encoding. The manifest records the archive SHA-256 and each file hash; the supplied manifest and README are retained unchanged alongside it. The supplied JPEG is a review aid only and is not shipped in the UI.

The supplied objects and geometric backdrops carry the colour. Following the subsequent user-approved Coach visual reference, cards use soft programme-specific peach, mint, coral and sage surfaces in Light, with muted dark equivalents. The supplied artwork is still unchanged and has no extra coloured image container. Display preserves the full composition and original aspect ratio with `object-fit:contain`. Missing images hide only the decorative image and leave programme selection usable.

PNG/WebP dimensions and pixel-identical alpha were verified with Pillow. Node tests verify exact supplied hashes, formats and byte limits. The user instructed use of this exact supplied artwork and explicitly approved the final real-app layout on 2026-10-30 after reviewing the Light, Dark and Tennis captures. No physical installed-iPhone check is available in this environment.

## Rights provenance review (issue #364, 31 October 2026)

The four Coach compositions (`general-fitness`, `general-strength-4w`, `build-arms`
and `tennis-conditioning`) are from the supplied archive above. Its retained
`supplied-README.md` identifies the parent image as
`a_clean_vector_illustration_style_composition_with.png` and describes extraction
into quadrants. The original creator, generation operator, tool terms and any
underlying third-party source permissions are not identified in this repository.
The user supplied these files for integration and approved their appearance;
no separate commercial licence, ownership assignment or source-clearance evidence
is recorded here. The hashes and pixel/alpha checks prove file integrity only.

No concrete copied artwork or branded source was established by this bounded
review, so retain the approved files without regeneration. Commercial rights
remain unverified: obtain and record the creator/source and applicable permission
or licence from the supplier before claiming clearance. The supplied preview JPEG
is a review aid, with the same unresolved source rights, and remains unshipped.
Follow the lightweight naming/provenance checklist in
[Exercise artwork](../exercise-artwork/README.md#checklist-for-future-catalogue-and-programme-changes)
for future programme names, wording and assets as well.
