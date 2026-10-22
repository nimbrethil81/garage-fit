# Shared circular timer verification (#164)

Both players use the shared `.ring-wrap`, SVG circles, `.ring-center`,
`.phase-label`, `.timer-num` and `.reps-num` presentation introduced in #164.
The original 200-unit SVG, radius 90, 12-unit round-capped stroke, progress
direction, tabular numerals and centred countdown remain canonical.

Issue #166 replaces the fixed-size scrolling player with a height-constrained
stage and a proportional ring. Navigation stays visible on phone viewports;
expanded instructions and result entry use contained surfaces. See
[Active player viewport](PLAYER_VIEWPORT.md) for implementation, accessibility
exceptions, platform constraints, current screenshots and measured evidence.

Pause changes `aria-pressed`, the button's accessible action and an absolutely
positioned pause mark. It leaves the countdown/phase stack and phase colours in
place. Enter, Space, click and touch use the native button's single click handler.
Instructions, Coach inputs and the rest of the panel have no pause handler.
Untimed work shows its reps and a separate accessible pause control.

The routine clock remains `state.timer`; the generated player reads its existing
phase, EMOM-minute, density-cap or AMRAP-cap clock. No clock, target, tracker record or
programme policy was added. Density continues to show the cap and explicit
recovery status; EMOM continues to show its minute window and work/rest status.

| Entry point | Player | Progression |
| --- | --- | --- |
| Prep & Recover Warm Up/Cool Down, bodyweight/equipment | `#player` | Get ready, timed work and any rest; Next skips the current interval |
| 7 Minute Workout | `#player` | Work/rest circuit |
| 5-Minute Ab Blast | `#player` through Workouts UI | Continuous timed sequence |
| Evening Full-Body Reset | `#player` through Workouts UI | Timed sequence with changeovers |
| Post-Run Reset | `#player` through Workouts UI | Fixed timed sequence with per-step transition rules |
| Legacy ramp-up and snack callable entry points | `#player` | Existing timed routines; covered without adding navigation links |
| Rep-based fixed-sequence support | `#player` through Workouts UI | Rep target/Next, then any timed work; no fabricated ring |
| 300 Workout, Cindy | `#workoutPlayer` | Reps/rounds or AMRAP; existing Previous and explicit rep completion |
| Generator | `#workoutPlayer` | Timed skip/partial evidence versus confirmed reps; existing Previous |
| Coach | `#workoutPlayer` | Same controls with actual-result inputs, durable saves, busy locks and feedback |

Routine playback has no occurrence replay/history-reconciliation contract. Adding
Previous would require new rules for already completed/skipped routine evidence,
so its supported navigation remains forward-only. EMOM minutes cannot be replayed;
density retains its recovery minimums and restrictions on revisiting ended blocks;
AMRAP allows Previous only within the current round and never reopens an ended block.

Each player previews only the immediate activity name, as one muted `Next: …` line
directly above its primary button (#235); the button itself carries only its action
and references the name with `aria-describedby`. The line is hidden when there is
no valid next activity. Side annotations, timing, reps, resistance, set counts and
after-rest explanations are excluded.
The primary advance action uses **Next** consistently (#172); existing explicit
work-completion, finish and Coach feedback paths retain their distinct semantics.

## Reproduce the mobile checks

The optional browser check requires developer-installed Python Playwright and
Chromium; neither is an application dependency. Serve this checkout locally and
run:

```sh
python scripts/verify-player-layout.py --url http://127.0.0.1:8000 --output /tmp/player-layout
node --test tests/*.test.js
```

`verify-player-timers.py` runs the same suite and supplies native entry-point
checks. They exercise all six fixed workout detail/Start flows, Prep & Recover,
Generator and real Coach programme/preview/Start flows. Touch, click, Space and
Enter toggle pause once, frozen clocks resume correctly, focus outlines remain
visible, instruction activation does not pause playback, and exit/cancel restores
the prior state. Node regressions cover progression, timed skip versus completion,
cues, rest boundaries, Previous, Coach saves/busy/failure and actuals.

The old #164 pixel comparisons required identical ring dimensions and allowed
short-screen scrolling. They are superseded by #166's proportional geometry and
viewport-fit checks. Historical images remain under `images/player-timers/`;
current evidence and reproduction details are in [PLAYER_VIEWPORT.md](PLAYER_VIEWPORT.md).
