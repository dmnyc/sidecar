// Export source and draft translations for native review. This never marks a review complete.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {ROOT,allKeys}=require('./i18n-keys-core');
const codes=['de','es','fr','pt-BR'];
const keys=allKeys().filter(key=>key.security);
const english=JSON.parse(fs.readFileSync(path.join(ROOT,'_locales/en/messages.json'),'utf8'));
const dir=path.join(ROOT,'docs/i18n/review');
fs.mkdirSync(dir,{recursive:true});
for(const code of codes) {
 const catalog=JSON.parse(fs.readFileSync(path.join(ROOT,'locales',code+'.json'),'utf8'));
 const browser=JSON.parse(fs.readFileSync(path.join(ROOT,'_locales',code.replace('-','_'),'messages.json'),'utf8'));
 const entries=[];
 for(const key of keys) {
  const forms=key.plural?new Intl.PluralRules(code).resolvedOptions().pluralCategories.map(form=>key.key+'_'+form):[key.key];
  if(key.plural&&key.simple)forms.unshift(key.key);
  for(const name of forms)entries.push({file:'locales/'+code+'.json',key:name,english:key.key,translation:catalog[name],reviewed:false,notes:''});
 }
 for(const [name,entry] of Object.entries(english)) entries.push({
  file:'_locales/'+code.replace('-','_')+'/messages.json',key:name,english:entry.message,
  context:entry.description,translation:browser[name].message,reviewed:false,notes:''
 });
 const output=path.join(dir,code+'.json');
 if(fs.existsSync(output)) {
  const previous=JSON.parse(fs.readFileSync(output,'utf8'));
  if(previous.reviewer||previous.reviewedAt||previous.entries.some(entry=>entry.reviewed||entry.notes)) {
   throw new Error('Preserving review work in '+output+'; reconcile changed strings manually.');
  }
 }
 const packet={language:code,status:'Unreviewed draft',reviewer:null,reviewedAt:null,entries};
 fs.writeFileSync(output,JSON.stringify(packet,null,2)+'\n');
 console.log(code+': '+entries.length+' entries for security and browser-text review');
}
