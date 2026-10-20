(function (root) {
  const STORAGE_KEY = 'gf_spoken_voice_v1';
  const identity = voice => ({voiceURI:voice.voiceURI || '', name:voice.name || '', lang:voice.lang || ''});
  const locale = voice => (voice.lang || '').replace(/_/g, '-').toLowerCase();

  // Browser inventories can arrive late or change between visits. Keep the saved
  // identity even when no voice matches; callers then use the system default.
  function create({getSynthesis, getStorage, onChange = () => {}}) {
    let voices = [], preference = null;
    try {
      const saved = JSON.parse(getStorage().getItem(STORAGE_KEY));
      if (saved && ['voiceURI','name','lang'].every(key => typeof saved[key] === 'string') && (saved.voiceURI || saved.name)) preference = saved;
    } catch (e) {}
    function synthesis() { try { return getSynthesis(); } catch (e) { return null; } }
    function supported() {
      const engine = synthesis();
      return !!engine && typeof engine.speak === 'function';
    }
    function refresh() {
      try { voices = Array.from(synthesis().getVoices()).sort((a,b) =>
        Number(locale(b) === 'en-gb') - Number(locale(a) === 'en-gb') ||
        locale(a).localeCompare(locale(b)) || (a.name || '').localeCompare(b.name || '') ||
        (a.voiceURI || '').localeCompare(b.voiceURI || '')); }
      catch (e) { voices = []; }
      onChange();
      return voices.slice();
    }
    function selected() {
      if (!preference) return null;
      const candidates = voices.filter(voice => preference.voiceURI
        ? voice.voiceURI === preference.voiceURI && locale(voice) === locale(preference)
        : voice.name === preference.name && locale(voice) === locale(preference));
      if (candidates.length === 1) return candidates[0];
      const exact = candidates.filter(voice => voice.name === preference.name);
      return exact.length === 1 ? exact[0] : null;
    }
    function choose(voice) {
      if (voice && !voices.includes(voice)) return;
      preference = voice ? identity(voice) : null;
      try { getStorage().setItem(STORAGE_KEY, JSON.stringify(preference)); } catch (e) {}
      onChange();
    }
    refresh();
    try {
      const engine = synthesis();
      if (typeof engine.addEventListener === 'function') engine.addEventListener('voiceschanged', refresh);
      else {
        const previous = engine.onvoiceschanged;
        engine.onvoiceschanged = event => { try { if (typeof previous === 'function') previous.call(engine, event); } finally { refresh(); } };
      }
    } catch (e) {}
    return {refresh, selected, choose, supported, list:() => voices.slice(), preference:() => preference && {...preference}};
  }
  root.GarageFitSpeechVoices = {create, STORAGE_KEY};
})(typeof window !== 'undefined' ? window : globalThis);
