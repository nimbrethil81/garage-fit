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
  // Production parameters approved in #61, issuecomment-6122051820.
  const directAnchor = (action, pattern) => ({requirementId: 'anchor-'+action, directElbowAction: action, pattern,
    role: 'primary', importance: 'required', targetSets: 3, prescriptionMode: 'reps',
    target: {type: 'reps', minReps: 8, maxReps: 8}, allowedProtocols: ['rounds'],
    progressionIntent: 'Confirm all three sets before adding reps'});
  const arms = {
    schemaVersion: 1, id: 'build-arms', version: 1, type: 'build-arms',
    name: 'Build Arms', objective: 'Build arms while maintaining whole-body training', openEnded: true,
    supportedDurations: [20, 30, 45], recommendedFrequency: {minSessionsPerWeek: 2, maxSessionsPerWeek: 3, aimSessionsPerWeek: 3},
    anchorSelectionPolicy: {requirements: [directAnchor('flexion','pull'), directAnchor('extension','push')]},
    doseTargets: {meaningfulRule: 'any-performed-main-work', sections: ['main'], windowDays: 7,
      directElbowActions: {flexion: 9, extension: 9}},
    coverageTargets: {windowDays: 7, patterns: {squat: 1, hinge: 1, lunge: 1, push: 1, pull: 1, core: 1, carry: 1},
      excludeDirectArmWork: true},
    progressionPolicy: {strategy: 'double-progression', minReps: 8, maxReps: 12, repIncrement: 1,
      allowConfirmedSetup: true, numericLoadEquipment: ['dumbbells','kettlebell','barbell'],
      numericResistanceIntent: 'Use the next heavier available load', setupResistanceIntent: 'Ready for more resistance',
      minimumRepsImprovement: null, minimumLoadImprovement: null, minimumSecondsImprovement: null},
    sessionTemplate: {duration: 30, workoutStyle: 'strength', difficulty: 'normal', bodyFocus: 'full-body', variationPreference: 'varied'},
    sequencingRules: {minimumRecoveryHours: 0},
    shortSessionPolicy: {preservePreparation: true, preserveRest: true,
      tiers: [{maxDurationMinutes: 20, primaryPriorityLimit: 0, primaryPreferredLimit: 0, accessoryLimit: 0, keepSecondaryPriorities: false}]},
    // Mode changes would need separately approved reductions. This objective uses
    // the common pause/resume/finish controls without inventing another mode.
    maintenancePolicy: {frequency: {minSessionsPerWeek: 2, maxSessionsPerWeek: 3}, coverageMultiplier: 1,
      keepAccessories: true, allowProgression: true, anchorTargetOverrides: {}},
    missedSessionPolicy: {strategy: 'recompute-no-debt'},
    feasibilityRequirements: {minimumDurationMinutes: 20, requiredPatterns: []},
    completionCriteria: {minimumMeaningfulSessions: null, requireNominalDuration: false, explicitFinish: true},
    supportsMaintenanceMode: false
  };
  function freeze(value) { Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); }); return Object.freeze(value); }
  root.GarageFitData = root.GarageFitData || {};
  root.GarageFitData.programmes = freeze({'general-strength-4w': {1: strength}, 'build-arms': {1: arms}});
})(typeof window !== 'undefined' ? window : globalThis);
