(function (root) {
  // Standalone five-minute warm-up and cool-down routines (Prep & Recover). Pure and
  // dependency-free: no coupling to a Main workout, Coach prescription or workout budgets.
  // Eligibility and relationships reuse js/generator.js; the policy below is described in
  // data/EXERCISE_METADATA.md ("Standalone routines").
  const G = () => root.GarageFitGenerator;

  const ROUTINE_SECONDS = 300;
  const KINDS = ['warmup','cooldown'];
  const VARIANTS = ['bodyweight','equipment'];
  // Seconds between occurrences: a change of side, the next exercise, or the next exercise
  // with a different setup (equipment or standing/floor position). Parity repair may add one
  // second to a transition so per-side work can stay equal on both sides.
  const TRANSITION = { side:5, exercise:5, setup:10 };
  const TRANSITION_SLACK = 2;
  // Work per occurrence (per side for per-side work): preferred value and safe bounds.
  const TIMING = {
    warmup: { single:{preferred:28,min:20,max:40}, perSide:{preferred:20,min:15,max:30} },
    cooldown: { single:{preferred:40,min:30,max:60}, perSide:{preferred:30,min:20,max:45} }
  };
  // Session-level anti-clustering: at most this many exercises share a repetitionClass, or
  // (cool-down) a stretch target, outside what essential coverage needs.
  const CLUSTER_LIMIT = 2;
  const RECENT_EXACT = [8,5,3];
  const RECENT_RELATED = [3,2,1];

  // Warm-up preparation never carries disproportionate fatigue into whatever follows.
  const WARMUP_MAX_FATIGUE = 2;
  const MAJOR_PATTERNS = new Set(['squat','hinge','lunge','push','pull','carry']);
  const hasArea = area => exercise => (exercise.warmupAreas || []).includes(area) ? 1 : 0;
  // A stretch shares its emphasis between its targets: a dedicated stretch counts fully, a broad
  // flow counts partly towards each region it reaches.
  const targetShare = targets => exercise => {
    const list = exercise.stretchTargets || [];
    return list.length ? list.filter(target => targets.includes(target)).length/list.length : 0;
  };

  // Essential coverage, in priority order: `contribution` scores one exercise and a
  // requirement is met once the routine's total reaches `threshold`. Generator policy over metadata.
  const REQUIREMENTS = {
    warmup: [
      {key:'knee-mobility', threshold:1, contribution:exercise => G().kneeMobilityQualified(exercise) ? 1 : 0},
      {key:'ankles', threshold:1, contribution:hasArea('ankles')},
      {key:'hips', threshold:1, contribution:hasArea('hips')},
      {key:'shoulders', threshold:1, contribution:hasArea('shoulders')},
      {key:'trunk', threshold:1, contribution:hasArea('trunk')},
      // Rhythmic pulse raising: cardiovascular demand without a loaded strength pattern.
      {key:'pulse', threshold:1, contribution:exercise => exercise.cardio>=2 && !(exercise.patterns || []).some(pattern => MAJOR_PATTERNS.has(pattern)) ? 1 : 0},
      // Progression ends on more dynamic preparation.
      {key:'dynamic', threshold:1, contribution:exercise => exercise.prepIntensity>=3 ? 1 : 0}
    ],
    cooldown: [
      {key:'posterior-lower', threshold:.5, contribution:targetShare(['hamstrings','glutes','calves'])},
      {key:'anterior-lower', threshold:.5, contribution:targetShare(['quadriceps','hip-flexors'])},
      {key:'upper', threshold:.5, contribution:targetShare(['chest','shoulders','triceps'])},
      {key:'trunk-back', threshold:.5, contribution:targetShare(['trunk','back'])}
    ]
  };
  const dose = (requirement, exercises) => exercises.reduce((sum, exercise) => sum + requirement.contribution(exercise), 0);
  const met = (requirement, exercises) => dose(requirement, exercises)>=requirement.threshold-1e-9;

  function sides(exercise) { return exercise.sidedness==='per-side' ? ((exercise.sideOrder && exercise.sideOrder.length) ? exercise.sideOrder.slice() : ['right','left']) : [null]; }
  function bounds(exercise, kind) {
    const timing = TIMING[kind][exercise.sidedness==='per-side' ? 'perSide' : 'single'];
    const authored = kind==='warmup' && exercise.warmupPrescription && Number.isFinite(exercise.warmupPrescription.minValue) ? exercise.warmupPrescription.minValue : 0;
    const min = Math.max(timing.min, authored);
    return {min, max:Math.max(min, timing.max), preferred:Math.min(Math.max(timing.preferred, min), Math.max(min, timing.max))};
  }
  function eligible(kind, catalogue, owned) {
    return Object.values(catalogue).filter(exercise => G().generatedPhaseEligible(exercise, kind, owned) &&
      (kind!=='warmup' || exercise.prepFatigue<=WARMUP_MAX_FATIGUE));
  }
  function setupKey(exercise, owned) {
    const position = exercise.bodyPosition==='floor' ? 'floor' : exercise.bodyPosition==='hanging' ? 'hanging' : 'standing';
    return G().sectionSetupKey(exercise, owned)+'|'+position;
  }
  function stretchTargetCount(selected, target) { return selected.filter(item => (item.stretchTargets || []).includes(target)).length; }
  function clusterKeys(exercise, kind) {
    const keys = exercise.repetitionClass ? ['class:'+exercise.repetitionClass] : [];
    return kind==='cooldown' ? keys.concat((exercise.stretchTargets || []).map(target => 'target:'+target)) : keys;
  }
  function clusterCount(selected, key, kind) { return selected.filter(item => clusterKeys(item, kind).includes(key)).length; }
  function blocked(exercise, selected) {
    return selected.some(item => item.id===exercise.id || G().sameFamily(item, exercise));
  }
  function overCluster(exercise, selected, kind) {
    return clusterKeys(exercise, kind).some(key => clusterCount(selected, key, kind)>=CLUSTER_LIMIT);
  }

  // Normalises recent history to newest-first arrays of ids; tolerates records or raw arrays.
  function recentSessions(recentHistory) {
    return (Array.isArray(recentHistory) ? recentHistory : []).slice(0, RECENT_EXACT.length)
      .map(entry => Array.isArray(entry) ? entry : entry && Array.isArray(entry.ids) ? entry.ids : [])
      .map(ids => ids.filter(id => typeof id==='string'));
  }
  function recencyPenalty(exercise, sessions, catalogue) {
    let exact = 0, related = 0;
    sessions.forEach((ids, index) => {
      if (ids.includes(exercise.id)) exact = Math.max(exact, RECENT_EXACT[index]);
      else if (ids.some(id => { const other = catalogue[id]; return other && (G().sameFamily(other, exercise) || G().sameRepetitionClass(other, exercise)); })) related = Math.max(related, RECENT_RELATED[index]);
    });
    return exact + related;
  }

  function score(exercise, selected, context, unmet) {
    const {kind, sessions, catalogue, owned} = context;
    let value = 10 - recencyPenalty(exercise, sessions, catalogue);
    value += unmet.reduce((sum, requirement) => sum + requirement.contribution(exercise), 0) * 4;
    value -= selected.filter(item => G().sameRepetitionClass(item, exercise)).length * 8;
    const setups = new Set(selected.map(item => setupKey(item, owned)));
    if (selected.length && !setups.has(setupKey(exercise, owned))) value -= kind==='cooldown' ? 1.5 : 1;
    if (kind==='warmup') {
      value -= (exercise.prepFatigue-1)*2 + Math.max(0, exercise.prepComplexity-1);
      // Prefer areas covered less so far; shared coverage is never a penalty.
      value += (exercise.warmupAreas || []).filter(area => selected.filter(hasArea(area)).length<2).length * .5;
    } else {
      // Anatomically similar stretches are discouraged, not prohibited.
      value -= (exercise.stretchTargets || []).reduce((sum, target) => sum + stretchTargetCount(selected, target)*3, 0);
    }
    return value;
  }

  function pick(candidates, selected, context, unmet) {
    if (!candidates.length) return null;
    const scored = candidates.map(exercise => ({exercise, score:score(exercise, selected, context, unmet)}));
    return G().controlledPick(scored, context.random, G().SHORTLIST_MARGIN);
  }

  function orderExercises(kind, selected, owned) {
    const rank = new Map(selected.map((exercise, index) => [exercise.id, index]));
    const order = kind==='warmup'
      // Preparation progresses from gentle mobility to more dynamic work.
      ? (a, b) => a.prepIntensity-b.prepIntensity || (G().WARMUP_PHASE_ORDER[a.warmupPhase]??0)-(G().WARMUP_PHASE_ORDER[b.warmupPhase]??0) ||
          setupKey(a, owned).localeCompare(setupKey(b, owned)) || rank.get(a.id)-rank.get(b.id)
      // Gentle flow: standing equipment set-ups, then standing, then down to the floor once.
      : (a, b) => coolGroup(a, owned)-coolGroup(b, owned) || setupKey(a, owned).localeCompare(setupKey(b, owned)) || rank.get(a.id)-rank.get(b.id);
    return selected.slice().sort(order);
  }
  function coolGroup(exercise, owned) {
    if (exercise.bodyPosition==='floor') return 2;
    return G().sectionSetupKey(exercise, owned)==='bodyweight' ? 1 : 0;
  }

  function transitionsFor(ordered, owned) {
    const list = [];
    ordered.forEach((exercise, index) => {
      for (let side=1; side<sides(exercise).length; side++) list.push({type:'side', seconds:TRANSITION.side, base:TRANSITION.side});
      const next = ordered[index+1];
      if (next) {
        const type = setupKey(exercise, owned)===setupKey(next, owned) ? 'exercise' : 'setup';
        list.push({type, seconds:TRANSITION[type], base:TRANSITION[type]});
      }
    });
    return list;
  }

  // Fits whole-second work values to exactly `total` seconds within each exercise's bounds,
  // spreading the difference evenly. Per-side work moves both sides together; an odd
  // remainder that only per-side work could absorb is taken by one transition instead.
  function solveDurations(items, transitions, total) {
    const values = items.map(item => item.preferred);
    const work = () => values.reduce((sum, value, index) => sum + value*items[index].sides, 0);
    const transitionTotal = () => transitions.reduce((sum, item) => sum + item.seconds, 0);
    let delta = total - work() - transitionTotal();
    for (let guard=0; delta!==0 && guard<10000; guard++) {
      const step = delta>0 ? 1 : -1;
      const movable = items.map((item, index) => index).filter(index => {
        const next = values[index]+step;
        return next>=items[index].min && next<=items[index].max && items[index].sides<=Math.abs(delta);
      });
      if (movable.length) {
        // The value furthest from its preference in the direction of travel moves first.
        movable.sort((a, b) => step*(values[a]-items[a].preferred)-step*(values[b]-items[b].preferred) || items[a].sides-items[b].sides || a-b);
        values[movable[0]] += step; delta -= step*items[movable[0]].sides;
        continue;
      }
      const transition = transitions.find(item => step>0 ? item.seconds<item.base+TRANSITION_SLACK : item.seconds>item.base);
      if (transition) { transition.seconds += step; delta -= step; continue; }
      // An odd deficit with only per-side work left: shorten one per-side exercise and lengthen a transition.
      const reducible = step<0 ? items.map((item, index) => index).filter(index => items[index].sides===2 && values[index]-1>=items[index].min)
        .sort((a, b) => (values[b]-items[b].preferred)-(values[a]-items[a].preferred) || a-b)[0] ?? -1 : -1;
      const spare = transitions.find(item => item.seconds<item.base+TRANSITION_SLACK);
      if (reducible>=0 && spare) { values[reducible] -= 1; spare.seconds += 1; delta += 1; continue; }
      break;
    }
    return {values, feasible:delta===0};
  }

  function buildPhases(ordered, values, transitions) {
    const phases = [];
    let cursor = 0;
    ordered.forEach((exercise, exerciseIndex) => {
      sides(exercise).forEach(side => {
        const transition = transitions[cursor++];
        phases.push({
          id:exercise.id,
          name:side ? exercise.name+' - '+side.charAt(0).toUpperCase()+side.slice(1) : exercise.name,
          side, exerciseIndex, work:values[exerciseIndex], rest:transition ? transition.seconds : 0,
          transition:transition ? transition.type : null,
          timedCues:(exercise.timedCues || []).map(cue => ({text:cue.text, at:Object.assign({}, cue.at)}))
        });
      });
    });
    return phases;
  }

  function coverageOf(kind, exercises) {
    return Object.fromEntries(REQUIREMENTS[kind].map(requirement => [requirement.key, met(requirement, exercises)]));
  }
  function coverageDoses(kind, exercises) {
    return Object.fromEntries(REQUIREMENTS[kind].map(requirement => [requirement.key, Math.round(dose(requirement, exercises)*100)/100]));
  }

  function resolveEquipment(variant, equipment) {
    return variant==='equipment' && Array.isArray(equipment) ? equipment.filter(id => typeof id==='string') : [];
  }

  // generateRoutine({kind, variant, catalogue, equipment, recentHistory, random})
  // kind 'warmup' | 'cooldown'; variant 'bodyweight' (no equipment) | 'equipment' (only the
  // given inventory); recentHistory: newest-first completed sessions of this kind.
  function generateRoutine(options) {
    options = options || {};
    const kind = options.kind, variant = options.variant || 'bodyweight';
    if (!KINDS.includes(kind)) throw new Error('Unknown routine kind: '+kind);
    if (!VARIANTS.includes(variant)) throw new Error('Unknown routine variant: '+variant);
    const catalogue = options.catalogue || (root.GarageFitData && root.GarageFitData.exercises);
    const owned = resolveEquipment(variant, options.equipment);
    const context = {kind, catalogue, owned, random:options.random || Math.random, sessions:recentSessions(options.recentHistory)};
    const pool = eligible(kind, catalogue, owned);
    const requirements = REQUIREMENTS[kind];
    const selected = [];
    const unmet = () => requirements.filter(requirement => !met(requirement, selected));
    const available = exercise => !blocked(exercise, selected);

    // 1. Essential coverage first, scarcest requirement first; coverage outranks anti-clustering.
    const helps = requirement => exercise => requirement.contribution(exercise)>0;
    const scarcity = requirement => pool.filter(helps(requirement)).length;
    for (let guard=0; guard<requirements.length*3; guard++) {
      const open = unmet().filter(requirement => pool.some(exercise => helps(requirement)(exercise) && available(exercise)));
      if (!open.length) break;
      open.sort((a, b) => scarcity(a)-scarcity(b) || requirements.indexOf(a)-requirements.indexOf(b));
      const requirement = open[0];
      const candidates = pool.filter(exercise => helps(requirement)(exercise) && available(exercise));
      const relaxed = candidates.filter(exercise => !overCluster(exercise, selected, kind));
      selected.push(pick(relaxed.length ? relaxed : candidates, selected, context, unmet()));
    }

    // 2. Fill towards five minutes at preferred timings with fresh, varied movements.
    const projected = list => {
      const ordered = orderExercises(kind, list, owned);
      return ordered.reduce((sum, exercise) => sum + bounds(exercise, kind).preferred*sides(exercise).length, 0) +
        transitionsFor(ordered, owned).reduce((sum, item) => sum + item.seconds, 0);
    };
    const capacity = list => {
      const ordered = orderExercises(kind, list, owned);
      const transitions = transitionsFor(ordered, owned).reduce((sum, item) => sum + item.seconds, 0);
      return {min:ordered.reduce((sum, exercise) => sum + bounds(exercise, kind).min*sides(exercise).length, 0)+transitions,
        max:ordered.reduce((sum, exercise) => sum + bounds(exercise, kind).max*sides(exercise).length, 0)+transitions+transitionsFor(ordered, owned).length*TRANSITION_SLACK};
    };
    for (let guard=0; guard<40; guard++) {
      const candidates = pool.filter(exercise => available(exercise) && !overCluster(exercise, selected, kind));
      if (!candidates.length) break;
      const fits = candidates.filter(exercise => capacity(selected.concat(exercise)).min<=ROUTINE_SECONDS);
      const current = projected(selected);
      // Stop once another movement would overshoot more than the current plan falls short.
      const helpful = fits.filter(exercise => Math.abs(projected(selected.concat(exercise))-ROUTINE_SECONDS)<Math.abs(current-ROUTINE_SECONDS) || capacity(selected).max<ROUTINE_SECONDS);
      if (!helpful.length) break;
      selected.push(pick(helpful, selected, context, []));
    }

    // 3. Timing repair: drop a non-essential movement if the minimum cannot fit.
    for (let guard=0; guard<selected.length && capacity(selected).min>ROUTINE_SECONDS; guard++) {
      const index = selected.map((exercise, i) => i).reverse().find(i => {
        const without = selected.filter((_, j) => j!==i);
        return requirements.every(requirement => !met(requirement, selected) || met(requirement, without));
      });
      if (index===undefined) break;
      selected.splice(index, 1);
    }

    const ordered = orderExercises(kind, selected, owned);
    const transitions = transitionsFor(ordered, owned);
    const items = ordered.map(exercise => Object.assign({sides:sides(exercise).length}, bounds(exercise, kind)));
    const solved = solveDurations(items, transitions, ROUTINE_SECONDS);
    const phases = buildPhases(ordered, solved.values, transitions);
    const coverage = coverageOf(kind, ordered);
    const diagnostics = Object.entries(coverage).filter(([, met]) => !met).map(([key]) => kind+':missing-'+key);
    if (!solved.feasible) diagnostics.push(kind+':timing-infeasible');
    const routine = {
      schemaVersion:1, kind, variant, equipment:owned.slice(),
      exercises:ordered.map((exercise, index) => ({id:exercise.id, name:exercise.name, sidedness:exercise.sidedness, sides:sides(exercise).filter(Boolean), work:solved.values[index]})),
      phases,
      transitionSeconds:phases.reduce((sum, phase) => sum + phase.rest, 0),
      estimatedSeconds:phases.reduce((sum, phase) => sum + phase.work + phase.rest, 0),
      coverage, coverageDoses:coverageDoses(kind, ordered), diagnostics
    };
    return routine;
  }

  // Structural check of a playback-ready routine against the timing and duplication contract.
  function validateRoutine(routine, catalogue) {
    catalogue = catalogue || (root.GarageFitData && root.GarageFitData.exercises);
    const issues = [];
    if (!routine || !Array.isArray(routine.phases) || !routine.phases.length) return ['routine:empty'];
    const total = routine.phases.reduce((sum, phase) => sum + phase.work + phase.rest, 0);
    if (total!==ROUTINE_SECONDS) issues.push('timing:total-'+total);
    routine.phases.forEach((phase, index) => {
      const last = index===routine.phases.length-1;
      if (!Number.isInteger(phase.work) || phase.work<10) issues.push('timing:work-'+phase.id);
      if (!Number.isInteger(phase.rest) || (last ? phase.rest!==0 : phase.rest<1)) issues.push('timing:rest-'+phase.id);
    });
    const exercises = routine.exercises.map(item => catalogue[item.id]).filter(Boolean);
    if (exercises.length!==routine.exercises.length) issues.push('catalogue:unknown-exercise');
    if (new Set(exercises.map(exercise => exercise.id)).size!==exercises.length) issues.push('duplicate:id');
    const families = exercises.map(exercise => exercise.family).filter(Boolean);
    if (new Set(families).size!==families.length) issues.push('duplicate:family');
    routine.exercises.forEach(item => {
      const occurrences = routine.phases.filter(phase => phase.id===item.id);
      if (new Set(occurrences.map(phase => phase.work)).size>1) issues.push('timing:unequal-sides-'+item.id);
      if (occurrences.length!==Math.max(1, item.sides.length)) issues.push('timing:occurrences-'+item.id);
    });
    const counts = new Map();
    exercises.forEach(exercise => clusterKeys(exercise, routine.kind).forEach(key => counts.set(key, (counts.get(key) || 0)+1)));
    for (const [key, count] of counts) if (count>CLUSTER_LIMIT) issues.push('cluster:'+key);
    return issues.concat(routine.diagnostics || []);
  }

  // ---- Lightweight routine recency ----
  // A separate, versioned record of the last three completed sessions per kind, shared by both
  // variants. It is independent of Generator Main history and Coach records.
  const HISTORY_KEY = 'gf_routine_recent_v1';
  const HISTORY_VERSION = 1;
  const HISTORY_LIMIT = 3;

  function emptyHistory() { return {version:HISTORY_VERSION, warmup:[], cooldown:[]}; }
  function sanitiseSessions(list) {
    return (Array.isArray(list) ? list : []).map(entry => {
      const ids = Array.isArray(entry) ? entry : entry && Array.isArray(entry.ids) ? entry.ids : null;
      if (!ids) return null;
      const clean = [...new Set(ids.filter(id => typeof id==='string' && id))];
      if (!clean.length) return null;
      const record = {ids:clean};
      if (entry && typeof entry.completedAt==='string') record.completedAt = entry.completedAt;
      return record;
    }).filter(Boolean).slice(0, HISTORY_LIMIT);
  }
  function readRoutineHistory(storage) {
    let parsed = null;
    try { parsed = JSON.parse(storage && storage.getItem(HISTORY_KEY)); } catch (error) { parsed = null; }
    if (!parsed || typeof parsed!=='object' || Array.isArray(parsed) || parsed.version!==HISTORY_VERSION) return emptyHistory();
    return {version:HISTORY_VERSION, warmup:sanitiseSessions(parsed.warmup), cooldown:sanitiseSessions(parsed.cooldown)};
  }
  function recentRoutineIds(history, kind) {
    return ((history && history[kind]) || []).map(entry => entry.ids.slice());
  }
  function recordRoutineCompletion(storage, kind, ids, completedAt) {
    if (!KINDS.includes(kind)) throw new Error('Unknown routine kind: '+kind);
    const history = readRoutineHistory(storage);
    const clean = [...new Set((ids || []).filter(id => typeof id==='string' && id))];
    if (!clean.length) return history;
    history[kind] = [{ids:clean, completedAt:completedAt || new Date().toISOString()}].concat(history[kind]).slice(0, HISTORY_LIMIT);
    try { storage && storage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (error) { /* storage unavailable: recency is best effort */ }
    return history;
  }

  // In-memory record of one run. Only occurrences that ran to completion count as performed;
  // skipped and unreached occurrences do not. History is written only by finish() (normal
  // completion); abandon() discards the run.
  function createRoutineRun(routine) {
    const outcomes = routine.phases.map(() => null);
    let state = 'active';
    const mark = (index, outcome) => { if (state==='active' && index>=0 && index<outcomes.length && outcomes[index]===null) outcomes[index] = outcome; };
    const performedIds = () => [...new Set(routine.phases.filter((_, index) => outcomes[index]==='completed').map(phase => phase.id))];
    return {
      get state() { return state; },
      complete(index) { mark(index, 'completed'); },
      skip(index) { mark(index, 'skipped'); },
      outcomes() { return outcomes.slice(); },
      performedIds,
      finish(options) {
        if (state!=='active') return null;
        state = 'finished';
        const ids = performedIds();
        options = options || {};
        if (options.storage && ids.length) recordRoutineCompletion(options.storage, routine.kind, ids, options.completedAt);
        return {kind:routine.kind, ids};
      },
      abandon() { if (state==='active') state = 'abandoned'; }
    };
  }

  root.GarageFitRoutineGenerator = {
    ROUTINE_SECONDS, KINDS, VARIANTS, TRANSITION, TIMING, CLUSTER_LIMIT, REQUIREMENTS,
    HISTORY_KEY, HISTORY_VERSION, HISTORY_LIMIT,
    generateRoutine, validateRoutine, solveDurations, coverageOf, coverageDoses,
    readRoutineHistory, recentRoutineIds, recordRoutineCompletion, createRoutineRun
  };
})(typeof window==='undefined' ? globalThis : window);
