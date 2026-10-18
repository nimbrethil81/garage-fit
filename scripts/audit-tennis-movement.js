// #159 before/after Main grid, independent of clocks, browser storage and network.
// node scripts/audit-tennis-movement.js > /tmp/tennis-movement.json
const {roles}=require('../tests/helpers/tennis-movement');
const kits={bodyweight:[],dumbbells:['dumbbells'],trx:['trx'],mixed:['dumbbells','kettlebell','trx','pullup-bar']};
const report=[];
for(const version of [5,6])for(const [kit,equipment] of Object.entries(kits))
  for(const duration of [20,30,45])for(const frequency of [2,3])for(const seed of [1,29,95]) {
    const cell={version,kit,duration,frequency,seed},result=roles({...cell,equipment});
    if(result.blocked){report.push({...cell,blocked:result.blocked});continue;}
    for(const row of result.rows)report.push({...cell,role:row.role,seconds:row.workout?.estimatedSeconds,
      mainSeconds:row.workout?.main.estimatedDurationSeconds,roleShare:row.share,roleWorkShare:row.workShare,
      warnings:row.rx.programmeContext.warnings,anchors:row.rx.requiredAnchors,blocks:row.blocks,
      conflicts:row.assessment.hardConflicts,rest:row.rest});
  }
console.log(JSON.stringify(report,null,2));
