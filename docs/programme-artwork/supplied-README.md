# GarageFit Coach programme artwork — candidate set v1

Four coordinated, object-led, iconographic compositions extracted from the approved-looking 2×2 concept image supplied in this conversation. **Candidate production assets, pending user visual approval in the real Coach cards.**

| Programme ID | PNG master | Runtime WebP |
| --- | --- | --- |
| `general-fitness` | `general-fitness.png` | `general-fitness.webp` |
| `general-strength-4w` | `general-strength-4w.png` | `general-strength-4w.webp` |
| `build-arms` | `build-arms.png` | `build-arms.webp` |
| `tennis-conditioning` | `tennis-conditioning.png` | `tennis-conditioning.webp` |

## Integration guidance (issue #341)

- Use the supplied graphics exactly; **do not regenerate, redraw, substitute or recolour** them.
- Separate programme artwork from `assets/exercises/` and the canonical exercise-image resolver.
- Use each WebP on the **neutral Coach card surface**; colour is concentrated in the artwork and its geometric backdrop (CV5 Option B).
- Preserve the full composition and aspect ratio with `object-fit: contain`; do not crop, mask or stretch. Images are decorative; titles/descriptions and navigational controls remain usable if images fail.
- Review the actual displayed size and spacing in 320/375/393/430px mobile screenshots, both appearance modes, and an actual installed iPhone where possible.
- CV3 refined direction: no people, bespoke illustrated fitness/sport objects with consistent outlines/visual density. Other CV1, CV2, CV4, CV5 approvals and the correct finished-programme status ownership remain unchanged.

## Verification and cautions

- Source image: `a_clean_vector_illustration_style_composition_with.png`, 1774×887 RGBA; split into exact 887×443 equal quadrants. No generative extension or manual redrawing performed.
- All PNGs preserve the supplied RGBA pixel data, including transparency and semi-transparent antialiasing; WebPs retain pixel-identical alpha. See `manifest.json` for dimensions, SHA-256 and alpha checks.
- `light-dark-preview.jpg` is a *review aid*, not a shipped asset.
- Artwork may have slight AI-rendered edge speckling; inspect at real app display size. The images are raster renders, not editable SVG/vector originals.
- Dark and light visual checks here are composited previews, **not actual app screenshots**. Final acceptance requires human review in GarageFit.
