const {test}=require('node:test');
const assert=require('node:assert/strict');
const {template,Messages}=require('../stream-chat');
const address='30311:'+ 'a'.repeat(64)+':radio';
test('chat uses NIP-53 kind 1311 with stream scope and optional parent',()=>{
 const message=template(address,' hello ',{id:'b'.repeat(64),pubkey:'c'.repeat(64)});
 assert.equal(message.kind,1311);assert.equal(message.content,'hello');assert.deepEqual(message.tags,[['a',address],['e','b'.repeat(64)],['p','c'.repeat(64)]]);
 assert.throws(()=>template('url:https://example.com','hello'));
 assert.throws(()=>template(address,'  '));assert.throws(()=>template(address,'x'.repeat(4001)));
});
test('chat verifies signatures, scopes messages, deduplicates, and sorts by time',()=>{
 const model=new Messages(address),a={...template(address,'hello'),id:'a',created_at:2};
 assert.equal(model.accept(a,()=>false),false);assert.equal(model.accept(a,()=>true),true);assert.equal(model.accept(a,()=>true),false);
 assert.equal(model.accept({...a,id:'wrong',kind:1},()=>true),false);
 assert.equal(model.accept({...a,id:'foreign',tags:[['a',address+'other']]},()=>true),false);
 assert.equal(model.accept({...a,id:'future',created_at:Math.floor(Date.now()/1000)+1000},()=>true),false);
 assert.equal(model.accept({...a,id:'b',created_at:1},()=>true),true);assert.deepEqual(model.rows().map(e=>e.id),['b','a']);
});
const fs=require('node:fs'),vm=require('node:vm');
function accountBridge(){
 const source=fs.readFileSync(require.resolve('../sidepanel.js'),'utf8');
 const bridge=source.slice(source.indexOf('  window.SidecarStreamChatAccount ='),source.indexOf("  window.addEventListener('sidecar-stream-zap'"));
 const signed=[],published=[];const context={window:{SidecarStreamChat:require('../stream-chat'),SidecarStreams:require('../stream-core')},state:{activePubkey:'a',accounts:[]},$:()=>({classList:{contains:()=>true}}),cachedProfile:()=>null,NT:{nip19:{npubEncode:x=>x},verifyEvent:()=>true},postRelays:async()=>['wss://relay.example'],call:async message=>{signed.push(message);return {...message.event,pubkey:message.expectedPubkey};},publishToRelays:async(...args)=>published.push(args),openProfileSheet:(...args)=>{context.profileArgs=args;}};
 vm.runInNewContext(bridge,context);return {context,bridge:context.window.SidecarStreamChatAccount,signed,published};
}
test('chat send pins the active signer and refuses a switch while preparing relays',async()=>{
 const s=accountBridge();await s.bridge.send(template(address,'hi'),[],'a');assert.equal(s.signed[0].expectedPubkey,'a');assert.equal(s.published.length,1);
 s.context.postRelays=async()=>{s.context.state.activePubkey='b';return [];};await assert.rejects(s.bridge.send(template(address,'hi'),[],'a'),/Account changed/);assert.equal(s.signed.length,1);
});
test('chat zaps target the verified message author and event, not the host',()=>{
 const s=accountBridge(),event={...template(address,'hi'),pubkey:'participant',id:'message'};s.bridge.zap(event);assert.equal(s.context.profileArgs[0],'participant');assert.equal(s.context.profileArgs[1].chatEvent,event);assert.equal(s.context.profileArgs[1].streamEvent,undefined);
 s.context.$=()=>({classList:{contains:()=>false}});s.context.profileArgs=null;s.bridge.zap(event);assert.equal(s.context.profileArgs,null);
});
test('history distinguishes offline relays from a genuinely empty response',async()=>{
 const {readPage}=require('../stream-chat');
 const pool={subscribeMany([relay],filter,handlers){queueMicrotask(()=>relay==='offline'?handlers.onclose():handlers.oneose());return {close(){}};}};
 const empty=await readPage(pool,['empty'],{},null,50);assert.equal(empty.complete,true);assert.equal(empty.events.length,0);
 const partial=await readPage(pool,['empty','offline'],{},null,50);assert.equal(partial.complete,false);assert.equal(partial.answered,1);
});
test('history retains events on failure and deduplicates across archive relays',async()=>{
 const {readPage}=require('../stream-chat');
 const pool={subscribeMany([relay],filter,h){queueMicrotask(()=>{h.onevent({id:'shared'});if(relay==='archive')h.onevent({id:'archive-only'});relay==='offline'?h.onclose():h.oneose();});return {close(){}};}};
 const page=await readPage(pool,['archive','offline'],{},null,50);assert.equal(page.complete,false);assert.deepEqual(page.events.map(e=>e.id),['shared','archive-only']);
});
test('history abort closes its subscription and reports incomplete',async()=>{
 const {readPage}=require('../stream-chat');let closed=0;const c=new AbortController();
 const pool={subscribeMany(){queueMicrotask(()=>c.abort());return {close(){closed++;}};}};
 const page=await readPage(pool,['relay'],{},c.signal,50);assert.equal(page.complete,false);assert.equal(closed,1);
});

