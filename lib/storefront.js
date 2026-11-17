import {fail,required} from './store.js';
import {contactInput} from './customer-messaging.js';

export function storefront(store,ordering){
 const db=store.db;
 db.exec('CREATE TABLE IF NOT EXISTS storefronts(restaurant_id INTEGER PRIMARY KEY REFERENCES restaurants(id),slug TEXT NOT NULL UNIQUE,config TEXT NOT NULL)');
 const owner=u=>{if(u.role!=='owner')fail('Owner access required',403);};
 const defaults=id=>({enabled:false,slug:'restaurant-'+id,theme:'clay',headline:'Good food.\nGreat moments.',intro:'Your favourites, made for your kind of day. Explore the menu and let us take care of the rest.',about:'A little comfort. A lot of flavour. Discover something delicious for every appetite.',announcement:'Order your favourites, directly from our kitchen.',address:'',phone:'',whatsappPhone:'',hours:'',areas:[],pickup:true,delivery:false,heroProductId:0});
 function settings(u){owner(u);const r=db.prepare('SELECT * FROM storefronts WHERE restaurant_id=?').get(u.restaurant_id);return {...defaults(u.restaurant_id),...(r?JSON.parse(r.config):{}),slug:r?.slug||'restaurant-'+u.restaurant_id,restaurant:store.restaurant(u).name};}
 function resolve(slug){const row=db.prepare('SELECT * FROM storefronts WHERE slug=?').get(slug);if(!row)fail('Restaurant website is unavailable',404);const c=JSON.parse(row.config);if(!c.enabled)fail('Restaurant website is unavailable',404);return {...c,slug:row.slug,restaurantId:row.restaurant_id};}
 function save(u,input){
  owner(u);const c=settings(u),next={};
  for(const key of ['enabled','pickup','delivery']){if(typeof input[key]!=='boolean')fail('Invalid '+key);next[key]=input[key];}
  next.slug=required(input.slug,'website address',60).toLowerCase();if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(next.slug))fail('Use lowercase letters, numbers and hyphens for the website address.');
  if(!['clay','forest','plum'].includes(input.theme))fail('Choose a valid theme');next.theme=input.theme;
  for(const [key,max] of Object.entries({headline:100,intro:300,about:1000,announcement:180,address:250,phone:30,hours:160})){if(typeof input[key]!=='string'||input[key].length>max)fail('Invalid '+key);next[key]=input[key].trim();}
  const whatsappPhone=input.whatsappPhone??c.whatsappPhone;
  if(typeof whatsappPhone!=='string'||whatsappPhone.length>30)fail('Invalid WhatsApp number');
  let digits=whatsappPhone.replace(/[+\s()-]/g,'');
  if(/^03\d{9}$/.test(digits))digits='92'+digits.slice(1);
  if(digits&&!/^[1-9]\d{7,14}$/.test(digits))fail('Enter a WhatsApp number with country code, for example +923001234567');
  next.whatsappPhone=digits;
  if(!next.headline)fail('Add a headline');
  if(next.phone&&!/^\+?[0-9 ()-]{7,30}$/.test(next.phone))fail('Enter a valid contact phone');
  if(!Array.isArray(input.areas)||input.areas.length>100||input.areas.some(a=>typeof a!=='string'||!a.trim()||a.length>80))fail('Invalid delivery areas');next.areas=[...new Set(input.areas.map(a=>a.trim()))];
  if(!Number.isInteger(input.heroProductId)||input.heroProductId<0)fail('Invalid featured item');next.heroProductId=input.heroProductId;
  if(next.heroProductId&&!store.menu(u).some(p=>p.id===next.heroProductId))fail('Featured item must belong to your menu');
  if(next.enabled){if(!next.pickup&&!next.delivery)fail('Enable pickup or delivery');if(!next.address||!next.phone)fail('Add a restaurant address and contact phone');if(next.delivery&&!next.areas.length)fail('Add at least one delivery area');}
  const taken=db.prepare('SELECT restaurant_id FROM storefronts WHERE slug=?').get(next.slug);if(taken&&taken.restaurant_id!==u.restaurant_id)fail('Website address is already taken',409);
  db.prepare('INSERT INTO storefronts(restaurant_id,slug,config) VALUES(?,?,?) ON CONFLICT(restaurant_id) DO UPDATE SET slug=excluded.slug,config=excluded.config').run(u.restaurant_id,next.slug,JSON.stringify(next));
  db.prepare('INSERT INTO audit(restaurant_id,user_id,action,entity_id,created_at) VALUES(?,?,?,?,?)').run(u.restaurant_id,u.id,'website.updated',u.restaurant_id,new Date().toISOString());
  return settings(u);
 }
 return {settings,save,
  catalog(slug){const c=resolve(slug),u={restaurant_id:c.restaurantId},r=store.restaurant(u);return {...c,restaurant:r.name,taxBps:r.tax_bps,items:store.menu(u).filter(p=>p.available).map(({id,name,desc,category,price,image,tag})=>({id,name,desc,category,price,tag,image:image.startsWith('/api/menu-images/')?`/api/storefront/${slug}/images/${image.split('/').pop()}`:image}))};},
  image(slug,id){const c=resolve(slug),u={restaurant_id:c.restaurantId};if(!store.menu(u).some(p=>p.available&&p.image==='/api/menu-images/'+id))fail('Image not found',404);return store.menuImage(u,id);},
  place(slug,input){
   const c=resolve(slug);if(input.type==='Takeaway'?!c.pickup:input.type==='Delivery'?!c.delivery:true)fail('This service is unavailable');
   const customer=required(input.customer,'customer name',100),contact=contactInput(input);if(!contact.customerPhone)fail('Enter your phone number with country code');
   let address='';if(input.type==='Delivery'){if(!c.areas.includes(input.area))fail('Choose an available delivery area');address=required(input.address,'delivery address',250);}
   if(typeof input.note!=='string'||input.note.length>250)fail('Keep order notes under 250 characters');
   const note=[input.type==='Delivery'?`Deliver to: ${address}. Area: ${input.area}.`:'Pickup order.',input.note.trim()].filter(Boolean).join(' ');
   return ordering.submit(c.restaurantId,'Website','web:'+required(input.requestKey,'request key',60),{type:input.type,customer,note,items:input.items,expectedTotal:input.expectedTotal,...contact});
  }
 };
}
