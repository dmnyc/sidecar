const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const lookup=source.slice(source.indexOf('  function profileImage('),source.indexOf('  const PAGE_SIZE'));
test('profile lookup survives directory shutdown and reads declared relays on a miss',async()=>{
 let finish;let destroyed=false;const calls=[];
 const context={profileImages:new Map(),enabled:true,isLocked:()=>false,relays:['wss://default.example'],SidecarStreams:require('../stream-core'),NostrTools:{SimplePool:class{
  get(relays,filter){calls.push({relays,kind:filter.kinds[0]});if(calls.length===1)return new Promise(r=>finish=r);if(filter.kinds[0]===10002)return Promise.resolve({tags:[['r','wss://host.example']]});return Promise.resolve({content:JSON.stringify({name:'Noderunners Radio',picture:'https://example.com/avatar.png'})});}
  destroy(){destroyed=true;}
 }}};
 vm.createContext(context);vm.runInContext(lookup,context);
 const pending=context.profileImage('host');
 // No directory pool exists: the bounded profile connection owns its lifetime.
 finish(null);assert.equal(await pending,'https://example.com/avatar.png');
 assert.equal(context.profileImages.get('host').name,'Noderunners Radio');
 assert.deepEqual(Array.from(calls[2].relays),['wss://host.example']);assert.equal(destroyed,true);
 assert.equal(await context.profileImage('host'),'https://example.com/avatar.png');assert.equal(calls.length,3);
});
