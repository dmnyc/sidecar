const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
async function setup(storage, i18n){
 const els=new Map();const observers=[];const nodes=[];
 function el(){const flags=new Set(),attrs=new Map();const node={childNodes:[],hidden:false,textContent:'',value:'',style:{setProperty(){}},classList:{add(...xs){xs.forEach(x=>flags.add(x));},remove(...xs){xs.forEach(x=>flags.delete(x));},contains(x){return flags.has(x);},toggle(x,on){on=on??!flags.has(x);on?flags.add(x):flags.delete(x);return on;}},events:{},addEventListener(n,f){this.events[n]=f;},setAttribute(k,v){attrs.set(k,String(v));},getAttribute(k){return attrs.get(k) ?? null;},removeAttribute(n){attrs.delete(n);delete this[n];},getBoundingClientRect(){return {height:42,width:this.width ?? 360};},replaceChildren(...children){this.childNodes=children;},append(...children){this.childNodes.push(...children);},get children(){return this.childNodes;},insertBefore(child,before){const at=this.childNodes.indexOf(before);this.childNodes.splice(at<0?this.childNodes.length:at,0,child);},querySelector(){return el();},play(){this.plays++;return Promise.resolve();},pause(){this.pauses++;},load(){this.loads++;},canPlayType(){return 'probably';},plays:0,pauses:0,loads:0};nodes.push(node);return node;}
 const get=id=>{if(!els.has(id))els.set(id,el());return els.get(id);};
 get('view-approval').classList.add('hidden');get('view-lock').classList.add('hidden');
 const context={SidecarI18n:i18n || require('./helpers/i18n').englishI18n(),SidecarStreams:require('../stream-core'),document:{getElementById:get,documentElement:el(),createElement:el,createElementNS:el},ResizeObserver:class{observe(){}},MutationObserver:class{constructor(f){observers.push(f);}observe(){}},window:{addEventListener(){}},setInterval,clearInterval,setTimeout,clearTimeout,URL};
 if(storage)context.chrome={storage:{local:{get:()=>storage.read},onChanged:{addListener:f=>storage.changed=f}}};
 await vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8'),context);
 return {get,nodes,lock(on){get('view-lock').classList.toggle('hidden',!on);observers.forEach(f=>f());},approval(on){get('view-approval').classList.toggle('hidden',!on);observers.forEach(f=>f());},start(){get('stream-url').value='https://example.com/live.mp4';get('stream-form').events.submit({preventDefault(){}});}};
}
test('approval and expansion preserve the playing video session',async()=>{const s=await setup();s.start();const v=s.get('stream-video');const loads=v.loads,pauses=v.pauses;s.approval(true);s.approval(false);s.get('stream-expand').events.click();s.get('stream-expand').events.click();assert.equal(v.loads,loads);assert.equal(v.pauses,pauses);assert.equal(v.src,'https://example.com/live.mp4');});
test('explicit stop releases the source and pauses playback',async()=>{const s=await setup();s.start();s.get('stream-stop').events.click();assert.equal(s.get('stream-video').src,undefined);assert.equal(s.get('stream-video').hidden,true);});

test('saved disabled preference hides the dock and blocks playback after startup',async()=>{
 const storage={read:Promise.resolve({sidecar_settings:{liveVideoEnabled:false}})};const s=await setup(storage);await storage.read;
 s.start();assert.equal(s.get('stream-dock').hidden,true);assert.equal(s.get('stream-video').plays,0);
});
test('disabling from another panel stops playback; enabling does not resume it',async()=>{
 const storage={read:Promise.resolve({sidecar_settings:{liveVideoEnabled:true}})};const s=await setup(storage);await storage.read;s.start();
 storage.changed({sidecar_settings:{newValue:{liveVideoEnabled:false}}},'local');
 assert.equal(s.get('stream-video').src,undefined);assert.equal(s.get('stream-dock').hidden,true);assert.equal(s.get('stream-directory').hidden,true);
 const plays=s.get('stream-video').plays;
 storage.changed({sidecar_settings:{newValue:{liveVideoEnabled:true}}},'local');
 assert.equal(s.get('stream-dock').hidden,true);assert.equal(s.get('stream-entry').hidden,false);assert.equal(s.get('stream-video').plays,plays);assert.equal(s.get('stream-video').hidden,true);
});
test('a stale initial read cannot override a newer disabled preference',async()=>{
 let resolve;const storage={read:new Promise(r=>resolve=r)};const s=await setup(storage);
 storage.changed({sidecar_settings:{newValue:{liveVideoEnabled:false}}},'local');resolve({sidecar_settings:{liveVideoEnabled:true}});await storage.read;
 assert.equal(s.get('stream-dock').hidden,true);
});
test('the local settings toggle immediately stops playback',async()=>{
 const s=await setup();s.start();const toggle=s.get('livevideo-toggle');toggle.checked=false;toggle.events.change();
 assert.equal(s.get('stream-video').src,undefined);assert.equal(s.get('stream-dock').hidden,true);
});

