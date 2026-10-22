# Active player viewport (#166)

Both active players reserve a navigation row inside the usable visual viewport.
`showScreen()` removes the tab bar and marks the app as an active player.
`js/player-layout.js` follows `visualViewport.height` and `offsetTop`, including
browser chrome, orientation and keyboard changes; `innerHeight` is the fallback.
Safe areas are included inside this height, replacing the shell's previous
negative bottom inset while a player is active. Other screens retain their layout.

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
# In a second terminal (requires developer-installed Playwright and Chromium):
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

The retained [measurement summary](images/player-viewport/measurements.json) and
screenshots show the viewport evidence; running the script emits the full report
and additional captures.

| Example | Screenshot |
| --- | --- |
| 375×667 generated timed work | [Timed work](images/player-viewport/375x667-timed.png) |
| 393×852 Coach anchor | [Coach anchor](images/player-viewport/393x852-coach.png) |
| 430×932 routine | [Routine](images/player-viewport/430x932-routine.png) |
| 375×540 density with a long exercise name | [Reduced height](images/player-viewport/375x540-density.png) |
| Coach editor with a 300px usable keyboard viewport | [Keyboard](images/player-viewport/375x540-keyboard.png) |
| 667×375 landscape EMOM | [Landscape](images/player-viewport/667x375-emom.png) |
