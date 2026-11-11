import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../lib/store.js';
import {createApp} from '../server.js';
import {decodeMenuImage,MAX_IMAGE_BYTES} from '../lib/menu-image.js';
import {menuImageUrl,validateImageFile} from '../public/menu-image.js';
const png={type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='};
const product={name:'Biryani',category:'Desi',price:450,available:true,imageData:png};
function fixture(t){const store=openStore(':memory:');t.after(()=>store.db.close());const owner=store.setup({restaurant:'Image Test',name:'Owner',email:'owner@example.com',password:'test-only-password-123'});return {store,owner};}
test('image validation rejects mismatched types, unsupported formats, malformed and oversized input',()=>{
  assert.equal(decodeMenuImage(png).type,'image/png');
  for(const image of [{...png,type:'image/jpeg'},{type:'image/svg+xml',data:Buffer.from('<svg/>').toString('base64')},{...png,data:'!!!!'},{...png,data:Buffer.alloc(MAX_IMAGE_BYTES+1).toString('base64')}])assert.throws(()=>decodeMenuImage(image));
  assert.throws(()=>validateImageFile({type:'image/png',size:MAX_IMAGE_BYTES+1}));
  assert.throws(()=>validateImageFile({type:'text/html',size:100}));
});
test('menu creation stores photo atomically and scopes access to restaurant',t=>{
  const {store,owner}=fixture(t),saved=store.addProduct(owner,product),id=saved.image.split('/').pop();
  assert.equal(Buffer.from(store.menuImage(owner,id).bytes).toString('base64'),png.data);
  assert.equal(store.menu(owner).find(p=>p.id===saved.id).image,saved.image);
  assert.equal(menuImageUrl(saved),saved.image);
  assert.throws(()=>store.menuImage({...owner,restaurant_id:999},id),/not found/);
  assert.throws(()=>store.addProduct({...owner,role:'cashier'},product),/Owner/);
  assert.throws(()=>store.addProduct(owner,{...product,imageData:{...png,data:'invalid'}}));
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM menu_images').get().n,1);
  assert.equal(menuImageUrl({image:'javascript:alert(1)'}),'/menu-placeholder.svg');
  assert.match(menuImageUrl({image:'photo-123'}),/^https:\/\/images.unsplash.com\//);
});
test('HTTP image upload and retrieval require authentication and return correct media bytes',async t=>{
  const {store}=fixture(t),server=createApp(store);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.com',password:'test-only-password-123'})});
  const headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0]};
  const created=await fetch(base+'/api/menu',{method:'POST',headers,body:JSON.stringify(product)});
  assert.equal(created.status,201);const item=await created.json();
  const image=await fetch(base+item.image,{headers});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'),png.data);
  assert.equal((await fetch(base+item.image)).status,401);
  assert.equal((await fetch(base+'/api/menu',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(product)})).status,401);
});
