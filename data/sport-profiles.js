(function (root) {
  // Sport identity and permitted user choices, independent of programme policies
  // and Generator selection. Capability-to-exercise mappings belong to later work.
  const tennis = {
    id: 'tennis', version: 1,
    capabilities: ['movement','power','endurance','resilience'],
    configuration: {
      focuses: ['balanced','movement','power','endurance','resilience'],
      weeklyCoachFrequencies: [1,2,3],
      playingDays: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'],
      sportIntensities: ['light','moderate','hard'],
      intents: ['ongoing','event']
    },
    defaults: {focus: 'balanced', weeklyCoachFrequency: 2, usualPlayingDays: [],
      typicalSportIntensity: 'moderate', intent: 'ongoing', significantEventDate: null}
  };
  function freeze(value) {
    Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); });
    return Object.freeze(value);
  }
  root.GarageFitData = root.GarageFitData || {};
  root.GarageFitData.sportProfiles = freeze({tennis});
})(typeof window !== 'undefined' ? window : globalThis);
