#!/usr/bin/env node
// Full-catalogue reachability audit for generated workouts.
//
//   node scripts/audit-exercise-reachability.js            readable report
//   node scripts/audit-exercise-reachability.js --json     machine-readable result
//   node scripts/audit-exercise-reachability.js --seeds=40 larger sample
//   node scripts/audit-exercise-reachability.js --no-diagnostics   counts only (faster)
//
// Generates deterministic workouts with the canonical catalogue and the real generator, then
// counts, per generated phase (Main, Warm-up, Ramp-up, Cool-down), how many workouts include
// each exercise. Eligibility is the generator's own hard rule for the phase
// (GarageFitGenerator.generatedPhaseEligible), so fixed-workout-only entries and flagged
// exercises a phase rule excludes are never counted as failures.
//
// Sample: every supported duration x focus x representative equipment configuration, with
// DEFAULT_SEEDS seeded workouts per combination. Configurations are bodyweight only, the
// minimal equipment set of each distinct catalogue requirement, all equipment, and every
// two-equipment combination (so exercises that need a particular mix are exercised without
// naming any). The configuration count is derived from the catalogue and equipment list; the
// report prints the total workout count and runtime.
//
// Exit status is 1 when an exercise eligible for a generated phase has zero appearances across
// every configuration it is eligible in. Rare and dominant exercises are warnings for human
// review against their intended role: equal frequencies are not a goal.
//
// Each failure and rare warning also gets diagnostic evidence from the traced generator (see
// createCollector): eligibility, selection, its selection funnel against the phase median,
// rank and score against the shortlist window, the score components behind the gap, the
// competitors ranked directly above it, and a general classification of the likely cause.
// Diagnostics never change the counts, warnings or exit status.

const DEFAULT_SEEDS = 24;
const PHASES = ['main','warmup','rampup','cooldown'];
// Warnings compare appearances with an even share of the phase: in each workout, every
// eligible exercise is credited (exercises the phase used) / (exercises eligible for it).
// Below RARE_RATIO of that share across all configurations is rare; above DOMINANT_RATIO in
// any one equipment configuration is dominant there.
const RARE_RATIO = 0.2;
const DOMINANT_RATIO = 3;

function lcg(seed) {
  return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; };
}

// Deterministic seed for one workout of the matrix, decorrelated across combinations.
function workoutSeed(configIndex, focusIndex, duration, sample) {
  return ((sample+1)*2654435761 + configIndex*40503 + focusIndex*9973 + duration*131) >>> 0;
}

function phaseExercises(workout, phase) {
  if (phase==='main') return (workout.main && workout.main.blocks || []).flatMap(block => block.exercises || []);
  return (workout[phase] && workout[phase].exercises) || [];
}

// Every unordered pair of distinct equipment ids, sorted and keyed "a+b". Systematic by
// construction: no pair is named for any particular exercise.
function equipmentPairs(equipmentIds) {
  const ids = [...new Set(equipmentIds || [])].sort();
  const pairs = [];
  for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) pairs.push([ids[i],ids[j]]);
  return pairs;
}

// Bodyweight, the minimal set for each distinct catalogue requirement (first option of every
// alternative group), all equipment, and every two-equipment combination. Combinations already
// present (for example a catalogue requirement set of exactly two items) are not repeated.
function representativeConfigs(catalogue, equipmentIds) {
  const configs = new Map([['bodyweight',[]]]);
  for (const exercise of Object.values(catalogue)) {
    const set = [...new Set((exercise.equipment || []).map(group => group[0]))].sort();
    if (set.length) configs.set(set.join('+'),set);
  }
  if (equipmentIds && equipmentIds.length) configs.set('all-equipment',equipmentIds.slice().sort());
  for (const pair of equipmentPairs(equipmentIds)) if (!configs.has(pair.join('+'))) configs.set(pair.join('+'),pair);
  return [...configs].map(([key,equipment]) => ({key,equipment}));
}

// ---- Diagnostic evidence ----
// Every audited workout is generated with the generator's opt-in trace, which reports each
// selection slot: the candidates its filters removed (by rule), the scored candidates and the
// shortlist window controlledPick drew from, plus Main attempt and Ramp-up sequence outcomes.
// The collector only aggregates those events; scores, ranks and windows come from the
// generator itself, and score components from its own scorers (via `explain`).

