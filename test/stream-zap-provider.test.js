const {test}=require('node:test');const assert=require('node:assert/strict');
const {zapProvider}=require('../stream-core');
const host='a'.repeat(64), provider='b'.repeat(64);
const ev=(kind,content,tags=[])=>({kind,pubkey:host,created_at:1,id:'1',content:JSON.stringify(content),tags});
test('missing bootstrap profile is resolved on declared relays and foreign profiles are ignored',async()=>{
 const sources=['wss://bootstrap.example'];const queries=[];
 const pool={querySync:async(urls,filter)=>{
  queries.push([...urls]);
  if(filter.kinds[0]===10002)return [ev(10002,{},[['r','wss://author.example']])];
  if(urls[0]==='wss://author.example')return [ev(0,{lud16:'host@example.com'})];
  return [{...ev(0,{lud16:'wrong@example.com'}),pubkey:'c'.repeat(64)}];
 }};
 let requested;
 const meta=await zapProvider(pool,sources,host,new AbortController().signal,async url=>{requested=url;return {ok:true,json:async()=>({allowsNostr:true,nostrPubkey:provider})};});
 assert.equal(meta.nostrPubkey,provider);assert.equal(requested,'https://example.com/.well-known/lnurlp/host');assert.ok(sources.includes('wss://author.example'));assert.deepEqual(queries[2],['wss://author.example']);
});
test('provider failures reject instead of returning a false zero',async()=>{
 const pool={querySync:async(_,f)=>f.kinds[0]===0?[ev(0,{lud16:'host@example.com'})]:[]};
 await assert.rejects(zapProvider(pool,[],host,new AbortController().signal,async()=>({ok:false})),/unavailable/);
});
test('stopping during provider fetch aborts the request',async()=>{
 const controller=new AbortController();const pool={querySync:async(_,f)=>f.kinds[0]===0?[ev(0,{lud16:'host@example.com'})]:[]};
 let started;const ready=new Promise(r=>started=r);
 const task=zapProvider(pool,[],host,controller.signal,(_,opts)=>new Promise((resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(new Error('aborted')));started();}));
 await ready;controller.abort();await assert.rejects(task,/aborted/);
});
const vm=require('node:vm'),fs=require('node:fs');
test('zap bootstrap retries twice and ignores a retry after switching streams',async()=>{
 const src=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
 const fn=src.slice(src.indexOf('  async function watchZaps('),src.indexOf('  function play('));
 let attempts=0;const scheduled=[];const out={replaceChildren(){},removeAttribute(){}};
 const context={document:{getElementById:()=>out},AbortController,fetch:()=>{},relays:[],generation:1,zapAbort:null,zapPool:null,zapRetryTimer:null,NostrTools:{SimplePool:class{destroy(){}}},SidecarStreams:{zapProvider:async()=>{attempts++;throw Error('offline');}},setTimeout:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;}};
 vm.createContext(context);vm.runInContext(fn,context);
 await context.watchZaps({host,relays:[]},1);
 assert.equal(scheduled[0].ms,2000);scheduled.shift().fn();await new Promise(setImmediate);
 assert.equal(scheduled[0].ms,5000);scheduled.shift().fn();await new Promise(setImmediate);
 assert.equal(attempts,3);assert.equal(scheduled.length,0);
 await context.watchZaps({host,relays:[]},1);context.generation=2;scheduled.shift().fn();await new Promise(setImmediate);assert.equal(attempts,4);
});
