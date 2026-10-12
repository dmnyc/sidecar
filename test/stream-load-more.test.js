const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const code=source.slice(source.indexOf('  let historyPaging='),source.indexOf('  // ROWS ARE KEPT ACROSS REPAINTS'));

// The scan that fetches more history when a list has run out of known streams. The same
// scenarios the Next button used to cover: it fetches, skips batches with nothing new, stops
// at exhausted history, leaves a timeout retryable, is bounded, ignores a view that changed
// under it, and never runs two at once.
function setup(load, {category='past'}={}) {
 const rows=Array.from({length:6},()=>({title:'A stream'})),painted=[];
 const ctx={historyBusy:false,historyStalled:false,savedOnly:false,category,detailItem:null,discoveryGeneration:1,
 relays:['relay'],historyCursors:new Map(),model:{events:{size:6},past:()=>rows,upcoming:()=>[]},
 t:s=>s,paint(){painted.push(1);},JSON,loadHistory:async()=>load(ctx,rows)};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 return {ctx,rows,painted,more:(kind='main')=>ctx.loadMoreHistory(kind)};
}
test('it fetches, and new streams leave the list ready to reveal them, not stalled',async()=>{
 const s=setup((ctx,rows)=>rows.push({title:'New result'}));await s.more();
 assert.equal(s.rows.length,7);assert.equal(s.ctx.historyStalled,false);assert.ok(s.painted.length>=2,'it painted while loading and after');
});
test('it skips batches that bring nothing new before it stops',async()=>{
 let calls=0;const s=setup((ctx,rows)=>{ctx.historyCursors.set('relay',++calls);if(calls===3)rows.push({title:'Found'});});
 await s.more();assert.equal(calls,3);assert.equal(s.ctx.historyStalled,false);
});
test('exhausted history is not scanned and is not a stall: there is nothing to ask for',async()=>{
 let calls=0;const s=setup(ctx=>{calls++;ctx.historyCursors.set('relay',null);});
 s.ctx.historyCursors.set('relay',null);await s.more();
 assert.equal(calls,0,'no relay is asked');assert.equal(s.ctx.historyStalled,false);
 const t=setup(ctx=>{ctx.historyCursors.set('relay',null);});await t.more();
 assert.equal(t.ctx.historyStalled,false,'a scan that reaches the end is the end, not a stall');
});
test('a timeout stays retryable and leaves a stall, the reader keeps looking by choice, and a scan is bounded',async()=>{
 let calls=0;const s=setup(()=>calls++);await s.more();
 assert.equal(calls,1,'a scan whose cursors did not move stops at once');assert.equal(s.ctx.historyStalled,true);
 const sparse=setup(ctx=>ctx.historyCursors.set('relay',++calls));calls=0;await sparse.more();
 assert.equal(calls,5,'five attempts and no more');assert.equal(sparse.ctx.historyStalled,true);
});
test('a view that changes under a scan is not touched by it',async()=>{
 const s=setup((ctx,rows)=>{ctx.category='upcoming';rows.push({title:'Late'});});await s.more();
 assert.equal(s.ctx.historyStalled,false);
});
test('repeated triggers while one is running issue no concurrent request',async()=>{
 let finish,calls=0;const s=setup(()=>{calls++;return new Promise(resolve=>finish=resolve);});
 const pending=s.more();await s.more();assert.equal(calls,1);finish();await pending;
});
test('Live has no history to fetch, and saved streams are never fetched for',async()=>{
 let calls=0;const live=setup(()=>calls++,{category:'live'});await live.more();assert.equal(calls,0);
 const saved=setup(()=>calls++);saved.ctx.savedOnly=true;await saved.more();assert.equal(calls,0);
});
test('the More group counts only its own untitled streams',async()=>{
 let calls=0;const s=setup((ctx,rows)=>{ctx.historyCursors.set('relay',++calls);rows.push({title:'Titled result'});});
 await s.more('more');
 assert.equal(calls,5,'titled streams do not satisfy a scan for untitled ones');assert.equal(s.ctx.historyStalled,true);
 const titled=setup((ctx,rows)=>{rows.push({title:'Titled result'});});await titled.more('main');
 assert.equal(titled.ctx.historyStalled,false);
});
test('a view that changes under a scan that found nothing does not leave the new view stalled',async()=>{
 const s=setup(ctx=>{ctx.category='upcoming';});await s.more();
 assert.equal(s.ctx.historyStalled,false,'the scan belonged to the view it started in');
});
