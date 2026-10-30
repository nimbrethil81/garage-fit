const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function registry() {
  const context = vm.createContext({});
  context.window = context;
  vm.runInContext(fs.readFileSync('data/equipment.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('js/backup-registry.js', 'utf8'), context);
  return context.GarageFitBackupRegistry;
}
const json = JSON.stringify;
const sample = {
  gf_equipment_inventory: '[ ]', gf_equipment_configured: 'true', gf_equipment: 'false',
  gf_generator_duration: '30', gf_generator_focus: 'balanced', gf_generator_difficulty: 'normal',
  gf_generator_body_focus: 'full-body', gf_generator_history: json([['retired-exercise'], ['air-squat']]),
  gf_300_pb_seconds: '0130', gf_amrap_results: json([{workoutId: 'cindy', terminationType: 'amrap',
    durationSeconds: 1200, completedRounds: 5, additionalReps: 8, partialReps: 3, completedAt: '2026-10-01T10:00:00Z'}]),
  gf_routine_variant: 'equipment', gf_routine_recent_v1: json({version: 1,
    warmup: [['old-exercise']], cooldown: [{ids: ['glute-stretch'], completedAt: '2026-10-01T10:00:00Z'}]}),
  gf_desk_break_recent_v1: json([['a', 'b', 'c', 'd', 'e', 'f']]), gf_post_run_recent_v1: json(['old-stretch']),
  gf_appearance_v1: 'automatic', gf_spoken_voice_v1: json({voiceURI: 'device-old', name: 'Old voice', lang: 'en-GB'}),
  gf_first_use_v1: json({version: 1, audience: 'new', explored: true, modes: ['home'], acknowledged: 'result-1'})
};

test('portable preferences preserve exact bytes, legacy interpretation, first-use acknowledgement and old evidence', () => {
  const api = registry(), entries = Object.entries(sample);
  assert.deepEqual([...api.keys].sort(), Object.keys(sample).sort());
  assert.equal(api.validate(entries), entries);
  assert.equal(entries.find(([key]) => key === 'gf_equipment_inventory')[1], '[ ]');
  api.validate([['gf_spoken_voice_v1', 'null']]);
  api.validate([['gf_equipment_inventory', '["rings","dumbbells"]']]);
});

test('valid old histories are never truncated to the current recency display limits', () => {
  const api = registry();
  const entries = [
    ['gf_generator_history', json(Array.from({length: 80}, (_, n) => ['old-' + n]))],
    ['gf_amrap_results', json(Array.from({length: 70}, () => JSON.parse(sample.gf_amrap_results)[0]))],
    ['gf_routine_recent_v1', json({version: 1, warmup: Array.from({length: 20}, (_, n) => ['old-' + n]), cooldown: []})]
  ];
  const original = json(entries);
  assert.equal(api.validate(entries), entries);
  assert.equal(json(entries), original);
});

test('malformed, duplicate, unsupported and future-version preferences fail without sanitising', () => {
  const api = registry();
  const invalid = [
    null, {}, [['gf_equipment_inventory', '["future-equipment"]']],
    [['gf_equipment_inventory', '["rings","rings"]']], [['gf_generator_history', '[null]']],
    [['gf_appearance_v1', 'sepia']], [['gf_generator_duration', '900']],
    [['gf_equipment_configured', 'yes']], [['gf_300_pb_seconds', '-1']],
    [['gf_300_pb_seconds', '9007199254740992']], [['gf_amrap_results', '[{}]']],
    [['gf_first_use_v1', sample.gf_first_use_v1.replace('"version":1', '"version":2')]],
    [['gf_routine_recent_v1', sample.gf_routine_recent_v1.replace('"version":1', '"version":2')]],
    [['gf_desk_break_recent_v1', '[["one"]]']], [['gf_post_run_recent_v1', '[1]']],
    [['gf_spoken_voice_v1', '{}']], [['gf_first_use_v1', '{']],
    [['gf_workout_diagnostics_v1', '{}']], [['third_party_secret', 'private']],
    [['__proto__', '{}']], [['gf_appearance_v1', 'light'], ['gf_appearance_v1', 'dark']],
    [['gf_appearance_v1', 'light', 'extra']], [['gf_appearance_v1', null]]
  ];
  for (const entries of invalid) {
    const before = json(entries);
    assert.throws(() => api.validate(entries), {code: 'invalid-backup-record'});
    assert.equal(json(entries), before);
  }
});

test('every non-Coach storage key literal in production has an explicit backup classification', () => {
  const api = registry();
  const registered = new Set([...api.keys, ...api.excludedKeys]);
  const files = ['index.html', ...['js', 'data'].flatMap(dir => fs.readdirSync(dir)
    .filter(name => name.endsWith('.js')).map(name => dir + '/' + name))];
  for (const file of files) {
    // Dynamic Coach storage is privately owned and classified by coach-store.
    if (file === 'js/coach-store.js') continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const [, key] of source.matchAll(/['"](gf_[a-zA-Z0-9_]+)['"]/g)) {
      assert.ok(registered.has(key), `${file}: classify ${key} in the maintained backup registry`);
    }
  }
});
