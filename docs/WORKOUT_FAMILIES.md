# Shared workout-family contract

`data/workout-families.js` owns the canonical six-family registry, exposed as
`GarageFitData.workoutFamilies[workoutFamilyId][version]`. Definitions and nested
values are immutable. Released versions remain available unchanged; a material
policy change needs a new definition version and versioned policy reference.

Each definition owns its display name, purpose, supported internal styles, Body
Focus compatibility, composition/membership policy references, suitability criteria
and family feasibility requirements. Those requirements describe obligations for
the downstream composers and validator, not proof that a workout can be generated.
Supporting a duration/difficulty does not promise feasibility for every equipment,
impact or space configuration. Policy references do not register working composers.

## Shared resolution

Load `js/workout-families.js` after the data file. Both standalone Generator and
Coach consumers use `GarageFitWorkoutFamilies`; neither maintains a second family
table. This foundation does not yet route existing generation through families.

1. `resolveRequest(options)` resolves the requested family/version and effective
   Body Focus. Missing/null `workoutFamilyId` returns `null`: continue the existing
   Generator or Coach path with the original options, with no additional random
   draws, preference changes or record migrations. The legacy `focus` and
   `workoutStyle` values are ignored only for an explicit family request.
2. An explicit request returns `{workoutFamilyId, workoutFamilyVersion, bodyFocus,
   familyStyleId: null}`. Only Strength & Control accepts a non-default Body Focus;
   other families resolve to `full-body`, ignoring the temporarily disabled value.
   The caller retains the original preferences for restoration on the legacy route.
3. The shared composer establishes which supported internal styles are feasible
   and ranks them using actual constraints and training context. Call
   `resolveStyle(request, feasibleStyleIds)` to select the first viable candidate
   automatically. An input request cannot set `familyStyleId`. The returned style
   identifies the actual composition; a supported label alone does not validate a
   workout. Same-family fallback must call `resolveStyle` with the original unresolved
   request and the revised feasible candidates before display, not feed the already
   resolved identity back into `resolveRequest`.

For example:

```js
const request = GarageFitWorkoutFamilies.resolveRequest({
  workoutFamilyId: 'strength-control', workoutFamilyVersion: 1,
  focus: 'cardio', bodyFocus: 'upper'
});
// After composition proves a paired-set session feasible:
const identity = GarageFitWorkoutFamilies.resolveStyle(request, ['paired-sets']);
```

`getDefinition(id, version = 1)` and `getStyle(id, styleId, version = 1)` are strict
lookups. The default remains version 1; future published consumers explicitly pin
their approved version instead of silently following newer policy. Requests do
not accept aliases or guess a family from other fields. `FamilyContractError.code`
distinguishes unknown family, unsupported version/style/Body Focus, invalid request
and an empty feasible-style list. An empty list means the composer supplied no
viable style; actionable feasibility reasons and bounded fallback belong to the
shared validation/fallback implementation.

## Boundaries

- `workoutFamilyId` describes the workout's purpose; `familyStyleId` describes its
  resolved internal experience. Neither replaces exercise `family` (variation
  metadata), Coach `sessionRole`, programme `type`, or a Main block protocol.
- `membershipPolicy` is the versioned seam for family-scoped exercise eligibility
  and contextual prescriptions. It contains no guessed exercise IDs or global
  phase promotions. Mobility/Athletic catalogue and sequence implementations use
  this seam in their own issues.
- Composition owns construction and style feasibility; the shared validation gate
  owns final programming quality, safe fallback and edit/swap integrity. A manual
  family choice must not silently cross families.
- Existing published Coach definitions, saved preferences and historical records
  remain unchanged. Persistent family identity/history is a later contract; this
  module neither stores identities nor relabels legacy sessions.

## Family-scoped exercise membership and prescriptions

After the Generator module loads, the catalogue-owning module registers its reviewed
membership policy once with `GarageFitWorkoutFamilies.registerMembershipPolicy({
workoutFamilyId, workoutFamilyVersion: 1, entries})`. The registry resolves the
definition's versioned `membershipPolicy` reference; duplicate registration and
unknown versions fail. Registered data is copied and deeply frozen. There are no
production membership entries in the shared foundation: each catalogue ticket owns its
complete approved table. The Mobility table (approved M1-M15, roles `prep`, `focused`,
`flow` and `finish`) lives in `data/mobility-membership.js`, loaded after the Generator.
Its eight new movements are family-only catalogue entries with no phase flags; the seven
existing ones keep their canonical flags. Neither Coach nor Generator supplies a
separate table, guessed exercise aliases or grants copied from saved data.

