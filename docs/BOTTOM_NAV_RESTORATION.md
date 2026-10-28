# Bottom navigation restoration (#316)

Reference: `40521292fa264cfa5d1521cf6cca7a7bd9dae5c5`.
Before-change main: `abd88629506323cf8ac5842bdfaa71b92c1b7120`.

## Confirmed CSS/layout difference

The historical fixed shell extended one bottom inset below the viewport. Its
bar included the same inset in bottom padding, cancelling it in the visible
layout. PR #327's normal-flow, full-height installed-iOS root removed the
off-screen extension, bringing that padding on-screen. The user confirmed this
root fixed the native gap. PRs #328–330 then changed the controls as well as the
bar: 4px button padding, 2px gap, centred stacks and equal minimum-height label
grids replaced 8px padding, 4px gap and natural label flow. The active-tab colour
and radius never changed; its enclosing rectangle changed with the button.

The before-change bar's bottom already reaches the simulated screen edge. Its
top is too high because its visible height is 97px instead of the historical
81px. Moving the shell again would address a different problem.

## Correction and retained changes

Remove all installed-iOS button/label overrides. Keep the original shared
navigation rules intact. Use only `padding-bottom:8px` on the installed-iOS bar:
this is the original visible padding after cancellation of the old off-screen
extension, not a new device-specific offset. Fonts, icons, active styling and
natural label flow now come from the historical shared rules.

Retain PR #321's accepted 16px routine-header padding, PR #322's browser-mode
measured shell and PR #327's installed-iOS root/keyboard handling. Player CSS/JS,
navigation logic, timers and Generator preview layout are unchanged. Retain
PR #329's automatic Git build references. No new transforms or spacers.

## Measurements and visual evidence

Chromium, identical 393×852 viewport, synthetic top/bottom insets 59/34px and
reported window/visual viewport 793px, top 0, scale 1. Historical and current
captures were taken before editing. Coordinates are CSS pixels.

| Measurement | Historical | Before-change main | Corrected |
| --- | ---: | ---: | ---: |
| App bottom | 886 | 852 | 852 |
| Bar top / bottom | 771 / 886 | 755 / 852 | 771 / 852 |
| Visible bar height | 81 | 97 | 81 |
| Button top / bottom | 780 / 844 | 777 / 831 | 780 / 844 |
| Button height | 64 | 54 | 64 |
| Icon top / height | 788 / 21 | 781 / 21 | 788 / 21 |
| Label box top | 813 | 804 | 813 |
| Two-line / single-line label height | 23 / 11.5 | 23 / 23 | 23 / 11.5 |
| Bar top / bottom padding | 8 / 42 | 21 / 21 | 8 / 8 |

The historical bar's last 34px are outside the captured viewport. The corrected
bar ends at the viewport, with the same visible background and all control
rectangles. The longest label ends at y=836 (16px above the edge); targets end
at y=844 (8px above it), matching the historical clearance.

Ten historical/corrected navigation crops (five tabs × two themes) are
pixel-identical. All button/icon/label rectangles and computed active styling
match. A wider comparison passed 120 states: four sizes (320×568, 375×667,
393×852, 430×932), three bottom insets (0/21/34), both themes and five real tab
taps. No horizontal overflow or targets under 44px were found.

Local capture scope: `/tmp/garagefit-nav-restore/`, with separate historical,
current and corrected manifests/measurements, navigation crops and full Workouts
screens. `comparison.html` displays all three versions. These are browser
evidence, not screenshots of the user's historical physical display.

## Regression checks and native limitation

Run `python3 scripts/preview_server.py --port 8000`, then:

```sh
python3 scripts/verify-player-layout.py --navigation-only --url http://127.0.0.1:8000 --output /tmp/nav-check
python3 scripts/verify-generator-preview-layout.py --output /tmp/preview-check
```

The navigation check records bounds in `navigation-report.json`. It protects the
historical visible arrangement, the 793/852 discrepancy, keyboard reduction and
recovery, all tabs/themes, both player returns and browser-mode shell behaviour.
The preview check covers both browser and installed modes and renders the build
templates before navigation, avoiding a raw-front-matter quirks-mode preview.
Both players also retain identical before/after geometry and passed touch,
click, Space/Enter pause/resume and timer/Next-state checks in both themes.
All 16 Generator preview cases passed, as did 32 focused Node checks and the
required Fast suite: 1,311 passed, zero failures.

Chromium cannot reproduce the native fixed-root clipping or establish the actual
current iOS visible viewport, home-indicator separation or keyboard animation.
The synthetic visible bottom is 852px; the injected 793px reports are deliberate
test inputs, not newly measured device facts. The previous device report and
confirmation support retaining the root workaround. Physical installed-iPhone
review is still required for the restored bar and accepted header; #316 stays
open and the regression is not declared resolved before that confirmation.
