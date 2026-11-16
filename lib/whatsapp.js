import {stageLabel} from './customer-messaging.js';
import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {fail} from './store.js';
export function validSignature(raw,signature,secret){
 if(!secret||!/^sha256=[a-f0-9]{64}$/.test(signature||''))return false;
 return timingSafeEqual(Buffer.from(signature.slice(7),'hex'),createHmac('sha256',secret).update(raw).digest());
}
export function whatsappBot(store,ordering,config=process.env,sendFetch=fetch){
 const db=store.db,rid=Number(config.WHATSAPP_RESTAURANT_ID);
 const configured=()=>!!(rid&&config.WHATSAPP_APP_SECRET&&config.WHATSAPP_VERIFY_TOKEN&&config.WHATSAPP_ACCESS_TOKEN&&config.WHATSAPP_PHONE_NUMBER_ID&&/^v\d+\.\d+$/.test(config.WHATSAPP_API_VERSION||''));
 function requestedMenuPage(text){
  const phrase=text.toLowerCase().trim().replace(/[.!?]+$/g,'').replace(/\s+/g,' ').replace(/^(?:please |(?:can|could|would) you (?:please )?)/,'').replace(/,? please$/,'').trim();
  const match=phrase.match(/^(?:(?:(?:send|show|share)(?: (?:me|us))?|(?:can|could|may) i (?:see|have|get|view)|i (?:want|would like)(?: to (?:see|view))?) )?(?:(?:the|your|a) )?menu(?: (?:page )?(\d+))?(?: to browse dishes)?$/);
  return match?Number(match[1]||1):null;
 }
 function wantsPerson(text){
  const phrase=text.toLowerCase().replace(/[.!?,]+$/g,'').replace(/\s+/g,' ').trim();
  const person='(?:human|person|agent|staff|staff member|someone|representative|customer support|support agent)';
  return [
   `^(?:${person})(?: please)?$`,
   `^(?:please )?(?:connect|transfer)(?: me)? (?:to|with) (?:a |an |the )?${person}(?: please)?$`,
   `^(?:(?:i (?:want|need|would like) to|can i|could i|please) )?(?:talk|speak|chat) (?:to|with) (?:a |an |the )?${person}(?: please)?$`
  ].some(pattern=>new RegExp(pattern).test(phrase));
 }
 function respond(message){
  const phone=message.from,text=(message.text?.body||'').trim(),user={restaurant_id:rid};
  if(!store.restaurant(user))return 'This restaurant is not available yet.';
  const t=db.prepare('SELECT * FROM wa_threads WHERE restaurant_id=? AND phone=?').get(rid,phone);
  if(wantsPerson(text)){
   if(t.mode!=='bot')return '';
   db.prepare("UPDATE wa_threads SET mode='waiting' WHERE id=?").run(t.id);
   return 'I am the automated assistant. I have notified restaurant staff that you want to speak with a person. A staff member will reply here when available. Send BOT to return to automated ordering.';
  }
  if(/^bot$/i.test(text)){db.prepare("UPDATE wa_threads SET mode='bot' WHERE id=?").run(t.id);return 'You are back with the automated assistant. Send MENU to order or HUMAN for restaurant staff.';}
  if(/^stop$/i.test(text)){db.prepare('UPDATE wa_threads SET updates_allowed=0 WHERE id=?').run(t.id);return 'Automatic order updates stopped. You can still use your tracking link. Send UPDATES to enable them again.';}
  if(/^updates$/i.test(text)){db.prepare('UPDATE wa_threads SET updates_allowed=1 WHERE id=?').run(t.id);return 'WhatsApp order updates enabled. Send STOP to turn them off.';}
  if(t.mode!=='bot')return '';
  if(/^status\s+\d+$/i.test(text)){
   const request=db.prepare('SELECT * FROM customer_requests WHERE id=? AND restaurant_id=? AND source=?').get(Number(text.split(/\s+/)[1]),rid,'WhatsApp');
   if(!request||!JSON.parse(request.body).customer.endsWith(`(+${phone})`))return 'Request not found for your phone number.';
   const o=request.order_id?store.getOrder(user,request.order_id):null;
   return `Request #${request.id}: ${o?stageLabel(o.type,o.status):request.status}${o?' · POS order #'+o.id:''}.`;
  }
  if(/^cancel$/i.test(text)){db.prepare('DELETE FROM whatsapp_drafts WHERE phone=?').run(phone);return 'Draft cancelled. Send MENU to start again.';}
  if(/^confirm$/i.test(text)){
   const draft=db.prepare('SELECT * FROM whatsapp_drafts WHERE phone=?').get(phone);
   if(!draft||Date.now()-draft.created_at>30*60*1000)return 'Your draft has expired or is empty. Send MENU to start.';
   const input=JSON.parse(draft.body);input.customerPhone=phone;input.whatsappUpdates=t.updates_allowed===1;const result=ordering.submit(rid,'WhatsApp',`wa:${createHash('sha256').update(message.id).digest('hex')}`,input);
   db.prepare('DELETE FROM whatsapp_drafts WHERE phone=?').run(phone);
   return `Request #${result.id} sent to restaurant staff for acceptance. Payment is due later. Please contact the restaurant if you need to change it. This is not yet a confirmed order. Send STATUS ${result.id} to check progress.${config.PUBLIC_BASE_URL?' Track: '+new URL('/track.html?request='+result.trackingToken,config.PUBLIC_BASE_URL).href:''}`;
  }
  if(/^order\s/i.test(text)){
   const [lines,type,name,address='']=text.slice(6).split('|').map(s=>s.trim());
   const types={takeaway:'Takeaway',delivery:'Delivery','dine-in':'Dine-in'},service=types[(type||'').toLowerCase()];
   if(!service||!name||name.length>100||(service==='Delivery'&&!address))return 'Use: ORDER 1x2, 3x1 | Delivery | Your name | Full address\nOr use Takeaway or Dine-in (include your table in the last field).';
   if(service==='Dine-in'&&!address)return 'Please include your table number after your name.';
   const items=lines.split(',').map(s=>{const m=s.trim().match(/^(\d+)\s*x\s*(\d+)$/i);if(!m)fail('Use itemID x quantity, for example 1x2, 3x1.');return {id:Number(m[1]),qty:Number(m[2])};});
   if(items.length>20)return 'Please include at most 20 different items in one WhatsApp order.';
   const q=ordering.quote(rid,{items,type:service,customer:`${name} (+${phone})`,note:address});
   const input={...q,items:q.items.map(p=>({id:p.id,qty:p.qty})),expectedTotal:q.total};
   db.prepare('INSERT INTO whatsapp_drafts(phone,body,created_at) VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET body=excluded.body,created_at=excluded.created_at').run(phone,JSON.stringify(input),Date.now());
   return `${q.type}\n${q.items.map(p=>`${p.qty} x ${p.name}`).join('\n')}\n${address}\nTotal PKR ${q.total.toFixed(2)}\nReply CONFIRM within 30 minutes to send this request, or CANCEL. Payment is due later. Confirming also requests WhatsApp order progress updates for takeaway/delivery. Send STOP to stop updates.`;
  }
  const requestedPage=requestedMenuPage(text);
  if(requestedPage===null){
   if(/^(hi|hello|hey|salam|assalam[ -]?o[ -]?alaikum)[.!?]*$/i.test(text))return 'How can I help? Reply with MENU (or "send me the menu") to browse dishes, or HUMAN to speak with restaurant staff.';
   return 'I did not understand that message. Send MENU to browse dishes, STATUS followed by your request number to track an order, or HUMAN to speak with a person.';
  }
  const menu=store.menu(user).filter(p=>p.available),header=`${store.restaurant(user).name}\nMenu (PKR, before tax):\n`;
  const page=requestedPage,pages=Math.max(1,Math.ceil(menu.length/20));
  if(!Number.isSafeInteger(page)||page<1||page>pages)return `There are ${pages} menu pages. Send MENU or MENU followed by a valid page number.`;
  const rows=menu.slice((page-1)*20,page*20).map(p=>`${p.id}: ${p.name} — ${p.price.toFixed(2)}`);
  const help='\nSend HUMAN to speak with restaurant staff.\nOrder with item IDs and quantities:\nORDER 1x2, 3x1 | Delivery | Your name | Full address\nUse Takeaway for pickup, or Dine-in with your table number. We show the total before you CONFIRM. Send CANCEL to clear a draft.';
  let body=header;for(const row of rows){if((body+row+help).length>3600)break;body+=row+'\n';}
  return body+`Page ${page} of ${pages}. ${page<pages?'Send MENU '+(page+1)+' for more.':''}`+help;
 }
 return {configured,async receive(payload){
  if(!configured())fail('WhatsApp is not configured',503);
  for(const entry of payload.entry||[])for(const change of entry.changes||[]){const value=change.value;
   if(value?.metadata?.phone_number_id!==config.WHATSAPP_PHONE_NUMBER_ID)continue;
   for(const status of value.statuses||[]){
    if(!['sent','delivered','read','failed'].includes(status.status))continue;
    const current=db.prepare('SELECT id,state FROM wa_outbox WHERE restaurant_id=? AND provider_id=?').get(rid,status.id);
    if(current){const ranks={sent:1,delivered:2,read:3};if(status.status==='failed'&&!['delivered','read'].includes(current.state))db.prepare("UPDATE wa_outbox SET state='failed',error='Meta reported delivery failure' WHERE id=?").run(current.id);else if((ranks[status.status]||0)>(ranks[current.state]||0))db.prepare('UPDATE wa_outbox SET state=?,error=? WHERE id=?').run(status.status,'',current.id);}
   }
   for(const message of value.messages||[]){
    if(typeof message.id!=='string'||!/^\d{6,15}$/.test(message.from||''))continue;
    let cached=db.prepare('SELECT * FROM whatsapp_messages WHERE id=?').get(message.id);
    if(cached?.sent)continue;
    if(!cached){db.exec('BEGIN IMMEDIATE');try{
      const first=!db.prepare('SELECT id FROM wa_threads WHERE restaurant_id=? AND phone=?').get(rid,message.from);
      db.prepare('INSERT INTO wa_threads(restaurant_id,phone,last_inbound) VALUES(?,?,?) ON CONFLICT(restaurant_id,phone) DO UPDATE SET last_inbound=excluded.last_inbound').run(rid,message.from,Date.now());
      const t=db.prepare('SELECT * FROM wa_threads WHERE restaurant_id=? AND phone=?').get(rid,message.from);
      db.prepare('INSERT INTO wa_chat(thread_id,direction,body,provider_id,created_at) VALUES(?,?,?,?,?)').run(t.id,'customer',message.text?.body||'[Non-text message: please ask the customer to send text]',message.id,new Date().toISOString());
      let reply;try{reply=respond(message);if(first)reply=`Welcome to ${store.restaurant({restaurant_id:rid})?.name||'our restaurant'}! I am the automated ordering assistant. Send HUMAN at any time to request a person.\n\n`+reply;}catch(e){if(!e.status)throw e;reply=e.message+' Send MENU to try again.';}
      if(reply)db.prepare('INSERT INTO wa_chat(thread_id,direction,body,created_at) VALUES(?,?,?,?)').run(t.id,'bot',reply,new Date().toISOString());
      db.prepare('INSERT INTO whatsapp_messages(id,reply) VALUES(?,?)').run(message.id,reply);db.exec('COMMIT');cached={reply};
     }catch(e){db.exec('ROLLBACK');throw e;}}
    if(!cached.reply){db.prepare('UPDATE whatsapp_messages SET sent=1 WHERE id=?').run(message.id);continue;}
    const response=await sendFetch(`https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:message.from,type:'text',text:{body:cached.reply}}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)fail('WhatsApp reply failed; webhook will retry',502);
    db.prepare('UPDATE whatsapp_messages SET sent=1 WHERE id=?').run(message.id);
   }
  }
 }};
}
