const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
const audit=require('../scripts/audit-exercise-reachability.js');

const G=GarageFitGenerator;
const real=GarageFitData.exercises;
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
// Generated workout ids carry a timestamp; everything else must match exactly.
const comparable=workout=>JSON.stringify(workout,(key,value)=>key==='id'&&typeof value==='string'&&value.startsWith('generated-')?'generated':value);
const LABELS=new Set(['phase/metadata mismatch','supporting-role crowding','fixed candidate-window crowding','stronger direct variants',
  'equipment-context limitation','duplicate/family/repetition filtering','later-stage rejection','insufficient evidence']);

// Bodyweight catalogue plus a synthetic supporting-role core exercise with minimal strength and
// cardio: eligible for Main, but outscored in every slot of this small matrix.
function fixtureCatalogue(rename=id=>id){
  const catalogue={};
  for(const exercise of Object.values(real))if(!exercise.equipment.length)catalogue[rename(exercise.id)]=Object.assign({},exercise,{id:rename(exercise.id)});
  const synthetic=Object.assign({},real['abdominal-crunch'],{id:rename('synthetic-weak-core'),name:'Synthetic weak core',strength:1,cardio:1,mainRole:'supporting'});
  catalogue[synthetic.id]=synthetic;
  return catalogue;
}
function auditOptions(catalogue,extra){
  return Object.assign({catalogue,generate:G.generate,isEligible:G.generatedPhaseEligible,durations:[20,30],focuses:['strength','balanced','cardio'],
    configs:[{key:'bodyweight',equipment:[]}],seeds:6,requirementsMet:G.requirementsMet,selectionRanks:G.selectionRanks,shortlistSize:G.SHORTLIST_SIZE},extra);
}

test('tracing does not change generated workouts or later untraced generation',()=>{
  const owned=['dumbbells','kettlebell','bands'];
  for(let seed=1;seed<=12;seed++)for(const focus of ['strength','balanced','cardio']){
    const options={catalogue:real,duration:[10,20,30,45][seed%4],focus,equipment:owned,history:seed%2?[['push-up'],['plank']]:[]};
    const plain=G.generate(Object.assign({random:random(seed)},options));
    let events=0;
    const traced=G.generate(Object.assign({random:random(seed),trace:()=>{events++;}},options));
    assert.ok(events>0);
    assert.equal(comparable(traced),comparable(plain));
    const after=events;
    const again=G.generate(Object.assign({random:random(seed)},options));
    assert.equal(comparable(again),comparable(plain));
    assert.equal(events,after,'the trace is not called after its generate returns');
  }
});

test('the trace is released when traced generation throws',()=>{
  let events=0;
  assert.throws(()=>G.generate({catalogue:real,duration:20,focus:'balanced',equipment:[],random:random(1),trace:()=>{events++;throw new Error('trace failed');}}),/trace failed/);
  assert.equal(events,1);
  const plain=G.generate({catalogue:real,duration:20,focus:'balanced',equipment:[],random:random(1)});
  assert.equal(events,1);
  assert.equal(comparable(plain),comparable(G.generate({catalogue:real,duration:20,focus:'balanced',equipment:[],random:random(1)})));
});

test('traced picks report the generator\'s own scores, window, ranks and score components',()=>{
  const phases=new Set();
  for(let seed=1;seed<=6;seed++)G.generate({catalogue:real,duration:30,focus:['strength','balanced','cardio'][seed%3],equipment:['dumbbells','trx'],random:random(seed),trace:event=>{
    if(event.type!=='pick')return;
    phases.add(event.phase);
    const scoredIds=new Set((event.scored||event.candidates).map(item=>(item.exercise||item).id));
    for(const stage of event.stages||[])for(const exercise of stage.removed)assert.ok(!scoredIds.has(exercise.id),stage.label+' removed '+exercise.id);
    if(!event.scored){assert.ok(event.candidates.includes(event.picked));return;}
    const {sorted,threshold,pool,band}=event.window;
    assert.equal(band,event.phase==='rampup'?0:G.SHORTLIST_MARGIN);
    assert.ok(pool.some(item=>item.exercise===event.picked),'the pick comes from the window');
    assert.ok(pool.every(item=>item.score>threshold)&&sorted.filter(item=>item.score>threshold).length===pool.length);
    const ranks=G.selectionRanks(sorted);
    sorted.forEach((item,index)=>{
      assert.equal(ranks[index],1+sorted.filter(other=>other.score>item.score+1e-9).length);
      const parts=event.explain(item.exercise);
      const total=Object.values(parts).reduce((sum,value)=>sum+value,0);
      assert.ok(Math.abs(total-item.score)<1e-9,event.phase+' '+item.exercise.id+': '+total+' vs '+item.score);
      if(event.phase==='main'&&item.exercise.mainRole==='supporting')assert.ok(parts['supporting-role']<0);
    });
  }});
  for(const phase of ['main','warmup','rampup','cooldown'])assert.ok(phases.has(phase),phase);
});

