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

test('backup payload round trips safe bookmarks and merges without deleting local saves',()=>{
 const {encodeBookmarks,decodeBookmarks,mergeBookmarks}=require('../stream-core');
 const local=bookmark({url:'https://example.com/local',title:'Local'}),remote=bookmark({url:'https://example.com/remote'});
 assert.deepEqual(decodeBookmarks(encodeBookmarks([local])),[local]);
 assert.deepEqual(mergeBookmarks([local],[remote,{...local,title:'Old'}]),[remote,local]);
 assert.throws(()=>decodeBookmarks('{"version":2,"streams":[]}'));
 assert.throws(()=>decodeBookmarks('{"version":1,"streams":[{"url":"javascript:alert(1)"}]}'));
 assert.throws(()=>encodeBookmarks(Array.from({length:201},(_,i)=>({url:'https://example.com/'+i}))));
});
function syncBridge(){
 const fs=require('node:fs'),vm=require('node:vm');const source=fs.readFileSync(require.resolve('../sidepanel'),'utf8');
 const code=source.slice(source.indexOf('  window.SidecarStreamBookmarks ='),source.indexOf("  window.addEventListener('sidecar-stream-zap'"));
 const calls=[],published=[],context={window:{SidecarStreams:require('../stream-core'),SidecarStreamChatAccount:{identity:()=>({pubkey:context.account})}},account:'a',postRelays:async()=>['relay'],backupReadRelays:async()=>['relay'],poolGet:async()=>context.remote,NT:{verifyEvent:()=>context.valid!==false},call:async m=>{calls.push(m);if(m.type==='SIDECAR_OWNER_ENCRYPT')return 'encrypted';if(m.type==='SIDECAR_OWNER_DECRYPT')return context.plaintext;return {...m.event,pubkey:m.expectedPubkey};},publishToRelays:async(...args)=>published.push(args)};
 vm.runInNewContext(code,context);return {context,calls,published,bridge:context.window.SidecarStreamBookmarks};
}
test('stream backups encrypt before publishing and pin the signing account',async()=>{
 const s=syncBridge();await s.bridge.save([{url:'https://example.com/live'}],'a');
 assert.equal(s.calls[0].nip,44);assert.equal(s.calls[0].peer,'a');assert.equal(s.calls[1].event.kind,30078);assert.equal(s.calls[1].event.content,'encrypted');assert.equal(s.calls[1].expectedPubkey,'a');assert.equal(s.published.length,1);
 s.context.postRelays=async()=>{s.context.account='b';return [];};await assert.rejects(s.bridge.save([],'a'),/Account changed/);assert.equal(s.published.length,1);
});
test('stream restore rejects foreign or unverified events and never decrypts them',async()=>{
 const s=syncBridge();s.context.remote={kind:30078,pubkey:'b',tags:[['d','sidecar:stream-bookmarks'],['encryption','nip44']],content:'encrypted',created_at:1};
 await assert.rejects(s.bridge.restore('a'),/Invalid/);assert.equal(s.calls.length,0);
 s.context.remote.pubkey='a';s.context.valid=false;await assert.rejects(s.bridge.restore('a'),/Invalid/);assert.equal(s.calls.length,0);
 s.context.valid=true;s.context.plaintext=JSON.stringify({version:1,streams:[{url:'https://example.com/live'}]});assert.equal((await s.bridge.restore('a'))[0].url,'https://example.com/live');
});

test('backup round trip uses real NIP-44 encryption and a verified kind-30078 signature',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
 const ctx={TextEncoder,TextDecoder,URL,crypto:crypto.webcrypto,Uint8Array,Object,Array};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../nostr-tools.js'),'utf8'),ctx);
 const nt=ctx.NostrTools,secret=nt.generateSecretKey(),pubkey=nt.getPublicKey(secret),conversation=nt.nip44.v2.utils.getConversationKey(secret,pubkey),s=syncBridge();
 s.context.account=pubkey;s.context.NT=nt;
 s.context.call=async m=>{
  assert.equal(m.expectedPubkey,pubkey);
  if(m.type==='SIDECAR_OWNER_ENCRYPT')return nt.nip44.v2.encrypt(m.plaintext,conversation);
  if(m.type==='SIDECAR_OWNER_DECRYPT')return nt.nip44.v2.decrypt(m.ciphertext,conversation);
  return nt.finalizeEvent(JSON.parse(JSON.stringify(m.event)),secret);
 };
 s.context.publishToRelays=async(_,event)=>{assert.equal(nt.verifyEvent(event),true);s.context.remote=event;};
 const items=[{url:'https://example.com/live',title:'Private saved stream'}];await s.bridge.save(items,pubkey);
 assert.equal(s.context.remote.content.includes('example.com'),false);assert.equal(s.context.remote.kind,30078);
 const restored=await s.bridge.restore(pubkey);assert.equal(restored.length,1);assert.equal(restored[0].title,items[0].title);assert.equal(restored[0].url,items[0].url);
 const other=nt.generateSecretKey(),wrongKey=nt.nip44.v2.utils.getConversationKey(other,nt.getPublicKey(other));
 assert.throws(()=>nt.nip44.v2.decrypt(s.context.remote.content,wrongKey));
});
