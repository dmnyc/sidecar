const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {Directory,parse}=require('../stream-core');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const fn=source.slice(source.indexOf('  async function loadHistory('),source.indexOf('  function paginate('));
const now=Math.floor(Date.now()/1000),author='a'.repeat(64);
const event=(id,time,status='ended')=>({id,kind:30311,pubkey:author,created_at:time,tags:[['d',id],['status',status]]});
function setup(read) {
 const calls=[], errors=[];
 const ctx={historyBusy:false,historyLoaded:false,enabled:true,isLocked:()=>false,pool:{},paint(){},
  discoveryGeneration:1,discoveryAbort:new AbortController(),historyCursors:new Map(),relays:['wss://one','wss://two'],
  model:new Directory(2000),directoryError:s=>errors.push(s),t:s=>s,
  SidecarStreams:{parse,relayPage:async(pool,relay,filter,signal)=>{calls.push({relay,filter,signal});return read(relay,filter);}}};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 return {ctx,calls,errors};
}
test('history has separate relay cursors and does not skip after a timeout',async()=>{
 const s=setup(relay=>({complete:relay.endsWith('one'),events:[event(relay,now-100)]}));
 await s.ctx.loadHistory();
 assert.equal(s.ctx.historyCursors.get('wss://one'),now-101);
 assert.equal(s.ctx.historyCursors.has('wss://two'),false);
 await s.ctx.loadHistory();
 assert.equal(s.calls[2].filter.until,now-101);
 assert.equal(s.calls[3].filter.until,undefined);
 assert.equal(s.ctx.model.past().length,2);
});
test('confirmed empty history stops querying that relay until refresh',async()=>{
 const s=setup(()=>({complete:true,events:[]}));
 await s.ctx.loadHistory();await s.ctx.loadHistory();
 assert.equal(s.calls.length,2);
 await s.ctx.loadHistory(true);assert.equal(s.calls.length,4);
});
test('closing the directory discards a late response and its cursor',async()=>{
 let finish;const waiting=new Promise(resolve=>finish=resolve);
 const s=setup(()=>waiting);const pending=s.ctx.loadHistory();
 s.ctx.discoveryGeneration++;s.ctx.historyBusy=false;
 finish({complete:true,events:[event('late',now)]});await pending;
 assert.equal(s.ctx.model.events.size,0);assert.equal(s.ctx.historyCursors.size,0);
 assert.equal(s.ctx.historyLoaded,false);
});
test('concurrent history clicks issue one page per relay',async()=>{
 let finish;const waiting=new Promise(resolve=>finish=resolve);
 const s=setup(()=>waiting);const pending=s.ctx.loadHistory();
 await s.ctx.loadHistory();assert.equal(s.calls.length,2);
 finish({complete:true,events:[]});await pending;assert.equal(s.ctx.historyBusy,false);
});
test('unconfirmed relay timeouts remain retryable and report incomplete history',async()=>{
 const s=setup(()=>({complete:false,events:[]}));
 await s.ctx.loadHistory();assert.equal(s.ctx.historyLoaded,false);
 assert.equal(s.errors.at(-1),'Could not load stream history. Try again.');
 await s.ctx.loadHistory();assert.equal(s.calls.length,4);
});
