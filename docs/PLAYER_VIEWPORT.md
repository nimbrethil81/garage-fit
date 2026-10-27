# Active player viewport (#166)

Both active players reserve a navigation row inside the usable visual viewport.
`showScreen()` removes the tab bar and marks the app as an active player.
`js/player-layout.js` follows `visualViewport.height` and `offsetTop`, including
browser chrome, orientation and keyboard changes; `innerHeight` is the fallback.
The shared shell also follows these measurements on menu screens so returning
from a player cannot fall back to a different fixed-layout viewport height. The
shell extends by one bottom safe inset, matching the tab bar's existing padding;
its background reaches the screen edge and its buttons stay above the home
indicator. Active players omit that extension and pay safe areas inside their
measured height.

The iOS installed-app trial (build 2026.10.27.2) is a scoped exception: iOS
27.0.1 device evidence shows a 793px reported viewport on an 852px screen with a
59px top inset. `navigator.standalone` adds a pre-paint class. html/body use 100vh,
and non-player screens use a normal-flow, full-height shell with the navigation
safe area inside it. A keyboard-sized visual-viewport reduction (>150px at scale
1) uses the measured menu height instead. Safari and player sizing retain the
existing path. Chromium validates these rules, not the native iOS compositor;
The user confirmed that this removes the physical-device gap. Build
2026.10.27.3 then compacts only the installed-iOS tab controls while retaining the
full home-indicator inset, existing fonts/icons and at least 44px tap height.

`css/player-layout.css` gives the stage the remaining height. The circular timer
uses that space through a size container, equal width/height and the original
200-unit SVG, radius 90, 12-unit stroke and round caps. Countdown, phase label,
pause mark, colours and progress direction retain the shared timer presentation.
Typography follows the ring with readable minimum sizes. Secondary spacing and
labels condense before the exercise or navigation. Short landscape viewports use
two columns. Targets, phase/protocol status, progress, pause, Previous, Next and
Skip work remain available with at least 44px hit targets (navigation starts at
54px). Timing, progression, generator policy and outcome contracts are unchanged.

Instructions, density partial reps and Coach edits keep their native `details`
summary and existing form elements/listeners. Opening one creates a single
reading/editing surface bounded above navigation. Only its content scrolls.
Close and Escape return focus to the summary; opening it focuses Close and does
not pause the workout. The Coach confirmation summary stays visible when the
editor is closed and is mirrored inside while editing. Save errors occupy the
reserved controls area, so an open surface cannot cover them. On very short keyboard viewports the surface also uses the
player header's space, with its own Close action. Inputs can scroll into view
inside the surface while navigation stays accessible.

In both players, opening How to do it stays silent. When browser speech is
available, its full expanded content area reads the displayed catalogue
instruction aloud on tap, Enter or Space; a small speaker icon signals the
action. Activating again restarts narration through the shared selected voice.
Close, Escape and the native summary retain their disclosure behaviour. Manual
narration leaves clocks running, yields to automatic cues and is cancelled when
the instruction resets or the player exits. Unsupported browsers keep readable
instructions without the speaker cue or narration action.

## Accessibility and platform constraints

Normal supported phone layouts do not scroll, including the reduced-height case
below. Extreme text enlargement or a genuinely tiny window can make the full
exercise/status content physically taller than the available stage. The measured
`player-reflow` exception then makes just the stage readable by scrolling, while
keeping the navigation row reserved and the player page stationary. It is also
allowed underneath an explicitly opened editor while a keyboard occupies most
of the viewport. This preserves information instead of clipping it or shrinking
all text. Closing the keyboard or restoring text size re-evaluates the regular
layout. Browser zoom settings are unchanged by this issue.

The implementation uses modern Safari/Chromium features: VisualViewport, dynamic
viewport units, size container queries and `:has()`. Browser evidence was collected
in Chromium with touch enabled and explicit iPhone safe-area simulation. Keyboard
checks simulate VisualViewport resize/pan separately from the layout viewport,
then focus and scroll the actual load input into the contained editor. This is
not a physical iPhone/Safari keyboard or standalone-PWA hardware test; real-device
browser chrome, keyboard animation, audio and wake-lock checks remain manual.

## Reproduce

