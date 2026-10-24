(function (root) {
  const G=root.GarageFitGenerator,F=root.GarageFitWorkoutFamilies;
  const FAMILY='mobility-movement-quality';
  // Published composition v1, independent of global phase flags. These orders express
  // connected regional practice, never eligibility grants (the central membership owns those).
  const PROFILES={10:[1,4,4,1],15:[2,5,6,2],20:[3,7,8,2],30:[3,11,13,3],45:[4,17,20,4]};
  const ORDER={
    prep:['hamstring-sweeps','standing-hip-rotations','leg-swings-forward-back','leg-swings-side','squat-to-stand','trx-squat-overhead'],
    focused:['wall-angel','standing-hip-rotations','kneeling-ankle-rocks','adductor-rock-backs','ninety-ninety-hip-switches','thread-the-needle'],
    flow:['ninety-ninety-hip-switches','thread-the-needle','downward-upward-dog','worlds-greatest-stretch','hamstring-sweeps','cossack-squat','squat-to-stand','trx-squat-overhead'],
    finish:['wall-angel','cat-cow','downward-upward-dog']
  };
  // Short sessions still include ankle, hip/adductor, thoracic and shoulder practice.
  const CORE={prep:['hamstring-sweeps','standing-hip-rotations'],
    focused:['wall-angel','kneeling-ankle-rocks','adductor-rock-backs','thread-the-needle'],
    flow:['ninety-ninety-hip-switches','downward-upward-dog','worlds-greatest-stretch','squat-to-stand'],
    finish:['cat-cow','downward-upward-dog']};
  const position=exercise=>exercise.bodyPosition==='mixed'?1:exercise.bodyPosition==='floor'?0:2;
  const ESSENTIAL_FOCUSED=['wall-angel','kneeling-ankle-rocks','thread-the-needle'];
  const STYLES=['joint-focused','integrated-flow'];
  function composeV1(options,request,attempt) {
    const {duration,difficulty,catalogue}=options,owned=options.equipment||[],random=options.random||Math.random;
    const excluded=attempt&&attempt.excludedStyleIds||[];
    // Diagnostic reason codes (and a style, when only that style failed) travel with the error.
    const fail=(message,reason,details)=>{const error=new F.FamilyContractError('family-not-feasible',message);
      Object.assign(error,{reason},details);throw error;};
    // Validate the caller's raw constraints before applying the family's Easy policy.
    const raw={workoutFamilyId:FAMILY,workoutFamilyVersion:1,role:'prep',difficulty};
    for(const field of ['excludedImpact','bodyPositions','movementRoom'])if(options[field]!==undefined)raw[field]=options[field];
    F.getMembership(raw,ORDER.prep[0]);
    const context=role=>({...request,role,difficulty,
      excludedImpact:[...new Set([...(options.excludedImpact===undefined?['high']:options.excludedImpact),...(difficulty==='easy'?['medium']:[])])],
      ...(options.bodyPositions===undefined?{}:{bodyPositions:options.bodyPositions}),
      ...(options.movementRoom===undefined?{}:{movementRoom:options.movementRoom})});
    // familyStyleId/bodyFocus belong to identity, not the membership context.
    const contexts={};
    for(const role of Object.keys(ORDER)) {
      const c=context(role);delete c.familyStyleId;delete c.bodyFocus;
      // Validate supplied constraints even when every exercise would otherwise be filtered out.
      F.getMembership(c,ORDER[role][0]);contexts[role]=c;
    }
    const pools=Object.fromEntries(Object.keys(ORDER).map(role=>[role,ORDER[role].map(id=>catalogue[id]).filter(ex=>ex
      &&G.generatedPhaseEligible(ex,'main',owned,difficulty,contexts[role])&&G.protocolCompatible(ex,'rounds',contexts[role]))]));
    // This policy promises a whole-body progression, not a loop made from whichever one
    // or two movements survived. Restricted position/impact requests can honestly be infeasible.
    for(const [role,minimum] of [['prep',2],['focused',4],['flow',4],['finish',2]])
      if(pools[role].length<minimum)fail('Mobility needs more eligible '+role+' movements for broad, connected practice.','insufficient-eligible-movements',{role});
    if(!ESSENTIAL_FOCUSED.every(id=>pools.focused.some(ex=>ex.id===id)))
      fail('Mobility needs shoulder, ankle and thoracic practice in the focused phase.','missing-essential-practice',{role:'focused'});
    const drawn=random()<.5?'joint-focused':'integrated-flow';
    // Same-family fallback keeps the seeded draw and takes the remaining style.
    const style=excluded.includes(drawn)?STYLES.find(id=>!excluded.includes(id)):drawn;
    if(!style)fail('Mobility has no remaining internal style.','no-buildable-style');
    const styleFail=message=>fail(message,'phase-cannot-fit',{familyStyleId:style});
    const targets=PROFILES[duration].map(value=>value*60);
    // Both keep the reference shape; actual emphasis distinguishes the internal styles.
    const emphasis=Math.round(targets[style==='joint-focused'?2:1]*.08);
    targets[1]+=style==='joint-focused'?emphasis:-emphasis;
    targets[2]+=style==='joint-focused'?-emphasis:emphasis;
    const selected={};
    for(const role of Object.keys(ORDER)) {
      const pool=pools[role],core=pool.filter(ex=>CORE[role].includes(ex.id));
      const extras=pool.filter(ex=>!CORE[role].includes(ex.id));
      // A fixed seed changes which optional regions/movements are introduced first.
      const ranked=extras.map(ex=>({ex,rank:random()})).sort((a,b)=>a.rank-b.rank).map(item=>item.ex);
      const added=duration===10?0:duration===15?1:duration===20?2:ranked.length;
      const ids=new Set([...core,...ranked.slice(0,added)].map(ex=>ex.id));
      selected[role]=pool.filter(ex=>ids.has(ex.id));
    }
    // Gentle finish begins on the same level where the last integrated sweep ends.
    const finishStartsStanding=selected.finish[0].bodyPosition==='standing';
    const blocks=[];
    for(const [phase,role] of Object.keys(ORDER).entries()) {
      const list=selected[role],budget=targets[phase]-(phase<3?G.BLOCK_TRANSITION_SECONDS:0);
      const max=role==='finish'?50:difficulty==='easy'?35:difficulty==='hard'?50:45;
      const maxSide=difficulty==='easy'?30:difficulty==='hard'?40:35;
      const preferred=role==='finish'?40:role==='focused'?(style==='joint-focused'?34:20):role==='flow'?(style==='integrated-flow'?34:20):26;
      const sides=ex=>G.sideCount(ex);
      const cap=ex=>sides(ex)===2?maxSide:max;
      // Connected flow uses brief changeovers on the same level. Joint practice
      // retains a deliberate reset; changing body level always gets twelve seconds.
      const gap=(a,b)=>position(a)===position(b)?(role==='flow'&&style==='integrated-flow'?3:7):12;
      const nominal=list.reduce((sum,ex)=>sum+Math.min(preferred,cap(ex))*sides(ex)+(role==='flow'&&style==='integrated-flow'?3:7),0);
      let visits=Math.max(1,Math.round(budget/nominal)),exercises,recovery,values;
      for(;visits<=8;visits++) {
        exercises=[];
        for(let visit=0;visit<visits;visit++) {
          // The finish descends to the floor once; later exposure stays in gentle
          // spinal/dog practice instead of repeatedly getting up for wall angels.
          let sweep=role==='finish'&&visit>0?list.filter(ex=>ex.bodyPosition==='floor'):list.slice();
          if(role==='flow') {
            // Alternating sweeps connect floor -> lunge -> standing and back. The last
            // sweep ends at the finish's level; every sweep practises the full varied set.
            const ascending=visit===visits-1?finishStartsStanding:visit%2===0;
            sweep.sort((a,b)=>(position(a)-position(b))*(ascending?1:-1));
            if(visit===0&&sweep[0].bodyPosition!=='floor') {
              const firstFloor=sweep.findIndex(ex=>ex.bodyPosition==='floor');
              sweep.unshift(...sweep.splice(firstFloor,1));
            }
          } else if(role==='focused') sweep.sort((a,b)=>position(b)-position(a));
          // Avoid immediately repeating the same drill at a return-sweep boundary.
          if(exercises.at(-1)?.id===sweep[0].id&&sweep.length>1) {
            const index=sweep.findIndex(ex=>ex.id!==sweep[0].id&&position(ex)===position(sweep[0]));
            if(index>0)[sweep[0],sweep[index]]=[sweep[index],sweep[0]];
          }
          exercises.push(...sweep);
        }
        recovery=exercises.slice(1).map((ex,index)=>gap(exercises[index],ex));
        const workBudget=budget-recovery.reduce((sum,n)=>sum+n,0);
        if(exercises.reduce((sum,ex)=>sum+cap(ex)*sides(ex),0)<workBudget)continue;
        values=exercises.map(()=>10);
        let remaining=workBudget-exercises.reduce((sum,ex)=>sum+10*sides(ex),0);
        if(remaining<0)styleFail('Mobility cannot fit its minimum controlled practice into this phase.');
        // Round-robin dosing fills actual per-side seconds. A small progression across
        // exposures varies practice without ever turning Hard into maximal stretching.
        const priority=exercises.map((ex,index)=>({index,weight:1+(Math.floor(index/list.length)%3)*.08}));
        while(remaining>0) {
          priority.sort((a,b)=>values[a.index]/a.weight-values[b.index]/b.weight||a.index-b.index);
          const next=priority.find(({index})=>values[index]<cap(exercises[index])&&sides(exercises[index])<=remaining);
          if(!next)break;
          values[next.index]++;remaining-=sides(exercises[next.index]);
        }
        break;
      }
      if(!values)styleFail('Mobility cannot fill the requested time with bounded, varied practice.');
      blocks.push({id:'mobility-'+role,protocol:'rounds',intent:'accessory',familyContext:contexts[role],
        exercises:exercises.map(ex=>JSON.parse(JSON.stringify(ex))),
        prescription:{rounds:1,exerciseRestSeconds:0,roundRestSeconds:0},
        occurrenceTargets:exercises.map((ex,index)=>({plannedPrescription:{type:sides(ex)===2?'unilateral-timed':'timed',value:values[index]}})),
        occurrenceRecoverySeconds:recovery});
    }
    return {familyStyleId:style,blocks};
  }
  // Family quality for the shared gate (#186): the resolved session must still be the published
  // standing preparation -> focused -> flow -> gentle floor finish, low-fatigue timed practice.
  const ROLES=['prep','focused','flow','finish'];
  function qualityV1(workout) {
    const blocks=workout.main.blocks,issues=[],difficulty=workout.difficulty,style=workout.familyStyleId;
    if(blocks.length!==4||blocks.some((block,index)=>!block.familyContext||block.familyContext.workoutFamilyId!==FAMILY||block.familyContext.role!==ROLES[index]))
      return ['phase-structure'];
    const max=difficulty==='easy'?35:difficulty==='hard'?50:45,maxSide=difficulty==='easy'?30:difficulty==='hard'?40:35;
    for(const block of blocks) {
      const role=block.familyContext.role,occurrences=G.resolvedOccurrences(block);
      if(block.protocol!=='rounds'||block.prescription.rounds!==1)issues.push(role+':not-sequential-flow');
      for(const [index,item] of occurrences.entries()) {
        const ex=item.exercise,sides=G.sideCount(ex),cap=sides===2?maxSide:role==='finish'?50:max;
        if(!item.timed||!(item.seconds>=10&&item.seconds<=cap))issues.push(role+':dose-out-of-range:'+ex.id);
        if(ex.impact==='high'||difficulty==='easy'&&ex.impact==='medium')issues.push(role+':impact:'+ex.id);
        if(role==='prep'&&ex.bodyPosition!=='standing')issues.push('prep:not-standing:'+ex.id);
        const next=occurrences[index+1];
        if(next) {
          // Same-level changeovers follow the style; a change of body level always gets twelve seconds.
          const expected=position(ex)!==position(next.exercise)?12:role==='flow'&&style==='integrated-flow'?3:7;
          if(item.restAfter!==expected)issues.push(role+':transition-mismatch:'+index);
        }
      }
    }
    const focused=blocks[1].exercises.map(ex=>ex.id);
    ESSENTIAL_FOCUSED.filter(id=>!focused.includes(id)).forEach(id=>issues.push('missing-region-coverage:'+id));
    return [...new Set(issues)];
  }
  // Training-purpose sections (#242): standing preparation reads as Warm-up and the gentle finish
  // as Cool-down; focused practice and the connected flow (which ramps naturally) stay Main.
  const stageSection=block=>block.familyContext&&block.familyContext.role==='prep'&&block.id==='mobility-prep'?'warmup'
    :block.familyContext&&block.familyContext.role==='finish'&&block.id==='mobility-finish'?'cooldown':'main';
  // ---- Composition v2 (#264): purposeful regional emphasis, duration-sensitive coverage and selective repetition ----
  // Published v1 above is untouched. v2 draws every approved member (membership v2) by region, stage and soft
  // sequencing preference instead of fixed ordered lists; membership, equipment, impact, position and dose gates stay central.
  const REGIONS=['lower','upper','trunk'];
  // Mobility-local region mapping (no catalogue metadata): primary region first, then secondary involvement.
  const REGION_MAP={
    'open-close-gates':['lower'],'body-hoops':['lower','trunk'],'body-twists':['trunk'],'trx-squat-overhead':['lower','upper'],
    'shallow-knee-bends':['lower'],'heel-toe-rocks':['lower'],'ankle-circles':['lower'],'leg-swings-forward-back':['lower'],
    'leg-swings-side':['lower'],'hamstring-sweeps':['lower'],'shoulder-rolls':['upper'],'standing-side-bends':['trunk'],
    'trx-lateral-weight-shift':['lower'],'kneeling-ankle-rocks':['lower'],'cat-cow':['trunk'],'standing-hip-rotations':['lower'],
    'squat-to-stand':['lower'],'controlled-shoulder-rotations':['upper'],'wall-angel':['upper'],'hip-flexor-arm-stretch':['lower'],
    'runners-stretch':['lower'],'ninety-ninety-hip-switches':['lower'],'thread-the-needle':['upper','trunk'],
    'adductor-rock-backs':['lower'],'quadruped-thoracic-rotation':['upper','trunk'],'supported-squat-rocks':['lower'],
    'half-kneeling-hip-flexor-rocks-with-reach':['lower','upper'],'downward-upward-dog':['trunk','upper','lower'],
    'cossack-squat':['lower'],'worlds-greatest-stretch':['lower','upper','trunk'],'childs-pose':['trunk','upper'],
    'chest-opener':['upper'],'glute-stretch':['lower'],'lying-torso-twist':['trunk']};
  // Static holds: membership already confines them to Focus/Finish; here they stay selective and short.
  const STATIC=new Set(['hip-flexor-arm-stretch','runners-stretch','childs-pose','chest-opener','glute-stretch','lying-torso-twist']);
  // Near-duplicates, simplest first. Same-session repeats cost a lot; a later, more developed member in a later stage is a progression.
  const NEAR=[['shoulder-rolls','controlled-shoulder-rotations'],['ankle-circles','heel-toe-rocks','kneeling-ankle-rocks'],
    ['open-close-gates','body-hoops','standing-hip-rotations'],['leg-swings-forward-back','leg-swings-side'],
    ['thread-the-needle','quadruped-thoracic-rotation'],['shallow-knee-bends','squat-to-stand','supported-squat-rocks','trx-squat-overhead'],
    ['hip-flexor-arm-stretch','runners-stretch','half-kneeling-hip-flexor-rocks-with-reach']];
  // Capture each published revision's relationships in its own closure. Extending v3 must never
  // reinterpret v2 selection, historical evidence, static holds or quality validation.
  function policy(regionMap, staticIds, near) {
  const regionsOf=id=>regionMap[id]||[];
  const clusterOf=id=>near.findIndex(group=>group.includes(id));
  const REGION_ORDER={prep:['lower','trunk','upper'],focused:['lower','trunk','upper'],flow:['upper','trunk','lower'],finish:['upper','lower','trunk']};
  const DESCEND_FIRST={prep:true,focused:true,flow:false,finish:true};
  const MIN_ITEMS={prep:2,focused:3,flow:3,finish:2},POOL_MIN={prep:2,focused:4,flow:4,finish:2};
  // Primary credit 1, secondary credit .5 per occurrence.
  function regionTotals(ids) {
    const totals={lower:0,upper:0,trunk:0};
    for(const id of ids)regionsOf(id).forEach((region,index)=>{totals[region]+=index?.5:1;});
    return totals;
  }
  // Emphasis of a performed Focus stage, or null when the evidence is partial, untagged or ambiguous. Deliberately
  // conservative: only a clear lower-body or shoulder/upper-back skew is named (a balanced session is never labelled).
  function inferEmphasis(focusIds) {
    if(!Array.isArray(focusIds)||focusIds.length<4||focusIds.some(id=>typeof id!=='string'||!regionMap[id]))return null;
    const totals=regionTotals(focusIds),sum=REGIONS.reduce((total,region)=>total+totals[region],0),share=region=>totals[region]/sum;
    // Joint-focused/integrated-flow never enter this: they are pacing styles recorded separately.
    if(share('lower')>=.5&&share('lower')-Math.max(share('upper'),share('trunk'))>=.2)return 'lower';
    if(share('upper')>=.42&&share('upper')-share('lower')>=.1&&share('upper')-share('trunk')>=.12)return 'upper';
    return null;
  }
  // The newest completed Mobility session from Training History (composition v2+ only: v1 swept the whole pool).
  function recentSession(options) {
    const session=options.recentFamilySessions&&options.recentFamilySessions[FAMILY];
    return session&&Array.isArray(session.completedOccurrences)&&session.plannedOccurrences>0?session:null;
  }
  function recentEmphasis(options) {
    const session=recentSession(options);
    if(!session||!(session.workoutFamilyVersion>=2)||session.completedOccurrences.length<session.plannedOccurrences*.75)return null;
    return inferEmphasis(session.completedOccurrences.filter(item=>item.blockIndex===1).map(item=>item.exerciseId));
  }
  // A seeded draw that mildly prefers a different emphasis from the previous session; never a rotation.
  function chooseEmphasis(random,feasible,previous) {
    const weights=feasible.map(emphasis=>emphasis===previous?.5:1),total=weights.reduce((sum,value)=>sum+value,0);
    let draw=random()*total;
    for(const [index,emphasis] of feasible.entries()) { draw-=weights[index];if(draw<0)return emphasis; }
    return feasible.at(-1);
  }
  // Target share of practice per region. Focus carries the full emphasis (60% of the primary region in 10 minutes, 50% in
  // 15-20, 42% in 30-45); Prepare, Flow and Finish stay half-way to even so the whole body is always practised.
  const regionShares=(emphasis,duration,role)=>{
    const primary=duration===10?.6:duration<=20?.5:.42;
    const even=emphasis==='full'?1/3:null;
    return Object.fromEntries(REGIONS.map(region=>{
      const main=even??(region===emphasis?primary:(1-primary)/2);
      return [region,role==='focused'?main:(main+1/3)/2];
    }));
  };
  // Weight of the regional-need term against the soft sequencing and variety terms in stage selection.
  const NEED_WEIGHT=3;
  // Minimum distinct movements practising each region, by duration.
  const coverageMinimum=duration=>duration===10?1:duration<=20?2:3;
  function coverageIssues(ids,duration) {
    const distinct=Object.fromEntries(REGIONS.map(region=>[region,new Set()]));
    for(const id of ids)regionsOf(id).forEach(region=>distinct[region].add(id));
    return REGIONS.filter(region=>distinct[region].size<coverageMinimum(duration)).map(region=>'missing-region-coverage:'+region);
  }
  // An unchanged run of four movements played again is a replayed sequence; repeated triples are only avoided when a reorder can.
  const grams=(sequence,size)=>sequence.slice(size-1).map((_,index)=>sequence.slice(index,index+size).join('>'));
  const repeatsGram=(sequence,earlier,size)=>{
    const seen=new Set(earlier);
    return grams(sequence,size).some(key=>seen.size===seen.add(key).size);
  };
  const dosing=difficulty=>({max:difficulty==='easy'?35:difficulty==='hard'?50:45,maxSide:difficulty==='easy'?30:difficulty==='hard'?40:35});

  function composeV2(options,request,attempt) {
    const {duration,difficulty,catalogue}=options,owned=options.equipment||[],random=options.random||Math.random;
    const excluded=attempt&&attempt.excludedStyleIds||[],version=request.workoutFamilyVersion;
    const fail=(message,reason,details)=>{const error=new F.FamilyContractError('family-not-feasible',message);
      Object.assign(error,{reason},details);throw error;};
    const raw={workoutFamilyId:FAMILY,workoutFamilyVersion:version,role:'prep',difficulty};
    for(const field of ['excludedImpact','bodyPositions','movementRoom'])if(options[field]!==undefined)raw[field]=options[field];
    F.getMembership(raw,'ninety-ninety-hip-switches');
    const context=role=>({...request,role,difficulty,
      excludedImpact:[...new Set([...(options.excludedImpact===undefined?['high']:options.excludedImpact),...(difficulty==='easy'?['medium']:[])])],
      ...(options.bodyPositions===undefined?{}:{bodyPositions:options.bodyPositions}),
      ...(options.movementRoom===undefined?{}:{movementRoom:options.movementRoom})});
    const contexts={};
    for(const role of ROLES) {
      const c=context(role);delete c.familyStyleId;delete c.bodyFocus;
      F.getMembership(c,'ninety-ninety-hip-switches');contexts[role]=c;
    }
    // Every approved member is a candidate: membership (not a fixed list) decides eligibility.
    const members=Object.keys(catalogue).filter(id=>ROLES.some(role=>F.getMembership({workoutFamilyId:FAMILY,workoutFamilyVersion:version,role},id)));
    const pools=Object.fromEntries(ROLES.map(role=>[role,members.map(id=>catalogue[id]).filter(ex=>ex
      &&G.generatedPhaseEligible(ex,'main',owned,difficulty,contexts[role])&&G.protocolCompatible(ex,'rounds',contexts[role]))]));
    for(const role of ROLES)
      if(pools[role].length<POOL_MIN[role])fail('Mobility needs more eligible '+role+' movements for broad, connected practice.','insufficient-eligible-movements',{role});
    const mainPool=[...new Set([...pools.focused,...pools.flow].map(ex=>ex.id))];
    for(const region of REGIONS)
      if(mainPool.filter(id=>regionsOf(id).includes(region)).length<2)
        fail('Mobility needs lower-body, shoulder/upper-back and trunk practice in its focused and flow stages.','missing-essential-practice',{role:'focused'});
    const drawn=random()<.5?'joint-focused':'integrated-flow';
    const style=excluded.includes(drawn)?STYLES.find(id=>!excluded.includes(id)):drawn;
    if(!style)fail('Mobility has no remaining internal style.','no-buildable-style');
    const styleFail=(message,reason='phase-cannot-fit')=>fail(message,reason,{familyStyleId:style});
    // Internal emphasis: seeded, mildly away from the previous completed session's inferable emphasis.
    const feasible=['lower','upper'].filter(region=>mainPool.filter(id=>(regionsOf(id)[0]===region)).length>=2).concat('full');
    const emphasis=chooseEmphasis(random,feasible,recentEmphasis(options));
    const recency=new Map();
    (Array.isArray(options.history)?options.history:[]).slice(0,4).forEach((ids,index)=>{
      if(Array.isArray(ids))for(const id of ids)recency.set(id,Math.max(recency.get(id)||0,index===0?1:.5));
    });
    const latest=recentSession(options);
    if(latest)for(const item of latest.completedOccurrences)recency.set(item.exerciseId,1);

    const targets=PROFILES[duration].map(value=>value*60);
    const shift=Math.round(targets[style==='joint-focused'?2:1]*.08);
    targets[1]+=style==='joint-focused'?shift:-shift;
    targets[2]+=style==='joint-focused'?-shift:shift;
    const {max,maxSide}=dosing(difficulty);
    const used=new Map(),coverage=Object.fromEntries(REGIONS.map(region=>[region,new Set()])),earlierGrams={3:[],4:[]};
    const sameGap=role=>role==='flow'&&style==='integrated-flow'?3:7;
    const blocks=[];
    let previousLevel=null;
    for(const [phase,role] of ROLES.entries()) {
      const budget=targets[phase]-(phase<3?G.BLOCK_TRANSITION_SECONDS:0),pool=pools[role],sides=ex=>G.sideCount(ex);
      const bounds=ex=>{
        const entry=F.getMembership(contexts[role],ex.id),type=sides(ex)===2?'unilateral-timed':'timed';
        const target=entry.prescriptions.find(item=>item.type===type);
        const lo=Math.max(10,target.minValue),hi=Math.max(lo,Math.min(target.maxValue,sides(ex)===2?maxSide:role==='finish'?50:max,staticIds.has(ex.id)?30:Infinity));
        const base=staticIds.has(ex.id)?25:role==='finish'?40:role==='focused'?(style==='joint-focused'?34:20):role==='flow'?(style==='integrated-flow'?34:20):26;
        return {lo,hi,pref:Math.min(hi,Math.max(lo,base))};
      };
      const bound=new Map(pool.map(ex=>[ex.id,bounds(ex)]));
      const jitters=[];
      const jitter=salt=>{
        // The small deterministic offset keeps ties (a constant or coarse random source) from freezing every reorder.
        while(jitters.length<=salt)jitters.push(new Map(pool.map((ex,index)=>[ex.id,random()+((index*37+jitters.length*101)%97)/97e3])));
        return jitters[salt];
      };
      const shares=regionShares(emphasis,duration,role),isMain=role==='focused'||role==='flow';
      const staticCap=role==='focused'?(duration>=30?2:1):Infinity;
      // Order one pass: group by body level so the pass changes level as few times as possible, starting where the
      // previous movement ended; regions then stay together within a level.
      const orderPass=(list,start,salt,preferDown,pass,grouped)=>{
        // The emphasised region leads each level group in Focus and Flow; return passes run the regions the other way round,
        // and a retry drops region grouping to break a repeated sequence.
        const order=isMain&&emphasis!=='full'?[emphasis,...REGION_ORDER[role].filter(region=>region!==emphasis)]:REGION_ORDER[role];
        const rank=ex=>grouped?(pass%2?2-order.indexOf(regionsOf(ex.id)[0]):order.indexOf(regionsOf(ex.id)[0])):0;
        const sorted=direction=>list.slice().sort((a,b)=>direction*(position(a)-position(b))||rank(a)-rank(b)||jitter(salt).get(a.id)-jitter(salt).get(b.id));
        const cost=arr=>(start!==null&&arr.length&&position(arr[0])!==start?1:0)+arr.filter((ex,index)=>index&&position(ex)!==position(arr[index-1])).length;
        const up=sorted(1),down=sorted(-1);
        return cost(up)<cost(down)?up:cost(down)<cost(up)?down:preferDown?down:up;
      };
      const layout=(base,passes,retry)=>{
        const sequence=[];
        let end=previousLevel,down=DESCEND_FIRST[role];
        [base,...passes].forEach((list,index)=>{
          if(!list.length)return;
          let ordered=orderPass(list,end,retry*13+index*7,down,index,retry===0);
          if(sequence.length&&ordered.length>1&&ordered[0].id===sequence.at(-1).ex.id)ordered=[ordered[1],ordered[0],...ordered.slice(2)];
          down=ordered.length>1?position(ordered[0])<position(ordered.at(-1)):down;
          end=position(ordered.at(-1));
          ordered.forEach(ex=>sequence.push({ex,returning:index>0}));
        });
        const items=sequence.map(({ex,returning})=>{
          const b=bound.get(ex.id);
          return {ex,sides:sides(ex),lo:b.lo,hi:b.hi,pref:returning?Math.min(b.hi,Math.max(b.lo,Math.round(b.pref*.7))):b.pref};
        });
        const gaps=items.slice(1).map((item,index)=>position(items[index].ex)===position(item.ex)?sameGap(role):12);
        const gapTotal=gaps.reduce((sum,n)=>sum+n,0),time=key=>items.reduce((sum,item)=>sum+item[key]*item.sides,0)+gapTotal;
        return {items,gaps,lo:time('lo'),hi:time('hi'),pref:time('pref'),ids:items.map(item=>item.ex.id)};
      };
      // Greedy, scored selection: region need for this emphasis and duration, soft sequencing and variety.
      const stageScore=(ex,picked,returning)=>{
        const regions=regionsOf(ex.id),have={lower:0,upper:0,trunk:0};
        for(const item of picked)regionsOf(item.id).forEach((region,index)=>{have[region]+=index?.5:1;});
        // Weighted mean deficit over the regions it practises, so a movement is not favoured merely for touching several.
        let score=0,weight=0;
        regions.forEach((region,index)=>{const w=index?.5:1;score+=w*(shares[region]*(picked.length+1)-have[region]);weight+=w;});
        score=weight?NEED_WEIGHT*score/weight:0;
        if(isMain)for(const region of regions) {
          const covered=new Set([...coverage[region],...picked.filter(item=>regionsOf(item.id).includes(region)).map(item=>item.id)]);
          if(covered.size<coverageMinimum(duration)&&!covered.has(ex.id))score+=1.2;
        }
        if(role==='flow'&&emphasis==='full')score+=.8*(regions.length-1)/2;
        score-=1.1*(recency.get(ex.id)||0);
        score-=(returning?.7:1.4)*(used.get(ex.id)||0);
        const cluster=clusterOf(ex.id);
        if(cluster>=0)for(const earlier of near[cluster]) {
          if(earlier===ex.id)continue;
          if(picked.some(item=>item.id===earlier))score-=duration>=30?1:2.5;
          else if(used.has(earlier))score-=near[cluster].indexOf(ex.id)>near[cluster].indexOf(earlier)?.5:2;
        }
        if(staticIds.has(ex.id))score-=.8;
        const levels=new Set(picked.map(position));
        if(picked.length&&!levels.has(position(ex)))score-=(role==='finish'?1.2:.3)*levels.size;
        if(!picked.length&&previousLevel!==null&&position(ex)!==previousLevel&&role==='finish')score-=.6;
        if(role==='prep'&&ex.bodyPosition!=='standing')score-=2.5;
        return score+.6*jitter(0).get(ex.id);
      };
      // One scored pool of candidates: a movement not yet in the stage, or (only once long sessions need it) a
      // selective return to an active movement already practised. Returns form shorter passes after the first.
      let base=[],current=layout([],[],0);
      const passes=[],remaining=pool.slice(),inStage=id=>base.concat(...passes).filter(item=>item.id===id).length;
      const passCap=()=>Math.max(2,Math.ceil(base.length*.6));
      const withReturn=(ex)=>{
        const next=passes.map(list=>list.slice()),index=next.findIndex(list=>!list.some(item=>item.id===ex.id)&&list.length<passCap());
        if(index<0)next.push([ex]);else next[index].push(ex);
        return next;
      };
      let tier=0;
      while(true) {
        const picked=base.concat(...passes);
        let best=null;
        const consider=(ex,returning)=>{
          const trial=returning?layout(base,withReturn(ex),0):layout(base.concat(ex),passes,0);
          if(trial.lo>budget)return;
          const score=stageScore(ex,picked,returning)-(returning?.3+.6*inStage(ex.id):0);
          if(!best||score>best.score)best={ex,score,trial,returning};
        };
        for(const ex of remaining)
          if(!(staticIds.has(ex.id)&&picked.filter(item=>staticIds.has(item.id)).length>=staticCap))consider(ex,false);
        // Tier 0 keeps a movement to two visits in a stage and three in the session; only a pool too small to
        // fill the time (a restricted or Easy session) widens that in two steps, to four visits in a stage and six in the session at most.
        if(duration>=30&&isMain||!remaining.length)
          for(const ex of base)
            if(!staticIds.has(ex.id)&&inStage(ex.id)<[2,3,4][tier]&&inStage(ex.id)+(used.get(ex.id)||0)<[3,5,6][tier])consider(ex,true);
        if(!best&&tier<2&&current.hi<budget){tier++;continue;}
        if(!best)break;
        // Stop at the closer of the two lists around the budget, unless the shorter one cannot be dosed to fill it.
        if(best.trial.pref>budget&&base.length>=MIN_ITEMS[role]&&current.hi>=budget&&Math.abs(best.trial.pref-budget)>=Math.abs(current.pref-budget))break;
        if(best.returning)passes.splice(0,passes.length,...withReturn(best.ex));
        else{base=base.concat(best.ex);remaining.splice(remaining.indexOf(best.ex),1);}
        current=best.trial;
        if(current.pref>=budget)break;
      }
      // Re-order (never re-select) when a stage would replay an unchanged four-movement sequence (triples too, if a reorder can).
      const earlierIds=blocks.flatMap(block=>block.exercises.map(ex=>ex.id)),tail=size=>earlierIds.slice(Math.max(0,earlierIds.length-size+1));
      const adjacent=candidate=>tail(2).concat(candidate.ids).some((id,index,all)=>index&&id===all[index-1]);
      const replays=(candidate,size)=>adjacent(candidate)||repeatsGram(tail(size).concat(candidate.ids),earlierGrams[size],size);
      let final=layout(base,passes,0),acceptable=replays(final,4)?null:final;
      for(let retry=1;retry<40&&(replays(final,3)||!acceptable);retry++) {
        final=layout(base,passes,retry);
        if(!acceptable&&!replays(final,4))acceptable=final;
        if(!replays(final,3)&&!replays(final,4)){acceptable=final;break;}
      }
      if(replays(final,3)||replays(final,4))final=acceptable||final;
      if(replays(final,4)||final.items.length<MIN_ITEMS[role]||new Set(final.ids).size<MIN_ITEMS[role])styleFail('Mobility cannot fit enough varied practice into the '+role+' stage.');
      // Exact whole-second dosing within each movement's bounds; a single odd second joins a changeover.
      const {items}=final,gaps=final.gaps.slice(),values=items.map(item=>item.pref);
      let left=budget-gaps.reduce((sum,n)=>sum+n,0)-items.reduce((sum,item,index)=>sum+values[index]*item.sides,0);
      const spread=index=>(values[index]-items[index].pref)/Math.max(1,items[index].hi-items[index].lo);
      let bumped=false;
      while(left!==0) {
        const direction=left>0?1:-1;
        let pick=-1;
        for(const [index,item] of items.entries()) {
          if(values[index]+direction<item.lo||values[index]+direction>item.hi||item.sides>Math.abs(left))continue;
          if(pick<0||direction*(spread(index)-spread(pick))<0)pick=index;
        }
        // Only per-side movements can still absorb time: one odd second lengthens a changeover.
        if(pick<0&&!bumped&&gaps.length&&Math.abs(left)%2===1) {
          const index=gaps.findLastIndex(gap=>gap<=13);
          if(index>=0){gaps[index]++;left--;bumped=true;continue;}
        }
        if(pick<0)break;
        values[pick]+=direction;left-=direction*items[pick].sides;
      }
      if(left!==0)styleFail('Mobility cannot fill the '+role+' stage with bounded practice.');
      blocks.push({id:'mobility-'+role,protocol:'rounds',intent:'accessory',familyContext:contexts[role],
        exercises:items.map(item=>JSON.parse(JSON.stringify(item.ex))),
        prescription:{rounds:1,exerciseRestSeconds:0,roundRestSeconds:0},
        occurrenceTargets:items.map((item,index)=>({plannedPrescription:{type:item.sides===2?'unilateral-timed':'timed',value:values[index]}})),
        occurrenceRecoverySeconds:gaps});
      for(const item of items) {
        used.set(item.ex.id,(used.get(item.ex.id)||0)+1);
        if(isMain)regionsOf(item.ex.id).forEach(region=>coverage[region].add(item.ex.id));
      }
      for(const size of [3,4])earlierGrams[size]=grams(blocks.flatMap(block=>block.exercises.map(ex=>ex.id)),size);
      previousLevel=position(items.at(-1).ex);
    }
    if(coverageIssues(blocks.flatMap(block=>block.exercises.map(ex=>ex.id)),duration).length)
      styleFail('Mobility cannot cover lower-body, shoulder/upper-back and trunk practice at this length.','missing-essential-practice');
    return {familyStyleId:style,blocks};
  }

  // Family quality for v2: staged Prepare -> Focus -> Flow -> Finish, low-fatigue timed practice, region coverage by
  // duration, static holds only in Focus/Finish, soft-sequencing outcomes that must hold (no unchanged repeated sequences).
  function qualityV2(workout) {
    const blocks=workout.main.blocks,issues=[],difficulty=workout.difficulty,style=workout.familyStyleId,constraints=workout.familyConstraints||{};
    if(blocks.length!==4||blocks.some((block,index)=>!block.familyContext||block.familyContext.workoutFamilyId!==FAMILY
      ||block.familyContext.workoutFamilyVersion!==workout.workoutFamilyVersion||block.familyContext.role!==ROLES[index]))return ['phase-structure'];
    const {max,maxSide}=dosing(difficulty),standingAllowed=!constraints.bodyPositions||constraints.bodyPositions.includes('standing');
    const sequence=[],counts=new Map();
    for(const block of blocks) {
      const role=block.familyContext.role,occurrences=G.resolvedOccurrences(block),ids=occurrences.map(item=>item.exercise.id);
      if(block.protocol!=='rounds'||block.prescription.rounds!==1)issues.push(role+':not-sequential-flow');
      if(new Set(ids).size<MIN_ITEMS[role])issues.push(role+':too-few-movements');
      for(const [index,item] of occurrences.entries()) {
        const ex=item.exercise,sides=G.sideCount(ex),cap=sides===2?maxSide:role==='finish'?50:max;
        if(!item.timed||!(item.seconds>=10&&item.seconds<=cap))issues.push(role+':dose-out-of-range:'+ex.id);
        if(ex.impact==='high'||difficulty==='easy'&&ex.impact==='medium')issues.push(role+':impact:'+ex.id);
        if(role==='prep'&&standingAllowed&&ex.bodyPosition!=='standing')issues.push('prep:not-standing:'+ex.id);
        if(staticIds.has(ex.id)&&role!=='focused'&&role!=='finish')issues.push(role+':static-outside-focus-finish:'+ex.id);
        const next=occurrences[index+1];
        if(next) {
          if(next.exercise.id===ex.id)issues.push(role+':adjacent-repeat:'+ex.id);
          // A change of body level always gets twelve seconds; same-level changeovers follow the style.
          const expected=position(ex)!==position(next.exercise)?12:role==='flow'&&style==='integrated-flow'?3:7;
          if(item.restAfter<expected||item.restAfter>14)issues.push(role+':transition-mismatch:'+index);
        }
        counts.set(ex.id,(counts.get(ex.id)||0)+1);
      }
      sequence.push(...ids);
    }
    sequence.forEach((id,index)=>{if(index&&id===sequence[index-1])issues.push('adjacent-repeat:'+id);});
    for(const [id,count] of counts)if(count>6)issues.push('excessive-repetition:'+id);
    if(repeatsGram(sequence,[],4))issues.push('repeated-sequence');
    issues.push(...coverageIssues(sequence,workout.duration));
    return [...new Set(issues)];
  }
    return {compose:composeV2,quality:qualityV2,helpers:Object.freeze({REGIONS,regionsOf,inferEmphasis,recentEmphasis,chooseEmphasis,isStatic:id=>staticIds.has(id)})};
  }
  const v2=policy(REGION_MAP,STATIC,NEAR);
  const v3=policy({...REGION_MAP,
    'standing-calf-stretch':['lower'],'bent-knee-calf-stretch':['lower'],
    'seated-ninety-ninety-hip-lift-offs':['lower'],'supine-hamstring-stretch':['lower'],'butterfly-stretch':['lower'],
    'standing-hinge-and-reach':['lower','upper','trunk'],'side-lying-open-books':['upper','trunk'],
    'seated-thoracic-extension':['upper','trunk'],'standing-wall-slides':['upper'],'standing-lat-stretch':['upper'],
    'quadruped-wrist-rocks':['upper'],'downward-facing-dog':['upper','lower'],
    'upward-facing-dog':['trunk','upper'],'low-cobra-pose':['trunk'],'extended-puppy-pose':['upper','trunk'],
    'kneeling-hamstring':['lower'],'inside-thigh-stretch':['lower'],'frog-stretch':['lower'],
    'plank-calf-stretch':['lower'],'side-stretch':['trunk'],'arm-across-pull':['upper']},
    // Active supported holds in Flow (both Dogs and alternating plank-calf) are intentionally
    // separate from passive STATIC stretches. Their membership doses and difficulty gates still apply.
    new Set([...STATIC,'standing-calf-stretch','bent-knee-calf-stretch','supine-hamstring-stretch','butterfly-stretch',
      'standing-lat-stretch','low-cobra-pose','extended-puppy-pose','kneeling-hamstring','inside-thigh-stretch',
      'frog-stretch','side-stretch','arm-across-pull']),
    [...NEAR.map(group=>group.includes('thread-the-needle')?group.concat('side-lying-open-books'):group),
      ['standing-calf-stretch','bent-knee-calf-stretch','plank-calf-stretch'],
      ['supine-hamstring-stretch','kneeling-hamstring'],['butterfly-stretch','inside-thigh-stretch','frog-stretch'],
      ['ninety-ninety-hip-switches','seated-ninety-ninety-hip-lift-offs'],
      ['wall-angel','standing-wall-slides'],['standing-side-bends','side-stretch'],
      ['standing-lat-stretch','extended-puppy-pose','childs-pose'],
      ['low-cobra-pose','downward-facing-dog','upward-facing-dog','downward-upward-dog']]);
  // Public helpers retain their v2 default; callers interpreting v3 evidence choose its local policy explicitly.
  root.GarageFitMobilityComposer=Object.freeze({...v2.helpers,forVersion:version=>{if(version===2)return v2.helpers;if(version===3)return v3.helpers;throw new RangeError('Unsupported regional Mobility policy: '+version);}});
  G.registerFamilyComposer(FAMILY,1,composeV1,qualityV1,stageSection);
  G.registerFamilyComposer(FAMILY,2,v2.compose,v2.quality,stageSection);
  G.registerFamilyComposer(FAMILY,3,v3.compose,v3.quality,stageSection);
})(typeof window==='undefined'?globalThis:window);
