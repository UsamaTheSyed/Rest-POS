import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {openStore} from '../lib/store.js';
import {customerOrdering} from '../lib/customer-ordering.js';
import {whatsappBot,validSignature} from '../lib/whatsapp.js';
import {createApp} from '../server.js';
const setup={restaurant:'QR restaurant',name:'Owner',email:'owner@test.com',password:'test-password-123'};
const config={PUBLIC_BASE_URL:'https://restaurant.example',WHATSAPP_RESTAURANT_ID:'1',WHATSAPP_APP_SECRET:'test-secret',WHATSAPP_VERIFY_TOKEN:'verify-test',WHATSAPP_ACCESS_TOKEN:'fake-token',WHATSAPP_PHONE_NUMBER_ID:'12345',WHATSAPP_API_VERSION:'v23.0'};
function fixture(t){const store=openStore(':memory:');t.after(()=>store.db.close());const owner=store.setup(setup),ordering=customerOrdering(store),table=ordering.addTable(owner,{label:'Table 04'});return {store,owner,ordering,table};}
const order={requestKey:'first',items:[{id:1,qty:2}],expectedTotal:1180,note:'No onions'};
const event=(id,body,from='923001234567')=>({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'12345'},messages:[{id,from,type:'text',text:{body}}]}}]}]});
test('table orders bind the table and restaurant, remain pending, and accept once as unpaid',t=>{
 const {store,owner,ordering,table}=fixture(t);
 const result=ordering.place(table.token,{...order,type:'Delivery',customer:'spoofed',payment:'Cash'});
 assert.equal(store.orders(owner).length,0);assert.equal(ordering.place(table.token,order).id,result.id);
 const request=ordering.requests(owner)[0];assert.equal(request.body.customer,'Table 04');assert.equal(request.body.type,'Dine-in');
 const accepted=ordering.decide(owner,result.id,'accept');assert.equal(ordering.decide(owner,result.id,'accept').orderId,accepted.orderId);
 const saved=store.getOrder(owner,accepted.orderId);assert.equal(saved.paymentStatus,'unpaid');assert.equal(saved.status,'queued');assert.match(saved.note,/Table QR/);assert.equal(store.orders(owner).length,1);
});
test('customer ordering rejects forged prices, unavailable items, reused keys and unauthorized staff',t=>{
 const {store,owner,ordering,table}=fixture(t);
 assert.throws(()=>ordering.place(table.token,{...order,expectedTotal:1}),/Prices/);
 assert.throws(()=>ordering.place(table.token,{...order,items:[{id:99999,qty:1}]}),/unavailable/);
 assert.throws(()=>ordering.place(table.token,{...order,items:[{id:1,qty:1},{id:1,qty:1}]}),/repeated/);
 const r=ordering.place(table.token,order);
 assert.throws(()=>ordering.place(table.token,{...order,note:'changed'}),/already used/);
 assert.throws(()=>ordering.requests({...owner,role:'kitchen'}),/Cashier/);
 assert.throws(()=>ordering.decide({...owner,restaurant_id:999},r.id,'accept'),/not found/);
 store.updateProduct(owner,1,{price:600,available:true});assert.throws(()=>ordering.decide(owner,r.id,'accept'),/prices or tax/);assert.equal(store.orders(owner).length,0);
 ordering.decide(owner,r.id,'reject');assert.equal(ordering.decide(owner,r.id,'accept').status,'rejected');
 ordering.disableTable(owner,table.token);assert.throws(()=>ordering.menu(table.token),/unavailable/);assert.throws(()=>ordering.place(table.token,order),/unavailable/);
});
test('WhatsApp confirms once, scopes status to sender, and retries a failed reply without duplicate requests',async t=>{
 const {store,owner,ordering}=fixture(t);let failSend=false;const replies=[];
 const bot=whatsappBot(store,ordering,config,async(_url,options)=>{replies.push(JSON.parse(options.body).text.body);return {ok:!failSend};});
 await bot.receive(event('menu','MENU'));assert.match(replies.at(-1),/ORDER/);
 await bot.receive(event('draft','ORDER 1x2 | Delivery | Ali | Main road Lahore'));assert.match(replies.at(-1),/1180.00/);assert.equal(ordering.requests(owner).length,0);
 failSend=true;await assert.rejects(()=>bot.receive(event('confirm','CONFIRM')),/reply failed/);assert.equal(ordering.requests(owner).length,1);
 failSend=false;await bot.receive(event('confirm','CONFIRM'));const count=replies.length;await bot.receive(event('confirm','CONFIRM'));assert.equal(replies.length,count);assert.equal(ordering.requests(owner).length,1);
 const r=ordering.requests(owner)[0];ordering.decide(owner,r.id,'accept');
 await bot.receive(event('status','STATUS '+r.id));assert.match(replies.at(-1),/accepted/);
 await bot.receive(event('stranger','STATUS '+r.id,'923009999999'));assert.match(replies.at(-1),/not found/);
});
test('WhatsApp drafts require address, expire, and revalidate current prices on confirmation',async t=>{
 const {store,owner,ordering}=fixture(t),replies=[];const bot=whatsappBot(store,ordering,config,async(_u,o)=>{replies.push(JSON.parse(o.body).text.body);return {ok:true};});
 await bot.receive(event('a','ORDER 1x1 | Delivery | Ali'));assert.match(replies.at(-1),/Full address/);
 await bot.receive(event('b','ORDER 1x1 | Takeaway | Ali'));store.updateProduct(owner,1,{price:700,available:true});
 await bot.receive(event('c','CONFIRM'));assert.match(replies.at(-1),/Prices changed/);assert.equal(ordering.requests(owner).length,0);
 store.db.prepare('UPDATE whatsapp_drafts SET created_at=0').run();await bot.receive(event('d','CONFIRM'));assert.match(replies.at(-1),/expired/);
});
test('HTTP exposes only scoped public menus, creates printable QR, and authenticates signed webhooks',async t=>{
 const {store,owner,table}=fixture(t),server=createApp(store,config,async()=>({ok:true}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`,menu=await fetch(base+'/api/customer/'+table.token);assert.equal(menu.status,200);assert.equal((await menu.json()).table,'Table 04');
 assert.equal((await fetch(base+'/api/orders')).status,401);
 const placed=await fetch(base+'/api/customer/'+table.token+'/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(order)});assert.equal(placed.status,201);
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:setup.password})});const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const qr=await fetch(base+'/api/customer-tables/'+table.token+'/qr',{headers});assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);
 const verify=await fetch(base+'/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-test&hub.challenge=123');assert.equal(await verify.text(),'123');
 const raw=JSON.stringify(event('signed','MENU')),signature='sha256='+createHmac('sha256',config.WHATSAPP_APP_SECRET).update(raw).digest('hex');
 assert.equal(validSignature(Buffer.from(raw),signature,config.WHATSAPP_APP_SECRET),true);assert.equal(validSignature(Buffer.from(raw+' '),signature,config.WHATSAPP_APP_SECRET),false);
 assert.equal((await fetch(base+'/webhooks/whatsapp',{method:'POST',body:raw})).status,403);
 assert.equal((await fetch(base+'/webhooks/whatsapp',{method:'POST',headers:{'X-Hub-Signature-256':signature},body:raw})).status,200);
});
