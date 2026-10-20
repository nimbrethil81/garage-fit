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
  // route a source of variety rather than a fixed insertion of the only accessory available:
  // the route slot's shortlist spans every route candidate (still weighted by score), so a
  // growing accessory pool shares the route instead of its top few scores taking it. A Main
  // that drew the route keeps the fittest valid attempt that filled it (see composeMain).
  const SUPPORTING_ROUTE = { minDuration:30, probability:.25, minRoles:4, minCandidates:2 };
  const SCORE_TIE_EPSILON = 1e-9;
  // Main score penalty when the previous Main exercise shares a non-null repetitionClass (soft, never an exclusion).
  const MAIN_REPETITION_CLASS_PENALTY = 10;
  const RECENT_EXACT_PENALTIES = [18,10,6,3];
  const RECENT_PATTERN_PENALTIES = [6,3,2,1];
  // Main block protocol structure. A block prescription describes structure only: one repeat
  // count (`repeatKey`) plus the protocol conditions (`conditionFields`) that make two
  // performances comparable. Each resolved exercise step records its repetition in `stepKey`,
  // one of the positions Session Tracker occurrence ids encode (round, set, cycle, minute, ladderStep,
  // pyramidStep or complexSequence).
  // Training History (js/training-history.js) and the Coach model (js/coach-model.js) keep
  // their own copies of this vocabulary; tests/protocol-contracts.test.js fails if they drift.
  // See docs/WORKOUT_PROTOCOLS.md before adding a protocol.
  const PROTOCOL_SHAPES = Object.freeze({
    rounds:Object.freeze({repeatKey:'rounds',stepKey:'round',conditionFields:Object.freeze(['exerciseRestSeconds','roundRestSeconds'])}),
    paired_sets:Object.freeze({repeatKey:'sets',stepKey:'set',conditionFields:Object.freeze(['betweenExercisesSeconds','betweenSetsSeconds'])}),
    timed_intervals:Object.freeze({repeatKey:'cycles',stepKey:'cycle',conditionFields:Object.freeze(['workSeconds','transitionSeconds'])}),
    emom:Object.freeze({repeatKey:'minutes',stepKey:'minute',conditionFields:Object.freeze(['slotSeconds','targets'])}),
    ladder:Object.freeze({repeatKey:'repSteps',stepKey:'ladderStep',conditionFields:Object.freeze(['exerciseRestSeconds','stepRestSeconds'])}),
    pyramid:Object.freeze({repeatKey:'steps',stepKey:'pyramidStep',conditionFields:Object.freeze(['stepRestSeconds'])}),
    complex:Object.freeze({repeatKey:'sequences',stepKey:'complexSequence',conditionFields:Object.freeze(['targets','changeoverSeconds','sequenceRestSeconds'])}),
    density:Object.freeze({repeatKey:'repeats',stepKey:'densityRound',conditionFields:Object.freeze(['targets','timeCapSeconds','exerciseRestSeconds','roundRestSeconds'])})
  });
  const MAIN_PROTOCOLS = new Set(Object.keys(PROTOCOL_SHAPES));
  const PROTOCOL_REPEAT_KEYS = Object.values(PROTOCOL_SHAPES).map(shape=>shape.repeatKey);
  // Generator policy: the protocols generation may choose by itself (standalone blocks and Coach
  // optional blocks), in weighted-pick order. A protocol can be accepted in the domain above
  // before it is auto-selected; adding it here is a deliberate selection change.
  const GENERATED_PROTOCOLS = Object.freeze(['rounds','paired_sets','timed_intervals','emom','ladder','pyramid','complex','density']);
  const MAIN_INTENTS = new Set(['strength','conditioning','accessory','finisher']);
  const MAIN_ROLES = new Set(['primary','supporting']);
  const BLOCK_TRANSITION_SECONDS = 3;
  // Keep at least twenty seconds for recovery/setup, without inventing a fixed recovery duration.
  const EMOM_POLICY = Object.freeze({slotSeconds:60,maxMinutes:12,maxExercises:3,maxWorkSeconds:40});
  const LADDER_POLICY = Object.freeze({maxSteps:5,maxReps:12,maxTotalReps:36,maxWorkSeconds:120,maxExercises:2});
  const PYRAMID_POLICY = Object.freeze({maxSteps:5,maxReps:12,maxTotalReps:40,maxWorkSeconds:180,minRestSeconds:60,intensityRestSeconds:90,maxRestSeconds:120});
  // A complex is two or three movements done back to back on one setup, then recovery.
  // Targets are per movement and never exceed the catalogue dose or these short bounds.
  const COMPLEX_POLICY = Object.freeze({minExercises:2,maxExercises:3,minSequences:2,maxSequences:4,minReps:3,maxReps:8,
    minTimedSeconds:15,maxTimedSeconds:30,maxChangeoverSeconds:15,minSequenceRestSeconds:60,maxSequenceRestSeconds:120,maxSequenceWorkSeconds:90,maxTotalWorkSeconds:240});
  const DENSITY_POLICY = Object.freeze({minCapSeconds:180,maxCapSeconds:420,maxRepeats:3,minReps:4,maxReps:8,
    minExerciseRestSeconds:15,minRoundRestSeconds:45,maxRestSeconds:60,maxTotalWorkSeconds:180});
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
  // Workout body focus (generate({bodyFocus})) reads each exercise's intrinsic `bodyFocus`.
  // Full Body is neutral: it scores nothing, so it generates exactly as a workout without the
  // option. Upper, Lower and Core are weighted preferences, never filters: exercises of the
  // focus area get a Main score credit (full-body exercises a smaller one) and every other
  // exercise stays eligible at its usual score. The credit pauses beside a run of
  // BODY_FOCUS_MAX_RUN focus-area exercises and never rewards high-impact work following
  // high-impact work, so the existing pattern, repetition, recency and equipment rules still
  // shape the workout. Preparation and Cool-down are unaffected.
  const WORKOUT_BODY_FOCUSES = ['upper','full-body','lower','core'];
  const EXERCISE_BODY_FOCUSES = new Set(['upper','lower','core','full-body']);
  const EXERCISE_DIRECT_ELBOW_ACTIONS = new Set(['flexion','extension']);
  const BODY_FOCUS_POLICY = {
    upper:{ credit:{ upper:18, 'full-body':3 } },
    'full-body':{ credit:{} },
    lower:{ credit:{ lower:18, 'full-body':3 } },
    core:{ credit:{ core:18, 'full-body':3 } }
  };
  const BODY_FOCUS_MAX_RUN = 2;

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

  // ---- Workout body focus policy (see BODY_FOCUS_POLICY) ----

  function workoutBodyFocus(value) {
    if (value==null) return 'full-body';
    const bodyFocus = String(value).toLowerCase();
    if (!WORKOUT_BODY_FOCUSES.includes(bodyFocus)) throw new Error('Unknown workout body focus '+JSON.stringify(value)+'.');
    return bodyFocus;
  }

  // Main score credit for `exercise` placed between the Main exercises `before` and `after`
  // (each in Main order). The credit pauses next to a run of BODY_FOCUS_MAX_RUN focus-area
  // exercises, and focus-area work earns nothing where it would extend a run beyond it, so that
  // slot is chosen on the usual scores alone.
  function bodyFocusCredit(exercise, bodyFocus, before, after) {
    const policy = BODY_FOCUS_POLICY[bodyFocus] || BODY_FOCUS_POLICY['full-body'];
    const value = (exercise && policy.credit[exercise.bodyFocus]) || 0;
    if (!value) return 0;
    // Focus-area exercises next to the slot; a full-body exercise neither extends nor breaks the run.
    const streak = list => { let count = 0; for (const item of list) { if (item && item.bodyFocus==='full-body') continue; if (!item || item.bodyFocus!==bodyFocus) break; count++; } return count; };
    const preceding = streak((before || []).slice().reverse()), following = streak(after || []);
    if (preceding>=BODY_FOCUS_MAX_RUN || following>=BODY_FOCUS_MAX_RUN) return 0;
    return exercise.bodyFocus===bodyFocus && 1+preceding+following>BODY_FOCUS_MAX_RUN ? 0 : value;
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

  // Main policy: families whose equipment variants are interchangeable enough that one
  // workout should never contain two of them (dumbbell and kettlebell sumo squat). Other
  // families stay subject only to the soft repeat and recency scoring.
  const MAIN_SINGLE_VARIANT_FAMILIES = new Set(['sumo-squat']);

  // Main policy: an "occasional" family (e.g. farmer carry across dumbbell/kettlebell
  // variants) or a single-variant family is capped at one exposure across the whole Main
  // phase. Shared by initial generation, Coach composition and swaps so a swap cannot
  // introduce what generation would have refused.
  function mainFamilyCapped(exercise) {
    return !!(exercise && exercise.family && (exercise.frequency==='occasional' || MAIN_SINGLE_VARIANT_FAMILIES.has(exercise.family)));
  }
  function mainFamilyCapReached(exercise, mainExercises) {
    return mainFamilyCapped(exercise) && (mainExercises || []).some(item => sameFamily(item,exercise));
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

  // Warm-up score penalty when an earlier pick shares a repetitionClass (soft, never an exclusion).
  const WARMUP_REPETITION_CLASS_PENALTY = 4;

  // Warm-up policy: every generated warm-up includes one `kneeMobility` exercise, a controlled,
  // unloaded movement that genuinely flexes and extends the knee. A knees warm-up area alone
  // does not qualify (squats, lunges and jogging drills load or bounce the knee). Catalogue
  // validation keeps every such exercise gentle, low-impact and bodyweight, so the obligation
  // is feasible with any equipment.
  function kneeMobilityQualified(exercise) {
    return !!(exercise && exercise.warmup && exercise.kneeMobility===true);
  }

  // Shoulder or trunk preparation. The warm-up keeps a minimum of it so the essential knee
  // slot and the gentle lower-body options cannot crowd upper-body mobility out.
  function upperTrunkPrep(exercise) {
    return (exercise.warmupAreas || []).some(area => area==='shoulders' || area==='trunk');
  }
  function upperTrunkTarget(count) {
    return count>=7 ? 2 : count>=3 ? 1 : 0;
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
      // An unknown protocol has no executable steps; fail loudly rather than play a silently empty block.
      if(!MAIN_PROTOCOLS.has(block.protocol))throw new Error('Workout Main block '+block.id+' uses unsupported protocol '+JSON.stringify(block.protocol)+'.');
      block.intent=block.intent||((workout.focus||'balanced')==='cardio'?'conditioning':'strength');
      block.prescription=Object.assign({},block.prescription||{});
      if(block.protocol==='emom'){
        const issues=validateEmomBlock(block);
        if(issues.length)throw new Error('Invalid EMOM block '+block.id+': '+issues.join(', '));
        block.prescription.targets=block.prescription.targets.map(target=>({...target}));
      }
      if(block.protocol==='ladder'){
        const issues=validateLadderBlock(block);
        if(issues.length)throw new Error('Invalid ladder block '+block.id+': '+issues.join(', '));
        block.prescription.repSteps=block.prescription.repSteps.slice();
      }
      if(block.protocol==='pyramid'){
        const issues=validatePyramidBlock(block);
        if(issues.length)throw new Error('Invalid pyramid block '+block.id+': '+issues.join(', '));
        block.prescription.steps=block.prescription.steps.map(step=>({...step}));
      }
      if(block.protocol==='complex'){
        const issues=validateComplexBlock(block);
        if(issues.length)throw new Error('Invalid complex block '+block.id+': '+issues.join(', '));
        block.prescription.targets=block.prescription.targets.map(target=>({...target}));
      }
      if(block.protocol==='density'){
        const issues=validateDensityBlock(block);
        if(issues.length)throw new Error('Invalid density block '+block.id+': '+issues.join(', '));
        block.prescription.targets=block.prescription.targets.map(target=>({...target}));
      }
      block.exercises=(block.exercises||[]).map(copyExercise);
      if(block.protocol==='rounds'){
        block.prescription.rounds=block.prescription.rounds||block.rounds||1;
        block.prescription.exerciseRestSeconds=Number.isFinite(block.prescription.exerciseRestSeconds)?block.prescription.exerciseRestSeconds:(block.rest&&block.rest.exercise)||0;
        block.prescription.roundRestSeconds=Number.isFinite(block.prescription.roundRestSeconds)?block.prescription.roundRestSeconds:(block.rest&&block.rest.round)||0;
        block.rounds=block.prescription.rounds;
        block.rest={exercise:block.prescription.exerciseRestSeconds,round:block.prescription.roundRestSeconds};
      }
      const targetIssues=validateOccurrenceTargets(block);
      if(targetIssues.length)throw new Error('Invalid occurrence targets in '+block.id+': '+targetIssues.join(', '));
      if(block.occurrenceTargets)block.occurrenceTargets=JSON.parse(JSON.stringify(block.occurrenceTargets));
      const estimate=estimateBlockDuration(block);
      block.estimatedDurationSeconds=['emom','ladder','pyramid','complex','density'].includes(block.protocol)||block.occurrenceTargets?estimate:Number.isFinite(block.estimatedDurationSeconds)?block.estimatedDurationSeconds:Number.isFinite(block.estimatedSeconds)?block.estimatedSeconds:estimate;
      block.estimatedSeconds=block.estimatedDurationSeconds;
      return block;
    });
    const blockSeconds=blocks.reduce((sum,block)=>sum+block.estimatedDurationSeconds,0);
    workout.schemaVersion=Math.max(2,Number(workout.schemaVersion)||0);
    workout.main={blocks,transitionSeconds:BLOCK_TRANSITION_SECONDS,estimatedDurationSeconds:blockSeconds+BLOCK_TRANSITION_SECONDS*Math.max(0,blocks.length-1)};
    workout.blocks=workout.main.blocks;
    if(blocks.some(block=>block.occurrenceTargets||['ladder','pyramid','complex','density'].includes(block.protocol))){
      const preparation=['warmup','rampup','cooldown'].map(section=>workout[section]&&workout[section].estimatedSeconds);
      if(preparation.every(Number.isFinite))workout.estimatedSeconds=preparation.reduce((sum,seconds)=>sum+seconds,0)+workout.main.estimatedDurationSeconds;
    }
    return workout;
  }

  function protocolCompatible(exercise, protocol) {
    if (!exercise || !MAIN_PROTOCOLS.has(protocol)) return false;
    if (protocol==='emom') return emomExerciseEligible(exercise);
    if (protocol==='ladder') return ladderExerciseEligible(exercise);
    if (protocol==='pyramid') return pyramidExerciseEligible(exercise);
    if (protocol==='complex') return complexExerciseEligible(exercise);
    if (protocol==='density') return densityExerciseEligible(exercise);
    if (Array.isArray(exercise.mainProtocols)) return exercise.mainProtocols.includes(protocol);
    if (protocol==='timed_intervals') return exercise.sidedness!=='per-side' && !!(exercise.prescription&&exercise.prescription.type&&exercise.prescription.type.includes('timed'));
    return protocol==='rounds'||protocol==='paired_sets';
  }

  function emomExerciseEligible(exercise) {
    if(!exercise||typeof exercise.id!=='string'||!exercise.generator||!exercise.main||exercise.coachAnchor)return false;
    // Existing clock compatibility is necessary, never sufficient. Do not turn a heavy
    // strength prescription into a race merely because its estimated duration is short.
    if(!Array.isArray(exercise.mainProtocols)||!exercise.mainProtocols.includes('timed_intervals'))return false;
    if(!['easy','moderate'].includes(exercise.difficulty)||!['low','medium'].includes(exercise.impact))return false;
    if(!['bilateral','alternating','none'].includes(exercise.sidedness)||exercise.unilateral)return false;
    if(!Number.isFinite(exercise.strength)||exercise.strength<1||exercise.strength>5
      ||!Array.isArray(exercise.equipment)||!exercise.equipment.every(Array.isArray))return false;
    const equipment=exercise.equipment.flat();
    if(equipment.includes('barbell')||exercise.strength>=4&&equipment.some(id=>['dumbbells','kettlebell'].includes(id)))return false;
    const p=exercise.prescription||{};
    return ['reps','timed'].includes(p.type)&&Number.isFinite(p.value)&&p.value>0
      &&(p.type!=='reps'||Number.isInteger(p.value))
      &&Number.isFinite(exercise.estimatedSeconds)&&exercise.estimatedSeconds>0
      &&exercise.estimatedSeconds<=EMOM_POLICY.maxWorkSeconds
      &&(p.type!=='timed'||p.value<=EMOM_POLICY.maxWorkSeconds);
  }

  // The one EMOM validator used by normalisation, estimation, resolution and Main validation.
  // Targets align with the ordered exercise rotation; minute N uses (N-1) % rotation.length.
  // Passing the catalogue prevents copied exercise metadata from weakening safety checks.
  function validateEmomBlock(block, catalogue) {
    const issues=[],p=block&&block.prescription||{},exercises=block&&block.exercises;
    if(!block||block.protocol!=='emom')issues.push('invalid-protocol');
    if(!Number.isInteger(p.minutes)||p.minutes<1||p.minutes>EMOM_POLICY.maxMinutes)issues.push('invalid-minutes');
    if(p.slotSeconds!==EMOM_POLICY.slotSeconds)issues.push('invalid-slot-seconds');
    if(Object.keys(p).some(key=>!['minutes','slotSeconds','targets'].includes(key)))issues.push('invalid-prescription-fields');
    if(!Array.isArray(exercises)||!exercises.length||exercises.length>EMOM_POLICY.maxExercises
      ||exercises.length>p.minutes||new Set(exercises.map(ex=>ex&&ex.id)).size!==exercises.length)issues.push('invalid-rotation');
    if(!Array.isArray(p.targets)||!Array.isArray(exercises)||p.targets.length!==exercises.length)issues.push('invalid-targets');
    if(!Array.isArray(exercises))return issues;
    exercises.forEach((exercise,index)=>{
      const source=catalogue?catalogue[exercise&&exercise.id]:exercise;
      if(!emomExerciseEligible(source)||!emomExerciseEligible(exercise))issues.push('ineligible-exercise:'+index);
      const target=Array.isArray(p.targets)&&p.targets[index],canonical=source&&source.prescription;
      if(!target||!canonical||target.type!==canonical.type||!['reps','timed'].includes(target.type)
        ||Object.keys(target).some(key=>!['type','value'].includes(key))
        ||!Number.isFinite(target.value)||target.value<=0||target.value>canonical.value
        ||target.type==='reps'&&!Number.isInteger(target.value))issues.push('invalid-target:'+index);
      else{
        const seconds=Math.max(target.type==='timed'?target.value:0,Math.ceil(source.estimatedSeconds*target.value/canonical.value));
        if(!Number.isFinite(seconds)||seconds<=0||seconds>EMOM_POLICY.maxWorkSeconds)issues.push('unsafe-target:'+index);
      }
      if(exercise&&mainFamilyCapReached(exercise,exercises.slice(0,index)))issues.push('family-cap:'+index);
    });
    return issues;
  }

  function controlledRepExerciseEligible(exercise) {
    if(!exercise||!exercise.generator||!exercise.main||exercise.coachAnchor)return false;
    if(!['easy','moderate'].includes(exercise.difficulty)||!['low','medium'].includes(exercise.impact)
      ||!['bilateral','alternating','none'].includes(exercise.sidedness)||exercise.unilateral)return false;
    if(!Array.isArray(exercise.mainProtocols)||!exercise.mainProtocols.includes('rounds')
      ||!Array.isArray(exercise.equipment)||!exercise.equipment.every(Array.isArray))return false;
    const p=exercise.prescription||{};
    return p.type==='reps'&&Number.isInteger(p.value)&&p.value>=2
      &&Number.isFinite(exercise.estimatedSeconds)&&exercise.estimatedSeconds>0;
  }
  function ladderExerciseEligible(exercise) {
    if(!controlledRepExerciseEligible(exercise))return false;
    const equipment=exercise.equipment.flat();
    // Keep technical/heavy free-weight work in its established straight-set formats.
    if(equipment.includes('barbell')||equipment.includes('kettlebell')||exercise.load==='Heavy'
      ||equipment.includes('dumbbells')&&exercise.strength>=4)return false;
    return true;
  }

  // repSteps is the repeat structure, not a catalogue override. Every exercise follows
  // the same strictly monotonic dose; generic occurrence overrides cannot turn it into
  // a pyramid, change load, or bypass the volume ceiling.
  function validateLadderBlock(block, catalogue) {
    const issues=[],p=block&&block.prescription||{},exercises=block&&block.exercises,steps=p.repSteps;
    if(!block||block.protocol!=='ladder')issues.push('invalid-protocol');
    if(Object.keys(p).some(key=>!['repSteps','exerciseRestSeconds','stepRestSeconds'].includes(key)))issues.push('invalid-prescription-fields');
    const validSteps=Array.isArray(steps)&&steps.length>=2&&steps.length<=LADDER_POLICY.maxSteps
      &&Array.from(steps).every(value=>Number.isInteger(value)&&value>0&&value<=LADDER_POLICY.maxReps)
      &&(steps.every((value,index)=>!index||value>steps[index-1])||steps.every((value,index)=>!index||value<steps[index-1]));
    if(!validSteps)issues.push('invalid-rep-steps');
    if(validSteps&&steps.reduce((sum,value)=>sum+value,0)>LADDER_POLICY.maxTotalReps)issues.push('unsafe-volume');
    if(!Number.isFinite(p.exerciseRestSeconds)||p.exerciseRestSeconds<0||p.exerciseRestSeconds>60
      ||!Number.isFinite(p.stepRestSeconds)||p.stepRestSeconds<15||p.stepRestSeconds>90)issues.push('invalid-rest');
    if(block&&block.occurrenceTargets!==undefined)issues.push('ladder-occurrence-overrides');
    if(!Array.isArray(exercises)||!exercises.length||exercises.length>LADDER_POLICY.maxExercises
      ||new Set(exercises.map(ex=>ex&&ex.id)).size!==exercises.length)return issues.concat('invalid-exercises');
    exercises.forEach((exercise,index)=>{
      const source=catalogue?catalogue[exercise&&exercise.id]:exercise;
      if(!ladderExerciseEligible(exercise)||!ladderExerciseEligible(source)){issues.push('ineligible-exercise:'+index);return;}
      if(validSteps){
        for(const ex of [source,exercise]){
          if(steps.some(value=>value>ex.prescription.value))issues.push('unsafe-target:'+index);
          const seconds=steps.reduce((sum,value)=>sum+Math.ceil(ex.estimatedSeconds*value/ex.prescription.value),0);
          if(!Number.isFinite(seconds)||seconds>LADDER_POLICY.maxWorkSeconds)issues.push('unsafe-work-duration:'+index);
        }
      }
      if(mainFamilyCapReached(exercise,exercises.slice(0,index)))issues.push('family-cap:'+index);
    });
    return issues;
  }

  // One stable, controlled exercise; no ballistic, per-side or heavy late-fatigue work.
  // Fixed-load rep pyramids need no inventory. Relative resistance is only meaningful
  // here for standing TRX strength work, adjusted by stance rather than assumed weights.
  function pyramidExerciseEligible(exercise) {
    return controlledRepExerciseEligible(exercise)&&exercise.bodyPosition!=='hanging'
      &&!exercise.equipment.flat().some(id=>['barbell','kettlebell'].includes(id))
      &&exercise.load!=='Heavy'&&exercise.strength>=3&&exercise.cardio<=3;
  }
  function pyramidResistanceAdjustable(exercise) {
    return pyramidExerciseEligible(exercise)&&exercise.bodyPosition==='standing'&&exercise.strength>=4&&exercise.cardio<=2
      &&exercise.equipment.length===1&&exercise.equipment[0].length===1&&exercise.equipment[0][0]==='trx';
  }
  const rising=values=>values.every((value,index)=>!index||value>values[index-1]);
  const falling=values=>values.every((value,index)=>!index||value<values[index-1]);
  function pyramidKind(steps) {
    if(!Array.isArray(steps)||![3,5].includes(steps.length)||!Array.from(steps).every(step=>plainTarget(step)))return null;
    const reps=steps.map(step=>step.reps),cues=steps.map(step=>step.relativeLoad);
    const middle=Math.floor(steps.length/2),peak=rising(reps.slice(0,middle+1))&&falling(reps.slice(middle));
    if(cues.every(cue=>cue===undefined))return peak?'reps':null;
    const levels=cues.map(cue=>['lighter','medium','heavier'].indexOf(cue));
    if(levels.some(level=>level<0))return null;
    // A reverse pyramid starts with the greatest intended resistance, then eases it.
    // Increasing resistance while fatigue accumulates is never a monotonic variant.
    if(steps.length===3&&rising(reps)&&levels.join(',')==='2,1,0')return 'reverse';
    if(falling(reps.slice(0,middle+1))&&rising(reps.slice(middle))
      &&rising(levels.slice(0,middle+1))&&falling(levels.slice(middle)))return 'intensity';
    return null;
  }
  function validatePyramidBlock(block,catalogue) {
    const issues=[],p=block&&block.prescription||{},steps=p.steps,exercises=block&&block.exercises;
    if(!block||block.protocol!=='pyramid')issues.push('invalid-protocol');
    if(Object.keys(p).some(key=>!['steps','stepRestSeconds'].includes(key)))issues.push('invalid-prescription-fields');
    const valid=Array.isArray(steps)&&[3,5].includes(steps.length)&&Array.from(steps).every(step=>plainTarget(step)
      &&Object.keys(step).every(key=>['reps','relativeLoad'].includes(key))&&Number.isInteger(step.reps)&&step.reps>=2&&step.reps<=PYRAMID_POLICY.maxReps);
    const kind=valid&&pyramidKind(steps);
    if(!kind)issues.push('invalid-pyramid-shape');
    if(valid&&steps.reduce((sum,step)=>sum+step.reps,0)>PYRAMID_POLICY.maxTotalReps)issues.push('unsafe-volume');
    if(!Number.isFinite(p.stepRestSeconds)||p.stepRestSeconds<(kind&&kind!=='reps'?PYRAMID_POLICY.intensityRestSeconds:PYRAMID_POLICY.minRestSeconds)
      ||p.stepRestSeconds>PYRAMID_POLICY.maxRestSeconds)issues.push('invalid-rest');
    if(block&&block.occurrenceTargets!==undefined)issues.push('pyramid-occurrence-overrides');
    if(!Array.isArray(exercises)||exercises.length!==1)return issues.concat('invalid-exercises');
    const exercise=exercises[0],source=catalogue?catalogue[exercise&&exercise.id]:exercise;
    for(const ex of [source,exercise]){
      if(!pyramidExerciseEligible(ex)){issues.push('ineligible-exercise');continue;}
      if(kind&&kind!=='reps'&&!pyramidResistanceAdjustable(ex))issues.push('unavailable-relative-resistance');
      if(valid){
        if(steps.some(step=>step.reps>ex.prescription.value))issues.push('unsafe-target');
        if(steps.reduce((sum,step)=>sum+Math.ceil(ex.estimatedSeconds*step.reps/ex.prescription.value),0)>PYRAMID_POLICY.maxWorkSeconds)issues.push('unsafe-work-duration');
      }
    }
    return [...new Set(issues)];
  }

  // Complex movements stay controlled and short: no high impact, hard technique,
  // per-side work, hanging, barbells or Heavy loads. Timed work keeps its measured timer.
  function complexExerciseEligible(exercise) {
    if(!exercise||typeof exercise.id!=='string'||!exercise.generator||!exercise.main||exercise.coachAnchor)return false;
    if(!['easy','moderate'].includes(exercise.difficulty)||!['low','medium'].includes(exercise.impact)
      ||!['bilateral','alternating','none'].includes(exercise.sidedness)||exercise.unilateral
      ||!['standing','floor','supported'].includes(exercise.bodyPosition))return false;
    if(!Array.isArray(exercise.mainProtocols)||!exercise.mainProtocols.includes('rounds')
      ||!Array.isArray(exercise.equipment)||!exercise.equipment.every(Array.isArray)
      ||exercise.equipment.flat().includes('barbell')||exercise.load==='Heavy')return false;
    const p=exercise.prescription||{};
    if(p.type==='reps')return Number.isInteger(p.value)&&p.value>=COMPLEX_POLICY.minReps
      &&Number.isFinite(exercise.estimatedSeconds)&&exercise.estimatedSeconds>0;
    return p.type==='timed'&&Number.isFinite(p.value)&&p.value>=COMPLEX_POLICY.minTimedSeconds;
  }
  // The same equipment requirement means one setup serves every movement.
  const complexSetupKey=exercise=>JSON.stringify((exercise.equipment||[]).map(group=>group.slice().sort()).sort());
  const complexDemanding=exercise=>exercise.impact==='medium'||exercise.cardio>=4;
  // Continuity and fatigue rules for an ordered sequence of eligible movements: one setup,
  // body position and load; no shared pattern or capped family; at most one higher-impact
  // or high-cardio movement, two moderate-technique movements and two of one body region.
  function complexSequenceIssues(exercises) {
    const issues=[];
    exercises.forEach((exercise,index)=>{
      const first=exercises[0],earlier=exercises.slice(0,index);
      if(!index)return;
      if(complexSetupKey(exercise)!==complexSetupKey(first))issues.push('setup-change');
      if(exercise.bodyPosition!==first.bodyPosition)issues.push('position-change');
      if((exercise.load||null)!==(first.load||null))issues.push('load-change');
      if(earlier.some(item=>sharedPatterns(item,exercise).length))issues.push('shared-pattern');
      if(mainFamilyCapReached(exercise,earlier))issues.push('family-cap');
    });
    if(exercises.filter(complexDemanding).length>1)issues.push('fatigue');
    if(exercises.some(exercise=>exercises.filter(item=>item.bodyFocus===exercise.bodyFocus).length>2))issues.push('local-fatigue');
    if(exercises.filter(exercise=>exercise.difficulty!=='easy').length>2)issues.push('technical');
    return [...new Set(issues)];
  }
  function complexDefaultTarget(exercise) {
    const p=exercise.prescription;
    return {type:p.type,value:Math.min(p.value,p.type==='timed'?COMPLEX_POLICY.maxTimedSeconds:COMPLEX_POLICY.maxReps)};
  }
  function complexTargetSeconds(exercise,target) {
    return target.type==='timed'?target.value:Math.ceil(exercise.estimatedSeconds*target.value/exercise.prescription.value);
  }
  // The one complex validator for normalisation, estimation, resolution, swaps and Main
  // validation. Targets align with the ordered movements; the catalogue, when supplied,
  // prevents copied metadata from weakening eligibility or continuity.
  function validateComplexBlock(block, catalogue) {
    const issues=[],p=block&&block.prescription||{},exercises=block&&block.exercises,policy=COMPLEX_POLICY;
    if(!block||block.protocol!=='complex')issues.push('invalid-protocol');
    if(Object.keys(p).some(key=>!['sequences','targets','changeoverSeconds','sequenceRestSeconds'].includes(key)))issues.push('invalid-prescription-fields');
    if(!Number.isInteger(p.sequences)||p.sequences<policy.minSequences||p.sequences>policy.maxSequences)issues.push('invalid-sequences');
    if(!Number.isFinite(p.changeoverSeconds)||p.changeoverSeconds<0||p.changeoverSeconds>policy.maxChangeoverSeconds)issues.push('invalid-changeover');
    if(!Number.isFinite(p.sequenceRestSeconds)||p.sequenceRestSeconds<policy.minSequenceRestSeconds||p.sequenceRestSeconds>policy.maxSequenceRestSeconds)issues.push('invalid-rest');
    if(block&&block.occurrenceTargets!==undefined)issues.push('complex-occurrence-overrides');
    if(!Array.isArray(exercises)||exercises.length<policy.minExercises||exercises.length>policy.maxExercises
      ||new Set(exercises.map(ex=>ex&&ex.id)).size!==exercises.length)return issues.concat('invalid-exercises');
    if(!Array.isArray(p.targets)||p.targets.length!==exercises.length)issues.push('invalid-targets');
    const sources=exercises.map(exercise=>catalogue?catalogue[exercise&&exercise.id]:exercise);
    let eligible=true;
    exercises.forEach((exercise,index)=>{
      const source=sources[index];
      if(!complexExerciseEligible(exercise)||!complexExerciseEligible(source)){issues.push('ineligible-exercise:'+index);eligible=false;return;}
      const target=Array.isArray(p.targets)&&p.targets[index];
      for(const ex of [source,exercise]){
        const base=ex.prescription,timed=base.type==='timed';
        if(!plainTarget(target)||Object.keys(target).some(key=>!['type','value'].includes(key))||target.type!==base.type
          ||!Number.isFinite(target.value)||target.value>base.value||!timed&&!Number.isInteger(target.value)
          ||target.value<(timed?policy.minTimedSeconds:policy.minReps)||target.value>(timed?policy.maxTimedSeconds:policy.maxReps))issues.push('invalid-target:'+index);
      }
    });
    if(!eligible)return [...new Set(issues)];
    for(const list of [sources,exercises])issues.push(...complexSequenceIssues(list));
    if(Array.isArray(p.targets)&&!issues.some(issue=>issue.startsWith('invalid-target'))){
      for(const list of [sources,exercises]){
        const work=list.reduce((sum,exercise,index)=>sum+complexTargetSeconds(exercise,p.targets[index]),0);
        if(work>policy.maxSequenceWorkSeconds)issues.push('unsafe-sequence-work');
        if(Number.isInteger(p.sequences)&&work*p.sequences>policy.maxTotalWorkSeconds)issues.push('unsafe-volume');
      }
    }
    return [...new Set(issues)];
  }

  // Fixed-work density is deliberately rep-only. Existing clock eligibility excludes
  // technical/heavy lifting; controlled reps and one setup avoid rushed changes or sides.
  function densityExerciseEligible(exercise) {
    return emomExerciseEligible(exercise)&&controlledRepExerciseEligible(exercise)
      &&['standing','floor','supported'].includes(exercise.bodyPosition)&&exercise.load!=='Heavy';
  }
  const densityDefaultTarget=exercise=>({type:'reps',value:Math.min(DENSITY_POLICY.maxReps,exercise.prescription.value)});
  function densityMinimumSeconds(exercises,p) {
    const work=exercises.reduce((sum,ex,index)=>sum+complexTargetSeconds(ex,p.targets[index]),0)*p.repeats;
    // A 50% work allowance plus every planned recovery; the cap is never a speed target.
    return Math.ceil(work*1.5)+p.repeats*(exercises.length-1)*p.exerciseRestSeconds+(p.repeats-1)*p.roundRestSeconds;
  }
  function validateDensityBlock(block,catalogue) {
    const issues=[],p=block&&block.prescription||{},exercises=block&&block.exercises,policy=DENSITY_POLICY;
    if(!block||block.protocol!=='density')issues.push('invalid-protocol');
    if(Object.keys(p).some(key=>!['repeats','targets','timeCapSeconds','exerciseRestSeconds','roundRestSeconds'].includes(key)))issues.push('invalid-prescription-fields');
    if(!Number.isInteger(p.repeats)||p.repeats<2||p.repeats>policy.maxRepeats)issues.push('invalid-repeats');
    if(!Number.isFinite(p.timeCapSeconds)||p.timeCapSeconds<policy.minCapSeconds||p.timeCapSeconds>policy.maxCapSeconds)issues.push('invalid-cap');
    for(const [field,minimum] of [['exerciseRestSeconds',policy.minExerciseRestSeconds],['roundRestSeconds',policy.minRoundRestSeconds]])
      if(!Number.isFinite(p[field])||p[field]<minimum||p[field]>policy.maxRestSeconds)issues.push('invalid-rest:'+field);
    if(block&&block.occurrenceTargets!==undefined)issues.push('density-occurrence-overrides');
    if(!Array.isArray(exercises)||exercises.length!==2||new Set(exercises.map(ex=>ex&&ex.id)).size!==2)return issues.concat('invalid-exercises');
    if(!Array.isArray(p.targets)||p.targets.length!==exercises.length)return issues.concat('invalid-targets');
    const sources=exercises.map(ex=>catalogue?catalogue[ex&&ex.id]:ex);
    for(const list of [exercises,sources]){
      if(list.some(ex=>!densityExerciseEligible(ex))){issues.push('ineligible-exercise');continue;}
      issues.push(...complexSequenceIssues(list));
      const valid=list.every((ex,index)=>{const target=p.targets[index];return plainTarget(target)&&Object.keys(target).every(key=>['type','value'].includes(key))
        &&target.type==='reps'&&Number.isInteger(target.value)&&target.value>=policy.minReps
        &&target.value<=Math.min(policy.maxReps,list[index].prescription.value)});
      if(!valid){issues.push('invalid-target');continue;}
      const work=list.reduce((sum,ex,index)=>sum+complexTargetSeconds(ex,p.targets[index]),0)*p.repeats;
      if(work>policy.maxTotalWorkSeconds)issues.push('unsafe-volume');
      if(densityMinimumSeconds(list,p)>p.timeCapSeconds)issues.push('insufficient-recovery');
    }
    return [...new Set(issues)];
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

  function recentProtocolsFromResults(results) {
    const protocols=new Set();
    (results||[]).slice().sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt)).slice(0,4).forEach(result=>{
      const performed=new Set((result.performedWork||[]).filter(work=>['completed','partial'].includes(work.status)).map(work=>work.occurrenceId));
      (result.plannedWork||[]).forEach(work=>{if(work.section==='main'&&performed.has(work.occurrenceId)&&work.prescription&&MAIN_PROTOCOLS.has(work.prescription.protocol))protocols.add(work.prescription.protocol);});
    });
    return [...protocols];
  }

  function protocolWeights(focus, intent, remainingSeconds, eligible, state) {
    const base=focus==='strength'
      ? {rounds:5,paired_sets:9,timed_intervals:2,emom:2,ladder:2,pyramid:1,complex:1}
      : focus==='cardio'
        ? {rounds:8,paired_sets:2,timed_intervals:10,emom:4,ladder:1,complex:1}
        : {rounds:7,paired_sets:7,timed_intervals:7,emom:3,ladder:2,pyramid:1,complex:1};
    base.density=focus==='strength'?0:1;
    if(intent==='strength') { base.paired_sets+=4;base.timed_intervals-=1; }
    if(intent==='conditioning'||intent==='finisher') { base.timed_intervals+=5;base.rounds+=2;base.paired_sets-=1; }
    if(intent==='accessory') { base.paired_sets+=3;base.rounds+=1; }
    if(remainingSeconds<300){base.timed_intervals+=3;base.rounds-=1;}
    const compatible=protocol=>eligible.filter(ex=>protocolCompatible(ex,protocol)).length;
    const previous=state.blocks[state.blocks.length-1];
    return GENERATED_PROTOCOLS.map(protocol=>{
      let weight=base[protocol]||0;
      const minimum=protocol==='rounds'?3:protocol==='pyramid'?1:2;
      if(compatible(protocol)<minimum)return {value:protocol,weight:0};
      // Automatic EMOM needs a coherent rotation and at least three minutes, never
      // a long low-variety substitute or consecutive minute blocks.
      if(protocol==='emom'&&(remainingSeconds<180||remainingSeconds>720||previous&&previous.protocol==='emom'))return {value:protocol,weight:0};
      if(protocol==='ladder'&&(remainingSeconds<120||remainingSeconds>900||state.blocks.some(block=>block.protocol==='ladder')))return {value:protocol,weight:0};
      if(protocol==='pyramid'&&(focus==='cardio'||!['strength','accessory'].includes(intent)||remainingSeconds<150||remainingSeconds>720
        ||state.blocks.some(block=>block.protocol==='pyramid')))return {value:protocol,weight:0};
      // Complexes follow an established first block (longer, multi-block sessions), once.
      if(protocol==='complex'&&(!state.blocks.length||remainingSeconds<240||remainingSeconds>720
        ||state.blocks.some(block=>block.protocol==='complex')||!complexPairAvailable(eligible)))return {value:protocol,weight:0};
      if(protocol==='density'&&(state.duration<15||focus==='strength'||state.difficulty==='easy'||intent==='strength'||!state.blocks.length
        ||remainingSeconds<DENSITY_POLICY.minCapSeconds||remainingSeconds>DENSITY_POLICY.maxCapSeconds
        ||state.blocks.some(block=>block.protocol==='density')||!densityPairAvailable(eligible)))return {value:protocol,weight:0};
      // Variety is deliberately a modest tie-breaker, below focus and viability.
      if(previous&&previous.protocol!==protocol)weight+=1;
      if((state.recentProtocols||[]).includes(protocol))weight-=.5;
      return {value:protocol,weight:Math.max(0,weight)};
    });
  }

  const complexPairs=new WeakMap();
  const densityPairs=new WeakMap();
  function densityPairAvailable(eligible) {
    if(!densityPairs.has(eligible)){
      const pool=eligible.filter(densityExerciseEligible);
      densityPairs.set(eligible,pool.some((first,index)=>pool.slice(index+1).some(second=>!complexSequenceIssues([first,second]).length)));
    }
    return densityPairs.get(eligible);
  }
  function complexPairAvailable(eligible) {
    if(!complexPairs.has(eligible)){
      const pool=eligible.filter(complexExerciseEligible);
      complexPairs.set(eligible,pool.some((first,index)=>pool.slice(index+1).some(second=>!complexSequenceIssues([first,second]).length)));
    }
    return complexPairs.get(eligible);
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
      // A complex grows only by fresh movements that keep one setup and safe transitions.
      // Its narrow pool cannot outweigh Main's reuse and adjacent-pattern safeguards, so they
      // are hard here; the first movement must also have at least one such partner.
      if(protocol==='complex'||protocol==='density'){
        const fresh=candidates.filter(ex=>!state.usedIds.has(ex.id));
        const lastMain=state.exercises[state.exercises.length-1];
        candidates=narrow(stages,'complex-continuity',candidates,fresh.filter(ex=>selected.length
          ?!complexSequenceIssues(selected.concat(ex)).length
          :!sharedPatterns(lastMain,ex).some(pattern=>MAJOR_REPEAT_PATTERNS.has(pattern))
            &&fresh.some(other=>other.id!==ex.id&&!complexSequenceIssues([ex,other]).length)));
      }
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
        // The difficulty and body-focus preferences never reward back-to-back high-impact work (a fatigue safeguard).
        const adjacentHighImpact=previous&&previous.impact==='high'&&exercise.impact==='high';
        const difficulty=adjacentHighImpact?0:difficultyCredit(exercise,state.difficulty);
        if(difficulty)score+=credit(parts,'difficulty',difficulty);
        const bodyFocus=adjacentHighImpact?0:bodyFocusCredit(exercise,state.bodyFocus,allSelected);
        if(bodyFocus)score+=credit(parts,'body-focus',bodyFocus);
        if(state.sessionPrescription)score+=credit(parts,'session-priority',sessionPriorityCredit(exercise,state.sessionPrescription,history,catalogue));
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
      // The route's candidates are already bounded to accessories, so its shortlist spans all of them.
      const picked=tracedPick(scored,random,SHORTLIST_MARGIN,()=>({phase:'main',desired,intent,protocol,stages,
        route,explain:exercise=>{const parts={};scoreFor(exercise,parts);return parts;}}),route?scored.length:candidateWindowRanks(scored.length));
      if(!picked)break;
      if(route)state.supportingRouteFilled=true;
      selected.push(picked);
    }
    return selected;
  }

  // Occurrence targets are plan data, never exercise metadata or confirmed actuals.
  // Bounds apply only to explicit overrides; saved/default prescriptions retain their semantics.
  const OCCURRENCE_TARGET_LIMITS=Object.freeze({maxOccurrences:256,maxReps:100,maxSecondsPerSide:300,maxEstimatedSeconds:600,maxLoad:1000});
  const plainTarget=value=>!!value&&Object.prototype.toString.call(value)==='[object Object]'
    &&(Object.getPrototypeOf(value)===null||Object.getPrototypeOf(Object.getPrototypeOf(value))===null);
  function resolveOccurrenceTarget(exercise, target, {timedIntervalSeconds}={}) {
    if(!plainTarget(target)||Object.keys(target).some(key=>!['plannedPrescription','plannedLoad'].includes(key)))throw new Error('Invalid occurrence target fields.');
    const p=target.plannedPrescription,base=exercise&&exercise.prescription,limit=OCCURRENCE_TARGET_LIMITS;
    const interval=Number.isFinite(timedIntervalSeconds),expected=interval?'timed':base&&base.type;
    if(!base||!Number.isFinite(base.value)||base.value<=0||!plainTarget(p)||Object.keys(p).some(key=>!['type','value'].includes(key))||p.type!==expected
      ||!['reps','unilateral-reps','timed','unilateral-timed'].includes(p.type)
      ||!Number.isFinite(p.value)||p.value<=0)throw new Error('Invalid occurrence prescription.');
    const timed=p.type.includes('timed'),sides=sideCount(exercise);
    if((sides===2)!==p.type.startsWith('unilateral')||!timed&&!Number.isInteger(p.value)
      ||p.value>(timed?limit.maxSecondsPerSide:limit.maxReps)
      ||interval&&p.value>timedIntervalSeconds)throw new Error('Unsafe or contradictory occurrence prescription.');
    const seconds=timed?p.value*sides:Math.ceil(exercise.estimatedSeconds/sides*p.value/base.value)*sides;
    if(!Number.isFinite(seconds)||seconds<=0||seconds>limit.maxEstimatedSeconds)throw new Error('Invalid occurrence duration.');
    const resolved={plannedPrescription:Object.freeze({...p}),estimatedSeconds:seconds};
    if(target.plannedLoad!==undefined){
      const load=target.plannedLoad;
      if(plainTarget(load)&&Object.keys(load).length===1&&['lighter','medium','heavier'].includes(load.relativeLoad)&&pyramidResistanceAdjustable(exercise)&&!timed){
        resolved.plannedLoad=Object.freeze({...load});
      }else{
        if(!plainTarget(load)||Object.keys(load).some(key=>!['suggestedLoad','loadUnit','loadInterpretation'].includes(key))
          ||!Number.isFinite(load.suggestedLoad)||load.suggestedLoad<=0||load.suggestedLoad>limit.maxLoad
          ||!['kg','lb'].includes(load.loadUnit)||!['per-item','total'].includes(load.loadInterpretation))throw new Error('Invalid planned load guidance.');
        resolved.plannedLoad=Object.freeze({...load});
      }
    }
    return Object.freeze(resolved);
  }

  function validateOccurrenceTargets(block, catalogue) {
    if(block.occurrenceTargets===undefined)return [];
    if(block.protocol==='ladder')return ['ladder-occurrence-overrides'];
    if(block.protocol==='pyramid')return ['pyramid-occurrence-overrides'];
    if(block.protocol==='density')return ['density-occurrence-overrides'];
    const targets=block.occurrenceTargets,exercises=block.exercises||[],p=block.prescription||{},shape=PROTOCOL_SHAPES[block.protocol];
    if(!Array.isArray(exercises)||!exercises.length)return ['invalid-occurrence-targets'];
    const count=shape&&(block.protocol==='emom'?p.minutes:p[shape.repeatKey]*exercises.length);
    if(!Array.isArray(targets)||!Number.isInteger(count)||count<1||count>OCCURRENCE_TARGET_LIMITS.maxOccurrences||targets.length!==count)return ['invalid-occurrence-targets'];
    if(exercises.some(exercise=>exercise.coachAnchor))return ['occurrence-target-anchor'];
    const issues=[];
    for(let index=0;index<count;index++){
      if(!Object.prototype.hasOwnProperty.call(targets,index)){issues.push('invalid-occurrence-target:'+index);continue;}
      if(targets[index]===null)continue;
      try{
        const exercise=exercises[index%exercises.length],options=block.protocol==='timed_intervals'?{timedIntervalSeconds:p.workSeconds}:{};
        const resolved=resolveOccurrenceTarget(exercise,targets[index],options);
        if(catalogue)resolveOccurrenceTarget(catalogue[exercise.id],targets[index],options);
        if(block.protocol==='emom'&&(resolved.plannedPrescription.value>p.targets[index%exercises.length].value||resolved.estimatedSeconds>EMOM_POLICY.maxWorkSeconds))throw new Error('Unsafe minute target.');
      }catch(error){issues.push('invalid-occurrence-target:'+index);}
    }
    return issues;
  }

  // Sequential steps last their work estimate plus rests. EMOM steps instead reserve their
  // entire minute window: finishing work early never moves the next boundary.
  // A block without a protocol is a legacy rounds block; an unknown protocol has no steps.
  function estimateBlockDuration(block) {
    if(!block||!Array.isArray(block.exercises)||!block.exercises.length)return 0;
    if(block.protocol&&!MAIN_PROTOCOLS.has(block.protocol))return 0;
    if(validateOccurrenceTargets(block).length)return 0;
    if(block.protocol==='density')return validateDensityBlock(block).length?0:block.prescription.timeCapSeconds;
    if(['ladder','pyramid','complex','density'].includes(block.protocol))return resolveBlockSteps(block).reduce((sum,step)=>sum+(step.kind==='exercise'?step.estimatedSeconds:step.seconds),0);
    if(block.occurrenceTargets&&block.protocol!=='emom')return resolveBlockSteps(block).reduce((sum,step)=>sum+(step.kind==='exercise'?(step.estimatedSeconds??(step.timed?step.seconds:block.exercises[step.exerciseIndex].estimatedSeconds)):step.seconds),0);
    const p=block.prescription||{};
    if(block.protocol==='emom')return validateEmomBlock(block).length?0:p.minutes*EMOM_POLICY.slotSeconds;
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

  // The single resolved plan of a block. The player builds its timeline from these steps and the
  // Session Tracker reads its planned occurrences from that timeline, so presentation and evidence
  // share one plan. Exercise steps carry their position (exerciseIndex plus round, set or cycle);
  // rest steps sit only between exercise steps and never end a block. EMOM steps carry absolute
  // block-relative minute windows; their targets never describe the length of the slot.
  function resolveBlockSteps(block) {
    const steps=[],p=block.prescription||{},exercises=block.exercises||[];
    if(validateOccurrenceTargets(block).length)return steps;
    if(block.protocol==='density'){
      if(validateDensityBlock(block).length)return steps;
      for(let densityRound=1;densityRound<=p.repeats;densityRound++)exercises.forEach((exercise,exerciseIndex)=>{
        const target=resolveOccurrenceTarget(exercise,{plannedPrescription:{...p.targets[exerciseIndex]}});
        steps.push(Object.freeze({kind:'exercise',exerciseIndex,densityRound,...target,variableTarget:true,timed:false,completion:'explicit'}));
        if(exerciseIndex<exercises.length-1)steps.push({kind:'density-rest',seconds:p.exerciseRestSeconds,nextExerciseIndex:exerciseIndex+1,densityRound});
        else if(densityRound<p.repeats)steps.push({kind:'density-rest',seconds:p.roundRestSeconds,nextExerciseIndex:0,densityRound});
      });
    }else if(block.protocol==='complex'){
      if(validateComplexBlock(block).length)return steps;
      for(let sequence=1;sequence<=p.sequences;sequence++)exercises.forEach((exercise,exerciseIndex)=>{
        const target=resolveOccurrenceTarget(exercise,{plannedPrescription:{...p.targets[exerciseIndex]}}),timed=target.plannedPrescription.type==='timed';
        steps.push(Object.freeze({kind:'exercise',exerciseIndex,complexSequence:sequence,...target,variableTarget:true,timed,
          ...(timed?{seconds:target.plannedPrescription.value}:{completion:'explicit'})}));
        if(exerciseIndex<exercises.length-1&&p.changeoverSeconds)steps.push({kind:'complex-change',seconds:p.changeoverSeconds,nextExerciseIndex:exerciseIndex+1,complexSequence:sequence});
        else if(exerciseIndex===exercises.length-1&&sequence<p.sequences)steps.push({kind:'complex-rest',seconds:p.sequenceRestSeconds,nextExerciseIndex:0,complexSequence:sequence});
      });
    }else if(block.protocol==='pyramid'){
      if(validatePyramidBlock(block).length)return steps;
      p.steps.forEach((step,index)=>{
        const target=resolveOccurrenceTarget(exercises[0],{plannedPrescription:{type:'reps',value:step.reps},
          ...(step.relativeLoad?{plannedLoad:{relativeLoad:step.relativeLoad}}:{})});
        steps.push(Object.freeze({kind:'exercise',exerciseIndex:0,pyramidStep:index+1,...target,variableTarget:true,timed:false,completion:'explicit'}));
        if(index<p.steps.length-1)steps.push({kind:'pyramid-rest',seconds:p.stepRestSeconds,nextExerciseIndex:0,pyramidStep:index+1});
      });
    }else if(block.protocol==='ladder'){
      if(validateLadderBlock(block).length)return steps;
      p.repSteps.forEach((reps,stepIndex)=>exercises.forEach((exercise,exerciseIndex)=>{
        const target=resolveOccurrenceTarget(exercise,{plannedPrescription:{type:'reps',value:reps}});
        steps.push(Object.freeze({kind:'exercise',exerciseIndex,ladderStep:stepIndex+1,...target,variableTarget:true,timed:false,completion:'explicit'}));
        if(exerciseIndex<exercises.length-1&&p.exerciseRestSeconds)steps.push({kind:'rest',seconds:p.exerciseRestSeconds,nextExerciseIndex:exerciseIndex+1,ladderStep:stepIndex+1});
        else if(exerciseIndex===exercises.length-1&&stepIndex<p.repSteps.length-1)steps.push({kind:'ladder-rest',seconds:p.stepRestSeconds,nextExerciseIndex:0,ladderStep:stepIndex+1});
      }));
    }else if(block.protocol==='emom'){
      if(validateEmomBlock(block).length)return steps;
      for(let slotIndex=0;slotIndex<p.minutes;slotIndex++){
        const exerciseIndex=slotIndex%exercises.length,target=Object.freeze({...p.targets[exerciseIndex]});
        steps.push(Object.freeze({kind:'exercise',exerciseIndex,minute:slotIndex+1,slotIndex,
          startsAtSeconds:slotIndex*60,endsAtSeconds:(slotIndex+1)*60,
          target,plannedPrescription:target,completion:'explicit',timed:target.type==='timed',...(target.type==='timed'?{seconds:target.value}:{})}));
      }
    }else if(block.protocol==='rounds'){
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
    if(!block.occurrenceTargets)return steps;
    let occurrence=0;
    return steps.map(step=>{
      if(step.kind!=='exercise')return step;
      const target=block.occurrenceTargets[occurrence++];
      if(target===null){
        const exercise=exercises[step.exerciseIndex],plannedPrescription=step.plannedPrescription
          ||(step.timed?{type:'timed',value:step.seconds}:exercise.prescription);
        return Object.freeze({...step,variableTarget:true,plannedPrescription:Object.freeze({...plannedPrescription}),
          estimatedSeconds:step.timed?step.seconds:exercise.estimatedSeconds});
      }
      const resolved=resolveOccurrenceTarget(exercises[step.exerciseIndex],target,block.protocol==='timed_intervals'?{timedIntervalSeconds:p.workSeconds}:{});
      const timed=resolved.plannedPrescription.type.includes('timed');
      return Object.freeze({...step,...resolved,variableTarget:true,timed,
        ...(timed?{seconds:resolved.plannedPrescription.value}:{}),
        ...(block.protocol==='emom'?{target:resolved.plannedPrescription}:{})});
    });
  }

  function preferredRepeatCount(protocol, exerciseCount) {
    if(protocol==='pyramid')return PYRAMID_POLICY.maxSteps;
    if(protocol==='complex')return COMPLEX_POLICY.maxSequences;
    if(protocol==='ladder')return LADDER_POLICY.maxSteps;
    if(protocol==='density')return DENSITY_POLICY.maxRepeats;
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
    if(protocol==='density'){
      if(exercises.length!==2)return null;
      const timeCapSeconds=Math.min(DENSITY_POLICY.maxCapSeconds,Math.floor(targetSeconds/30)*30);
      for(let repeats=DENSITY_POLICY.maxRepeats;repeats>=2;repeats--){
        const prescription={repeats,targets:exercises.map(densityDefaultTarget),timeCapSeconds,
          exerciseRestSeconds:Math.max(15,rest.exercise),roundRestSeconds:Math.max(45,rest.round)};
        if(!validateDensityBlock({protocol,exercises,prescription}).length)return {prescription,estimate:timeCapSeconds,fitness:targetSeconds-timeCapSeconds};
      }
      return null;
    }
    if(protocol==='complex'){
      // The fullest bounded plan within the share; recovery is never compressed below its floor.
      let best=null;
      const targets=exercises.map(complexDefaultTarget),changeoverSeconds=Math.min(10,rest.exercise);
      for(let sequences=COMPLEX_POLICY.minSequences;sequences<=COMPLEX_POLICY.maxSequences;sequences++)
        for(let recovery=Math.max(rest.round,COMPLEX_POLICY.minSequenceRestSeconds);recovery<=COMPLEX_POLICY.maxSequenceRestSeconds;recovery+=15){
          const prescription={sequences,targets:targets.map(target=>({...target})),changeoverSeconds,sequenceRestSeconds:recovery};
          const candidate={protocol,exercises,prescription};
          if(validateComplexBlock(candidate).length)continue;
          const estimate=estimateBlockDuration(candidate);
          if(estimate<=targetSeconds&&(!best||estimate>best.estimate))best={prescription,estimate,fitness:targetSeconds-estimate};
        }
      return best;
    }
    if(protocol==='pyramid'){
      let best=null;
      const kind=options&&options.pyramidKind||'reps';
      const plans=kind==='reverse'?[[4,6,8]]:kind==='intensity'?[[8,4,8],[8,6,4,6,8]]:[[4,8,4],[4,6,8,6,4]];
      const minimumRest=kind==='reps'?PYRAMID_POLICY.minRestSeconds:PYRAMID_POLICY.intensityRestSeconds;
      for(const reps of plans)for(let recovery=Math.max(rest.round,minimumRest);recovery<=PYRAMID_POLICY.maxRestSeconds;recovery+=15){
        const levels=kind==='reverse'?['heavier','medium','lighter']:reps.length===3?['lighter','heavier','lighter']:['lighter','medium','heavier','medium','lighter'];
        const steps=reps.map((value,index)=>({reps:value,...(kind!=='reps'?{relativeLoad:levels[index]}:{})}));
        const prescription={steps,stepRestSeconds:recovery};
        const candidate={protocol,exercises,prescription};
        if(validatePyramidBlock(candidate).length)continue;
        const estimate=estimateBlockDuration(candidate);
        if(estimate<=targetSeconds&&(!best||estimate>best.estimate))best={prescription,estimate,fitness:targetSeconds-estimate};
      }
      return best;
    }
    if(protocol==='ladder'){
      let best=null;
      for(const plan of [[2,4],[2,4,6],[2,4,6,8],[2,4,6,8,10],[3,6,9],[4,8,12]]){
        const repSteps=options&&options.descending?plan.slice().reverse():plan.slice();
        const prescription={repSteps,exerciseRestSeconds:rest.exercise,stepRestSeconds:rest.round};
        const candidate={protocol,exercises,prescription};
        if(validateLadderBlock(candidate).length)continue;
        const estimate=estimateBlockDuration(candidate);
        if(estimate<=targetSeconds&&(!best||estimate>best.estimate))best={prescription,estimate,fitness:targetSeconds-estimate};
      }
      return best;
    }
    if(protocol==='emom'){
      const minutes=Math.min(EMOM_POLICY.maxMinutes,exercises.length*4,Math.floor(targetSeconds/60));
      if(minutes<Math.max(3,exercises.length))return null;
      const prescription={minutes,slotSeconds:60,targets:exercises.map(exercise=>({...exercise.prescription}))};
      return {prescription,estimate:minutes*60,fitness:targetSeconds-minutes*60};
    }
    const allowExtendedRepetition=!!(options&&options.allowExtendedRepetition);
    let best=null;
    const consider=p=>{
      const candidate={protocol,exercises,prescription:p};
      const estimate=estimateBlockDuration(candidate);
      const repeatCount=p[PROTOCOL_SHAPES[protocol].repeatKey];
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
    const desiredCount=protocol==='pyramid'?1:protocol==='complex'?(targetSeconds<360?2:3):protocol==='paired_sets'||protocol==='ladder'||protocol==='density'?2:protocol==='rounds'?(targetSeconds<420?3:4):(targetSeconds<300?2:3);
    const count=Math.min(desiredCount,compatible.length);
    const exercises=selectBlockExercises(eligible,count,focus,intent,protocol,state,history,random,catalogue);
    if(exercises.length<(protocol==='pyramid'?1:protocol==='rounds'?Math.min(3,compatible.length):2))return null;
    const constrainedPool=compatible.length<=count;
    const pyramidVariant=protocol==='pyramid'&&pyramidResistanceAdjustable(exercises[0])?weightedPick([{value:'reps',weight:2},{value:'intensity',weight:1},{value:'reverse',weight:1}],random):'reps';
    const fitted=chooseClosestPrescription(protocol,exercises,targetSeconds,rest,focus,{allowExtendedRepetition:constrainedPool,
      ...(protocol==='ladder'?{descending:random()<.5}:{}),...(protocol==='pyramid'?{pyramidKind:pyramidVariant}:{})});
    if(!fitted)return null;
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
    const p=block.prescription||{},shape=PROTOCOL_SHAPES[block.protocol];
    if(block.protocol==='pyramid')return Array.isArray(p.steps)?p.steps.length:0;
    if(block.protocol==='ladder')return Array.isArray(p.repSteps)?p.repSteps.length:0;
    return shape?Number(p[shape.repeatKey])||1:1;
  }

  // Protocol conditions shared by every occurrence of a block: its prescription without the
  // repeat count. The player attaches them to each Main exercise phase; the Session Tracker
  // records them in the planned occurrence for Training History comparability.
  function protocolConditions(block) {
    const conditions=block&&['emom','complex','density'].includes(block.protocol)?jsonCopy(block.prescription):Object.assign({},block&&block.prescription);
    PROTOCOL_REPEAT_KEYS.forEach(key=>delete conditions[key]);
    return conditions;
  }

  function protocolVarietyCredit(blocks, targetSeconds) {
    return new Set(blocks.map(block=>block.protocol)).size>1?(targetSeconds>=720?35:targetSeconds>=480?20:5):0;
  }

  function mainQualityPenalty(blocks, targetSeconds, eligibleCount) {
    const exercises=blocks.flatMap(block=>block.exercises),counts=new Map();
    let penalty=0;
    for(const block of blocks){
      const repeats=block.protocol==='emom'?Math.ceil(blockRepeatCount(block)/block.exercises.length):blockRepeatCount(block);
      penalty+=repetitionPenalty(block.protocol,block.exercises,repeats,false);
      const repeatedSupporting=block.exercises.filter(exercise=>exercise.mainRole==='supporting').length*Math.max(0,repeats-1);
      penalty+=repeatedSupporting*24;
      // Pyramid volume is bounded in actual reps/work seconds, so five small steps
      // must not be scored as five full catalogue sets of a tiny straight-set loop.
      if(!['pyramid','complex'].includes(block.protocol)&&block.exercises.length<=3&&repeats>3)penalty+=(repeats-3)*70;
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

  function exerciseExposureCount(block,index){
    return block.protocol==='emom'?Math.max(0,Math.ceil((blockRepeatCount(block)-index)/block.exercises.length)):blockRepeatCount(block);
  }

  function equipmentUsageSeconds(blocks) {
    const usage=new Map();
    for(const block of blocks){
      for(const [index,exercise] of (block.exercises||[]).entries()){
        const type=primaryEquipment(exercise);
        if(type==='bodyweight')continue;
        if(['ladder','pyramid','complex','density'].includes(block.protocol)){
          const seconds=resolveBlockSteps(block).filter(step=>step.kind==='exercise'&&step.exerciseIndex===index).reduce((sum,step)=>sum+step.estimatedSeconds,0);
          usage.set(type,(usage.get(type)||0)+seconds);continue;
        }
        usage.set(type,(usage.get(type)||0)+(block.protocol==='emom'?Math.ceil(exercise.estimatedSeconds*block.prescription.targets[index].value/exercise.prescription.value):exercise.estimatedSeconds)*exerciseExposureCount(block,index));
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
      if(mainFamilyCapped(exercise))
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
      if(block.protocol==='emom'){
        const invalid=validateEmomBlock(block,catalogue);
        if(invalid.length){issues.push(...invalid.map(issue=>block.id+':'+issue));continue;}
      }
      if(block.protocol==='ladder'){
        const invalid=validateLadderBlock(block,catalogue);
        if(invalid.length){issues.push(...invalid.map(issue=>block.id+':'+issue));continue;}
      }
      if(block.protocol==='pyramid'){
        const invalid=validatePyramidBlock(block,catalogue);
        if(invalid.length){issues.push(...invalid.map(issue=>block.id+':'+issue));continue;}
      }
      if(block.protocol==='complex'){
        const invalid=validateComplexBlock(block,catalogue);
        if(invalid.length){issues.push(...invalid.map(issue=>block.id+':'+issue));continue;}
      }
      if(block.protocol==='density'){
        const invalid=validateDensityBlock(block,catalogue);
        if(invalid.length){issues.push(...invalid.map(issue=>block.id+':'+issue));continue;}
      }
      if(!MAIN_INTENTS.has(block.intent))issues.push(block.id+':invalid-intent');
      if(!Array.isArray(block.exercises)||!block.exercises.length)issues.push(block.id+':no-exercises');
      for(const exercise of block.exercises||[]){
        if(!catalogue[exercise.id])issues.push(block.id+':unknown-exercise:'+exercise.id);
        else if(!requirementsMet(catalogue[exercise.id],owned))issues.push(block.id+':equipment:'+exercise.id);
        else if(!protocolCompatible(catalogue[exercise.id],block.protocol))issues.push(block.id+':incompatible:'+exercise.id);
      }
      const p=block.prescription||{};
      issues.push(...validateOccurrenceTargets(block,catalogue).map(issue=>block.id+':'+issue));
      if(block.protocol==='rounds'&&(!Number.isInteger(p.rounds)||p.rounds<1))issues.push(block.id+':invalid-rounds');
      if(block.protocol==='paired_sets'&&((block.exercises||[]).length!==2||!Number.isInteger(p.sets)||p.sets<1))issues.push(block.id+':invalid-paired-sets');
      if(block.protocol==='timed_intervals'&&(!Number.isInteger(p.cycles)||p.cycles<1||!Number.isFinite(p.workSeconds)||p.workSeconds<=0||!Number.isFinite(p.transitionSeconds)||p.transitionSeconds<0))issues.push(block.id+':invalid-intervals');
      const estimate=estimateBlockDuration(block);
      if(!Number.isFinite(estimate)||estimate<=0)issues.push(block.id+':invalid-duration');
      if(!resolveBlockSteps(block).some(step=>step.kind==='exercise'))issues.push(block.id+':unplayable');
    }
    const estimate=main.blocks.reduce((sum,block)=>sum+estimateBlockDuration(block),0)+BLOCK_TRANSITION_SECONDS*Math.max(0,main.blocks.length-1);
    if(main.blocks.some(block=>['emom','ladder','pyramid','complex','density'].includes(block.protocol)||block.occurrenceTargets)&&Number.isFinite(targetSeconds)&&estimate>targetSeconds)issues.push('main:duration-over-budget');
    if(Number.isFinite(targetSeconds)&&Math.abs(estimate-targetSeconds)>Math.max(240,targetSeconds*.38))issues.push('main:duration-out-of-tolerance');
    return issues;
  }

  function composeMain(catalogue, eligible, budget, duration, focus, owned, history, rest, random, difficulty, bodyFocus, recentProtocols) {
    const attempts=[];
    const diversityTarget=EQUIPMENT_DIVERSITY[duration]||EQUIPMENT_DIVERSITY[20];
    const viableCount=viableEquipmentTypes(eligible).size;
    // One roll for the whole Main, taken only where the route could apply, so short Main phases,
    // Cardio (no accessory block; see chooseIntents) and pools with fewer than `minCandidates`
    // accessories generate exactly as before.
    const supportingRoute=duration>=SUPPORTING_ROUTE.minDuration&&focus!=='cardio'&&eligible.filter(routeAccessory).length>=SUPPORTING_ROUTE.minCandidates&&random()<SUPPORTING_ROUTE.probability;
    // Catalogue growth can make all ten attempts miss a variety requirement. Retry
    // only that failure path before using the short last-resort fallback; ordinary
    // valid attempts and supporting-route selection keep their existing draw stream.
    for(let attempt=0;attempt<10||(!attempts.length&&attempt<20);attempt++){
      const count=chooseBlockCount(duration,eligible.length,random),intents=chooseIntents(focus,count,random);
      const state={exercises:[],usedIds:new Set(),equipmentUsage:new Map(),blocks:[],owned,diversityTarget,supportingRoute,difficulty,bodyFocus,duration,recentProtocols};
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
        block.exercises.forEach(ex=>state.usedIds.add(ex.id));
        state.equipmentUsage=equipmentUsageSeconds(state.blocks);
        remaining-=block.estimatedDurationSeconds+(index<count-1?BLOCK_TRANSITION_SECONDS:0);
      }
      if(!state.blocks.length){
        if(activeTrace)activeTrace({type:'main-attempt',attempt,issues:['main:no-blocks']});
        continue;
      }
      const estimated=state.blocks.reduce((sum,block)=>sum+block.estimatedDurationSeconds,0)+BLOCK_TRANSITION_SECONDS*Math.max(0,state.blocks.length-1);
      const varietyCredit=protocolVarietyCredit(state.blocks,budget.main);
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
      attempts.push({attempt,blocks:state.blocks,estimated,routeFilled:!!state.supportingRouteFilled,fitness:Math.abs(estimated-budget.main)+mainQualityPenalty(state.blocks,budget.main,eligible.length)+dominancePenalty+blockDominancePenalty-varietyCredit-equipmentCredit});
      if(activeTrace)activeTrace({type:'main-attempt',attempt,issues:[],fitness:attempts[attempts.length-1].fitness});
    }
    attempts.sort((a,b)=>a.fitness-b.fitness);
    // A drawn route keeps its accessory: the fittest valid attempt that filled the route slot is
    // chosen over fitter attempts that never reached it (no accessory block, or too few roles
    // before its last slot). Without such an attempt the fittest attempt is chosen as before.
    const chosen=attempts.find(item=>item.routeFilled)||attempts[0];
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
  const VALID_STRETCH_TARGETS = new Set(['hamstrings','glutes','calves','quadriceps','hip-flexors','adductors','chest','shoulders','triceps','back','trunk']);
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
      if (!validInstruction) errors.push(id+': instruction must be a non-empty, single-line string of at most 180 characters');
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
      if (exercise.bodyFocus!=null && !EXERCISE_BODY_FOCUSES.has(exercise.bodyFocus)) errors.push(id+': invalid bodyFocus '+JSON.stringify(exercise.bodyFocus));
      if (exercise.directElbowAction!=null && !EXERCISE_DIRECT_ELBOW_ACTIONS.has(exercise.directElbowAction)) errors.push(id+': invalid directElbowAction '+JSON.stringify(exercise.directElbowAction));
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
      if (exercise.stretchTargets!==undefined) {
        const targets = exercise.stretchTargets;
        if (!Array.isArray(targets) || !targets.every(target => VALID_STRETCH_TARGETS.has(target)) || new Set(targets).size!==targets.length) errors.push(id+': invalid stretch targets');
        else if (exercise.cooldown && !targets.length) errors.push(id+': cool-down exercise missing stretch targets');
        else if (!exercise.cooldown && targets.length) errors.push(id+': stretch targets set on a non-cool-down exercise');
      }
      if (exercise.kneeMobility!==undefined && typeof exercise.kneeMobility!=='boolean') errors.push(id+': kneeMobility must be boolean');
      if (exercise.kneeMobility===true && !(exercise.warmup && exercise.impact==='low' && Array.isArray(exercise.equipment) && !exercise.equipment.length &&
        (exercise.warmupAreas || []).includes('knees') && !(exercise.patterns || []).some(pattern => MAJOR_REPEAT_PATTERNS.has(pattern)) &&
        !exercise.conditioning && exercise.prepIntensity<=2 && exercise.prepFatigue===1)) errors.push(id+': kneeMobility requires a gentle, low-impact, unloaded bodyweight knee warm-up');
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
    if (selected.some(item=>sameRepetitionClass(item,exercise))) score += credit(parts,'repetition-class',-WARMUP_REPETITION_CLASS_PENALTY);
    return score;
  }

  function scoreRampupCandidate(exercise, position, selected, warmup, mainExercises, owned, focus, parts) {
    const previous = selected[selected.length-1] || warmup[warmup.length-1];
    const firstMain = mainExercises[0];
    const targetIntensity = 3 + 2*position;
    let score = credit(parts,'prep-demand',14 - Math.abs(exercise.prepIntensity-targetIntensity)*3 - exercise.prepFatigue*1.8 - Math.max(0,exercise.prepComplexity-2)*1.5);
    const specificity = contextSpecificity(exercise,mainExercises);
    score += credit(parts,'main-specificity',specificity * (2 + 7*position));
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
    const upperCap=upperTrunkOnlyCap(targetCount), upperTarget=upperTrunkTarget(targetCount);
    for(let slot=0;slot<targetCount && candidates.length;slot++) {
      const stages=activeTrace?[]:null;
      // Exercises an earlier pick removed as a duplicate or direct variant.
      if (stages) narrow(stages,'family-duplicate',eligible.filter(ex=>!selected.includes(ex)),candidates);
      let slotCandidates=candidates;
      // Essential knee mobility is constructed first and precedes every other rule, so a
      // warm-up of any length holds it; it is infeasible only without an eligible qualifier.
      if (!selected.some(kneeMobilityQualified)) {
        const kneeCandidates=slotCandidates.filter(kneeMobilityQualified);
        if (kneeCandidates.length) slotCandidates=narrow(stages,'knee-mobility',slotCandidates,kneeCandidates);
      }
      // The coverage rules are soft-mandatory: they narrow the slot only while an eligible
      // alternative exists, so a constrained catalogue still produces a warm-up.
      const lowerNeeded=context.lowerTarget-selected.filter(meaningfulLowerPrep).length;
      if (lowerNeeded>0 && lowerNeeded>=targetCount-slot) {
        const lowerCandidates=slotCandidates.filter(meaningfulLowerPrep);
        if (lowerCandidates.length) slotCandidates=narrow(stages,'lower-coverage',slotCandidates,lowerCandidates);
      }
      // Once the remaining slots are only just enough for both minimums, each slot serves one of them.
      const upperNeeded=upperTarget-selected.filter(upperTrunkPrep).length;
      if (upperNeeded>0 && upperNeeded+Math.max(0,lowerNeeded)>=targetCount-slot) {
        const covering=slotCandidates.filter(ex=>upperTrunkPrep(ex) || (lowerNeeded>0 && meaningfulLowerPrep(ex)));
        if (covering.length) slotCandidates=narrow(stages,'upper-trunk-coverage',slotCandidates,covering);
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
      const upperCoverage=selected.filter(upperTrunkPrep).length;
      const soleKneeMobility=kneeMobilityQualified(current) && !selected.some(ex=>ex!==current && kneeMobilityQualified(ex));
      const viable=alternatives.filter(ex=>(!soleKneeMobility || kneeMobilityQualified(ex)) && coverage-(meaningfulLowerPrep(current)?1:0)+(meaningfulLowerPrep(ex)?1:0)>=context.lowerTarget &&
        upperOnly-(!lowerJointCoverage(current).length?1:0)+(!lowerJointCoverage(ex).length?1:0)<=upperCap &&
        upperCoverage-(upperTrunkPrep(current)?1:0)+(upperTrunkPrep(ex)?1:0)>=Math.min(upperTarget,upperCoverage));
      if (viable.length) {
        viable.sort((a,b)=>Math.abs(a.prepIntensity-current.prepIntensity)-Math.abs(b.prepIntensity-current.prepIntensity) ||
          scoreWarmupCandidate(b,selected.slice(0,index),mainExercises,owned,context)-scoreWarmupCandidate(a,selected.slice(0,index),mainExercises,owned,context));
        if (activeTrace) activeTrace({type:'replace',phase:'warmup',rule:'adjacent-pattern',removed:selected[index],added:viable[0]});
        selected[index]=viable[0];
        candidates=candidates.filter(ex=>!sameExerciseOrFamily(ex,viable[0]));
      }
    }
    const fitted=fitTimedDurations(selected,targetSeconds,restSeconds,'warmup');
    const result={exercises:fitted.exercises,restSeconds,estimatedSeconds:fitted.estimatedSeconds};
    // An artificially constrained pool can lack every qualifier; say so rather than pass it off as complete.
    if (selected.length && !selected.some(kneeMobilityQualified)) result.diagnostics=['warmup:knee-mobility-unavailable'];
    return result;
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
    if(warmup.exercises.length && !warmup.exercises.some(kneeMobilityQualified)) issues.push('warmup:missing-knee-mobility');
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
    const copy=Object.assign({},exercise,{patterns:(exercise.patterns||[]).slice(),movementPlanes:(exercise.movementPlanes||[]).slice(),warmupAreas:(exercise.warmupAreas||[]).slice(),equipment:(exercise.equipment||[]).map(group=>group.slice()),prescription:Object.assign({},exercise.prescription),timedCues:(exercise.timedCues||[]).map(cue=>Object.assign({},cue,{at:Object.assign({},cue.at)}))});
    if(exercise.coachAnchor)copy.coachAnchor=JSON.parse(JSON.stringify(exercise.coachAnchor));
    return copy;
  }

  // ---- Session Prescription seam ----
  // This policy only runs with an explicit versioned prescription. Required blocks are built
  // before selection, without RNG/history/role penalties. Coach supplies intent, not scores
  // or Programme State. The standalone composition path below remains unchanged.
  class SessionPrescriptionError extends Error {
    constructor(assessment) {
      super('Infeasible Session Prescription: '+assessment.hardConflicts.map(item=>item.code).join(', '));
      this.name='SessionPrescriptionError';
      this.code='session-prescription-infeasible';
      this.assessment=assessment;
    }
  }

  const jsonCopy=value=>JSON.parse(JSON.stringify(value));
  const prescriptionList=(rx,key)=>rx[key]||[];
  function avoidMatches(exercise, constraint) {
    return constraint.exerciseId?exercise.id===constraint.exerciseId:constraint.pattern?(exercise.patterns||[]).includes(constraint.pattern):exercise.bodyFocus===constraint.bodyRegion;
  }
  const optionalMainAllowed=(exercise,rx)=>!rx||rx.optionalMainExerciseIds==null||rx.optionalMainExerciseIds.includes(exercise.id);
  function sessionPriorityCredit(exercise, rx, history, catalogue) {
    let score=0;
    for(const priority of prescriptionList(rx,'movementPriorities'))if((exercise.patterns||[]).includes(priority.pattern))score+=({primary:18,secondary:8,maintenance:0})[priority.priority];
    for(const priority of prescriptionList(rx,'bodyRegionPriorities'))if(exercise.bodyFocus===priority.bodyRegion)score+=({high:16,normal:6,maintenance:0})[priority.priority];
    for(const constraint of prescriptionList(rx,'avoidConstraints'))if(constraint.importance==='soft'&&avoidMatches(exercise,constraint))score-=28;
    if(rx.variationPreference==='varied')score-=Math.min(8,recentUsePenalty(exercise,history,catalogue)/2);
    if(rx.variationPreference==='familiar')score+=Math.min(8,recentUsePenalty(exercise,history,catalogue)/2);
    return Math.max(-40,Math.min(32,score));
  }
  const recentExerciseIds=history=>[...new Set((history||[]).flat())];
  function constraintApplies(constraint, anchor) {
    return !constraint.anchorRequirementId || !!anchor&&constraint.anchorRequirementId===anchor.requirementId;
  }
  function permittedProtocols(rx, anchor, includeSoft=false) {
    let protocols=GENERATED_PROTOCOLS.slice();
    // Timed conversion of an anchor requires explicit permission, even if its catalogue
    // entry supports intervals. Generic timed work retains its normal protocol policy.
    if(anchor)protocols=anchor.allowedProtocols==null?['rounds','paired_sets']:anchor.allowedProtocols.slice();
    for(const constraint of prescriptionList(rx,'protocolConstraints'))if(constraintApplies(constraint,anchor)&&(includeSoft||constraint.importance==='hard'))protocols=protocols.filter(protocol=>constraint.allowedProtocols.includes(protocol));
    return protocols;
  }
  function anchorExercise(source, anchor, prescriptionId) {
    const exercise=copyExercise(source),target=anchor.target;
    if(target){
      const perSide=sideCount(exercise)>1;
      const value=target.type==='timed'?target.seconds:target.maxReps||target.minReps;
      exercise.prescription={type:target.type==='timed'?(perSide?'unilateral-timed':'timed'):(perSide?'unilateral-reps':'reps'),value};
      // Estimate rep ranges conservatively at their upper bound; timed targets are per side.
      exercise.estimatedSeconds=target.type==='timed'?value*sideCount(exercise):Math.ceil(source.estimatedSeconds*value/source.prescription.value);
    }
    const plannedTarget={};
    for(const key of ['targetSets','targetExposures','target','prescriptionMode','suggestedLoad','loadUnit','loadInterpretation','progressionIntent'])if(anchor[key]!=null)plannedTarget[key]=jsonCopy(anchor[key]);
    exercise.coachAnchor={prescriptionId,requirementId:anchor.requirementId,importance:anchor.importance,plannedTarget};
    return exercise;
  }
  function anchorRepeats(anchor, exercise) {
    const sides=sideCount(exercise),sets=anchor.targetSets,exposures=anchor.targetExposures;
    if(exposures!=null&&(!Number.isInteger(exposures/sides)||sets!=null&&sets*sides!==exposures))return null;
    return sets||exposures/sides||1;
  }
  function finishMainBlock(block) {
    if(block.protocol==='rounds'){
      block.rounds=block.prescription.rounds;
      block.rest={exercise:block.prescription.exerciseRestSeconds,round:block.prescription.roundRestSeconds};
    }
    block.estimatedDurationSeconds=block.estimatedSeconds=estimateBlockDuration(block);
    return block;
  }
  function anchorBlock(protocol, exercises, repeats, rest, index) {
    const prescription=protocol==='rounds'?{rounds:repeats,exerciseRestSeconds:rest.exercise,roundRestSeconds:rest.round}:
      protocol==='paired_sets'?{sets:repeats,betweenExercisesSeconds:Math.min(10,rest.exercise),betweenSetsSeconds:rest.round}:
      {cycles:repeats,workSeconds:exercises[0].prescription.type.includes('timed')?exercises[0].prescription.value:exercises[0].estimatedSeconds,transitionSeconds:rest.exercise};
    return finishMainBlock({id:'main-'+(index+1),protocol,intent:'strength',exercises:exercises.map(copyExercise),prescription});
  }
  const mainSeconds=blocks=>blocks.reduce((sum,block)=>sum+estimateBlockDuration(block),0)+BLOCK_TRANSITION_SECONDS*Math.max(0,blocks.length-1);
  function minimumOptionalBlock(eligible, protocols, rest, focus, index=0) {
    const choices=[];
    for(const protocol of protocols){
      const compatible=eligible.filter(exercise=>protocolCompatible(exercise,protocol)).sort((a,b)=>a.estimatedSeconds-b.estimatedSeconds||a.id.localeCompare(b.id));
      const count=['emom','paired_sets','complex','density'].includes(protocol)?2:1;
      const picked=[];
      if(protocol==='complex'||protocol==='density'){
        const first=compatible.find(exercise=>compatible.some(other=>other!==exercise&&!complexSequenceIssues([exercise,other]).length));
        if(first)picked.push(first,compatible.find(other=>other!==first&&!complexSequenceIssues([first,other]).length));
      }else for(const exercise of compatible)if(picked.length<count&&!mainFamilyCapReached(exercise,picked))picked.push(exercise);
      if(picked.length<count)continue;
      const exercises=picked.map(copyExercise);
      const prescription=protocol==='density'?{repeats:2,targets:exercises.map(densityDefaultTarget),timeCapSeconds:Math.max(180,Math.ceil(densityMinimumSeconds(exercises,{repeats:2,targets:exercises.map(densityDefaultTarget),exerciseRestSeconds:15,roundRestSeconds:45})/30)*30),exerciseRestSeconds:15,roundRestSeconds:45}:
        protocol==='complex'?{sequences:COMPLEX_POLICY.minSequences,targets:exercises.map(complexDefaultTarget),
        changeoverSeconds:Math.min(10,rest.exercise),sequenceRestSeconds:Math.max(COMPLEX_POLICY.minSequenceRestSeconds,rest.round)}:
        protocol==='pyramid'?{steps:[{reps:4},{reps:8},{reps:4}],stepRestSeconds:Math.max(60,rest.round)}:
        protocol==='ladder'?{repSteps:[2,4],exerciseRestSeconds:rest.exercise,stepRestSeconds:rest.round}:
        protocol==='emom'?{minutes:3,slotSeconds:60,targets:exercises.map(exercise=>({...exercise.prescription}))}:protocol==='rounds'?{rounds:1,exerciseRestSeconds:rest.exercise,roundRestSeconds:rest.round}:
        protocol==='paired_sets'?{sets:1,betweenExercisesSeconds:Math.min(10,rest.exercise),betweenSetsSeconds:rest.round}:
        {cycles:1,workSeconds:30,transitionSeconds:rest.exercise};
      if(protocol==='ladder'&&validateLadderBlock({protocol,exercises,prescription}).length)continue;
      if(protocol==='pyramid'&&validatePyramidBlock({protocol,exercises,prescription}).length)continue;
      if(protocol==='complex'&&validateComplexBlock({protocol,exercises,prescription}).length)continue;
      if(protocol==='density'&&validateDensityBlock({protocol,exercises,prescription}).length)continue;
      choices.push(finishMainBlock({id:'main-'+(index+1),protocol,intent:focus==='cardio'?'conditioning':'strength',exercises,prescription}));
    }
    return choices.sort((a,b)=>a.estimatedDurationSeconds-b.estimatedDurationSeconds)[0]||null;
  }
  function prescriptionContext(options, rx) {
    return Object.assign({},options,{
      sessionPrescription:undefined,
      duration:Number(options.duration??rx.duration??20),
      focus:String(options.focus??rx.workoutStyle??'balanced').toLowerCase(),
      difficulty:workoutDifficulty(options.difficulty??rx.difficulty),
      bodyFocus:workoutBodyFocus(options.bodyFocus??rx.bodyFocus),
      equipment:options.equipment??rx.equipment??[]
    });
  }
  function prescriptionBudget(rx, duration) {
    const budget = BUDGETS[duration] || BUDGETS[20];
    if(rx.mainTimeLimitSeconds==null&&rx.maximumDurationSeconds==null)return budget;
    return {...budget,main:Math.max(0,Math.min(budget.main,rx.mainTimeLimitSeconds??Infinity,
      (rx.maximumDurationSeconds??Infinity)-budget.warmup-budget.rampup-budget.cooldown))};
  }
  function prepareSessionPrescription(options) {
    const rx=options.sessionPrescription;
    const assessment={status:'feasible',prescriptionId:rx&&rx.prescriptionId||null,hardConflicts:[],softConflicts:[],softRelaxations:[],warnings:[]};
    const conflict=(list,code,requirementIds=[],exerciseIds=[],details={})=>list.push({code,requirementIds,exerciseIds,...details});
    const Model=root.GarageFitCoachModel;
    const validation=Model?Model.validate('session-prescription',rx):{valid:false,errors:[{message:'GarageFitCoachModel must be loaded for Session Prescriptions.'}]};
    if(!validation.valid){
      conflict(assessment.hardConflicts,'invalid-prescription',[],[],{errors:validation.errors});
      assessment.status='infeasible';return {assessment};
    }
    let context;
    try{
      context=prescriptionContext(options,rx);
      if(!BUDGETS[context.duration])throw new Error('Unsupported prescribed duration '+context.duration+'.');
      if(!Model.WORKOUT_STYLES.includes(context.focus))throw new Error('Unknown prescribed workout style '+context.focus+'.');
      if(!Array.isArray(context.equipment)||context.equipment.some(item=>typeof item!=='string'))throw new Error('Prescribed equipment context must be an array of IDs.');
      assertValidCatalogue(context.catalogue);
    }
    catch(error){conflict(assessment.hardConflicts,'invalid-generation-context',[],[],{message:error.message});assessment.status='infeasible';return {assessment};}
    const catalogue=context.catalogue,owned=context.equipment,budget=prescriptionBudget(rx,context.duration),rest=RESTS[context.focus]||RESTS.balanced;
    const hardAvoids=prescriptionList(rx,'avoidConstraints').filter(item=>item.importance==='hard');
    const available=Object.values(catalogue).filter(exercise=>!hardAvoids.some(item=>avoidMatches(exercise,item)));
    const eligible=available.filter(exercise=>generatedPhaseEligible(exercise,'main',owned,context.difficulty));
    const optionalEligible=eligible.filter(exercise=>optionalMainAllowed(exercise,rx));
    const anchors=prescriptionList(rx,'requiredAnchors').concat(prescriptionList(rx,'preferredAnchors'));
    const anchorIds=new Set(anchors.map(anchor=>anchor.exerciseId)),entries=[];
    for(const anchor of anchors){
      const issues=[],source=catalogue[anchor.exerciseId];
      const add=(code,details={})=>issues.push({code,requirementIds:[anchor.requirementId],exerciseIds:[anchor.exerciseId],...details});
      let exercise,repeats,protocols=[];
      if(!source)add('missing-exercise');
      else{
        if(!requirementsMet(source,owned))add('equipment-mismatch');
        if(!source.generator||!source.main)add('main-ineligible');
        if(difficultyExcluded(source,context.difficulty))add('difficulty-ineligible');
        const avoids=hardAvoids.filter(item=>avoidMatches(source,item));
        if(avoids.length)add('hard-avoid-conflict',{requirementIds:[anchor.requirementId,...avoids.map(item=>item.requirementId)]});
        const mode=prescriptionMode(source.prescription.type);
        if(anchor.prescriptionMode&&anchor.prescriptionMode!==mode||anchor.target&&(anchor.target.type==='timed'?'time':'reps')!==mode)add('prescription-mode-mismatch');
        exercise=anchorExercise(source,anchor,rx.prescriptionId);
        repeats=anchorRepeats(anchor,exercise);
        if(repeats==null)add('target-exposure-mismatch');
        protocols=permittedProtocols(rx,anchor).filter(protocol=>!['emom','ladder','pyramid','complex','density'].includes(protocol)&&GENERATED_PROTOCOLS.includes(protocol)&&protocolCompatible(source,protocol)&&(protocol!=='timed_intervals'||sideCount(exercise)===1&&anchor.prescriptionMode!=='reps'));
        if(!protocols.length)add('protocol-incompatible',{requirementIds:[anchor.requirementId,...prescriptionList(rx,'protocolConstraints').filter(item=>item.importance==='hard'&&constraintApplies(item,anchor)).map(item=>item.requirementId)]});
        // Main's family cap holds for Coach work too: a required anchor cannot be joined by
        // another member of a capped family (required anchors precede preferred ones).
        const rival=entries.find(other=>other.anchor.importance==='required'&&other.anchor.exerciseId!==anchor.exerciseId&&mainFamilyCapReached(source,[catalogue[other.anchor.exerciseId]]));
        if(rival)add('family-cap-conflict',{requirementIds:[anchor.requirementId,rival.anchor.requirementId],exerciseIds:[anchor.exerciseId,rival.anchor.exerciseId]});
      }
      entries.push({anchor,exercise,repeats,protocols,issues});
      (anchor.importance==='required'?assessment.hardConflicts:assessment.softConflicts).push(...issues);
    }
    const required=entries.filter(entry=>entry.anchor.importance==='required'),reserved=[],planned=new Set();
    // A dedicated rounds/interval block needs no filler. Paired-only anchors may share a
    // block with an equally prescribed required anchor, or an eligible optional partner.
    const candidatesFor=(entry,index,allowPair=true)=>{
      if(entry.issues.length)return [];
      const candidates=[];
      for(const protocol of entry.protocols){
        if(protocol!=='paired_sets')candidates.push({block:anchorBlock(protocol,[entry.exercise],entry.repeats,rest,index),entries:[entry]});
        else if(allowPair){
          const partner=required.find(other=>other!==entry&&!planned.has(other)&&!other.issues.length&&other.anchor.exerciseId!==entry.anchor.exerciseId&&other.repeats===entry.repeats&&other.protocols.includes(protocol));
          if(partner)candidates.push({block:anchorBlock(protocol,[entry.exercise,partner.exercise],entry.repeats,rest,index),entries:[entry,partner]});
          const generic=optionalEligible.filter(exercise=>!anchorIds.has(exercise.id)&&!mainFamilyCapReached(exercise,[entry.exercise])&&protocolCompatible(exercise,protocol)&&permittedProtocols(rx,null).includes(protocol)).sort((a,b)=>a.estimatedSeconds-b.estimatedSeconds||a.id.localeCompare(b.id))[0];
          if(generic)candidates.push({block:anchorBlock(protocol,[entry.exercise,generic],entry.repeats,rest,index),entries:[entry]});
        }
      }
      return candidates;
    };
    const simpleRank=protocol=>['rounds','paired_sets','timed_intervals'].indexOf(protocol);
    const reserve=(honourSoft,preferSimple)=>{
      planned.clear();const blocks=[],conflicts=[];
      for(const entry of required){
        if(planned.has(entry)||entry.issues.length)continue;
        let choices=candidatesFor(entry,blocks.length);
        if(honourSoft)choices=choices.filter(choice=>choice.entries.every(item=>permittedProtocols(rx,item.anchor,true).includes(choice.block.protocol))&&
          (choice.block.exercises.every(exercise=>exercise.coachAnchor)||permittedProtocols(rx,null,true).includes(choice.block.protocol)));
        choices.sort((a,b)=>(preferSimple?simpleRank(a.block.protocol)-simpleRank(b.block.protocol):0)||a.block.estimatedDurationSeconds/a.entries.length-b.block.estimatedDurationSeconds/b.entries.length);
        if(!choices.length){conflict(conflicts,'protocol-partner-unavailable',[entry.anchor.requirementId],[entry.anchor.exerciseId]);continue;}
        blocks.push(choices[0].block);choices[0].entries.forEach(item=>planned.add(item));
      }
      return {blocks,conflicts};
    };
    // Prefer comparable simple structures and honour soft protocol intent where it fits.
    // A faster explicitly permitted structure may rescue a hard duration requirement.
    const plans=[[true,true],[true,false],[false,true],[false,false]].map(([soft,simple])=>reserve(soft,simple));
    // With no optional partner, three or more paired-only anchors may need their dose split
    // across pairs (e.g. A/B, A/C, B/C for two sets each). Solve the remaining set counts,
    // rather than declaring the final unpaired anchor impossible after one greedy pairing.
    if(required.length>1&&required.every(entry=>!entry.issues.length&&entry.protocols.includes('paired_sets'))&&new Set(required.map(entry=>entry.anchor.exerciseId)).size===required.length){
      const remaining=required.map(entry=>({entry,count:entry.repeats})),pairs=[],conflicts=[];
      let total=remaining.reduce((sum,item)=>sum+item.count,0);
      if(total%2===0&&Math.max(...remaining.map(item=>item.count))<=total/2){
        while(total>0){
          remaining.sort((a,b)=>b.count-a.count||a.entry.anchor.requirementId.localeCompare(b.entry.anchor.requirementId));
          const first=remaining[0],second=remaining[1],otherMax=remaining[2]?remaining[2].count:0;
          const dose=Math.min(first.count,second.count,total/2-otherMax);
          if(dose<=0)break;
          pairs.push(anchorBlock('paired_sets',[first.entry.exercise,second.entry.exercise],dose,rest,pairs.length));
          first.count-=dose;second.count-=dose;total-=dose*2;
        }
        if(total===0)plans.push({blocks:pairs,conflicts});
      }
    }
    const plan=plans.find(item=>!item.conflicts.length&&mainSeconds(item.blocks)<=budget.main)||plans.filter(item=>!item.conflicts.length).sort((a,b)=>mainSeconds(a.blocks)-mainSeconds(b.blocks))[0]||plans[3];
    reserved.push(...plan.blocks);assessment.hardConflicts.push(...plan.conflicts);
    if(mainSeconds(reserved)>budget.main)conflict(assessment.hardConflicts,'insufficient-main-time',required.map(entry=>entry.anchor.requirementId),required.map(entry=>entry.anchor.exerciseId),{requiredSeconds:mainSeconds(reserved),availableSeconds:budget.main});
    const genericProtocols=permittedProtocols(rx,null);
    const minimumMain=minimumOptionalBlock(optionalEligible,genericProtocols,rest,context.focus);
    if(!reserved.length&&!minimumMain)conflict(assessment.hardConflicts,'no-eligible-main',hardAvoids.concat(prescriptionList(rx,'protocolConstraints').filter(item=>item.importance==='hard'&&!item.anchorRequirementId)).map(item=>item.requirementId));
    else if(!reserved.length&&minimumMain.estimatedDurationSeconds>budget.main)conflict(assessment.hardConflicts,'insufficient-main-time',[],minimumMain.exercises.map(exercise=>exercise.id),{requiredSeconds:minimumMain.estimatedDurationSeconds,availableSeconds:budget.main});
    const preferred=[];
    for(const entry of entries.filter(entry=>entry.anchor.importance==='preferred')){
      const choices=candidatesFor(entry,reserved.length,false);
      // Preferred paired sets can use an optional partner too; never absorb required work.
      if(entry.protocols.includes('paired_sets')&&!entry.issues.length){
        const partner=optionalEligible.filter(exercise=>!anchorIds.has(exercise.id)&&!mainFamilyCapReached(exercise,[entry.exercise])&&protocolCompatible(exercise,'paired_sets')&&genericProtocols.includes('paired_sets')).sort((a,b)=>a.estimatedSeconds-b.estimatedSeconds||a.id.localeCompare(b.id))[0];
        if(partner)choices.push({block:anchorBlock('paired_sets',[entry.exercise,partner],entry.repeats,rest,reserved.length),entries:[entry]});
      }
      choices.sort((a,b)=>Number(!permittedProtocols(rx,entry.anchor,true).includes(a.block.protocol))-Number(!permittedProtocols(rx,entry.anchor,true).includes(b.block.protocol))||simpleRank(a.block.protocol)-simpleRank(b.block.protocol)||a.block.estimatedDurationSeconds-b.block.estimatedDurationSeconds);
      const choice=choices.find(item=>mainSeconds(reserved.concat(item.block))<=budget.main)||choices[0];
      const block=choice&&choice.block;
      if(!entry.issues.length&&!block)conflict(assessment.softConflicts,'protocol-partner-unavailable',[entry.anchor.requirementId],[entry.anchor.exerciseId]);
      else if(block&&mainSeconds(reserved.concat(block))>budget.main)conflict(assessment.softConflicts,'preferred-time-budget',[entry.anchor.requirementId],[entry.anchor.exerciseId]);
      else if(block)preferred.push({entry,block});
    }
    if(mainSeconds(reserved.concat(preferred.map(item=>item.block)))>budget.main)conflict(assessment.softConflicts,'soft-time-budget',preferred.map(item=>item.entry.anchor.requirementId),preferred.map(item=>item.entry.anchor.exerciseId));
    for(const priority of prescriptionList(rx,'movementPriorities').concat(prescriptionList(rx,'bodyRegionPriorities'))){
      const matches=exercise=>priority.pattern?(exercise.patterns||[]).includes(priority.pattern):exercise.bodyFocus===priority.bodyRegion;
      const possible=optionalEligible.filter(exercise=>matches(exercise)&&genericProtocols.some(protocol=>protocolCompatible(exercise,protocol)));
      const covered=reserved.some(block=>block.exercises.some(matches));
      if(!covered&&(!possible.length||mainSeconds(reserved)+BLOCK_TRANSITION_SECONDS+Math.min(...possible.map(exercise=>exercise.estimatedSeconds))>budget.main))conflict(assessment.softConflicts,'priority-unavailable',[priority.requirementId],possible.map(exercise=>exercise.id));
    }
    for(const constraint of prescriptionList(rx,'avoidConstraints').filter(item=>item.importance==='soft')){
      const matches=reserved.flatMap(block=>block.exercises).filter(exercise=>avoidMatches(exercise,constraint));
      if(matches.length)conflict(assessment.softConflicts,'soft-avoid-required-work',[constraint.requirementId],matches.map(exercise=>exercise.id));
      else if(!reserved.length&&optionalEligible.length&&!optionalEligible.some(exercise=>!avoidMatches(exercise,constraint)&&genericProtocols.some(protocol=>protocolCompatible(exercise,protocol))))conflict(assessment.softConflicts,'soft-avoid-unavoidable',[constraint.requirementId],eligible.map(exercise=>exercise.id));
    }
    for(const constraint of prescriptionList(rx,'protocolConstraints').filter(item=>item.importance==='soft')){
      const blocks=reserved.filter(block=>!constraint.anchorRequirementId||block.exercises.some(exercise=>exercise.coachAnchor&&exercise.coachAnchor.requirementId===constraint.anchorRequirementId));
      if(blocks.some(block=>!constraint.allowedProtocols.includes(block.protocol))||!constraint.anchorRequirementId&&!minimumOptionalBlock(optionalEligible,genericProtocols.filter(protocol=>constraint.allowedProtocols.includes(protocol)),rest,context.focus))conflict(assessment.softConflicts,'soft-protocol-conflict',[constraint.requirementId],blocks.flatMap(block=>block.exercises.map(exercise=>exercise.id)));
    }
    if(rx.variationPreference){
      const recent=new Set(recentExerciseIds(context.history)),repeated=reserved.flatMap(block=>block.exercises).filter(exercise=>recent.has(exercise.id));
      if(rx.variationPreference==='familiar'&&!eligible.some(exercise=>recent.has(exercise.id))||rx.variationPreference==='varied'&&(repeated.length||!eligible.some(exercise=>!recent.has(exercise.id))))conflict(assessment.softConflicts,'variation-preference-unavailable',[],repeated.map(exercise=>exercise.id));
    }
    assessment.softRelaxations=jsonCopy(assessment.softConflicts);
    assessment.status=assessment.hardConflicts.length?'infeasible':assessment.softConflicts.length?'partially-feasible':'feasible';
    assessment.availableMainSeconds=budget.main;
    assessment.requiredMainSeconds=mainSeconds(reserved);
    return {assessment,context,rx,catalogue,selectionCatalogue:Object.fromEntries(available.map(exercise=>[exercise.id,exercise])),eligible,reserved,preferred,budget,rest};
  }
  function assessSessionPrescription(options) {
    return prepareSessionPrescription(options).assessment;
  }

  // Explicit candidate entry point; automatic composition shares the selector and fitter.
  // availableSeconds is the
  // total Main budget, including preceding blocks and the normal external transition.
  // Coach reserves exact required work first; EMOM can only supply permitted optional work.
  function buildEmomBlock(options={}) {
    let context=options,preceding=options.blocks||[],rx=options.sessionPrescription;
    let available=options.availableSeconds,prepared;
    if(!Number.isFinite(available)||available<60)return null;
    if(rx){
      prepared=prepareSessionPrescription(options);
      if(prepared.assessment.status==='infeasible')return null;
      context=prepared.context;
      preceding=options.blocks||prepared.reserved;
      available=Math.min(available,prepared.budget.main);
      if(prescriptionList(rx,'protocolConstraints').some(item=>item.importance==='hard'&&!item.anchorRequirementId&&!item.allowedProtocols.includes('emom')))return null;
    }
    const catalogue=context.catalogue||{},owned=context.equipment||[],difficulty=workoutDifficulty(context.difficulty);
    if(preceding.length&&validateMain({blocks:preceding},catalogue,owned).length)return null;
    if(rx){
      // A caller-supplied prefix must retain every reserved required occurrence unchanged.
      const requiredPrefix=preceding.filter(block=>block.exercises.some(ex=>ex.coachAnchor&&ex.coachAnchor.importance==='required'));
      if(requiredPrefix.length!==prepared.reserved.length||prepared.reserved.some(required=>!requiredPrefix.some(block=>root.GarageFitCoachModel.sameRecord(block,required))))return null;
      if(preceding.some(block=>block.exercises.some(ex=>!ex.coachAnchor&&!optionalMainAllowed(ex,rx))
        ||prescriptionList(rx,'protocolConstraints').some(item=>item.importance==='hard'
        &&(!item.anchorRequirementId||block.exercises.some(ex=>ex.coachAnchor&&ex.coachAnchor.requirementId===item.anchorRequirementId))
        &&!item.allowedProtocols.includes(block.protocol))||block.exercises.some(ex=>prescriptionList(rx,'avoidConstraints').some(item=>item.importance==='hard'&&avoidMatches(catalogue[ex.id],item)))))return null;
    }
    const remaining=available-mainSeconds(preceding)-(preceding.length?BLOCK_TRANSITION_SECONDS:0);
    const minutes=Math.min(EMOM_POLICY.maxMinutes,Math.floor(remaining/60));
    if(minutes<1)return null;
    const anchorIds=new Set(rx?prescriptionList(rx,'requiredAnchors').concat(prescriptionList(rx,'preferredAnchors')).map(anchor=>anchor.exerciseId):[]);
    const eligible=Object.values(catalogue).filter(exercise=>generatedPhaseEligible(exercise,'main',owned,difficulty)
      &&emomExerciseEligible(exercise)&&!anchorIds.has(exercise.id)&&optionalMainAllowed(exercise,rx)
      &&!(rx&&prescriptionList(rx,'avoidConstraints').some(item=>item.importance==='hard'&&avoidMatches(exercise,item))))
      .sort((a,b)=>a.id.localeCompare(b.id));
    const prior=preceding.flatMap(block=>block.exercises),state={blocks:preceding,exercises:prior,usedIds:new Set(prior.map(ex=>ex.id)),
      owned,difficulty,bodyFocus:workoutBodyFocus(context.bodyFocus),sessionPrescription:rx};
    const exercises=selectBlockExercises(eligible,Math.min(minutes,EMOM_POLICY.maxExercises),context.focus||'balanced',options.intent||'conditioning',
      'emom',state,options.history||[],options.random||(()=>0),catalogue).map(copyExercise);
    if(!exercises.length)return null;
    const block=finishMainBlock({id:'main-'+(preceding.length+1),protocol:'emom',intent:options.intent||'conditioning',exercises,
      prescription:{minutes,slotSeconds:60,targets:exercises.map(exercise=>({...exercise.prescription}))}});
    return validateMain({blocks:preceding.concat(block)},catalogue,owned).length?null:block;
  }

  function prescriptionState(blocks, prepared, history) {
    const exercises=blocks.flatMap(block=>block.exercises);
    return {blocks,exercises,usedIds:new Set(exercises.map(exercise=>exercise.id)),equipmentUsage:equipmentUsageSeconds(blocks),
      owned:prepared.context.equipment,diversityTarget:EQUIPMENT_DIVERSITY[prepared.context.duration]||EQUIPMENT_DIVERSITY[20],
      supportingRoute:false,duration:prepared.context.duration,difficulty:prepared.context.difficulty,bodyFocus:prepared.context.bodyFocus,sessionPrescription:prepared.rx,history,recentProtocols:prepared.context.recentProtocols};
  }
  function composePrescribedMain(prepared, random, history) {
    const {rx,context,catalogue,eligible,budget,rest}=prepared,blocks=jsonCopy(prepared.reserved);
    const anchorIds=new Set(prescriptionList(rx,'requiredAnchors').concat(prescriptionList(rx,'preferredAnchors')).map(anchor=>anchor.exerciseId));
    const hardProtocols=permittedProtocols(rx,null),softProtocols=permittedProtocols(rx,null,true);
    const generic=eligible.filter(exercise=>optionalMainAllowed(exercise,rx)&&!anchorIds.has(exercise.id)&&hardProtocols.some(protocol=>protocolCompatible(exercise,protocol)));
    // Preferred anchors take a bounded scoring advantage in a normal random shortlist.
    // Only after winning that optional selection do their exact targets reserve time.
    for(const {entry,block} of prepared.preferred){
      if(mainSeconds(blocks.concat(block))>budget.main)continue;
      if(block.exercises.some(exercise=>mainFamilyCapReached(exercise,blocks.flatMap(item=>item.exercises))))continue;
      const state=prescriptionState(blocks,prepared,history),desired=(RECIPES[context.focus]||RECIPES.balanced)[state.exercises.length%(RECIPES[context.focus]||RECIPES.balanced).length];
      const scored=[entry.exercise,...generic.filter(exercise=>!mainFamilyCapReached(exercise,state.exercises))].map(exercise=>({exercise,score:scoreCandidate(exercise,desired,state.exercises,context.focus,history,catalogue)+sessionPriorityCredit(exercise,rx,history,catalogue)+(exercise===entry.exercise?28:0)}));
      const selected=controlledPick(scored,random,SHORTLIST_MARGIN);
      if(selected&&selected.id===entry.exercise.id){block.id='main-'+(blocks.length+1);blocks.push(jsonCopy(block));}
    }
    const reserved=blocks.slice(),attempts=[];
    const protectedIds=new Set(reserved.flatMap(block=>block.exercises.filter(exercise=>exercise.coachAnchor).map(exercise=>exercise.id)));
    const requiredIds=new Set(prescriptionList(rx,'requiredAnchors').map(anchor=>anchor.exerciseId));
    // If a preferred target is missed, its catalogue exercise remains optional. Selecting
    // that ordinary dose cannot be reported as satisfying the preferred anchor target.
    const optional=eligible.filter(exercise=>optionalMainAllowed(exercise,rx)&&!requiredIds.has(exercise.id)&&!protectedIds.has(exercise.id)&&hardProtocols.some(protocol=>protocolCompatible(exercise,protocol)));
    for(let attempt=0;attempt<10;attempt++){
      const state=prescriptionState(jsonCopy(reserved),prepared,history);
      let remaining=budget.main-mainSeconds(state.blocks)-(state.blocks.length?BLOCK_TRANSITION_SECONDS:0);
      if(optional.length&&remaining>0){
        const count=chooseBlockCount(context.duration,optional.length,random),intents=chooseIntents(context.focus,count,random);
        for(let index=0;index<count&&remaining>0;index++){
          const target=Math.max(1,Math.floor((remaining-BLOCK_TRANSITION_SECONDS*(count-index-1))/(count-index)));
          const viable=protocol=>hardProtocols.includes(protocol)
            &&(protocol!=='ladder'||!state.blocks.some(block=>block.protocol==='ladder'))
            &&(protocol!=='pyramid'||!state.blocks.some(block=>block.protocol==='pyramid'))
            &&(protocol!=='density'||!state.blocks.some(block=>block.protocol==='density')&&densityPairAvailable(optional))
            &&(protocol!=='complex'||!state.blocks.some(block=>block.protocol==='complex')&&complexPairAvailable(optional))
            &&optional.filter(exercise=>protocolCompatible(exercise,protocol)).length>=(['paired_sets','complex','density'].includes(protocol)?2:1);
          let protocols=softProtocols.filter(viable);if(!protocols.length)protocols=hardProtocols.filter(viable);
          if(!protocols.length)break;
          const weights=protocolWeights(context.focus,intents[index],target,optional,state).filter(item=>protocols.includes(item.value));
          let protocol=weightedPick(weights,random);
          // Soft preferences can relax when no practical block fits this share.
          if(!protocol&&protocols.every(item=>item==='emom')){protocols=hardProtocols.filter(viable);protocol=weightedPick(protocolWeights(context.focus,intents[index],target,optional,state).filter(item=>protocols.includes(item.value)),random);}
          protocol=protocol||protocols.find(item=>item!=='emom');
          if(!protocol)break;
          let block=buildMainBlock(optional,state.blocks.length,protocol,intents[index],target,context.focus,rest,state,history,random,catalogue);
          // Constrained optional pools may defeat the generic block/variety route. Its
          // fallback selects only unconstrained work; reserved anchors remain in state.
          if(!block){
            const fallbackProtocol=protocols.find(item=>item!=='paired_sets')||protocols[0];
            const pairs=['paired_sets','complex','density'].includes(fallbackProtocol);
            const exercises=selectBlockExercises(optional,pairs?2:1,context.focus,intents[index],fallbackProtocol,state,history,random,catalogue);
            if(exercises.length&&(!pairs||exercises.length===2)&&fallbackProtocol!=='emom'){
              const fitted=chooseClosestPrescription(fallbackProtocol,exercises,target,rest,context.focus,{allowExtendedRepetition:true});
              if(fitted)block=finishMainBlock({id:'main-'+(state.blocks.length+1),protocol:fallbackProtocol,intent:intents[index],exercises:exercises.map(copyExercise),prescription:fitted.prescription});
            }
          }
          if(!block)break;
          // Optional dose may shrink; required/preferred target blocks are never refitted.
          const key=PROTOCOL_SHAPES[block.protocol].repeatKey;
          while(!['ladder','pyramid','complex','density'].includes(block.protocol)&&block.estimatedDurationSeconds>remaining&&block.prescription[key]>(block.protocol==='emom'?Math.max(3,block.exercises.length):1)){block.prescription[key]--;finishMainBlock(block);}
          if(block.estimatedDurationSeconds>remaining)break;
          state.blocks.push(block);state.exercises.push(...block.exercises);
          block.exercises.forEach(exercise=>state.usedIds.add(exercise.id));state.equipmentUsage=equipmentUsageSeconds(state.blocks);
          remaining-=block.estimatedDurationSeconds+BLOCK_TRANSITION_SECONDS;
        }
      }
      if(!state.blocks.length)continue;
      const issues=validateMain({blocks:state.blocks},catalogue,context.equipment);
      if(issues.length)continue;
      const varietyCredit=protocolVarietyCredit(state.blocks,budget.main);
      const fitness=Math.abs(mainSeconds(state.blocks)-budget.main)+mainQualityPenalty(state.blocks,budget.main,eligible.length)-varietyCredit;
      attempts.push({blocks:state.blocks,fitness});
    }
    attempts.sort((a,b)=>a.fitness-b.fitness);
    let chosen=attempts[0];
    if(!chosen&&!reserved.length){
      const fallback=minimumOptionalBlock(optional,hardProtocols,rest,context.focus);
      if(fallback&&fallback.estimatedDurationSeconds<=budget.main)chosen={blocks:[fallback]};
    }
    if(!chosen){
      const assessment=jsonCopy(prepared.assessment);
      assessment.status='infeasible';assessment.hardConflicts.push({code:'composition-impossible',requirementIds:prescriptionList(rx,'requiredAnchors').map(anchor=>anchor.requirementId),exerciseIds:[]});
      throw new SessionPrescriptionError(assessment);
    }
    return {blocks:chosen.blocks,transitionSeconds:BLOCK_TRANSITION_SECONDS,estimatedDurationSeconds:mainSeconds(chosen.blocks)};
  }

  function reconcileSessionPrescription(workout, rx, assessment) {
    const blocks=mainBlocks(workout),mainExercises=blocks.flatMap(block=>block.exercises);
    const allExercises=mainExercises.concat(...['warmup','rampup','cooldown'].map(section=>workout[section].exercises));
    if(mainExercises.some(exercise=>!exercise.coachAnchor&&!optionalMainAllowed(exercise,rx)))
      throw new SessionPrescriptionError({...assessment,status:'infeasible',hardConflicts:[{code:'optional-main-pool-conflict',requirementIds:[],exerciseIds:mainExercises.filter(exercise=>!exercise.coachAnchor&&!optionalMainAllowed(exercise,rx)).map(exercise=>exercise.id)}]});
    const placements=[];
    if(rx.mainTimeLimitSeconds!=null&&workout.main.estimatedDurationSeconds>rx.mainTimeLimitSeconds)hardTimingConflict('main-time-limit-exceeded',workout.main.estimatedDurationSeconds,rx.mainTimeLimitSeconds);
    if(rx.maximumDurationSeconds!=null&&workout.estimatedSeconds>rx.maximumDurationSeconds)hardTimingConflict('maximum-duration-exceeded',workout.estimatedSeconds,rx.maximumDurationSeconds);
    function hardTimingConflict(code,actualSeconds,maximumSeconds) {
      throw new SessionPrescriptionError({...assessment,status:'infeasible',hardConflicts:[{code,actualSeconds,maximumSeconds,
        requirementIds:prescriptionList(rx,'requiredAnchors').map(anchor=>anchor.requirementId),exerciseIds:[]}]});
    }
    blocks.forEach((block,blockIndex)=>block.exercises.forEach((exercise,exerciseIndex)=>{
      if(!exercise.coachAnchor)return;
      placements.push({requirementId:exercise.coachAnchor.requirementId,exerciseId:exercise.id,importance:exercise.coachAnchor.importance,
        blockId:block.id,blockIndex,exerciseIndex,protocol:block.protocol,expectedSetCount:blockRepeatCount(block),
        expectedExposureCount:blockRepeatCount(block)*(block.protocol==='timed_intervals'?1:sideCount(exercise))});
    }));
    const requiredAnchorPlacements=placements.filter(placement=>placement.importance==='required');
    const hardConflicts=[],satisfiedHardRequirementIds=[],softRelaxations=[];
    const relax=(code,requirementIds,exerciseIds=[])=>{if(!softRelaxations.some(item=>item.code===code&&item.requirementIds.join()===requirementIds.join()))softRelaxations.push({code,requirementIds,exerciseIds});};
    for(const anchor of prescriptionList(rx,'requiredAnchors')){
      const linked=requiredAnchorPlacements.filter(item=>item.requirementId===anchor.requirementId&&item.exerciseId===anchor.exerciseId);
      if(!linked.length||anchor.targetSets!=null&&linked.reduce((sum,item)=>sum+item.expectedSetCount,0)!==anchor.targetSets||anchor.targetExposures!=null&&linked.reduce((sum,item)=>sum+item.expectedExposureCount,0)!==anchor.targetExposures||linked.some(item=>!permittedProtocols(rx,anchor).includes(item.protocol)))hardConflicts.push({code:'required-placement-mismatch',requirementIds:[anchor.requirementId],exerciseIds:[anchor.exerciseId]});
      else satisfiedHardRequirementIds.push(anchor.requirementId);
    }
    const preferredSatisfied=[],preferredMissed=[];
    for(const anchor of prescriptionList(rx,'preferredAnchors')){
      if(placements.some(placement=>placement.importance==='preferred'&&placement.requirementId===anchor.requirementId))preferredSatisfied.push(anchor.requirementId);
      else{
        preferredMissed.push(anchor.requirementId);
        const reason=assessment.softConflicts.find(item=>item.requirementIds.includes(anchor.requirementId));
        relax(reason?reason.code:'preferred-not-selected',[anchor.requirementId],[anchor.exerciseId]);
      }
    }
    const prioritiesSatisfied=[],prioritiesMissed=[];
    for(const priority of prescriptionList(rx,'movementPriorities').concat(prescriptionList(rx,'bodyRegionPriorities'))){
      const satisfied=mainExercises.some(exercise=>priority.pattern?(exercise.patterns||[]).includes(priority.pattern):exercise.bodyFocus===priority.bodyRegion);
      (satisfied?prioritiesSatisfied:prioritiesMissed).push(priority.requirementId);
      if(!satisfied)relax('priority-not-covered',[priority.requirementId]);
    }
    for(const constraint of prescriptionList(rx,'avoidConstraints')){
      const matches=allExercises.filter(exercise=>avoidMatches(exercise,constraint));
      if(matches.length){
        if(constraint.importance==='hard')hardConflicts.push({code:'hard-avoid-conflict',requirementIds:[constraint.requirementId],exerciseIds:matches.map(exercise=>exercise.id)});
        else relax('soft-avoid-selected',[constraint.requirementId],matches.map(exercise=>exercise.id));
      }else if(constraint.importance==='hard')satisfiedHardRequirementIds.push(constraint.requirementId);
    }
    for(const constraint of prescriptionList(rx,'protocolConstraints')){
      const relevant=blocks.filter(block=>!constraint.anchorRequirementId||block.exercises.some(exercise=>exercise.coachAnchor&&exercise.coachAnchor.requirementId===constraint.anchorRequirementId));
      const incompatible=relevant.filter(block=>!constraint.allowedProtocols.includes(block.protocol));
      if(incompatible.length){
        if(constraint.importance==='hard')hardConflicts.push({code:'protocol-incompatible',requirementIds:[constraint.requirementId],exerciseIds:incompatible.flatMap(block=>block.exercises.map(exercise=>exercise.id))});
        else relax('soft-protocol-relaxed',[constraint.requirementId],incompatible.flatMap(block=>block.exercises.map(exercise=>exercise.id)));
      }else if(constraint.importance==='hard')satisfiedHardRequirementIds.push(constraint.requirementId);
    }
    if(hardConflicts.length)throw new SessionPrescriptionError({...assessment,status:'infeasible',hardConflicts});
    const warnings=[];
    let variationPreference=null;
    if(rx.variationPreference){
      const recent=new Set(workout.prescriptionContext.recentExerciseIds),familiar=mainExercises.filter(exercise=>recent.has(exercise.id));
      const satisfied=rx.variationPreference==='familiar'?familiar.length>0:familiar.length===0;
      variationPreference={requested:rx.variationPreference,status:satisfied?'satisfied':'relaxed'};
      if(!satisfied)relax('variation-preference-relaxed',[],familiar.map(exercise=>exercise.id));
    }
    if(workout.main.estimatedDurationSeconds<assessment.availableMainSeconds*.62)warnings.push({code:'main-underfilled',plannedSeconds:workout.main.estimatedDurationSeconds,availableSeconds:assessment.availableMainSeconds});
    return {prescriptionId:rx.prescriptionId,status:softRelaxations.length?'partially-feasible':'feasible',satisfiedHardRequirementIds,requiredAnchorPlacements,
      preferredSatisfied,preferredMissed,preferredAnchorPlacements:placements.filter(placement=>placement.importance==='preferred'),prioritiesSatisfied,prioritiesMissed,variationPreference,softRelaxations,warnings};
  }
  function generatePrescribedWorkout(options) {
    const prepared=prepareSessionPrescription(options),{assessment,context,rx}=prepared;
    if(assessment.status==='infeasible')throw new SessionPrescriptionError(assessment);
    const hasRequirements=['requiredAnchors','preferredAnchors','movementPriorities','bodyRegionPriorities','avoidConstraints','protocolConstraints'].some(key=>prescriptionList(rx,key).length)||rx.optionalMainExerciseIds!=null||rx.variationPreference||rx.mainTimeLimitSeconds!=null||rx.maximumDurationSeconds!=null;
    // An empty prescription can use the exact ordinary flow, including its RNG consumption.
    if(!hasRequirements){
      const workout=generateWorkout(context);
      workout.prescriptionOutcome=reconcileSessionPrescription(workout,rx,assessment);return workout;
    }
    const {catalogue,selectionCatalogue,budget}=prepared,random=context.random||Math.random,history=context.history||[];
    const main=composePrescribedMain(prepared,random,history),mainExercises=main.blocks.flatMap(block=>block.exercises);
    const preparation=buildPreparation(selectionCatalogue,budget,context.equipment,main.blocks[0].exercises,context.focus,random,mainExercises,context.difficulty);
    const cooldown=buildSection(selectionCatalogue,'cooldown',budget.cooldown,context.equipment,random);
    const workout={schemaVersion:2,id:'generated-'+Date.now(),duration:context.duration,focus:context.focus,bodyFocus:context.bodyFocus,difficulty:context.difficulty,
      estimatedSeconds:preparation.warmup.estimatedSeconds+preparation.rampup.estimatedSeconds+main.estimatedDurationSeconds+cooldown.estimatedSeconds,
      warmup:{...preparation.warmup,exercises:preparation.warmup.exercises.map(copyExercise)},
      rampup:{...preparation.rampup,exercises:preparation.rampup.exercises.map(copyExercise)},main,
      cooldown:{...cooldown,exercises:cooldown.exercises.map(copyExercise)}};
    workout.blocks=workout.main.blocks;
    const issues=validateMain(main,catalogue,context.equipment);
    if(issues.length)throw new SessionPrescriptionError({...assessment,status:'infeasible',hardConflicts:[{code:'invalid-main',requirementIds:[],exerciseIds:[],issues}]});
    if(rx.variationPreference)workout.prescriptionContext={recentExerciseIds:recentExerciseIds(history)};
    workout.prescriptionOutcome=reconcileSessionPrescription(workout,rx,assessment);
    // Keep only this session's bounded request for safe generic swaps and reconciliation.
    // Never embed programmeContext or a full Programme State in the generated workout.
    const request=Object.fromEntries(Object.entries(rx).filter(([key])=>key!=='programmeContext'));
    workout.sessionPrescription=jsonCopy(request);
    return workout;
  }
  function refreshPrescriptionOutcome(workout) {
    if(!workout.sessionPrescription)return;
    workout.prescriptionOutcome=reconcileSessionPrescription(workout,workout.sessionPrescription,{softConflicts:[],availableMainSeconds:prescriptionBudget(workout.sessionPrescription,workout.duration).main});
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
    if(options.sessionPrescription!=null)return generatePrescribedWorkout(options);
    const catalogue=options.catalogue;
    const duration=Number(options.duration);
    const focus=String(options.focus||'balanced').toLowerCase();
    const difficulty=workoutDifficulty(options.difficulty);
    const bodyFocus=workoutBodyFocus(options.bodyFocus);
    const owned=options.equipment||[],history=options.history||[],random=options.random||Math.random;
    const budget=BUDGETS[duration]||BUDGETS[20],rest=RESTS[focus]||RESTS.balanced;
    assertValidCatalogue(catalogue);
    const eligible=Object.values(catalogue).filter(exercise=>generatedPhaseEligible(exercise,'main',owned,difficulty));
    if(!eligible.length)throw new Error('No eligible exercises available.');
    const main=composeMain(catalogue,eligible,budget,duration,focus,owned,history,rest,random,difficulty,bodyFocus,options.recentProtocols);
    const firstMain=main.blocks[0].exercises;
    const preparation=buildPreparation(catalogue,budget,owned,firstMain,focus,random,main.blocks.flatMap(block=>block.exercises),difficulty);
    const cooldown=buildSection(catalogue,'cooldown',budget.cooldown,owned,random);
    const estimatedSeconds=preparation.warmup.estimatedSeconds+preparation.rampup.estimatedSeconds+main.estimatedDurationSeconds+cooldown.estimatedSeconds;
    const workout={
      schemaVersion:2,id:'generated-'+Date.now(),duration,focus,bodyFocus,difficulty,estimatedSeconds,
      warmup:{estimatedSeconds:preparation.warmup.estimatedSeconds,restSeconds:preparation.warmup.restSeconds,exercises:preparation.warmup.exercises.map(copyExercise),
        ...(preparation.warmup.diagnostics?{diagnostics:preparation.warmup.diagnostics.slice()}:{})},
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
    const placement=workout.prescriptionOutcome&&workout.prescriptionOutcome.requiredAnchorPlacements.find(item=>item.blockIndex===(blockIndex||0)&&item.exerciseIndex===exerciseIndex);
    const anchor=(mainBlocks(workout)[blockIndex||0]||{exercises:[]}).exercises[exerciseIndex];
    if(placement||anchor&&anchor.coachAnchor&&anchor.coachAnchor.importance==='required'){
      const error=new Error('Required Coach anchor cannot be replaced by a generic swap.');
      error.code='required-anchor-swap';error.requirementId=placement?placement.requirementId:anchor.coachAnchor.requirementId;
      error.exerciseId=placement?placement.exerciseId:anchor.id;throw error;
    }
    options=options||{};normaliseWorkout(workout);
    const catalogue=options.catalogue,owned=options.equipment||[],random=options.random||Math.random;
    const blocks=mainBlocks(workout),block=blocks[blockIndex||0],current=block&&block.exercises[exerciseIndex];
    if(!block||!current)return workout;
    const otherExercises=blocks.flatMap((item,bIndex)=>item.exercises.filter((_,eIndex)=>bIndex!==(blockIndex||0)||eIndex!==exerciseIndex));
    const otherIds=new Set(otherExercises.map(exercise=>exercise.id));
    // A swap keeps the workout's difficulty (its Main eligibility and score preference) and body focus.
    const difficulty=workoutDifficulty(workout.difficulty);
    const bodyFocus=workoutBodyFocus(workout.bodyFocus);
    let eligible=Object.values(catalogue).filter(exercise=>generatedPhaseEligible(exercise,'main',owned,difficulty)&&protocolCompatible(exercise,block.protocol)&&exercise.id!==current.id&&!mainFamilyCapReached(exercise,otherExercises));
    // The whole block after the swap. A complex movement takes its own default target;
    // the sequence count, changeover and recovery stay as planned.
    const replaced=exercise=>({...block,exercises:block.exercises.map((item,index)=>index===exerciseIndex?exercise:item),
      ...(block.protocol==='complex'?{prescription:{...block.prescription,targets:block.prescription.targets.map((target,index)=>index===exerciseIndex?complexDefaultTarget(exercise):target)}}:{})});
    if(block.protocol==='emom')eligible=eligible.filter(exercise=>!validateEmomBlock(replaced(exercise),catalogue).length);
    if(['ladder','pyramid','complex','density'].includes(block.protocol))eligible=eligible.filter(exercise=>{
      const replacement=replaced(exercise);
      return !({ladder:validateLadderBlock,pyramid:validatePyramidBlock,complex:validateComplexBlock,density:validateDensityBlock}[block.protocol])(replacement,catalogue).length
        &&mainSeconds(blocks)-estimateBlockDuration(block)+estimateBlockDuration(replacement)<=(BUDGETS[workout.duration]||BUDGETS[20]).main;
    });
    if(block.occurrenceTargets)eligible=eligible.filter(exercise=>!validateOccurrenceTargets(replaced(exercise),catalogue).length);
    if(workout.sessionPrescription){
      const rx=workout.sessionPrescription,budget=prescriptionBudget(rx,workout.duration);
      eligible=eligible.filter(exercise=>optionalMainAllowed(exercise,rx)&&!prescriptionList(rx,'avoidConstraints').some(item=>item.importance==='hard'&&avoidMatches(exercise,item))&&
        !prescriptionList(rx,'requiredAnchors').some(item=>item.exerciseId===exercise.id)&&
        mainSeconds(blocks)-estimateBlockDuration(block)+estimateBlockDuration(replaced(exercise))<=budget.main
        && (rx.maximumDurationSeconds==null || workout.estimatedSeconds-estimateBlockDuration(block)
          +estimateBlockDuration(replaced(exercise))<=rx.maximumDurationSeconds));
    }
    const fresh=eligible.filter(exercise=>!otherIds.has(exercise.id));if(fresh.length)eligible=fresh;
    // The swapped slot's neighbours in Main order, for the body-focus run limit.
    const mainOrder=blocks.flatMap(item=>item.exercises),position=blocks.slice(0,blockIndex||0).reduce((sum,item)=>sum+item.exercises.length,0)+exerciseIndex;
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
      else score+=difficultyCredit(exercise,difficulty)+bodyFocusCredit(exercise,bodyFocus,mainOrder.slice(0,position),mainOrder.slice(position+1));
      return {exercise,score};
    });
    const replacement=controlledPick(scored,random,SHORTLIST_MARGIN);if(!replacement)return workout;
    block.exercises[exerciseIndex]=copyExercise(replacement);
    if(block.protocol==='complex')block.prescription.targets[exerciseIndex]=complexDefaultTarget(replacement);
    block.estimatedDurationSeconds=estimateBlockDuration(block);block.estimatedSeconds=block.estimatedDurationSeconds;
    recalcWorkoutEstimate(workout);
    refreshPrescriptionOutcome(workout);return workout;
  }

  function swapPreparation(workout, section, exerciseIndex, options) {
    if(!['warmup','rampup'].includes(section)||!workout[section]) return workout;
    const catalogue=options.catalogue, owned=options.equipment||[], random=options.random||Math.random, current=workout[section].exercises[exerciseIndex], main=workout.blocks[0].exercises;
    const otherPrep=workout.warmup.exercises.concat(workout.rampup.exercises).filter(ex=>ex!==current);
    let eligible=Object.values(catalogue).filter(ex=>ex[section]&&preparationMetadataValid(ex)&&requirementsMet(ex,owned)&&ex.id!==current.id&&!otherPrep.some(item=>item.id===ex.id));
    eligible=preferNonDuplicates(eligible,otherPrep);
    if(section==='warmup') eligible=eligible.filter(ex=>ex.impact!=='high');
    if(section==='rampup') eligible=eligible.filter(ex=>ex.prepFatigue<=3&&ex.prepComplexity<=3&&!difficultyExcluded(ex,workoutDifficulty(workout.difficulty)));
    if(workout.sessionPrescription)eligible=eligible.filter(ex=>!prescriptionList(workout.sessionPrescription,'avoidConstraints').some(item=>item.importance==='hard'&&avoidMatches(ex,item)));
    if(workout.sessionPrescription&&workout.sessionPrescription.maximumDurationSeconds!=null)eligible=eligible.filter(ex=>
      workout.estimatedSeconds-current.estimatedSeconds+roundToFive(current.estimatedSeconds/sideCount(ex))*sideCount(ex)<=workout.sessionPrescription.maximumDurationSeconds);
    if(section==='warmup') {
      // A swap must not undo the warm-up's lower-body coverage or tip it into upper/trunk skew.
      const others=workout.warmup.exercises.filter((_,index)=>index!==exerciseIndex), count=workout.warmup.exercises.length;
      // Essential knee mobility is a hard obligation: its only holder is replaced by another
      // qualifier or kept.
      if (kneeMobilityQualified(current) && !others.some(kneeMobilityQualified)) {
        eligible=eligible.filter(kneeMobilityQualified); if(!eligible.length) return workout;
      }
      const demand=lowerBodyDemand(mainBlocks(workout).flatMap(block=>block.exercises),workout.focus);
      if (meaningfulLowerPrep(current) && others.filter(meaningfulLowerPrep).length<lowerPrepTarget(count,demand,workout.focus)) {
        const lowerEligible=eligible.filter(meaningfulLowerPrep); if(lowerEligible.length) eligible=lowerEligible;
      }
      if (upperTrunkPrep(current) && others.filter(upperTrunkPrep).length<upperTrunkTarget(count)) {
        const upperEligible=eligible.filter(upperTrunkPrep); if(upperEligible.length) eligible=upperEligible;
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
    recalcWorkoutEstimate(workout); refreshPrescriptionOutcome(workout); return workout;
  }

  function recalcWorkoutEstimate(workout) {
    normaliseWorkout(workout);
    workout.warmup.estimatedSeconds=workout.warmup.exercises.reduce((s,e)=>s+e.estimatedSeconds,0)+workout.warmup.restSeconds*Math.max(0,workout.warmup.exercises.length-1);
    workout.rampup.estimatedSeconds=workout.rampup.exercises.reduce((s,e)=>s+e.estimatedSeconds,0)+workout.rampup.restSeconds*Math.max(0,workout.rampup.exercises.length-1);
    for(const block of workout.main.blocks){block.estimatedDurationSeconds=estimateBlockDuration(block);block.estimatedSeconds=block.estimatedDurationSeconds;}
    workout.main.estimatedDurationSeconds=workout.main.blocks.reduce((sum,block)=>sum+block.estimatedDurationSeconds,0)+workout.main.transitionSeconds*Math.max(0,workout.main.blocks.length-1);
    workout.estimatedSeconds=workout.warmup.estimatedSeconds+workout.rampup.estimatedSeconds+workout.main.estimatedDurationSeconds+workout.cooldown.estimatedSeconds;
  }

  root.GarageFitGenerator = { BUDGETS, RESTS, PROTOCOL_SHAPES, MAIN_PROTOCOLS, GENERATED_PROTOCOLS, MAIN_INTENTS, MAIN_ROLES, BLOCK_TRANSITION_SECONDS, EMOM_POLICY, LADDER_POLICY, PYRAMID_POLICY, COMPLEX_POLICY, DENSITY_POLICY, WARMUP_PHASE_ORDER, EQUIPMENT_DIVERSITY, EQUIPMENT_DOMINANCE_CAP, BLOCK_DOMINANCE_CAP, WORKOUT_DIFFICULTIES, EXERCISE_DIFFICULTIES, DIFFICULTY_POLICY, workoutDifficulty, difficultyExcluded, difficultyCredit, WORKOUT_BODY_FOCUSES, EXERCISE_BODY_FOCUSES, EXERCISE_DIRECT_ELBOW_ACTIONS, BODY_FOCUS_POLICY, workoutBodyFocus, bodyFocusCredit, SHORTLIST_SIZE, SHORTLIST_MARGIN, WINDOW_MAX_RANKS, SUPPORTING_ROUTE, candidateWindowRanks, controlledPick, selectionWindow, selectionRanks, generatedPhaseEligible, requirementsMet, sectionSetupKey, groupSectionBySetup, sharedPatterns, selectionTags, sameFamily, sameRepetitionClass, sameExerciseOrFamily, mainFamilyCapReached, prescriptionMode, sideCount, phaseExercise, fitTimedDurations, recentUsePenalty, preparationMetadataValid, validateCatalogue, assertValidCatalogue, VALID_PATTERNS, VALID_WARMUP_AREAS, VALID_STRETCH_TARGETS, validatePreparation, estimateMain, estimateBlockDuration, resolveBlockSteps, OCCURRENCE_TARGET_LIMITS, resolveOccurrenceTarget, validateOccurrenceTargets, validateEmomBlock, validateLadderBlock, validatePyramidBlock, pyramidKind, validateComplexBlock, validateDensityBlock, complexSequenceIssues, buildEmomBlock, protocolCompatible, protocolWeights, recentProtocolsFromResults, preferredRepeatCount, repetitionPenalty, mainQualityPenalty, validateMain, mainVarietyIssues, equipmentUsageSeconds, viableEquipmentTypes, primaryEquipment, blockRepeatCount, protocolConditions, selectBlockExercises, selectWarmup, kneeMobilityQualified, upperTrunkTarget, lowerBodyDemand, lowerPrepTarget, selectRampup, scoreRampupCandidate, mainBlocks, normaliseWorkout, SessionPrescriptionError, assessSessionPrescription, generate, swap, swapPreparation };

  if (typeof window!=='undefined' && typeof document!=='undefined' && typeof window.addEventListener==='function') window.addEventListener('load',()=>{
    if (document.querySelector('script[data-garagefit-rampup-ui]')) return;
    const script=document.createElement('script'); script.src='js/rampup-ui.js'; script.dataset.garagefitRampupUi='true'; document.body.appendChild(script);
  });
})(typeof window==='undefined' ? globalThis : window);
