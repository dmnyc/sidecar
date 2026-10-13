const frame=document.getElementById('layout');
for(const button of document.querySelectorAll('[data-preview]'))button.onclick=()=>frame.contentWindow.postMessage({preview:button.dataset.preview},location.origin);
document.getElementById('theme').onchange=e=>frame.contentWindow.postMessage({preview:'theme',theme:e.target.value},location.origin);

document.getElementById('panel-size').onchange=e=>{const [width,height]=e.target.value.split('x').map(Number);frame.style.width=width+'px';frame.style.height=height+'px';document.querySelector('figcaption').textContent=width+' × '+height+' · sidebar review';};

function updateReviewLanguage() {
  const language=document.getElementById('review-language').value;
  frame.src='layout.html?v=verified-live&lang='+encodeURIComponent(language)+(document.getElementById('pseudo-locale').checked?'&pseudo=1':'');
}
document.getElementById('pseudo-locale').onchange=updateReviewLanguage;
document.getElementById('review-language').onchange=updateReviewLanguage;
// A locale reload should retain the selected review theme and panel dimensions.
frame.addEventListener('load',()=>frame.contentWindow.postMessage({preview:'theme',theme:document.getElementById('theme').value},location.origin));
