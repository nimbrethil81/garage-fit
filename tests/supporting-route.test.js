const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const G=GarageFitGenerator;
const catalogue=GarageFitData.exercises;
const ROUTE=G.SUPPORTING_ROUTE;
const RECIPES={strength:['squat','hinge','push','pull','core','carry','lunge'],balanced:['squat','push','pull','hinge','conditioning','core','lunge']};
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const comparable=workout=>JSON.stringify(workout,(key,value)=>key==='id'&&typeof value==='string'&&value.startsWith('generated-')?'generated':value);
const mainExercises=workout=>workout.main.blocks.flatMap(block=>block.exercises);
const supporting=exercise=>exercise.mainRole==='supporting';

// Generates one traced workout and groups its Main picks by attempt.
function traced(options){
  const attempts=[],events=[];let current=[],result=null;
  const workout=G.generate(Object.assign({},options,{trace:event=>{
    // `explain` is only valid during the trace call.
    if(event.type==='pick'&&event.route&&event.scored)event.explained=event.scored.map(entry=>event.explain(entry.exercise));
    events.push(event);
    if(event.type==='pick'&&event.phase==='main')current.push(event);
    else if(event.type==='main-attempt'){attempts[event.attempt]={picks:current,issues:event.issues};current=[];}
    else if(event.type==='main-result')result=event;
  }}));
  const chosen=result&&result.attempt!=null?attempts[result.attempt]:null;
  const routed=chosen?chosen.picks.filter(pick=>pick.route&&pick.picked&&supporting(pick.picked)).map(pick=>pick.picked.id):[];
  return {workout,events,attempts,result,routed:routed.filter(id=>mainExercises(workout).some(exercise=>exercise.id===id))};
}
const owned=['dumbbells','kettlebell','bands','trx'];
const longSample=[];
for(const focus of ['strength','balanced'])for(const duration of [30,45])for(let seed=1;seed<=40;seed++)
  longSample.push(Object.assign({focus,duration},traced({catalogue,duration,focus,equipment:owned,random:random(seed*7919+duration+focus.length)})));

test('short Main phases and Cardio never draw or open the route',()=>{
  for(const duration of [10,15,20])for(const focus of ['strength','balanced','cardio'])for(let seed=1;seed<=6;seed++){
    const run=traced({catalogue,duration,focus,equipment:owned,random:random(seed)});
    assert.equal(run.result.supportingRoute,false,duration+' '+focus);
    assert.ok(!run.events.some(event=>event.route));
  }
  for(const duration of [30,45])for(let seed=1;seed<=6;seed++){
    const run=traced({catalogue,duration,focus:'cardio',equipment:owned,random:random(seed)});
    assert.equal(run.result.supportingRoute,false);
    assert.ok(!run.events.some(event=>event.route));
  }
});

test('the route opens only at the last accessory slot, after enough primary recipe roles and no supporting work',()=>{
  let opened=0;
  for(const run of longSample)for(const attempt of run.attempts.filter(Boolean)){
    attempt.picks.forEach((pick,index)=>{
      if(!pick.route)return;
      opened++;
      assert.equal(pick.intent,'accessory');
      const before=attempt.picks.slice(0,index).map(item=>item.picked);
      assert.ok(!before.some(supporting),'no supporting exercise before the route');
      const roles=new Set(before.flatMap(G.selectionTags).filter(tag=>RECIPES[run.focus].includes(tag)));
      assert.ok(roles.size>=ROUTE.minRoles,'primary roles '+roles.size);
    });
  }
  assert.ok(opened>0,'the route opens in the long sample');
});

test('at most one exercise per Main comes through the route, and inclusion is possible but not guaranteed',()=>{
  let used=0,drawnUnused=0,notDrawn=0;
  for(const run of longSample){
    for(const attempt of run.attempts.filter(Boolean))assert.ok(attempt.picks.filter(pick=>pick.route).length<=1);
    assert.ok(run.routed.length<=1);
    if(run.routed.length)used++;
    else if(run.result.supportingRoute)drawnUnused++;
    else notDrawn++;
  }
  assert.ok(used>0,'route used');
  assert.ok(notDrawn>used,'route not drawn in most long Mains: '+notDrawn+' vs '+used);
  assert.ok(drawnUnused>0,'a drawn route can still go unused');
  assert.ok(used<longSample.length*ROUTE.probability,'used '+used);
});

