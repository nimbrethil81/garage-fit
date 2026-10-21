(function (root) {
  const G=root.GarageFitGenerator,F=root.GarageFitWorkoutFamilies,FAMILY='athletic-movement';
  const PROFILES={10:[2,3,3,2],15:[3,4,5,3],20:[3,6,6,5],30:[4,9,10,7],45:[5,14,15,11]};
  // Composition preferences only: the reviewed central membership remains authoritative.
  const ORDER={
    footwork:['forward-back-line-steps','lateral-step-and-stick','quarter-turn-pivot-steps','grapevine-cross-steps','lateral-shuffle'],
    control:['single-leg-balance-reach','quarter-turn-pivot-steps','lateral-step-and-stick','knee-to-opposite-elbow','forward-back-line-steps'],
    integrated:['grapevine-cross-steps','lateral-shuffle','reverse-lunge-knee-drive','bear-crawl','alternating-lateral-lunge','skater-jumps']
  };
  const STYLES=['footwork-coordination','dynamic-balance','integrated-movement'];
  function compose(options,request) {
    const {duration,difficulty,catalogue}=options,owned=options.equipment||[],random=options.random||Math.random;
    const fail=message=>{throw new F.FamilyContractError('family-not-feasible',message);};
    const contexts={};
    for(const role of Object.keys(ORDER)) {
      const context={workoutFamilyId:FAMILY,workoutFamilyVersion:request.workoutFamilyVersion,role,difficulty};
      for(const field of ['excludedImpact','bodyPositions','movementRoom'])if(options[field]!==undefined)context[field]=options[field];
      F.getMembership(context,ORDER[role][0]); // Validate raw constraints before filtering.
      // High impact is an optional Hard route, never an automatic difficulty requirement.
      if(difficulty!=='hard')context.excludedImpact=[...new Set([...(context.excludedImpact||['high']),'high'])];
      contexts[role]=context;
    }
    const pools=Object.fromEntries(Object.keys(ORDER).map(role=>[role,ORDER[role].map(id=>catalogue[id]).filter(ex=>ex
      &&G.generatedPhaseEligible(ex,'main',owned,difficulty,contexts[role])&&G.protocolCompatible(ex,'rounds',contexts[role]))]));
    for(const role of Object.keys(ORDER))if(pools[role].length<2)
      fail('Athletic Movement needs at least two eligible '+role+' drills; low-impact-only integrated practice needs confirmed movement room.');
    const has=(role,id)=>pools[role].some(ex=>ex.id===id);
    if(!['forward-back-line-steps','lateral-step-and-stick','quarter-turn-pivot-steps'].every(id=>has('footwork',id))
      ||!has('control','single-leg-balance-reach')||!has('control','knee-to-opposite-elbow'))
      fail('Athletic Movement needs standing forward/back, lateral, rotation and balance practice.');
    const style=STYLES[Math.min(2,Math.floor(random()*3))],targets=PROFILES[duration].map(n=>n*60);
    const emphasized=STYLES.indexOf(style)+1,donor=emphasized===1?2:1;
    const shift=Math.round(targets[donor]*.08);targets[emphasized]+=shift;targets[donor]-=shift;
    const blocks=[];
    const copy=ex=>JSON.parse(JSON.stringify(ex));
    const light=ids=>ids.map(id=>catalogue[id]);
    const recovery=(a,b,stage)=>{
      // Every gap follows both sides; floor changes, landing practice and demanding
      // combinations receive deliberate resets. Hard never shortens these rests.
      if(a.impact==='high'||b.impact==='high')return 40;
      if(a.bodyPosition!==b.bodyPosition)return 25;
      if(a.bodyPosition==='floor'||b.bodyPosition==='floor')return 25;
      if(a.impact==='medium'||b.impact==='medium')return 20;
      if(G.sideCount(a)===2||G.sideCount(b)===2)return 16;
      return stage==='preparation'||stage==='finish'?8:style==='footwork-coordination'?12:15;
    };
    function drill(stage,role,list,budget) {
      // The three-second shared transition is part of this phase's allocation.
      budget-=G.BLOCK_TRANSITION_SECONDS;
      const cap=ex=>ex.impact==='high'?15:ex.bodyPosition==='floor'?20:G.sideCount(ex)===2?22:difficulty==='easy'?25:30;
      const preferred=ex=>stage==='preparation'||stage==='finish'?18:ex.impact==='high'?12:
        G.sideCount(ex)===2?(style==='dynamic-balance'?18:14):style==='footwork-coordination'&&role==='footwork'?22:20;
      let best;
      for(let rounds=1;rounds<=6;rounds++) {
        const sequence=Array.from({length:rounds},()=>list).flat();
        const gaps=sequence.slice(1).map((ex,i)=>recovery(sequence[i],ex,stage));
        const rest=gaps.reduce((sum,n)=>sum+n,0),minimum=sequence.reduce((sum,ex)=>sum+10*G.sideCount(ex),rest);
        const maximum=sequence.reduce((sum,ex)=>sum+cap(ex)*G.sideCount(ex),rest+gaps.length*25);
        if(budget<minimum||budget>maximum)continue;
        const nominal=sequence.reduce((sum,ex)=>sum+preferred(ex)*G.sideCount(ex),rest);
        const score=Math.abs(budget-nominal);
        if(!best||score<best.score)best={rounds,sequence,gaps,score};
      }
      if(!best)fail('Athletic Movement cannot fit bounded technical efforts and recovery into '+stage+' ('+budget+' s; '+list.map(ex=>ex.id).join(', ')+').');
      const {rounds,sequence,gaps}=best,values=sequence.map(()=>10);
      let remaining=budget-gaps.reduce((sum,n)=>sum+n,0)-sequence.reduce((sum,ex)=>sum+10*G.sideCount(ex),0);
      while(remaining>0) {
        // Vary exposure modestly, without increasing fatigue from round to round.
        const ranked=sequence.map((ex,index)=>({ex,index,ratio:values[index]/(preferred(ex)+(Math.floor(index/list.length)%2))}))
          .sort((a,b)=>a.ratio-b.ratio||a.index-b.index);
        const next=ranked.find(({ex,index})=>values[index]<cap(ex)&&G.sideCount(ex)<=remaining);
        if(!next)break;
        values[next.index]++;remaining-=G.sideCount(next.ex);
      }
      // Odd unilateral budgets and small fitting differences extend recovery only.
      for(let i=0;remaining>0;i=(i+1)%gaps.length){gaps[i]++;remaining--;}
      blocks.push({id:'athletic-'+stage+'-'+(blocks.length+1),protocol:'rounds',intent:'accessory',familyContext:contexts[role],
        exercises:list.map(copy),prescription:{rounds,exerciseRestSeconds:0,roundRestSeconds:0},
        occurrenceTargets:sequence.map((ex,i)=>({plannedPrescription:{type:G.sideCount(ex)===2?'unilateral-timed':'timed',value:values[i]}})),
        occurrenceRecoverySeconds:gaps});
    }
    // Small related rotations introduce new combinations before adding exposure. The
    // standing last movement leads into active recovery, never a jump or floor exit.
    function selection(role,index,available) {
      const pool=pools[role],ranked=pool.map(ex=>({ex,rank:random()})).sort((a,b)=>a.rank-b.rank).map(x=>x.ex);
      if(role==='footwork') {
        const core=light(['forward-back-line-steps','lateral-step-and-stick','quarter-turn-pivot-steps']);
        const extra=ranked.filter(ex=>!core.some(e=>e.id===ex.id));
        if(extra.length&&duration>=15)core.splice(1,0,extra[index%extra.length]);
        if(!extra.length&&index%3===1)return [core[1],core[2]];
        if(!extra.length&&index%3===2)return [core[0],core[1]];
        if(index%2)[core[0],core[1]]=[core[1],core[0]];
        return core;
      }
      if(role==='control') {
        const anchor=catalogue['single-leg-balance-reach'],others=pool.filter(ex=>ex.id!==anchor.id);
        return [others[index%others.length],anchor,others[(index+1)%others.length]];
      }
      // Opt-in means permitted, not compulsory. Other styles and some integrated
      // sessions stay entirely low/medium impact even with the exclusion lifted.
      const candidates=ranked.filter(ex=>ex.impact!=='high'||style==='integrated-movement'&&random()<.4);
      const standing=pools.integrated.filter(ex=>ex.bodyPosition==='standing'&&ex.impact!=='high');
      // Keep floor changes and optional jumps inside a standing-to-standing drill.
      // With one standing identity, revisit it around the travelling floor drill.
      const end=standing[index%standing.length],first=standing[(index+1)%standing.length];
      const middle=candidates.filter(ex=>ex.id!==first.id&&ex.id!==end.id);
      if(standing.length>1&&(duration<20||!middle.length))return [first,end];
      let center=middle[index%middle.length];
      if(center.impact==='high'&&available-G.BLOCK_TRANSITION_SECONDS<10*(G.sideCount(first)+1+G.sideCount(end))+80)
        center=middle.find(ex=>ex.impact!=='high');
      return [first,center,end];
    }
    const prep=light(['knee-to-opposite-elbow','forward-back-line-steps','quarter-turn-pivot-steps']);
    drill('preparation','control',prep,targets[0]);
    for(const [phase,role] of [[1,'footwork'],[2,'control']]) {
      const count=Math.ceil(targets[phase]/240);
      for(let i=0;i<count;i++)drill(role,role,selection(role,i),Math.floor(targets[phase]/count)+(i<targets[phase]%count?1:0));
    }
    const finish=Math.max(30,Math.round(targets[3]*.18)),practice=targets[3]-finish;
    const count=Math.ceil(practice/240),connector=count>1?60:0;
    const integrated=practice-connector*(count-1);
    for(let i=0;i<count;i++) {
      const budget=Math.floor(integrated/count)+(i<integrated%count?1:0);
      drill('integrated','integrated',selection('integrated',i,budget),budget);
      if(i<count-1)drill('reset','control',light(['knee-to-opposite-elbow','quarter-turn-pivot-steps']),connector);
    }
    // Finish with gentle coordinated stepping, without adding a generic cooldown.
    drill('finish','control',light(['quarter-turn-pivot-steps','knee-to-opposite-elbow']),finish+G.BLOCK_TRANSITION_SECONDS);
    return {familyStyleId:style,blocks};
  }
  G.registerFamilyComposer(FAMILY,1,compose);
})(typeof window==='undefined'?globalThis:window);
