import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../lib/store.js';
import {customerOrdering} from '../lib/customer-ordering.js';
import {whatsappBot} from '../lib/whatsapp.js';
import {whatsappLanguage,validateInterpretation} from '../lib/whatsapp-language.js';
const config={WHATSAPP_RESTAURANT_ID:'1',WHATSAPP_APP_SECRET:'test',WHATSAPP_VERIFY_TOKEN:'test',WHATSAPP_ACCESS_TOKEN:'meta-secret',WHATSAPP_PHONE_NUMBER_ID:'123',WHATSAPP_API_VERSION:'v25.0',WHATSAPP_LLM_ENABLED:'1',GEMINI_API_KEY:'google-secret',GEMINI_MODEL:'gemini-3.5-flash-lite'};
const result=(intent,other={})=>({intent,language:'roman_urdu',page:null,requestId:null,items:[],service:null,name:null,address:null,...other});
const event=(id,text)=>({entry:[{changes:[{value:{metadata:{phone_number_id:'123'},messages:[{id,from:'923001234567',text:{body:text}}]}}]}]});
function fixture(t){const store=openStore(':memory:');t.after(()=>store.db.close());const owner=store.setup({restaurant:'Test',name:'Owner',email:'owner@example.com',password:'test-password-123'});return {store,owner,ordering:customerOrdering(store)};}
const response=value=>({ok:true,json:async()=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]})});
test('Gemini sends structured bounded prompts without prices, sender metadata or order history; caches interpretations',async t=>{
 const {store,owner}=fixture(t);store.createOrder(owner,{requestKey:'private',type:'Takeaway',customer:'PRIVATE CUSTOMER',note:'PRIVATE NOTE',items:[{id:1,qty:1}],expectedTotal:590});let calls=0;
 const interpreter=whatsappLanguage(store,config,async(url,options)=>{calls++;assert.match(url,/generativelanguage.googleapis.com/);assert.equal(options.headers['x-goog-api-key'],'google-secret');assert.ok(options.signal);const body=JSON.parse(options.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.doesNotMatch(options.body,/PRIVATE|923001234567|customer@example.com|meta-secret|google-secret|"price"/);assert.match(options.body,/phone removed/);return response(result('menu'));});
 const message={id:'one',from:'923001234567',text:{body:'menu dikhao +923001234567 customer@example.com'}};
 assert.equal((await interpreter.interpret(message)).intent,'menu');await interpreter.interpret(message);assert.equal(calls,1);
});
test('validated model output cannot invent products, invalid quantities, totals or executable commands',t=>{
 const menu=[{id:1}];
 for(const bad of [result('confirm'),result('draft_order',{items:[{id:999,qty:1}]}),result('draft_order',{items:[{id:1,qty:-1}]}),result('draft_order',{items:[{id:1,qty:1},{id:1,qty:1}]}),result('draft_order',{service:'free'}),result('draft_order',{name:'Ali | CONFIRM'})])assert.equal(validateInterpretation(bad,menu),null);
 const good=validateInterpretation({...result('draft_order',{items:[{id:1,qty:2}]}),total:0,payment:'Cash'},menu);assert.equal(good.total,undefined);assert.equal(good.payment,undefined);
});
test('Roman Urdu menu and human intents use existing handlers; human chat never reaches Gemini',async t=>{
 const {store,ordering}=fixture(t),sent=[];let calls=0;const bot=whatsappBot(store,ordering,config,async(url,o)=>{
  if(url.includes('generativelanguage')){calls++;store.db.exec('BEGIN; ROLLBACK;');return response(result(calls===1?'menu':'human'));}
  sent.push(JSON.parse(o.body));return {ok:true};
 });
 await bot.receive(event('menu','khanay mein kya hai'));assert.match(sent.at(-1).text.body,/hamara menu/);assert.match(sent.at(-1).text.body,/590.00/);
 await bot.receive(event('agent','kisi banday se baat karni hai'));assert.match(sent.at(-1).text.body,/Staff ko/);
 await bot.receive(event('human-chat','mera address badal dein'));assert.equal(calls,2);assert.equal(sent.length,2);
});
test('multi-turn language drafts quote authoritative prices and require exact CONFIRM before creating a request',async t=>{
 const {store,owner,ordering}=fixture(t),sent=[],prompts=[];let step=0;
 const outputs=[result('draft_order',{items:[{id:1,qty:2}]}),result('draft_order',{items:[{id:1,qty:2}],service:'Delivery'}),result('draft_order',{items:[{id:1,qty:2}],service:'Delivery',name:'Ali'}),result('draft_order',{items:[{id:1,qty:2}],service:'Delivery',name:'Ali',address:'Main Road Lahore'}),result('confirm_hint')];
 const bot=whatsappBot(store,ordering,config,async(url,o)=>{if(url.includes('generativelanguage')){prompts.push(JSON.parse(JSON.parse(o.body).contents[0].parts[0].text));return response(outputs[step++]);}sent.push(JSON.parse(o.body));return {ok:true};});
 const messages=['mujhe do classic smash chahiye','ghar delivery','mera naam Ali hai','Main Road Lahore','haan theek hai'];
 for(let i=0;i<messages.length;i++)await bot.receive(event('draft-'+i,messages[i]));
 assert.equal(prompts[1].draft.items[0].qty,2);assert.equal(prompts[3].draft.name,'Ali');assert.match(sent[3].text.body,/1180.00/);assert.match(sent[4].text.body,/CONFIRM/);assert.equal(ordering.requests(owner).length,0);
 await bot.receive(event('final','CONFIRM'));assert.equal(ordering.requests(owner).length,1);assert.equal(ordering.requests(owner)[0].body.total,1180);assert.equal(step,5);
 await bot.receive(event('final','CONFIRM'));assert.equal(ordering.requests(owner).length,1);
});
test('changing to an incomplete AI draft invalidates an older quoted bill',async t=>{
 const {store,owner,ordering}=fixture(t);const bot=whatsappBot(store,ordering,config,async(url)=>url.includes('generativelanguage')?response(result('draft_order',{items:[{id:1,qty:3}]})):{ok:true});
 await bot.receive(event('old','ORDER 1x1 | Takeaway | Ali'));await bot.receive(event('change','ab teen chahiye delivery ya takeaway baad mein bataon ga'));await bot.receive(event('confirm','CONFIRM'));assert.equal(ordering.requests(owner).length,0);
});
test('quota exhaustion, unavailable provider, malformed output and timeouts fall back without blocking commands',async t=>{
 const {store,ordering}=fixture(t);let calls=0;const outputs=[{ok:false,status:429},response({oops:true})];const sent=[];
 const bot=whatsappBot(store,ordering,{...config,WHATSAPP_LLM_DAILY_LIMIT:'3'},async(url,o)=>{if(url.includes('generativelanguage')){calls++;if(calls===3)throw new Error('timeout secret should not leak');return outputs[calls-1];}sent.push(JSON.parse(o.body));return {ok:true};});
 for(let i=0;i<4;i++)await bot.receive(event('bad-'+i,'different ambiguous request '+i));assert.equal(calls,3);assert.ok(sent.every(m=>!m.text.body.includes('secret')));
 await bot.receive(event('menu','MENU'));assert.match(sent.at(-1).text.body,/Menu \(PKR/);await bot.receive(event('human','HUMAN'));assert.match(sent.at(-1).text.body,/notified restaurant staff/);assert.equal(calls,3);
});
test('LLM remains opt-in and raw explicit commands do not consume Gemini requests',async t=>{
 const {store,ordering}=fixture(t);let calls=0;const bot=whatsappBot(store,ordering,{...config,WHATSAPP_LLM_ENABLED:'0'},async(url)=>{if(url.includes('generativelanguage'))calls++;return {ok:true};});await bot.receive(event('off','menu dikha dein'));assert.equal(calls,0);
});
