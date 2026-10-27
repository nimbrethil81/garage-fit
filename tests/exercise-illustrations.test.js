const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
global.window = global;
require('../data/equipment.js');
require('../data/exercises.js');
require('../js/generator.js');
const ids = ['dumbbell-lateral-raise','dumbbell-romanian-deadlift','side-plank','skater-jumps','trx-reverse-lunge','trx-row'];
const base = path.join(__dirname, '..');
const manifest = require('../docs/exercise-artwork/manifest.json');
test('only the six pilot exercises resolve to safe canonical WebP paths', () => {
  assert.deepEqual(Object.values(GarageFitData.exercises).filter(e => e.illustration).map(e => e.id).sort(), ids);
  for (const e of Object.values(GarageFitData.exercises)) {
    assert.equal(GarageFitData.exerciseIllustration(e.id), ids.includes(e.id) ? `assets/exercises/${e.id}.webp` : null);
  }
  for (const id of ['unknown','../trx-row','https://example.com','__proto__',null]) assert.equal(GarageFitData.exerciseIllustration(id), null);
});
test('illustrations remain optional and reject malformed authoring and runtime values', () => {
  const copy = JSON.parse(JSON.stringify(GarageFitData.exercises));
  delete copy['air-squat'].illustration;
  assert.deepEqual(GarageFitGenerator.validateCatalogue(copy), []);
  for (const value of ['external.webp',{},1,null]) {
    copy['air-squat'].illustration = value;
    assert.ok(GarageFitGenerator.validateCatalogue(copy).some(e => /illustration must be boolean/.test(e)));
  }
  assert.throws(() => GarageFitData.buildExerciseCatalogue([{id:'x',illustrationUrl:'x'}]), /unknown exercise field/);
});
test('all expected binaries retain verified integrity, format, alpha flag and bounded sizes', () => {
  assert.deepEqual(fs.readdirSync(path.join(base,'assets/exercises')).sort(), ids.map(id => id+'.webp'));
  assert.deepEqual(Object.keys(manifest).sort(), ids);
  for (const id of ids) {
    for (const [kind, file] of Object.entries(manifest[id])) {
      const bytes = fs.readFileSync(path.join(base, file.path));
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256);
      assert.ok(bytes.length > 1000 && bytes.length <= (kind==='webp' ? 300000 : 2000000));
      if (kind==='webp') {
        assert.equal(bytes.toString('ascii',0,4),'RIFF');
        assert.equal(bytes.readUInt32LE(4)+8,bytes.length);
        assert.equal(bytes.toString('ascii',8,16),'WEBPVP8X');
        assert.ok(bytes[20] & 16, id+' has alpha');
      } else if (kind==='png') assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      else assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');
    }
  }
});
