const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
test('programme illustration sources and runtime files preserve the separate integrity contract',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/programme-artwork/manifest.json')));
 const supplied=JSON.parse(fs.readFileSync(path.join(root,'docs/programme-artwork/supplied-manifest.json')));
 assert.deepEqual(manifest.assets.map(a=>a.id).sort(),['build-arms','general-fitness','general-strength-4w','tennis-conditioning']);
 for(const a of manifest.assets)for(const kind of ['source','runtime']){
  const record=a[kind], bytes=fs.readFileSync(path.join(root,record.path));
  const originalHash=supplied[a.id][kind==='source'?'png_sha256':'webp_sha256'];
  if(a.revision){
   // #365 deliberately replaced Tennis artwork; retain the original supply record
   // and verify the approved replacement's own current hash below.
   assert.equal(a.id,'tennis-conditioning');
   assert.equal(a.revision.issue,365);assert.equal(a.revision.pullRequest,372);
   assert.ok(a.revision.provenance);
   assert.equal(record.replacesSha256,originalHash);
   assert.notEqual(record.sha256,originalHash);
  }else {
   assert.equal(record.replacesSha256,undefined);
   assert.equal(record.sha256,originalHash);
  }
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),record.sha256);
  assert.ok(bytes.length<(kind==='source'?3000000:300000));
  if(kind==='source')assert.equal(bytes.subarray(1,4).toString(),'PNG');
  else {assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WEBP');}
 }
});
