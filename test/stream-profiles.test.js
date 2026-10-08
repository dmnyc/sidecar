const {test}=require('node:test');
const assert=require('node:assert/strict');
const {profileBatch}=require('../stream-core');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function transport(){
 const reads=[];
 const pool={ensureRelay:async url=>({subscribe(filters,handlers){const read={url,filter:filters[0],handlers,closed:false};reads.push(read);return {close(){read.closed=true;}};}})};
 return {pool,reads};
}
const event=(pubkey,time,name,extra={})=>({kind:0,pubkey,created_at:time,id:String(time),content:JSON.stringify({name,picture:'https://example.com/avatar.png'}),...extra});
test('profiles arrive before slow relay EOSE and newest valid metadata wins',async()=>{
 const s=transport(),updates=[],controller=new AbortController();
 const pending=profileBatch({pool:s.pool,sources:['wss://fast.example','wss://slow.example'],keys:['a'],signal:controller.signal,verify:e=>e.valid!==false,onProfile:(key,p)=>updates.push(p.name)});
 await tick();
 s.reads[0].handlers.onevent(event('a',10,'First'));
 assert.deepEqual(updates,['First']); // Neither relay has finished.
 s.reads[1].handlers.onevent(event('a',20,'New'));
 s.reads[0].handlers.onevent(event('a',5,'Old'));
 s.reads[0].handlers.onevent(event('other',30,'Foreign'));
 s.reads[0].handlers.onevent(event('a',30,'Invalid',{valid:false}));
 s.reads[0].handlers.onevent(event('a',Math.floor(Date.now()/1000)+3600,'Future'));
 assert.deepEqual(updates,['First','New']);
 s.reads.forEach(r=>r.handlers.oneose());
 assert.equal((await pending).get('a').name,'New');
 assert.ok(s.reads.every(r=>r.closed));
});
test('missing profile fallbacks are bounded and abort closes reads without late updates',async()=>{
 const s=transport(),updates=[],controller=new AbortController();
 const pending=profileBatch({pool:s.pool,sources:['wss://primary.example'],keys:['a','b','c','d'],signal:controller.signal,verify:()=>true,onProfile:(k,p)=>updates.push(p)});
 await tick();s.reads[0].handlers.oneose();await tick();
 assert.equal(s.reads.length,3);assert.deepEqual(s.reads.slice(1).map(r=>r.filter.authors),[['a'],['b']]);
 s.reads[1].handlers.onevent(event('a',10,'A'));s.reads[1].handlers.oneose();await tick();
 assert.equal(s.reads.length,4);assert.deepEqual(s.reads[3].filter.authors,['c']);
 controller.abort();const result=await pending;
 s.reads[2].handlers.onevent(event('b',10,'Late'));
 assert.equal(result.size,1);assert.equal(updates.length,1);assert.equal(s.reads.length,4);assert.ok(s.reads.every(r=>r.closed));
});
test('already aborted profile loading does not open relay connections',async()=>{
 const s=transport(),controller=new AbortController();controller.abort();
 const result=await profileBatch({pool:s.pool,sources:['wss://primary.example'],keys:['a'],signal:controller.signal,verify:()=>true});
 assert.equal(result.size,0);assert.equal(s.reads.length,0);
});
