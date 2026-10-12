// Reproduce #95's bounded feasible-output and performed-history release gate.
// No browser/production storage, external services or catalogue edits.
const {matrix,simulate,kits}=require('../tests/helpers/tennis-pilot');
(async()=>{
  const report={seed:95,weeks:8,matrix:await matrix(),simulations:[]};
  for(const frequency of [1,2,3]) for(const duration of [10,15,20,30,45])
    for(const equipment of [kits.dumbbells,kits.trx,kits['kb-pullup']])
      report.simulations.push(await simulate({frequency,duration,equipment}));
  report.spaciousComparison=await simulate({smallSpace:false});
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