// Score components are recomputed for one in DETAIL_SAMPLE scored slots of each exercise:
// recomputing every slot would more than double the audit's runtime.
const DETAIL_SAMPLE = 8;

// How far ahead `theirs` is of `mine`, per score component.
function componentGaps(theirs, mine) {
  const gaps = {};
  for (const label in theirs) gaps[label] = theirs[label];
  for (const label in mine) gaps[label] = (gaps[label]||0)-mine[label];
  return gaps;
}

function createCollector(selectionRanks, shortlistSize, detail) {
  const stats = new Map();
  let contextKey = null, workout = null;
  const stat = (phase, id) => {
    const key = phase+'|'+id;
    let entry = stats.get(key);
    if (!entry) stats.set(key, entry = { phase, id, slots:0, filtered:{}, scored:0, inWindow:0, picked:0, offered:0,
      ranks:new Map(), sizes:0, deficits:new Map(), best:null, above:new Map(), gaps:{}, gapCount:0, own:{}, ownCount:0,
      constructed:0, discarded:{} });
    return entry;
  };
  const add = (map, key, value) => map.set(key,(map.get(key)||0)+(value ?? 1));
  const bump = (object, key) => { object[key] = (object[key]||0)+1; };

  function pick(event) {
    const phase = event.phase, picked = event.picked;
    if (picked) {
      workout.constructed[phase].add(picked.id);
      if (workout.attempt[phase]) workout.attempt[phase].add(picked.id);
    }
    for (const stage of event.stages || []) for (const exercise of stage.removed) {
      const entry = stat(phase,exercise.id);
      entry.slots++; bump(entry.filtered,stage.label);
    }
    if (!event.scored) {
      for (const exercise of event.candidates) {
        const entry = stat(phase,exercise.id);
        entry.slots++; entry.offered++;
        if (exercise===picked) entry.picked++;
      }
      return;
    }
    const window = event.window;
    if (!window) return;
    const { sorted, threshold } = window;
    const shortlist = { size:shortlistSize, margin:window.band };
    const ranks = selectionRanks(sorted);
    sorted.forEach((item, index) => {
      const entry = stat(phase,item.exercise.id), rank = ranks[index];
      // Positive deficit: points short of the lowest score the shortlist window admits.
      const deficit = threshold-item.score, chosen = item.exercise===picked;
      const above = chosen || rank===1 ? null : sorted[rank-2].exercise; // nearest strictly higher score
      entry.slots++; entry.scored++; entry.sizes += sorted.length; entry.window = shortlist;
      add(entry.ranks,rank);
      add(entry.deficits,Math.round(deficit*10)/10);
      if (item.score>threshold) entry.inWindow++;
      if (chosen) entry.picked++;
      if (above) add(entry.above,above.id);
      const best = !entry.best || deficit<entry.best.deficit-1e-9;
      // Score components (the phase scorer's own labelled terms) are recomputed for a
      // deterministic systematic sample of slots, and exactly at each new best opportunity.
      const sampled = detail && (entry.scored-1)%DETAIL_SAMPLE===0;
      if (!sampled && !(detail && best)) return;
      const mine = event.explain(item.exercise), theirs = above ? event.explain(above) : null;
      if (best) entry.best = { deficit, score:item.score, threshold, rank, size:sorted.length, context:contextKey, slot:event.desired || null,
        above:above ? above.id : null, gaps:theirs ? componentGaps(theirs,mine) : null };
      if (!sampled) return;
      for (const label in mine) entry.own[label] = (entry.own[label]||0)+mine[label];
      entry.ownCount++;
      if (!theirs) return;
      const gaps = componentGaps(theirs,mine);
      for (const label in gaps) entry.gaps[label] = (entry.gaps[label]||0)+gaps[label];
      entry.gapCount++;
    });
  }

  function trace(event) {
    if (event.type==='pick') return pick(event);
    if (event.type==='main-attempt' || event.type==='rampup-attempt') {
      const phase = event.type==='main-attempt' ? 'main' : 'rampup';
      workout.attempts[phase].push({ attempt:event.attempt, issues:event.issues || [], ids:workout.attempt[phase] });
      workout.attempt[phase] = new Set();
    } else if (event.type==='main-result' || event.type==='rampup-result') {
      workout.chosen[event.type==='main-result' ? 'main' : 'rampup'] = event.attempt;
    } else if (event.type==='replace') workout.replaced.set(event.removed.id,event.rule);
  }

  function begin(key) {
    contextKey = key;
    const perPhase = make => Object.fromEntries(PHASES.map(phase => [phase,make()]));
    workout = { constructed:perPhase(() => new Set()), attempt:perPhase(() => new Set()), attempts:perPhase(() => []), chosen:{}, replaced:new Map() };
  }

  // Why an exercise picked while this workout was being built is absent from the result.
  function discardReason(phase, id) {
    if (phase==='warmup' && workout.replaced.has(id)) return 'replaced:'+workout.replaced.get(id);
    const attempts = workout.attempts[phase].filter(attempt => attempt.ids.has(id));
    if (!attempts.length) return 'discarded';
    if (attempts.some(attempt => attempt.attempt===workout.chosen[phase])) return phase==='main' ? 'block-rebuilt' : 'discarded';
    const rejected = attempts.filter(attempt => attempt.issues.length);
    if (rejected.length===attempts.length) {
      const kinds = {};
      for (const attempt of rejected) for (const issue of attempt.issues) bump(kinds,issue.split(':')[1]);
      return 'rejected-attempt:'+Object.keys(kinds).sort((a,b) => kinds[b]-kinds[a] || a.localeCompare(b))[0];
    }
    return phase==='main' ? 'fitter-attempt-chosen' : 'fitter-sequence-chosen';
  }

  function end(result) {
    for (const phase of PHASES) {
      const final = new Set(phaseExercises(result,phase).map(exercise => exercise.id));
      for (const id of workout.constructed[phase]) {
        const entry = stat(phase,id);
        entry.constructed++;
        if (!final.has(id)) bump(entry.discarded,discardReason(phase,id));
      }
    }
    workout = null;
  }

  return { trace, begin, end, stats };
}

