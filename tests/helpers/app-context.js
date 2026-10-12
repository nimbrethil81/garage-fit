// Minimal DOM stand-in that loads the app shell's inline script so tests can call its
// presentation and playback helpers (formatPrescription, makeGeneratedExercisePhases, ...).
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element {
  constructor() {
    const classes = new Set();
    this.classList = { add(value){ classes.add(value); }, remove(value){ classes.delete(value); }, contains(value){ return classes.has(value); }, toggle(value,force){ const enable=force===undefined?!classes.has(value):force;enable?classes.add(value):classes.delete(value);return enable; } };
    this.style = {}; this.children = []; this.attributes = {}; this.textContent = ''; this.className = '';
    this._innerHTML = '';
    Object.defineProperty(this,'innerHTML',{get:()=>this._innerHTML,set:value=>{this._innerHTML=String(value);if(value==='')this.children=[];}});
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  insertBefore(child) { this.children.push(child); return child; }
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  addEventListener() {}
  focus() {}
}

// options.ownIntrinsics leaves JSON/Math/Date/Set/Map to the VM realm, so objects the app
// builds and parses share one realm (needed by plain-object checks in js/coach-model.js).
function loadAppContext(storage = new Map(), options = {}) {
  const root = path.join(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const elements = {};
  const element = id => elements[id] || (elements[id] = new Element());
  const context = {
    console, Date, Math, JSON, Set, Map,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    speechSynthesis: { cancel(){}, speak(){} },
    addEventListener(){},
    document: { getElementById: element, createElement: () => new Element(), head: new Element(), body: new Element(), addEventListener(){}, querySelector: () => new Element(), querySelectorAll: () => [] },
    localStorage: { get length(){return storage.size;}, key: index => [...storage.keys()][index] || null, getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    navigator: {},
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
    setInterval: () => 0, clearInterval(){}, setTimeout: callback => callback()
  };
  if (options.ownIntrinsics) ['JSON','Math','Date','Set','Map'].forEach(name => delete context[name]);
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  for (const file of ['data/equipment.js','js/equipment-icons.js','data/exercises.js','data/workouts.js','js/generator.js','js/timed-cues.js','js/completion-signal.js','data/sport-profiles.js','data/sport-capabilities.js','js/coach-model.js','js/coach-store.js','js/session-tracker.js','data/programmes.js','js/training-history.js','js/sport-coverage.js','js/coach-policies.js','js/coach-tennis-policy.js','js/coach-engine.js','js/coach-recovery.js','js/coach-ui.js','js/masthead.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename:file });
  }
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  vm.runInContext(inline, context, { filename:'index-inline.js' });
  return context;
}

module.exports = { loadAppContext };
