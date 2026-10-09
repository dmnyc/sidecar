const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const code=source.slice(source.indexOf('  let historyPaging='),source.indexOf('  function paginate('));
function setup(load) {
 const rows=Array.from({length:6},()=>({title:'A stream'})),messages=[],pages=[];
 const ctx={historyBusy:false,savedOnly:false,category:'past',moreOpen:false,detailItem:null,discoveryGeneration:1,
 pageSize:6,relays:['relay'],historyCursors:new Map(),model:{events:{size:6},past:()=>rows,upcoming:()=>[]},
 directoryError:s=>messages.push(s),t:s=>s,paint(){},revealContent(){},JSON,loadHistory:async()=>load(ctx,rows)};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,rows,messages,pages,next:()=>ctx.nextHistoryPage({},0,page=>pages.push(page))};
}
test('Next fetches and advances to the newly available page',async()=>{
 const s=setup((ctx,rows)=>rows.push({title:'New result'}));await s.next();assert.deepEqual(s.pages,[1]);
});
test('Next skips duplicate-only batches before advancing',async()=>{
 let calls=0;const s=setup((ctx,rows)=>{ctx.historyCursors.set('relay',++calls);if(calls===3)rows.push({title:'Found'});});
 await s.next();assert.equal(calls,3);assert.deepEqual(s.pages,[1]);
});
test('Next stops at exhausted history without advancing to an empty page',async()=>{
 const s=setup(ctx=>ctx.historyCursors.set('relay',null));await s.next();assert.deepEqual(s.pages,[]);
 assert.equal(s.messages.at(-1),'No more streams available.');
});
test('Next leaves a timeout retryable and bounds sparse scans',async()=>{
 let calls=0;const s=setup(()=>calls++);await s.next();assert.equal(calls,1);assert.deepEqual(s.pages,[]);
 assert.match(s.messages.at(-1),/Select Next/);
 const sparse=setup(ctx=>ctx.historyCursors.set('relay',++calls));await sparse.next();assert.equal(calls,6);
});
test('changing views while loading cannot advance the new view',async()=>{
 const s=setup((ctx,rows)=>{ctx.category='upcoming';rows.push({title:'Late'});});await s.next();assert.deepEqual(s.pages,[]);
});
test('repeated clicks while loading do not issue concurrent requests',async()=>{
 let finish,calls=0;const s=setup(()=>{calls++;return new Promise(resolve=>finish=resolve);});
 const pending=s.next();await s.next();assert.equal(calls,1);finish();await pending;
});
