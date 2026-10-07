const {test}=require('node:test');
const assert=require('node:assert/strict');
const {bookmark}=require('../stream-core');
test('Nostr bookmarks preserve stable addresses rather than event IDs',()=>{
 const key='30311:'+'a'.repeat(64)+':radio:live';
 const saved=bookmark({key,id:'old-event',url:'https://example.com/old.m3u8',title:'Radio',host:'b'.repeat(64),relays:['wss://relay.example']});
 assert.equal(saved.key,key);assert.equal(saved.id,undefined);assert.equal(saved.host,'b'.repeat(64));
 assert.equal(bookmark({...saved,url:'https://example.com/new.m3u8'}).key,key);
});
test('direct bookmarks have canonical URL identity and a default name',()=>{
 const saved=bookmark({url:'https://EXAMPLE.com/video.mp4'});
 assert.equal(saved.key,'url:https://example.com/video.mp4');assert.equal(saved.title,'example.com');assert.equal(saved.host,null);
});
test('bookmark restoration rejects unsafe URLs and normalizes malformed optional fields',()=>{
 for(const url of ['javascript:alert(1)','http://example.com','https://user:pass@example.com'])assert.equal(bookmark({url}),null);
 assert.equal(bookmark(null),null);
 const saved=bookmark({url:'https://example.com',host:'bad',relays:'bad',image:'http://bad',title:'x'.repeat(400)});
 assert.deepEqual(saved.relays,[]);assert.equal(saved.image,null);assert.equal(saved.host,null);assert.equal(saved.title.length,240);
});
