(function () {
  if (typeof window==='undefined' || !window.GarageFitGenerator) return;

  const baseRenderGeneratedPreview=window.renderGeneratedPreview;
  const baseGeneratedPhaseLabel=window.generatedPhaseLabel;

  function injectStyles() {
    if (document.getElementById('rampupUiStyles')) return;
    const style=document.createElement('style'); style.id='rampupUiStyles';
    style.textContent='#generatedPreview{overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y}#generatedPreview>*{flex-shrink:0}.preview-section-title{margin:16px 2px 7px;color:var(--text-muted);font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.preview-prep-list{margin-bottom:8px}.preview-block-heading{background:#e1e7e4}.preview-block-heading .preview-index{color:var(--work-dark)}.preview-block-heading .preview-exercise{font-size:13px;text-transform:uppercase;letter-spacing:.06em}.preview-block-heading .preview-prescription{text-transform:none;letter-spacing:0}.preview-timing{grid-template-columns:repeat(3,1fr)}#rampupSkipBtn{margin-top:-8px}@media(max-width:380px){.preview-timing{grid-template-columns:1fr 1fr}.preview-time-card:last-child{grid-column:1/-1}}';
    document.head.appendChild(style);
  }

  function makeSectionList(id, title, beforeNode) {
    let heading=document.getElementById(id+'Title'), list=document.getElementById(id);
    if (!heading) { heading=document.createElement('div'); heading.id=id+'Title'; heading.className='preview-section-title'; heading.textContent=title; beforeNode.parentNode.insertBefore(heading,beforeNode); }
    if (!list) { list=document.createElement('ol'); list.id=id; list.className='preview-list preview-prep-list'; beforeNode.parentNode.insertBefore(list,beforeNode); }
    return list;
  }

  function renderExerciseList(list, exercises, section, swappable) {
    list.innerHTML='';
    exercises.forEach((exercise,index)=>{
      const li=document.createElement('li'), number=document.createElement('span'), copy=document.createElement('span');
      number.className='preview-index'; number.textContent=String(index+1).padStart(2,'0');
      copy.className='preview-exercise'; copy.textContent=exercise.name;
      const prescription=document.createElement('span'); prescription.className='preview-prescription'; prescription.textContent=formatPrescription(exercise); copy.appendChild(prescription);
      li.append(number,copy);
      if (swappable) {
        const button=document.createElement('button'); button.type='button'; button.className='swap-btn'; button.textContent='Swap'; button.setAttribute('aria-label','Swap '+exercise.name); button.onclick=()=>window.swapGeneratedPreparation(section,index); li.appendChild(button);
      }
      list.appendChild(li);
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
    let mainTitle=document.getElementById('previewMainTitle');
    if(!mainTitle){mainTitle=document.createElement('div');mainTitle.id='previewMainTitle';mainTitle.className='preview-section-title';mainList.parentNode.insertBefore(mainTitle,mainList);}
    mainTitle.textContent='Main workout · '+blocks.length+' block'+(blocks.length===1?'':'s');
    let cooldownTitle=document.getElementById('previewCooldownListTitle'), cooldownList=document.getElementById('previewCooldownList');
    if(!cooldownTitle){cooldownTitle=document.createElement('div');cooldownTitle.id='previewCooldownListTitle';cooldownTitle.className='preview-section-title';cooldownTitle.textContent='Cool-down';mainList.parentNode.insertBefore(cooldownTitle,timing);}
    if(!cooldownList){cooldownList=document.createElement('ol');cooldownList.id='previewCooldownList';cooldownList.className='preview-list preview-prep-list';mainList.parentNode.insertBefore(cooldownList,timing);}

    renderExerciseList(warmupList,workout.warmup.exercises,'warmup',true);
    renderExerciseList(rampupList,workout.rampup.exercises,'rampup',true);
    renderExerciseList(cooldownList,workout.cooldown.exercises,'cooldown',false);

    document.getElementById('previewWarmup').textContent=Math.round(workout.warmup.estimatedSeconds/60)+' min';
    let rampCard=document.getElementById('previewRampupCard');
    if(!rampCard){rampCard=document.createElement('div');rampCard.id='previewRampupCard';rampCard.className='preview-time-card';rampCard.innerHTML='<strong id="previewRampup"></strong>Ramp-up';timing.insertBefore(rampCard,timing.children[1]);}
    document.getElementById('previewRampup').textContent=Math.round(workout.rampup.estimatedSeconds/60)+' min';
    document.getElementById('previewCooldown').textContent=Math.round(workout.cooldown.estimatedSeconds/60)+' min';
    document.getElementById('previewEstimate').textContent='≈'+Math.round(workout.estimatedSeconds/60)+' min total';
  };

  window.buildGeneratedTimeline=function(workout){
    workout=GarageFitGenerator.normaliseWorkout(workout);
    const timeline=[{kind:'ready',seconds:3}], warmup=workout.warmup.exercises, rampup=workout.rampup.exercises, blocks=workout.main.blocks, cooldown=workout.cooldown.exercises;
    warmup.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'warmup',null,index));if(index<warmup.length-1)timeline.push({kind:'rest',section:'warmup',seconds:workout.warmup.restSeconds,nextExercise:warmup[index+1]})});
    if(rampup.length)timeline.push({kind:'transition',section:'rampup',seconds:3,label:'Warm-up complete',nextExercise:rampup[0]});
    rampup.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'rampup',null,index));if(index<rampup.length-1)timeline.push({kind:'rest',section:'rampup',seconds:workout.rampup.restSeconds,nextExercise:rampup[index+1]})});
    timeline.push({kind:'transition',section:'main',seconds:3,label:rampup.length?'Ramp-up complete':'Warm-up complete',nextExercise:blocks[0].exercises[0]});
    blocks.forEach((block,index)=>{
      appendBlockTimeline(timeline,block,index,blocks.length);
      if(index<blocks.length-1)timeline.push({kind:'block-transition',section:'main',blockIndex:index,totalBlocks:blocks.length,seconds:workout.main.transitionSeconds,label:'Block '+(index+1)+' complete',nextExercise:blocks[index+1].exercises[0]});
    });
    timeline.push({kind:'transition',section:'cooldown',seconds:3,label:'Main workout complete',nextExercise:cooldown[0]});
    cooldown.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'cooldown',null,index));if(index<cooldown.length-1)timeline.push({kind:'rest',section:'cooldown',seconds:workout.cooldown.restSeconds,nextExercise:cooldown[index+1]})});
    return timeline;
  };

  window.generatedPhaseLabel=function(phase){
    if(phase.section==='rampup')return phase.kind==='exercise'?'Ramp-up · Exercise '+(phase.exerciseIndex+1)+' of '+generatorState.workout.rampup.exercises.length:'Ramp-up';
    if(phase.section==='warmup'&&phase.kind!=='exercise')return 'Warm-up';
    if(phase.section==='cooldown'&&phase.kind!=='exercise')return 'Cool-down';
    if(phase.kind==='transition'&&phase.section==='main')return 'Main workout';
    return baseGeneratedPhaseLabel(phase);
  };

  const originalRenderGeneratedPhase=window.renderGeneratedPhase;
  window.renderGeneratedPhase=function(){
    originalRenderGeneratedPhase();
    let button=document.getElementById('rampupSkipBtn');
    if(!button){button=document.createElement('button');button.id='rampupSkipBtn';button.type='button';button.className='ctrl-btn ctrl-secondary hidden';button.textContent='Skip ramp-up';button.onclick=()=>{
      for(let i=generatorState.timelineIndex+1;i<generatorState.timeline.length;i++)if(generatorState.timeline[i].kind==='exercise'&&generatorState.timeline[i].section==='main'){enterGeneratedPhase(i);return;}
    };document.getElementById('completeMovementBtn').parentNode.insertBefore(button,document.getElementById('completeMovementBtn'));}
    const phase=currentGeneratedPhase();button.classList.toggle('hidden',!(phase&&phase.section==='rampup'));
  };

  injectStyles();
})();
