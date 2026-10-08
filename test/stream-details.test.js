const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 class Node {
  constructor(){this.children=[];this.attrs={};this.style={};this.hidden=false;this.textContent='';this.offsetHeight=20;this.classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x))};}
  append(...xs){this.children.push(...xs);}replaceWith(){}setAttribute(k,v){this.attrs[k]=v;}toggleAttribute(k,on){if(on)this.attrs[k]='';else delete this.attrs[k];}
  matches(){return false;}focus(){}getBoundingClientRect(){return {bottom:250,top:750};}getClientRects(){return [];}
 }
 const root=new Node(),body=new Node(),timers=new Map();let next=0;
 const context={window:{addEventListener(){}},document:{documentElement:root,body,hidden:false,createElement:()=>new Node(),getElementById:()=>null,addEventListener(){}},innerHeight:800,SidecarStreams:require('../stream-core'),SidecarI18n:{t:(text,values={})=>text.replace(/{{(\w+)}}/g,(_,key)=>values[key]),fmtNum:String,fmtDate:()=> 'date'},matchMedia:()=>({matches:context.reduced}),ResizeObserver:class{observe(){}},MutationObserver:class{observe(){}},getComputedStyle:()=>({getPropertyValue:()=> '150ms'}),setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../stream-details'),'utf8'),context);
 const title=new Node(),trigger=new Node(),dock=new Node();let restored=0;
 const view=context.window.SidecarStreamDetails.mount({dock,title,trigger,allowed:()=>true,onOpen(){},onClose(){restored++;}});
 const tick=()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();return timer.ms;};
 return {view,title,trigger,context,timers,tick,body,restored:()=>restored};
}
test('title rotates to runtime after 12 seconds, returns after four, and cancels on close',()=>{
 const f=fixture();f.view.set({title:'Radio',starts:Math.floor(Date.now()/1000)-3600});
 assert.equal(f.title.textContent,'Radio');assert.equal(f.tick(),12000);assert.equal(f.tick(),150);assert.match(f.title.textContent,/Live for 1h/);
 assert.equal(f.tick(),4000);f.tick();assert.equal(f.title.textContent,'Radio');f.view.set(null);assert.equal(f.timers.size,0);
});
test('reduced motion and focused title keep the title static',()=>{
 for(const reduced of [true,false]){const f=fixture();f.context.reduced=reduced;f.trigger.matches=()=>!reduced;f.view.set({title:'Radio',starts:1});f.tick();assert.equal(f.title.textContent,'Radio');assert.equal([...f.timers.values()][0].ms,12000);}
});
test('unknown start does not rotate; About renders description as text and restores previous view',()=>{
 const f=fixture();f.view.set({title:'Radio',summary:'<script>not markup</script>',categories:['music']});assert.equal(f.timers.size,0);
 f.view.toggle();const panel=f.body.children[0];assert.equal(panel.hidden,false);assert.equal(panel.children[2].textContent,'<script>not markup</script>');assert.equal(panel.style.height,'550px');
 f.view.close(true);assert.equal(panel.hidden,true);assert.equal(f.restored(),1);
});
