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
  const VALID_SIDEDNESS = new Set(['bilateral','alternating','per-side','none']);
  const MAJOR_REPEAT_PATTERNS = new Set(['squat','hinge','push','pull','lunge','carry']);
  const LOWER_JOINT_AREAS = new Set(['hips','knees','ankles']);
  const RECENT_EXACT_PENALTIES = [18,10,6,3];
  const RECENT_PATTERN_PENALTIES = [6,3,2,1];
  const MAIN_PROTOCOLS = new Set(['rounds','paired_sets','timed_intervals']);
  const MAIN_INTENTS = new Set(['strength','conditioning','accessory','finisher']);
  const MAIN_ROLES = new Set(['primary','supporting']);
  const BLOCK_TRANSITION_SECONDS = 3;
  const VALID_IMPACT_LEVELS = new Set(['low','medium','high']);
  const PRESCRIPTION_MODE_BY_TYPE = { 'timed':'time', 'unilateral-timed':'time', 'reps':'reps', 'unilateral-reps':'reps' };
  // Equipment diversity targets apply only to the Main phase, and only when enough of the
  // user's selected equipment is actually viable (has eligible candidates) to make variety
  // meaningful. Bodyweight never counts as an equipment type for this purpose.
  const EQUIPMENT_DIVERSITY = {
    10:{minTypes:1,preferredTypes:1},
    15:{minTypes:1,preferredTypes:1},
    20:{minTypes:2,preferredTypes:2},
    30:{minTypes:2,preferredTypes:3},
    45:{minTypes:2,preferredTypes:3}
  };
  const EQUIPMENT_DOMINANCE_CAP = 0.6;
  const BLOCK_DOMINANCE_CAP = 0.45;

  function requirementsMet(exercise, owned) {
    const equipment = new Set(owned || []);
    return (exercise.equipment || []).every(group => group.some(id => equipment.has(id)));
  }

  function prescriptionMode(type) {
    return PRESCRIPTION_MODE_BY_TYPE[type] || null;
  }

  function sameSelectionFamily(first, second) {
    return !!(first && second && first.selectionFamily && first.selectionFamily===second.selectionFamily);
  }

  // A broad repetition family/class (e.g. basic no-equipment conditioning bounces) that's
  // independent of `selectionFamily`, which drives Main-only cross-block frequency capping.
  // This is scoped to Warm-up/Ramp-up phase repetition and never touches Main selection.
  function sameRepetitionClass(first, second) {
    return !!(first && second && first.repetitionClass && first.repetitionClass===second.repetitionClass);
  }

  function recentUsePenalty(exercise, history, catalogue) {
    let exactPenalty = 0, patternPenalty = 0;
    for (let i=0;i<(history || []).length;i++) {
      const ids = history[i] || [];
      const exact = RECENT_EXACT_PENALTIES[i] || 1;
      const family = RECENT_PATTERN_PENALTIES[i] || 1;
      if (ids.includes(exercise.id)) exactPenalty = Math.max(exactPenalty,exact);
      const sharesMajorPattern = ids.some(id => {
        const previous = catalogue && catalogue[id];
        return previous && sharedPatterns(exercise,previous).some(pattern => MAJOR_REPEAT_PATTERNS.has(pattern));
      });
      const sharesSelectionFamily = ids.some(id => sameSelectionFamily(exercise, catalogue && catalogue[id]));
      if (sharesMajorPattern || sharesSelectionFamily) patternPenalty = Math.max(patternPenalty,family);
    }
    return exactPenalty + patternPenalty;
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

  function scoreCandidate(exercise, desiredPattern, selected, focus, history, catalogue) {
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
    score -= recentUsePenalty(exercise,history,catalogue);
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

  function selectExercises(eligible, count, focus, history, random, catalogue) {
    const selected = [];
    const recipe = RECIPES[focus];
    for (let slot=0;slot<count;slot++) {
      const desired = recipe[slot % recipe.length];
      let candidates = eligible.filter(exercise => !selected.some(item => item.id===exercise.id || (item.frequency==='occasional' && sameSelectionFamily(item,exercise))));
      const previous = selected[selected.length-1];
      const neighbours = [previous, slot===count-1 ? selected[0] : null];
      const varied = candidates.filter(exercise => neighbours.every(item => !sharedPatterns(item,exercise).length));
      if (varied.length) candidates = varied;
      const noMajorRepeats = candidates.filter(exercise => repeatedMajorPatternCount(exercise,selected)===0);
      if (noMajorRepeats.length) candidates = noMajorRepeats;
      const patternMatches = candidates.filter(exercise => exercise.patterns.includes(desired));
      const variedPatternMatches = patternMatches.filter(exercise => !sharedPatterns(previous,exercise).length);
      const preferredMatches = variedPatternMatches.length ? variedPatternMatches : (!previous ? patternMatches : []);
      if (preferredMatches.length) {
        const allPreferredRecentlyUsed = preferredMatches.every(exercise => recentUsePenalty(exercise,history,catalogue)>0);
        const hasFreshAlternative = candidates.some(exercise => recentUsePenalty(exercise,history,catalogue)===0);
        if (!(allPreferredRecentlyUsed && hasFreshAlternative)) candidates = preferredMatches;
      }
      const scored = candidates.map(exercise => ({exercise,score:scoreCandidate(exercise,desired,selected,focus,history,catalogue)}));
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

  function mainBlocks(workout) {
    if (workout && workout.main && Array.isArray(workout.main.blocks)) return workout.main.blocks;
    if (workout && Array.isArray(workout.blocks)) return workout.blocks;
    return [];
  }

  function normaliseWorkout(workout) {
    if (!workout || typeof workout!=='object') throw new Error('Invalid workout.');
    let blocks;
    if (workout.main && Array.isArray(workout.main.blocks)) blocks=workout.main.blocks;
    else if (Array.isArray(workout.blocks)) blocks=workout.blocks;
    else if (workout.main && Array.isArray(workout.main.exercises)) blocks=[{
      id:'main-1',
      protocol:'rounds',
      intent:workout.focus==='cardio'?'conditioning':'strength',
      exercises:workout.main.exercises,
      prescription:{rounds:workout.main.rounds||1,exerciseRestSeconds:(workout.main.rest&&workout.main.rest.exercise)||0,roundRestSeconds:(workout.main.rest&&workout.main.rest.round)||0}
    }];
    else throw new Error('Workout Main has no playable blocks.');

    blocks=blocks.map((source,index)=>{
      const block=Object.assign({},source);
      block.id=block.id||'main-'+(index+1);
      block.protocol=block.protocol||'rounds';
      block.intent=block.intent||((workout.focus||'balanced')==='cardio'?'conditioning':'strength');
      block.exercises=(block.exercises||[]).map(copyExercise);
      block.prescription=Object.assign({},block.prescription||{});
      if(block.protocol==='rounds'){
        block.prescription.rounds=block.prescription.rounds||block.rounds||1;
        block.prescription.exerciseRestSeconds=Number.isFinite(block.prescription.exerciseRestSeconds)?block.prescription.exerciseRestSeconds:(block.rest&&block.rest.exercise)||0;
        block.prescription.roundRestSeconds=Number.isFinite(block.prescription.roundRestSeconds)?block.prescription.roundRestSeconds:(block.rest&&block.rest.round)||0;
        block.rounds=block.prescription.rounds;
        block.rest={exercise:block.prescription.exerciseRestSeconds,round:block.prescription.roundRestSeconds};
      }
      const estimate=estimateBlockDuration(block);
      block.estimatedDurationSeconds=Number.isFinite(block.estimatedDurationSeconds)?block.estimatedDurationSeconds:Number.isFinite(block.estimatedSeconds)?block.estimatedSeconds:estimate;
      block.estimatedSeconds=block.estimatedDurationSeconds;
      return block;
    });
    const blockSeconds=blocks.reduce((sum,block)=>sum+block.estimatedDurationSeconds,0);
    workout.schemaVersion=Math.max(2,Number(workout.schemaVersion)||0);
    workout.main={blocks,transitionSeconds:BLOCK_TRANSITION_SECONDS,estimatedDurationSeconds:blockSeconds+BLOCK_TRANSITION_SECONDS*Math.max(0,blocks.length-1)};
    workout.blocks=workout.main.blocks;
    return workout;
  }

  function protocolCompatible(exercise, protocol) {
    if (!exercise || !MAIN_PROTOCOLS.has(protocol)) return false;
    if (Array.isArray(exercise.mainProtocols)) return exercise.mainProtocols.includes(protocol);
    if (protocol==='timed_intervals') return exercise.sidedness!=='per-side' && !!(exercise.prescription&&exercise.prescription.type&&exercise.prescription.type.includes('timed'));
    return protocol==='rounds'||protocol==='paired_sets';
  }

  function weightedPick(items, random) {
    const viable=items.filter(item=>item.weight>0);
    if(!viable.length)return null;
    let roll=random()*viable.reduce((sum,item)=>sum+item.weight,0);
    for(const item of viable){roll-=item.weight;if(roll<=0)return item.value;}
    return viable[viable.length-1].value;
  }

  function chooseBlockCount(duration, eligibleCount, random) {
    const tendencies={
      10:[{value:1,weight:9},{value:2,weight:1}],
      15:[{value:1,weight:8},{value:2,weight:2}],
      20:[{value:1,weight:4},{value:2,weight:6}],
      30:[{value:2,weight:8},{value:3,weight:2}],
      45:[{value:2,weight:4},{value:3,weight:6}]
    };
    const choices=tendencies[duration]||tendencies[20];
    const count=weightedPick(choices,random)||1;
    return eligibleCount<4?1:count;
  }

  function chooseIntents(focus, count, random) {
    if(focus==='strength'){
      if(count===1)return ['strength'];
      if(count===2)return ['strength',random()<.25?'finisher':'accessory'];
      return ['strength','accessory','finisher'];
    }
    if(focus==='cardio')return Array.from({length:count},(_,index)=>index===count-1&&count>1&&random()<.35?'finisher':'conditioning');
    if(count===1)return [random()<.55?'strength':'conditioning'];
    if(count===2)return ['strength','conditioning'];
    return ['strength','accessory','conditioning'];
  }

  function protocolWeights(focus, intent, remainingSeconds, eligible, state) {
    const base=focus==='strength'
      ? {rounds:5,paired_sets:9,timed_intervals:2}
      : focus==='cardio'
        ? {rounds:8,paired_sets:2,timed_intervals:10}
        : {rounds:7,paired_sets:7,timed_intervals:7};
    if(intent==='strength') { base.paired_sets+=4;base.timed_intervals-=1; }
    if(intent==='conditioning'||intent==='finisher') { base.timed_intervals+=5;base.rounds+=2;base.paired_sets-=1; }
    if(intent==='accessory') { base.paired_sets+=3;base.rounds+=1; }
    if(remainingSeconds<300){base.timed_intervals+=3;base.rounds-=1;}
    const compatible=protocol=>eligible.filter(ex=>protocolCompatible(ex,protocol)).length;
    const previous=state.blocks[state.blocks.length-1];
    return [...MAIN_PROTOCOLS].map(protocol=>{
      let weight=base[protocol]||0;
      const minimum=protocol==='rounds'?3:2;
      if(compatible(protocol)<minimum)weight=0;
      // Variety is deliberately a modest tie-breaker, below focus and viability.
      if(previous&&previous.protocol!==protocol)weight+=1;
      return {value:protocol,weight:Math.max(0,weight)};
    });
  }

  function scoreIntent(exercise, intent) {
    if(intent==='strength')return exercise.strength*2-exercise.cardio*.15;
    if(intent==='conditioning'||intent==='finisher')return exercise.cardio*2+((exercise.patterns||[]).includes('conditioning')?4:0)-exercise.strength*.1;
    return exercise.strength+exercise.cardio*.45+((exercise.patterns||[]).includes('core')?2:0);
  }

  function selectBlockExercises(eligible, count, focus, intent, protocol, state, history, random, catalogue) {
    const selected=[], recipe=RECIPES[focus]||RECIPES.balanced;
    for(let slot=0;slot<count;slot++){
      const desired=recipe[(state.exercises.length+slot)%recipe.length];
      let candidates=eligible.filter(ex=>protocolCompatible(ex,protocol)&&!selected.some(item=>item.id===ex.id));
      // An "occasional" selection family (e.g. farmer carry, across dumbbell/kettlebell variants)
      // is capped at one exposure across the whole Main phase, not just within a block.
      candidates=candidates.filter(ex=>!(ex.frequency==='occasional'&&ex.selectionFamily&&(
        (state.usedFamilies&&state.usedFamilies.has(ex.selectionFamily)) || selected.some(item=>sameSelectionFamily(item,ex))
      )));
      if(!candidates.length)break;
      const previous=selected[selected.length-1]||state.exercises[state.exercises.length-1];
      const allSelected=state.exercises.concat(selected);
      const scored=candidates.map(exercise=>{
        let score=scoreCandidate(exercise,desired,allSelected,focus,history,catalogue)+scoreIntent(exercise,intent);
        if(state.usedIds.has(exercise.id))score-=42;
        if(previous&&sharedPatterns(previous,exercise).some(pattern=>MAJOR_REPEAT_PATTERNS.has(pattern)))score-=8;
        if(previous&&sectionSetupKey(previous,state.owned)===sectionSetupKey(exercise,state.owned))score+=1.5;
        if(protocol==='paired_sets'&&selected.length===1&&!sharedPatterns(selected[0],exercise).length)score+=8;
        if(protocol==='timed_intervals'&&exercise.sidedness==='per-side')score-=30;
        if(exercise.mainRole==='supporting'){
          const supportingAlready=allSelected.filter(item=>item.mainRole==='supporting').length;
          score-=3+supportingAlready*6;
        }
        // Equipment portfolio bias: nudge toward introducing an under-used viable equipment
        // type, and away from a type that would come to dominate active Main working time.
        // This runs during selection (not as a final shuffle) but is a soft preference,
        // subordinate to the pattern/fatigue/recency scoring above.
        if(state.diversityTarget&&state.diversityTarget.preferredTypes>1&&state.equipmentUsage){
          const type=primaryEquipment(exercise);
          if(type!=='bodyweight'){
            const usage=state.equipmentUsage;
            const distinctUsed=[...usage.keys()].filter(t=>usage.get(t)>0).length;
            const usageTotal=[...usage.values()].reduce((a,b)=>a+b,0);
            if(!usage.get(type)&&distinctUsed<state.diversityTarget.preferredTypes)score+=5;
            if(usageTotal>0){
              const projectedShare=(usage.get(type)||0)/(usageTotal+exercise.estimatedSeconds);
              if(projectedShare>EQUIPMENT_DOMINANCE_CAP)score-=6;
            }
          }
        }
        return {exercise,score};
      });
      const picked=controlledPick(scored,random);
      if(!picked)break;
      selected.push(picked);
    }
    return selected;
  }

  function estimateBlockDuration(block) {
    if(!block||!Array.isArray(block.exercises)||!block.exercises.length)return 0;
    const p=block.prescription||{};
    if(block.protocol==='timed_intervals'){
      const cycles=Math.max(1,Number(p.cycles)||1),work=Math.max(0,Number(p.workSeconds)||0),transition=Math.max(0,Number(p.transitionSeconds)||0);
      const steps=block.exercises.length*cycles;
      return steps*work+Math.max(0,steps-1)*transition;
    }
    const work=block.exercises.reduce((sum,exercise)=>sum+(Number(exercise.estimatedSeconds)||0),0);
    if(block.protocol==='paired_sets'){
      const sets=Math.max(1,Number(p.sets)||1),between=Math.max(0,Number(p.betweenExercisesSeconds)||0),setRest=Math.max(0,Number(p.betweenSetsSeconds)||0);
      return sets*(work+between)+Math.max(0,sets-1)*setRest;
    }
    const rounds=Math.max(1,Number(p.rounds)||Number(block.rounds)||1),exerciseRest=Math.max(0,Number(p.exerciseRestSeconds) || (block.rest&&Number(block.rest.exercise)) || 0),roundRest=Math.max(0,Number(p.roundRestSeconds) || (block.rest&&Number(block.rest.round)) || 0);
    return rounds*(work+Math.max(0,block.exercises.length-1)*exerciseRest)+Math.max(0,rounds-1)*roundRest;
  }

  function resolveBlockSteps(block) {
    const steps=[],p=block.prescription||{},exercises=block.exercises||[];
    if(block.protocol==='rounds'){
      for(let round=1;round<=p.rounds;round++)exercises.forEach((exercise,index)=>{
        steps.push({kind:'exercise',exerciseIndex:index,round});
        if(index<exercises.length-1&&p.exerciseRestSeconds)steps.push({kind:'rest',seconds:p.exerciseRestSeconds,nextExerciseIndex:index+1,round});
        else if(index===exercises.length-1&&round<p.rounds&&p.roundRestSeconds)steps.push({kind:'round-rest',seconds:p.roundRestSeconds,nextExerciseIndex:0,round});
      });
    }else if(block.protocol==='paired_sets'){
      for(let set=1;set<=p.sets;set++)exercises.forEach((exercise,index)=>{
        steps.push({kind:'exercise',exerciseIndex:index,set});
        if(index===0&&p.betweenExercisesSeconds)steps.push({kind:'set-change',seconds:p.betweenExercisesSeconds,nextExerciseIndex:1,set});
        else if(index===1&&set<p.sets&&p.betweenSetsSeconds)steps.push({kind:'set-rest',seconds:p.betweenSetsSeconds,nextExerciseIndex:0,set});
      });
    }else if(block.protocol==='timed_intervals'){
      for(let cycle=1;cycle<=p.cycles;cycle++)exercises.forEach((exercise,index)=>{
        steps.push({kind:'exercise',exerciseIndex:index,cycle,seconds:p.workSeconds,timed:true});
        const final=cycle===p.cycles&&index===exercises.length-1;
        if(!final&&p.transitionSeconds)steps.push({kind:'interval-rest',seconds:p.transitionSeconds,nextExerciseIndex:index<exercises.length-1?index+1:0,cycle});
      });
    }
    return steps;
  }

  function preferredRepeatCount(protocol, exerciseCount) {
    if(protocol==='paired_sets')return 4;
    if(exerciseCount<=3)return 3;
    if(exerciseCount===4)return 4;
    return 5;
  }

  function repetitionPenalty(protocol, exercises, repeatCount, allowExtendedRepetition) {
    if(allowExtendedRepetition)return 0;
    const preferred=preferredRepeatCount(protocol,exercises.length);
    const excess=Math.max(0,repeatCount-preferred);
    if(!excess)return 0;
    const smallBlock=exercises.length<=3;
    const unit=protocol==='paired_sets'?55:smallBlock?170:85;
    return excess*unit;
  }

  function chooseClosestPrescription(protocol, exercises, targetSeconds, rest, focus, options) {
    const allowExtendedRepetition=!!(options&&options.allowExtendedRepetition);
    let best=null;
    const consider=p=>{
      const candidate={protocol,exercises,prescription:p};
      const estimate=estimateBlockDuration(candidate);
      const repeatCount=protocol==='rounds'?p.rounds:protocol==='paired_sets'?p.sets:p.cycles;
      const repeatPenalty=repetitionPenalty(protocol,exercises,repeatCount,allowExtendedRepetition);
      const fitness=Math.abs(estimate-targetSeconds)+repeatPenalty;
      if(!best||fitness<best.fitness)best={prescription:p,estimate,fitness};
    };
    if(protocol==='rounds')for(let rounds=1;rounds<=5;rounds++)consider({rounds,exerciseRestSeconds:rest.exercise,roundRestSeconds:rest.round});
    else if(protocol==='paired_sets')for(let sets=2;sets<=5;sets++)consider({sets,betweenExercisesSeconds:Math.min(10,rest.exercise),betweenSetsSeconds:rest.round});
    else {
      const intervals=focus==='strength'?[[30,30],[40,20]]:focus==='cardio'?[[40,20],[45,15],[30,15]]:[[40,20],[30,15]];
      for(const [workSeconds,transitionSeconds] of intervals)for(let cycles=1;cycles<=5;cycles++)consider({workSeconds,transitionSeconds,cycles});
    }
    return best;
  }

  function buildMainBlock(eligible, index, protocol, intent, targetSeconds, focus, rest, state, history, random, catalogue) {
    const compatible=eligible.filter(ex=>protocolCompatible(ex,protocol));
    const desiredCount=protocol==='paired_sets'?2:protocol==='rounds'?(targetSeconds<420?3:4):(targetSeconds<300?2:3);
    const count=Math.min(desiredCount,compatible.length);
    const exercises=selectBlockExercises(eligible,count,focus,intent,protocol,state,history,random,catalogue);
    if(exercises.length<(protocol==='rounds'?Math.min(3,compatible.length):2))return null;
    const constrainedPool=compatible.length<=count;
    const fitted=chooseClosestPrescription(protocol,exercises,targetSeconds,rest,focus,{allowExtendedRepetition:constrainedPool});
    const block={
      id:'main-'+(index+1),
      protocol,
      intent,
      exercises:exercises.map(copyExercise),
      prescription:fitted.prescription,
      estimatedDurationSeconds:fitted.estimate,
      estimatedSeconds:fitted.estimate
    };
    if(protocol==='rounds'){
      block.rounds=block.prescription.rounds;
      block.rest={exercise:block.prescription.exerciseRestSeconds,round:block.prescription.roundRestSeconds};
    }
    return block;
  }

  function blockRepeatCount(block) {
    const p=block.prescription||{};
    return block.protocol==='rounds'?Number(p.rounds)||1:block.protocol==='paired_sets'?Number(p.sets)||1:Number(p.cycles)||1;
  }

  function mainQualityPenalty(blocks, targetSeconds, eligibleCount) {
    const exercises=blocks.flatMap(block=>block.exercises),counts=new Map();
    let penalty=0;
    for(const block of blocks){
      const repeats=blockRepeatCount(block);
      penalty+=repetitionPenalty(block.protocol,block.exercises,repeats,false);
      const repeatedSupporting=block.exercises.filter(exercise=>exercise.mainRole==='supporting').length*Math.max(0,repeats-1);
      penalty+=repeatedSupporting*24;
      if(block.exercises.length<=3&&repeats>3)penalty+=(repeats-3)*70;
    }
    for(const exercise of exercises){
      counts.set(exercise.id,(counts.get(exercise.id)||0)+1);
      if((counts.get(exercise.id)||0)>1)penalty+=55;
    }
    for(let i=1;i<exercises.length;i++){
      const shared=sharedPatterns(exercises[i-1],exercises[i]).filter(pattern=>MAJOR_REPEAT_PATTERNS.has(pattern));
      penalty+=shared.length*18;
      if(exercises[i-1].impact==='high'&&exercises[i].impact==='high')penalty+=25;
    }
    if(Number.isFinite(targetSeconds)&&Number.isFinite(eligibleCount)){
      const desiredDistinct=Math.min(eligibleCount,targetSeconds>=720?6:targetSeconds>=480?4:3);
      const distinctCount=new Set(exercises.map(exercise=>exercise.id)).size;
      penalty+=Math.max(0,desiredDistinct-distinctCount)*95;
      const total=blocks.reduce((sum,block)=>sum+estimateBlockDuration(block),0);
      if(targetSeconds>=720&&eligibleCount>=6&&total>0){
        const dominant=blocks.reduce((max,block)=>Math.max(max,estimateBlockDuration(block)),0)/total;
        if(dominant>.72&&blocks.some(block=>block.exercises.length<=3))penalty+=180;
      }
    }
    return penalty;
  }

  function equipmentUsageSeconds(blocks) {
    const usage=new Map();
    for(const block of blocks){
      const repeats=blockRepeatCount(block);
      for(const exercise of block.exercises||[]){
        const type=primaryEquipment(exercise);
        if(type==='bodyweight')continue;
        usage.set(type,(usage.get(type)||0)+exercise.estimatedSeconds*repeats);
      }
    }
    return usage;
  }

  function viableEquipmentTypes(eligible) {
    return new Set(eligible.map(primaryEquipment).filter(type=>type!=='bodyweight'));
  }

  // Main-phase equipment/family/round-variety planning. Kept separate from validateMain
  // (which stays a pure structural/prescription/safety check with no throw-risk on a
  // pathologically small candidate pool) so composeMain can use it to filter and rank
  // attempts while a last-resort fallback Main is never blocked by these preferences.
  function mainVarietyIssues(blocks, duration, eligible) {
    const issues=[];
    const familyCounts=new Map();
    for(const block of blocks)for(const exercise of block.exercises||[]){
      if(exercise.frequency==='occasional'&&exercise.selectionFamily)
        familyCounts.set(exercise.selectionFamily,(familyCounts.get(exercise.selectionFamily)||0)+1);
    }
    for(const [family,count] of familyCounts)if(count>1)issues.push('main:family-cap:'+family);

    for(const block of blocks){
      if(block.protocol!=='rounds')continue;
      const rounds=Number(block.prescription&&block.prescription.rounds)||0;
      if(rounds<3)continue;
      // Left/right entries are one catalogue exercise (one distinct family) that plays back
      // as two work exposures; distinctness is therefore measured by exercise id, not by
      // playback step count, so per-side work cannot masquerade as extra block variety.
      const distinctFamilies=new Set(block.exercises.map(exercise=>exercise.id)).size;
      const distinctPatterns=new Set(block.exercises.flatMap(exercise=>exercise.patterns||[])).size;
      if(distinctFamilies<3||distinctPatterns<2)issues.push(block.id+':insufficient-round-variety');
    }

    const viableTypes=viableEquipmentTypes(eligible);
    const target=EQUIPMENT_DIVERSITY[duration]||EQUIPMENT_DIVERSITY[20];
    if(viableTypes.size>=target.minTypes){
      const usage=equipmentUsageSeconds(blocks);
      const usedTypes=[...usage.keys()].filter(type=>usage.get(type)>0).length;
      if(usedTypes<target.minTypes)issues.push('main:equipment-diversity-below-minimum');
    }
    return issues;
  }

  function validateMain(main, catalogue, owned, targetSeconds) {
    const issues=[];
    if(!main||!Array.isArray(main.blocks)||!main.blocks.length)return ['main:no-blocks'];
    for(const block of main.blocks){
      if(!MAIN_PROTOCOLS.has(block.protocol)){issues.push(block.id+':invalid-protocol');continue;}
      if(!MAIN_INTENTS.has(block.intent))issues.push(block.id+':invalid-intent');
      if(!Array.isArray(block.exercises)||!block.exercises.length)issues.push(block.id+':no-exercises');
      for(const exercise of block.exercises||[]){
        if(!catalogue[exercise.id])issues.push(block.id+':unknown-exercise:'+exercise.id);
        else if(!requirementsMet(catalogue[exercise.id],owned))issues.push(block.id+':equipment:'+exercise.id);
        else if(!protocolCompatible(catalogue[exercise.id],block.protocol))issues.push(block.id+':incompatible:'+exercise.id);
      }
      const p=block.prescription||{};
      if(block.protocol==='rounds'&&(!Number.isInteger(p.rounds)||p.rounds<1))issues.push(block.id+':invalid-rounds');
      if(block.protocol==='paired_sets'&&((block.exercises||[]).length!==2||!Number.isInteger(p.sets)||p.sets<1))issues.push(block.id+':invalid-paired-sets');
      if(block.protocol==='timed_intervals'&&(!Number.isInteger(p.cycles)||p.cycles<1||!Number.isFinite(p.workSeconds)||p.workSeconds<=0||!Number.isFinite(p.transitionSeconds)||p.transitionSeconds<0))issues.push(block.id+':invalid-intervals');
      const estimate=estimateBlockDuration(block);
      if(!Number.isFinite(estimate)||estimate<=0)issues.push(block.id+':invalid-duration');
      if(!resolveBlockSteps(block).some(step=>step.kind==='exercise'))issues.push(block.id+':unplayable');
    }
    const estimate=main.blocks.reduce((sum,block)=>sum+estimateBlockDuration(block),0)+BLOCK_TRANSITION_SECONDS*Math.max(0,main.blocks.length-1);
    if(Number.isFinite(targetSeconds)&&Math.abs(estimate-targetSeconds)>Math.max(240,targetSeconds*.38))issues.push('main:duration-out-of-tolerance');
    return issues;
  }

  function composeMain(catalogue, eligible, budget, duration, focus, owned, history, rest, random) {
    const attempts=[];
    const diversityTarget=EQUIPMENT_DIVERSITY[duration]||EQUIPMENT_DIVERSITY[20];
    const viableCount=viableEquipmentTypes(eligible).size;
    for(let attempt=0;attempt<10;attempt++){
      const count=chooseBlockCount(duration,eligible.length,random),intents=chooseIntents(focus,count,random);
      const state={exercises:[],usedIds:new Set(),usedFamilies:new Set(),equipmentUsage:new Map(),blocks:[],owned,diversityTarget};
      let remaining=budget.main;
      for(let index=0;index<count;index++){
        const blocksLeft=count-index;
        const target=Math.max(180,Math.round((remaining-BLOCK_TRANSITION_SECONDS*Math.max(0,blocksLeft-1))/blocksLeft));
        const weights=protocolWeights(focus,intents[index],target,eligible,state);
        let protocol=eligible.length<=3?'rounds':weightedPick(weights,random)||'rounds';
        let block=buildMainBlock(eligible,index,protocol,intents[index],target,focus,rest,state,history,random,catalogue);
        if(!block){
          protocol='rounds';
          block=buildMainBlock(eligible,index,protocol,intents[index],target,focus,rest,state,history,random,catalogue);
        }
        if(!block)break;
        state.blocks.push(block);
        state.exercises.push(...block.exercises);
        const repeats=blockRepeatCount(block);
        block.exercises.forEach(ex=>{
          state.usedIds.add(ex.id);
          if(ex.frequency==='occasional'&&ex.selectionFamily)state.usedFamilies.add(ex.selectionFamily);
          const type=primaryEquipment(ex);
          if(type!=='bodyweight')state.equipmentUsage.set(type,(state.equipmentUsage.get(type)||0)+ex.estimatedSeconds*repeats);
        });
        remaining-=block.estimatedDurationSeconds+(index<count-1?BLOCK_TRANSITION_SECONDS:0);
      }
      if(!state.blocks.length)continue;
      const estimated=state.blocks.reduce((sum,block)=>sum+block.estimatedDurationSeconds,0)+BLOCK_TRANSITION_SECONDS*Math.max(0,state.blocks.length-1);
      const protocols=new Set(state.blocks.map(block=>block.protocol));
      const varietyCredit=protocols.size>1?(budget.main>=720?35:budget.main>=480?20:5):0;
      const issues=validateMain({blocks:state.blocks},catalogue,owned,budget.main);
      const varietyIssues=mainVarietyIssues(state.blocks,duration,eligible);
      const malformed=issues.filter(issue=>issue!=='main:duration-out-of-tolerance').concat(varietyIssues);
      if(malformed.length)continue;
      const usedTypesCount=[...state.equipmentUsage.keys()].filter(type=>state.equipmentUsage.get(type)>0).length;
      const equipmentCredit=(viableCount>=diversityTarget.preferredTypes&&usedTypesCount>=diversityTarget.preferredTypes)?15:0;
      let dominancePenalty=0;
      const usageTotal=[...state.equipmentUsage.values()].reduce((a,b)=>a+b,0);
      if(usageTotal>0&&viableCount>=3){
        const dominantShare=Math.max(...state.equipmentUsage.values())/usageTotal;
        if(dominantShare>EQUIPMENT_DOMINANCE_CAP)dominancePenalty=(dominantShare-EQUIPMENT_DOMINANCE_CAP)*400;
      }
      let blockDominancePenalty=0;
      if(state.blocks.length>1&&estimated>0){
        const dominantBlockShare=Math.max(...state.blocks.map(block=>block.estimatedDurationSeconds))/estimated;
        if(dominantBlockShare>BLOCK_DOMINANCE_CAP)blockDominancePenalty=(dominantBlockShare-BLOCK_DOMINANCE_CAP)*300;
      }
      attempts.push({blocks:state.blocks,estimated,fitness:Math.abs(estimated-budget.main)+mainQualityPenalty(state.blocks,budget.main,eligible.length)+dominancePenalty+blockDominancePenalty-varietyCredit-equipmentCredit});
    }
    attempts.sort((a,b)=>a.fitness-b.fitness);
    const chosen=attempts[0];
    if(chosen)return {blocks:chosen.blocks,transitionSeconds:BLOCK_TRANSITION_SECONDS,estimatedDurationSeconds:chosen.estimated};
    const fallbackExercises=selectExercises(eligible,Math.min(3,eligible.length),focus,history,random,catalogue);
    const fitted=chooseClosestPrescription('rounds',fallbackExercises,budget.main,rest,focus,{allowExtendedRepetition:true});
    const block={id:'main-1',protocol:'rounds',intent:focus==='cardio'?'conditioning':'strength',exercises:fallbackExercises.map(copyExercise),prescription:fitted.prescription,rounds:fitted.prescription.rounds,rest:{exercise:fitted.prescription.exerciseRestSeconds,round:fitted.prescription.roundRestSeconds},estimatedDurationSeconds:fitted.estimate,estimatedSeconds:fitted.estimate};
    return {blocks:[block],transitionSeconds:BLOCK_TRANSITION_SECONDS,estimatedDurationSeconds:fitted.estimate};
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
      if (!VALID_SIDEDNESS.has(exercise.sidedness)) errors.push(exercise.id+': invalid sidedness');
      if (exercise.mainRole!=null&&!MAIN_ROLES.has(exercise.mainRole)) errors.push(exercise.id+': invalid main role');
      for (const cue of exercise.timedCues || []) {
        const at=cue&&cue.at,validText=typeof cue.text==='string'&&cue.text.trim().length>0;
        const validFraction=at&&at.type==='fraction'&&Number.isFinite(at.value)&&at.value>0&&at.value<1;
        const validSeconds=at&&at.type==='seconds'&&Number.isFinite(at.value)&&at.value>0;
        if(!validText||(!validFraction&&!validSeconds))errors.push(exercise.id+': invalid timed cue');
      }
      const prescriptionIsPerSide = !!(exercise.prescription && exercise.prescription.type && exercise.prescription.type.includes('unilateral'));
      if ((exercise.sidedness==='per-side') !== prescriptionIsPerSide) errors.push(exercise.id+': sidedness does not match prescription type');
      if (exercise.warmup && !VALID_IMPACT_LEVELS.has(exercise.impact)) errors.push(exercise.id+': warm-up exercise missing a recognised impact classification');
      if (Array.isArray(exercise.prescriptionModes) && exercise.prescriptionModes.length) {
        const mode = prescriptionMode(exercise.prescription && exercise.prescription.type);
        if (!mode || !exercise.prescriptionModes.includes(mode)) errors.push(exercise.id+': prescription mode not permitted');
      }
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
    // Discourage (but don't forbid) picking another exercise from the same broad repetition
    // family/class as one already used in Warm-up or earlier in Ramp-up itself.
    if (warmup.some(item=>sameRepetitionClass(item,exercise)) || selected.some(item=>sameRepetitionClass(item,exercise))) score -= 5;
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
    // High-impact movements are a safety exclusion for warm-ups specifically; they remain
    // available to a suitable Main phase, which is scored (not hard-filtered) on impact.
    let candidates = Object.values(catalogue).filter(ex=>ex.warmup && ex.impact!=='high' && preparationMetadataValid(ex) && requirementsMet(ex,owned));
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
        // An exercise already used in Warm-up shouldn't normally repeat exactly in Ramp-up,
        // but this stays a soft-mandatory filter: if it would leave no eligible candidate for
        // this slot (a genuinely constrained catalogue), the exact duplicate remains available
        // as a last resort rather than breaking generation.
        const notWarmupDuplicate=candidates.filter(ex=>!warmup.some(item=>item.id===ex.id));
        if (notWarmupDuplicate.length) candidates=notWarmupDuplicate;
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
    return Object.assign({},exercise,{patterns:(exercise.patterns||[]).slice(),movementPlanes:(exercise.movementPlanes||[]).slice(),warmupAreas:(exercise.warmupAreas||[]).slice(),equipment:(exercise.equipment||[]).map(group=>group.slice()),prescription:Object.assign({},exercise.prescription),timedCues:(exercise.timedCues||[]).map(cue=>Object.assign({},cue,{at:Object.assign({},cue.at)}))});
  }

  function generate(options) {
    const catalogue=options.catalogue;
    const duration=Number(options.duration);
    const focus=String(options.focus||'balanced').toLowerCase();
    const owned=options.equipment||[],history=options.history||[],random=options.random||Math.random;
    const budget=BUDGETS[duration]||BUDGETS[20],rest=RESTS[focus]||RESTS.balanced;
    const errors=validateCatalogue(catalogue);if(errors.length)throw new Error('Invalid exercise catalogue: '+errors.join(', '));
    const eligible=Object.values(catalogue).filter(exercise=>exercise.generator&&exercise.main&&requirementsMet(exercise,owned));
    if(!eligible.length)throw new Error('No eligible exercises available.');
    const main=composeMain(catalogue,eligible,budget,duration,focus,owned,history,rest,random);
    const firstMain=main.blocks[0].exercises;
    const preparation=buildPreparation(catalogue,budget,owned,firstMain,focus,random);
    const cooldown=buildSection(catalogue,'cooldown',budget.cooldown,owned,random);
    const estimatedSeconds=preparation.warmup.estimatedSeconds+preparation.rampup.estimatedSeconds+main.estimatedDurationSeconds+cooldown.estimatedSeconds;
    const workout={
      schemaVersion:2,id:'generated-'+Date.now(),duration,focus,estimatedSeconds,
      warmup:{estimatedSeconds:preparation.warmup.estimatedSeconds,restSeconds:preparation.warmup.restSeconds,exercises:preparation.warmup.exercises.map(copyExercise)},
      rampup:{estimatedSeconds:preparation.rampup.estimatedSeconds,restSeconds:preparation.rampup.restSeconds,exercises:preparation.rampup.exercises.map(copyExercise)},
      main,
      cooldown:{estimatedSeconds:cooldown.estimatedSeconds,restSeconds:cooldown.restSeconds,exercises:cooldown.exercises.map(copyExercise)}
    };
    workout.blocks=workout.main.blocks;
    const issues=validateMain(workout.main,catalogue,owned,budget.main);
    const fatal=issues.filter(issue=>issue!=='main:duration-out-of-tolerance');
    if(fatal.length)throw new Error('Invalid generated Main: '+fatal.join(', '));
    return workout;
  }

  function swap(workout, blockIndex, exerciseIndex, options) {
    if(typeof exerciseIndex==='object'){options=exerciseIndex;exerciseIndex=blockIndex;blockIndex=0;}
    options=options||{};normaliseWorkout(workout);
    const catalogue=options.catalogue,owned=options.equipment||[],random=options.random||Math.random;
    const blocks=mainBlocks(workout),block=blocks[blockIndex||0],current=block&&block.exercises[exerciseIndex];
    if(!block||!current)return workout;
    const otherExercises=blocks.flatMap((item,bIndex)=>item.exercises.filter((_,eIndex)=>bIndex!==(blockIndex||0)||eIndex!==exerciseIndex));
    const otherIds=new Set(otherExercises.map(exercise=>exercise.id));
    let eligible=Object.values(catalogue).filter(exercise=>exercise.generator&&exercise.main&&requirementsMet(exercise,owned)&&protocolCompatible(exercise,block.protocol)&&exercise.id!==current.id);
    const fresh=eligible.filter(exercise=>!otherIds.has(exercise.id));if(fresh.length)eligible=fresh;
    const before=exerciseIndex>0?block.exercises[exerciseIndex-1]:(blocks[(blockIndex||0)-1]||{exercises:[]}).exercises.at(-1);
    const after=exerciseIndex<block.exercises.length-1?block.exercises[exerciseIndex+1]:(blocks[(blockIndex||0)+1]||{exercises:[]}).exercises[0];
    const scored=eligible.map(exercise=>{
      let score=(exercise.patterns||[]).filter(pattern=>(current.patterns||[]).includes(pattern)).length*8;
      score-=Math.abs(exercise.strength-current.strength)*1.5+Math.abs(exercise.cardio-current.cardio)*1.5;
      if(exercise.impact===current.impact)score+=2;
      if(primaryEquipment(exercise)===primaryEquipment(current))score+=2;
      score-=(sharedPatterns(before,exercise).length+sharedPatterns(exercise,after).length)*12;
      score-=repeatedMajorPatternCount(exercise,otherExercises)*8;
      if(otherIds.has(exercise.id))score-=42;
      if(exercise.impact==='high'&&((before&&before.impact==='high')||(after&&after.impact==='high')))score-=12;
      return {exercise,score};
    });
    const replacement=controlledPick(scored,random);if(!replacement)return workout;
    block.exercises[exerciseIndex]=copyExercise(replacement);
    block.estimatedDurationSeconds=estimateBlockDuration(block);block.estimatedSeconds=block.estimatedDurationSeconds;
    recalcWorkoutEstimate(workout);return workout;
  }

  function swapPreparation(workout, section, exerciseIndex, options) {
    if(!['warmup','rampup'].includes(section)||!workout[section]) return workout;
    const catalogue=options.catalogue, owned=options.equipment||[], random=options.random||Math.random, current=workout[section].exercises[exerciseIndex], main=workout.blocks[0].exercises;
    const allPrepIds=new Set(workout.warmup.exercises.concat(workout.rampup.exercises).filter(ex=>ex!==current).map(ex=>ex.id));
    let eligible=Object.values(catalogue).filter(ex=>ex[section]&&preparationMetadataValid(ex)&&requirementsMet(ex,owned)&&ex.id!==current.id&&!allPrepIds.has(ex.id));
    if(section==='warmup') eligible=eligible.filter(ex=>ex.impact!=='high');
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
    normaliseWorkout(workout);
    workout.warmup.estimatedSeconds=workout.warmup.exercises.reduce((s,e)=>s+e.estimatedSeconds,0)+workout.warmup.restSeconds*Math.max(0,workout.warmup.exercises.length-1);
    workout.rampup.estimatedSeconds=workout.rampup.exercises.reduce((s,e)=>s+e.estimatedSeconds,0)+workout.rampup.restSeconds*Math.max(0,workout.rampup.exercises.length-1);
    for(const block of workout.main.blocks){block.estimatedDurationSeconds=estimateBlockDuration(block);block.estimatedSeconds=block.estimatedDurationSeconds;}
    workout.main.estimatedDurationSeconds=workout.main.blocks.reduce((sum,block)=>sum+block.estimatedDurationSeconds,0)+workout.main.transitionSeconds*Math.max(0,workout.main.blocks.length-1);
    workout.estimatedSeconds=workout.warmup.estimatedSeconds+workout.rampup.estimatedSeconds+workout.main.estimatedDurationSeconds+workout.cooldown.estimatedSeconds;
  }

  root.GarageFitGenerator = { BUDGETS, RESTS, MAIN_PROTOCOLS, MAIN_INTENTS, MAIN_ROLES, BLOCK_TRANSITION_SECONDS, WARMUP_PHASE_ORDER, EQUIPMENT_DIVERSITY, EQUIPMENT_DOMINANCE_CAP, BLOCK_DOMINANCE_CAP, requirementsMet, sectionSetupKey, groupSectionBySetup, sharedPatterns, sameSelectionFamily, sameRepetitionClass, prescriptionMode, recentUsePenalty, preparationMetadataValid, validateCatalogue, validatePreparation, estimateMain, estimateBlockDuration, resolveBlockSteps, protocolCompatible, protocolWeights, preferredRepeatCount, repetitionPenalty, mainQualityPenalty, validateMain, mainVarietyIssues, equipmentUsageSeconds, viableEquipmentTypes, primaryEquipment, blockRepeatCount, selectBlockExercises, selectWarmup, selectRampup, scoreRampupCandidate, mainBlocks, normaliseWorkout, generate, swap, swapPreparation };

  if (typeof window!=='undefined' && typeof document!=='undefined' && typeof window.addEventListener==='function') window.addEventListener('load',()=>{
    if (document.querySelector('script[data-garagefit-rampup-ui]')) return;
    const script=document.createElement('script'); script.src='js/rampup-ui.js'; script.dataset.garagefitRampupUi='true'; document.body.appendChild(script);
  });
})(typeof window==='undefined' ? globalThis : window);
