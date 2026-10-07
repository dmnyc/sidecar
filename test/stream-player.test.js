const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function setup(storage){
 const els=new Map();const observers=[];
 function el(){const flags=new Set();return {hidden:false,textContent:'',value:'',style:{setProperty(){}},classList:{add(...xs){xs.forEach(x=>flags.add(x));},remove(...xs){xs.forEach(x=>flags.delete(x));},contains(x){return flags.has(x);},toggle(x,on){on=on??!flags.has(x);on?flags.add(x):flags.delete(x);return on;}},events:{},addEventListener(n,f){this.events[n]=f;},setAttribute(){},removeAttribute(n){delete this[n];},getBoundingClientRect(){return {height:42,width:this.width ?? 360};},replaceChildren(){},append(){},play(){this.plays++;return Promise.resolve();},pause(){this.pauses++;},load(){this.loads++;},canPlayType(){return 'probably';},plays:0,pauses:0,loads:0};}
 const get=id=>{if(!els.has(id))els.set(id,el());return els.get(id);};
 get('view-approval').classList.add('hidden');get('view-lock').classList.add('hidden');
 const context={SidecarI18n:{t:x=>x},SidecarStreams:require('../stream-core'),document:{getElementById:get,documentElement:el(),createElement:el},ResizeObserver:class{observe(){}},MutationObserver:class{constructor(f){observers.push(f);}observe(){}},window:{addEventListener(){}},setInterval,clearInterval,setTimeout,clearTimeout,URL};
 if(storage)context.chrome={storage:{local:{get:()=>storage.read},onChanged:{addListener:f=>storage.changed=f}}};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8'),context);
 return {get,lock(on){get('view-lock').classList.toggle('hidden',!on);observers.forEach(f=>f());},approval(on){get('view-approval').classList.toggle('hidden',!on);observers.forEach(f=>f());},start(){get('stream-url').value='https://example.com/live.mp4';get('stream-form').events.submit({preventDefault(){}});}};
}
test('approval and expansion preserve the playing video session',()=>{const s=setup();s.start();const v=s.get('stream-video');const loads=v.loads,pauses=v.pauses;s.approval(true);s.approval(false);s.get('stream-expand').events.click();s.get('stream-expand').events.click();assert.equal(v.loads,loads);assert.equal(v.pauses,pauses);assert.equal(v.src,'https://example.com/live.mp4');});
test('explicit stop releases the source and pauses playback',()=>{const s=setup();s.start();s.get('stream-stop').events.click();assert.equal(s.get('stream-video').src,undefined);assert.equal(s.get('stream-video').hidden,true);});

test('saved disabled preference hides the dock and blocks playback after startup',async()=>{
 const storage={read:Promise.resolve({sidecar_settings:{liveVideoEnabled:false}})};const s=setup(storage);await storage.read;
 s.start();assert.equal(s.get('stream-dock').hidden,true);assert.equal(s.get('stream-video').plays,0);
});
test('disabling from another panel stops playback; enabling does not resume it',async()=>{
 const storage={read:Promise.resolve({sidecar_settings:{liveVideoEnabled:true}})};const s=setup(storage);await storage.read;s.start();
 storage.changed({sidecar_settings:{newValue:{liveVideoEnabled:false}}},'local');
 assert.equal(s.get('stream-video').src,undefined);assert.equal(s.get('stream-dock').hidden,true);assert.equal(s.get('stream-directory').hidden,true);
 const plays=s.get('stream-video').plays;
 storage.changed({sidecar_settings:{newValue:{liveVideoEnabled:true}}},'local');
 assert.equal(s.get('stream-dock').hidden,true);assert.equal(s.get('stream-entry').hidden,false);assert.equal(s.get('stream-video').plays,plays);assert.equal(s.get('stream-video').hidden,true);
});
test('a stale initial read cannot override a newer disabled preference',async()=>{
 let resolve;const storage={read:new Promise(r=>resolve=r)};const s=setup(storage);
 storage.changed({sidecar_settings:{newValue:{liveVideoEnabled:false}}},'local');resolve({sidecar_settings:{liveVideoEnabled:true}});await storage.read;
 assert.equal(s.get('stream-dock').hidden,true);
});
test('the local settings toggle immediately stops playback',()=>{
 const s=setup();s.start();const toggle=s.get('livevideo-toggle');toggle.checked=false;toggle.events.change();
 assert.equal(s.get('stream-video').src,undefined);assert.equal(s.get('stream-dock').hidden,true);
});