// options: { catalogue, generate, isEligible, durations, focuses, configs, seeds,
//            rareRatio, dominantRatio, requirementsMet, selectionRanks, diagnose, detail }
// With `selectionRanks` (GarageFitGenerator.selectionRanks) and `diagnose` not false, workouts
// are traced and every failure and rare warning gets diagnostic evidence (result.diagnostics).
function runAudit(options) {
  const { catalogue, generate, isEligible, durations, focuses, configs } = options;
  const seeds = options.seeds || DEFAULT_SEEDS;
  const rareRatio = options.rareRatio ?? RARE_RATIO, dominantRatio = options.dominantRatio ?? DOMINANT_RATIO;
  const exercises = Object.values(catalogue);
  const phases = {};
  for (const phase of PHASES) phases[phase] = {};
  const flagged = (exercise, phase) => phase==='main' ? !!(exercise.generator && exercise.main) : !!exercise[phase];
  let workouts = 0;
  const collector = options.selectionRanks && options.diagnose!==false ? createCollector(options.selectionRanks,options.shortlistSize,options.detail!==false) : null;

  configs.forEach((config, configIndex) => {
    const eligible = {};
    for (const phase of PHASES) eligible[phase] = exercises.filter(exercise => isEligible(exercise,phase,config.equipment));
    focuses.forEach((focus, focusIndex) => durations.forEach(duration => {
      for (let sample=0; sample<seeds; sample++) {
        const request = { catalogue, duration, focus, equipment:config.equipment, random:lcg(workoutSeed(configIndex,focusIndex,duration,sample)) };
        if (collector) { collector.begin([config.key,focus,duration].join('|')); request.trace = collector.trace; }
        const workout = generate(request);
        if (collector) collector.end(workout);
        workouts++;
        for (const phase of PHASES) {
          const used = new Set(phaseExercises(workout,phase).map(exercise => exercise.id));
          const share = eligible[phase].length ? used.size/eligible[phase].length : 0;
          for (const exercise of eligible[phase]) {
            const entry = phases[phase][exercise.id] || (phases[phase][exercise.id] = { id:exercise.id, workouts:0, appearances:0, evenShare:0, contexts:{} });
            const contextKey = [config.key,focus,duration].join('|');
            const context = entry.contexts[contextKey] || (entry.contexts[contextKey] = { equipment:config.key, focus, duration, workouts:0, appearances:0, evenShare:0 });
            entry.workouts++; context.workouts++; entry.evenShare += share; context.evenShare += share;
            if (used.has(exercise.id)) { entry.appearances++; context.appearances++; }
          }
        }
      }
    }));
  });

  const result = { workouts, seeds, rareRatio, dominantRatio, phases:{}, failures:[], rare:[], dominant:[], excluded:[] };
  for (const phase of PHASES) {
    const entries = Object.values(phases[phase]).map(entry => Object.assign(entry, {
      rate: entry.workouts ? entry.appearances/entry.workouts : 0,
      shareRatio: entry.evenShare ? entry.appearances/entry.evenShare : 0
    })).sort((a,b) => a.id.localeCompare(b.id));
    result.phases[phase] = entries;
    for (const entry of entries) {
      const finding = { phase, id:entry.id, appearances:entry.appearances, workouts:entry.workouts, rate:entry.rate, shareRatio:entry.shareRatio };
      if (!entry.appearances) { result.failures.push(finding); continue; }
      if (entry.shareRatio<rareRatio) result.rare.push(finding);
      const peak = equipmentTotals(entry).filter(total => total.evenShare && total.appearances/total.evenShare>dominantRatio)
        .sort((a,b) => b.appearances/b.evenShare-a.appearances/a.evenShare)[0];
      if (peak) result.dominant.push({ phase, id:entry.id, equipment:peak.equipment, appearances:peak.appearances, workouts:peak.workouts,
        rate:peak.appearances/peak.workouts, shareRatio:peak.appearances/peak.evenShare });
    }
    // Flagged for the phase but never eligible in any audited configuration (e.g. a high-impact
    // exercise flagged for Warm-up): reported for information, not as a failure.
    for (const exercise of exercises) if (flagged(exercise,phase) && !phases[phase][exercise.id]) result.excluded.push({ phase, id:exercise.id });
  }
  if (collector) {
    const evidence = { catalogue, configs, isEligible, requirementsMet:options.requirementsMet, stats:collector.stats, peers:peerFunnels(collector.stats,phases) };
    const entryFor = finding => phases[finding.phase][finding.id];
    result.diagnostics = result.failures.map(finding => diagnose('failure',finding,entryFor(finding),evidence))
      .concat(result.rare.map(finding => diagnose('rare',finding,entryFor(finding),evidence)));
  }
  return result;
}

