export async function api(path, method='GET', body) {
  const response=await fetch('/api'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error||'Request failed'),{status:response.status});
  return result;
}
export const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function authenticate() {
  try{return await api('/me');}catch(error){if(error.status!==401)throw error;}
  const {required}=await api('/setup');
  document.querySelector('#app').innerHTML=`<div class="auth-shell"><form id="auth" class="auth-card"><a class="board-logo" href="/">ember<span>✦</span></a><div class="eyebrow">RESTAURANT OPERATIONS</div><h1>${required?'Set up your restaurant':'Welcome back'}</h1><p>${required?'Create the owner account for this restaurant installation.':'Sign in to your restaurant workspace.'}</p>${required?'<label>Restaurant name<input name="restaurant" required maxlength="100" autocomplete="organization"></label><label>Your name<input name="name" required maxlength="100" autocomplete="name"></label>':''}<label>Email<input type="email" name="email" required autocomplete="username"></label><label>Password<input type="password" name="password" required minlength="12" maxlength="200" autocomplete="${required?'new-password':'current-password'}"></label>${required?'<p class="help">Use at least 12 characters. Sample menu items will be added for evaluation; configure your menu and tax before taking sales.</p>':''}<div id="auth-error" role="alert"></div><button class="checkout">${required?'Create restaurant':'Sign in'} →</button></form></div>`;
  return new Promise(resolve=>{document.querySelector('#auth').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await api(required?'/setup':'/login','POST',Object.fromEntries(new FormData(e.target)));resolve(await api('/me'));}catch(error){document.querySelector('#auth-error').textContent=error.message;button.disabled=false;}};});
}
