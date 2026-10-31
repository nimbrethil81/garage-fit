#!/usr/bin/env node
'use strict';
// Manual developer tooling. Uses synthetic VM storage, never browser/user storage.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {pilot} = require('../../tests/helpers/coach-pilot');
const ROOT = path.resolve(__dirname, '../..');
const plain = x => JSON.parse(JSON.stringify(x));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
function rng(seed) { return () => { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }; }
function context(programme='general-fitness', version=2, seed=362) {
  const p=pilot(new Map(),programme,version,{rampupUi:true});
  p.run(`Math.random=(${rng.toString()})(${seed}); Date.now=()=>1790841600000;`);
  vm.runInContext(fs.readFileSync(path.join(ROOT,'data/exercise-guidance.js'),'utf8'),p.app);
  return p;
}
function manifest() {
  const p=context(), cases=[];
  for(const family of p.app.GarageFitWorkoutFamilies.FAMILY_IDS) {
    for(const [label, config] of Object.entries({baseline:{duration:20,difficulty:'normal',equipment:[]},demanding:{duration:45,difficulty:'hard',equipment:['dumbbells','trx','rings'],movementRoom:true},restricted:{duration:10,difficulty:'easy',equipment:[],excludedImpact:['medium','high'],movementRoom:false,bodyPositions:['standing']}})) {
      cases.push({id:`family-${family}-${label}`,route:'generator',seed:362,configuration:{workoutFamilyId:family,workoutFamilyVersion:p.app.GarageFitWorkoutFamilies.currentVersion(family),...config},purpose:label});
    }
  }
  for(const difficulty of ['easy','normal','hard']) cases.push({id:`legacy-${difficulty}`,route:'generator',seed:363,configuration:{duration:30,difficulty,equipment:difficulty==='hard'?['dumbbells']:[]},purpose:'legacy baseline/dose comparison'});
  for(const id of ['workout300','cindy']) cases.push({id:`fixed-${id}`,route:'fixed',seed:364,configuration:{id},purpose:'authored high-volume/time-capped workout'});
  for(const [programme,version] of [['general-fitness',2],['general-strength-4w',1],['build-arms',1]]) cases.push({id:`coach-${programme}`,route:'coach',seed:365,configuration:{programme,version,duration:30,equipment:programme==='build-arms'?['dumbbells','bench']:['dumbbells'],outcomes:['completed','partial','missed','completed']},purpose:'longitudinal synthetic progression/recovery'});
  return {schemaVersion:1,clock:'2026-10-01T08:00:00.000Z',cases};
}
function resolved(p,workout,fixed=false) {
  const timeline=fixed?null:p.app.buildGeneratedTimeline(workout);
  const exercises=fixed?p.run(`fixedWorkoutExercises(FIXED_WORKOUTS[${JSON.stringify(workout.id)}])`):timeline.filter(x=>x.kind==='exercise').map(x=>x.exercise);
  return plain({workout,timeline,plannedWork:timeline?p.app.GarageFitSessionTracker.plannedWorkFromTimeline(timeline):null,
    fixedOccurrences:fixed?exercises.map((exercise,index)=>({occurrenceId:`fixed:${index}`,exercise,termination:workout.termination})):null,
    catalogue:Object.fromEntries(exercises.map(ex=>[ex.id,{authored:p.app.GarageFitData.exercises[ex.id],approvedGuidance:p.app.GarageFitData.exerciseGuidance(ex.id),guidanceStatus:p.app.GarageFitData.exerciseGuidance(ex.id)?'available-approved':'unavailable'}])),
    evidenceMeaning:'All targets and loads are planned. Synthetic results are simulations, never human performed measurements. Fixed repetitions/termination are authored; no invented timeline or recovery.'});
}
async function sample(input=manifest()) {
  if(input.schemaVersion!==1||!Array.isArray(input.cases)||input.cases.length>64) throw Error('Invalid/beyond bounded manifest');
  if(!Number.isFinite(Date.parse(input.clock))||input.cases.some(c=>!c.id||!Number.isInteger(c.seed)||!c.configuration||c.route==='coach'&&(!Array.isArray(c.configuration.outcomes)||c.configuration.outcomes.length>8||c.configuration.outcomes.some(x=>!['completed','partial','missed'].includes(x)))))throw Error('Invalid replay inputs');
  if(new Set(input.cases.map(x=>x.id)).size!==input.cases.length) throw Error('Duplicate case ID');
  const cases=[];
  for(const spec of input.cases) {
    const c={...plain(spec),sessions:[]};cases.push(c);
    try {
      const cfg=spec.configuration,p=context(cfg.programme,cfg.version,spec.seed);
      p.run(`Date.now=()=>${Date.parse(input.clock)};pilotNow=${JSON.stringify(input.clock)}`);
      if(spec.route==='coach') {
        await p.start();
        for(let i=0;i<cfg.outcomes.length;i++) {
          const clock=new Date(Date.parse(input.clock)+i*3*86400000).toISOString();
          p.run(`pilotNow=${JSON.stringify(clock)};Date.now=()=>${Date.parse(clock)}`);
          const before=p.json('pilot.snapshot()'),preview=p.run(`pilot.prepare(${JSON.stringify({duration:cfg.duration,equipment:cfg.equipment,difficulty:'normal'})})`);
          const session={id:`${spec.id}/${i+1}`,clock,syntheticOutcome:cfg.outcomes[i],stateBefore:before,preview:plain(preview.plan),...resolved(p,preview.workout)};
          c.sessions.push(session);
          if(cfg.outcomes[i]!=='missed') {
            await p.run('pilot.begin().then(value=>{pilotTracker=value})');
            await p.run(`(async()=>{const work=pilotTracker.plannedWork().filter(x=>x.section==='main');for(const item of (${cfg.outcomes[i]==='partial'}?work.slice(0,1):work))await pilotTracker.recordDone(item.occurrenceId);})()`);
            session.syntheticResult=plain(await p.finish(cfg.outcomes[i]==='partial'?'exit':'complete'));
          }
          session.stateAfter=p.json('pilot.snapshot()');
        }
      } else if(spec.route==='generator') {
        const workout=p.app.GarageFitGenerator.generate({...cfg,catalogue:p.app.GarageFitData.exercises,random:rng(spec.seed)});
        c.sessions.push({id:spec.id,clock:input.clock,...resolved(p,workout)});
      } else if(spec.route==='fixed') {
        const workout=p.app.GarageFitData.fixedWorkouts[cfg.id];if(!workout)throw Error('Unknown fixed workout');
        c.sessions.push({id:spec.id,clock:input.clock,...resolved(p,workout,true)});
      } else throw Error('Unknown route');
      c.outcome='generated';
    } catch(error) {c.outcome=['family-not-feasible','session-prescription-infeasible'].includes(error.code)?'infeasible':'failed';c.error=plain({message:error.message,code:error.code,reasons:error.reasons,assessment:error.assessment});}
  }
  return {schemaVersion:1,manifest:input,cases};
}
function markdown(packet) {
  const lines=['# Synthetic editorial evidence — NOT a safety assessment',
    `Source: ${packet.provenance.sourceSha}; schema 1. No findings accepted, no launch clearance.`,
    'Full resolved records and synthetic state/results are in packet.json. All doses/loads below are planned.'];
  for(const c of packet.cases) {
    lines.push(`## ${c.id}: ${c.outcome}`,`Purpose: ${c.purpose}; seed ${c.seed}`,`Configuration: ${JSON.stringify(c.configuration)}`);
    if(c.error)lines.push(JSON.stringify(c.error));
    for(const s of c.sessions) {
      lines.push(`### ${s.id} (${s.clock})`,s.syntheticOutcome?`Synthetic outcome: ${s.syntheticOutcome}`:'Unperformed proposed workout');
      if(s.preview)lines.push(`Coach rationale: ${JSON.stringify(s.preview.rationale)}`);
      lines.push(`Workout: ${s.workout.name||s.workout.workoutFamilyId||'legacy'}; estimated seconds: ${s.workout.estimatedSeconds??'not specified'}; termination: ${JSON.stringify(s.workout.termination||null)}`);
      for(const [i,block] of (s.workout.main?.blocks||[]).entries())lines.push(`Block ${i}: ${block.protocol}; ${JSON.stringify(block.prescription)}`);
      for(const step of s.timeline||[]) {
        if(step.kind!=='exercise') {lines.push(`- ${step.section}: ${step.kind}, ${step.seconds??'unspecified'} seconds${step.label?' — '+step.label:''}`);continue;}
        const work=s.plannedWork.find(w=>w.occurrenceId===step.occurrenceId);
        lines.push(`- ${step.occurrenceId}: ${step.section} / ${step.exercise.id} / ${step.side||'bilateral'}; target ${JSON.stringify(work?.prescription||{})}`);
      }
      for(const item of s.fixedOccurrences||[])lines.push(`- ${item.occurrenceId}: ${item.exercise.id}; authored dose ${JSON.stringify(item.exercise)}; repeat/stop ${JSON.stringify(item.termination)}`);
      lines.push('Canonical teaching (approved guidance unavailable is an evidence gap):');
      for(const [id,ex] of Object.entries(s.catalogue))lines.push(`- **${id}**: ${ex.authored.instruction} Equipment: ${JSON.stringify(ex.authored.equipment)}; difficulty: ${ex.authored.difficulty}; impact: ${ex.authored.impact}. Guidance: ${ex.approvedGuidance?JSON.stringify(ex.approvedGuidance):'unavailable'}`);
    }
  }
  return lines.join('\n\n')+'\n';
}
function verify(directory) {
  const list=JSON.parse(fs.readFileSync(path.join(directory,'checksums.json')));
  if(list.schemaVersion!==1||!list.files||Object.keys(list.files).length!==4)throw Error('Invalid checksum manifest');
  for(const name of ['inputs.json','packet.json','review.md','findings.json'])if(hash(fs.readFileSync(path.join(directory,name)))!==list.files[name])throw Error('Checksum mismatch: '+name);
  return true;
}
async function write(directory,input=manifest()) {
  directory=path.resolve(directory);
  if(directory===ROOT||directory.startsWith(ROOT+path.sep))throw Error('Evidence must be outside the repository/shipped assets');
  if(fs.existsSync(directory))throw Error('Use a fresh output directory');
  const packet=await sample(input);
  const sourceSha=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  packet.provenance={sourceSha,dirty:!!execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim(),node:process.version,
    sourceHashes:Object.fromEntries(['index.html',...fs.readdirSync(path.join(ROOT,'js')).filter(x=>x.endsWith('.js')).map(x=>'js/'+x),...fs.readdirSync(path.join(ROOT,'data')).filter(x=>x.endsWith('.js')).map(x=>'data/'+x),'scripts/safety-review/export.js','tests/helpers/app-context.js','tests/helpers/coach-pilot.js'].map(f=>[f,hash(fs.readFileSync(path.join(ROOT,f)))])),identity:'Case/session IDs are stable; production workout IDs use the pinned clock. Source SHA plus hashes identify implementation, family and policy versions are also retained in resolved records.'};
  fs.mkdirSync(directory,{recursive:true});
  const files={'inputs.json':JSON.stringify(input,null,2)+'\n','packet.json':JSON.stringify(packet,null,2)+'\n','review.md':markdown(packet),'findings.json':JSON.stringify({schemaVersion:1,status:'not-reviewed',findings:[],findingTemplate:{caseId:null,occurrenceId:null,evidence:null,plausibleHarm:null,severity:null,confidence:null,uncertainty:null,mitigation:null,references:[],challenge:{reviewer:null,independentFraming:null,outcome:null},humanDisposition:{decision:'deferred',rationale:'Awaiting human review'}}},null,2)+'\n'};
  for(const [name,body] of Object.entries(files))fs.writeFileSync(path.join(directory,name),body);
  fs.writeFileSync(path.join(directory,'checksums.json'),JSON.stringify({schemaVersion:1,files:Object.fromEntries(Object.entries(files).map(([name,body])=>[name,hash(body)]))},null,2)+'\n');
  verify(directory);return packet;
}
if(require.main===module)(async()=>{
  const [command,directory,inputFile]=process.argv.slice(2);
  if(command==='verify') {verify(directory);console.log('Local readback checksums verified.');}
  else if(command==='export'&&directory) {const p=await write(directory,inputFile?JSON.parse(fs.readFileSync(inputFile)):manifest());console.log(JSON.stringify({cases:p.cases.length,sessions:p.cases.reduce((n,c)=>n+c.sessions.length,0),outcomes:p.cases.map(c=>[c.id,c.outcome]),archive:'local-verified; not uploaded; not reviewed'}));if(p.cases.some(c=>c.outcome==='failed'))process.exitCode=1;}
  else throw Error('Usage: node scripts/safety-review/export.js export OUTSIDE_REPO [inputs.json] | verify DIRECTORY');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={manifest,sample,write,verify,markdown};
