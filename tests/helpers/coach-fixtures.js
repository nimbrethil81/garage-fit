// Valid version-1 Coach records for tests. Each builder returns a fresh object; overrides
// replace top-level fields.
const merge = (base, overrides) => Object.assign(base, overrides || {});

function programmeState(overrides) {
  return merge({
    schemaVersion: 1,
    programmeInstanceId: 'prog-1',
    programmeDefinitionId: 'general-strength',
    programmeDefinitionVersion: 1,
    status: 'active',
    mode: 'development',
    startedAt: '2026-10-01T07:30:00Z',
    nominalProgress: 2,
    meaningfulSessionsCompleted: 2,
    anchors: [{exerciseId: 'goblet-squat'}],
    currentTargets: {'goblet-squat': {load: 16, loadUnit: 'kg'}},
    recentSessionSummaries: [],
    recentOverrides: [],
    recentSubstitutions: [],
    lastAppliedSessionResultId: null
  }, overrides);
}

function anchor(overrides) {
  return merge({
    requirementId: 'req-1',
    exerciseId: 'goblet-squat',
    importance: 'required',
    targetSets: 3,
    targetExposures: null,
    target: {type: 'reps', minReps: 6, maxReps: 10},
    suggestedLoad: 16,
    loadUnit: 'kg',
    loadInterpretation: 'total',
    allowedProtocols: ['paired_sets','rounds'],
    progressionIntent: 'add-reps'
  }, overrides);
}

function prescription(overrides) {
  return merge({
    schemaVersion: 1,
    prescriptionId: 'rx-1',
    programmeInstanceId: 'prog-1',
    sessionRole: 'strength-a',
    duration: 30,
    workoutStyle: 'strength',
    difficulty: 'normal',
    bodyFocus: 'full-body',
    equipment: ['kettlebell','dumbbells'],
    requiredAnchors: [anchor()],
    preferredAnchors: [],
    movementPriorities: [{requirementId: 'priority-hinge', pattern: 'hinge', priority: 'primary'}],
    bodyRegionPriorities: [],
    avoidConstraints: [],
    protocolConstraints: [],
    programmeContext: {week: 1}
  }, overrides);
}

function sessionResult(overrides) {
  return merge({
    schemaVersion: 1,
    sessionResultId: 'result-1',
    source: 'coach',
    programmeInstanceId: 'prog-1',
    prescriptionId: 'rx-1',
    workoutId: 'workout-1',
    generatedAt: '2026-10-01T07:55:00Z',
    startedAt: '2026-10-01T08:00:00Z',
    endedAt: '2026-10-01T08:31:00Z',
    actualDurationSeconds: 1860,
    finalStatus: 'completed',
    feedback: {effort: 'moderate'},
    overrides: [],
    plannedWork: [{occurrenceId: 'occ-1', exerciseId: 'goblet-squat', section: 'main', blockIndex: 0, requirementId: 'req-1', prescription: {sets: 3, reps: 8}}],
    performedWork: [{occurrenceId: 'occ-1', exerciseId: 'goblet-squat', status: 'completed', sets: [{reps: 8, load: 16, loadUnit: 'kg', loadInterpretation: 'total'}]}],
    substitutions: [],
    anchorResults: [{requirementId: 'req-1', exerciseId: 'goblet-squat', occurrenceId: 'occ-1', status: 'completed', sets: null}],
    derivedExposure: null
  }, overrides);
}

function sessionDraft(overrides) {
  return merge({
    schemaVersion: 1,
    draftId: 'draft-1',
    source: 'coach',
    programmeInstanceId: 'prog-1',
    prescriptionId: 'rx-1',
    workoutId: 'workout-1',
    generatedAt: '2026-10-01T07:55:00Z',
    startedAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:10:00Z',
    plannedWork: [{occurrenceId: 'occ-1', exerciseId: 'goblet-squat'}],
    occurrenceOutcomes: [{occurrenceId: 'occ-1', exerciseId: 'goblet-squat', status: 'partial'}],
    substitutions: [{occurrenceId: 'occ-2', fromExerciseId: 'push-up', toExerciseId: 'incline-push-up', reason: 'wrist'}],
    anchorResults: [{requirementId: 'req-1', exerciseId: 'goblet-squat', occurrenceId: 'occ-1', status: null, sets: [{reps: 8, load: 16, loadUnit: 'kg'}]}],
    finalisation: {state: 'in-progress', sessionResultId: null}
  }, overrides);
}

// Fixed input for pre-C1 behavioural snapshots: catalogue expansion is allowed to
// change fresh draws, while these pins continue to detect policy changes on the
// original catalogue. This projection is test-only; all other tests use production.
function catalogueBeforeC1(catalogue) {
  const added=new Set(['side-plank-knees','bent-knee-fallout','tabletop-toe-taps','dumbbell-suitcase-carry',
    'side-plank-hip-lifts','supine-heel-slides','plank-arm-reaches','bridge-march','bent-knee-windshield-wipers',
    'dead-bug-isometric-press','bear-plank-hold','seated-knee-tucks','kettlebell-suitcase-march',
    'half-kneeling-band-pallof-press','dumbbell-dead-bug-hold',
    'single-leg-glute-bridge','hand-release-push-up','wall-push-up','reverse-nordic','side-lying-hip-adduction',
    'prone-swimmer-raise','dumbbell-suitcase-march','dumbbell-half-kneeling-press','dumbbell-lateral-lunge',
    'ring-scapular-row','dumbbell-staggered-stance-row']);
  const copy=JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(catalogue).filter(([id])=>!added.has(id)))));
  for(const id of ['side-plank','dead-bug','band-pallof-press'])copy[id].repetitionClass=null;
  Object.assign(copy['plank-shoulder-taps'],{strength:2,difficulty:null,bodyFocus:null,
    generator:false,main:false,mainRole:'primary',mainProtocols:null});
  copy['single-arm-dumbbell-row'].repetitionClass=null;
  copy['trx-chest-press'].instruction='Face away from the anchor holding the handles, lean forward, bend your elbows to lower your chest and press back, keeping your body straight.';
  return copy;
}

module.exports = { programmeState, anchor, prescription, sessionResult, sessionDraft, catalogueBeforeC1 };
