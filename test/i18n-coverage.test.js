'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {auditCatalog}=require('../scripts/i18n-coverage-core');

test('missing translations fail coverage even though runtime English fallback would work',()=>{
 const report=auditCatalog('de',{Copy:'Kopieren'},[{key:'Copy'},{key:'Unlock',security:true}]);
 assert.equal(report.complete,false);assert.deepEqual(report.missing,['Unlock']);
 assert.equal(report.translated,1);assert.deepEqual(report.securityKeys,['Unlock']);
});

test('coverage requires each locale plural category and retains plain uses',()=>{
 const keys=[{key:'{{count}} relay',other:'{{count}} relays',plural:true,simple:true}];
 const catalog={'{{count}} relay':'{{count}} relais'};
 for(const category of new Intl.PluralRules('ar').resolvedOptions().pluralCategories)catalog['{{count}} relay_'+category]='{{count}} relais';
 assert.equal(auditCatalog('ar',catalog,keys).complete,true);
 delete catalog['{{count}} relay_few'];
 assert.deepEqual(auditCatalog('ar',catalog,keys).missing,['{{count}} relay_few']);
});

test('coverage rejects malformed values and altered security parameters',()=>{
 const report=auditCatalog('de',{
  'Pay {{amount}} to {{name}}':'Zahlen an {{name}}',
  Copy:'<b>Kopieren</b>',Empty:'',Number:12,Unknown:'Extra',
 },[{key:'Pay {{amount}} to {{name}}',security:true},{key:'Copy'},{key:'Empty'},{key:'Number'}]);
 assert.equal(report.complete,false);
 assert.deepEqual(report.unknown,['Unknown']);
 assert.deepEqual(report.missing,['Empty','Number']);
 assert.deepEqual(report.invalid.map(item=>item.reason),['placeholder mismatch','markup','empty or non-string value','empty or non-string value']);
});

test('plural forms may spell out count but must retain other parameters',()=>{
 const key={key:'{{count}} relay for {{name}}',other:'{{count}} relays for {{name}}',plural:true};
 const catalog={[key.key+'_one']:'Relay for {{name}}',[key.key+'_other']:'{{count}} relays for {{name}}'};
 assert.equal(auditCatalog('de',catalog,[key]).complete,true);
 catalog[key.key+'_one']='One relay';
 assert.equal(auditCatalog('de',catalog,[key]).complete,false);
});

test('release coverage command reports actual registration and never passes an empty language set',()=>{
 const run=spawnSync(process.execPath,[path.join(__dirname,'../scripts/i18n-coverage.mjs'),'--json','--check'],{encoding:'utf8'});
 const report=JSON.parse(run.stdout);
 assert.equal(run.status,report.catalogsComplete?0:1);
 if(!report.productionLanguages)assert.equal(report.catalogsComplete,false);
 assert.equal(report.nativeReview,'Not assessed by this tool');
});

test('draft audit measures unregistered catalogs without changing language registration',()=>{
 const script=path.join(__dirname,'../scripts/i18n-coverage.mjs');
 const run=spawnSync(process.execPath,[script,'--draft=de,es,fr,pt-BR','--json','--check'],{encoding:'utf8'});
 const report=JSON.parse(run.stdout);
 assert.equal(run.status,report.catalogsComplete?0:1);
 assert.equal(report.mode,'draft');
 assert.deepEqual(report.reports.map(item=>item.code),['de','es','fr','pt-BR']);
 for(const item of report.reports) {
  assert.ok(item.translated>0);
  assert.deepEqual(item.invalid,[]);
  assert.deepEqual(item.unknown,[]);
 }
});

test('draft locale arguments cannot traverse paths',()=>{
 const run=spawnSync(process.execPath,[path.join(__dirname,'../scripts/i18n-coverage.mjs'),'--draft=../../secrets'],{encoding:'utf8'});
 assert.equal(run.status,2);
 assert.match(run.stderr,/Use locale codes/);
});
