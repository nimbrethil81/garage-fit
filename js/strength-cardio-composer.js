(function (root) {
  // Strength & Control and Cardio & Conditioning composition v1 (docs/WORKOUT_FAMILIES.md).
  // Exercises come from the canonical catalogue's reviewed strength/cardio/impact/protocol
  // metadata through the Generator's own recipes and selection, never a family table.
  const G=root.GarageFitGenerator,F=root.GarageFitWorkoutFamilies;
  const TRANSITION=G.BLOCK_TRANSITION_SECONDS;
  // The generic preparation/cool-down are built after Main and may run a few seconds over
  // their budgets; Main leaves this much room so the whole session stays within its duration.
  const MARGIN=15;
  const IMPACTS=['low','medium','high'],POSITIONS=['standing','floor','supported','hanging','mixed'];
  const copy=value=>JSON.parse(JSON.stringify(value));
  const sum=list=>list.reduce((total,value)=>total+value,0);
  const fail=message=>{throw new F.FamilyContractError('family-not-feasible',message);};

  // Resistance work is controlled, strength-led and non-ballistic; cardio work is cardio-led.
  const controlled=ex=>ex.strength>=2&&ex.strength>=ex.cardio&&!ex.conditioning&&ex.impact!=='high';
  const cardioLed=(ex,difficulty)=>ex.cardio>=3&&ex.cardio>=ex.strength&&!(difficulty==='easy'&&ex.impact==='high');
  // A rep movement is never held longer as a timed interval than its catalogue estimate.
  const intervalCap=ex=>{
    const timed=ex.prescription&&String(ex.prescription.type).includes('timed');
    return Math.min(timed?60:ex.estimatedSeconds,ex.impact==='high'?40:60);
  };
  const intervalCapable=ex=>G.protocolCompatible(ex,'timed_intervals')&&G.sideCount(ex)===1;
  const restFor=ex=>ex.strength>=5||ex.load==='Heavy'?90:ex.strength>=4?75:60;

  // Weighted seeded ordering: one draw per candidate style, higher weight tends to rank first.
  const ordered=(entries,random)=>entries.filter(entry=>entry.weight>0)
    .map(entry=>({...entry,key:Math.pow(random(),1/entry.weight)})).sort((a,b)=>b.key-a.key);

  function constraints(options) {
    const {excludedImpact,bodyPositions}=options;
    if(excludedImpact!==undefined&&(!Array.isArray(excludedImpact)||excludedImpact.some(value=>!IMPACTS.includes(value)))
      ||bodyPositions!==undefined&&(!Array.isArray(bodyPositions)||!bodyPositions.length||bodyPositions.some(value=>!POSITIONS.includes(value))))
      throw new F.FamilyContractError('invalid-family-context','Invalid family exercise constraints.');
    return ex=>!(excludedImpact||[]).includes(ex.impact)&&(!bodyPositions||bodyPositions.includes(ex.bodyPosition));
  }

  function context(options,request,label,suitable,focus) {
    const {duration,difficulty,catalogue}=options,owned=options.equipment||[],random=options.random||Math.random;
    const allowed=constraints(options),budget=G.BUDGETS[duration];
    const pool=Object.values(catalogue).filter(ex=>G.generatedPhaseEligible(ex,'main',owned,difficulty)&&allowed(ex)&&suitable(ex,difficulty));
    return {label,focus,duration,difficulty,catalogue,owned,random,pool,target:budget.main-MARGIN,
      history:options.history||[],recent:options.recentProtocols||[],bodyFocus:request.bodyFocus};
  }

  // Selection state for the Generator's recipe-driven picker (js/generator.js selectBlockExercises).
  const freshState=ctx=>({exercises:[],usedIds:new Set(),equipmentUsage:new Map(),owned:ctx.owned,difficulty:ctx.difficulty,
    bodyFocus:ctx.bodyFocus,diversityTarget:G.EQUIPMENT_DIVERSITY[ctx.duration],duration:ctx.duration,recentProtocols:ctx.recent});
  const pick=(ctx,state,pool,count,focus,intent,protocol)=>
    G.selectBlockExercises(pool,count,focus,intent,protocol,state,ctx.history,ctx.random,ctx.catalogue);

  // Lowest cost among prescriptions that fit the share; underfill counts against a candidate.
  function fitted(ctx,protocol,intent,exercises,candidates,share) {
    let best=null;
    for(const {prescription,cost} of candidates) {
      const block={protocol,intent,exercises,prescription};
      const estimate=G.estimateBlockDuration(block,ctx.owned);
      if(estimate>0&&estimate<=share&&(!best||share-estimate+cost<best.score))best={prescription,estimate,score:share-estimate+cost};
    }
    return best;
  }

  // Builds `count` blocks in order; each takes an even share of the time left, setup-aware.
  function sequence(ctx,count,build) {
    const state=freshState(ctx),blocks=[];
    for(let index=0;index<count;index++) {
      const left=ctx.target-(blocks.length?G.mainSeconds(blocks,ctx.owned)+TRANSITION:0);
      const share=Math.floor((left-TRANSITION*(count-index-1))/(count-index));
      const made=build(index,share,state,blocks);
      if(!made)return null;
      const block={id:'main-'+(index+1),...made.block,exercises:made.block.exercises.map(copy)};
      block.estimatedDurationSeconds=block.estimatedSeconds=made.estimate;
      blocks.push(block);
      state.exercises.push(...block.exercises);
      block.exercises.forEach(ex=>state.usedIds.add(ex.id));
      state.equipmentUsage=G.equipmentUsageSeconds(blocks);
    }
    return blocks;
  }

  // Block-count candidates: from the fewest that keeps blocks reasonably sized to the most that keeps them worthwhile.
  const counts=(total,largest,smallest)=>{const low=Math.max(1,Math.ceil(total/largest));return Array.from({length:Math.max(low,Math.floor(total/smallest))-low+1},(_,i)=>low+i);};

  // Shared acceptance: executable, within the Main budget, filled to within 6% (at least 40 s), not repetitive.
  function accept(ctx,blocks,maxExposure) {
    if(!blocks)return null;
    const total=G.mainSeconds(blocks,ctx.owned);
    if(total>ctx.target||ctx.target-total>Math.max(40,ctx.target*.06))return null;
    if(G.validateMain({blocks},ctx.catalogue,ctx.owned,ctx.target).length)return null;
    const exposure=new Map();
    for(const block of blocks)for(const ex of block.exercises)exposure.set(ex.id,(exposure.get(ex.id)||0)+1);
    if(Math.max(...exposure.values())>maxExposure)return null;
    // The session as a whole must read as the family: resistance-led or cardio-led work.
    const list=blocks.flatMap(block=>block.exercises),mean=key=>sum(list.map(ex=>ex[key]))/list.length;
    if(ctx.focus==='strength'?mean('strength')-mean('cardio')<.5:mean('cardio')-mean('strength')<.5)return null;
    return {blocks,fitness:ctx.target-total+G.mainQualityPenalty(blocks,ctx.target,ctx.pool.length)};
  }
  // Each plan is tried a few times: the seeded picks differ, so one poor draw is not final.
  const bestOf=(attempts,build)=>{
    let best=null;
    for(let repeat=0;repeat<3;repeat++)for(const attempt of attempts){const made=build(attempt);if(made&&(!best||made.fitness<best.fitness))best=made;}
    return best;
  };

  // ---- Strength & Control ----
  const STRENGTH_STYLES={
    // One exercise at a time: sets of a single movement with full, exercise-sensitive rests.
    'straight-sets':ctx=>{
      const strong=ctx.pool.filter(ex=>ex.strength>=3),pool=strong.length>=4?strong:ctx.pool;
      const T=ctx.target,attempts=counts(T,460,200);
      return bestOf(attempts,count=>accept(ctx,sequence(ctx,count,(index,share,state)=>{
        const [ex]=pick(ctx,state,pool,1,'strength',index?'accessory':'strength','rounds');
        if(!ex)return null;
        const base=restFor(ex),candidates=[];
        for(const rounds of [3,4])for(let rest=Math.max(45,base-15);rest<=120;rest+=5)
          candidates.push({prescription:{rounds,exerciseRestSeconds:0,roundRestSeconds:rest},cost:Math.abs(rest-base)*.5+(rounds===3?0:8)});
        const fit=fitted(ctx,'rounds',index?'accessory':'strength',[ex],candidates,share);
        return fit&&{estimate:fit.estimate,block:{protocol:'rounds',intent:index?'accessory':'strength',exercises:[ex],
          prescription:fit.prescription,rounds:fit.prescription.rounds,rest:{exercise:0,round:fit.prescription.roundRestSeconds}}};
      }),1));
    },
    // Two contrasting movements alternate, recovering after each pair.
    'paired-sets':ctx=>{
      const T=ctx.target,attempts=counts(T,640,300);
      return bestOf(attempts,count=>accept(ctx,sequence(ctx,count,(index,share,state)=>{
        const pair=pick(ctx,state,ctx.pool,2,'strength',index?'accessory':'strength','paired_sets');
        if(pair.length<2)return null;
        const base=Math.max(...pair.map(restFor)),candidates=[];
        for(const sets of [3,4])for(let rest=Math.max(45,base-15);rest<=120;rest+=5)
          candidates.push({prescription:{sets,betweenExercisesSeconds:10,betweenSetsSeconds:rest},cost:Math.abs(rest-base)*.5+(sets===3?0:8)});
        const fit=fitted(ctx,'paired_sets',index?'accessory':'strength',pair,candidates,share);
        return fit&&{estimate:fit.estimate,block:{protocol:'paired_sets',intent:index?'accessory':'strength',exercises:pair,prescription:fit.prescription}};
      }),1));
    },
    // A short circuit of varied movements with deliberate rests between exercises and rounds.
    'controlled-circuits':ctx=>{
      const T=ctx.target,sizes={10:[3],15:[3,4],20:[4,5],30:[4,5,6],45:[5,6]}[ctx.duration];
      const attempts=counts(T,1000,330)
        .flatMap(count=>sizes.map(size=>({count,size})));
      return bestOf(attempts,({count,size})=>accept(ctx,sequence(ctx,count,(index,share,state)=>{
        const exercises=pick(ctx,state,ctx.pool,size,'strength',index?'accessory':'strength','rounds');
        if(exercises.length<3)return null;
        const candidates=[];
        for(const rounds of [2,3,4,5])for(const exercise of [20,25,30])for(let round=60;round<=120;round+=5)
          candidates.push({prescription:{rounds,exerciseRestSeconds:exercise,roundRestSeconds:round},
            cost:Math.abs(exercise-25)*.3+Math.abs(round-75)*.3+Math.abs(rounds-3)*4});
        const fit=fitted(ctx,'rounds',index?'accessory':'strength',exercises,candidates,share);
        return fit&&{estimate:fit.estimate,block:{protocol:'rounds',intent:index?'accessory':'strength',exercises,prescription:fit.prescription,
          rounds:fit.prescription.rounds,rest:{exercise:fit.prescription.exerciseRestSeconds,round:fit.prescription.roundRestSeconds}}};
      }),1));
    }
  };
  const STRENGTH_WEIGHTS={'straight-sets':{10:.5,15:1,20:2,30:3,45:4},'paired-sets':{10:4,15:4,20:4,30:3,45:3},'controlled-circuits':{10:3,15:3,20:3,30:2,45:2}};

  // ---- Cardio & Conditioning ----
  const INTERVALS={easy:[[30,30],[30,20]],normal:[[40,20],[30,30],[30,20]],hard:[[40,20],[45,15],[30,15]]};
  function intervalBlock(ctx,pool,index,share,state,intent,size) {
    for(const [work,transition] of ordered(INTERVALS[ctx.difficulty].map(value=>({value,weight:1})),ctx.random).map(entry=>entry.value)) {
      const capable=pool.filter(ex=>intervalCapable(ex)&&intervalCap(ex)>=work);
      if(capable.length<3)continue;
      const exercises=pick(ctx,state,capable,Math.min(size,5),'cardio',intent,'timed_intervals');
      if(exercises.length<3)continue;
      const candidates=[2,3,4,5].map(cycles=>({prescription:{workSeconds:work,transitionSeconds:transition,cycles},cost:0}));
      const fit=fitted(ctx,'timed_intervals',intent,exercises,candidates,share);
      if(fit)return {estimate:fit.estimate,block:{protocol:'timed_intervals',intent,exercises,prescription:fit.prescription}};
    }
    return null;
  }
  // Sustained circuit: short exercise changes and brief round breaks keep the effort continuous,
  // so it excludes high impact, heavy or technical resistance work and hard-rated movements.
  function enduranceBlock(ctx,pool,index,share,state,intent,size) {
    const steady=pool.filter(ex=>ex.impact!=='high'&&ex.load!=='Heavy'&&ex.strength<=3&&ex.difficulty!=='hard'),
      exercises=pick(ctx,state,steady,size,'cardio',intent,'rounds');
    if(exercises.length<3)return null;
    const base=ctx.difficulty==='easy'?15:10,candidates=[];
    for(const rounds of [2,3,4,5])for(const exerciseRest of [base,base+5])for(let round=ctx.difficulty==='easy'?25:20;round<=45;round+=5)
      candidates.push({prescription:{rounds,exerciseRestSeconds:exerciseRest,roundRestSeconds:round},cost:(round-20)*.5+(exerciseRest-base)});
    const fit=fitted(ctx,'rounds',intent,exercises,candidates,share);
    return fit&&{estimate:fit.estimate,block:{protocol:'rounds',intent,exercises,prescription:fit.prescription,rounds:fit.prescription.rounds,
      rest:{exercise:fit.prescription.exerciseRestSeconds,round:fit.prescription.roundRestSeconds}}};
  }
  // High-impact work never runs back to back (including cycle and block wrap-around) and is
  // limited to half of any interval block.
  function impactSafe(blocks) {
    let previous=null;
    for(const block of blocks) {
      const list=block.exercises,repeats=G.blockRepeatCount(block);
      if(list.filter(ex=>ex.impact==='high').length>Math.floor(list.length/2))return false;
      const flow=[...list,...(repeats>1?[list[0]]:[])];
      if(previous&&previous.impact==='high'&&list[0].impact==='high')return false;
      if(flow.some((ex,i)=>i&&ex.impact==='high'&&flow[i-1].impact==='high'))return false;
      previous=list[list.length-1];
    }
    return true;
  }
  function conditioningStyle(kinds) {
    return ctx=>{
      const attempts=kinds(ctx).flatMap(plan=>[3,4,5,6].map(size=>({plan,size})));
      return bestOf(attempts,({plan,size})=>{
        const blocks=sequence(ctx,plan.length,(index,share,state)=>{
          if(share<150)return null;
          const intent=index===plan.length-1&&plan.length>1&&plan[index]==='intervals'?'finisher':'conditioning';
          return (plan[index]==='intervals'?intervalBlock:enduranceBlock)(ctx,ctx.pool,index,share,state,intent,size);
        });
        return blocks&&impactSafe(blocks)?accept(ctx,blocks,2):null;
      });
    };
  }
  const CARDIO_STYLES={
    // Sustained moderate effort: continuous low/medium-impact circuits with brief rests only.
    endurance:conditioningStyle(ctx=>counts(ctx.target,1000,420).map(count=>Array(count).fill('rounds'))),
    // Structured hard/easy work: every block alternates timed work with proportionate recovery.
    intervals:conditioningStyle(ctx=>counts(ctx.target,750,300).map(count=>Array(count).fill('intervals'))),
    // Both: a sustained circuit and an interval block, always with at least one of each.
    'mixed-conditioning':conditioningStyle(ctx=>Array.from({length:Math.max(0,Math.min(4,Math.floor(ctx.target/190))-1)},(_,i)=>i+2).map(count=>
      Array.from({length:count},(_,i)=>i%2?'intervals':'rounds')))
  };
  function cardioWeights(ctx) {
    const d=ctx.difficulty,recent=ctx.recent;
    return {endurance:3*(d==='easy'?1.5:d==='hard'?.8:1)*(recent.includes('rounds')?.8:1),
      intervals:3*(d==='easy'?.6:d==='hard'?1.5:1)*(recent.includes('timed_intervals')?.6:1),
      'mixed-conditioning':ctx.duration>=20?3:2};
  }

  function build(label,styles,weights,suitable,focus) {
    return (options,request)=>{
      const ctx=context(options,request,label,suitable,focus);
      const ranked=ordered(Object.keys(styles).map(id=>({id,weight:weights(ctx)[id]})),ctx.random);
      for(const {id} of ranked) {
        const made=styles[id](ctx);
        if(made)return {familyStyleId:id,blocks:made.blocks,generalPreparation:{focus}};
      }
      return fail(label+' cannot build a suitable '+ctx.duration+'-minute session from the selected equipment and constraints.');
    };
  }

  G.registerFamilyComposer('strength-control',1,build('Strength & Control',STRENGTH_STYLES,ctx=>{
    const recent=ctx.recent,rounds=recent.includes('rounds')?.8:1;
    return Object.fromEntries(Object.entries(STRENGTH_WEIGHTS).map(([id,table])=>[id,table[ctx.duration]
      *(id==='paired-sets'?(recent.includes('paired_sets')?.6:1):rounds)]));
  },controlled,'strength'));
  G.registerFamilyComposer('cardio-conditioning',1,build('Cardio & Conditioning',CARDIO_STYLES,cardioWeights,cardioLed,'cardio'));
})(typeof window==='undefined'?globalThis:window);
