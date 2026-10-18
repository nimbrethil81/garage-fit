// #79: bounded routing coverage, independent of the saved #53 characterisation.
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
const fixtures=require('./helpers/coach-fixtures');
global.window=global;
for(const f of ['data/equipment','data/exercises','data/sport-profiles','data/sport-capabilities','js/generator','js/coach-model','data/programmes','js/training-history','js/coach-policies','js/coach-engine'])require('../'+f+'.js');
const G=GarageFitGenerator,catalogue=GarageFitData.exercises,kit=GarageFitData.equipment.map(x=>x.id);
const random=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
const copy=x=>JSON.parse(JSON.stringify(x));
const engine=GarageFitCoachEngine.createEngine({catalogue,assessSessionPrescription:G.assessSessionPrescription});
function check(w,equipment){
  assert.deepEqual(G.validateMain(w.main,catalogue,equipment,G.BUDGETS[w.duration].main),[]);
  for(const b of w.main.blocks)if(b.protocol==='ladder'){
    assert.deepEqual(G.validateLadderBlock(b,catalogue),[]);
    assert.equal(w.main.blocks.filter(item=>item.protocol==='ladder').length,1);
  }
  for(const [index,b] of w.main.blocks.entries())if(b.protocol==='complex'){
    // Complexes follow an established block, once, and never carry Coach anchors.
    assert.deepEqual(G.validateComplexBlock(b,catalogue),[]);
    assert.ok(index>0&&w.main.blocks.filter(item=>item.protocol==='complex').length===1);
    assert.ok(b.exercises.every(ex=>!ex.coachAnchor));
  }
  for(const [index,b] of w.main.blocks.entries())if(b.protocol==='emom'){
    assert.deepEqual(G.validateEmomBlock(b,catalogue),[]);
    assert.ok(b.prescription.minutes>=3&&b.prescription.minutes<=12);
    assert.ok(b.exercises.length>=2&&b.exercises.length<=3);
    assert.ok(Math.ceil(b.prescription.minutes/b.exercises.length)<=4);
    assert.notEqual(w.main.blocks[index-1]?.protocol,'emom');
    assert.ok(b.exercises.every(ex=>!ex.coachAnchor));
  }
}

test('seeded standalone matrix spans duration/style/difficulty/body/kit with optional patterns and bounded quality',t=>{
  const report={};let seed=0;
  for(const duration of [10,15,20,30,45]){
    const row=report[duration]={sessions:0,protocols:{},blocks:{},maxMainError:0};
    for(const focus of ['strength','balanced','cardio'])for(const difficulty of ['easy','normal','hard'])
      for(const bodyFocus of ['full-body','upper','lower','core'])for(const equipment of [[],['dumbbells'],kit]){
        const options={catalogue,duration,focus,difficulty,bodyFocus,equipment,random:random((++seed*2654435761+duration)>>>0)};
        const w=G.generate(options);check(w,equipment);row.sessions++;
        row.blocks[w.main.blocks.length]=(row.blocks[w.main.blocks.length]||0)+1;
        assert.ok(w.main.blocks.length<=(duration<=20?2:3));
        assert.ok(Math.abs(w.estimatedSeconds-duration*60)<=Math.max(180,duration*60*.18));
        row.maxMainError=Math.max(row.maxMainError,Math.abs(w.main.estimatedDurationSeconds-G.BUDGETS[duration].main));
        const exercises=w.main.blocks.flatMap(b=>b.exercises);
        assert.ok(new Set(exercises.map(x=>x.id)).size>=3);
        assert.ok(new Set(exercises.flatMap(x=>x.patterns)).size>=2);
        if(difficulty==='easy')assert.ok(exercises.every(x=>x.difficulty!=='hard'));
        for(const b of w.main.blocks)row.protocols[b.protocol]=(row.protocols[b.protocol]||0)+1;
      }
    // Rare ladders have explicit bounded reachability seeds in ladder.test.js.
    for(const protocol of G.GENERATED_PROTOCOLS.filter(p=>!['ladder','pyramid','complex','density'].includes(p)))assert.ok(row.protocols[protocol]>0,`${duration}: ${protocol}`);
    assert.ok((row.protocols.complex||0)<row.sessions/6,'complexes remain occasional');
    if(duration>=20)assert.ok(row.protocols.complex>0,duration+': complexes reach longer sessions');
    assert.ok((row.protocols.ladder||0)<row.sessions/4,'ladders remain occasional');
    assert.ok((row.protocols.pyramid||0)<row.sessions/10,'pyramids remain modest supporting variety');
    assert.ok(row.protocols.emom<row.sessions/2,'no compulsory novelty');
    if(duration===10)assert.ok(row.blocks[1]>row.sessions*.8,'short Main is usually one coherent pattern');
  }
  t.diagnostic(JSON.stringify(report));
});

