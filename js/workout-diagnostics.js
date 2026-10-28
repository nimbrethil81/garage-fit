(function(root){
  'use strict';
  const KEY='gf_workout_diagnostics_v1',LIMIT=96000;
  const scalar=value=>['string','number','boolean'].includes(typeof value)?String(value):'';
  function fields(object,keys){return keys.filter(key=>scalar(object?.[key])!=='').map(key=>key+': '+scalar(object[key])).join(' · ');}
  function composition(workout,context={}){
    const gen=root.GarageFitGenerator,ui=root.GarageFitWorkoutPreview,plan=gen.trainingSectionPlan(workout),lines=[];
    lines.push('Source: '+(context.source==='Coach'?'Coach':'Generator'));
    if(context.source==='Coach')lines.push('Programme: '+fields(context,['programme','programmeVersion','sessionRole','variationPreference']));
    lines.push(fields(workout,['id','workoutFamilyId','workoutFamilyVersion','familyStyleId','duration','estimatedSeconds','focus','bodyFocus','difficulty']));
    if(workout.familyReplan)lines.push('Delivered adjustment: '+fields(workout.familyReplan,['requestedWorkoutFamilyId','requestedWorkoutFamilyVersion','replanned']));
    if(workout.familyConstraints){
      lines.push('Constraints: '+fields(workout.familyConstraints,['movementRoom']));
      for(const key of ['excludedImpact','bodyPositions'])if(Array.isArray(workout.familyConstraints[key]))lines.push(key+': '+workout.familyConstraints[key].map(scalar).filter(Boolean).join(', '));
    }
    lines.push('Available equipment: '+(context.equipment||[]).map(scalar).filter(Boolean).join(', '));
    function exercise(ex,index,block){
      let target=block?(ui.occurrenceTargetLabel(block,index)||(block.protocol==='emom'?ui.emomTargetLabel(block,index):block.protocol==='timed_intervals'?block.prescription.workSeconds+' sec':ui.formatPrescription(ex))):ui.formatPrescription(ex);
      if(block?.benchmark)target='Optional benchmark: as many controlled reps as possible; may be skipped';
      const load=ex.coachAnchor?.plannedTarget;
      lines.push('  '+(index+1)+'. '+scalar(ex.name)+' ['+scalar(ex.id)+'] · '+target);
      if(load)lines.push('    Planned target: '+fields(load,['targetSets','suggestedLoad','loadUnit','loadInterpretation']));
    }
    function transitions(section,blockIndex,exerciseIndex){
      (workout.setupTransitions||[]).filter(t=>t.section===section&&t.exerciseIndex===exerciseIndex&&(section!=='main'||t.blockIndex===blockIndex)).forEach(t=>lines.push('  Setup: '+fields(t,['instruction','seconds','additionalSeconds'])));
    }
    for(const [key,title] of [['warmup','Warm-up'],['rampup','Ramp-up'],['main','Main'],['cooldown','Cool-down']]){
      lines.push('',title+' · estimated '+plan.seconds[key]+' sec');
      const phase=workout[key];
      if(key==='main')lines.push('Between-block transition: '+gen.BLOCK_TRANSITION_SECONDS+' sec');
      if(key!=='main'){
        if(phase?.exercises?.length)lines.push('Recovery: '+scalar(phase.restSeconds)+' sec between exercises');
        (phase?.exercises||[]).forEach((ex,i)=>{transitions(key,null,i);exercise(ex,i);});
      }
      plan.blocks.filter(item=>item.section===key).forEach(item=>{
        const block=workout.main.blocks[item.blockIndex];
        lines.push('Block '+scalar(block.id)+' ['+scalar(block.protocol)+'] · '+ui.protocolLabel(block));
        lines.push('  Recovery: '+fields(block.prescription,['exerciseRestSeconds','roundRestSeconds','stepRestSeconds','transitionSeconds','betweenExercisesSeconds','betweenSetsSeconds','sequenceRestSeconds']));
        block.exercises.forEach((ex,i)=>{transitions('main',item.blockIndex,i);exercise(ex,i,block);});
        // Ordered resolved occurrences include variable targets, recovery and minute/round boundaries.
        gen.resolveBlockSteps(block).forEach(step=>{
          const ex=block.exercises[step.exerciseIndex];
          const position=fields(step,['round','set','cycle','minute','ladderStep','pyramidStep','complexSequence','densityRound']);
          if(step.kind==='exercise'){
            const p=step.plannedPrescription||(step.timed?{type:'timed',value:step.seconds}:ex.prescription);
            lines.push('    Work ['+scalar(ex.id)+'] '+position+' · '+ui.formatPrescription({...ex,prescription:p})+(step.plannedLoad?' · '+fields(step.plannedLoad,['relativeLoad','suggestedLoad','loadUnit','loadInterpretation']):''));
          }else lines.push('    '+scalar(step.kind)+' · '+scalar(step.seconds)+' sec');
        });
      });
    }
    return lines.filter(line=>line!==undefined).join('\n');
  }
  function create({storage=()=>root.localStorage,build=()=>root.document.getElementById('aboutBuild').getAttribute('data-commit')||'Unknown',clock=()=>new Date().toISOString()}={}){
    let snapshot=null,persistent=false,loaded=false;
    function load(){
      if(loaded)return;loaded=true;
      try{const raw=storage().getItem(KEY);if(!raw||raw.length>LIMIT)return;const data=JSON.parse(raw);
        if(data?.version===1&&typeof data.text==='string'&&typeof data.build==='string'&&typeof data.capturedAt==='string'&&Number.isFinite(Date.parse(data.capturedAt))){snapshot={version:1,text:data.text,build:data.build,capturedAt:data.capturedAt};persistent=true;}
      }catch(error){/* Diagnostics must never interrupt the app. */}
    }
    function capture(workout,context){
      try{load();const text=composition(workout,context);if(snapshot?.text===text)return false;
        const next={version:1,text,build:scalar(build()),capturedAt:clock()},raw=JSON.stringify(next);
        if(raw.length>LIMIT)return false;
        snapshot=next;persistent=false;try{storage().setItem(KEY,raw);persistent=true;}catch(error){}
        return true;
      }catch(error){return false;}
    }
    function report(){load();return ['Workout diagnostics','Currently loaded build: '+scalar(build()),'Report time: '+clock(),snapshot?'Composition build: '+snapshot.build+'\nCaptured at: '+snapshot.capturedAt+'\nRetention: '+(persistent?'Saved on this device':'Current session only; storage unavailable')+'\nComposition only; does not indicate a started or completed session.\n\n'+snapshot.text:'No captured workout. Preview a Generator or Coach workout to capture its composition.'].join('\n');}
    return {capture,report};
  }
  root.GarageFitWorkoutDiagnostics={create,composition,KEY,LIMIT};
  root.garageFitWorkoutDiagnostics=create();
})(typeof window==='undefined'?globalThis:window);
