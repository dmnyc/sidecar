const frame=document.getElementById('layout');
for(const button of document.querySelectorAll('[data-preview]'))button.onclick=()=>frame.contentWindow.postMessage({preview:button.dataset.preview},location.origin);
document.getElementById('theme').onchange=e=>frame.contentWindow.postMessage({preview:'theme',theme:e.target.value},location.origin);

document.getElementById('panel-size').onchange=e=>{const [width,height]=e.target.value.split('x').map(Number);frame.style.width=width+'px';frame.style.height=height+'px';document.querySelector('figcaption').textContent=width+' × '+height+' · sidebar review';};
