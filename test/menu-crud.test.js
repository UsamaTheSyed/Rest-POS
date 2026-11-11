import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../lib/store.js';
const png={type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
function fixture(t){const store=openStore(':memory:');t.after(()=>store.db.close());const owner=store.setup({restaurant:'Test',name:'Owner',email:'owner@example.com',password:'test-password-123'});return {store,owner};}
test('editing full item details preserves original sale snapshots and supports photo changes',t=>{
  const {store,owner}=fixture(t);
  const item=store.addProduct(owner,{name:'Tea',category:'Drinks',price:100,available:true,imageData:png});
  const sale=store.createOrder(owner,{requestKey:'test',type:'Takeaway',payment:'Cash',items:[{id:item.id,qty:2}],expectedTotal:200});
  const edited=store.updateProduct(owner,item.id,{name:'Karak Tea',category:'Hot drinks',description:'Freshly brewed',tag:'Popular',price:150,available:false});
  assert.equal(edited.name,'Karak Tea');assert.equal(edited.desc,'Freshly brewed');assert.equal(edited.category,'Hot drinks');assert.equal(edited.tag,'Popular');assert.equal(edited.available,false);assert.equal(edited.image,item.image);
  const replaced=store.updateProduct(owner,item.id,{price:150,available:true,imageData:png});assert.notEqual(replaced.image,item.image);
  const removed=store.updateProduct(owner,item.id,{price:150,available:true,imageData:null});assert.equal(removed.image,'');
  assert.equal(store.getOrder(owner,sale.id).items[0].name,'Tea');assert.equal(store.getOrder(owner,sale.id).total,200);
  assert.throws(()=>store.updateProduct(owner,item.id,{name:'',price:150,available:true}));
  assert.equal(store.menu(owner).find(p=>p.id===item.id).name,'Karak Tea');
});
test('deleting hides menu item, blocks new sales and retains historical order and audit',t=>{
  const {store,owner}=fixture(t);
  const sale=store.createOrder(owner,{requestKey:'test',type:'Takeaway',payment:'Cash',items:[{id:1,qty:1}],expectedTotal:590});
  assert.throws(()=>store.deleteProduct({...owner,role:'cashier'},1),/Owner/);
  assert.throws(()=>store.deleteProduct({...owner,restaurant_id:999},1),/not found/);
  assert.throws(()=>store.updateProduct({...owner,restaurant_id:999},1,{price:20,available:true}),/not found/);
  store.deleteProduct(owner,1);
  assert.ok(!store.menu(owner).some(p=>p.id===1));
  assert.equal(store.getOrder(owner,sale.id).total,590);
  assert.throws(()=>store.createOrder(owner,{requestKey:'new',type:'Takeaway',payment:'Cash',items:[{id:1,qty:1}],expectedTotal:590}),/unavailable/);
  assert.throws(()=>store.updateProduct(owner,1,{price:20,available:true}),/not found/);
  assert.throws(()=>store.deleteProduct(owner,1),/not found/);
  assert.ok(store.audit(owner).some(e=>e.action==='menu.deleted'&&e.entity_id===1));
});
