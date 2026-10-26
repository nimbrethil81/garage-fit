(function (root) {
  'use strict';

  var HISTORY_KEY = 'gf_desk_break_recent_v1';
  // A timed, small-space policy, separate from Main eligibility and prescriptions.
  // Groups express heavy overlap; gentle entries can open a session. No wall,
  // furniture, jumping, travelling lunges or per-side prescriptions are needed.
  var POOL = [
    ['marching-on-the-spot','march',true],
    ['side-step-touches','steps',true],
    ['alternating-hamstring-curl-steps','curl',true],
    ['power-march','march'],
    ['step-jacks','steps'],
    ['standing-knee-drive-march','march'],
    ['side-step-knee-lift','steps'],
    ['low-impact-speed-skaters','steps'],
    ['alternating-straight-punches','punch'],
    ['boxer-step-and-punches','punch'],
    ['air-squat','squat'],
    ['squat-to-alternating-knee-drive','squat'],
    ['alternating-lateral-lunge','lunge'],
    ['knee-to-opposite-elbow','trunk'],
    ['push-up','arm-support'],
    ['plank','arm-support'],
    ['dead-bug','supine'],
    ['bird-dog','arm-support']
  ];

  function eligible(catalogue) {
    return POOL.map(function (entry) {
      var ex = catalogue[entry[0]];
      if (!ex || ex.equipment.length || !['low','medium'].includes(ex.impact) || ex.difficulty === 'hard' ||
          ex.sidedness === 'per-side' || !['standing','floor'].includes(ex.bodyPosition)) return null;
      return { exercise:ex, group:entry[1], gentle:!!entry[2] };
    }).filter(Boolean);
  }
  function readRecent(storage) {
    try {
      var value = JSON.parse(storage.getItem(HISTORY_KEY));
      return Array.isArray(value) ? value.filter(function (session) {
        return Array.isArray(session) && session.length === 6 && session.every(function (id) { return typeof id === 'string'; }) && new Set(session).size === 6;
      }).slice(-3) : [];
    } catch (_) { return []; }
  }
  function recordStarted(storage, plan) {
    try { storage.setItem(HISTORY_KEY, JSON.stringify(readRecent(storage).concat([plan.exercises.map(function (ex) { return ex.id; })]).slice(-3))); }
    catch (_) { /* Playback remains available without local storage. */ }
  }
  function generate(options) {
    options = options || {};
    var pool = eligible(options.catalogue || root.GarageFitData.exercises);
    var recent = Array.isArray(options.recent) ? options.recent.slice(-3).flat() : [];
    var random = options.random || Math.random;
    // Random order within recency bands. Search only valid sequences, so recency
    // can never displace balance or safety. Backtracking also handles small pools.
    var ranked = pool.map(function (entry) {
      return { entry:entry, rank:(recent.includes(entry.exercise.id) ? 1 : 0) + random() };
    }).sort(function (a,b) { return a.rank-b.rank; }).map(function (item) { return item.entry; });
    function search(sequence) {
      if (sequence.length === 6) {
        var exercises = sequence.map(function (item) { return item.exercise; });
        return exercises.filter(function (ex) { return ex.cardio >= 3; }).length >= 2 &&
          exercises.some(function (ex) { return ex.patterns.includes('squat') || ex.patterns.includes('lunge'); }) &&
          exercises.some(function (ex) { return ex.bodyFocus === 'upper' || ex.patterns.includes('core') || ex.id === 'knee-to-opposite-elbow'; }) ? sequence : null;
      }
      for (var entry of ranked) {
        var ex = entry.exercise, last = sequence[sequence.length-1];
        if (!sequence.length && (!entry.gentle || ex.bodyPosition !== 'standing')) continue;
        if (sequence.some(function (item) { return item.exercise.id === ex.id; })) continue;
        if (last && (last.group === entry.group || last.exercise.patterns.some(function (p) { return ex.patterns.includes(p); }))) continue;
        var floors = sequence.filter(function (item) { return item.exercise.bodyPosition === 'floor'; }).length;
        // Finish any floor work together: one descent, at most two movements.
        if (ex.bodyPosition === 'floor' && (sequence.length < 4 || floors >= 2)) continue;
        if (floors && ex.bodyPosition !== 'floor') continue;
        var found = search(sequence.concat([entry]));
        if (found) return found;
      }
      return null;
    }
    var selected = search([]);
    if (!selected) throw new Error('Desk Break is unavailable: there are not enough suitable movements for a balanced three-minute break. Please try again later.');
    return { id:'deskBreak', name:'Desk Break', transitionSeconds:6,
      termination:{type:'timed-sequence',durationSeconds:180},
      completionMessage:'Break complete. Ready for your next meeting.',
      exercises:selected.map(function (item) { return {id:item.exercise.id,name:item.exercise.name,durationSeconds:25}; }) };
  }
  root.GarageFitDeskBreak = {generate:generate,eligible:eligible,readRecent:readRecent,recordStarted:recordStarted};
})(window);