// The selection funnel of one exercise: the share of its slots that survive the filters, the
// share of scored slots inside the shortlist window, the share of window places it is drawn
// from, and the share of workouts that keep it after it is drawn.
const FUNNEL = ['filters','window','draw','kept'];
function funnel(stat) {
  const kept = stat.constructed-Object.values(stat.discarded).reduce((sum,count) => sum+count,0);
  const stage = (part, whole) => ({ part, whole, rate:whole ? part/whole : null });
  return { filters:stage(stat.scored+stat.offered,stat.slots), window:stage(stat.inWindow,stat.scored),
    draw:stage(stat.picked,stat.scored ? stat.inWindow : stat.offered), kept:stage(kept,stat.constructed) };
}

// Median funnel stage of every audited exercise in each phase: the reference for "unusually low".
function peerFunnels(stats, phases) {
  const peers = {};
  for (const phase of PHASES) {
    const funnels = Object.keys(phases[phase]).map(id => stats.get(phase+'|'+id)).filter(Boolean).map(funnel);
    peers[phase] = {};
    for (const stage of FUNNEL) {
      const values = funnels.map(item => item[stage].rate).filter(value => value!=null).sort((a,b) => a-b);
      peers[phase][stage] = values.length ? values[Math.floor((values.length-1)/2)] : null;
    }
  }
  return peers;
}

// Median of a value->count histogram.
function histogramMedian(histogram) {
  const keys = [...histogram.keys()].sort((a,b) => a-b);
  const total = keys.reduce((sum,key) => sum+histogram.get(key),0);
  let seen = 0;
  for (const key of keys) { seen += histogram.get(key); if (seen*2>=total) return key; }
  return null;
}

