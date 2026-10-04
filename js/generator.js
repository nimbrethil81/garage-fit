(function (root) {
  const BUDGETS = {
    10:{warmup:65,rampup:55,main:420,cooldown:60},
    15:{warmup:100,rampup:80,main:600,cooldown:120},
    20:{warmup:115,rampup:95,main:870,cooldown:120},
    30:{warmup:175,rampup:120,main:1325,cooldown:180},
    45:{warmup:225,rampup:160,main:2015,cooldown:300}
  };
  const RESTS = {
    strength:{exercise:20,round:60},
    balanced:{exercise:15,round:45},
    cardio:{exercise:10,round:30}
  };
  // Recipe slots name selection roles: a movement pattern, or the conditioning role
  // (exercises with `conditioning: true`). See selectionTags().
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
  // Main patterns that load the hips/knees/ankles. For Cardio, on-feet work with medium or
  // high impact (running, jumping, bounding) also loads the legs; conditioning status alone
  // never does (e.g. floor-based mountain climbers or knee tucks are core-led).
  const LOWER_DEMAND_PATTERNS = new Set(['squat','hinge','lunge']);
  const LOWER_DEMAND_POSITIONS = new Set(['standing','mixed']);
  // Share of Main exercises above which lower-body demand is treated as substantial.
  const LOWER_DEMAND_THRESHOLD = { strength:.4, balanced:.5, cardio:.5 };
  // Scored-selection shortlist (see controlledPick). Main and Warm-up admit near-misses within
  // SHORTLIST_MARGIN score points of the cutoff, so a correctly modelled exercise just outside
  // a dense same-pattern shortlist stays reachable. Ramp-up does not: its scores target an
  // intensity progression per position, so a near-miss there is a progression fault.
  const SHORTLIST_SIZE = 4;
  const SHORTLIST_MARGIN = 5;
  // Generated Main selection widens its shortlist slowly as its candidate pool grows (see
  // candidateWindowRanks), so a fixed leading group cannot crowd accurately modelled exercises
  // out as the catalogue grows. Warm-up, Ramp-up and swaps keep the fixed SHORTLIST_SIZE.
  const WINDOW_MAX_RANKS = 6;
  // Bounded Main route for accessory work: supporting, non-conditioning exercises (see
  // routeAccessory and supportingRouteOpen). Main phases of at least `minDuration` minutes that
  // can contain an accessory block and offer `minCandidates` accessories take one seeded roll;
  // when it succeeds, the last slot of the accessory block is filled from the accessories that
  // pass every filter, if at least `minCandidates` do, once the exercises before it cover
  // `minRoles` recipe roles and none of them is supporting. The candidate minimum keeps the
  // route a source of variety rather than a fixed insertion of the only accessory available.
  const SUPPORTING_ROUTE = { minDuration:30, probability:.25, minRoles:4, minCandidates:2 };
  const SCORE_TIE_EPSILON = 1e-9;
  // Main score penalty when the previous Main exercise shares a non-null repetitionClass (soft, never an exclusion).
  const MAIN_REPETITION_CLASS_PENALTY = 10;
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
  // Workout difficulty (generate({difficulty})) reads each exercise's intrinsic `difficulty`.
  // Normal is neutral: it neither excludes nor scores, so it generates exactly as a workout
  // without the option. Easy is a hard eligibility rule for generated Main and Ramp-up (no
  // `hard` exercises) plus a Main preference for `easy` ones. Hard excludes nothing; it gives
  // demanding exercises a Main score advantage that stays below the pattern, impact and recency
  // safeguards. Warm-up and Cool-down are unaffected.
  const WORKOUT_DIFFICULTIES = ['easy','normal','hard'];
  const EXERCISE_DIFFICULTIES = new Set(['easy','moderate','hard']);
  const DIFFICULTY_POLICY = {
    easy:{ excluded:['hard'], credit:{ easy:4 } },
    normal:{ excluded:[], credit:{} },
    hard:{ excluded:[], credit:{ hard:6, moderate:2 } }
  };

  function requirementsMet(exercise, owned) {
    const equipment = new Set(owned || []);
    return (exercise.equipment || []).every(group => group.some(id => equipment.has(id)));
  }

  function prescriptionMode(type) {
    return PRESCRIPTION_MODE_BY_TYPE[type] || null;
  }

  // ---- Workout difficulty policy (see DIFFICULTY_POLICY) ----

  function workoutDifficulty(value) {
    if (value==null) return 'normal';
    const difficulty = String(value).toLowerCase();
    if (!WORKOUT_DIFFICULTIES.includes(difficulty)) throw new Error('Unknown workout difficulty '+JSON.stringify(value)+'.');
    return difficulty;
  }

  function difficultyExcluded(exercise, difficulty) {
    const policy = DIFFICULTY_POLICY[difficulty] || DIFFICULTY_POLICY.normal;
    return !!(exercise && policy.excluded.includes(exercise.difficulty));
  }

  function difficultyCredit(exercise, difficulty) {
    const policy = DIFFICULTY_POLICY[difficulty] || DIFFICULTY_POLICY.normal;
    return (exercise && policy.credit[exercise.difficulty]) || 0;
  }

  // ---- Relationship metadata and the phase policies built on it ----
  // `family`: direct or near-direct variants of substantially the same exercise.
  // `repetitionClass`: different exercises that feel repetitive when programmed close together.
  // The metadata only describes relationships; each phase decides what they mean (below).

  function sameFamily(first, second) {
    return !!(first && second && first.family && first.family===second.family);
  }

  function sameRepetitionClass(first, second) {
    return !!(first && second && first.repetitionClass && first.repetitionClass===second.repetitionClass);
  }

  // The same exercise, or a direct variant of it.
  function sameExerciseOrFamily(first, second) {
    return !!(first && second && (first.id===second.id || sameFamily(first,second)));
  }

  // Main policy: an "occasional" family (e.g. farmer carry across dumbbell/kettlebell
  // variants) is capped at one exposure across the whole Main phase. Shared by initial
  // generation and swaps so a swap cannot introduce what generation would have refused.
  function mainFamilyCapReached(exercise, mainExercises) {
    return !!(exercise && exercise.frequency==='occasional' && exercise.family && (mainExercises || []).some(item => sameFamily(item,exercise)));
  }

  // Preparation policy (Warm-up, Ramp-up and their swaps): repeating an exercise or a direct
  // variant of it counts as a duplicate. Applied as a soft-mandatory filter so a constrained
  // catalogue still produces a phase.
  function preferNonDuplicates(candidates, used) {
    const fresh = candidates.filter(exercise => !(used || []).some(item => sameExerciseOrFamily(item,exercise)));
    return fresh.length ? fresh : candidates;
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
      const sharesFamily = ids.some(id => sameFamily(exercise, catalogue && catalogue[id]));
      if (sharesMajorPattern || sharesFamily) patternPenalty = Math.max(patternPenalty,family);
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

  // Selection roles used for recipe slots and similarity: the movement `patterns` plus the
  // categorical conditioning role. Kept together so separating `conditioning` from
  // `patterns` in the catalogue does not change how similarity between exercises is judged.
  function selectionTags(exercise) {
    const patterns = (exercise && exercise.patterns) || [];
    return exercise && exercise.conditioning ? patterns.concat('conditioning') : patterns;
  }

  function sharedPatterns(first, second) {
    if (!first || !second) return [];
    const other = selectionTags(second);
    return selectionTags(first).filter(pattern => other.includes(pattern));
  }

  function sharesMajorPattern(first, second) {
    return sharedPatterns(first,second).some(pattern=>MAJOR_REPEAT_PATTERNS.has(pattern));
  }

  // A proximity preference, applied after stronger eligibility and coverage rules.
  function preferDifferentPattern(candidates, previous) {
    if (!previous) return candidates;
    const different=candidates.filter(ex=>!sharesMajorPattern(previous,ex));
    return different.length ? different : candidates;
  }

  function preparationPatternPenalty(exercise, earlier) {
    return earlier.filter(item=>sharesMajorPattern(item,exercise)).length * 2;
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

  // Meaningful lower-body preparation works at least two of hips/knees/ankles together
  // (e.g. squat, lunge, knee drive). Hip-only mobility is partial lower-body preparation;
  // trunk/shoulder-only movements such as body hoops or arm circles are not lower-body prep.
  function meaningfulLowerPrep(exercise) {
    return lowerJointCoverage(exercise).length>=2;
  }

  function lowerBodyDemand(mainExercises, focus) {
    const list = mainExercises || [];
    if (!list.length) return 0;
    const lower = list.filter(exercise=>(exercise.patterns||[]).some(pattern=>LOWER_DEMAND_PATTERNS.has(pattern)) ||
      (focus==='cardio' && LOWER_DEMAND_POSITIONS.has(exercise.bodyPosition) && (exercise.impact==='medium' || exercise.impact==='high'))).length;
    return lower/list.length;
  }

  // How many meaningful lower-body warm-up exercises a warm-up of this size should contain.
  // Short warm-ups need one; medium/long warm-ups need two; substantial lower-body Main
  // demand adds one more once the warm-up is long enough to hold it without regional skew.
  function lowerPrepTarget(count, demand, focus) {
    let target = count>=6 ? 2 : 1;
    if (count>=5 && demand>=(LOWER_DEMAND_THRESHOLD[focus]||LOWER_DEMAND_THRESHOLD.balanced)) target++;
    return Math.max(1,Math.min(target,Math.floor(count/2)));
  }

  // Maximum number of warm-up exercises with no lower-joint coverage at all (trunk/shoulder
  // only). Very short warm-ups may give the odd slot to upper/trunk work; otherwise such
  // movements may not make up more than half of the warm-up.
  function upperTrunkOnlyCap(count) {
    return count<5 ? Math.ceil(count/2) : Math.floor(count/2);
  }

  // ---- Opt-in diagnostic trace ----
  // generate({trace}) passes selection events to `trace` (used by the reachability audit to
  // explain rare exercises). It is null during ordinary generation, and tracing never changes
  // a selection: it reads the same scores and filters and consumes no random numbers.
  let activeTrace = null;

  // Adds a labelled score component to `parts` (when explaining a score) and returns it, so
  // `score += credit(parts,label,value)` is the unlabelled arithmetic exactly.
  function credit(parts, label, value) {
    if (parts) parts[label] = (parts[label] || 0) + value;
    return value;
  }

  // One soft-mandatory candidate filter: returns `after` unchanged and, while tracing, records
  // which candidates the named rule removed.
  function narrow(stages, label, before, after) {
    if (stages && after.length<before.length) {
      const kept = new Set(after);
      stages.push({ label, removed:before.filter(item=>!kept.has(item)) });
    }
    return after;
  }

  // controlledPick plus a trace event. `describe` (only called while tracing) adds the phase
  // context and an `explain` function that recomputes one candidate's score as labelled
  // components with the phase's own scorer; it is valid only during the trace call.
  function tracedPick(scored, random, margin, describe, ranks) {
    const picked = controlledPick(scored,random,margin,ranks);
    if (activeTrace) activeTrace(Object.assign({ type:'pick', scored, window:selectionWindow(scored,margin,ranks), picked }, describe()));
    return picked;
  }

  function scoreCandidate(exercise, desiredPattern, selected, focus, history, catalogue, parts) {
    let score = 0;
    const previous = selected[selected.length-1];
    const tags = selectionTags(exercise);
    const selectedPatterns = selected.flatMap(selectionTags);
    const overlaps = tags.filter(pattern => selectedPatterns.includes(pattern)).length;
    const majorRepeats = repeatedMajorPatternCount(exercise,selected);
    // Recipe-slot fit is categorical (does the exercise fill this role?); the focus weighting
    // below adds the degree of strength/cardio demand. Both are intended.
    if (tags.includes(desiredPattern)) score += credit(parts,'slot-fit',8);
    else if (tags.some(pattern => RECIPES[focus].includes(pattern))) score += credit(parts,'slot-fit',2);
    if (focus==='strength') score += credit(parts,'focus-demand',exercise.strength * 1.7 + exercise.cardio * .15);
    else if (focus==='cardio') score += credit(parts,'focus-demand',exercise.cardio * 1.7 + exercise.strength * .2);
    else score += credit(parts,'focus-demand',exercise.strength * .85 + exercise.cardio * .85);
    score += credit(parts,'pattern-overlap',overlaps===0 ? 2 : -2.25 * overlaps);
    score += credit(parts,'major-pattern-repeat',-(majorRepeats * 8));
    score += credit(parts,'recent-history',-recentUsePenalty(exercise,history,catalogue));
    if (previous) {
      score += credit(parts,'adjacent-pattern',-(sharedPatterns(previous,exercise).length * 12));
      const sameEquipment = primaryEquipment(previous)===primaryEquipment(exercise);
      if (sameEquipment) score += credit(parts,'equipment-continuity',2.2);
      else if (primaryEquipment(exercise)==='bodyweight') score += credit(parts,'equipment-continuity',.6);
      else score += credit(parts,'equipment-continuity',-1.2);
      if (previous.impact==='high' && exercise.impact==='high') score += credit(parts,'adjacent-high-impact',-12);
      if (previous.load && exercise.load && previous.load!==exercise.load) score += credit(parts,'load-change',-1.8);
    }
    const highCount = selected.filter(item => item.impact==='high').length;
    if (exercise.impact==='high' && highCount>=Math.ceil((selected.length+1)/2)) score += credit(parts,'high-impact-share',-5);
    return score;
  }

  // Scored selection. The best SHORTLIST_SIZE scores form the shortlist, weighted by rank and by
  // lead over the shortlist cutoff. Equal scores share a rank, so catalogue order never decides
  // whether (or how strongly) an exercise is shortlisted. A phase may pass a `margin` to admit
  // near-misses below the cutoff with a weight that falls linearly from the cutoff's weight to
  // zero across the margin: still score-ordered, but no longer all-or-nothing at the cutoff.
  // A phase may pass `ranks` (see candidateWindowRanks) to widen the shortlist to that many
  // score ranks; rank and lead weights then count from the wider cutoff.
  function selectionWindow(scored, margin, ranks) {
    const sorted = scored.slice().sort((a,b)=>b.score-a.score);
    if (!sorted.length) return null;
    const band = margin || 0;
    const size = Math.max(SHORTLIST_SIZE, ranks || 0);
    const cutoff = sorted[Math.min(size,sorted.length)-1].score - SCORE_TIE_EPSILON;
    return { sorted, band, ranks:size, cutoff, threshold:cutoff-band, pool:sorted.filter(item=>item.score>cutoff-band) };
  }

  // Shortlist ranks for generated Main selection from `count` scored candidates (after every
  // hard and soft filter): SHORTLIST_SIZE below 32 candidates, one more rank each time the pool
  // doubles from there, never more than WINDOW_MAX_RANKS.
  function candidateWindowRanks(count) {
    return Math.min(WINDOW_MAX_RANKS, Math.max(SHORTLIST_SIZE, SHORTLIST_SIZE+Math.floor(Math.log2(Math.max(1,count)/16))));
  }

  // 1-based shortlist rank of each entry of a selectionWindow's `sorted` list: one plus the
  // number of strictly higher scores, so equal scores share a rank (as in controlledPick).
  function selectionRanks(sorted) {
    const ranks = [];
    let ahead = 0;
    for (let i=0;i<sorted.length;i++) {
      while (sorted[ahead].score>sorted[i].score+SCORE_TIE_EPSILON) ahead++;
      ranks.push(ahead+1);
    }
    return ranks;
  }

  function controlledPick(scored, random, margin, ranks) {
    const window = selectionWindow(scored,margin,ranks);
    if (!window) return null;
    const { sorted, band, ranks:size, cutoff, pool } = window;
    const weights = pool.map(item=>{
      if (item.score<cutoff) return 1-(cutoff-item.score)/band;
      const ahead = sorted.filter(other=>other.score>item.score+SCORE_TIE_EPSILON).length;
      return Math.max(1,size-ahead) * Math.max(1,item.score-cutoff+1);
    });
    let roll = random() * weights.reduce((sum,value)=>sum+value,0);
    for (let i=0;i<pool.length;i++) {
      roll -= weights[i];
      if (roll<=0) return pool[i].exercise;
    }
    return pool[0].exercise;
  }

  function selectExercises(eligible, count, focus, history, random, catalogue) {
    const selected = [];
    const recipe = RECIPES[focus];
    for (let slot=0;slot<count;slot++) {
      const desired = recipe[slot % recipe.length];
      const stages = activeTrace ? [] : null;
      const unselected = eligible.filter(exercise => !selected.some(item => item.id===exercise.id));
      let candidates = narrow(stages,'family-cap',unselected,unselected.filter(exercise => !mainFamilyCapReached(exercise,selected)));
      const previous = selected[selected.length-1];
      const neighbours = [previous, slot===count-1 ? selected[0] : null];
      const varied = candidates.filter(exercise => neighbours.every(item => !sharedPatterns(item,exercise).length));
      if (varied.length) candidates = narrow(stages,'adjacent-pattern',candidates,varied);
      const noMajorRepeats = candidates.filter(exercise => repeatedMajorPatternCount(exercise,selected)===0);
      if (noMajorRepeats.length) candidates = narrow(stages,'major-pattern-repeat',candidates,noMajorRepeats);
      const patternMatches = candidates.filter(exercise => selectionTags(exercise).includes(desired));
      const variedPatternMatches = patternMatches.filter(exercise => !sharedPatterns(previous,exercise).length);
      const preferredMatches = variedPatternMatches.length ? variedPatternMatches : (!previous ? patternMatches : []);
      if (preferredMatches.length) {
        const allPreferredRecentlyUsed = preferredMatches.every(exercise => recentUsePenalty(exercise,history,catalogue)>0);
        const hasFreshAlternative = candidates.some(exercise => recentUsePenalty(exercise,history,catalogue)===0);
        if (!(allPreferredRecentlyUsed && hasFreshAlternative)) candidates = narrow(stages,'slot-pattern',candidates,preferredMatches);
      }
      const scored = candidates.map(exercise => ({exercise,score:scoreCandidate(exercise,desired,selected,focus,history,catalogue)}));
      const picked = tracedPick(scored,random,SHORTLIST_MARGIN,() => ({ phase:'main', desired, stages,
        explain:exercise => { const parts = {}; scoreCandidate(exercise,desired,selected,focus,history,catalogue,parts); return parts; } }),candidateWindowRanks(scored.length));
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
    // `cardio` grades cardiovascular demand; `conditioning` marks categorical suitability for a
    // conditioning role (e.g. a heavy farmer carry has cardio 3 but is not conditioning work).
    // They are deliberately separate contributions, not a double count.
    if(intent==='conditioning'||intent==='finisher')return exercise.cardio*2+(exercise.conditioning?4:0)-exercise.strength*.1;
    return exercise.strength+exercise.cardio*.45+((exercise.patterns||[]).includes('core')?2:0);
  }

  function routeAccessory(exercise) {
    return exercise.mainRole==='supporting'&&!exercise.conditioning;
  }

  // Whether the supporting route may fill this slot: the Main drew the route, this is the last
  // slot of an accessory-intent block, the exercises before it already cover enough recipe
  // roles, and none of them is supporting.
  function supportingRouteOpen(state, intent, slot, count, mainSoFar, focus) {
    if(!state.supportingRoute||intent!=='accessory'||slot!==count-1)return false;
    if(mainSoFar.some(exercise=>exercise.mainRole==='supporting'))return false;
    const recipe=RECIPES[focus]||RECIPES.balanced;
    const roles=new Set(mainSoFar.flatMap(selectionTags).filter(tag=>recipe.includes(tag)));
    return roles.size>=SUPPORTING_ROUTE.minRoles;
  }

  function selectBlockExercises(eligible, count, focus, intent, protocol, state, history, random, catalogue) {
    const selected=[], recipe=RECIPES[focus]||RECIPES.balanced;
    for(let slot=0;slot<count;slot++){
      const desired=recipe[(state.exercises.length+slot)%recipe.length];
      const mainSoFar=state.exercises.concat(selected);
      const stages=activeTrace?[]:null;
      const unselected=eligible.filter(ex=>!selected.some(item=>item.id===ex.id));
      const compatible=narrow(stages,'protocol',unselected,unselected.filter(ex=>protocolCompatible(ex,protocol)));
      let candidates=narrow(stages,'family-cap',compatible,compatible.filter(ex=>!mainFamilyCapReached(ex,mainSoFar)));
      if(!candidates.length)break;
      // The route narrows this slot to the accessories that passed every filter, when at least
      // `minCandidates` remain; otherwise the slot is filled as normal.
      const accessories=supportingRouteOpen(state,intent,slot,count,mainSoFar,focus)?candidates.filter(routeAccessory):[];
      const route=accessories.length>=SUPPORTING_ROUTE.minCandidates;
      if(route)candidates=narrow(stages,'supporting-route',candidates,accessories);
      const previous=selected[selected.length-1]||state.exercises[state.exercises.length-1];
      const allSelected=state.exercises.concat(selected);
      const scoreFor=(exercise,parts)=>{
        let score=scoreCandidate(exercise,desired,allSelected,focus,history,catalogue,parts)+credit(parts,'intent',scoreIntent(exercise,intent));
        if(state.usedIds.has(exercise.id))score+=credit(parts,'main-reuse',-42);
        if(previous&&sharedPatterns(previous,exercise).some(pattern=>MAJOR_REPEAT_PATTERNS.has(pattern)))score+=credit(parts,'adjacent-pattern',-8);
        // Soft relationship rule: different exercises that feel alike should not run back to back.
        if(sameRepetitionClass(previous,exercise))score+=credit(parts,'repetition-class',-MAIN_REPETITION_CLASS_PENALTY);
        if(previous&&sectionSetupKey(previous,state.owned)===sectionSetupKey(exercise,state.owned))score+=credit(parts,'same-setup',1.5);
        if(protocol==='paired_sets'&&selected.length===1&&!sharedPatterns(selected[0],exercise).length)score+=credit(parts,'paired-contrast',8);
        if(protocol==='timed_intervals'&&exercise.sidedness==='per-side')score+=credit(parts,'per-side-intervals',-30);
        if(exercise.mainRole==='supporting'){
          const supportingAlready=allSelected.filter(item=>item.mainRole==='supporting').length;
          score+=credit(parts,'supporting-role',-(3+supportingAlready*6));
        }
        // The difficulty preference never rewards back-to-back high-impact work (a fatigue safeguard).
        const difficulty=previous&&previous.impact==='high'&&exercise.impact==='high'?0:difficultyCredit(exercise,state.difficulty);
        if(difficulty)score+=credit(parts,'difficulty',difficulty);
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
            if(!usage.get(type)&&distinctUsed<state.diversityTarget.preferredTypes)score+=credit(parts,'equipment-diversity',5);
            if(usageTotal>0){
              const projectedShare=(usage.get(type)||0)/(usageTotal+exercise.estimatedSeconds);
              if(projectedShare>EQUIPMENT_DOMINANCE_CAP)score+=credit(parts,'equipment-diversity',-6);
            }
          }
        }
        return score;
      };
      const scored=candidates.map(exercise=>({exercise,score:scoreFor(exercise,null)}));
      const picked=tracedPick(scored,random,SHORTLIST_MARGIN,()=>({phase:'main',desired,intent,protocol,stages,
        route,explain:exercise=>{const parts={};scoreFor(exercise,parts);return parts;}}),candidateWindowRanks(scored.length));
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
      if(exercise.frequency==='occasional'&&exercise.family)
        familyCounts.set(exercise.family,(familyCounts.get(exercise.family)||0)+1);
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
      const distinctPatterns=new Set(block.exercises.flatMap(selectionTags)).size;
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

  function composeMain(catalogue, eligible, budget, duration, focus, owned, history, rest, random, difficulty) {
    const attempts=[];
    const diversityTarget=EQUIPMENT_DIVERSITY[duration]||EQUIPMENT_DIVERSITY[20];
    const viableCount=viableEquipmentTypes(eligible).size;
    // One roll for the whole Main, taken only where the route could apply, so short Main phases,
    // Cardio (no accessory block; see chooseIntents) and pools with fewer than `minCandidates`
    // accessories generate exactly as before.
    const supportingRoute=duration>=SUPPORTING_ROUTE.minDuration&&focus!=='cardio'&&eligible.filter(routeAccessory).length>=SUPPORTING_ROUTE.minCandidates&&random()<SUPPORTING_ROUTE.probability;
    for(let attempt=0;attempt<10;attempt++){
      const count=chooseBlockCount(duration,eligible.length,random),intents=chooseIntents(focus,count,random);
      const state={exercises:[],usedIds:new Set(),equipmentUsage:new Map(),blocks:[],owned,diversityTarget,supportingRoute,difficulty};
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
          const type=primaryEquipment(ex);
          if(type!=='bodyweight')state.equipmentUsage.set(type,(state.equipmentUsage.get(type)||0)+ex.estimatedSeconds*repeats);
        });
        remaining-=block.estimatedDurationSeconds+(index<count-1?BLOCK_TRANSITION_SECONDS:0);
      }
      if(!state.blocks.length){
        if(activeTrace)activeTrace({type:'main-attempt',attempt,issues:['main:no-blocks']});
        continue;
      }
      const estimated=state.blocks.reduce((sum,block)=>sum+block.estimatedDurationSeconds,0)+BLOCK_TRANSITION_SECONDS*Math.max(0,state.blocks.length-1);
      const protocols=new Set(state.blocks.map(block=>block.protocol));
      const varietyCredit=protocols.size>1?(budget.main>=720?35:budget.main>=480?20:5):0;
      const issues=validateMain({blocks:state.blocks},catalogue,owned,budget.main);
      const varietyIssues=mainVarietyIssues(state.blocks,duration,eligible);
      const malformed=issues.filter(issue=>issue!=='main:duration-out-of-tolerance').concat(varietyIssues);
      if(malformed.length){
        if(activeTrace)activeTrace({type:'main-attempt',attempt,issues:malformed});
        continue;
      }
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
      attempts.push({attempt,blocks:state.blocks,estimated,fitness:Math.abs(estimated-budget.main)+mainQualityPenalty(state.blocks,budget.main,eligible.length)+dominancePenalty+blockDominancePenalty-varietyCredit-equipmentCredit});
      if(activeTrace)activeTrace({type:'main-attempt',attempt,issues:[],fitness:attempts[attempts.length-1].fitness});
    }
    attempts.sort((a,b)=>a.fitness-b.fitness);
    const chosen=attempts[0];
    if(activeTrace)activeTrace({type:'main-result',attempt:chosen?chosen.attempt:null,supportingRoute});
    if(chosen)return {blocks:chosen.blocks,transitionSeconds:BLOCK_TRANSITION_SECONDS,estimatedDurationSeconds:chosen.estimated};
    const fallbackExercises=selectExercises(eligible,Math.min(3,eligible.length),focus,history,random,catalogue);
    const fitted=chooseClosestPrescription('rounds',fallbackExercises,budget.main,rest,focus,{allowExtendedRepetition:true});
    const block={id:'main-1',protocol:'rounds',intent:focus==='cardio'?'conditioning':'strength',exercises:fallbackExercises.map(copyExercise),prescription:fitted.prescription,rounds:fitted.prescription.rounds,rest:{exercise:fitted.prescription.exerciseRestSeconds,round:fitted.prescription.roundRestSeconds},estimatedDurationSeconds:fitted.estimate,estimatedSeconds:fitted.estimate};
    return {blocks:[block],transitionSeconds:BLOCK_TRANSITION_SECONDS,estimatedDurationSeconds:fitted.estimate};
  }

  // Hard eligibility for a generated phase: its flag, the owned equipment and the phase's own
  // safety/suitability rules (e.g. no high-impact Warm-up). Selection only scores these
  // candidates. The reachability audit (scripts/audit-exercise-reachability.js) reuses this so
  // it never re-implements phase rules. `difficulty` is the workout difficulty (default Normal).
  function generatedPhaseEligible(exercise, phase, owned, difficulty) {
    if (!exercise || !requirementsMet(exercise,owned)) return false;
    if (phase==='main') return !!(exercise.generator && exercise.main) && !difficultyExcluded(exercise,difficulty);
    if (phase==='warmup') return !!exercise.warmup && exercise.impact!=='high' && preparationMetadataValid(exercise);
    if (phase==='rampup') return !!exercise.rampup && preparationMetadataValid(exercise) && exercise.prepFatigue<=3 && exercise.prepComplexity<=3 && !difficultyExcluded(exercise,difficulty);
    if (phase==='cooldown') return !!exercise.cooldown;
    return false;
  }

  function buildSection(catalogue, kind, targetSeconds, owned, random) {
    const eligible = Object.values(catalogue).filter(exercise => generatedPhaseEligible(exercise,kind,owned)).map(exercise => {
      if (kind==='warmup' && exercise.warmupPrescription) return Object.assign({},exercise,{prescription:Object.assign({},exercise.warmupPrescription),estimatedSeconds:exercise.warmupEstimatedSeconds || exercise.warmupPrescription.value});
      return exercise;
    });
    let candidates = eligible;
    const picked = [], restSeconds = 5;
    let total = 0;
    while (candidates.length && total < targetSeconds-10) {
      const fitting = candidates.filter(exercise => total + exercise.estimatedSeconds + (picked.length?restSeconds:0) <= targetSeconds+5);
      if (!fitting.length) break;
      const index = Math.floor(random()*fitting.length);
      const exercise = fitting[index];
      // Unscored: every fitting candidate is equally likely.
      if (activeTrace) {
        const stages = [];
        narrow(stages,'family-duplicate',eligible.filter(item => !picked.includes(item)),candidates);
        narrow(stages,'duration-fit',candidates,fitting);
        activeTrace({ type:'pick', phase:kind, scored:null, candidates:fitting, picked:exercise, stages });
      }
      picked.push(exercise);
      total += exercise.estimatedSeconds + (picked.length>1?restSeconds:0);
      // Cool-down policy: a family's alternatives (e.g. a stretch and its TRX version) never co-occur.
      candidates = candidates.filter(item => !sameExerciseOrFamily(item,exercise));
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

  // Canonical metadata vocabularies. Catalogue validation rejects anything outside these,
  // so a typo cannot silently change generator behaviour.
  const VALID_PATTERNS = new Set(['squat','hinge','lunge','push','pull','carry','core']);
  const VALID_WARMUP_AREAS = new Set(['hips','knees','ankles','shoulders','trunk']);
  const VALID_LOADS = new Set(['Light','Medium','Heavy']);
  const VALID_FREQUENCIES = new Set(['occasional']);
  const PRESCRIPTION_TYPES = new Set(Object.keys(PRESCRIPTION_MODE_BY_TYPE));
  const RELATIONSHIP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const PHASE_FLAGS = ['generator','main','warmup','rampup','cooldown'];
  const RETIRED_FIELDS = ['alternativeGroup','selectionFamily'];

  function canonicalEquipmentIds(options) {
    const list = (options && options.equipment) || (root.GarageFitData && root.GarageFitData.equipment);
    return Array.isArray(list) ? new Set(list.map(item => typeof item==='string' ? item : item && item.id)) : null;
  }

  // Number of separately performed sides for a prescription: per-side work is performed
  // once for each side; bilateral, alternating and side-less work is performed once.
  function sideCount(exercise) {
    return exercise && exercise.sidedness==='per-side' ? ((exercise.sideOrder && exercise.sideOrder.length) || 2) : 1;
  }

  function isScale(value) {
    return Number.isInteger(value) && value>=1 && value<=5;
  }

  function prescriptionErrors(label, p, exercise, estimatedSeconds, options) {
    options = options || {};
    const errors = [];
    if (!p || typeof p!=='object') return [label+' missing'];
    if (!PRESCRIPTION_TYPES.has(p.type)) return [label+' has invalid type '+JSON.stringify(p.type)];
    if (!Number.isFinite(p.value) || p.value<=0) errors.push(label+' has invalid value');
    for (const bound of ['minValue','maxValue']) if (p[bound]!==undefined && (!Number.isFinite(p[bound]) || p[bound]<=0)) errors.push(label+' has invalid '+bound);
    if (Number.isFinite(p.minValue) && Number.isFinite(p.value) && p.minValue>p.value) errors.push(label+' minValue exceeds value');
    if (Number.isFinite(p.maxValue) && Number.isFinite(p.value) && p.maxValue<p.value) errors.push(label+' maxValue is below value');
    if (options.timedOnly && prescriptionMode(p.type)!=='time') errors.push(label+' must be timed');
    // Per-side prescriptions are always expressed per side ("each side"); every other
    // sidedness states the whole exercise, so its prescription must not claim to be per side.
    if ((exercise.sidedness==='per-side') !== p.type.startsWith('unilateral')) errors.push(label+' does not match sidedness '+exercise.sidedness);
    if (estimatedSeconds!==undefined) {
      if (!Number.isFinite(estimatedSeconds) || estimatedSeconds<=0) errors.push(label+' has invalid estimated seconds');
      else if (prescriptionMode(p.type)==='time' && Number.isFinite(p.value) && estimatedSeconds!==p.value*sideCount(exercise)) errors.push(label+' estimated seconds do not budget every side');
    }
    return errors;
  }

  // Structural validation of the exercise catalogue. Accepts the keyed catalogue object or
  // an array of exercise definitions (so duplicate IDs can be detected before keying).
  function validateCatalogue(catalogue, options) {
    const errors = [];
    const entries = Array.isArray(catalogue) ? catalogue.map(exercise => [exercise && exercise.id, exercise]) : Object.entries(catalogue || {});
    const seen = new Set();
    const equipmentIds = canonicalEquipmentIds(options);
    for (const [key, exercise] of entries) {
      if (!exercise || typeof exercise!=='object') { errors.push(String(key)+': invalid exercise entry'); continue; }
      const id = exercise.id;
      if (typeof id!=='string' || !RELATIONSHIP_ID.test(id)) { errors.push(String(key)+': missing or malformed id'); continue; }
      if (seen.has(id)) errors.push(id+': duplicate id');
      seen.add(id);
      if (!Array.isArray(catalogue) && key!==id) errors.push(id+': catalogue key '+JSON.stringify(key)+' does not match id');
      if (typeof exercise.name!=='string' || !exercise.name.trim()) errors.push(id+': missing name');
      const validInstruction=typeof exercise.instruction==='string' && !!exercise.instruction.trim() && exercise.instruction.length<=180 && !/[\r\n]/.test(exercise.instruction);
      if (exercise.instruction!==undefined && !validInstruction) errors.push(id+': instruction must be a non-empty, single-line string of at most 180 characters');
      if (exercise.voiceInstruction!==undefined && typeof exercise.voiceInstruction!=='boolean') errors.push(id+': voiceInstruction must be boolean');
      if (exercise.voiceInstruction===true && !validInstruction) errors.push(id+': voiceInstruction requires a valid instruction');

      if (!Array.isArray(exercise.equipment)) errors.push(id+': equipment must be an array of alternative groups');
      else for (const group of exercise.equipment) {
        if (!Array.isArray(group) || !group.length) { errors.push(id+': empty or malformed equipment group'); continue; }
        for (const item of group) if (typeof item!=='string' || (equipmentIds && !equipmentIds.has(item))) errors.push(id+': unknown equipment '+JSON.stringify(item));
      }

      if (!Array.isArray(exercise.patterns)) errors.push(id+': patterns must be an array');
      else {
        for (const pattern of exercise.patterns) if (!VALID_PATTERNS.has(pattern)) errors.push(id+': invalid pattern '+JSON.stringify(pattern));
        if (new Set(exercise.patterns).size!==exercise.patterns.length) errors.push(id+': duplicate pattern');
      }
      if (exercise.conditioning!==undefined && typeof exercise.conditioning!=='boolean') errors.push(id+': conditioning must be boolean');
      if (!isScale(exercise.strength)) errors.push(id+': strength must be an integer from 1 to 5');
      if (!isScale(exercise.cardio)) errors.push(id+': cardio must be an integer from 1 to 5');
      if (exercise.difficulty!=null && !EXERCISE_DIFFICULTIES.has(exercise.difficulty)) errors.push(id+': invalid difficulty '+JSON.stringify(exercise.difficulty));
      if (!VALID_IMPACT_LEVELS.has(exercise.impact)) errors.push(id+': invalid impact '+JSON.stringify(exercise.impact));
      if (exercise.load!=null && !VALID_LOADS.has(exercise.load)) errors.push(id+': invalid load '+JSON.stringify(exercise.load));
      if (!VALID_BODY_POSITIONS.has(exercise.bodyPosition)) errors.push(id+': invalid body position');
      if (!Array.isArray(exercise.movementPlanes) || !exercise.movementPlanes.length || !exercise.movementPlanes.every(plane=>VALID_MOVEMENT_PLANES.has(plane))) errors.push(id+': invalid movement planes');

      if (!VALID_SIDEDNESS.has(exercise.sidedness)) errors.push(id+': invalid sidedness');
      if (exercise.unilateral!==undefined && exercise.unilateral!==(exercise.sidedness==='per-side')) errors.push(id+': unilateral flag does not match sidedness');
      if (exercise.mainRole!=null&&!MAIN_ROLES.has(exercise.mainRole)) errors.push(id+': invalid main role');
      for (const cue of exercise.timedCues || []) {
        const at=cue&&cue.at,validText=cue&&typeof cue.text==='string'&&cue.text.trim().length>0;
        const validFraction=at&&at.type==='fraction'&&Number.isFinite(at.value)&&at.value>0&&at.value<1;
        const validSeconds=at&&at.type==='seconds'&&Number.isFinite(at.value)&&at.value>0;
        if(!validText||(!validFraction&&!validSeconds))errors.push(id+': invalid timed cue');
      }

      // Phase flags.
      for (const flag of PHASE_FLAGS) if (exercise[flag]!==undefined && typeof exercise[flag]!=='boolean') errors.push(id+': '+flag+' must be boolean');
      if (exercise.generator && !exercise.main) errors.push(id+': generator exercises must be Main exercises');
      if (exercise.cooldown && (exercise.main || exercise.warmup || exercise.rampup)) errors.push(id+': cool-down exercises cannot also be work or preparation exercises');

      // Base (Main / fixed) prescription.
      if (VALID_SIDEDNESS.has(exercise.sidedness)) {
        prescriptionErrors('prescription', exercise.prescription, exercise, exercise.estimatedSeconds).forEach(error=>errors.push(id+': '+error));
        if (Array.isArray(exercise.prescriptionModes) && exercise.prescriptionModes.length) {
          const mode = prescriptionMode(exercise.prescription && exercise.prescription.type);
          if (!mode || !exercise.prescriptionModes.includes(mode)) errors.push(id+': prescription mode not permitted');
        }
      }

      // Main protocols.
      if (exercise.mainProtocols!=null) {
        if (!exercise.main) errors.push(id+': mainProtocols set on a non-Main exercise');
        if (!Array.isArray(exercise.mainProtocols) || !exercise.mainProtocols.length) errors.push(id+': mainProtocols must be a non-empty array');
        else {
          for (const protocol of exercise.mainProtocols) if (!MAIN_PROTOCOLS.has(protocol)) errors.push(id+': invalid main protocol '+JSON.stringify(protocol));
          // Timed intervals play one fixed work period per exercise; per-side work would need two.
          if (exercise.sidedness==='per-side' && exercise.mainProtocols.includes('timed_intervals')) errors.push(id+': per-side exercises cannot use timed intervals');
        }
      }

      // Preparation metadata.
      for (const field of ['prepIntensity','prepFatigue','prepComplexity']) {
        if (exercise[field]!=null && !isScale(exercise[field])) errors.push(id+': '+field+' must be an integer from 1 to 5');
      }
      if (exercise.warmupAreas!==undefined && (!Array.isArray(exercise.warmupAreas) || !exercise.warmupAreas.every(area=>VALID_WARMUP_AREAS.has(area)))) errors.push(id+': invalid warm-up areas');
      if (exercise.warmupPhase!=null && !Object.prototype.hasOwnProperty.call(WARMUP_PHASE_ORDER,exercise.warmupPhase)) errors.push(id+': invalid warm-up phase '+JSON.stringify(exercise.warmupPhase));
      if ((exercise.warmup || exercise.rampup) && !preparationMetadataValid(exercise)) errors.push(id+': invalid preparation metadata');
      if (exercise.warmup) {
        if (exercise.warmupPhase==null) errors.push(id+': warm-up exercise missing warm-up phase');
        if (exercise.warmupPrescription!=null) prescriptionErrors('warm-up prescription', exercise.warmupPrescription, exercise, exercise.warmupEstimatedSeconds==null?undefined:exercise.warmupEstimatedSeconds, {timedOnly:true}).forEach(error=>errors.push(id+': '+error));
      } else {
        if (exercise.warmupPhase!=null || exercise.warmupPrescription!=null) errors.push(id+': warm-up metadata set on a non-warm-up exercise');
      }
      if (exercise.rampup) {
        const p = exercise.rampupPrescription;
        if (!p || !p.type || !Number.isFinite(p.value) || !Number.isFinite(exercise.rampupEstimatedSeconds)) errors.push(id+': invalid ramp-up prescription');
        else prescriptionErrors('ramp-up prescription', p, exercise, exercise.rampupEstimatedSeconds, {timedOnly:true}).forEach(error=>errors.push(id+': '+error));
      } else if (exercise.rampupPrescription!=null) errors.push(id+': ramp-up prescription set on a non-ramp-up exercise');

      // Relationship metadata.
      for (const field of ['family','repetitionClass']) {
        if (exercise[field]!=null && (typeof exercise[field]!=='string' || !RELATIONSHIP_ID.test(exercise[field]))) errors.push(id+': invalid '+field+' '+JSON.stringify(exercise[field]));
      }
      for (const field of RETIRED_FIELDS) if (exercise[field]!==undefined) errors.push(id+': '+field+' is retired; use family or repetitionClass');
      if (exercise.frequency!=null) {
        if (!VALID_FREQUENCIES.has(exercise.frequency)) errors.push(id+': invalid frequency '+JSON.stringify(exercise.frequency));
        else if (!exercise.family) errors.push(id+': frequency requires a family');
      }
    }
    return errors;
  }

  // Throws with every problem listed, so authoring mistakes fail loudly.
  function assertValidCatalogue(catalogue, options) {
    const errors = validateCatalogue(catalogue, options);
    if (errors.length) throw new Error('Invalid exercise catalogue: '+errors.join(', '));
    return catalogue;
  }

  // `seconds` is the phase prescription value: the whole interval for bilateral, alternating
  // and side-less work, or the time for each side of per-side work. The estimate budgets
  // every side, matching the separate-side playback of per-side exercises.
  function phaseExercise(exercise, kind, seconds) {
    const source = kind==='rampup' ? exercise.rampupPrescription : exercise.warmupPrescription || exercise.prescription;
    const prescription = Object.assign({}, source || exercise.prescription);
    const timed = prescriptionMode(prescription.type)==='time';
    if (timed && Number.isFinite(seconds)) prescription.value = seconds;
    const fallback = (kind==='rampup'?exercise.rampupEstimatedSeconds:exercise.warmupEstimatedSeconds)||exercise.estimatedSeconds;
    return Object.assign({}, exercise, { prescription, estimatedSeconds:timed&&Number.isFinite(seconds)?seconds*sideCount(exercise):fallback });
  }

  function roundToFive(value) {
    return Math.max(5,Math.round(value/5)*5);
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

  function scoreWarmupCandidate(exercise, selected, mainExercises, owned, context, parts) {
    const previous = selected[selected.length-1];
    context = context || {};
    let score = credit(parts,'prep-demand',12 - exercise.prepIntensity*1.5 - exercise.prepFatigue*2 - exercise.prepComplexity*1.5);
    const mainPatterns = new Set((mainExercises || []).slice(0,3).flatMap(selectionTags));
    if (selectionTags(exercise).some(pattern=>mainPatterns.has(pattern))) score += credit(parts,'main-pattern-match',1.5);
    const lowerCoverage=lowerJointCoverage(exercise).length;
    const lowerSelected=selected.filter(meaningfulLowerPrep).length;
    const lowerTarget=context.lowerTarget||1;
    if (lowerSelected<lowerTarget) score += credit(parts,'lower-coverage',lowerCoverage*2.5);
    // Beyond the required minimum, further leg-driven prep follows upcoming Main demand
    // rather than crowding out hip mobility and upper/trunk preparation.
    else if (meaningfulLowerPrep(exercise)) score += credit(parts,'lower-demand',Math.max(-1.5,Math.min(1.5,((context.lowerDemand||0)-(context.lowerDemandThreshold||.5))*4)));
    if (previous) {
      if (previous.bodyPosition===exercise.bodyPosition) score += credit(parts,'body-position',1);
      else if (previous.bodyPosition!=='mixed' && exercise.bodyPosition!=='mixed') score += credit(parts,'body-position',-.8);
      if (sectionSetupKey(previous,owned)===sectionSetupKey(exercise,owned)) score += credit(parts,'same-setup',.6);
      if (sharedPatterns(previous,exercise).length) score += credit(parts,'adjacent-pattern',-1);
    }
    score += credit(parts,'repeated-pattern',-preparationPatternPenalty(exercise,selected));
    return score;
  }

  function scoreRampupCandidate(exercise, position, selected, warmup, mainExercises, owned, focus, parts) {
    const previous = selected[selected.length-1] || warmup[warmup.length-1];
    const firstMain = mainExercises[0];
    const targetIntensity = 3 + 2*position;
    let score = credit(parts,'prep-demand',14 - Math.abs(exercise.prepIntensity-targetIntensity)*3 - exercise.prepFatigue*1.8 - Math.max(0,exercise.prepComplexity-2)*1.5);
    const specificity = contextSpecificity(exercise,mainExercises);
    score += credit(parts,'main-specificity',specificity * (2 + 5*position));
    // Conditioning prep suits the early, pulse-raising end of Ramp-up (categorical); the
    // Cardio-focus `cardio` term below grades how much it raises the pulse.
    if (exercise.conditioning) score += credit(parts,'conditioning-position',(1-position)*2 + (focus==='cardio'?2:focus==='strength'?-0.5:0.5));
    if (focus==='strength' && exercise.impact==='high') score += credit(parts,'focus-impact',-1.5);
    if (focus==='strength') score += credit(parts,'main-specificity',specificity*1.2);
    if (focus==='cardio') score += credit(parts,'focus-demand',exercise.cardio*.35);
    if (previous) {
      if (previous.impact==='high' && exercise.impact==='high') score += credit(parts,'adjacent-high-impact',-10);
      const intensityDrop = previous.prepIntensity - exercise.prepIntensity;
      if (intensityDrop>1) score += credit(parts,'intensity-drop',-(intensityDrop*3));
      if (previous.bodyPosition===exercise.bodyPosition) score += credit(parts,'body-position',1);
      else if (previous.bodyPosition!=='mixed' && exercise.bodyPosition!=='mixed') score += credit(parts,'body-position',-1.2);
      if (sectionSetupKey(previous,owned)===sectionSetupKey(exercise,owned)) score += credit(parts,'same-setup',.8);
    }
    if (exercise.impact==='high') score += credit(parts,'impact-position',position*1.5 - (1-position)*2);
    if (exercise.unilateral && position<.5) score += credit(parts,'unilateral-early',-1);
    if (warmup.some(item=>sameExerciseOrFamily(item,exercise))) score += credit(parts,'family-duplicate',-3);
    // Discourage (but don't forbid) picking another exercise from the same broad repetition
    // family/class as one already used in Warm-up or earlier in Ramp-up itself.
    if (warmup.some(item=>sameRepetitionClass(item,exercise)) || selected.some(item=>sameRepetitionClass(item,exercise))) score += credit(parts,'repetition-class',-5);
    score += credit(parts,'repeated-pattern',-preparationPatternPenalty(exercise,selected));
    // The boundary is one continuous preparation sequence, but distant Warm-up
    // patterns must not outweigh the Ramp-up's handoff into Main.
    if (previous && sharesMajorPattern(previous,exercise)) score += credit(parts,'adjacent-pattern',-12);
    if (position>.65) {
      score += credit(parts,'main-equipment',contextEquipmentScore(exercise,mainExercises,owned)*2);
      if (firstMain && exercise.bodyPosition===firstMain.bodyPosition) score += credit(parts,'main-position',2);
      if (firstMain && sharedPatterns(exercise,firstMain).length && exercise.prepFatigue>=3) score += credit(parts,'main-fatigue',-5);
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
    // Values and bounds are prescription values (per side for per-side work); every side
    // costs time, so budgeting multiplies by the number of sides. Default bounds describe a
    // whole exercise and are shared between the sides of per-side work.
    const sides = exercises.map(sideCount);
    const mins = defaults.map((p,i)=>Number.isFinite(p.minValue)?p.minValue:Math.min(p.value,roundToFive((kind==='rampup'?20:15)/sides[i])));
    const maxs = defaults.map((p,i)=>Number.isFinite(p.maxValue)?p.maxValue:Math.max(p.value,roundToFive((kind==='rampup'?45:30)/sides[i])));
    const desired = defaults.map(p=>p.value);
    const cost = list => list.reduce((sum,value,i)=>sum+value*sides[i],0);
    let values = desired.slice();
    let current = cost(values);
    const target = Math.min(cost(maxs),Math.max(cost(mins),available));
    let delta = target-current;
    let guard = 0;
    while (Math.abs(delta)>=1 && guard++<500) {
      let changed=false;
      for (let i=0;i<values.length && Math.abs(delta)>=1;i++) {
        const step = delta>0 ? 5 : -5;
        const candidate = values[i]+step;
        if (candidate>=mins[i] && candidate<=maxs[i]) { values[i]=candidate; delta-=step*sides[i]; changed=true; }
      }
      if (!changed) break;
    }
    const fitted = exercises.map((exercise,index)=>phaseExercise(exercise,kind,values[index]));
    return {exercises:fitted,estimatedSeconds:fitted.reduce((sum,ex)=>sum+ex.estimatedSeconds,0)+restSeconds*Math.max(0,fitted.length-1)};
  }

  function selectWarmup(catalogue, targetSeconds, owned, mainExercises, random, options) {
    options = options || {};
    const focus = options.focus || 'balanced';
    // High-impact movements are a safety exclusion for warm-ups specifically; they remain
    // available to a suitable Main phase, which is scored (not hard-filtered) on impact.
    const eligible = Object.values(catalogue).filter(ex=>generatedPhaseEligible(ex,'warmup',owned));
    let candidates = eligible;
    const restSeconds=5, selected=[];
    const targetCount=Math.max(2,Math.min(candidates.length,Math.round((targetSeconds+5)/25)));
    const lowerDemand=lowerBodyDemand(options.mainDemandExercises||mainExercises,focus);
    const context={lowerDemand,lowerDemandThreshold:LOWER_DEMAND_THRESHOLD[focus]||LOWER_DEMAND_THRESHOLD.balanced,lowerTarget:lowerPrepTarget(targetCount,lowerDemand,focus)};
    const upperCap=upperTrunkOnlyCap(targetCount);
    for(let slot=0;slot<targetCount && candidates.length;slot++) {
      const stages=activeTrace?[]:null;
      // Exercises an earlier pick removed as a duplicate or direct variant.
      if (stages) narrow(stages,'family-duplicate',eligible.filter(ex=>!selected.includes(ex)),candidates);
      let slotCandidates=candidates;
      // Both coverage rules are soft-mandatory: they narrow the slot only while an eligible
      // alternative exists, so a constrained catalogue still produces a warm-up.
      const lowerNeeded=context.lowerTarget-selected.filter(meaningfulLowerPrep).length;
      if (lowerNeeded>0 && lowerNeeded>=targetCount-slot) {
        const lowerCandidates=slotCandidates.filter(meaningfulLowerPrep);
        if (lowerCandidates.length) slotCandidates=narrow(stages,'lower-coverage',slotCandidates,lowerCandidates);
      }
      if (selected.filter(ex=>!lowerJointCoverage(ex).length).length>=upperCap) {
        const lowerInvolved=slotCandidates.filter(ex=>lowerJointCoverage(ex).length);
        if (lowerInvolved.length) slotCandidates=narrow(stages,'upper-trunk-cap',slotCandidates,lowerInvolved);
      }
      // Intensity ordering follows selection, so any two warm-up exercises may end up adjacent:
      // prefer candidates that repeat no major pattern already selected (soft-mandatory, below coverage).
      const freshPatterns=slotCandidates.filter(ex=>!selected.some(item=>sharesMajorPattern(item,ex)));
      if (freshPatterns.length) slotCandidates=narrow(stages,'major-pattern-repeat',slotCandidates,freshPatterns);
      const scored=slotCandidates.map(exercise=>({exercise,score:scoreWarmupCandidate(exercise,selected,mainExercises,owned,context)}));
      const picked=tracedPick(scored,random,SHORTLIST_MARGIN,()=>({phase:'warmup',stages,
        explain:exercise=>{const parts={};scoreWarmupCandidate(exercise,selected,mainExercises,owned,context,parts);return parts;}})); if(!picked) break;
      selected.push(picked); candidates=candidates.filter(ex=>!sameExerciseOrFamily(ex,picked));
    }
    selected.sort((a,b)=>{
      const intensity=a.prepIntensity-b.prepIntensity;
      if (intensity) return intensity;
      return (WARMUP_PHASE_ORDER[a.warmupPhase]??0)-(WARMUP_PHASE_ORDER[b.warmupPhase]??0);
    });
    // Selection precedes intensity ordering. Repair adjacencies created by that ordering
    // with an unused, eligible exercise in the same intensity window when possible.
    for(let pass=0;pass<2;pass++) for(let index=1;index<selected.length;index++) {
      if (!sharesMajorPattern(selected[index-1],selected[index])) continue;
      const before=selected[index-1], after=selected[index+1], current=selected[index];
      const alternatives=candidates.filter(ex=>ex.prepIntensity>=before.prepIntensity &&
        (!after || ex.prepIntensity<=after.prepIntensity) &&
        !selected.some(item=>sameExerciseOrFamily(item,ex)) &&
        !sharesMajorPattern(before,ex) && (!after || !sharesMajorPattern(ex,after)));
      const coverage=selected.filter(meaningfulLowerPrep).length;
      const upperOnly=selected.filter(ex=>!lowerJointCoverage(ex).length).length;
      const viable=alternatives.filter(ex=>coverage-(meaningfulLowerPrep(current)?1:0)+(meaningfulLowerPrep(ex)?1:0)>=context.lowerTarget &&
        upperOnly-(!lowerJointCoverage(current).length?1:0)+(!lowerJointCoverage(ex).length?1:0)<=upperCap);
      if (viable.length) {
        viable.sort((a,b)=>Math.abs(a.prepIntensity-current.prepIntensity)-Math.abs(b.prepIntensity-current.prepIntensity) ||
          scoreWarmupCandidate(b,selected.slice(0,index),mainExercises,owned,context)-scoreWarmupCandidate(a,selected.slice(0,index),mainExercises,owned,context));
        if (activeTrace) activeTrace({type:'replace',phase:'warmup',rule:'adjacent-pattern',removed:selected[index],added:viable[0]});
        selected[index]=viable[0];
        candidates=candidates.filter(ex=>!sameExerciseOrFamily(ex,viable[0]));
      }
    }
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

  function selectRampup(catalogue, targetSeconds, owned, mainExercises, warmup, focus, random, difficulty) {
    const eligible = Object.values(catalogue).filter(ex=>generatedPhaseEligible(ex,'rampup',owned,difficulty));
    const restSeconds=5, count=Math.min(chooseRampCount(targetSeconds),eligible.length);
    let best=null;
    for(let attempt=0;attempt<8;attempt++) {
      const selected=[];
      for(let slot=0;slot<count;slot++) {
        const position=count===1?1:slot/(count-1);
        const stages=activeTrace?[]:null;
        let candidates=eligible.filter(ex=>!selected.some(item=>item.id===ex.id));
        // An exercise (or a direct variant of one) already used earlier in Ramp-up or in Warm-up
        // shouldn't normally repeat, but this stays soft-mandatory: in a genuinely constrained
        // catalogue the duplicate remains available as a last resort rather than breaking generation.
        candidates=narrow(stages,'family-duplicate',candidates,preferNonDuplicates(candidates,selected));
        candidates=narrow(stages,'family-duplicate',candidates,preferNonDuplicates(candidates,warmup));
        candidates=narrow(stages,'adjacent-pattern',candidates,preferDifferentPattern(candidates,selected[selected.length-1] || warmup[warmup.length-1]));
        // Consecutive high-impact work is a Ramp-up fault (validatePreparation); avoid it whenever
        // an alternative exists rather than relying on the score penalty, which a shifted pool can outweigh.
        if (selected.length && selected[selected.length-1].impact==='high') {
          const lowerImpact=candidates.filter(ex=>ex.impact!=='high');
          if (lowerImpact.length) candidates=narrow(stages,'adjacent-high-impact',candidates,lowerImpact);
        }
        const scored=candidates.map(exercise=>({exercise,score:scoreRampupCandidate(exercise,position,selected,warmup,mainExercises,owned,focus)}));
        const picked=tracedPick(scored,random,0,()=>({phase:'rampup',position,stages,
          explain:exercise=>{const parts={};scoreRampupCandidate(exercise,position,selected,warmup,mainExercises,owned,focus,parts);return parts;}})); if(!picked) break; selected.push(picked);
      }
      const score=rampSequenceScore(selected,warmup,mainExercises,owned,focus);
      if(activeTrace) activeTrace({type:'rampup-attempt',attempt,score});
      if(!best||score>best.score) best={exercises:selected,score,attempt};
    }
    if(activeTrace) activeTrace({type:'rampup-result',attempt:best?best.attempt:null});
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

  function buildPreparation(catalogue, budget, owned, mainExercises, focus, random, allMainExercises, difficulty) {
    const warmup=selectWarmup(catalogue,budget.warmup,owned,mainExercises,random,{focus,mainDemandExercises:allMainExercises});
    const rampup=selectRampup(catalogue,budget.rampup,owned,mainExercises,warmup.exercises,focus,random,difficulty);
    return {warmup,rampup,issues:validatePreparation(warmup,rampup,mainExercises)};
  }

  function copyExercise(exercise) {
    return Object.assign({},exercise,{patterns:(exercise.patterns||[]).slice(),movementPlanes:(exercise.movementPlanes||[]).slice(),warmupAreas:(exercise.warmupAreas||[]).slice(),equipment:(exercise.equipment||[]).map(group=>group.slice()),prescription:Object.assign({},exercise.prescription),timedCues:(exercise.timedCues||[]).map(cue=>Object.assign({},cue,{at:Object.assign({},cue.at)}))});
  }

  // options.trace: optional diagnostic callback receiving selection events (see tracedPick and
  // scripts/audit-exercise-reachability.js). Events are only valid during the call.
  function generate(options) {
    if(!options.trace)return generateWorkout(options);
    const outer=activeTrace;
    activeTrace=options.trace;
    try { return generateWorkout(options); }
    finally { activeTrace=outer; }
  }

  function generateWorkout(options) {
    const catalogue=options.catalogue;
    const duration=Number(options.duration);
    const focus=String(options.focus||'balanced').toLowerCase();
    const difficulty=workoutDifficulty(options.difficulty);
    const owned=options.equipment||[],history=options.history||[],random=options.random||Math.random;
    const budget=BUDGETS[duration]||BUDGETS[20],rest=RESTS[focus]||RESTS.balanced;
    assertValidCatalogue(catalogue);
    const eligible=Object.values(catalogue).filter(exercise=>generatedPhaseEligible(exercise,'main',owned,difficulty));
    if(!eligible.length)throw new Error('No eligible exercises available.');
    const main=composeMain(catalogue,eligible,budget,duration,focus,owned,history,rest,random,difficulty);
    const firstMain=main.blocks[0].exercises;
    const preparation=buildPreparation(catalogue,budget,owned,firstMain,focus,random,main.blocks.flatMap(block=>block.exercises),difficulty);
    const cooldown=buildSection(catalogue,'cooldown',budget.cooldown,owned,random);
    const estimatedSeconds=preparation.warmup.estimatedSeconds+preparation.rampup.estimatedSeconds+main.estimatedDurationSeconds+cooldown.estimatedSeconds;
    const workout={
      schemaVersion:2,id:'generated-'+Date.now(),duration,focus,difficulty,estimatedSeconds,
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
    // A swap keeps the workout's difficulty: its Main eligibility and score preference.
    const difficulty=workoutDifficulty(workout.difficulty);
    let eligible=Object.values(catalogue).filter(exercise=>generatedPhaseEligible(exercise,'main',owned,difficulty)&&protocolCompatible(exercise,block.protocol)&&exercise.id!==current.id&&!mainFamilyCapReached(exercise,otherExercises));
    const fresh=eligible.filter(exercise=>!otherIds.has(exercise.id));if(fresh.length)eligible=fresh;
    const before=exerciseIndex>0?block.exercises[exerciseIndex-1]:(blocks[(blockIndex||0)-1]||{exercises:[]}).exercises.at(-1);
    const after=exerciseIndex<block.exercises.length-1?block.exercises[exerciseIndex+1]:(blocks[(blockIndex||0)+1]||{exercises:[]}).exercises[0];
    const scored=eligible.map(exercise=>{
      let score=sharedPatterns(exercise,current).length*8;
      score-=Math.abs(exercise.strength-current.strength)*1.5+Math.abs(exercise.cardio-current.cardio)*1.5;
      if(exercise.impact===current.impact)score+=2;
      if(primaryEquipment(exercise)===primaryEquipment(current))score+=2;
      score-=(sharedPatterns(before,exercise).length+sharedPatterns(exercise,after).length)*12;
      score-=repeatedMajorPatternCount(exercise,otherExercises)*8;
      if(otherIds.has(exercise.id))score-=42;
      const adjacentHighImpact=exercise.impact==='high'&&((before&&before.impact==='high')||(after&&after.impact==='high'));
      if(adjacentHighImpact)score-=12;
      else score+=difficultyCredit(exercise,difficulty);
      return {exercise,score};
    });
    const replacement=controlledPick(scored,random,SHORTLIST_MARGIN);if(!replacement)return workout;
    block.exercises[exerciseIndex]=copyExercise(replacement);
    block.estimatedDurationSeconds=estimateBlockDuration(block);block.estimatedSeconds=block.estimatedDurationSeconds;
    recalcWorkoutEstimate(workout);return workout;
  }

  function swapPreparation(workout, section, exerciseIndex, options) {
    if(!['warmup','rampup'].includes(section)||!workout[section]) return workout;
    const catalogue=options.catalogue, owned=options.equipment||[], random=options.random||Math.random, current=workout[section].exercises[exerciseIndex], main=workout.blocks[0].exercises;
    const otherPrep=workout.warmup.exercises.concat(workout.rampup.exercises).filter(ex=>ex!==current);
    let eligible=Object.values(catalogue).filter(ex=>ex[section]&&preparationMetadataValid(ex)&&requirementsMet(ex,owned)&&ex.id!==current.id&&!otherPrep.some(item=>item.id===ex.id));
    eligible=preferNonDuplicates(eligible,otherPrep);
    if(section==='warmup') eligible=eligible.filter(ex=>ex.impact!=='high');
    if(section==='rampup') eligible=eligible.filter(ex=>ex.prepFatigue<=3&&ex.prepComplexity<=3&&!difficultyExcluded(ex,workoutDifficulty(workout.difficulty)));
    if(section==='warmup') {
      // A swap must not undo the warm-up's lower-body coverage or tip it into upper/trunk skew.
      const others=workout.warmup.exercises.filter((_,index)=>index!==exerciseIndex), count=workout.warmup.exercises.length;
      const demand=lowerBodyDemand(mainBlocks(workout).flatMap(block=>block.exercises),workout.focus);
      if (meaningfulLowerPrep(current) && others.filter(meaningfulLowerPrep).length<lowerPrepTarget(count,demand,workout.focus)) {
        const lowerEligible=eligible.filter(meaningfulLowerPrep); if(lowerEligible.length) eligible=lowerEligible;
      }
      if (others.filter(ex=>!lowerJointCoverage(ex).length).length>=upperTrunkOnlyCap(count)) {
        const lowerInvolved=eligible.filter(ex=>lowerJointCoverage(ex).length); if(lowerInvolved.length) eligible=lowerInvolved;
      }
    }
    // The replacement inherits the slot's total time, so prefer candidates whose sides can
    // share it evenly in whole 5-second prescription steps.
    const evenSplit=eligible.filter(ex=>current.estimatedSeconds%(5*sideCount(ex))===0); if(evenSplit.length) eligible=evenSplit;
    const position=workout[section].exercises.length===1?1:exerciseIndex/(workout[section].exercises.length-1);
    const before=workout[section].exercises[exerciseIndex-1] || (section==='rampup'?workout.warmup.exercises.at(-1):null);
    const after=workout[section].exercises[exerciseIndex+1] || (section==='warmup'?workout.rampup.exercises[0]:null);
    if(section==='warmup') {
      const ordered=eligible.filter(ex=>(!before || ex.prepIntensity>=before.prepIntensity) &&
        (!workout.warmup.exercises[exerciseIndex+1] || ex.prepIntensity<=workout.warmup.exercises[exerciseIndex+1].prepIntensity));
      if(ordered.length) eligible=ordered;
    }
    const separated=eligible.filter(ex=>(!before || !sharesMajorPattern(before,ex)) && (!after || !sharesMajorPattern(ex,after)));
    if(separated.length) eligible=separated;
    else if ((!before || !sharesMajorPattern(before,current)) && (!after || !sharesMajorPattern(current,after))) return workout;
    const scored=eligible.map(exercise=>({exercise,score:(section==='rampup'?scoreRampupCandidate(exercise,position,workout[section].exercises.slice(0,exerciseIndex),workout.warmup.exercises,main,owned,workout.focus):scoreWarmupCandidate(exercise,workout.warmup.exercises.slice(0,exerciseIndex),main,owned) - Math.abs(exercise.prepIntensity-current.prepIntensity)*2 + (before&&before.bodyPosition===exercise.bodyPosition?1:0)) - (after&&sharesMajorPattern(exercise,after)?12:0)}));
    const replacement=controlledPick(scored,random,section==='warmup'?SHORTLIST_MARGIN:0); if(!replacement) return workout;
    // Keep the slot's total time: a per-side replacement shares it between its sides.
    const seconds=roundToFive(current.estimatedSeconds/sideCount(replacement));
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

  root.GarageFitGenerator = { BUDGETS, RESTS, MAIN_PROTOCOLS, MAIN_INTENTS, MAIN_ROLES, BLOCK_TRANSITION_SECONDS, WARMUP_PHASE_ORDER, EQUIPMENT_DIVERSITY, EQUIPMENT_DOMINANCE_CAP, BLOCK_DOMINANCE_CAP, WORKOUT_DIFFICULTIES, EXERCISE_DIFFICULTIES, DIFFICULTY_POLICY, workoutDifficulty, difficultyExcluded, difficultyCredit, SHORTLIST_SIZE, SHORTLIST_MARGIN, WINDOW_MAX_RANKS, SUPPORTING_ROUTE, candidateWindowRanks, controlledPick, selectionWindow, selectionRanks, generatedPhaseEligible, requirementsMet, sectionSetupKey, groupSectionBySetup, sharedPatterns, selectionTags, sameFamily, sameRepetitionClass, sameExerciseOrFamily, mainFamilyCapReached, prescriptionMode, sideCount, phaseExercise, fitTimedDurations, recentUsePenalty, preparationMetadataValid, validateCatalogue, assertValidCatalogue, VALID_PATTERNS, VALID_WARMUP_AREAS, validatePreparation, estimateMain, estimateBlockDuration, resolveBlockSteps, protocolCompatible, protocolWeights, preferredRepeatCount, repetitionPenalty, mainQualityPenalty, validateMain, mainVarietyIssues, equipmentUsageSeconds, viableEquipmentTypes, primaryEquipment, blockRepeatCount, selectBlockExercises, selectWarmup, lowerBodyDemand, lowerPrepTarget, selectRampup, scoreRampupCandidate, mainBlocks, normaliseWorkout, generate, swap, swapPreparation };

  if (typeof window!=='undefined' && typeof document!=='undefined' && typeof window.addEventListener==='function') window.addEventListener('load',()=>{
    if (document.querySelector('script[data-garagefit-rampup-ui]')) return;
    const script=document.createElement('script'); script.src='js/rampup-ui.js'; script.dataset.garagefitRampupUi='true'; document.body.appendChild(script);
  });
})(typeof window==='undefined' ? globalThis : window);
