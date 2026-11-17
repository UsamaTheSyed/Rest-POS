import {fail,required} from './store.js';
export const stageLabel=(type,status)=>({queued:'Order accepted',preparing:'Preparing your order',ready:type==='Takeaway'?'Ready for pickup':'Ready',out_for_delivery:'Out for delivery',served:type==='Delivery'?'Delivered':type==='Takeaway'?'Collected':'Served',updated:'Order updated',paid:'Payment recorded',rejected:'Order request declined'}[status]||status);
export function contactInput(input){
 const phone=typeof input.customerPhone==='string'?input.customerPhone.replace(/[+\s()-]/g,''):'';
 if(phone&&!/^[1-9]\d{7,14}$/.test(phone))fail('Enter a phone number with country code, for example +923001234567');
 if(input.whatsappUpdates!==undefined&&typeof input.whatsappUpdates!=='boolean')fail('Invalid WhatsApp consent');
 if(input.whatsappUpdates&&!phone)fail('A customer phone number is required for WhatsApp updates');
 return {customerPhone:phone,whatsappUpdates:input.whatsappUpdates===true};
}
export function installMessaging(db){
 const cols=db.prepare('PRAGMA table_info(orders)').all();
 if(!cols.some(c=>c.name==='customer_phone'))db.exec("ALTER TABLE orders ADD COLUMN customer_phone TEXT NOT NULL DEFAULT ''; ALTER TABLE orders ADD COLUMN whatsapp_updates INTEGER NOT NULL DEFAULT 0;");
 db.exec(`CREATE TABLE IF NOT EXISTS order_tracking(order_id INTEGER PRIMARY KEY REFERENCES orders(id),token TEXT NOT NULL UNIQUE);
 CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),stage TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS wa_threads(id INTEGER PRIMARY KEY,restaurant_id INTEGER NOT NULL,phone TEXT NOT NULL,mode TEXT NOT NULL DEFAULT 'bot',last_inbound INTEGER NOT NULL DEFAULT 0,updates_allowed INTEGER NOT NULL DEFAULT 1,UNIQUE(restaurant_id,phone));
 CREATE TABLE IF NOT EXISTS wa_chat(id INTEGER PRIMARY KEY,thread_id INTEGER NOT NULL REFERENCES wa_threads(id),direction TEXT NOT NULL,body TEXT NOT NULL,provider_id TEXT UNIQUE,staff_id INTEGER,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS wa_outbox(id INTEGER PRIMARY KEY,restaurant_id INTEGER NOT NULL,phone TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,order_id INTEGER,stage TEXT,tracking_token TEXT,event_key TEXT NOT NULL UNIQUE,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,provider_id TEXT,error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
 INSERT OR IGNORE INTO order_tracking SELECT id,lower(hex(randomblob(24))) FROM orders;
 CREATE TRIGGER IF NOT EXISTS track_order_insert AFTER INSERT ON orders BEGIN
 INSERT INTO order_tracking(order_id,token) VALUES(NEW.id,lower(hex(randomblob(24))));
 INSERT INTO order_events(order_id,stage,created_at) VALUES(NEW.id,'queued',NEW.created_at); END;
 CREATE TRIGGER IF NOT EXISTS track_order_change AFTER UPDATE OF status,revision ON orders WHEN OLD.status!=NEW.status OR OLD.revision!=NEW.revision BEGIN
 INSERT INTO order_events(order_id,stage,created_at) VALUES(NEW.id,CASE WHEN OLD.revision!=NEW.revision THEN 'updated' ELSE NEW.status END,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
 CREATE TRIGGER IF NOT EXISTS track_order_paid AFTER UPDATE OF paid_at ON orders WHEN OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL BEGIN
 INSERT INTO order_events(order_id,stage,created_at) VALUES(NEW.id,'paid',NEW.paid_at); END;`);
}
export function customerMessaging(store,config=process.env,sendFetch=fetch){
 const db=store.db;let flushing=false;
 const staff=u=>{if(!['owner','cashier'].includes(u.role))fail('Cashier access required',403);};
 const thread=(u,id)=>{staff(u);const t=db.prepare('SELECT * FROM wa_threads WHERE restaurant_id=? AND id=?').get(u.restaurant_id,id);if(!t)fail('Conversation not found',404);return t;};
 const enqueue=(rid,phone,kind,body,key)=>db.prepare('INSERT OR IGNORE INTO wa_outbox(restaurant_id,phone,kind,body,event_key,created_at) VALUES(?,?,?,?,?,?)').run(rid,phone,kind,body,key,new Date().toISOString());
 function sync(){
  db.exec(`INSERT OR IGNORE INTO wa_outbox(restaurant_id,phone,kind,body,order_id,stage,tracking_token,event_key,created_at)
   SELECT o.restaurant_id,o.customer_phone,'tracking','',o.id,e.stage,t.token,'order-event:'||e.id,e.created_at FROM order_events e JOIN orders o ON o.id=e.order_id JOIN order_tracking t ON t.order_id=o.id WHERE o.whatsapp_updates=1 AND o.customer_phone!='' AND o.type IN ('Takeaway','Delivery');`);
 }
 function link(token){if(!config.PUBLIC_BASE_URL)return '';try{return new URL('/track.html?token='+token,config.PUBLIC_BASE_URL).href;}catch{return '';}}
 return {sync,link,
  tracking(token){
   const o=db.prepare('SELECT o.*,r.name AS restaurant FROM orders o JOIN order_tracking t ON t.order_id=o.id JOIN restaurants r ON r.id=o.restaurant_id WHERE t.token=?').get(token);
   if(!o)fail('Tracking link not found',404);
   return {orderId:o.id,restaurant:o.restaurant,type:o.type,status:stageLabel(o.type,o.status),paid:!!o.paid_at,total:o.total/100,events:db.prepare('SELECT stage,created_at FROM order_events WHERE order_id=? ORDER BY id').all(o.id).map(e=>({status:stageLabel(o.type,e.stage),at:e.created_at}))};
  },
  inbox(u){staff(u);sync();return {threads:db.prepare("SELECT * FROM wa_threads WHERE restaurant_id=? ORDER BY last_inbound DESC, id DESC").all(u.restaurant_id),outbox:db.prepare('SELECT id,phone,kind,order_id,state,error,created_at FROM wa_outbox WHERE restaurant_id=? ORDER BY id DESC LIMIT 50').all(u.restaurant_id)};},
  conversation(u,id){const t=thread(u,id);return {...t,messages:db.prepare('SELECT id,direction,body,created_at FROM wa_chat WHERE thread_id=? ORDER BY id DESC LIMIT 100').all(id).reverse()};},
  reply(u,id,input){const t=thread(u,id);if(t.mode==='bot')fail('Customer is using the bot. Wait for a staff request.',409);
   if(Date.now()-t.last_inbound>=86400000)fail('The WhatsApp reply window has closed. Ask the customer to message again.',409);
   const body=required(input.message,'message',2000),key='staff:'+u.restaurant_id+':'+required(input.requestKey,'request key',80);
   const old=db.prepare('SELECT * FROM wa_outbox WHERE event_key=?').get(key);if(old){if(old.phone!==t.phone||old.body!==body)fail('Request key already used',409);return {ok:true};}
   db.exec('BEGIN IMMEDIATE');try{db.prepare("UPDATE wa_threads SET mode='active' WHERE id=?").run(id);db.prepare('INSERT INTO wa_chat(thread_id,direction,body,staff_id,created_at) VALUES(?,?,?,?,?)').run(id,'staff',body,u.id,new Date().toISOString());enqueue(u.restaurant_id,t.phone,'staff',body,key);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {ok:true};
  },
  retry(u,id){staff(u);const row=db.prepare('SELECT * FROM wa_outbox WHERE restaurant_id=? AND id=?').get(u.restaurant_id,id);if(!row)fail('Message not found',404);if(['failed','blocked','retry'].includes(row.state))db.prepare("UPDATE wa_outbox SET state='pending',attempts=0,next_attempt=0,error='' WHERE id=?").run(id);return {ok:true};},
  resume(u,id){const t=thread(u,id);db.prepare("UPDATE wa_threads SET mode='bot' WHERE id=?").run(t.id);enqueue(u.restaurant_id,t.phone,'staff','Our automated assistant is back. Send MENU to order, or HUMAN to ask for a staff member.','resume:'+t.id+':'+Date.now());return {ok:true};},
  async flush(){if(flushing)return;flushing=true;try{
   sync();const rows=db.prepare("SELECT * FROM wa_outbox WHERE state IN ('pending','retry','blocked') AND next_attempt<=? ORDER BY id LIMIT 30").all(Date.now());
   for(const row of rows){
    if(row.order_id&&db.prepare("SELECT id FROM wa_outbox WHERE order_id=? AND id<? AND state IN ('pending','retry','blocked','failed') LIMIT 1").get(row.order_id,row.id))continue;
    const block=reason=>db.prepare("UPDATE wa_outbox SET state='blocked',error=?,next_attempt=? WHERE id=?").run(reason,Date.now()+60000,row.id);
    if(Number(config.WHATSAPP_RESTAURANT_ID)!==row.restaurant_id||!config.WHATSAPP_ACCESS_TOKEN||!config.WHATSAPP_PHONE_NUMBER_ID||!/^v\d+\.\d+$/.test(config.WHATSAPP_API_VERSION||'')){block('WhatsApp is not configured for this restaurant');continue;}
    const t=db.prepare('SELECT * FROM wa_threads WHERE restaurant_id=? AND phone=?').get(row.restaurant_id,row.phone);
    if(row.kind==='tracking'&&t?.updates_allowed===0){db.prepare("UPDATE wa_outbox SET state='cancelled',error='Customer stopped updates' WHERE id=?").run(row.id);continue;}
    const windowOpen=t&&Date.now()-t.last_inbound<86400000;
    const description=row.kind==='tracking'?stageLabel(db.prepare('SELECT type FROM orders WHERE id=?').get(row.order_id)?.type,row.stage):'';
    const url=row.tracking_token?link(row.tracking_token):'';
    const body=row.kind==='tracking'?`Order #${row.order_id}: ${description}.${url?' Track your order: '+url:''}`:row.body;
    let payload={messaging_product:'whatsapp',to:row.phone,type:'text',text:{body}};
    if(!windowOpen){
     if(row.kind!=='tracking'||!config.WHATSAPP_STATUS_TEMPLATE||!config.WHATSAPP_TEMPLATE_LANGUAGE||!url){block('Customer must message again, or configure an approved order-status template and PUBLIC_BASE_URL');continue;}
     payload={messaging_product:'whatsapp',to:row.phone,type:'template',template:{name:config.WHATSAPP_STATUS_TEMPLATE,language:{code:config.WHATSAPP_TEMPLATE_LANGUAGE},components:[{type:'body',parameters:[String(row.order_id),description,url].map(text=>({type:'text',text}))}]}};
    }
    try{
     const response=await sendFetch(`https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
     let result={};try{result=await response.json();}catch{}
     if(!response.ok)throw new Error('Meta rejected message'+(result.error?.code?' (code '+result.error.code+')':''));
     db.prepare("UPDATE wa_outbox SET state='sent',provider_id=?,error='',attempts=attempts+1 WHERE id=?").run(result.messages?.[0]?.id||null,row.id);
    }catch(e){const attempts=row.attempts+1;db.prepare("UPDATE wa_outbox SET state=?,attempts=?,next_attempt=?,error=? WHERE id=?").run(attempts>=5?'failed':'retry',attempts,Date.now()+Math.min(300000,10000*2**attempts),e.name==='TimeoutError'?'Message send timed out':e.message,row.id);}
   }
  }finally{flushing=false;}}
 };
}
