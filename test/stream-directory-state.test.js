const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../streams'),'utf8');
function fixture(){
 const classes=(initial=[])=>{const values=new Set(initial);return {contains:k=>values.has(k),add:k=>values.add(k),remove:k=>values.delete(k),toggle(k,on){if(on)values.add(k);else values.delete(k);}};};
 const attrs=new Map(),feedToggle={setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k)};
 const directory={hidden:false,classList:classes(['stream-idle-directory','is-open']),style:{}},html={classList:classes()},root={hidden:false,getBoundingClientRect:()=>({bottom:250})};
 let finish;
 const ctx={directory,root,feedToggle,entry:null,document:{documentElement:html,getElementById:()=>null},window:{innerHeight:800},disconnect(){},clearTimeout(){},setTimeout:fn=>{finish=fn;return 1;},getComputedStyle:()=>({getPropertyValue:()=> '150'})};
 const functions=['setFeedExpanded','positionDirectory','closeFeed'].map(name=>{
  const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  }',start)+4;return source.slice(start,end);
 }).join('\n');
 vm.runInNewContext('let feedCloseTimer;'+functions+'\nthis.api={setFeedExpanded,positionDirectory,closeFeed};',ctx);
 return {ctx,directory,html,root,finish:()=>finish()};
}
test('resize callbacks during the close transition cannot hide the app again',()=>{
 const f=fixture();f.ctx.api.setFeedExpanded(true);f.ctx.api.positionDirectory();
 assert.equal(f.html.classList.contains('stream-directory-active'),true);
 f.ctx.api.closeFeed();assert.equal(f.directory.hidden,false); // closing animation still visible
 f.ctx.api.positionDirectory();
 assert.equal(f.html.classList.contains('stream-directory-active'),false);
 f.finish();f.ctx.api.positionDirectory();
 assert.equal(f.directory.hidden,true);assert.equal(f.html.classList.contains('stream-directory-active'),false);
});
test('reopening during close keeps the takeover, and idle browsing keeps navigation',()=>{
 const f=fixture();f.ctx.api.closeFeed();f.directory.classList.remove('is-closing');f.directory.classList.add('is-open');f.ctx.api.setFeedExpanded(true);f.ctx.api.positionDirectory();
 assert.equal(f.html.classList.contains('stream-directory-active'),true);
 f.root.hidden=true;f.ctx.api.positionDirectory();assert.equal(f.html.classList.contains('stream-directory-active'),false);
});