test('locking hides browsing while preserving the existing stream',()=>{
 const s=setup();s.start();const v=s.get('stream-video');const loads=v.loads;
 s.get('stream-directory').hidden=false;s.lock(true);
 assert.equal(s.get('stream-directory').hidden,true);assert.equal(s.get('stream-browse').disabled,true);
 assert.equal(v.loads,loads);assert.equal(v.src,'https://example.com/live.mp4');
 s.get('stream-browse').events.click();assert.equal(s.get('stream-directory').hidden,true);
 s.get('stream-stop').events.click();assert.equal(s.get('stream-dock').hidden,true);
 s.start();assert.equal(v.src,undefined);s.lock(false);assert.equal(s.get('stream-dock').hidden,true);
});

test('picture in picture collapses the dock without restarting playback',()=>{
 const s=setup();s.start();const v=s.get('stream-video');const loads=v.loads;
 v.events.enterpictureinpicture();assert.equal(s.get('stream-dock').classList.contains('stream-pip'),true);
 assert.equal(v.loads,loads);assert.equal(v.src,'https://example.com/live.mp4');
 v.events.leavepictureinpicture();assert.equal(s.get('stream-dock').classList.contains('stream-pip'),false);
 assert.equal(v.loads,loads);
});

test('zap digits animate only when requested and replay on a later arrival',()=>{
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

test('feed caret appears for playback and hides while locked or approving',()=>{
 const s=setup();const caret=s.get('stream-feed-toggle');assert.equal(caret.hidden,true);
 s.start();assert.equal(caret.hidden,false);
 s.lock(true);assert.equal(caret.hidden,true);s.lock(false);assert.equal(caret.hidden,false);
 s.approval(true);assert.equal(caret.hidden,true);s.approval(false);assert.equal(caret.hidden,false);
 s.get('stream-stop').events.click();assert.equal(caret.hidden,true);
});


test('expand is available only in wide panels and collapses when narrowed',()=>{
 const s=setup();s.start();assert.equal(s.get('stream-expand').hidden,true);
 s.get('stream-dock').width=600;s.approval(false);assert.equal(s.get('stream-expand').hidden,false);
 s.get('stream-expand').events.click();assert.equal(s.get('stream-dock').classList.contains('stream-expanded'),true);
 s.get('stream-dock').width=360;s.approval(false);assert.equal(s.get('stream-expand').hidden,true);assert.equal(s.get('stream-dock').classList.contains('stream-expanded'),false);
});

test('zap gleam restarts on arrival and clears when finished or stopped',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
 const fn=source.slice(source.indexOf('  function shineZap('),source.indexOf('  async function watchZaps('));
 const s=setup();const bolt=s.get('stream-zap');let reflows=0;
 Object.defineProperty(bolt,'offsetHeight',{get(){reflows++;return 32;}});
 const context={document:{getElementById:s.get}};vm.createContext(context);vm.runInContext(fn,context);
 context.shineZap();assert.equal(bolt.classList.contains('is-shining'),true);
 context.shineZap();assert.equal(reflows,2);
 bolt.events.animationend();assert.equal(bolt.classList.contains('is-shining'),false);
 context.shineZap();s.get('stream-stop').events.click();assert.equal(bolt.classList.contains('is-shining'),false);
});
