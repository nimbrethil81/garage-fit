const vm = require('node:vm');
const {loadAppContext} = require('./app-context');

function pilot(storage = new Map(), programmeId = 'general-strength-4w', version = 1) {
  const app = loadAppContext(storage, {ownIntrinsics:true});
  const run = source => vm.runInContext(source, app);
  run(`
    const pilotDef=GarageFitData.programmes[${JSON.stringify(programmeId)}][${version}];
    const pilotStore=GarageFitCoachStore.createStore(localStorage);
    const pilotEngine=GarageFitCoachEngine.createEngine({catalogue:CATALOGUE,assessSessionPrescription:GarageFitGenerator.assessSessionPrescription});
    let pilotNow='2026-10-01T08:00:00Z',pilotId=0;
    const pilot=GarageFitCoachUI.createController({store:pilotStore,engine:pilotEngine,catalogue:CATALOGUE,buildTimeline:buildGeneratedTimeline,
      clock:()=>pilotNow,id:prefix=>prefix+':'+(++pilotId)});
    const pilotOptions={equipment:${JSON.stringify(programmeId==='build-arms'?['dumbbells','bench']:['dumbbells'])},duration:30};
    let pilotTracker=null;
  `);
  const json = source => JSON.parse(run(`JSON.stringify(${source})`));
  const start = () => run('pilot.start(pilotDef,pilotOptions.equipment)');
  const begin = async options => { run(`pilot.prepare(${options || 'pilotOptions'})`); await run('pilot.begin().then(value=>{pilotTracker=value;})'); };
  const log = (requirement='anchor-squat', reps='undefined', load='12') => run(`(async()=>{
    for(const work of pilotTracker.plannedWork().filter(item=>item.requirementId===${JSON.stringify(requirement)})){
      const reps=${reps}===undefined?work.prescription.reps:${reps};
      await pilotTracker.recordAnchor(work.occurrenceId,{status:'completed',sets:[{reps,load:${load},...(${load}===null?{}:{loadUnit:'kg',loadInterpretation:'total'})}]});
    }
  })()`);
  const finish = (kind='exit') => run(`pilot.finish('${kind}',{difficulty:'about-right'},600)`);
  return {app,run,json,start,begin,log,finish,storage};
}

module.exports = {pilot};
