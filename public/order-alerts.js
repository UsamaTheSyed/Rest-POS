import {api,html} from './api.js';
export function startOrderAlerts(context,{whatsappShortcut=false}={}){
 if(!['owner','cashier'].includes(context.user.role))return;
 const box=document.createElement('aside');box.className='customer-alerts';box.setAttribute('aria-label','Customer order notifications');document.body.append(box);
 let whatsappLink;
 if(whatsappShortcut){
  document.body.classList.add('has-whatsapp-shortcut');
  whatsappLink=document.createElement('a');whatsappLink.className='whatsapp-float';whatsappLink.href='/operations.html?section=messages';whatsappLink.target='ember-whatsapp-inbox';whatsappLink.rel='noopener';whatsappLink.setAttribute('aria-label','Open WhatsApp staff inbox in a new tab');whatsappLink.title='WhatsApp staff inbox';
  whatsappLink.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 3a12 12 0 0 0-10.4 18L4 28l7-1.6A12 12 0 1 0 16 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M11 9c-1 0-2 2-1 5 1.4 3.7 4.6 6.1 8 7 2 .5 4-1 4-2l-1-2-3 1c-2-1-4-3-5-5l1-2-1-2Z" fill="currentColor"/></svg><span class="whatsapp-float-label">WhatsApp</span><span class="whatsapp-float-count" hidden></span>';document.body.append(whatsappLink);
 }
 let latest={requests:[],conversations:[]},seen=new Set(),audio=null,busy=false,open=false,loaded=false;
 function beep(){if(!audio)return;const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.connect(gain);gain.connect(audio.destination);oscillator.frequency.value=740;gain.gain.value=.08;oscillator.start();oscillator.stop(audio.currentTime+.18);}
 function draw(){const count=latest.requests.length+latest.conversations.length;
  box.innerHTML=`<button id="customer-alert-toggle" aria-expanded="${open}">🔔 Customer requests (${count})</button><button id="customer-alert-sound">${audio?'Sound on':'Enable sound'}</button><span id="customer-alert-status" role="status">${loaded?'':'Connecting…'}</span><div id="customer-alert-panel" ${open?'':'hidden'}></div>`;
  box.querySelector('#customer-alert-toggle').onclick=async()=>{open=!open;draw();if(open)await details();};
  box.querySelector('#customer-alert-sound').onclick=async()=>{try{if(audio){await audio.close();audio=null;}else{audio=new AudioContext();await audio.resume();beep();}draw();if(open)await details();}catch{box.querySelector('#customer-alert-status').textContent='Sound is unavailable in this browser.';}};
 }
 async function details(){const panel=box.querySelector('#customer-alert-panel');try{
  const requests=(await api('/customer-requests')).filter(r=>r.status==='pending');
  panel.innerHTML=`<h3>Waiting for acceptance</h3>${requests.map(r=>`<article><strong>#${r.id} · ${html(r.source)}</strong><p>${html(r.body.type)} · ${html(r.body.customer)}</p><p>${r.body.items.map(p=>`${p.qty} × ${html(p.name)}`).join(', ')}</p><p>${html(r.body.note)}</p><strong>PKR ${r.body.total.toFixed(2)}</strong><p><button data-request-id="${r.id}" data-action="accept">Accept</button> <button data-request-id="${r.id}" data-action="reject">Reject</button></p></article>`).join('')||'<p>No pending order requests.</p>'}<p><a href="/operations.html?section=messages" target="_blank" rel="noopener">Open staff chat inbox (${latest.conversations.length}) ↗</a></p>`;
  panel.querySelectorAll('[data-request-id]').forEach(button=>button.onclick=async()=>{if(busy)return;busy=true;button.disabled=true;try{await api('/customer-requests/'+button.dataset.requestId,'PATCH',{action:button.dataset.action});window.dispatchEvent(new Event('customer-order-accepted'));await poll();await details();}catch(e){box.querySelector('#customer-alert-status').textContent=e.message;button.disabled=false;}finally{busy=false;}});
 }catch(e){box.querySelector('#customer-alert-status').textContent=e.message;}}
 async function poll(){try{latest=await api('/notifications');const ids=[...latest.requests.map(r=>'r'+r.id),...latest.conversations.map(r=>'c'+r.id+':'+r.last_inbound)];const changed=ids.some(id=>!seen.has(id));if(changed)beep();seen=new Set(ids);loaded=true;
  if(whatsappLink){const count=latest.conversations.length,badge=whatsappLink.querySelector('.whatsapp-float-count');badge.textContent=count>99?'99+':String(count);badge.hidden=!count;whatsappLink.setAttribute('aria-label',`Open WhatsApp staff inbox in a new tab${count?', '+count+' active staff conversations':''}`);whatsappLink.title=count?`${count} staff conversations · Open WhatsApp inbox`:'Open WhatsApp staff inbox';}
  box.querySelector('#customer-alert-toggle').textContent=`🔔 Customer requests (${ids.length})`;box.querySelector('#customer-alert-status').textContent=changed?'New customer activity':ids.length?'Requests need attention':'';
  if(open&&changed&&!busy)await details();
 }catch{box.querySelector('#customer-alert-status').textContent='Alerts disconnected — retrying…';}}
 draw();poll();const timer=setInterval(poll,5000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
