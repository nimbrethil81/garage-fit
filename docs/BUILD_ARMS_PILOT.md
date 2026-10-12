# Build Arms production pilot

Definition `build-arms` version 1 implements the production parameters approved in
[#61, comment 6122051820](https://github.com/nimbrethil81/garage-fit/issues/61#issuecomment-6122051820).
The dependency #60 is closed and its reviewed canonical `directElbowAction`
metadata is present on main. No test-fixture targets were used.

The objective remains active until explicitly paused or finished. Aim for three
meaningful sessions per week; two is acceptable and missed sessions create no debt.
One stable direct flexion anchor and one stable direct extension anchor each start
at three sets of eight reps. Both use same-exercise double progression through
three sets of twelve. Numeric load progression suggests the next heavier available
load without inventing an increment. Bands/TRX use explicit setup confirmation,
show “Ready for more resistance” at the ceiling, and reset to eight only after
explicitly confirmed harder resistance. Easy today holds progression.

Rolling seven-day dose targets are nine performed direct set exposures per action.
Completed occurrences earn one, measured partial occurrences earn their performed
fraction capped at one, and skipped/planned-only work earns zero. Compound push/pull
exposure stays separate; it is coarse maintenance context, never quantified biceps
or triceps sets. Whole-body floors are one exposure each for squat, hinge, lunge,
compound push, compound pull, core and carry in seven days. Deficits prioritise
preferred maintenance exercises after required direct work. Short sessions omit
these preferences; later sessions recompute coverage rather than accumulating debt.
The catalogue currently requires dumbbells for carry maintenance; sessions explain
when equipment cannot provide a maintenance pattern.

## Browser verification

Verified on 2026-10-12 in Chromium 154 at a 390 × 844 viewport against the local
application. These were browser-driven pilot runs with timer phases advanced to
exercise playback and saving efficiently; no actual physical workout was performed.

- The existing Coach navigation lists General Strength and Build Arms.
- Empty equipment blocks direct flexion; dumbbells alone block direct extension.
  Bands/TRX provide both actions. Dumbbells plus bands/TRX/bench start successfully.
- The 20-minute preview places required direct curl/extension anchors first, each
  with three sets, while broader training remains present. Supporting-role dumbbell
  curls are included deterministically. Warm-up, ramp-up and rest remain present.
- The player logs confirmed numeric load for curls and explicitly confirmed
  resistance setup for extension work. Six completed direct sets save three
  exposures per action, advancing both initial targets to nine reps independently
  of whole-session Hard feedback.
- Reloading preserves programme identity, targets and dose without double credit.
- A temporary TRX curl substitute preserves flexion, starts at eight without the
  dumbbell load, records substitutions and leaves the stable dumbbell anchor intact.
  Four of eight reps earn 0.5 flexion exposure; skipped extension work adds zero.
- A second browser run progresses the setup anchor through 3×12, displays “Ready
  for more resistance”, and checks the harder-setup confirmation. The new confirmed
  setup persists across all three work sets and resets the next target to 3×8.
- Finishing Build Arms permits starting General Strength independently; its three
  squat/push/pull anchors and ordinary prescription flow remain available.
- No browser JavaScript errors occurred in either run.

## Automated verification

Run `node --test tests/*.test.js`. `tests/build-arms.test.js` covers registration,
approved values, feasibility, intrinsic direct-dose classification, fractional
partial credit, separate compound context, supporting-role reservation, numeric
and setup progression, unknown/missed/partial/Easy holds, comparable conditions,
same-action substitutions, short sessions, rolling maintenance restoration,
no debt, persistence and open-ended controls. The existing General Strength pilot
and standalone Generator characterisation remain unchanged. Generator selection
code and catalogue content are unchanged, so no separate reachability audit is
required for this programme.

Final run on 2026-10-12: all 47 test files passed, including all 11 focused Build
Arms cases.
