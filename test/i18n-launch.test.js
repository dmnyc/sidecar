'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'i18n.js'),'utf8');
const codes=['ar','de','el','es','fa','fr','he','hi','hu','it','ja','ko','pl','pt-BR','pt-PT','ru','th','tr','ur','zh','zh-TW'];
for(const code of codes) {
 test(code+' loads its real catalog through the persisted language setting',async()=>{
  const fetched=[];
  const ctx={Intl,chrome:{
   i18n:{getUILanguage:()=> 'en-US'},
   runtime:{getURL:p=>p},
   storage:{local:{get:(_key,cb)=>cb({sidecar_settings:{language:code}})}}
  },fetch:async url=>{
   fetched.push(url);
   const file=path.join(root,url);
   return {ok:fs.existsSync(file),json:async()=>JSON.parse(fs.readFileSync(file,'utf8'))};
  }};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const i=ctx.SidecarI18n;await i.ready;
  assert.equal(i.lang,code);
  assert.ok(fetched.includes('locales/'+code+'.json'));
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'locales',code+'.json'),'utf8'));
  assert.equal(i.t('Copy'),catalog.Copy);
  const key='Incorrect PIN. Attempts remaining before Sidecar erases itself: {{count}}';
  assert.equal(i.controlError({errorKey:'pin-remaining',errorParams:{count:3}}),catalog[key].replace('{{count}}',i.fmtNum(3)));
  const one='{{count}} relay';
  for(const count of [0,1,2,1000000]) {
   const category=new Intl.PluralRules(code).select(count);
   assert.equal(i.tn(one,'{{count}} relays',count),catalog[one+'_'+category].replace('{{count}}',i.fmtNum(count)));
  }
  const text={textContent:'',getAttribute:()=> 'Copy'};
  const doc={documentElement:{setAttribute(){}},querySelectorAll:selector=>selector==='[data-i18n]'?[text]:[]};
  ctx.document=doc;
  i.applyDom();
  assert.equal(text.textContent,catalog.Copy);
 });
}
test('browser payment catalogs retain every key and payment placeholder definition',()=>{
 const english=JSON.parse(fs.readFileSync(path.join(root,'_locales/en/messages.json'),'utf8'));
 for(const code of codes) {
  const folder=code==='zh'?'zh_CN':code.replace('-','_');
  if(!fs.existsSync(path.join(root,'_locales',folder))) { assert.equal(code,'ur','only Urdu has no browser message catalog (Chrome has no Urdu locale)'); continue; }
  const messages=JSON.parse(fs.readFileSync(path.join(root,'_locales',folder,'messages.json'),'utf8'));
  assert.deepEqual(Object.keys(messages).sort(),Object.keys(english).sort());
  for(const [key,entry] of Object.entries(english)) {
   assert.deepEqual(messages[key].placeholders,entry.placeholders,code+': '+key);
   const slots=text=>[...text.matchAll(/\$([A-Z_]+)\$/g)].map(m=>m[1]).sort();
   assert.deepEqual(slots(messages[key].message),slots(entry.message),code+': '+key);
  }
 }
});

// zh was once written with zh-TW's file, because the merge matched "out-zh-" against "out-zh-TW-".
// Both then read as Traditional, and nothing failed. The two scripts share a few strings (PIN, 24H),
// never most of them.
test('the Simplified and Traditional Chinese catalogs are different translations',()=>{
 const read=code=>JSON.parse(fs.readFileSync(path.join(root,'locales',code+'.json'),'utf8'));
 const simplified=read('zh'),traditional=read('zh-TW');
 const keys=Object.keys(simplified);
 const alike=keys.filter(key=>simplified[key]===traditional[key]).length;
 assert.ok(alike<keys.length*0.2,alike+' of '+keys.length+' strings are the same in both');
 for(const key of ['Accounts','Activity','Profile','Wallet','Settings']) assert.notEqual(simplified[key],traditional[key],key);
 assert.match(simplified.Wallet,/钱包/);
 assert.match(traditional.Wallet,/錢包/);
});