test('chat content resolves references and links without treating markup as HTML',()=>{
 const {contentParts}=require('../stream-chat');
 const vm=require('node:vm'),fs=require('node:fs');
 const ctx={TextEncoder,TextDecoder,Uint8Array,URL};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../nostr-tools'),'utf8'),ctx);const NT=ctx.NostrTools;
 const pubkey='a'.repeat(64),npub=NT.nip19.npubEncode(pubkey),note=NT.nip19.noteEncode('b'.repeat(64));
 const parts=contentParts('<script> hi nostr:'+npub+' '+note+' #NostrForever https://example.com/path?q=yes.',NT.nip19.decode);
 assert.equal(parts.find(p=>p.pubkey)?.pubkey,pubkey);
 assert.equal(parts.find(p=>p.type==='note')?.entity,note);
 assert.equal(parts.find(p=>p.hashtag)?.hashtag,'NostrForever');
 assert.equal(parts.find(p=>p.href)?.href,'https://example.com/path?q=yes');
 assert.equal(parts.at(-1).text,'.');
 assert.ok(parts[0].text.includes('<script>'));
 assert.equal(contentParts('javascript:alert(1) <img onerror=x>',NT.nip19.decode).some(p=>p.href),false);
});

test('chat opens with the newest bounded page across messages and a year of zaps',()=>{
 const {recentRows}=require('../stream-chat');
 const archive=Array.from({length:865},(_,i)=>({id:'zap'+i,created_at:i,kind:9735}));
 const message={id:'latest-message',created_at:1000,kind:1311};
 const rows=recentRows([message],archive);
 assert.equal(rows.length,50);
 assert.equal(rows[0],message);
 assert.equal(rows[1].id,'zap864');
 assert.equal(rows.at(-1).id,'zap816');
 assert.equal(recentRows([message],archive,100).length,100);
 assert.equal(recentRows([message,message],archive)[0],message);
 assert.ok(rows.every((e,i)=>i===0 || rows[i-1].created_at>=e.created_at));
});

test('chat mentions add deduplicated notification tags while preserving the reply target',()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const ctx={TextEncoder,TextDecoder,Uint8Array,URL};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../nostr-tools'),'utf8'),ctx);
 const NT=ctx.NostrTools,person='b'.repeat(64),other='c'.repeat(64);
 const text='Watching with nostr:'+NT.nip19.npubEncode(person)+' and nostr:'+NT.nip19.nprofileEncode({pubkey:other})+' nostr:'+NT.nip19.npubEncode(person);
 const event=template(address,text,{id:'d'.repeat(64),pubkey:person},NT.nip19.decode);
 assert.equal(event.kind,1311);assert.equal(event.content,text);
 assert.deepEqual(event.tags.filter(t=>t[0]==='p'),[['p',person],['p',other]]);
 assert.deepEqual(event.tags.find(t=>t[0]==='e'),['e','d'.repeat(64)]);
});

function sendView(fail=false){
 const source=fs.readFileSync(require.resolve('../stream-chat'),'utf8');
 const handler=source.slice(source.indexOf('    form.onsubmit='),source.indexOf("    root.addEventListener('sidecar-chat-account'"));
 const signed={...template(address,'hello'),pubkey:'author',id:'sent'};
 const context={form:{},run:1,account:'author',busy:false,reply:null,model:new Messages(address),syncAccount:()=>({pubkey:'author'}),allowed:()=>true,draftText:()=>context.draft,bridge:()=>({send:async()=>{if(fail)throw Error('offline');return signed;}}),template,sources:()=>[],NostrTools:{verifyEvent:()=>true},clearDraft:()=>context.draft='',mentionEditor:null,clearReply:()=>{},paint:()=>context.painted=context.model.rows(),setNotice:(text,duration)=>context.status={text,duration},revealLatest:()=>context.atBottom=true,input:{focus:()=>{}},t:x=>x,draft:'hello',atBottom:false};
 vm.runInNewContext(handler,context);return context;
}
test('successful send renders locally and reveals the latest post without a relay echo',async()=>{
 const s=sendView();await s.form.onsubmit({preventDefault(){}});
 assert.equal(s.painted.at(-1).content,'hello');assert.equal(s.atBottom,true);assert.equal(s.draft,'');
 assert.deepEqual(s.status,{text:'Sent',duration:2500});
});
test('failed send preserves the draft and shows temporary composer feedback',async()=>{
 const s=sendView(true);await s.form.onsubmit({preventDefault(){}});
 assert.equal(s.draft,'hello');assert.equal(s.atBottom,false);assert.equal(s.model.rows().length,0);assert.equal(s.status.duration,7000);
});
