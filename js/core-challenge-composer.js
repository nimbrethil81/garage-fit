(function (root) {
  // Core & Stability and Full-Body Challenges composition v1 (docs/WORKOUT_FAMILIES.md).
  // Like Strength & Control and Cardio & Conditioning these families have no membership table:
  // eligibility is canonical Main eligibility narrowed by reviewed catalogue metadata, and
  // construction reuses the Generator's selector and the shared composer kit.
  const G=root.GarageFitGenerator,K=root.GarageFitFamilyComposerKit;
  const {copy,sum,fail,ordered,context,fitted,sequence,counts,bestOf,between,repeated,meanOf}=K;
  const timed=ex=>String(ex.prescription.type).includes('timed');
  const blockOf=(protocol,intent,exercises,prescription,extra)=>({protocol,intent,exercises,prescription,...extra});
  const rounded=prescription=>({rounds:prescription.rounds,rest:{exercise:prescription.exerciseRestSeconds,round:prescription.roundRestSeconds}});

  // One exercise at a time: freshest first, then the Generator's scored selection.
  function selectOne(ctx,state,chosen,list,protocol,intent,focus) {
    const fresh=list.filter(ex=>!state.usedIds.has(ex.id)),candidates=fresh.length?fresh:list;
    if(!candidates.length)return null;
    const view={...state,exercises:state.exercises.concat(chosen),usedIds:new Set([...state.usedIds,...chosen.map(ex=>ex.id)])};
    return G.selectBlockExercises(candidates,1,focus,intent,protocol,view,ctx.history,ctx.random,ctx.catalogue)[0]||null;
  }
  const unchosen=(ctx,chosen,ex)=>!chosen.some(item=>item.id===ex.id)&&G.setupProfilesCompatible(chosen.concat(ex),ctx.owned);

  // Shared acceptance: executable, inside the Main budget, filled to tolerance, not repetitive.
  function accept(ctx,blocks,{tolerance,maxExposure=2,check}) {
    if(!blocks)return null;
    const total=G.mainSeconds(blocks,ctx.owned),list=blocks.flatMap(block=>block.exercises);
    if(total>ctx.target||ctx.target-total>tolerance)return null;
    if(G.validateMain({blocks},ctx.catalogue,ctx.owned,ctx.target).length)return null;
    const exposure=new Map();
    for(const ex of list)exposure.set(ex.id,(exposure.get(ex.id)||0)+1);
    if(Math.max(...exposure.values())>maxExposure||check&&!check(blocks,list))return null;
    const repeats=sum([...exposure.values()].map(count=>count-1));
    return {blocks,fitness:ctx.target-total+repeats*20};
  }
  const tolerance=ctx=>Math.max(40,ctx.target*.06);

  // ---- Core & Stability ----
  // Trunk-led, low-impact, controlled work: reviewed bodyFocus, core pattern, cardio and impact.
  // Press-pattern variants are not trunk work; hanging raises remain (core + pull).
  const trunkLed=ex=>ex.bodyFocus==='core'&&ex.patterns.includes('core')&&!ex.patterns.includes('push')&&ex.impact==='low'&&ex.cardio<=3;
  // A hold is an unmoving or anti-movement effort: timed, controlled and without alternating sides.
  const isHold=ex=>ex.cardio<=2&&timed(ex)&&['none','per-side'].includes(ex.sidedness);
  const REST={easy:{exercise:25,round:75,set:50},normal:{exercise:20,round:60,set:40},hard:{exercise:15,round:50,set:30}};

  // Alternate holds with controlled movement, preferring unused exercises.
  function alternating(ctx,state,pool,size,intent) {
    const holds=pool.filter(isHold),moves=pool.filter(ex=>!isHold(ex)),chosen=[];
    for(let slot=0;slot<size;slot++) {
      const first=slot%2===0?holds:moves,second=slot%2===0?moves:holds;
      const ex=selectOne(ctx,state,chosen,first.filter(item=>unchosen(ctx,chosen,item)),'rounds',intent,'strength')
        ||selectOne(ctx,state,chosen,second.filter(item=>unchosen(ctx,chosen,item)),'rounds',intent,'strength');
      if(!ex)break;
      chosen.push(ex);
    }
    return chosen;
  }
  const coreAccept=(ctx,blocks,maxExposure)=>accept(ctx,blocks,{tolerance:tolerance(ctx),maxExposure,check:(all,list)=>
    new Set(list.map(ex=>ex.id)).size>=3&&list.filter(isHold).length>=list.length*.25&&sum(list.map(ex=>ex.cardio))/list.length<=2.5});

  const CORE_STYLES={
    // Holds and controlled movement in short circuits, with full recovery between rounds.
    'controlled-stability':(ctx,exposure)=>{
      const pool=ctx.pool.filter(ex=>ex.cardio<=2),rest=REST[ctx.difficulty];
      if(pool.filter(isHold).length<1||pool.length<4)return null;
      const attempts=counts(ctx.target,1000,330).flatMap(count=>[3,4,5,6].map(size=>({count,size})));
      return bestOf(attempts,({count,size})=>coreAccept(ctx,sequence(ctx,count,(index,share,state)=>{
        const intent=index?'accessory':'strength',exercises=alternating(ctx,state,pool,size,intent);
        if(exercises.length<3)return null;
        const candidates=[];
        for(const rounds of [2,3,4])for(let exercise=15;exercise<=rest.exercise+10;exercise+=5)for(let round=45;round<=rest.round+30;round+=5)
          candidates.push({prescription:{rounds,exerciseRestSeconds:exercise,roundRestSeconds:round},
            cost:Math.abs(exercise-rest.exercise)*.5+Math.abs(round-rest.round)*.3+Math.abs(rounds-3)*4});
        const fit=fitted(ctx,'rounds',intent,exercises,candidates,share);
        return fit&&{estimate:fit.estimate,block:blockOf('rounds',intent,exercises,fit.prescription,rounded(fit.prescription))};
      }),exposure));
    },
    // A hold paired with a dynamic trunk movement, recovering after each pair.
    'dynamic-core':(ctx,exposure)=>{
      const rest=REST[ctx.difficulty],holds=ctx.pool.filter(isHold),moves=ctx.pool.filter(ex=>!isHold(ex));
      if(!holds.length||moves.length<2)return null;
      const attempts=counts(ctx.target,640,300);
      return bestOf(attempts,count=>coreAccept(ctx,sequence(ctx,count,(index,share,state)=>{
        const intent=index?'accessory':'strength',hold=selectOne(ctx,state,[],holds,'paired_sets',intent,'strength');
        const move=hold&&selectOne(ctx,state,[hold],moves.filter(ex=>unchosen(ctx,[hold],ex)),'paired_sets',intent,'strength');
        if(!move)return null;
        const pair=index%2?[move,hold]:[hold,move],candidates=[];
        for(const sets of [3,4])for(let between=30;between<=rest.set+30;between+=5)
          candidates.push({prescription:{sets,betweenExercisesSeconds:10,betweenSetsSeconds:between},cost:Math.abs(between-rest.set)*.4+(sets===3?0:6)});
        const fit=fitted(ctx,'paired_sets',intent,pair,candidates,share);
        return fit&&{estimate:fit.estimate,block:blockOf('paired_sets',intent,pair,fit.prescription)};
      }),exposure));
    }
  };
  function coreWeights(ctx) {
    const d=ctx.difficulty,recent=ctx.recent;
    return {'controlled-stability':(d==='easy'?3:d==='hard'?2:2.5)*(ctx.duration<=15?1.3:1)*(recent.includes('rounds')?.8:1),
      'dynamic-core':(d==='easy'?1.5:d==='hard'?3:2.5)*(ctx.duration>=30?1.3:1)*(recent.includes('paired_sets')?.6:1)};
  }

  // ---- Full-Body Challenges ----
  const UPPER_LOWER_CORE=['upper','lower','core'],WHOLE=['upper','lower','core','full-body'];
  // Credit each exercise to the body regions it trains; a full-body exercise is shared equally.
  function balanced(list) {
    if(list.length<3)return false;
    const credit={upper:0,lower:0,core:0};
    for(const ex of list)for(const region of UPPER_LOWER_CORE)credit[region]+=ex.bodyFocus===region?1:ex.bodyFocus==='full-body'?1/3:0;
    return Object.values(credit).every(value=>value>=list.length*.15-1e-9&&value<=list.length*.5+1e-9);
  }
  // Balanced across the session, and no multi-exercise block repeats an earlier one.
  const distinctBlocks=blocks=>{
    const signatures=blocks.filter(block=>block.exercises.length>1).map(block=>block.exercises.map(ex=>ex.id).sort().join('+'));
    return new Set(signatures).size===signatures.length;
  };
  const challengeAccept=(ctx,blocks,maxExposure,options)=>accept(ctx,blocks,{tolerance:tolerance(ctx),maxExposure,...options,
    check:(all,list)=>balanced(list)&&distinctBlocks(all)});
  // Choose one exercise for a body region; if the region has nothing usable fall back to the others.
  function choose(ctx,state,chosen,region,protocol,intent,ok,link) {
    for(const target of [region,...WHOLE.filter(item=>item!==region)]) {
      const list=ctx.pool.filter(ex=>ex.bodyFocus===target&&ok(ex)&&unchosen(ctx,chosen,ex)&&(!link||link(chosen,ex)));
      const ex=selectOne(ctx,state,chosen,list,protocol,intent,'balanced');
      if(ex)return ex;
    }
    return null;
  }
  const cursor=(state,offset=0)=>UPPER_LOWER_CORE[(state.exercises.length+offset)%3];
  const stepFloor={easy:{ladder:40,pyramid:75},normal:{ladder:30,pyramid:60},hard:{ladder:20,pyramid:60}};

  // Two exercises from consecutive body regions; `compat` lets a protocol require a workable partner.
  function pairBlock(ctx,state,label,intent,ok,compat) {
    const regions=[cursor(state),cursor(state,1)];
    const partnerExists=first=>ctx.pool.some(other=>other.id!==first.id&&other.bodyFocus===regions[1]&&ok(other)&&unchosen(ctx,[first],other)&&compat(first,other));
    const first=choose(ctx,state,[],regions[0],label,intent,ok,compat&&((chosen,ex)=>partnerExists(ex)));
    const next=first&&choose(ctx,state,[first],regions[1],label,intent,ok,compat&&((chosen,ex)=>compat(chosen[0],ex)));
    return next?[first,next]:null;
  }

  // The high-impact rule shared with Cardio: never adjacent (including round wrap-around) and
  // at most one per circuit.
  function impactSafe(exercises,repeats) {
    const flow=[...exercises,...(repeats>1?[exercises[0]]:[])];
    return exercises.filter(ex=>ex.impact==='high').length<=1&&flow.every((ex,i)=>!i||ex.impact!=='high'||flow[i-1].impact!=='high');
  }
  const ROUNDS_REST={easy:{exercise:20,round:50},normal:{exercise:15,round:40},hard:{exercise:10,round:30}};
  const EMOM_WORK={easy:30,normal:35,hard:40};
  function emomTarget(ex,cap) {
    const dose=ex.prescription.value,value=timed(ex)?Math.min(dose,cap):Math.min(dose,Math.floor(dose*cap/ex.estimatedSeconds));
    return value>=(timed(ex)?15:3)?{type:ex.prescription.type,value}:null;
  }
  const LADDERS={easy:[[2,4,6],[2,4,6,8]],normal:[[2,4,6],[2,4,6,8],[3,6,9],[2,4,6,8,10]],hard:[[2,4,6,8],[3,6,9],[2,4,6,8,10],[3,6,9,12],[4,8,12]]};
  const PYRAMIDS=[[3,6,3],[4,8,4],[3,5,7,5,3],[4,6,8,6,4],[6,10,6]];

  const CHALLENGE_STYLES={
    // A fixed number of rounds of one balanced whole-body circuit, in at most two blocks.
    rounds:(ctx,exposure)=>{
      const rest=ROUNDS_REST[ctx.difficulty],sizes={10:[3],15:[3,4],20:[4,5],30:[4,5],45:[5,6]}[ctx.duration],minimumRounds=ctx.duration>=20?4:3;
      const ok=ex=>ex.load!=='Heavy'&&ex.strength<5&&(ex.impact!=='high'||ctx.difficulty==='hard')&&ex.estimatedSeconds<=60;
      const attempts=counts(ctx.target,1200,330).filter(count=>count<=2).flatMap(count=>sizes.map(size=>({count,size})));
      const buildAttempt=({count,size,recovery=false})=>challengeAccept(ctx,sequence(ctx,count,(index,share,state)=>{
        const exercises=[];
        for(let slot=0;slot<size;slot++) {
          const fitsMinimum=ex=>{
            if(!ok(ex))return false;
            if(!recovery)return true;
            const prefix=exercises.concat(ex),left=size-prefix.length;
            // Optimistic remaining work: ignore region/setup costs here, then
            // retain the ordinary complete-block fitting and acceptance gates.
            const remaining=ctx.pool.filter(item=>ok(item)&&G.protocolCompatible(item,'rounds')&&!prefix.some(chosen=>chosen.id===item.id))
              .map(item=>item.estimatedSeconds).sort((a,b)=>a-b).slice(0,left);
            if(remaining.length<left)return false;
            const minimum=minimumRounds*(sum(prefix.map(item=>item.estimatedSeconds))+sum(remaining)+(size-1)*rest.exercise)
              +(minimumRounds-1)*rest.round;
            return minimum<=share;
          };
          const ex=choose(ctx,state,exercises,WHOLE[slot%4],'rounds','conditioning',fitsMinimum);
          if(!ex)return null;
          exercises.push(ex);
        }
        const candidates=[];
        for(const rounds of [3,4,5,6].filter(value=>value>=minimumRounds))for(let exercise=rest.exercise;exercise<=rest.exercise+10;exercise+=5)for(let round=rest.round;round<=rest.round+30;round+=5)
          candidates.push({prescription:{rounds,exerciseRestSeconds:exercise,roundRestSeconds:round},
            cost:(exercise-rest.exercise)*.5+(round-rest.round)*.3+Math.abs(rounds-4)*3});
        const usable=candidates.filter(item=>impactSafe(exercises,item.prescription.rounds));
        const fit=fitted(ctx,'rounds','conditioning',exercises,usable,share);
        return fit&&{estimate:fit.estimate,block:blockOf('rounds','conditioning',exercises,fit.prescription,rounded(fit.prescription))};
      }),exposure);
      const made=bestOf(attempts,buildAttempt);
      // Long circuits have a narrow four-round dose window. If the original
      // search misses it, sample more legal combinations of the same plans.
      // Successful searches keep their exact draw stream and prescription.
      return made||(ctx.duration===45?bestOf(attempts.flatMap(plan=>[{...plan,recovery:true},{...plan,recovery:true}]),buildAttempt):null);
    },
    // Whole minutes rotating upper, lower and core work; every minute leaves recovery inside it.
    emom:(ctx,exposure)=>{
      const cap=EMOM_WORK[ctx.difficulty],ok=ex=>G.protocolCompatible(ex,'emom')&&!!emomTarget(ex,cap);
      return bestOf(counts(ctx.target,720,300),count=>challengeAccept(ctx,sequence(ctx,count,(index,share,state)=>{
        const rotation=Math.floor(share/60)>=6?3:2,minutes=Math.min(Math.floor(share/60),rotation*4);
        if(minutes<4)return null;
        const exercises=[];
        for(let slot=0;slot<rotation;slot++) {
          const ex=choose(ctx,state,exercises,rotation===3?UPPER_LOWER_CORE[slot]:cursor(state,slot),'emom','conditioning',ok);
          if(!ex)return null;
          exercises.push(ex);
        }
        const block=blockOf('emom','conditioning',exercises,{minutes,slotSeconds:60,targets:exercises.map(ex=>emomTarget(ex,cap))});
        return !G.validateEmomBlock(block,ctx.catalogue).length&&{estimate:minutes*60,block};
      }),exposure,{tolerance:Math.max(65,tolerance(ctx))}));
    },
    // Two-exercise ladders rising or falling together, with step recovery that is never squeezed below its floor.
    ladder:(ctx,exposure)=>{
      const floor=stepFloor[ctx.difficulty].ladder,ok=ex=>G.protocolCompatible(ex,'ladder');
      return bestOf(counts(ctx.target,520,260),count=>challengeAccept(ctx,sequence(ctx,count,(index,share,state)=>{
        const exercises=pairBlock(ctx,state,'ladder',index?'accessory':'strength',ok);
        if(!exercises)return null;
        const candidates=[],down=ctx.random()<.5;
        for(const plan of LADDERS[ctx.difficulty])for(const exercise of [10,20,30])for(let step=floor;step<=90;step+=10)
          candidates.push({prescription:{repSteps:down?plan.slice().reverse():plan.slice(),exerciseRestSeconds:exercise,stepRestSeconds:step},cost:(exercise-10)*.3+(step-floor)*.2});
        const fit=fitted(ctx,'ladder',index?'accessory':'strength',exercises,candidates,share);
        return fit&&{estimate:fit.estimate,block:blockOf('ladder',index?'accessory':'strength',exercises,fit.prescription)};
      }),exposure));
    },
    // One stable strength movement per rep pyramid, rotating body regions, with full step recovery.
    pyramid:(ctx,exposure)=>{
      const floor=stepFloor[ctx.difficulty].pyramid,ok=ex=>G.protocolCompatible(ex,'pyramid');
      return bestOf(counts(ctx.target,560,190),count=>challengeAccept(ctx,sequence(ctx,count,(index,share,state)=>{
        const ex=choose(ctx,state,[],cursor(state),'pyramid',index?'accessory':'strength',ok);
        if(!ex)return null;
        const candidates=[];
        for(const plan of PYRAMIDS)for(let rest=floor;rest<=120;rest+=5)
          candidates.push({prescription:{steps:plan.map(reps=>({reps})),stepRestSeconds:rest},cost:(rest-floor)*.2});
        const fit=fitted(ctx,'pyramid',index?'accessory':'strength',[ex],candidates,share);
        return fit&&{estimate:fit.estimate,block:blockOf('pyramid',index?'accessory':'strength',[ex],fit.prescription)};
      }),exposure));
    },
    // Fixed work for a time cap, never on Easy. The cap is reserved in full, so it is the block estimate.
    density:(ctx,exposure)=>{
      if(ctx.difficulty==='easy')return null;
      const ok=ex=>G.protocolCompatible(ex,'density'),compat=(first,other)=>!G.complexSequenceIssues([first,other]).length;
      return bestOf(counts(ctx.target,420,200),count=>challengeAccept(ctx,sequence(ctx,count,(index,share,state)=>{
        const exercises=pairBlock(ctx,state,'rounds','conditioning',ok,compat);
        if(!exercises)return null;
        const cap=Math.min(420,Math.floor(share));
        for(const repeats of [3,2])for(const exerciseRest of [15,20])for(const roundRest of [45,50]) {
          const prescription={repeats,targets:exercises.map(ex=>({type:'reps',value:Math.min(8,ex.prescription.value)})),timeCapSeconds:cap,
            exerciseRestSeconds:exerciseRest,roundRestSeconds:roundRest};
          const block=blockOf('density','conditioning',exercises,prescription);
          if(!G.validateDensityBlock(block,ctx.catalogue).length)return {estimate:cap,block};
        }
        return null;
      }),exposure));
    }
  };
  function challengeWeights(ctx) {
    const d=ctx.difficulty,recent=ctx.recent,long=ctx.duration>=20;
    return {rounds:1.5*(recent.includes('rounds')?.8:1),emom:3*(recent.includes('emom')?.6:1),
      ladder:3*(recent.includes('ladder')?.6:1),pyramid:(long?3:1.5)*(d==='easy'?1.3:d==='hard'?.8:1)*(recent.includes('pyramid')?.6:1),
      density:d==='easy'?0:(long?3:1.5)*(recent.includes('density')?.6:1)};
  }

  // ---- Family quality rules for the shared gate (docs/WORKOUT_FAMILIES.md, #186) ----
  const CORE_STRUCTURE={
    'controlled-stability':b=>b.protocol==='rounds'&&between(b.exercises.length,3,6)&&between(b.prescription.rounds,2,4)
      &&b.prescription.exerciseRestSeconds>=15&&b.prescription.roundRestSeconds>=45&&b.exercises.every(ex=>ex.cardio<=2),
    'dynamic-core':b=>b.protocol==='paired_sets'&&b.exercises.length===2&&b.exercises.filter(isHold).length===1
      &&between(b.prescription.sets,3,4)&&b.prescription.betweenExercisesSeconds===10&&b.prescription.betweenSetsSeconds>=30
  };
  function coreQuality(workout) {
    const blocks=workout.main.blocks,list=blocks.flatMap(block=>block.exercises),issues=[];
    if(blocks.some(block=>block.familyContext!=null))issues.push('unexpected-family-context');
    list.filter(ex=>!trunkLed(ex)).forEach(ex=>issues.push('unsuitable-exercise:'+ex.id));
    if(new Set(list.map(ex=>ex.id)).size<3)issues.push('insufficient-core-variety');
    if(list.filter(isHold).length<list.length*.25)issues.push('insufficient-holds');
    if(meanOf(list,'cardio')>2.5)issues.push('not-controlled');
    issues.push(...repeated(list,2));
    if(!blocks.every(CORE_STRUCTURE[workout.familyStyleId]))issues.push('style-structure-mismatch');
    return issues;
  }
  const emomWork=(ex,target)=>Math.max(target.type==='timed'?target.value:0,Math.ceil(ex.estimatedSeconds*target.value/ex.prescription.value));
  const CHALLENGE_STRUCTURE={
    rounds:(blocks,w)=>blocks.length<=2&&blocks.every(b=>{
      const rest=ROUNDS_REST[w.difficulty];
      return b.protocol==='rounds'&&between(b.exercises.length,3,6)&&b.prescription.rounds>=(w.duration>=20?4:3)
        &&b.prescription.exerciseRestSeconds>=rest.exercise&&b.prescription.roundRestSeconds>=rest.round&&impactSafe(b.exercises,b.prescription.rounds)
        &&b.exercises.every(ex=>ex.load!=='Heavy'&&ex.strength<5&&(ex.impact!=='high'||w.difficulty==='hard'));
    }),
    emom:(blocks,w)=>blocks.every(b=>b.protocol==='emom'&&b.exercises.length>=2&&between(b.prescription.minutes,4,b.exercises.length*4)
      &&b.prescription.slotSeconds===60&&b.prescription.targets.every((target,i)=>emomWork(b.exercises[i],target)<=EMOM_WORK[w.difficulty])),
    ladder:(blocks,w)=>blocks.every(b=>b.protocol==='ladder'&&b.exercises.length===2&&b.prescription.repSteps.length>=3
      &&b.prescription.stepRestSeconds>=stepFloor[w.difficulty].ladder),
    pyramid:(blocks,w)=>blocks.length>=3&&blocks.every(b=>b.protocol==='pyramid'&&b.exercises.length===1&&b.prescription.steps.length>=3
      &&b.prescription.stepRestSeconds>=stepFloor[w.difficulty].pyramid),
    density:(blocks,w)=>w.difficulty!=='easy'&&blocks.every(b=>b.protocol==='density'&&b.exercises.length===2
      &&b.prescription.exerciseRestSeconds>=15&&b.prescription.roundRestSeconds>=45)
  };
  function challengeQuality(workout) {
    const blocks=workout.main.blocks,list=blocks.flatMap(block=>block.exercises),issues=[];
    if(blocks.some(block=>block.familyContext!=null))issues.push('unexpected-family-context');
    if(!balanced(list))issues.push('unbalanced-body-regions');
    if(!distinctBlocks(blocks))issues.push('repeated-block');
    issues.push(...repeated(list,2));
    if(!CHALLENGE_STRUCTURE[workout.familyStyleId](blocks,workout))issues.push('style-structure-mismatch');
    return issues;
  }

  function build(label,styles,weights,suitable,focus) {
    return (options,request,attempt)=>{
      const ctx=context(options,request,label,suitable,focus),table=weights(ctx),excluded=attempt&&attempt.excludedStyleIds||[];
      // Same-family fallback: styles the shared gate rejected are skipped; the draw stream is unchanged.
      for(const {id} of ordered(Object.keys(styles).map(id=>({id,weight:table[id]})),ctx.random).filter(entry=>!excluded.includes(entry.id))) {
        // Prefer sessions that use each exercise once; repeat at most twice only when the pool requires it.
        const made=styles[id](ctx,1)||styles[id](ctx,2);
        if(made)return {familyStyleId:id,blocks:made.blocks,generalPreparation:{focus}};
      }
      return fail(label+' cannot build a suitable '+ctx.duration+'-minute session from the selected equipment and constraints.');
    };
  }
  G.registerFamilyComposer('core-stability',1,build('Core & Stability',CORE_STYLES,coreWeights,trunkLed,'strength'),coreQuality);
  G.registerFamilyComposer('full-body-challenges',1,build('Full-Body Challenges',CHALLENGE_STYLES,challengeWeights,()=>true,'balanced'),challengeQuality);

  // ---- Full-Body Challenges v2 (#398, GF-CHAL-R2) ----
  // These are observable prescription checks, not physiological intensity scores. Work is
  // resolved target time (estimated for reps); minute windows/caps never become work credit.
  const V2={
    easy:{exercise:20,round:50,roundShare:.52,ladderShare:.38,step:40,minute:[20,30],interval:[20,30,20,30],reps:4,conditioning:.08,demand:.4},
    normal:{exercise:15,round:40,roundShare:.60,ladderShare:.48,step:30,minute:[24,35],interval:[25,40,15,25],reps:6,conditioning:.12,demand:.5},
    hard:{exercise:10,round:30,roundShare:.66,ladderShare:.55,step:20,minute:[28,40],interval:[30,45,15,20],reps:8,conditioning:.16,demand:.6}
  };
  const v2Suitable=ex=>ex.load!=='Heavy'&&ex.strength<5&&ex.estimatedSeconds<=60;
  const complements=(chosen,ex)=>!chosen.some(other=>other.id===ex.id||G.sameFamily(other,ex)
    ||other.patterns.some(pattern=>['push','pull','squat','hinge','lunge'].includes(pattern)&&ex.patterns.includes(pattern)));
  const conditioning=ex=>ex.cardio>=3;
  const intervalLimit=ex=>Math.min(timed(ex)?ex.prescription.value:ex.estimatedSeconds,ex.impact==='high'?40:60);

  function challengeWork(block,catalogue) {
    let work=0,rest=0;const occurrences=[];
    for(const step of G.resolveBlockSteps(block)) {
      if(step.kind!=='exercise'){rest+=step.seconds||0;continue;}
      const ex=catalogue[block.exercises[step.exerciseIndex].id],target=step.plannedPrescription||step.target
        ||(step.timed?{type:'timed',value:step.seconds}:ex.prescription);
      const seconds=step.estimatedSeconds??(step.timed?step.seconds:Math.ceil(ex.estimatedSeconds*target.value/ex.prescription.value));
      work+=seconds;occurrences.push({ex,target,seconds});
    }
    return {work,rest,occurrences};
  }
  function challengeV2Quality(workout,{catalogue}={catalogue:root.GarageFitData.exercises}) {
    const blocks=workout.main.blocks,p=V2[workout.difficulty],style=workout.familyStyleId,issues=[];
    const protocol={rounds:'rounds',emom:'emom',ladder:'ladder',amrap:'amrap',intervals:'timed_intervals'}[style];
    if(!protocol||blocks.some(b=>b.protocol!==protocol))issues.push('style-structure-mismatch');
    // Fit is a feasibility obligation, never proof of workload. The separate dose checks
    // below still reject filled but underworked plans. The shared gate removes benchmark
    // blocks from this view; preserve their actual reservation from the full Main estimate.
    const main=G.mainSeconds(blocks,workout.setupEquipment||[]),allocated=workout.main.estimatedDurationSeconds??main;
    const target=(G.BUDGETS[workout.duration]?.main??main+K.MARGIN)-K.MARGIN-Math.max(0,allocated-main);
    if(main>target+K.MARGIN||target-main>Math.max(65,target*.06))issues.push('challenge-main-budget');
    const totals={upper:0,lower:0,core:0},patterns=new Set(),familyWork=new Map();
    let total=0,conditioned=0,demanding=0,resistance=0;
    for(const block of blocks) {
      const q=block.prescription,list=block.exercises.map(ex=>catalogue[ex.id]),dose=challengeWork(block,catalogue);
      if(block.familyContext!=null)issues.push('unexpected-family-context');
      if(block.occurrenceTargets||block.occurrenceRecoverySeconds)issues.push('unexpected-occurrence-override');
      if(list.some(ex=>!v2Suitable(ex)||ex.impact==='high'&&workout.difficulty!=='hard'))issues.push('unsuitable-challenge-movement');
      if(list.some((ex,i)=>!complements(list.slice(0,i),ex)))issues.push('redundant-movement-pattern');
      if(!impactSafe(list,G.blockRepeatCount(block)))issues.push('high-impact-adjacency');
      for(const {ex,seconds} of dose.occurrences) {
        total+=seconds;
        for(const region of UPPER_LOWER_CORE)totals[region]+=seconds*(ex.bodyFocus===region?1:ex.bodyFocus==='full-body'?1/3:0);
        ex.patterns.forEach(pattern=>patterns.add(pattern));
        if(ex.family)familyWork.set(ex.family,(familyWork.get(ex.family)||0)+seconds);
        if(conditioning(ex))conditioned+=seconds;
        if(ex.strength>=3||conditioning(ex))demanding+=seconds;
        if(ex.strength>=3)resistance+=seconds;
      }
      // Assess each protocol on its own real work/recovery contract. A Density negative
      // exemplar still gets the fixed-work check even when its style is unsupported.
      if(['rounds','density'].includes(block.protocol)) {
        if(dose.work/(G.estimateBlockDuration(block)||1)<p.roundShare)issues.push('insufficient-prescribed-work');
        if(block.protocol==='rounds'&&(!between(q.rounds,2,6)||!between(list.length,3,6)
          ||!between(q.exerciseRestSeconds,p.exercise,p.exercise+10)||!between(q.roundRestSeconds,p.round,p.round+20)))issues.push('rounds-dose-or-recovery');
      } else if(block.protocol==='emom') {
        if(list.length<2||!between(q.minutes,4,list.length*4))issues.push('emom-rotation');
        if(dose.occurrences.some(o=>!between(o.seconds,...p.minute)))issues.push('emom-underworked-or-overloaded');
      } else if(block.protocol==='ladder') {
        if(list.length!==2||q.repSteps.length<3||!between(q.stepRestSeconds,p.step,p.step+20)
          ||!between(q.exerciseRestSeconds,10,20))issues.push('ladder-dose-or-recovery');
        if(dose.work/(dose.work+dose.rest||1)<p.ladderShare)issues.push('insufficient-ladder-work');
      } else if(block.protocol==='amrap') {
        // One planned pass only. Never multiply it by cap/estimated-round-time.
        if(dose.occurrences.some(o=>o.target.value<p.reps)||dose.work<({easy:18,normal:24,hard:30}[workout.difficulty]))issues.push('insufficient-amrap-sequence');
        if(G.validateAmrapBlock(block,catalogue).length)issues.push('amrap-contract');
      } else if(block.protocol==='timed_intervals') {
        const [low,high,recoveryLow,recoveryHigh]=p.interval;
        if(!between(list.length,3,5)||!between(q.cycles,2,8)||!between(q.workSeconds,low,high)
          ||!between(q.transitionSeconds,recoveryLow,recoveryHigh)||list.some(ex=>q.workSeconds>intervalLimit(ex)))issues.push('interval-dose-or-recovery');
      }
    }
    if(!total||Object.values(totals).some(value=>value<total*.12||value>total*.6))issues.push('unbalanced-prescribed-work');
    if(patterns.size<3)issues.push('insufficient-movement-coverage');
    if([...familyWork.values()].some(value=>value>total*.5))issues.push('equivalent-variant-dominance');
    if(conditioned<total*p.conditioning||demanding<total*p.demand||resistance<total*.2)issues.push('insufficient-challenge-demand');
    if(!distinctBlocks(blocks))issues.push('repeated-block');
    issues.push(...repeated(blocks.flatMap(b=>b.exercises),2));
    return [...new Set(issues)];
  }

  const v2Accept=(ctx,blocks)=>accept(ctx,blocks,{tolerance:Math.max(65,tolerance(ctx)),maxExposure:2,
    check:all=>!challengeV2Quality({main:{blocks:all},difficulty:ctx.difficulty,familyStyleId:ctx.style},{catalogue:ctx.catalogue}).length});
  function v2Pick(ctx,state,size,protocol,ok,link) {
    const chosen=[];
    for(let slot=0;slot<size;slot++) {
      const region=UPPER_LOWER_CORE[(state.exercises.length+slot)%3];
      // AMRAP eligibility and continuity are already hard filters here. The shared
      // AMRAP selector expects a whole pair pool, so use ordinary scored selection for
      // a single regional slot (as v1 Density does), then validate the completed block.
      const ex=choose(ctx,state,chosen,region,protocol==='amrap'?'rounds':protocol,'conditioning',item=>ok(item)&&complements(chosen,item),link);
      if(!ex)return null;
      chosen.push(ex);
    }
    return chosen;
  }
  function v2Circuit(ctx,intervals) {
    const p=V2[ctx.difficulty],protocol=intervals?'timed_intervals':'rounds';
    const attempts=counts(ctx.target,intervals?1000:1200,300).flatMap(count=>[3,4,5].map(size=>({count,size})));
    return bestOf(attempts,({count,size})=>v2Accept(ctx,sequence(ctx,count,(index,share,state)=>{
      const [low,high,recoveryLow,recoveryHigh]=p.interval;
      const exercises=v2Pick(ctx,state,size,protocol,ex=>G.protocolCompatible(ex,protocol)
        &&(ex.impact!=='high'||ctx.difficulty==='hard')&&(!intervals||G.sideCount(ex)===1&&intervalLimit(ex)>=low));
      if(!exercises)return null;
      const candidates=[];
      if(intervals) {
        for(let work=low;work<=Math.min(high,...exercises.map(intervalLimit));work+=5)
          for(let rest=recoveryLow;rest<=recoveryHigh;rest+=5)for(let cycles=2;cycles<=8;cycles++)
            candidates.push({prescription:{cycles,workSeconds:work,transitionSeconds:rest},cost:(high-work)*.3+(rest-recoveryLow)*.3});
      } else for(let rounds=2;rounds<=6;rounds++)for(let exercise=p.exercise;exercise<=p.exercise+10;exercise+=5)
        for(let round=p.round;round<=p.round+20;round+=5)
          candidates.push({prescription:{rounds,exerciseRestSeconds:exercise,roundRestSeconds:round},cost:(exercise-p.exercise)+(round-p.round)*.5});
      // Work quality is checked before best-fit ranking: extra rest cannot win by filling time.
      const usable=candidates.filter(({prescription})=>{
        const b=blockOf(protocol,'conditioning',exercises,prescription),d=challengeWork(b,ctx.catalogue);
        return intervals||d.work/(G.estimateBlockDuration(b)||1)>=p.roundShare;
      });
      const fit=fitted(ctx,protocol,'conditioning',exercises,usable,share);
      return fit&&{estimate:fit.estimate,block:blockOf(protocol,'conditioning',exercises,fit.prescription,intervals?{}:rounded(fit.prescription))};
    })));
  }
  const V2_STYLES={
    rounds:ctx=>v2Circuit(ctx,false),intervals:ctx=>v2Circuit(ctx,true),
    emom:ctx=>bestOf(counts(ctx.target,720,240),count=>v2Accept(ctx,sequence(ctx,count,(index,share,state)=>{
      const p=V2[ctx.difficulty],minutes=Math.min(12,Math.floor(share/60));
      const exercises=v2Pick(ctx,state,3,'emom',ex=>G.protocolCompatible(ex,'emom')&&!!emomTarget(ex,p.minute[1])
        &&emomWork(ex,emomTarget(ex,p.minute[1]))>=p.minute[0]);
      if(!exercises||minutes<4)return null;
      return {estimate:minutes*60,block:blockOf('emom','conditioning',exercises,{minutes,slotSeconds:60,targets:exercises.map(ex=>emomTarget(ex,p.minute[1]))})};
    }))),
    ladder:ctx=>bestOf(counts(ctx.target,520,180),count=>v2Accept(ctx,sequence(ctx,count,(index,share,state)=>{
      const p=V2[ctx.difficulty];
      const plans={easy:[[2,4,6,8],[4,6,8]],normal:[[2,4,6,8,10],[4,6,8,10],[3,6,9]],hard:[[2,4,6,8,10],[4,8,12],[6,8,10,12]]}[ctx.difficulty];
      const plan=plans[Math.floor(ctx.random()*plans.length)],peak=Math.max(...plan),volume=sum(plan);
      const exercises=v2Pick(ctx,state,2,'ladder',ex=>G.protocolCompatible(ex,'ladder')&&ex.prescription.value>=peak
        &&ex.estimatedSeconds*volume/ex.prescription.value<=120);
      if(!exercises)return null;
      const candidates=[],down=ctx.random()<.5;
      for(const reps of [plan])for(const exercise of [10,15,20])for(let step=p.step;step<=p.step+20;step+=5) {
        const prescription={repSteps:down?reps.slice().reverse():reps.slice(),exerciseRestSeconds:exercise,stepRestSeconds:step};
        const block=blockOf('ladder','conditioning',exercises,prescription),dose=challengeWork(block,ctx.catalogue);
        if(!G.validateLadderBlock(block,ctx.catalogue).length&&dose.work/(dose.work+dose.rest)>=p.ladderShare)
          candidates.push({prescription,cost:(exercise-10)+(step-p.step)*.5});
      }
      const fit=fitted(ctx,'ladder','conditioning',exercises,candidates,share);
      return fit&&{estimate:fit.estimate,block:blockOf('ladder','conditioning',exercises,fit.prescription)};
    }))),
    amrap:ctx=>bestOf(counts(ctx.target,480,180),count=>v2Accept(ctx,sequence(ctx,count,(index,share,state)=>{
      const cap=Math.min(480,Math.floor(share/60)*60);
      if(cap<180)return null;
      const eligible=ex=>G.protocolCompatible(ex,'amrap');
      // A legal first movement must have a complementary compatible partner. In particular,
      // a TRX floor core movement cannot borrow a bodyweight partner on a different setup.
      const hasPartner=ex=>ctx.pool.some(other=>eligible(other)&&complements([ex],other)
        &&!G.complexSequenceIssues([ex,other]).length);
      const exercises=v2Pick(ctx,state,2,'amrap',ex=>eligible(ex)&&hasPartner(ex),
        (chosen,ex)=>!G.complexSequenceIssues(chosen.concat(ex)).length);
      if(!exercises)return null;
      const reps={easy:5,normal:6,hard:8}[ctx.difficulty];
      const block=blockOf('amrap','conditioning',exercises,{capSeconds:cap,targets:exercises.map(ex=>({type:'reps',value:Math.min(ex.prescription.value,reps)}))});
      return !G.validateAmrapBlock(block,ctx.catalogue).length&&{estimate:cap,block};
    })))
  };
  function composeChallengeV2(options,request,attempt) {
    const ctx=context(options,request,'Full-Body Challenges',v2Suitable,'balanced'),excluded=attempt?.excludedStyleIds||[];
    const weights={rounds:3,emom:3,ladder:3,amrap:2,intervals:3};
    for(const {id} of ordered(Object.keys(V2_STYLES).map(id=>({id,weight:weights[id]*(ctx.recent.includes(id==='intervals'?'timed_intervals':id)?.6:1)})),ctx.random)) {
      if(excluded.includes(id))continue;
      ctx.style=id;
      const made=V2_STYLES[id](ctx);
      if(made)return {familyStyleId:id,blocks:made.blocks,generalPreparation:{focus:'balanced'}};
    }
    return fail('Full-Body Challenges cannot build a balanced, meaningfully worked '+ctx.duration+'-minute challenge with these settings.');
  }
  G.registerFamilyComposer('full-body-challenges',2,composeChallengeV2,challengeV2Quality);
})(typeof window==='undefined'?globalThis:window);
