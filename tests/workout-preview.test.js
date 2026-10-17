const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {loadAppContext}=require('./helpers/app-context');
const root=path.join(__dirname,'..');

function previewOnly() {
  // No catalogue, Generator, Coach or storage globals. Reject HTML rendering.
  const context={document:{createElement(tag) {
    return {tagName:tag.toUpperCase(),children:[],textContent:'',className:'',
      set innerHTML(value) { throw new Error('Preview must use textContent'); },
      append(...nodes) { this.children.push(...nodes); },
      appendChild(node) { this.children.push(node); return node; }};
  }}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'js/workout-preview.js'),'utf8'),context);
  return context.GarageFitWorkoutPreview;
}
const descendants=node=>[node,...node.children.flatMap(descendants)];

test('shared preview headings preserve block numbering and use semantic headings',()=>{
  const ui=previewOnly();
  for(const title of ['Warm-up','Ramp-up','Main workout · 2 blocks','Cool-down']) {
    const heading=ui.sectionHeading(title);
    assert.equal(heading.tagName,'H2'); assert.equal(heading.textContent,title);
    assert.equal(heading.className,'preview-section-title');
  }
  const block=ui.blockHeading({index:1,total:3,prescription:'Paired sets · 2 sets'});
  assert.equal(block.tagName,'LI'); assert.equal(block.className,'preview-block-heading');
  assert.equal(block.children[0].textContent,'B2');
  assert.equal(block.children[1].tagName,'H3');
  assert.equal(block.children[1].textContent,'Block 2 of 3');
  assert.equal(block.children[1].children[0].textContent,'Paired sets · 2 sets');
});

test('shared preview retains rep, timed, per-side and load formatting without changing inputs',()=>{
  const ui=previewOnly();
  const cases=[
    [{prescription:{type:'reps',value:10}},'10 reps'],
    [{prescription:{type:'timed',value:30}},'30 sec'],
    [{prescription:{type:'unilateral-reps',value:8},load:'Medium'},'8 reps each side · Medium'],
    [{prescription:{type:'unilateral-timed',value:15}},'15 sec each side'],
    [{prescription:{type:'reps',value:12},sidedness:'per-side'},'12 reps each side'],
    [{prescription:{type:'timed',value:20},sidedness:'alternating'},'20 sec']
  ];
  for(const [exercise,expected] of cases) {
    const before=JSON.stringify(exercise);
    assert.equal(ui.formatPrescription(exercise),expected);
    assert.equal(JSON.stringify(exercise),before);
    const row=ui.exerciseRow({index:0,name:'Exercise',prescription:ui.formatPrescription(exercise)});
    assert.equal(row.children[1].children[0].textContent,expected);
  }
  assert.equal(ui.protocolLabel({protocol:'rounds',prescription:{rounds:3}}),'Mini-circuit · 3 rounds');
  // paired_sets is presented as a superset; the stored protocol id is unchanged.
  assert.equal(ui.protocolLabel({protocol:'paired_sets',prescription:{sets:2}}),'Superset · 2 sets · A then B, no changeover');
  assert.equal(ui.protocolLabel({protocol:'paired_sets',prescription:{sets:3,betweenExercisesSeconds:10,betweenSetsSeconds:60}}),
    'Superset · 3 sets · A then B · 10 sec changeover · 60 sec rest after each pair');
  assert.equal(ui.protocolLabel({protocol:'paired_sets',prescription:{sets:1,betweenExercisesSeconds:10,betweenSetsSeconds:60}}),
    'Superset · 1 set · A then B · 10 sec changeover','one pair has no post-pair rest');
  assert.deepEqual([0,1].map(index=>ui.supersetMarker({protocol:'paired_sets'},index)),['A','B']);
  assert.equal(ui.supersetMarker({protocol:'rounds'},0),null);
  assert.equal(ui.exerciseRow({index:1,marker:'B',name:'Row',prescription:'10 reps'}).children[0].textContent,'B');
  assert.equal(ui.exerciseRow({index:1,name:'Row',prescription:'10 reps'}).children[0].textContent,'02');
  assert.equal(ui.protocolLabel({protocol:'timed_intervals',prescription:{workSeconds:40,transitionSeconds:10,cycles:3}}),
    'Timed intervals · 40 sec work / 10 sec change · 3 cycles');
});

