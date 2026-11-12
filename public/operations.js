import {inventoryView,teamView} from './team-stock.js';
import {menuImageUrl,validateImageFile,readImageFile} from './menu-image.js';
import {api,authenticate,html} from './api.js';
import {money} from './model.js';
const sectionNames={kitchen:'Kitchen',menu:'Menu',inventory:'Inventory',employees:'Staffing',attendance:'Attendance',staff:'Staff accounts',reports:'Reports',settings:'Settings',audit:'Audit'};
const requestedSection=new URLSearchParams(location.search).get('section');
let context,section=Object.hasOwn(sectionNames,requestedSection)?requestedSection:'kitchen',poll;
const attendanceRange={};
const app=document.querySelector('#app');
let previewUrl=null;
function clearPreview(){if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}}
window.addEventListener('pagehide',clearPreview);
const time=d=>new Date(d).toLocaleString('en-PK',{timeZone:'Asia/Karachi'});
function alertError(e){const el=document.querySelector('#ops-error');if(el){el.textContent=e.message;el.hidden=false;}}
async function start(){context=await authenticate();if(context.user.role==='cashier')section='attendance';if(context.user.role==='kitchen'&&!['kitchen','attendance'].includes(section))section='kitchen';shell();await load();poll=setInterval(()=>{if(section==='kitchen')load().catch(alertError);},5000);}
function shell(){clearPreview();app.innerHTML=`<div class="ops"><nav class="ops-nav"><a class="board-logo" href="/">ember✦</a><a href="/">Point of sale</a><a href="/?display=1" target="ember-display">Menu display ↗</a><span class="user-info">${html(context.user.name)} · ${html(context.user.role)}</span><button id="logout" class="muted-button">Sign out</button></nav><h1>${html(context.restaurant.name)}</h1><p class="subtitle">Restaurant operations · Asia/Karachi · PKR</p><div class="ops-tabs">${(context.user.role==='owner'?Object.keys(sectionNames):context.user.role==='kitchen'?['kitchen','attendance']:['attendance']).map(s=>`<button data-section="${s}" class="${section===s?'active':''}">${sectionNames[s]}</button>`).join('')}<span class="ops-status" id="status"></span></div><div id="ops-error" class="ops-error" role="alert" hidden></div><div id="content"></div></div>`;document.querySelector('#logout').onclick=async()=>{await api('/logout','POST',{});location.href='/';};document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{section=b.dataset.section;shell();load().catch(alertError);});}
async function load(){const selected=section;let markup='',menuRows=[],moduleView=null;
  const reloadModule=async()=>{if(section===selected)await load();};
  if(section==='inventory')moduleView=await inventoryView(reloadModule,alertError);
  if(['employees','attendance'].includes(section))moduleView=await teamView(context,section==='attendance',reloadModule,alertError,attendanceRange);
  if(moduleView)markup=moduleView.markup;
  if(section==='kitchen'){const orders=await api('/orders');markup=`<div class="kitchen-grid">${orders.filter(o=>o.status!=='served').reverse().map(o=>`<article class="ticket"><div class="ticket-head ${o.status}"><strong>#${o.id} · ${html(o.type)}</strong><span>${html(o.status)}</span></div><div class="ticket-body"><p>${time(o.date)}${o.customer?' · '+html(o.customer):''}</p><ul>${o.items.map(p=>`<li><b>${p.qty} ×</b> ${html(p.name)}</li>`).join('')}</ul>${o.note?`<p class="ticket-note">${html(o.note)}</p>`:''}<button data-order="${o.id}" data-next="${{queued:'preparing',preparing:'ready',ready:'served'}[o.status]}">${{queued:'Start preparing',preparing:'Mark ready',ready:'Mark served'}[o.status]}</button></div></article>`).join('')||'<div class="ops-panel">No active kitchen tickets.</div>'}</div>`;}
  if(section==='menu'){const menu=await api('/menu');menuRows=menu;markup=`<div class="ops-panel"><div class="menu-admin-heading"><div><h2>Manage menu</h2><p class="subtitle">Add dishes, drinks and deals for your restaurant.</p></div><button type="button" id="new-menu-item">+ Add menu item</button></div><form id="menu-form" class="ops-form menu-create"><h2 id="add-menu-item">Add menu item</h2><label>Item name<input name="name" required maxlength="100" placeholder="e.g. Chicken Biryani"></label><label>Category<input name="category" list="menu-categories" required maxlength="60" placeholder="Choose or type a category"></label><datalist id="menu-categories">${[...new Set([...menu.map(p=>p.category),'Desi','BBQ','Beverages'])].map(c=>`<option value="${html(c)}"></option>`).join('')}</datalist><label>Price (PKR)<input name="price" type="number" min="0" max="100000" step="0.01" required placeholder="450"></label><label>Description (optional)<input name="description" maxlength="300" placeholder="What is included?"></label><label>Badge (optional)<input name="tag" maxlength="40" placeholder="e.g. Lunch special"></label><label>Item image (optional)<input id="menu-image" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="image-help image-error"></label><p id="image-help" class="image-help">JPG, PNG or WebP · Up to 2 MB</p><div class="menu-image-preview" id="image-preview" hidden><img id="image-preview-img" alt="Selected menu item image"><button type="button" id="remove-image" class="muted-button">Remove image</button></div><p id="image-error" role="alert"></p><label class="availability-label"><input name="available" type="checkbox" checked> Available for ordering</label><p class="subtitle">Use the Deals category for a combo. Items without a photo use a neutral food illustration.</p><div class="menu-form-actions"><button type="submit">Add item to menu</button><button type="button" id="cancel-menu-edit" class="muted-button" hidden>Cancel edit</button></div><p id="menu-feedback" role="status"></p></form><h2>Menu items</h2><p class="subtitle">Changes apply to new orders. Existing order prices remain unchanged.</p><table><thead><tr><th>Item</th><th>Category</th><th>Price (PKR)</th><th>Available</th><th>Actions</th></tr></thead><tbody>${menu.map(p=>`<tr data-product="${p.id}"><td><img class="menu-thumbnail" src="${menuImageUrl(p,100)}" alt="">${html(p.name)}</td><td>${html(p.category)}</td><td>${money(p.price)}</td><td>${p.available?'Available':'Unavailable'}</td><td><div class="menu-row-actions"><button data-edit="${p.id}" aria-label="Edit ${html(p.name)}">Edit</button><button class="danger-button" data-delete="${p.id}" aria-label="Delete ${html(p.name)}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`;}
  if(section==='staff'){const users=await api('/staff');markup=`<div class="ops-panel"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${users.map(u=>`<tr><td>${html(u.name)}</td><td>${html(u.email)}</td><td>${html(u.role)}</td></tr>`).join('')}</tbody></table><form id="staff-form" class="ops-form"><h2>Add staff member</h2><label>Name<input name="name" required maxlength="100"></label><label>Email<input type="email" name="email" required></label><label>Initial password<input type="password" name="password" required minlength="12" maxlength="200" autocomplete="new-password"></label><label>Role<select name="role"><option value="cashier">Cashier</option><option value="kitchen">Kitchen</option><option value="owner">Owner (full access)</option></select></label><button>Create staff account</button></form></div>`;}
  if(section==='reports'){const rows=await api('/reports');markup=`<div class="ops-panel"><h2>Daily recorded sales</h2><p class="subtitle">Last 90 trading days · Pakistan time · Recorded payments, not bank settlement</p><table><thead><tr><th>Date</th><th>Orders</th><th>Subtotal</th><th>Tax</th><th>Total</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.date}</td><td>${r.orders}</td><td>${money(r.subtotal)}</td><td>${money(r.tax)}</td><td>${money(r.total)}</td></tr>`).join('')||'<tr><td colspan="5">No sales recorded yet.</td></tr>'}</tbody></table></div>`;}
  if(section==='settings'){context=await api('/me');markup=`<div class="ops-panel"><form class="ops-form" id="settings-form"><h2>Restaurant settings</h2><label>Restaurant name<input name="name" value="${html(context.restaurant.name)}" required maxlength="100"></label><label>Tax rate (%)<input name="tax" type="number" min="0" max="100" step="0.01" value="${context.restaurant.tax_bps/100}" required></label><p class="subtitle">Configure the rate applicable to your restaurant. This setting does not provide FBR or provincial e-invoicing integration.</p><button>Save settings</button></form></div>`;}
  if(section==='audit'){const rows=await api('/audit');markup=`<div class="ops-panel"><h2>Activity log</h2><table><thead><tr><th>Time</th><th>Staff</th><th>Action</th><th>Record</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${time(r.created_at)}</td><td>${html(r.staff)}</td><td>${html(r.action)}</td><td>${r.entity_id}</td></tr>`).join('')}</tbody></table></div>`;}
  if(selected!==section)return;clearPreview();document.querySelector('#content').innerHTML=markup;document.querySelector('#status').textContent='Updated '+new Date().toLocaleTimeString('en-PK');document.querySelector('#ops-error').hidden=true;
  if(moduleView)moduleView.bind();
  document.querySelectorAll('[data-order]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api(`/orders/${b.dataset.order}/status`,'PATCH',{status:b.dataset.next});await load();}catch(e){alertError(e);b.disabled=false;}});
  const menuForm=document.querySelector('#menu-form');
  if(menuForm){
    let editingId=null,removeImage=false,saving=false;
    const picker=menuForm.querySelector('#menu-image'),preview=menuForm.querySelector('#image-preview'),previewImg=menuForm.querySelector('#image-preview-img'),error=menuForm.querySelector('#image-error');
    const submit=menuForm.querySelector('button[type=submit]');
    const reset=()=>{clearPreview();picker.value='';picker.setCustomValidity('');preview.hidden=true;previewImg.removeAttribute('src');error.textContent='';submit.disabled=false;};
    picker.onchange=()=>{
      clearPreview();preview.hidden=true;previewImg.removeAttribute('src');error.textContent='';picker.setCustomValidity('');
      const file=picker.files[0];if(!file){submit.disabled=false;return;}
      try{
        validateImageFile(file);submit.disabled=true;picker.setCustomValidity('Please wait for the image preview.');
        const url=URL.createObjectURL(file);previewUrl=url;
        previewImg.onload=()=>{if(previewUrl!==url)return;preview.hidden=false;picker.setCustomValidity('');submit.disabled=false;};
        previewImg.onerror=()=>{if(previewUrl!==url)return;clearPreview();error.textContent='This image could not be opened. Choose a different file.';picker.setCustomValidity(error.textContent);submit.disabled=false;};
        previewImg.src=url;
      }catch(e){error.textContent=e.message;picker.setCustomValidity(e.message);submit.disabled=false;}
    };
    menuForm.querySelector('#remove-image').onclick=()=>{reset();removeImage=true;};
    const resetForm=()=>{
      editingId=null;removeImage=false;menuForm.reset();reset();
      menuForm.querySelector('#add-menu-item').textContent='Add menu item';submit.textContent='Add item to menu';
      menuForm.querySelector('#cancel-menu-edit').hidden=true;menuForm.querySelector('#menu-feedback').textContent='';
    };
    const focusForm=()=>{menuForm.scrollIntoView({behavior:'smooth',block:'start'});menuForm.elements.namedItem('name').focus({preventScroll:true});};
    document.querySelector('#new-menu-item').onclick=()=>{if(saving)return;resetForm();focusForm();};
    menuForm.querySelector('#cancel-menu-edit').onclick=()=>{resetForm();focusForm();};
    document.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>{
      if(saving)return;
      const product=menuRows.find(item=>item.id===Number(button.dataset.edit));resetForm();editingId=product.id;
      for(const [key,value] of Object.entries({name:product.name,category:product.category,price:product.price,description:product.desc,tag:product.tag}))menuForm.elements.namedItem(key).value=value;
      menuForm.elements.namedItem('available').checked=product.available;
      menuForm.querySelector('#add-menu-item').textContent='Edit menu item';submit.textContent='Save changes';
      menuForm.querySelector('#cancel-menu-edit').hidden=false;
      if(product.image){previewImg.onload=null;previewImg.onerror=null;previewImg.src=menuImageUrl(product);preview.hidden=false;}
      focusForm();
    });
    document.querySelectorAll('[data-delete]').forEach(button=>button.onclick=async()=>{
      if(saving)return;
      const product=menuRows.find(item=>item.id===Number(button.dataset.delete));
      if(!confirm(`Delete “${product.name}” from the menu? Past orders will be kept.`))return;
      saving=true;button.disabled=true;
      try{await api('/menu/'+product.id,'DELETE',{});if(section==='menu'){await load();const feedback=document.querySelector('#menu-feedback');if(feedback)feedback.textContent=`${product.name} deleted from the menu.`;}}
      catch(error){alertError(error);saving=false;button.disabled=false;}
    });
    menuForm.onsubmit=async e=>{
      e.preventDefault();if(saving)return;saving=true;submit.disabled=true;
      const fields=Object.fromEntries(new FormData(menuForm)),file=picker.files[0];
      const controls=[...menuForm.elements];controls.forEach(el=>el.disabled=true);
      try{
        const imageData=file?await readImageFile(file):removeImage?null:undefined;
        const item=await api(editingId?'/menu/'+editingId:'/menu',editingId?'PATCH':'POST',{...fields,price:Number(fields.price),available:fields.available==='on',imageData});
        if(section==='menu'){await load();const feedback=document.querySelector('#menu-feedback');if(feedback){feedback.textContent=editingId?`${item.name} updated.`:`${item.name} added to the menu.`;document.querySelector('#menu-form input[name=name]').focus();}}
      }catch(error){alertError(error);saving=false;controls.forEach(el=>el.disabled=false);}
    };
  }
  const staff=document.querySelector('#staff-form');if(staff)staff.onsubmit=async e=>{e.preventDefault();const b=staff.querySelector('button');b.disabled=true;try{await api('/staff','POST',Object.fromEntries(new FormData(staff)));await load();}catch(e){alertError(e);b.disabled=false;}};
  const settings=document.querySelector('#settings-form');if(settings)settings.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(settings));try{await api('/settings','PATCH',{name:data.name,tax_bps:Math.round(Number(data.tax)*100)});context=await api('/me');shell();await load();}catch(e){alertError(e);}};
}
start().catch(e=>{app.innerHTML=`<div class="ops"><p class="ops-error">${html(e.message)}</p><a href="/operations.html">Retry</a></div>`;});
