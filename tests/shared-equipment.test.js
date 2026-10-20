const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {loadAppContext} = require('./helpers/app-context');
const run = (app, code) => vm.runInContext(code, app);
const json = (app, code) => JSON.parse(run(app, `JSON.stringify(${code})`));

function selected(app) {
  return json(app, "document.getElementById('equipmentList').children.filter(node=>node.attributes['aria-pressed']==='true').map(node=>node.textContent)");
}

test('More reuses the catalogue-driven equipment screen; Back and Done keep every return route', async () => {
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const more=html.match(/<main id="more"[\s\S]*?<\/main>/)[0];
  assert.match(more,/class="library-entry"[^>]*onclick="openEquipment\('more'\)"[^>]*>My Equipment →/);
  assert.match(more,/Exercise Library →/);
  assert.match(html,/<h1>My Equipment<\/h1>/);
  const app=loadAppContext();
  for (const from of ['more','generator','coach','home']) for (const done of [false,true]) {
    app.openEquipment(from);
    assert.equal(run(app,'currentScreen'),'equipment');
    assert.equal(app.document.getElementById('bottomNav').classList.contains('hidden'),true);
    await app.closeEquipment(done);
    assert.equal(run(app,'currentScreen'),from);
    assert.equal(app.document.getElementById('bottomNav').classList.contains('hidden'),false);
  }
  run(app,"EQUIPMENT.push({id:'future-kit',name:'Future kit'})");
  app.openEquipment('more');
  assert.ok(json(app,"document.getElementById('equipmentList').children.map(node=>node.textContent)").includes('Future kit'));
  app.toggleEquipmentItem('bodyweight');
  assert.deepEqual(json(app,'state.ownedEquipment'),[]);
});

test('visiting preserves onboarding, explicit empty choice and saved/legacy inventory survive reload', () => {
  const cases=[
    [new Map(),[],false],
    [new Map([['gf_equipment_inventory','[]'],['gf_equipment_configured','true']]),[],true],
    [new Map([['gf_equipment_inventory','["trx","unknown"]'],['gf_equipment_configured','true']]),['trx'],true],
    [new Map([['gf_equipment','false']]),[],true],
    [new Map([['gf_equipment','true']]),null,true]
  ];
  for (const [storage,inventory,configured] of cases) {
    const app=loadAppContext(storage), expected=inventory||json(app,'EQUIPMENT.map(item=>item.id)');
    for (const route of ['more','generator']) {
      app.openEquipment(route); app.closeEquipment();
      assert.deepEqual(json(app,'state.ownedEquipment'),expected);
      assert.equal(run(app,'state.equipmentConfigured'),configured);
    }
    app.openEquipment('more'); app.closeEquipment(true);
    const reloaded=loadAppContext(storage);
    assert.deepEqual(json(reloaded,'state.ownedEquipment'),expected);
    assert.equal(run(reloaded,'state.equipmentConfigured'),true);
  }
});

test('More and Generator persist the same IDs immediately, including bodyweight-only', () => {
  const storage=new Map(),app=loadAppContext(storage);
  app.openEquipment('more'); app.toggleEquipmentItem('trx');
  assert.deepEqual(selected(app),['TRX']);
  assert.deepEqual(JSON.parse(storage.get('gf_equipment_inventory')),['trx']);
  app.closeEquipment(); app.openEquipment('generator');
  assert.deepEqual(selected(app),['TRX']);
  app.toggleEquipmentItem('dumbbells');
  assert.equal(app.document.getElementById('generatorEquipmentSummary').textContent,'Dumbbells · TRX');
  const reloaded=loadAppContext(storage); reloaded.openEquipment('more');
  assert.deepEqual(selected(reloaded),['Dumbbells','TRX']);
  reloaded.toggleEquipmentItem('trx'); reloaded.toggleEquipmentItem('dumbbells');
  assert.equal(storage.get('gf_equipment_inventory'),'[]');
  assert.equal(storage.get('gf_equipment_configured'),'true');
  assert.deepEqual(json(loadAppContext(storage),'state.ownedEquipment'),[]);
});

test('equipment edits leave standalone previews and running routines untouched; new sessions use shared kit', () => {
  const app=loadAppContext();
  app.toggleEquipmentItem('trx'); app.generateWorkout();
  const prepared=json(app,'generatorState.workout');
  app.openEquipment('more'); app.toggleEquipmentItem('trx');
  assert.deepEqual(json(app,'generatorState.workout'),prepared);
  app.generateWorkout();
  assert.ok(json(app,'generatorState.workout.main.blocks.flatMap(block=>block.exercises)').every(ex=>!ex.equipment.length));
  app.setRoutineVariant('equipment'); app.toggleEquipmentItem('trx'); app.startPreferredRoutine('warmup');
  const active=json(app,'state.list');
  app.toggleEquipmentItem('trx');
  assert.deepEqual(json(app,'state.list'),active);
  assert.equal(run(app,'state.running'),true);
  app.goHome(); app.startPreferredRoutine('warmup');
  assert.ok(json(app,'state.list').every(ex=>run(app,`CATALOGUE[${JSON.stringify(ex.id)}].equipment.length`)===0));
});
