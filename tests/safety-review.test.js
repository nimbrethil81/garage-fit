const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {manifest,sample,write,verify}=require('../scripts/safety-review/export');
test('editorial sampler replays real resolved plans, infeasibility and synthetic Coach context',async()=>{
  const all=manifest();
  const input={...all,cases:all.cases.filter(c=>['family-strength-control-demanding','family-core-stability-restricted','fixed-cindy','coach-general-fitness'].includes(c.id))};
  const a=await sample(input),b=await sample(input);
  assert.deepEqual(a,b);
  assert.equal(a.cases.find(c=>c.id.includes('restricted')).outcome,'infeasible');
  const generated=a.cases[0].sessions[0];
  assert.ok(generated.plannedWork.length);
  assert.ok(generated.timeline.some(x=>x.kind==='rest'&&x.seconds>0));
  for(const work of generated.plannedWork)assert.ok(work.occurrenceId&&work.prescription);
  for(const ex of Object.values(generated.catalogue)){assert.ok(ex.authored.instruction);assert.equal(ex.approvedGuidance,null);}
  assert.equal(a.cases.find(c=>c.route==='fixed').sessions[0].workout.termination.type,'amrap');
  const coach=a.cases.find(c=>c.route==='coach');
  assert.equal(coach.outcome,'generated');
  assert.equal(coach.sessions[0].syntheticResult.finalStatus,'completed');
  assert.equal(coach.sessions[1].syntheticResult.finalStatus,'partial');
  assert.equal(coach.sessions[2].syntheticResult,undefined);
  assert.deepEqual(coach.sessions[2].stateBefore.state,coach.sessions[2].stateAfter.state);
  assert.ok(coach.sessions[3].stateBefore.results.length>=2);
});
test('local packet readback detects tampering; developer outputs cannot enter shipped assets',async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'gf-review-test-'));
  try{
    const input=manifest();input.cases=input.cases.filter(c=>c.id==='fixed-cindy');
    const dir=path.join(parent,'packet');await write(dir,input);assert.equal(verify(dir),true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'findings.json'))).status,'not-reviewed');
    fs.appendFileSync(path.join(dir,'review.md'),'tampered');assert.throws(()=>verify(dir),/Checksum/);
    await assert.rejects(write(path.resolve(__dirname,'../data/evidence'),input),/outside/);
    await assert.rejects(sample({...input,cases:[{...input.cases[0],route:'coach',configuration:{outcomes:new Array(9).fill('completed')}}]}),/Invalid replay/);
  }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
