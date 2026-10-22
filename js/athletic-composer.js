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
  const PREPARATION=['knee-to-opposite-elbow','forward-back-line-steps','quarter-turn-pivot-steps'];
  const RESET=['knee-to-opposite-elbow','quarter-turn-pivot-steps'];

  // Shared by both published compositions: contexts, eligible pools, essential practice, the seeded
  // internal style and its 8% emphasis transfer. Random draws happen exactly as in v1.
  function prepare(options,request,attempt) {
    const {duration,difficulty,catalogue}=options,owned=options.equipment||[],random=options.random||Math.random;
    const excluded=attempt&&attempt.excludedStyleIds||[];
    // Diagnostic reason codes (and a style, when only that style failed) travel with the error.
    const fail=(message,reason,details)=>{const error=new F.FamilyContractError('family-not-feasible',message);
      Object.assign(error,{reason},details);throw error;};
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
      fail('Athletic Movement needs at least two eligible '+role+' drills; low-impact-only integrated practice needs confirmed movement room.','insufficient-eligible-movements',{role});
    const has=(role,id)=>pools[role].some(ex=>ex.id===id);
    if(!['forward-back-line-steps','lateral-step-and-stick','quarter-turn-pivot-steps'].every(id=>has('footwork',id))
      ||!has('control','single-leg-balance-reach')||!has('control','knee-to-opposite-elbow'))
      fail('Athletic Movement needs standing forward/back, lateral, rotation and balance practice.','missing-essential-practice');
    // Same-family fallback keeps the seeded draw and takes the next remaining style.
    const drawn=Math.min(2,Math.floor(random()*3));
    const style=[0,1,2].map(offset=>STYLES[(drawn+offset)%3]).find(id=>!excluded.includes(id)),targets=PROFILES[duration].map(n=>n*60);
    if(!style)fail('Athletic Movement has no remaining internal style.','no-buildable-style');
    const emphasized=STYLES.indexOf(style)+1,donor=emphasized===1?2:1;
    const shift=Math.round(targets[donor]*.08);targets[emphasized]+=shift;targets[donor]-=shift;
    return {duration,difficulty,catalogue,random,fail,contexts,pools,style,targets,light:ids=>ids.map(id=>catalogue[id])};
  }

  // Bounded technical drills with exercise-sensitive recovery, fitted exactly to a phase budget.
  function builder({difficulty,style,contexts,fail}) {
    const blocks=[];
    const copy=ex=>JSON.parse(JSON.stringify(ex));
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
    // The smallest phase budget (including the shared block transition) one round of a drill needs.
    const minimum=(stage,list)=>G.BLOCK_TRANSITION_SECONDS+list.reduce((sum,ex)=>sum+10*G.sideCount(ex),0)
      +list.slice(1).reduce((sum,ex,i)=>sum+recovery(list[i],ex,stage),0);
    function fit(stage,role,list,budget) {
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
      return best&&{...best,budget,cap,preferred};
    }
    function drill(stage,role,list,phaseBudget) {
      const best=fit(stage,role,list,phaseBudget),budget=phaseBudget-G.BLOCK_TRANSITION_SECONDS;
      if(!best)fail('Athletic Movement cannot fit bounded technical efforts and recovery into '+stage+' ('+budget+' s; '+list.map(ex=>ex.id).join(', ')+').',
        'phase-cannot-fit',{familyStyleId:style});
      const {rounds,sequence,gaps,cap,preferred}=best,values=sequence.map(()=>10);
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
    return {blocks,drill,minimum,fits:(stage,role,list,budget)=>!!fit(stage,role,list,budget)};
  }
  // Whole-second split of a phase budget across its blocks.
  const share=(total,count,index)=>Math.floor(total/count)+(index<total%count?1:0);

  // ---- Published composition v1: unchanged, still composable for explicit v1 requests ----
  function composeV1(options,request,attempt) {
    const setup=prepare(options,request,attempt),{duration,catalogue,random,pools,style,targets,light}=setup;
    const {blocks,drill}=builder(setup);
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
    drill('preparation','control',light(PREPARATION),targets[0]);
    for(const [phase,role] of [[1,'footwork'],[2,'control']]) {
      const count=Math.ceil(targets[phase]/240);
      for(let i=0;i<count;i++)drill(role,role,selection(role,i),share(targets[phase],count,i));
    }
    const finish=Math.max(30,Math.round(targets[3]*.18)),practice=targets[3]-finish;
    const count=Math.ceil(practice/240),connector=count>1?60:0;
    const integrated=practice-connector*(count-1);
    for(let i=0;i<count;i++) {
      const budget=share(integrated,count,i);
      drill('integrated','integrated',selection('integrated',i,budget),budget);
      if(i<count-1)drill('reset','control',light(RESET),connector);
    }
    // Finish with gentle coordinated stepping, without adding a generic cooldown.
    drill('finish','control',light(['quarter-turn-pivot-steps','knee-to-opposite-elbow']),finish+G.BLOCK_TRANSITION_SECONDS);
    return {familyStyleId:style,blocks};
  }

  // ---- Published composition v2 (#244): purposeful blocks, honest variety, longer finish ----
  // A stage gains another block only for each further four minutes of its budget AND when that block
  // brings practice the stage has not had yet (at least one drill absent from all its earlier blocks).
  // Otherwise the stage is consolidated into fewer, longer drills with deliberate within-block
  // repetition, so a limited eligible pool never becomes a series of near-identical circuits.
  const BLOCK_SECONDS=240,CONNECTOR_SECONDS=60,FINISH_MINIMUM=30;
  const finishTarget=duration=>duration>=30?120:60;
  function composeV2(options,request,attempt) {
    const setup=prepare(options,request,attempt),{duration,catalogue,random,pools,style,targets,light,fail}=setup;
    const {blocks,drill,minimum,fits}=builder(setup);
    const wanted=budget=>Math.max(1,Math.floor(budget/BLOCK_SECONDS));
    const rank=pool=>pool.map(ex=>({ex,rank:random()})).sort((a,b)=>a.rank-b.rank).map(x=>x.ex);
    const practised=new Set(); // drills already used by an earlier Main stage
    // Fresh drills first (new to this stage, then new to the session), then the seeded order.
    const order=(pool,used)=>[...pool.filter(ex=>!used.has(ex.id)&&!practised.has(ex.id)),
      ...pool.filter(ex=>!used.has(ex.id)&&practised.has(ex.id)),...pool.filter(ex=>used.has(ex.id))];
    const brings=(list,used)=>list.some(ex=>!used.has(ex.id));
    // Chosen drills play in their seeded order, so equal choices still vary between sessions.
    const seeded=(list,pool)=>list.slice().sort((a,b)=>pool.indexOf(a)-pool.indexOf(b));
    function plan(count,next) {
      const used=new Set(),lists=[];
      for(let index=0;index<count;index++) {
        const list=next(index,used);
        if(!list||index&&!brings(list,used))break;
        lists.push(list);list.forEach(ex=>used.add(ex.id));
      }
      lists.flat().forEach(ex=>practised.add(ex.id));
      return lists;
    }
    // Footwork opens with forward/back, lateral and rotational practice; later blocks add new drills.
    const feet=rank(pools.footwork);
    const footwork=plan(wanted(targets[1]),(index,used)=>{
      const options=order(feet,used),list=[];
      if(!index)for(const plane of ['sagittal','frontal','transverse'])
        if(!list.some(ex=>ex.movementPlanes.includes(plane)))list.push(options.find(ex=>!list.includes(ex)&&ex.movementPlanes.includes(plane)));
      for(const ex of options)if(list.length<3&&!list.includes(ex))list.push(ex);
      return list.every(Boolean)?seeded(list,feet):null;
    });
    // Every control drill centres on standing single-leg balance, combined with different stepping,
    // sticking or cross-body partners in each block.
    const anchor=catalogue['single-leg-balance-reach'],partners=rank(pools.control.filter(ex=>ex.id!==anchor.id));
    const control=plan(wanted(targets[2]),(index,used)=>{
      const [before,after]=seeded(order(partners,used).slice(0,2),partners);
      return [before,anchor,after].filter(Boolean);
    });
    // Integrated drills begin and end with standing non-jumping movement; floor changes and optional
    // jumps stay inside. Opt-in high impact is permitted, never compulsory.
    const integratedPool=rank(pools.integrated);
    const candidates=integratedPool.filter(ex=>ex.impact!=='high'||style==='integrated-movement'&&random()<.4);
    const standing=integratedPool.filter(ex=>ex.bodyPosition==='standing'&&ex.impact!=='high');
    const target=finishTarget(duration);
    const integrated=plan(wanted(targets[3]-target),(index,used)=>{
      const edges=order(standing,used),first=edges[0],end=edges[1]||edges[0];
      const middle=order(candidates.filter(ex=>ex!==first&&ex!==end),used);
      if(!first||first===end&&!middle.length)return null;
      return first!==end&&(duration<20||!middle.length)?[first,end]:[first,middle[0],end];
    });
    if(!integrated.length)fail('Athletic Movement cannot build a standing integrated drill.','phase-cannot-fit',{familyStyleId:style});
    // A one-minute gentle reset separates integrated blocks; the rest of the stage is practice and finish.
    const practiceFor=seconds=>targets[3]-seconds-CONNECTOR_SECONDS*(integrated.length-1);
    integrated.forEach((list,index)=>{
      // Optional jumping needs spare time around its forty-second landing recoveries; otherwise the
      // drill keeps a non-jumping centre (or just its standing edges).
      if(list.length===3&&list[1].impact==='high'&&share(practiceFor(target),integrated.length,index)<minimum('integrated',list)+40) {
        const replacement=order(candidates,new Set(integrated.slice(0,index).flat().map(ex=>ex.id)))
          .find(ex=>ex.impact!=='high'&&!list.includes(ex));
        if(replacement)list[1]=replacement;else if(list[0]!==list[2])list.splice(1,1);
      }
    });
    // Bounded efforts and recoveries cannot fill every whole-second budget, so the finish moves by the
    // fewest seconds from its target (never below thirty, at most twenty above) until every drill fits.
    const finishList=light(duration>=30?['forward-back-line-steps',...RESET.slice().reverse()]:RESET.slice().reverse());
    const fitsWith=seconds=>fits('finish','control',finishList,seconds+G.BLOCK_TRANSITION_SECONDS)
      &&integrated.every((list,index)=>fits('integrated','integrated',list,share(practiceFor(seconds),integrated.length,index)));
    let finish=target;
    for(let offset=0;offset<=target-FINISH_MINIMUM;offset++) {
      const found=[target-offset,target+offset].find(seconds=>(seconds>=FINISH_MINIMUM&&seconds<=target+20)&&fitsWith(seconds));
      if(found!==undefined){finish=found;break;}
    }
    const practice=practiceFor(finish);
    drill('preparation','control',light(PREPARATION),targets[0]);
    footwork.forEach((list,index)=>drill('footwork','footwork',list,share(targets[1],footwork.length,index)));
    control.forEach((list,index)=>drill('control','control',list,share(targets[2],control.length,index)));
    integrated.forEach((list,index)=>{
      drill('integrated','integrated',list,share(practice,integrated.length,index));
      if(index<integrated.length-1)drill('reset','control',light(RESET),CONNECTOR_SECONDS);
    });
    // A longer gentle stepping finish (about one minute, two from 30 minutes), within the same total.
    drill('finish','control',finishList,finish+G.BLOCK_TRANSITION_SECONDS);
    return {familyStyleId:style,blocks};
  }

  // Family quality for the shared gate (#186): approved drills only, standing preparation and
  // finish, three-plane footwork plus single-leg control, bounded technical efforts with
  // exercise-sensitive recovery, and high impact only as the integrated style's optional route.
  const minimumRecovery=(a,b)=>a.impact==='high'||b.impact==='high'?40:a.bodyPosition!==b.bodyPosition||a.bodyPosition==='floor'||b.bodyPosition==='floor'?25
    :a.impact==='medium'||b.impact==='medium'?20:G.sideCount(a)===2||G.sideCount(b)===2?16:8;
  function quality(workout) {
    const blocks=workout.main.blocks,issues=[],difficulty=workout.difficulty;
    if(!blocks.length||blocks.some(block=>!block.familyContext||block.familyContext.workoutFamilyId!==FAMILY))return ['phase-structure'];
    const roles=blocks.map(block=>block.familyContext.role);
    if(roles[0]!=='control'||roles[roles.length-1]!=='control'||!['footwork','control','integrated'].every(role=>roles.includes(role)))issues.push('phase-structure');
    // Integrated practice always leads into gentle active recovery, never another demanding block.
    roles.forEach((role,index)=>{if(role==='integrated'&&roles[index+1]!=='control')issues.push('integrated-without-recovery:'+index);});
    const planes=new Set(blocks.filter(block=>block.familyContext.role==='footwork').flatMap(block=>block.exercises.flatMap(ex=>ex.movementPlanes||[])));
    ['sagittal','frontal','transverse'].filter(plane=>!planes.has(plane)).forEach(plane=>issues.push('missing-footwork-plane:'+plane));
    if(!blocks.some(block=>block.familyContext.role==='control'&&block.exercises.some(ex=>ex.sidedness==='per-side'&&ex.bodyPosition==='standing')))
      issues.push('missing-single-leg-control');
    const played=[];
    for(const block of blocks) {
      const occurrences=G.resolvedOccurrences(block);
      if(block.protocol!=='rounds'||!(block.exercises.length>=2&&block.exercises.length<=4)||new Set(block.exercises.map(ex=>ex.id)).size<2)issues.push('drill-structure:'+block.id);
      if(block.exercises[0].impact==='high'||block.exercises[block.exercises.length-1].impact==='high')issues.push('high-impact-block-edge:'+block.id);
      for(const [index,item] of occurrences.entries()) {
        const ex=item.exercise,cap=ex.impact==='high'?15:ex.bodyPosition==='floor'?20:G.sideCount(ex)===2?22:difficulty==='easy'?25:30;
        if(!item.timed||!(item.seconds>=10&&item.seconds<=cap))issues.push('dose-out-of-range:'+ex.id);
        if(ex.impact==='high'&&workout.familyStyleId!=='integrated-movement')issues.push('high-impact-outside-integrated-style:'+ex.id);
        const next=occurrences[index+1];
        if(next&&item.restAfter<minimumRecovery(ex,next.exercise))issues.push('recovery-too-short:'+block.id+':'+index);
      }
      played.push(...occurrences.map(item=>item.exercise));
    }
    if(played.some((ex,index)=>index&&ex.impact==='high'&&played[index-1].impact==='high'))issues.push('consecutive-high-impact');
    return [...new Set(issues)];
  }
  // v2 keeps every v1 rule and adds session-wide construction quality: explicit stage identity in
  // the coached order, single-leg balance in every control drill, a finish of at least thirty
  // seconds, and no block that only repeats drills its stage already practised (a subset, reorder
  // or copy of earlier blocks). Repetition within a block, and recovery resets, remain allowed.
  const STAGE_ROLES={preparation:'control',footwork:'footwork',control:'control',integrated:'integrated',reset:'control',finish:'control'};
  const stageOf=block=>{
    const match=/^athletic-([a-z]+)-\d+$/.exec(block.id||'');
    return match&&STAGE_ROLES[match[1]]===block.familyContext.role?match[1]:null;
  };
  function qualityV2(workout) {
    const issues=quality(workout),blocks=workout.main.blocks;
    if(!blocks.length||blocks.some(block=>!block.familyContext||block.familyContext.workoutFamilyId!==FAMILY))return issues;
    if(blocks.some(block=>block.familyContext.workoutFamilyVersion!==workout.workoutFamilyVersion))issues.push('context-version');
    const stages=blocks.map(stageOf);
    stages.forEach((stage,index)=>{if(!stage)issues.push('stage-identity:'+blocks[index].id);});
    const letters=stages.map(stage=>({preparation:'P',footwork:'F',control:'C',integrated:'I',reset:'R',finish:'X'})[stage]||'?').join('');
    if(!/^PF+C+I(RI)*X$/.test(letters))issues.push('stage-order');
    const used={};
    blocks.forEach((block,index)=>{
      const stage=stages[index],ids=block.exercises.map(ex=>ex.id);
      if(stage==='control'&&!block.exercises.some(ex=>ex.sidedness==='per-side'&&ex.bodyPosition==='standing'))issues.push('control-without-single-leg:'+block.id);
      if(!['footwork','control','integrated'].includes(stage))return;
      if(used[stage]&&ids.every(id=>used[stage].has(id)))issues.push('redundant-block:'+block.id);
      used[stage]=new Set([...(used[stage]||[]),...ids]);
    });
    const last=blocks[blocks.length-1];
    if(stages[stages.length-1]==='finish'&&last.estimatedSeconds<FINISH_MINIMUM)issues.push('finish-too-short');
    return [...new Set(issues)];
  }
  // Training-purpose sections (#242) follow explicit stage identity, never the reused `control`
  // role: the gentle preparation reads as Warm-up and the stepping finish as Cool-down; footwork,
  // control, integrated practice and its active-recovery resets stay Main. No generic Ramp-up is
  // added: the progression itself ramps from preparation into technical practice.
  const stageSection=block=>block.familyContext&&block.familyContext.role==='control'
    ?/^athletic-preparation-\d+$/.test(block.id)?'warmup':/^athletic-finish-\d+$/.test(block.id)?'cooldown':'main':'main';
  G.registerFamilyComposer(FAMILY,1,composeV1,quality,stageSection);
  G.registerFamilyComposer(FAMILY,2,composeV2,qualityV2,stageSection);
})(typeof window==='undefined'?globalThis:window);
