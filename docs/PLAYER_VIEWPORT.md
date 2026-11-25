# Shared workout player

`#player` handles routines and compatible fixed sequences. `#workoutPlayer` handles
Generator, Coach and fixed challenges. Both reserve a header and footer around an
adaptive stage inside the measured visual viewport. Active players hide the tab bar.
`js/player-layout.js` follows `visualViewport.height` and `offsetTop` with an
`innerHeight` fallback. Keep all three regions inside safe areas.

## Layout and navigation

- **Header.** Exit, concise title and elapsed time or step count. After the shell's
  top safe inset, the shared whole-pixel offset is 16px, 8px at heights ≤700px
  and 0px at ≤580px. Keep Exit at least 44px, the title unclipped and header
  contents clear of the stage. Preserve unrounded viewport measurements and avoid
  transforms, filters and font changes for positioning.
- **Stage.** Keep the immediate exercise, target, timer and brief side, load, setup
  or protocol cues. The timer follows the available height with a proportional
  200-unit SVG, radius 90, 12-unit stroke, round caps, tabular numerals and a
  centred countdown. The teal divider has reserved space outside the pause target.
  Compact views condense secondary space first. Short landscape uses two columns.
  Untimed work uses an explicit Pause control and allocates no timer ring.
- **Footer.** The workout journey, immediate `Next: …` line and action controls stay
  reserved below the stage. Previous is to the left of Next/Finish, with Coach's
  Skip work following in focus order. On short screens the three share a row.
  The preview names only the immediate activity and is associated with the primary
  button using `aria-describedby`. EMOM may keep its next activity in Next itself.
  The routine's sole advance action stays centred at 70% width (maximum 340px).
  Keep navigation usable with a disclosure open or the keyboard raised.

Tap, click, Enter and Space use one native pause action. Pause updates its accessible
action and pressed state while preserving phase colour, number and label position.
Clocks freeze until Resume. Routine navigation is forward-only. Workout navigation
keeps explicit rep confirmation distinct from timed skip/partial work. EMOM minutes
cannot be replayed, density retains recovery minimums and ended-block limits, and AMRAP
Previous is restricted to the current round. Preserve Coach busy, retry and outcome
entry behaviour. [Resolved playback and tracking](WORKOUT_PROTOCOLS.md)

The journey reflects Warm-up, Ramp-up, actual Main blocks and Cool-down. It weights
resolved durations, counts an EMOM minute in full and each AMRAP/density cap once.
Rep estimates size the segments and are described as estimates. Navigation or
confirmation advances rep positions. Pause freezes progress, Previous revisits it and
skipped work never becomes performed credit. Fixed-workout totals change on
confirmation or reversal. The routine player has no journey.

For the 300-Rep Challenge, Regenerate replaces the seven exercises. A swap revalidates
the whole plan for owned equipment and the slot's 25/50-rep dose. Start freezes the
selection. Only whole confirmed targets count, and voluntary mini-sets/rests leave
elapsed time running unless the player is paused. Keep the manageable-load cue inline.
Counting, safety, anchor setup and technique guidance remain on the preview and in
How to do it. Timing is not comparable across generated prescriptions. Reviewed dose
and composition eligibility belongs to `js/challenge300.js`.

## Disclosures and accessibility

Instruction, Coach editing and density partial-rep disclosures use the existing native
controls. Opening focuses Close without pausing. Close and Escape return focus to the
summary. Only panel content scrolls. Keep Coach confirmation visible and save errors
in the reserved controls area. When the keyboard consumes most of the viewport the
editor can use header space while leaving navigation accessible. Normal player pages
stay stationary. Extreme text enlargement or very small usable heights can enable
`player-reflow` for the stage alone.

How to do it keeps the live timer visible (compact circle above in portrait, alongside
in landscape). Artwork is optional, contained at its original aspect ratio, and shown
only with room for at least 160×120 CSS px after text and heading. Use the canonical
lookup; never wait for images or preload the catalogue. Reset clears the old image,
and late/failed loads leave the text and speech usable. [Exercise artwork](exercise-artwork/README.md)

## Installed iOS viewport

