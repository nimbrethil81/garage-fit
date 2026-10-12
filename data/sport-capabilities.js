(function (root) {
  // Reviewed exercise identities, not rules inferred from broad movement patterns.
  // Release a new version when membership or interpretation changes.
  const group = (exerciseIds, facet, rationale, space = 'stationary') => ({exerciseIds, facet, rationale, space});
  const tennis = {
    id: 'tennis-conditioning', sportId: 'tennis', version: 1, windowDays: 14,
    balancedMinimum: 'positive-known-exposure',
    capabilities: [
      {id: 'lower-body', label: 'Lower-body strength/stability', priority: 'core', facets: ['strength-stability'], mappings: [
        group(['air-squat','goblet-squat','kettlebell-goblet-squat','dumbbell-sumo-squat','kettlebell-sumo-squat','dumbbell-romanian-deadlift','kettlebell-deadlift','glute-bridge','trx-glute-bridge'], 'strength-stability', 'Controlled squat/hinge strength exposure.'),
        group(['reverse-lunge','dumbbell-reverse-lunge','kettlebell-reverse-lunge','trx-reverse-lunge','trx-split-squat','kettlebell-single-leg-deadlift','trx-single-leg-deadlift','alternating-lateral-lunge','cossack-squat'], 'strength-stability', 'Split-stance, single-leg or lateral lower-body control; not automatic lateral braking.')
      ]},
      {id: 'lateral-movement', label: 'Lateral movement and deceleration', priority: 'core', facets: ['lateral-control','lateral-braking'], mappings: [
        group(['alternating-lateral-lunge','cossack-squat','banded-lateral-walk'], 'lateral-control', 'Controlled lateral loading/stepping; does not establish fast braking.', 'lateral'),
        group(['skater-jumps'], 'lateral-braking', 'Sideways leap and single-leg landing expose lateral propulsion and landing control; not court-speed stopping skill.', 'lateral')
      ]},
      {id: 'trunk', label: 'Trunk control/rotation', priority: 'core', facets: ['control','rotation'], mappings: [
        group(['plank','side-plank','dead-bug','dumbbell-plank-pull-through','dumbbell-renegade-row','band-pallof-press'], 'control', 'Trunk stabilisation against limb movement or asymmetric resistance.'),
        group(['dumbbell-wood-chop','kettlebell-russian-twist','push-up-rotation','trx-power-pull'], 'rotation', 'Controlled rotational exposure; not demonstrated rotational power.')
      ]},
      {id: 'upper-body', label: 'Shoulder and upper-body conditioning', priority: 'core', facets: ['push-pull','shoulder-support'], mappings: [
        group(['push-up','dumbbell-floor-press','kettlebell-floor-press','trx-chest-press','trx-row','dumbbell-bent-over-row','single-arm-dumbbell-row','single-arm-kettlebell-row','pull-up','chin-up'], 'push-pull', 'General upper-body pushing/pulling capacity; not tennis-specific shoulder resilience.'),
        group(['dumbbell-reverse-fly','trx-t-fly','trx-y-fly','band-pull-apart','band-face-pull','dumbbell-lateral-raise'], 'shoulder-support', 'Controlled shoulder/scapular supporting work; not injury prevention evidence.')
      ]},
      {id: 'power', label: 'Explosive power', priority: 'complementary', facets: ['general-power','rotational-power'], mappings: [
        group(['squat-jumps'], 'general-power', 'Jump propulsion; high impact, landing clearance required.'),
        group(['skater-jumps'], 'general-power', 'Lateral jump propulsion; high impact.', 'lateral'),
        group(['kettlebell-swing','kettlebell-single-arm-swing','kettlebell-clean','dumbbell-snatch','kettlebell-snatch','dumbbell-push-press'], 'general-power', 'Explicit ballistic hip/leg drive; skill and load remain individual prerequisites.')
      ]},
      {id: 'endurance', label: 'Match endurance/repeated efforts', priority: 'complementary', facets: ['general-conditioning','match-repeated-efforts'], mappings: [
        group(['mountain-climbers','jumping-jacks','high-knees','burpees','dumbbell-thruster','kettlebell-swing','trx-mountain-climber'], 'general-conditioning', 'General conditioning exposure only; exercise completion cannot establish match endurance or a repeated-effort dose.')
      ]}
    ],
    focusPreferences: {
      balanced: [], movement: ['lateral-movement','lower-body','trunk'],
      power: ['power','lower-body','trunk'], endurance: ['endurance'],
      resilience: ['lower-body','trunk','upper-body']
    }
  };
  function freeze(value) {
    Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); });
    return Object.freeze(value);
  }
  root.GarageFitData = root.GarageFitData || {};
  root.GarageFitData.sportCapabilityPolicies = freeze({tennis: {1: tennis}});
})(typeof window !== 'undefined' ? window : globalThis);
