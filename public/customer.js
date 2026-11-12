import {html} from './api.js';
import {menuImageUrl} from './menu-image.js';
const app=document.querySelector('#app'),token=new URLSearchParams(location.search).get('table');
const endpoint='/api/customer/'+encodeURIComponent(token||'');
let catalog,cart=new Map(),busy=false,note='',pending=null;
const money=n=>'PKR '+n.toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
async function call(path='',body){const response=await fetch(endpoint+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error),{status:response.status});return data;}
function total(){const sub=[...cart].reduce((s,[id,qty])=>s+Math.round(catalog.items.find(p=>p.id===id).price*100)*qty,0);return (sub+Math.round(sub*catalog.taxBps/10000))/100;}
function render(){
 app.innerHTML=`<header><span class="eyebrow">ORDER AT YOUR TABLE</span><h1>${html(catalog.restaurant)}</h1><p>${html(catalog.table)} · Pay after your meal</p></header><section class="menu"><h2>Choose your meal</h2>${[...new Set(catalog.items.map(p=>p.category))].map(category=>`<h3>${html(category)}</h3><div class="grid">${catalog.items.filter(p=>p.category===category).map(p=>`<article><img src="${html(p.image.startsWith('/api/customer/')?p.image:menuImageUrl(p,240))}" alt="" loading="lazy"><div><h4>${html(p.name)}</h4><p>${html(p.desc)}</p><strong>${money(p.price)}</strong><label>Quantity<input type="number" min="0" max="99" step="1" value="${cart.get(p.id)||0}" data-item="${p.id}" aria-label="Quantity for ${html(p.name)}"></label></div></article>`).join('')}</div>`).join('')}</section><form id="order"><h2>Your order</h2><div id="summary"></div><label>Notes / allergies<textarea id="note" maxlength="700" placeholder="Please also tell a staff member about any allergies.">${html(note)}</textarea></label><p>Staff will review your request before sending it to the kitchen. Tax: ${catalog.taxBps/100}%.</p><p id="error" role="alert"></p><button id="submit">Send order request</button><p id="result" role="status"></p></form>`;
 app.querySelectorAll('[data-item]').forEach(el=>el.oninput=()=>{const qty=Number(el.value);if(el.value!==''&&Number.isInteger(qty)&&qty>=0&&qty<=99){qty?cart.set(Number(el.dataset.item),qty):cart.delete(Number(el.dataset.item));summary();}});
 app.querySelector('#note').oninput=e=>note=e.target.value;
 app.querySelector('#order').onsubmit=async e=>{e.preventDefault();if(busy)return;if(!pending&&[...app.querySelectorAll('[data-item]')].some(el=>!el.reportValidity()||el.value===''))return;
  if(!pending&&!cart.size){app.querySelector('#error').textContent='Choose at least one item.';return;}
  busy=true;app.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=true);
  pending=pending||{requestKey:crypto.randomUUID(),items:[...cart].map(([id,qty])=>({id,qty})),note,expectedTotal:total()};sessionStorage.setItem('table-order:'+token,JSON.stringify(pending));
  try{const result=await call('/orders',pending);sessionStorage.removeItem('table-order:'+token);pending=null;cart.clear();note='';render();app.querySelector('#result').textContent=`Request #${result.id} received (${result.status}). Please wait for staff confirmation. Payment is due later.`;app.querySelector('#result').scrollIntoView({behavior:'smooth'});}
  catch(e){app.querySelector('#error').textContent=e.message;if(e.status&&e.status<500){pending=null;sessionStorage.removeItem('table-order:'+token);}else app.querySelector('#error').textContent+=' Press Retry to safely check the same request.';}
  finally{busy=false;app.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=!!pending&&el.id!=='submit');app.querySelector('#submit').textContent=pending?'Retry order request':'Send order request';}
 };
 summary();
}
function summary(){app.querySelector('#summary').innerHTML=`${[...cart].map(([id,qty])=>`<p>${qty} × ${html(catalog.items.find(p=>p.id===id).name)}</p>`).join('')||'<p>No items selected yet.</p>'}<strong>Total ${money(total())}</strong>`;}
try{catalog=await call();try{pending=JSON.parse(sessionStorage.getItem('table-order:'+token));}catch{}if(pending){cart=new Map(pending.items.filter(p=>catalog.items.some(x=>x.id===p.id)).map(p=>[p.id,p.qty]));note=pending.note;}render();if(pending){app.querySelectorAll('input,textarea').forEach(el=>el.disabled=true);app.querySelector('#submit').textContent='Retry previous order request';}}catch(e){app.innerHTML=`<h1>Menu unavailable</h1><p>${html(e.message)}</p><p>Please ask restaurant staff for help.</p>`;}