test('route slots score only filtered supporting candidates with the normal scorer and window',()=>{
  let routeSlots=0;
  for(const run of longSample)for(const pick of run.events.filter(event=>event.type==='pick'&&event.route&&event.scored)){
    const routeStage=(pick.stages||[]).find(stage=>stage.label==='supporting-route');
    if(!routeStage)continue; // every candidate was already supporting, or none was (normal slot)
    routeSlots++;
    assert.ok(pick.scored.every(entry=>supporting(entry.exercise)));
    assert.ok(routeStage.removed.every(exercise=>!supporting(exercise)),'the route removes only primary work');
    const labels=pick.stages.map(stage=>stage.label);
    assert.ok(labels.indexOf('supporting-route')===labels.length-1,'the route narrows after every other filter: '+labels);
    pick.scored.forEach((entry,index)=>{
      assert.ok(G.protocolCompatible(entry.exercise,pick.protocol));
      const parts=pick.explained[index];
      assert.ok(Math.abs(Object.values(parts).reduce((sum,value)=>sum+value,0)-entry.score)<1e-9);
      assert.ok(parts['supporting-role']<0,'the supporting-role penalty still applies');
    });
    assert.equal(pick.window.ranks,G.candidateWindowRanks(pick.scored.length));
    assert.ok(pick.window.pool.some(entry=>entry.exercise===pick.picked));
  }
  assert.ok(routeSlots>0);
});

test('workouts using the route keep Main validity, family caps, variety and duration rules',()=>{
  for(const run of longSample){
    const issues=G.validateMain(run.workout.main,catalogue,owned,G.BUDGETS[run.duration].main).filter(issue=>issue!=='main:duration-out-of-tolerance');
    assert.deepEqual(issues,[]);
    const eligible=Object.values(catalogue).filter(exercise=>G.generatedPhaseEligible(exercise,'main',owned));
    assert.deepEqual(G.mainVarietyIssues(run.workout.main.blocks,run.duration,eligible),[]);
    const ids=mainExercises(run.workout).map(exercise=>exercise.id);
    assert.equal(new Set(ids).size,ids.length);
    const exercises=mainExercises(run.workout);
    for(let i=1;i<exercises.length;i++){
      assert.ok(!G.sameFamily(exercises[i-1],exercises[i]),ids.join(','));
      assert.ok(!G.sameRepetitionClass(exercises[i-1],exercises[i]),ids.join(','));
    }
  }
});

test('without supporting candidates the route is never drawn and generation is valid',()=>{
  const primaryOnly=Object.fromEntries(Object.entries(catalogue).filter(([,exercise])=>!supporting(exercise)));
  for(const focus of ['strength','balanced'])for(let seed=1;seed<=6;seed++){
    const run=traced({catalogue:primaryOnly,duration:45,focus,equipment:owned,random:random(seed)});
    assert.equal(run.result.supportingRoute,false);
    assert.ok(!mainExercises(run.workout).some(supporting));
    assert.ok(run.workout.main.blocks.length>0);
  }
});

test('constrained catalogues with supporting work still generate',()=>{
  const small={};
  for(const id of ['push-up','air-squat','plank','glute-bridge','jumping-jacks','high-knees'])small[id]=catalogue[id];
  for(const focus of ['strength','balanced'])for(let seed=1;seed<=10;seed++){
    const workout=G.generate({catalogue:small,duration:45,focus,equipment:[],random:random(seed)});
    assert.ok(workout.main.blocks.length>0);
    assert.ok(mainExercises(workout).every(exercise=>small[exercise.id]));
  }
});

test('the same seed gives the same workout, and preparation and cool-down never use the route',()=>{
  for(let seed=1;seed<=5;seed++){
    const options={catalogue,duration:45,focus:'strength',equipment:owned};
    assert.equal(comparable(G.generate(Object.assign({random:random(seed)},options))),comparable(G.generate(Object.assign({random:random(seed)},options))));
  }
  for(const run of longSample)for(const event of run.events)if(event.type==='pick'&&event.phase!=='main')assert.ok(!event.route,event.phase);
});
