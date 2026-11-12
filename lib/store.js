import {restaurantOperations} from './restaurant-operations.js';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { decodeMenuImage } from './menu-image.js';
import { menu } from '../public/model.js';
import { MAX_QUANTITY } from '../public/cart.js';

export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function required(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Invalid ${name}`);
  return value.trim();
}
function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) fail('Password must contain 12–200 characters');
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function verify(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(hash, 'hex'));
}
const tokenHash = token => createHash('sha256').update(token).digest('hex');

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS restaurants(id INTEGER PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'PKR', tax_bps INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, restaurant_id INTEGER NOT NULL REFERENCES restaurants(id), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','cashier','kitchen')));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, restaurant_id INTEGER NOT NULL REFERENCES restaurants(id), name TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0), image TEXT NOT NULL, tag TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS menu_images(id TEXT PRIMARY KEY, restaurant_id INTEGER NOT NULL REFERENCES restaurants(id), content_type TEXT NOT NULL, bytes BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, restaurant_id INTEGER NOT NULL REFERENCES restaurants(id), staff_id INTEGER NOT NULL REFERENCES users(id), request_key TEXT NOT NULL, request_body TEXT NOT NULL, created_at TEXT NOT NULL, type TEXT NOT NULL, customer TEXT NOT NULL, note TEXT NOT NULL, payment TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', subtotal INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL, UNIQUE(restaurant_id, request_key));
    CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL, qty INTEGER NOT NULL CHECK(qty > 0));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, restaurant_id INTEGER NOT NULL, user_id INTEGER NOT NULL, action TEXT NOT NULL, entity_id INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS orders_restaurant ON orders(restaurant_id, id);
    PRAGMA user_version=1;`);
  if(!db.prepare('PRAGMA table_info(products)').all().some(column=>column.name==='deleted_at'))db.exec('ALTER TABLE products ADD COLUMN deleted_at TEXT');
  if(!db.prepare('PRAGMA table_info(orders)').all().some(column=>column.name==='paid_at')){
    db.exec("BEGIN IMMEDIATE; ALTER TABLE orders ADD COLUMN paid_at TEXT; UPDATE orders SET paid_at=created_at WHERE payment!='Unpaid'; COMMIT;");
  }
  const orderColumns=db.prepare('PRAGMA table_info(orders)').all();
  if(!orderColumns.some(c=>c.name==='revision'))db.exec('ALTER TABLE orders ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
  if(!orderColumns.some(c=>c.name==='tax_bps'))db.exec('ALTER TABLE orders ADD COLUMN tax_bps REAL; UPDATE orders SET tax_bps=CASE WHEN subtotal>0 THEN tax*10000.0/subtotal ELSE 0 END');
  db.exec('CREATE TABLE IF NOT EXISTS order_revisions(id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),revision INTEGER NOT NULL,before_json TEXT NOT NULL,changes TEXT NOT NULL,created_at TEXT NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id))');
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const audit = (user, action, id) => db.prepare('INSERT INTO audit(restaurant_id,user_id,action,entity_id,created_at) VALUES(?,?,?,?,?)').run(user.restaurant_id, user.id, action, id, new Date().toISOString());
  const safeUser = u => ({ id:u.id, restaurant_id:u.restaurant_id, name:u.name, email:u.email, role:u.role });
  function addUser(restaurantId, input) {
    const name = required(input.name, 'name', 100), email = required(input.email, 'email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email');
    const hash = passwordHash(input.password);
    if (!['owner','cashier','kitchen'].includes(input.role)) fail('Invalid role');
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) fail('Email already exists',409);
    const id = Number(db.prepare('INSERT INTO users(restaurant_id,name,email,password,role) VALUES(?,?,?,?,?)').run(restaurantId,name,email,hash,input.role).lastInsertRowid);
    return safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  }
  function getOrder(user,id) {
    const row = db.prepare('SELECT * FROM orders WHERE restaurant_id=? AND id=?').get(user.restaurant_id,id);
    if (!row) fail('Order not found',404);
    const items = db.prepare('SELECT product_id AS id,name,price,qty FROM order_items WHERE order_id=?').all(id).map(p=>({...p,price:p.price/100}));
    return {id:row.id,date:row.created_at,type:row.type,customer:row.customer,note:row.note,revision:row.revision,taxBps:row.tax_bps,changes:db.prepare('SELECT changes FROM order_revisions WHERE order_id=? ORDER BY id DESC LIMIT 1').get(id)?.changes||'',payment:row.payment,paymentStatus:row.paid_at?'paid':'unpaid',paidAt:row.paid_at,status:row.status,subtotal:row.subtotal/100,tax:row.tax/100,total:row.total/100,items};
  }
  return {
    db,
    ...restaurantOperations(db,{fail,required,transaction,audit}),
    needsSetup:()=>!db.prepare('SELECT id FROM users LIMIT 1').get(),
    setup(input) { return transaction(()=>{
      if(db.prepare('SELECT id FROM users LIMIT 1').get()) fail('Setup has already been completed',409);
      const restaurantId=Number(db.prepare('INSERT INTO restaurants(name) VALUES(?)').run(required(input.restaurant,'restaurant name',100)).lastInsertRowid);
      const owner=addUser(restaurantId,{...input,role:'owner'});
      const insert=db.prepare('INSERT INTO products(restaurant_id,name,description,category,price,image,tag) VALUES(?,?,?,?,?,?,?)');
      for(const p of menu) insert.run(restaurantId,p.name,p.desc,p.category,p.price*100,p.image,p.tag||'');
      audit(owner,'restaurant.setup',restaurantId);return owner;
    }); },
    login(input) {
      const email=required(input.email,'email').toLowerCase();
      if(typeof input.password!=='string'||input.password.length>200) fail('Invalid credentials',401);
      const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
      const dummy='00000000000000000000000000000000:'+ '00'.repeat(64);
      const valid=verify(input.password,user?.password||dummy);
      if(!user||!valid) fail('Invalid credentials',401);
      db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
      const token=randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),user.id,Date.now()+12*60*60*1000);
      return {token,user:safeUser(user)};
    },
    session(token) { const user=db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(tokenHash(token||''),Date.now());return user?safeUser(user):null; },
    logout(token) { db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(token||'')); },
    restaurant(user) { return db.prepare('SELECT * FROM restaurants WHERE id=?').get(user.restaurant_id); },
    menu(user) { return db.prepare('SELECT id,name,description AS desc,category,price,image,tag,available FROM products WHERE restaurant_id=? AND deleted_at IS NULL ORDER BY id').all(user.restaurant_id).map(p=>({...p,price:p.price/100,available:!!p.available})); },
    orders(user) { return db.prepare('SELECT id FROM orders WHERE restaurant_id=? AND (paid_at IS NULL OR status!=\'served\' OR id IN (SELECT id FROM orders WHERE restaurant_id=? ORDER BY id DESC LIMIT 200)) ORDER BY id DESC').all(user.restaurant_id,user.restaurant_id).map(o=>getOrder(user,o.id)); },
    orderByKey(user,key) { const row=db.prepare('SELECT id FROM orders WHERE restaurant_id=? AND request_key=?').get(user.restaurant_id,key);return row?getOrder(user,row.id):null; },
    createOrder(user,input) { return transaction(()=>{
      if(!['owner','cashier'].includes(user.role)) fail('Cashier access required',403);
      const key=required(input.requestKey,'request key',80);
      if(!Array.isArray(input.items)||!input.items.length||input.items.length>100) fail('Order must contain 1–100 items');
      if(input.items.some(p=>!p||typeof p!=='object'))fail('Invalid order item');
      if(!['Dine-in','Takeaway','Delivery'].includes(input.type)) fail('Invalid service type');
      const payment=input.payment===undefined?'Unpaid':input.payment;
      if(!['Unpaid','Cash','Card (external terminal)'].includes(payment)) fail('Invalid payment method');
      const customer=typeof input.customer==='string'?input.customer.trim():'',note=typeof input.note==='string'?input.note.trim():'';
      if(customer.length>200||note.length>1000) fail('Customer or note is too long');
      const canonical=JSON.stringify({items:input.items.map(p=>({id:p.id,qty:p.qty})),type:input.type,payment,customer,note});
      const old=db.prepare('SELECT id,request_body FROM orders WHERE restaurant_id=? AND request_key=?').get(user.restaurant_id,key);
      if(old){if(old.request_body!==canonical)fail('Request key was already used for a different order',409);return getOrder(user,old.id);}
      const items=input.items.map(item=>{
        if(!Number.isSafeInteger(item.id)||!Number.isInteger(item.qty)||item.qty<1||item.qty>MAX_QUANTITY) fail('Invalid item quantity');
        const product=db.prepare('SELECT * FROM products WHERE id=? AND restaurant_id=? AND available=1 AND deleted_at IS NULL').get(item.id,user.restaurant_id);
        if(!product) fail('An item is unavailable');
        return {...product,qty:item.qty};
      });
      const subtotal=items.reduce((s,p)=>s+p.price*p.qty,0);
      if(!Number.isSafeInteger(subtotal)||subtotal>100000000)fail('Order amount exceeds the supported limit');
      const taxBps=db.prepare('SELECT tax_bps FROM restaurants WHERE id=?').get(user.restaurant_id).tax_bps;
      const tax=Math.round(subtotal*taxBps/10000);
      if(input.expectedTotal!== (subtotal+tax)/100) fail('Menu prices or tax changed. Refresh the menu and review this order before taking payment.',409);
      const id=Number(db.prepare('INSERT INTO orders(restaurant_id,staff_id,request_key,request_body,created_at,type,customer,note,payment,subtotal,tax,total) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(user.restaurant_id,user.id,key,canonical,new Date().toISOString(),input.type,customer,note,payment,subtotal,tax,subtotal+tax).lastInsertRowid);
      for(const p of items)db.prepare('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)').run(id,p.id,p.name,p.price,p.qty);
      db.prepare('UPDATE orders SET tax_bps=? WHERE id=?').run(taxBps,id);
      if(payment!=='Unpaid')db.prepare('UPDATE orders SET paid_at=created_at WHERE id=?').run(id);
      audit(user,payment==='Unpaid'?'order.placed':'order.payment_recorded',id);return getOrder(user,id);
    }); },
    editOrder(user,id,input){return transaction(()=>{
      if(!['owner','cashier'].includes(user.role))fail('Cashier access required',403);
      const old=getOrder(user,id);if(old.paymentStatus==='paid')fail('Paid orders cannot be edited',409);
      if(input.expectedRevision!==old.revision)fail('Order changed. Reopen it before editing.',409);
      if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)fail('An order must contain 1–100 items');
      const seen=new Set();
      const items=input.items.map(p=>{
        if(!p||!Number.isSafeInteger(p.id)||!Number.isInteger(p.qty)||p.qty<1||p.qty>MAX_QUANTITY||seen.has(p.id))fail('Invalid or duplicate order item');seen.add(p.id);
        const existing=old.items.find(x=>x.id===p.id);
        if(existing)return {...existing,qty:p.qty};
        const product=db.prepare('SELECT * FROM products WHERE restaurant_id=? AND id=? AND available=1 AND deleted_at IS NULL').get(user.restaurant_id,p.id);
        if(!product)fail('An added item is unavailable');return {id:product.id,name:product.name,price:product.price/100,qty:p.qty};
      });
      const note=typeof input.note==='string'?input.note:old.note,customer=typeof input.customer==='string'?input.customer:old.customer;
      if(note.length>1000||customer.length>200)fail('Customer or note is too long');
      const subtotal=items.reduce((s,p)=>s+Math.round(p.price*100)*p.qty,0),tax=Math.round(subtotal*old.taxBps/10000);
      if(subtotal>100000000)fail('Order amount exceeds the supported limit');
      if(input.expectedTotal!==(subtotal+tax)/100)fail('Prices changed. Reopen the editor and review the total.',409);
      const changes=[];
      for(const p of old.items){const next=items.find(x=>x.id===p.id);if(!next)changes.push(`Removed ${p.qty} × ${p.name}`);else if(next.qty!==p.qty)changes.push(`${p.name}: ${p.qty} → ${next.qty}`);}
      for(const p of items)if(!old.items.some(x=>x.id===p.id))changes.push(`Added ${p.qty} × ${p.name}`);
      const kitchenChanged=changes.length>0||note!==old.note;
      if(note!==old.note)changes.push('Order note updated');if(customer!==old.customer)changes.push('Table/customer reference updated');
      if(!changes.length)return old;
      db.prepare('DELETE FROM order_items WHERE order_id=?').run(id);
      for(const p of items)db.prepare('INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)').run(id,p.id,p.name,Math.round(p.price*100),p.qty);
      db.prepare('UPDATE orders SET subtotal=?,tax=?,total=?,customer=?,note=?,revision=revision+1,status=? WHERE id=?').run(subtotal,tax,subtotal+tax,customer,note,kitchenChanged?'queued':old.status,id);
      db.prepare('INSERT INTO order_revisions(order_id,revision,before_json,changes,created_at,user_id) VALUES(?,?,?,?,?,?)').run(id,old.revision+1,JSON.stringify(old),changes.join('; '),new Date().toISOString(),user.id);
      audit(user,'order.edited',id);return getOrder(user,id);
    });},
    collectPayment(user,id,input){return transaction(()=>{
      if(!['owner','cashier'].includes(user.role))fail('Cashier access required',403);
      const order=getOrder(user,id);
      if(!['Cash','Card (external terminal)'].includes(input.payment))fail('Invalid payment method');
      if((input.expectedRevision??0)!==order.revision)fail('Order changed. Reopen payment and review the bill.',409);
      if(input.expectedTotal!==order.total)fail('Order total does not match. Refresh and review the bill.',409);
      if(order.paymentStatus==='paid'){
        if(order.payment!==input.payment)fail('This order has already been paid using another method.',409);
        return {...order,alreadyPaid:true};
      }
      db.prepare('UPDATE orders SET payment=?,paid_at=? WHERE id=? AND restaurant_id=? AND paid_at IS NULL').run(input.payment,new Date().toISOString(),id,user.restaurant_id);
      audit(user,'order.payment_recorded',id);return getOrder(user,id);
    });},
    status(user,id,status,expectedRevision=0) { return transaction(()=>{
      if(!['owner','kitchen'].includes(user.role))fail('Kitchen access required',403);
      const order=getOrder(user,id),next={queued:'preparing',preparing:'ready',ready:'served'};
      if(expectedRevision!==order.revision)fail('Order changed. Refresh the kitchen screen.',409);
      if(next[order.status]!==status)fail('Invalid order status transition',409);
      db.prepare('UPDATE orders SET status=? WHERE id=? AND restaurant_id=?').run(status,id,user.restaurant_id);
      audit(user,`order.${status}`,id);return getOrder(user,id);
    }); },
    users(user) { if(user.role!=='owner')fail('Owner access required',403);return db.prepare('SELECT id,name,email,role FROM users WHERE restaurant_id=?').all(user.restaurant_id); },
    addUser(user,input) {if(user.role!=='owner')fail('Owner access required',403);return transaction(()=>{const staff=addUser(user.restaurant_id,input);audit(user,'staff.created',staff.id);return staff;});},
    menuImage(user,id) { const image=db.prepare('SELECT content_type,bytes FROM menu_images WHERE id=? AND restaurant_id=?').get(id,user.restaurant_id);if(!image)fail('Image not found',404);return image; },
    addProduct(user,input) {if(user.role!=='owner')fail('Owner access required',403);return transaction(()=>{
      const name=required(input.name,'item name',100),category=required(input.category,'category',60);
      const description=input.description??'',tag=input.tag??'';
      if(typeof description!=='string'||description.length>300)fail('Description must be 300 characters or less');
      if(typeof tag!=='string'||tag.length>40)fail('Badge must be 40 characters or less');
      if(!Number.isFinite(input.price)||input.price<0||input.price>100000||Math.abs(input.price*100-Math.round(input.price*100))>0.00001)fail('Price must have at most two decimal places');
      if(typeof input.available!=='boolean')fail('Invalid availability');
      let image='';
      if(input.imageData!=null){
        const decoded=decodeMenuImage(input.imageData),imageId=randomUUID();
        db.prepare('INSERT INTO menu_images(id,restaurant_id,content_type,bytes) VALUES(?,?,?,?)').run(imageId,user.restaurant_id,decoded.type,decoded.bytes);
        image='/api/menu-images/'+imageId;
      }
      const id=Number(db.prepare('INSERT INTO products(restaurant_id,name,description,category,price,image,tag,available) VALUES(?,?,?,?,?,?,?,?)').run(user.restaurant_id,name,description.trim(),category,Math.round(input.price*100),image,tag.trim(),Number(input.available)).lastInsertRowid);
      audit(user,'menu.created',id);return {id,name,desc:description.trim(),category,price:input.price,image,tag:tag.trim(),available:input.available};
    });},
    updateProduct(user,id,input) {if(user.role!=='owner')fail('Owner access required',403);return transaction(()=>{
      const current=db.prepare('SELECT * FROM products WHERE restaurant_id=? AND id=? AND deleted_at IS NULL').get(user.restaurant_id,id);
      if(!current)fail('Item not found',404);
      const name=input.name===undefined?current.name:required(input.name,'item name',100);
      const category=input.category===undefined?current.category:required(input.category,'category',60);
      const description=input.description===undefined?current.description:input.description;
      const tag=input.tag===undefined?current.tag:input.tag;
      if(typeof description!=='string'||description.length>300)fail('Description must be 300 characters or less');
      if(typeof tag!=='string'||tag.length>40)fail('Badge must be 40 characters or less');
      if(!Number.isFinite(input.price)||input.price<0||input.price>100000||Math.abs(input.price*100-Math.round(input.price*100))>0.00001)fail('Price must have at most two decimal places');
      if(typeof input.available!=='boolean')fail('Invalid availability');
      let image=current.image;
      if(input.imageData===null)image='';
      else if(input.imageData!==undefined){
        const decoded=decodeMenuImage(input.imageData),imageId=randomUUID();
        db.prepare('INSERT INTO menu_images(id,restaurant_id,content_type,bytes) VALUES(?,?,?,?)').run(imageId,user.restaurant_id,decoded.type,decoded.bytes);
        image='/api/menu-images/'+imageId;
      }
      db.prepare('UPDATE products SET name=?,category=?,description=?,tag=?,price=?,available=?,image=? WHERE restaurant_id=? AND id=?').run(name,category,description.trim(),tag.trim(),Math.round(input.price*100),Number(input.available),image,user.restaurant_id,id);
      audit(user,'menu.updated',id);
      return {id,name,category,desc:description.trim(),tag:tag.trim(),price:input.price,available:input.available,image};
    });},
    deleteProduct(user,id) {if(user.role!=='owner')fail('Owner access required',403);return transaction(()=>{
      const result=db.prepare('UPDATE products SET deleted_at=?,available=0 WHERE restaurant_id=? AND id=? AND deleted_at IS NULL').run(new Date().toISOString(),user.restaurant_id,id);
      if(!result.changes)fail('Item not found',404);
      audit(user,'menu.deleted',id);return {ok:true};
    });},
    settings(user,input){if(user.role!=='owner')fail('Owner access required',403);if(!Number.isInteger(input.tax_bps)||input.tax_bps<0||input.tax_bps>10000)fail('Invalid tax rate');return transaction(()=>{db.prepare('UPDATE restaurants SET name=?,tax_bps=? WHERE id=?').run(required(input.name,'restaurant name',100),input.tax_bps,user.restaurant_id);audit(user,'settings.updated',user.restaurant_id);return {ok:true};});},
    report(user){if(user.role!=='owner')fail('Owner access required',403);return db.prepare("SELECT date(paid_at,'+5 hours') AS date,COUNT(*) AS orders,SUM(subtotal)/100.0 AS subtotal,SUM(tax)/100.0 AS tax,SUM(total)/100.0 AS total FROM orders WHERE restaurant_id=? AND paid_at IS NOT NULL GROUP BY date(paid_at,'+5 hours') ORDER BY date DESC LIMIT 90").all(user.restaurant_id);},
    audit(user){if(user.role!=='owner')fail('Owner access required',403);return db.prepare('SELECT a.id,a.action,a.entity_id,a.created_at,u.name AS staff FROM audit a JOIN users u ON u.id=a.user_id WHERE a.restaurant_id=? ORDER BY a.id DESC LIMIT 200').all(user.restaurant_id);},
    getOrder
  };
}
