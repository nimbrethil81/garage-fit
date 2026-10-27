# iPhone player header sharpness (#316)

Investigation on 27 October 2026 against `37bbbc8` (main at checkout).
Current status: **the user reports that 16px routine-header padding improved
sharpness on iPhone 15; the bottom-navigation follow-up awaits device confirmation**.
The initial desktop investigation did not reproduce the original softness.
The initial investigation made no application changes. A subsequent user-requested
experiment adds 8px of top layout padding to the Prep & Recover header row. Fonts, colours,
sizes and tap targets remain unchanged. This experiment must stay unmerged until
the user confirms a visible improvement on their physical iPhone; otherwise revert
the padding. Browser checks cannot make that judgement.
An initial trial on both headers caused reduced-height density-workout overflow;
the standard workout header therefore retains its original padding.

## Findings

- The routine header and standard workout header use their existing three-column
  grids. On phone widths, neither header, player nor app has a computed transform,
  filter, backdrop filter or reduced opacity. There is no forced `will-change`
  layer. Appearance rules change colours, not header font rendering.
- The app's horizontal translation only applies at widths of at least 720px;
  it does not apply at the checked portrait phone widths.
- At 390 × 844, both headers have bounds x=14, y=6, width=362, height=44 CSS px.
  The close target is 52 × 44px. The routine counter starts at x=324, y=20;
  the workout elapsed counter at x=304, y=19.
- The 13px title uses line-height 1.2 (measured 15.59375px in Chromium), placing
  its centred line box at y=20.203125. Fractional text positioning is normal and
  this observation does not establish a cause for softness of all three items.
  Snapping this title or changing its typography would be speculative.
- VisualViewport height/offset are passed through without rounding. No fractional
  viewport offset occurred in this run; rounding it without iOS evidence could
  break viewport tracking during keyboard/browser-chrome changes.

## Supplementary validation

Used the existing Python Playwright installation and system Chromium against a
local HTTP server, with the repository timer fixtures and a deterministic clock.
Checked both players, light/dark appearances, short (`Post Run Stretch`) and long
(`Five-Minute Full-Body Warm-Up`) titles at these CSS viewport sizes/DPRs:
375 × 667 / 2, 390 × 844 / 3, 393 × 852 / 3, 430 × 932 / 3.
All 32 cases retained header content without horizontal overflow and close tap
height of at least 44px. Captured four 390 × 844 screenshots (both players and
appearances); inspected the dark routine screenshot. These are temporary local
artefacts under `/tmp/garagefit-header/`, alongside measurements and a provenance
manifest, not permanent device evidence. The displayed routine title was replaced
in the fixture; these captures do not represent the actual Post Run Stretch steps.

Chromium emulation uses Linux fonts, does not reproduce iOS Safari compositing or
installed-PWA safe areas, and cannot establish physical iPhone sharpness. No
original user screenshot was attached to the issue or available in this session.
WebKit and physical iPhone access were unavailable. There is no before/after
comparison because no safe corrective change has been identified.

## Remaining device check

Obtain the original-resolution screenshot, iPhone model, iOS version, appearance,
and whether Safari or installed PWA was used. Reproduce the actual routine and
step on that device, comparing both players and appearances. Inspect computed
header/ancestor styles and VisualViewport offsets while affected. Confirm the
cause before making a minimal correction, then capture the same state before and
after and verify exit, progression and timer controls. Keep #316 open until its
physical-device acceptance criteria are met.

## 8px routine-header experiment

The final trial uses `.player-top{padding-top:8px}` in
`css/player-layout.css`. The existing player padding and safe-area handling remain
in place. No transforms, font rules, colours or sizes change. The initial
both-header trial moved all three contents down exactly 8px in 32 measured
cases; the final trial limits that rule to the routine header.

The existing layout script passed 656 measured layouts with the final rule,
including reduced heights and landscape, plus its instruction-speech and Coach
actual-recording checks. Its native-entry check was omitted for this run because
an existing `View Post-Run Reset details` selector timed out (the test uses an old
routine name). This is a qualified layout pass, not a claim that the unmodified
browser script passed.

Physical-device comparison remains pending. Do not treat the experiment as an
accepted sharpness fix until the user reports visible improvement.

## iPhone 15 follow-up: 16px trial

The user reported that the 8px trial did not improve the softness on their iPhone
15 and requested a slightly lower position. Increase routine-header top padding
to 16px total (another 8px). This supersedes the first trial, without changing the
standard workout header, typography, colours, sizes or using a transform.
Temporary live publication remains authorised for the next device comparison;
this is still an experiment and #316 stays open. Retain it only if the user
reports visible improvement; otherwise restore the original zero header padding.

## Device result and bottom navigation follow-up

