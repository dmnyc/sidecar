'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'help.js'),'utf8');
const key='This guide is currently available in English. Translations are in progress.';
for(const language of ['en','ar','de','el','es','fa','fr','he','hi','hu','it','ja','ko','pl','pt-BR','pt-PT','ru','th','tr','ur','zh','zh-TW']) {
 test('guide identifies its English content for '+language,async()=>{
  const note={hidden:true,textContent:'',lang:''};
  const catalog=language==='en'?{}:JSON.parse(fs.readFileSync(path.join(root,'locales',language+'.json'),'utf8'));
  const ctx={document:{getElementById:id=>id==='guide-language-note'?note:null},
   window:{SidecarI18n:{lang:language,ready:Promise.resolve(),t:k=>catalog[k]||k}}};
  vm.createContext(ctx);vm.runInContext(source,ctx);await Promise.resolve();
  assert.equal(note.hidden,language==='en');
  if(language!=='en') {
   assert.equal(note.textContent,catalog[key]);
   assert.equal(note.lang,language);
  }
 });
}
