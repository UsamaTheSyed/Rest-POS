import {api,html} from './api.js';
import {money} from './model.js';
export async function editUnpaidOrder(id,onSaved,onCancel){
  const [order,catalog]=await Promise.all([api('/orders/'+id),api('/menu')]);
  if(order.paymentStatus==='paid')throw new Error('Paid orders cannot be edited.');
  const dialog=document.querySelector('#checkout');
  let items=order.items.map(p=>({...p})),note=order.note,customer=order.customer,busy=false;
  const totals=()=>{const subtotal=items.reduce((s,p)=>s+Math.round(p.price*100)*p.qty,0);const tax=Math.round(subtotal*order.taxBps/10000);return {subtotal:subtotal/100,tax:tax/100,total:(subtotal+tax)/100};};
  const close=()=>{if(!busy){dialog.close();onCancel();}};
  function paint(){
    const t=totals();
    dialog.innerHTML=`<button type="button" class="close" aria-label="Cancel order edit">×</button><div class="eyebrow">EDIT ORDER #${order.id}</div><h2>Edit before payment</h2><p>${html(order.type)} · Existing items keep their original prices.</p><form id="order-edit-form"><div class="edit-order-items">${items.map((p,index)=>`<div class="edit-order-line"><div><strong>${html(p.name)}</strong><p>${money(p.price)} each</p></div><label>Qty<input type="number" min="1" max="999" step="1" required value="${p.qty}" data-edit-qty="${index}" aria-label="Quantity for ${html(p.name)}"></label><button type="button" class="remove-item" data-edit-remove="${index}">Remove</button></div>`).join('')}</div><label>Add menu item<select id="edit-add-item"><option value="">Select an item</option>${catalog.filter(p=>p.available).map(p=>`<option value="${p.id}">${html(p.name)} · ${money(p.price)}</option>`).join('')}</select></label><button type="button" id="edit-add" class="checkout pay-now">Add selected item</button><label>Table / customer<input id="edit-customer" maxlength="200" value="${html(customer)}"></label><label>Kitchen note<input id="edit-note" maxlength="1000" value="${html(note)}"></label><p class="payment-help">Item or note changes return this order to the kitchen queue with a change summary. Tell the kitchen if preparation has already started.</p><div class="checkout-total" id="edit-total">${money(t.total)}</div><p id="edit-error" role="alert"></p><button type="submit" class="checkout">Save and return to payment</button><button type="button" id="edit-cancel" class="clear">Cancel changes</button></form>`;
    dialog.querySelector('.close').onclick=close;dialog.querySelector('#edit-cancel').onclick=close;
    dialog.querySelector('#edit-customer').oninput=e=>customer=e.target.value;dialog.querySelector('#edit-note').oninput=e=>note=e.target.value;
    const error=message=>dialog.querySelector('#edit-error').textContent=message;
    dialog.querySelectorAll('[data-edit-qty]').forEach(input=>input.oninput=()=>{const n=Number(input.value);if(Number.isInteger(n)&&n>=1&&n<=999){items[Number(input.dataset.editQty)].qty=n;dialog.querySelector('#edit-total').textContent=money(totals().total);}});
    dialog.querySelectorAll('[data-edit-remove]').forEach(button=>button.onclick=()=>{items.splice(Number(button.dataset.editRemove),1);paint();});
    dialog.querySelector('#edit-add').onclick=()=>{
      const p=catalog.find(p=>p.id===Number(dialog.querySelector('#edit-add-item').value));if(!p){error('Choose an item to add.');return;}
      const existing=items.find(x=>x.id===p.id),original=order.items.find(x=>x.id===p.id);
      if(existing){if(existing.qty>=999){error('Maximum quantity is 999.');return;}existing.qty++;}else items.push({...(original||p),qty:1});paint();
    };
    dialog.querySelector('#order-edit-form').onsubmit=async e=>{
      e.preventDefault();if(busy)return;if(!items.length){error('Keep at least one item in the order.');return;}
      busy=true;dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
      try{const saved=await api('/orders/'+id,'PATCH',{expectedRevision:order.revision,items:items.map(p=>({id:p.id,qty:p.qty})),note,customer,expectedTotal:totals().total});dialog.close();await onSaved(saved);}
      catch(e){if(dialog.open){error(e.message);dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}}
      finally{busy=false;}
    };
  }
  paint();dialog.oncancel=e=>{e.preventDefault();close();};if(!dialog.open)dialog.showModal();
}
