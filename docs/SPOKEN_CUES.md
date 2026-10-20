# Spoken cue voice selection (#174)

More → Settings → Spoken Cues offers System default and the current browser's
voices, with en-GB first. Names and language codes come from the device. A voice
changes pronunciation, not the English instructions. No speech service is used.

`js/speech-voices.js` discovers voices at startup, on `voiceschanged` and whenever
the screen opens. `gf_spoken_voice_v1` stores a device-local identity (voiceURI,
name, language). A unique URI/language match survives a renamed voice; ambiguous
matches and unavailable voices fall back to system default. With no URI, only a
unique name/language match is used. Empty inventories never erase preferences.
Storage and discovery failures are best effort. Every utterance in `speak()` uses
the same resolved voice; its queue order, cancellation and rate/pitch stay intact.

Preview uses the same speech path, starts only on user action on Spoken Cues,
replaces the previous preview, and cancels on selection changes or leaving the
screen. An active or paused workout prevents preview. Preview does not change
workout state or add timers. Existing workout/player layout is unchanged.

## Validation

- `node --test tests/*.test.js`: includes discovery, ordering, delayed inventories,
  persistence, duplicate names, renamed/missing voices, API/storage failures,
  multi-part utterances and workout/preview timing and cancellation regressions.
- Chromium with an injected voice inventory: real More/Settings navigation,
  selection, preview dispatch, back cancellation, reload persistence, empty/late
  inventory changes and 375×667 layout. This checks browser integration, not
  actual voice quality or audible hardware output.

## Physical device checks still required

No physical iPhone or Android device was available for this implementation.
Before release, record device/OS/browser versions, actual voice names/locales and
whether they load initially or after an update. Test on iPhone Safari and its
installed PWA, plus Android Chrome where available:

1. Open Spoken Cues; verify System default, en-GB first, and other locales.
2. Preview a named voice, change it while previewing, then leave the screen;
   confirm audible output follows the choice and stops when leaving.
3. Reload/reopen the PWA and confirm the choice persists.
4. Play Prep & Recover, a fixed workout, Generator and Coach; confirm named
   voices apply to announcements, follow-up instructions and timed cues.
5. Check workout pause/exit, transitions and chimes retain existing behaviour.
6. If a chosen voice can be removed/disabled on the device, confirm default
   fallback and automatic recovery when it becomes available again.

Siri/enhanced/premium voices are not guaranteed to be exposed by Web Speech.
