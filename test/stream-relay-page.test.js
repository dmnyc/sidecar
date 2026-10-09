const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const {relayPage,zapHistory}=require('../stream-core');
// Exercise the vendored transport and its real callback ordering. Only the wire is fake.
function transport(mode){
 const requests=[];
 class Socket {
  static OPEN=1;
  constructor(url){this.url=url;this.readyState=0;queueMicrotask(()=>{if(mode(url)==='connect-fail'){this.readyState=3;this.onerror?.();}else{this.readyState=1;this.onopen?.();}});}
  send(raw){const [type,id,filter]=JSON.parse(raw);if(type!=='REQ')return;requests.push({url:this.url,filter});queueMicrotask(()=>{
   const behavior=mode(this.url);
   if(behavior==='closed'){this.onmessage?.({data:JSON.stringify(['CLOSED',id,'rate-limited: retry later'])});return;}
   if(behavior==='silent')return;
   const events=Array.isArray(behavior)?behavior:behavior.events || [];
   for(const event of events.filter(e=>e.created_at<=(filter.until??Infinity)&&e.created_at>=(filter.since??0)).slice(0,filter.limit??1000))this.onmessage?.({data:JSON.stringify(['EVENT',id,event])});
   this.onmessage?.({data:JSON.stringify([behavior.closed?'CLOSED':'EOSE',id,...(behavior.closed?['disconnected']:[])])});
  });}
  close(){this.readyState=3;}
 }
 const ctx={TextEncoder,TextDecoder,URL,crypto:crypto.webcrypto,Uint8Array,Object,Array,JSON,console,setTimeout:(fn,ms)=>setTimeout(fn,ms).unref(),clearTimeout,setInterval,clearInterval};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../nostr-tools'),'utf8'),ctx);
 const nt=ctx.NostrTools,pool=new nt.SimplePool({websocketImplementation:Socket});
 const secret=nt.generateSecretKey();
 const event=time=>nt.finalizeEvent({kind:9735,created_at:time,content:'',tags:[]},secret);
 return {pool,requests,event};
}
test('real pool emits synthetic EOSE on failure; relay pages do not call that complete',async()=>{
 for(const failure of ['connect-fail','closed']){
  const s=transport(()=>failure),order=[];
  await new Promise(resolve=>s.pool.subscribeMany(['wss://archive.example'],{kinds:[9735]},{oneose:()=>order.push('EOSE'),onclose:()=>{order.push('CLOSED');resolve();}}));
  assert.deepEqual(order,['EOSE','CLOSED']);
  const page=await relayPage(s.pool,'wss://archive.example',{kinds:[9735]},null,100);
  assert.equal(page.complete,false);assert.equal(page.events.length,0);
  const chat=await require('../stream-chat').readPage(s.pool,['wss://archive.example'],{kinds:[1311]},null,100);assert.equal(chat.complete,false);assert.equal(chat.answered,0);s.pool.destroy();
 }
});
test('only real EOSE completes a page; silent relays and aborts stay incomplete',async()=>{
 for(const behavior of [[], 'silent']){
  const s=transport(()=>behavior),page=await relayPage(s.pool,'wss://archive.example',{kinds:[9735]},null,25);
  assert.equal(page.complete,Array.isArray(behavior));s.pool.destroy();
 }
 const s=transport(()=> 'silent'),c=new AbortController(),pending=relayPage(s.pool,'wss://archive.example',{kinds:[9735]},c.signal,100);
 c.abort();assert.equal((await pending).complete,false);s.pool.destroy();
});
test('receipts received before CLOSED remain available and history stays partial',async()=>{
 let receipt;const s=transport(()=>({events:[receipt],closed:true}));receipt=s.event(5);
 const accepted=new Set();const result=await zapHistory({sources:['wss://archive.example'],query:(url,f)=>relayPage(s.pool,url,f,null,100),filter:{kinds:[9735],until:10},signal:new AbortController().signal,accept:async e=>accepted.add(e.id)});
 assert.equal(result.complete,false);assert.equal(accepted.size,1);s.pool.destroy();
});
test('failed archive is rescanned from history on recovery and deduplicates existing receipts',async()=>{
 let recovered=false,old,recent;
 const s=transport(url=>url.includes('archive')?(recovered?[recent,old]:'connect-fail'):[recent]);old=s.event(5);recent=s.event(90);
 const accepted=new Set(),sources=['wss://recent.example','wss://archive.example'];
 const scan=filter=>zapHistory({sources,query:(url,f)=>relayPage(s.pool,url,f,null,100),filter,signal:new AbortController().signal,accept:async e=>accepted.add(e.id)});
 const first=await scan({kinds:[9735],until:100});assert.equal(first.complete,false);assert.equal(accepted.size,1);
 recovered=true;
 // This is the recovery decision used by the player: advance only on complete history.
 const second=await scan({kinds:[9735],until:100,...(first.complete?{since:98}:{})});
 assert.equal(second.complete,true);assert.equal(accepted.size,2);assert.ok(accepted.has(old.id));
 const archive=s.requests.filter(r=>r.url.includes('archive'));assert.equal(archive[0].filter.since,undefined);s.pool.destroy();
});
