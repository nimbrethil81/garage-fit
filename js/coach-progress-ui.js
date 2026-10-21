(function (root) {
  // Your progress presentation for every Coach programme. Read-only views over
  // saved Programme State, Session Results and existing policy summaries; this
  // module never plans sessions, changes targets or reads Coach storage.
  const title = value => value ? value.charAt(0).toUpperCase()+value.slice(1) : '';
  const known = value => value !== null && value !== undefined;
  const dateText = iso => new Date(iso).toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'});

  function sectionLabel(anchor) {
    if (anchor.directElbowAction) return anchor.directElbowAction === 'flexion' ? 'Curl' : 'Extension';
    return title(anchor.roleId || anchor.pattern || 'Target');
  }
  function loadText(load, unit, interpretation) {
    if (!known(load) || !unit) return null;
    return load+' '+unit+(interpretation === 'per-item' ? ' each' : interpretation === 'total' ? ' total' : '');
  }
  // The recorded workout-family identity of a saved session or generated workout, for
  // display. Records without a complete published identity return null: legacy sessions
  // keep neutral copy and are never assigned a family label.
  function workoutIdentity(record) {
    if (!record || !record.workoutFamilyId) return null;
    const versions = root.GarageFitData && root.GarageFitData.workoutFamilies && root.GarageFitData.workoutFamilies[record.workoutFamilyId];
    const family = versions && versions[record.workoutFamilyVersion];
    const style = family && family.styles.find(item => item.id === record.familyStyleId);
    return style ? {family: family.name, style: style.name, purpose: family.purpose, label: family.name+' — '+style.name} : null;
  }
  function perSide(exercise) { return !!exercise && exercise.sidedness === 'per-side'; }
  // Sets/reps only: the prescription. Load is shown separately and never implied.
  function prescriptionText(target, exercise) {
    const goal = target.target || {};
    const amount = goal.type === 'reps' || known(goal.maxReps) ? goal.maxReps+' reps' : known(goal.seconds) ? goal.seconds+' sec' : 'work';
    return target.targetSets+' × '+amount+(perSide(exercise) ? ' each side' : '');
  }
  function currentLoadText(target) {
    const load = loadText(target.suggestedLoad, target.loadUnit, target.loadInterpretation);
    return load ? 'Planned load · '+load : 'Load · not yet confirmed';
  }

  // The latest actual evidence for the stable anchor exercise. A substitute is a
  // separate series, so its sets never appear as this target's performance.
  function lastPerformed(anchor, history, programmeInstanceId) {
    const candidates = [];
    (history ? history.performances : []).forEach(item => {
      if (item.requirementId === anchor.requirementId && item.exerciseId === anchor.exerciseId && item.section === 'main'
        && item.programmeInstanceId === programmeInstanceId) candidates.push(item);
    });
    (anchor.comparisonBaseline && anchor.comparisonBaseline.performances || []).forEach(item => {
      if (item.exerciseId === anchor.exerciseId && !candidates.some(other => other.sessionResultId === item.sessionResultId
        && other.occurrenceId === item.occurrenceId)) candidates.push(item);
    });
    if (!candidates.length) return null;
    const latest = candidates.slice().sort((a,b) => Date.parse(b.occurredAt)-Date.parse(a.occurredAt))[0];
    const work = candidates.filter(item => item.sessionResultId === latest.sessionResultId)
      .sort((a,b) => a.occurrenceId.localeCompare(b.occurrenceId, undefined, {numeric: true}));
    return {sessionResultId: latest.sessionResultId, occurredAt: latest.occurredAt,
      status: work.every(item => item.status === 'completed') ? 'completed' : 'partial',
      sets: work.flatMap(item => item.sets.map(set => ({side: item.side, reps: set.reps.value, seconds: set.seconds.value,
        load: set.load.value, loadUnit: set.loadUnit, loadInterpretation: set.loadInterpretation, resistanceSetup: set.resistanceSetup})))};
  }
  function setText(set, index) {
    const side = set.side === 'left' || set.side === 'right' ? ' '+set.side : '';
    const amount = known(set.reps) ? set.reps+' reps' : known(set.seconds) ? set.seconds+' sec' : 'reps not recorded';
    const load = loadText(set.load, set.loadUnit, set.loadInterpretation)
      || (set.resistanceSetup ? 'resistance setup confirmed' : 'load not recorded');
    return 'Set '+(index+1)+side+' · '+amount+' · '+load;
  }
  function laterSubstitution(anchor, performed) {
    const latest = (anchor.substitutionHistory || []).slice(-1)[0];
    return latest && (!performed || Date.parse(latest.occurredAt) > Date.parse(performed.occurredAt)) ? latest : null;
  }
  const heldReasons = {
    'hold-unknown-load': 'Progression is held until a full session records your actual load.',
    'hold-unknown-setup': 'Progression is held until a full session confirms your resistance setup.',
    'hold-easy-today': 'Your last session was marked Easy today, so progression was held.'
  };
  // Only the engine's stored intent or a known hold is shown; nothing is predicted.
  function nextProgression(anchor, {state, holdReason} = {}) {
    if (state && state.mode === 'maintenance') return {text: null, note: 'Maintenance keeps this challenge steady; progression is held.'};
    if (holdReason) return {text: null, note: holdReason};
    const decision = anchor.progression && anchor.progression.decision;
    return {text: anchor.currentTarget && anchor.currentTarget.progressionIntent || null, note: heldReasons[decision] || null};
  }

  function createViews({paragraph, heading, catalogue}) {
    const expanded = {};
    function node(tag, className, text) {
      const item = document.createElement(tag); if (className) item.className = className;
      if (text !== undefined) item.textContent = text; return item;
    }
    function section(label, className) {
      const wrap = node('section', 'coach-progress-section'+(className ? ' '+className : ''));
      wrap.setAttribute('aria-label', label); wrap.append(heading(label)); return wrap;
    }
    // A tappable card: the button names the card, a sibling panel holds detail.
    function card({key, label, lines, detail, className, icon}) {
      const item = node('div', 'coach-progress-card'+(className ? ' '+className : ''));
      const control = node('button', 'coach-progress-card-button'); control.type = 'button';
      const panel = node('div', 'coach-progress-detail'); panel.id = 'coach-progress-'+key.replace(/[^a-z0-9-]/gi,'-');
      control.setAttribute('aria-label', [label, ...lines].join(' · '));
      control.setAttribute('aria-controls', panel.id);
      if (icon) { const mark = node('span', 'coach-capability-icon', icon); mark.setAttribute('aria-hidden', 'true'); control.append(mark); }
      // Allow a line break after a slash so long names wrap between words.
      const name = node('span', 'coach-progress-card-title', label.replaceAll('/', '/\u200b')); control.append(name);
      lines.forEach(line => control.append(node('span', 'coach-progress-card-line', line)));
      const sync = () => { panel.hidden = !expanded[key]; control.setAttribute('aria-expanded', String(!!expanded[key])); };
      control.onclick = () => { expanded[key] = !expanded[key]; sync(); };
      panel.append(...detail); sync(); item.append(control, panel); return item;
    }

    function strengthTargets({state, history, holdReason}) {
      const wrap = section('Strength targets'), grid = node('div', 'coach-progress-grid');
      state.anchors.forEach(anchor => {
        const exercise = catalogue[anchor.exerciseId], target = anchor.currentTarget || anchor;
        const name = exercise ? exercise.name : anchor.exerciseId, label = sectionLabel(anchor);
        const performed = lastPerformed(anchor, history, state.programmeInstanceId);
        const detail = [heading('Current target'), paragraph(prescriptionText(target, exercise)+' · prescribed'), paragraph(currentLoadText(target))];
        detail.push(heading('Last performed'));
        if (performed) {
          detail.push(paragraph(dateText(performed.occurredAt)+' · '+performed.status+' · actual recorded work'));
          performed.sets.forEach((set, index) => detail.push(paragraph(setText(set, index))));
        } else detail.push(paragraph('No performed sets recorded yet for '+name+'.'));
        const transition = (anchor.variationProgression && anchor.variationProgression.transitions || []).slice(-1)[0];
        if (transition) detail.push(paragraph('You chose to progress from '+(catalogue[transition.fromExerciseId]?.name || transition.fromExerciseId)
          +' on '+dateText(transition.confirmedAt)+'. Its history is kept as a separate series.'));
        const substitute = laterSubstitution(anchor, performed);
        if (substitute) detail.push(paragraph('On '+dateText(substitute.occurredAt)+' you used '+(catalogue[substitute.exerciseId]?.name || substitute.exerciseId)
          +' just for that session. It is a separate series and did not change this target.'));
        const next = nextProgression(anchor, {state, holdReason});
        if (next.text || next.note) detail.push(heading('Next progression'));
        if (next.text) detail.push(paragraph(next.text));
        if (next.note) detail.push(paragraph(next.note));
        grid.append(card({key: 'target-'+anchor.requirementId, label: name, lines: [label, prescriptionText(target, exercise)], detail, className: 'coach-target-card'}));
      });
      wrap.append(grid, paragraph('Targets are prescriptions. Last performed shows only work you recorded; unknown values stay unknown.'));
      return wrap;
    }

    const coverageStatus = {observed: ['✓', 'Performed'], unknown: ['?', 'Unmeasured'], 'not-observed': ['○', 'Not performed']};
    function capabilityGrid(summary) {
      const wrap = section('Tennis fitness · last '+summary.window.days+' days'), grid = node('div', 'coach-progress-grid');
      summary.capabilities.forEach(cap => {
        const [icon, status] = coverageStatus[cap.coverage];
        const lines = [status];
        if (!cap.achievable) lines.push('Not possible with today’s equipment');
        else if (cap.missingFacets.length) lines.push('Limited by equipment');
        const names = [...new Set(cap.observations.map(work => catalogue[work.exerciseId]?.name || work.exerciseId))];
        const detail = [paragraph(names.length ? 'Performed: '+names.join(', ') : 'No performed work for this capability in the last '+summary.window.days+' days.')];
        if (cap.observations.some(work => work.exposure.confidence === 'unknown')) detail.push(paragraph('Some work was recorded without an amount, so exposure is unknown.'));
        if (!cap.achievable) detail.push(paragraph('Today’s equipment and constraints cannot provide this capability.'));
        else if (cap.missingFacets.length) detail.push(paragraph('Unavailable today: '+cap.missingFacets.join(', ').replaceAll('-', ' ')+'.'));
        grid.append(card({key: 'capability-'+cap.capabilityId, label: cap.label, lines, detail, icon,
          className: 'coach-capability-card coverage-'+cap.coverage}));
      });
      wrap.append(grid);
      if (summary.unclassifiedObservations.length) wrap.append(paragraph('Some performed work cannot be classified; no capability coverage is assumed for it.'));
      wrap.append(paragraph('Performed training coverage, not proven tennis skill. Capabilities overlap; there is no catch-up debt.'));
      return wrap;
    }

    function armsExposure({definition, state, history, now}) {
      const days = definition.doseTargets.windowDays, wrap = section('Arm work · last '+days+' days'), grid = node('div', 'coach-progress-grid');
      const scope = {programmeInstanceId: state.programmeInstanceId, sections: definition.doseTargets.sections,
        since: new Date(Date.parse(now)-days*86400000).toISOString(), until: now};
      Object.entries(definition.doseTargets.directElbowActions).forEach(([action, target]) => {
        const exposure = history.directElbowExposure(action, scope);
        const unmeasured = history.performances.some(item => item.directElbowAction === action && item.exposure.confidence === 'unknown'
          && item.programmeInstanceId === state.programmeInstanceId && scope.sections.includes(item.section)
          && Date.parse(item.occurredAt) >= Date.parse(scope.since) && Date.parse(item.occurredAt) <= Date.parse(scope.until));
        const tile = node('div', 'coach-progress-tile');
        tile.append(paragraph((action === 'flexion' ? 'Curls' : 'Extensions')+' · '+Number(exposure.value.toFixed(2))+' / '+target+' performed set exposures'));
        if (unmeasured) tile.append(paragraph('Some work is unmeasured'));
        grid.append(tile);
      });
      wrap.append(grid, paragraph('Compound pushing and pulling support whole-body maintenance and are tracked separately from direct arm work.'));
      return wrap;
    }

    function sessionHistory({state, results}) {
      const wrap = section('Recent sessions'), summaries = new Map((state.recentSessionSummaries || []).map(item => [item.sessionResultId, item]));
      const recent = results.filter(result => result.programmeInstanceId === state.programmeInstanceId).slice(-5).reverse();
      if (!recent.length) wrap.append(paragraph('No saved sessions yet. Performed work appears here after you save a session.'));
      const list = node('ul', 'coach-history-list');
      recent.forEach(result => {
        const performed = result.performedWork.filter(work => ['completed','partial'].includes(work.status)).length;
        const summary = summaries.get(result.sessionResultId);
        const status = result.finalStatus === 'abandoned' ? 'Ended early · no main work counted'
          : result.finalStatus === 'skipped-before-start' ? 'Not started' : title(result.finalStatus);
        const credit = summary ? summary.meaningful ? 'counted' : 'not counted' : null;
        const identity = workoutIdentity(result);
        list.append(node('li', null, [dateText(result.endedAt), identity && identity.label, status, performed+' performed exercise'+(performed === 1 ? '' : 's'), credit].filter(Boolean).join(' · ')));
      });
      if (recent.length) wrap.append(list);
      const help = node('details', 'coach-help'), label = node('summary', null, 'ⓘ About your history');
      label.setAttribute('aria-label', 'About your history');
      help.append(label, paragraph('History is local to this browser and device. Clearing site data or changing devices can remove access to it. Only performed work counts; skipped or unperformed work is never credited.'));
      wrap.append(help);
      return wrap;
    }

    return {strengthTargets, capabilityGrid, armsExposure, sessionHistory, section};
  }
  root.GarageFitCoachProgressUI = {createViews, workoutIdentity, sectionLabel, prescriptionText, lastPerformed, nextProgression, loadText};
})(typeof window !== 'undefined' ? window : globalThis);