test('both production Coach programmes keep exact rounds anchors and recovery while optional EMOM remains reachable',t=>{
  const report={};
  for(const name of ['general-strength-4w','build-arms']){
    const def=GarageFitData.programmes[name][1],before=copy(def),state=engine.startProgramme(def,{programmeInstanceId:name,equipment:kit},'2026-10-17T08:00:00Z').state;
    report[name]={};let hits=0;
    for(const duration of [10,15,20,30,45])for(const difficulty of ['easy','normal','hard'])for(const bodyFocus of ['full-body','upper','lower','core']){
      const plan=engine.planNextSession(def,state,[],{now:'2026-10-17T08:00:00Z',duration,difficulty,bodyFocus,equipment:kit,prescriptionId:'matrix-rx'});
      if(!plan.prescription){assert.equal(plan.status,'infeasible');continue;}
      const rx=plan.prescription;
      const w=G.generate({catalogue,sessionPrescription:rx,random:random((duration*131+hits*9973+bodyFocus.length*31+difficulty.length)*2654435761>>>0)});
      check(w,kit);
      assert.ok(w.main.estimatedDurationSeconds<=G.BUDGETS[duration].main);
      for(const placement of w.prescriptionOutcome.requiredAnchorPlacements){
        const anchor=rx.requiredAnchors.find(a=>a.requirementId===placement.requirementId),b=w.main.blocks[placement.blockIndex];
        assert.equal(b.protocol,'rounds');assert.equal(b.prescription.rounds,anchor.targetSets);
        assert.deepEqual(b.exercises[placement.exerciseIndex].coachAnchor.plannedTarget.target,anchor.target);
        assert.ok(b.prescription.roundRestSeconds>=G.RESTS[rx.workoutStyle].round);
      }
      assert.ok(rx.requiredAnchors.every(a=>w.prescriptionOutcome.satisfiedHardRequirementIds.includes(a.requirementId)));
      for(const b of w.main.blocks){report[name][b.protocol]=(report[name][b.protocol]||0)+1;if(b.protocol==='emom')hits++;}
    }
    assert.ok(hits>0,name);assert.ok(report[name].ladder>0,name+' optional ladders');assert.ok(report[name].pyramid>0,name+' optional pyramids');assert.ok(report[name].complex>0,name+' optional complexes');assert.deepEqual(def,before);
  }
  t.diagnostic(JSON.stringify(report));
});

test('hard protocols, avoids and exact anchor budget outrank optional novelty; soft protocols relax only as needed',()=>{
  const rx=fixtures.prescription({duration:20,equipment:kit,requiredAnchors:[fixtures.anchor({allowedProtocols:['rounds']})],mainTimeLimitSeconds:600,
    protocolConstraints:[{requirementId:'protocols',importance:'hard',allowedProtocols:['rounds','emom']}],
    avoidConstraints:[{requirementId:'avoid-push',importance:'hard',pattern:'push'}]});
  let hits=0;
  for(let seed=1;seed<=20;seed++){
    const w=G.generate({catalogue,sessionPrescription:rx,random:random(seed*2654435761>>>0)});
    assert.ok(w.main.estimatedDurationSeconds<=600);
    assert.ok(w.main.blocks.every(b=>['rounds','emom'].includes(b.protocol)&&b.exercises.every(ex=>!ex.patterns.includes('push'))));
    hits+=w.main.blocks.filter(b=>b.protocol==='emom').length;
  }
  assert.ok(hits>0);
  const a=G.assessSessionPrescription({catalogue,sessionPrescription:rx});
  const tight=G.generate({catalogue,sessionPrescription:{...rx,mainTimeLimitSeconds:a.requiredMainSeconds},random:random(1)});
  assert.ok(tight.main.blocks.every(b=>b.exercises.every(ex=>ex.coachAnchor?.importance==='required')));
  assert.equal(tight.main.estimatedDurationSeconds,a.requiredMainSeconds);
  const only=fixtures.prescription({duration:10,equipment:kit,requiredAnchors:[],movementPriorities:[],mainTimeLimitSeconds:240,
    protocolConstraints:[{requirementId:'only',importance:'hard',allowedProtocols:['emom']}]});
  const w=G.generate({catalogue,sessionPrescription:only,random:random(11)});
  assert.ok(w.main.blocks.every(b=>b.protocol==='emom'));assert.ok(w.main.estimatedDurationSeconds<=240);
  assert.equal(G.assessSessionPrescription({catalogue,sessionPrescription:{...only,mainTimeLimitSeconds:179}}).status,'infeasible');
  const soft={...only,protocolConstraints:[{requirementId:'soft',importance:'soft',allowedProtocols:['emom']}],mainTimeLimitSeconds:120};
  assert.ok(G.generate({catalogue,sessionPrescription:soft,random:random(2)}).main.blocks.every(b=>b.protocol!=='emom'));
});

