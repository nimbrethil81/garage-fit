// Read-only, deterministic audit of reviewed mappings; no Generator selection.
global.window = global;
require('../data/exercises.js');
require('../data/sport-capabilities.js');
require('../js/coach-model.js');
require('../js/sport-coverage.js');
const policy = GarageFitSportCoverage.createPolicy(GarageFitData.sportCapabilityPolicies.tennis[1], GarageFitData.exercises);
const kit = ['dumbbells','kettlebell','trx','pullup-bar'];
const scenarios = {
  bodyweight: {equipment: []},
  ownedKit: {equipment: kit},
  bodyweightSmallSpaceNoHighImpact: {equipment: [], smallSpace: true, allowedImpact: ['low','medium']},
  ownedKitSmallSpaceNoHighImpact: {equipment: kit, smallSpace: true, allowedImpact: ['low','medium']}
};
console.log(JSON.stringify({policyId:policy.definition.id,version:policy.definition.version,
  scenarios:Object.fromEntries(Object.entries(scenarios).map(([id, options]) => [id, policy.availability(options)]))},null,2));