```sh
python -m http.server 8000 --bind 127.0.0.1
# In a second terminal (requires developer-installed Playwright and Chromium;
# set CHROMIUM_PATH if Chromium is not at /usr/bin/chromium):
python scripts/verify-player-layout.py --url http://127.0.0.1:8000 --output /tmp/player-layout
node --test tests/*.test.js
```

`verify-player-timers.py` remains an alias and supplies the shared native entry/
timer interaction checks. The app and Node suite have no new dependencies.

The browser matrix covers 375×667, 393×852, 430×932, 375×540, 320×568 and 667×375
CSS px. Portrait tests reserve 47px at the top and 34px at the bottom; landscape
reserves 47px at each side and 21px at the bottom. It checks both players, all
fixed workout entry points, Prep & Recover, Generator, real Coach anchors and
all eight generated protocols, including work/rest/transition and unilateral
cool-downs. It also exercises long names/instructions, pause, rotation, numeric
Coach entry with a reduced keyboard viewport, extreme text enlargement, and
actual Coach outcome persistence through Next.
It also checks manual instruction narration in both players with a stubbed speech
engine: silent opening, full-area touch, replay/cancellation, Enter/Space,
Close/Escape/summary isolation, unchanged playback state and unsupported speech.

Every normal state measures player-page `scrollHeight <= clientHeight` and
stage fit (with 1 CSS px tolerance for subpixel rounding),
horizontal fit, safe navigation bounds, visible content bounds, unobstructed
button hit tests and ring/countdown geometry. Open detail surfaces separately
check navigation clearance and contained scrolling. The report records the
explicit accessibility exception separately from normal states.

Validation: all 78 Node test files passed, and all 390 measured browser states
passed, including Coach actuals and density partial-rep persistence. Normal
states include open optional surfaces; keyboard and enlarged-text exceptions are
measured separately. The 1px stage rounding in one 393×852 rest state stays
inside the gap above navigation and introduces no scrollable player area.

| Viewport | Measured states | Maximum page overflow | Maximum normal stage overflow | Smallest normal ring |
| --- | --- | --- | --- | --- |
| 375×667 | 65 | 0px | 0px | 248.09px |
| 393×852 | 65 | 0px | 1px | 330px |
| 430×932 | 65 | 0px | 0px | 330px |
| 375×540 | 65 | 0px | 0px | 121.09px |
| 320×568 | 65 | 0px | 0px | 134.8px |
| 667×375 | 65 | 0px | 0px | 182px |

