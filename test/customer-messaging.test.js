import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../lib/store.js';
import {customerOrdering} from '../lib/customer-ordering.js';
import {customerMessaging} from '../lib/customer-messaging.js';
import {whatsappBot} from '../lib/whatsapp.js';
import {createApp} from '../server.js';
const credentials={restaurant:'Updates',name:'Owner',email:'owner@test.com',password:'test-password-123'};
const config={PUBLIC_BASE_URL:'https://restaurant.example',WHATSAPP_RESTAURANT_ID:'1',WHATSAPP_APP_SECRET:'test',WHATSAPP_VERIFY_TOKEN:'test',WHATSAPP_ACCESS_TOKEN:'test',WHATSAPP_PHONE_NUMBER_ID:'123',WHATSAPP_API_VERSION:'v23.0'};
const input={requestKey:'one',type:'Delivery',items:[{id:1,qty:1}],expectedTotal:590,customerPhone:'+923001234567',whatsappUpdates:true};
const event=(id,text,phone='923001234567')=>({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123'},messages:[{id,from:phone,type:'text',text:{body:text}}]}}]}]});
function fixture(t){const store=openStore(':memory:');t.after(()=>store.db.close());const owner=store.setup(credentials),ordering=customerOrdering(store),sent=[];const send=async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({messages:[{id:'provider-'+sent.length}]})};};const messaging=customerMessaging(store,config,send),bot=whatsappBot(store,ordering,config,send);return {store,owner,ordering,messaging,bot,sent,send};}
test('QR and WhatsApp requests notify only their restaurant and link to safe live tracking',async t=>{
 const {store,owner,ordering,messaging}=fixture(t),table=ordering.addTable(owner,{label:'Table 1'});
 const r=ordering.place(table.token,{requestKey:'qr',items:input.items,expectedTotal:590});
 assert.equal(ordering.notifications(owner).requests.length,1);assert.equal(ordering.notifications({...owner,restaurant_id:999}).requests.length,0);
 assert.match(ordering.tracking(r.trackingToken).status,/Waiting/);
 const accepted=ordering.decide(owner,r.id,'accept');assert.equal(ordering.notifications(owner).requests.length,0);
 const tracked=ordering.tracking(r.trackingToken);assert.ok(tracked.orderToken);assert.equal(messaging.tracking(tracked.orderToken).status,'Order accepted');
 store.status(owner,accepted.orderId,'preparing');assert.equal(messaging.tracking(tracked.orderToken).status,'Preparing your order');
 assert.equal(messaging.tracking(tracked.orderToken).customerPhone,undefined);assert.equal(messaging.tracking(tracked.orderToken).customer,undefined);
 assert.throws(()=>messaging.tracking('0'.repeat(48)),/not found/);
});
test('delivery has a distinct dispatch step and sends each transition once, with tracking link',async t=>{
 const {store,owner,messaging,bot,sent}=fixture(t);await bot.receive(event('hello','hello'));sent.length=0;
 const o=store.createOrder(owner,input);store.status(owner,o.id,'preparing');store.status(owner,o.id,'ready');
 assert.throws(()=>store.status(owner,o.id,'served'),/transition/);
 store.status({...owner,role:'cashier'},o.id,'out_for_delivery');store.status({...owner,role:'cashier'},o.id,'served');
 await messaging.flush();assert.equal(sent.length,5);assert.match(sent[3].text.body,/Out for delivery/);assert.match(sent[4].text.body,/Delivered/);assert.ok(sent.every(m=>m.text.body.includes('https://restaurant.example/track.html?token=')));
 await messaging.flush();assert.equal(sent.length,5);assert.equal(messaging.tracking(o.trackingToken).events.length,5);
});
test('WhatsApp updates require opt-in, validate numbers and use approved templates outside the reply window',async t=>{
 const {store,owner,sent,send}=fixture(t);
 assert.throws(()=>store.createOrder(owner,{...input,customerPhone:'03001234567'}),/country code/);
 assert.throws(()=>store.createOrder(owner,{...input,customerPhone:''}),/required/);
 store.createOrder(owner,{...input,requestKey:'none',whatsappUpdates:false});
 const o=store.createOrder(owner,input),m=customerMessaging(store,config,send);await m.flush();assert.equal(sent.length,0);assert.equal(m.inbox(owner).outbox[0].state,'blocked');
 store.db.exec('UPDATE wa_outbox SET next_attempt=0');const templated=customerMessaging(store,{...config,WHATSAPP_STATUS_TEMPLATE:'order_status',WHATSAPP_TEMPLATE_LANGUAGE:'en'},send);await templated.flush();assert.equal(sent.length,1);assert.equal(sent[0].type,'template');assert.equal(sent[0].template.components[0].parameters[0].text,String(o.id));
});
test('failed sends retry without losing events and provider delivery receipts do not regress',async t=>{
 const {store,owner,bot}=fixture(t);await bot.receive(event('hello','hello'));store.createOrder(owner,input);let attempts=0;
 const m=customerMessaging(store,config,async()=>{attempts++;return attempts===1?{ok:false,json:async()=>({error:{code:190}})}:{ok:true,json:async()=>({messages:[{id:'delivery-id'}]})};});
 await m.flush();assert.equal(m.inbox(owner).outbox[0].state,'retry');assert.equal(attempts,1);
 await m.flush();assert.equal(attempts,1);store.db.exec('UPDATE wa_outbox SET next_attempt=0');await m.flush();assert.equal(attempts,2);
 const statuses=status=>({entry:[{changes:[{value:{metadata:{phone_number_id:'123'},statuses:[{id:'delivery-id',status}]}}]}]});
 await bot.receive(statuses('read'));await bot.receive(statuses('sent'));assert.equal(m.inbox(owner).outbox[0].state,'read');
});
test('human handoff pauses commands, stores messages, scopes staff access, and resumes the bot',async t=>{
 const {store,owner,ordering,messaging,bot,sent}=fixture(t);
 await bot.receive(event('hello','hello'));assert.match(sent.at(-1).text.body,/automated ordering assistant/);assert.match(sent.at(-1).text.body,/HUMAN/);
 await bot.receive(event('human','HUMAN'));const thread=messaging.inbox(owner).threads[0];assert.equal(thread.mode,'waiting');assert.equal(ordering.notifications(owner).conversations.length,1);
 const count=sent.length;await bot.receive(event('q','Can I change my address?'));await bot.receive(event('cmd','ORDER 1x1 | Takeaway | Ali'));assert.equal(sent.length,count);assert.equal(ordering.requests(owner).length,0);
 assert.equal(messaging.conversation(owner,thread.id).messages.filter(m=>m.direction==='customer').length,4);
 assert.throws(()=>messaging.conversation({...owner,restaurant_id:999},thread.id),/not found/);assert.throws(()=>messaging.inbox({...owner,role:'kitchen'}),/Cashier/);
 messaging.reply(owner,thread.id,{message:'Yes, please tell us your address.',requestKey:'reply-1'});messaging.reply(owner,thread.id,{message:'Yes, please tell us your address.',requestKey:'reply-1'});await messaging.flush();assert.equal(sent.length,count+1);
 await bot.receive(event('bot','BOT'));assert.equal(messaging.inbox(owner).threads.length,0);await bot.receive(event('menu','MENU'));assert.match(sent.at(-1).text.body,/Menu/);
});
test('STOP disables progress updates and expired staff reply windows reject free-text replies',async t=>{
 const {store,owner,messaging,bot,sent}=fixture(t);await bot.receive(event('hi','MENU'));await bot.receive(event('stop','STOP'));sent.length=0;store.createOrder(owner,input);await messaging.flush();assert.equal(sent.length,0);assert.equal(messaging.inbox(owner).outbox[0].state,'cancelled');
 await bot.receive(event('human','HUMAN'));const thread=messaging.inbox(owner).threads[0];store.db.exec('UPDATE wa_threads SET last_inbound=0');assert.throws(()=>messaging.reply(owner,thread.id,{message:'Hi',requestKey:'expired'}),/window has closed/);
});
test('HTTP tracking is public but notifications and conversations require authorized staff',async t=>{
 const {store,owner,send}=fixture(t),o=store.createOrder(owner,{...input,whatsappUpdates:false}),server=createApp(store,config,send);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/notifications')).status,401);assert.equal((await fetch(base+'/api/conversations')).status,401);
 const response=await fetch(base+'/api/tracking/order/'+o.trackingToken);assert.equal(response.status,200);const tracking=await response.json();assert.equal(tracking.customerPhone,undefined);assert.equal(tracking.status,'Order accepted');
});


