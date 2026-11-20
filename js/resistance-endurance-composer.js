(function (root) {
  // Strength & Stamina composition v1 (internal family id `resistance-endurance`, #399).
  // Like the other metadata-led families there is no membership table or catalogue change:
  // eligibility is canonical Main eligibility narrowed by a small family-scoped suitability
  // rule over existing metadata, and construction reuses the Generator's selector, the shared
  // composer kit, generic preparation and the shared family gate (docs/WORKOUT_FAMILIES.md).
  const G=root.GarageFitGenerator,K=root.GarageFitFamilyComposerKit;
  const {fail,ordered,constraints,context,fitted,sequence,counts,bestOf,between,repeated,sum}=K;
  const FAMILY='resistance-endurance',STYLE_IDS=['muscular-endurance','metcon'];
  const MAJOR=['squat','hinge','lunge','push','pull','carry'],LOWER=['squat','hinge','lunge'],UPPER=['push','pull'];
  const has=(ex,patterns)=>(ex.patterns||[]).some(pattern=>patterns.includes(pattern));

  // ---- Family-scoped suitability (existing metadata only) ----
  // Sustained repetition magnifies fatigue and technique demands, so this family uses safely
  // repeatable movements: no Heavy or strength-5 lifts, no long single efforts, hard-rated
  // movements only on Hard, and no jumping on Easy. Each exercise has exactly one role, so a
  // dual-purpose movement is never credited as both resistance and conditioning.
  const repeatable=(ex,difficulty)=>ex.load!=='Heavy'&&ex.strength<=4&&ex.estimatedSeconds<=60
    &&(ex.difficulty!=='hard'||difficulty==='hard')&&(ex.impact!=='high'||difficulty!=='easy');
  // Resistance credit needs a strength-led major movement pattern (squat, hinge, lunge, push,
  // pull or carry): controlled air squats count; trunk holds, isolation drills and cardio-led
  // variants do not. Trunk/accessory work is supporting: it adds variety, stimulus and fatigue, but
  // cannot by itself meet the minimum resistance share that establishes the family's identity.
  function role(ex) {
    if(ex.conditioning)return ex.cardio>=3?'conditioning':null;
    if(ex.strength<2||ex.strength<ex.cardio||ex.impact==='high')return null;
    if(has(ex,MAJOR))return ex.strength>=3?'resistance':null;
    return 'support';
  }
  const ROLES={'muscular-endurance':['resistance','support'],metcon:['resistance','conditioning']};
  const suitable=(ex,difficulty)=>repeatable(ex,difficulty)&&role(ex)!==null;

  // ---- Observable prescription policy (calibrated on resolved compositions; not physiology) ----
  // Rest is exercise-sensitive: demanding movements (strength 4, or per-side lower-body work)
  // raise the minimum exercise and round recovery inside each difficulty's range.
  const POLICY={
    'muscular-endurance':{
      easy:{exercise:[20,30],round:[60,90],change:[10,15],set:[45,60],repeats:[2,3],density:.45},
      normal:{exercise:[15,25],round:[45,75],change:[10,15],set:[30,45],repeats:[2,4],density:.5},
      hard:{exercise:[10,20],round:[40,60],change:[10,10],set:[30,40],repeats:[2,4],density:.55}},
    metcon:{
      easy:{exercise:[15,25],round:[45,75],repeats:[2,3],density:.5},
      normal:{exercise:[10,20],round:[30,60],repeats:[2,4],density:.55},
      hard:{exercise:[10,15],round:[30,45],repeats:[2,4],density:.6}}
  };
  // Provisional #399 candidate shares of active resolved Main work (time-weighted).
  const SHARES={'muscular-endurance':{resistance:.7},metcon:{resistance:.5,conditioning:.25}};
  const CONDITIONING_PREFERENCE=3.5;
  const SIZES={'muscular-endurance':{10:[3,4],15:[3,4,5],20:[3,4,5],30:[3,4,5],45:[3,4,5]},metcon:{10:[3,4],15:[3,4,5],20:[4,5,6],30:[4,5,6],45:[4,5,6]}};
  const demanding=ex=>ex.strength>=4||G.sideCount(ex)>1&&has(ex,LOWER);
  function minimumRest(block,p) {
    const list=block.exercises,heavy=list.filter(demanding).length;
    if(block.protocol==='paired_sets')return {change:p.change[0],set:Math.min(p.set[1],p.set[0]+(heavy===2?5:0))};
    return {exercise:Math.min(p.exercise[1],p.exercise[0]+(heavy?5:0)),round:Math.min(p.round[1],p.round[0]+5*Math.min(2,heavy))};
  }
  // Hard-rated loaded ballistic lifts (snatches, cleans, thrusters, devil's press): Hard only, one per block.
  const technical=ex=>ex.conditioning&&ex.difficulty==='hard'&&(ex.equipment||[]).length>0;
  const majorShared=(a,b)=>!!a&&!!b&&G.sharedPatterns(a,b).some(pattern=>MAJOR.includes(pattern));
  // Two strength-4 lower-body lifts must not share a ten-second changeover or follow each other in a circuit.
  const fatiguingPair=list=>list.length===2&&list.every(ex=>ex.strength>=4&&has(ex,LOWER));

  // Active work of every resolved occurrence (target time, or the catalogue estimate for reps,
  // both sides included) and the scheduled recovery between them. Setup is neither.
  function blockDose(block) {
    let work=0,rest=0;const occurrences=[];
    for(const step of G.resolveBlockSteps(block)) {
      if(step.kind!=='exercise'){rest+=step.seconds||0;continue;}
      const ex=block.exercises[step.exerciseIndex],target=step.plannedPrescription||step.target;
      const seconds=step.estimatedSeconds??(step.timed?step.seconds:target
        ?Math.ceil(ex.estimatedSeconds*target.value/ex.prescription.value):ex.estimatedSeconds);
      work+=seconds;occurrences.push({ex,seconds});
    }
    return {work,rest,occurrences};
  }
  function sessionShares(blocks) {
    const totals={resistance:0,conditioning:0,support:0,other:0};
    for(const block of blocks)for(const {ex,seconds} of blockDose(block).occurrences)totals[role(ex)||'other']+=seconds;
    const work=sum(Object.values(totals));
    return {work,resistance:work?totals.resistance/work:0,conditioning:work?totals.conditioning/work:0,support:work?totals.support/work:0};
  }
  // Coverage is required only where the permitted pool can supply it.
  function coverage(blocks,pool,duration) {
    if(duration<15)return [];
    const resistance=list=>list.filter(ex=>role(ex)==='resistance'),list=resistance(blocks.flatMap(b=>b.exercises)),options=resistance(pool);
    return [['lower',LOWER],['upper',UPPER]].filter(([,patterns])=>options.some(ex=>has(ex,patterns))&&!list.some(ex=>has(ex,patterns)))
      .map(([region])=>'missing-resistance-region:'+region);
  }

  // ---- Family quality rules (the shared gate; also used before a composition is accepted) ----
  function blockIssues(block,style,difficulty) {
    const p=POLICY[style][difficulty],q=block.prescription||{},list=block.exercises,issues=[];
    const roles=list.map(role),min=minimumRest(block,p);
    if(block.protocol==='rounds') {
      const shaped=between(q.rounds,...p.repeats)&&between(q.exerciseRestSeconds,min.exercise,p.exercise[1])
        &&between(q.roundRestSeconds,min.round,p.round[1]);
      // At most one support station, and only closing a circuit of four or more (as composed).
      const support=roles.map((r,i)=>r==='support'?i:-1).filter(i=>i>=0);
      if(style==='muscular-endurance'&&!(shaped&&between(list.length,3,5)&&(!support.length||support.length===1&&support[0]===list.length-1&&list.length>=4)))issues.push('style-structure-mismatch');
      if(style==='metcon') {
        const resistance=roles.filter(r=>r==='resistance').length,conditioning=roles.filter(r=>r==='conditioning').length;
        if(!(shaped&&between(list.length,3,6)&&conditioning>=1&&resistance>=conditioning))issues.push('style-structure-mismatch');
        // Conditioning stations are separated by resistance work, including the round wrap-around.
        if(roles.some((r,i)=>r==='conditioning'&&roles[(i+1)%roles.length]==='conditioning'&&(i<roles.length-1||q.rounds>1)))issues.push('consecutive-conditioning');
      }
    } else if(block.protocol==='paired_sets') {
      if(!(style==='muscular-endurance'&&list.length===2&&roles.every(r=>r==='resistance')&&between(q.sets,...p.repeats)
        &&between(q.betweenExercisesSeconds,min.change,p.change[1])&&between(q.betweenSetsSeconds,min.set,p.set[1])))issues.push('style-structure-mismatch');
      if(fatiguingPair(list))issues.push('fatiguing-pair');
    } else issues.push('style-structure-mismatch');
    // Adjacent movements (and the wrap-around of a repeated circuit) do not share a major pattern.
    const cyclic=block.protocol==='rounds'&&q.rounds>1&&list.length>=3;
    if(list.some((ex,i)=>i&&majorShared(list[i-1],ex))||cyclic&&majorShared(list[list.length-1],list[0]))issues.push('adjacent-major-pattern');
    // Nor do two demanding (strength-4) lower-body movements follow each other in a circuit.
    if(block.protocol==='rounds'&&(list.some((ex,i)=>i&&fatiguingPair([list[i-1],ex]))||cyclic&&fatiguingPair([list[list.length-1],list[0]])))issues.push('fatiguing-sequence');
    if(list.some((ex,i)=>list.slice(0,i).some(other=>G.sameFamily(other,ex))))issues.push('repeated-variation-family');
    if(list.filter(ex=>ex.impact==='high').length>1)issues.push('high-impact-load');
    if(list.filter(technical).length>1)issues.push('technical-load');
    if(list.filter(ex=>ex.mainRole==='supporting').length>1)issues.push('supporting-dominance');
    const dose=blockDose(block);
    if(!(dose.work/(dose.work+dose.rest||1)>=p.density))issues.push('insufficient-work-density');
    return issues;
  }
  function qualityIssues({blocks,style,difficulty,duration},pool) {
    const issues=[],list=blocks.flatMap(b=>b.exercises);
    if(!STYLE_IDS.includes(style)||!POLICY[style][difficulty])return ['style-structure-mismatch'];
    if(blocks.some(b=>b.familyContext!=null||b.occurrenceTargets||b.occurrenceRecoverySeconds))issues.push('unexpected-family-context');
    list.filter(ex=>!suitable(ex,difficulty)||!ROLES[style].includes(role(ex))).forEach(ex=>issues.push('unsuitable-exercise:'+ex.id));
    blocks.forEach(block=>issues.push(...blockIssues(block,style,difficulty)));
    // Resistance-led on the resolved work: never Cardio with token resistance.
    const shares=sessionShares(blocks),target=SHARES[style];
    if(!(shares.resistance>=target.resistance))issues.push('not-resistance-led');
    if(target.conditioning&&!(shares.conditioning>=target.conditioning))issues.push('insufficient-conditioning');
    issues.push(...repeated(list,2),...coverage(blocks,pool,duration));
    return [...new Set(issues)];
  }
  function permittedPool(workout,catalogue,equipment) {
    const allowed=constraints(workout.familyConstraints||{});
    return Object.values(catalogue).filter(ex=>suitable(ex,workout.difficulty)&&allowed(ex)&&G.generatedPhaseEligible(ex,'main',equipment,workout.difficulty));
  }
  function validateQuality(workout,{catalogue=root.GarageFitData.exercises,equipment=[]}={}) {
    return qualityIssues({blocks:workout.main.blocks,style:workout.familyStyleId,difficulty:workout.difficulty,duration:workout.duration},
      permittedPool(workout,catalogue,equipment));
  }

  // ---- Composition ----
  // One movement at a time through the Generator's scored selection, preferring unused
  // movements; family, setup and adjacent-pattern rules are hard filters here.
  function choose(ctx,state,chosen,pool,protocol,intent,focus,closing) {
    const previous=chosen[chosen.length-1],ok=pool.filter(ex=>!chosen.some(other=>other.id===ex.id||G.sameFamily(other,ex))
      &&G.setupProfilesCompatible(chosen.concat(ex),ctx.owned)&&!majorShared(previous,ex)&&!(closing&&majorShared(chosen[0],ex))
      &&!(previous&&fatiguingPair([previous,ex]))&&!(closing&&chosen.length>1&&fatiguingPair([ex,chosen[0]]))
      &&!(ex.mainRole==='supporting'&&chosen.some(other=>other.mainRole==='supporting')));
    const fresh=ok.filter(ex=>!state.usedIds.has(ex.id)),candidates=fresh.length?fresh:ok;
    if(!candidates.length)return null;
    const view={...state,exercises:state.exercises.concat(chosen),usedIds:new Set([...state.usedIds,...chosen.map(ex=>ex.id)])};
    return G.selectBlockExercises(candidates,1,focus,intent,protocol,view,ctx.history,ctx.random,ctx.catalogue)[0]||null;
  }
  const ofRole=(ctx,...roles)=>ctx.pool.filter(ex=>roles.includes(role(ex)));
  const range=(low,high)=>{const values=[];for(let value=low;value<=high;value+=5)values.push(value);return values;};
  function fit(ctx,block,share) {
    const p=POLICY[ctx.style][ctx.difficulty],min=minimumRest(block,p),candidates=[];
    for(let repeats=p.repeats[0];repeats<=p.repeats[1];repeats++) {
      if(block.protocol==='paired_sets')for(const change of range(min.change,p.change[1]))for(const set of range(min.set,p.set[1]))
        candidates.push({prescription:{sets:repeats,betweenExercisesSeconds:change,betweenSetsSeconds:set},cost:(change-min.change)*.5+(set-min.set)*.3+Math.abs(repeats-3)*6});
      else for(const exercise of range(min.exercise,p.exercise[1]))for(const round of range(min.round,p.round[1]))
        candidates.push({prescription:{rounds:repeats,exerciseRestSeconds:exercise,roundRestSeconds:round},cost:(exercise-min.exercise)*.5+(round-min.round)*.3+Math.abs(repeats-3)*6});
    }
    // Work density is checked before best fit, so extra rest cannot win by filling the clock.
    const usable=candidates.filter(({prescription})=>!blockIssues({...block,prescription},ctx.style,ctx.difficulty).length);
    const made=fitted(ctx,block.protocol,block.intent,block.exercises,usable,share);
    if(!made)return null;
    const extra=block.protocol==='rounds'?{rounds:made.prescription.rounds,rest:{exercise:made.prescription.exerciseRestSeconds,round:made.prescription.roundRestSeconds}}:{};
    return {estimate:made.estimate,block:{...block,prescription:made.prescription,...extra}};
  }
  function circuit(ctx,state,index,share,size) {
    const intent=index?'accessory':'strength',metcon=ctx.style==='metcon',chosen=[];
    for(let slot=0;slot<size;slot++) {
      // Metcon alternates resistance and conditioning stations, always starting and weighted
      // towards resistance; Muscular Endurance may close a larger circuit with trunk support.
      const conditioningSlot=metcon&&slot%2===1,closing=slot===size-1;
      const pool=conditioningSlot?ofRole(ctx,'conditioning').filter(ex=>(ex.impact!=='high'||!chosen.some(other=>other.impact==='high'))
        &&!(technical(ex)&&chosen.some(technical)))
        :ofRole(ctx,'resistance',...(!metcon&&closing&&size>=4?['support']:[]));
      const ex=choose(ctx,state,chosen,pool,'rounds',conditioningSlot?'conditioning':intent,conditioningSlot?'cardio':'strength',closing&&size>=3);
      if(!ex)return null;
      chosen.push(ex);
    }
    return fit(ctx,{protocol:'rounds',intent:metcon?'conditioning':intent,exercises:chosen},share);
  }
  function pair(ctx,state,index,share) {
    const intent=index?'accessory':'strength',chosen=[],pool=ofRole(ctx,'resistance');
    for(let slot=0;slot<2;slot++) {
      const ex=choose(ctx,state,chosen,pool.filter(ex=>!fatiguingPair(chosen.concat(ex))),'paired_sets',intent,'strength',false);
      if(!ex)return null;
      chosen.push(ex);
    }
    return fit(ctx,{protocol:'paired_sets',intent,exercises:chosen},share);
  }
  function accept(ctx,blocks) {
    if(!blocks)return null;
    const total=G.mainSeconds(blocks,ctx.owned);
    if(total>ctx.target||ctx.target-total>Math.max(40,ctx.target*.06))return null;
    if(G.validateMain({blocks},ctx.catalogue,ctx.owned,ctx.target).length)return null;
    if(qualityIssues({blocks,style:ctx.style,difficulty:ctx.difficulty,duration:ctx.duration},ctx.pool).length)return null;
    // Soft preference (not a gate): Normal/Hard Metcon conditioning leans towards higher-demand
    // movements where the permitted pool allows, without excluding low-impact options.
    const conditioning=blocks.flatMap(b=>blockDose(b).occurrences).filter(o=>role(o.ex)==='conditioning');
    const demand=sum(conditioning.map(o=>o.ex.cardio*o.seconds))/(sum(conditioning.map(o=>o.seconds))||1);
    const shortfall=ctx.style==='metcon'&&ctx.difficulty!=='easy'?Math.max(0,CONDITIONING_PREFERENCE-demand)*200:0;
    // Repetition is part of the identity: prefer three rounds or sets per block over many short blocks.
    const repeats=sum(blocks.map(b=>Math.abs(G.blockRepeatCount(b)-3)))*25;
    return {blocks,fitness:ctx.target-total+G.mainQualityPenalty(blocks,ctx.target,ctx.pool.length)+shortfall+repeats};
  }
  function composeStyle(ctx) {
    const attempts=[],metcon=ctx.style==='metcon';
    for(const count of counts(ctx.target,1100,300))for(const size of SIZES[ctx.style][ctx.duration]) {
      attempts.push({plan:Array(count).fill('circuit'),size});
      // Muscular Endurance may alternate circuits with contrasting resistance pairs.
      if(!metcon&&count>=2)attempts.push({plan:Array.from({length:count},(_,i)=>i%2?'pair':'circuit'),size});
    }
    return bestOf(attempts,({plan,size})=>accept(ctx,sequence(ctx,plan.length,(index,share,state)=>
      share<150?null:plan[index]==='pair'?pair(ctx,state,index,share):circuit(ctx,state,index,share,size))));
  }
  const WEIGHTS={'muscular-endurance':{easy:4,normal:3,hard:2.5},metcon:{easy:2,normal:3,hard:3.5}};
  function compose(options,request,attempt) {
    const ctx=context(options,request,'Strength & Stamina',suitable,'strength'),excluded=attempt&&attempt.excludedStyleIds||[];
    // Encourage variation from the newest completed session of this family, never a rotation.
    const previous=options.recentFamilySessions&&options.recentFamilySessions[FAMILY];
    const previousStyle=previous&&previous.familyStyleId||null;
    const ranked=ordered(STYLE_IDS.map(id=>({id,weight:WEIGHTS[id][ctx.difficulty]*(id===previousStyle?.5:1)})),ctx.random);
    for(const {id} of ranked) {
      if(excluded.includes(id))continue;
      const made=composeStyle({...ctx,style:id});
      if(made)return {familyStyleId:id,blocks:made.blocks,generalPreparation:{focus:id==='metcon'?'balanced':'strength'}};
    }
    return fail('Strength & Stamina cannot build a resistance-led '+ctx.duration+'-minute session from the selected equipment and constraints.');
  }

  G.registerFamilyComposer(FAMILY,1,compose,validateQuality);
  // Read-only analysis seam for tests and calibration; not a second policy table.
  const deepFreeze=value=>{Object.values(value).forEach(item=>{if(item&&typeof item==='object')deepFreeze(item);});return Object.freeze(value);};
  root.GarageFitResistanceEndurance=Object.freeze({role,suitable,sessionShares,blockDose,POLICY:deepFreeze(POLICY),SHARES:deepFreeze(SHARES)});
})(typeof window==='undefined'?globalThis:window);
