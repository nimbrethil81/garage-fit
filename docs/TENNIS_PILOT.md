# Tennis pilot verification (#95)

Baseline: `93827937ec37a23ecb87507388ce246f5b16ea48` (merged #88–#94).
Tested locally on 12 October 2026; no live deployment or production storage used.

Reproduce with:

```sh
node --test tests/*.test.js
node tests/tennis-pilot.test.js
node scripts/audit-tennis-pilot.js > tennis-pilot.json
node scripts/audit-exercise-reachability.js
```

## Scope and evidence

The audit covers 600 setup/context cells: five focuses, 1/2/3 weekly sessions,
five 10–45 minute budgets and eight equipment scenarios. Readiness (including
omission), intensity, fixed/irregular days, reported hard tennis and ongoing/
1/5/56-day event horizons vary deterministically across cells. This is a bounded
interaction matrix, not every possible Cartesian combination: **429 feasible
previews, 21 explained rest recommendations and 150 blocked starts**. Bodyweight and
kettlebell-only starts explain the missing pull anchor; bands are not required.
An existing programme without today's anchor equipment can offer useful support
work with omission warnings, without replacing its persistent anchors.

Forty-five eight-week simulations cover every frequency/budget with dumbbells,
TRX and kettlebell + pull-up bar: **720 scheduled, generated and performed
sessions**. A further 16-session spacious comparison checks lateral coverage.
They use the production controller, Generator, player timeline, Tracker checkpoints,
Store, immutable results and reload reconciliation. Simulated users explicitly
confirm prescribed reps with 12 kg numeric resistance or the unchanged `initial`
resistance setup; neither targets nor calendar passage fabricate actuals.

Every output checks preparation, rounds/rest, actual side occurrences and selected
hard-target placements against the generated timeline and time ceiling. Deferred
anchors retain their identity/targets. Old results remain unchanged; replay/reload
does not duplicate credit. Supporting exercise variety and each rolling coverage
window, actual role counts and consolidation sessions are included in the JSON.
Supporting variety ranged from 23–42 exercises; each scenario completed one or
two performed consolidation sessions. All 720 sessions fit their requested budgets.
Frequencies describe aims rather than fixed weekly quotas or missed-work debt.

The nine focused regressions cover short omission rotation, unknown resistance,
skipped anchors, temporary substitutions, partial exits, preview-only work,
extended absence/pause, scheduled versus reported tennis, event expiry, unavailable
equipment/storage, failed checkpoints and result → state → draft-clear failures.
Existing context/development/event, Store/resilience and UI suites cover date
boundaries, corruption, unknown work, feedback gates and conservative safety.
General Strength, Build Arms and standalone #53 characterisation remain covered.

## Defect found and corrected

On released v4, one weekly 10-minute DB session repeatedly forgot older anchor
work at the 14-day boundary: pull remained at 6 reps after eight weeks while other
anchors advanced. Immutable **v5** keeps rolling dose first, then breaks ties with
earlier actual anchor work from the existing bounded history. The same seeded
run now ends at knee/hinge/push/pull targets **8/8/7/8**, with stable identities.
Saved v1–v4 definitions and behaviour remain pinned; there is no automatic migration.
All previously released definitions were compared to the baseline and are identical.

Seeded examples (`95 + calendar-day offset`, start 2026-10-01): DB, twice weekly,
30 minutes starts with reverse lunge/RDL/floor press/bent-over row at 2×6 and
plank pull-through support, **1,754 seconds**. The next seed, `98`, produces
movement/conditioning with selected knee/hinge anchors and varied support,
**1,763 seconds**. The JSON includes exact targets, exercise IDs and further cases.

## Mobile and validation

Isolated real Chromium, **390×844**, America/Los_Angeles, service workers blocked:
rendered Tennis setup, readiness, 10/30-minute controls, preview, paused player,
actual-set editing/Done and durable interruption/repeated reload were exercised.
Five further sessions used production controller/Tracker confirmations to reach
the performed consolidation/check-in gates. Rendered consolidation, optional
movement/endurance/comfort feedback, an event eight weeks away then tomorrow,
expired-event return to ongoing, pause/resume and finish retained the same instance.
Seven meaningful sessions survived; **zero page errors and horizontal overflow**.
This was a browser functional pilot with simulated execution, not physical exercise.

Full test suite and nine focused pilot cases pass. Reachability: **PASS**, 13,680
workouts, zero unreachable eligible exercises; **26 rare / 21 dominant** warnings.
Rare accessories, shoulder support and specialist hinges compete with primary
recipes; dominant pulls/conditioning and simple ramp-up exercises reflect equipment
and preparation roles. Dead bug/support variety and the specialist warnings remain
visible; catalogue, generic selection, thresholds and frequencies were not altered
to equalise appearances. `git diff --check` passes.

## Material limits

- Default home-small-space sessions observed **five of six capabilities** in the
  rolling windows; lateral work is explicitly unachievable under that constraint.
  The spacious comparison observed all six. A small-space programme cannot promise
  lateral/braking coverage; short or near-event sessions likewise cannot promise
  every anchor/facet. UI coverage/omission qualifiers are part of the release gate.
- Exposure is not proven tennis improvement. Controlled rotation is not rotational
  power; general conditioning is not measured match-specific repeated-effort fitness.
  Saved v1–v4 retain the previously released short-session rotation limitation.
- Targeted candidates needing separate approval remain those in
  [the capability audit](TENNIS_CAPABILITY_AUDIT.md): low-impact lateral step-and-stick
  with adequate space, stationary control variety and suitable shoulder rotation.
  No arbitrary drills, outdoor work, new equipment or protocols were added.
- History remains local to this browser/device; quota failures are recoverable errors,
  not cloud durability. The seeded pilot is bounded evidence, not an athletic outcome
  study or universal feasibility guarantee. Live deployment needs separate permission.
