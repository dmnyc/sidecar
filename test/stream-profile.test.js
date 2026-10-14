const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const lookup=source.slice(source.indexOf('  function profileImage('),source.indexOf('  // THE DIRECTORY IS A LIST THAT SCROLLS'));
// ---- profile lookups are batched: one read for every host asked about in a moment ----
const core=require('../stream-core');
function harness({batch=async()=>{},get=async()=>null,enabled=true,locked=false}={}){
 const pools=[],batches=[],gets=[],updates=[];let timer=null,now=1000000;
 const ctx={updatePlayingProfile:(host,record,picture)=>updates.push({host,picture,name:record.name}),profileImages:new Map(),enabled,isLocked:()=>locked,
  relays:['wss://default.example'],selectedHost:null,
  SidecarStreams:{httpsUrl:core.httpsUrl,profileBatch:async args=>{batches.push({sources:[...args.sources],keys:[...args.keys],verify:args.verify,onProfile:args.onProfile});return batch(args);}},
  NostrTools:{verifyEvent:()=>true,SimplePool:class{constructor(){this.destroyed=false;pools.push(this);}get(sources,filter,params){gets.push({sources:[...sources],kind:filter.kinds[0],host:filter.authors[0]});return get(sources,filter,params);}destroy(){this.destroyed=true;}}},
  setTimeout:(f)=>{timer=f;return 1;},Date:{now:()=>now}};
 vm.createContext(ctx);vm.runInContext(lookup,ctx);
 return {ctx,pools,batches,gets,updates,advance:ms=>{now+=ms;},flush:async()=>{const f=timer;timer=null;if(f)await f();},hasTimer:()=>timer!==null,
  ask:(h,hints)=>ctx.profileImage(h,hints)};
}
const profile=(name,picture,created=10,extra={})=>({name,content:{picture,banner:extra.banner,display_name:name},created_at:created});

test('asks made in the same moment share one read: one pool, one request per relay for every host',async()=>{
 const h=harness({batch:async a=>{for(const k of a.keys)a.onProfile(k,profile('N'+k,'https://example.com/'+k+'.png'));}});
 const hosts=Array.from({length:24},(_,i)=>'h'+i);
 const asked=hosts.map(k=>h.ask(k));
 assert.equal(h.pools.length,0,'nothing is read until the moment has passed');
 await h.flush();
 assert.equal(h.pools.length,1,'24 hosts open one pool, not 24');
 assert.equal(h.batches.length,1);
 assert.deepEqual(h.batches[0].keys,hosts);
 assert.deepEqual((await Promise.all(asked)).slice(0,2),['https://example.com/h0.png','https://example.com/h1.png']);
 assert.equal(h.pools[0].destroyed,true);
 assert.equal(h.batches[0].verify,h.ctx.NostrTools.verifyEvent,'events are verified');
 assert.ok(h.batches[0].sources.includes('wss://purplepag.es')&&h.batches[0].sources.includes('wss://default.example'));
});

test('more hosts than a batch hold are read in more than one batch, not one huge request',async()=>{
 const h=harness({batch:async a=>{for(const k of a.keys)a.onProfile(k,profile('N','https://example.com/p.png'));}});
 for(let i=0;i<120;i++)h.ask('h'+i);
 await h.flush();
 assert.deepEqual(h.batches.map(b=>b.keys.length),[50,50,20]);
 assert.equal(h.pools.length,3);assert.ok(h.pools.every(p=>p.destroyed));
});

test('a host settles the moment its profile arrives, not when the slowest relay gives up',async()=>{
 let release;const gate=new Promise(r=>{release=r;});
 const h=harness({batch:async a=>{a.onProfile('fast',profile('Fast','https://example.com/f.png'));await gate;}});
 const fast=h.ask('fast'),slow=h.ask('slow');
 const flushing=h.flush();
 assert.equal(await fast,'https://example.com/f.png');
 assert.equal(h.ctx.profileImages.get('fast').name,'Fast');
 let slowDone=false;slow.then(()=>{slowDone=true;});await new Promise(setImmediate);
 assert.equal(slowDone,false,'the other host is still being read');
 release();await flushing;assert.equal(await slow,null);
});

test('a hit is remembered for minutes; a miss for seconds, so the next ask tries again',async()=>{
 const h=harness({batch:async a=>{a.onProfile('hit',profile('Hit','https://example.com/hit.png'));}});
 h.ask('hit');h.ask('miss');await h.flush();
 const batchesAfterFirst=h.batches.length;
 h.ask('hit');h.ask('miss');assert.equal(h.hasTimer(),false,'both are answered from memory');
 h.advance(3500);h.ask('hit');h.ask('miss');
 await h.flush();
 assert.equal(h.batches.length,batchesAfterFirst+1);
 assert.deepEqual(h.batches.at(-1).keys,['miss'],'only the miss is read again');
 h.advance(310000);h.ask('hit');await h.flush();
 assert.deepEqual(h.batches.at(-1).keys,['hit'],'a hit expires after five minutes');
});

