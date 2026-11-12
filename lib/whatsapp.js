import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
import {fail} from './store.js';
export function validSignature(raw,signature,secret){
 if(!secret||!/^sha256=[a-f0-9]{64}$/.test(signature||''))return false;
 return timingSafeEqual(Buffer.from(signature.slice(7),'hex'),createHmac('sha256',secret).update(raw).digest());
}
export function whatsappBot(store,ordering,config=process.env,sendFetch=fetch){
 const db=store.db,rid=Number(config.WHATSAPP_RESTAURANT_ID);
 const configured=()=>!!(rid&&config.WHATSAPP_APP_SECRET&&config.WHATSAPP_VERIFY_TOKEN&&config.WHATSAPP_ACCESS_TOKEN&&config.WHATSAPP_PHONE_NUMBER_ID&&/^v\d+\.\d+$/.test(config.WHATSAPP_API_VERSION||''));
 function respond(message){
  const phone=message.from,text=(message.text?.body||'').trim(),user={restaurant_id:rid};
  if(!store.restaurant(user))return 'This restaurant is not available yet.';
  if(/^status\s+\d+$/i.test(text)){
   const request=db.prepare('SELECT * FROM customer_requests WHERE id=? AND restaurant_id=? AND source=?').get(Number(text.split(/\s+/)[1]),rid,'WhatsApp');
   if(!request||!JSON.parse(request.body).customer.endsWith(`(+${phone})`))return 'Request not found for your phone number.';
   return `Request #${request.id}: ${request.status}${request.order_id?' · POS order #'+request.order_id:''}.`;
  }
  if(/^cancel$/i.test(text)){db.prepare('DELETE FROM whatsapp_drafts WHERE phone=?').run(phone);return 'Draft cancelled. Send MENU to start again.';}
  if(/^confirm$/i.test(text)){
   const draft=db.prepare('SELECT * FROM whatsapp_drafts WHERE phone=?').get(phone);
   if(!draft||Date.now()-draft.created_at>30*60*1000)return 'Your draft has expired or is empty. Send MENU to start.';
   const input=JSON.parse(draft.body),result=ordering.submit(rid,'WhatsApp',`wa:${createHash('sha256').update(message.id).digest('hex')}`,input);
   db.prepare('DELETE FROM whatsapp_drafts WHERE phone=?').run(phone);
   return `Request #${result.id} sent to restaurant staff for acceptance. Payment is due later. Please contact the restaurant if you need to change it. This is not yet a confirmed order. Send STATUS ${result.id} to check acceptance.`;
  }
  if(/^order\s/i.test(text)){
   const [lines,type,name,address='']=text.slice(6).split('|').map(s=>s.trim());
   const types={takeaway:'Takeaway',delivery:'Delivery','dine-in':'Dine-in'},service=types[(type||'').toLowerCase()];
   if(!service||!name||name.length>100||(service==='Delivery'&&!address))return 'Use: ORDER 1x2, 3x1 | Delivery | Your name | Full address\nOr use Takeaway or Dine-in (include your table in the last field).';
   if(service==='Dine-in'&&!address)return 'Please include your table number after your name.';
   const items=lines.split(',').map(s=>{const m=s.trim().match(/^(\d+)\s*x\s*(\d+)$/i);if(!m)fail('Use itemID x quantity, for example 1x2, 3x1.');return {id:Number(m[1]),qty:Number(m[2])};});
   const q=ordering.quote(rid,{items,type:service,customer:`${name} (+${phone})`,note:address});
   const input={...q,items:q.items.map(p=>({id:p.id,qty:p.qty})),expectedTotal:q.total};
   db.prepare('INSERT INTO whatsapp_drafts(phone,body,created_at) VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET body=excluded.body,created_at=excluded.created_at').run(phone,JSON.stringify(input),Date.now());
   return `${q.type}\n${q.items.map(p=>`${p.qty} x ${p.name}`).join('\n')}\n${address}\nTotal PKR ${q.total.toFixed(2)}\nReply CONFIRM within 30 minutes to send this request, or CANCEL. Payment is due later.`;
  }
  const menu=store.menu(user).filter(p=>p.available),header=`${store.restaurant(user).name}\nMenu (PKR, before tax):\n`;
  const page=Math.max(1,Number(text.match(/^menu\s+(\d+)$/i)?.[1]||1)),pages=Math.max(1,Math.ceil(menu.length/20));
  const rows=menu.slice((page-1)*20,page*20).map(p=>`${p.id}: ${p.name} — ${p.price.toFixed(2)}`);
  const help='\nOrder with item IDs and quantities:\nORDER 1x2, 3x1 | Delivery | Your name | Full address\nUse Takeaway for pickup, or Dine-in with your table number. We show the total before you CONFIRM. Send CANCEL to clear a draft.';
  let body=header;for(const row of rows){if((body+row+help).length>3900)break;body+=row+'\n';}
  return body+`Page ${page} of ${pages}. ${page<pages?'Send MENU '+(page+1)+' for more.':''}`+help;
 }
 return {configured,async receive(payload){
  if(!configured())fail('WhatsApp is not configured',503);
  for(const entry of payload.entry||[])for(const change of entry.changes||[]){const value=change.value;
   if(value?.metadata?.phone_number_id!==config.WHATSAPP_PHONE_NUMBER_ID)continue;
   for(const message of value.messages||[]){
    if(typeof message.id!=='string'||!/^\d{6,15}$/.test(message.from||''))continue;
    let cached=db.prepare('SELECT * FROM whatsapp_messages WHERE id=?').get(message.id);
    if(cached?.sent)continue;
    if(!cached){db.exec('BEGIN IMMEDIATE');try{
      let reply;try{reply=respond(message);}catch(e){if(!e.status)throw e;reply=e.message+' Send MENU to try again.';}
      db.prepare('INSERT INTO whatsapp_messages(id,reply) VALUES(?,?)').run(message.id,reply);db.exec('COMMIT');cached={reply};
     }catch(e){db.exec('ROLLBACK');throw e;}}
    const response=await sendFetch(`https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:message.from,type:'text',text:{body:cached.reply}}),signal:AbortSignal.timeout(10000)});
    if(!response.ok)fail('WhatsApp reply failed; webhook will retry',502);
    db.prepare('UPDATE whatsapp_messages SET sent=1 WHERE id=?').run(message.id);
   }
  }
 }};
}
