// Reproducible review samples for #403; simulated inputs, not user research.
// node scripts/sample-athletic-v6.js > /tmp/athletic-v6-samples.md
const {loadAppContext}=require('../tests/helpers/app-context');
const app=loadAppContext(new Map(),{ownIntrinsics:true});
function random(style){let first=true,s=7;return()=>{if(first){first=false;return style;}s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function generate(consumer,version,duration,style,recent=false){
 const G=app.GarageFitGenerator,C=app.GarageFitData.exercises;
 const options={catalogue:C,duration,difficulty:'normal',equipment:[],random:random(style)};
 if(consumer==='Generator')Object.assign(options,{workoutFamilyId:'athletic-movement',workoutFamilyVersion:version});
 else {
  const tennis=consumer==='Tennis',definition=app.GarageFitData.programmes[tennis?'tennis-conditioning':'general-fitness'][tennis?(version===6?10:9):2];
  const engine=app.GarageFitCoachEngine.createEngine({catalogue:C,assessSessionPrescription:G.assessSessionPrescription});
  const equipment=tennis?['dumbbells']:[],now='2026-11-16T08:00:00Z';
  const state=engine.startProgramme(definition,{programmeInstanceId:'sample',equipment,...(tennis?{programmeSettings:{sportId:'tennis',focus:'balanced',weeklyCoachFrequency:2}}:{})},now).state;
  const today={now,localDate:'2026-11-16',prescriptionId:'sample-rx',duration,difficulty:'normal',equipment};
  let rx;
  if(tennis){
   const policy=app.GarageFitCoachTennisPolicy,history=app.GarageFitTrainingHistory.createHistory([],C);
   const priorities=policy.calculatePriorities({definition,catalogue:C,state,history,today});
   priorities.role=definition.sessionRoles[2][1];
   rx=policy.buildPrescription({definition,catalogue:C,state,history,today,priorities,assessSessionPrescription:G.assessSessionPrescription});
  }else{
   rx=engine.planNextSession(definition,state,[],today).prescription;
   rx.workoutFamilyPlan.candidates=rx.workoutFamilyPlan.candidates.filter(item=>item.workoutFamilyId==='athletic-movement');
   rx.workoutFamilyPlan.candidates[0].workoutFamilyVersion=version;
  }
  options.sessionPrescription=rx;
 }
 if(recent){const prior=generate(consumer,version,duration,style,false);const work=app.GarageFitSessionTracker.plannedWorkFromTimeline(app.buildGeneratedTimeline(prior));
  options.recentFamilySessions={'athletic-movement':{workoutFamilyVersion:version,familyStyleId:prior.familyStyleId,plannedOccurrences:work.length,
   completedOccurrences:work.map(item=>({exerciseId:item.exerciseId,blockIndex:item.blockIndex}))}};
 }
 return G.generate(options);
}
function describe(w){
 const G=app.GarageFitGenerator,main=w.main.blocks.filter(b=>G.blockTrainingSection(b)==='main');
 let technical=0,conditioning=0,all=0;
 for(const b of w.main.blocks)for(const item of G.resolvedOccurrences(b)){
  const sec=item.seconds*G.sideCount(item.exercise);all+=sec;
  if(G.blockTrainingSection(b)==='main'){if(b.familyContext.role==='conditioning')conditioning+=sec;else technical+=sec;}
 }
 const sequence=main.map(b=>b.familyContext.role+': '+b.exercises.map(ex=>ex.id).join(' → ')+' × '+b.prescription.rounds).join('<br>');
 return `${w.familyStyleId}; technical ${technical}s, conditioning-role ${conditioning}s; rest/transitions ${w.estimatedSeconds-all}s<br>${sequence}`;
}
console.log('# Athletic v5/v6 resolved comparison samples\n');
console.log('Normal; seed 7 after style draws 0.1/0.5/0.9; no confirmed movement room; default impact exclusions. Generator and General Fitness use no kit. Tennis has dumbbells for programme feasibility, while the Athletic workouts use bodyweight. General Fitness is restricted to its Athletic candidate and Tennis to its eligible movement role for comparison; these diagnostics do not change production family/role ranking. Counts use actual resolved seconds and both sides. Conditioning-role work is distinct from the stricter energetic-credit calculation in the calibration document. Preparation/finish are excluded from Main. Rest/transitions include all sections.\n');
for(const consumer of ['Generator','General Fitness','Tennis']){
 console.log(`## ${consumer}\n\n| Minutes / style draw | v5 | v6 |\n| --- | --- | --- |`);
 for(const duration of [20,30,45])for(const style of [.1,.5,.9])console.log(`| ${duration} / ${style} | ${describe(generate(consumer,5,duration,style))} | ${describe(generate(consumer,6,duration,style))} |`);
}
console.log('\n## Completed-history example\n');
for(const consumer of ['Generator','General Fitness','Tennis'])console.log(`- ${consumer}, 30 minutes, draw 0.1, immediately preceding fully completed same-seed v6 session: ${describe(generate(consumer,6,30,.1,true))}\n`);
console.log('These deterministic examples demonstrate structural variety and safe timing, not proof of enjoyment or user testing. Protected Tennis days use the existing conservative path; the focused regression suite checks that path separately.');