test('a host with a name and no picture is remembered for half a minute',async()=>{
 const h=harness({batch:async a=>{a.onProfile('np',profile('Name only',''));}});
 assert.equal(await (async()=>{const p=h.ask('np');await h.flush();return p;})(),null);
 assert.equal(h.ctx.profileImages.get('np').name,'Name only');
 h.advance(20000);h.ask('np');assert.equal(h.hasTimer(),false);
 h.advance(11000);h.ask('np');assert.equal(h.hasTimer(),true);
});

test('a lookup that fails is forgotten, so the next ask is a real one',async()=>{
 const h=harness({batch:async()=>{throw new Error('relays unreachable');}});
 const p=h.ask('boom');await h.flush();
 assert.equal(await p,null);
 assert.equal(h.ctx.profileImages.has('boom'),false);
 assert.equal(h.pools[0].destroyed,true);
});

test('a host nobody had a profile for is looked for on the relays it declares, as before',async()=>{
 const h=harness({get:async(sources,filter)=>{
  if(filter.kinds[0]===10002)return {tags:[['r','wss://host.example'],['r','wss://default.example']]};
  return {content:JSON.stringify({name:'Noderunners Radio',picture:'https://example.com/avatar.png',banner:'https://example.com/banner.jpg'})};}});
 const p=h.ask('host');await h.flush();
 assert.equal(await p,'https://example.com/avatar.png');
 assert.equal(h.ctx.profileImages.get('host').name,'Noderunners Radio');
 assert.equal(h.ctx.profileImages.get('host').banner,'https://example.com/banner.jpg');
 const read=h.gets.find(g=>g.kind===0);
 assert.deepEqual(read.sources,['wss://host.example'],'only the declared relays it had not already read');
 assert.equal(h.pools[0].destroyed,true);
});

test('the declared-relay fallback is bounded, and the playing stream goes first',async()=>{
 const h=harness({get:async()=>null});
 h.ctx.selectedHost='h9';
 for(let i=0;i<10;i++)h.ask('h'+i);
 await h.flush();
 const hosts=[...new Set(h.gets.filter(g=>g.kind===10002).map(g=>g.host))];
 assert.equal(hosts.length,4);
 assert.ok(hosts.includes('h9'),'the host being played is looked for first');
});

test('a newer profile from a slower relay corrects the first one',async()=>{
 let later;
 const h=harness({batch:async a=>{a.onProfile('x',profile('Old name','https://example.com/old.png',10));later=()=>a.onProfile('x',profile('New name','https://example.com/new.png',20));}});
 const p=h.ask('x');await h.flush();
 assert.equal(await p,'https://example.com/old.png');
 later();
 assert.equal(h.ctx.profileImages.get('x').name,'New name');
 assert.equal(h.updates.at(-1).picture,'https://example.com/new.png');
 const n=h.updates.length;
 h.batches[0].onProfile('x',profile('Older','https://example.com/older.png',5));
 assert.equal(h.updates.length,n,'an older version never replaces a newer one');
});

test('relay hints are limited to wss, six of them, shared across the batch',async()=>{
 const h=harness();
 const hints=['ws://bad.example',...Array.from({length:9},(_,i)=>'wss://hint'+i+'.example'),7,null];
 h.ask('a',hints);h.ask('b',['wss://hint0.example','wss://other.example']);
 await h.flush();
 const extra=h.batches[0].sources.filter(u=>u!=='wss://default.example'&&u!=='wss://purplepag.es');
 assert.equal(extra.length,6);assert.ok(extra.every(u=>u.startsWith('wss://')));
});

test('nothing is read while the player is off or the panel is locked',async()=>{
 for(const opts of [{enabled:false},{locked:true}]){
  const h=harness(opts);
  assert.equal(await h.ask('x'),null);
  assert.equal(h.hasTimer(),false);assert.equal(h.pools.length,0);
 }
});

test('the player asks once more for a host nothing answered for, after the miss has expired',()=>{
 const play=source.slice(source.indexOf('  function play('),source.indexOf('  function',source.indexOf('  function play(')+20));
 assert.match(play,/if \(!picture && !profileImages\.get\(host\)\?\.name\) setTimeout\(\(\) => \{ if \(run === generation\) profileImage\(host, item\?\.relays\); \}, PROFILE_MISS_MS \+ 500\);/);
 assert.match(source,/PROFILE_MISS_MS = 3000/,'the retry waits out a three second miss');
});

test('a later directory profile result refreshes the playing identity without changing another host',()=>{
 const start=source.indexOf('  function updatePlayingProfile(');
 const fn=source.slice(start,source.indexOf('  function profileImage(',start));
 const name={textContent:'Fallback title'},avatar={src:'',getAttribute(){return this.src;}};
 const ctx={selectedHost:'current',document:{getElementById:id=>id==='stream-host-name'?name:avatar}};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 ctx.updatePlayingProfile('other',{name:'Other'},'https://example.com/other.png');assert.equal(name.textContent,'Fallback title');assert.equal(avatar.src,'');
 ctx.updatePlayingProfile('current',{name:'Resolved name'},'https://example.com/current.png');assert.equal(name.textContent,'Resolved name');assert.equal(avatar.src,'https://example.com/current.png');
});
