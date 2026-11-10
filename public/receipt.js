import {api,authenticate,html} from './api.js';
import {money} from './model.js';
const app=document.querySelector('#app');
try{
  const context=await authenticate(),id=Number(new URLSearchParams(location.search).get('id'));
  const order=await api('/orders/'+id);
  app.innerHTML=`<div><div class="receipt"><h1>${html(context.restaurant.name)}</h1><p>Order #${order.id}<br>${new Date(order.date).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})}</p><p>${html(order.type)}${order.customer?' · '+html(order.customer):''}</p><hr><table>${order.items.map(p=>`<tr><td>${p.qty} × ${html(p.name)}<br>@ ${money(p.price)}</td><td>${money(p.price*p.qty)}</td></tr>`).join('')}</table><hr><table><tr><td>Subtotal</td><td>${money(order.subtotal)}</td></tr><tr><td>Tax</td><td>${money(order.tax)}</td></tr><tr><td><b>Total</b></td><td><b>${money(order.total)}</b></td></tr></table><hr><p>Payment recorded: ${html(order.payment)}</p><p>Thank you for dining with us.</p><p>Internal sales receipt.<br>Not a fiscal authority-verified invoice.</p></div><div class="receipt-actions"><button id="print">Print receipt</button> <a href="/">Back to POS</a></div></div>`;
  document.querySelector('#print').onclick=()=>window.print();
}catch(e){app.innerHTML=`<div class="ops"><p class="ops-error">${html(e.message)}</p><a href="/">Back to POS</a></div>`;}
