# Phase 3 native compatibility proof — issue #360

## Decision recorded 31 October 2026

**No-go for an iOS release at this gate. Conditional go for continuing the
bounded Capacitor investigation on the user's Mac/iPhone.** This is neither a
rejection of Capacitor nor a claim of native compatibility. The available
executor is Linux x86_64 with no Xcode or attached iPhone. Mac model, macOS,
Xcode, iPhone model and iOS version are **unverified**. Hardware details have
been requested; ability to use the existing Mac without new hardware is not yet
established. Do not close #360 as device acceptance complete.

| Area | Evidence / decision | Gap severity and next action |
| --- | --- | --- |
| Shared assets | Go: pinned Git bundle and iOS project generation/copy succeed | Native compilation/signing unverified |
| Existing Mac/toolchain | Unverified; `cap doctor ios` reports `Xcode is not installed` here | Blocking: verify user's Mac supports Xcode 26+ and the phone's OS |
| Offline native operation | Unverified on iPhone; local bundle inventory and Chromium checks only | Blocking: airplane-mode cold launch and all representative paths |
| Storage / protected restore | Existing contract retained; Chromium regression evidence only | Blocking: WKWebView locks/crypto/file semantics, recovery, real upgrade |
| Interruption safety | Source shows incomplete GF-MOB3 coverage across Players | Blocking: focused lifecycle/UI follow-on; no automatic continuation or inferred work |
| Speech / audio / wake | Browser implementations retained | Blocking physical-device audible/wake evidence; native bridge may be needed |
| Appearance / navigation / accessibility | Existing browser checks only | Native visual acceptance **unverified**: safe areas, keyboard, VoiceOver, gestures |
| Cost / Android | Local tools and bundled web assets, no mandatory paid service introduced | Mac sufficiency unknown; later Android device evidence unavailable (user owns none) |

## Candidate and exact source

Tested application source: `31d878d1a55125897b7a4dba097741ad0cf40acb`,
latest fetched `origin/main` at investigation start. Phase 2 code is present.
All packaging/browser evidence below uses that source; proof tooling lives in
the accompanying PR. No production HTML, CSS, JS, catalogue or persistence code
was changed. First-use impact: **no impact** (developer tooling/report only).

Provisionally selected current npm release: `@capacitor/core`, `@capacitor/ios`
and `@capacitor/cli` **8.6.0**, all exact-pinned with an npm lockfile. Observed
Node **24.19.0**, npm **11.9.0**, Python/system Chromium on Linux. Candidate
requires Node **22+**, Xcode **26.0+**, iOS deployment target **15.0+**.
Generated project uses Swift Package Manager (tools version 5.9, exact
`capacitor-swift-pm` 8.6.0). No native plugin was added. Xcode SDK version,
Swift compiler, provisioning and signed builds are **unverified**.