test('locking hides browsing while preserving the existing stream',async()=>{
 const s=await setup();s.start();const v=s.get('stream-video');const loads=v.loads;
 s.get('stream-directory').hidden=false;s.lock(true);
 assert.equal(s.get('stream-directory').hidden,true);assert.equal(s.get('stream-browse').disabled,true);
 assert.equal(v.loads,loads);assert.equal(v.src,'https://example.com/live.mp4');
 s.get('stream-browse').events.click();assert.equal(s.get('stream-directory').hidden,true);
 s.get('stream-stop').events.click();assert.equal(s.get('stream-dock').hidden,true);
 s.start();assert.equal(v.src,undefined);s.lock(false);assert.equal(s.get('stream-dock').hidden,true);
});

test('picture in picture collapses the dock without restarting playback',async()=>{
 const s=await setup();s.start();const v=s.get('stream-video');const loads=v.loads;
 v.events.enterpictureinpicture();assert.equal(s.get('stream-dock').classList.contains('stream-pip'),true);
 assert.equal(v.loads,loads);assert.equal(v.src,'https://example.com/live.mp4');
 v.events.leavepictureinpicture();assert.equal(s.get('stream-dock').classList.contains('stream-pip'),false);
 assert.equal(v.loads,loads);
});

test('zap digits animate only when requested and replay on a later arrival',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
 const fn=source.slice(source.indexOf('  function setZapDigits('),source.indexOf('  function shineZap('));
 const classes=new Set();let reflows=0;
 const output={children:[],classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)},replaceChildren(){this.children=[];},appendChild(c){this.children.push(c);},get offsetHeight(){reflows++;return 12;}};
 const context={document:{createElement:()=>({dataset:{},setAttribute(){}})}};
 vm.createContext(context);vm.runInContext(fn,context);
 context.setZapDigits(output,'1.2k',false);assert.equal(classes.has('is-animating'),false);assert.equal(reflows,0);
 context.setZapDigits(output,'1.3k',true);assert.equal(classes.has('is-animating'),true);assert.equal(reflows,1);assert.equal(output.children.map(c=>c.textContent).join(''),'1.3k');
 context.setZapDigits(output,'1.4k',true);assert.equal(reflows,2);
 context.setZapDigits(output,'2k',false);assert.equal(classes.has('is-animating'),false);
});

test('feed caret appears for playback and hides while locked or approving',async()=>{
 const s=await setup();const caret=s.get('stream-feed-toggle');assert.equal(caret.hidden,true);
 s.start();assert.equal(caret.hidden,false);
 s.lock(true);assert.equal(caret.hidden,true);s.lock(false);assert.equal(caret.hidden,false);
 s.approval(true);assert.equal(caret.hidden,true);s.approval(false);assert.equal(caret.hidden,false);
 s.get('stream-stop').events.click();assert.equal(caret.hidden,true);
});


test('expand is available only in wide panels and collapses when narrowed',async()=>{
 const s=await setup();s.start();assert.equal(s.get('stream-expand').hidden,true);
 s.get('stream-dock').width=600;s.approval(false);assert.equal(s.get('stream-expand').hidden,false);
 s.get('stream-expand').events.click();assert.equal(s.get('stream-dock').classList.contains('stream-expanded'),true);
 s.get('stream-dock').width=360;s.approval(false);assert.equal(s.get('stream-expand').hidden,true);assert.equal(s.get('stream-dock').classList.contains('stream-expanded'),false);
});

test('zap gleam restarts on arrival and clears when finished or stopped',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
 const fn=source.slice(source.indexOf('  function shineZap('),source.indexOf('  async function watchZaps('));
 const s=await setup();const bolt=s.get('stream-zap');let reflows=0;
 Object.defineProperty(bolt,'offsetHeight',{get(){reflows++;return 32;}});
 const context={document:{getElementById:s.get}};vm.createContext(context);vm.runInContext(fn,context);
 context.shineZap();assert.equal(bolt.classList.contains('is-shining'),true);
 context.shineZap();assert.equal(reflows,2);
 bolt.events.animationend();assert.equal(bolt.classList.contains('is-shining'),false);
 context.shineZap();s.get('stream-stop').events.click();assert.equal(bolt.classList.contains('is-shining'),false);
});

test('stream controls wait for locale loading before mounting their permanent labels', async () => {
 const I18N=require('./helpers/i18n').englishI18n();await I18N.ready;
 let release;const ready=new Promise(resolve=>{release=resolve;});
 let mounted=false;
 const pending=setup(null,{...I18N,ready}).then(value=>{mounted=true;return value;});
 await Promise.resolve();assert.equal(mounted,false);
 I18N.setLocale('de',[{'Save to account':'Im Konto speichern'}]);release();
 const s=await pending;
 assert.ok(s.nodes.some(node=>node.getAttribute('aria-label')==='Im Konto speichern' && node.title==='Im Konto speichern'));
 assert.equal(mounted,true);s.start();assert.equal(s.get('stream-video').plays,1);
});
