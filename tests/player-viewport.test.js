const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context');

// Real layout/overlap checks run in scripts/verify-player-layout.py. These tests
// keep the viewport lifecycle and tab-bar contract covered without browser deps.
function viewportHarness(visualViewport) {
  const styles = {}, listeners = {}, viewportListeners = {};
  const context = {
    document:{getElementById:()=>({style:{setProperty:(key,value)=>{styles[key]=value;}}}),querySelectorAll:()=>[]},
    innerHeight:667,
    addEventListener:(name,fn)=>{listeners[name]=fn;}
  };
  if(visualViewport) context.visualViewport={...visualViewport,addEventListener:(name,fn)=>{viewportListeners[name]=fn;}};
  context.window=context;
  vm.runInNewContext(fs.readFileSync('js/player-layout.js','utf8'),context);
  return {context,styles,listeners,viewportListeners};
}

test('players follow the visual viewport when browser chrome or keyboard changes usable height and offset',()=>{
  const h=viewportHarness({height:540,offsetTop:0});
  assert.equal(h.styles['--player-viewport-height'],'540px');
  h.context.visualViewport.height=292;h.context.visualViewport.offsetTop=81;
  h.viewportListeners.resize();h.viewportListeners.scroll();
  assert.equal(h.styles['--player-viewport-height'],'292px');
  assert.equal(h.styles['--player-viewport-top'],'81px');
  h.context.visualViewport.height=852;h.context.visualViewport.offsetTop=0;h.listeners.resize();
  assert.equal(h.styles['--player-viewport-height'],'852px');
  assert.equal(h.styles['--player-viewport-top'],'0px');
});

test('older browsers without VisualViewport use resized innerHeight',()=>{
  const h=viewportHarness();
  assert.equal(h.styles['--player-viewport-height'],'667px');
  h.context.innerHeight=375;h.listeners.resize();
  assert.equal(h.styles['--player-viewport-height'],'375px');
  assert.equal(h.styles['--player-viewport-top'],'0px');
});

test('both players reserve the viewport and remove the bottom nav; landing screens restore it',()=>{
  const app=loadAppContext(),el=id=>app.document.getElementById(id);
  for(const player of ['player','workoutPlayer']) {
    app.showScreen(player);
    assert.equal(el('app').classList.contains('active-player'),true);
    assert.equal(el('bottomNav').classList.contains('hidden'),true);
    app.showScreen('home');
    assert.equal(el('app').classList.contains('active-player'),false);
    assert.equal(el('bottomNav').classList.contains('hidden'),false);
  }
});