// Labelled components sorted by magnitude in the given direction (sign 1: largest positive),
// as {label, value} means rounded to 0.1; zero-valued components are dropped.
function topComponents(sums, count, sign, limit) {
  if (!count) return [];
  return Object.entries(sums).map(([label,sum]) => ({ label, value:Math.round(sum/count*10)/10 }))
    .filter(item => item.value*sign>0).sort((a,b) => (b.value-a.value)*sign || a.label.localeCompare(b.label)).slice(0,limit);
}

function describeExercise(exercise) {
  return { id:exercise.id, mainRole:exercise.mainRole || null, family:exercise.family || null, repetitionClass:exercise.repetitionClass || null,
    patterns:(exercise.patterns || []).concat(exercise.conditioning ? ['conditioning'] : []),
    equipment:(exercise.equipment || []).map(group => group.join('/')).join('+') || 'bodyweight' };
}

function diagnose(kind, finding, entry, evidence) {
  const { catalogue, configs, isEligible, requirementsMet } = evidence;
  const exercise = catalogue[finding.id], stat = evidence.stats.get(finding.phase+'|'+finding.id);
  const eligibleConfigs = configs.filter(config => isEligible(exercise,finding.phase,config.equipment));
  const equipmentExcluded = requirementsMet ? configs.filter(config => !requirementsMet(exercise,config.equipment)).length : configs.length-eligibleConfigs.length;
  const byEquipment = equipmentTotals(entry).map(total => ({ equipment:total.equipment, appearances:total.appearances, workouts:total.workouts, rate:total.appearances/total.workouts }));
  const appearing = byEquipment.filter(total => total.appearances).sort((a,b) => b.rate-a.rate || a.equipment.localeCompare(b.equipment));
  const diagnosis = {
    kind, phase:finding.phase, id:finding.id,
    eligibility:{ configs:eligibleConfigs.length, of:configs.length, examples:eligibleConfigs.slice(0,3).map(config => config.key),
      equipmentExcluded, phaseExcluded:configs.length-eligibleConfigs.length-equipmentExcluded },
    selection:{ appearances:finding.appearances, workouts:finding.workouts, rate:finding.rate,
      configs:appearing.length, appearsIn:appearing.slice(0,3).map(total => total.equipment), best:appearing[0] || null },
    slots:null
  };
  if (stat) Object.assign(diagnosis,slotEvidence(stat,catalogue),{ funnel:funnel(stat), peers:evidence.peers[finding.phase] });
  diagnosis.classification = classify(diagnosis,exercise,catalogue);
  return diagnosis;
}

// Rank, score and competitor evidence from one exercise's traced selection slots.
function slotEvidence(stat, catalogue) {
  const filteredSlots = Object.values(stat.filtered).reduce((sum,count) => sum+count,0);
  const aboveTotal = [...stat.above.values()].reduce((sum,count) => sum+count,0);
  const competitors = [...stat.above].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,3)
    .map(([id,count]) => Object.assign(describeExercise(catalogue[id]),{ count, share:count/aboveTotal }));
  const round = value => Math.round(value*100)/100;
  const best = stat.best && Object.assign({},stat.best,{ deficit:round(stat.best.deficit), score:round(stat.best.score), threshold:round(stat.best.threshold),
    gaps:stat.best.gaps ? topComponents(stat.best.gaps,1,1,3) : [] });
  return {
    slots:{ total:stat.slots, filtered:filteredSlots, filteredBy:sortedCounts(stat.filtered), scored:stat.scored, offered:stat.offered,
      inWindow:stat.inWindow, picked:stat.picked, builtInto:stat.constructed, discarded:sortedCounts(stat.discarded) },
    rank:stat.scored ? { best:Math.min(...stat.ranks.keys()), median:histogramMedian(stat.ranks), candidates:Math.round(stat.sizes/stat.scored), window:stat.window } : null,
    score:stat.scored ? { best, medianDeficit:histogramMedian(stat.deficits), sampled:stat.ownCount,
      penalties:topComponents(stat.own,stat.ownCount,-1,3), gaps:topComponents(stat.gaps,stat.gapCount,1,3) } : null,
    competitors
  };
}

function sortedCounts(counts) {
  return Object.entries(counts).sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(([label,count]) => ({ label, count }));
}

