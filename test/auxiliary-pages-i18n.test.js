const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {withI18n}=require('./helpers/i18n');
function fixture(){
 class Node {
  constructor(){this.children=[];this.dataset={};this.style={};this.classList={add(){},remove(){}};this.textContent='';}
  appendChild(n){this.children.push(n);}replaceChildren(...nodes){this.children=nodes;}addEventListener(){}
 }
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
 const ctx=withI18n({document:{getElementById:get,createElement:()=>new Node(),querySelectorAll:()=>[]},console});
 let release;const ready=new Promise(resolve=>release=resolve);ctx.SidecarI18n={...ctx.SidecarI18n,ready};ctx.window=ctx;ctx.addEventListener=()=>{};
 return {ctx,get,release};
}
test('wallet catalog waits for its locale and translates descriptions and controls at render time',async()=>{
 const f=fixture();await f.ctx.I18N.ready;vm.runInNewContext(fs.readFileSync(require.resolve('../wallets'),'utf8'),f.ctx);
 assert.equal(f.get('grid').children.length,0);
 f.ctx.SidecarI18n.setLocale('en-XB',[{'Get this wallet →':'Wallet action translated','Custodial':'Custody translated'}]);
 f.release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.get('grid').children.length,8);
 const cards=f.get('grid').children;
 assert.ok(cards.every(card=>card.children.at(-1).textContent==='Wallet action translated'));
 assert.equal(cards[3].children[1].textContent,'Custody translated');
 assert.equal(cards[0].children[0].children[1].children[0].textContent,'Alby Hub');
});
test('QR scanner waits for translations before requesting the camera and translates denial',async()=>{
 const f=fixture();await f.ctx.I18N.ready;let requests=0;
 f.ctx.navigator={mediaDevices:{getUserMedia:async()=>{requests++;throw {name:'NotAllowedError'};}}};
 // The scanner reads its own query string now (?mode=address), so the stub
 // browser gets a location like the stream test's does.
 f.ctx.location={search:''};
 vm.runInNewContext(fs.readFileSync(require.resolve('../scan-qr'),'utf8'),f.ctx);
 assert.equal(requests,0);
 const key='Camera access was denied. Close this and use "Choose file" instead.';
 f.ctx.SidecarI18n.setLocale('en-XB',[{[key]:'Camera denial translated'}]);
 f.release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,1);assert.equal(f.get('scanq-status').textContent,'Camera denial translated');
});

test('stream review applies pseudo-locale and static labels after locale startup', async () => {
 const f=fixture();await f.ctx.I18N.ready;
 let applied='';
 f.ctx.SidecarI18n.applyDom=()=>{applied=f.ctx.I18N.lang;};
 f.ctx.URLSearchParams=URLSearchParams;f.ctx.location={search:'?pseudo=1'};
 vm.runInNewContext(fs.readFileSync(require.resolve('../docs/streaming/locale'),'utf8'),f.ctx);
 assert.equal(applied,'');
 f.release();await f.ctx.SidecarI18n.ready;
 assert.equal(f.ctx.I18N.lang,'en-XA');assert.equal(applied,'en-XA');
});
