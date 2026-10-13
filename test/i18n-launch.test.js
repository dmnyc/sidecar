'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'i18n.js'),'utf8');
const codes=['de','es','fr','pt-BR'];
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
  assert.equal(i.controlError({errorKey:'pin-remaining',errorParams:{count:3}}),catalog[key].replace('{{count}}','3'));
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
  const messages=JSON.parse(fs.readFileSync(path.join(root,'_locales',code.replace('-','_'),'messages.json'),'utf8'));
  assert.deepEqual(Object.keys(messages).sort(),Object.keys(english).sort());
  for(const [key,entry] of Object.entries(english)) {
   assert.deepEqual(messages[key].placeholders,entry.placeholders,code+': '+key);
   const slots=text=>[...text.matchAll(/\$([A-Z_]+)\$/g)].map(m=>m[1]).sort();
   assert.deepEqual(slots(messages[key].message),slots(entry.message),code+': '+key);
  }
 }
});