Generated AMRAP (#221) adds one status line and reuses the ring, target, Next, Previous and Skip
work. The verifier now also covers the AMRAP fixture: a long name, open instructions, round 2,
pause, the timer at zero, the ended block, Coach Retry save and rotation. In Chromium all 270
AMRAP-inclusive states (every fixture phase plus those AMRAP states) passed at the six viewports
with no page overflow, at most 1px stage rounding at 667×375 and a smallest ring of 137px (375×540).

### Shared action footer and timer divider (#235)

Timed layouts restore the short teal divider below the ring. It is drawn in space
the timer host reserves under the ring (18px, 10px on short viewports), so the ring
keeps its proportional sizing, and it is not a pause target. Once the ring reaches
its 330px maximum the host stops growing, so the stage centres the timer, divider,
name and details as one group. A 2px stage bottom inset absorbs the display
line-height's sub-pixel text overflow, which otherwise pushed one rest state into
`player-reflow` in current Chromium.

The immediate-next preview (`updateRoutineControls()` / `renderUpNext()`, unchanged)
is a muted `Next: …` line above the navigation. In the workout player
(generated, fixed and Coach) **Previous sits on the left and the primary Next/Finish
workout action on the right, in one row** at every size (GF-R1 Option B, #280). On
normal portrait phones the two share the full content width in equal columns;
Coach Skip work follows centred beneath the row. DOM and focus order stay Previous,
primary, Skip work. This supersedes #235 Decision 1B's stacked, centred 70% portrait
primary layout. The routine player has no Previous control, so its primary action
stays centred at 70% of the content width (capped at 340px). When the usable height
is 580px or less, the workout player keeps one reserved row with Previous, the primary
action and Skip work, the preview above the primary action. Wide landscape rows centre
the primary action.

The verifier now also checks that the preview is above and outside the primary
action in one colour, Previous and the primary action share one row with Previous on
the left (also with the Finish workout label) and contained in the navigation, the
routine player's lone primary action is centred at ~70%, and the divider is present
inside the timer space. The matrix includes 390×844 and 360×640. The Python
script needs a developer-installed Playwright. For this change the same matrix,
native entry checks and assertions were run through a Node Playwright port with
Chromium 141. All 444 measured states passed with no page or normal-stage overflow.
The smallest rings were 165px (375×667), 321px (393×852), 330px (430×932), 101px
(375×540), 115px (320×568) and 163px (667×375). In every viewport the smallest was
the deliberately long three-line density fixture with Skip work. Representative fixed,
routine, Generator, Coach, AMRAP, EMOM, interval, Mobility and Athletic states were
also inspected at 393×852, 375×540 and 667×375. These cover first, intermediate, final,
paused and instruction-open states.

The retained [measurement summary](images/player-viewport/measurements.json) and
screenshots (refreshed for #235) show the viewport evidence; running the script emits the full report
and additional captures.

| Example | Screenshot |
| --- | --- |
| 375×667 generated timed work | [Timed work](images/player-viewport/375x667-timed.png) |
| 393×852 Coach anchor | [Coach anchor](images/player-viewport/393x852-coach.png) |
| 430×932 routine | [Routine](images/player-viewport/430x932-routine.png) |
| 375×540 density with a long exercise name | [Reduced height](images/player-viewport/375x540-density.png) |
| Coach editor with a 300px usable keyboard viewport | [Keyboard](images/player-viewport/375x540-keyboard.png) |
| 667×375 landscape EMOM | [Landscape](images/player-viewport/667x375-emom.png) |

### Workout journey progress (#292, WP-V1–V4)

The workout player's existing overall progress slot now contains one duration-weighted
journey bar and its concise current-phase label. Only real Warm-up, Ramp-up,
individual Main blocks and Cool-down appear. Short segments retain an 8px minimum.
Completed segments fill teal, the current segment fills orange, and upcoming
segments remain muted. The former dense movement counter shows only relevant
round context; its responsive space is retained to preserve timer/exercise geometry.

This is a read-only view of the resolved timeline and existing clocks. Timed work,
recoveries and transitions advance within their owning segment. EMOM includes the
whole minute; AMRAP and density count their block cap once. Rep estimates weight
planned work but never fabricate elapsed rep completion: confirmation/navigation
moves that portion, and the accessible progress description identifies estimates.
Pause excludes inactive time, Previous reflects the revisited position, and skipped
work advances the journey without becoming performed evidence. Fixed workouts and
Coach use the same presentation; the routine player is unchanged.

The viewport capture helper settles CSS transitions and disclosure/viewport layout
before screenshots, and emits `progress-regions.json` for comparison against the
same fixtures on main. Compare both versions' region bounds, because the removed
counter can be wider than the new round text. Images outside these regions must
remain unchanged; native input focus/scroll state must also match when comparing
open editors. Chromium emulation is not physical iPhone/Safari validation.

### Illustrated exercise instructions (#203)

Both players resolve artwork through the shared canonical illustration lookup.
Preparing the current phase starts a best-effort browser image load without
waiting or preloading the whole catalogue. Phase reset removes the previous
image; late callbacks are ignored and failures leave the text/speech path intact.
Images have no separate activation handler or focus stop: image, text and blank
instruction content all use the existing single narration handler. Opening and
image loading stay silent.

An open exercise instruction surface keeps the live timer visible. Portrait
uses a compact 120–128px circular timer above the panel; landscape keeps the timer
in the left column and instruction content in the right. Circle proportions,
countdown centring and pause activation remain unchanged. Other editors keep
their existing bounded overlay. Navigation stays reserved below every panel.

Artwork is contained against the dark artwork background, at its native 4:3
composition. It appears only when at least 160×120 CSS pixels remain after the
instruction text and panel heading; otherwise the panel deterministically keeps
text only. Resizing re-evaluates this without shrinking artwork below that floor.
Long text can still scroll within the panel under the existing accessibility
contract. This does not alter clocks, progression, narration or saved outcomes.