Each entry identifies one exact canonical `exerciseId` and family-specific `role`,
its allowed `protocols`, and reviewed `prescriptions`. Roles describe contextual
usage, independently of the exercise's global `mainRole` and Coach `sessionRole`.
Protocols come from the existing `GarageFitGenerator.MAIN_PROTOCOLS` vocabulary;
membership never relaxes a protocol's canonical exercise restrictions or validator.
An entry may set `requiresMovementRoom: true`; that is unavailable unless the
planning context explicitly confirms sufficient room. It does not add a space UI.

Each prescription is `{type, minValue, maxValue, secondsPerRep?}`. The type retains
canonical sidedness (`unilateral-` only for per-side exercises). Bounds are positive,
whole reps where appropriate, and cannot exceed the shared occurrence-target ceilings.
Canonical exercise prescriptions remain the defaults. A contextual mode or dose is
allowed only within an explicitly reviewed prescription range; intrinsic
`prescriptionModes` restrictions still apply. Timed work estimates its actual planned
seconds on each side. Rep work uses the canonical rep estimate, or a reviewed
`secondsPerRep` estimate (1–30 seconds); conversion from a timed default to reps
requires that pacing estimate. These are planned targets/estimates, never measured
reps, achieved loads or completion evidence.

Blocks carry a plain JSON `familyContext`:

```js
{
  workoutFamilyId: 'mobility-movement-quality', workoutFamilyVersion: 1,
  role: 'flow', difficulty: 'normal', excludedImpact: ['high'],
  bodyPositions: ['standing', 'floor'], movementRoom: false
}
```

Only family/version/role are required. Omitted difficulty is Normal; omitted
`excludedImpact` excludes high impact; omitted `bodyPositions` adds no position
restriction; omitted room confirmation is false. An explicit empty impact exclusion
list does not override Easy difficulty or protocol safety. Supplied malformed
constraints fail closed. Selected equipment remains an input to eligibility and Main
validation through their existing equipment arguments; a family grant cannot bypass it.

`getMembership(context, exerciseId)` resolves the central reviewed entry, including
after JSON round-trip. `generatedPhaseEligible(exercise, 'main', equipment,
difficulty, context)` applies that grant plus canonical equipment, difficulty, impact,
position and room checks. Other phases retain their original rules. A warm-up-only or
cool-down-only ID can therefore be explicitly authorised as family Main without
changing `generator`, `main`, preparation metadata or global catalogue validation.
Related variants receive no implicit membership.

`protocolCompatible(exercise, protocol, context)` additionally checks membership.
`validateFamilyBlock` rechecks the canonical catalogue and rejects modified exercise
copies. Main validation, normalisation, step resolution and estimation share that
check. Existing setup compatibility and protocol validators remain authoritative.
Within-family swaps must preserve the role's membership, canonical safety and every
occurrence target. Final family composition/quality revalidation remains the later
shared validator's responsibility.

Contextual targets use the existing `block.occurrenceTargets` contract from
[Workout protocols](WORKOUT_PROTOCOLS.md#shared-occurrence-targets). Pass
`{familyContext}` to `resolveOccurrenceTarget` when resolving them directly. Defaults
and null entries must also satisfy the registered ranges. Invalid/stale grants or
targets produce no executable steps, estimate zero, and fail normalisation instead
of silently reverting to a default. Normalisation copies the context and targets and
recomputes duration. Original catalogue objects and prescriptions are never rewritten.

The common preview/player consume the same resolved targets. Main exercise phases
carry the transient context so Session Tracker can validate permitted mode changes;
the context is not a new persisted workout-family identity/history field. Existing
variable-target evidence rules and saved record schemas remain unchanged. Without
an explicit family context, these seams retain the original behaviour and RNG use.

The foundation tests demonstrate shared rounds, supersets and intervals plus existing
advanced protocol compatibility, not specialist composition. Whole-session allocation,
exercise-sensitive recovery and sequential-flow characterisation belong to issue 05
(#181); no new protocol or player is introduced here.
