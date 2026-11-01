# Player audio regression checks (#338)

## Evidence and limits

Reported installed iPhone build: `403af15e150a5416e1ce64be63e7d5f4a557da79`, iPhone OS 18.7, 393 × 852, light appearance.

Confirmed code defect: PR #357 moved voice-service creation behind asynchronous backup lease/recovery. The post-inline player layout checked support once, while the service was null. The repair binds immediately when available and again on `garagefit-ready`, without moving preference reads ahead of recovery. Binding is idempotent; failed startup and unsupported speech add no false affordance.

History: `3871955` introduced ticks; `2ab8acd` introduced the completion chime. Both used a default Web Audio context. PR #349 (`2bfaf9f`) added gesture resume and louder ticks but remained field-unverified. No physically verified last-known-good audio build is established by the available evidence. The reported build contains #349; repeating its changes would not establish a fix.

Remaining audio hypothesis: WebKit's default ambient audio session can obey the iPhone silent switch independently of Web Speech. Requesting the supported `navigator.audioSession.type='playback'` before context creation addresses that routing possibility; browsers without the API retain the existing path. This is **not a confirmed diagnosis of the reported phone**. No volume, timer dispatch, transition semantics or narration changes are made. Resume promises never queue old sounds.

`playerAudioDiagnostics()` returns up to 40 memory-only technical events: creation/state changes, session selection/errors, resume requests/results, skipped sounds, oscillator scheduling/errors. Only error names are retained, with context state and page visibility; no console noise, persistence, workout text or network telemetry. Scheduling proves an attempt, not audibility. To distinguish a running-but-inaudible context from a resume failure on a connected device, inspect this function with Safari remote debugging immediately after the failure. Copy technical evidence manually if needed. Reopening the app clears it.

## Fast / PR gate

For changes to shared startup, Backup & Restore, player layout, instruction speech or audio:

```sh
node --test tests/instruction-startup.test.js tests/instruction-speech.test.js tests/player-audio.test.js tests/exercise-countdown.test.js
node --test --test-skip-pattern='\[Full\]' tests/*.test.js
```

These tests are automatically included in the established Fast checks. The startup integration runs the deployed inline bootstrap with a deferred backup boundary and the actual `js/player-layout.js`, testing both players' bindings and unsupported/failing startup. Audio tests cover context suspend/interruption/close, failed and pending resume, no stale replay, routing fallback and bounded diagnostics. Countdown tests cover mixed timed/rep phases, rest/setup suppression, pause, stale navigation callbacks and both reported Generator configurations. They do not reproduce physical audio output.

For affected PRs, also run the focused real-DOM check with the existing developer browser tooling:

```sh
python3 scripts/preview_server.py --port 8000
# in a second terminal
python3 scripts/verify-player-audio.py http://127.0.0.1:8000 /tmp/player-audio
```

It loads real Backup & Restore, defers its startup result, runs the shipped inline script and layout, checks content/illustration clicks, restart, Enter/Space, Escape, unsupported speech and failed startup, and captures both player surfaces at the reported viewport. Browser speech is intercepted for deterministic assertions. This is not physical iPhone acceptance.

## Installed-iPhone acceptance — outstanding

Do not close #338 or claim audio acceptance until these checks pass on hardware. Record **loaded page and layout SHA**, iOS version, installed-PWA mode, output route, media volume, silent-switch state and pass/fail for each row. Use About's loaded build and existing composition diagnostics, rather than the latest server SHA. First verify the installed page matches the candidate commit; an old installed build cannot validate it.

| Check | Expected |
| --- | --- |
| Both players: open How to do it, tap text/artwork twice, keyboard Enter/Space; Close/Escape | Canonical text and speaker; silent opening; every activation restarts narration; dismissal/focus unchanged |
| Selected voice, exercise names and due spoken cues while using manual narration | Selected voice retained; automatic cues supersede manual narration; timers/history unchanged |
| Generator: 15 min / Cardio / Full body / Hard / bodyweight; warm-up, ramp-up, main timed work, cool-down | Ticks once at 3, 2, 1 during active timed exercise; established start/end/completion chimes audible and distinct from speech |
| Secondary: 30 min / Mixed / bodyweight; timed and rep phases | Same sounds on timed work; no ticks in reps, rest, setup, transition, round rest or AMRAP/density cap |
| Repeat sound checks with silent switch on and off at audible media volume | Record actual routing outcome and technical diagnostics for each; no inference from speech alone |
| Pause/resume near 3 seconds; rapid Next/Previous; leave player | No paused, stale or duplicate sound; normal subsequent exercise cues |
| Background/foreground and an audio interruption, then trusted Resume/Next gesture | Current work recovers when permitted; no delayed replay; capture diagnostics if recovery fails |

**Current physical-device result: UNVERIFIED — no installed iPhone is available in the coding environment.** The audio root cause remains provisional pending device evidence. Keep the PR unmerged while that material uncertainty remains, and the issue open until acceptance is established.
