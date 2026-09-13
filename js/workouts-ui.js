(function (root) {
  'use strict';

  var selectedWorkoutId = null;
  var installed = false;
  var baseShowScreen = null;

  var CARD_META = {
    sevenMinute: { name:'Minute Workout', kicker:'Timed circuit', number:'7', format:'12 movements', summary:'30s work · 10s rest' },
    cindy: { name:'Cindy', kicker:'AMRAP', number:'20', format:'20 min AMRAP', summary:'3-movement sequence' },
    workout300: { name:'Workout', kicker:'For time', number:'300', format:'7 movements', summary:'300 total reps' }
  };

  function detailDefinition(workoutId) {
    if (workoutId === 'sevenMinute') {
      return { id:workoutId, name:'7 Minute Workout', format:'7 min timed circuit', description:'12 movements · 30s work · 10s rest', exercises:SEVEN_MINUTE_WORKOUT.map(function(exercise){return {name:exercise.name,target:exercise.work+' sec'};}) };
    }
    var workout=FIXED_WORKOUTS[workoutId]; if(!workout||!workout.exercises)return null;
    var exercises=fixedWorkoutExercises(workout).map(function(exercise){return {name:exercise.name,target:exercise.reps+' reps',note:exercise.note||''};});
    if(workoutId==='cindy') return {id:workoutId,name:workout.name,format:workout.subtitle||'AMRAP',description:'Repeat the sequence for as many rounds as possible before the overall timer reaches zero.',exercises:exercises,provenance:workout.provenance||''};
    return {id:workoutId,name:workout.name,format:'For time',description:'Complete the full exercise sequence as quickly as you can.',exercises:exercises,personalBest:workoutId==='workout300'};
  }

  function startSelectedWorkout(){if(selectedWorkoutId==='sevenMinute')startSevenMinuteWorkout();else if(selectedWorkoutId)startFixedWorkout(selectedWorkoutId);}
  function renderExercises(definition){var list=document.getElementById('fixedWorkoutDetailExercises');list.innerHTML='';definition.exercises.forEach(function(exercise){var item=document.createElement('li'),copy=document.createElement('span'),target=document.createElement('strong');copy.className='fixed-detail-exercise-name';copy.textContent=exercise.name;if(exercise.note){var note=document.createElement('small');note.textContent=exercise.note;copy.appendChild(note);}target.textContent=exercise.target;item.append(copy,target);list.appendChild(item);});}
  function openWorkoutDetail(workoutId){var definition=detailDefinition(workoutId);if(!definition)return;selectedWorkoutId=workoutId;document.getElementById('fixedWorkoutDetailTitle').textContent=definition.name;document.getElementById('fixedWorkoutDetailFormat').textContent=definition.format;document.getElementById('fixedWorkoutDetailDescription').textContent=definition.description;renderExercises(definition);var best=document.getElementById('fixedWorkoutDetailBest');best.classList.toggle('hidden',!definition.personalBest);if(definition.personalBest){var pb=getPersonalBest();document.getElementById('fixedWorkoutDetailBestValue').textContent=pb===null?'No time yet':formatTime(pb);}var provenance=document.getElementById('fixedWorkoutDetailProvenance');provenance.classList.toggle('hidden',!definition.provenance);provenance.textContent=definition.provenance||'';showScreen('workoutDetail');}

  function styleUi(){var style=document.createElement('style');style.textContent=[
    '#workoutDetail{padding:20px 20px calc(20px + env(safe-area-inset-bottom));overflow-y:auto}',
    '.workout-list{gap:12px}',
    '.workout-launch{min-height:205px!important;padding:20px!important;display:grid!important;grid-template-columns:auto 1fr!important;grid-template-rows:auto 1fr auto!important;column-gap:18px!important;align-items:initial!important}',
    '.workout-launch .workout-kicker{grid-column:1/-1}',
    '.workout-launch .workout-number{display:block}',
    '.workout-launch .workout-label{display:block}',
    '.workout-launch .workout-launch-bottom{display:flex}',
    '.workout-launch-cta{display:inline-block}',
    '.fixed-detail-header{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;margin:4px 0 26px}',
    '.fixed-detail-header h1{margin:0;text-align:center;font-size:19px;font-weight:900}',
    '.fixed-detail-format{color:var(--work-light);font-size:12px;font-weight:900;letter-spacing:.11em;text-transform:uppercase;margin-bottom:8px}',
    '.fixed-detail-title{font-size:34px;line-height:1.02;margin:0 0 12px;font-weight:950;letter-spacing:-.04em}',
    '.fixed-detail-description{margin:0 0 22px;color:var(--text-muted);font-size:14px;line-height:1.5}',
    '.fixed-detail-section-title{margin:0 0 9px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted)}',
    '.fixed-detail-exercises{list-style:none;padding:0;margin:0 0 14px;background:var(--card);color:var(--card-text);border-radius:16px;overflow:hidden}',
    '.fixed-detail-exercises li{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:14px 16px;border-bottom:1px solid #d5dbd8}',
    '.fixed-detail-exercises li:last-child{border-bottom:0}',
    '.fixed-detail-exercise-name{font-size:14px;font-weight:800;line-height:1.35}',
    '.fixed-detail-exercise-name small{display:block;margin-top:2px;color:var(--card-muted);font-size:11px;font-weight:650}',
    '.fixed-detail-exercises strong{font-size:13px;color:var(--work-dark);white-space:nowrap}',
    '.fixed-detail-best{margin:14px 0;border:1px solid var(--surface-2);border-radius:14px;padding:13px 15px;display:flex;justify-content:space-between;gap:16px;color:var(--text-muted);font-size:13px;font-weight:700}',
    '.fixed-detail-best strong{color:var(--rest);font-size:15px;font-variant-numeric:tabular-nums}',
    '.fixed-detail-provenance{margin:14px 0 0;color:var(--text-muted);font-size:11px;line-height:1.45}',
    '.fixed-detail-start{width:100%;border:0;background:var(--work);color:#101416;border-radius:15px;padding:18px;margin-top:24px;font-weight:950;text-transform:uppercase;letter-spacing:.04em;font-size:15px}',
    '@media (max-width:380px){#workoutDetail{padding-left:14px;padding-right:14px}}'
  ].join('');document.head.appendChild(style);}

  function createDetailScreen(){var main=document.createElement('main');main.id='workoutDetail';main.className='screen hidden';main.innerHTML='<header class="fixed-detail-header"><button class="back-btn" type="button" aria-label="Back to workouts" id="fixedWorkoutDetailBack">←</button><h1>Workout</h1><span class="header-spacer"></span></header><div class="fixed-detail-format" id="fixedWorkoutDetailFormat"></div><h2 class="fixed-detail-title" id="fixedWorkoutDetailTitle"></h2><p class="fixed-detail-description" id="fixedWorkoutDetailDescription"></p><h3 class="fixed-detail-section-title">Exercises</h3><ol class="fixed-detail-exercises" id="fixedWorkoutDetailExercises"></ol><div class="fixed-detail-best hidden" id="fixedWorkoutDetailBest"><span>Personal best</span><strong id="fixedWorkoutDetailBestValue">No time yet</strong></div><p class="fixed-detail-provenance hidden" id="fixedWorkoutDetailProvenance"></p><button class="fixed-detail-start" type="button" id="fixedWorkoutDetailStart">Start workout</button>';var nav=document.getElementById('bottomNav');nav.parentNode.insertBefore(main,nav);document.getElementById('fixedWorkoutDetailBack').addEventListener('click',function(){showLanding('workouts');});document.getElementById('fixedWorkoutDetailStart').addEventListener('click',startSelectedWorkout);}

  function rewriteCard(button,workoutId){var meta=CARD_META[workoutId];button.removeAttribute('onclick');button.setAttribute('aria-label','View '+(workoutId==='sevenMinute'?'7 Minute Workout':workoutId==='workout300'?'300 Workout':meta.name)+' details');button.innerHTML='<span class="workout-kicker"></span><span class="workout-number"></span><span class="workout-label"></span><span class="workout-launch-bottom"><span class="workout-launch-meta"><span class="card-format"></span><span class="card-summary"></span></span><span class="workout-launch-cta">View →</span></span>';button.querySelector('.workout-kicker').textContent=meta.kicker;button.querySelector('.workout-number').textContent=meta.number;button.querySelector('.workout-label').textContent=meta.name;button.querySelector('.card-format').textContent=meta.format;button.querySelector('.card-summary').textContent=meta.summary;button.addEventListener('click',function(){openWorkoutDetail(workoutId);});}
  function cleanCatalogue(){var list=document.querySelector('.workout-list');if(!list)return;var buttons=list.querySelectorAll('.workout-launch');if(buttons.length>=3){rewriteCard(buttons[0],'sevenMinute');rewriteCard(buttons[1],'cindy');rewriteCard(buttons[2],'workout300');}['.workout-detail','.review-toggle','#workoutReview'].forEach(function(selector){var element=document.querySelector(selector);if(element)element.remove();});var legacyBest=document.querySelector('.best-strip');if(legacyBest)legacyBest.classList.add('hidden');}
  function patchScreenNavigation(){baseShowScreen=root.showScreen;if(typeof baseShowScreen!=='function')return;root.showScreen=function(id){var detail=document.getElementById('workoutDetail');if(id==='workoutDetail'){['home','workouts','generator','equipment','generatedPreview','snackpick','player','workoutPlayer','done'].forEach(function(screenId){var screen=document.getElementById(screenId);if(screen)screen.classList.add('hidden');});detail.classList.remove('hidden');document.getElementById('bottomNav').classList.add('hidden');return;}if(detail)detail.classList.add('hidden');baseShowScreen(id);};}
  function install(){if(installed||!document.getElementById('workouts'))return;installed=true;styleUi();createDetailScreen();cleanCatalogue();patchScreenNavigation();}
  root.GarageFitWorkoutUI={cardMeta:CARD_META,detailDefinition:detailDefinition,openWorkoutDetail:openWorkoutDetail,startSelectedWorkout:startSelectedWorkout,install:install};
  if(document.readyState==='complete')install();else root.addEventListener('load',install,{once:true});
})(window);