test('natural-language handoff requests pause the bot without repeatedly sending menus or resetting active staff chat',async t=>{
 const {store,owner,messaging,bot,sent}=fixture(t);
 const phrases=['Connect with agent','Connect me to an agent','Please connect me with a person!','I want to talk to someone','Can I speak to a staff member?','HUMAN'];
 for(let i=0;i<phrases.length;i++){
  const phone='9230012345'+String(i).padStart(2,'0');
  await bot.receive(event('natural-'+i,phrases[i],phone));
  assert.match(sent.at(-1).text.body,/notified restaurant staff/);assert.doesNotMatch(sent.at(-1).text.body,/Menu \(PKR/);
  const thread=messaging.inbox(owner).threads.find(t=>t.phone===phone);assert.equal(thread.mode,'waiting');
  messaging.reply(owner,thread.id,{message:'A staff member is here.',requestKey:'hello-'+i});
  const count=sent.length;await bot.receive(event('repeat-'+i,phrases[i],phone));await bot.receive(event('followup-'+i,'Are you there?',phone));
  assert.equal(sent.length,count);assert.equal(messaging.conversation(owner,thread.id).mode,'active');
 }
});

test('unknown messages get concise help, only explicit MENU sends the menu, and webhook/status retries do not resend it',async t=>{
 const {bot,sent}=fixture(t);
 await bot.receive(event('greeting','Hi'));assert.doesNotMatch(sent.at(-1).text.body,/Menu \(PKR/);
 await bot.receive(event('unknown','How long will it take?'));assert.match(sent.at(-1).text.body,/did not understand/);assert.doesNotMatch(sent.at(-1).text.body,/Menu \(PKR/);
 await bot.receive(event('explicit-menu','MENU'));assert.match(sent.at(-1).text.body,/Menu \(PKR/);
 const count=sent.length;await bot.receive(event('explicit-menu','MENU'));assert.equal(sent.length,count);
 await bot.receive({entry:[{changes:[{value:{metadata:{phone_number_id:'123'},statuses:[{id:'unrelated',status:'delivered'}]}}]}]});assert.equal(sent.length,count);
 await bot.receive(event('invalid-page','MENU 999'));assert.match(sent.at(-1).text.body,/valid page number/);
});