// Classification thresholds. Below MIN_SLOTS traced slots the evidence is too thin to classify;
// a score component must put the next-higher candidate DIFFUSE_GAP points ahead on average to
// count as the cause; a same-family competitor ranked directly above in at least
// VARIANT_SHARE of slots marks stronger direct variants.
const MIN_SLOTS = 20, DIFFUSE_GAP = 2, VARIANT_SHARE = .25;
// Score components and filters that enforce variety: repetition, relationships and reuse.
const REPETITION_RULES = new Set(['repetition-class','family-duplicate','family-cap','main-reuse','recent-history','major-pattern-repeat',
  'adjacent-pattern','pattern-overlap','repeated-pattern','adjacent-high-impact']);
// Score components that depend on the equipment in use rather than on the exercise.
const EQUIPMENT_RULES = new Set(['equipment-continuity','equipment-diversity','same-setup','main-equipment']);

// A short, general label for where and why the exercise loses selections. It names the funnel
// stage furthest below the phase median and the rule behind it; it is guidance, not a decision.
function classify(diagnosis, exercise, catalogue) {
  const result = (label, basis) => ({ label, stage, basis });
  const { slots, funnel:stages, peers } = diagnosis;
  let stage = null;
  if (!slots || slots.total<MIN_SLOTS) return result('insufficient evidence',(slots ? slots.total : 0)+' traced selection slots');
  // Additive smoothing keeps a stage observed only a few times (e.g. one drawn workout) from
  // outweighing stages observed thousands of times.
  let lowest = Infinity;
  for (const name of FUNNEL) {
    const { part, whole } = stages[name];
    if (!whole || !peers[name]) continue;
    const relative = (part+1)/(whole+2)/peers[name];
    if (relative<lowest) { lowest = relative; stage = name; }
  }
  if (!stage) return result('insufficient evidence','no funnel stage to compare with the phase');
  const versus = percent(stages[stage].rate)+' vs phase median '+percent(peers[stage]);
  if (stage==='filters') {
    const rule = slots.filteredBy[0];
    return result(REPETITION_RULES.has(rule.label) ? 'duplicate/family/repetition filtering' : 'phase/metadata mismatch',
      'past pre-score filters in '+versus+'; mostly removed by '+rule.label);
  }
  if (stage==='kept') {
    const reason = slots.discarded[0];
    return result(reason && /family|duplicate/.test(reason.label) ? 'duplicate/family/repetition filtering' : 'later-stage rejection',
      'kept in '+versus+' of the workouts that drew it'+(reason ? '; lost to '+reason.label : ''));
  }
  const where = (stage==='window' ? 'in the shortlist window in ' : 'drawn from the window in ')+versus;
  const variant = diagnosis.competitors[0];
  if (variant && exercise.family && variant.family===exercise.family && variant.share>=VARIANT_SHARE)
    return result('stronger direct variants',where+'; same-family '+variant.id+' ranks directly above in '+percent(variant.share));
  const gap = diagnosis.score && diagnosis.score.gaps[0];
  if (!gap || gap.value<DIFFUSE_GAP)
    return result('fixed candidate-window crowding',where+'; no single score component puts the next-higher candidate '+DIFFUSE_GAP+'+ points ahead'+(gap ? ' (largest '+gap.label+' '+signed(gap.value)+')' : ''));
  const lead = '; the next-higher candidate leads on '+gap.label+' by '+gap.value.toFixed(1);
  if (gap.label==='supporting-role') return result('supporting-role crowding',where+lead);
  if (REPETITION_RULES.has(gap.label)) return result('duplicate/family/repetition filtering',where+lead);
  if (EQUIPMENT_RULES.has(gap.label)) return result('equipment-context limitation',where+lead);
  return result('phase/metadata mismatch',where+lead);
}

// One entry's contexts summed per equipment configuration.
function equipmentTotals(entry) {
  const totals = new Map();
  for (const context of Object.values(entry.contexts)) {
    const total = totals.get(context.equipment) || { equipment:context.equipment, workouts:0, appearances:0, evenShare:0 };
    total.workouts += context.workouts; total.appearances += context.appearances; total.evenShare += context.evenShare;
    totals.set(context.equipment,total);
  }
  return [...totals.values()];
}

const percent = value => (100*value).toFixed(1)+'%';