The user reports that the 16px routine-header padding appears to resolve the
softness on their iPhone 15. Retain that padding. Their subsequent Workouts
screenshot shows a background-coloured gap below the bottom navigation.

Menu screens previously sized the fixed shell through bottom insets, whereas
players followed the measured visual viewport. Size menu screens from the same
viewport measurement, retaining their existing extra bottom safe inset and nav
padding. This addresses the differing shell-sizing paths; the exact iOS
rasterisation/viewport behaviour cannot be reproduced in Chromium and the phone
result remains to be confirmed.

Supplementary checks: the original shell fails a synthetic differing-viewport
geometry case; the corrected shell passes light/dark, all five tabs, zero/34px
bottom safe insets, viewport resize/offset changes and returns from both players.
All 720 measured player layouts pass (the existing stale Post-Run Reset native
entry selector was omitted, as in prior runs). An emulated Workouts light capture
was inspected: the nav background reaches the bottom edge. These checks establish
the viewport-sizing contract, not reproduction of the physical iOS artefact.

## Persistent gap and build identification

The user confirmed the blank strip remains in the installed PWA after restarting
the iPhone. Safari shows its own bottom controls, so browser screenshots are not
equivalent to the installed display mode. Add Settings → About with loaded page
build `2026.10.27.1` and an independent CSS layout marker, plus optional copyable
display details. These values come from loaded files, not the newest GitHub commit.
Use the device's page/layout build, standalone mode, viewport and shell bounds to
distinguish stale files from incorrect iOS measurements before another layout
change. No further positioning change is included in this diagnostic release.

## iOS 27.0.1 physical-device evidence and root-layout trial

Builds 2026.10.27.1 match on device. iPhone 15 screen 393×852; window and visual
viewport 393×793, offset 0, scale 1; app bounds 0–827; top padding 59px; menu
bottom padding 42px. The missing 59px equals the top inset. The user reports iOS
27.0.1, so this is not a stale-file diagnosis. WebKit reports 313800 and 317153
describe closely matching standalone geometry, but do not establish a guaranteed
CSS fix for this particular device.

Build 2026.10.27.2 trials 100vh html/body and a normal-flow app on iOS standalone
menu/detail screens. It retains menu safe-area padding inside that full height
and removes the old menu extension in this mode. Safari and active player sizing
are unchanged, including the accepted 16px routine-header offset. The menu still
uses the visual viewport during a keyboard-sized reduction (more than 150px, at
scale 1); zoom and the 59px status-bar delta do not trigger that branch.

About adds root height and app positioning for device validation. Chromium can
verify the layout contract with a synthetic 793px report on an 852px viewport; it
cannot establish that iOS permits painting or hit-testing in the reported strip.
Physical-device confirmation is required. Roll back the standalone root trial if
it clips navigation or fails to improve the gap.

Sources: https://bugs.webkit.org/show_bug.cgi?id=313800 and
https://bugs.webkit.org/show_bug.cgi?id=317153; first-party workaround report:
https://github.com/cjnova/piclaw-monaco/blob/main/docs/PWA.md

## Compact menu after successful iOS root trial

The user confirms build 2026.10.27.2 removes the gap on the physical iPhone, but
the menu appears taller. Its formerly clipped 34px home-indicator padding is now
visible. Build 2026.10.27.3 keeps the accepted root layout and 16px player-header
offset. On installed iOS only, remove surplus vertical button/bar padding and
reduce the icon-to-label gap to 2px, preserving fonts, icon sizes and at least
44px button height. Keep the full bottom safe inset inside the bar. At the
393px iPhone width this targets an approximately 81px total bar instead of 115px,
including the 34px home-indicator region. Safari retains its existing styling.

## Comfortable control spacing and enduring Git build references

The user reports the compact bar leaves buttons against its top edge. Keep the
successful full-height root and 16px header adjustment; give the installed-iOS
bar 4px top padding, 4px above its bottom safe inset, and 4px vertical button
padding, centring icon/label stacks inside each target. Equal two-line label
slots preserve the common icon alignment. At 393px with a 34px
inset the total is 97px, between the previous 81px compact and 115px padded bars.
Fonts, icons, horizontal spacing and home-indicator clearance are preserved.

Replace manual date/sequence identifiers with GitHub Pages/Jekyll's
`site.github.build_revision`, embedded at build time in HTML and layout CSS.
About shows seven characters and copies the full hash; the CSS URL carries the
revision to keep the page and its diagnostic stylesheet together. No latest-API
lookup or manual bump is used. The existing Pages Jekyll pipeline is unchanged.
Local previews use the standard-library Python preview handler, which renders
only these revision expressions with the checkout SHA; self-hosted browser
checks reuse it. Production rendering must be checked after deployment.

Reference: https://jekyll.github.io/github-metadata/configuration/
