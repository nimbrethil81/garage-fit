(function (root) {
  // Reviewed Athletic Movement membership (approved A1-A8, A10-A12; issue #180).
  // Roles describe contextual usage within an Athletic session, independent of an exercise's
  // global phase flags: `footwork` (light stepping and direction change), `control`
  // (balance and controlled single-leg or coordination work) and `integrated` (whole-body
  // movement that joins footwork and control). Membership grants family Main eligibility only;
  // equipment, impact, difficulty, position and protocol safety are still enforced by the
  // Generator, and no catalogue entry or phase flag is changed. A9 (forward-backward
  // acceleration and stop) and A13 (forward hop and stick) are deferred and deliberately absent.
  // Drills that travel are marked `requiresMovementRoom` and are never assumed safe in a small
  // space; the rest are in-place and ordinarily viable. High-impact skater jumps stay excluded
  // unless a Hard-difficulty request explicitly lifts the default high-impact exclusion.
  // Load after js/workout-families.js and js/generator.js.
  const families = root.GarageFitWorkoutFamilies, generator = root.GarageFitGenerator;
  if (!families || !generator) throw new Error('Load js/workout-families.js and js/generator.js before data/athletic-membership.js.');
  // Drills run as sequential rounds or a shared timed clock; canonical protocol rules still apply
  // (per-side work cannot use timed intervals). Athletic drills are never paired as supersets.
  const PROTOCOLS = ['rounds', 'timed_intervals'];
  // Bounded drill timing. Bounds contain each canonical default; no long uncontrolled series.
  const TIMED = {bilateral: {type: 'timed', minValue: 10, maxValue: 40}, 'per-side': {type: 'unilateral-timed', minValue: 10, maxValue: 30}};
  const JUMP_TIMED = {type: 'timed', minValue: 10, maxValue: 30};
  const REPS = {bilateral: {type: 'reps', minValue: 4, maxValue: 12}, 'per-side': {type: 'unilateral-reps', minValue: 4, maxValue: 10}};
  // [exerciseId, roles, requiresMovementRoom] (A-number in the issue).
  const MEMBERS = [
    ['lateral-shuffle', ['footwork', 'integrated'], true],              // A1
    ['skater-jumps', ['integrated'], true],                             // A2 (reused; high impact, Hard opt-in)
    ['single-leg-balance-reach', ['control'], false],                   // A3
    ['bear-crawl', ['control', 'integrated'], true],                    // A4 (adapted)
    ['forward-back-line-steps', ['footwork', 'control'], false],        // A5
    ['reverse-lunge-knee-drive', ['control', 'integrated'], false],     // A6 (reused)
    ['quarter-turn-pivot-steps', ['footwork', 'control'], false],       // A7
    ['lateral-step-and-stick', ['footwork', 'control'], false],         // A8
    ['alternating-lateral-lunge', ['integrated'], false],               // A10 (reused; selective)
    ['grapevine-cross-steps', ['footwork', 'integrated'], true],        // A11
    ['knee-to-opposite-elbow', ['control'], false]                      // A12 (reused; selective)
  ];
  const catalogue = root.GarageFitData && root.GarageFitData.exercises;
  if (!catalogue) throw new Error('Load data/exercises.js before data/athletic-membership.js.');
  const entries = [];
  for (const [exerciseId, roles, requiresMovementRoom] of MEMBERS) {
    const exercise = catalogue[exerciseId];
    if (!exercise) throw new Error('Unknown Athletic exercise: ' + exerciseId);
    const side = exercise.sidedness === 'per-side' ? 'per-side' : 'bilateral';
    const timed = exercise.impact === 'high' ? JUMP_TIMED : TIMED[side];
    // Canonical rep-based drills keep reps as their default; reps are offered nowhere else.
    const prescriptions = exercise.prescription.type.includes('reps') ? [REPS[side], timed] : [timed];
    for (const role of roles) {
      const entry = {exerciseId, role, protocols: PROTOCOLS.slice(), prescriptions: JSON.parse(JSON.stringify(prescriptions))};
      if (requiresMovementRoom) entry.requiresMovementRoom = true;
      entries.push(entry);
    }
  }
  families.registerMembershipPolicy({workoutFamilyId: 'athletic-movement', workoutFamilyVersion: 1, entries});
})(typeof window !== 'undefined' ? window : globalThis);
