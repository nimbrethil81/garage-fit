// Deliberately fake, explicit test parameters. Never ship this as a user programme.
const {sessionResult} = require('./coach-fixtures.js');
const clone = value => JSON.parse(JSON.stringify(value));
const NOW = '2026-10-01T08:00:00Z';
const KIT = ['kettlebell','dumbbells','pullup-bar'];
function definition(overrides = {}) {
  return {
    schemaVersion: 1, id: 'test-only-strength', version: 3, type: 'general-strength', objective: 'test-whole-body-strength',
    nominalDurationDays: 28, openEnded: false,
    recommendedFrequency: {minSessionsPerWeek: 2, maxSessionsPerWeek: 3},
    coverageTargets: {windowDays: 7, patterns: {squat: 2, hinge: 2, lunge: 2, push: 2, pull: 2, core: 2, carry: 2}, bodyRegions: {upper: 2, lower: 2, core: 2}},
    doseTargets: {meaningfulExposure: 1, sections: ['main']},
    anchorSelectionPolicy: {requirements: [
      {requirementId: 'anchor-squat', pattern: 'squat', role: 'primary', importance: 'required', exerciseIds: ['goblet-squat','kettlebell-goblet-squat'],
        targetSets: 2, prescriptionMode: 'reps', target: {type: 'reps', minReps: 6, maxReps: 8}, suggestedLoad: 16, loadUnit: 'kg', loadInterpretation: 'total', allowedProtocols: ['rounds'], progressionIntent: 'test-add-reps'},
      {requirementId: 'anchor-row', pattern: 'pull', role: 'primary', importance: 'preferred', exerciseIds: ['dumbbell-bent-over-row'],
        targetSets: 2, prescriptionMode: 'reps', target: {type: 'reps', minReps: 6, maxReps: 8}, allowedProtocols: ['rounds']},
      {requirementId: 'anchor-core', pattern: 'core', role: 'accessory', importance: 'preferred', exerciseIds: ['plank'],
        targetSets: 2, prescriptionMode: 'time', target: {type: 'timed', seconds: 30}, allowedProtocols: ['rounds']}
    ]},
    progressionPolicy: {minimumRepsImprovement: 1, minimumLoadImprovement: 2, minimumSecondsImprovement: 5},
    sequencingRules: {minimumRecoveryHours: 24},
    shortSessionPolicy: {preservePreparation: true, preserveRest: true,
      tiers: [{maxDurationMinutes: 15, primaryPriorityLimit: 2, primaryPreferredLimit: 1, accessoryLimit: 0, keepSecondaryPriorities: false}]},
    maintenancePolicy: {frequency: {minSessionsPerWeek: 1, maxSessionsPerWeek: 2}, coverageMultiplier: 0.5,
      keepAccessories: false, allowProgression: false, anchorTargetOverrides: {'anchor-squat': {targetSets: 1}}},
    missedSessionPolicy: {strategy: 'recompute-no-debt'},
    feasibilityRequirements: {minimumDurationMinutes: 10, requiredPatterns: ['squat','hinge','lunge','push','pull','core','carry']},
    completionCriteria: {minimumMeaningfulSessions: 8, requireNominalDuration: true},
    sessionTemplate: {duration: 20, workoutStyle: 'strength', difficulty: 'normal', bodyFocus: 'full-body', variationPreference: 'familiar'},
    ...clone(overrides)
  };
}
// Test-only opt-in: assisted ring anchors with reviewed variation edges. The thresholds
// are fixture parameters, not approved production values.
function ringsDefinition(overrides = {}) {
  const requirement = (requirementId, exerciseIds, timed) => ({requirementId, pattern: 'push', role: 'primary', importance: 'required', exerciseIds,
    targetSets: 2, prescriptionMode: timed ? 'time' : 'reps', target: timed ? {type: 'timed', seconds: 20} : {type: 'reps', minReps: 8, maxReps: 8},
    allowedProtocols: ['rounds'], progressionIntent: timed ? 'Hold steady for the full time' : 'Confirm both sets before adding reps'});
  return definition({id: 'test-only-rings', version: 1, name: 'Test rings', openEnded: true,
    supportedDurations: [20, 30, 45],
    coverageTargets: {windowDays: 7, patterns: {push: 1, pull: 1, core: 1}},
    doseTargets: {meaningfulRule: 'any-performed-main-work', sections: ['main']},
    anchorSelectionPolicy: {requirements: [requirement('anchor-dip', ['foot-assisted-ring-dip','ring-dip']),
      requirement('anchor-support', ['foot-assisted-ring-support-hold','ring-support-hold'], true)]},
    progressionPolicy: {strategy: 'double-progression', minReps: 6, maxReps: 10, repIncrement: 1,
      minimumRepsImprovement: null, minimumLoadImprovement: null, minimumSecondsImprovement: null},
    sequencingRules: {minimumRecoveryHours: 0},
    shortSessionPolicy: {preservePreparation: true, preserveRest: true, tiers: []},
    maintenancePolicy: {frequency: {minSessionsPerWeek: 1, maxSessionsPerWeek: 2}, coverageMultiplier: 0.5,
      keepAccessories: true, allowProgression: false, anchorTargetOverrides: {}},
    feasibilityRequirements: {minimumDurationMinutes: 20, requiredPatterns: ['push','pull']},
    completionCriteria: {minimumMeaningfulSessions: null, requireNominalDuration: false},
    sessionTemplate: {duration: 30, workoutStyle: 'strength', difficulty: 'normal', bodyFocus: 'upper', variationPreference: 'varied'},
    variationProgressionPolicy: {edges: [
      {edgeId: 'assisted-ring-dip-to-ring-dip', requirementId: 'anchor-dip', fromExerciseId: 'foot-assisted-ring-dip', toExerciseId: 'ring-dip',
        evidence: {consecutiveSessions: 3, minimumRepsPerSet: 10}, repromptAfterSessions: 3,
        startingTarget: {target: {type: 'reps', minReps: 3, maxReps: 3}, progressionIntent: 'New exercise: build steady reps'}},
      {edgeId: 'assisted-ring-support-to-ring-support', requirementId: 'anchor-support', fromExerciseId: 'foot-assisted-ring-support-hold', toExerciseId: 'ring-support-hold',
        evidence: {consecutiveSessions: 3, minimumSecondsPerSet: 20}, repromptAfterSessions: 2,
        startingTarget: {target: {type: 'timed', seconds: 10}}}
    ]},
    ...clone(overrides)});
}
// A Coach result for one stable ring anchor: two planned rounds with explicit rest
// conditions. values are actual reps (or seconds when timed); null stays unknown.
function ringResult(id, endedAt, options = {}) {
  const {requirementId = 'anchor-dip', exerciseId = 'foot-assisted-ring-dip', performedExerciseId = exerciseId, timed = false,
    planned = timed ? 20 : 8, values = [10, 10], status = 'completed', overrides = [], conditions = {exerciseRestSeconds: 20, roundRestSeconds: 60},
    side = null, programmeInstanceId = 'rings-instance'} = options;
  const plannedWork = values.map((value, index) => ({occurrenceId: id+'-main-'+(index+1), exerciseId, requirementId, section: 'main', blockIndex: 0,
    prescription: {type: timed ? 'timed' : 'reps', timed, seconds: timed ? planned : null, reps: timed ? null : planned, protocol: 'rounds',
      ...(side === 'omit' ? {} : {side}), protocolConditions: clone(conditions), round: index+1}}));
  return sessionResult({sessionResultId: id, programmeInstanceId, prescriptionId: 'rx-'+id, workoutId: 'workout-'+id,
    generatedAt: endedAt, startedAt: endedAt, endedAt, actualDurationSeconds: 1200, overrides: clone(overrides), plannedWork,
    performedWork: plannedWork.map((work, index) => ({occurrenceId: work.occurrenceId, exerciseId: performedExerciseId,
      status: Array.isArray(status) ? status[index] : status, sets: [timed ? {seconds: values[index]} : {reps: values[index]}]})),
    substitutions: performedExerciseId === exerciseId ? [] : plannedWork.map(work => ({occurrenceId: work.occurrenceId, requirementId,
      fromExerciseId: exerciseId, toExerciseId: performedExerciseId, reason: 'Just for today'})),
    anchorResults: []});
}
function context(overrides = {}) { return {programmeInstanceId: 'test-instance', equipment: KIT.slice(), ...overrides}; }
function today(overrides = {}) { return {now: NOW, prescriptionId: 'test-rx', equipment: KIT.slice(), ...overrides}; }
function performance(overrides = {}) {
  return sessionResult({sessionResultId: 'test-result', programmeInstanceId: 'test-instance', prescriptionId: 'test-rx',
    plannedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', requirementId: 'anchor-squat', section: 'main',
      prescription: {type: 'reps', timed: false, reps: 8, protocol: 'rounds', side: null,
        protocolConditions: {exerciseRestSeconds: 20, roundRestSeconds: 60}, plannedTarget: {suggestedLoad: 16}}}],
    performedWork: [{occurrenceId: 'main-1', exerciseId: 'goblet-squat', status: 'completed', sets: [{reps: 8, load: 16, loadUnit: 'kg', loadInterpretation: 'total'}]}],
    anchorResults: [], ...clone(overrides)});
}
module.exports = {definition, ringsDefinition, ringResult, context, today, performance, NOW, KIT};
