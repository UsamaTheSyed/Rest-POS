import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../lib/store.js';
import {createApp} from '../server.js';

function fixture(t){const store=openStore(':memory:');t.after(()=>store.db.close());const owner=store.setup({restaurant:'Operations Test',name:'Owner',email:'owner@example.com',password:'test-password-123'});const cashier=store.addUser(owner,{name:'Cashier',email:'cashier@example.com',password:'test-password-123',role:'cashier'});return {store,owner,cashier};}
const stock={name:'Chicken',unit:'kg',quantity:10.125,minimum:2,supplier:'Local supplier'};
test('stock movements retain precise decimals, prevent negative stock and deduplicate retries',t=>{
  const {store,owner}=fixture(t),item=store.addStock(owner,stock);
  const movement={requestKey:'usage-1',kind:'use',quantity:.125,reason:'Kitchen batch'};
  assert.equal(store.adjustStock(owner,item.id,movement).balance,10);
  assert.equal(store.adjustStock(owner,item.id,movement).balance,10);
  assert.equal(store.stockHistory(owner,item.id).length,2);
  assert.throws(()=>store.adjustStock(owner,item.id,{...movement,quantity:1}),/already used/);
  assert.throws(()=>store.adjustStock(owner,item.id,{...movement,requestKey:'overdraw',quantity:11}),/Not enough/);
  assert.throws(()=>store.adjustStock(owner,item.id,{...movement,requestKey:'decimal',quantity:.0001}),/decimal/);
  assert.equal(store.inventory(owner)[0].quantity,10);
  store.adjustStock(owner,item.id,{requestKey:'count',kind:'count',quantity:1.5,expectedQuantity:10,reason:'Physical count'});
  assert.equal(store.inventory(owner)[0].low,true);
  assert.throws(()=>store.adjustStock(owner,item.id,{requestKey:'stale-count',kind:'count',quantity:2,expectedQuantity:10,reason:'Old screen'}),/Stock changed/);
  store.updateStock(owner,item.id,{name:'Chicken breast',minimum:1,supplier:'Supplier B'});
  assert.equal(store.inventory(owner)[0].quantity,1.5);assert.equal(store.inventory(owner)[0].low,false);
  assert.ok(store.audit(owner).some(e=>e.action==='inventory.count'));
});
test('inventory is owner-only and isolated by restaurant',t=>{
  const {store,owner,cashier}=fixture(t),item=store.addStock(owner,stock),other={...owner,restaurant_id:999};
  assert.throws(()=>store.inventory(cashier),/Owner/);assert.throws(()=>store.addStock(cashier,stock),/Owner/);
  assert.throws(()=>store.adjustStock(cashier,item.id,{}),/Owner/);
  assert.deepEqual(store.inventory(other),[]);assert.throws(()=>store.stockHistory(other,item.id),/not found/);
  assert.throws(()=>store.updateStock(other,item.id,{name:'Wrong',minimum:0}),/not found/);
  assert.throws(()=>store.adjustStock(other,item.id,{requestKey:'cross',kind:'receive',quantity:1,reason:'Delivery'}),/not found/);
});
test('employee profiles include linked accounts once and allow non-login restaurant staff',t=>{
  const {store,owner,cashier}=fixture(t);
  assert.equal(store.employees(owner).length,2);assert.equal(store.employees(owner).length,2);
  const waiter=store.addEmployee(owner,{name:'Waiter',job:'Waiter',phone:'03001234567'});
  assert.equal(waiter.user_id,null);assert.equal(store.employees(cashier).length,1);
  assert.throws(()=>store.addEmployee(cashier,{name:'X',job:'Chef'}),/Owner/);
  assert.equal(store.addEmployee(owner,{name:'Inactive starter',job:'Chef',active:false}).active,0);
  store.updateEmployee(owner,waiter.id,{name:'Waiter updated',job:'Floor supervisor',phone:'',active:false});
  assert.throws(()=>store.clockIn(owner,waiter.id),/inactive/);
});
test('clock-in/out enforces self access and prevents duplicate sessions and stale clock-outs',t=>{
  const {store,owner,cashier}=fixture(t),people=store.employees(owner),mine=people.find(p=>p.user_id===cashier.id),boss=people.find(p=>p.user_id===owner.id);
  assert.throws(()=>store.clockIn(cashier,boss.id),/own attendance/);
  const first=store.clockIn(cashier,mine.id);assert.throws(()=>store.clockIn(cashier,mine.id),/already/);
  assert.throws(()=>store.updateEmployee(owner,mine.id,{name:mine.name,job:mine.job,active:false}),/Clock out/);
  store.clockOut(cashier,mine.id,{attendanceId:first.id});store.clockOut(cashier,mine.id,{attendanceId:first.id});
  const second=store.clockIn(cashier,mine.id);store.clockOut(cashier,mine.id,{attendanceId:first.id});
  assert.equal(store.employees(cashier)[0].attendance_id,second.id);
  assert.throws(()=>store.clockOut({...owner,restaurant_id:999},mine.id,{attendanceId:second.id}),/not found/);
});
test('attendance date reports clip overnight sessions to Pakistan dates',t=>{
  const {store,owner,cashier}=fixture(t),person=store.employees(cashier)[0];
  const {id}=store.clockIn(cashier,person.id);
  // 23:00 Pakistan on Nov 10 until 02:00 Pakistan on Nov 11.
  store.db.prepare('UPDATE attendance SET clock_in=?,clock_out=? WHERE id=?').run('2026-11-10T18:00:00.000Z','2026-11-10T21:00:00.000Z',id);
  assert.equal(store.attendance(owner,{from:'2026-11-10',to:'2026-11-10'}).records[0].minutes,60);
  assert.equal(store.attendance(cashier,{from:'2026-11-11',to:'2026-11-11'}).records[0].minutes,120);
  assert.equal(store.attendance(owner,{from:'2026-11-10',to:'2026-11-11'}).records[0].minutes,180);
  assert.equal(store.attendance({...owner,restaurant_id:999},{from:'2026-11-10',to:'2026-11-11'}).records.length,0);
  for(const range of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-12-01',to:'2026-11-01'},{from:'2026-01-01',to:'2026-12-31'}])assert.throws(()=>store.attendance(owner,range));
});
test('HTTP inventory and attendance routes support real sessions and enforce role checks',async t=>{
  const {store}=fixture(t),server=createApp(store);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function login(email){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'test-password-123'})});return {'Content-Type':'application/json',Cookie:r.headers.get('set-cookie').split(';')[0]};}
  const ownerHeaders=await login('owner@example.com'),cashierHeaders=await login('cashier@example.com');
  const response=await fetch(base+'/api/inventory',{method:'POST',headers:ownerHeaders,body:JSON.stringify(stock)});assert.equal(response.status,201);
  assert.equal((await fetch(base+'/api/inventory',{headers:cashierHeaders})).status,403);
  const people=await (await fetch(base+'/api/employees',{headers:cashierHeaders})).json();assert.equal(people.length,1);
  const clock=await fetch(base+`/api/employees/${people[0].id}/clock-in`,{method:'POST',headers:cashierHeaders,body:'{}'});assert.equal(clock.status,200);const attendance=await clock.json();
  assert.equal((await fetch(base+`/api/employees/${people[0].id}/clock-out`,{method:'POST',headers:cashierHeaders,body:JSON.stringify({attendanceId:attendance.id})})).status,200);
  assert.equal((await fetch(base+'/api/attendance',{headers:cashierHeaders})).status,200);
  assert.equal((await fetch(base+'/api/attendance')).status,401);
});
