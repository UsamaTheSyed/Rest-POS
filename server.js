import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, fail } from './lib/store.js';
import { bootstrapDemo } from './lib/bootstrap.js';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
export function createApp(store) {
  const attempts=new Map();
  return http.createServer(async(req,res)=>{
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' https://images.unsplash.com; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try{
      const url=new URL(req.url,'http://localhost'), route=url.pathname;
      if(route.startsWith('/api/')){
        const write=!['GET','HEAD'].includes(req.method);
        if(write){
          if(req.headers['sec-fetch-site']==='cross-site')fail('Cross-site requests are not permitted',403);
          if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)fail('Origin mismatch',403);
          if(!(req.headers['content-type']||'').startsWith('application/json'))fail('JSON content type required',415);
        }
        let input={};
        if(write){let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)fail('Request too large',413);}try{input=JSON.parse(body||'{}');}catch{fail('Invalid JSON');}if(!input||Array.isArray(input)||typeof input!=='object')fail('Invalid request');}
        const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('ember_session='))?.slice(14)||'';
        const cookie=t=>res.setHeader('Set-Cookie',`ember_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${t?43200:0}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`);
        if(route==='/api/setup'&&req.method==='GET')return json(200,{required:store.needsSetup()});
        if(route==='/api/setup'&&req.method==='POST'){
          if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))fail('Initial setup must be performed on the server computer',403);
          store.setup(input);const session=store.login(input);cookie(session.token);return json(201,{user:session.user});
        }
        if(route==='/api/login'&&req.method==='POST'){
          const key=req.socket.remoteAddress,now=Date.now();
          for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
          const attempt=attempts.get(key)||{count:0,until:now+15*60*1000};
          if(attempt.count>=10)fail('Too many attempts. Try again in 15 minutes.',429);
          attempt.count++;attempts.set(key,attempt);
          const session=store.login(input);attempts.delete(key);cookie(session.token);return json(200,{user:session.user});
        }
        const user=store.session(token);if(!user)fail('Please sign in',401);
        if(route==='/api/logout'&&req.method==='POST'){store.logout(token);cookie('');return json(200,{ok:true});}
        if(route==='/api/me'&&req.method==='GET')return json(200,{user,restaurant:store.restaurant(user)});
        if(route==='/api/menu'&&req.method==='GET')return json(200,store.menu(user));
        if(route==='/api/menu'&&req.method==='POST')return json(201,store.addProduct(user,input));
        if(route==='/api/orders'&&req.method==='GET')return json(200,store.orders(user));
        if(route==='/api/orders'&&req.method==='POST')return json(201,store.createOrder(user,input));
        if(route==='/api/order-request'&&req.method==='GET')return json(200,{order:store.orderByKey(user,url.searchParams.get('key')||'')});
        const order=route.match(/^\/api\/orders\/(\d+)$/);
        if(order&&req.method==='GET')return json(200,store.getOrder(user,Number(order[1])));
        const status=route.match(/^\/api\/orders\/(\d+)\/status$/);
        if(status&&req.method==='PATCH')return json(200,store.status(user,Number(status[1]),input.status));
        const product=route.match(/^\/api\/menu\/(\d+)$/);
        if(product&&req.method==='PATCH')return json(200,store.updateProduct(user,Number(product[1]),input));
        if(route==='/api/staff'&&req.method==='GET')return json(200,store.users(user));
        if(route==='/api/staff'&&req.method==='POST')return json(201,store.addUser(user,input));
        if(route==='/api/settings'&&req.method==='PATCH')return json(200,store.settings(user,input));
        if(route==='/api/reports'&&req.method==='GET')return json(200,store.report(user));
        if(route==='/api/audit'&&req.method==='GET')return json(200,store.audit(user));
        fail('API endpoint not found',404);
      }
      if(!['GET','HEAD'].includes(req.method))fail('Method not allowed',405);
      const filename=path.resolve(root,'.'+decodeURIComponent(route==='/'?'/index.html':route));
      if(!filename.startsWith(root+path.sep))fail('Forbidden',403);
      const body=await readFile(filename);
      res.setHeader('Content-Type',({'html':'text/html; charset=utf-8','css':'text/css','js':'text/javascript','svg':'image/svg+xml'})[filename.split('.').pop()]||'application/octet-stream');
      res.setHeader('Cache-Control','no-cache');res.end(req.method==='HEAD'?undefined:body);
    }catch(error){const status=error.status||(error.code==='ENOENT'?404:500);if(status===500)console.error('Request failed:',error.message);json(status,{error:status===500?'Internal server error':error.message});}
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const data=path.resolve(process.env.DATA_DIR||'data');await mkdir(data,{recursive:true});
  const store=openStore(path.join(data,'ember.sqlite'));
  try {
    if (bootstrapDemo(store)) console.log('Demo restaurant initialized. Sign in using the configured account.');
  } catch (error) {
    store.db.close();
    console.error('Startup setup failed:', error.message);
    process.exit(1);
  }
  const server=createApp(store);server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Ember POS: http://localhost:${process.env.PORT||3000}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.db.close();process.exit(0);}));
}
