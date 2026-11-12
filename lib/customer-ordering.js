import {randomBytes} from 'node:crypto';
import {fail,required} from './store.js';
export function customerOrdering(store){
 const db=store.db;
 db.exec(`CREATE TABLE IF NOT EXISTS customer_tables(token TEXT PRIMARY KEY,restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),label TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS customer_requests(id INTEGER PRIMARY KEY,restaurant_id INTEGER NOT NULL,request_key TEXT NOT NULL,source TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',order_id INTEGER,created_at TEXT NOT NULL,UNIQUE(restaurant_id,request_key));
 CREATE TABLE IF NOT EXISTS whatsapp_messages(id TEXT PRIMARY KEY,reply TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS whatsapp_drafts(phone TEXT PRIMARY KEY,body TEXT NOT NULL,created_at INTEGER NOT NULL);`);
 const staff=u=>{if(!['owner','cashier'].includes(u.role))fail('Cashier access required',403);};
 const table=token=>{const row=db.prepare('SELECT * FROM customer_tables WHERE token=? AND enabled=1').get(token);if(!row)fail('Table menu is unavailable',404);return row;};
 function quote(restaurantId,input){
  if(!['Dine-in','Takeaway','Delivery'].includes(input.type))fail('Invalid service type');
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>50)fail('Choose 1–50 items');
  const seen=new Set(),menu=store.menu({restaurant_id:restaurantId});
  const items=input.items.map(i=>{if(!i||!Number.isInteger(i.qty)||i.qty<1||i.qty>99||seen.has(i.id))fail('Invalid quantity or repeated item');seen.add(i.id);const p=menu.find(p=>p.id===i.id&&p.available);if(!p)fail('An item is unavailable');return {id:p.id,name:p.name,price:p.price,qty:i.qty};});
  const subtotal=items.reduce((s,p)=>s+Math.round(p.price*100)*p.qty,0),tax=Math.round(subtotal*store.restaurant({restaurant_id:restaurantId}).tax_bps/10000);
  const customer=required(input.customer,'table/customer',200),note=typeof input.note==='string'?input.note.trim():'';
  if(note.length>700)fail('Note is too long');if(subtotal>100000000)fail('Order is too large');
  return {type:input.type,customer,note,items,total:(subtotal+tax)/100};
 }
 function submit(restaurantId,source,key,input){
  key=required(key,'request key',80);
  const fingerprint=JSON.stringify(input),old=db.prepare('SELECT * FROM customer_requests WHERE restaurant_id=? AND request_key=?').get(restaurantId,key);
  if(old){if(JSON.parse(old.body).fingerprint!==fingerprint)fail('Request key already used',409);return {id:old.id,status:old.status};}
  const q=quote(restaurantId,input);if(input.expectedTotal!==q.total)fail('Prices changed. Refresh the menu before ordering.',409);
  const pending=db.prepare("SELECT count(*) AS n FROM customer_requests WHERE restaurant_id=? AND status='pending'").get(restaurantId).n;
  if(pending>=200)fail('Restaurant is busy. Please contact staff.',429);
  const id=Number(db.prepare('INSERT INTO customer_requests(restaurant_id,request_key,source,body,created_at) VALUES(?,?,?,?,?)').run(restaurantId,key,source,JSON.stringify({...q,fingerprint}),new Date().toISOString()).lastInsertRowid);
  return {id,status:'pending'};
 }
 return {
  quote,submit,
  tables(u){staff(u);return db.prepare('SELECT * FROM customer_tables WHERE restaurant_id=? ORDER BY label').all(u.restaurant_id);},
  addTable(u,input){if(u.role!=='owner')fail('Owner access required',403);const label=required(input.label,'table name',60),token=randomBytes(24).toString('hex');db.prepare('INSERT INTO customer_tables(token,restaurant_id,label) VALUES(?,?,?)').run(token,u.restaurant_id,label);return {token,label};},
  disableTable(u,token){if(u.role!=='owner')fail('Owner access required',403);db.prepare('UPDATE customer_tables SET enabled=0 WHERE restaurant_id=? AND token=?').run(u.restaurant_id,token);return {ok:true};},
  menu(token){const t=table(token),u={restaurant_id:t.restaurant_id};return {restaurant:store.restaurant(u).name,table:t.label,taxBps:store.restaurant(u).tax_bps,items:store.menu(u).filter(p=>p.available).map(p=>({...p,image:p.image.startsWith('/api/menu-images/')?`/api/customer/${token}/images/${p.image.split('/').pop()}`:p.image}))};},
  image(token,id){return store.menuImage({restaurant_id:table(token).restaurant_id},id);},
  place(token,input){const t=table(token);return submit(t.restaurant_id,'Table QR',`qr:${required(input.requestKey,'request key',60)}`,{items:input.items,type:'Dine-in',customer:t.label,note:input.note||'',expectedTotal:input.expectedTotal});},
  requests(u){staff(u);return db.prepare("SELECT * FROM customer_requests WHERE restaurant_id=? ORDER BY id DESC LIMIT 200").all(u.restaurant_id).map(r=>({...r,body:JSON.parse(r.body)}));},
  decide(u,id,action){staff(u);const r=db.prepare('SELECT * FROM customer_requests WHERE restaurant_id=? AND id=?').get(u.restaurant_id,id);if(!r)fail('Request not found',404);
   if(!['accept','reject'].includes(action))fail('Invalid action');if(r.status!=='pending')return {id:r.id,status:r.status,orderId:r.order_id};
   if(action==='reject'){db.prepare("UPDATE customer_requests SET status='rejected' WHERE id=?").run(id);return {status:'rejected'};}
   const q=JSON.parse(r.body),order=store.createOrder(u,{requestKey:`customer-request:${id}`,type:q.type,customer:q.customer,note:`${r.source} request #${id}. ${q.note}`,items:q.items.map(p=>({id:p.id,qty:p.qty})),expectedTotal:q.total,payment:'Unpaid'});
   db.prepare("UPDATE customer_requests SET status='accepted',order_id=? WHERE id=?").run(order.id,id);return {status:'accepted',orderId:order.id};
  }
 };
}