test('a synthetic zero-reachability exercise reports its boundary, competitors and classification',()=>{
  const catalogue=fixtureCatalogue();
  const result=audit.runAudit(auditOptions(catalogue));
  const diagnosis=result.diagnostics.find(item=>item.id==='synthetic-weak-core');
  assert.ok(result.failures.some(item=>item.id==='synthetic-weak-core'));
  assert.equal(diagnosis.kind,'failure');
  assert.deepEqual(diagnosis.eligibility,{configs:1,of:1,examples:['bodyweight'],equipmentExcluded:0,phaseExcluded:0});
  assert.equal(diagnosis.selection.appearances,0);
  assert.equal(diagnosis.selection.best,null);
  assert.ok(diagnosis.slots.scored>0);
  assert.deepEqual(diagnosis.rank.window,{size:G.SHORTLIST_SIZE,maxSize:G.SHORTLIST_SIZE,margin:G.SHORTLIST_MARGIN});
  assert.ok(diagnosis.rank.median>G.SHORTLIST_SIZE,'it usually ranks outside the shortlist');
  assert.ok(diagnosis.score.medianDeficit>0,'it usually scores below the window boundary');
  assert.ok(Number.isFinite(diagnosis.score.best.threshold)&&Number.isFinite(diagnosis.score.best.deficit));
  assert.equal(diagnosis.score.gaps[0].label,'supporting-role');
  assert.ok(diagnosis.score.penalties.some(item=>item.label==='supporting-role'&&item.value<0));
  assert.ok(diagnosis.competitors.length>0&&diagnosis.competitors.length<=3);
  for(const competitor of diagnosis.competitors){
    assert.ok(catalogue[competitor.id]);
    assert.ok(competitor.mainRole&&Array.isArray(competitor.patterns)&&competitor.equipment==='bodyweight'&&competitor.share>0);
  }
  assert.equal(diagnosis.classification.label,'supporting-role crowding');
  assert.equal(diagnosis.classification.stage,'window');
  const report=audit.formatReport(result);
  assert.match(report,/diagnosis: supporting-role crowding/);
  assert.match(report,/rank       best \d+, median \d+ of ~\d+ \(window: top 4 \+ 5 pts\)/);
  assert.match(report,/RESULT: FAIL/);
});

test('diagnostics are deterministic and do not mutate the catalogue',()=>{
  const catalogue=fixtureCatalogue();
  const before=JSON.stringify(catalogue);
  const first=audit.runAudit(auditOptions(catalogue,{seeds:3}));
  const second=audit.runAudit(auditOptions(catalogue,{seeds:3}));
  assert.equal(JSON.stringify(catalogue),before);
  assert.ok(first.diagnostics.length>0);
  assert.deepEqual(first,second);
  assert.equal(audit.formatReport(first),audit.formatReport(second));
});

test('diagnostics leave the audit counts, failures and warnings unchanged',()=>{
  const catalogue=fixtureCatalogue();
  const diagnosed=audit.runAudit(auditOptions(catalogue,{seeds:3}));
  const plain=audit.runAudit(auditOptions(catalogue,{seeds:3,diagnose:false}));
  assert.equal(plain.diagnostics,undefined);
  const {diagnostics,...rest}=diagnosed;
  assert.deepEqual(rest,plain);
});

test('classifications do not depend on exercise ids',()=>{
  const labels=rename=>{
    const result=audit.runAudit(auditOptions(fixtureCatalogue(rename),{seeds:3}));
    return result.diagnostics.map(item=>[item.phase,item.classification.label,item.classification.stage]);
  };
  assert.deepEqual(labels(id=>'renamed-'+id),labels(id=>id));
});