test('row copy, optional cues and instructions are plain text with a native collapsed disclosure',()=>{
  const ui=previewOnly(), unsafe='<img src=x onerror="alert(1)">';
  const row=ui.exerciseRow({index:8,name:unsafe,prescription:unsafe,instruction:unsafe,cue:unsafe,targetLabel:unsafe});
  assert.equal(row.children[0].textContent,'09');
  const copy=row.children[1];
  assert.equal(copy.textContent,unsafe);
  assert.deepEqual(copy.children.slice(0,3).map(node=>node.textContent),[unsafe,unsafe,unsafe]);
  const details=copy.children[3];
  assert.equal(details.tagName,'DETAILS'); assert.ok(!details.open);
  assert.equal(details.children[0].tagName,'SUMMARY');
  assert.equal(details.children[0].textContent,'How to do it');
  assert.equal(details.children[1].textContent,unsafe);
  assert.ok(descendants(row).every(node=>node.tagName!=='IMG'));
  assert.equal(ui.instructionDisclosure(''),null);
  const compact=ui.exerciseRow({index:0,name:'Warm-up',prescription:'20 sec'});
  assert.equal(compact.children[1].children.length,1,'optional copy stays absent unless requested');
});

test('callers own controls and strength target labels across viewing and editing boundaries',()=>{
  const ui=previewOnly(), calls=[];
  const control=label=>({tagName:'BUTTON',children:[],textContent:label,onclick:()=>calls.push(label)});
  const edit=control('Edit'), substitute=control('Substitute'), controls=[edit,substitute];
  const options=Object.freeze({index:0,name:'Squat',prescription:'2 sets · 6–10 reps each side',
    targetLabel:'Strength target',controls:Object.freeze(controls)});
  const row=ui.exerciseRow(options);
  assert.equal(calls.length,0,'rendering never fires actions');
  assert.equal(row.children[1].children[0].textContent,options.prescription);
  assert.equal(row.children[1].children[1].className,'preview-prescription preview-target-label');
  assert.equal(row.children[1].children[1].textContent,'Strength target');
  assert.equal(row.children[2].children[0],edit); assert.equal(row.children[2].children[1],substitute);
  edit.onclick(); substitute.onclick(); assert.deepEqual(calls,['Edit','Substitute']);
  const viewing=ui.exerciseRow({index:0,name:'Squat',prescription:'10 reps'});
  assert.equal(viewing.children.length,2,'viewing has no controls');
  assert.ok(!descendants(viewing).some(node=>node.className.includes('preview-target-label')));
});

test('Generator renders all phases through shared rows and retains caller-owned Swap routing',()=>{
  const app=loadAppContext(), el=id=>app.document.getElementById(id), ui=app.GarageFitWorkoutPreview;
  vm.runInContext(fs.readFileSync(path.join(root,'js/rampup-ui.js'),'utf8'),app);
  vm.runInContext("state.ownedEquipment=['trx','dumbbells'];generatorState.workout=GarageFitGenerator.generate({catalogue:CATALOGUE,duration:30,focus:'balanced',equipment:state.ownedEquipment,random:()=>0.4})",app);
  const workout=vm.runInContext('generatorState.workout',app);
  // Force representative protocols/quantities without depending on random selection.
  workout.main.blocks[0].protocol='timed_intervals';
  workout.main.blocks[0].prescription={workSeconds:40,transitionSeconds:10,cycles:2};
  workout.main.blocks[0].exercises[0]={...app.GarageFitData.exercises['trx-knee-tuck'],instruction:'Untrusted override'};
  const rows=[], originalRow=ui.exerciseRow;
  ui.exerciseRow=options=>{rows.push(options);return originalRow(options);};
  app.renderGeneratedPreview();
  const main=workout.main.blocks.flatMap(block=>block.exercises);
  assert.equal(rows.length,main.length+workout.warmup.exercises.length+workout.rampup.exercises.length+workout.cooldown.exercises.length);
  assert.equal(rows[0].prescription,'40 sec','interval work overrides the catalogue rep count');
  assert.equal(rows[0].instruction,app.GarageFitData.exercises['trx-knee-tuck'].instruction,'caller resolves canonical instructions');
  for(const section of ['warmup','rampup','cooldown']) {
    const list=el('preview'+section[0].toUpperCase()+section.slice(1)+'List');
    assert.equal(list.children.length,workout[section].exercises.length);
    assert.equal(list.children[0].children[1].children[0].textContent,ui.formatPrescription(workout[section].exercises[0]));
    assert.equal(list.children[0].children.length,section==='cooldown'?2:3);
  }
  const swaps=[];
  app.swapGeneratedExercise=(...args)=>swaps.push(['main',...args]);
  app.swapGeneratedPreparation=(...args)=>swaps.push(args);
  const button=row=>row.children[2].children[0];
  const mainRow=el('previewList').children[1];
  assert.equal(button(mainRow).attributes['aria-label'],'Swap '+main[0].name);
  button(mainRow).onclick();
  button(el('previewWarmupList').children[1]).onclick();
  button(el('previewRampupList').children[0]).onclick();
  assert.deepEqual(swaps,[['main',0,0],['warmup',1],['rampup',0]]);
});

test('a single mini-circuit round is singular',()=>{
  assert.equal(previewOnly().protocolLabel({protocol:'rounds',prescription:{rounds:1}}),'Mini-circuit · 1 round');
});
