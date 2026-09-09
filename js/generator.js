(function (root) {
  const BUDGETS = {
    10:{warmup:65,rampup:55,main:420,cooldown:60},
    15:{warmup:100,rampup:80,main:600,cooldown:120},
    20:{warmup:115,rampup:95,main:870,cooldown:120},
    30:{warmup:150,rampup:120,main:1350,cooldown:180},
    45:{warmup:200,rampup:160,main:2040,cooldown:300}
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
  const WARMUP_PHASE_ORDER = { basic:0, dynamic:1, late:2 };
  const VALID_BODY_POSITIONS = new Set(['standing','floor','hanging','supported','mixed']);
  const VALID_MOVEMENT_PLANES = new Set(['sagittal','frontal','transverse']);
  const MAJOR_REPEAT_PATTERNS = new Set(['squat','hinge','push','pull','lunge','carry']);
  const LOWER_JOINT_AREAS = new Set(['hips','knees','ankles']);

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

  function sectionSetupKey(exercise, owned) {
    const available = new Set(owned || []);
    const setup = (exercise.equipment || []).map(group => group.find(id => available.has(id)) || group[0]).filter(Boolean).sort();
    return setup.length ? setup.join('+') : 'bodyweight';
  }

  function groupSectionBySetup(exercises, owned) {
    const groups = new Map();
    for (const exercise of exercises) {
      const key = sectionSetupKey(exercise,owned);
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(exercise);
    }
    return [...groups.values()].flat();
  }

  function sharedPatterns(first, second) {
    if (!first || !second) return [];
    return (first.patterns || []).filter(pattern => (second.patterns || []).includes(pattern));
  }

  function repeatedMajorPatternCount(exercise, selected) {
    return (exercise.patterns || []).filter(pattern => MAJOR_REPEAT_PATTERNS.has(pattern) && selected.some(item => (item.patterns || []).includes(pattern))).length;
  }

  function repeatedBlockPenalty(exercises, rounds) {
    const counts = new Map();
    for (const exercise of exercises) for (const pattern of exercise.patterns || []) if (MAJOR_REPEAT_PATTERNS.has(pattern)) counts.set(pattern,(counts.get(pattern)||0)+1);
    let repeats=0;
    for (const count of counts.values()) repeats += Math.max(0,count-1);
    return repeats * Math.max(1,rounds) * 18;
  }

  function lowerJointCoverage(exercise) {
    return (exercise.warmupAreas || []).filter(area => LOWER_JOINT_AREAS.has(area));
  }

  function scoreCandidate(exercise, desiredPattern, selected, focus, history) {
    let score = 0;
    const previous = selected[selected.length-1];
    const selectedPatterns = selected.flatMap(item => item.patterns || []);
    const overlaps = (exercise.patterns || []).filter(pattern => selectedPatterns.includes(pattern)).length;
    const majorRepeats = repeatedMajorPatternCount(exercise,selected);
    if ((exercise.patterns || []).includes(desiredPattern)) score += 8;
    else if ((exercise.patterns || []).some(pattern => RECIPES[focus].includes(pattern))) score += 2;
    if (focus==='strength') score += exercise.strength * 1.7 + exercise.cardio * .15;
    else if (focus==='cardio') score += exercise.cardio * 1.7 + exercise.strength * .2;
    else score += exercise.strength * .85 + exercise.cardio * .85;
    score += overlaps===0 ? 2 : -2.25 * overlaps;
    score -= majorRepeats * 8;
    score -= recentPenalty(exercise.id, history);
    if (previous) {
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
    const top = scored.slice().sort((a,b)=>b.score-a.score).slice(0,4);
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
      const previous = selected[selected.length-1];
      const neighbours = [previous, slot===count-1 ? selected[0] : null];
      const varied = candidates.filter(exercise => neighbours.every(item => !sharedPatterns(item,exercise).length));
      if (varied.length) candidates = varied;
      const noMajorRepeats = candidates.filter(exercise => repeatedMajorPatternCount(exercise,selected)===0);
      if (noMajorRepeats.length) candidates = noMajorRepeats;
      const patternMatches = candidates.filter(exercise => exercise.patterns.includes(desired));
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
      candidates = candidates.filter(item => item.id!==exercise.id && (!exercise.alternativeGroup || item.alternativeGroup!==exercise.alternativeGroup));
    }
    if (kind==='cooldown') picked.splice(0,picked.length,...groupSectionBySetup(picked,owned));
    return { exercises:picked, restSeconds, estimatedSeconds:total };
  }

  function preparationMetadataValid(exercise) {
    const scaleValid = value => Number.isInteger(value) && value>=1 && value<=5;
    return scaleValid(exercise.prepIntensity) && scaleValid(exercise.prepFatigue) && scaleValid(exercise.prepComplexity) &&
      VALID_BODY_POSITIONS.has(exercise.bodyPosition) && Array.isArray(exercise.movementPlanes) && exercise.movementPlanes.length>0 &&
      exercise.movementPlanes.every(plane=>VALID_MOVEMENT_PLANES.has(plane)) && Array.isArray(exercise.warmupAreas || []);
  }

  function validateCatalogue(catalogue) {
    const errors = [];
    for (const exercise of Object.values(catalogue)) {
      if ((exercise.warmup || exercise.rampup) && !preparationMetadataValid(exercise)) errors.push(exercise.id+': invalid preparation metadata');
      if (exercise.rampup) {
        const p = exercise.rampupPrescription;
        if (!p || !p.type || !Number.isFinite(p.value) || !Number.isFinite(exercise.rampupEstimatedSeconds)) errors.push(exercise.id+': invalid ramp-up prescription');
      }
    }
    return errors;
  }

  function phaseExercise(exercise, kind, seconds) {
    const source = kind==='rampup' ? exercise.rampupPrescription : exercise.warmupPrescription || exercise.prescription;
    const prescription = Object.assign({}, source || exercise.prescription);
    if (prescription.type && prescription.type.includes('timed') && Number.isFinite(seconds)) prescription.value = seconds;
    return Object.assign({}, exercise, { prescription, estimatedSeconds:Number.isFinite(seconds)?seconds:(kind==='rampup'?exercise.rampupEstimatedSeconds:exercise.warmupEstimatedSeconds)||exercise.estimatedSeconds });
  }

  function contextSpecificity(exercise, mainExercises) {
    const weights = [1,.6,.3];
    return (mainExercises || []).slice(0,3).reduce((score,main,index)=>score + sharedPatterns(exercise,main).length * (weights[index]||0),0);
  }

  function contextEquipmentScore(exercise, mainExercises, owned) {
    const first = (mainExercises || [])[0];
    if (!first) return 0;
    const a = sectionSetupKey(exercise,owned), b = sectionSetupKey(first,owned);
    if (a===b) return 2;
    if (a==='bodyweight') return .5;
    return -1;
  }

  function scoreWarmupCandidate(exercise, selected, mainExercises, owned) {
    const previous = selected[selected.length-1];
    let score = 12 - exercise.prepIntensity*1.5 - exercise.prepFatigue*2 - exercise.prepComplexity*1.5;
    const mainPatterns = new Set((mainExercises || []).slice(0,3).flatMap(item=>item.patterns||[]));
    if ((exercise.patterns||[]).some(pattern=>mainPatterns.has(pattern))) score += 1.5;
    const lowerCoverage=lowerJointCoverage(exercise).length;
    const lowerAlready=selected.some(item=>lowerJointCoverage(item).length>=2);
    if (!lowerAlready) score += lowerCoverage*2.5;
    if (previous) {
      if (previous.bodyPosition===exercise.bodyPosition) score += 1;
      else if (previous.bodyPosition!=='mixed' && exercise.bodyPosition!=='mixed') score -= .8;
      if (sectionSetupKey(previous,owned)===sectionSetupKey(exercise,owned)) score += .6;
      if (sharedPatterns(previous,exercise).length) score -= 1;
    }
    return score;
  }

  function scoreRampupCandidate(exercise, position, selected, warmup, mainExercises, owned, focus) {
    const previous = selected[selected.length-1] || warmup[warmup.length-1];
    const firstMain = mainExercises[0];
    const targetIntensity = 3 + 2*position;
    let score = 14 - Math.abs(exercise.prepIntensity-targetIntensity)*3 - exercise.prepFatigue*1.8 - Math.max(0,exercise.prepComplexity-2)*1.5;
    const specificity = contextSpecificity(exercise,mainExercises);
    score += specificity * (2 + 5*position);
    if ((exercise.patterns||[]).includes('conditioning')) score += (1-position)*2 + (focus==='cardio'?2:focus==='strength'?-0.5:0.5);
    if (focus==='strength' && exercise.impact==='high') score -= 1.5;
    if (focus==='strength') score += specificity*1.2;
    if (focus==='cardio') score += exercise.cardio*.35;
    if (previous) {
      if (previous.impact==='high' && exercise.impact==='high') score -= 10;
      const intensityDrop = previous.prepIntensity - exercise.prepIntensity;
      if (intensityDrop>1) score -= intensityDrop*3;
      if (previous.bodyPosition===exercise.bodyPosition) score += 1;
      else if (previous.bodyPosition!=='mixed' && exercise.bodyPosition!=='mixed') score -= 1.2;
      if (sectionSetupKey(previous,owned)===sectionSetupKey(exercise,owned)) score += .8;
    }
    if (exercise.impact==='high') score += position*1.5 - (1-position)*2;
    if (exercise.unilateral && position<.5) score -= 1;
    if (warmup.some(item=>item.id===exercise.id)) score -= 3;
    if (position>.65) {
      score += contextEquipmentScore(exercise,mainExercises,owned)*2;
      if (firstMain && exercise.bodyPosition===firstMain.bodyPosition) score += 2;
      if (firstMain && sharedPatterns(exercise,firstMain).length && exercise.prepFatigue>=3) score -= 5;
    }
    return score;
  }

  function chooseRampCount(targetSeconds) {
    if (targetSeconds<=60) return 1;
    if (targetSeconds<=90) return 2;
    if (targetSeconds<=135) return 3;
    return 4;
  }

  function fitTimedDurations(exercises, targetSeconds, restSeconds, kind) {
    if (!exercises.length) return {exercises:[],estimatedSeconds:0};
    const available = Math.max(0,targetSeconds - restSeconds*Math.max(0,exercises.length-1));
    const defaults = exercises.map(ex=>kind==='rampup'?ex.rampupPrescription:ex.warmupPrescription||ex.prescription);
    const mins = defaults.map(p=>Number.isFinite(p.minValue)?p.minValue:Math.min(p.value,kind==='rampup'?20:15));
    const maxs = defaults.map(p=>Number.isFinite(p.maxValue)?p.maxValue:Math.max(p.value,kind==='rampup'?45:30));
    const desired = defaults.map(p=>p.value);
    let values = desired.slice();
    let current = values.reduce((a,b)=>a+b,0);
    const target = Math.min(maxs.reduce((a,b)=>a+b,0),Math.max(mins.reduce((a,b)=>a+b,0),available));
    let delta = target-current;
    let guard = 0;
    while (Math.abs(delta)>=1 && guard++<500) {
      let changed=false;
      for (let i=0;i<values.length && Math.abs(delta)>=1;i++) {
        const step = delta>0 ? 5 : -5;
        const candidate = values[i]+step;
        if (candidate>=mins[i] && candidate<=maxs[i]) { values[i]=candidate; delta-=step; changed=true; }
      }
      if (!changed) break;
    }
    const fitted = exercises.map((exercise,index)=>phaseExercise(exercise,kind,values[index]));
    return {exercises:fitted,estimatedSeconds:fitted.reduce((sum,ex)=>sum+ex.estimatedSeconds,0)+restSeconds*Math.max(0,fitted.length-1)};
  }

  function selectWarmup(catalogue, targetSeconds, owned, mainExercises, random) {
    let candidates = Object.values(catalogue).filter(ex=>ex.warmup && preparationMetadataValid(ex) && requirementsMet(ex,owned));
    const restSeconds=5, selected=[];
    const targetCount=Math.max(2,Math.min(candidates.length,Math.round((targetSeconds+5)/25)));
    for(let slot=0;slot<targetCount && candidates.length;slot++) {
      let slotCandidates=candidates;
      const lowerAlready=selected.some(ex=>lowerJointCoverage(ex).length>=2);
      if (!lowerAlready && slot===targetCount-1) {
        const lowerCandidates=candidates.filter(ex=>lowerJointCoverage(ex).length>=2);
        if (lowerCandidates.length) slotCandidates=lowerCandidates;
      }
      const scored=slotCandidates.map(exercise=>({exercise,score:scoreWarmupCandidate(exercise,selected,mainExercises,owned)}));
      const picked=controlledPick(scored,random); if(!picked) break;
      selected.push(picked); candidates=candidates.filter(ex=>ex.id!==picked.id && (!picked.alternativeGroup || ex.alternativeGroup!==picked.alternativeGroup));
    }
    selected.sort((a,b)=>{
      const intensity=a.prepIntensity-b.prepIntensity;
      if (intensity) return intensity;
      return (WARMUP_PHASE_ORDER[a.warmupPhase]??0)-(WARMUP_PHASE_ORDER[b.warmupPhase]??0);
    });
    const fitted=fitTimedDurations(selected,targetSeconds,restSeconds,'warmup');
    return {exercises:fitted.exercises,restSeconds,estimatedSeconds:fitted.estimatedSeconds};
  }

  function rampSequenceScore(exercises, warmup, mainExercises, owned, focus) {
    if (!exercises.length) return -Infinity;
    let score=0;
    exercises.forEach((exercise,index)=>{
      const position=exercises.length===1?1:index/(exercises.length-1);
      score+=scoreRampupCandidate(exercise,position,exercises.slice(0,index),warmup,mainExercises,owned,focus);
    });
    for(let i=1;i<exercises.length;i++) {
      if (exercises[i].prepIntensity < exercises[i-1].prepIntensity-1) score-=8;
      if (exercises[i].impact==='high'&&exercises[i-1].impact==='high') score-=12;
    }
    return score;
  }

  function selectRampup(catalogue, targetSeconds, owned, mainExercises, warmup, focus, random) {
    const eligible = Object.values(catalogue).filter(ex=>ex.rampup && preparationMetadataValid(ex) && ex.prepFatigue<=3 && ex.prepComplexity<=3 && requirementsMet(ex,owned));
    const restSeconds=5, count=Math.min(chooseRampCount(targetSeconds),eligible.length);
    let best=null;
    for(let attempt=0;attempt<8;attempt++) {
      const selected=[];
      for(let slot=0;slot<count;slot++) {
        const position=count===1?1:slot/(count-1);
        let candidates=eligible.filter(ex=>!selected.some(item=>item.id===ex.id));
        const scored=candidates.map(exercise=>({exercise,score:scoreRampupCandidate(exercise,position,selected,warmup,mainExercises,owned,focus)}));
        const picked=controlledPick(scored,random); if(!picked) break; selected.push(picked);
      }
      const score=rampSequenceScore(selected,warmup,mainExercises,owned,focus);
      if(!best||score>best.score) best={exercises:selected,score};
    }
    const fitted=fitTimedDurations(best?best.exercises:[],targetSeconds,restSeconds,'rampup');
    return {exercises:fitted.exercises,restSeconds,estimatedSeconds:fitted.estimatedSeconds};
  }

  function validatePreparation(warmup, rampup, mainExercises) {
    const issues=[];
    for(const ex of warmup.exercises.concat(rampup.exercises)) if(!preparationMetadataValid(ex)) issues.push('metadata:'+ex.id);
    if(warmup.exercises.length && !warmup.exercises.some(ex=>lowerJointCoverage(ex).length>=2)) issues.push('warmup:missing-lower-joint-coverage');
    for(let i=1;i<rampup.exercises.length;i++) {
      const before=rampup.exercises[i-1], after=rampup.exercises[i];
      if(before.impact==='high'&&after.impact==='high') issues.push('impact:'+before.id+'>'+after.id);
      if(after.prepIntensity<before.prepIntensity-1) issues.push('intensity:'+before.id+'>'+after.id);
    }
    const last=rampup.exercises[rampup.exercises.length-1], first=mainExercises[0];
    if(last&&first&&last.prepFatigue>3&&sharedPatterns(last,first).length) issues.push('fatigue:'+last.id+'>'+first.id);
    return issues;
  }

  function buildPreparation(catalogue, budget, owned, mainExercises, focus, random) {
    const warmup=selectWarmup(catalogue,budget.warmup,owned,mainExercises,random);
    const rampup=selectRampup(catalogue,budget.rampup,owned,mainExercises,warmup.exercises,focus,random);
    return {warmup,rampup,issues:validatePreparation(warmup,rampup,mainExercises)};
  }

  function copyExercise(exercise) {
    return Object.assign({},exercise,{patterns:(exercise.patterns||[]).slice(),movementPlanes:(exercise.movementPlanes||[]).slice(),warmupAreas:(exercise.warmupAreas||[]).slice(),equipment:(exercise.equipment||[]).map(group=>group.slice()),prescription:Object.assign({},exercise.prescription)});
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
    const errors=validateCatalogue(catalogue); if(errors.length) throw new Error('Invalid exercise catalogue: '+errors.join(', '));
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
          const repetitionPenalty=repeatedBlockPenalty(exercises,rounds);
          candidates.push({exercises,rounds,estimate,fitness:Math.abs(estimate-budget.main)+sizePenalty+extraRoundPenalty+repetitionPenalty});
        }
      }
    }
    candidates.sort((a,b)=>a.fitness-b.fitness);
    const shortlist = candidates.slice(0,Math.min(3,candidates.length));
    const chosen = shortlist[Math.floor(random()*shortlist.length)] || candidates[0];
    const preparation = buildPreparation(catalogue,budget,owned,chosen.exercises,focus,random);
    const cooldown = buildSection(catalogue,'cooldown',budget.cooldown,owned,random);
    const estimatedSeconds = preparation.warmup.estimatedSeconds + preparation.rampup.estimatedSeconds + chosen.estimate + cooldown.estimatedSeconds;
    return {
      id:'generated-'+Date.now(), duration, focus, estimatedSeconds,
      warmup:{estimatedSeconds:preparation.warmup.estimatedSeconds,restSeconds:preparation.warmup.restSeconds,exercises:preparation.warmup.exercises.map(copyExercise)},
      rampup:{estimatedSeconds:preparation.rampup.estimatedSeconds,restSeconds:preparation.rampup.restSeconds,exercises:preparation.rampup.exercises.map(copyExercise)},
      blocks:[{id:'main',rounds:chosen.rounds,rest:Object.assign({},rest),estimatedSeconds:chosen.estimate,exercises:chosen.exercises.map(copyExercise)}],
      cooldown:{estimatedSeconds:cooldown.estimatedSeconds,restSeconds:cooldown.restSeconds,exercises:cooldown.exercises.map(copyExercise)}
    };
  }

  function swap(workout, exerciseIndex, options) {
    const catalogue = options.catalogue, owned = options.equipment || [], random = options.random || Math.random;
    const block = workout.blocks[0], current = block.exercises[exerciseIndex];
    const otherIds = new Set(block.exercises.filter((_,index)=>index!==exerciseIndex).map(exercise=>exercise.id));
    let eligible = Object.values(catalogue).filter(exercise => exercise.generator && exercise.main && requirementsMet(exercise,owned) && !otherIds.has(exercise.id) && exercise.id!==current.id);
    const before = block.exercises[(exerciseIndex-1+block.exercises.length)%block.exercises.length], after = block.exercises[(exerciseIndex+1)%block.exercises.length];
    const varied = eligible.filter(exercise => !sharedPatterns(before,exercise).length && !sharedPatterns(exercise,after).length); if (varied.length) eligible = varied;
    const withoutRepeatedMajor=eligible.filter(exercise=>block.exercises.every((item,index)=>index===exerciseIndex||repeatedMajorPatternCount(exercise,[item])===0)); if(withoutRepeatedMajor.length) eligible=withoutRepeatedMajor;
    const matching = eligible.filter(exercise => exercise.patterns.some(pattern=>current.patterns.includes(pattern))); if (matching.length) eligible = matching;
    const scored = eligible.map(exercise => { let score = exercise.patterns.filter(pattern=>current.patterns.includes(pattern)).length*8; score -= Math.abs(exercise.strength-current.strength)*1.5; score -= Math.abs(exercise.cardio-current.cardio)*1.5; if (exercise.impact===current.impact) score += 2; if (primaryEquipment(exercise)===primaryEquipment(current)) score += 2; score -= (sharedPatterns(before,exercise).length + sharedPatterns(exercise,after).length) * 12; score -= repeatedMajorPatternCount(exercise,block.exercises.filter((_,index)=>index!==exerciseIndex))*8; if (exercise.impact==='high' && ((before&&before.impact==='high')||(after&&after.impact==='high'))) score -= 12; return {exercise,score}; });
    const replacement = controlledPick(scored,random); if (!replacement) return workout;
    block.exercises[exerciseIndex] = copyExercise(replacement); block.estimatedSeconds = estimateMain(block.exercises,block.rounds,block.rest); recalcWorkoutEstimate(workout); return workout;
  }

  function swapPreparation(workout, section, exerciseIndex, options) {
    if(!['warmup','rampup'].includes(section)||!workout[section]) return workout;
    const catalogue=options.catalogue, owned=options.equipment||[], random=options.random||Math.random, current=workout[section].exercises[exerciseIndex], main=workout.blocks[0].exercises;
    const allPrepIds=new Set(workout.warmup.exercises.concat(workout.rampup.exercises).filter(ex=>ex!==current).map(ex=>ex.id));
    let eligible=Object.values(catalogue).filter(ex=>ex[section]&&preparationMetadataValid(ex)&&requirementsMet(ex,owned)&&ex.id!==current.id&&!allPrepIds.has(ex.id));
    if(section==='rampup') eligible=eligible.filter(ex=>ex.prepFatigue<=3&&ex.prepComplexity<=3);
    if(section==='warmup' && lowerJointCoverage(current).length>=2 && !workout.warmup.exercises.some((ex,index)=>index!==exerciseIndex&&lowerJointCoverage(ex).length>=2)) {
      const lowerEligible=eligible.filter(ex=>lowerJointCoverage(ex).length>=2); if(lowerEligible.length) eligible=lowerEligible;
    }
    const position=workout[section].exercises.length===1?1:exerciseIndex/(workout[section].exercises.length-1);
    const before=workout[section].exercises[exerciseIndex-1];
    const scored=eligible.map(exercise=>({exercise,score:section==='rampup'?scoreRampupCandidate(exercise,position,workout[section].exercises.slice(0,exerciseIndex),workout.warmup.exercises,main,owned,workout.focus):scoreWarmupCandidate(exercise,workout.warmup.exercises.slice(0,exerciseIndex),main,owned) - Math.abs(exercise.prepIntensity-current.prepIntensity)*2 + (before&&before.bodyPosition===exercise.bodyPosition?1:0)}));
    const replacement=controlledPick(scored,random); if(!replacement) return workout;
    const seconds=current.estimatedSeconds;
    workout[section].exercises[exerciseIndex]=phaseExercise(replacement,section,seconds);
    recalcWorkoutEstimate(workout); return workout;
  }

  function recalcWorkoutEstimate(workout) {
    workout.warmup.estimatedSeconds=workout.warmup.exercises.reduce((s,e)=>s+e.estimatedSeconds,0)+workout.warmup.restSeconds*Math.max(0,workout.warmup.exercises.length-1);
    workout.rampup.estimatedSeconds=workout.rampup.exercises.reduce((s,e)=>s+e.estimatedSeconds,0)+workout.rampup.restSeconds*Math.max(0,workout.rampup.exercises.length-1);
    workout.estimatedSeconds=workout.warmup.estimatedSeconds+workout.rampup.estimatedSeconds+workout.blocks[0].estimatedSeconds+workout.cooldown.estimatedSeconds;
  }

  root.GarageFitGenerator = { BUDGETS, RESTS, WARMUP_PHASE_ORDER, requirementsMet, sectionSetupKey, groupSectionBySetup, sharedPatterns, preparationMetadataValid, validateCatalogue, validatePreparation, estimateMain, generate, swap, swapPreparation };

  if (typeof window!=='undefined' && typeof document!=='undefined' && typeof window.addEventListener==='function') window.addEventListener('load',()=>{
    if (document.querySelector('script[data-garagefit-rampup-ui]')) return;
    const script=document.createElement('script'); script.src='js/rampup-ui.js'; script.dataset.garagefitRampupUi='true'; document.body.appendChild(script);
  });
})(typeof window==='undefined' ? globalThis : window);