(function () {
  if (typeof window==='undefined' || !window.GarageFitGenerator) return;

  const baseRenderGeneratedPreview=window.renderGeneratedPreview;
  const baseGeneratedPhaseLabel=window.generatedPhaseLabel;

  function injectStyles() {
    if (document.getElementById('rampupUiStyles')) return;
    const style=document.createElement('style'); style.id='rampupUiStyles';
    style.textContent='#generatedPreview{overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y}#generatedPreview>*{flex-shrink:0}.preview-timing{grid-template-columns:repeat(3,1fr)}.preview-timing.preview-timing-pair{grid-template-columns:1fr 1fr}@media(max-width:380px){.preview-timing{grid-template-columns:1fr 1fr}.preview-timing:not(.preview-timing-pair) .preview-time-card:last-child{grid-column:1/-1}}';
    document.head.appendChild(style);
  }

  function makeSectionList(id, title, beforeNode) {
    let heading=document.getElementById(id+'Title'), list=document.getElementById(id);
    if (!heading) { heading=GarageFitWorkoutPreview.sectionHeading(title); heading.id=id+'Title'; beforeNode.parentNode.insertBefore(heading,beforeNode); }
    if (!list) { list=document.createElement('ol'); list.id=id; list.className='preview-list preview-prep-list'; beforeNode.parentNode.insertBefore(list,beforeNode); }
    return list;
  }

  function renderExerciseList(list, exercises, section, swappable) {
    list.innerHTML='';
    exercises.forEach((exercise,index)=>{
      const controls=[];
      if (swappable) {
        const button=document.createElement('button'); button.type='button'; button.className='swap-btn'; button.textContent='Swap'; button.setAttribute('aria-label','Swap '+exercise.name); button.onclick=()=>window.swapGeneratedPreparation(section,index); controls.push(button);
      }
      // Preparation retains its compact copy; Main opts into instructions and cues.
      list.appendChild(GarageFitWorkoutPreview.exerciseRow({index,name:exercise.name,prescription:formatPrescription(exercise),controls}));
    });
  }

  window.swapGeneratedPreparation=function(section,index){
    GarageFitGenerator.swapPreparation(generatorState.workout,section,index,{catalogue:CATALOGUE,equipment:state.ownedEquipment});
    window.renderGeneratedPreview();
  };

  window.renderGeneratedPreview=function(){
    injectStyles();
    const workout=GarageFitGenerator.normaliseWorkout(generatorState.workout), blocks=workout.main.blocks, mainList=document.getElementById('previewList'), timing=document.querySelector('.preview-timing');
    baseRenderGeneratedPreview();

    const warmupList=makeSectionList('previewWarmupList','Warm-up',mainList);
    const rampupList=makeSectionList('previewRampupList','Ramp-up',mainList);
    // The shared training-section reading (#242): specialist preparation/finish blocks appear
    // under Warm-up/Cool-down with their own timing; Main counts only its own blocks.
    const plan=GarageFitGenerator.trainingSectionPlan(workout),inSection=section=>plan.blocks.filter(item=>item.section===section);
    let mainTitle=document.getElementById('previewMainTitle');
    if(!mainTitle){mainTitle=GarageFitWorkoutPreview.sectionHeading('');mainTitle.id='previewMainTitle';mainList.parentNode.insertBefore(mainTitle,mainList);}
    const mainCount=inSection('main').length;
    mainTitle.textContent='Main workout · '+mainCount+' block'+(mainCount===1?'':'s');
    let cooldownTitle=document.getElementById('previewCooldownListTitle'), cooldownList=document.getElementById('previewCooldownList');
    if(!cooldownTitle){cooldownTitle=GarageFitWorkoutPreview.sectionHeading('Cool-down');cooldownTitle.id='previewCooldownListTitle';mainList.parentNode.insertBefore(cooldownTitle,timing);}
    if(!cooldownList){cooldownList=document.createElement('ol');cooldownList.id='previewCooldownList';cooldownList.className='preview-list preview-prep-list';mainList.parentNode.insertBefore(cooldownList,timing);}

    renderExerciseList(warmupList,workout.warmup.exercises,'warmup',true);
    renderExerciseList(rampupList,workout.rampup.exercises,'rampup',true);
    renderExerciseList(cooldownList,workout.cooldown.exercises,'cooldown',false);
    inSection('warmup').forEach(item=>window.appendGeneratedBlockRows(warmupList,workout,item.blockIndex,plan));
    inSection('cooldown').forEach(item=>window.appendGeneratedBlockRows(cooldownList,workout,item.blockIndex,plan));

    let rampCard=document.getElementById('previewRampupCard');
    if(!rampCard){rampCard=document.createElement('div');rampCard.id='previewRampupCard';rampCard.className='preview-time-card';rampCard.innerHTML='<strong id="previewRampup"></strong>Ramp-up';timing.insertBefore(rampCard,timing.children[1]);}
    // A section with no work is not shown: no misleading 0 min heading or timing card.
    for(const [section,list,title,card] of [['warmup',warmupList,'previewWarmupListTitle',document.getElementById('previewWarmup').parentNode],
      ['rampup',rampupList,'previewRampupListTitle',rampCard],['cooldown',cooldownList,'previewCooldownListTitle',document.getElementById('previewCooldown').parentNode]]){
      const empty=!plan.seconds[section]&&!list.children.length;
      [list,document.getElementById(title),card].forEach(node=>node&&node.classList&&node.classList.toggle('hidden',empty));
    }
    timing.classList.toggle('preview-timing-pair',rampCard.classList.contains('hidden'));
    document.getElementById('previewWarmup').textContent=GarageFitWorkoutPreview.sectionDurationLabel(plan.seconds.warmup);
    document.getElementById('previewRampup').textContent=GarageFitWorkoutPreview.sectionDurationLabel(plan.seconds.rampup);
    document.getElementById('previewCooldown').textContent=GarageFitWorkoutPreview.sectionDurationLabel(plan.seconds.cooldown);
    document.getElementById('previewEstimate').textContent='≈'+Math.round(workout.estimatedSeconds/60)+' min total';
  };

  window.buildGeneratedTimeline=function(workout){
    workout=GarageFitGenerator.normaliseWorkout(workout);
    const timeline=[{kind:'ready',seconds:3}], warmup=workout.warmup.exercises, rampup=workout.rampup.exercises, blocks=workout.main.blocks, cooldown=workout.cooldown.exercises;
    warmup.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'warmup',null,index));if(index<warmup.length-1)timeline.push({kind:'rest',section:'warmup',seconds:workout.warmup.restSeconds,nextExercise:warmup[index+1]})});
    if(warmup.length&&rampup.length)timeline.push({kind:'transition',section:'rampup',seconds:3,label:'Warm-up complete',nextExercise:rampup[0]});
    rampup.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'rampup',null,index));if(index<rampup.length-1)timeline.push({kind:'rest',section:'rampup',seconds:workout.rampup.restSeconds,nextExercise:rampup[index+1]})});
    if(warmup.length||rampup.length)timeline.push({kind:'transition',section:'main',seconds:3,label:rampup.length?'Ramp-up complete':'Warm-up complete',nextExercise:blocks[0].exercises[0]});
    blocks.forEach((block,index)=>{
      appendBlockTimeline(timeline,block,index,blocks.length);
      if(index<blocks.length-1)timeline.push(generatedBlockTransition(workout,index));
    });
    if(cooldown.length)timeline.push({kind:'transition',section:'cooldown',seconds:3,label:'Main workout complete',nextExercise:cooldown[0]});
    cooldown.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'cooldown',null,index));if(index<cooldown.length-1)timeline.push({kind:'rest',section:'cooldown',seconds:workout.cooldown.restSeconds,nextExercise:cooldown[index+1]})});
    return applyGeneratedSetupTransitions(timeline,workout);
  };

  window.generatedPhaseLabel=function(phase){
    if(phase.section==='rampup')return phase.kind==='exercise'?'Ramp-up · Exercise '+(phase.exerciseIndex+1)+' of '+generatorState.workout.rampup.exercises.length:'Ramp-up';
    if(phase.section==='warmup'&&phase.kind!=='exercise')return 'Warm-up';
    if(phase.section==='cooldown'&&phase.kind!=='exercise')return 'Cool-down';
    if(phase.kind==='transition'&&phase.section==='main')return 'Main workout';
    return baseGeneratedPhaseLabel(phase);
  };

  injectStyles();
})();
