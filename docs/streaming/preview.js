const byId = id => document.getElementById(id);
byId('demo-sign').onclick=()=>byId('view-approval').classList.remove('hidden');
for(const id of ['demo-allow','demo-reject'])byId(id).onclick=()=>byId('view-approval').classList.add('hidden');
byId('demo-lock').onclick=()=>{byId('view-main').classList.add('hidden');byId('view-lock').classList.remove('hidden');};
byId('demo-unlock').onclick=()=>{byId('view-lock').classList.add('hidden');byId('view-main').classList.remove('hidden');};
byId('demo-pseudo').onclick=()=>{SidecarI18n.setLocale('en-XA');SidecarI18n.applyDom(document);};
let loads=0;byId('stream-video').addEventListener('loadstart',()=>loads++);
setInterval(()=>{byId('demo-stats').textContent=`Playback: ${byId('stream-video').currentTime.toFixed(1)}s · Source loads: ${loads}`;},500);
