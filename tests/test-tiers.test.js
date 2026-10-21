const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

test('documented tiers include new ordinary files, exclude only marked sweeps in Fast, and propagate failures', t => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const commands = [...readme.matchAll(/```sh\n(node --test[^\n]*)\n```/g)].map(match => match[1]);
  assert.equal(commands.length, 2);
  const [fast, full] = commands;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'garage-fit-tiers-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.mkdirSync(path.join(root, 'tests'));
  const write = (name, body) => fs.writeFileSync(path.join(root, 'tests', name + '.test.js'),
    "const test = require('node:test');\n" + body);
  const run = command => {
    const result = spawnSync(command, {cwd:root, shell:true, encoding:'utf8',
      env:{...process.env, NODE_TEST_CONTEXT:undefined}});
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return result;
  };
  write('mixed', "test('ordinary fixture',()=>{});\ntest('[Full] sweep fixture',()=>{throw Error('sweep executed')});");
  // This file is added after defining the commands: no allowlist to update.
  write('new-ordinary', "test('new ordinary fixture',()=>{});");
  const quick = run(fast);
  assert.equal(quick.status, 0, quick.stdout + quick.stderr);
  assert.match(quick.stdout, /ordinary fixture/);
  assert.match(quick.stdout, /new ordinary fixture/);
  assert.doesNotMatch(quick.stdout, /sweep executed/);
  const exhaustive = run(full);
  assert.equal(exhaustive.status, 1, exhaustive.stdout + exhaustive.stderr);
  assert.match(exhaustive.stdout, /sweep executed/);
  assert.match(exhaustive.stdout, /new ordinary fixture/);
  write('mixed', "test('ordinary fixture',()=>{});\ntest('[Full] sweep fixture',()=>{});");
  assert.equal(run(full).status, 0);
  write('new-ordinary', "test('new ordinary fixture',()=>{throw Error('ordinary regression')});");
  for (const command of commands) {
    const result = run(command);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /ordinary regression/);
  }
});
