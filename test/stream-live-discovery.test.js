const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {Directory}=require('../stream-core');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const code=source.slice(source.indexOf('  const liveChecks='),source.indexOf('  function disconnect()'));
function setup(probe){
 const model=new Directory(2000),now=Math.floor(Date.now()/1000);
 for(let i=0;i<4;i++)model.accept({kind:30311,id:String(i),pubkey:'a'.repeat(64),created_at:now-7200,tags:[['d',String(i)],['status','live'],['streaming',`https://media.example/${i}.m3u8`]]});
 const ctx={model,Date,Set,Map,Math,setTimeout,clearTimeout,enabled:true,isLocked:()=>false,pool:{},discoveryGeneration:1,discoveryAbort:new AbortController(),queueDirectoryPaint(){},SidecarStreams:{advancingPlaylist:probe}};
 vm.createContext(ctx);vm.runInContext(code,ctx);return ctx;
}
test('stale stream probes stay limited to two concurrent requests across repeated scheduling',async()=>{
 let active=0,max=0,calls=0;const releases=[];
 const ctx=setup(async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>releases.push(r));active--;return true;});
 const pending=ctx.checkOlderLiveStreams();await ctx.checkOlderLiveStreams();assert.equal(calls,2);
 releases.splice(0).forEach(r=>r());await new Promise(setImmediate);assert.equal(calls,4);
 releases.splice(0).forEach(r=>r());await pending;assert.equal(max,2);assert.equal(ctx.model.live().length,4);
});
test('closing discovery prevents late playlist results from verifying a stream',async()=>{
 const releases=[];const ctx=setup(()=>new Promise(r=>releases.push(r)));const pending=ctx.checkOlderLiveStreams();
 ctx.discoveryGeneration++;ctx.discoveryAbort.abort();releases.forEach(r=>r(true));await pending;
 assert.equal(ctx.model.verified.size,0);
});
