(function (root) {
  const BUDGETS = {
    10:{warmup:120,main:420,cooldown:60},
    15:{warmup:120,main:660,cooldown:120},
    20:{warmup:180,main:900,cooldown:120},
    30:{warmup:240,main:1380,cooldown:180},
    45:{warmup:300,main:2100,cooldown:300}
  };
  const RESTS = {
    strength:{exercise:20,round:60},
    balanced:{exercise:15,round:45},
    cardio:{exercise:10,round:30}
  };
  const RECIPES = {
    strength:['squat','hinge','push','pull','core','carry','lunge'],
    balanced:['squat','push','pull','hinge','conditioning','core','lunge'],
    cardio:['conditioning','hinge','lunge','core','squat','push','pull']
  };
  const SIZE = {
    10:{count:3,minCount:3,maxCount:4,minRounds:2,maxRounds:2},
    15:{count:4,minCount:3,maxCount:5,minRounds:2,maxRounds:3},
    20:{count:5,minCount:4,maxCount:5,minRounds:3,maxRounds:3},
    30:{count:6,minCount:5,maxCount:6,minRounds:3,maxRounds:4},
    45:{count:7,minCount:6,maxCount:7,minRounds:4,maxRounds:5}
  };

  function requirementsMet(exercise, owned) {
    const equipment = new Set(owned || []);
    return (exercise.equipment || []).every(group => group.some(id => equipment.has(id)));
  }

  function recentPenalty(id, history) {
    for (let i=0;i<(history || []).length;i++) {
      if ((history[i] || []).includes(id)) return i===0 ? 12 : i===1 ? 6 : Math.max(1,4-i);
    }
    return 0;
  }

  function primaryEquipment(exercise) {
    return exercise.equipment && exercise.equipment.length ? exercise.equipment[0][0] : 'bodyweight';
  }

  function sharedPatterns(first, second) {
    if (!first || !second) return [];
    return (first.patterns || []).filter(pattern => (second.patterns || []).includes(pattern));
  }

  function scoreCandidate(exercise, desiredPattern, selected, focus, history) {
    let score = 0;
    const previous = selected[selected.length-1];
    const selectedPatterns = selected.flatMap(item => item.patterns || []);
    const overlaps = (exercise.patterns || []).filter(pattern => selectedPatterns.includes(pattern)).length;
    if ((exercise.patterns || []).includes(desiredPattern)) score += 8;
    else if ((exercise.patterns || []).some(pattern => RECIPES[focus].includes(pattern))) score += 2;
    if (focus==='strength') score += exercise.strength * 1.7 + exercise.cardio * .15;
    else if (focus==='cardio') score += exercise.cardio * 1.7 + exercise.strength * .2;
    else score += exercise.strength * .85 + exercise.cardio * .85;
    score += overlaps===0 ? 2 : -2.25 * overlaps;
    score -= recentPenalty(exercise.id, history);
    if (previous) {
      // Normally alternate movement patterns so one area is not fatigued by
      // back-to-back variations (for example, clean and press then press).
      // This is deliberately a penalty rather than a ban: a limited equipment
      // pool can still produce a complete workout, and occasional fatigue
      // pairings remain possible.
      score -= sharedPatterns(previous,exercise).length * 12;
      const sameEquipment = primaryEquipment(previous)===primaryEquipment(exercise);
      if (sameEquipment) score += 2.2;
      else if (primaryEquipment(exercise)==='bodyweight') score += .6;
      else score -= 1.2;
      if (previous.impact==='high' && exercise.impact==='high') score -= 12;
      if (previous.load && exercise.load && previous.load!==exercise.load) score -= 1.8;
    }
    const highCount = selected.filter(item => item.impact==='high').length;
    if (exercise.impact==='high' && highCount>=Math.ceil((selected.length+1)/2)) score -= 5;
    return score;
  }

  function controlledPick(scored, random) {
    const top = scored.sort((a,b)=>b.score-a.score).slice(0,4);
    if (!top.length) return null;
    const weights = top.map((item,index)=>Math.max(1,4-index) * Math.max(1,item.score-top[top.length-1].score+1));
    let roll = random() * weights.reduce((sum,value)=>sum+value,0);
    for (let i=0;i<top.length;i++) {
      roll -= weights[i];
      if (roll<=0) return top[i].exercise;
    }
    return top[0].exercise;
  }

  function selectExercises(eligible, count, focus, history, random) {
    const selected = [];
    const recipe = RECIPES[focus];
    for (let slot=0;slot<count;slot++) {
      const desired = recipe[slot % recipe.length];
      let candidates = eligible.filter(exercise => !selected.some(item => item.id===exercise.id));
      const patternMatches = candidates.filter(exercise => exercise.patterns.includes(desired));
      const previous = selected[selected.length-1];
      const variedPatternMatches = patternMatches.filter(exercise => !sharedPatterns(previous,exercise).length);
      if (variedPatternMatches.length) candidates = variedPatternMatches;
      else if (patternMatches.length && !previous) candidates = patternMatches;
      const scored = candidates.map(exercise => ({exercise,score:scoreCandidate(exercise,desired,selected,focus,history)}));
      const picked = controlledPick(scored,random);
      if (picked) selected.push(picked);
    }
    return selected;
  }

  function estimateMain(exercises, rounds, rest) {
    const work = exercises.reduce((sum,exercise)=>sum+exercise.estimatedSeconds,0);
    const exerciseRests = Math.max(0,exercises.length-1) * rest.exercise;
    return rounds * (work + exerciseRests) + Math.max(0,rounds-1) * rest.round;
  }

  function buildSection(catalogue, kind, targetSeconds, owned, random) {
    let candidates = Object.values(catalogue).filter(exercise => exercise[kind] && requirementsMet(exercise,owned)).map(exercise => {
      if (kind==='warmup' && exercise.warmupPrescription) return Object.assign({},exercise,{prescription:Object.assign({},exercise.warmupPrescription),estimatedSeconds:exercise.warmupEstimatedSeconds || exercise.warmupPrescription.value});
      return exercise;
    });
    const picked = [], restSeconds = 5;
    let total = 0;
    while (candidates.length && total < targetSeconds-10) {
      const fitting = candidates.filter(exercise => total + exercise.estimatedSeconds + (picked.length?restSeconds:0) <= targetSeconds+5);
      if (!fitting.length) break;
      const index = Math.floor(random()*fitting.length);
      const exercise = fitting[index];
      picked.push(exercise);
      total += exercise.estimatedSeconds + (picked.length>1?restSeconds:0);
      candidates = candidates.filter(item => item.id!==exercise.id);
    }
    return { exercises:picked, restSeconds, estimatedSeconds:total };
  }

  function copyExercise(exercise) {
    return Object.assign({},exercise,{patterns:exercise.patterns.slice(),equipment:exercise.equipment.map(group=>group.slice()),prescription:Object.assign({},exercise.prescription)});
  }

  function generate(options) {
    const catalogue = options.catalogue;
    const duration = Number(options.duration);
    const focus = String(options.focus || 'balanced').toLowerCase();
    const owned = options.equipment || [];
    const history = options.history || [];
    const random = options.random || Math.random;
    const budget = BUDGETS[duration] || BUDGETS[20];
    const rest = RESTS[focus] || RESTS.balanced;
    const sizing = SIZE[duration] || SIZE[20];
    const eligible = Object.values(catalogue).filter(exercise => exercise.generator && exercise.main && requirementsMet(exercise,owned));
    if (!eligible.length) throw new Error('No eligible exercises available.');

    const candidates = [];
    for (let count=sizing.minCount;count<=Math.min(sizing.maxCount,eligible.length);count++) {
      for (let attempt=0;attempt<4;attempt++) {
        const exercises = selectExercises(eligible,count,focus,history,random);
        const flexibleMaxRounds=sizing.maxRounds+(duration>=45?3:2);
        for (let rounds=sizing.minRounds;rounds<=flexibleMaxRounds;rounds++) {
          const estimate = estimateMain(exercises,rounds,rest);
          const sizePenalty = Math.abs(count-sizing.count)*20;
          const extraRoundPenalty=Math.max(0,rounds-sizing.maxRounds)*20;
          candidates.push({exercises,rounds,estimate,fitness:Math.abs(estimate-budget.main)+sizePenalty+extraRoundPenalty});
        }
      }
    }
    candidates.sort((a,b)=>a.fitness-b.fitness);
    const shortlist = candidates.slice(0,Math.min(3,candidates.length));
    const chosen = shortlist[Math.floor(random()*shortlist.length)] || candidates[0];
    const warmup = buildSection(catalogue,'warmup',budget.warmup,owned,random);
    const cooldown = buildSection(catalogue,'cooldown',budget.cooldown,owned,random);
    const estimatedSeconds = warmup.estimatedSeconds + chosen.estimate + cooldown.estimatedSeconds;
    return {
      id:'generated-'+Date.now(),
      duration,
      focus,
      estimatedSeconds,
      warmup:{estimatedSeconds:warmup.estimatedSeconds,restSeconds:warmup.restSeconds,exercises:warmup.exercises.map(copyExercise)},
      blocks:[{id:'main',rounds:chosen.rounds,rest:Object.assign({},rest),estimatedSeconds:chosen.estimate,exercises:chosen.exercises.map(copyExercise)}],
      cooldown:{estimatedSeconds:cooldown.estimatedSeconds,restSeconds:cooldown.restSeconds,exercises:cooldown.exercises.map(copyExercise)}
    };
  }

  function swap(workout, exerciseIndex, options) {
    const catalogue = options.catalogue;
    const owned = options.equipment || [];
    const random = options.random || Math.random;
    const block = workout.blocks[0];
    const current = block.exercises[exerciseIndex];
    const otherIds = new Set(block.exercises.filter((_,index)=>index!==exerciseIndex).map(exercise=>exercise.id));
    let eligible = Object.values(catalogue).filter(exercise => exercise.generator && exercise.main && requirementsMet(exercise,owned) && !otherIds.has(exercise.id) && exercise.id!==current.id);
    const matching = eligible.filter(exercise => exercise.patterns.some(pattern=>current.patterns.includes(pattern)));
    if (matching.length) eligible = matching;
    const scored = eligible.map(exercise => {
      let score = exercise.patterns.filter(pattern=>current.patterns.includes(pattern)).length*8;
      score -= Math.abs(exercise.strength-current.strength)*1.5;
      score -= Math.abs(exercise.cardio-current.cardio)*1.5;
      if (exercise.impact===current.impact) score += 2;
      if (primaryEquipment(exercise)===primaryEquipment(current)) score += 2;
      const before = block.exercises[exerciseIndex-1], after = block.exercises[exerciseIndex+1];
      score -= (sharedPatterns(before,exercise).length + sharedPatterns(exercise,after).length) * 12;
      if (exercise.impact==='high' && ((before&&before.impact==='high')||(after&&after.impact==='high'))) score -= 12;
      return {exercise,score};
    });
    const replacement = controlledPick(scored,random);
    if (!replacement) return workout;
    block.exercises[exerciseIndex] = copyExercise(replacement);
    block.estimatedSeconds = estimateMain(block.exercises,block.rounds,block.rest);
    workout.estimatedSeconds = workout.warmup.estimatedSeconds + block.estimatedSeconds + workout.cooldown.estimatedSeconds;
    return workout;
  }

  root.GarageFitGenerator = { BUDGETS, RESTS, requirementsMet, estimateMain, generate, swap };
})(typeof window==='undefined' ? globalThis : window);
