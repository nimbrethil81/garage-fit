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