// Per-equipment, per-focus and per-duration breakdown of one audited exercise.
function breakdown(entry) {
  const groups = { equipment:new Map(), focus:new Map(), duration:new Map() };
  for (const context of Object.values(entry.contexts)) for (const [name,map] of Object.entries(groups)) {
    const key = context[name], total = map.get(key) || { workouts:0, appearances:0 };
    total.workouts += context.workouts; total.appearances += context.appearances;
    map.set(key,total);
  }
  return Object.entries(groups).map(([name,map]) => name+' '+[...map].map(([key,total]) => key+' '+total.appearances+'/'+total.workouts).join(', ')).join('\n      ');
}

const signed = value => (value>0?'+':'')+value.toFixed(1);
const components = list => list.map(item => item.label+' '+signed(item.value)).join(', ');
const counts = (list, limit) => list.slice(0,limit).map(item => item.label+' '+item.count).join(', ')+(list.length>limit?', +'+(list.length-limit)+' more':'');

// A failure's or rare warning's evidence as a few report lines.
function formatDiagnosis(diagnosis) {
  const { eligibility, selection, slots, rank, score, funnel:stages, peers } = diagnosis;
  const lines = ['diagnosis: '+diagnosis.classification.label+' ('+diagnosis.classification.basis+')'];
  const examples = eligibility.examples.join(', ')+(eligibility.configs>eligibility.examples.length?', +'+(eligibility.configs-eligibility.examples.length)+' more':'');
  lines.push('eligible   '+eligibility.configs+'/'+eligibility.of+' configs ('+examples+'); excluded by equipment '+eligibility.equipmentExcluded+', by phase rules '+eligibility.phaseExcluded);
  lines.push('selected   '+(selection.best ? 'in '+selection.configs+'/'+eligibility.configs+' configs; best '+selection.best.equipment+' '+selection.best.appearances+'/'+selection.best.workouts+' ('+percent(selection.best.rate)+')' : 'never'));
  if (!slots) { lines.push('trace      no traced selection slots'); return lines; }
  const versus = stage => stages[stage].rate==null ? 'n/a' : percent(stages[stage].rate)+(peers[stage]==null ? '' : ' (phase median '+percent(peers[stage])+')');
  lines.push('funnel     '+slots.total+' slots: past filters '+versus('filters')+(slots.filteredBy.length ? ' [removed by '+counts(slots.filteredBy,2)+']' : ''));
  if (slots.scored) lines.push('           in window '+versus('window')+'; drawn '+versus('draw')+'; kept '+versus('kept')+' of '+slots.builtInto+' workouts'+(slots.discarded.length ? ' [lost to '+counts(slots.discarded,2)+']' : ''));
  else lines.push('           unscored: drawn '+versus('draw')+'; kept '+versus('kept'));
  if (rank) lines.push('rank       best '+rank.best+', median '+rank.median+' of ~'+rank.candidates+' (window: top '+rank.window.size+(rank.window.margin ? ' + '+rank.window.margin+' pts' : '')+')');
  if (score) {
    const best = score.best;
    lines.push('score      points short of the window boundary (negative: inside): smallest '+signed(best.deficit)+' at '+best.context+(best.slot ? ' '+best.slot+' slot' : '')+
      (best.deficit>0 && best.above ? ' behind '+best.above+(best.gaps.length ? ' ('+components(best.gaps)+')' : '') : '')+'; median '+signed(score.medianDeficit));
    if (score.sampled) lines.push('           components (mean of '+score.sampled+' sampled slots): own penalties '+(components(score.penalties) || 'none')+'; lead of the next-higher candidate '+(components(score.gaps) || 'none'));
  }
  if (diagnosis.competitors.length) lines.push('above      '+diagnosis.competitors.map(item => item.id+' '+percent(item.share)+' ['+[item.mainRole,item.patterns.join('/') || 'no pattern',item.equipment].concat(item.family ? ['family '+item.family] : []).join('; ')+']').join(', '));
  return lines;
}

