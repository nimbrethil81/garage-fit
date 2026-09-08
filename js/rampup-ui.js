(function () {
  if (typeof window==='undefined' || !window.GarageFitGenerator) return;

  function injectStyles() {
    if (document.getElementById('rampupUiStyles')) return;
    const style=document.createElement('style'); style.id='rampupUiStyles';
    style.textContent='#generatedPreview{overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y}#generatedPreview>*{flex-shrink:0}.preview-section-title{margin:16px 2px 7px;color:var(--text-muted);font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.preview-prep-list{margin-bottom:8px}.preview-timing{grid-template-columns:repeat(3,1fr)}#rampupSkipBtn{margin-top:-8px}@media(max-width:380px){.preview-timing{grid-template-columns:1fr 1fr}.preview-time-card:last-child{grid-column:1/-1}}';
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
    const workout=generatorState.workout, block=workout.blocks[0], focus=workout.focus[0].toUpperCase()+workout.focus.slice(1), mainList=document.getElementById('previewList');
    document.getElementById('previewKicker').textContent=workout.duration+' min · '+focus;
    document.getElementById('previewRounds').textContent=block.rounds+' rounds';

    const warmupList=makeSectionList('previewWarmupList','Warm-up',mainList);
    const rampupList=makeSectionList('previewRampupList','Ramp-up',mainList);
    let mainTitle=document.getElementById('previewMainTitle');
    if(!mainTitle){mainTitle=document.createElement('div');mainTitle.id='previewMainTitle';mainTitle.className='preview-section-title';mainTitle.textContent='Main workout';mainList.parentNode.insertBefore(mainTitle,mainList);}
    renderExerciseList(warmupList,workout.warmup.exercises,'warmup',true);
    renderExerciseList(rampupList,workout.rampup.exercises,'rampup',true);
    renderExerciseList(mainList,block.exercises,'main',false);
    [...mainList.children].forEach((li,index)=>{
      const button=document.createElement('button'); button.type='button'; button.className='swap-btn'; button.textContent='Swap'; button.setAttribute('aria-label','Swap '+block.exercises[index].name); button.onclick=()=>swapGeneratedExercise(index); li.appendChild(button);
    });

    document.getElementById('previewWarmup').textContent=Math.round(workout.warmup.estimatedSeconds/60)+' min';
    let rampCard=document.getElementById('previewRampupCard');
    if(!rampCard){rampCard=document.createElement('div');rampCard.id='previewRampupCard';rampCard.className='preview-time-card';rampCard.innerHTML='<strong id="previewRampup"></strong>Ramp-up';document.querySelector('.preview-timing').insertBefore(rampCard,document.querySelector('.preview-timing').children[1]);}
    document.getElementById('previewRampup').textContent=Math.round(workout.rampup.estimatedSeconds/60)+' min';
    document.getElementById('previewCooldown').textContent=Math.round(workout.cooldown.estimatedSeconds/60)+' min';
    document.getElementById('previewEstimate').textContent='≈'+Math.round(workout.estimatedSeconds/60)+' min total';
  };

  window.buildGeneratedTimeline=function(workout){
    const timeline=[{kind:'ready',seconds:3}], warmup=workout.warmup.exercises, rampup=workout.rampup.exercises, block=workout.blocks[0], cooldown=workout.cooldown.exercises;
    warmup.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'warmup',null,index));if(index<warmup.length-1)timeline.push({kind:'rest',section:'warmup',seconds:workout.warmup.restSeconds,nextExercise:warmup[index+1]})});
    if(rampup.length) timeline.push({kind:'transition',section:'rampup',seconds:3,label:'Ramp up',nextExercise:rampup[0]});
    rampup.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'rampup',null,index));if(index<rampup.length-1)timeline.push({kind:'rest',section:'rampup',seconds:workout.rampup.restSeconds,nextExercise:rampup[index+1]})});
    timeline.push({kind:'transition',section:'main',seconds:3,label:'Main workout',nextExercise:block.exercises[0]});
    for(let round=1;round<=block.rounds;round++)block.exercises.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'main',round,index));if(index<block.exercises.length-1)timeline.push({kind:'rest',section:'main',seconds:block.rest.exercise,nextExercise:block.exercises[index+1]});else if(round<block.rounds)timeline.push({kind:'round-rest',section:'main',round,seconds:block.rest.round,nextExercise:block.exercises[0]})});
    timeline.push({kind:'transition',section:'cooldown',seconds:3,label:'Main workout complete',nextExercise:cooldown[0]});
    cooldown.forEach((exercise,index)=>{timeline.push(...makeGeneratedExercisePhases(exercise,'cooldown',null,index));if(index<cooldown.length-1)timeline.push({kind:'rest',section:'cooldown',seconds:workout.cooldown.restSeconds,nextExercise:cooldown[index+1]})});
    return timeline;
  };

  window.generatedPhaseLabel=function(phase){
    const workout=generatorState.workout, block=workout.blocks[0];
    if(phase.section==='main'&&phase.kind==='exercise')return 'Round '+phase.round+' of '+block.rounds+' · Exercise '+(phase.exerciseIndex+1)+' of '+block.exercises.length;
    if(phase.section==='warmup'&&phase.kind==='exercise')return 'Warm-up · Exercise '+(phase.exerciseIndex+1)+' of '+workout.warmup.exercises.length;
    if(phase.section==='rampup'&&phase.kind==='exercise')return 'Ramp-up · Exercise '+(phase.exerciseIndex+1)+' of '+workout.rampup.exercises.length;
    if(phase.section==='cooldown'&&phase.kind==='exercise')return 'Cool-down · Exercise '+(phase.exerciseIndex+1)+' of '+workout.cooldown.exercises.length;
    if(phase.kind==='transition'&&phase.section==='rampup')return 'Ramp-up';
    if(phase.kind==='transition'&&phase.section==='main')return 'Main workout';
    return phase.kind==='ready'?'Get ready':phase.section?phase.section[0].toUpperCase()+phase.section.slice(1):'Get ready';
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