Requirements sources checked on 31 October 2026:
[Capacitor 8 environment setup](https://github.com/ionic-team/capacitor-docs/blob/main/versioned_docs/version-v8/main/getting-started/environment-setup.md),
[8.0 migration requirements](https://github.com/ionic-team/capacitor-docs/blob/main/versioned_docs/version-v8/main/updating/8-0.md),
installed 8.6.0 package manifests/podspecs and generated Xcode/SPM project.
Check [Apple's Xcode support table](https://developer.apple.com/support/xcode/)
against the user's exact macOS and device OS before building; that combination
has not been verified. Do not silently downgrade the candidate or require a new
Mac if it conflicts with the cost constraint; report that decision gate.

## Reproduction and inventory

Follow [_native-proof/README.md](../_native-proof/README.md). Executed:

```sh
npm install --prefix _native-proof --ignore-scripts
python3 scripts/prepare_native.py --ref 31d878d1a55125897b7a4dba097741ad0cf40acb
# In _native-proof:
npm run ios:add -- --packagemanager SPM
npm run ios:sync
./node_modules/.bin/cap doctor ios
```

Generation and sync succeeded; doctor reported missing Xcode. These are not a
compiled binary or an install. An initial add before preparing assets warned
that `www` was missing; preparing assets and syncing succeeded afterwards.
The documented fresh-checkout order prepares assets first.

The generated inventory contains **72 application files** with path, byte size
and SHA-256, plus the inventory itself. It includes the catalogue/guidance,
programme definitions, logic, styles, manifest/icons, exercise/programme artwork
and dynamically loaded ramp-up script. Both revision templates use the pinned
SHA; directory structure/relative URL resolution is preserved. Browser speech
voices are OS resources rather than bundled assets and may require downloaded
voices; they remain an offline-device test dependency. No service worker or
remote web-app URL is introduced. Bundle reproducibility covers web bytes and
source identity, not byte-identical signed Xcode products. Pages continues using
its original Jekyll templates; its native-proof underscore directory is excluded.

## Persistence and API decision gate

Default iOS runtime source uses scheme `capacitor`, hostname `localhost`; expected
`capacitor://localhost` is **not** an observed secure origin. In Safari's connected
Web Inspector record `location.href`, `location.origin`, `isSecureContext`,
`typeof navigator.locks?.request`, `typeof crypto?.subtle?.digest`, storage
read/write/remove outcome, `typeof navigator.share`, `navigator.canShare` for a
real JSON File, and file-input selection/re-selection. Feature presence is
insufficient: test shared locks coexisting, exclusive denial while shared is
held, exclusive ownership after release, and recovery/release on termination.
Do not run destructive tests against the user's sole real history.

On a synthetic native dataset, then an independently backed-up representative
history, exercise the full #354 contract from `docs/BACKUP_FORMAT.md`:

1. Export; save to Files/share destination. Independently reselect and verify the
   saved file; cancelling/sharing alone must never be marked verified.
2. Prepare and independently verify a separate destination-preservation backup.
   Change destination data and check that verification is invalidated.
3. Explicitly confirm replacement; reload; compare all curated preferences and
   immutable completed/partial Session Results, with Coach reconciliation once.
4. Interrupt replacement/recovery at journal/reserve and write boundaries using
   synthetic data; restart and check exact rollback or blocked recovery, never
   an apparently usable partial restore. Retain evidence of failed writes.
5. Force-close/restart after recording results. Install signed build B over A
   with the **same identity/origin/data store**, without uninstalling; compare raw
   saved records/checksums and derived history, and repeat interrupted recovery.

All five steps on native iPhone, including real upgrade, are **unverified**.
Current backup bridge allows ordinary startup without Web Locks when no recovery
is pending, but protected operations depend on locks. Missing locks or unusable
crypto/files is a **blocker**; no stub lock, bypass, silent fallback or relaxed
preservation gate is acceptable. Retain browser storage initially (GF-MOB4 B).
Only evidence of a failure can justify evaluating a native adapter later.

## GF-MOB3 source assessment and device matrix

The following is **source assessment**, not observed iOS behaviour. For every row
run foreground baseline, home/app switch, screen lock, incoming call,
notification overlay, audio interruption and process kill; return both quickly
and after the timer/cap would have expired. Device outcomes for every cell are
**unverified**. Observe durable records as well as displayed clocks/cues.

| Player/protocol | Existing implementation / risk | Narrow follow-on needed |
| --- | --- | --- |
| Routine / seven-minute | `runTimer` decrements by interval; no comprehensive hidden-state pause | Pause at interruption; no delayed tick/advance; explicit resume |
| Fixed workouts including fixed AMRAP | Elapsed wall clock; no generic interruption boundary | Freeze elapsed/cap and disable completion while interrupted |
| Generator timed / rest / rep phases | Clock/deadline and phase timer machinery; no general pause-on-hide | Freeze phase safely; never turn time away into completed work |
| Coach generated phases | Same Player plus durable tracker/checkpoints | Checkpoint only established evidence; recover results idempotently |
| EMOM | Visibility return can catch up; pagehide best-effort Coach settlement then pause | Native resign-active must precede elapsed catch-up/settlement; missed minutes earn no speculative timed credit |
| Density | Deadline and explicit rep confirmations; pagehide Coach checkpoint/pause | Preserve confirmed work and cap; no new target on return |
| Generated AMRAP | Deadline, explicit rep evidence; pagehide pause, no speculative checkpoint | Preserve unknown reps and explicit resume; no expiry announcement replay |
| Termination / all | JS unload/checkpoint cannot be guaranteed; Coach startup reconciles durable drafts | Recovery from durable evidence only; never resume a stale live timer |

Relevant source anchors: `runTimer`, `currentWorkoutElapsedMs`,
`pauseWorkoutClock`, `resumeWorkoutClock`, `syncGeneratedCountdown`,
`updateEmomMinute`, `settleEmomMinute`, density/AMRAP clocks and
`pagehide/pageshow` in `index.html`; `session-tracker`, `coach-recovery` and
`timed-cues` modules. `pageshow` restarts protocol polling but leaves the paused
clock requiring Resume; that limited policy must not be mistaken for complete
native interruption handling. Visibility returning also prepares audio and
requests wake lock, which does not establish native lifecycle correctness.

Proposed minimum integration to evaluate later: native app-active/background
and audio-session interruption events feeding one idempotent pause boundary;
stop/cancel pending speech/chimes, freeze time and persist only measured evidence.
A general App-state plugin alone may miss foreground call/audio interruptions;
verify event coverage before selecting a plugin or a small native observer.
Do not change existing browser workout semantics based on speculation.

Required states for **focused UI/UX approval before final implementation**:
running; interrupted/paused with reason and preserved position; foreground still
paused with explicit Resume or End; checkpoint-save failure with retry of the
same evidence; termination recovery summary based solely on durable work. Define
cap/minute behaviour, focus and accessible announcements for each protocol.
No final interruption UI or appearance decision is implemented in this proof.

## Remaining physical acceptance and smallest next step

On the same iPhone/build record offline cold start after force-close with airplane
mode/Wi-Fi off: catalogue/art, Generator, Coach start/continue, both Players,
history and settings. Test installed/downloaded Web Speech voices, countdowns,
chimes, silent mode, Bluetooth connect/disconnect and calls; check no stale cues
or queued speech on return. Verify wake behaviour and screen locking separately.
If Web Audio/session or wake APIs fail, evaluate the smallest local native audio
session/idle-timer bridge; do not promise background workouts. Check light/dark,
notches/home indicator, keyboard and restored viewport, back/swipe dismissal,
five-tab navigation, focus/labels and VoiceOver. All native visual/audible/wake
acceptance is **unverified**; Safari-PWA and Chromium results cannot substitute.

No mandatory new subscriptions/backend/build services are introduced. Local
Xcode/SPM/npm are sufficient tooling in principle; signing/store fees remain a
separate distribution concern, and hardware suitability remains unknown.
For later Android, reuse the identical pinned web bundle, add Android tooling
only in its authorised issue, and verify Android back dispatch, lifecycle,
origin/store, files, audio and edge-to-edge insets. Capacitor 8's migration guide
specifies Android Studio 2025.2.1+, compile/target SDK 36 and min SDK 24; confirm
its JDK/toolchain on the Windows PC then. No Android project/device claim here.

The smallest next action is to finish this issue's blocked Mac/iPhone evidence
using the runbook. Only after that gate, scope an iOS release issue containing
approved interruption UI and the particular native integrations the evidence
requires, same-identity upgrade/persistence tests and physical acceptance.
Store submission, production signing and Android release remain separate.
If Web Locks, upgrade storage or lifecycle semantics prove incompatible, stop
and obtain a decision on that concrete architectural conflict.

## Validation record

Observed results (all browser checks use prepared assets unless noted):

- `python3 scripts/test_prepare_native.py`: passed; repeated bundle bytes,
  stale-output removal, SHA hashes, local HTML/manifest references and complete
  dynamic asset trees checked.
- `python3 scripts/verify-native-bundle.py`: passed; 72 asset hashes, five tabs,
  library, routine/fixed/generated Player entry, Coach landing, settings and
  Progress entry; zero external requests or page errors. This is loopback serving
  with external requests blocked, **not** native airplane-mode evidence.
- `python3 scripts/verify-backup.py /tmp/gf360-backup http://127.0.0.1:8000`:
  passed; 54 captures, real browser tabs, file round trips, preservation and
  startup recovery; synthetic fixtures, no native iPhone verified.
- `python3 scripts/verify-player-layout.py --url http://127.0.0.1:8000 --output /tmp/gf360-player`:
  **failed** at line 217: expected instruction-speaker count. Standalone viewport
  and five-tab shell checks passed before the failure. The identical
  `instruction_speech_checks` failure reproduced on untouched main via
  `preview_server.py --port 8001`. With speech stubbed as supported, after app
  readiness `instructionSpeechAvailable()` is true but speaker count is zero and
  content roles are absent. Source initialises these affordances only once in
  `player-layout.js`, before async backup/app startup sets `speechVoices`.
  This is a pre-existing startup-order regression; no assertions or production
  behaviour were changed here. Remaining full viewport checks are unverified.
- Existing `verify-player-timers.py` `native_entry_checks` (name refers to UI
  entry controls, **not** native runtime): passed all seven entry fixtures in
  Chromium separately.
- Fast and Full Node suites: see PR for final results.
- iOS generation/sync: passed; Xcode compilation/signing/install: **blocked**.

The speech-affordance regression needs a focused correction before release;
this proof does not rewrite Player startup. These checks protect PWA/Phase 2
regressions; none certify native behaviour. No exhaustive catalogue reachability
audit is needed because catalogue and generator policy are unchanged.
