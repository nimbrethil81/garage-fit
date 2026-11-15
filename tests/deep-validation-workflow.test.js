const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {execFileSync}=require('node:child_process');

test('Deep validation summaries print branch and SHA literally in both jobs',()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../.github/workflows/picksetgo-deep-validation.yml'),'utf8');
  const lines=source.split('\n').filter(line=>line.trim().startsWith('printf --'));
  assert.equal(lines.length,4);
  assert.doesNotMatch(source,/echo "- (Source branch\/ref|Tested SHA):/);
  const ref='refs/heads/fix/407-exercise-metadata',sha='0123456789abcdef0123456789abcdef01234567';
  const output=execFileSync('bash',['-e','-o','pipefail','-c',lines.map(line=>line.trim()).join('\n')],{
    env:{...process.env,SOURCE_REF:ref,TESTED_SHA:sha},encoding:'utf8'});
  const expected=['- Source branch/ref: `'+ref+'`','- Tested SHA: `'+sha+'`'];
  assert.deepEqual(output.trim().split('\n'),expected.concat(expected));
});
