import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../lib/store.js';
import {createApp} from '../server.js';
const setup={restaurant:'Pay later',name:'Owner',email:'owner@example.com',password:'test-password-123'};
function fixture(t){const store=openStore(':memory:');t.after(()=>store.db.close());const owner=store.setup(setup);return {store,owner};}
const order=(type='Dine-in',requestKey=type)=>({requestKey,type,customer:'Table/customer reference',items:[{id:1,qty:1}],expectedTotal:590});
test('all service types can enter the kitchen unpaid and settle after serving',t=>{
  const {store,owner}=fixture(t);
  for(const type of ['Dine-in','Takeaway','Delivery']){
    const saved=store.createOrder(owner,order(type));assert.equal(saved.paymentStatus,'unpaid');assert.equal(saved.paidAt,null);assert.equal(saved.status,'queued');
    for(const status of ['preparing','ready','served'])store.status(owner,saved.id,status);
    assert.equal(store.getOrder(owner,saved.id).paymentStatus,'unpaid');
  }
  assert.equal(store.report(owner).length,0);
  for(const saved of store.orders(owner)){const paid=store.collectPayment(owner,saved.id,{payment:'Cash',expectedTotal:590});assert.equal(paid.status,'served');assert.equal(paid.paymentStatus,'paid');assert.ok(paid.paidAt);}
  assert.equal(store.report(owner)[0].orders,3);assert.equal(store.report(owner)[0].total,1770);
});
test('payment retries are safe and do not create orders, kitchen tickets or duplicate audit records',t=>{
  const {store,owner}=fixture(t),saved=store.createOrder(owner,order());
  assert.equal(store.createOrder(owner,order()).id,saved.id);
  const input={payment:'Card (external terminal)',expectedTotal:590};
  const paid=store.collectPayment(owner,saved.id,input),retry=store.collectPayment(owner,saved.id,input);
  assert.equal(retry.alreadyPaid,true);assert.equal(retry.paidAt,paid.paidAt);assert.equal(store.orders(owner).length,1);
  assert.equal(store.audit(owner).filter(e=>e.action==='order.payment_recorded').length,1);
  assert.equal(store.createOrder(owner,order()).paymentStatus,'paid');
  assert.throws(()=>store.collectPayment(owner,saved.id,{payment:'Cash',expectedTotal:590}),/already been paid/);
});
test('settlement uses original order total and payment date, with role and tenant enforcement',t=>{
  const {store,owner}=fixture(t),saved=store.createOrder(owner,order());
  store.db.prepare('UPDATE orders SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',saved.id);
  store.updateProduct(owner,1,{price:999,available:true});store.settings(owner,{name:'Pay later',tax_bps:500});
  assert.throws(()=>store.collectPayment({...owner,role:'kitchen'},saved.id,{payment:'Cash',expectedTotal:590}),/Cashier/);
  assert.throws(()=>store.collectPayment({...owner,restaurant_id:999},saved.id,{payment:'Cash',expectedTotal:590}),/not found/);
  assert.throws(()=>store.collectPayment(owner,saved.id,{payment:'Cash',expectedTotal:999}),/total/);
  assert.throws(()=>store.collectPayment(owner,saved.id,{payment:'Unpaid',expectedTotal:590}),/method/);
  assert.equal(store.getOrder(owner,saved.id).paidAt,null);
  const paid=store.collectPayment(owner,saved.id,{payment:'Cash',expectedTotal:590});assert.equal(paid.total,590);
  assert.equal(store.report(owner)[0].date,new Date(Date.parse(paid.paidAt)+5*3600000).toISOString().slice(0,10));
});
test('old unpaid orders remain discoverable after more than 200 newer sales',t=>{
  const {store,owner}=fixture(t),unpaid=store.createOrder(owner,order('Delivery','old'));store.status(owner,unpaid.id,'preparing');store.status(owner,unpaid.id,'ready');store.status(owner,unpaid.id,'served');
  for(let i=0;i<205;i++){const o=store.createOrder(owner,{...order('Takeaway','paid-'+i),payment:'Cash'});store.db.prepare("UPDATE orders SET status='served' WHERE id=?").run(o.id);}
  assert.ok(store.orders(owner).some(o=>o.id===unpaid.id));assert.equal(store.orders(owner).length,201);
});
test('legacy paid orders migrate correctly and deferred orders survive restart unpaid',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'ember-payment-')),filename=path.join(directory,'test.sqlite');let store=openStore(filename);
  try{
    const owner=store.setup(setup),paid=store.createOrder(owner,{...order(),payment:'Cash'});
    store.db.exec('ALTER TABLE orders DROP COLUMN paid_at');store.db.close();store=openStore(filename);
    assert.equal(store.getOrder(owner,paid.id).paymentStatus,'paid');assert.equal(store.getOrder(owner,paid.id).paidAt,paid.date);
    const unpaid=store.createOrder(owner,order('Delivery'));store.db.close();store=openStore(filename);
    assert.equal(store.getOrder(owner,unpaid.id).paymentStatus,'unpaid');assert.equal(store.report(owner)[0].orders,1);
  }finally{store.db.close();rmSync(directory,{recursive:true,force:true});}
});
test('HTTP supports creating unpaid orders, printable bills and collecting later',async t=>{
  const {store,owner}=fixture(t),server=createApp(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner.email,password:setup.password})});
  const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0]};
  const placed=await fetch(base+'/api/orders',{method:'POST',headers,body:JSON.stringify({...order(),payment:'Unpaid'})});assert.equal(placed.status,201);const saved=await placed.json();assert.equal(saved.paymentStatus,'unpaid');
  const bill=await (await fetch(base+'/api/orders/'+saved.id,{headers})).json();assert.equal(bill.paidAt,null);
  const result=await fetch(base+`/api/orders/${saved.id}/payment`,{method:'POST',headers,body:JSON.stringify({payment:'Cash',expectedTotal:590})});assert.equal(result.status,200);assert.equal((await result.json()).paymentStatus,'paid');
});
