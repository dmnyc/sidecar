const {test}=require('node:test'),assert=require('node:assert/strict');
const {zapHistory}=require('../stream-core');
test('pages each relay and drains timestamp ties without duplicate counting',async()=>{
 const rows=Array.from({length:14},(_,i)=>({id:String(i),created_at:100-Math.floor(i/3)}));const seen=new Set();const requests=[];
 const result=await zapHistory({sources:['a','b'],filter:{until:100},signal:new AbortController().signal,pageSize:4,query:async(r,f)=>{requests.push({r,...f});return rows.filter(e=>e.created_at<=f.until&&e.created_at>=(f.since??0)).slice(0,f.limit);},accept:async e=>seen.add(e.id)});
 assert.equal(result.complete,true);assert.equal(seen.size,14);assert.ok(requests.some(r=>r.since===r.until));assert.ok(requests.filter(r=>r.r==='a').length>2);
});
test('failed relay marks history partial while successful receipts remain',async()=>{
 const seen=[];const result=await zapHistory({sources:['good','bad'],filter:{until:1},signal:new AbortController().signal,query:async(r,f)=>{if(r==='bad')throw Error('offline');return f.until===1?[{id:'one',created_at:1}]:[];},accept:async e=>seen.push(e.id)});
 assert.equal(result.complete,false);assert.ok(seen.includes('one'));
});
test('saturated timestamp and page budget are reported incomplete',async()=>{
 for(const rows of [[{created_at:2}],Array.from({length:1000},()=>({created_at:2}))]){
 const result=await zapHistory({sources:['a'],filter:{until:2},signal:new AbortController().signal,maxPages:1,query:async()=>rows,accept:async()=>{}});assert.equal(result.complete,false);
 }
});
test('abort stops history processing',async()=>{
 const c=new AbortController();let accepted=0;const result=await zapHistory({sources:['a'],filter:{},signal:c.signal,query:async()=>{c.abort();return [{created_at:1}];},accept:async()=>accepted++});assert.equal(result.complete,false);assert.equal(accepted,0);
});
