const test=require('node:test');
const assert=require('node:assert/strict');

global.window=global;
require('../js/timed-cues.js');
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');

const G=GarageFitGenerator;
const catalogue=GarageFitData.exercises;
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296}}
const item=(id,score)=>({exercise:{id},score});
// Enumerates rolls evenly across [0,1), so pick counts are proportional to pick weights.
function pickCounts(scored,margin,ranks,rolls=6000){
  const counts={};
  for(let i=0;i<rolls;i++){
    const picked=G.controlledPick(scored,()=>(i+.5)/rolls,margin,ranks);
    counts[picked.id]=(counts[picked.id]||0)+1;
  }
  return counts;
}
const descending=n=>Array.from({length:n},(_,i)=>item('r'+(i+1),40-i*1.5));
const comparable=workout=>JSON.stringify(workout,(key,value)=>key==='id'&&typeof value==='string'&&value.startsWith('generated-')?'generated':value);

test('the window never shrinks as the candidate pool grows and stays within its bounds',()=>{
  let previous=0;
  for(let count=0;count<=2000;count++){
    const ranks=G.candidateWindowRanks(count);
    assert.ok(ranks>=previous,'count '+count);
    assert.ok(ranks>=G.SHORTLIST_SIZE&&ranks<=G.WINDOW_MAX_RANKS,'count '+count+': '+ranks);
    previous=ranks;
  }
  for(const count of [0,1,4,16,31])assert.equal(G.candidateWindowRanks(count),G.SHORTLIST_SIZE);
  assert.equal(G.candidateWindowRanks(32),G.SHORTLIST_SIZE+1);
  assert.equal(G.candidateWindowRanks(10000),G.WINDOW_MAX_RANKS);
  assert.ok(G.WINDOW_MAX_RANKS<=G.SHORTLIST_SIZE+2,'the cap stays conservative');
});

test('small pools keep the fixed shortlist exactly',()=>{
  for(const count of [1,3,4,8,20,31]){
    const scored=descending(count);
    const ranks=G.candidateWindowRanks(count);
    for(let i=0;i<500;i++){
      const roll=()=>(i+.5)/500;
      assert.equal(G.controlledPick(scored,roll,G.SHORTLIST_MARGIN,ranks),G.controlledPick(scored,roll,G.SHORTLIST_MARGIN));
      assert.equal(G.controlledPick(scored,roll,0,ranks),G.controlledPick(scored,roll,0));
    }
  }
});

test('a wider window admits exactly its ranks plus near-misses, and nothing beyond',()=>{
  const scored=descending(12); // scores 40, 38.5, ... 1.5 points apart
  const strict=pickCounts(scored,0,6);
  for(let rank=1;rank<=6;rank++)assert.ok(strict['r'+rank]>0,'rank '+rank);
  for(let rank=7;rank<=12;rank++)assert.equal(strict['r'+rank],undefined,'rank '+rank);
  const banded=pickCounts(scored,G.SHORTLIST_MARGIN,6);
  // 5 points below the 6th-ranked score admits ranks 7-9 (1.5, 3 and 4.5 points below).
  for(let rank=7;rank<=9;rank++)assert.ok(banded['r'+rank]>0&&banded['r'+rank]<banded.r6,'rank '+rank);
  for(let rank=10;rank<=12;rank++)assert.equal(banded['r'+rank],undefined,'rank '+rank);
});

test('lower-ranked admitted candidates keep smaller weights and leaders stay far ahead',()=>{
  const scored=descending(40);
  const counts=pickCounts(scored,G.SHORTLIST_MARGIN,G.candidateWindowRanks(scored.length));
  for(let rank=2;rank<=8;rank++)assert.ok(counts['r'+rank]<counts['r'+(rank-1)],'rank '+rank+' '+JSON.stringify(counts));
  assert.ok(counts.r1>counts.r5*5,JSON.stringify(counts));
  assert.ok(counts.r1+counts.r2+counts.r3+counts.r4>counts.r5*10,JSON.stringify(counts));
});

test('tied scores share a rank and weight wherever the catalogue lists them',()=>{
  const scored=[item('a',20),item('b',18),item('c',17),item('d',16),item('e',15),item('t1',14),item('t2',14),item('t3',14),item('x',4)];
  const orders=[scored,scored.slice().reverse(),[...scored.slice(4),...scored.slice(0,4)]];
  const results=orders.map(order=>pickCounts(order,G.SHORTLIST_MARGIN,6));
  for(const counts of results){
    assert.ok(counts.t1>0,JSON.stringify(counts));
    assert.ok(Math.abs(counts.t1-counts.t2)<=1&&Math.abs(counts.t2-counts.t3)<=1,JSON.stringify(counts));
    assert.equal(counts.x,undefined);
  }
  for(const id of ['a','b','c','d','e'])for(const counts of results)assert.ok(Math.abs(counts[id]-results[0][id])<=1,id);
});

test('generated Main uses the scaled window after its filters; Warm-up and Ramp-up keep the fixed one',()=>{
  const ranks={main:new Set(),warmup:new Set(),rampup:new Set()};
  let wider=0;
  for(let seed=1;seed<=8;seed++)G.generate({catalogue,duration:45,focus:['strength','balanced'][seed%2],equipment:GarageFitData.equipment.map(item=>item.id),random:random(seed),trace:event=>{
    if(event.type!=='pick'||!event.scored)return;
    ranks[event.phase].add(event.window.ranks);
    if(event.phase==='main'){
      assert.equal(event.window.ranks,G.candidateWindowRanks(event.scored.length));
      const removed=new Set((event.stages||[]).flatMap(stage=>stage.removed));
      assert.ok(event.scored.every(entry=>!removed.has(entry.exercise)),'filters run before the window');
      if(event.window.ranks>G.SHORTLIST_SIZE)wider++;
    }
    else assert.equal(event.window.band,event.phase==='rampup'?0:G.SHORTLIST_MARGIN);
  }});
  assert.ok(wider>0,'large pools widen the Main window');
  assert.deepEqual([...ranks.warmup],[G.SHORTLIST_SIZE]);
  assert.deepEqual([...ranks.rampup],[G.SHORTLIST_SIZE]);
});

test('constrained catalogues keep the fixed window and still generate',()=>{
  const bodyweight={},tiny={};
  for(const exercise of Object.values(catalogue))if(!exercise.equipment.length)bodyweight[exercise.id]=exercise;
  for(const id of ['push-up','air-squat','plank'])tiny[id]=catalogue[id];
  for(const small of [bodyweight,tiny])for(let seed=1;seed<=4;seed++){
    const sizes=new Set();
    const workout=G.generate({catalogue:small,duration:30,focus:'balanced',equipment:[],random:random(seed),trace:event=>{if(event.type==='pick'&&event.phase==='main')sizes.add(event.window.ranks);}});
    assert.ok(workout.main.blocks.length>0);
    assert.deepEqual([...sizes],[G.SHORTLIST_SIZE]);
  }
});

test('the same seed generates the same workout',()=>{
  const options={catalogue,duration:45,focus:'strength',equipment:GarageFitData.equipment.map(item=>item.id)};
  for(let seed=1;seed<=5;seed++)
    assert.equal(comparable(G.generate(Object.assign({random:random(seed)},options))),comparable(G.generate(Object.assign({random:random(seed)},options))));
});
