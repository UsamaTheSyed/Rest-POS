import {api,html} from './api.js';

// Keep unsent replies when staff switch between conversations or dashboard pages.
const drafts=new Map();
let rememberedId=null;
const stamp=value=>new Date(value).toLocaleTimeString('en-PK',{timeZone:'Asia/Karachi',hour:'2-digit',minute:'2-digit'});
const date=value=>new Date(value).toLocaleDateString('en-PK',{timeZone:'Asia/Karachi',day:'numeric',month:'short',year:'numeric'});
export async function messagesView(reload,alertError){
 let inbox=await api('/conversations'),selected=null,disposed=false,version=0;
 const state=id=>{if(!drafts.has(id))drafts.set(id,{text:'',pending:null,sending:false});return drafts.get(id);};
 return {
 markup:`<div class="messenger"><section class="messenger-list" aria-label="Conversations"><div class="inbox-heading"><div><h2>Messages</h2><span id="conversation-count"></span></div><button id="refresh-chat" class="muted-button" aria-label="Refresh inbox">↻</button></div><label class="chat-search"><span class="sr-only">Search customer phone</span><input id="chat-search" type="search" placeholder="Search phone number…"></label><div class="inbox-caption">ALL CONVERSATIONS</div><div id="conversation-list"></div><p class="inbox-help">All WhatsApp conversations stay here, including bot chats. The status shows who is handling each customer.</p></section><section class="messenger-detail" id="chat-detail" aria-label="Selected conversation"><div class="chat-empty"><span aria-hidden="true">✉</span><h2>Your customer conversations</h2><p>Select a conversation to read messages and reply through WhatsApp.</p></div></section></div><details class="ops-panel delivery-panel"><summary>Message delivery <span>${inbox.outbox.length} recent messages</span></summary><p class="subtitle">Sent means submitted to WhatsApp. Delivered and read are shown only after Meta confirms them.</p><table><thead><tr><th>Customer</th><th>Message</th><th>Status</th><th>Details</th></tr></thead><tbody>${inbox.outbox.map(m=>`<tr><td>+${html(m.phone)}</td><td>${html(m.kind)}${m.order_id?' #'+m.order_id:''}</td><td><span class="delivery-state">${html(m.state)}</span></td><td>${html(m.error)}${['failed','blocked','retry'].includes(m.state)?` <button data-retry-message="${m.id}">Retry</button>`:''}</td></tr>`).join('')||'<tr><td colspan="4">No outgoing messages yet.</td></tr>'}</tbody></table></details>`,
 dispose(){disposed=true;version++;},
 bind(){
 const root=document.querySelector('.messenger'),panel=root.querySelector('#chat-detail');
 function list(){
  const query=root.querySelector('#chat-search').value.trim().replace(/^\+/,''),threads=inbox.threads.filter(t=>t.phone.includes(query));
  root.querySelector('#conversation-count').textContent=`${inbox.threads.length} conversations`;
  root.querySelector('#conversation-list').innerHTML=threads.map(t=>`<button class="conversation-row ${selected===t.id?'selected':''}" data-thread="${t.id}" aria-pressed="${selected===t.id}"><span class="chat-avatar">${html(t.phone.slice(-2))}</span><span class="conversation-info"><strong>+${html(t.phone)}</strong><span>${t.mode==='bot'?'Bot active':t.mode==='waiting'?'Waiting for staff':'Staff active'}</span></span><span class="conversation-meta"><time>${stamp(t.last_inbound)}</time><span class="thread-dot ${t.mode}" aria-label="${html(t.mode)}"></span></span></button>`).join('')||'<p class="inbox-empty">No conversations found.</p>';
  root.querySelectorAll('[data-thread]').forEach(b=>b.onclick=()=>show(Number(b.dataset.thread)).catch(alertError));
 }
 async function show(id){
  const request=++version;selected=id;rememberedId=id;list();
  const t=await api('/conversations/'+id);if(disposed||request!==version)return;
  const draft=state(id);
  panel.innerHTML=`<header class="conversation-header"><button id="back-chats" class="muted-button" aria-label="Back to conversations">←</button><span class="chat-avatar">${html(t.phone.slice(-2))}</span><div><h2>+${html(t.phone)}</h2><p>${t.mode==='bot'?'Automated assistant active':'WhatsApp · Staff conversation'}</p></div><button id="refresh-thread" class="muted-button" aria-label="Refresh conversation">↻</button></header><div class="handoff-banner"><span>${t.mode==='bot'?'Bot active · You can view this conversation':'Staff active · Automated replies paused'}</span><button id="resume-bot" ${t.mode==='bot'?'disabled':''}>Resume bot</button></div><div class="message-stream" tabindex="0" aria-label="Message history">${transcript(t.messages)}</div><form id="staff-reply" class="message-composer"><label class="sr-only" for="message-text">Your reply</label><textarea id="message-text" name="message" required maxlength="2000" rows="3" placeholder="${t.mode==='bot'?'The bot is handling this conversation':'Write a reply…'}" ${draft.sending||draft.pending||t.mode==='bot'?'disabled':''}>${html(draft.text)}</textarea><div class="composer-bottom"><span>WhatsApp reply · Shift + Enter for a new line</span><button type="submit" ${draft.sending||t.mode==='bot'?'disabled':''}>${draft.pending?'Retry reply':'Send reply'} ↗</button></div><p id="chat-feedback" role="status"></p></form>`;
  root.classList.add('conversation-open');
  const stream=panel.querySelector('.message-stream');stream.scrollTop=stream.scrollHeight;
  const textarea=panel.querySelector('textarea'),form=panel.querySelector('form'),feedback=panel.querySelector('#chat-feedback');
  textarea.oninput=()=>{draft.text=textarea.value;};
  textarea.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();form.requestSubmit();}};
  panel.querySelector('#back-chats').onclick=()=>{root.classList.remove('conversation-open');root.querySelector(`[data-thread="${id}"]`)?.focus();};
  panel.querySelector('#refresh-thread').onclick=()=>show(id).catch(alertError);
  panel.querySelector('#resume-bot').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{await api('/conversations/'+id+'/resume','POST',{});drafts.delete(id);if(!disposed)await reload();}catch(e){if(!disposed){alertError(e);button.disabled=false;}}};
  form.onsubmit=async e=>{
   e.preventDefault();if(t.mode==='bot'||draft.sending||(!draft.pending&&!textarea.value.trim()))return;
   draft.pending=draft.pending||{message:textarea.value,requestKey:crypto.randomUUID()};draft.text=draft.pending.message;draft.sending=true;
   textarea.disabled=true;form.querySelector('button').disabled=true;feedback.textContent='Queuing reply…';
   try{await api('/conversations/'+id+'/reply','POST',draft.pending);draft.pending=null;draft.text='';draft.sending=false;if(!disposed&&selected===id){await show(id);panel.querySelector('#chat-feedback').textContent='Reply queued for WhatsApp. Check Message delivery for its status.';}}
   catch(error){draft.sending=false;if(error.status&&error.status<500)draft.pending=null;if(!disposed&&selected===id){textarea.disabled=!!draft.pending;form.querySelector('button').disabled=false;form.querySelector('button').textContent=draft.pending?'Retry reply':'Send reply';feedback.textContent=error.message;}}
  };
 }
 async function refresh(){const button=root.querySelector('#refresh-chat');button.disabled=true;try{inbox=await api('/conversations');if(disposed)return;list();if(selected)await show(selected);}catch(e){if(!disposed)alertError(e);}finally{button.disabled=false;}}
 root.querySelector('#chat-search').oninput=list;
 root.querySelector('#refresh-chat').onclick=refresh;
 document.querySelectorAll('[data-retry-message]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/messages/'+b.dataset.retryMessage+'/retry','POST',{});if(!disposed)await reload();}catch(e){if(!disposed){alertError(e);b.disabled=false;}}});
 list();if(rememberedId&&inbox.threads.some(t=>t.id===rememberedId))show(rememberedId).catch(alertError);
 }
 };
}
function transcript(messages){
 let previous='';
 return messages.map(m=>{const day=date(m.created_at),divider=day!==previous?`<div class="message-day">${day}</div>`:'';previous=day;return `${divider}<article class="message-bubble ${m.direction==='customer'?'incoming':'outgoing'}"><span class="message-author">${m.direction==='customer'?'Customer':m.direction==='bot'?'Automated assistant':'Restaurant staff'}</span><p>${html(m.body)}</p><time>${stamp(m.created_at)}</time></article>`;}).join('')||'<div class="chat-empty"><p>No messages yet. Start the conversation below.</p></div>';
}
