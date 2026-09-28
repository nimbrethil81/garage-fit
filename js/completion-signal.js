(function (root) {
  // A structured playback unit (a timed interval, a rest, a round, a block,
  // a phase, the whole workout) has just finished exactly when playback
  // advances forward past it. Nested boundaries that land on the same
  // advance (e.g. the last exercise of a round also ending the round)
  // share that single forward step, so this only ever reports one
  // completion per step instead of one per boundary crossed.
  function shouldSignalUnitComplete(previousIndex, nextIndex) {
    return Number.isFinite(previousIndex) && Number.isFinite(nextIndex) && nextIndex > previousIndex;
  }

  root.GarageFitCompletionSignal = { shouldSignalUnitComplete };
})(typeof window !== 'undefined' ? window : globalThis);
