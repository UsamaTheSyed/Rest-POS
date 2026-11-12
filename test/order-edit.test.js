import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../lib/store.js';
import {createApp} from '../server.js';
const setup={restaurant:'Edit orders',name:'Owner',email:'owner@example.com',password:'test-password-123'};
function fixture(t){const store=openStore(':memory:');t.after(()=>store.db.close());return {store,owner:store.setup(setup)};}
const input={requestKey:'edit-test',type:'Dine-in',items:[{id:1,qty:1}],expectedTotal:590};
test('all service types support audited edits, original prices and tax, additions and removals',t=>{
 const {store,owner}=fixture(t);
 store.settings(owner,{name:setup.restaurant,tax_bps:500});
 for(const type of ['Dine-in','Takeaway','Delivery']){
  store.updateProduct(owner,1,{price:590,available:true});
  const old=store.createOrder(owner,{...input,type,requestKey:type,expectedTotal:619.5});
  for(const status of ['preparing','ready','served'])store.status(owner,old.id,status);
  store.updateProduct(owner,1,{price:900,available:true});
  const added=store.menu(owner).find(p=>p.id!==1&&p.available);
  const subtotal=1180+added.price,total=Math.round(subtotal*100*1.05)/100;
  const edited=store.editOrder(owner,old.id,{expectedRevision:0,items:[{id:1,qty:2},{id:added.id,qty:1}],note:'Extra hot',customer:'Table 4',expectedTotal:total});
  assert.equal(edited.items[0].price,590);assert.equal(edited.revision,1);assert.equal(edited.status,'queued');assert.match(edited.changes,/Added/);assert.equal(edited.paymentStatus,'unpaid');
  const before=JSON.parse(store.db.prepare('SELECT before_json FROM order_revisions WHERE order_id=?').get(old.id).before_json);assert.equal(before.total,619.5);
  const removed=store.editOrder(owner,old.id,{expectedRevision:1,items:[{id:1,qty:1}],expectedTotal:619.5});assert.match(removed.changes,/Removed/);
  assert.equal(store.collectPayment(owner,old.id,{payment:'Cash',expectedRevision:2,expectedTotal:619.5}).paymentStatus,'paid');
 }
});
test('edits reject invalid items, stale revisions, unauthorized users and paid orders without changes',t=>{
 const {store,owner}=fixture(t),old=store.createOrder(owner,input);
 const edit={expectedRevision:0,items:[{id:1,qty:2}],expectedTotal:1180};
 for(const items of [[],[{id:1,qty:0}],[{id:1,qty:1},{id:1,qty:1}],[{id:999999,qty:1}]])assert.throws(()=>store.editOrder(owner,old.id,{...edit,items}));
 assert.throws(()=>store.editOrder({...owner,role:'kitchen'},old.id,edit),/Cashier/);
 assert.throws(()=>store.editOrder({...owner,restaurant_id:999},old.id,edit),/not found/);
 assert.throws(()=>store.editOrder(owner,old.id,{...edit,expectedTotal:1}),/Prices/);
 assert.deepEqual(store.getOrder(owner,old.id),old);
 store.editOrder(owner,old.id,edit);
 assert.throws(()=>store.editOrder(owner,old.id,edit),/changed/);
 store.collectPayment(owner,old.id,{payment:'Cash',expectedRevision:1,expectedTotal:1180});
 assert.throws(()=>store.editOrder(owner,old.id,{...edit,expectedRevision:1}),/Paid/);
});
test('same-total edits invalidate old payment and kitchen actions; no-op edits do not create revisions',t=>{
 const {store,owner}=fixture(t),old=store.createOrder(owner,input);
 const edit={expectedRevision:0,items:input.items,expectedTotal:590};
 assert.equal(store.editOrder(owner,old.id,edit).revision,0);
 store.editOrder(owner,old.id,{...edit,note:'No onions'});
 assert.throws(()=>store.collectPayment(owner,old.id,{payment:'Cash',expectedTotal:590,expectedRevision:0}),/changed/);
 assert.throws(()=>store.status(owner,old.id,'preparing',0),/changed/);
 assert.equal(store.status(owner,old.id,'preparing',1).status,'preparing');
});
test('HTTP payment-screen edit updates the existing order then settles the revised bill',async t=>{
 const {store,owner}=fixture(t),server=createApp(store);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:setup.password})});
 const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0]},old=store.createOrder(owner,input);
 const response=await fetch(base+'/api/orders/'+old.id,{method:'PATCH',headers,body:JSON.stringify({expectedRevision:0,items:[{id:1,qty:2}],expectedTotal:1180})});
 assert.equal(response.status,200);assert.equal((await response.json()).total,1180);
 const result=await fetch(base+`/api/orders/${old.id}/payment`,{method:'POST',headers,body:JSON.stringify({payment:'Cash',expectedRevision:1,expectedTotal:1180})});assert.equal(result.status,200);assert.equal(store.orders(owner).length,1);
});