Outside active players the shell follows viewport measurements and extends one bottom
inset so the tab bar background reaches the edge and buttons clear the home indicator.
Installed iOS (`navigator.standalone`, set before paint) uses a normal-flow, full-height
root and keeps navigation compensation inside it. A keyboard-sized visual viewport
reduction (>150px at scale 1) switches the menu to its measured height. Browser mode
and active players keep their measured paths. Retain the historical tab button
padding (8px), gap (4px), natural labels and 8px visible bottom padding on the installed
root. Emulated restoration at 393×852 measures an 81px bar with 64px targets.

The owner accepted the installed-iPhone header and tab bar in [#316](https://github.com/nimbrethil81/garage-fit/issues/316#issuecomment-6463664476).
That check predates the shared #404 height-dependent header. Native sharpness and
safe-area confirmation for the shared offsets remains unverified. When checking it,
include both players at normal height and an SE-size screen or reduced Safari viewport
if available, in light and dark. Check device keyboard, browser chrome, home-indicator
clearance and wake-lock separately when affected.

## Speech and tones

- More → Settings → Spoken Cues selects a device voice (System default, then en-GB
  before other locales). `gf_spoken_voice_v1` retains its device-local identity.
  Prefer a unique URI/language match and use name/language only when there is no URI.
  Ambiguity or absence falls back to system default without erasing the stored
  choice. Voice discovery can finish later. Preview is user-initiated, replaces
  earlier preview, cancels on choice/navigation and is unavailable during live or
  paused workouts. No external speech service is used.
- Opening How to do it is silent. Once supported speech is ready, the expanded
  content and artwork share one speaker affordance and restart narration on tap,
  Enter or Space. Automatic cues take precedence. Reset and exit cancel manual
  narration. Unsupported speech and failed startup keep plain, readable instructions.
  Bind idempotently both immediately and at `garagefit-ready`; never move voice
  preference reads ahead of Backup & Restore startup and recovery.
- Web Audio is separate from speech. Use trusted-gesture unlock/resume and request
  the playback session type when supported. Recover suspended, interrupted or
  closed contexts as allowed. A delayed resume never replays dropped audio.
  Final 3/2/1 ticks are for active timed work only, excluding rep work, setup,
  transitions, recovery and AMRAP/density cap clocks. Retain established start,
  end and completion signals, and invalidate stale callbacks across pause,
  navigation, exit and backgrounding.
- About's audio diagnostics retain up to 40 technical events in memory, with an
  8 KiB copied Audio section. There is no workout text, storage or automatic
  transmission. Use the loaded page and layout SHA for device evidence. Scheduled oscillators and speech events show attempts,
  while actual audibility is a hardware observation.

## Equipment preparation

Use the actual final resolved play order and inventory, including preview substitutions,
preparation/ramp-up and cool-down. Reuse canonical IDs and AND-of-OR requirements:
announce the selected owned alternative when known, and present unresolved alternatives
truthfully. Combine newly needed items. Bodyweight needs no cue. Generator and Coach
share playback preparation. Equipment-bearing fixed flows and standalone routines
follow the same first-use rule using their actual frozen selection or routine inventory.

The existing preview or ready state covers only first-movement gear. Later cues prefer
a useful existing rest or changeover and can look earlier past a short gap. In a safe
work window, give advance notice to prepare when able. Use visual fallback when speech
cannot fit. The inline status wraps, announces politely without repeating on render,
and remains visible across intervening phases until first use or obsolescence. Hide an
empty row. No extra rest, timer, occurrence or persisted record is created. Planned
setup changes such as ring-height adjustments still have independent timing and
announcements. [Setup transitions](WORKOUT_PROTOCOLS.md#planned-equipment-setup-changes)

Equipment speech uses the selected voice and yields to ordinary announcements, doses,
sides, manual instructions, setup/safety, midpoint cues, countdowns and chimes. Keep
speech attempts distinct from presentation and delivery. An interrupted attempt may
retry with time and relevance in the same phase, without repeating a completed cue.
Guard pending speech by run, phase and reachable first use. Pause uses the frozen
clock, Resume rebases it, and background/foreground must not replay stale speech.
Recalculate on skip, Previous/redo and other jumps. Keep first-use state across rounds,
sides and revisits, and reset it only for a new run. Keep cue identity with live phase
objects across inserted recovery. Observe settled EMOM recovery, density cap/target
and AMRAP completion boundaries. Live loops withhold cues for unreached later blocks.
Coach save/retry never becomes preparation time. [Approved behaviour](https://github.com/nimbrethil81/garage-fit/issues/430)

## Regression and device verification

For shared startup, Backup & Restore, player, instructions or audio changes, run the
affected focused suites and the normal PR validation. Run the focused browser verifier
for affected startup and speech bindings. It uses the real bootstrap/layout with
deferred recovery and checks both player surfaces, including failure and unsupported
speech. Browser interception can verify dispatch and timing.

```sh
node --test tests/instruction-startup.test.js tests/instruction-speech.test.js tests/player-audio.test.js tests/exercise-countdown.test.js tests/timed-cues.test.js tests/equipment-cues.test.js
python3 scripts/preview_server.py --port 8000
```

In another terminal with developer-installed Playwright and Chromium:

```sh
python3 scripts/verify-player-audio.py http://127.0.0.1:8000 /tmp/player-audio
python3 scripts/verify-player-layout.py --url http://127.0.0.1:8000 --output /tmp/player-layout
```

`verify-player-timers.py` aliases the shared verifier. Use `--navigation-only` for tab
bar and viewport transitions. For layout changes compare matching states against main
using `--evidence` or `--evidence-only`. Include light/dark, both players, native entry
points, timed and rep work, short portrait and landscape, recovery, disclosures and
Coach actual entry. Check safe-area fit, ring proportion, focus, hit targets, keyboard
and enlarged text as well as page overflow.
[Viewport measurements](images/player-viewport/measurements.json) ·
[393×852 shared layout](images/player-viewport/404/393x852-dark-before-after.png) ·
[320×568 compact](images/player-viewport/404/320x568-light-before-after.png) ·
[667×375 landscape](images/player-viewport/404/667x375-dark-before-after.png) ·
[Equipment cue comparisons](images/player-viewport/equipment-cues-430/)

For affected installed-iPhone behaviour, record loaded page/layout SHA, OS, installed
mode, route, media volume, silent-switch state and observations:

| Check | Expected |
| --- | --- |
| How to do it in both players | Silent open, speaker when supported, text/artwork tap and Enter/Space restart, Close/Escape and focus work |
| Spoken Cues | Named voice, preview replacement/cancellation and reload persistence, device fallback and rediscovery if a voice disappears |
| Generator 15 min Cardio/Full body/Hard/bodyweight, and 30 min Mixed/bodyweight | Existing announcements and distinct tones. Timed work ticks once at 3, 2, 1. Reps, setup, rest and cap clocks stay quiet |
| Pause near 3s, rapid Next/Previous, exit, background, audio interruption, then trusted Resume | Current work resumes when allowed, with no stale or duplicate sound |
| Equipment in ordinary, short-rest and no-rest playback, including pause/resume | Useful first-use speech yields to normal instructions and tones. Muted/unavailable speech leaves a useful visual cue |

Test tone routing with the silent switch in both positions at audible volume. Use
technical diagnostics on failures and check first voice discovery, preview and workout
speech on Safari/installed PWA and Android Chrome when available. Voice inventory and
quality depend on the device.

The owner confirmed [#174 voice selection](https://github.com/nimbrethil81/garage-fit/issues/174)
on iPhone. Safari versus installed-PWA mode, OS version and voice names were unreported.
Android Chrome was untested. Keep the Spoken Cues row for future regression checks.

The owner confirmed the #338 repair on iPhone after PR #368. The exact loaded SHA and
individual matrix results were not reported. Keep the matrix for future regressions.
[#388](https://github.com/nimbrethil81/garage-fit/issues/388) tracks separate intermittent
tone and first-announcement reports. Reuse the existing diagnostics and record the
loaded build and each symptom separately.
The installed-iPhone equipment row remains outstanding for #430/PR #432. Chromium
layout, startup and dispatch evidence do not verify native audio or compositor behaviour.
[Audio acceptance](https://github.com/nimbrethil81/garage-fit/issues/338) ·
[Equipment acceptance](https://github.com/nimbrethil81/garage-fit/pull/432)
