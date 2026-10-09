const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../streams.js'),'utf8');
const code=source.slice(source.indexOf('  function measurePageSize()'),source.indexOf('  new ResizeObserver(schedulePageSize)'));
function setup(height=760){
 let rowHeight=80;const list={querySelectorAll:()=>Array.from({length:6},()=>({getBoundingClientRect:()=>({height:rowHeight})}))};
 const ctx={directory:{hidden:false},detailItem:null,directoryContent:{clientHeight:height,clientWidth:360},list,moreOpen:false,
 filters:{getBoundingClientRect:()=>({height:40})},measuredWidth:0,measuredRowHeight:0,pageSize:6,streamPage:0,morePage:0,
 getComputedStyle:()=>({rowGap:'10',paddingTop:'0',paddingBottom:'12',marginBottom:'8'}),paint(){this.paints=(this.paints||0)+1;}};
 vm.createContext(ctx);vm.runInContext(code,ctx);return {ctx,setRow:n=>rowHeight=n};
}
test('tall panels show more than six rows and smaller panels reduce capacity',()=>{
 const {ctx}=setup();ctx.measurePageSize();assert.equal(ctx.pageSize,7);
 ctx.directoryContent.clientHeight=420;ctx.measurePageSize();assert.equal(ctx.pageSize,4);
});
test('capacity accounts for row wrapping and preserves the current results neighborhood',()=>{
 const {ctx,setRow}=setup();ctx.streamPage=2;setRow(100);ctx.measurePageSize();assert.equal(ctx.pageSize,6);
 ctx.directoryContent.clientHeight=1100;ctx.measurePageSize();assert.equal(ctx.pageSize,9);assert.equal(ctx.streamPage,1);
});
test('shorter titles do not oscillate page size and narrow panels keep at least one row',()=>{
 const {ctx,setRow}=setup();setRow(100);ctx.measurePageSize();setRow(70);ctx.measurePageSize();assert.equal(ctx.pageSize,6);
 ctx.directoryContent.clientHeight=90;ctx.measurePageSize();assert.equal(ctx.pageSize,1);
});
