# Programme artwork

Issue #341 uses the user-supplied `garagefit-coach-artwork-v1.zip`. All four PNG masters and runtime WebPs are copied byte-for-byte from that archive, without regeneration, recolouring, resizing or re-encoding. The manifest records the archive SHA-256 and each file hash; the supplied manifest and README are retained unchanged alongside it. The supplied JPEG is a review aid only and is not shipped in the UI.

The supplied objects and geometric backdrops carry the colour. Cards use the shared neutral surface in both appearances, without an added coloured artwork container. Display preserves the full composition and original aspect ratio with `object-fit:contain`. Missing images hide only the decorative image and leave programme selection usable.

PNG/WebP dimensions and pixel-identical alpha were verified with Pillow. Node tests verify exact supplied hashes, formats and byte limits. The user instructed use of this exact supplied artwork and explicitly approved the final real-app layout on 2026-10-30 after reviewing the Light, Dark and Tennis captures. No physical installed-iPhone check is available in this environment.
