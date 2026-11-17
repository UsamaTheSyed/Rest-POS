import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../lib/store.js';
import {customerOrdering} from '../lib/customer-ordering.js';
import {storefront} from '../lib/storefront.js';
import {createApp} from '../server.js';
const credentials={restaurant:'Foodies',name:'Owner',email:'website@test.com',password:'test-password-123'};
const request={requestKey:'web-one',type:'Delivery',customer:'Ali',customerPhone:'923001234567',whatsappUpdates:false,address:'House 12, Test Street',area:'Clifton',note:'No onions',items:[{id:1,qty:2}],expectedTotal:1180};
function fixture(t){const store=openStore(':memory:');t.after(()=>store.db.close());const owner=store.setup(credentials),ordering=customerOrdering(store),site=storefront(store,ordering),settings={...site.settings(owner),slug:'foodies',enabled:true,address:'Test kitchen, Karachi',phone:'+923001234567',delivery:true,areas:['Clifton','DHA']};site.save(owner,settings);return {store,owner,ordering,site,settings};}
test('website orders use POS prices, reach staff review, and become unpaid kitchen orders with tracking',t=>{
 const {store,owner,ordering,site}=fixture(t);
 const catalog=site.catalog('foodies');assert.equal(catalog.restaurant,'Foodies');assert.equal(catalog.items[0].price,590);
 const result=site.place('foodies',{...request,restaurantId:999,source:'spoofed',payment:'Cash'});
 assert.equal(site.place('foodies',request).id,result.id);assert.equal(store.orders(owner).length,0);
 assert.equal(ordering.notifications(owner).requests[0].source,'Website');
 const r=ordering.requests(owner)[0];assert.equal(r.source,'Website');assert.match(r.body.note,/House 12/);assert.match(r.body.note,/Clifton/);
 assert.equal(ordering.tracking(result.trackingToken).status,'Waiting for staff confirmation');
 const accepted=ordering.decide(owner,result.id,'accept'),o=store.getOrder(owner,accepted.orderId);
 assert.equal(o.paymentStatus,'unpaid');assert.equal(o.status,'queued');assert.equal(o.type,'Delivery');assert.equal(o.total,1180);
 assert.ok(ordering.tracking(result.trackingToken).orderToken);
});
test('website rejects unsupported areas, forged totals, unavailable products and duplicate edits',t=>{
 const {store,owner,site,settings}=fixture(t);
 assert.throws(()=>site.place('foodies',{...request,area:'Unknown'}),/area/);
 assert.throws(()=>site.place('foodies',{...request,address:''}),/address/);
 assert.throws(()=>site.place('foodies',{...request,customerPhone:''}),/phone/);
 assert.throws(()=>site.place('foodies',{...request,type:'Dine-in'}),/unavailable/);
 assert.throws(()=>site.place('foodies',{...request,expectedTotal:1}),/Prices/);
 site.place('foodies',request);assert.throws(()=>site.place('foodies',{...request,note:'changed'}),/already used/);
 store.updateProduct(owner,1,{price:650,available:true});assert.equal(site.catalog('foodies').items.find(p=>p.id===1).price,650);
 assert.throws(()=>site.place('foodies',{...request,requestKey:'new'}),/Prices/);
 store.updateProduct(owner,1,{price:650,available:false});assert.ok(!site.catalog('foodies').items.some(p=>p.id===1));assert.throws(()=>site.place('foodies',{...request,requestKey:'hidden'}),/unavailable/);
 site.save(owner,{...settings,enabled:false});assert.throws(()=>site.catalog('foodies'),/unavailable/);assert.throws(()=>site.place('foodies',request),/unavailable/);
});
test('website configuration is owner-only, tenant scoped and validates publication settings',t=>{
 const {store,owner,site,settings}=fixture(t);
 assert.throws(()=>site.settings({...owner,role:'cashier'}),/Owner/);
 assert.throws(()=>site.save({...owner,role:'cashier'},settings),/Owner/);
 assert.throws(()=>site.save(owner,{...settings,slug:'../bad'}),/letters/);
 assert.throws(()=>site.save(owner,{...settings,areas:[]}),/delivery area/);
 assert.throws(()=>site.save(owner,{...settings,address:''}),/address/);
 assert.throws(()=>site.save(owner,{...settings,heroProductId:9999}),/your menu/);
 const otherId=Number(store.db.prepare('INSERT INTO restaurants(name,tax_bps) VALUES(?,?)').run('Other',0).lastInsertRowid),other={...owner,restaurant_id:otherId};
 assert.equal(site.settings(other).enabled,false);assert.throws(()=>site.save(other,settings),/already taken/);
 const second={...site.settings(other),slug:'other',enabled:true,address:'Other address',phone:'923009999999'};site.save(other,second);
 assert.equal(site.catalog('other').items.length,0);assert.throws(()=>site.place('other',{...request,type:'Takeaway'}),/unavailable/);
 assert.ok(store.audit(owner).some(a=>a.action==='website.updated'));
});
test('website HTTP routes are public while configuration needs owner authentication',async t=>{
 const {store,owner}=fixture(t),server=createApp(store,{});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/shop/foodies')).status,200);
 const catalog=await(await fetch(base+'/api/storefront/foodies')).json();assert.equal(catalog.restaurant,'Foodies');assert.ok(!('users' in catalog));
 assert.equal((await fetch(base+'/api/website-settings')).status,401);
 const post=await fetch(base+'/api/storefront/foodies/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,type:'Takeaway'})});assert.equal(post.status,201);
 const result=await post.json();assert.equal((await fetch(base+'/api/tracking/request/'+result.trackingToken)).status,200);
 const cookie='ember_session='+store.login(credentials).token;
 assert.equal((await fetch(base+'/api/website-settings',{headers:{Cookie:cookie}})).status,200);
 assert.equal((await fetch(base+'/api/storefront/foodies/orders',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://unrelated.example'},body:JSON.stringify(request)})).status,403);
 assert.equal((await fetch(base+'/api/storefront/unknown')).status,404);
});

test('website WhatsApp contact is optional, normalized and independently configurable',t=>{
 const {site,owner,settings}=fixture(t);
 assert.equal(site.catalog('foodies').whatsappPhone,'');
 site.save(owner,{...settings,whatsappPhone:'0300 1234567'});
 assert.equal(site.catalog('foodies').whatsappPhone,'923001234567');
 const legacy={...site.settings(owner)};delete legacy.whatsappPhone;
 site.save(owner,legacy);assert.equal(site.catalog('foodies').whatsappPhone,'923001234567');
 assert.throws(()=>site.save(owner,{...settings,whatsappPhone:'https://example.com'}),/WhatsApp number/);
 site.save(owner,{...settings,whatsappPhone:''});assert.equal(site.catalog('foodies').whatsappPhone,'');
});
