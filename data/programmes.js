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
  // #146: rings are optional equipment. New starts may use ring rows/pull-ups/chin-ups
  // and ring press-ups as comparable rep-based anchors. They are appended after the
  // released choices, so owners of other kit keep their v1 default anchors; rings
  // become the default only when no earlier choice is available. Timed support holds,
  // dips and supporting-role ring work are not anchors. Saved v1 programmes keep v1.
  const strengthRings = JSON.parse(JSON.stringify(strength));
  strengthRings.version = 2;
  strengthRings.anchorSelectionPolicy.requirements.find(item => item.pattern === 'push').exerciseIds.push('ring-press-up');
  strengthRings.anchorSelectionPolicy.requirements.find(item => item.pattern === 'pull').exerciseIds.push('ring-row','ring-pull-up','ring-chin-up');
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
  // Tennis keeps programme anchors separate from the hard subset of today's work.
  const tennisAnchor = (roleId, pattern, exerciseIds, patterns = [pattern]) => ({
    ...anchor(pattern, exerciseIds), requirementId: 'tennis-anchor-'+roleId, roleId, patterns,
    progressionIntent: 'Confirm both sets; leave about 2 reps in reserve'
  });
  const tennisRole = (id, label, capabilities, anchorLimits) => ({id, label, capabilities, anchorLimits});
  const tennis = {
    schemaVersion: 1, id: 'tennis-conditioning', version: 1, type: 'tennis-conditioning',
    name: 'Tennis Conditioning', objective: 'Build balanced conditioning for tennis', openEnded: true,
    supportedDurations: [10,15,20,30,45],
    recommendedFrequency: {minSessionsPerWeek: 1, maxSessionsPerWeek: 3, aimSessionsPerWeek: 2},
    defaultProgrammeSettings: {sportId: 'tennis', weeklyCoachFrequency: 2, focus: 'balanced'},
    sportPolicy: {sportId: 'tennis', version: 1},
    preparationTimingReserveSeconds: 30,
    coverageTargets: {windowDays: 14, patterns: {lunge: 1, squat: 1, hinge: 1, push: 1, pull: 1, core: 1}},
    doseTargets: {meaningfulRule: 'any-performed-main-work', sections: ['main']},
    anchorSelectionPolicy: {strengthOnly: true, requirements: [
      tennisAnchor('knee','lunge',['dumbbell-reverse-lunge','trx-split-squat','reverse-lunge','goblet-squat','kettlebell-goblet-squat','air-squat'],['lunge','squat']),
      tennisAnchor('hinge','hinge',['dumbbell-romanian-deadlift','kettlebell-deadlift','trx-single-leg-deadlift','band-romanian-deadlift','barbell-romanian-deadlift','glute-bridge']),
      tennisAnchor('push','push',['dumbbell-floor-press','kettlebell-floor-press','trx-chest-press','band-chest-press','push-up']),
      tennisAnchor('pull','pull',['dumbbell-bent-over-row','trx-row','band-row','pull-up','chin-up'])
    ]},
    progressionPolicy: {strategy: 'double-progression', minReps: 6, maxReps: 10, repIncrement: 1,
      allowConfirmedSetup: true, numericLoadEquipment: ['dumbbells','kettlebell','barbell'],
      numericResistanceIntent: 'Use the next heavier available load', setupResistanceIntent: 'Ready for more resistance',
      minimumRepsImprovement: null, minimumLoadImprovement: null, minimumSecondsImprovement: null},
    // All anchor sessions retain the same rounds/rest conditions for comparison.
    sessionTemplate: {duration: 30, workoutStyle: 'strength', difficulty: 'normal', bodyFocus: 'full-body', variationPreference: 'varied'},
    sequencingRules: {minimumRecoveryHours: 0, repsInReserve: 2},
    sessionRoles: {
      1: [tennisRole('full-body','Full-body', ['lower-body','upper-body','lateral-movement','trunk','power','endurance'],[1,2,3,4,4])],
      2: [tennisRole('strength-stability','Strength and stability',['lower-body','upper-body','trunk','lateral-movement'],[1,2,3,4,4]),
        tennisRole('movement-conditioning','Movement and athletic conditioning',['lateral-movement','trunk','endurance','power','upper-body'],[1,1,1,2,2])],
      3: [tennisRole('strength','Strength',['lower-body','upper-body','trunk'],[1,2,3,4,4]),
        tennisRole('movement-power','Movement and power',['lateral-movement','power','trunk','lower-body'],[1,1,1,1,2]),
        tennisRole('conditioning-resilience','Conditioning and resilience',['endurance','trunk','upper-body','lateral-movement'],[0,0,0,0,0])]
    },
    shortSessionPolicy: {preservePreparation: true, preserveRest: true, tiers: []},
    maintenancePolicy: {frequency: {minSessionsPerWeek: 1, maxSessionsPerWeek: 3}, coverageMultiplier: 1,
      keepAccessories: true, allowProgression: false, anchorTargetOverrides: {}},
    missedSessionPolicy: {strategy: 'recompute-no-debt'},
    feasibilityRequirements: {minimumDurationMinutes: 10, requiredPatterns: []},
    completionCriteria: {minimumMeaningfulSessions: null, requireNominalDuration: false, explicitFinish: true},
    supportsMaintenanceMode: false
  };
  // Version 1 stays available for saved programmes. These are transparent pilot
  // preferences, not a fatigue score or a claim of physiological recovery.
  const tennisContext = {...JSON.parse(JSON.stringify(tennis)), version: 2,
    contextPolicy: {nearbyDays: 1, recentReportDays: 7, lighterDurationMinutes: 20,
      tiredDurationMinutes: 15, lighterAnchorLimit: 1, tiredAnchorSets: 1,
      lighterImpact: ['low','medium'], homeSmallSpace: true}};
  const tennisDevelopment = {...JSON.parse(JSON.stringify(tennisContext)), version: 3,
    phasePolicy: {minimumDevelopmentDays: 21, minimumDevelopmentSessions: 6,
      consolidationSessions: 1, consolidationAnchorSets: 1},
    sportReviewPolicy: {minimumDays: 28, minimumSessions: 4}};
  const tennisEvents = {...JSON.parse(JSON.stringify(tennisDevelopment)), version: 4,
    eventPolicy: {buildMinimumDays: 15, refineMinimumDays: 8, reducedMinimumDays: 3,
      reducedAnchorSets: 1, finalAnchorLimit: 0, finalDurationMinutes: 15, finalImpact: ['low']}};
  // The pilot found that forgetting old anchor work at the coverage boundary
  // could starve a never-performed anchor in weekly short sessions. Saved v1–v4
  // retain their scheduler; new programmes break equal recent-dose ties using
  // actual earlier work from the bounded performed history.
  const tennisPilot = {...JSON.parse(JSON.stringify(tennisEvents)), version: 5,
    anchorRotationPolicy: {tieBreak: 'last-performed'}};
  const tennisMovement = {...JSON.parse(JSON.stringify(tennisPilot)), version: 6,
    sportPolicy: {sportId: 'tennis', version: 2},
    roleCompositionPolicy: {roles: {
      'movement-conditioning': ['lateral-movement','trunk','endurance','power'],
      'movement-power': ['lateral-movement','trunk','power'],
      'conditioning-resilience': ['lateral-movement','trunk','endurance']
    }}};
  // #146: v7 pins Tennis capability mapping v3, which credits the reviewed ring
  // row/press-up as push-pull work and the ring face pull as shoulder support. Ring
  // anchors are appended after the released choices; pull-ups, dips, holds and other
  // stability-heavy ring work are deliberately not Tennis anchors.
  const tennisRings = {...JSON.parse(JSON.stringify(tennisMovement)), version: 7,
    sportPolicy: {sportId: 'tennis', version: 3}};
  tennisRings.anchorSelectionPolicy.requirements.find(item => item.roleId === 'push').exerciseIds.push('ring-press-up');
  tennisRings.anchorSelectionPolicy.requirements.find(item => item.roleId === 'pull').exerciseIds.push('ring-row');
  // #255 maps the shared single-leg hinge and lateral-lunge-to-balance drills (Tennis capability mapping v4)
  // so movement roles can draw on them. Programme v8 changes only the pinned mapping; v1-v7 are unchanged
  // and in-progress instances keep their saved definition.
  const tennisMovementDrills = {...JSON.parse(JSON.stringify(tennisRings)), version: 8,
    sportPolicy: {sportId: 'tennis', version: 4}};
  // #286: keep released policies immutable. Normal movement roles use the shared
  // staged Athletic composer; constrained days retain the conservative Tennis path.
  const tennisAthletic = {...JSON.parse(JSON.stringify(tennisMovementDrills)), version: 9,
    sportPolicy: {sportId: 'tennis', version: 5},
    movementFamilyPolicy: {workoutFamilyId: 'athletic-movement', workoutFamilyVersion: 5}};
  Object.values(tennisAthletic.sessionRoles).flat().forEach(role => {
    role.anchorLimits = tennisAthletic.roleCompositionPolicy.roles[role.id]
      ? [0,0,0,0,0] : [1,1,2,2,3];
  });
  // #190 approved General Fitness Decisions 1–8: open-ended and anchor-free. Each session
  // chooses an intended workout family from rolling performed training effects across
  // GarageFit sources (strength and conditioning foundations first), adapts to recent
  // attendance without debt, and is built by the shared family composers and gate.
  // Weights/penalties are transparent planning preferences, not a fitness score.
  const fitnessFamily = (workoutFamilyId, effects, demanding, repeatable = false) => ({workoutFamilyId, workoutFamilyVersion: 1, effects, demanding, repeatable});
  const generalFitness = {
    schemaVersion: 1, id: 'general-fitness', version: 1, type: 'general-fitness',
    name: 'General Fitness', objective: 'Build balanced everyday fitness without fixed anchors', openEnded: true,
    supportedDurations: [10, 15, 20, 30, 45],
    recommendedFrequency: {minSessionsPerWeek: 2, maxSessionsPerWeek: 5},
    coverageTargets: {windowDays: 28, includeCrossSourceHistory: true},
    doseTargets: {meaningfulRule: 'any-performed-main-work', sections: ['main']},
    familyBalancePolicy: {
      families: [
        fitnessFamily('strength-control', {strength: 1}, true, true),
        fitnessFamily('cardio-conditioning', {conditioning: 1}, true),
        fitnessFamily('full-body-challenges', {challenge: 0.5, strength: 0.25, conditioning: 0.25}, true),
        fitnessFamily('athletic-movement', {athletic: 1}, false),
        fitnessFamily('core-stability', {core: 1}, false),
        fitnessFamily('mobility-movement-quality', {mobility: 1}, false)
      ],
      effectWeights: {
        lowAttendance: {strength: 3, conditioning: 3, challenge: 0.5, athletic: 1, core: 1, mobility: 1},
        regularAttendance: {strength: 2, conditioning: 2, challenge: 0.5, athletic: 1, core: 1, mobility: 1}
      },
      regularAttendanceSessionsPerWeek: 3, attendanceWindowDays: 14
    },
    varietyPolicy: {recentSessions: 3, repeatPreviousPenalty: 1, repeatableRepeatPenalty: 0.35, recentRepeatPenalty: 0.25, maximumConsecutiveRepeatable: 2},
    recoveryPolicy: {recentHours: 24, demandingPenalty: 1.5, reportedIntensities: ['hard'], reportedDays: 1},
    externalActivityPolicy: {typicalMobilityWeightPerSession: 0.25, maximumTypicalMobilityWeight: 0.5},
    sessionTemplate: {duration: 30, difficulty: 'normal', bodyFocus: 'full-body'},
    sequencingRules: {minimumRecoveryHours: 0},
    missedSessionPolicy: {strategy: 'recompute-no-debt'},
    feasibilityRequirements: {minimumDurationMinutes: 10, requiredPatterns: []},
    completionCriteria: {minimumMeaningfulSessions: null, requireNominalDuration: false, explicitFinish: true},
    supportsMaintenanceMode: false
  };
  // #192 (approved Decision 7 C): General Fitness v2 adds occasional, optional embedded comparable
  // benchmarks to v1's unchanged scheduling; saved v1 instances stay pinned. A small reviewed set of
  // unloaded, one-set rep measurements is offered first in a suitable Strength & Control session no
  // more than about every four weeks, never on Easy or recently demanding days, and always skippable
  // with no debt. `setupId` is the explicit unloaded-setup identity the user confirms when recording.
  const generalFitnessBenchmarks = {...JSON.parse(JSON.stringify(generalFitness)), version: 2,
    benchmarkPolicy: {
      workoutFamilyId: 'strength-control', workoutFamilyVersion: 1,
      minimumIntervalDays: 28, minimumMeaningfulSessions: 1, minimumDurationMinutes: 20, exerciseRestSeconds: 30,
      benchmarks: [
        {benchmarkId: 'push-up', exerciseId: 'push-up', setupId: 'bodyweight', capability: 'push'},
        {benchmarkId: 'air-squat', exerciseId: 'air-squat', setupId: 'bodyweight', capability: 'squat'},
        {benchmarkId: 'leg-raises', exerciseId: 'leg-raises', setupId: 'bodyweight', capability: 'core'}
      ],
      consistencyWeeks: 4
    }};
  function freeze(value) { Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); }); return Object.freeze(value); }
  root.GarageFitData = root.GarageFitData || {};
  root.GarageFitData.programmes = freeze({'general-fitness': {1: generalFitness, 2: generalFitnessBenchmarks}, 'general-strength-4w': {1: strength, 2: strengthRings}, 'build-arms': {1: arms}, 'tennis-conditioning': {1: tennis, 2: tennisContext, 3: tennisDevelopment, 4: tennisEvents, 5: tennisPilot, 6: tennisMovement, 7: tennisRings, 8: tennisMovementDrills, 9: tennisAthletic}});
})(typeof window !== 'undefined' ? window : globalThis);
