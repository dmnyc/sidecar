// Real sidepanel markup/styles, with fictional account data and no extension APIs.
(() => {
 const $=id=>document.getElementById(id);
 const reveal=id=>{for(const name of ['view-main','view-lock','view-settings','view-profile-edit','view-onboarding'])$(name).classList.toggle('hidden',name!==id);};
 reveal('view-main');
 $('chip-av').innerHTML='<img src="icons/icon48.png" alt="Demo account">';
 $('active-account').innerHTML='<span class="aa-avatar"><img src="icons/icon48.png" alt=""></span><div class="aa-info"><div class="aa-label">Alex Morgan</div><div class="aa-npub">Demo account · preview only</div></div>';
 $('account-list').innerHTML=['Alex Morgan','Studio account','Reading account'].map((name,i)=>`<div class="item"><span class="avatar"><img src="icons/icon48.png" alt=""></span><div class="item-main"><div class="item-title">${name}</div><div class="item-sub">${i?'Available account':'Active account'}</div></div></div>`).join('');
 $('profile-view').innerHTML='<div class="active-account"><span class="aa-avatar"><img src="icons/icon48.png" alt=""></span><div class="aa-info"><div class="aa-label">Alex Morgan</div><div class="aa-npub">Demo profile</div></div></div><p>Photography, music, and open networks.</p><p class="hint">Fictional data for the layout preview.</p>';
 $('wallet-view').innerHTML='<div class="wallet-card"><div class="wallet-label">Balance</div><div class="wallet-balance">111,059</div><div class="wallet-unit">sats</div></div><div class="add-actions"><button class="secondary">Send</button><button class="secondary">Receive</button></div><h2>Recent activity</h2><div class="item"><div class="item-main"><div class="item-title">Coffee</div><div class="item-sub">Sample payment · 2,100 sats</div></div></div><p class="hint">Sample wallet. No payments are enabled.</p>';
 for(const button of document.querySelectorAll('.tabs .tab'))button.onclick=()=>{for(const other of document.querySelectorAll('.tabs .tab'))other.classList.toggle('active',other===button);for(const pane of document.querySelectorAll('.tabview'))pane.classList.toggle('hidden',pane.id!=='tab-'+button.dataset.tab);};
 const accountMenu=$('acct-menu');
 accountMenu.replaceChildren();
 for(const name of ['Alex Morgan','Studio account','Reading account']){const row=document.createElement('button');row.textContent=name;row.className='secondary';row.style.display='block';row.style.width='100%';accountMenu.append(row);}
 function closeAccounts(){accountMenu.classList.remove('is-open');accountMenu.classList.add('hidden');}
 $('acct-btn').onclick=()=>{const opening=accountMenu.classList.contains('hidden');accountMenu.classList.toggle('hidden',!opening);accountMenu.classList.toggle('is-open',opening);};
 window.addEventListener('sidecar-open-streams',closeAccounts);
 $('lock-btn').onclick=()=>reveal('view-lock');
 $('unlock-form').onsubmit=e=>{e.preventDefault();$('unlock-pin').value='';reveal('view-main');};
 $('unlock-pin').placeholder='Preview: press Unlock';$('unlock-pin').removeAttribute('autofocus');
 $('unlock-forgot').onclick=e=>e.preventDefault();
 $('settings-btn').onclick=()=>reveal('view-settings');
 const close=$('view-settings').querySelector('.settings-close');if(close)close.onclick=()=>reveal('view-main');
 $('approval-host').textContent='Example app';$('approval-ask').textContent='wants to sign a note';$('approval-account').textContent='Alex Morgan · preview only';
 for(const id of ['approval-allow','approval-reject','approval-trust'])$(id).onclick=()=>$('view-approval').classList.add('hidden');
 $('approval-preview').classList.remove('hidden');$('approval-preview').textContent='This is a simulated signing request. No signature will be created.';
 $('compose-note-btn').onclick=()=>{ $('approval-preview').textContent='Preview controls are outside the sidebar. No note will be published.'; };
 window.addEventListener('sidecar-stream-zap',()=>{const dialog=document.createElement('dialog');const text=document.createElement('p');text.textContent='Payment preview only. In Sidecar, this opens the streamer’s profile with the existing zap form expanded. No payment will be sent here.';const close=document.createElement('button');close.textContent='Close';close.onclick=()=>dialog.close();dialog.append(text,close);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();});
 window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin)return;switch(e.data?.preview){case 'lock':reveal('view-lock');break;case 'unlock':reveal('view-main');break;case 'approval':$('view-approval').classList.remove('hidden');break;case 'theme':document.documentElement.dataset.theme=(["speakeasy", "metropolis", "film-noir", "brownstone", "nixie", "cast-iron", "wabi-sabi", "constellation", "jazz-age", "departures", "industria", "aegean", "bauhaus", "populuxe", "par-avion", "werkstatte", "ukiyo-e", "mycelium", "ben-day", "turnstile", "sleepy-hollow"]).includes(e.data.theme)?e.data.theme:"speakeasy";break;}});
})();
