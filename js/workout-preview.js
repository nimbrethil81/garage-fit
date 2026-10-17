(function (root) {
  // Presentation only. Headings/rows return detached DOM nodes; indexes are zero-based.
  // Row copy (name, prescription, instruction, cue, optional targetLabel) is plain text.
  // Callers resolve catalogue instructions and supply controls as already-wired DOM nodes
  // (e.g. Swap, Edit, Substitute, or none). No workout/state/storage access or mutations.
  function text(tag, className, value) {
    const node=root.document.createElement(tag);
    node.className=className; node.textContent=value;
    return node;
  }

  function sectionHeading(title) {
    return text('h2','preview-section-title',title);
  }

  function blockHeading({index, total, prescription}) {
    const row=root.document.createElement('li'); row.className='preview-block-heading';
    const heading=text('h3','preview-exercise','Block '+(index+1)+' of '+total);
    heading.appendChild(text('span','preview-prescription',prescription));
    row.append(text('span','preview-index','B'+(index+1)),heading);
    return row;
  }

  function instructionDisclosure(instruction) {
    if (!instruction) return null;
    const details=root.document.createElement('details'); details.className='exercise-instruction';
    details.append(text('summary','','How to do it'),text('p','',instruction));
    return details;
  }

  // `marker` replaces the numbered index, e.g. A/B for the two exercises of a superset.
  function exerciseRow({index, marker, name, prescription, instruction, cue, targetLabel, controls=[]}) {
    const row=root.document.createElement('li'), copy=text('div','preview-exercise',name);
    copy.appendChild(text('span','preview-prescription',prescription));
    if (targetLabel) copy.appendChild(text('span','preview-prescription preview-target-label',targetLabel));
    if (cue) copy.appendChild(text('span','review-note',cue));
    const disclosure=instructionDisclosure(instruction);
    if (disclosure) copy.appendChild(disclosure);
    row.append(text('span','preview-index',marker||String(index+1).padStart(2,'0')),copy);
    if (controls.length) {
      const actions=root.document.createElement('div'); actions.className='preview-controls';
      actions.append(...controls); row.appendChild(actions);
    }
    return row;
  }

  // Pure formatting of the existing exercise/block contracts. Callers can instead
  // supply their own row prescription text (e.g. a Coach sets/rep-range target).
  function formatPrescription(exercise) {
    const p=exercise.prescription, unit=p.type.includes('timed')?' sec':' reps';
    const each=(exercise.sidedness==='per-side'||p.type.includes('unilateral'))?' each side':'';
    return p.value+unit+each+(exercise.load?' · '+exercise.load:'');
  }

  // `paired_sets` is presented as a superset: A then B, a short changeover, and the recovery
  // after each completed pair (never after the last pair, matching resolveBlockSteps).
  function supersetMarker(block, exerciseIndex) {
    return block.protocol==='paired_sets' ? 'AB'.charAt(exerciseIndex) || null : null;
  }

  function protocolLabel(block) {
    if (block.protocol==='paired_sets') {
      const p=block.prescription, sets=p.sets;
      return ['Superset · '+sets+(sets===1?' set':' sets')+' · A then B'+(p.betweenExercisesSeconds ? '' : ', no changeover'),
        p.betweenExercisesSeconds ? p.betweenExercisesSeconds+' sec changeover' : null,
        sets>1 && p.betweenSetsSeconds ? p.betweenSetsSeconds+' sec rest after each pair' : null].filter(Boolean).join(' · ');
    }
    if (block.protocol==='timed_intervals') return 'Timed intervals · '+block.prescription.workSeconds+' sec work / '+block.prescription.transitionSeconds+' sec change · '+block.prescription.cycles+' cycles';
    const rounds=block.prescription.rounds;
    return 'Mini-circuit · '+rounds+(rounds===1?' round':' rounds');
  }

  root.GarageFitWorkoutPreview={sectionHeading,blockHeading,exerciseRow,instructionDisclosure,formatPrescription,protocolLabel,supersetMarker};
})(typeof window==='undefined' ? globalThis : window);
