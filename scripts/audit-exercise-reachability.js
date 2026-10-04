#!/usr/bin/env node
// Full-catalogue reachability audit for generated workouts.
//
//   node scripts/audit-exercise-reachability.js            readable report
//   node scripts/audit-exercise-reachability.js --json     machine-readable result
//   node scripts/audit-exercise-reachability.js --seeds=40 larger sample
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

// options: { catalogue, generate, isEligible, durations, focuses, configs, seeds,
//            rareRatio, dominantRatio }
function runAudit(options) {
  const { catalogue, generate, isEligible, durations, focuses, configs } = options;
  const seeds = options.seeds || DEFAULT_SEEDS;
  const rareRatio = options.rareRatio ?? RARE_RATIO, dominantRatio = options.dominantRatio ?? DOMINANT_RATIO;
  const exercises = Object.values(catalogue);
  const phases = {};
  for (const phase of PHASES) phases[phase] = {};
  const flagged = (exercise, phase) => phase==='main' ? !!(exercise.generator && exercise.main) : !!exercise[phase];
  let workouts = 0;

  configs.forEach((config, configIndex) => {
    const eligible = {};
    for (const phase of PHASES) eligible[phase] = exercises.filter(exercise => isEligible(exercise,phase,config.equipment));
    focuses.forEach((focus, focusIndex) => durations.forEach(duration => {
      for (let sample=0; sample<seeds; sample++) {
        const workout = generate({ catalogue, duration, focus, equipment:config.equipment, random:lcg(workoutSeed(configIndex,focusIndex,duration,sample)) });
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
  return result;
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
    configs: representativeConfigs(catalogue,equipmentIds)
  });
  const elapsedMs = Date.now()-started;
  if (json) process.stdout.write(JSON.stringify(Object.assign({ elapsedMs }, result),null,2)+'\n');
  else process.stdout.write(formatReport(result,elapsedMs)+'\n');
  return result.failures.length ? 1 : 0;
}

module.exports = { DEFAULT_SEEDS, PHASES, RARE_RATIO, DOMINANT_RATIO, equipmentPairs, representativeConfigs, runAudit, formatReport, workoutSeed, main };

if (require.main===module) process.exitCode = main(process.argv.slice(2));
