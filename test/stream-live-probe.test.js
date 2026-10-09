const {test}=require('node:test'),assert=require('node:assert/strict');
const {advancingPlaylist,Directory}=require('../stream-core');
const playlist=n=>`#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:${n}\n#EXTINF:4,\nsegment.ts\n`;
const response=(body,url='https://media.example/live.m3u8')=>({ok:true,url,text:async()=>body});
test('only an advancing playlist verifies stale announcements',async()=>{
 let n=10;assert.equal(await advancingPlaylist('https://media.example/live.m3u8',null,async()=>response(playlist(n++)),async()=>{}),true);
 assert.equal(await advancingPlaylist('https://media.example/live.m3u8',null,async()=>response(playlist(10)),async()=>{}),false);
 assert.equal(await advancingPlaylist('https://media.example/live.m3u8',null,async()=>response(playlist(10)+'#EXT-X-ENDLIST'),async()=>{}),false);
});
test('master playlists resolve a variant without downloading video segments',async()=>{
 const calls=[];let n=4;
 const request=async(url,options)=>{calls.push(url);assert.equal(options.credentials,'omit');return response(calls.length===1?'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nchild.m3u8':playlist(n++),url);};
 assert.equal(await advancingPlaylist('https://media.example/master.m3u8',null,request,async()=>{}),true);
 assert.deepEqual(calls,['https://media.example/master.m3u8','https://media.example/child.m3u8','https://media.example/child.m3u8']);
});
test('unsafe variants, non-HLS, unavailable streams and canceled probes stay excluded',async()=>{
 for(const body of ['html','#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttp://insecure.example/live'])
 assert.equal(await advancingPlaylist('https://media.example/live',null,async()=>response(body),async()=>{}),false);
 assert.equal(await advancingPlaylist('https://media.example/live',null,async()=>{throw Error('offline');},async()=>{}),false);
 const controller=new AbortController();controller.abort();let called=false;
 assert.equal(await advancingPlaylist('https://media.example/live',controller.signal,async()=>{called=true;}),false);assert.equal(called,false);
});
test('verified streams expire, deduplicate URLs, and cannot override ended events',()=>{
 const d=new Directory(),pubkey='a'.repeat(64),url='https://media.example/live';
 const event=(id,status,created_at)=>({kind:30311,id,pubkey,created_at,tags:[['d',id],['status',status],['streaming',url]]});
 d.accept(event('old','live',100),10000);assert.equal(d.live(10000).length,0);
 d.verified.set(url,10000);assert.equal(d.live(10001).length,1);assert.equal(d.live(10181).length,0);
 d.accept(event('new','live',9999),10000);assert.equal(d.live(10000).length,1);assert.equal(d.live(10000)[0].id,'new');
 d.accept(event('old','ended',10001),10001);d.accept(event('new','ended',10001),10001);assert.equal(d.live(10001).length,0);
});
