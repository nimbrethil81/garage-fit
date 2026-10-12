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
module.exports = {definition, context, today, performance, NOW, KIT};
