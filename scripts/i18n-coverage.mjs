// node scripts/i18n-coverage.mjs [--json] [--check] [--draft=de,es,fr,pt-BR]
// --check requires at least one complete non-English production catalog.
// This is a coverage gate, not a native-language/security review certificate.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const {ROOT,allKeys}=require('./i18n-keys-core');
const {auditCatalog}=require('./i18n-coverage-core');
const context={Intl};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT,'i18n.js'),'utf8'),context);
const production=context.SidecarI18n.languages().filter(item=>item.code!=='en');
const draftArg=process.argv.find(arg=>arg.startsWith('--draft='));
const draftCodes=draftArg ? [...new Set(draftArg.slice(8).split(','))] : null;
if(draftCodes && draftCodes.some(code=>! /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(code))) {
  console.error('Use locale codes such as --draft=de,es,fr,pt-BR');
  process.exit(2);
}
const languages=draftCodes ? draftCodes.map(code=>({code})) : production;
const keys=allKeys();
const reports=languages.map(({code})=>{
  const catalog={}; const files=[]; const errors=[]; const missingFiles=[];
  // Match runtime regional fallback: the base catalog, then its overrides.
  for(const language of [...new Set([code.split('-')[0],code])]) {
    const file=path.join(ROOT,'locales',language+'.json');
    if(!fs.existsSync(file)) {missingFiles.push(path.relative(ROOT,file));continue;}
    try {
      const data=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!data||Array.isArray(data)||typeof data!=='object')throw Error('Expected an object');
      Object.assign(catalog,data);files.push(path.relative(ROOT,file));
    } catch(error) {errors.push(path.relative(ROOT,file)+': '+error.message);}
  }
  const result=auditCatalog(code,catalog,keys);
  return {...result,complete:result.complete&&!errors.length&&files.length>0,files,missingFiles,errors};
});
const result={baseKeys:keys.length,productionLanguages:production.length,mode:draftCodes?'draft':'production',
  catalogsComplete:reports.length>0&&reports.every(report=>report.complete),
  nativeReview:'Not assessed by this tool',reports};
if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));
else {
  console.log(keys.length+' base keys; '+reports.length+(draftCodes?' draft catalogs (not a release approval).':' non-English production languages.'));
  if(!reports.length)console.log('No production translation is registered. Language selection remains required.');
  for(const report of reports) {
    console.log(report.code+': '+report.translated+'/'+report.required+' entries; '+report.invalid.length+' invalid; '+report.unknown.length+' unknown.');
    for(const error of report.errors)console.log('  '+error);
    for(const key of report.missing.slice(0,10))console.log('  Missing: '+key);
  }
  console.log('Native review, guide coverage, and rendered layout still require separate evidence.');
}
if(process.argv.includes('--check')&&!result.catalogsComplete)process.exitCode=1;
