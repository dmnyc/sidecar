const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const code=source.slice(source.indexOf('  function openHostProfile('),source.indexOf('  document.getElementById(\'stream-host\').addEventListener'));
function click({host='a'.repeat(64),identity=()=>({pubkey:'b'}),bridge=true}={}){
 const opened=[];let prevented=false;
 const ctx={selectedHost:host,window:bridge?{SidecarStreamChatAccount:{identity,profile:key=>opened.push(key)}}:{}};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 ctx.openHostProfile({preventDefault(){prevented=true;}});
 return {opened,prevented};
}
test('clicking the streamer opens their profile card and cancels the browser link',()=>{
 const r=click();assert.deepEqual(r.opened,['a'.repeat(64)]);assert.equal(r.prevented,true);
});
test('without an account to show it, the link to the web client still works',()=>{
 for(const r of [click({identity:()=>null}),click({bridge:false}),click({host:null})]){assert.deepEqual(r.opened,[]);assert.equal(r.prevented,false);}
});
test('the click is wired to the streamer link',()=>{
 assert.match(source,/getElementById\('stream-host'\)\.addEventListener\('click', openHostProfile\)/);
});
