const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const vm=require('node:vm');
const fs=require('node:fs');
const {ZapTotals,invoiceDetails}=require('../stream-core');
const ctx={TextEncoder,TextDecoder,URL,crypto:crypto.webcrypto,Uint8Array,Object,Array};vm.createContext(ctx);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../nostr-tools.js'),'utf8'),ctx);
const NT=ctx.NostrTools;
const sender=NT.generateSecretKey(), server=NT.generateSecretKey();
const recipient='a'.repeat(64),address='30311:'+recipient+':show';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function invoice(description,hash='12'.repeat(32)) {
 const alphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
 const words=hex=>{let bits=0,value=0;const out=[];for(const b of Buffer.from(hex,'hex')){value=(value<<8)|b;bits+=8;while(bits>=5){bits-=5;out.push((value>>>bits)&31);}}if(bits)out.push((value<<(5-bits))&31);return out;};
 const data=[...Array(7).fill(0),1,1,20,...words(hash),23,1,20,...words(digest(description)),...Array(104).fill(0)];
 const prefix='lnbc210n';let chk=1;
 const step=v=>{const top=chk>>>25;chk=((chk&0x1ffffff)<<5)^v;[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3].forEach((g,i)=>{if((top>>>i)&1)chk^=g;});};
 for(const c of prefix)step(c.charCodeAt(0)>>>5);step(0);for(const c of prefix)step(c.charCodeAt(0)&31);for(const w of data)step(w);for(let i=0;i<6;i++)step(0);chk^=1;
 return prefix+'1'+[...data,...Array.from({length:6},(_,i)=>(chk>>>(5*(5-i)))&31)].map(w=>alphabet[w]).join('');
}
function receipt(requestTags=[],receiptTags=[],time=1) {
 const request=NT.finalizeEvent({kind:9734,created_at:1,content:'',tags:[['p',recipient],['a',address],...requestTags]},sender);
 const description=JSON.stringify(request);
 return NT.finalizeEvent({kind:9735,created_at:time,content:'',tags:[['p',recipient],['a',address],['description',description],['bolt11',invoice(description)],...receiptTags]},server);
}
const opts={address,recipient,provider:NT.getPublicKey(server),verify:e=>NT.verifyEvent(e),digest};
test('counts verified receipts using invoice amount, including requests without amount',async()=>{const total=new ZapTotals();assert.equal(await total.accept(receipt(),opts),true);assert.equal(total.msats,21000);assert.equal(total.count,1);});
test('deduplicates across relays and distinct receipts for the same invoice',async()=>{const total=new ZapTotals();await Promise.all([total.accept(receipt(),opts),total.accept(receipt([],[],2),opts)]);assert.equal(total.count,1);});
test('rejects wrong provider, event, recipient and mismatched amounts',async()=>{for(const override of [{provider:'b'.repeat(64)},{address:address+'other'},{recipient:'b'.repeat(64)}])assert.equal(await new ZapTotals().accept(receipt(),{...opts,...override}),false);assert.equal(await new ZapTotals().accept(receipt([['amount','22000']]),opts),false);});
test('rejects duplicate linkage tags and altered invoice checksums',async()=>{assert.equal(await new ZapTotals().accept(receipt([], [['a',address]]),opts),false);const inv=invoice('test');assert.equal(invoiceDetails(inv).msats,21000);assert.equal(invoiceDetails(inv.slice(0,-1)+(inv.endsWith('q')?'p':'q')),null);});
test('rejects signed receipt with invoice bound to a different request',async()=>{const e=receipt();e.tags=e.tags.map(t=>t[0]==='bolt11'?['bolt11',invoice('different')]:t);const signed=NT.finalizeEvent({kind:e.kind,created_at:e.created_at,content:e.content,tags:e.tags},server);assert.equal(await new ZapTotals().accept(signed,opts),false);});