test('EMOM swaps preserve target type/value, minute windows, eligibility and Coach constraints',()=>{
  const w=G.generate({catalogue,duration:10,equipment:kit,random:random(12)});
  const b={id:'main-1',protocol:'emom',intent:'conditioning',exercises:[copy(catalogue['push-up']),copy(catalogue.plank)],
    prescription:{minutes:5,slotSeconds:60,targets:[{type:'reps',value:6},{type:'timed',value:20}]}};
  w.main.blocks=[b];G.normaliseWorkout(w);const prescription=copy(b.prescription);
  for(let seed=1;seed<=20;seed++)for(const index of [0,1]){
    G.swap(w,0,index,{catalogue,equipment:kit,random:random(seed*2654435761>>>0)});
    assert.deepEqual(b.prescription,prescription);assert.deepEqual(G.validateEmomBlock(b,catalogue),[]);
    assert.equal(G.estimateBlockDuration(b),300);
    assert.equal(b.exercises[index].prescription.type,prescription.targets[index].type);
  }
  const before=copy(w);G.swap(w,0,0,{catalogue:Object.fromEntries(b.exercises.map(ex=>[ex.id,ex])),equipment:kit,random:random(1)});
  assert.deepEqual(w,before,'no safe alternative leaves the plan intact');
});

test('recent pattern preference is bounded, soft and based only on performed Main occurrences',()=>{
  const r=fixtures.sessionResult({plannedWork:[{occurrenceId:'a',section:'main',prescription:{protocol:'emom'}},{occurrenceId:'b',section:'main',prescription:{protocol:'rounds'}},{occurrenceId:'c',section:'warmup',prescription:{protocol:'paired_sets'}}],
    performedWork:[{occurrenceId:'a',status:'partial'},{occurrenceId:'b',status:'skipped'},{occurrenceId:'c',status:'completed'}]});
  assert.deepEqual(G.recentProtocolsFromResults([r]),['emom']);
  assert.deepEqual(G.recentProtocolsFromResults([r,...Array.from({length:4},(_,i)=>({...r,endedAt:'2026-10-'+(10+i)+'T08:00:00Z',performedWork:[]}))]),[]);
  const eligible=Object.values(catalogue).filter(ex=>ex.main),base=G.protocolWeights('balanced','conditioning',420,eligible,{blocks:[]});
  const recent=G.protocolWeights('balanced','conditioning',420,eligible,{blocks:[],recentProtocols:['emom']});
  assert.equal(base.find(x=>x.value==='emom').weight-recent.find(x=>x.value==='emom').weight,.5);
  for(const seconds of [179,721])assert.equal(G.protocolWeights('balanced','conditioning',seconds,eligible,{blocks:[]}).find(x=>x.value==='emom').weight,0);
  assert.equal(G.protocolWeights('balanced','conditioning',420,[catalogue.plank],{blocks:[{protocol:'rounds'}]}).find(x=>x.value==='emom').weight,0,'variety cannot revive ineligible patterns');
});

test('standalone recency queries at most four existing results and reaches generation without a new store',async()=>{
  const app=loadAppContext(new Map(),{ownIntrinsics:true}),run=s=>vm.runInContext(s,app);let filter,received;
  app.GarageFitCoachStore.createStore=()=>({listSessionResults:async options=>{filter=options;return {results:[fixtures.sessionResult({plannedWork:[{occurrenceId:'a',section:'main',prescription:{protocol:'emom'}}],performedWork:[{occurrenceId:'a',status:'completed'}]})]}}});
  await app.refreshGeneratorProtocols();assert.deepEqual(copy(filter),{source:'generator',limit:4});
  const generate=app.GarageFitGenerator.generate;app.GarageFitGenerator.generate=options=>{received=options.recentProtocols;return generate({...options,random:random(9)})};
  app.generateWorkout();assert.deepEqual(copy(received),['emom']);
  assert.deepEqual(copy(run('generatorRecentProtocols')),['emom']);
});
