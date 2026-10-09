const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const start=source.indexOf("  document.addEventListener?.('click',event=>{");
const end=source.indexOf("  document.addEventListener?.('keydown'",start);
function setup(){
 let handler,closed=0;
 const directory={hidden:false,contains:()=>false};
 const context={directory,entry:{contains:()=>false},browse:{contains:()=>false},feedToggle:{contains:()=>false},closeFeed:()=>closed++,document:{addEventListener:(_,fn)=>handler=fn}};
 vm.runInNewContext(source.slice(start,end),context);
 return {context,click:path=>handler({target:{},composedPath:()=>path}),closed:()=>closed};
}
test('pagination repaint can detach its target without closing the directory',()=>{
 const s=setup();s.click([{},s.context.directory]);assert.equal(s.closed(),0);
});
test('an outside click still closes the directory',()=>{
 const s=setup();s.click([{}]);assert.equal(s.closed(),1);
});
test('toolbar and feed triggers are not treated as outside clicks',()=>{
 const s=setup();for(const name of ['entry','browse','feedToggle'])s.click([s.context[name]]);assert.equal(s.closed(),0);
});
