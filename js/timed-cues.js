(function (root) {
  function cueOffsetSeconds(cue, durationSeconds) {
    if (!cue || !cue.at || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
    if (cue.at.type === 'fraction' && Number.isFinite(cue.at.value)) {
      return Math.max(0, Math.min(durationSeconds, durationSeconds * cue.at.value));
    }
    if (cue.at.type === 'seconds' && Number.isFinite(cue.at.value)) {
      return Math.max(0, Math.min(durationSeconds, cue.at.value));
    }
    return null;
  }

  function createTracker(cues, durationSeconds) {
    return {
      durationSeconds,
      cues: (Array.isArray(cues) ? cues : []).map((cue, index) => ({
        id: cue.id || String(index),
        text: cue.text,
        offsetSeconds: cueOffsetSeconds(cue, durationSeconds),
        fired: false
      })).filter(cue => cue.text && cue.offsetSeconds !== null)
    };
  }

  function takeDueCues(tracker, elapsedSeconds) {
    if (!tracker || !Number.isFinite(elapsedSeconds)) return [];
    const due = [];
    tracker.cues.forEach(cue => {
      if (!cue.fired && elapsedSeconds >= cue.offsetSeconds) {
        cue.fired = true;
        due.push(cue);
      }
    });
    return due;
  }

  root.GarageFitTimedCues = { cueOffsetSeconds, createTracker, takeDueCues };
})(typeof window !== 'undefined' ? window : globalThis);
