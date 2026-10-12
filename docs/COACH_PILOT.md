# General Strength production pilot

Implementation follows the approved UI/UX and General Strength production-parameter
comments on [issue #58](https://github.com/nimbrethil81/garage-fit/issues/58). Dependency
#57 was closed and its engine/policy/history framework was present on the starting
checkout (`b612ef7`). No test-fixture definition is shipped as a production programme.

## Automated verification

Run `node --test tests/*.test.js`. `tests/coach-pilot.test.js` exercises the released
definition across start feasibility, all supported durations, stable anchors,
preview/start without dose, confirmed and unknown actuals, double progression,
skipped/partial/abandoned outcomes, substitutions, no debt, maintenance, explicit
block review and completion, interrupted checkpoints and result/index/state recovery.
It also executes Coach player Done, Skip, Previous and timed partial exit through the
app shell. Existing standalone generator characterisation remains unchanged.

`generator.js` and the canonical exercise catalogue are unchanged, so no additional
catalogue reachability audit is required for this issue.

## Chromium pilot verification

Verified using the actual app served locally in Chromium at a 390×844 mobile viewport:

- Bodyweight-only start displays the missing pull/carry coverage and cannot start.
- Usual-equipment setup with dumbbells permits programme start and persists three
  stable anchors; the normal 30-minute preview contains all required work.
- Begin persists a draft. Anchor Done confirms edited actual reps/load.
- Previous and another Done retain one outcome for the occurrence. Skip on the next
  anchor set earns no performed credit.
- Actual countdown work followed by early exit records measured partial seconds.
  About right feedback saves an immutable partial result and applies state once.
- Reload retains history and programme state; the next adapted session is available.
- A 20-minute preview retains all required anchors and their two sets.
- Just-for-today squat substitution generates the approved alternative, records its
  actual identity, and leaves the original stable anchor unchanged.
- A completed run saves feedback and progression; pause/resume and maintenance work
  within the same programme instance.
- Ramp-up Skip records its current measured work and unperformed occurrences before
  moving to Main. The late-loaded ramp-up timeline uses the same planned occurrence
  identities as the tracker.
- No browser runtime errors or horizontal mobile overflow occurred.

Browser verification used player timeline shortcuts to reach selected work quickly;
actual confirmation/Skip/Previous/exit/feedback/navigation actions were exercised in
the rendered UI, and the timed partial used the running countdown.

The pilot intentionally provides temporary substitutions and a minimal programme
history. Permanent anchor replacement and a complete previous-programmes browser
remain optional future extensions; records are retained for them.
