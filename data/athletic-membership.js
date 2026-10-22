(function (root) {
  // Reviewed Athletic Movement membership (approved A1-A8, A10-A12; issue #180).
  // Roles describe contextual usage within an Athletic session, independent of an exercise's
  // global phase flags: `footwork` (light stepping and direction change), `control`
  // (balance and controlled single-leg or coordination work) and `integrated` (whole-body
  // movement that joins footwork and control). Membership grants family Main eligibility only;
  // equipment, impact, difficulty, position and protocol safety are still enforced by the
  // Generator, and no catalogue entry or phase flag is changed. A9 (forward-back
  // acceleration and stop) and A13 (forward hop and stick) were deferred in v1 and are absent there;
  // membership v2 (#255) authorises them explicitly for composition v4.
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
  // Membership v2 (#255) extends v1 without altering it: eleven further movements and three existing
  // identities shared from elsewhere in the catalogue. Fourth item: lowest workout difficulty the
  // entry suits (`normal` excludes Easy; `hard` is Hard only, and high impact still needs the existing
  // Hard opt-in). Roles are only those the v4 composer actually draws on: hops and bounds are
  // integrated-only (control blocks are gentle balance circuits), and high impact is never a block edge.
  // [exerciseId, roles, requiresMovementRoom, minimumDifficulty]
  const ADDITIONS = [
    ['in-in-out-out-steps', ['footwork'], false],
    ['lateral-line-steps', ['footwork'], false],
    ['split-stance-step-switches', ['footwork', 'control'], false],
    ['clock-step-balance', ['control'], false],
    ['single-leg-hip-hinge-reach', ['control'], false, 'normal'],
    ['lateral-lunge-to-balance', ['control', 'integrated'], false, 'normal'],
    ['180-degree-step-turns', ['footwork'], false, 'normal'],
    ['lateral-shuffle-and-stop', ['footwork', 'integrated'], true, 'normal'],
    ['forward-back-acceleration-and-stop', ['footwork', 'integrated'], true, 'normal'],
    ['forward-hop-and-stick', ['integrated'], true, 'hard'],
    ['lateral-bound-and-stick', ['integrated'], true, 'hard'],
    ['fast-feet', ['footwork'], false],                 // reused: light, in-place conditioning footwork
    ['side-step-touches', ['control'], false],          // reused: light stepping and controlled recovery (finish, partner)
    ['cossack-squat', ['integrated'], false]            // reused: selective in-place lateral control
  ];
  function build(members, version) {
    const entries = [];
    for (const [exerciseId, roles, requiresMovementRoom, minimumDifficulty] of members) {
      const exercise = catalogue[exerciseId];
      if (!exercise) throw new Error('Unknown Athletic exercise: ' + exerciseId);
      const side = exercise.sidedness === 'per-side' ? 'per-side' : 'bilateral';
      // New landings (v2 additions) are short, quality-led efforts (at most fifteen seconds); every v1 entry,
      // including skater jumps, keeps its released bounds in both tables.
      const jump = version > 1 && ADDITIONS.some(item => item[0] === exerciseId) && exercise.impact === 'high' ? {type: side === 'per-side' ? 'unilateral-timed' : 'timed', minValue: 10, maxValue: 15} : JUMP_TIMED;
      const timed = exercise.impact === 'high' ? jump : TIMED[side];
      // Canonical rep-based drills keep reps as their default; reps are offered nowhere else.
      const prescriptions = exercise.prescription.type.includes('reps') ? [REPS[side], timed] : [timed];
      for (const role of roles) {
        const entry = {exerciseId, role, protocols: PROTOCOLS.slice(), prescriptions: JSON.parse(JSON.stringify(prescriptions))};
        if (requiresMovementRoom) entry.requiresMovementRoom = true;
        if (minimumDifficulty) entry.minimumDifficulty = minimumDifficulty;
        entries.push(entry);
      }
    }
    return entries;
  }
  families.registerMembershipPolicy({workoutFamilyId: 'athletic-movement', workoutFamilyVersion: 1, entries: build(MEMBERS, 1)});
  families.registerMembershipPolicy({workoutFamilyId: 'athletic-movement', workoutFamilyVersion: 4, entries: build(MEMBERS.concat(ADDITIONS), 2)});
})(typeof window !== 'undefined' ? window : globalThis);
