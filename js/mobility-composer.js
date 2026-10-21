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
  function compose(options,request,attempt) {
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
  function quality(workout) {
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
  G.registerFamilyComposer(FAMILY,1,compose,quality);
})(typeof window==='undefined'?globalThis:window);