function formatReport(result, elapsedMs) {
  const lines = [];
  const entryFor = finding => result.phases[finding.phase].find(entry => entry.id===finding.id);
  const describe = finding => '  '+finding.phase.padEnd(8)+' '+(finding.id+(finding.equipment?' ['+finding.equipment+']':'')).padEnd(46)+' '+String(finding.appearances).padStart(5)+'/'+String(finding.workouts).padEnd(5)+' '+percent(finding.rate).padStart(6)+'  x'+finding.shareRatio.toFixed(2)+' even share';
  lines.push('GarageFit exercise reachability audit');
  lines.push(result.workouts+' workouts ('+result.seeds+' seeds per equipment/focus/duration)'+(elapsedMs!=null?' in '+(elapsedMs/1000).toFixed(1)+'s':''));
  lines.push('');
  lines.push('Phase summary (eligible exercises / appeared / rare / dominant):');
  for (const phase of PHASES) {
    const entries = result.phases[phase];
    const count = list => list.filter(item => item.phase===phase).length;
    lines.push('  '+phase.padEnd(8)+' '+entries.length+' / '+entries.filter(entry => entry.appearances).length+' / '+count(result.rare)+' / '+count(result.dominant));
  }
  const section = (title, list, detail) => {
    lines.push('');
    lines.push(title+' ('+list.length+')');
    if (!list.length) lines.push('  none');
    for (const finding of list) {
      lines.push(describe(finding));
      if (detail) lines.push('      '+breakdown(entryFor(finding)));
      const diagnosis = detail && (result.diagnostics || []).find(item => item.phase===finding.phase && item.id===finding.id);
      if (diagnosis) lines.push(...formatDiagnosis(diagnosis).map(line => '      '+line));
    }
  };
  section('FAILURES: eligible but never selected', result.failures, true);
  section('Warnings: rare (below '+result.rareRatio+'x an even share)', result.rare, true);
  section('Warnings: dominant (above '+result.dominantRatio+'x an even share in one equipment configuration)', result.dominant, false);
  lines.push('');
  lines.push('Flagged for a phase but excluded by that phase\'s rules ('+result.excluded.length+')');
  lines.push(result.excluded.length ? '  '+result.excluded.map(item => item.phase+':'+item.id).join(', ') : '  none');
  lines.push('');
  lines.push('Warnings are for review against each exercise\'s intended role; equal frequency is not a goal.');
  lines.push(result.failures.length ? 'RESULT: FAIL ('+result.failures.length+' unreachable)' : 'RESULT: PASS');
  return lines.join('\n');
}

function loadApp() {
  global.window = global;
  require('../js/timed-cues.js');
  require('../data/equipment.js');
  require('../data/exercises.js');
  require('../js/generator.js');
  return { catalogue:GarageFitData.exercises, equipmentIds:GarageFitData.equipment.map(item => item.id), generator:GarageFitGenerator };
}

function main(argv) {
  const json = argv.includes('--json');
  const seedArg = argv.find(arg => arg.startsWith('--seeds='));
  const seeds = seedArg ? Number(seedArg.split('=')[1]) : DEFAULT_SEEDS;
  if (!Number.isInteger(seeds) || seeds<1) throw new Error('--seeds must be a positive integer');
  const { catalogue, equipmentIds, generator } = loadApp();
  generator.assertValidCatalogue(catalogue);
  const started = Date.now();
  const result = runAudit({
    catalogue, seeds,
    generate: generator.generate,
    isEligible: generator.generatedPhaseEligible,
    durations: Object.keys(generator.BUDGETS).map(Number),
    focuses: Object.keys(generator.RESTS),
    configs: representativeConfigs(catalogue,equipmentIds),
    requirementsMet: generator.requirementsMet,
    selectionRanks: generator.selectionRanks,
    shortlistSize: generator.SHORTLIST_SIZE,
    diagnose: !argv.includes('--no-diagnostics')
  });
  const elapsedMs = Date.now()-started;
  if (json) process.stdout.write(JSON.stringify(Object.assign({ elapsedMs }, result),null,2)+'\n');
  else process.stdout.write(formatReport(result,elapsedMs)+'\n');
  return result.failures.length ? 1 : 0;
}

module.exports = { DEFAULT_SEEDS, PHASES, RARE_RATIO, DOMINANT_RATIO, equipmentPairs, representativeConfigs, runAudit, formatReport, formatDiagnosis, classify, workoutSeed, main };

if (require.main===module) process.exitCode = main(process.argv.slice(2));
