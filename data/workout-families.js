(function (root) {
  // Published versions remain available unchanged. These are shared family contracts,
  // not exercise membership tables, working composers or Coach programme definitions.
  const style = (id, name) => ({id, name});
  const definition = (id, name, purpose, styles, suitabilityCriteria, requirements, bodyFocus = ['full-body']) => ({
    id, version: 1, name, purpose, styles, bodyFocus,
    compositionPolicy: {id, version: 1},
    membershipPolicy: {id, version: 1},
    suitabilityCriteria,
    feasibilityRequirements: {
      supportedDurations: [10, 15, 20, 30, 45],
      supportedDifficulties: ['easy', 'normal', 'hard'],
      requiredChecks: ['equipment', 'impact', 'difficulty', 'sidedness', 'space', 'resolved-duration'],
      requirements
    }
  });
  const definitions = [
    definition('strength-control', 'Strength & Control',
      'Practise controlled resistance work with quality movement and meaningful rests.',
      [style('straight-sets', 'Straight sets'), style('paired-sets', 'Paired sets'), style('controlled-circuits', 'Controlled circuits')],
      ['controlled-resistance', 'movement-quality', 'meaningful-rest'],
      ['suitable-resistance-work', 'adequate-recovery'], ['full-body', 'upper', 'lower', 'core']),
    definition('cardio-conditioning', 'Cardio & Conditioning',
      'Train heart and lungs through suitable endurance, intervals or mixed conditioning.',
      [style('endurance', 'Endurance'), style('intervals', 'Intervals'), style('mixed-conditioning', 'Mixed conditioning')],
      ['cardiovascular-training', 'appropriate-work-rest', 'safe-prescriptions'],
      ['suitable-conditioning-work', 'sustainable-intensity']),
    definition('athletic-movement', 'Athletic Movement',
      'Practise footwork, balance and coordinated athletic movement with technical recovery.',
      [style('footwork-coordination', 'Footwork & coordination'), style('dynamic-balance', 'Dynamic balance'), style('integrated-movement', 'Integrated movement')],
      ['footwork', 'balance-control', 'integrated-athletic-movement', 'technical-quality'],
      ['approved-athletic-membership', 'safe-movement-space', 'exercise-sensitive-recovery']),
    definition('core-stability', 'Core & Stability',
      'Practise controlled trunk stability, holds, anti-rotation and suitable dynamic core work.',
      [style('controlled-stability', 'Controlled stability'), style('dynamic-core', 'Dynamic core')],
      ['trunk-control', 'stability', 'appropriate-core-variety'],
      ['suitable-core-work', 'bounded-local-fatigue']),
    definition('mobility-movement-quality', 'Mobility & Movement Quality',
      'Progress from comfortable preparation through focused mobility and connected flows to a gentle finish.',
      [style('joint-focused', 'Joint-focused mobility'), style('integrated-flow', 'Integrated flow')],
      ['progressive-preparation-focus-flow-finish', 'movement-region-coverage', 'natural-transitions', 'low-fatigue'],
      ['approved-mobility-membership', 'suitable-contextual-prescriptions', 'whole-session-flow-budget']),
    definition('full-body-challenges', 'Full-Body Challenges',
      'Enjoy a balanced whole-body challenge with a recognisable structure, bounded effort and appropriate rest.',
      [style('rounds', 'Rounds challenge'), style('emom', 'EMOM challenge'), style('ladder', 'Ladder challenge'),
        style('pyramid', 'Pyramid challenge'), style('density', 'Density challenge')],
      ['whole-body-balance', 'recognisable-challenge-structure', 'bounded-effort', 'appropriate-rest'],
      ['compatible-playable-protocol', 'balanced-work', 'adequate-recovery'])
  ];
  function freeze(value) {
    Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); });
    return Object.freeze(value);
  }
  root.GarageFitData = root.GarageFitData || {};
  root.GarageFitData.workoutFamilies = freeze(Object.fromEntries(definitions.map(item => [item.id, {1: item}])));
})(typeof window !== 'undefined' ? window : globalThis);
