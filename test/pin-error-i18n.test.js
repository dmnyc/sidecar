'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../background'),'utf8');
const guard=source.slice(source.indexOf('async function guardPinAttempt('),source.indexOf('async function stepUpPin('));
function fixture(fails,delay=0) {
 const calls=[];
 const scope={MAX_UNLOCK_FAILS:21,Date:{now:()=>1000},
  loadUnlockGuard:async()=>({fails,lastAt:1000}),unlockDelayMs:()=>delay,
  saveUnlockGuard:async value=>calls.push(['save',value.fails]),
  clearUnlockGuard:async()=>calls.push(['clear']),lockKeystore:async()=>calls.push(['lock']),
  chrome:{storage:{local:{clear:callback=>{calls.push(['erase']);callback();}}}},
 };
 vm.createContext(scope);vm.runInContext(guard,scope);return {scope,calls};
}
test('cooldown metadata preserves the English error and does not attempt another PIN',async()=>{
 const f=fixture(3,5000);let attempted=false;
 await assert.rejects(f.scope.guardPinAttempt(async()=>{attempted=true;}),error=>{
  assert.equal(error.message,'Too many attempts — try again in 5s');
  assert.equal(error.errorKey,'pin-cooldown');assert.equal(error.errorParams.seconds,5);return true;
 });
 assert.equal(attempted,false);assert.deepEqual(f.calls,[]);
});
test('remaining-attempt metadata matches the persisted failure count',async()=>{
 const f=fixture(16);
 await assert.rejects(f.scope.guardPinAttempt(async()=>{throw new Error('Incorrect PIN');}),error=>{
  assert.equal(error.message,'Incorrect PIN — 4 attempts left before Sidecar erases itself');
  assert.equal(error.errorKey,'pin-remaining');assert.equal(error.errorParams.count,4);return true;
 });
 assert.deepEqual(f.calls,[['save',17]]);
});
test('translation metadata does not change final-strike erasure or successful reset',async()=>{
 const f=fixture(20);
 await assert.rejects(f.scope.guardPinAttempt(async()=>{throw new Error('Incorrect PIN');}),/Too many failed attempts — Sidecar has been erased/);
 assert.deepEqual(f.calls,[['lock'],['erase']]);
 const success=fixture(16);
 assert.equal(await success.scope.guardPinAttempt(async()=> 'ok'),'ok');
 assert.deepEqual(success.calls,[['clear']]);
});

for (const file of ['sidepanel','compose']) test(file+' call boundary translates errors without mutating the worker response',async()=>{
 const {englishI18n}=require('./helpers/i18n');const I18N=englishI18n();await I18N.ready;
 I18N.setLocale('de',[{'Incorrect PIN':'Falsche PIN'}]);
 const response={ok:false,error:'Incorrect PIN',destructive:{count:3}};
 const script=fs.readFileSync(require.resolve('../'+file),'utf8');
 const start=script.indexOf('  async function call(message) {');
 const end=script.indexOf('\n  }',start)+4;
 const ctx={I18N,t:I18N.t,bg:async()=>response};vm.createContext(ctx);vm.runInContext(script.slice(start,end),ctx);
 await assert.rejects(ctx.call({type:'SIDECAR_VERIFY_PIN'}),error=>{
  assert.equal(error.message,'Falsche PIN');
  if(file==='sidepanel')assert.equal(error.destructive,response.destructive);
  return true;
 });
 assert.equal(response.error,'Incorrect PIN');
});