test('only failures and rare warnings carry diagnostics in the report',()=>{
  const result=audit.runAudit(auditOptions(fixtureCatalogue(),{seeds:3}));
  const report=audit.formatReport(result);
  const diagnosed=result.failures.length+result.rare.length;
  assert.equal(result.diagnostics.length,diagnosed);
  assert.equal((report.match(/^      diagnosis: /gm)||[]).length,diagnosed);
  const dominant=report.slice(report.indexOf('Warnings: dominant'));
  assert.doesNotMatch(dominant,/diagnosis:/);
  for(const diagnosis of result.diagnostics)assert.ok(LABELS.has(diagnosis.classification.label),diagnosis.classification.label);
});

// Classification rules on hand-built evidence.
function evidence(fields){
  const stage=(part,whole)=>({part,whole,rate:whole?part/whole:null});
  return Object.assign({
    slots:{total:1000,filteredBy:[],discarded:[]},
    funnel:{filters:stage(1000,1000),window:stage(300,1000),draw:stage(30,300),kept:stage(10,30)},
    peers:{filters:1,window:.3,draw:.1,kept:.33},
    score:{gaps:[]},competitors:[]
  },fields);
}
const classify=(fields,exercise={})=>audit.classify(evidence(fields),exercise);

test('classification names the funnel stage furthest below the phase median and its main cause',()=>{
  const stage=(part,whole)=>({part,whole,rate:part/whole});
  const lowWindow={filters:stage(1000,1000),window:stage(20,1000),draw:stage(2,20),kept:stage(1,2)};
  assert.equal(classify({slots:{total:5,filteredBy:[],discarded:[]}}).label,'insufficient evidence');
  assert.equal(classify({slots:null}).label,'insufficient evidence');
  assert.deepEqual(classify({funnel:lowWindow,score:{gaps:[{label:'supporting-role',value:3}]}}).label,'supporting-role crowding');
  assert.equal(classify({funnel:lowWindow,score:{gaps:[{label:'intent',value:3}]}}).label,'phase/metadata mismatch');
  assert.equal(classify({funnel:lowWindow,score:{gaps:[{label:'same-setup',value:2.5}]}}).label,'equipment-context limitation');
  assert.equal(classify({funnel:lowWindow,score:{gaps:[{label:'repetition-class',value:4}]}}).label,'duplicate/family/repetition filtering');
  assert.equal(classify({funnel:lowWindow,score:{gaps:[{label:'intent',value:1.5}]}}).label,'fixed candidate-window crowding');
  const variant={id:'other',family:'press',share:.4};
  assert.equal(classify({funnel:lowWindow,competitors:[variant],score:{gaps:[{label:'intent',value:3}]}},{family:'press'}).label,'stronger direct variants');
  assert.equal(classify({funnel:lowWindow,competitors:[variant],score:{gaps:[{label:'intent',value:3}]}},{family:'pull'}).label,'phase/metadata mismatch');
  const filtered={filters:stage(100,1000),window:stage(30,100),draw:stage(3,30),kept:stage(1,3)};
  assert.equal(classify({funnel:filtered,slots:{total:1000,filteredBy:[{label:'protocol',count:900}],discarded:[]}}).label,'phase/metadata mismatch');
  assert.equal(classify({funnel:filtered,slots:{total:1000,filteredBy:[{label:'family-cap',count:900}],discarded:[]}}).label,'duplicate/family/repetition filtering');
  const dropped={filters:stage(1000,1000),window:stage(300,1000),draw:stage(30,300),kept:stage(0,30)};
  const later=classify({funnel:dropped,slots:{total:1000,filteredBy:[],discarded:[{label:'fitter-attempt-chosen',count:30}]}});
  assert.equal(later.label,'later-stage rejection');
  assert.equal(later.stage,'kept');
  assert.equal(classify({funnel:dropped,slots:{total:1000,filteredBy:[],discarded:[{label:'rejected-attempt:family-cap',count:30}]}}).label,'duplicate/family/repetition filtering');
});

test('a stage seen only a few times does not outweigh well-observed stages',()=>{
  const stage=(part,whole)=>({part,whole,rate:part/whole});
  // Never kept in the single workout that drew it, but far below the phase in the window.
  const result=classify({funnel:{filters:stage(1000,1000),window:stage(20,1000),draw:stage(1,20),kept:stage(0,1)},score:{gaps:[{label:'supporting-role',value:3}]}});
  assert.equal(result.stage,'window');
  assert.equal(result.label,'supporting-role crowding');
});
