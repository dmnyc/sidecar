const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const core=fs.readFileSync(require.resolve('../composer-core'),'utf8');
const panel=fs.readFileSync(require.resolve('../sidepanel'),'utf8');
function harness(){
 const source=core.slice(core.indexOf('  const VIEW_CLIENTS ='),core.indexOf('  // ---- the review window',core.indexOf('  const VIEW_CLIENTS =')));
 let settings={defaultClient:'jumble'},account='alice';const opened=[];
 const ctx={URLSearchParams,encodeURIComponent};vm.createContext(ctx);
 vm.runInContext(source+'\nthis.clients=VIEW_CLIENTS;this.resolve=resolveClient;',ctx);
 ctx.VIEW_CLIENTS=ctx.clients;ctx.preferredClient=async()=>ctx.resolve(settings,account);ctx.openInClient=async url=>opened.push(url);
 const methods=panel.slice(panel.indexOf('    hashtagUrl: async function'),panel.indexOf('    profile(pubkey)',panel.indexOf('    hashtagUrl: async function')));
 vm.runInContext('this.bridge={'+methods+'};',ctx);
 return {bridge:ctx.bridge,opened,set:(s,a)=>{settings=s;account=a;}};
}
test('stream hashtags follow Jumble and encode the tag as one query value',async()=>{
 const h=harness();await h.bridge.openHashtag('Nostr&Music');
 assert.equal(h.opened[0],'https://jumble.social/notes?t=nostr%26music');
 assert.equal(await h.bridge.hashtagUrl('Nostr'),'https://jumble.social/notes?t=nostr');
});
test('stream hashtag destination is resolved again after account or setting changes',async()=>{
 const h=harness();h.set({defaultClient:'primal',defaultClientBy:{alice:'jumble'}},'alice');
 await h.bridge.openHashtag('Nostr');
 h.set({defaultClient:'primal',defaultClientBy:{alice:'jumble'}},'bob');await h.bridge.openHashtag('Nostr');
 h.set({defaultClient:'jumble'},'bob');await h.bridge.openHashtag('Nostr');
 assert.deepEqual(h.opened,['https://jumble.social/notes?t=nostr','https://primal.net/search/%23Nostr','https://jumble.social/notes?t=nostr']);
});
