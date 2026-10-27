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


  // One tracker per exercise occurrence. Consume skipped positions without replaying
  // them, including after suspension; callers retain this tracker across pause.
  function createCountdown() { return { lowest: Infinity, observedAt: null }; }
  function takeCountdownTick(tracker, remaining, active, now) {
    if (!tracker || !Number.isFinite(remaining)) return false;
    const position = Math.ceil(remaining);
    const fresh = tracker.observedAt === null || now - tracker.observedAt <= 1250;
    tracker.observedAt = now;
    if (position >= tracker.lowest) return false;
    tracker.lowest = position;
    return active && fresh && position >= 1 && position <= 3;
  }

  root.GarageFitTimedCues = { cueOffsetSeconds, createTracker, takeDueCues, createCountdown, takeCountdownTick };
})(typeof window !== 'undefined' ? window : globalThis);
