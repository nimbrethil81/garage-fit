(function (root) {
  // Reviewed Mobility & Movement Quality membership (approved M1-M15; issue #179).
  // Roles describe contextual usage within a Mobility flow, independent of an exercise's
  // global phase flags: `prep` (comfortable preparation), `focused` (joint-specific work),
  // `flow` (integrated movement) and `finish` (gentle finish). Membership grants family
  // Main eligibility only; equipment, impact, difficulty, position and protocol safety are
  // still enforced by the Generator, and no catalogue entry or phase flag is changed.
  // Load after js/workout-families.js and js/generator.js.
  const families = root.GarageFitWorkoutFamilies, generator = root.GarageFitGenerator;
  if (!families || !generator) throw new Error('Load js/workout-families.js and js/generator.js before data/mobility-membership.js.');
  // Sequential flows use rounds or a shared timed clock; canonical protocol rules still apply
  // (per-side work cannot use timed intervals). Mobility never pairs movements as supersets.
  const PROTOCOLS = ['rounds', 'timed_intervals'];
  const TIMED = {bilateral: {type: 'timed', minValue: 10, maxValue: 60}, 'per-side': {type: 'unilateral-timed', minValue: 10, maxValue: 45}};
  // exerciseId -> permitted roles (M-number in the issue). Sides come from canonical sidedness.
  const MEMBERS = [
    ['ninety-ninety-hip-switches', ['focused', 'flow']],        // M1
    ['thread-the-needle', ['focused', 'flow']],                 // M2
    ['kneeling-ankle-rocks', ['prep', 'focused']],              // M3
    ['worlds-greatest-stretch', ['flow']],                      // M4
    ['cossack-squat', ['flow']],                                // M5 (adapted)
    ['cat-cow', ['prep', 'finish']],                            // M6
    ['wall-angel', ['focused', 'finish']],                      // M7 (reused)
    ['adductor-rock-backs', ['focused']],                       // M8
    ['downward-upward-dog', ['flow', 'finish']],                // M9 (adapted)
    ['standing-hip-rotations', ['prep', 'focused']],            // M10
    ['hamstring-sweeps', ['prep', 'flow']],                     // M11 (reused)
    ['leg-swings-forward-back', ['prep']],                      // M12 (reused)
    ['leg-swings-side', ['prep']],                              // M13 (reused)
    ['squat-to-stand', ['prep', 'flow']],                       // M14
    ['trx-squat-overhead', ['prep', 'flow']]                    // M15 (adapted; TRX only)
  ];
  const catalogue = root.GarageFitData && root.GarageFitData.exercises;
  if (!catalogue) throw new Error('Load data/exercises.js before data/mobility-membership.js.');
  function build(members) {
    const entries = [];
    for (const [exerciseId, roles] of members) {
      const exercise = catalogue[exerciseId];
      if (!exercise) throw new Error('Unknown Mobility exercise: ' + exerciseId);
      const timed = exercise.sidedness === 'per-side' ? TIMED['per-side'] : TIMED.bilateral;
      // Canonical rep-based Cossack squat keeps reps as its default; reps are not offered elsewhere.
      const prescriptions = exercise.prescription.type.includes('reps')
        ? [{type: 'reps', minValue: 4, maxValue: 12}, timed] : [timed];
      for (const role of roles) entries.push({exerciseId, role, protocols: PROTOCOLS.slice(), prescriptions: JSON.parse(JSON.stringify(prescriptions))});
    }
    return entries;
  }
  // Membership v2 (#263, Mobility & Movement Quality v2 workstream 1): all fifteen v1 entries unchanged, plus
  // fifteen existing and four new identities. Membership is eligibility only; composition v2 (#264,
  // js/mobility-composer.js) selects from it; v3 is now current.
  // [exerciseId, roles, minimumDifficulty?, prescription override?]
  const GENTLE = {bilateral: {type: 'timed', minValue: 15, maxValue: 40}, 'per-side': {type: 'unilateral-timed', minValue: 15, maxValue: 40}};
  const ADDITIONS = [
    ['ankle-circles', ['prep', 'focused']],
    ['heel-toe-rocks', ['prep', 'focused']],
    ['shoulder-rolls', ['prep']],
    ['open-close-gates', ['prep']],
    ['standing-side-bends', ['prep', 'focused']],
    ['body-hoops', ['prep']],
    ['body-twists', ['prep', 'focused']],
    ['shallow-knee-bends', ['prep']],
    ['trx-lateral-weight-shift', ['prep', 'flow']],          // TRX required (canonical equipment)
    ['hip-flexor-arm-stretch', ['focused', 'finish']],       // static hold, kept canonical
    ['runners-stretch', ['focused'], 'normal'],              // plank-bearing set-up: not offered at Easy
    ['childs-pose', ['finish']],
    ['lying-torso-twist', ['finish']],
    ['glute-stretch', ['finish']],
    ['chest-opener', ['finish']],
    // New canonical movements; bounds follow their reviewed doses.
    ['quadruped-thoracic-rotation', ['focused', 'flow'], undefined, {minValue: 15, maxValue: 25}],
    ['supported-squat-rocks', ['focused', 'flow'], undefined, {minValue: 20, maxValue: 30}], // TRX required (anchored support)
    ['controlled-shoulder-rotations', ['prep', 'focused'], undefined, {minValue: 15, maxValue: 25}],
    ['half-kneeling-hip-flexor-rocks-with-reach', ['focused', 'flow'], undefined, {minValue: 15, maxValue: 25}]
  ];
  function buildV2() {
    const entries = build(MEMBERS);
    for (const [exerciseId, roles, minimumDifficulty, bounds] of ADDITIONS) {
      const exercise = catalogue[exerciseId];
      if (!exercise) throw new Error('Unknown Mobility exercise: ' + exerciseId);
      const side = exercise.sidedness === 'per-side' ? 'per-side' : 'bilateral';
      const target = {...GENTLE[side], ...(bounds || {})};
      for (const role of roles) {
        const entry = {exerciseId, role, protocols: PROTOCOLS.slice(), prescriptions: [JSON.parse(JSON.stringify(target))]};
        if (minimumDifficulty) entry.minimumDifficulty = minimumDifficulty;
        entries.push(entry);
      }
    }
    return entries;
  }
  // V3 adds M25's fifteen canonical movements and six existing identities. Prior entries stay frozen.
  // Doses are per occurrence (per side where canonical sidedness requires it).
  const V3_ADDITIONS = [
    ['standing-calf-stretch', ['focused','finish'], 20,30],
    ['bent-knee-calf-stretch', ['focused','finish'], 20,30],
    ['seated-ninety-ninety-hip-lift-offs', ['focused'], 15,25, 'normal'],
    ['supine-hamstring-stretch', ['focused','finish'], 20,30],
    ['butterfly-stretch', ['focused','finish'], 20,30],
    ['standing-hinge-and-reach', ['prep','flow'], 20,35],
    ['side-lying-open-books', ['focused','flow'], 20,30],
    ['seated-thoracic-extension', ['focused'], 20,30],
    ['standing-wall-slides', ['focused'], 20,35],
    ['standing-lat-stretch', ['focused','finish'], 20,30],
    ['quadruped-wrist-rocks', ['prep','focused'], 15,25],
    ['downward-facing-dog', ['focused','flow'], 15,30],
    ['upward-facing-dog', ['focused','flow'], 10,20, 'normal'],
    ['low-cobra-pose', ['focused','finish'], 10,25],
    ['extended-puppy-pose', ['focused','finish'], 15,30],
    ['kneeling-hamstring', ['focused','finish'], 20,30],
    ['inside-thigh-stretch', ['focused','finish'], 20,30],
    ['frog-stretch', ['focused'], 15,30],
    ['plank-calf-stretch', ['focused','flow'], 15,30, 'normal'],
    ['side-stretch', ['focused','finish'], 20,30],
    ['arm-across-pull', ['focused','finish'], 20,30]
  ];
  function buildV3() {
    return buildV2().concat(V3_ADDITIONS.flatMap(([exerciseId,roles,minValue,maxValue,minimumDifficulty])=>roles.map(role=>({
      exerciseId,role,protocols:PROTOCOLS.slice(),
      prescriptions:[{type:catalogue[exerciseId].sidedness==='per-side'?'unilateral-timed':'timed',minValue,maxValue}],
      ...(minimumDifficulty?{minimumDifficulty}:{})
    }))));
  }
  families.registerMembershipPolicy({workoutFamilyId: 'mobility-movement-quality', workoutFamilyVersion: 1, entries: build(MEMBERS)});
  families.registerMembershipPolicy({workoutFamilyId: 'mobility-movement-quality', workoutFamilyVersion: 2, entries: buildV2()});
  families.registerMembershipPolicy({workoutFamilyId: 'mobility-movement-quality', workoutFamilyVersion: 3, entries: buildV3()});
})(typeof window !== 'undefined' ? window : globalThis);
