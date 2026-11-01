const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness() {
  const context = vm.createContext({}); context.window=context;
  for (const file of ['data/equipment.js','data/exercises.js','js/generator.js','js/challenge300.js','js/backup-registry.js']) vm.runInContext(fs.readFileSync(file,'utf8'),context);
  return {api:context.GarageFitChallenge300,data:context.GarageFitData,registry:context.GarageFitBackupRegistry};
}
const clone = x => JSON.parse(JSON.stringify(x));
function seeded(seed) { return () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }; }
const {api,data,registry}=harness();
test('seeded challenge generation preserves exact ladder, metadata, equipment, balance and variety including bodyweight', () => {
  const configurations=[[],['dumbbells'],['kettlebell'],['trx'],['rings'],['bands'],['barbell'],data.equipment.map(item=>item.id)];
  for (const equipment of configurations) {
    const sequences=new Set();
    for (const seed of [1,2,3,4,5,6,7,8]) {
      const value=api.generate({equipment,random:seeded(seed)});
      assert.deepEqual(clone(api.generate({equipment,random:seeded(seed)})),clone(value));
      assert.equal(api.validate(value,{equipment}).valid,true);
      assert.deepEqual(clone(value.exercises.map(ex=>ex.reps)),[25,50,50,50,50,50,25]);
      assert.equal(value.exercises.reduce((sum,ex)=>sum+ex.reps,0),300);
      assert.equal(new Set(value.exercises.map(ex=>ex.exerciseId)).size,7);
      assert.equal(value.difficulty,'hard');
      const exercises=value.exercises.map(slot=>data.exercises[slot.exerciseId]);
      for (const ex of exercises) assert.equal(ex.equipment.every(group=>group.some(id=>equipment.includes(id))),true);
      assert.ok(exercises.filter(ex=>ex.impact==='high').length<=1);
      assert.ok(exercises.some(ex=>ex.patterns.includes('push')));
      assert.ok(exercises.some(ex=>ex.patterns.includes('hinge')));
      assert.ok(exercises.some(ex=>ex.patterns.includes('core')));
      assert.ok(exercises.some(ex=>ex.conditioning&&ex.cardio>=4));
      sequences.add(value.exercises.map(ex=>ex.exerciseId).join(','));
    }
    assert.ok(sequences.size>1);
  }
});
test('high-rep eligibility is reviewed separately from Hard tags and rejects per-side/timed/odd alternating targets', () => {
  assert.equal(api.eligible(data.exercises['burpees'],25,[]),true);
  assert.equal(api.eligible(data.exercises['burpees'],50,[]),false);
  assert.equal(api.eligible(data.exercises['reverse-nordic'],50,[]),false);
  assert.equal(api.eligible(data.exercises['reverse-lunge'],50,[]),false);
  assert.equal(api.eligible(data.exercises['mountain-climbers'],50,[]),false);
  assert.equal(api.eligible(data.exercises['walking-lunge'],25,[]),false);
  assert.equal(api.eligible(data.exercises['walking-lunge'],50,[]),true);
  assert.equal(api.eligible(data.exercises['trx-row'],50,[]),false);
  assert.equal(api.eligible(data.exercises['trx-row'],50,['trx']),true);
});
test('infeasible selection is explained rather than lowered; rep, balance and equipment violations fail validation', () => {
  assert.throws(()=>api.generate({catalogue:{'air-squat':data.exercises['air-squat']}}),/cannot currently support/);
  const value=api.generate({random:seeded(1)}), bad=clone(value);
  bad.exercises[1].reps=25; assert.equal(api.validate(bad).valid,false);
  const repeated=clone(value); repeated.exercises[1]=repeated.exercises[0]; assert.equal(api.validate(repeated).valid,false);
  const unavailable=clone(value); unavailable.exercises[1].exerciseId='trx-row'; assert.equal(api.validate(unavailable,{equipment:[]}).valid,false);
});
test('whole-workout swaps retain dose/ownership/fatigue and starting locks an independent snapshot', () => {
  const equipment=data.equipment.map(item=>item.id), value=api.generate({equipment,random:seeded(5)});
  let swaps=0;
  for (let i=0;i<7;i++) {
    try {
      const next=api.swap(value,i,{equipment,random:seeded(i+1)});
      assert.equal(api.validate(next,{equipment}).valid,true);
      assert.notEqual(next.exercises[i].exerciseId,value.exercises[i].exerciseId);
      assert.equal(next.exercises[i].reps,value.exercises[i].reps);
      assert.equal(next.exercises.filter((ex,j)=>ex.exerciseId!==value.exercises[j].exerciseId).length,1); swaps++;
    } catch(error) { assert.match(error.message,/No compatible replacement/); }
  }
  assert.ok(swaps>0);
  const locked=api.freeze(value,{equipment});
  assert.equal(Object.isFrozen(locked.exercises[0]),true);
  const original=locked.exercises[0].name; value.exercises[0].name='changed'; assert.equal(locked.exercises[0].name,original);
  assert.throws(()=>api.swap(locked,0,{equipment}),/locked/);
  assert.throws(()=>api.freeze(api.generate({equipment,random:seeded(8)}),{equipment:[]}),/unavailable|balance/);
});
test('versioned exact results are durable, idempotent and isolated from the legacy PB', () => {
  const map=new Map([['gf_300_pb_seconds','42']]),storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  const prescription=api.freeze(api.generate({random:seeded(1)}));
  const result=api.createResult(prescription,{resultId:'challenge-1',elapsedSeconds:902,completedAt:'2026-10-31T12:00:00Z'});
  api.saveResult(storage,result); api.saveResult(storage,result);
  assert.equal(api.readHistory(storage).results.length,1);
  assert.deepEqual(clone(api.readHistory(storage).results[0].prescription),clone(prescription));
  assert.equal(map.get('gf_300_pb_seconds'),'42');
  assert.doesNotThrow(()=>registry.validate([[api.HISTORY_KEY,map.get(api.HISTORY_KEY)]]));
  const duplicate=api.readHistory(storage); duplicate.results.push(duplicate.results[0]);
  assert.equal(api.validHistory(duplicate),false);
  for (const mutate of [x=>x.elapsedSeconds=-1,x=>x.elapsedSeconds=1.5,x=>x.completedAt='bad',x=>x.schemaVersion=2,x=>x.status='unknown',x=>x.prescription.exercises[1].reps=1]) {
    const bad=clone(result); mutate(bad); assert.equal(api.validHistory({version:1,results:[bad]}),false);
    assert.throws(()=>registry.validate([[api.HISTORY_KEY,JSON.stringify({version:1,results:[bad]})]]),/damaged/);
  }
  const partial=api.createResult(prescription,{resultId:'partial-1',status:'partial',elapsedSeconds:180,completedAt:'2026-10-31T12:00:00Z'});
  api.saveResult(storage,partial); assert.equal(api.readHistory(storage).results[1].status,'partial');
});
