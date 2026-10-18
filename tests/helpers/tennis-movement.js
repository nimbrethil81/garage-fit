// Pure deterministic diagnostic: force each configured role from the same fresh
// state to compare composition without inventing performed history or role credit.
global.window=global;
for(const file of ['data/exercises','data/sport-profiles','data/sport-capabilities','data/programmes',
  'js/coach-model','js/training-history','js/sport-coverage','js/coach-policies','js/coach-tennis-policy','js/coach-engine','js/generator']) require('../../'+file);
const catalogue=GarageFitData.exercises,policy=GarageFitCoachTennisPolicy,Generator=GarageFitGenerator;
const now='2026-10-01T08:00:00Z';
const random=value=>()=>{value=(value*1664525+1013904223)>>>0;return value/4294967296;};
function roles({version=6,equipment=['dumbbells'],frequency=2,duration=30,seed=95,options={},settings={},consolidation=false,catalogue=GarageFitData.exercises}={}) {
  const engine=GarageFitCoachEngine.createEngine({catalogue,assessSessionPrescription:Generator.assessSessionPrescription});
  const definition=GarageFitData.programmes['tennis-conditioning'][version];
  const started=engine.startProgramme(definition,{programmeInstanceId:'movement-diagnostic',equipment,
    programmeSettings:{sportId:'tennis',focus:'balanced',weeklyCoachFrequency:frequency,...settings}},now);
  if(!started.state)return {blocked:started.assessment.conflicts};
  const state=started.state;
  if(consolidation){
    state.startedAt='2026-09-01T08:00:00Z';
    state.currentTargets.tennisDevelopment.developmentStartedAt=state.startedAt;
    state.currentTargets.tennisDevelopment.eligibleDevelopmentSessions=6;
  }
  const history=GarageFitTrainingHistory.createHistory([],catalogue);
  const sport=GarageFitSportCoverage.createPolicy(GarageFitData.sportCapabilityPolicies.tennis[definition.sportPolicy.version],catalogue);
  const today={now,localDate:now.slice(0,10),equipment,duration,prescriptionId:'movement-diagnostic-rx',...options};
  const priorities=policy.calculatePriorities({definition,catalogue,state,history,today});
  return {state,rows:definition.sessionRoles[frequency].map(role=>{
    const rx=policy.buildPrescription({definition,catalogue,state,history,today,priorities:{...priorities,role},
      assessSessionPrescription:request=>Generator.assessSessionPrescription({catalogue,sessionPrescription:request})});
    const assessment=Generator.assessSessionPrescription({catalogue,sessionPrescription:rx});
    if(assessment.status==='infeasible'||rx.programmeContext.restRecommendation)return {role:role.id,rx,assessment,rest:rx.programmeContext.restRecommendation};
    const workout=Generator.generate({catalogue,sessionPrescription:rx,random:random(seed)});
    const blocks=workout.main.blocks.map(block=>({protocol:block.protocol,intent:block.intent,seconds:block.estimatedDurationSeconds,
      prescription:block.prescription,exercises:block.exercises.map(e=>({id:e.id,requirementId:e.coachAnchor?.requirementId||null,
        facets:sport.classifyExercise(e.id).contributions.map(c=>c.capabilityId+'/'+c.facet)}))}));
    const entries=blocks.flatMap(b=>b.exercises),relevant=e=>e.facets.some(f=>f.startsWith('lateral-movement/')||f.startsWith('trunk/')||f.startsWith('endurance/')||f.startsWith('power/'));
    return {role:role.id,rx,assessment,workout,blocks,share:entries.filter(relevant).length/entries.length,
      // Work time (not rest) makes share meaningful across multi-set protocols.
      workShare:(()=>{let total=0,fit=0;for(const b of workout.main.blocks)for(const step of Generator.resolveBlockSteps(b))if(step.kind==='exercise'){
        const exercise=b.exercises[step.exerciseIndex],e=entries.find(e=>e.id===exercise.id);
        const seconds=step.seconds ?? exercise.estimatedSeconds;total+=seconds;if(relevant(e))fit+=seconds;
      }return total?fit/total:0;})()};
  })};
}
module.exports={roles,random};
