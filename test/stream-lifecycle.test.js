const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Directory,parse,bookmark,encodeBookmarks,decodeBookmarks}=require('../stream-core');
const author='a'.repeat(64);
function event(d,status,time,tags=[]) {
 return {kind:30311,id:String(time)+d,pubkey:author,created_at:time,tags:[['d',d],['status',status],...tags]};
}
test('upcoming includes future start times and announcements without media',()=>{
 const directory=new Directory();
 directory.accept(event('later','planned',900,[['starts','2000']]),1000);
 directory.accept(event('soon','planned',900,[['starts','1100']]),1000);
 directory.accept(event('unknown','planned',900),1000);
 directory.accept(event('missed','planned',900,[['starts','999']]),1000);
 assert.deepEqual(directory.upcoming(1000).map(e=>e.key.split(':').pop()),['soon','later','unknown']);
 assert.equal(directory.upcoming(1000)[0].url,null);
});
test('same-address updates move upcoming to live to past and reject older resurrection',()=>{
 const d=new Directory();
 d.accept(event('show','planned',900,[['starts','1100']]),1000);
 d.accept(event('show','live',1100,[['starts','1100'],['streaming','https://example.com/live.m3u8']]),1100);
 assert.equal(d.upcoming(1100).length,0);assert.equal(d.live(1100).length,1);
 d.accept(event('show','ended',1200,[['starts','1100'],['ends','1200'],['recording','https://example.com/replay.mp4']]),1200);
 d.accept(event('show','live',1100,[['streaming','https://example.com/stale.m3u8']]),1200);
 assert.equal(d.live(1200).length,0);assert.equal(d.past().length,1);
 assert.equal(d.past()[0].recording,'https://example.com/replay.mp4');
});
test('stale live streams never masquerade as finished recordings',()=>{
 const d=new Directory();
 d.accept(event('stale','live',1,[['streaming','https://example.com/live.m3u8']]),5000);
 assert.equal(d.live(5000).length,0);assert.equal(d.past().length,0);
});
test('past streams sort by end time with announcement time as fallback',()=>{
 const d=new Directory();
 d.accept(event('old','ended',999,[['ends','800']]),1000);
 d.accept(event('recent','ended',990,[['ends','950']]),1000);
 d.accept(event('unknown','ended',960),1000);
 assert.deepEqual(d.past().map(e=>e.key.split(':').pop()),['unknown','recent','old']);
 for(const url of ['javascript:alert(1)','http://example.com','https://user:pass@example.com']) {
  assert.equal(parse(event('bad','ended',900,[['recording',url]]),1000).recording,null);
 }
});
test('a scheduled bookmark survives backup before any playback URL exists',()=>{
 const item=parse(event('scheduled','planned',900,[['starts','2000']]),1000);
 const saved=bookmark(item);
 assert.equal(saved.key,item.key);assert.equal(saved.url,null);
 const restored=decodeBookmarks(encodeBookmarks([saved]));
 assert.equal(restored[0].key,item.key);assert.equal(restored[0].url,null);
 assert.equal(bookmark({key:'url:javascript:alert(1)'}),null);
});
test('announced timestamps must be representable as dates',()=>{
 const item=parse(event('bad-date','planned',900,[['starts','9007199254740991']]),1000);
 assert.equal(item.starts,null);
});
test('directory opens recordings instead of expired live URLs and never autoplays upcoming',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
 const fn=source.slice(source.indexOf('  function openDirectoryItem('),source.indexOf('  function drawDirectoryDetails('));
 const played=[];const ctx={Date,model:new Directory(),play:(...args)=>played.push(args),detailItem:null,paint(){},revealContent(){},list:{querySelector(){return null;}}};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 const replay={status:'ended',recording:'https://example.com/replay.mp4',url:'https://example.com/expired.m3u8',title:'Replay',host:author};
 ctx.openDirectoryItem(replay);assert.equal(played[0][0],replay.recording);
 const scheduled={status:'planned',url:'https://example.com/future.m3u8'};
 ctx.openDirectoryItem(scheduled);assert.equal(played.length,1);assert.equal(ctx.detailItem,scheduled);
 ctx.openDirectoryItem({status:'ended',url:'https://example.com/expired.m3u8'});assert.equal(played.length,1);
});
