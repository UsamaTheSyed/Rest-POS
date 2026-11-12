// Stock is held in thousandths of the selected unit; attendance timestamps are UTC.
export function restaurantOperations(db, {fail,required,transaction,audit}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_items(id INTEGER PRIMARY KEY, restaurant_id INTEGER NOT NULL REFERENCES restaurants(id), name TEXT NOT NULL, unit TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0), minimum INTEGER NOT NULL DEFAULT 0, supplier TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS stock_movements(id INTEGER PRIMARY KEY, restaurant_id INTEGER NOT NULL REFERENCES restaurants(id), item_id INTEGER NOT NULL REFERENCES stock_items(id), user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, delta INTEGER NOT NULL, balance INTEGER NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, request_key TEXT NOT NULL, request_body TEXT NOT NULL, UNIQUE(restaurant_id,request_key));
    CREATE TABLE IF NOT EXISTS employees(id INTEGER PRIMARY KEY, restaurant_id INTEGER NOT NULL REFERENCES restaurants(id), user_id INTEGER UNIQUE REFERENCES users(id), name TEXT NOT NULL, job TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS attendance(id INTEGER PRIMARY KEY, restaurant_id INTEGER NOT NULL REFERENCES restaurants(id), employee_id INTEGER NOT NULL REFERENCES employees(id), clock_in TEXT NOT NULL, clock_out TEXT, recorded_by INTEGER NOT NULL REFERENCES users(id), closed_by INTEGER REFERENCES users(id));
    CREATE UNIQUE INDEX IF NOT EXISTS attendance_open ON attendance(employee_id) WHERE clock_out IS NULL;
    CREATE INDEX IF NOT EXISTS stock_history ON stock_movements(restaurant_id,item_id,id);
    CREATE INDEX IF NOT EXISTS attendance_history ON attendance(restaurant_id,clock_in);
  `);
  const owner=u=>{if(u.role!=='owner')fail('Owner access required',403);};
  const units=['kg','g','litre','ml','piece','pack'];
  function amount(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000||Math.abs(value*1000-Math.round(value*1000))>0.00001)fail('Quantity must be between 0 and 1,000,000 with up to 3 decimal places');return Math.round(value*1000);}
  function short(value,label,max){if(value===undefined)return '';if(typeof value!=='string'||value.length>max)fail(`Invalid ${label}`);return value.trim();}
  const stock=u=>db.prepare('SELECT * FROM stock_items WHERE restaurant_id=? AND active=1 ORDER BY name,id').all(u.restaurant_id).map(p=>({...p,quantity:p.quantity/1000,minimum:p.minimum/1000,low:p.quantity<=p.minimum}));
  function syncEmployees(u){db.prepare("INSERT OR IGNORE INTO employees(restaurant_id,user_id,name,job) SELECT restaurant_id,id,name,role FROM users WHERE restaurant_id=?").run(u.restaurant_id);}
  function employee(u,id){syncEmployees(u);const e=db.prepare('SELECT * FROM employees WHERE restaurant_id=? AND id=?').get(u.restaurant_id,id);if(!e)fail('Employee not found',404);return e;}
  function permittedEmployee(u,id){const e=employee(u,id);if(u.role!=='owner'&&e.user_id!==u.id)fail('You can only record your own attendance',403);return e;}
  const today=()=>new Date(Date.now()+5*3600000).toISOString().slice(0,10);
  function dates(from=today(),to=today()){
    for(const d of [from,to])if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)fail('Invalid attendance date');
    const start=Date.parse(from+'T00:00:00+05:00'),end=Date.parse(to+'T00:00:00+05:00')+86400000;
    if(end<=start||end-start>93*86400000)fail('Choose an ordered date range of at most 93 days');
    return {start,end,from,to};
  }
  return {
    inventory(u){owner(u);return stock(u);},
    addStock(u,input){owner(u);return transaction(()=>{
      const name=required(input.name,'stock item name',100),unit=required(input.unit,'unit',20);
      if(!units.includes(unit))fail('Invalid stock unit');
      const quantity=amount(input.quantity),minimum=amount(input.minimum),supplier=short(input.supplier,'supplier',150);
      const id=Number(db.prepare('INSERT INTO stock_items(restaurant_id,name,unit,quantity,minimum,supplier) VALUES(?,?,?,?,?,?)').run(u.restaurant_id,name,unit,quantity,minimum,supplier).lastInsertRowid);
      db.prepare('INSERT INTO stock_movements(restaurant_id,item_id,user_id,kind,delta,balance,reason,created_at,request_key,request_body) VALUES(?,?,?,?,?,?,?,?,?,?)').run(u.restaurant_id,id,u.id,'opening',quantity,quantity,'Opening stock',new Date().toISOString(),'opening:'+id,'');
      audit(u,'inventory.created',id);return stock(u).find(p=>p.id===id);
    });},
    updateStock(u,id,input){owner(u);return transaction(()=>{
      const item=db.prepare('SELECT * FROM stock_items WHERE restaurant_id=? AND id=? AND active=1').get(u.restaurant_id,id);if(!item)fail('Stock item not found',404);
      db.prepare('UPDATE stock_items SET name=?,minimum=?,supplier=? WHERE id=?').run(required(input.name,'stock item name',100),amount(input.minimum),short(input.supplier,'supplier',150),id);
      audit(u,'inventory.updated',id);return {ok:true};
    });},
    adjustStock(u,id,input){owner(u);return transaction(()=>{
      const requestKey=required(input.requestKey,'request key',100),reason=required(input.reason,'reason',300);
      if(!['receive','use','waste','count'].includes(input.kind))fail('Invalid stock movement');
      const quantity=amount(input.quantity),body=JSON.stringify({id,kind:input.kind,quantity,reason,expected:input.expectedQuantity});
      const existing=db.prepare('SELECT * FROM stock_movements WHERE restaurant_id=? AND request_key=?').get(u.restaurant_id,requestKey);
      if(existing){if(existing.request_body!==body)fail('Request key already used',409);return {ok:true,balance:existing.balance/1000};}
      const item=db.prepare('SELECT * FROM stock_items WHERE restaurant_id=? AND id=? AND active=1').get(u.restaurant_id,id);if(!item)fail('Stock item not found',404);
      if(input.kind!=='count'&&quantity===0)fail('Enter a quantity greater than zero');
      if(input.kind==='count'&&amount(input.expectedQuantity)!==item.quantity)fail('Stock changed. Refresh before entering a stock count.',409);
      const delta=input.kind==='count'?quantity-item.quantity:quantity*(input.kind==='receive'?1:-1),balance=item.quantity+delta;
      if(balance<0)fail('Not enough stock for this adjustment',409);
      if(balance>1000000000)fail('Stock quantity exceeds supported limit');
      db.prepare('UPDATE stock_items SET quantity=? WHERE id=?').run(balance,id);
      db.prepare('INSERT INTO stock_movements(restaurant_id,item_id,user_id,kind,delta,balance,reason,created_at,request_key,request_body) VALUES(?,?,?,?,?,?,?,?,?,?)').run(u.restaurant_id,id,u.id,input.kind,delta,balance,reason,new Date().toISOString(),requestKey,body);
      audit(u,'inventory.'+input.kind,id);return {ok:true,balance:balance/1000};
    });},
    stockHistory(u,id){owner(u);if(!db.prepare('SELECT id FROM stock_items WHERE restaurant_id=? AND id=?').get(u.restaurant_id,id))fail('Stock item not found',404);return db.prepare('SELECT m.*,u.name AS staff FROM stock_movements m JOIN users u ON u.id=m.user_id WHERE m.restaurant_id=? AND m.item_id=? ORDER BY m.id DESC LIMIT 200').all(u.restaurant_id,id).map(m=>({id:m.id,kind:m.kind,delta:m.delta/1000,balance:m.balance/1000,reason:m.reason,date:m.created_at,staff:m.staff}));},
    employees(u){syncEmployees(u);return db.prepare(`SELECT e.*,a.id AS attendance_id,a.clock_in FROM employees e LEFT JOIN attendance a ON a.employee_id=e.id AND a.clock_out IS NULL WHERE e.restaurant_id=? ${u.role==='owner'?'':'AND e.user_id=?'} ORDER BY e.active DESC,e.name`).all(...(u.role==='owner'?[u.restaurant_id]:[u.restaurant_id,u.id]));},
    addEmployee(u,input){owner(u);return transaction(()=>{
      const active=input.active===undefined?true:input.active;if(typeof active!=='boolean')fail('Invalid employee status');
      const id=Number(db.prepare('INSERT INTO employees(restaurant_id,name,job,phone,active) VALUES(?,?,?,?,?)').run(u.restaurant_id,required(input.name,'employee name',100),required(input.job,'job title',100),short(input.phone,'phone',40),Number(active)).lastInsertRowid);
      audit(u,'employee.created',id);return employee(u,id);
    });},
    updateEmployee(u,id,input){owner(u);return transaction(()=>{
      const e=employee(u,id);if(typeof input.active!=='boolean')fail('Invalid employee status');
      if(!input.active&&db.prepare('SELECT id FROM attendance WHERE employee_id=? AND clock_out IS NULL').get(id))fail('Clock out this employee before marking inactive',409);
      if(e.user_id===u.id&&!input.active)fail('You cannot deactivate your own attendance profile');
      db.prepare('UPDATE employees SET name=?,job=?,phone=?,active=? WHERE id=?').run(required(input.name,'employee name',100),required(input.job,'job title',100),short(input.phone,'phone',40),Number(input.active),id);
      audit(u,'employee.updated',id);return {ok:true};
    });},
    clockIn(u,id){return transaction(()=>{
      const e=permittedEmployee(u,id);if(!e.active)fail('Employee is inactive',409);
      if(db.prepare('SELECT id FROM attendance WHERE employee_id=? AND clock_out IS NULL').get(id))fail('Employee is already clocked in',409);
      const attendanceId=Number(db.prepare('INSERT INTO attendance(restaurant_id,employee_id,clock_in,recorded_by) VALUES(?,?,?,?)').run(u.restaurant_id,id,new Date().toISOString(),u.id).lastInsertRowid);
      audit(u,'attendance.clock_in',attendanceId);return {id:attendanceId};
    });},
    clockOut(u,id,input){return transaction(()=>{
      permittedEmployee(u,id);if(!Number.isSafeInteger(input.attendanceId))fail('Invalid attendance record');
      const row=db.prepare('SELECT * FROM attendance WHERE restaurant_id=? AND employee_id=? AND id=?').get(u.restaurant_id,id,input.attendanceId);
      if(!row)fail('Attendance record not found',404);
      if(row.clock_out)return {ok:true};
      const now=new Date().toISOString();if(now<row.clock_in)fail('Server time is before clock-in time',409);
      db.prepare('UPDATE attendance SET clock_out=?,closed_by=? WHERE id=?').run(now,u.id,row.id);audit(u,'attendance.clock_out',row.id);return {ok:true};
    });},
    attendance(u,query={}){
      syncEmployees(u);const range=dates(query.from,query.to),params=[u.restaurant_id,new Date(range.end).toISOString(),new Date(range.start).toISOString()];
      let filter='';if(u.role!=='owner'){filter=' AND e.user_id=?';params.push(u.id);}
      const records=db.prepare(`SELECT a.*,e.name,e.job,actor.name AS recorded_by_name FROM attendance a JOIN employees e ON e.id=a.employee_id JOIN users actor ON actor.id=a.recorded_by WHERE a.restaurant_id=? AND a.clock_in<? AND (a.clock_out IS NULL OR a.clock_out>?)${filter} ORDER BY a.clock_in DESC,a.id DESC`).all(...params);
      const now=Date.now();return {from:range.from,to:range.to,records:records.map(r=>({...r,minutes:Math.max(0,Math.floor((Math.min(r.clock_out?Date.parse(r.clock_out):now,range.end)-Math.max(Date.parse(r.clock_in),range.start))/60000))}))};
    }
  };
}
