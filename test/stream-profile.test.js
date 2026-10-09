const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const lookup=source.slice(source.indexOf('  function profileImage('),source.indexOf('  let pageSize'));
test('profile lookup survives directory shutdown and reads declared relays on a miss',async()=>{
 let finish;let destroyed=false;const calls=[];
 const context={updatePlayingProfile(){},profileImages:new Map(),enabled:true,isLocked:()=>false,relays:['wss://default.example'],SidecarStreams:require('../stream-core'),NostrTools:{SimplePool:class{
  get(relays,filter){calls.push({relays,kind:filter.kinds[0]});if(calls.length===1)return new Promise(r=>finish=r);if(filter.kinds[0]===10002)return Promise.resolve({tags:[['r','wss://host.example']]});return Promise.resolve({content:JSON.stringify({name:'Noderunners Radio',picture:'https://example.com/avatar.png',banner:'https://example.com/banner.jpg'})});}
  destroy(){destroyed=true;}
 }}};
 vm.createContext(context);vm.runInContext(lookup,context);
 const pending=context.profileImage('host');
 // No directory pool exists: the bounded profile connection owns its lifetime.
 finish(null);assert.equal(await pending,'https://example.com/avatar.png');
 assert.equal(context.profileImages.get('host').name,'Noderunners Radio');
 assert.equal(context.profileImages.get('host').banner,'https://example.com/banner.jpg');
 assert.deepEqual(Array.from(calls[2].relays),['wss://host.example']);assert.equal(destroyed,true);
 assert.equal(await context.profileImage('host'),'https://example.com/avatar.png');assert.equal(calls.length,3);
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
