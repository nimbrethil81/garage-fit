(function (root) {
  // Released definitions are immutable. Material policy changes get a new version.
  // Production values approved in issue #58, comments 6120383745 and the
  // subsequent General Strength production-parameter approval.
  const anchor = (pattern, exerciseIds) => ({requirementId: 'anchor-'+pattern, pattern,
    role: 'primary', importance: 'required', exerciseIds, targetSets: 2,
    prescriptionMode: 'reps', target: {type: 'reps', minReps: 6, maxReps: 6},
    allowedProtocols: ['rounds'], progressionIntent: 'Confirm both sets before adding reps'});
  const strength = {
    schemaVersion: 1, id: 'general-strength-4w', version: 1, type: 'general-strength',
    name: '4-Week General Strength', objective: 'Build whole-body strength', openEnded: false,
    nominalDurationDays: 28, supportedDurations: [20, 30, 45],
    recommendedFrequency: {minSessionsPerWeek: 2, maxSessionsPerWeek: 3},
    coverageTargets: {windowDays: 7, patterns: {squat: 2, hinge: 2, lunge: 2, push: 2, pull: 2, core: 2, carry: 2}},
    doseTargets: {meaningfulRule: 'any-performed-main-work', sections: ['main']},
    anchorSelectionPolicy: {strengthOnly: true, requirements: [
      anchor('squat', ['goblet-squat','kettlebell-goblet-squat','dumbbell-front-squat','barbell-front-squat','banded-squat','trx-squat','air-squat']),
      anchor('push', ['dumbbell-floor-press','kettlebell-floor-press','barbell-floor-press','band-chest-press','trx-chest-press','push-up','incline-push-up']),
      anchor('pull', ['dumbbell-bent-over-row','barbell-bent-over-row','single-arm-dumbbell-row','trx-row','band-row','pull-up','chin-up'])
    ]},
    progressionPolicy: {strategy: 'double-progression', minReps: 6, maxReps: 10, repIncrement: 1,
      minimumRepsImprovement: null, minimumLoadImprovement: null, minimumSecondsImprovement: null},
    sessionTemplate: {duration: 30, workoutStyle: 'strength', difficulty: 'normal', bodyFocus: 'full-body', variationPreference: 'varied'},
    sequencingRules: {minimumRecoveryHours: 0},
    shortSessionPolicy: {preservePreparation: true, preserveRest: true,
      tiers: [{maxDurationMinutes: 20, primaryPriorityLimit: 4, primaryPreferredLimit: 0, accessoryLimit: 0, keepSecondaryPriorities: false}]},
    // The approval permits definition-driven maintenance reductions. Keep the
    // same challenge/identities, with one set and a lower frequency/coverage floor.
    maintenancePolicy: {frequency: {minSessionsPerWeek: 1, maxSessionsPerWeek: 2}, coverageMultiplier: 0.5, maximumDurationMinutes: 20,
      keepAccessories: false, allowProgression: false, anchorTargetOverrides: {
        'anchor-squat': {targetSets: 1}, 'anchor-push': {targetSets: 1}, 'anchor-pull': {targetSets: 1}}},
    missedSessionPolicy: {strategy: 'recompute-no-debt'},
    feasibilityRequirements: {minimumDurationMinutes: 20, requiredPatterns: ['squat','hinge','lunge','push','pull','core','carry']},
    completionCriteria: {minimumMeaningfulSessions: null, requireNominalDuration: false, blockMeaningfulSessionTarget: 8, explicitFinish: true}
  };
  function freeze(value) { Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); }); return Object.freeze(value); }
  root.GarageFitData = root.GarageFitData || {};
  root.GarageFitData.programmes = freeze({'general-strength-4w': {1: strength}});
})(typeof window !== 'undefined' ? window : globalThis);
